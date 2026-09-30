/**
 * GET/POST /api/v1/cron/media-retention
 *
 * Apaga somente o BINÁRIO vencido do bucket `whatsapp-media`. A linha da
 * mensagem permanece com legenda, tipo, horário, texto derivado e metadata que
 * explica por que o arquivo saiu. O teto de upload é aplicado no worker; esta
 * rota abre espaço de volta, diariamente e em lotes curtos.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import {
  expurgarMidiasVencidas,
  type MidiaCandidataAoExpurgo,
  type RepositorioDeMidiaVencida,
  type StorageDeMidia,
} from "@/lib/messaging/media/expurgo";
import {
  interpretarInteiroPositivo,
  WHATSAPP_MEDIA_RETENTION_DAYS_DEFAULT,
} from "@/lib/messaging/media/retention";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const fornecido = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (!fornecido || aceitos.length === 0 || !aceitos.includes(fornecido)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const repositorio: RepositorioDeMidiaVencida = {
    async listarAntesDe(corteIso, limite) {
      const { data, error } = await admin
        .from("messages")
        .select("id, organization_id, sent_at, media_storage_path, media_size_bytes, metadata")
        .not("media_storage_path", "is", null)
        .lt("sent_at", corteIso)
        .order("sent_at", { ascending: true })
        .limit(limite);
      if (error) throw new Error(`listar mídia vencida: ${error.message}`);
      return (data ?? []) as MidiaCandidataAoExpurgo[];
    },
    async marcarExpirada(midia, metadata) {
      const { error } = await admin
        .from("messages")
        .update({
          media_storage_path: null,
          media_size_bytes: null,
          media_url: null,
          metadata,
        })
        .eq("id", midia.id)
        .eq("organization_id", midia.organization_id);
      if (error) throw new Error(`marcar mídia expirada: ${error.message}`);
    },
  };
  const storage: StorageDeMidia = {
    async remover(caminhos) {
      const { error } = await admin.storage.from("whatsapp-media").remove(caminhos);
      if (error) throw new Error(`apagar mídia vencida: ${error.message}`);
    },
  };

  try {
    const retencaoDias = interpretarInteiroPositivo(
      env.WHATSAPP_MEDIA_RETENTION_DAYS,
      WHATSAPP_MEDIA_RETENTION_DAYS_DEFAULT,
    );
    const resultado = await expurgarMidiasVencidas(repositorio, storage, { retencaoDias });
    if (resultado.arquivos_apagados > 0) {
      void audit({
        action: "retention.sweep_run",
        organizationId: null,
        bypassedRls: true,
        requestId,
        metadata: { tipo: "whatsapp_media", ...resultado },
      });
    }
    return ok(resultado, { requestId });
  } catch (erro) {
    return fail(
      "internal_error",
      "Failed to prune expired WhatsApp media.",
      500,
      { requestId, details: erro instanceof Error ? erro.message : String(erro) },
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
