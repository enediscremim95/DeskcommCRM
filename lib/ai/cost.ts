import type { Pool } from "pg";

import { precoClaude, type TokenUsage } from "@/lib/agent-engine/edge/llm/pricing";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const COLUNAS = "provider, model_id, input_price_per_million_cents, output_price_per_million_cents";
const TTL_MS = 60_000;
const TAMANHO_PAGINA = 500;

interface LinhaDePreco {
  provider: string;
  model_id: string;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
}

interface Catalogo {
  linhas: LinhaDePreco[];
  expiraEm: number;
  consulta?: Promise<LinhaDePreco[]>;
}

const catalogoRest: Catalogo = { linhas: [], expiraEm: 0 };
const catalogosPg = new WeakMap<Pool, Catalogo>();

async function consultarCatalogo(db?: Pool): Promise<LinhaDePreco[]> {
  if (db) {
    const { rows } = await db.query<LinhaDePreco>(`select ${COLUNAS} from public.ai_models`);
    return rows;
  }

  const admin = createAdminClient();
  const linhas: LinhaDePreco[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await admin
      .from("ai_models")
      .select(COLUNAS)
      .order("id")
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < TAMANHO_PAGINA) return linhas;
  }
}

function carregarCatalogo(db?: Pool): Promise<LinhaDePreco[]> {
  const cache = (db && catalogosPg.get(db)) || { linhas: [], expiraEm: 0 };
  const catalogo = db ? cache : catalogoRest;
  if (db) catalogosPg.set(db, catalogo);
  if (Date.now() < catalogo.expiraEm) return Promise.resolve(catalogo.linhas);

  catalogo.consulta ??= consultarCatalogo(db)
    .then((linhas) => {
      catalogo.linhas = linhas;
      return linhas;
    })
    .catch(() => {
      logger.warn("[llm-calls] falha ao carregar preços do catálogo");
      return catalogo.linhas;
    })
    .finally(() => {
      catalogo.expiraEm = Date.now() + TTL_MS;
      delete catalogo.consulta;
    });
  return catalogo.consulta;
}

function semData(modelo: string): string {
  return modelo.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function encontrarPreco(linhas: LinhaDePreco[], provider: string, id: string): LinhaDePreco | undefined {
  const modelos = linhas.filter((linha) => linha.provider === provider);
  const base = semData(id);
  const exato = modelos.find((linha) => linha.model_id === id)
    ?? modelos.find((linha) => linha.model_id === base);
  if (exato) return exato;

  const separador = base.indexOf("/");
  if (provider !== "openrouter" && !base.startsWith(`${provider}/`)) return undefined;
  if (separador >= 0) {
    return modelos.find((linha) => linha.model_id === base.slice(separador + 1));
  }

  // Um id sem família só pode herdar a tarifa se houver uma família inequívoca.
  const candidatos = modelos.filter((linha) => linha.model_id.endsWith(`/${base}`));
  return candidatos.length === 1 ? candidatos[0] : undefined;
}

interface ComputeCostInput extends Partial<TokenUsage> {
  provider: string;
  model: string;
}

/** Custo estimado em centavos, com precisão fracionária para llm_calls. */
export async function computeCost(input: ComputeCostInput, db?: Pool): Promise<number | null> {
  const linha = encontrarPreco(await carregarCatalogo(db), input.provider, input.model);
  const idClaude = input.model.replace(/^anthropic\//, "");
  const claude = input.provider === "anthropic" ? precoClaude(idClaude) : undefined;
  const entrada = linha?.input_price_per_million_cents ?? claude?.input;
  const saida = linha?.output_price_per_million_cents ?? claude?.output;
  if (entrada === undefined || saida === undefined) return null;

  const leitura = input.cacheReadTokens ?? 0;
  const escrita = input.cacheWriteTokens ?? 0;
  const semCache = Math.max(0, (input.inputTokens ?? 0) - leitura - escrita);
  return (
    semCache * entrada +
    leitura * (claude?.cacheRead ?? entrada) +
    escrita * (claude?.cacheWrite ?? entrada) +
    (input.outputTokens ?? 0) * saida
  ) / 1_000_000;
}

/**
 * Deriva o provedor do id do modelo.
 *
 * Usado quando o caminho legado recebe apenas o id canônico; bindings e
 * credenciais já trazem o provedor explícito.
 */
export function providerDoModelo(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("anthropic/") || m.startsWith("claude")) return "anthropic";
  if (m.startsWith("openai/") || m.startsWith("gpt") || m.startsWith("text-embedding")) return "openai";
  if (m.startsWith("google/") || m.startsWith("gemini")) return "google";
  if (m.includes("/")) return "openrouter";
  return "desconhecido";
}
