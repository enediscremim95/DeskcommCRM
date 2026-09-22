-- Nota humana do negócio, independente do score calculado pela IA.
-- Nullable preserva leads ainda não avaliados; o CHECK fecha o vocabulário.
alter table public.crm_leads
  add column if not exists qualification smallint;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_leads_qualification_check'
       and conrelid = 'public.crm_leads'::regclass
  ) then
    alter table public.crm_leads
      add constraint crm_leads_qualification_check
      check (qualification between 1 and 5);
  end if;
end $$;

comment on column public.crm_leads.qualification is
  'Nota humana de qualificação de 1 a 5, independente do score da IA.';
