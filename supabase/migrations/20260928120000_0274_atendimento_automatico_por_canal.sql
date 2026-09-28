-- Atendimento automático é uma autorização explícita por número.
--
-- Decisão de migração: canais que já existem podem estar atendendo clientes em
-- produção e, por isso, são marcados como ligados SOMENTE quando a coluna nasce.
-- Canais criados depois desta migration usam o DEFAULT false e nunca começam a
-- responder por consequência da conexão. A guarda também impede que reaplicar o
-- baseline religue um canal que uma pessoa desligou deliberadamente.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'channel_sessions'
       and column_name = 'automatic_attendance_enabled'
  ) then
    alter table public.channel_sessions
      add column automatic_attendance_enabled boolean;

    update public.channel_sessions
       set automatic_attendance_enabled = true;

    alter table public.channel_sessions
      alter column automatic_attendance_enabled set default false,
      alter column automatic_attendance_enabled set not null;
  end if;
end
$$;

comment on column public.channel_sessions.automatic_attendance_enabled is
  'Chave mestra por canal. false mantém a ingestão, conversa, contato e lead, mas impede respostas automáticas. Canais anteriores à migration foram preservados ligados; novos canais nascem desligados.';

notify pgrst, 'reload schema';
