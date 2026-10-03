-- 0282, revisao humana de negocios abertos duplicados.
--
-- Nao existe juncao automatica. A pessoa escolhe o par na tela e a funcao
-- reconfere, sob lock, que o absorvido continua vazio. O desenho reversivel e
-- o mesmo da 0281: snapshot completo, catalogo de FKs, IDs exatos movidos e
-- falha fechada no desfazer se qualquer parte do historico mudou.

create table if not exists public.crm_lead_merge_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survivor_lead_id uuid not null,
  absorbed_lead_id uuid not null,
  absorbed_snapshot jsonb not null,
  moved_references jsonb not null default '{}'::jsonb,
  merged_by_user_id uuid references auth.users(id) on delete set null,
  merged_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_user_id uuid references auth.users(id) on delete set null,
  constraint crm_lead_merge_log_distintos check (survivor_lead_id <> absorbed_lead_id),
  constraint crm_lead_merge_log_undo_coerente check (
    (undone_at is null and undone_by_user_id is null)
    or (undone_at is not null and undone_by_user_id is not null)
  )
);

create unique index if not exists crm_lead_merge_log_par_ativo_uk
  on public.crm_lead_merge_log (organization_id, survivor_lead_id, absorbed_lead_id)
  where undone_at is null;
create index if not exists crm_lead_merge_log_org_recentes_idx
  on public.crm_lead_merge_log (organization_id, merged_at desc);

alter table public.crm_lead_merge_log enable row level security;
drop policy if exists crm_lead_merge_log_manager_select on public.crm_lead_merge_log;
create policy crm_lead_merge_log_manager_select on public.crm_lead_merge_log
  for select using (public.fn_role_at_least(organization_id, 'manager'));

-- A tabela e append-only pela superficie: nem authenticated nem service_role
-- recebem escrita direta. Somente as funcoes, como owner, gravam e desfazem.
revoke all on table public.crm_lead_merge_log from public, anon, authenticated, service_role;
grant select on table public.crm_lead_merge_log to authenticated, service_role;

create or replace function public.fn_negocio_vazio_para_juncao(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.crm_leads l
     where l.id = p_lead_id
       and l.organization_id = p_organization_id
       and l.status = 'open'
       and l.value_cents is null
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
            and a.type not in ('lead_created', 'message_received')
       )
  );
$$;

revoke execute on function public.fn_negocio_vazio_para_juncao(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_negocio_vazio_para_juncao(uuid, uuid)
  to service_role;

create or replace function public.fn_candidatos_negocios_duplicados(
  p_organization_id uuid
)
returns table (
  group_key text,
  contact_id uuid,
  pipeline_id uuid,
  classification text,
  survivor jsonb,
  absorbed jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  return query
  with base as (
    select l.*,
           public.fn_negocio_vazio_para_juncao(l.organization_id, l.id) as vazio
      from public.crm_leads l
     where l.organization_id = p_organization_id
       and l.status = 'open'
       and l.contact_id is not null
  ), grupos as (
    select organization_id, contact_id, pipeline_id,
           count(*) filter (where vazio) as vazios,
           count(*) filter (where not vazio) as com_contexto,
           (array_agg(id order by created_at, id) filter (where not vazio))[1] as contextual,
           (array_agg(id order by created_at, id))[1] as mais_antigo
      from base
     group by organization_id, contact_id, pipeline_id
    having count(*) > 1
       and count(*) filter (where vazio) > 0
       and count(*) filter (where not vazio) <= 1
  ), escolhas as (
    select g.*,
           coalesce(g.contextual, g.mais_antigo) as survivor_id,
           case when g.com_contexto = 1 then 'vazio_com_contexto' else 'todos_vazios' end as classe
      from grupos g
  )
  select e.contact_id::text || ':' || e.pipeline_id::text,
         e.contact_id,
         e.pipeline_id,
         e.classe,
         jsonb_build_object(
           'id', s.id,
           'title', s.title,
           'source', s.source,
           'value_cents', s.value_cents,
           'custom_fields', s.custom_fields,
           'source_metadata', s.source_metadata,
           'tags', to_jsonb(s.tags),
           'created_at', s.created_at,
           'contact_name', coalesce(c.display_name, c.name),
           'pipeline_name', p.name
         ) as survivor,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', x.id,
             'title', x.title,
             'source', x.source,
             'value_cents', x.value_cents,
             'custom_fields', x.custom_fields,
             'source_metadata', x.source_metadata,
             'tags', to_jsonb(x.tags),
             'created_at', x.created_at,
             'contact_name', coalesce(c.display_name, c.name),
             'pipeline_name', p.name
           ) order by x.created_at, x.id)
             from base x
            where x.organization_id = e.organization_id
              and x.contact_id = e.contact_id
              and x.pipeline_id = e.pipeline_id
              and x.id <> e.survivor_id
              and x.vazio
         ), '[]'::jsonb) as absorbed
    from escolhas e
    join base s on s.id = e.survivor_id and s.organization_id = e.organization_id
    join public.contacts c on c.id = e.contact_id and c.organization_id = e.organization_id
    join public.crm_pipelines p on p.id = e.pipeline_id and p.organization_id = e.organization_id
   order by s.created_at, s.id;
end;
$$;

revoke execute on function public.fn_candidatos_negocios_duplicados(uuid)
  from public, anon;
grant execute on function public.fn_candidatos_negocios_duplicados(uuid)
  to authenticated;

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
begin
  if auth.uid() is null
     or not public.fn_role_at_least(p_organization_id, 'manager') then
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
       and a.type not in ('lead_created', 'message_received')
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
    type, payload, metadata, performed_at, performed_by_user_id
  ) values (
    p_organization_id, p_survivor, v_survivor.contact_id,
    'lead_duplicate_merge', v_log.id, 'lead_duplicate_merged',
    jsonb_build_object(
      'merge_log_id', v_log.id,
      'absorbed_lead_id', p_absorbed,
      'message', 'Negócio duplicado juntado'
    ), '{}'::jsonb, now(), auth.uid()
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

create or replace function public.fn_desfazer_juncao_de_negocios(
  p_organization_id uuid,
  p_log_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.crm_lead_merge_log%rowtype;
  v_item record;
  v_schema text;
  v_table text;
  v_column text;
  v_pk text;
  v_ids jsonb;
  v_expected integer;
  v_found integer;
  v_has_org boolean;
  v_org_filter text;
begin
  if auth.uid() is null
     or not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  select * into v_log from public.crm_lead_merge_log m
   where m.id = p_log_id and m.organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'juncao_de_negocios_nao_encontrada';
  end if;
  if v_log.undone_at is not null then
    return jsonb_build_object(
      'outcome', 'already_undone', 'log_id', v_log.id,
      'survivor_lead_id', v_log.survivor_lead_id,
      'absorbed_lead_id', v_log.absorbed_lead_id
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':'
      || least(v_log.survivor_lead_id, v_log.absorbed_lead_id)::text || ':'
      || greatest(v_log.survivor_lead_id, v_log.absorbed_lead_id)::text,
      0
    )
  );
  perform 1 from public.crm_leads l
   where l.organization_id = p_organization_id and l.id = v_log.survivor_lead_id
   for update;
  if not found then
    raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
  end if;
  if exists (
    select 1 from public.crm_leads l
     where l.organization_id = p_organization_id and l.id = v_log.absorbed_lead_id
  ) then
    raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
  end if;

  for v_item in select * from jsonb_each(coalesce(v_log.moved_references, '{}'::jsonb))
  loop
    v_schema := split_part(v_item.key, '.', 1);
    v_table := split_part(v_item.key, '.', 2);
    v_column := split_part(v_item.key, '.', 3);
    v_pk := v_item.value->>'pk_column';
    v_ids := coalesce(v_item.value->'ids', '[]'::jsonb);
    v_has_org := coalesce((v_item.value->>'organization_scoped')::boolean, false);
    v_expected := jsonb_array_length(v_ids);
    if v_schema <> 'public'
       or v_table !~ '^[a-z0-9_]+$'
       or v_column !~ '^[a-z0-9_]+$'
       or v_pk !~ '^[a-z0-9_]+$' then
      raise exception using errcode = '22023', message = 'registro_de_desfazer_invalido';
    end if;
    v_org_filter := case when v_has_org then ' and organization_id = $3' else '' end;
    execute format(
      'select count(*) from %I.%I where %I = $1 and %I::text in '
      || '(select jsonb_array_elements_text($2))%s',
      v_schema, v_table, v_column, v_pk, v_org_filter
    ) into v_found using v_log.survivor_lead_id, v_ids, p_organization_id;
    if v_found <> v_expected then
      raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
    end if;
  end loop;

  insert into public.crm_leads
  select (pg_catalog.jsonb_populate_record(
    null::public.crm_leads, v_log.absorbed_snapshot
  )).*;

  for v_item in select * from jsonb_each(coalesce(v_log.moved_references, '{}'::jsonb))
  loop
    v_schema := split_part(v_item.key, '.', 1);
    v_table := split_part(v_item.key, '.', 2);
    v_column := split_part(v_item.key, '.', 3);
    v_pk := v_item.value->>'pk_column';
    v_ids := coalesce(v_item.value->'ids', '[]'::jsonb);
    v_has_org := coalesce((v_item.value->>'organization_scoped')::boolean, false);
    v_expected := jsonb_array_length(v_ids);
    v_org_filter := case when v_has_org then ' and organization_id = $4' else '' end;
    execute format(
      'update %I.%I set %I = $1 where %I = $2 and %I::text in '
      || '(select jsonb_array_elements_text($3))%s',
      v_schema, v_table, v_column, v_column, v_pk, v_org_filter
    ) using v_log.absorbed_lead_id, v_log.survivor_lead_id, v_ids, p_organization_id;
    get diagnostics v_found = row_count;
    if v_found <> v_expected then
      raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
    end if;
  end loop;

  update public.crm_lead_merge_log set
    undone_at = now(),
    undone_by_user_id = auth.uid()
   where id = p_log_id and organization_id = p_organization_id and undone_at is null;
  if not found then
    raise exception using errcode = '55000', message = 'estado_da_juncao_mudou';
  end if;

  insert into public.crm_lead_activities (
    organization_id, lead_id, contact_id, source_module, source_id,
    type, payload, metadata, performed_at, performed_by_user_id
  )
  select p_organization_id, l.id, l.contact_id,
         'lead_duplicate_merge', p_log_id, 'lead_duplicate_merge_undone',
         jsonb_build_object(
           'merge_log_id', p_log_id,
           'restored_lead_id', v_log.absorbed_lead_id
         ), '{}'::jsonb, now(), auth.uid()
    from public.crm_leads l
   where l.id = v_log.survivor_lead_id and l.organization_id = p_organization_id;

  return jsonb_build_object(
    'outcome', 'undone', 'log_id', v_log.id,
    'survivor_lead_id', v_log.survivor_lead_id,
    'absorbed_lead_id', v_log.absorbed_lead_id
  );
end;
$$;

revoke execute on function public.fn_desfazer_juncao_de_negocios(uuid, uuid)
  from public, anon;
grant execute on function public.fn_desfazer_juncao_de_negocios(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
