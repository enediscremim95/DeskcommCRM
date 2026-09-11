-- 0236: proveniência de template é leitura administrativa; escrita é só do
-- servidor. Também preserva o rascunho inicial do agente que ainda não possui
-- versão publicada, sem transformar esse prompt em publicação.

-- A tabela não é uma porta de edição do navegador. Um admin do tenant pode
-- inspecionar a origem para entender a troca; inserts/updates/deletes só
-- acontecem pela função SECURITY DEFINER chamada pela rota de plataforma.
drop policy if exists tenant_isolation_organization_template_items_all on public.organization_template_items;
drop policy if exists organization_template_items_admin_select on public.organization_template_items;
create policy organization_template_items_admin_select on public.organization_template_items
  for select using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
    )
  );
revoke all on public.organization_template_items from anon, authenticated;
grant select on public.organization_template_items to authenticated;
grant all on public.organization_template_items to service_role;

-- A 0235 restaurava o prompt legado sempre que o agente não tinha versão
-- publicada. Nesse estado o agente não é executável, portanto o próprio campo
-- do agente é o rascunho seguro que a 0233 já expunha. Não sobrescrevemos um
-- draft de versão que alguém já tenha criado manualmente.
do $$ begin
  if to_regprocedure('public.fn_aplicar_template_de_organizacao_0235(uuid,uuid,jsonb)') is null
     and to_regprocedure('public.fn_aplicar_template_de_organizacao(uuid,uuid,jsonb)') is not null then
    alter function public.fn_aplicar_template_de_organizacao(uuid,uuid,jsonb)
      rename to fn_aplicar_template_de_organizacao_0235;
  end if;
end $$;

create or replace function public.fn_aplicar_template_de_organizacao(
  p_organization_id uuid, p_actor uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_agente public.ai_agents%rowtype;
  v_ja_tem_rascunho boolean := false;
  v_resultado jsonb;
begin
  select * into v_agente
    from public.ai_agents
   where organization_id = p_organization_id and is_default
   for update;

  if v_agente.id is not null then
    select exists(
      select 1 from public.ai_agent_versions
       where organization_id = p_organization_id
         and agent_id = v_agente.id
         and status = 'draft'
    ) into v_ja_tem_rascunho;
  end if;

  v_resultado := public.fn_aplicar_template_de_organizacao_0235(
    p_organization_id, p_actor, p_payload
  );
  if not coalesce((v_resultado->>'ok')::boolean, false) then
    return v_resultado;
  end if;

  if v_agente.id is not null
     and v_agente.published_version_id is null
     and not v_ja_tem_rascunho then
    update public.ai_agents
       set name = p_payload->'atendente'->>'nome',
           system_prompt = p_payload->'atendente'->>'instrucoes',
           updated_at = now()
     where id = v_agente.id and organization_id = p_organization_id;

    return v_resultado || jsonb_build_object(
      'atendente_aplicado', true,
      'atendente_preservado', false
    );
  end if;

  return v_resultado;
end $$;

revoke all on function public.fn_aplicar_template_de_organizacao(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_aplicar_template_de_organizacao(uuid, uuid, jsonb)
  to service_role;
