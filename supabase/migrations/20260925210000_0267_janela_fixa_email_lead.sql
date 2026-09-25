-- A janela de lead novo começa no primeiro item do lote.
-- Novos itens não podem empurrar o envio indefinidamente.

create or replace function public.fn_preserve_new_lead_batch_due_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.kind = 'new_lead'
     and old.status = 'pending'
     and new.due_at > old.due_at then
    new.due_at := old.due_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_preserve_new_lead_batch_due_at()
  from public, anon, authenticated;

drop trigger if exists trg_preserve_new_lead_batch_due_at
  on public.notification_email_batches;
create trigger trg_preserve_new_lead_batch_due_at
  before update of due_at on public.notification_email_batches
  for each row
  execute function public.fn_preserve_new_lead_batch_due_at();

comment on function public.fn_preserve_new_lead_batch_due_at() is
  'Mantém a janela de lead novo ancorada no primeiro item do lote.';
