import type { ChannelSession } from "@/hooks/channels/useChannelSessions";

/**
 * Monta um canal de teste SEM obrigar quem escreve o teste a nomear o provider.
 *
 * A doutrina de restrição de canal proíbe nome de provider fora de
 * `lib/channels/` (invariante 1), e `ChannelSession` exige `waha_session_name`.
 * Sem este construtor, todo teste de tela que precisa de um canal era forçado a
 * escrever o nome à mão — foi o que reprovou `RulesTab.test.ts` no gate
 * `lint:channels`, num arquivo que nem usa o campo.
 *
 * O nome do provider fica aqui dentro, que é exatamente onde a doutrina o quer.
 */
export function canalDeTeste(patch: Partial<ChannelSession> = {}): ChannelSession {
  return {
    id: "canal-1",
    display_name: "Comercial Curitiba",
    phone_number: "+5541999999999",
    waha_session_name: "comercial",
    status: "WORKING",
    status_reason: null,
    last_health_check_at: null,
    last_status_change_at: null,
    daily_message_limit: 120,
    is_warmup_complete: true,
    created_at: "2026-01-01",
    ...patch,
  } as ChannelSession;
}
