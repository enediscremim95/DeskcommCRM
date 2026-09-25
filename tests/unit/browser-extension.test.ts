import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_EXTENSION_HEARTBEAT_INTERVAL_MS,
  BROWSER_EXTENSION_PAIRING_KEY,
  BrowserExtensionHeartbeat,
} from "@/app/app/_components/BrowserExtensionHeartbeat";

import {
  EXTENSION_PRESENCE_MAX_AGE_MS,
  WHATSAPP_EXTENSION_ID,
  WHATSAPP_EXTENSION_MANIFEST_KEY,
  WHATSAPP_EXTENSION_ORIGIN,
} from "@/lib/browser-extension/constants";
import {
  headersCorsDaExtensao,
  origemDaExtensaoPermitida,
  respostaPreflightDaExtensao,
} from "@/lib/browser-extension/cors";
import { criarPacoteDaExtensao } from "@/lib/browser-extension/package";
import {
  hashExtensionSecret,
  novoCodigoDePareamento,
  novoTokenDaExtensao,
  segredoConfere,
} from "@/lib/browser-extension/security";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("extensão de apoio no WhatsApp Web", () => {
  it("aceita CORS somente da origem fixa da extensão", () => {
    const permitida = new Request("https://crm.example/api/v1/browser-extension/context", {
      headers: { Origin: WHATSAPP_EXTENSION_ORIGIN },
    });
    const recusada = new Request("https://crm.example/api/v1/browser-extension/context", {
      headers: { Origin: "chrome-extension://outra" },
    });

    expect(origemDaExtensaoPermitida(permitida)).toBe(true);
    expect(origemDaExtensaoPermitida(recusada)).toBe(false);
    expect(respostaPreflightDaExtensao(recusada).status).toBe(403);
    expect(new Headers(headersCorsDaExtensao()).get("Access-Control-Allow-Origin")).toBe(
      WHATSAPP_EXTENSION_ORIGIN,
    );
  });

  it("emite segredos aleatórios e compara somente pelo hash", () => {
    const codeA = novoCodigoDePareamento();
    const codeB = novoCodigoDePareamento();
    const token = novoTokenDaExtensao();

    expect(codeA).not.toBe(codeB);
    expect(token).toMatch(/^ext_[A-Za-z0-9_-]{40,}$/);
    expect(segredoConfere(codeA, hashExtensionSecret(codeA))).toBe(true);
    expect(segredoConfere(codeB, hashExtensionSecret(codeA))).toBe(false);
  });

  it("gera um Manifest V3 fechado na origem do CRM e no WhatsApp Web", () => {
    const files = unzipSync(criarPacoteDaExtensao("https://crm.example"));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as {
      manifest_version: number;
      key: string;
      host_permissions: string[];
      externally_connectable: { matches: string[] };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.key).toBeTruthy();
    expect(manifest.host_permissions).toEqual([
      "https://crm.example/*",
      "https://web.whatsapp.com/*",
    ]);
    expect(manifest.externally_connectable.matches).toEqual(["https://crm.example/*"]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
    expect(files["vendor/wppconnect-wa.js"]).toBeTruthy();
    expect(files["vendor/wppconnect-wa.js.LICENSE.txt"]).toBeTruthy();
  });

  it("mantém o ID fixo coerente com a chave pública do manifesto", () => {
    const digest = createHash("sha256")
      .update(Buffer.from(WHATSAPP_EXTENSION_MANIFEST_KEY, "base64"))
      .digest()
      .subarray(0, 16);
    const derivedId = [...digest]
      .flatMap((byte) => [byte >> 4, byte & 15])
      .map((nibble) => "abcdefghijklmnop"[nibble])
      .join("");

    expect(derivedId).toBe(WHATSAPP_EXTENSION_ID);
  });

  it("isola o único envio de voz com OGG/Opus e isPtt, sem fallback como anexo", () => {
    const files = unzipSync(criarPacoteDaExtensao("https://crm.example"));
    const bridge = strFromU8(files["page-bridge.js"]!);

    expect(bridge).toContain("async function sendVoiceMessage");
    expect(bridge).toContain('type: "audio"');
    expect(bridge).toContain("isPtt: true");
    expect(bridge).toContain('mimetype: "audio/ogg; codecs=opus"');
    expect(bridge.match(/sendFileMessage/g)).toHaveLength(1);
  });

  it("não cria uma porta pública diferente das rotas autenticadas da extensão", () => {
    const source = readFileSync(join(process.cwd(), "lib", "auth", "public-paths.ts"), "utf8");
    expect(source).toContain("api\\/v1\\/browser-extension");
    expect(WHATSAPP_EXTENSION_ID).toHaveLength(32);
  });

  it("mantém o pulso no shell autenticado sem guardar o token no CRM", () => {
    const heartbeat = readFileSync(
      join(process.cwd(), "app", "app", "_components", "BrowserExtensionHeartbeat.tsx"),
      "utf8",
    );
    const layout = readFileSync(join(process.cwd(), "app", "app", "layout.tsx"), "utf8");

    expect(layout).toContain("<BrowserExtensionHeartbeat />");
    expect(heartbeat).toContain("window.sessionStorage");
    expect(heartbeat).toContain("pairing/heartbeat");
    expect(heartbeat).not.toContain("accessToken");
  });

  it("desfaz o pareamento quando o pulso responde 401", async () => {
    window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, "pairing-401");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(createElement(BrowserExtensionHeartbeat));

    await waitFor(() => {
      expect(window.sessionStorage.getItem(BROWSER_EXTENSION_PAIRING_KEY)).toBeNull();
    });
  });

  it("mantém o pareamento quando o pulso responde 500", async () => {
    window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, "pairing-500");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(BrowserExtensionHeartbeat));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(BROWSER_EXTENSION_PAIRING_KEY)).toBe("pairing-500");
  });

  it("mantém o pareamento quando a rede falha", async () => {
    window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, "pairing-rede");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("rede indisponível"));
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(BrowserExtensionHeartbeat));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(BROWSER_EXTENSION_PAIRING_KEY)).toBe("pairing-rede");
  });

  it("deriva o intervalo como um quarto da janela de presença", () => {
    expect(BROWSER_EXTENSION_HEARTBEAT_INTERVAL_MS).toBe(
      EXTENSION_PRESENCE_MAX_AGE_MS / 4,
    );
  });
});
