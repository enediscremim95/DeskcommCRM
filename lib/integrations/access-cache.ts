import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";
import { validarConfigRedisRest } from "@/lib/redis-config";
import { DEFAULT_INTEGRATION_ACCESS, type IntegrationAccessMap } from "./types";

const CACHE_TTL_SECONDS = 30;
const CACHE_TIMEOUT_MS = 75;
const CACHE_PREFIX = "crm:integration-access:v1";

let redisClient: Redis | null | undefined;

declare global {
  var __integrationAccessCacheGeneration: Map<string, number> | undefined;
  var __integrationAccessCacheBypassUntil: Map<string, number> | undefined;
}

function generations(): Map<string, number> {
  return (globalThis.__integrationAccessCacheGeneration ??= new Map());
}

function bypasses(): Map<string, number> {
  return (globalThis.__integrationAccessCacheBypassUntil ??= new Map());
}

function redis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const config = validarConfigRedisRest(
    env.UPSTASH_REDIS_REST_URL,
    env.UPSTASH_REDIS_REST_TOKEN,
  );
  redisClient = config.ok
    ? new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
        retry: false,
      })
    : null;
  return redisClient;
}

function cacheKey(organizationId: string): string {
  // O UUID confiável da organização faz parte da chave. Configuração de uma
  // empresa nunca pode aquecer a resposta de outra.
  return `${CACHE_PREFIX}:${organizationId}`;
}

function cacheIgnorado(organizationId: string): boolean {
  const ate = bypasses().get(organizationId);
  if (!ate) return false;
  if (ate > Date.now()) return true;
  bypasses().delete(organizationId);
  return false;
}

function cacheValido(value: unknown): value is IntegrationAccessMap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<IntegrationAccessMap>;
  return (["whatsapp", "n8n", "windsor"] as const).every((integration) => {
    const permission = candidate[integration];
    return (
      !!permission &&
      typeof permission.client_visible === "boolean" &&
      typeof permission.client_can_reconnect === "boolean"
    );
  });
}

async function comTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("integration_access_cache_timeout")),
          CACHE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function lerCache(organizationId: string): Promise<IntegrationAccessMap | null> {
  if (cacheIgnorado(organizationId)) return null;
  const client = redis();
  if (!client) return null;
  try {
    const value = await comTimeout(client.get<unknown>(cacheKey(organizationId)));
    return cacheValido(value) ? structuredClone(value) : null;
  } catch {
    // Cache é aceleração. Redis fora nunca derruba a casca do CRM.
    return null;
  }
}

async function guardarCache(
  organizationId: string,
  generation: number,
  access: IntegrationAccessMap,
): Promise<void> {
  if (cacheIgnorado(organizationId)) return;
  if ((generations().get(organizationId) ?? 0) !== generation) return;
  const client = redis();
  if (!client) return;
  try {
    await comTimeout(
      client.set(cacheKey(organizationId), access, { ex: CACHE_TTL_SECONDS }),
    );
  } catch {
    // A resposta do banco continua sendo a autoridade desta requisição.
  }
}

export async function comCacheDeAcessoAsIntegracoes(
  organizationId: string,
  lerDoBanco: () => Promise<IntegrationAccessMap | null>,
): Promise<IntegrationAccessMap> {
  const cached = await lerCache(organizationId);
  if (cached) return cached;

  const generation = generations().get(organizationId) ?? 0;
  const access = await lerDoBanco();
  if (!access) return structuredClone(DEFAULT_INTEGRATION_ACCESS);
  await guardarCache(organizationId, generation, access);
  return access;
}

/**
 * Chamada depois da única escrita das permissões de integração.
 *
 * A geração sobe ANTES do `await`: uma leitura de banco iniciada antes da
 * escrita não consegue reinstalar o valor antigo depois do `DEL`. Se o Redis
 * cair durante a invalidação, esta organização ignora cache por um TTL inteiro
 * e segue no banco. Na instalação suportada há um processo de app; o TTL é a
 * rede de segurança para restart, edição direta e uma réplica futura.
 */
export async function invalidarCacheDeAcessoAsIntegracoes(
  organizationId: string,
): Promise<void> {
  const atuais = generations();
  atuais.set(organizationId, (atuais.get(organizationId) ?? 0) + 1);
  bypasses().set(organizationId, Date.now() + CACHE_TTL_SECONDS * 1_000);

  const client = redis();
  if (!client) {
    bypasses().delete(organizationId);
    return;
  }
  try {
    await comTimeout(client.del(cacheKey(organizationId)));
    bypasses().delete(organizationId);
  } catch {
    // Mantém o bypass local até toda entrada possível no Redis expirar.
  }
}

/** Limpa singletons e guardas globais entre casos unitários. */
export function __resetIntegrationAccessCacheForTests(): void {
  redisClient = undefined;
  globalThis.__integrationAccessCacheGeneration = new Map();
  globalThis.__integrationAccessCacheBypassUntil = new Map();
}
