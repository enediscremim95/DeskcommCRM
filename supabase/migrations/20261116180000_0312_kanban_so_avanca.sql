-- 0312 — Kanban: IA/automações só avançam o lead no funil (regra de 16/11/2026, todas as orgs).
-- Substitui a trava total da 0310: serviço (service_role/anon) agora pode mudar a etapa
-- SOMENTE para uma etapa de posição maior, no mesmo funil, fora de Ganho/Perdido/arquivada,
-- e nunca altera pipeline/status/fechamento. Retrocesso => 'kanban_only_forward'.
-- Entrada de lead novo continua só na primeira etapa aberta. Sem ID de organização: vale para todas.
-- O trigger zz_guard_kanban_human (0310) já existe e chama esta função; só o corpo muda.
--
-- REVERTER (volta à trava total da 0310): reexecutar o corpo abaixo.
/*
create or replace function public.fn_guard_kanban_human() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare entry_id uuid;
begin
  if coalesce(auth.role(), current_user) in ('service_role', 'anon') then
    if tg_op = 'UPDATE' then
      if (new.stage_id, new.pipeline_id, new.status, new.closed_at)
         is distinct from (old.stage_id, old.pipeline_id, old.status, old.closed_at) then
        raise exception using errcode = '42501', message = 'human_kanban_required';
      end if;
    else
      select id into entry_id from public.crm_stages
       where organization_id = new.organization_id and pipeline_id = new.pipeline_id
         and not is_archived and not is_won and not is_lost
       order by position, id limit 1;
      if new.stage_id is distinct from entry_id or new.status <> 'open' or new.closed_at is not null then
        raise exception using errcode = '42501', message = 'automation_entry_only';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.fn_guard_kanban_human() from public, anon;
*/

create or replace function public.fn_guard_kanban_human() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare entry_id uuid; o record; n record;
begin
  if coalesce(auth.role(), current_user) in ('service_role', 'anon') then
    if tg_op = 'UPDATE' then
      -- Pipeline, status e fechamento continuam exclusivos de humano.
      if (new.pipeline_id, new.status, new.closed_at)
         is distinct from (old.pipeline_id, old.status, old.closed_at) then
        raise exception using errcode = '42501', message = 'human_kanban_required';
      end if;
      if new.stage_id is distinct from old.stage_id then
        select position, is_won, is_lost into o from public.crm_stages where id = old.stage_id;
        select position, is_won, is_lost, is_archived into n from public.crm_stages where id = new.stage_id;
        -- Sair de Ganho/Perdido ou entrar neles: só humano.
        if old.status <> 'open' or coalesce(o.is_won, false) or coalesce(o.is_lost, false)
           or n.is_won is null or n.is_won or n.is_lost or n.is_archived then
          raise exception using errcode = '42501', message = 'human_kanban_required';
        end if;
        -- Automação só avança (posição estritamente maior). Nunca volta, nunca empata.
        if not (n.position > o.position) then
          raise exception using errcode = '42501', message = 'kanban_only_forward';
        end if;
      end if;
    else
      select id into entry_id from public.crm_stages
       where organization_id = new.organization_id and pipeline_id = new.pipeline_id
         and not is_archived and not is_won and not is_lost
       order by position, id limit 1;
      if new.stage_id is distinct from entry_id or new.status <> 'open' or new.closed_at is not null then
        raise exception using errcode = '42501', message = 'automation_entry_only';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.fn_guard_kanban_human() from public, anon;
