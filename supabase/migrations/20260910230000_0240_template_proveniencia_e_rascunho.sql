-- 0235: troca segura de template, proveniência por item e rascunho real do agente.
--
-- A 0233 criou configuração útil, mas não guardava de onde cada item vinha. Sem
-- essa origem, "trocar o template" só podia significar sobrescrever ou apagar no
-- escuro. Esta forward-fix registra apenas itens criados pelo template e remove
-- somente os que continuam byte-equivalentes ao que ele criou.

create table if not exists public.organization_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id text not null,
  item_kind text not null check (item_kind in ('message_template', 'followup_flow', 'org_memory', 'agent_draft')),
  item_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, item_kind, item_id)
);
create index if not exists organization_template_items_org_template_idx
  on public.organization_template_items (organization_id, template_id);
alter table public.organization_template_items enable row level security;
drop policy if exists tenant_isolation_organization_template_items_all on public.organization_template_items;
create policy tenant_isolation_organization_template_items_all on public.organization_template_items
  for all using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())
  with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
revoke all on public.organization_template_items from anon, authenticated;
grant all on public.organization_template_items to service_role;

-- Mantém o corpo aplicado da 0233 como subrotina. Não se edita migration já
-- aplicada: o nome novo permite que esta forward-fix a chame sem recursão.
do $$ begin
  if to_regprocedure('public.fn_aplicar_template_de_organizacao_0233(uuid,uuid,jsonb)') is null
     and to_regprocedure('public.fn_aplicar_template_de_organizacao(uuid,uuid,jsonb)') is not null then
    alter function public.fn_aplicar_template_de_organizacao(uuid,uuid,jsonb)
      rename to fn_aplicar_template_de_organizacao_0233;
  end if;
end $$;

-- O corpo herdado é corrigido sem reescrever a migration 0233 já aplicada.
-- `webhook_sources.default_stage_id` pode apontar para etapa de outra org em
-- dado legado; sem este predicado, esse dado alheio bloqueava a troca de A.
do $$
declare definicao text;
begin
  select pg_get_functiondef('public.fn_aplicar_template_de_organizacao_0233(uuid,uuid,jsonb)'::regprocedure)
    into definicao;
  if definicao is not null then
    definicao := replace(
      definicao,
      E'where s.pipeline_id = v_pipeline_id\n     and s.organization_id = p_organization_id;',
      E'where w.organization_id = p_organization_id\n     and s.pipeline_id = v_pipeline_id\n     and s.organization_id = p_organization_id;'
    );
    execute definicao;
  end if;
end $$;

create or replace function public.fn_aplicar_template_de_organizacao(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_antes jsonb;
  v_resultado jsonb;
  v_anterior text;
  v_respostas_preservadas bigint := 0;
  v_cadencias_preservadas bigint := 0;
  v_regras_preservadas boolean := false;
  v_atendente_preservado boolean := false;
  v_estado_hibrido boolean := false;
  v_agente public.ai_agents%rowtype;
  v_publicada public.ai_agent_versions%rowtype;
  v_nova_versao uuid;
  v_memoria_antes uuid;
begin
  -- Serializa o par limpar/aplicar por organização. Sem isto dois POSTs podem
  -- ambos concluir que o item não existe e produzir recibos contraditórios.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  select settings->'template_aplicado'->>'id', settings into v_anterior, v_antes
    from public.organizations where id = p_organization_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_nao_encontrada');
  end if;
  select version_id into v_memoria_antes from public.org_memory_pointers
    where organization_id = p_organization_id;

  -- Uma aplicação anterior à 0235 não tem procedência recuperável. Não fingimos
  -- saber o que foi humano: preservamos e expomos o estado híbrido na resposta.
  if v_anterior is not null and v_anterior <> p_payload->>'template_id'
     and not exists (select 1 from public.organization_template_items where organization_id=p_organization_id and template_id=v_anterior) then
    v_estado_hibrido := true;
  end if;

  if v_anterior is distinct from p_payload->>'template_id' then
    -- Resposta/cadência só saem se continuam iguais ao snapshot de origem.
    with candidatos as (
      select i.item_id, i.snapshot from public.organization_template_items i
       where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='message_template'
    ), apagados as (
      delete from public.message_templates m using candidatos c
       where m.id=c.item_id and m.organization_id=p_organization_id
         and jsonb_build_object('title',m.title,'body',m.body,'shortcut',m.shortcut)=c.snapshot
       returning m.id
    ) delete from public.organization_template_items i using apagados a
       where i.organization_id=p_organization_id and i.item_kind='message_template' and i.item_id=a.id;
    select count(*) into v_respostas_preservadas from public.organization_template_items i
      join public.message_templates m on m.id=i.item_id and m.organization_id=p_organization_id
     where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='message_template';

    with candidatos as (
      select i.item_id, i.snapshot from public.organization_template_items i
       where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='followup_flow'
    ), apagados as (
      delete from public.followup_flow_pointers f using candidatos c
       where f.id=c.item_id and f.organization_id=p_organization_id and f.status='draft' and f.active_version_id is null
         and jsonb_build_object('name',f.name,'draft_graph',f.draft_graph,'handoff_policy',f.handoff_policy,'trigger_config',f.trigger_config)=c.snapshot
       returning f.id
    ) delete from public.organization_template_items i using apagados a
       where i.organization_id=p_organization_id and i.item_kind='followup_flow' and i.item_id=a.id;
    select count(*) into v_cadencias_preservadas from public.organization_template_items i
      join public.followup_flow_pointers f on f.id=i.item_id and f.organization_id=p_organization_id
     where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='followup_flow';

    -- Memória é imutável: ponteiro diferente significa que alguém a revisou.
    if exists (select 1 from public.organization_template_items where organization_id=p_organization_id and template_id=v_anterior and item_kind='org_memory') then
      if exists (select 1 from public.organization_template_items i join public.org_memory_pointers p on p.organization_id=i.organization_id and p.version_id=i.item_id where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='org_memory') then
        delete from public.org_memory_pointers p using public.organization_template_items i where p.organization_id=i.organization_id and p.version_id=i.item_id and i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='org_memory';
        delete from public.org_memory_versions v using public.organization_template_items i where v.id=i.item_id and i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='org_memory';
        delete from public.organization_template_items where organization_id=p_organization_id and template_id=v_anterior and item_kind='org_memory';
      else v_regras_preservadas := true; end if;
    end if;
    delete from public.ai_agent_versions v using public.organization_template_items i
     where v.id=i.item_id and v.organization_id=p_organization_id and v.status='draft'
       and jsonb_build_object('system_prompt',v.system_prompt)=i.snapshot
       and i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='agent_draft';
    delete from public.organization_template_items i
     where i.organization_id=p_organization_id and i.template_id=v_anterior and i.item_kind='agent_draft'
       and not exists (select 1 from public.ai_agent_versions v where v.id=i.item_id);
  end if;

  -- A 0233 continua sendo a única dona da troca transacional do funil. Guardamos
  -- o prompt legado para desfazer a escrita dela: o artefato editável é versão,
  -- não ai_agents.system_prompt.
  select * into v_agente from public.ai_agents where organization_id=p_organization_id and is_default for update;
  v_resultado := public.fn_aplicar_template_de_organizacao_0233(p_organization_id, p_actor, p_payload);
  if not coalesce((v_resultado->>'ok')::boolean, false) then return v_resultado; end if;

  -- Esta referência é instalada abaixo antes de substituir a função na primeira
  -- aplicação. Em bancos atualizados, ela preserva a implementação da 0233.
  if v_agente.id is not null then
    update public.ai_agents set system_prompt=v_agente.system_prompt, name=v_agente.name, updated_at=now() where id=v_agente.id and organization_id=p_organization_id;
    select * into v_publicada from public.ai_agent_versions where id=v_agente.published_version_id and organization_id=p_organization_id for share;
    if v_publicada.id is null then
      v_atendente_preservado := true;
    elsif exists (select 1 from public.ai_agent_versions v where v.organization_id=p_organization_id and v.agent_id=v_agente.id and v.status='draft') then
      v_atendente_preservado := true;
    else
      insert into public.ai_agent_versions
      select (jsonb_populate_record(null::public.ai_agent_versions,
        to_jsonb(v_publicada) || jsonb_build_object('id',gen_random_uuid(),'version_number',(select coalesce(max(version_number),0)+1 from public.ai_agent_versions where agent_id=v_agente.id),'system_prompt',p_payload->'atendente'->>'instrucoes','status','draft','published_at',null,'superseded_at',null,'created_at',now(),'created_by',p_actor))).*
      returning id into v_nova_versao;
      insert into public.organization_template_items(organization_id,template_id,item_kind,item_id,snapshot)
      values(p_organization_id,p_payload->>'template_id','agent_draft',v_nova_versao,jsonb_build_object('system_prompt',p_payload->'atendente'->>'instrucoes')) on conflict do nothing;
    end if;
  end if;

  -- Marca só o que nasceu nesta aplicação: títulos/nomes que já existiam nunca
  -- ganham proveniência retroativa e por isso jamais são apagados pela troca.
  insert into public.organization_template_items(organization_id,template_id,item_kind,item_id,snapshot)
  select p_organization_id,p_payload->>'template_id','message_template',m.id,jsonb_build_object('title',m.title,'body',m.body,'shortcut',m.shortcut)
    from public.message_templates m where m.organization_id=p_organization_id and m.created_by_user_id=p_actor and m.created_at >= now()-interval '1 minute'
  on conflict do nothing;
  insert into public.organization_template_items(organization_id,template_id,item_kind,item_id,snapshot)
  select p_organization_id,p_payload->>'template_id','followup_flow',f.id,jsonb_build_object('name',f.name,'draft_graph',f.draft_graph,'handoff_policy',f.handoff_policy,'trigger_config',f.trigger_config)
    from public.followup_flow_pointers f where f.organization_id=p_organization_id and f.created_at >= now()-interval '1 minute'
  on conflict do nothing;
  insert into public.organization_template_items(organization_id,template_id,item_kind,item_id,snapshot)
  select p_organization_id,p_payload->>'template_id','org_memory',p.version_id,jsonb_build_object('content',v.content)
    from public.org_memory_pointers p join public.org_memory_versions v on v.id=p.version_id
   where p.organization_id=p_organization_id and v_memoria_antes is null
  on conflict do nothing;

  return v_resultado || jsonb_build_object('respostas_preservadas',v_respostas_preservadas,'cadencias_preservadas',v_cadencias_preservadas,'regras_da_casa_preservadas',v_regras_preservadas,'atendente_preservado',v_atendente_preservado,'estado_hibrido',v_estado_hibrido,'atendente_aplicado',v_nova_versao is not null);
end $$;
