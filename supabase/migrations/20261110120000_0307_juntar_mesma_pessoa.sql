-- 0307, reconhece a mesma pessoa por mensagem pronta e junta seus negócios sob demanda.
--
-- A reconciliação mantém a regra dos oito dígitos como primeira tentativa. Somente
-- quando ela não acha candidato a primeira mensagem inbound é lida. Nome completo
-- e único em até 60 minutos pode juntar; primeiro nome, ambiguidade e nome apenas
-- parecido alimentam a fila humana existente.
--
-- A junção contextual é uma porta nova e deliberadamente separada da
-- fn_juntar_negocios. A função antiga continua recusando card com contexto, pois é
-- usada pela tela e pelo cron curto. Esta é chamada somente sob demanda para uma
-- organização e guarda o antes/depois do sobrevivente para o mesmo desfazer.

alter table public.crm_lead_merge_log
  add column if not exists survivor_snapshot jsonb;

create or replace function public.fn_normalizar_nome_reconciliacao(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(p_nome, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'));
$$;

revoke execute on function public.fn_normalizar_nome_reconciliacao(text)
  from public, anon, authenticated;
grant execute on function public.fn_normalizar_nome_reconciliacao(text)
  to service_role;

create or replace function public.fn_reconciliar_contato_whatsapp_formulario(
  p_organization_id uuid,
  p_contato_whatsapp uuid,
  p_external_message_id text,
  p_janela_dias integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_whatsapp public.contacts%rowtype;
  v_form public.contacts%rowtype;
  v_fila public.merge_queue%rowtype;
  v_candidatos uuid[] := '{}'::uuid[];
  v_similares uuid[] := '{}'::uuid[];
  v_candidato uuid;
  v_sufixo text;
  v_nome_whatsapp text;
  v_nome_form text;
  v_nome_extraido text;
  v_nome_normalizado text;
  v_mensagem text;
  v_mensagem_em timestamptz;
  v_palavras integer := 0;
  v_motivo text;
  v_regra text := 'ultimos_8_digitos_7_dias_nome_compativel';
  v_alvo record;
  v_ids jsonb;
  v_movidos jsonb := '{}'::jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_tags text[];
  v_atividades integer := 0;
begin
  if p_organization_id is null or p_contato_whatsapp is null
     or nullif(p_external_message_id, '') is null
     or p_janela_dias <> 7 then
    raise exception using errcode = '22023', message = 'reconciliacao_parametros_invalidos';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_contato_whatsapp::text, 0)
  );

  select * into v_fila from public.merge_queue q
   where q.organization_id = p_organization_id
     and q.reason in ('whatsapp_form_auto_merge', 'whatsapp_form_provavel')
     and q.trigger_payload->>'external_message_id' = p_external_message_id
   order by q.created_at desc limit 1 for update;
  if found then
    return coalesce(v_fila.resolution, '{}'::jsonb) || jsonb_build_object(
      'merge_queue_id', v_fila.id,
      'outcome', case when v_fila.reason = 'whatsapp_form_auto_merge' then 'merged' else 'suggestion' end,
      'contact_id', v_fila.trigger_payload->>'whatsapp_contact_id',
      'regra', v_fila.trigger_payload->>'regra'
    );
  end if;

  select * into v_whatsapp from public.contacts c
   where c.id = p_contato_whatsapp
     and c.organization_id = p_organization_id
     and c.source = 'whatsapp'
     and c.is_merged_into is null
     and c.is_anonymized = false
   for update;
  if not found then
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  if coalesce((v_whatsapp.source_metadata->>'reconciliacao_formulario_pendente')::boolean, false) = false then
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  v_sufixo := right(regexp_replace(coalesce(v_whatsapp.phone_number, ''), '\D', '', 'g'), 8);
  if length(v_sufixo) = 8 then
    select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[])
      into v_candidatos
      from public.contacts c
     where c.organization_id = p_organization_id
       and c.id <> p_contato_whatsapp
       and c.source = 'webhook'
       and c.is_merged_into is null
       and c.is_anonymized = false
       and c.created_at >= now() - make_interval(days => p_janela_dias)
       and length(regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g')) >= 8
       and right(regexp_replace(c.phone_number, '\D', '', 'g'), 8) = v_sufixo
       and not exists (
         select 1 from public.conversations cv
          where cv.organization_id = p_organization_id and cv.contact_id = c.id
       );
  end if;

  if cardinality(v_candidatos) > 0 then
    v_nome_whatsapp := coalesce(v_whatsapp.display_name, v_whatsapp.name);
    if cardinality(v_candidatos) > 1 then
      v_motivo := 'multiplos_candidatos';
    else
      v_candidato := v_candidatos[1];
      select * into v_form from public.contacts c
       where c.id = v_candidato and c.organization_id = p_organization_id for update;
      v_nome_form := coalesce(v_form.name, v_form.display_name);
      if not public.fn_nome_compativel_whatsapp_formulario(v_nome_form, v_nome_whatsapp) then
        v_motivo := 'nome_incompativel';
      end if;
    end if;
  else
    -- A chamada normal acontece depois do INSERT. No lote, a mesma consulta usa
    -- a primeira mensagem que já estava gravada. Em ambos os casos uma mensagem
    -- posterior nunca toma o lugar da primeira.
    select m.body, coalesce(m.sent_at, m.created_at)
      into v_mensagem, v_mensagem_em
      from public.messages m
     where m.organization_id = p_organization_id
       and m.contact_id = p_contato_whatsapp
       and m.direction = 'inbound'
     order by coalesce(m.sent_at, m.created_at), m.created_at, m.id
     limit 1;

    if not found or not exists (
      select 1 from public.messages m
       where m.organization_id = p_organization_id
         and m.contact_id = p_contato_whatsapp
         and m.direction = 'inbound'
         and m.external_id = p_external_message_id
         and m.body is not distinct from v_mensagem
         and coalesce(m.sent_at, m.created_at) = v_mensagem_em
    ) then
      v_mensagem := null;
    end if;

    if v_mensagem is not null then
      select (pg_catalog.regexp_match(
        v_mensagem,
        '\mme[[:space:]]+chamo[[:space:]]+(.+?)[[:space:]]+e[[:space:]]+quero\M',
        'i'
      ))[1] into v_nome_extraido;
    end if;
    v_nome_normalizado := public.fn_normalizar_nome_reconciliacao(v_nome_extraido);
    if nullif(v_nome_normalizado, '') is not null then
      v_palavras := cardinality(pg_catalog.regexp_split_to_array(v_nome_normalizado, ' '));
      select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[])
        into v_candidatos
        from public.contacts c
       where c.organization_id = p_organization_id
         and c.id <> p_contato_whatsapp
         and c.source = 'webhook'
         and c.is_merged_into is null
         and c.is_anonymized = false
         and c.created_at between v_mensagem_em - interval '60 minutes' and v_mensagem_em
         and not exists (
           select 1 from public.conversations cv
            where cv.organization_id = p_organization_id and cv.contact_id = c.id
         )
         and public.fn_normalizar_nome_reconciliacao(coalesce(c.name, c.display_name)) = v_nome_normalizado;

      if cardinality(v_candidatos) = 0 then
        select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[])
          into v_similares
          from public.contacts c
         where c.organization_id = p_organization_id
           and c.id <> p_contato_whatsapp
           and c.source = 'webhook'
           and c.is_merged_into is null
           and c.is_anonymized = false
           and c.created_at between v_mensagem_em - interval '60 minutes' and v_mensagem_em
           and not exists (
             select 1 from public.conversations cv
              where cv.organization_id = p_organization_id and cv.contact_id = c.id
           )
           and public.fn_nome_compativel_whatsapp_formulario(
             coalesce(c.name, c.display_name), v_nome_extraido
           );
        if cardinality(v_similares) > 0 then
          v_candidatos := v_similares;
          v_motivo := 'nome_parecido';
        end if;
      elsif cardinality(v_candidatos) > 1 then
        v_motivo := 'multiplos_candidatos';
      elsif v_palavras < 2 then
        v_motivo := 'nome_incompleto';
      else
        v_candidato := v_candidatos[1];
        select * into v_form from public.contacts c
         where c.id = v_candidato and c.organization_id = p_organization_id for update;
      end if;
      v_regra := 'mensagem_pronta_nome_60_min';
    end if;
  end if;

  if cardinality(v_candidatos) = 0 then
    update public.contacts set
      source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
        || jsonb_build_object('reconciliacao_formulario_processada_em', to_jsonb(now())),
      updated_at = now()
     where id = p_contato_whatsapp and organization_id = p_organization_id;
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  perform 1 from public.contacts c
   where c.organization_id = p_organization_id and c.id = any(v_candidatos)
   order by c.id for update;

  if v_motivo is not null then
    insert into public.merge_queue
      (organization_id, candidates, reason, trigger_payload, status, resolution)
    values (
      p_organization_id,
      array[p_contato_whatsapp] || v_candidatos,
      'whatsapp_form_provavel',
      jsonb_strip_nulls(jsonb_build_object(
        'external_message_id', p_external_message_id,
        'whatsapp_contact_id', p_contato_whatsapp,
        'motivo', v_motivo,
        'regra', v_regra,
        'janela_dias', p_janela_dias,
        'janela_minutos', case when v_regra = 'mensagem_pronta_nome_60_min' then 60 else null end,
        'nome_extraido', v_nome_extraido
      )),
      'pending',
      jsonb_build_object('outcome', 'suggestion', 'motivo', v_motivo, 'regra', v_regra)
    ) returning * into v_fila;

    update public.contacts set
      source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
        || jsonb_build_object('reconciliacao_formulario_processada_em', to_jsonb(now())),
      updated_at = now()
     where id = p_contato_whatsapp and organization_id = p_organization_id;
    return v_fila.resolution || jsonb_build_object(
      'merge_queue_id', v_fila.id, 'contact_id', p_contato_whatsapp
    );
  end if;

  if exists (
    select 1 from public.conversations c
     where c.organization_id = p_organization_id and c.contact_id = v_candidato
  ) then
    update public.contacts set
      source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
        || jsonb_build_object('reconciliacao_formulario_processada_em', to_jsonb(now())),
      updated_at = now()
     where id = p_contato_whatsapp and organization_id = p_organization_id;
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  select * into v_form from public.contacts c
   where c.id = v_candidato and c.organization_id = p_organization_id for update;

  insert into public.merge_queue
    (organization_id, candidates, reason, trigger_payload, status, resolution, resolved_at)
  values (
    p_organization_id,
    array[p_contato_whatsapp, v_candidato],
    'whatsapp_form_auto_merge',
    jsonb_strip_nulls(jsonb_build_object(
      'external_message_id', p_external_message_id,
      'whatsapp_contact_id', p_contato_whatsapp,
      'form_contact_id', v_candidato,
      'telefone_original_formulario', v_form.phone_number,
      'regra', v_regra,
      'juntado_por', 'sistema',
      'janela_dias', p_janela_dias,
      'janela_minutos', case when v_regra = 'mensagem_pronta_nome_60_min' then 60 else null end,
      'nome_extraido', v_nome_extraido
    )),
    'resolved', '{}'::jsonb, now()
  ) returning * into v_fila;

  v_antes := jsonb_build_object(
    'name', v_whatsapp.name,
    'display_name', v_whatsapp.display_name,
    'birthdate', v_whatsapp.birthdate,
    'email', v_whatsapp.email,
    'tags', to_jsonb(v_whatsapp.tags),
    'last_activity_at', v_whatsapp.last_activity_at
  ) || case when v_regra = 'mensagem_pronta_nome_60_min'
    then jsonb_build_object(
      'nome_perfil_whatsapp', coalesce(v_whatsapp.display_name, v_whatsapp.name)
    )
    else '{}'::jsonb
  end;

  update public.contacts set
    is_merged_into = p_contato_whatsapp,
    merged_at = now(),
    updated_at = now()
   where id = v_candidato and organization_id = p_organization_id
     and is_merged_into is null;
  if not found then raise exception 'candidato_indisponivel' using errcode = 'P0002'; end if;

  for v_alvo in
    select n.nspname as esquema, t.relname as tabela, a.attname as coluna,
           pk_a.attname as pk_coluna, ''::text as filtro
      from pg_catalog.pg_constraint fk
      join pg_catalog.pg_class t on t.oid = fk.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = fk.conrelid and a.attnum = fk.conkey[1]
      left join pg_catalog.pg_constraint pk
        on pk.conrelid = t.oid and pk.contype = 'p' and array_length(pk.conkey, 1) = 1
      left join pg_catalog.pg_attribute pk_a
        on pk_a.attrelid = pk.conrelid and pk_a.attnum = pk.conkey[1]
     where fk.contype = 'f'
       and fk.confrelid = 'public.contacts'::regclass
       and fk.conrelid <> 'public.contacts'::regclass
       and array_length(fk.conkey, 1) = 1
       and t.relkind = 'r' and n.nspname = 'public'
    union all
    select 'public', 'crm_lead_links', 'target_id', 'id',
           ' and target_kind = ''contact'''
     where to_regclass('public.crm_lead_links') is not null
    order by 2, 3
  loop
    if v_alvo.pk_coluna is null then
      execute format(
        'select case when exists(select 1 from %I.%I where %I = $1%s) then ''[true]''::jsonb else ''[]''::jsonb end',
        v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
      ) into v_ids using v_candidato;
      if jsonb_array_length(v_ids) > 0 then
        raise exception 'historico_sem_chave_para_desfazer' using errcode = '55000';
      end if;
      continue;
    end if;

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(%I)), ''[]''::jsonb) from %I.%I where %I = $1%s',
      v_alvo.pk_coluna, v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
    ) into v_ids using v_candidato;
    if jsonb_array_length(v_ids) = 0 then continue; end if;

    execute format(
      'update %I.%I set %I = $1 where %I = $2%s',
      v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.coluna, v_alvo.filtro
    ) using p_contato_whatsapp, v_candidato;

    v_movidos := v_movidos || jsonb_build_object(
      v_alvo.esquema || '.' || v_alvo.tabela || '.' || v_alvo.coluna,
      jsonb_build_object('pk_column', v_alvo.pk_coluna, 'ids', v_ids, 'filter', v_alvo.filtro)
    );
  end loop;

  select coalesce(array_agg(distinct tag), '{}'::text[]) into v_tags
    from (
      select unnest(c.tags) as tag from public.contacts c
       where c.id in (p_contato_whatsapp, v_candidato)
         and c.organization_id = p_organization_id
    ) tags_unidas;

  update public.contacts set
    name = case when v_regra = 'mensagem_pronta_nome_60_min'
      then coalesce(v_form.name, v_form.display_name)
      else coalesce(name, display_name, v_form.name, v_form.display_name)
    end,
    display_name = case when v_regra = 'mensagem_pronta_nome_60_min'
      then coalesce(v_form.display_name, v_form.name)
      else coalesce(display_name, name, v_form.display_name, v_form.name)
    end,
    birthdate = coalesce(birthdate, v_form.birthdate),
    email = coalesce(email, v_form.email),
    tags = v_tags,
    last_activity_at = greatest(last_activity_at, v_form.last_activity_at),
    source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
      || jsonb_build_object(
        'reconciliacao_formulario_processada_em', to_jsonb(now()),
        'telefones_originais_formulario',
        coalesce(source_metadata->'telefones_originais_formulario', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'merge_queue_id', v_fila.id,
            'contact_id', v_candidato,
            'telefone', v_form.phone_number,
            'nome', coalesce(v_form.name, v_form.display_name),
            'juntado_em', now()
          ))
      )
      || case when v_regra = 'mensagem_pronta_nome_60_min'
        then jsonb_build_object(
          'nome_perfil_whatsapp', coalesce(v_whatsapp.display_name, v_whatsapp.name)
        )
        else '{}'::jsonb
      end,
    updated_at = now()
   where id = p_contato_whatsapp and organization_id = p_organization_id;

  select jsonb_build_object(
    'name', c.name, 'display_name', c.display_name, 'birthdate', c.birthdate,
    'email', c.email, 'tags', to_jsonb(c.tags), 'last_activity_at', c.last_activity_at
  ) into v_depois
  from public.contacts c
  where c.id = p_contato_whatsapp and c.organization_id = p_organization_id;

  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type,
     payload, metadata, performed_at)
  select p_organization_id, l.id, p_contato_whatsapp, 'whatsapp_reconciliation',
         v_fila.id, 'contacts_merged',
         jsonb_build_object(
           'automatico', true,
           'merge_queue_id', v_fila.id,
           'contato_formulario', v_candidato,
           'telefone_original_formulario', v_form.phone_number,
           'regra', v_regra
         ), '{}'::jsonb, now()
    from public.crm_leads l
   where l.organization_id = p_organization_id and l.contact_id = p_contato_whatsapp;
  get diagnostics v_atividades = row_count;

  update public.merge_queue set resolution = jsonb_build_object(
      'outcome', 'merged',
      'contact_id', p_contato_whatsapp,
      'form_contact_id', v_candidato,
      'telefone_original_formulario', v_form.phone_number,
      'regra', v_regra,
      'juntado_por', 'sistema',
      'merged_at', now(),
      'moved_references', v_movidos,
      'winner_before', v_antes,
      'winner_after', v_depois,
      'timeline_activities', v_atividades
    )
   where id = v_fila.id and organization_id = p_organization_id;

  return jsonb_build_object(
    'outcome', 'merged',
    'contact_id', p_contato_whatsapp,
    'form_contact_id', v_candidato,
    'merge_queue_id', v_fila.id,
    'telefone_original_formulario', v_form.phone_number,
    'regra', v_regra
  );
end;
$$;

revoke execute on function public.fn_reconciliar_contato_whatsapp_formulario(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.fn_reconciliar_contato_whatsapp_formulario(uuid, uuid, text, integer)
  to service_role;

create or replace function public.fn_juntar_negocios_mesma_pessoa(
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
  v_after public.crm_leads%rowtype;
  v_target record;
  v_ids jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_org_filter text;
  v_log_id uuid := gen_random_uuid();
  v_stage_final uuid;
  v_stage_position numeric;
  v_expected_survivor uuid;
  v_tags text[];
  v_source_message text;
  v_service boolean := coalesce(auth.role() = 'service_role', false);
  v_exists boolean;
begin
  if not v_service and (
    auth.uid() is null or not public.fn_role_at_least(p_organization_id, 'manager')
  ) then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  if p_survivor is null or p_absorbed is null or p_survivor = p_absorbed then
    raise exception using errcode = '22023', message = 'selecao_de_negocios_invalida';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || least(p_survivor, p_absorbed)::text
      || ':' || greatest(p_survivor, p_absorbed)::text, 0
    )
  );
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

  select l.id into v_expected_survivor
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.id in (p_survivor, p_absorbed)
   order by (coalesce(l.source_metadata, '{}'::jsonb) <> '{}'::jsonb) desc,
            l.created_at, l.id
   limit 1;
  if v_expected_survivor <> p_survivor then
    raise exception using errcode = '22023', message = 'sobrevivente_incorreto';
  end if;

  if v_survivor.owner_user_id is not null and v_absorbed.owner_user_id is not null
     and v_survivor.owner_user_id <> v_absorbed.owner_user_id then
    raise exception using errcode = '55000', message = 'donos_humanos_diferentes';
  end if;
  if v_survivor.value_cents is not null and v_absorbed.value_cents is not null
     and v_survivor.value_cents <> v_absorbed.value_cents then
    raise exception using errcode = '55000', message = 'valores_diferentes';
  end if;
  if exists (
    select 1 from public.crm_lead_risk_states r
     where r.organization_id = p_organization_id and r.lead_id = p_survivor
  ) and exists (
    select 1 from public.crm_lead_risk_states r
     where r.organization_id = p_organization_id and r.lead_id = p_absorbed
  ) then
    raise exception using errcode = '55000', message = 'ambos_com_estado_de_risco';
  end if;
  if exists (
    select 1 from public.cron_jobs j
     where j.organization_id = p_organization_id and j.job_kind = 'followup_turn'
       and j.enabled and j.payload->>'lead_id' = p_absorbed::text
  ) and exists (
    select 1 from public.cron_jobs j
     where j.organization_id = p_organization_id and j.job_kind = 'followup_turn'
       and j.enabled and j.payload->>'lead_id' = p_survivor::text
  ) then
    raise exception using errcode = '55000', message = 'followup_agendado_nao_pode_ser_movido';
  end if;

  -- Referência sem FK, mas estável por id. É segura quando o sobrevivente não
  -- tem outro follow-up ativo, condição conferida acima.
  select coalesce(jsonb_agg(to_jsonb(j.id)), '[]'::jsonb) into v_ids
    from public.cron_jobs j
   where j.organization_id = p_organization_id
     and j.job_kind = 'followup_turn'
     and j.payload->>'lead_id' = p_absorbed::text;
  if jsonb_array_length(v_ids) > 0 then
    update public.cron_jobs j set
      payload = jsonb_set(j.payload, '{lead_id}', to_jsonb(p_survivor::text), false),
      updated_at = now()
     where j.organization_id = p_organization_id
       and j.id::text in (select jsonb_array_elements_text(v_ids));
    v_moved := v_moved || jsonb_build_object(
      'special.cron_jobs.payload_lead_id',
      jsonb_build_object('kind', 'payload_lead_id', 'pk_column', 'id', 'ids', v_ids,
                         'organization_scoped', true)
    );
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
      execute format(
        'select exists(select 1 from %I.%I where %I = $1%s)',
        v_target.schema_name, v_target.table_name, v_target.fk_column, v_org_filter
      ) into v_exists using p_survivor, p_organization_id;
      if v_exists then
        raise exception using errcode = '55000',
          message = 'referencia_unica_conflitante_' || v_target.table_name;
      end if;
      execute format(
        'update %I.%I set %I = $1 where %I = $2%s',
        v_target.schema_name, v_target.table_name, v_target.fk_column,
        v_target.fk_column,
        case when v_target.has_organization then ' and organization_id = $3' else '' end
      ) using p_survivor, p_absorbed, p_organization_id;
      v_moved := v_moved || jsonb_build_object(
        v_target.schema_name || '.' || v_target.table_name || '.' || v_target.fk_column,
        jsonb_build_object('kind', 'primary_fk', 'pk_column', v_target.pk_column,
                           'ids', v_ids, 'organization_scoped', v_target.has_organization)
      );
      continue;
    end if;

    execute format(
      'update %I.%I set %I = $1 where %I = $2%s',
      v_target.schema_name, v_target.table_name, v_target.fk_column,
      v_target.fk_column,
      case when v_target.has_organization then ' and organization_id = $3' else '' end
    ) using p_survivor, p_absorbed, p_organization_id;
    v_moved := v_moved || jsonb_build_object(
      v_target.schema_name || '.' || v_target.table_name || '.' || v_target.fk_column,
      jsonb_build_object('kind', 'foreign_key', 'pk_column', v_target.pk_column,
                         'ids', v_ids, 'organization_scoped', v_target.has_organization)
    );
  end loop;

  select s.id, s.position into v_stage_final, v_stage_position
    from public.crm_stages s
   where s.organization_id = p_organization_id
     and s.pipeline_id = v_survivor.pipeline_id
     and s.id in (v_survivor.stage_id, v_absorbed.stage_id)
   order by s.position desc, s.id
   limit 1;
  if v_stage_final is null then
    raise exception using errcode = '55000', message = 'etapa_final_nao_encontrada';
  end if;

  select coalesce(array_agg(distinct t order by t), '{}'::text[]) into v_tags
    from unnest(coalesce(v_survivor.tags, '{}'::text[]) || coalesce(v_absorbed.tags, '{}'::text[])) t;

  update public.crm_leads set
    stage_id = v_stage_final,
    owner_user_id = coalesce(v_survivor.owner_user_id, v_absorbed.owner_user_id),
    assigned_at = coalesce(v_survivor.assigned_at, v_absorbed.assigned_at),
    value_cents = coalesce(v_survivor.value_cents, v_absorbed.value_cents),
    currency = case when v_survivor.value_cents is not null then v_survivor.currency
                    else coalesce(v_absorbed.currency, v_survivor.currency) end,
    custom_fields = coalesce(v_absorbed.custom_fields, '{}'::jsonb)
      || coalesce(v_survivor.custom_fields, '{}'::jsonb),
    tags = v_tags,
    last_activity_at = greatest(v_survivor.last_activity_at, v_absorbed.last_activity_at),
    updated_at = now()
   where id = p_survivor and organization_id = p_organization_id;

  delete from public.crm_leads
   where id = p_absorbed and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'estado_da_juncao_mudou';
  end if;

  if v_survivor.stage_id <> v_stage_final then
    insert into public.crm_lead_activities (
      organization_id, lead_id, contact_id, source_module, source_id, type,
      payload, metadata, performed_at, performed_by_user_id, actor_kind, reason
    ) values (
      p_organization_id, p_survivor, v_survivor.contact_id,
      'lead_duplicate_merge', v_log_id, 'stage_changed',
      jsonb_build_object('from_stage_id', v_survivor.stage_id, 'to_stage_id', v_stage_final,
                         'position', v_stage_position, 'automatico', true),
      '{}'::jsonb, now(), auth.uid(), case when v_service then 'system' else 'user' end,
      'etapa mais avançada preservada ao juntar negócios da mesma pessoa'
    );
  end if;

  if coalesce(v_absorbed.source_metadata, '{}'::jsonb) <> '{}'::jsonb then
    v_source_message := 'Nova entrada pelo formulário em '
      || to_char(v_absorbed.created_at, 'DD/MM')
      || ', origem '
      || coalesce(nullif(concat_ws('/',
           nullif(v_absorbed.source_metadata->>'utm_source', ''),
           nullif(v_absorbed.source_metadata->>'utm_medium', '')), ''), v_absorbed.source)
      || case when nullif(v_absorbed.source_metadata->>'utm_campaign', '') is not null
           then ', campanha ' || (v_absorbed.source_metadata->>'utm_campaign') else '' end;
    insert into public.crm_lead_activities (
      organization_id, lead_id, contact_id, source_module, source_id, type,
      payload, metadata, performed_at, performed_by_user_id, actor_kind, reason
    ) values (
      p_organization_id, p_survivor, v_survivor.contact_id,
      'lead_duplicate_merge', v_log_id, 'lead_source_preserved',
      jsonb_build_object('message', v_source_message,
                         'absorbed_lead_id', p_absorbed,
                         'source_metadata', v_absorbed.source_metadata),
      '{}'::jsonb, now(), auth.uid(), case when v_service then 'system' else 'user' end,
      v_source_message
    );
  end if;

  insert into public.crm_lead_activities (
    organization_id, lead_id, contact_id, source_module, source_id, type,
    payload, metadata, performed_at, performed_by_user_id, actor_kind, reason
  ) values (
    p_organization_id, p_survivor, v_survivor.contact_id,
    'lead_duplicate_merge', v_log_id, 'lead_duplicate_merged',
    jsonb_build_object('merge_log_id', v_log_id, 'absorbed_lead_id', p_absorbed,
                       'message', 'Negócios da mesma pessoa juntados com o contexto preservado'),
    '{}'::jsonb, now(), auth.uid(), case when v_service then 'system' else 'user' end,
    'junção sob demanda de negócios da mesma pessoa'
  );

  select * into v_after from public.crm_leads l
   where l.id = p_survivor and l.organization_id = p_organization_id;

  insert into public.crm_lead_merge_log (
    id, organization_id, survivor_lead_id, absorbed_lead_id,
    absorbed_snapshot, moved_references, merged_by_user_id, survivor_snapshot
  ) values (
    v_log_id, p_organization_id, p_survivor, p_absorbed,
    to_jsonb(v_absorbed), v_moved, auth.uid(),
    jsonb_build_object('before', to_jsonb(v_survivor), 'after', to_jsonb(v_after),
                       'mode', 'mesma_pessoa_com_contexto')
  );

  return jsonb_build_object(
    'outcome', 'merged', 'log_id', v_log_id,
    'survivor_lead_id', p_survivor, 'absorbed_lead_id', p_absorbed,
    'final_stage_id', v_stage_final
  );
end;
$$;

revoke execute on function public.fn_juntar_negocios_mesma_pessoa(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fn_juntar_negocios_mesma_pessoa(uuid, uuid, uuid)
  to service_role;

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
  v_kind text;
  v_ids jsonb;
  v_expected integer;
  v_found integer;
  v_has_org boolean;
  v_org_filter text;
  v_before jsonb;
  v_after jsonb;
  v_current public.crm_leads%rowtype;
begin
  if auth.uid() is null or not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  select * into v_log from public.crm_lead_merge_log m
   where m.id = p_log_id and m.organization_id = p_organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'juncao_de_negocios_nao_encontrada';
  end if;
  if v_log.undone_at is not null then
    return jsonb_build_object('outcome', 'already_undone', 'log_id', v_log.id,
      'survivor_lead_id', v_log.survivor_lead_id,
      'absorbed_lead_id', v_log.absorbed_lead_id);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':'
      || least(v_log.survivor_lead_id, v_log.absorbed_lead_id)::text || ':'
      || greatest(v_log.survivor_lead_id, v_log.absorbed_lead_id)::text, 0
    )
  );
  select * into v_current from public.crm_leads l
   where l.organization_id = p_organization_id and l.id = v_log.survivor_lead_id
   for update;
  if not found or exists (
    select 1 from public.crm_leads l
     where l.organization_id = p_organization_id and l.id = v_log.absorbed_lead_id
  ) then
    raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
  end if;

  v_before := v_log.survivor_snapshot->'before';
  v_after := v_log.survivor_snapshot->'after';
  if v_after is not null and (
    v_current.stage_id::text is distinct from v_after->>'stage_id'
    or v_current.owner_user_id::text is distinct from v_after->>'owner_user_id'
    or v_current.value_cents::text is distinct from v_after->>'value_cents'
    or v_current.custom_fields is distinct from coalesce(v_after->'custom_fields', '{}'::jsonb)
    or to_jsonb(v_current.tags) is distinct from coalesce(v_after->'tags', '[]'::jsonb)
  ) then
    raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
  end if;

  for v_item in select * from jsonb_each(coalesce(v_log.moved_references, '{}'::jsonb))
  loop
    v_kind := coalesce(v_item.value->>'kind', 'foreign_key');
    v_ids := coalesce(v_item.value->'ids', '[]'::jsonb);
    v_expected := jsonb_array_length(v_ids);
    v_has_org := coalesce((v_item.value->>'organization_scoped')::boolean, false);
    if v_kind = 'payload_lead_id' then
      select count(*) into v_found from public.cron_jobs j
       where j.organization_id = p_organization_id
         and j.id::text in (select jsonb_array_elements_text(v_ids))
         and j.payload->>'lead_id' = v_log.survivor_lead_id::text;
      if v_found <> v_expected then
        raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
      end if;
      continue;
    end if;

    v_schema := split_part(v_item.key, '.', 1);
    v_table := split_part(v_item.key, '.', 2);
    v_column := split_part(v_item.key, '.', 3);
    v_pk := v_item.value->>'pk_column';
    if v_schema <> 'public' or v_table !~ '^[a-z0-9_]+$'
       or v_column !~ '^[a-z0-9_]+$' or v_pk !~ '^[a-z0-9_]+$' then
      raise exception using errcode = '22023', message = 'registro_de_desfazer_invalido';
    end if;
    v_org_filter := case when v_has_org then ' and organization_id = $3' else '' end;
    if v_kind = 'primary_fk' then
      execute format(
        'select count(*) from %I.%I where %I = $1%s',
        v_schema, v_table, v_column, v_org_filter
      ) into v_found using v_log.survivor_lead_id, v_ids, p_organization_id;
    else
      execute format(
        'select count(*) from %I.%I where %I = $1 and %I::text in '
        || '(select jsonb_array_elements_text($2))%s',
        v_schema, v_table, v_column, v_pk, v_org_filter
      ) into v_found using v_log.survivor_lead_id, v_ids, p_organization_id;
    end if;
    if v_found <> v_expected then
      raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
    end if;
  end loop;

  insert into public.crm_leads
  select (pg_catalog.jsonb_populate_record(null::public.crm_leads, v_log.absorbed_snapshot)).*;

  for v_item in select * from jsonb_each(coalesce(v_log.moved_references, '{}'::jsonb))
  loop
    v_kind := coalesce(v_item.value->>'kind', 'foreign_key');
    v_ids := coalesce(v_item.value->'ids', '[]'::jsonb);
    v_expected := jsonb_array_length(v_ids);
    v_has_org := coalesce((v_item.value->>'organization_scoped')::boolean, false);
    if v_kind = 'payload_lead_id' then
      update public.cron_jobs j set
        payload = jsonb_set(j.payload, '{lead_id}', to_jsonb(v_log.absorbed_lead_id::text), false),
        updated_at = now()
       where j.organization_id = p_organization_id
         and j.id::text in (select jsonb_array_elements_text(v_ids))
         and j.payload->>'lead_id' = v_log.survivor_lead_id::text;
      get diagnostics v_found = row_count;
      if v_found <> v_expected then
        raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
      end if;
      continue;
    end if;

    v_schema := split_part(v_item.key, '.', 1);
    v_table := split_part(v_item.key, '.', 2);
    v_column := split_part(v_item.key, '.', 3);
    v_pk := v_item.value->>'pk_column';
    v_org_filter := case when v_has_org then ' and organization_id = $4' else '' end;
    if v_kind = 'primary_fk' then
      execute format(
        'update %I.%I set %I = $1 where %I = $2%s',
        v_schema, v_table, v_column, v_column,
        case when v_has_org then ' and organization_id = $3' else '' end
      ) using v_log.absorbed_lead_id, v_log.survivor_lead_id, p_organization_id;
    else
      execute format(
        'update %I.%I set %I = $1 where %I = $2 and %I::text in '
        || '(select jsonb_array_elements_text($3))%s',
        v_schema, v_table, v_column, v_column, v_pk, v_org_filter
      ) using v_log.absorbed_lead_id, v_log.survivor_lead_id, v_ids, p_organization_id;
    end if;
    get diagnostics v_found = row_count;
    if v_found <> v_expected then
      raise exception using errcode = '55000', message = 'historico_mudou_desde_a_juncao';
    end if;
  end loop;

  if v_before is not null then
    update public.crm_leads set
      stage_id = (v_before->>'stage_id')::uuid,
      owner_user_id = nullif(v_before->>'owner_user_id', '')::uuid,
      assigned_at = nullif(v_before->>'assigned_at', '')::timestamptz,
      value_cents = nullif(v_before->>'value_cents', '')::bigint,
      currency = v_before->>'currency',
      custom_fields = coalesce(v_before->'custom_fields', '{}'::jsonb),
      tags = coalesce(array(select jsonb_array_elements_text(v_before->'tags')), '{}'::text[]),
      updated_at = now()
     where id = v_log.survivor_lead_id and organization_id = p_organization_id;
  end if;

  update public.crm_lead_merge_log set
    undone_at = now(), undone_by_user_id = auth.uid()
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
         jsonb_build_object('merge_log_id', p_log_id,
                            'restored_lead_id', v_log.absorbed_lead_id),
         '{}'::jsonb, now(), auth.uid()
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

create or replace function public.fn_juntar_mesma_pessoa_da_organizacao(
  p_organization_id uuid,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := coalesce(auth.role() = 'service_role', false);
  v_item record;
  v_group record;
  v_absorbed uuid;
  v_result jsonb;
  v_contacts jsonb := '[]'::jsonb;
  v_business jsonb := '[]'::jsonb;
  v_reason text;
  v_action text;
  v_rule text;
  v_candidate_ids uuid[];
  v_suffix_compatible boolean;
  v_contact_map jsonb := '{}'::jsonb;
begin
  if not v_service and (
    auth.uid() is null or not public.fn_role_at_least(p_organization_id, 'manager')
  ) then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  -- Plano e execução usam a primeira inbound. O plano repete as duas regras sem
  -- escrever e registra um mapa hipotético formulário -> WhatsApp; esse mapa é
  -- usado na etapa B para agrupar negócios como eles ficariam depois da etapa A.
  for v_item in
    select w.id as whatsapp_id, m.external_id,
           coalesce(w.display_name, w.name) as nome_whatsapp,
           public.fn_normalizar_nome_reconciliacao((pg_catalog.regexp_match(
             m.body,
             '\mme[[:space:]]+chamo[[:space:]]+(.+?)[[:space:]]+e[[:space:]]+quero\M',
             'i'
           ))[1]) as nome_extraido,
           antigos.ids as candidatos_sufixo,
           exatos.ids as candidatos_exatos,
           similares.ids as candidatos_similares
      from public.contacts w
      cross join lateral (
        select msg.external_id, msg.body, coalesce(msg.sent_at, msg.created_at) as sent_at
          from public.messages msg
         where msg.organization_id = p_organization_id
           and msg.contact_id = w.id and msg.direction = 'inbound'
         order by coalesce(msg.sent_at, msg.created_at), msg.created_at, msg.id
         limit 1
       ) m
      cross join lateral (
        select public.fn_normalizar_nome_reconciliacao((pg_catalog.regexp_match(
          m.body,
          '\mme[[:space:]]+chamo[[:space:]]+(.+?)[[:space:]]+e[[:space:]]+quero\M',
          'i'
        ))[1]) as normalizado
      ) nome
      cross join lateral (
        select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[]) as ids
          from public.contacts c
         where c.organization_id = p_organization_id
           and c.id <> w.id and c.source = 'webhook'
           and c.is_merged_into is null and not c.is_anonymized
           and c.created_at >= now() - interval '7 days'
           and length(regexp_replace(coalesce(w.phone_number, ''), '\D', '', 'g')) >= 8
           and length(regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g')) >= 8
           and right(regexp_replace(c.phone_number, '\D', '', 'g'), 8)
             = right(regexp_replace(w.phone_number, '\D', '', 'g'), 8)
           and not exists (
             select 1 from public.conversations cv
              where cv.organization_id = p_organization_id and cv.contact_id = c.id
           )
      ) antigos
      cross join lateral (
        select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[]) as ids
          from public.contacts c
         where c.organization_id = p_organization_id
           and c.id <> w.id and c.source = 'webhook'
           and c.is_merged_into is null and not c.is_anonymized
           and c.created_at between m.sent_at - interval '60 minutes' and m.sent_at
           and not exists (
             select 1 from public.conversations cv
              where cv.organization_id = p_organization_id and cv.contact_id = c.id
           )
           and nullif(nome.normalizado, '') is not null
           and public.fn_normalizar_nome_reconciliacao(coalesce(c.name, c.display_name))
             = nome.normalizado
      ) exatos
      cross join lateral (
        select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[]) as ids
          from public.contacts c
         where c.organization_id = p_organization_id
           and c.id <> w.id and c.source = 'webhook'
           and c.is_merged_into is null and not c.is_anonymized
           and c.created_at between m.sent_at - interval '60 minutes' and m.sent_at
           and not exists (
             select 1 from public.conversations cv
              where cv.organization_id = p_organization_id and cv.contact_id = c.id
           )
           and nullif(nome.normalizado, '') is not null
           and public.fn_normalizar_nome_reconciliacao(coalesce(c.name, c.display_name))
             <> nome.normalizado
           and public.fn_nome_compativel_whatsapp_formulario(
             coalesce(c.name, c.display_name), (pg_catalog.regexp_match(
               m.body,
               '\mme[[:space:]]+chamo[[:space:]]+(.+?)[[:space:]]+e[[:space:]]+quero\M',
               'i'
             ))[1]
           )
      ) similares
     where w.organization_id = p_organization_id
       and w.source = 'whatsapp'
       and w.is_merged_into is null
       and not w.is_anonymized
       and m.external_id is not null
  loop
    if p_simular then
      v_action := 'nenhuma';
      v_reason := null;
      v_rule := null;
      v_candidate_ids := '{}'::uuid[];

      if cardinality(v_item.candidatos_sufixo) > 0 then
        v_rule := 'ultimos_8_digitos_7_dias_nome_compativel';
        v_candidate_ids := v_item.candidatos_sufixo;
        if cardinality(v_candidate_ids) > 1 then
          v_action := 'sugerir';
          v_reason := 'multiplos_candidatos';
        else
          select public.fn_nome_compativel_whatsapp_formulario(
                   coalesce(c.name, c.display_name), v_item.nome_whatsapp)
            into v_suffix_compatible
            from public.contacts c
           where c.organization_id = p_organization_id and c.id = v_candidate_ids[1];
          if coalesce(v_suffix_compatible, false) then
            v_action := 'juntar';
          else
            v_action := 'sugerir';
            v_reason := 'nome_incompativel';
          end if;
        end if;
      elsif cardinality(v_item.candidatos_exatos) > 0 then
        v_rule := 'mensagem_pronta_nome_60_min';
        v_candidate_ids := v_item.candidatos_exatos;
        if cardinality(v_candidate_ids) > 1 then
          v_action := 'sugerir';
          v_reason := 'multiplos_candidatos';
        elsif cardinality(pg_catalog.regexp_split_to_array(v_item.nome_extraido, ' ')) < 2 then
          v_action := 'sugerir';
          v_reason := 'nome_incompleto';
        else
          v_action := 'juntar';
        end if;
      elsif cardinality(v_item.candidatos_similares) > 0 then
        v_rule := 'mensagem_pronta_nome_60_min';
        v_candidate_ids := v_item.candidatos_similares;
        v_action := 'sugerir';
        v_reason := 'nome_parecido';
      end if;

      if v_action <> 'nenhuma' then
        v_contacts := v_contacts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'whatsapp_contact_id', v_item.whatsapp_id,
          'external_message_id', v_item.external_id,
          'nome_extraido', nullif(v_item.nome_extraido, ''),
          'regra', v_rule,
          'acao', v_action,
          'grupo', to_jsonb(array[v_item.whatsapp_id] || v_candidate_ids),
          'motivo_recusa', v_reason
        )));
        if v_action = 'juntar' then
          v_contact_map := v_contact_map || jsonb_build_object(
            v_candidate_ids[1]::text, v_item.whatsapp_id
          );
        end if;
      end if;
    else
      update public.contacts set
        source_metadata = (source_metadata - 'reconciliacao_formulario_processada_em')
          || jsonb_build_object('reconciliacao_formulario_pendente', true),
        updated_at = now()
       where id = v_item.whatsapp_id and organization_id = p_organization_id;
      v_result := public.fn_reconciliar_contato_whatsapp_formulario(
        p_organization_id, v_item.whatsapp_id, v_item.external_id, 7
      );
      v_contacts := v_contacts || jsonb_build_array(v_result);
    end if;
  end loop;

  for v_group in
    with leads_efetivos as (
      select l.*,
             case when p_simular and v_contact_map ? l.contact_id::text
                  then (v_contact_map->>l.contact_id::text)::uuid
                  else l.contact_id end as contato_efetivo
        from public.crm_leads l
       where l.organization_id = p_organization_id
         and l.status = 'open' and l.contact_id is not null
    )
    select l.contato_efetivo as contact_id, l.pipeline_id,
           l.contato_efetivo::text || ':' || l.pipeline_id::text as group_key,
           (array_agg(l.id order by
             (coalesce(l.source_metadata, '{}'::jsonb) <> '{}'::jsonb) desc,
             l.created_at, l.id))[1] as survivor,
           array_agg(l.id order by l.created_at, l.id) as members,
           (array_agg(l.stage_id order by s.position desc, l.id))[1] as final_stage
      from leads_efetivos l
      join public.crm_stages s
        on s.id = l.stage_id and s.organization_id = l.organization_id
     group by l.contato_efetivo, l.pipeline_id
     having count(*) > 1
     order by min(l.created_at), l.contato_efetivo, l.pipeline_id
  loop
    foreach v_absorbed in array v_group.members loop
      if v_absorbed = v_group.survivor then continue; end if;
      v_reason := null;
      if exists (
        select 1 from public.crm_leads a
        join public.crm_leads b on b.id = v_absorbed and b.organization_id = a.organization_id
        where a.id = v_group.survivor and a.organization_id = p_organization_id
          and a.owner_user_id is not null and b.owner_user_id is not null
          and a.owner_user_id <> b.owner_user_id
      ) then v_reason := 'donos_humanos_diferentes';
      elsif exists (
        select 1 from public.crm_leads a
        join public.crm_leads b on b.id = v_absorbed and b.organization_id = a.organization_id
        where a.id = v_group.survivor and a.organization_id = p_organization_id
          and a.value_cents is not null and b.value_cents is not null
          and a.value_cents <> b.value_cents
      ) then v_reason := 'valores_diferentes';
      elsif exists (
        select 1 from public.crm_lead_risk_states r
         where r.organization_id = p_organization_id and r.lead_id = v_group.survivor
      ) and exists (
        select 1 from public.crm_lead_risk_states r
         where r.organization_id = p_organization_id and r.lead_id = v_absorbed
      ) then v_reason := 'ambos_com_estado_de_risco';
      end if;

      if p_simular then
        v_business := v_business || jsonb_build_array(jsonb_build_object(
          'grupo', v_group.group_key,
          'sobrevivente', v_group.survivor,
          'absorvido', v_absorbed,
          'absorvidos', to_jsonb(array_remove(v_group.members, v_group.survivor)),
          'etapa_final', v_group.final_stage,
          'motivo_recusa', v_reason
        ));
      elsif v_reason is not null then
        v_business := v_business || jsonb_build_array(jsonb_build_object(
          'grupo', v_group.group_key, 'sobrevivente', v_group.survivor,
          'absorvido', v_absorbed, 'etapa_final', v_group.final_stage,
          'outcome', 'refused', 'motivo_recusa', v_reason
        ));
      else
        begin
          v_result := public.fn_juntar_negocios_mesma_pessoa(
            p_organization_id, v_group.survivor, v_absorbed
          );
          v_business := v_business || jsonb_build_array(
            jsonb_build_object('grupo', v_group.group_key) || v_result
          );
        exception when others then
          v_business := v_business || jsonb_build_array(jsonb_build_object(
            'grupo', v_group.group_key, 'sobrevivente', v_group.survivor,
            'absorvido', v_absorbed, 'etapa_final', v_group.final_stage,
            'outcome', 'refused', 'motivo_recusa', sqlerrm
          ));
        end;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'simular', p_simular,
    'contatos', v_contacts,
    'negocios', v_business
  );
end;
$$;

revoke execute on function public.fn_juntar_mesma_pessoa_da_organizacao(uuid, boolean)
  from public, anon;
grant execute on function public.fn_juntar_mesma_pessoa_da_organizacao(uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
