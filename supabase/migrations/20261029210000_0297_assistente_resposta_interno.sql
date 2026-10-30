-- O assistente interno de resposta é um segundo agente deliberado: ele prepara
-- texto sob clique humano mesmo quando a conversa já tem um agente operacional.
-- A exceção fica dentro do snapshot atômico e exige as quatro travas. Nenhum
-- outro agente pode atravessar a propriedade ativa da conversa.
create or replace function public.fn_reply_begin(
  p_org uuid,
  p_conversation uuid,
  p_agent uuid,
  p_version uuid,
  p_token uuid
)
returns public.ai_reply_drafts
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.conversations;
  a public.ai_agents;
  d public.ai_reply_drafts;
  contact uuid;
  b jsonb;
  assistente_interno boolean;
begin
  select contact_id into contact
  from public.conversations
  where organization_id=p_org and id=p_conversation;

  if contact is null then
    raise exception 'reply_context_unavailable' using errcode='42501';
  end if;

  perform public.fn_service_lock(p_org,contact);

  select * into a
  from public.ai_agents
  where organization_id=p_org and id=p_agent and archived_at is null
  for share;

  if not found or a.published_version_id is distinct from p_version then
    raise exception 'reply_agent_stale' using errcode='40001';
  end if;

  assistente_interno :=
    a.operation_mode='assisted'
    and a.paused_at is not null
    and not a.is_active
    and a.config @> '{"reply_assistant":{"managed":true,"enabled":true}}'::jsonb;

  select * into c
  from public.conversations
  where organization_id=p_org and id=p_conversation and contact_id=contact
  for no key update;

  if c.active_ai_agent_id is not null
     and c.active_ai_agent_id<>p_agent
     and not assistente_interno then
    raise exception 'reply_agent_stale' using errcode='40001';
  end if;

  b:=public.fn_service_boundary(p_org,p_conversation)
     -'status'-'demanda_fechada_em'-'service_started_at';

  if not public.fn_meet_boundary_current(b)
     or exists(
       select 1 from public.contacts
       where organization_id=p_org and id=contact and (is_blocked or is_anonymized)
     ) then
    raise exception 'reply_context_unavailable' using errcode='42501';
  end if;

  insert into public.ai_reply_drafts(
    organization_id,conversation_id,contact_id,agent_id,agent_version_id,
    channel_session_id,service_boundary,context_revision,operation_revision,generation_token
  )
  values(
    p_org,p_conversation,contact,p_agent,p_version,c.channel_session_id,b,
    c.reply_context_revision,a.operation_revision,p_token
  )
  on conflict(organization_id,conversation_id,agent_id,context_revision,operation_revision)
  do update set
    generation_token=case
      when ai_reply_drafts.status='failed'
        or (ai_reply_drafts.status='generating'
            and ai_reply_drafts.updated_at<now()-interval '10 minutes')
      then p_token else ai_reply_drafts.generation_token end,
    status=case
      when ai_reply_drafts.status='failed'
        or (ai_reply_drafts.status='generating'
            and ai_reply_drafts.updated_at<now()-interval '10 minutes')
      then 'generating' else ai_reply_drafts.status end,
    revision=ai_reply_drafts.revision+case
      when ai_reply_drafts.status='failed'
        or (ai_reply_drafts.status='generating'
            and ai_reply_drafts.updated_at<now()-interval '10 minutes')
      then 1 else 0 end,
    updated_at=now()
  returning * into d;

  return d;
end;
$$;

revoke all on function public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)
  to service_role;
