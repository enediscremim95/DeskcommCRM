-- 0279, leads que chegam a uma etapa entram no topo sem disputar posição.
--
-- O quadro lê `position_in_stage` em ordem crescente. A criação, a movimentação
-- sem posição explícita e a reabertura calculavam `max + 1000`, escondendo a
-- chegada mais recente no fim da coluna. Trocar por `min - 1000` apenas no
-- TypeScript manteria um check-then-act: duas requisições poderiam ler o mesmo
-- mínimo e reservar o mesmo número.
--
-- A tabela abaixo é o coordenador durável por etapa. A função cria a linha de
-- reserva, trava-a com `for update`, calcula contra o contador E contra a posição
-- realmente ocupada e persiste o novo contador antes de devolver. Duas chamadas
-- simultâneas ficam serializadas mesmo que o INSERT/UPDATE do lead ainda não
-- tenha acontecido. Falha posterior deixa só um intervalo vazio, permitido pelo
-- fractional indexing e invisível para a ordem.
--
-- Nenhum lead existente é atualizado. `numeric` aceita valores negativos e não
-- tem precisão declarada; o passo inteiro de 1000 preserva exatidão no Number do
-- app por cerca de 9 trilhões de reservas antes do limite de inteiro seguro.

create table if not exists public.crm_stage_position_reservations (
  stage_id uuid primary key references public.crm_stages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  top_position numeric,
  bottom_position numeric,
  updated_at timestamptz not null default now()
);

alter table public.crm_stage_position_reservations enable row level security;

do $$
begin
  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'crm_stage_position_reservations'
       and policyname = 'tenant_isolation_crm_stage_position_reservations_all'
  ) then
    create policy tenant_isolation_crm_stage_position_reservations_all
      on public.crm_stage_position_reservations
      for all
      using (organization_id in (select * from public.fn_user_org_ids()))
      with check (organization_id in (select * from public.fn_user_org_ids()));
  end if;
end
$$;

revoke all on table public.crm_stage_position_reservations from anon, authenticated;
grant select, insert, update, delete on table public.crm_stage_position_reservations to service_role;

create or replace function public.fn_reservar_posicao_lead_na_etapa(
  p_organization_id uuid,
  p_stage_id uuid,
  p_lado text
) returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_top numeric;
  v_bottom numeric;
  v_occupied numeric;
  v_position numeric;
begin
  if p_lado not in ('topo', 'fim') then
    raise exception 'lado de reserva inválido: %', p_lado using errcode = '22023';
  end if;

  if coalesce(auth.role(), '') not in ('service_role', 'postgres')
     and not exists (
       select 1
         from public.fn_user_org_ids() as allowed(organization_id)
        where allowed.organization_id = p_organization_id
     ) then
    raise exception 'organização fora do escopo do usuário' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.crm_stages s
     where s.id = p_stage_id
       and s.organization_id = p_organization_id
  ) then
    raise exception 'etapa não encontrada na organização' using errcode = 'P0002';
  end if;

  insert into public.crm_stage_position_reservations (stage_id, organization_id)
  values (p_stage_id, p_organization_id)
  on conflict (stage_id) do nothing;

  select r.top_position, r.bottom_position
    into v_top, v_bottom
    from public.crm_stage_position_reservations r
   where r.stage_id = p_stage_id
     and r.organization_id = p_organization_id
   for update;

  if not found then
    raise exception 'reserva da etapa pertence a outra organização' using errcode = '42501';
  end if;

  if p_lado = 'topo' then
    select min(l.position_in_stage)
      into v_occupied
      from public.crm_leads l
     where l.organization_id = p_organization_id
       and l.stage_id = p_stage_id;

    -- Etapa vazia começa em 1000: base 2000 menos o passo de 1000.
    v_position := coalesce(least(v_top, v_occupied), v_top, v_occupied, 2000) - 1000;
    update public.crm_stage_position_reservations
       set top_position = v_position,
           updated_at = now()
     where stage_id = p_stage_id;
  else
    select max(l.position_in_stage)
      into v_occupied
      from public.crm_leads l
     where l.organization_id = p_organization_id
       and l.stage_id = p_stage_id;

    -- Encerramentos continuam no fim: etapa vazia usa 0 + 1000.
    v_position := coalesce(greatest(v_bottom, v_occupied), v_bottom, v_occupied, 0) + 1000;
    update public.crm_stage_position_reservations
       set bottom_position = v_position,
           updated_at = now()
     where stage_id = p_stage_id;
  end if;

  return v_position;
end;
$$;

comment on table public.crm_stage_position_reservations is
  'Cursores internos que serializam a reserva de posições de leads por etapa sem reordenar cards existentes.';
comment on function public.fn_reservar_posicao_lead_na_etapa(uuid, uuid, text) is
  'Reserva posição distinta no topo ou no fim da etapa. Topo atende novas chegadas; fim preserva a semântica de encerramento.';

revoke all on function public.fn_reservar_posicao_lead_na_etapa(uuid, uuid, text)
  from public, anon;
grant execute on function public.fn_reservar_posicao_lead_na_etapa(uuid, uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
