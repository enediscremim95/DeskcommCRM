'use strict';
// Política da instalação Veritas: carregada ANTES do app/worker pelo NODE_OPTIONS.
// Nenhum prompt, resposta, id de cliente ou credencial entra neste log.
const MODEL = 'deepseek/deepseek-v4-flash';
const ENDPOINT = 'https://openrouter.ai/api/v1';
const OPENAI_BYOK_MODELS = new Set(['gpt-5.4-mini', 'gpt-5-mini']);
const log = (event, data = {}) => process.stderr.write(JSON.stringify({ scope: 'crm_llm_lock', event, ...data }) + '\n');
if (process.env.CRM_LLM_LOCK_MODEL !== MODEL || process.env.OPENROUTER_BASE_URL !== ENDPOINT) {
  throw new Error('crm_llm_lock: configuração obrigatória ausente ou divergente');
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Preload CommonJS executado pelo Node.
const { setTimeout: sleep } = require('node:timers/promises');
const ORDER = ['deepinfra', 'gmicloud', 'baidu', 'streamlake', 'siliconflow', 'parasail'];
const RETRY_MS = [1000, 3000]; // Três tentativas totais, somente no transporte LLM.
const modo = process.env.CRM_LLM_LOCK_MODO ?? 'legado';
if (modo !== 'legado' && modo !== 'lista') {
  throw new Error('crm_llm_lock: modo inválido');
}

const PROVEDORES = {
  'https://openrouter.ai': {
    id: 'openrouter', header: 'authorization',
    caminho: /^\/api\/v1\/(chat\/completions|responses)\/?$/,
  },
  'https://api.openai.com': {
    id: 'openai', header: 'authorization',
    caminho: /^\/v1\/(chat\/completions|responses)\/?$/,
  },
  'https://api.anthropic.com': {
    id: 'anthropic', header: 'x-api-key',
    caminho: /^\/v1\/messages\/?$/,
  },
  'https://generativelanguage.googleapis.com': {
    id: 'google', header: 'x-goog-api-key',
    caminho: /^\/v1(?:beta)?\/models\/([\w.-]+):(?:generateContent|streamGenerateContent)$/,
  },
};

function lerLista() {
  try {
    const lista = JSON.parse(process.env.CRM_LLM_LOCK_LISTA_JSON ?? '');
    if (!lista || Array.isArray(lista) || typeof lista !== 'object') throw new Error();
    const ids = Object.values(PROVEDORES).map(({ id }) => id);
    return new Map(Object.entries(lista).map(([id, modelos]) => {
      if (!ids.includes(id) || !Array.isArray(modelos) ||
          modelos.some((modelo) => typeof modelo !== 'string' || !/^[\w./:-]+$/.test(modelo))) {
        throw new Error();
      }
      return [id, new Set(modelos)];
    }));
  } catch {
    throw new Error('crm_llm_lock: lista de modelos inválida');
  }
}

const lista = modo === 'lista' ? lerLista() : null;

function autorizarChavePropria(input, init, url, payload) {
  const provedor = PROVEDORES[url.origin];
  const caminho = provedor?.caminho.exec(url.pathname);
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  const auth = provedor ? headers.get(provedor.header) : null;
  const chave = provedor?.header === 'authorization' ? /^Bearer (\S+)$/.exec(auth ?? '')?.[1] : auth;
  if (provedor?.id === 'openrouter' && chave && chave === process.env.OPENROUTER_API_KEY) return false;

  const modelo = caminho?.[1] && provedor.id === 'google' ? caminho[1] : payload?.model;
  if (!caminho || !chave || !payload || Array.isArray(payload) || 'models' in payload ||
      url.searchParams.has('key') ||
      [process.env.OPENROUTER_API_KEY, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY,
        process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.GOOGLE_API_KEY].includes(chave) ||
      !lista.get(provedor.id)?.has(modelo)) {
    log('rejected', { reason: 'byok_provider_key_or_model_not_allowed' });
    throw new Error('crm_llm_lock: fornecedor, credencial ou modelo fora da política de chave própria');
  }
  return true;
}
const originalFetch = globalThis.fetch;
function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
async function backoff(attempt, retryAfter, signal, status) {
  const base = RETRY_MS[attempt];
  const delay = Math.max(base + Math.floor(Math.random() * base * 0.25), retryAfter);
  log('retry', { attempt: attempt + 2, status, delay_ms: delay });
  await sleep(delay, undefined, { signal });
}
globalThis.fetch = async function lockedFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'POST') return originalFetch(input, init);
  // Embedding vetorial e transcrição não são modelos de chat; preservados.
  if (/\/(embeddings|audio\/(transcriptions|translations))\/?$/.test(url.pathname)) return originalFetch(input, init);
  let body = init?.body;
  if (body === undefined && input instanceof Request) body = await input.clone().text();
  let payload;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { payload = JSON.parse(body.toString()); } catch { /* corpo não JSON */ }
  }
  const knownProvider = /(^|\.)(openrouter\.ai|openai\.com|anthropic\.com|generativelanguage\.googleapis\.com|ai-gateway\.vercel\.sh)$/.test(url.hostname);
  const chatPath = /\/(chat\/completions|responses|messages|completions)\/?$/.test(url.pathname) || /:generateContent|:streamGenerateContent/.test(url.pathname);
  const hasModel = payload && (modo === 'legado' || typeof payload === 'object') && ('model' in payload || 'models' in payload);
  if (!(knownProvider && (chatPath || hasModel)) && !(chatPath && hasModel)) return originalFetch(input, init);
  if (lista && autorizarChavePropria(input, init, url, payload)) {
    // Headers de API específicos do fornecedor não devem seguir redirecionamentos.
    return originalFetch(input, { ...init, redirect: 'error' });
  }
  // Exceção estreita (23/11, ordem do dono): OpenAI direta SOMENTE com a chave
  // própria da organização (BYOK) e SOMENTE modelos mini permitidos. A chave da
  // OpenRouter nunca é injetada aqui, e a chave de plataforma OPENAI_API_KEY não
  // vale como chave própria. Qualquer outra chamada de chat à OpenAI é recusada.
  if (url.origin === 'https://api.openai.com') {
    const reqHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const auth = reqHeaders.get('authorization') || '';
    const orKey = process.env.OPENROUTER_API_KEY ? 'Bearer ' + process.env.OPENROUTER_API_KEY : null;
    const platKey = process.env.OPENAI_API_KEY ? 'Bearer ' + process.env.OPENAI_API_KEY : null;
    const ownKey = /^Bearer \S{20,}$/.test(auth) && auth !== orKey && auth !== platKey;
    const okPath = /^\/v1\/(chat\/completions|responses)\/?$/.test(url.pathname);
    const okModel = payload && OPENAI_BYOK_MODELS.has(payload.model) &&
      !Object.prototype.hasOwnProperty.call(payload, 'models');
    if (!(ownKey && okPath && okModel)) {
      log('rejected', { reason: 'openai_not_byok_or_model_not_allowed' });
      throw new Error('crm_llm_lock: OpenAI só com chave própria da organização e modelo permitido');
    }
    log('openai_byok', { model: payload.model });
    const response = await originalFetch(input, init);
    if (!payload.stream && response.headers.get('content-type')?.includes('application/json')) {
      const data = await response.clone().json().catch(() => null);
      if (data?.model) {
        log('effective_model', { model: data.model, provider: 'openai', status: response.status });
        if (!String(data.model).startsWith(payload.model)) throw new Error('crm_llm_lock: modelo efetivo divergente');
      } else if (!response.ok) log('provider_error', { status: response.status, code: data?.error?.code });
    }
    return response;
  }
  const valid = url.origin === 'https://openrouter.ai' && url.pathname.startsWith('/api/v1/') && payload?.model === MODEL &&
    !Object.prototype.hasOwnProperty.call(payload, 'models');
  if (!valid) {
    log('rejected', { reason: 'provider_model_or_fallback_not_allowed' });
    throw new Error('crm_llm_lock: somente OpenRouter deepseek/deepseek-v4-flash é permitido; sem fallback de modelo');
  }
  // Nunca troca o modelo: fallback exclusivamente entre provedores FP8 ou superior.
  delete payload.models;
  delete payload.route;
  payload.provider = {
    ...payload.provider,
    order: ORDER,
    allow_fallbacks: true,
    quantizations: ['fp8', 'fp16', 'bf16', 'fp32'],
    ignore: ['atlas-cloud', 'relace', 'wafer'],
  };
  delete payload.provider.only;
  delete payload.provider.sort;
  payload.reasoning = { ...payload.reasoning, enabled: false };
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', 'Bearer ' + process.env.OPENROUTER_API_KEY);
  headers.delete('content-length');
  // Template clonável: permite refazer Request sem reutilizar um body consumido.
  const template = new Request(input, { ...init, method, headers, body: JSON.stringify(payload) });
  const callerSignal = template.signal;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    callerSignal.throwIfAborted();
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(60000)]);
    try {
      response = await originalFetch(template.clone(), { signal });
    } catch (error) {
      // Cancelamento pelo chamador nunca recomeça o atendimento.
      const transient = error?.name === 'TimeoutError' || error instanceof TypeError ||
        /^(ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/.test(error?.cause?.code || '');
      if (callerSignal.aborted || !transient || attempt === 2) throw error;
      await backoff(attempt, 0, callerSignal, 'timeout_or_network');
      continue;
    }
    if (!(response.status === 429 || response.status >= 500 && response.status <= 599) || attempt === 2) break;
    const retryAfter = retryAfterMs(response.headers.get('retry-after'));
    const status = response.status;
    await response.body?.cancel();
    await backoff(attempt, retryAfter, callerSignal, status);
  }
  if (!payload.stream && response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.clone().json().catch(() => null);
    if (data?.model) {
      log('effective_model', { model: data.model, provider: typeof data.provider === 'string' ? data.provider : 'not_reported', status: response.status });
      if (data.model !== MODEL) throw new Error('crm_llm_lock: modelo efetivo divergente');
    } else if (!response.ok) log('provider_error', { status: response.status, code: data?.error?.code });
  }
  return response;
};
log('loaded', { model: MODEL, openai_byok: [...OPENAI_BYOK_MODELS] });
