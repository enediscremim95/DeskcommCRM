-- Origem explícita para aplicar opt-in sem alterar follow-ups agendados existentes.
alter table public.followup_enrollments add column if not exists automatic_silence boolean not null default false;
