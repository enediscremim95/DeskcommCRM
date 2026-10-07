-- 0287, cartão vazio ignora somente registros automáticos sem trabalho humano.
--
-- A 0286 consulta fn_negocio_vazio_para_juncao para escolher o absorvido, mas
-- fn_juntar_negocios repete a validação sob lock. As duas funções precisam usar
-- a mesma lista positiva; mudar só a primeira produziria candidato que falha na
-- hora de juntar.
--
-- Tipos ignorados, confirmados nos emissores do produto:
--   lead_created: registro mecânico do nascimento pelo canal inbound;
--   lead_cooled: observação do risk-worker sobre passagem do tempo, sem interação;
--   lead_merged: registro da janela curta alimentando um card já existente.
-- message_received já era exceção na 0282 e continua por compatibilidade com o
-- histórico: o conteúdo recebido é filho movido na junção, não trabalho do time.
-- Todo tipo humano, de agente, de decisão ou desconhecido continua contando como
-- conteúdo. A lista é positiva de propósito: tipo novo bloqueia até ser revisto.

create or replace function public.fn_negocio_vazio_para_juncao(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.crm_leads l
     where l.id = p_lead_id
       and l.organization_id = p_organization_id
       and l.status = 'open'
       and l.value_cents is null
       and l.owner_user_id is null
       and coalesce(l.custom_fields, '{}'::jsonb) = '{}'::jsonb
       and coalesce(l.source_metadata, '{}'::jsonb) = '{}'::jsonb
       and cardinality(coalesce(l.tags, '{}'::text[])) = 0
       and not exists (
         select 1 from public.crm_tasks t
          where t.organization_id = p_organization_id and t.lead_id = l.id
       )
       and not exists (
         select 1 from public.crm_lead_reactivations r
          where r.organization_id = p_organization_id and r.lead_id = l.id
       )
       and not exists (
         select 1 from public.cron_jobs j
          where j.organization_id = p_organization_id
            and j.job_kind = 'followup_turn'
            and j.payload->>'lead_id' = l.id::text
       )
       and not exists (
         select 1 from public.crm_lead_activities a
          where a.organization_id = p_organization_id
            and a.lead_id = l.id
            and a.type not in (
              'lead_created',
              'message_received',
              'lead_cooled',
              'lead_merged'
            )
       )
  );
$$;

revoke execute on function public.fn_negocio_vazio_para_juncao(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_negocio_vazio_para_juncao(uuid, uuid)
  to service_role;

-- Revalidação sob lock da junção reversível. Corpo mantido igual ao da 0286,
-- exceto pela trava explícita de dono humano e pela mesma lista positiva acima.
create or replace function public.fn_juntar_negocios(
  p_organization_id uuid,
  p_survivor uuid,
  p_absorbed uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survivor public.crm_leads%rowtype;
  v_absorbed public.crm_leads%rowtype;
  v_log public.crm_lead_merge_log%rowtype;
  v_target record;
  v_ids jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_org_filter text;
  v_system_call boolean := coalesce((
    auth.uid() is null
    and auth.role() = 'service_role'
    and current_setting('app.juncao_negocio_actor', true) = 'sistema'
  ), false);
  v_reason text := nullif(current_setting('app.juncao_negocio_motivo', true), '');
begin
  if not v_system_call and (
    auth.uid() is null
    or not public.fn_role_at_least(p_organization_id, 'manager')
  ) then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  if p_survivor is null or p_absorbed is null or p_survivor = p_absorbed then
    raise exception using errcode = '22023', message = 'selecao_de_negocios_invalida';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || least(p_survivor, p_absorbed)::text
      || ':' || greatest(p_survivor, p_absorbed)::text,
      0
    )
  );

  select * into v_log
    from public.crm_lead_merge_log m
   where m.organization_id = p_organization_id
     and m.survivor_lead_id = p_survivor
     and m.absorbed_lead_id = p_absorbed
     and m.undone_at is null
   for update;
  if found then
    return jsonb_build_object(
      'outcome', 'already_merged', 'log_id', v_log.id,
      'survivor_lead_id', p_survivor, 'absorbed_lead_id', p_absorbed
    );
  end if;

  perform 1 from public.crm_leads l
   where l.organization_id = p_organization_id and l.id in (p_survivor, p_absorbed)
   order by l.id for update;

  select * into v_survivor from public.crm_leads l
   where l.organization_id = p_organization_id and l.id = p_survivor;
  if not found then
    raise exception using errcode = 'P0002', message = 'negocio_sobrevivente_nao_encontrado';
  end if;
  select * into v_absorbed from public.crm_leads l
   where l.organization_id = p_organization_id and l.id = p_absorbed;
  if not found then
    raise exception using errcode = 'P0002', message = 'negocio_absorvido_nao_encontrado';
  end if;

  if v_survivor.contact_id is null or v_survivor.contact_id is distinct from v_absorbed.contact_id then
    raise exception using errcode = '22023', message = 'negocios_de_contatos_diferentes';
  end if;
  if v_survivor.pipeline_id is distinct from v_absorbed.pipeline_id then
    raise exception using errcode = '22023', message = 'negocios_de_funis_diferentes';
  end if;
  if v_survivor.status <> 'open' or v_absorbed.status <> 'open' then
    raise exception using errcode = '55000', message = 'negocio_nao_esta_aberto';
  end if;
  if v_absorbed.value_cents is not null then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_valor';
  end if;
  if v_absorbed.owner_user_id is not null then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_dono';
  end if;
  if coalesce(v_absorbed.custom_fields, '{}'::jsonb) <> '{}'::jsonb then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_campos';
  end if;
  if coalesce(v_absorbed.source_metadata, '{}'::jsonb) <> '{}'::jsonb then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_origem';
  end if;
  if cardinality(coalesce(v_absorbed.tags, '{}'::text[])) > 0 then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_tags';
  end if;
  if exists (
    select 1 from public.crm_tasks t
     where t.organization_id = p_organization_id and t.lead_id = p_absorbed
  ) then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_tarefa';
  end if;
  if exists (
    select 1 from public.crm_lead_reactivations r
     where r.organization_id = p_organization_id and r.lead_id = p_absorbed
  ) or exists (
    select 1 from public.cron_jobs j
     where j.organization_id = p_organization_id
       and j.job_kind = 'followup_turn'
       and j.payload->>'lead_id' = p_absorbed::text
  ) then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_followup';
  end if;
  if exists (
    select 1 from public.crm_lead_activities a
     where a.organization_id = p_organization_id
       and a.lead_id = p_absorbed
       and a.type not in (
         'lead_created',
         'message_received',
         'lead_cooled',
         'lead_merged'
       )
  ) then
    raise exception using errcode = '55000', message = 'negocio_absorvido_tem_atividade';
  end if;

  for v_target in
    select n.nspname as schema_name,
           t.relname as table_name,
           fk_col.attname as fk_column,
           pk_col.attname as pk_column,
           exists (
             select 1 from pg_catalog.pg_attribute org_col
              where org_col.attrelid = t.oid and org_col.attname = 'organization_id'
                and org_col.attnum > 0 and not org_col.attisdropped
           ) as has_organization
      from pg_catalog.pg_constraint fk
      join pg_catalog.pg_class t on t.oid = fk.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      join pg_catalog.pg_attribute fk_col
        on fk_col.attrelid = fk.conrelid and fk_col.attnum = fk.conkey[1]
      left join pg_catalog.pg_constraint pk
        on pk.conrelid = t.oid and pk.contype = 'p' and array_length(pk.conkey, 1) = 1
      left join pg_catalog.pg_attribute pk_col
        on pk_col.attrelid = pk.conrelid and pk_col.attnum = pk.conkey[1]
     where fk.contype = 'f'
       and fk.confrelid = 'public.crm_leads'::regclass
       and array_length(fk.conkey, 1) = 1
       and array_length(fk.confkey, 1) = 1
       and t.relkind = 'r'
       and n.nspname = 'public'
     order by t.relname, fk_col.attname
  loop
    v_org_filter := case when v_target.has_organization
      then ' and organization_id = $2' else '' end;

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(%I)), ''[]''::jsonb) from %I.%I where %I = $1%s',
      coalesce(v_target.pk_column, v_target.fk_column),
      v_target.schema_name, v_target.table_name, v_target.fk_column, v_org_filter
    ) into v_ids using p_absorbed, p_organization_id;
    if jsonb_array_length(v_ids) = 0 then continue; end if;
    if v_target.pk_column is null then
      raise exception using errcode = '55000', message = 'historico_sem_chave_para_desfazer';
    end if;
    if v_target.pk_column = v_target.fk_column then
      raise exception using errcode = '55000', message = 'historico_sem_chave_estavel_para_desfazer';
    end if;

    execute format(
      'update %I.%I set %I = $1 where %I = $2%s',
      v_target.schema_name, v_target.table_name, v_target.fk_column,
      v_target.fk_column,
      case when v_target.has_organization then ' and organization_id = $3' else '' end
    ) using p_survivor, p_absorbed, p_organization_id;

    v_moved := v_moved || jsonb_build_object(
      v_target.schema_name || '.' || v_target.table_name || '.' || v_target.fk_column,
      jsonb_build_object(
        'pk_column', v_target.pk_column,
        'ids', v_ids,
        'organization_scoped', v_target.has_organization
      )
    );
  end loop;

  insert into public.crm_lead_merge_log (
    organization_id, survivor_lead_id, absorbed_lead_id,
    absorbed_snapshot, moved_references, merged_by_user_id
  ) values (
    p_organization_id, p_survivor, p_absorbed,
    to_jsonb(v_absorbed), v_moved, auth.uid()
  ) returning * into v_log;

  delete from public.crm_leads
   where id = p_absorbed and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'estado_da_juncao_mudou';
  end if;

  insert into public.crm_lead_activities (
    organization_id, lead_id, contact_id, source_module, source_id,
    type, payload, metadata, performed_at, performed_by_user_id, actor_kind, reason
  ) values (
    p_organization_id, p_survivor, v_survivor.contact_id,
    'lead_duplicate_merge', v_log.id, 'lead_duplicate_merged',
    jsonb_build_object(
      'merge_log_id', v_log.id,
      'absorbed_lead_id', p_absorbed,
      'message', case when v_system_call then v_reason else 'Negócio duplicado juntado' end
    ), '{}'::jsonb, now(), auth.uid(),
    case when v_system_call then 'system' else null end,
    case when v_system_call then v_reason else null end
  );

  return jsonb_build_object(
    'outcome', 'merged', 'log_id', v_log.id,
    'survivor_lead_id', p_survivor, 'absorbed_lead_id', p_absorbed
  );
end;
$$;

revoke execute on function public.fn_juntar_negocios(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fn_juntar_negocios(uuid, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
