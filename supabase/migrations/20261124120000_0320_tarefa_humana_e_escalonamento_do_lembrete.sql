-- 0320: tarefa humana no follow-up, convite por e-mail, lembrete rico e
-- escalonamento do lembrete.
--
-- Tudo ADITIVO e OPT-IN: nenhuma organização muda de comportamento sem
-- configurar. Colunas novas nascem nulas ou com default "desligado".
--
-- ─── LOCKS (tabelas grandes em produção) ────────────────────────────────────
-- * Toda CHECK/FK nova entra `NOT VALID`: o ADD pega o lock só pelo instante do
--   catálogo, sem varrer a tabela. A varredura (`VALIDATE CONSTRAINT`, lock
--   SHARE UPDATE EXCLUSIVE, que não bloqueia escrita) mora na migration 0321,
--   porque o runner envolve CADA migration numa transação: validar aqui seguraria
--   o lock do ADD até o commit — exatamente o que se quer evitar.
-- * A troca do vocabulário de `agent_inbox_items.kind` é UM `alter table` com
--   `drop ... , add ... not valid`: atômica (nunca há janela sem a constraint) e
--   sem varredura.
-- * Índices: NÃO moram aqui. Criá-los na mesma transação que adiciona as
--   colunas prolongaria o lock ACCESS EXCLUSIVE do `add column` pela varredura do
--   build. Eles estão na 0322, transação própria (ver o cabeçalho dela). O kit
--   self-host (`baseline.sql`, `psql -f` em autocommit) os cria com `CONCURRENTLY`.
--
-- ─── O QUE ENTRA ────────────────────────────────────────────────────────────
-- 1. crm_tasks.source_key / alerted_at — tarefa criada por automação carrega a
--    chave do FATO que a pediu; retry cai em 23505 em vez de duplicar.
-- 2. agent_inbox_items.dedupe_key — chave única por efeito para o aviso da
--    tarefa (`crm_task:<id>`): corrida ou retry não abre segundo aviso.
-- 3. agent_inbox_items.kind ganha 'human_task'.
-- 4. calendar_event_types: guest_invite_enabled (convite do Google no
--    agendamento pela IA), reminder_rich_format (lembrete com link e variáveis;
--    desligado = texto de antes byte a byte), reminder_escalation_enabled e
--    reminder_escalation_minutes (padrão 20).
-- 5. calendar_appointments: reminder_claimed_at (lease do ENVIO do lembrete;
--    reminder_sent_at só depois do envio, como na main), reminder_message_id /
--    reminder_conversation_id (o
--    envio que de fato saiu — o prazo do escalonamento conta a partir dele e a
--    resposta é procurada NAQUELA conversa), reminder_escalation_claimed_at
--    (posse atômica antes de efeito), reminder_escalation_checked_at / _result
--    (decisão única).

alter table public.crm_tasks
  add column if not exists source_key text,
  add column if not exists alerted_at timestamptz;

comment on column public.crm_tasks.source_key is
  'Chave do fato automático que criou a tarefa (passo de follow-up, escalonamento de lembrete). Única por organização: retry não duplica. Nula em tarefa criada por pessoa.';
comment on column public.crm_tasks.alerted_at is
  'Quando o aviso da tarefa automática foi aberto na Central. Nulo = aviso ainda não confirmado (o aviso tem dedupe_key própria).';

alter table public.agent_inbox_items
  add column if not exists dedupe_key text;

comment on column public.agent_inbox_items.dedupe_key is
  'Chave do efeito que abriu o aviso (ex.: crm_task:<id>). Única por organização quando presente: o mesmo efeito nunca abre dois avisos.';

alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check,
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required', 'appointment_recovery_review', 'qr_rescan',
    'routing_unassigned', 'job_dead', 'event_dead', 'budget_exceeded', 'handoff',
    'promotion_review', 'judge_unaligned', 'followup_dead', 'snooze_expired',
    'next_action_ambiguous', 'risk_backlog_seeded', 'reactivation_expired',
    'capabilities_missing', 'message_send_stuck', 'midia_nao_lida',
    'channel_template_review', 'channel_number_alert', 'promise_unfulfilled',
    'contact_proposal_expired', 'budget_warning', 'conhecimento_nao_indexado',
    'voice_call_missed', 'webhook_source_silent', 'followup_suggestion', 'human_task', 'other'
  )) not valid;

alter table public.calendar_event_types
  add column if not exists guest_invite_enabled boolean not null default false,
  add column if not exists reminder_rich_format boolean not null default false,
  add column if not exists reminder_escalation_enabled boolean not null default false,
  add column if not exists reminder_escalation_minutes integer not null default 20;

alter table public.calendar_event_types
  drop constraint if exists calendar_event_types_escalonamento_sensato,
  add constraint calendar_event_types_escalonamento_sensato
    check (reminder_escalation_minutes between 5 and 720) not valid;

comment on column public.calendar_event_types.guest_invite_enabled is
  'Opt-in: o agendamento pela IA registra o e-mail informado (ou o do contato) como convidado do evento do Google, que envia o convite na sincronização.';
comment on column public.calendar_event_types.reminder_rich_format is
  'Opt-in: o lembrete passa a levar o link da sala pronta e o modelo aceita {{nome}} {{data}} {{hora}} {{link}}. Desligado = texto e modelo de antes, sem alteração.';
comment on column public.calendar_event_types.reminder_escalation_enabled is
  'Opt-in: N minutos após o lembrete entregue, sem resposta do cliente naquela conversa, cria tarefa + aviso e passa a conversa para uma pessoa.';
comment on column public.calendar_event_types.reminder_escalation_minutes is
  'Minutos depois do envio do lembrete até decidir o escalonamento (5 a 720, padrão 20).';

alter table public.calendar_appointments
  add column if not exists reminder_claimed_at timestamptz,
  add column if not exists reminder_message_id uuid,
  add column if not exists reminder_conversation_id uuid,
  add column if not exists reminder_escalation_claimed_at timestamptz,
  add column if not exists reminder_escalation_checked_at timestamptz,
  add column if not exists reminder_escalation_result text;

alter table public.calendar_appointments
  drop constraint if exists calendar_appointments_reminder_message_fk,
  add constraint calendar_appointments_reminder_message_fk
    foreign key (reminder_message_id) references public.messages(id) on delete set null not valid,
  drop constraint if exists calendar_appointments_reminder_conversation_fk,
  add constraint calendar_appointments_reminder_conversation_fk
    foreign key (reminder_conversation_id) references public.conversations(id) on delete set null not valid,
  drop constraint if exists calendar_appointments_escalonamento_resultado,
  add constraint calendar_appointments_escalonamento_resultado
    check (reminder_escalation_result in ('confirmed', 'escalated', 'not_applicable')) not valid;

comment on column public.calendar_appointments.reminder_claimed_at is
  'Posse do ENVIO do lembrete por uma rodada do cron (lease de 4 min, menor que o intervalo do cron). reminder_sent_at só é gravado depois do envio, junto com a mensagem e a conversa: uma queda no meio não some com o lembrete.';
comment on column public.calendar_appointments.reminder_message_id is
  'A mensagem do lembrete que saiu. O escalonamento só conta prazo se ela não falhou.';
comment on column public.calendar_appointments.reminder_conversation_id is
  'A conversa em que o lembrete saiu: é nela que a resposta do cliente é procurada e é ela que passa para uma pessoa.';
comment on column public.calendar_appointments.reminder_escalation_claimed_at is
  'Posse do escalonamento por uma rodada do cron (lease de 10 min). Tomada atomicamente ANTES de qualquer efeito.';
comment on column public.calendar_appointments.reminder_escalation_checked_at is
  'Quando o escalonamento pós-lembrete foi decidido. Preenchido uma vez: é a idempotência do escalonamento.';
comment on column public.calendar_appointments.reminder_escalation_result is
  'confirmed = o cliente respondeu depois do lembrete; escalated = tarefa + aviso + passagem para pessoa; not_applicable = lembrete falhou, compromisso já começou, deixou de estar marcado ou a opção foi desligada.';

notify pgrst, 'reload schema';
