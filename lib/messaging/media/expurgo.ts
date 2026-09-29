import {
  MEDIA_DISCARD_REASON_KEY,
  MEDIA_DISCARD_REASON_RETENTION,
  MEDIA_STATUS_NOT_STORED,
  WHATSAPP_MEDIA_RETENTION_DAYS_DEFAULT,
} from "@/lib/messaging/media/retention";

export const TAMANHO_LOTE_EXPURGO_MIDIA = 200;
export const MAX_LOTES_EXPURGO_MIDIA = 20;

export interface MidiaCandidataAoExpurgo {
  id: string;
  organization_id: string;
  sent_at: string;
  media_storage_path: string;
  media_size_bytes: number | null;
  metadata: Record<string, unknown> | null;
}

export interface RepositorioDeMidiaVencida {
  listarAntesDe(corteIso: string, limite: number): Promise<MidiaCandidataAoExpurgo[]>;
  marcarExpirada(
    midia: MidiaCandidataAoExpurgo,
    metadata: Record<string, unknown>,
  ): Promise<void>;
}

export interface StorageDeMidia {
  remover(caminhos: string[]): Promise<void>;
}

export interface ResultadoDoExpurgoDeMidia {
  arquivos_apagados: number;
  bytes_liberados: number;
  lotes: number;
  tem_resto: boolean;
  retencao_dias: number;
}

/**
 * Apaga o binário, nunca a mensagem. A defesa local de idade é deliberada:
 * mesmo que um adapter de banco devolva uma linha recente por erro de filtro,
 * ela não alcança o Storage. É a propriedade que o teste de regressão sabota.
 */
export async function expurgarMidiasVencidas(
  repositorio: RepositorioDeMidiaVencida,
  storage: StorageDeMidia,
  opcoes: { agora?: Date; retencaoDias?: number } = {},
): Promise<ResultadoDoExpurgoDeMidia> {
  const agora = opcoes.agora ?? new Date();
  const retencaoDias = opcoes.retencaoDias ?? WHATSAPP_MEDIA_RETENTION_DAYS_DEFAULT;
  const corteMs = agora.getTime() - retencaoDias * 86_400_000;
  const corteIso = new Date(corteMs).toISOString();
  let arquivosApagados = 0;
  let bytesLiberados = 0;
  let lotes = 0;
  let ultimoLoteCheio = false;

  for (let lote = 0; lote < MAX_LOTES_EXPURGO_MIDIA; lote += 1) {
    const candidatas = await repositorio.listarAntesDe(corteIso, TAMANHO_LOTE_EXPURGO_MIDIA);
    const vencidas = candidatas.filter((midia) => {
      const enviadaEm = Date.parse(midia.sent_at);
      return Number.isFinite(enviadaEm) && enviadaEm < corteMs;
    });
    ultimoLoteCheio = candidatas.length >= TAMANHO_LOTE_EXPURGO_MIDIA;
    if (vencidas.length === 0) break;

    await storage.remover(vencidas.map((midia) => midia.media_storage_path));
    const expirouEm = agora.toISOString();
    for (const midia of vencidas) {
      await repositorio.marcarExpirada(midia, {
        ...(midia.metadata ?? {}),
        media_status: MEDIA_STATUS_NOT_STORED,
        [MEDIA_DISCARD_REASON_KEY]: MEDIA_DISCARD_REASON_RETENTION,
        media_expired_at: expirouEm,
        media_retention_days: retencaoDias,
      });
      arquivosApagados += 1;
      bytesLiberados += Math.max(0, midia.media_size_bytes ?? 0);
    }
    lotes += 1;
    if (!ultimoLoteCheio) break;
  }

  return {
    arquivos_apagados: arquivosApagados,
    bytes_liberados: bytesLiberados,
    lotes,
    tem_resto: ultimoLoteCheio && lotes >= MAX_LOTES_EXPURGO_MIDIA,
    retencao_dias: retencaoDias,
  };
}
