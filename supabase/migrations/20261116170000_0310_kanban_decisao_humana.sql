-- IA e automações só podem inserir na entrada. JWT de serviço nunca move/reabre/fecha.
-- Conexões administrativas diretas continuam disponíveis para manutenção explícita;
-- os workers não possuem nenhum caminho de movimentação (gate de código + testes).
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
-- Trigger não é RPC. Verifica DEPOIS do trigger que deriva status a partir da etapa.
drop trigger if exists zz_guard_kanban_human on public.crm_leads;
create trigger zz_guard_kanban_human before insert or update on public.crm_leads
for each row execute function public.fn_guard_kanban_human();

-- Junção operacional (0307/0309) não pode promover etapa implicitamente.
-- O estado original do absorvido continua no snapshot; desfazer humano usa JWT
-- authenticated e restaura a decisão histórica sem conceder movimento a automações.
do $patch$
declare v_fn regprocedure; v_definition text;
begin
 v_fn := to_regprocedure('public.fn_juntar_negocios_mesma_pessoa(uuid,uuid,uuid)');
 if v_fn is not null then
  v_definition := pg_get_functiondef(v_fn);
  if position('and s.id in (v_survivor.stage_id, v_absorbed.stage_id)' in v_definition) > 0 then
   execute replace(v_definition,
     'and s.id in (v_survivor.stage_id, v_absorbed.stage_id)',
     'and s.id = v_survivor.stage_id');
  end if;
 end if;
end $patch$;
