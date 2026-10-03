-- 0281, reconcilia o card do formulário com o contato novo do WhatsApp.
--
-- O WhatsApp é a fonte da verdade para o número. O cadastro vindo do formulário
-- só pode ser absorvido quando é recente, não tem conversa, é o único com os
-- mesmos oito últimos dígitos e o primeiro nome é compatível. Ambiguidade ou
-- nome incompatível viram linha em merge_queue, a tela de revisão já existente.
--
-- A fusão automática não usa fn_mesclar_contatos: ela precisa ser reversível.
-- Registra os IDs exatos repontados e snapshots antes/depois em merge_queue.
-- O desfazer devolve somente esses IDs ao cadastro do formulário; a conversa e
-- as mensagens nascidas depois da fusão permanecem no contato do WhatsApp.

create unique index if not exists uniq_merge_queue_whatsapp_external
  on public.merge_queue (organization_id, ((trigger_payload->>'external_message_id')))
  where reason in ('whatsapp_form_auto_merge', 'whatsapp_form_provavel')
    and trigger_payload->>'external_message_id' is not null;

create or replace function public.fn_nome_compativel_whatsapp_formulario(
  p_nome_formulario text,
  p_nome_whatsapp text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_form text;
  v_whats text;
  v_maior text;
  v_menor text;
  v_i integer := 1;
  v_j integer := 1;
  v_erros integer := 0;
begin
  v_form := split_part(
    btrim(regexp_replace(
      translate(lower(coalesce(p_nome_formulario, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+', ' ', 'g')),
    ' ', 1
  );
  v_whats := split_part(
    btrim(regexp_replace(
      translate(lower(coalesce(p_nome_whatsapp, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+', ' ', 'g')),
    ' ', 1
  );

  if v_form = '' or v_whats = '' then return false; end if;
  if v_form = v_whats then return true; end if;
  if v_form like v_whats || '%' or v_whats like v_form || '%' then return true; end if;
  if abs(length(v_form) - length(v_whats)) > 1 then return false; end if;

  if length(v_form) >= length(v_whats) then
    v_maior := v_form; v_menor := v_whats;
  else
    v_maior := v_whats; v_menor := v_form;
  end if;

  while v_i <= length(v_maior) and v_j <= length(v_menor) loop
    if substr(v_maior, v_i, 1) = substr(v_menor, v_j, 1) then
      v_i := v_i + 1; v_j := v_j + 1;
    else
      v_erros := v_erros + 1;
      if v_erros > 1 then return false; end if;
      if length(v_maior) = length(v_menor) then v_j := v_j + 1; end if;
      v_i := v_i + 1;
    end if;
  end loop;
  if v_i <= length(v_maior) or v_j <= length(v_menor) then
    v_erros := v_erros + 1;
  end if;
  return v_erros <= 1;
end;
$$;

revoke execute on function public.fn_nome_compativel_whatsapp_formulario(text, text)
  from public, anon, authenticated;
grant execute on function public.fn_nome_compativel_whatsapp_formulario(text, text)
  to service_role;

-- Marca SOMENTE o contato que nasceu nesta chamada como elegível. Se o processo
-- cair antes da reconciliação, a reentrega reencontra a marca e conclui. Contato
-- preexistente nunca ganha a marca e, portanto, nunca entra por acidente.
create or replace function public.fn_upsert_wa_contact(
  p_org uuid, p_kind text, p_phone text, p_lid text, p_chat_id text, p_notify text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_conflito text;
  v_lid text := nullif(regexp_replace(coalesce(p_lid, ''), '@.*$', ''), '');
  v_phone text := nullif(p_phone, '');
  v_digits text;
  v_alt text;
begin
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '\D', '', 'g');
    if v_digits ~ '^55[1-9][0-9][6-9][0-9]{7}$' then
      v_alt := '+' || v_digits;
      v_phone := '+55' || substring(v_digits from 3 for 2) || '9' || substring(v_digits from 5);
    elsif v_digits ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' then
      v_phone := '+' || v_digits;
      v_alt := '+55' || substring(v_digits from 3 for 2) || substring(v_digits from 6);
    end if;
  end if;

  if v_lid is not null then
    select id into v_id from public.contacts
     where organization_id = p_org and wa_lid = v_lid and is_merged_into is null
     limit 1;
  end if;
  if v_id is null and v_phone is not null then
    select id into v_id from public.contacts
     where organization_id = p_org and is_merged_into is null
       and phone_number in (v_phone, v_alt)
     order by case when phone_number = v_phone then 0 else 1 end
     limit 1;
  end if;
  if v_id is not null and v_phone is not null and exists (
    select 1 from public.contacts
     where organization_id = p_org and phone_number = v_phone
       and is_merged_into is null and id <> v_id
  ) then
    v_conflito := v_phone;
    v_phone := null;
  end if;

  if v_id is not null then
    update public.contacts set
      phone_number = case
        when v_phone is not null and (phone_number is null or phone_number = v_alt) then v_phone
        else phone_number
      end,
      display_name = coalesce(display_name, nullif(p_notify, '')),
      source_metadata = source_metadata
        || case when v_lid is not null then jsonb_build_object('waha_lid', v_lid) else '{}'::jsonb end
        || case when p_chat_id is not null then jsonb_build_object('waha_chat_id', p_chat_id) else '{}'::jsonb end
        || case when nullif(p_notify, '') is not null then jsonb_build_object('notify_name', p_notify) else '{}'::jsonb end
        || case when v_conflito is not null then jsonb_build_object('telefone_em_conflito', v_conflito) else '{}'::jsonb end,
      updated_at = now()
    where id = v_id and organization_id = p_org;
    return v_id;
  end if;

  begin
    insert into public.contacts
      (organization_id, phone_number, source, consent, tags, source_metadata, display_name)
    values (
      p_org, v_phone, 'whatsapp', '{}'::jsonb, '{}'::text[],
      jsonb_strip_nulls(jsonb_build_object(
        'waha_lid', v_lid,
        'waha_chat_id', p_chat_id,
        'notify_name', nullif(p_notify, ''),
        'reconciliacao_formulario_pendente', true
      )),
      nullif(p_notify, '')
    ) returning id into v_id;
    return v_id;
  exception when unique_violation then
    select id into v_id from public.contacts
     where organization_id = p_org and is_merged_into is null
       and (
         (v_phone is not null and phone_number = v_phone)
         or (v_alt is not null and phone_number = v_alt)
         or (v_lid is not null and wa_lid = v_lid)
       )
     order by case when phone_number = v_phone then 0 else 1 end
     limit 1;
    return v_id;
  end;
end;
$$;

revoke execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fn_upsert_wa_contact(uuid, text, text, text, text, text)
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
  v_candidato uuid;
  v_sufixo text;
  v_nome_whatsapp text;
  v_nome_form text;
  v_motivo text;
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
      'contact_id', v_fila.trigger_payload->>'whatsapp_contact_id'
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

  if coalesce((v_whatsapp.source_metadata->>'reconciliacao_formulario_pendente')::boolean, false) = false
     or exists (
       select 1 from public.conversations c
        where c.organization_id = p_organization_id and c.contact_id = p_contato_whatsapp
     ) then
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  v_sufixo := right(regexp_replace(coalesce(v_whatsapp.phone_number, ''), '\D', '', 'g'), 8);
  if length(v_sufixo) <> 8 then
    update public.contacts set
      source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
        || jsonb_build_object('reconciliacao_formulario_processada_em', to_jsonb(now())),
      updated_at = now()
     where id = p_contato_whatsapp and organization_id = p_organization_id;
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

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

  if v_motivo is not null then
    insert into public.merge_queue
      (organization_id, candidates, reason, trigger_payload, status, resolution)
    values (
      p_organization_id,
      array[p_contato_whatsapp] || v_candidatos,
      'whatsapp_form_provavel',
      jsonb_build_object(
        'external_message_id', p_external_message_id,
        'whatsapp_contact_id', p_contato_whatsapp,
        'motivo', v_motivo,
        'regra', 'ultimos_8_digitos_7_dias_nome_compativel',
        'janela_dias', p_janela_dias
      ),
      'pending',
      jsonb_build_object('outcome', 'suggestion', 'motivo', v_motivo)
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

  -- Reconfere as travas depois dos locks. O candidato que ganhou conversa no
  -- intervalo sai da automação sem mutação.
  if exists (
    select 1 from public.conversations c
     where c.organization_id = p_organization_id
       and c.contact_id in (p_contato_whatsapp, v_candidato)
  ) then
    update public.contacts set
      source_metadata = (source_metadata - 'reconciliacao_formulario_pendente')
        || jsonb_build_object('reconciliacao_formulario_processada_em', to_jsonb(now())),
      updated_at = now()
     where id = p_contato_whatsapp and organization_id = p_organization_id;
    return jsonb_build_object('outcome', 'none', 'contact_id', p_contato_whatsapp);
  end if;

  insert into public.merge_queue
    (organization_id, candidates, reason, trigger_payload, status, resolution, resolved_at)
  values (
    p_organization_id,
    array[p_contato_whatsapp, v_candidato],
    'whatsapp_form_auto_merge',
    jsonb_build_object(
      'external_message_id', p_external_message_id,
      'whatsapp_contact_id', p_contato_whatsapp,
      'form_contact_id', v_candidato,
      'telefone_original_formulario', v_form.phone_number,
      'regra', 'ultimos_8_digitos_7_dias_nome_compativel',
      'juntado_por', 'sistema',
      'janela_dias', p_janela_dias
    ),
    'resolved', '{}'::jsonb, now()
  ) returning * into v_fila;

  v_antes := jsonb_build_object(
    'name', v_whatsapp.name,
    'display_name', v_whatsapp.display_name,
    'birthdate', v_whatsapp.birthdate,
    'email', v_whatsapp.email,
    'tags', to_jsonb(v_whatsapp.tags),
    'last_activity_at', v_whatsapp.last_activity_at
  );

  -- A lápide libera os identificadores parciais antes de completar o vencedor.
  update public.contacts set
    is_merged_into = p_contato_whatsapp,
    merged_at = now(),
    updated_at = now()
   where id = v_candidato and organization_id = p_organization_id
     and is_merged_into is null;
  if not found then raise exception 'candidato_indisponivel' using errcode = 'P0002'; end if;

  -- Catálogo, não lista manual. Para desfazer com segurança, toda tabela que
  -- realmente tem linha a mover precisa ter PK simples; sem isso falha fechado.
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
      jsonb_build_object(
        'pk_column', v_alvo.pk_coluna,
        'ids', v_ids,
        'filter', v_alvo.filtro
      )
    );
  end loop;

  select coalesce(array_agg(distinct tag), '{}'::text[]) into v_tags
    from (
      select unnest(c.tags) as tag from public.contacts c
       where c.id in (p_contato_whatsapp, v_candidato)
         and c.organization_id = p_organization_id
    ) tags_unidas;

  update public.contacts set
    -- O nome do WhatsApp prevalece; dados ausentes vêm do formulário.
    name = coalesce(name, display_name, v_form.name, v_form.display_name),
    display_name = coalesce(display_name, name, v_form.display_name, v_form.name),
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
      ),
    updated_at = now()
   where id = p_contato_whatsapp and organization_id = p_organization_id;

  select jsonb_build_object(
    'name', c.name,
    'display_name', c.display_name,
    'birthdate', c.birthdate,
    'email', c.email,
    'tags', to_jsonb(c.tags),
    'last_activity_at', c.last_activity_at
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
           'regra', 'ultimos_8_digitos_7_dias_nome_compativel'
         ), '{}'::jsonb, now()
    from public.crm_leads l
   where l.organization_id = p_organization_id and l.contact_id = p_contato_whatsapp;
  get diagnostics v_atividades = row_count;

  update public.merge_queue set resolution = jsonb_build_object(
      'outcome', 'merged',
      'contact_id', p_contato_whatsapp,
      'form_contact_id', v_candidato,
      'telefone_original_formulario', v_form.phone_number,
      'regra', 'ultimos_8_digitos_7_dias_nome_compativel',
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
    'telefone_original_formulario', v_form.phone_number
  );
end;
$$;

revoke execute on function public.fn_reconciliar_contato_whatsapp_formulario(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.fn_reconciliar_contato_whatsapp_formulario(uuid, uuid, text, integer)
  to service_role;

create or replace function public.fn_desfazer_mesclagem_automatica_whatsapp(
  p_organization_id uuid,
  p_merge_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila public.merge_queue%rowtype;
  v_whatsapp uuid;
  v_form uuid;
  v_item record;
  v_esquema text;
  v_tabela text;
  v_coluna text;
  v_pk text;
  v_filtro text;
  v_ids jsonb;
  v_esperado integer;
  v_movido integer;
  v_antes jsonb;
  v_depois jsonb;
  v_meta jsonb;
  v_historico jsonb;
  v_atividades integer := 0;
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  select * into v_fila from public.merge_queue q
   where q.id = p_merge_queue_id
     and q.organization_id = p_organization_id
     and q.reason = 'whatsapp_form_auto_merge'
   for update;
  if not found then raise exception 'mesclagem_automatica_nao_encontrada' using errcode = 'P0002'; end if;
  if v_fila.status = 'discarded' then
    return coalesce(v_fila.resolution, '{}'::jsonb)
      || jsonb_build_object('outcome', 'already_undone', 'merge_queue_id', v_fila.id);
  end if;
  if v_fila.status <> 'resolved' then
    raise exception 'mesclagem_automatica_nao_pode_ser_desfeita' using errcode = '55000';
  end if;

  v_whatsapp := (v_fila.trigger_payload->>'whatsapp_contact_id')::uuid;
  v_form := (v_fila.trigger_payload->>'form_contact_id')::uuid;
  perform 1 from public.contacts c
   where c.organization_id = p_organization_id and c.id in (v_whatsapp, v_form)
   order by c.id for update;
  if not exists (
    select 1 from public.contacts c
     where c.id = v_form and c.organization_id = p_organization_id
       and c.is_merged_into = v_whatsapp
  ) then
    raise exception 'estado_da_mesclagem_mudou' using errcode = '55000';
  end if;

  for v_item in select * from jsonb_each(coalesce(v_fila.resolution->'moved_references', '{}'::jsonb))
  loop
    v_esquema := split_part(v_item.key, '.', 1);
    v_tabela := split_part(v_item.key, '.', 2);
    v_coluna := split_part(v_item.key, '.', 3);
    v_pk := v_item.value->>'pk_column';
    v_filtro := coalesce(v_item.value->>'filter', '');
    v_ids := coalesce(v_item.value->'ids', '[]'::jsonb);
    v_esperado := jsonb_array_length(v_ids);

    if v_esquema <> 'public' or v_tabela !~ '^[a-z0-9_]+$'
       or v_coluna !~ '^[a-z0-9_]+$' or v_pk !~ '^[a-z0-9_]+$'
       or v_filtro not in ('', ' and target_kind = ''contact''') then
      raise exception 'registro_de_desfazer_invalido' using errcode = '22023';
    end if;

    execute format(
      'update %I.%I set %I = $1 where %I = $2 and %I::text in (select jsonb_array_elements_text($3))%s',
      v_esquema, v_tabela, v_coluna, v_coluna, v_pk, v_filtro
    ) using v_form, v_whatsapp, v_ids;
    get diagnostics v_movido = row_count;
    if v_movido <> v_esperado then
      raise exception 'historico_mudou_desde_a_mesclagem' using errcode = '55000';
    end if;
  end loop;

  -- Reativar pode colidir com outro contato que tomou o número antigo. Nesse
  -- caso o índice derruba a transação inteira e nada fica meio desfeito.
  update public.contacts set is_merged_into = null, merged_at = null, updated_at = now()
   where id = v_form and organization_id = p_organization_id
     and is_merged_into = v_whatsapp;
  if not found then raise exception 'estado_da_mesclagem_mudou' using errcode = '55000'; end if;

  v_antes := v_fila.resolution->'winner_before';
  v_depois := v_fila.resolution->'winner_after';
  select c.source_metadata into v_meta from public.contacts c
   where c.id = v_whatsapp and c.organization_id = p_organization_id for update;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_historico
    from jsonb_array_elements(coalesce(v_meta->'telefones_originais_formulario', '[]'::jsonb)) e
   where e->>'merge_queue_id' <> p_merge_queue_id::text;
  if jsonb_array_length(v_historico) = 0 then
    v_meta := v_meta - 'telefones_originais_formulario';
  else
    v_meta := jsonb_set(v_meta, '{telefones_originais_formulario}', v_historico, true);
  end if;

  update public.contacts c set
    name = case when coalesce(to_jsonb(c.name), 'null'::jsonb) = v_depois->'name'
      then case when v_antes->'name' = 'null'::jsonb then null else v_antes->>'name' end else c.name end,
    display_name = case when coalesce(to_jsonb(c.display_name), 'null'::jsonb) = v_depois->'display_name'
      then case when v_antes->'display_name' = 'null'::jsonb then null else v_antes->>'display_name' end else c.display_name end,
    birthdate = case when coalesce(to_jsonb(c.birthdate), 'null'::jsonb) = v_depois->'birthdate'
      then nullif(v_antes->>'birthdate', '')::date else c.birthdate end,
    email = case when coalesce(to_jsonb(c.email), 'null'::jsonb) = v_depois->'email'
      then case when v_antes->'email' = 'null'::jsonb then null else v_antes->>'email' end else c.email end,
    tags = case when to_jsonb(c.tags) = v_depois->'tags'
      then array(select jsonb_array_elements_text(coalesce(v_antes->'tags', '[]'::jsonb))) else c.tags end,
    last_activity_at = case when coalesce(to_jsonb(c.last_activity_at), 'null'::jsonb) = v_depois->'last_activity_at'
      then nullif(v_antes->>'last_activity_at', '')::timestamptz else c.last_activity_at end,
    source_metadata = v_meta,
    updated_at = now()
   where c.id = v_whatsapp and c.organization_id = p_organization_id;

  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type,
     payload, metadata, performed_at, performed_by_user_id)
  select p_organization_id, l.id, v_form, 'whatsapp_reconciliation',
         p_merge_queue_id, 'contacts_merge_undone',
         jsonb_build_object('merge_queue_id', p_merge_queue_id, 'contato_whatsapp', v_whatsapp),
         '{}'::jsonb, now(), auth.uid()
    from public.crm_leads l
   where l.organization_id = p_organization_id and l.contact_id = v_form;
  get diagnostics v_atividades = row_count;

  update public.merge_queue set
    status = 'discarded',
    resolved_at = now(),
    resolved_by_user_id = auth.uid(),
    resolution = resolution || jsonb_build_object(
      'undone_at', now(),
      'undone_by_user_id', auth.uid(),
      'undo_timeline_activities', v_atividades
    )
   where id = p_merge_queue_id and organization_id = p_organization_id;

  return jsonb_build_object(
    'outcome', 'undone',
    'merge_queue_id', p_merge_queue_id,
    'whatsapp_contact_id', v_whatsapp,
    'form_contact_id', v_form
  );
end;
$$;

revoke execute on function public.fn_desfazer_mesclagem_automatica_whatsapp(uuid, uuid)
  from public, anon;
grant execute on function public.fn_desfazer_mesclagem_automatica_whatsapp(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
