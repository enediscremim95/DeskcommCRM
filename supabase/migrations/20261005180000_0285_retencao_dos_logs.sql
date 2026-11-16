-- 0285: RETENÇÃO DOS LOGS QUE CRESCEM SOZINHOS.
--
-- PROBLEMA MEDIDO EM PRODUÇÃO EM 05/10/2026
-- `webhook_events_log` tinha 123 MB e `event_log`, 20 MB. A primeira já
-- esvaziava o corpo pesado em D+7, mas o expurgo definitivo vivia numa rota
-- separada, sem piso no banco. A segunda não tinha expurgo.
--
-- O QUE `archived_at` SIGNIFICA
-- Não é processamento nem entrega concluída. A poda de corpo grava
-- `archived_at` quando substitui `raw_body`, `payload_parsed` e `headers`
-- por NULL. Portanto esta migration só remove a linha leve DEPOIS de o corpo já
-- ter sido descartado. Linha ainda com corpo nunca é candidata.
--
-- POR QUE 14 DIAS PARA WEBHOOKS, COM PISO DE 7
-- A rota operacional da Nuvemshop consulta `webhook_events_log` por
-- (organization_id, provider, external_id) para deduplicar uma repetição. Não
-- existe UNIQUE nesse conjunto: existe apenas
-- `idx_webhook_events_external_id`, que é um índice comum; os três handlers
-- LGPD que esperam 23505 dependem de uma unicidade que o schema atual não tem.
-- Apagar a linha libera a chave para reprocessamento, por isso o horizonte tem
-- de ultrapassar a janela do provedor. A política oficial da Nuvemshop limita a
-- 16 tentativas a uma janela de 48 horas. Quatorze dias são sete vezes essa
-- janela; o piso de sete dias ainda é 3,5 vezes maior. O corte usa received_at,
-- não archived_at: a proteção de idempotência conta desde a entrega original.
--
-- POR QUE 30 DIAS PARA EVENTOS CONCLUIDOS, COM PISO DE 14
-- Só `done` e `dead` são terminais. `pending` ainda espera consumidor e
-- `processing` está com um worker; nenhum dos dois entra no predicado. O corte
-- usa `updated_at`, não `created_at`, para preservar por 30 dias um evento
-- antigo que acabou de chegar ao estado terminal.
--
-- LOTES E LOCK
-- Cada chamada apaga no máximo 2.000 linhas (teto defensivo de 10.000) e usa
-- SKIP LOCKED. `lock_timeout` de 1 s faz a poda ceder para o tráfego do produto
-- numa máquina Micro. O cron limita a cinco lotes por tabela e por execução:
-- até 10 mil linhas/dia, de modo que o backlog drena em várias rodadas.
--
-- SEGURANÇA
-- As duas funções não aceitam org, id, tipo de evento nem status escolhido pelo
-- chamador. O único seletor é a ponta velha, com o piso dentro do corpo.
-- SECURITY DEFINER é necessária para a poda centralizada; EXECUTE é revogado de
-- PUBLIC, anon e authenticated e concedido somente a service_role.
--
-- A migration NÃO apaga linha alguma. Ela cria as funções e índices; o expurgo
-- só começa quando o cron data-retention rodar depois do deploy.

create index if not exists idx_webhook_events_log_expurgo_arquivado
  on public.webhook_events_log (received_at, id)
  where archived_at is not null;

create index if not exists idx_event_log_expurgo_concluido
  on public.event_log (updated_at, id)
  where status in ('done', 'dead');

create or replace function public.fn_expurgar_webhook_events_log_arquivado(
  p_retencao_dias int default null,
  p_lote int default 2000
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 14), 7);
  v_lote int := least(greatest(coalesce(p_lote, 2000), 1), 10000);
  v_apagadas int;
begin
  perform set_config('lock_timeout', '1s', true);

  with candidatas as materialized (
    select w.id
      from public.webhook_events_log w
     where w.archived_at is not null
       and w.received_at < now() - make_interval(days => v_dias)
     order by w.received_at, w.id
     limit v_lote
     for update skip locked
  )
  delete from public.webhook_events_log w
   using candidatas c
   where w.id = c.id;

  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

create or replace function public.fn_expurgar_event_log_concluido(
  p_retencao_dias int default null,
  p_lote int default 2000
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 30), 14);
  v_lote int := least(greatest(coalesce(p_lote, 2000), 1), 10000);
  v_apagadas int;
begin
  perform set_config('lock_timeout', '1s', true);

  with candidatas as materialized (
    select e.id
      from public.event_log e
     where e.status in ('done', 'dead')
       and e.updated_at < now() - make_interval(days => v_dias)
     order by e.updated_at, e.id
     limit v_lote
     for update skip locked
  )
  delete from public.event_log e
   using candidatas c
   where e.id = c.id;

  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

revoke execute on function public.fn_expurgar_webhook_events_log_arquivado(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_expurgar_webhook_events_log_arquivado(int, int)
  to service_role;

revoke execute on function public.fn_expurgar_event_log_concluido(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_expurgar_event_log_concluido(int, int)
  to service_role;

comment on function public.fn_expurgar_webhook_events_log_arquivado(int, int) is
  'Apaga em lote apenas linhas de webhook já sem corpo, por received_at. Default 14 dias; piso 7.';

comment on function public.fn_expurgar_event_log_concluido(int, int) is
  'Apaga em lote apenas eventos done/dead pela última mudança. Default 30 dias; piso 14.';

notify pgrst, 'reload schema';
