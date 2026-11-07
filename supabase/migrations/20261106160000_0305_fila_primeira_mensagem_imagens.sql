-- Amplia a sequência persistida da primeira mensagem para o roteiro com
-- imagens. message_parts continua jsonb para preservar arrays antigos de
-- strings e passa a aceitar até treze partes, inclusive objetos de imagem.

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_message_parts_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_message_parts_check
  check (
    message_parts is null
    or case
      when jsonb_typeof(message_parts) = 'array'
        then jsonb_array_length(message_parts) between 2 and 13
      else false
    end
  );

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_sent_part_count_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_sent_part_count_check
  check (sent_part_count between 0 and 13);

alter table public.automation_first_message_queue
  drop constraint if exists automation_first_message_queue_outbound_message_ids_check;
alter table public.automation_first_message_queue
  add constraint automation_first_message_queue_outbound_message_ids_check
  check (cardinality(outbound_message_ids) <= 13);

comment on column public.automation_first_message_queue.message_parts is
  'Snapshot de até treze bolhas já renderizadas, texto ou imagem. NULL preserva itens legados de mensagem única.';

notify pgrst, 'reload schema';
