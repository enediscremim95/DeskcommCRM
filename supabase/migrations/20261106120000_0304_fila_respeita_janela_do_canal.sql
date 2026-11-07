-- 0304: a fila da primeira mensagem respeita a física do canal.
--
-- Canais sem janela oficial podem aguardar de 1 a 168 horas. NULL preserva o
-- padrão efetivo de 72 horas definido no worker. A coluna herda a RLS e os
-- privilégios existentes de channel_knobs, sem criar tabela ou função.
alter table public.channel_knobs
  add column if not exists first_message_queue_max_wait_hours smallint;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channel_knobs_first_message_queue_max_wait_hours_check'
      and conrelid = 'public.channel_knobs'::regclass
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_first_message_queue_max_wait_hours_check
      check (
        first_message_queue_max_wait_hours is null
        or first_message_queue_max_wait_hours between 1 and 168
      );
  end if;
end
$constraint$;

comment on column public.channel_knobs.first_message_queue_max_wait_hours is
  'Espera máxima da primeira mensagem em canal sem janela oficial; NULL usa 72 horas, entre 1 e 168.';

notify pgrst, 'reload schema';
