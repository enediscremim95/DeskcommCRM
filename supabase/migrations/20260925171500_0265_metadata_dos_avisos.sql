-- 0265: a coluna `metadata` dos avisos da Central, que o codigo ja lia sem ela existir.
--
-- O vigia de fontes de captacao (migration 0262, versao 76) le
-- `agent_inbox_items.metadata` para saber quando aquela fonte recebeu lead pela
-- ultima vez e nao reabrir o mesmo aviso a cada rodada. A coluna nunca foi
-- criada: nem na 0262, nem no baseline. Medido em producao em 25/09/2026, o
-- cron falhava de cinco em cinco minutos com
-- `column agent_inbox_items.metadata does not exist`, e nenhum aviso de fonte
-- muda chegava a ser aberto.
--
-- O teste da 0262 passava porque exercitava o Supabase simulado, que aceita
-- qualquer coluna no `select`. Banco simulado nao tem schema; e por isso que
-- mudanca de leitura tambem precisa passar pelo banco de verdade.

alter table public.agent_inbox_items
  add column if not exists metadata jsonb;

comment on column public.agent_inbox_items.metadata is
  'Dados do episodio que abriu o aviso (ex.: last_received_at da fonte de captacao). Consultado pelo vigia para nao reabrir o mesmo aviso.';
