-- O código agrupável continua em lost_reason. O texto livre de "Outro motivo"
-- ganha coluna própria para não ser validado como se fosse uma categoria.
-- Não há backfill: valores livres já aceitos por configurações de funil ficam
-- intactos em lost_reason e continuam legíveis.
alter table public.crm_leads
  add column if not exists lost_reason_detail text;

do $lost_reason_detail$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'crm_leads_lost_reason_detail_length'
       and conrelid = 'public.crm_leads'::regclass
  ) then
    alter table public.crm_leads
      add constraint crm_leads_lost_reason_detail_length
      check (lost_reason_detail is null or char_length(lost_reason_detail) <= 500);
  end if;
end
$lost_reason_detail$;

comment on column public.crm_leads.lost_reason_detail is
  'Texto livre opcional de lost_reason=other. Leitura complementar; relatórios agrupam por lost_reason.';

notify pgrst, 'reload schema';
