-- 0322: os dois índices únicos parciais que a 0320 precisa, fora dela.
--
-- Por que migration própria: na 0320 o build varreria as tabelas DENTRO da
-- transação que adiciona as colunas, segurando o lock ACCESS EXCLUSIVE do
-- `add column` durante a varredura. Aqui o lock é só o SHARE do `create index`
-- (bloqueia escrita, não leitura) pelo tempo do build.
--
-- Por que não `CONCURRENTLY`: o runner envolve cada migration numa transação, e
-- `CREATE INDEX CONCURRENTLY` não roda dentro de transação. O kit self-host
-- (`baseline.sql`, aplicado por `psql -f` em autocommit) cria os MESMOS índices
-- com `CONCURRENTLY`.
--
-- Tamanho: os dois são parciais sobre colunas recém-criadas e todas nulas, então
-- indexam zero linhas; o custo é uma leitura sequencial de `crm_tasks` (tarefas
-- internas; ordem de milhares de linhas por instalação) e de `agent_inbox_items`
-- (avisos da Central; ordem de milhares a dezenas de milhares). Para uma tabela
-- muito maior, crie à mão com `create unique index concurrently if not exists`
-- (mesmo nome) ANTES de aplicar esta migration: o `if not exists` a torna no-op.

create unique index if not exists uniq_crm_tasks_source_key
  on public.crm_tasks (organization_id, source_key)
  where source_key is not null;

create unique index if not exists uniq_agent_inbox_dedupe_key
  on public.agent_inbox_items (organization_id, dedupe_key)
  where dedupe_key is not null;
