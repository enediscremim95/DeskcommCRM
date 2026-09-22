-- Momento exato em que o lead entrou na etapa atual.
--
-- O trigger centraliza a regra no banco para que arrasto, ficha, lote,
-- handoff, agendamento e agente atualizem o relógio pelo mesmo caminho.

alter table public.crm_leads
  add column if not exists stage_entered_at timestamptz;

update public.crm_leads l
   set stage_entered_at = coalesce(
     (
       select max(a.performed_at)
         from public.crm_lead_activities a
        where a.organization_id = l.organization_id
          and a.lead_id = l.id
          and a.type = 'stage_changed'
     ),
     l.created_at
   )
 where l.stage_entered_at is null;

alter table public.crm_leads
  alter column stage_entered_at set default now(),
  alter column stage_entered_at set not null;

create or replace function public.fn_set_lead_stage_entered_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, new.created_at, now());
  elsif new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_set_lead_stage_entered_at()
  from public, anon;
grant execute on function public.fn_set_lead_stage_entered_at()
  to authenticated, service_role;

drop trigger if exists trg_crm_leads_stage_entered_at on public.crm_leads;
create trigger trg_crm_leads_stage_entered_at
  before insert or update of stage_id on public.crm_leads
  for each row execute function public.fn_set_lead_stage_entered_at();

comment on column public.crm_leads.stage_entered_at is
  'Instante em que o lead entrou na etapa atual; atualizado pelo trigger de stage_id.';
