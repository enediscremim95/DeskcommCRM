-- Permite que um item da fila envie de duas a quatro bolhas sem perder a
-- unidade operacional por lead. As partes renderizadas e o progresso ficam no
-- item para que uma retomada continue da próxima bolha, sem repetir as anteriores.

alter table public.automation_first_message_queue
  add column if not exists message_parts jsonb,
  add column if not exists sent_part_count integer not null default 0,
  add column if not exists outbound_message_ids uuid[] not null default '{}'::uuid[];

-- Auto-cura uma aplicação interrompida ou um clone com escrita manual inválida
-- antes de instalar os CHECKs. Itens antigos continuam com message_parts nulo.
update public.automation_first_message_queue
set message_parts = null
where message_parts is not null
  and case
    when jsonb_typeof(message_parts) = 'array'
      then jsonb_array_length(message_parts) not between 2 and 4
    else true
  end;

update public.automation_first_message_queue
set sent_part_count = greatest(0, least(4, coalesce(sent_part_count, 0))),
    outbound_message_ids = coalesce(outbound_message_ids[1:4], '{}'::uuid[]);

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_message_parts_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_message_parts_check
  check (
    message_parts is null
    or case
      when jsonb_typeof(message_parts) = 'array'
        then jsonb_array_length(message_parts) between 2 and 4
      else false
    end
  );

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_sent_part_count_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_sent_part_count_check
  check (sent_part_count between 0 and 4);

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_outbound_message_ids_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_outbound_message_ids_check
  check (cardinality(outbound_message_ids) <= 4);

comment on column public.automation_first_message_queue.message_parts is
  'Snapshot das bolhas já renderizadas. NULL preserva itens legados de mensagem única.';
comment on column public.automation_first_message_queue.sent_part_count is
  'Quantidade de bolhas confirmadas como enviadas; retry continua deste índice.';
comment on column public.automation_first_message_queue.outbound_message_ids is
  'Mensagens outbound próprias das bolhas, na mesma ordem de message_parts.';

notify pgrst, 'reload schema';
