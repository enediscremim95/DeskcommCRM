/**
 * Vigia de infraestrutura executada FORA do app e do banco observado.
 *
 * Ela usa apenas HTTP, um arquivo de estado em volume próprio e o transporte
 * de WhatsApp diretamente. Se o banco cair, não há query de configuração,
 * fila ou audit log no caminho do aviso. O processo companheiro (`watchdog`)
 * lê o heartbeat do mesmo volume e avisa quando esta vigia para de atualizá-lo.
 *
 * Este arquivo vive na fronteira `lib/channels/` porque é o único lugar em que
 * o nome e o contrato do transporte podem aparecer. A regra de negócio abaixo
 * fala em componentes, incidentes e destinatário, nunca em lead/conversa.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Com checagem a cada 60 s, três falhas confirmam a queda cerca de dois minutos
// depois do primeiro erro: filtra um soluço sem esconder uma pane como a de 5
// minutos medida em 29/09. A volta pede duas respostas para não oscilar.
export const FALHAS_PARA_CONFIRMAR = 3;
export const SUCESSOS_PARA_CONFIRMAR_VOLTA = 2;
// Uma queda longa não fica silenciosa por um dia inteiro, mas também não vira
// spam: no máximo quatro lembretes por dia, sempre no mesmo incidente.
export const LEMBRETE_INCIDENTE_MS = 6 * 60 * 60 * 1000;
export const HEARTBEAT_EXPIRADO_MS = 5 * 60 * 1000;
export const LIMITE_MIDIA_BYTES_PADRAO = 3_150_000_000;
export const ALERTA_MIDIA_BYTES_PADRAO = 2_370_000_000;

const COMPONENTES = ["app", "supabase", "redis", "waha"];

function numeroPositivo(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function estadoInicial(agora = Date.now()) {
  return {
    fase: "up",
    falhas_consecutivas: 0,
    sucessos_consecutivos: 0,
    incidente_iniciado_em: null,
    ultimo_aviso_em: null,
    ultimo_diagnostico: null,
    heartbeat_at: new Date(agora).toISOString(),
    nivel_midia: "normal",
  };
}

export function observacaoDoHealth(payload, healthAlcancavel, supabaseDiretoOk = false) {
  if (!healthAlcancavel || !payload?.data?.checks) {
    return {
      caiu: true,
      componentes: { app: { status: "down", reason: "health_inacessivel" } },
    };
  }

  const componentes = { app: { status: "ok" }, ...payload.data.checks };
  if (componentes.supabase?.status === "down" && supabaseDiretoOk) {
    componentes.supabase = {
      ...componentes.supabase,
      status: "degraded",
      reason: "health_3s_excedido_mas_consulta_direta_respondeu",
    };
  }

  return {
    caiu: COMPONENTES.some((nome) => componentes[nome]?.status === "down"),
    componentes,
  };
}

/** Máquina de estado pura. O chamador só persiste depois de tentar o envio. */
export function avaliarSaude(anterior, observacao, agora = Date.now()) {
  const estado = { ...estadoInicial(agora), ...anterior };
  estado.heartbeat_at = new Date(agora).toISOString();
  estado.ultimo_diagnostico = observacao.componentes;
  const eventos = [];

  if (estado.fase === "up") {
    estado.sucessos_consecutivos = 0;
    estado.falhas_consecutivas = observacao.caiu ? estado.falhas_consecutivas + 1 : 0;
    if (estado.falhas_consecutivas >= FALHAS_PARA_CONFIRMAR) {
      estado.fase = "down";
      estado.incidente_iniciado_em = new Date(agora).toISOString();
      estado.ultimo_aviso_em = new Date(agora).toISOString();
      eventos.push({ tipo: "caiu", componentes: observacao.componentes });
    }
    return { estado, eventos };
  }

  if (observacao.caiu) {
    estado.sucessos_consecutivos = 0;
    const ultimo = Date.parse(estado.ultimo_aviso_em ?? estado.incidente_iniciado_em ?? "");
    if (!Number.isFinite(ultimo) || agora - ultimo >= LEMBRETE_INCIDENTE_MS) {
      estado.ultimo_aviso_em = new Date(agora).toISOString();
      eventos.push({ tipo: "continua_fora", componentes: observacao.componentes });
    }
    return { estado, eventos };
  }

  estado.sucessos_consecutivos += 1;
  if (estado.sucessos_consecutivos >= SUCESSOS_PARA_CONFIRMAR_VOLTA) {
    eventos.push({
      tipo: "voltou",
      componentes: observacao.componentes,
      incidente_iniciado_em: estado.incidente_iniciado_em,
    });
    estado.fase = "up";
    estado.falhas_consecutivas = 0;
    estado.sucessos_consecutivos = 0;
    estado.incidente_iniciado_em = null;
    estado.ultimo_aviso_em = null;
  }
  return { estado, eventos };
}

export function avaliarOcupacaoDeMidia(
  nivelAnterior,
  bytes,
  alertaBytes = ALERTA_MIDIA_BYTES_PADRAO,
  limiteBytes = LIMITE_MIDIA_BYTES_PADRAO,
) {
  const nivel = bytes >= limiteBytes ? "limite" : bytes >= alertaBytes ? "alerta" : "normal";
  if (nivel === nivelAnterior) return { nivel, evento: null };
  if (nivel === "normal") return { nivel, evento: { tipo: "midia_normalizada", bytes } };
  return { nivel, evento: { tipo: nivel === "limite" ? "midia_no_limite" : "midia_em_alerta", bytes } };
}

export function heartbeatDaVigiaExpirou(heartbeatAt, observandoDesde, agora = Date.now()) {
  const heartbeat = Date.parse(heartbeatAt ?? "");
  if (Number.isFinite(heartbeat)) return agora - heartbeat > HEARTBEAT_EXPIRADO_MS;

  const inicio = Date.parse(observandoDesde ?? "");
  return Number.isFinite(inicio) && agora - inicio > HEARTBEAT_EXPIRADO_MS;
}

function descricaoComponentes(componentes) {
  return COMPONENTES.filter((nome) => componentes?.[nome]?.status === "down")
    .map((nome) => {
      const motivo = componentes[nome]?.reason;
      return motivo ? `${nome} (${motivo})` : nome;
    })
    .join(", ") || "componente não identificado";
}

function formatarBytes(bytes) {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function textoDoEvento(evento, contexto = {}) {
  const marca = contexto.marca || "CRM";
  if (evento.tipo === "caiu") {
    return `🔴 ${marca} fora do ar. Peça afetada: ${descricaoComponentes(evento.componentes)}. A vigia confirmou ${FALHAS_PARA_CONFIRMAR} falhas seguidas antes deste aviso.`;
  }
  if (evento.tipo === "continua_fora") {
    return `🟠 ${marca} continua fora do ar. Peça afetada agora: ${descricaoComponentes(evento.componentes)}. Este é o lembrete de 6 horas do mesmo incidente.`;
  }
  if (evento.tipo === "voltou") {
    return `🟢 ${marca} voltou. Supabase, Redis e WhatsApp responderam em ${SUCESSOS_PARA_CONFIRMAR_VOLTA} checagens seguidas.`;
  }
  if (evento.tipo === "midia_em_alerta") {
    return `🟠 Mídia do WhatsApp ocupando ${formatarBytes(evento.bytes)}. O aviso dispara em ${formatarBytes(contexto.alertaBytes)} e o teto é ${formatarBytes(contexto.limiteBytes)}; o expurgo diário remove arquivos com mais de ${contexto.retencaoDias} dias.`;
  }
  if (evento.tipo === "midia_no_limite") {
    return `🔴 Mídia do WhatsApp chegou a ${formatarBytes(evento.bytes)}, acima do teto de ${formatarBytes(contexto.limiteBytes)}. Arquivos novos deixam de ser guardados até o expurgo abrir espaço; as mensagens e os textos continuam no CRM.`;
  }
  if (evento.tipo === "midia_normalizada") {
    return `🟢 Uso de mídia normalizado em ${formatarBytes(evento.bytes)}, abaixo do aviso de ${formatarBytes(contexto.alertaBytes)}.`;
  }
  if (evento.tipo === "vigia_parou") {
    return `🔴 A vigia do ${marca} parou de atualizar o heartbeat há mais de 5 minutos. O processo companheiro continua ativo e detectou a falha.`;
  }
  if (evento.tipo === "vigia_voltou") {
    return `🟢 A vigia do ${marca} voltou a atualizar o heartbeat.`;
  }
  return `${marca}: evento de infraestrutura sem descrição.`;
}

async function fetchComTimeout(url, init = {}, timeoutMs = 10_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function lerJson(caminho, padrao) {
  try {
    return JSON.parse(await readFile(caminho, "utf8"));
  } catch {
    return padrao;
  }
}

async function gravarJsonAtomico(caminho, valor) {
  await mkdir(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  await writeFile(temporario, `${JSON.stringify(valor)}\n`, { mode: 0o600 });
  await rename(temporario, caminho);
}

async function consultarHealth(config) {
  try {
    const resposta = await fetchComTimeout(
      config.healthUrl,
      { headers: { Authorization: `Bearer ${config.internalSecret}` } },
      config.healthTimeoutMs,
    );
    const payload = await resposta.json();
    const supabaseCaiu = payload?.data?.checks?.supabase?.status === "down";
    const supabaseDiretoOk = supabaseCaiu ? await consultarSupabaseDireto(config) : false;
    return observacaoDoHealth(payload, true, supabaseDiretoOk);
  } catch {
    return observacaoDoHealth(null, false, await consultarSupabaseDireto(config));
  }
}

async function consultarSupabaseDireto(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return false;
  try {
    const resposta = await fetchComTimeout(
      `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/organizations?select=id&limit=1`,
      {
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
        },
      },
      12_000,
    );
    // Só 2xx prova que a consulta atravessou o gateway e chegou ao PostgREST.
    // 401/403 pode ser respondido antes do banco e não serve para desmentir
    // uma queda reportada pelo health.
    return resposta.ok;
  } catch {
    return false;
  }
}

async function consultarUsoDeMidia(config) {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
  try {
    const resposta = await fetchComTimeout(
      `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/fn_total_midia_armazenada_bytes`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseServiceKey,
          Authorization: `Bearer ${config.supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
      12_000,
    );
    if (!resposta.ok) return null;
    const valor = Number(await resposta.json());
    return Number.isFinite(valor) && valor >= 0 ? valor : null;
  } catch {
    return null;
  }
}

async function resolverChatId(config) {
  const destinatario = config.destinatario.trim();
  if (destinatario.includes("@")) return destinatario;
  const digitos = destinatario.replace(/\D/g, "");
  if (!digitos) throw new Error("VIGIA_WHATSAPP_TO sem número válido");
  try {
    const url = new URL(`${config.transporteUrl.replace(/\/$/, "")}/api/contacts/check-exists`);
    url.searchParams.set("session", config.sessao);
    url.searchParams.set("phone", digitos);
    const resposta = await fetchComTimeout(url, { headers: { "X-Api-Key": config.transporteKey } });
    if (resposta.ok) {
      const corpo = await resposta.json();
      if (corpo?.numberExists && typeof corpo.chatId === "string" && corpo.chatId.trim()) {
        return corpo.chatId.trim();
      }
    }
  } catch {
    // A resolução é enriquecimento. O envio ainda tenta o JID telefônico.
  }
  return `${digitos}@c.us`;
}

async function enviarWhatsApp(config, texto) {
  if (!config.destinatario) throw new Error("VIGIA_WHATSAPP_TO não configurado");
  const chatId = await resolverChatId(config);
  const resposta = await fetchComTimeout(`${config.transporteUrl.replace(/\/$/, "")}/api/sendText`, {
    method: "POST",
    headers: { "X-Api-Key": config.transporteKey, "Content-Type": "application/json" },
    body: JSON.stringify({ session: config.sessao, chatId, text: texto }),
  });
  if (!resposta.ok) throw new Error(`transporte_http_${resposta.status}`);
}

function configuracao() {
  return {
    healthUrl: process.env.VIGIA_HEALTH_URL || "http://app:3000/api/v1/health?verbose=1",
    internalSecret: process.env.INTERNAL_SECRET || "",
    healthTimeoutMs: numeroPositivo(process.env.VIGIA_HEALTH_TIMEOUT_MS, 20_000),
    intervaloMs: numeroPositivo(process.env.VIGIA_INTERVAL_SECONDS, 60) * 1000,
    mediaIntervalMs: numeroPositivo(process.env.VIGIA_MEDIA_INTERVAL_SECONDS, 300) * 1000,
    statePath: process.env.VIGIA_STATE_PATH || "/state/vigia.json",
    watchdogStatePath: process.env.VIGIA_WATCHDOG_STATE_PATH || "/state/watchdog.json",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    transporteUrl: process.env.WAHA_API_BASE_URL || "http://waha:3000",
    transporteKey: process.env.WAHA_API_KEY || "",
    destinatario: process.env.VIGIA_WHATSAPP_TO || "",
    sessao: process.env.VIGIA_WHATSAPP_SESSION || "default",
    marca: process.env.APP_NAME || "CRM",
    alertaBytes: numeroPositivo(process.env.WHATSAPP_MEDIA_STORAGE_ALERT_BYTES, ALERTA_MIDIA_BYTES_PADRAO),
    limiteBytes: numeroPositivo(process.env.WHATSAPP_MEDIA_STORAGE_CAP_BYTES, LIMITE_MIDIA_BYTES_PADRAO),
    retencaoDias: numeroPositivo(process.env.WHATSAPP_MEDIA_RETENTION_DAYS, 21),
  };
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function executarVigia() {
  const config = configuracao();
  let ultimoCheckMidia = 0;
  process.stdout.write(`vigia: ativa; destino ${config.destinatario ? "configurado" : "AUSENTE"}\n`);
  for (;;) {
    const agora = Date.now();
    const anterior = await lerJson(config.statePath, estadoInicial(agora));
    const observacao = await consultarHealth(config);
    const avaliado = avaliarSaude(anterior, observacao, agora);

    if (agora - ultimoCheckMidia >= config.mediaIntervalMs) {
      const uso = await consultarUsoDeMidia(config);
      if (uso !== null) {
        const midia = avaliarOcupacaoDeMidia(
          avaliado.estado.nivel_midia,
          uso,
          config.alertaBytes,
          config.limiteBytes,
        );
        avaliado.estado.nivel_midia = midia.nivel;
        if (midia.evento) avaliado.eventos.push(midia.evento);
      }
      ultimoCheckMidia = agora;
    }

    const nivelMidiaAnterior = anterior.nivel_midia ?? "normal";
    for (const evento of avaliado.eventos) {
      try {
        await enviarWhatsApp(config, textoDoEvento(evento, config));
      } catch (erro) {
        process.stderr.write(`vigia: aviso não entregue: ${erro instanceof Error ? erro.message : String(erro)}\n`);
        if (evento.tipo === "caiu") {
          avaliado.estado.fase = anterior.fase ?? "up";
          avaliado.estado.falhas_consecutivas = FALHAS_PARA_CONFIRMAR - 1;
          avaliado.estado.sucessos_consecutivos = anterior.sucessos_consecutivos ?? 0;
          avaliado.estado.incidente_iniciado_em = anterior.incidente_iniciado_em ?? null;
          avaliado.estado.ultimo_aviso_em = anterior.ultimo_aviso_em ?? null;
        } else if (evento.tipo === "voltou") {
          avaliado.estado.fase = anterior.fase ?? "down";
          avaliado.estado.falhas_consecutivas = anterior.falhas_consecutivas ?? FALHAS_PARA_CONFIRMAR;
          avaliado.estado.sucessos_consecutivos = SUCESSOS_PARA_CONFIRMAR_VOLTA - 1;
          avaliado.estado.incidente_iniciado_em = anterior.incidente_iniciado_em ?? null;
          avaliado.estado.ultimo_aviso_em = anterior.ultimo_aviso_em ?? null;
        } else if (evento.tipo === "continua_fora") {
          avaliado.estado.ultimo_aviso_em = anterior.ultimo_aviso_em ?? null;
        } else if (evento.tipo.startsWith("midia_")) {
          avaliado.estado.nivel_midia = nivelMidiaAnterior;
        }
      }
    }
    await gravarJsonAtomico(config.statePath, avaliado.estado);
    await esperar(config.intervaloMs);
  }
}

async function executarWatchdog() {
  const config = configuracao();
  process.stdout.write("vigia-watchdog: ativo\n");
  for (;;) {
    const agora = Date.now();
    const principal = await lerJson(config.statePath, null);
    const proprio = await lerJson(config.watchdogStatePath, {
      vigia_estava_parada: false,
      observando_desde: new Date(agora).toISOString(),
    });
    proprio.observando_desde ??= new Date(agora).toISOString();
    const parada = heartbeatDaVigiaExpirou(
      principal?.heartbeat_at,
      proprio.observando_desde,
      agora,
    );
    if (parada !== proprio.vigia_estava_parada) {
      const evento = { tipo: parada ? "vigia_parou" : "vigia_voltou" };
      try {
        await enviarWhatsApp(config, textoDoEvento(evento, config));
        proprio.vigia_estava_parada = parada;
      } catch (erro) {
        process.stderr.write(`vigia-watchdog: aviso não entregue: ${erro instanceof Error ? erro.message : String(erro)}\n`);
      }
    }
    proprio.heartbeat_at = new Date(agora).toISOString();
    await gravarJsonAtomico(config.watchdogStatePath, proprio);
    await esperar(config.intervaloMs);
  }
}

async function healthcheck(modo) {
  const config = configuracao();
  const caminho = modo === "watchdog" ? config.watchdogStatePath : config.statePath;
  try {
    const info = await stat(caminho);
    process.exit(Date.now() - info.mtimeMs <= HEARTBEAT_EXPIRADO_MS * 2 ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

const executadoDiretamente = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDiretamente) {
  const modo = process.argv[2] || "monitor";
  if (modo === "watchdog") await executarWatchdog();
  else if (modo === "healthcheck") await healthcheck(process.argv[3] || "monitor");
  else await executarVigia();
}
