-- 0273: costura o radar, a Central de avisos e a automação de mensagem fixa.

alter table public.crm_lead_reactivations
  add column if not exists automation_rule_id uuid references public.automation_rules(id) on delete set null,
  add column if not exists stage_id_at_proposal uuid references public.crm_stages(id) on delete set null,
  add column if not exists last_inbound_at_at_proposal timestamptz,
  add column if not exists resuggest_after_at timestamptz;

comment on column public.crm_lead_reactivations.stage_id_at_proposal is
  'Etapa observada na sugestao ou atualizada pela propria aprovacao. Mudanca posterior e fato novo para ressugerir.';
comment on column public.crm_lead_reactivations.last_inbound_at_at_proposal is
  'Ultima mensagem recebida observada na decisao. Somente resposta posterior e fato novo para ressugerir.';
comment on column public.crm_lead_reactivations.resuggest_after_at is
  'Prazo longo configurado pelo dono. Antes dele, uma decisao sem fato novo nao volta para a fila.';

create index if not exists idx_crm_lead_reactivations_ultima_decisao
  on public.crm_lead_reactivations (lead_id, proposed_at desc)
  where status <> 'pending';

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
    'voice_call_missed', 'webhook_source_silent', 'followup_suggestion', 'other'
  ));

create unique index if not exists uniq_agent_inbox_followup_suggestion_open
  on public.agent_inbox_items (organization_id, kind, ref_id)
  where kind = 'followup_suggestion' and status = 'open';

notify pgrst, 'reload schema';
