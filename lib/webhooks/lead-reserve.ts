/**
 * Reserva externa ao Postgres para captações de formulário.
 *
 * O incidente de 30/09/2026 provou que o processo do app e o Redis continuaram
 * disponíveis durante 40 minutos sem Supabase. A reserva vive no Redis por
 * isso: `job_queue`, `event_log` e qualquer tabela de log caem junto do banco.
 *
 * Capacidade: 30 eventos/min (pico medido, embora `generic` seja uma fração)
 * por 120 min = 3.600 itens. Cada corpo aceito na reserva tem no máximo 16 KiB,
 * logo o corpo cru ocupa no máximo 56,25 MiB; cifra/base64 e índices ficam
 * abaixo de ~100 MiB. A fila expira em 24 h e remove itens vencidos em toda
 * leitura/escrita, então não cresce sem teto nem guarda PII indefinidamente.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";
import { validarConfigRedisRest } from "@/lib/redis-config";

export const WEBHOOK_RESERVE_PEAK_PER_MINUTE = 30;
export const WEBHOOK_RESERVE_PROTECTION_MINUTES = 120;
export const WEBHOOK_RESERVE_MAX_ITEMS =
  WEBHOOK_RESERVE_PEAK_PER_MINUTE * WEBHOOK_RESERVE_PROTECTION_MINUTES;
export const WEBHOOK_RESERVE_MAX_RAW_BODY_BYTES = 16 * 1024;
export const WEBHOOK_RESERVE_TTL_SECONDS = 24 * 60 * 60;
export const WEBHOOK_SOURCE_CACHE_TTL_SECONDS = 48 * 60 * 60;

const QUEUE_KEY = "webhook:lead-reserve:v1";
const LOCK_KEY = "webhook:lead-reserve:drain-lock:v1";
const SOURCE_PREFIX = "webhook:lead-source:v1:";
const SOURCE_INDEX_KEY = "webhook:lead-source-index:v1";
const SOURCE_SYNC_LOCK_KEY = "webhook:lead-source-sync-lock:v1";
const DRAIN_LOCK_SECONDS = 55;
const DRAIN_BATCH_SIZE = 100;

export interface WebhookSourceSnapshot {
  id: string;
  name: string | null;
  organization_id: string;
  secret_encrypted: string | null;
  source_secret: string | null;
  default_pipeline_id: string;
  default_stage_id: string;
  default_owner_user_id: string | null;
  field_map: Record<string, unknown> | null;
  redirect_to: string | null;
  is_active: boolean;
  merge_repeated_submissions: boolean;
}

export interface WebhookReserveItem {
  id: string;
  token: string;
  organizationId: string;
  sourceId: string;
  receivedAt: string;
  rawBody: string;
  contentType: string;
  signature: string | null;
  origin: string | null;
  referer: string | null;
  userAgent: string | null;
  forwardedFor: string | null;
  externalId: string;
}

export type WebhookReserveEnqueueResult =
  | { status: "enfileirado"; count: number; item: WebhookReserveItem }
  | { status: "cheia"; count: number }
  | { status: "corpo_grande"; maxBytes: number };

export interface WebhookReserveStatus {
  count: number;
  oldest_received_at: string | null;
  oldest_age_seconds: number;
  capacity: number;
  retention_seconds: number;
}

type RedisLike = {
  eval: (script: string, keys: string[], args: Array<string | number>) => Promise<unknown>;
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, options?: Record<string, unknown>) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  zrange: <T = string>(key: string, start: number, stop: number) => Promise<T[]>;
  zrem: (key: string, ...members: string[]) => Promise<number>;
};

let redisSingleton: Redis | null = null;

function redisClient(): RedisLike {
  const config = validarConfigRedisRest(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (!config.ok) throw new Error(`webhook_reserve_redis_${config.reason}`);
  redisSingleton ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redisSingleton as unknown as RedisLike;
}

function chaveDeCifra(): Buffer {
  return createHash("sha256")
    .update("webhook-lead-reserve:v1\0")
    .update(env.SUPABASE_SERVICE_ROLE_KEY)
    .digest();
}

function cifrar(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chaveDeCifra(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decifrar<T>(sealed: string): T {
  const [ivRaw, tagRaw, ciphertextRaw] = sealed.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error("webhook_reserve_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", chaveDeCifra(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sourceKey(tokenHash: string): string {
  return `${SOURCE_PREFIX}${tokenHash}`;
}

function queueMember(item: WebhookReserveItem): string {
  return `${item.id}.${cifrar(item)}`;
}

function itemFromMember(member: string): WebhookReserveItem {
  const separator = member.indexOf(".");
  if (separator < 1) throw new Error("webhook_reserve_member_invalid");
  return decifrar<WebhookReserveItem>(member.slice(separator + 1));
}

const ENQUEUE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then return {0, count} end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return {1, count + 1}
`;

const STATUS_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #oldest == 0 then return {count, 0} end
return {count, oldest[2]}
`;

const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function novoItemDaReserva(
  input: Omit<WebhookReserveItem, "id" | "receivedAt" | "externalId"> & {
    id?: string;
    receivedAt?: string;
    externalId?: string | null;
  },
): WebhookReserveItem {
  const id = input.id ?? randomUUID();
  return {
    ...input,
    id,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    externalId: input.externalId || `reserve:${id}`,
  };
}

export async function enfileirarWebhookComRedis(
  redis: RedisLike,
  item: WebhookReserveItem,
  now = Date.now(),
): Promise<WebhookReserveEnqueueResult> {
  if (Buffer.byteLength(item.rawBody, "utf8") > WEBHOOK_RESERVE_MAX_RAW_BODY_BYTES) {
    return { status: "corpo_grande", maxBytes: WEBHOOK_RESERVE_MAX_RAW_BODY_BYTES };
  }
  const cutoff = now - WEBHOOK_RESERVE_TTL_SECONDS * 1000;
  const result = (await redis.eval(
    ENQUEUE_SCRIPT,
    [QUEUE_KEY],
    [
      cutoff,
      WEBHOOK_RESERVE_MAX_ITEMS,
      new Date(item.receivedAt).getTime(),
      queueMember(item),
      WEBHOOK_RESERVE_TTL_SECONDS,
    ],
  )) as [number | string, number | string];
  const inserted = Number(result[0]) === 1;
  const count = Number(result[1]);
  return inserted ? { status: "enfileirado", count, item } : { status: "cheia", count };
}

export function enfileirarWebhook(item: WebhookReserveItem): Promise<WebhookReserveEnqueueResult> {
  return enfileirarWebhookComRedis(redisClient(), item);
}

export async function statusReservaComRedis(
  redis: RedisLike,
  now = Date.now(),
): Promise<WebhookReserveStatus> {
  const cutoff = now - WEBHOOK_RESERVE_TTL_SECONDS * 1000;
  const result = (await redis.eval(STATUS_SCRIPT, [QUEUE_KEY], [cutoff])) as [
    number | string,
    number | string,
  ];
  const count = Number(result[0]);
  const oldestMs = Number(result[1]);
  return {
    count,
    oldest_received_at: oldestMs > 0 ? new Date(oldestMs).toISOString() : null,
    oldest_age_seconds: oldestMs > 0 ? Math.max(0, Math.floor((now - oldestMs) / 1000)) : 0,
    capacity: WEBHOOK_RESERVE_MAX_ITEMS,
    retention_seconds: WEBHOOK_RESERVE_TTL_SECONDS,
  };
}

export function statusReservaWebhook(): Promise<WebhookReserveStatus> {
  return statusReservaComRedis(redisClient());
}

export async function guardarFonteWebhookEmCache(
  token: string,
  source: WebhookSourceSnapshot,
): Promise<void> {
  await redisClient().set(sourceKey(hashToken(token)), cifrar(source), {
    ex: WEBHOOK_SOURCE_CACHE_TTL_SECONDS,
  });
}

export async function lerFonteWebhookDoCache(token: string): Promise<WebhookSourceSnapshot | null> {
  const sealed = await redisClient().get<string>(sourceKey(hashToken(token)));
  return typeof sealed === "string" ? decifrar<WebhookSourceSnapshot>(sealed) : null;
}

/** `true` significa que ausência no cache pode ser tratada como token desconhecido. */
export async function cacheDeFontesEstaCompleto(): Promise<boolean> {
  return (await redisClient().get<string>(SOURCE_INDEX_KEY)) !== null;
}

/** Evita varrer todas as organizações em cada tick de um minuto do dreno. */
export async function adquirirJanelaDeSyncDeFontes(): Promise<boolean> {
  const result = await redisClient().set(SOURCE_SYNC_LOCK_KEY, randomUUID(), {
    nx: true,
    ex: 5 * 60,
  });
  return result === "OK";
}

export async function substituirCacheCompletoDeFontes(
  fontes: Array<{ token: string; source: WebhookSourceSnapshot }>,
): Promise<void> {
  const redis = redisClient();
  const hashesNovos = fontes.map(({ token }) => hashToken(token));
  const indiceAnteriorSelado = await redis.get<string>(SOURCE_INDEX_KEY);
  const hashesAnteriores = indiceAnteriorSelado ? decifrar<string[]>(indiceAnteriorSelado) : [];

  for (const { token, source } of fontes) {
    await redis.set(sourceKey(hashToken(token)), cifrar(source), {
      ex: WEBHOOK_SOURCE_CACHE_TTL_SECONDS,
    });
  }

  const novos = new Set(hashesNovos);
  const obsoletos = hashesAnteriores.filter((hash) => !novos.has(hash));
  if (obsoletos.length > 0) {
    await redis.del(...obsoletos.map(sourceKey));
  }
  await redis.set(SOURCE_INDEX_KEY, cifrar(hashesNovos), {
    ex: WEBHOOK_SOURCE_CACHE_TTL_SECONDS,
  });
}

export interface WebhookDrainResult {
  scanned: number;
  drained: number;
  remaining: number;
  locked: boolean;
}

export async function drenarReservaComRedis(
  redis: RedisLike,
  processar: (item: WebhookReserveItem) => Promise<boolean>,
): Promise<WebhookDrainResult> {
  const lockToken = randomUUID();
  const locked = await redis.set(LOCK_KEY, lockToken, { nx: true, ex: DRAIN_LOCK_SECONDS });
  if (locked !== "OK") {
    const status = await statusReservaComRedis(redis);
    return { scanned: 0, drained: 0, remaining: status.count, locked: true };
  }

  let scanned = 0;
  let drained = 0;
  try {
    const members = await redis.zrange<string>(QUEUE_KEY, 0, DRAIN_BATCH_SIZE - 1);
    for (const member of members) {
      scanned += 1;
      let item: WebhookReserveItem;
      try {
        item = itemFromMember(member);
      } catch {
        // Item indecifrável não pode virar lead. Remove para não bloquear todos
        // os posteriores; a contagem cai e o erro aparece no resultado do cron.
        await redis.zrem(QUEUE_KEY, member);
        continue;
      }
      const completed = await processar(item);
      if (!completed) break;
      await redis.zrem(QUEUE_KEY, member);
      drained += 1;
    }
    const status = await statusReservaComRedis(redis);
    return { scanned, drained, remaining: status.count, locked: false };
  } finally {
    await redis.eval(UNLOCK_SCRIPT, [LOCK_KEY], [lockToken]);
  }
}

export function drenarReservaWebhook(
  processar: (item: WebhookReserveItem) => Promise<boolean>,
): Promise<WebhookDrainResult> {
  return drenarReservaComRedis(redisClient(), processar);
}

export function erroEhIndisponibilidadeDoBanco(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  const status = Number(candidate?.status ?? 0);
  const message =
    `${String(candidate?.message ?? "")} ${String(candidate?.details ?? "")} ${String(candidate?.cause?.message ?? "")}`.toLowerCase();
  return (
    [502, 503, 504].includes(status) ||
    [
      "PGRST000",
      "PGRST001",
      "PGRST002",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
    ].includes(code) ||
    /fetch failed|failed to fetch|connection (?:refused|reset|terminated)|database .* unavailable|gateway timeout|service unavailable|network error|timeout/.test(
      message,
    )
  );
}
