-- Janela curta de reenvio por organização.
--
-- Não existe unicidade global de card aberto por contato. A trava cobre apenas
-- o card automático mais recente enquanto `reentry_guard_until` está presente.
-- Depois do prazo o app libera a trava e outro negócio aberto pode nascer.
--
-- A limpeza NÃO fecha card como lost: isso acionaria validação de motivo,
-- notificação de perda e relatório comercial falso. O gêmeo é absorvido pelo
-- card anterior, suas referências são reposicionadas e o fato vira atividade.
do $$
declare
  grupo record;
  candidato record;
  manter_id uuid;
  manter_criado_em timestamptz;
  janela_minutos integer;
begin
  -- Fecha a janela entre limpar legado e instalar a garantia. O lock dura até o
  -- fim deste DO, que é uma única transação no psql do install/update.
  lock table public.crm_leads in share row exclusive mode;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'crm_leads'
       and column_name = 'reentry_guard_until'
  ) then
    execute 'alter table public.crm_leads add column reentry_guard_until timestamptz';
  end if;

  -- Índice presente é o marcador de que a migração inteira concluiu. Na
  -- reaplicação não há UPDATE, INSERT nem DELETE de dados.
  if to_regclass('public.uniq_crm_leads_reentry_guard') is null then
    for grupo in
      select organization_id, contact_id
        from public.crm_leads
       where status = 'open' and contact_id is not null
       group by organization_id, contact_id
      having count(*) > 1
    loop
      select least(10080, greatest(1,
               coalesce(
                 case
                   when (o.settings->>'lead_reentry_window_minutes') ~ '^[0-9]+$'
                     then (o.settings->>'lead_reentry_window_minutes')::integer
                 end,
                 60
               )))
        into janela_minutos
        from public.organizations o
       where o.id = grupo.organization_id;

      manter_id := null;
      manter_criado_em := null;

      for candidato in
        select id, created_at
          from public.crm_leads
         where organization_id = grupo.organization_id
           and contact_id = grupo.contact_id
           and status = 'open'
         order by created_at, id
      loop
        if manter_id is null
           or candidato.created_at > manter_criado_em + make_interval(mins => janela_minutos) then
          manter_id := candidato.id;
          manter_criado_em := candidato.created_at;
          continue;
        end if;

        update public.crm_leads vencedor
           set custom_fields = coalesce(vencedor.custom_fields, '{}'::jsonb)
                               || coalesce(perdedor.custom_fields, '{}'::jsonb),
               source_metadata = coalesce(vencedor.source_metadata, '{}'::jsonb)
                                 || coalesce(perdedor.source_metadata, '{}'::jsonb),
               tags = (
                 select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
                   from unnest(coalesce(vencedor.tags, '{}'::text[])
                               || coalesce(perdedor.tags, '{}'::text[])) as tag
               ),
               last_activity_at = greatest(vencedor.last_activity_at, perdedor.last_activity_at)
          from public.crm_leads perdedor
         where vencedor.id = manter_id
           and perdedor.id = candidato.id;

        update public.event_log
           set status = 'done',
               last_error = 'superseded: card juntado pela janela de reenvio',
               metadata = metadata || jsonb_build_object('merged_into_lead_id', manter_id),
               updated_at = now()
         where organization_id = grupo.organization_id
           and entity_kind = 'crm_lead'
           and entity_id = candidato.id
           and event_type = 'lead.created'
           and status in ('pending', 'processing');

        delete from public.crm_lead_activities
         where lead_id = candidato.id and type = 'lead_created';
        update public.crm_lead_activities set lead_id = manter_id where lead_id = candidato.id;

        delete from public.crm_lead_links perdedor
         where perdedor.lead_id = candidato.id
           and exists (
             select 1 from public.crm_lead_links vencedor
              where vencedor.lead_id = manter_id
                and vencedor.target_kind = perdedor.target_kind
                and vencedor.target_id = perdedor.target_id
                and vencedor.link_kind = perdedor.link_kind
           );
        update public.crm_lead_links set lead_id = manter_id where lead_id = candidato.id;

        update public.agent_cases set lead_id = manter_id where lead_id = candidato.id;
        update public.demandas set lead_id = manter_id where lead_id = candidato.id;
        update public.webhook_lead_captures set lead_id = manter_id where lead_id = candidato.id;
        update public.crm_tasks set lead_id = manter_id where lead_id = candidato.id;

        if exists (select 1 from public.crm_lead_scores where lead_id = manter_id) then
          delete from public.crm_lead_scores where lead_id = candidato.id;
        else
          update public.crm_lead_scores set lead_id = manter_id where lead_id = candidato.id;
        end if;

        if exists (select 1 from public.crm_lead_risk_states where lead_id = manter_id) then
          delete from public.crm_lead_risk_states where lead_id = candidato.id;
        else
          update public.crm_lead_risk_states set lead_id = manter_id where lead_id = candidato.id;
        end if;

        if exists (
          select 1 from public.crm_lead_reactivations
           where lead_id = manter_id and status = 'pending'
        ) then
          delete from public.crm_lead_reactivations
           where lead_id = candidato.id and status = 'pending';
        end if;
        update public.crm_lead_reactivations set lead_id = manter_id where lead_id = candidato.id;

        delete from public.ad_conversion_dispatches perdedor
         where perdedor.lead_id = candidato.id
           and exists (
             select 1 from public.ad_conversion_dispatches vencedor
              where vencedor.organization_id = perdedor.organization_id
                and vencedor.lead_id = manter_id
                and vencedor.event_name = perdedor.event_name
           );
        update public.ad_conversion_dispatches set lead_id = manter_id where lead_id = candidato.id;

        -- Item de lote representa o aviso de criação do card removido. Reapontar
        -- produziria dois avisos do mesmo negócio; remover preserva a verdade.
        delete from public.notification_email_batch_items where lead_id = candidato.id;

        insert into public.crm_lead_activities (
          organization_id, lead_id, contact_id, source_module, source_id,
          type, payload, metadata, actor_kind, reason, performed_at
        ) values (
          grupo.organization_id, manter_id, grupo.contact_id,
          'migration.0275', candidato.id, 'lead_merged',
          jsonb_build_object('merged_lead_id', candidato.id),
          jsonb_build_object('window_minutes', janela_minutos),
          'system', 'Card gêmeo absorvido dentro da janela de reenvio.', now()
        );

        delete from public.crm_leads where id = candidato.id;
      end loop;
    end loop;

    -- Só o card aberto mais recente de cada pessoa recebe a trava curta. Os
    -- demais cards legítimos continuam abertos e fora do índice.
    with mais_recente as (
      select distinct on (l.organization_id, l.contact_id)
             l.id,
             least(10080, greatest(1,
               coalesce(
                 case
                   when (o.settings->>'lead_reentry_window_minutes') ~ '^[0-9]+$'
                     then (o.settings->>'lead_reentry_window_minutes')::integer
                 end,
                 60
               ))) as minutos
        from public.crm_leads l
        join public.organizations o on o.id = l.organization_id
       where l.status = 'open' and l.contact_id is not null
       order by l.organization_id, l.contact_id, l.created_at desc, l.id desc
    )
    update public.crm_leads l
       set reentry_guard_until = l.created_at + make_interval(mins => r.minutos)
      from mais_recente r
     where l.id = r.id;

    execute $index$
      create unique index uniq_crm_leads_reentry_guard
        on public.crm_leads (organization_id, contact_id)
       where status = 'open'
         and contact_id is not null
         and reentry_guard_until is not null
    $index$;
  end if;
end
$$;

comment on column public.crm_leads.reentry_guard_until is
  'Trava interna da janela curta de reenvio. Não limita a quantidade global de negócios abertos por contato.';

notify pgrst, 'reload schema';
