import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow } from "@/lib/event-log/dispatcher";

export interface ActionResultDetail {
  type: string;
  status: "success" | "failed" | "skipped" | "postponed";
  error?: string;
  detail?: Record<string, unknown>;
}

export interface ActionCtx {
  /** Privado à execução: nunca vem do payload nem do contexto de condições. */
  serviceBoundaries?: Map<string, Promise<ServiceBoundary>>;
  admin: SupabaseClient;
  organizationId: string;
  ruleId: string;
  /** Nome da regra como o operador a nomeou — entra nos avisos que ele lê. */
  ruleName: string;
  event: EventRow;
  context: Record<string, unknown>; // mesmo objeto avaliado pelas condições
  requestId: string;
  /**
   * O motor já aplicou o ritmo humano durável desta ação. Executores que ainda
   * mantêm um throttle local não devem somá-lo outra vez.
   */
  humanPacingManaged?: boolean;
}

export interface HumanPacingCapability {
  /**
   * Descreve o texto FINAL que seria enviado. `null` significa que a ação não
   * enviaria agora (config inválida, contato bloqueado etc.) e portanto não
   * deve atrasar as ações seguintes.
   */
  textLength(ctx: ActionCtx, config: Record<string, unknown>): Promise<number | null>;
  /** Indicador opcional do canal. Falha é engolida pelo motor. */
  signalTyping?(ctx: ActionCtx, config: Record<string, unknown>): Promise<void>;
}

export interface ActionExecutor {
  type: string;
  /** Pré-checagem opcional: se retornar um ISO timestamp, o EVENTO INTEIRO é
   *  adiado para essa hora ANTES de qualquer ação executar (all-or-nothing —
   *  evita reexecução parcial no retry). Usada pelo throttle do WhatsApp. */
  postponeUntil?(ctx: ActionCtx, config: Record<string, unknown>): Promise<string | null>;
  /**
   * Veto que encerra a REGRA inteira antes de qualquer ação restante. Serve
   * para fatos que tornam a sequência obsoleta, como um humano já ter respondido
   * depois do evento-gatilho. O resultado entra na execução visível.
   */
  interruptRule?(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail | null>;
  /** Capability, não identidade de provider: só ações textuais que a expõem entram no ritmo. */
  humanPacing?: HumanPacingCapability;
  execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail>;
}
