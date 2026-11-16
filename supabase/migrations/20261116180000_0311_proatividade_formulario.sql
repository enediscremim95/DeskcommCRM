-- Sem backfill nem envio: configuração ausente significa desligado em TODA org.
create table if not exists public.form_proactivity_attempts (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 lead_id uuid not null references public.crm_leads(id) on delete cascade,
 phase text not null check (phase in ('whatsapp','whatsapp_corrigido','email')),
 outcome text not null default 'started' check (outcome in ('started','sent','failed','uncertain')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key (organization_id,lead_id,phase)
);
alter table public.form_proactivity_attempts enable row level security;
drop policy if exists tenant_isolation_form_proactivity_attempts_all on public.form_proactivity_attempts;
create policy tenant_isolation_form_proactivity_attempts_all on public.form_proactivity_attempts
 for select to authenticated using (organization_id in (select public.fn_user_org_ids()));
revoke all on public.form_proactivity_attempts from public, anon, authenticated;
grant select on public.form_proactivity_attempts to authenticated;
grant select,insert,update on public.form_proactivity_attempts to service_role;
notify pgrst,'reload schema';

create or replace function public.fn_form_proactivity_log() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_leads where id=new.lead_id and organization_id=new.organization_id) then
  raise exception using errcode='42501',message='proactivity_scope_mismatch';
 end if;
 if tg_op='INSERT' or new.outcome is distinct from old.outcome then
  insert into public.crm_lead_activities(organization_id,lead_id,type,source_module,source_id,actor_kind,reason,payload)
  values(new.organization_id,new.lead_id,'note','form_proactivity',new.lead_id,'system',
    'Primeiro contato do formulário: '||new.phase||' — '||new.outcome,
    jsonb_build_object('phase',new.phase,'outcome',new.outcome));
 end if;
 return new;
end $$;
revoke execute on function public.fn_form_proactivity_log() from public,anon,authenticated;
drop trigger if exists form_proactivity_log on public.form_proactivity_attempts;
create trigger form_proactivity_log after insert or update on public.form_proactivity_attempts
 for each row execute function public.fn_form_proactivity_log();

create or replace function public.fn_form_proactivity_attention(p_org uuid,p_lead uuid,p_tag text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.crm_leads set tags=array(select distinct x from unnest(tags||array[p_tag]) x)
 where organization_id=p_org and id=p_lead and status='open';
end $$;
revoke execute on function public.fn_form_proactivity_attention(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_form_proactivity_attention(uuid,uuid,text) to service_role;
