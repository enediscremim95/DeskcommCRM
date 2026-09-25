-- Uma fonte por página precisa guardar quem recebe o lead e denunciar quando
-- uma entrada que já funcionava fica muda. A coluna é nullable para preservar
-- fontes existentes; a UI nova exige a escolha nas criações humanas.

alter table public.webhook_sources
  add column if not exists default_owner_user_id uuid references auth.users(id) on delete set null;

comment on column public.webhook_sources.default_owner_user_id is
  'Responsável humano padrão dos leads desta fonte. O código valida membership ativa na mesma organização antes de gravar.';

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
    'voice_call_missed', 'webhook_source_silent', 'other'
  ));

create unique index if not exists uniq_agent_inbox_webhook_source_silent_open
  on public.agent_inbox_items (organization_id, kind, ref_id)
  where kind = 'webhook_source_silent' and status = 'open';
