import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

import {
  WHATSAPP_EXTENSION_ID,
  WHATSAPP_EXTENSION_MANIFEST_KEY,
} from "@/lib/browser-extension/constants";

function jsString(value: string): string {
  return JSON.stringify(value);
}

function manifest(crmOrigin: string): string {
  return JSON.stringify(
    {
      manifest_version: 3,
      name: "Apoio ao atendimento",
      version: "1.0.0",
      description: "Respostas, áudios e ficha do lead ao lado do WhatsApp Web.",
      key: WHATSAPP_EXTENSION_MANIFEST_KEY,
      permissions: ["sidePanel", "storage", "tabs"],
      host_permissions: [`${crmOrigin}/*`, "https://web.whatsapp.com/*"],
      externally_connectable: { matches: [`${crmOrigin}/*`] },
      background: { service_worker: "background.js" },
      action: { default_title: "Abrir apoio ao atendimento" },
      side_panel: { default_path: "panel.html" },
      content_scripts: [
        { matches: ["https://web.whatsapp.com/*"], js: ["content.js"], run_at: "document_idle" },
      ],
      web_accessible_resources: [
        {
          resources: ["vendor/wppconnect-wa.js", "page-bridge.js"],
          matches: ["https://web.whatsapp.com/*"],
        },
      ],
    },
    null,
    2,
  );
}

const BACKGROUND = `
importScripts("config.js");
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function api(path, options = {}) {
  const stored = await chrome.storage.session.get(["accessToken"]);
  if (!stored.accessToken) throw new Error("Entre no CRM para usar.");
  const headers = { "X-Extension-Id": EXTENSION_ID, ...(options.headers || {}) };
  headers.Authorization = "Bearer " + stored.accessToken;
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(CRM_ORIGIN + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (options.responseType === "arrayBuffer" && response.ok) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true, dataUrl: "data:audio/ogg;base64," + btoa(binary) };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || "Não foi possível falar com o CRM.");
  return payload;
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== CRM_ORIGIN || message?.type !== "pair" || typeof message.code !== "string") return;
  (async () => {
    const response = await fetch(CRM_ORIGIN + "/api/v1/browser-extension/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Extension-Id": EXTENSION_ID,
        "X-CRM-Origin": CRM_ORIGIN,
      },
      body: JSON.stringify({ pairing_code: message.code, crm_origin: CRM_ORIGIN }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || "Pareamento recusado.");
    await chrome.storage.session.set({ accessToken: payload.data.access_token });
    return { ok: true, pairingId: payload.data.pairing_id };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "api") return;
  api(message.path, message.options).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});
`;

const CONTENT = `
const vendor = document.createElement("script");
vendor.src = chrome.runtime.getURL("vendor/wppconnect-wa.js");
vendor.onload = () => {
  const bridge = document.createElement("script");
  bridge.src = chrome.runtime.getURL("page-bridge.js");
  document.documentElement.appendChild(bridge);
};
document.documentElement.appendChild(vendor);

function pageCall(type, payload = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WhatsApp Web não respondeu.")), 10000);
    function onMessage(event) {
      if (event.source !== window || event.data?.source !== "crm-whatsapp-bridge" || event.data.requestId !== requestId) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error || "Operação recusada."));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "crm-whatsapp-extension", requestId, type, payload }, "https://web.whatsapp.com");
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["active-phone", "paste-text", "send-voice"].includes(message?.type)) return;
  pageCall(message.type, message.payload).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
`;

const PAGE_BRIDGE = `
(function () {
  function digits(value) { return String(value || "").replace(/\\D/g, ""); }
  async function ready() {
    for (let i = 0; i < 100; i++) {
      if (window.WPP?.chat?.getActiveChat) return window.WPP;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Recarregue o WhatsApp Web para ativar o apoio.");
  }
  async function activeChat() {
    const WPP = await ready();
    const chat = await WPP.chat.getActiveChat();
    if (!chat) throw new Error("Abra uma conversa no WhatsApp Web.");
    return { WPP, chat };
  }
  function phoneFromChat(chat) {
    const candidates = [chat?.id?.user, chat?.contact?.phoneNumber?.user, chat?.contact?.id?.user, chat?.id?._serialized];
    const phone = candidates.map(digits).find((value) => value.length >= 10 && value.length <= 15);
    if (!phone) throw new Error("Não foi possível reconhecer o número desta conversa.");
    return phone;
  }
  async function sendVoiceMessage(chatId, dataUrl) {
    const WPP = await ready();
    return WPP.chat.sendFileMessage(chatId, dataUrl, {
      type: "audio",
      isPtt: true,
      filename: "voz.ogg",
      mimetype: "audio/ogg; codecs=opus",
    });
  }
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== "https://web.whatsapp.com" || event.data?.source !== "crm-whatsapp-extension") return;
    const { requestId, type, payload } = event.data;
    try {
      const { WPP, chat } = await activeChat();
      let result;
      if (type === "active-phone") result = { phone: phoneFromChat(chat) };
      else if (type === "paste-text") result = await WPP.chat.setInputText(payload.text);
      else if (type === "send-voice") result = await sendVoiceMessage(chat.id, payload.dataUrl);
      else throw new Error("Operação desconhecida.");
      window.postMessage({ source: "crm-whatsapp-bridge", requestId, ok: true, result }, "https://web.whatsapp.com");
    } catch (error) {
      window.postMessage({ source: "crm-whatsapp-bridge", requestId, ok: false, error: error?.message || "Falha no WhatsApp Web." }, "https://web.whatsapp.com");
    }
  });
})();
`;

const PANEL_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="panel.css"><title>Apoio ao atendimento</title></head><body><header><span class="eyebrow">APOIO AO ATENDIMENTO</span><button id="refresh" title="Atualizar">↻</button></header><main><div id="status" class="status">Abra uma conversa no WhatsApp Web.</div><section id="lead" hidden></section><nav><button data-tab="texts" class="active">Mensagens</button><button data-tab="audios">Áudios</button><button data-tab="notes">Anotar</button></nav><input id="search" placeholder="Buscar por título ou atalho"><div id="list"></div><section id="notes" hidden><textarea id="note" maxlength="2000" placeholder="O que a equipe precisa lembrar?"></textarea><button id="save-note" class="primary">Salvar anotação</button><label for="stage">Etapa do funil</label><select id="stage"></select><button id="save-stage">Mudar etapa</button></section></main><script src="panel.js"></script></body></html>`;

const PANEL_CSS = `:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#142019;background:#f5f7f4}*{box-sizing:border-box}body{margin:0;min-width:320px}header{display:flex;justify-content:space-between;align-items:center;padding:18px;background:#142019;color:#fff}.eyebrow{font-size:11px;letter-spacing:.14em;font-weight:800}button{border:1px solid #cbd4cc;background:#fff;color:#142019;border-radius:8px;padding:9px 11px;font-weight:700;cursor:pointer}header button{background:transparent;color:#fff;border-color:#4a5b50;font-size:18px;padding:2px 8px}main{padding:14px}.status{padding:12px;border-radius:8px;background:#e7eee8;font-size:13px;margin-bottom:12px}.status.error{background:#fbe7e4;color:#8b261d}#lead{background:#fff;border:1px solid #dce3dd;border-radius:12px;padding:14px;margin-bottom:12px}#lead h2{font-size:17px;margin:0 0 6px}#lead h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}.recent-note{font-size:12px;color:#526057;margin:5px 0;padding-left:8px;border-left:2px solid #79d440}.meta{font-size:12px;color:#68746c;display:flex;gap:8px;flex-wrap:wrap}nav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0}nav button.active{background:#142019;color:#fff;border-color:#142019}#search,textarea,select{width:100%;border:1px solid #cbd4cc;border-radius:8px;background:#fff;padding:10px;margin-bottom:10px;font:inherit}.item{background:#fff;border:1px solid #dce3dd;border-radius:10px;padding:12px;margin:8px 0}.item strong{display:block;margin-bottom:5px}.item p{font-size:13px;color:#526057;white-space:pre-wrap;margin:0 0 9px}.item button{width:100%}.primary{background:#79d440;border-color:#79d440;width:100%}#notes button{width:100%;margin-bottom:12px}label{display:block;font-size:12px;font-weight:800;margin:4px 0 6px}`;

const PANEL_JS = `
let state={templates:[],context:null,tab:"texts"};
const $=(id)=>document.getElementById(id);
function status(text,error=false){$("status").textContent=text;$("status").className="status"+(error?" error":"");}
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!tab.url?.startsWith("https://web.whatsapp.com/"))throw new Error("Abra o WhatsApp Web neste navegador.");return tab;}
function tabMessage(tabId,message){return new Promise((resolve,reject)=>chrome.tabs.sendMessage(tabId,message,(response)=>{if(chrome.runtime.lastError)reject(new Error("Recarregue o WhatsApp Web para ativar o apoio."));else if(!response?.ok)reject(new Error(response?.error||"Operação não concluída."));else resolve(response.result)}));}
function bgApi(path,options){return new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:"api",path,options},(response)=>{if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));else if(response?.error)reject(new Error(response.error));else resolve(response)}));}
async function load(){try{status("Lendo a conversa aberta...");const tab=await activeTab();const active=await tabMessage(tab.id,{type:"active-phone"});const [context,templates]=await Promise.all([bgApi("/api/v1/browser-extension/context?phone="+encodeURIComponent(active.phone)),bgApi("/api/v1/browser-extension/templates")]);state.context=context.data;state.templates=templates.data;render();status(state.context.contact?"Ficha ligada ao CRM.":"Este número ainda não está no CRM.");}catch(error){status(error.message,true);$("lead").hidden=true;$("list").innerHTML="";}}
function render(){const c=state.context;$("lead").hidden=!c?.contact;if(c?.contact){const recent=(c.notes||[]).map(n=>'<p class="recent-note">'+escapeHtml(n.body)+'</p>').join("");$("lead").innerHTML='<h2>'+escapeHtml(c.contact.name||"Contato sem nome")+'</h2><div class="meta"><span>'+escapeHtml(c.lead?.stage_name||"Sem negócio")+'</span><span>'+escapeHtml(c.lead?.source||"")+'</span></div>'+(recent?'<h3>Últimas anotações</h3>'+recent:'');}const search=$("search").value.toLowerCase();const list=state.templates.filter(t=>(state.tab==="audios"?t.has_audio:true)&&((t.title+" "+(t.shortcut||"")+" "+t.body).toLowerCase().includes(search)));$("list").innerHTML=list.map(t=>'<article class="item"><strong>'+escapeHtml(t.title)+'</strong><p>'+escapeHtml(t.body)+'</p><button data-template="'+t.id+'">'+(state.tab==="audios"?"Enviar como voz":"Colar no campo")+'</button></article>').join("")||'<p>Nenhum item encontrado.</p>';$("search").hidden=state.tab==="notes";$("list").hidden=state.tab==="notes";$("notes").hidden=state.tab!=="notes";if(c?.lead){$("stage").innerHTML=c.stages.map(s=>'<option value="'+s.id+'"'+(s.id===c.lead.stage_id?' selected':'')+'>'+escapeHtml(s.name)+'</option>').join("");}else $("stage").innerHTML="";}
function escapeHtml(v){const e=document.createElement("span");e.textContent=String(v||"");return e.innerHTML;}
document.addEventListener("click",async(e)=>{const id=e.target?.dataset?.template;if(!id)return;const template=state.templates.find(t=>t.id===id);try{const tab=await activeTab();if(state.tab==="audios"){status("Enviando a mensagem de voz...");const audio=await bgApi("/api/v1/browser-extension/templates/"+id+"/audio",{responseType:"arrayBuffer"});await tabMessage(tab.id,{type:"send-voice",payload:{dataUrl:audio.dataUrl}});status("Mensagem de voz enviada.");}else{await tabMessage(tab.id,{type:"paste-text",payload:{text:template.body}});status("Mensagem colocada no campo. Revise e envie.");}}catch(error){status(error.message,true);}});
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.tab=b.dataset.tab;render();}));
$("search").addEventListener("input",render);$("refresh").addEventListener("click",load);
$("save-note").addEventListener("click",async()=>{try{if(!state.context?.lead)throw new Error("Este contato ainda não tem negócio no CRM.");await bgApi("/api/v1/browser-extension/leads/"+state.context.lead.id+"/note",{method:"POST",body:{body:$("note").value}});$("note").value="";status("Anotação salva no CRM.");await load();}catch(error){status(error.message,true);}});
$("save-stage").addEventListener("click",async()=>{try{if(!state.context?.lead)throw new Error("Este contato ainda não tem negócio no CRM.");await bgApi("/api/v1/browser-extension/leads/"+state.context.lead.id+"/stage",{method:"PATCH",body:{stage_id:$("stage").value}});status("Etapa atualizada no CRM.");await load();}catch(error){status(error.message,true);}});
load();
`;

export function criarPacoteDaExtensao(crmOrigin: string): Uint8Array {
  const require = createRequire(import.meta.url);
  const wppPath = require.resolve("@wppconnect/wa-js");
  const wppDir = dirname(wppPath);
  const wppBundle = readFileSync(wppPath);
  const wppLicense = readFileSync(join(wppDir, "wppconnect-wa.js.LICENSE.txt"));
  const config = `const CRM_ORIGIN=${jsString(crmOrigin)};const EXTENSION_ID=${jsString(WHATSAPP_EXTENSION_ID)};`;
  return zipSync(
    {
      "manifest.json": strToU8(manifest(crmOrigin)),
      "config.js": strToU8(config),
      "background.js": strToU8(BACKGROUND),
      "content.js": strToU8(CONTENT),
      "page-bridge.js": strToU8(PAGE_BRIDGE),
      "panel.html": strToU8(PANEL_HTML),
      "panel.css": strToU8(PANEL_CSS),
      "panel.js": strToU8(PANEL_JS),
      "vendor/wppconnect-wa.js": new Uint8Array(wppBundle),
      "vendor/wppconnect-wa.js.LICENSE.txt": new Uint8Array(wppLicense),
      "LEIA-ME.txt": strToU8(
        "1. Extraia esta pasta.\n2. Abra chrome://extensions.\n3. Ative o modo do desenvolvedor.\n4. Clique em Carregar sem compactação e escolha esta pasta.\n5. Volte ao CRM aberto para o pareamento automático.\n",
      ),
    },
    { level: 9 },
  );
}
