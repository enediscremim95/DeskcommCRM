-- 0233: aplicar um template de organização, numa transação só
--
-- ═══ O PROBLEMA ═══
--
-- Organização nasce com o funil de e-commerce do
-- `trg_seed_default_pipeline_for_org`, um agente genérico, zero resposta pronta
-- e zero cadência. Quem entrega o CRM a cliente como parte de um serviço monta
-- isso à mão, cliente por cliente, e na vigésima vez monta diferente da
-- primeira.
--
-- Esta função aplica uma configuração DECLARADA (ver
-- `lib/templates/organizacao/`) sobre uma organização existente.
--
-- ═══ POR QUE NO BANCO, E NÃO EM OITO CHAMADAS DO CLIENTE ═══
--
-- São escritas em seis tabelas: `crm_pipelines`, `crm_stages`,
-- `message_templates`, `followup_flow_pointers`, `ai_agents` e
-- `organizations`. O cliente JS não tem transação. Pelo cliente, a quarta
-- falhar deixaria a organização com o funil trocado, as respostas prontas pela
-- metade e nenhuma cadência — um estado que ninguém consegue nomear depois, e
-- que o segundo clique pioraria em vez de consertar.
--
-- A troca das etapas tem um agravante próprio, o mesmo da 0156: é DELETE
-- seguido de INSERT, e `uniq_crm_stages_pipeline_won`,
-- `uniq_crm_stages_pipeline_hint` e `uniq_crm_stages_pipeline_slug` são
-- imediatos. Qualquer estado intermediário com as duas gerações no mesmo funil
-- é recusado pelo banco.
--
-- ═══ O QUE ESTA FUNÇÃO NÃO TOCA, E ISSO É O PONTO ═══
--
-- Não lê NENHUMA outra organização. O único `organization_id` que aparece é o
-- `p_organization_id` que entrou, em TODA cláusula `where` de leitura e em TODA
-- linha inserida. Um template não é cópia de cliente: o conteúdo vem do
-- `p_payload`, que vem de arquivo versionado em código, não de `select`.
--
-- Por consequência — e não por lista de exclusão mantida à mão — nada de
-- contato, negócio, conversa, mensagem, tarefa, compromisso, credencial de IA,
-- sessão de WhatsApp, webhook, catálogo, base de conhecimento, histórico ou
-- auditoria atravessa daqui. Não há `insert` nessas tabelas nesta função, e uma
-- tabela nova no produto não passa a atravessar sozinha, porque não existe
-- "copie o resto".
--
-- ═══ IDEMPOTÊNCIA ═══
--
-- Aplicar duas vezes o mesmo template tem que ser inofensivo: quem clica em
-- "aplicar" e não vê a tela responder clica de novo.
--
--   · etapas do funil  — DELETE + INSERT, converge no mesmo conjunto
--   · settings e vocabulário — UPDATE, convergem
--   · respostas prontas — inseridas só se não existe uma com o mesmo título na
--     organização. `message_templates` não tem unique em (org, title), então é
--     `where not exists` e não `on conflict`
--   · cadências — `on conflict (organization_id, name) do nothing`. NÃO
--     sobrescreve o rascunho: se alguém já editou a cadência, o segundo clique
--     apagaria o trabalho dela
--   · atendente — UPDATE do prompt do agente padrão, converge
--
-- ═══ AS RECUSAS, E POR QUE ELAS VOLTAM COMO jsonb ═══
--
-- São estados NORMAIS do produto, não erros: a tela precisa explicá-las em
-- português a um operador, e `raise exception` vira string opaca do lado do
-- cliente. Mesma decisão da 0156.
--
-- (1) FUNIL COM NEGÓCIO. `crm_leads_stage_id_fkey` é ON DELETE RESTRICT.
--     Recusar antes devolve um motivo; deixar o Postgres recusar devolve um
--     código de erro numa tela de operação.
--
-- (2) ETAPA USADA POR FONTE DE WEBHOOK. Esta é a silenciosa:
--     `webhook_sources.default_stage_id` referencia `crm_stages` com ON DELETE
--     **CASCADE**. O DELETE não falha — ele APAGA A FONTE INTEIRA, em silêncio,
--     e as integrações que mandavam lead para ela param sem nada ficar
--     vermelho.
--
-- ═══ POR QUE O ATENDENTE FICA EM RASCUNHO, E A CADÊNCIA DESLIGADA ═══
--
-- A função grava `ai_agents.system_prompt` e NÃO mexe em
-- `published_version_id`. O runtime usa a versão publicada; o prompt do
-- template entra como o texto que o dono vai ler, ajustar e publicar. Publicar
-- aqui poria no ar, falando com cliente final, um texto que ninguém da empresa
-- leu.
--
-- As cadências entram com `status = 'draft'` e sem `active_version_id` pela
-- mesma razão, mais grave: cadência ativa num tenant recém-criado começa a
-- mandar WhatsApp em nome de um cliente que ainda não viu a mensagem.

create or replace function public.fn_aplicar_template_de_organizacao(
  p_organization_id uuid,
  p_actor uuid,
  p_payload jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_pipeline_id uuid;
  v_negocios bigint;
  v_fontes bigint;
  v_etapas bigint;
  v_respostas bigint := 0;
  v_cadencias bigint := 0;
  v_agente_id uuid;
  v_atendente_aplicado boolean := false;
  v_vocabulario jsonb;
  v_tags jsonb;
begin
  -- Quem aplica template é a operação da plataforma, e a checagem fica AQUI
  -- além de na rota — mesma decisão de `fn_create_tenant_with_owner`. A função é
  -- `security definer` e passa por cima da RLS: uma permissão conferida só na
  -- camada HTTP deixa a porta aberta para qualquer chamada futura que esqueça de
  -- conferir.
  if not exists (
    select 1 from public.platform_admins
     where user_id = p_actor and revoked_at is null and scope = 'full'
  ) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  -- A organização existe e não está redigida? Aplicar template numa organização
  -- anonimizada reintroduziria configuração num tenant que foi apagado por
  -- pedido de LGPD.
  perform 1 from public.organizations
   where id = p_organization_id and redacted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_nao_encontrada');
  end if;

  -- ── o funil ───────────────────────────────────────────────────────────────
  select id into v_pipeline_id
    from public.crm_pipelines
   where organization_id = p_organization_id
     and is_default
     and not is_archived
   limit 1;

  if v_pipeline_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'funil_nao_encontrado');
  end if;

  select count(*) into v_negocios
    from public.crm_leads
   where pipeline_id = v_pipeline_id
     and organization_id = p_organization_id;

  if v_negocios > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'funil_com_negocios', 'quantos', v_negocios);
  end if;

  -- ON DELETE CASCADE: sem esta recusa, trocar as colunas apaga a fonte inteira.
  select count(*) into v_fontes
    from public.webhook_sources w
    join public.crm_stages s on s.id = w.default_stage_id
   where s.pipeline_id = v_pipeline_id
     and s.organization_id = p_organization_id;

  if v_fontes > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'etapa_em_uso_por_webhook', 'quantos', v_fontes);
  end if;

  delete from public.crm_stages
   where pipeline_id = v_pipeline_id
     and organization_id = p_organization_id;

  insert into public.crm_stages
    (organization_id, pipeline_id, name, slug, position, is_won, is_lost, agent_stage_hint)
  select p_organization_id,
         v_pipeline_id,
         e->>'nome',
         e->>'slug',
         (e->>'position')::numeric,
         coalesce((e->>'is_won')::boolean, false),
         coalesce((e->>'is_lost')::boolean, false),
         nullif(e->>'agent_stage_hint', '')
    from jsonb_array_elements(p_payload->'funil'->'etapas') as e;
  get diagnostics v_etapas = row_count;

  -- O slug do funil pode colidir com outro funil da organização
  -- (`uniq_crm_pipelines_org_slug`). Quem chamou já resolveu isso lendo os
  -- slugs em uso; aqui só se grava o que veio.
  v_vocabulario := coalesce(p_payload->'vocabulario_do_funil', '{}'::jsonb);

  update public.crm_pipelines
     set name = p_payload->'funil'->>'nome',
         slug = p_payload->'funil'->>'slug',
         -- Merge, não substituição: o vocabulário do template cobre quatro
         -- chaves, e trocar o objeto inteiro apagaria qualquer outra que o
         -- produto venha a ter.
         vocabulary = coalesce(vocabulary, '{}'::jsonb) || v_vocabulario,
         settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object(
                         'fields', coalesce(p_payload->'settings_do_funil'->'fields', '[]'::jsonb),
                         'lost_reasons', coalesce(p_payload->'settings_do_funil'->'lost_reasons', '[]'::jsonb)
                       ),
         updated_at = now()
   where id = v_pipeline_id
     and organization_id = p_organization_id;

  -- ── as tags de conversa ───────────────────────────────────────────────────
  -- Vivem em `organizations.settings.canonical_conversation_tags` (org-scoped,
  -- não pipeline-scoped — spec 13 §3.3). São SUGESTÕES do inbox; não marcam
  -- nenhuma conversa nem leem nenhuma.
  v_tags := coalesce(p_payload->'tags_de_conversa', '[]'::jsonb);
  if jsonb_array_length(v_tags) > 0 then
    update public.organizations
       set settings = coalesce(settings, '{}'::jsonb)
                      || jsonb_build_object('canonical_conversation_tags', v_tags),
           updated_at = now()
     where id = p_organization_id;
  end if;

  -- ── as respostas prontas ──────────────────────────────────────────────────
  -- `owner_user_id` fica NULL: a resposta é da EQUIPE, não de uma pessoa. Com
  -- dono, só quem aplicou o template veria os textos.
  insert into public.message_templates
    (organization_id, owner_user_id, title, body, shortcut, created_by_user_id)
  select p_organization_id,
         null,
         r->>'titulo',
         r->>'corpo',
         nullif(r->>'atalho', ''),
         p_actor
    from jsonb_array_elements(coalesce(p_payload->'respostas_rapidas', '[]'::jsonb)) as r
   where not exists (
     select 1 from public.message_templates m
      where m.organization_id = p_organization_id
        and m.title = r->>'titulo'
   );
  get diagnostics v_respostas = row_count;

  -- ── as cadências, desligadas ──────────────────────────────────────────────
  -- `status = 'draft'`, `active_version_id` nulo, nenhuma linha em
  -- `followup_flow_versions`: o motor só enxerga versão ativa, então o que entra
  -- aqui é desenho na tela e mais nada. `trigger_config` fica manual para que
  -- nem um publish distraído comece a disparar por evento.
  insert into public.followup_flow_pointers
    (organization_id, name, status, draft_graph, handoff_policy, trigger_config)
  select p_organization_id,
         c->>'nome',
         'draft',
         c->'graph',
         'pause',
         jsonb_build_object('kind', 'manual')
    from jsonb_array_elements(coalesce(p_payload->'cadencias', '[]'::jsonb)) as c
  on conflict (organization_id, name) do nothing;
  get diagnostics v_cadencias = row_count;

  -- ── o atendente, em rascunho ──────────────────────────────────────────────
  -- `ai_agents_one_default_per_org` é índice único parcial em (organization_id)
  -- where is_default, então "o default desta org" é uma linha ou nenhuma.
  -- `published_version_id` NÃO é tocado de propósito: ver o cabeçalho.
  update public.ai_agents
     set name = p_payload->'atendente'->>'nome',
         system_prompt = p_payload->'atendente'->>'instrucoes',
         updated_at = now()
   where organization_id = p_organization_id
     and is_default
   returning id into v_agente_id;

  if v_agente_id is not null then
    v_atendente_aplicado := true;
  end if;

  -- As regras da casa valem para QUALQUER agente da organização, então vão para
  -- a memória da org — o mesmo lugar que a tela de Memória edita — e não para o
  -- prompt deste agente. No prompt, a segunda contratação nasceria sem elas.
  --
  -- Só escreve se a organização ainda não tem memória: sobrescrever apagaria
  -- regras que alguém da casa escreveu.
  if coalesce(p_payload->'atendente'->>'regras_da_casa', '') <> ''
     and not exists (
       select 1 from public.org_memory_pointers
        where organization_id = p_organization_id
     ) then
    with nova as (
      insert into public.org_memory_versions
        (organization_id, content, version_number, created_by)
      values (p_organization_id, p_payload->'atendente'->>'regras_da_casa', 1, p_actor)
      returning id
    )
    insert into public.org_memory_pointers (organization_id, version_id)
    select p_organization_id, id from nova
    on conflict (organization_id) do nothing;
  end if;

  -- ── o recibo ──────────────────────────────────────────────────────────────
  -- Qual template entrou e quando, na própria organização. Sem isto, descobrir
  -- por que um tenant tem "Visitando imóveis" no funil exigiria ler o audit log
  -- inteiro — e o audit log tem retenção, a organização não.
  update public.organizations
     set settings = coalesce(settings, '{}'::jsonb)
                    || jsonb_build_object(
                         'template_aplicado',
                         jsonb_build_object(
                           'id', p_payload->>'template_id',
                           'aplicado_em', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                           'aplicado_por', p_actor
                         )
                       ),
         updated_at = now()
   where id = p_organization_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', p_payload->>'template_id',
    'etapas', v_etapas,
    'respostas_criadas', v_respostas,
    'cadencias_criadas', v_cadencias,
    'atendente_aplicado', v_atendente_aplicado
  );
end;
$$;

comment on function public.fn_aplicar_template_de_organizacao(uuid, uuid, jsonb) is
  'Aplica um template declarado em lib/templates/organizacao/ sobre uma organização: funil, etapas, vocabulário, campos, motivos de perda, tags, respostas prontas, prompt do atendente (em rascunho) e cadências (desligadas). Transacional e idempotente. Lê e escreve SOMENTE a organização recebida — nunca copia dado de outra.';

-- `security definer` passa por cima da RLS, então a função é chamada apenas pela
-- rota de platform admin. `anon` e `authenticated` não recebem execute: sem
-- isto, qualquer usuário logado poderia trocar o funil da própria organização
-- por fora das permissões da tela.
revoke all on function public.fn_aplicar_template_de_organizacao(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_aplicar_template_de_organizacao(uuid, uuid, jsonb)
  to service_role;
