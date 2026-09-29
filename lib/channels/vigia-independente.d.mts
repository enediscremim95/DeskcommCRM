export interface ComponenteDaVigia {
  status: "ok" | "degraded" | "down";
  reason?: string;
  [chave: string]: unknown;
}

export interface ObservacaoDaVigia {
  caiu: boolean;
  componentes: Record<string, ComponenteDaVigia>;
}

export interface EstadoDaVigia {
  fase: "up" | "down";
  falhas_consecutivas: number;
  sucessos_consecutivos: number;
  incidente_iniciado_em: string | null;
  ultimo_aviso_em: string | null;
  ultimo_diagnostico: Record<string, ComponenteDaVigia> | null;
  heartbeat_at: string;
  nivel_midia: "normal" | "alerta" | "limite";
}

export const FALHAS_PARA_CONFIRMAR: number;
export const SUCESSOS_PARA_CONFIRMAR_VOLTA: number;
export const LEMBRETE_INCIDENTE_MS: number;
export const HEARTBEAT_EXPIRADO_MS: number;
export const LIMITE_MIDIA_BYTES_PADRAO: number;
export const ALERTA_MIDIA_BYTES_PADRAO: number;

export function observacaoDoHealth(
  payload: unknown,
  healthAlcancavel: boolean,
  supabaseDiretoOk?: boolean,
): ObservacaoDaVigia;
export function avaliarSaude(
  anterior: Partial<EstadoDaVigia>,
  observacao: ObservacaoDaVigia,
  agora?: number,
): { estado: EstadoDaVigia; eventos: Array<Record<string, unknown>> };
export function avaliarOcupacaoDeMidia(
  nivelAnterior: EstadoDaVigia["nivel_midia"],
  bytes: number,
  alertaBytes?: number,
  limiteBytes?: number,
): { nivel: EstadoDaVigia["nivel_midia"]; evento: Record<string, unknown> | null };
export function heartbeatDaVigiaExpirou(
  heartbeatAt: string | null | undefined,
  observandoDesde: string | null | undefined,
  agora?: number,
): boolean;
export function textoDoEvento(evento: Record<string, unknown>, contexto?: Record<string, unknown>): string;
