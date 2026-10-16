-- 0291_anotacoes_do_negocio
--
-- `crm_lead_activities` já é a linha do tempo canônica do negócio e já aceita
-- `type = 'note'`. Não nasce uma segunda tabela. Esta migration acrescenta
-- somente a autoridade que faltava para a anotação humana:
--
--   * viewer não lê nota, embora continue lendo as demais atividades visíveis;
--   * agent+ insere nota apenas num lead que já pode ver e em nome próprio;
--   * somente o autor, manager/admin ou platform admin apaga;
--   * UPDATE continua sem grant e sem policy: texto salvo nunca é editado.
--
-- As policies continuam herdando o escopo do lead-pai por EXISTS, sem aceitar
-- organization_id do corpo. O grant de DELETE é estreito: a policy abaixo é a
-- barreira real e só alcança `type = 'note'`.

drop policy if exists "crm_lead_activities_select" on public.crm_lead_activities;
drop policy if exists "crm_lead_activities_insert" on public.crm_lead_activities;
drop policy if exists "crm_lead_activities_delete_note" on public.crm_lead_activities;

create policy "crm_lead_activities_select" on public.crm_lead_activities
  for select using (
    exists (
      select 1
        from public.crm_leads l
       where l.id = crm_lead_activities.lead_id
         and public.fn_can_view_lead(l.organization_id, l.owner_user_id)
    )
    and (
      type <> 'note'
      or public.fn_is_platform_admin()
      or public.fn_role_at_least(organization_id, 'agent')
    )
  );

create policy "crm_lead_activities_insert" on public.crm_lead_activities
  for insert with check (
    (
      organization_id in (select public.fn_user_org_ids())
      or public.fn_is_platform_admin()
    )
    and (
      type <> 'note'
      or (
        (
          public.fn_is_platform_admin()
          or public.fn_role_at_least(organization_id, 'agent')
        )
        and performed_by_user_id = auth.uid()
        and actor_kind = 'user'
        and exists (
          select 1
            from public.crm_leads l
           where l.id = crm_lead_activities.lead_id
             and public.fn_can_view_lead(l.organization_id, l.owner_user_id)
        )
      )
    )
  );

create policy "crm_lead_activities_delete_note" on public.crm_lead_activities
  for delete using (
    type = 'note'
    and exists (
      select 1
        from public.crm_leads l
       where l.id = crm_lead_activities.lead_id
         and public.fn_can_view_lead(l.organization_id, l.owner_user_id)
    )
    and (
      public.fn_is_platform_admin()
      or public.fn_role_at_least(organization_id, 'manager')
      or (
        public.fn_role_at_least(organization_id, 'agent')
        and performed_by_user_id = auth.uid()
      )
    )
  );

revoke update, delete on table public.crm_lead_activities from anon;
revoke update on table public.crm_lead_activities from authenticated;
grant delete on table public.crm_lead_activities to authenticated;

notify pgrst, 'reload schema';
