-- Guarda o resumo e a identidade do prefixo coberto no checkpoint da conversa.
-- Checkpoints anteriores continuam válidos com NULL e o histórico original permanece no CRM.
alter table public.lead_checkpoints
  add column if not exists compaction_state jsonb;

comment on column public.lead_checkpoints.compaction_state is
  'Estado do resumo incremental do histórico: conversa, prefixo coberto e resumo. NULL sem compactação.';

-- A anonimização explícita já remove os dados identificáveis do contato.
-- Limpa também o novo derivado, mantendo as linhas e demais campos do checkpoint.
create or replace function public.fn_redigir_compactacao_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.lead_checkpoints
     set compaction_state = null
   where organization_id = new.organization_id
     and contact_id = new.id
     and compaction_state is not null;
  return new;
end;
$$;

revoke execute on function public.fn_redigir_compactacao_do_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_redigir_compactacao_do_contato_anonimizado() to service_role;

drop trigger if exists trg_redigir_compactacao_ao_anonimizar on public.contacts;
create trigger trg_redigir_compactacao_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_compactacao_do_contato_anonimizado();
