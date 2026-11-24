-- 0321: valida as constraints que a 0320 criou `NOT VALID`.
--
-- Migration SEPARADA de propósito: o runner envolve cada arquivo numa
-- transação, e validar dentro da 0320 manteria o lock do ADD até o commit.
-- `VALIDATE CONSTRAINT` pega SHARE UPDATE EXCLUSIVE: lê a tabela sem bloquear
-- escrita. Re-executar é no-op (constraint já válida não é varrida de novo).

alter table public.agent_inbox_items validate constraint agent_inbox_items_kind_check;
alter table public.calendar_event_types validate constraint calendar_event_types_escalonamento_sensato;
alter table public.calendar_appointments validate constraint calendar_appointments_reminder_message_fk;
alter table public.calendar_appointments validate constraint calendar_appointments_reminder_conversation_fk;
alter table public.calendar_appointments validate constraint calendar_appointments_escalonamento_resultado;
