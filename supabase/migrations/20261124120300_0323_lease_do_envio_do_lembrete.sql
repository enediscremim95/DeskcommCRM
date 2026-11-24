-- 0323: posse (lease) do ENVIO do lembrete.
--
-- Esta coluna nasceu dentro da 0320 numa revisão posterior. A 0320 nunca foi
-- aplicada em produção, mas bancos de teste podem ter aplicado uma versão
-- anterior dela — e o runner não reaplica migration já registrada. Em
-- migration própria, com `if not exists`, ela chega a esses bancos e é no-op
-- onde já existe.
--
-- `reminder_claimed_at` é a posse do envio por uma rodada do cron, com lease
-- de 4 min (menor que o intervalo do cron): `reminder_sent_at` só é gravado
-- DEPOIS do envio, como na main, e uma rodada que morreu com a posse não tira
-- o compromisso da fila. Coluna nula, sem default e sem constraint: `add
-- column` só mexe no catálogo, sem reescrever a tabela.

alter table public.calendar_appointments
  add column if not exists reminder_claimed_at timestamptz;

comment on column public.calendar_appointments.reminder_claimed_at is
  'Posse do ENVIO do lembrete por uma rodada do cron (lease de 4 min, menor que o intervalo do cron). reminder_sent_at só é gravado depois do envio, junto com a mensagem e a conversa: uma queda no meio não some com o lembrete.';
