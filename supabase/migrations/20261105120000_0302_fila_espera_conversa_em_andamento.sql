-- 0302: a fila da primeira mensagem pode esperar o atendimento humano do canal.
--
-- NULL ou zero preservam integralmente o comportamento anterior. A coluna vive
-- no knob do próprio canal e herda a RLS e os grants já existentes da tabela.
alter table public.channel_knobs
  add column if not exists first_message_queue_busy_minutes smallint;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channel_knobs_first_message_queue_busy_minutes_check'
      and conrelid = 'public.channel_knobs'::regclass
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_first_message_queue_busy_minutes_check
      check (
        first_message_queue_busy_minutes is null
        or first_message_queue_busy_minutes between 0 and 60
      );
  end if;
end $$;

comment on column public.channel_knobs.first_message_queue_busy_minutes is
  'Minutos sem saída humana em outra conversa do canal antes de liberar a primeira mensagem; NULL ou zero desliga.';

notify pgrst, 'reload schema';
