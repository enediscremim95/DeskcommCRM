-- Preferências pessoais do Inbox. Não reutiliza metadata compartilhado da
-- conversa nem da mensagem: cada usuário enxerga e altera somente as próprias.

create table if not exists public.inbox_user_conversation_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  favorited_at timestamptz,
  pinned_at timestamptz,
  muted_until timestamptz,
  marked_unread_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, conversation_id)
);

create table if not exists public.inbox_user_message_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  starred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, message_id)
);

alter table public.inbox_user_conversation_state enable row level security;
alter table public.inbox_user_message_state enable row level security;

-- Reaplicar a migration não pode falhar por política já existente.
drop policy if exists inbox_user_conversation_state_select on public.inbox_user_conversation_state;
drop policy if exists inbox_user_conversation_state_insert on public.inbox_user_conversation_state;
drop policy if exists inbox_user_conversation_state_update on public.inbox_user_conversation_state;
drop policy if exists inbox_user_message_state_select on public.inbox_user_message_state;
drop policy if exists inbox_user_message_state_insert on public.inbox_user_message_state;
drop policy if exists inbox_user_message_state_update on public.inbox_user_message_state;

create policy inbox_user_conversation_state_select
  on public.inbox_user_conversation_state for select
  using (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));
create policy inbox_user_conversation_state_insert
  on public.inbox_user_conversation_state for insert
  with check (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));
create policy inbox_user_conversation_state_update
  on public.inbox_user_conversation_state for update
  using (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));

create policy inbox_user_message_state_select
  on public.inbox_user_message_state for select
  using (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));
create policy inbox_user_message_state_insert
  on public.inbox_user_message_state for insert
  with check (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));
create policy inbox_user_message_state_update
  on public.inbox_user_message_state for update
  using (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));

revoke all on table public.inbox_user_conversation_state from public, anon;
revoke all on table public.inbox_user_message_state from public, anon;
grant select, insert, update on table public.inbox_user_conversation_state to authenticated;
grant select, insert, update on table public.inbox_user_message_state to authenticated;
grant all on table public.inbox_user_conversation_state to service_role;
grant all on table public.inbox_user_message_state to service_role;

create index if not exists inbox_user_conversation_state_favorites_idx
  on public.inbox_user_conversation_state
  (organization_id, user_id, favorited_at desc, conversation_id)
  where favorited_at is not null;
create index if not exists inbox_user_conversation_state_pins_idx
  on public.inbox_user_conversation_state
  (organization_id, user_id, pinned_at desc, conversation_id)
  where pinned_at is not null;
create index if not exists inbox_user_message_state_starred_idx
  on public.inbox_user_message_state
  (organization_id, user_id, starred_at desc, message_id)
  where starred_at is not null;

drop trigger if exists trg_inbox_user_conversation_state_updated_at
  on public.inbox_user_conversation_state;
create trigger trg_inbox_user_conversation_state_updated_at
  before update on public.inbox_user_conversation_state
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_inbox_user_message_state_updated_at
  on public.inbox_user_message_state;
create trigger trg_inbox_user_message_state_updated_at
  before update on public.inbox_user_message_state
  for each row execute function public.fn_set_updated_at();

-- O lock fecha a corrida entre duas fixações simultâneas. A API repete a
-- checagem apenas para devolver uma mensagem amigável.
create or replace function public.fn_inbox_user_conversation_pin_limit()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare quantidade integer;
begin
  if new.pinned_at is null
     or (tg_op = 'UPDATE' and new.pinned_at is not distinct from old.pinned_at) then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.user_id::text, 0)
  );
  select count(*) into quantidade
  from public.inbox_user_conversation_state s
  where s.organization_id = new.organization_id
    and s.user_id = new.user_id
    and s.pinned_at is not null
    and s.conversation_id <> new.conversation_id;
  if quantidade >= 5 then
    raise exception using errcode = '23514', message = 'inbox_pin_limit';
  end if;
  return new;
end;
$fn$;

revoke execute on function public.fn_inbox_user_conversation_pin_limit()
  from public, anon, authenticated;
grant execute on function public.fn_inbox_user_conversation_pin_limit() to service_role;
drop trigger if exists trg_inbox_user_conversation_pin_limit
  on public.inbox_user_conversation_state;
create trigger trg_inbox_user_conversation_pin_limit
  before insert or update of pinned_at on public.inbox_user_conversation_state
  for each row execute function public.fn_inbox_user_conversation_pin_limit();

comment on table public.inbox_user_conversation_state is
  'Estado pessoal do usuário no Inbox; favorito, fixação e reservas para silenciar e marcar como não lida.';
comment on table public.inbox_user_message_state is
  'Estado pessoal da mensagem no Inbox; estrela pertence somente ao usuário atual.';

notify pgrst, 'reload schema';
