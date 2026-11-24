-- 0320: tarefa humana no follow-up, convite por e-mail e escalonamento do lembrete.
--
-- Tudo ADITIVO e OPT-IN: nenhuma organização muda de comportamento sem
-- configurar. Colunas novas nascem nulas ou com default "desligado".
--
-- 1. crm_tasks.source_key / alerted_at — a tarefa criada por automação (nó
--    "tarefa humana" do fluxo, escalonamento do lembrete) carrega a chave do
--    FATO que a pediu. O índice único parcial faz o retry cair em 23505 em vez
--    de duplicar a tarefa; `alerted_at` marca que o aviso na Central já saiu,
--    para o retry abrir o aviso que faltou e não um segundo.
-- 2. agent_inbox_items.kind ganha 'human_task' (lista completa reconstruída,
--    igual ao bloco único do baseline).
-- 3. calendar_event_types.guest_invite_enabled — o agendamento feito pela IA
--    passa o e-mail do cliente como convidado do evento do Google (o Google
--    envia o convite). Default false: sem ligar, nada muda.
-- 4. calendar_event_types.reminder_escalation_enabled / _minutes — N minutos
--    depois do lembrete, se o cliente não respondeu, abre tarefa + aviso e
--    passa a conversa para uma pessoa. Default desligado, 20 minutos.
-- 5. calendar_appointments.reminder_escalation_checked_at / _result — a
--    decisão do escalonamento é tomada UMA vez por compromisso.

alter table public.crm_tasks
  add column if not exists source_key text,
  add column if not exists alerted_at timestamptz;

create unique index if not exists uniq_crm_tasks_source_key
  on public.crm_tasks (organization_id, source_key)
  where source_key is not null;

comment on column public.crm_tasks.source_key is
  'Chave do fato automático que criou a tarefa (passo de follow-up, escalonamento de lembrete). Única por organização: retry não duplica. Nula em tarefa criada por pessoa.';
comment on column public.crm_tasks.alerted_at is
  'Quando o aviso da tarefa automática foi aberto na Central. Nulo = aviso ainda não saiu.';

alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;
alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required', 'appointment_recovery_review', 'qr_rescan',
    'routing_unassigned', 'job_dead', 'event_dead', 'budget_exceeded', 'handoff',
    'promotion_review', 'judge_unaligned', 'followup_dead', 'snooze_expired',
    'next_action_ambiguous', 'risk_backlog_seeded', 'reactivation_expired',
    'capabilities_missing', 'message_send_stuck', 'midia_nao_lida',
    'channel_template_review', 'channel_number_alert', 'promise_unfulfilled',
    'contact_proposal_expired', 'budget_warning', 'conhecimento_nao_indexado',
    'voice_call_missed', 'webhook_source_silent', 'followup_suggestion', 'human_task', 'other'
  ));

alter table public.calendar_event_types
  add column if not exists guest_invite_enabled boolean not null default false,
  add column if not exists reminder_escalation_enabled boolean not null default false,
  add column if not exists reminder_escalation_minutes integer not null default 20
    check (reminder_escalation_minutes between 5 and 720);

comment on column public.calendar_event_types.guest_invite_enabled is
  'Opt-in: o agendamento pela IA usa o e-mail informado (ou o do contato) como convidado do evento do Google, que envia o convite.';
comment on column public.calendar_event_types.reminder_escalation_enabled is
  'Opt-in: N minutos após o lembrete, sem resposta do cliente, cria tarefa + aviso e passa a conversa para uma pessoa.';
comment on column public.calendar_event_types.reminder_escalation_minutes is
  'Minutos depois do envio do lembrete até decidir o escalonamento (5 a 720, padrão 20).';

alter table public.calendar_appointments
  add column if not exists reminder_escalation_checked_at timestamptz,
  add column if not exists reminder_escalation_result text
    check (reminder_escalation_result in ('confirmed', 'escalated', 'not_applicable'));

comment on column public.calendar_appointments.reminder_escalation_checked_at is
  'Quando o escalonamento pós-lembrete foi decidido. Preenchido uma vez: é a idempotência do escalonamento.';
comment on column public.calendar_appointments.reminder_escalation_result is
  'confirmed = o cliente respondeu depois do lembrete; escalated = tarefa + aviso + passagem para pessoa; not_applicable = compromisso já começou ou deixou de estar marcado.';

notify pgrst, 'reload schema';
