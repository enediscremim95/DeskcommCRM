-- Limpeza MANUAL das repetições de "Negócio esfriou" (crm_lead_activities.type = lead_cooled).
--
-- NÃO é migration. NÃO entra em supabase/baseline.sql. NÃO é aplicada por
-- install.sh, update.sh nem pelo CI. Quem roda é uma pessoa, no banco, depois
-- do código novo já estar no ar — senão o worker continua gravando enquanto
-- este script apaga.
--
-- ANTES DE RODAR, faça uma cópia só desta tabela e a pré-medição do runbook.
-- Sem o dump, não há volta: o DELETE abaixo é definitivo.
--
--   pg_dump --format=custom --table=public.crm_lead_activities \
--     --file=crm_lead_activities-antes.dump "$SUPABASE_DB_URL"
--
-- O que fica: a primeira linha de cada sequência contínua de esfriamento.
-- Uma sequência nova começa em três casos, e na dúvida a linha FICA:
--   1. é o primeiro esfriamento do lead;
--   2. entre este e o anterior houve interação ou "voltou a andar";
--   3. o esfriamento anterior do mesmo lead está a pelo menos o intervalo
--      (padrão 1 hora). As repetições do defeito saem a cada passada, cerca
--      de 15 minutos, sem buracos. Intervalo menor mantém mais frases; as
--      duplicatas que sobrarem saem numa segunda limpeza.
--
-- Para manter mais, diminua o intervalo na linha de comando (não edite o arquivo):
--   psql -v intervalo_esfriamento='30 minutes' -f este_arquivo.sql
--
-- Idempotente: a segunda execução recalcula e não acha duplicata.
-- Cada DELETE leva no máximo 500 linhas e tem statement_timeout de 30s.
-- Não há teto para o total: a fila inteira sai, um comando de cada vez.
--
-- A tabela está na publicação supabase_realtime. Apagar cerca de um milhão de
-- linhas gera muito WAL e muitos eventos. Rode de madrugada, com espaço em
-- disco conferido antes.
--
-- Rode com psql em autocommit. NÃO envolva o arquivo num BEGIN: o índice
-- concorrente recusa transação externa.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/ops/limpar-negocio-esfriou-repetido.sql
--
-- Se o script morrer no meio, rode de novo. Se sobrar o índice
-- ops_tmp_messages_activity_id:
--   DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;

\set ON_ERROR_STOP on

\if :{?intervalo_esfriamento}
\else
\set intervalo_esfriamento '1 hour'
\endif
\if :{?somente_leads}
\else
\set somente_leads ''
\endif

\echo '== contagem ANTES =='
\echo 'intervalo:' :intervalo_esfriamento
SELECT count(*) AS atividades_total,
       count(*) FILTER (WHERE type = 'lead_cooled') AS negocio_esfriou,
       count(DISTINCT lead_id) FILTER (WHERE type = 'lead_cooled') AS negocios_com_esfriamento
  FROM public.crm_lead_activities
 WHERE (
        :'somente_leads' = ''
        OR lead_id = ANY (
          CASE
            WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
            ELSE string_to_array(:'somente_leads', ',')::uuid[]
          END
        )
      );

-- Sem este índice, cada DELETE confere messages.activity_id varrendo a tabela
-- (a FK é ON DELETE SET NULL e a coluna não tem índice). É a única FK que
-- aponta para crm_lead_activities. O índice sai no fim.
\echo '== índice temporário para a FK de messages.activity_id =='
SET statement_timeout = '10min';
SET lock_timeout = '30s';
-- Execução anterior pode ter deixado o índice INVALID. CREATE INDEX
-- CONCURRENTLY IF NOT EXISTS não substitui índice inválido.
DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
\set ON_ERROR_STOP off
CREATE INDEX CONCURRENTLY ops_tmp_messages_activity_id
  ON public.messages (activity_id)
  WHERE activity_id IS NOT NULL;
\set indice_falhou :ERROR
\if :indice_falhou
  SET lock_timeout = '30s';
  DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
  \echo 'não consegui criar o índice temporário; nada foi apagado'
  \set ON_ERROR_STOP on
  DO $$ BEGIN RAISE EXCEPTION 'indice temporario nao criado'; END $$;
\endif
\set ON_ERROR_STOP on

\echo '== pré-medição (nada é apagado neste SELECT) =='
-- BEGIN IDENTIFICACAO
WITH esfriamentos AS (
  SELECT id,
         lead_id,
         performed_at,
         lag(performed_at) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, id
         ) AS anterior
    FROM public.crm_lead_activities
   WHERE type = 'lead_cooled'
     AND (
          :'somente_leads' = ''
          OR lead_id = ANY (
            CASE
              WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
              ELSE string_to_array(:'somente_leads', ',')::uuid[]
            END
          )
        )
),
pausas AS (
  SELECT id
    FROM esfriamentos
   WHERE anterior IS NOT NULL
     AND performed_at - anterior >= :'intervalo_esfriamento'::interval
),
marcadores AS (
  SELECT a.id,
         a.lead_id,
         a.performed_at,
         a.type,
         CASE
           WHEN a.type <> 'lead_cooled' THEN 1
           WHEN a.id IN (SELECT pausas.id FROM pausas) THEN 1
           ELSE 0
         END AS quebra
    FROM public.crm_lead_activities AS a
   WHERE (
          :'somente_leads' = ''
          OR a.lead_id = ANY (
            CASE
              WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
              ELSE string_to_array(:'somente_leads', ',')::uuid[]
            END
          )
        )
     AND (
          a.type = 'lead_cooled'
          OR a.type IN (
            'ai_turn',
            'note',
            'lead_edited',
            'stage_changed',
            'next_action_approved',
            'voice_call',
            'lead_reactivated'
          )
        )
),
ordenados AS (
  SELECT id,
         lead_id,
         type,
         performed_at,
         sum(quebra) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
com_pausa AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio
           ORDER BY performed_at, id
         ) AS n
    FROM ordenados
   WHERE type = 'lead_cooled'
),
so_tipo_base AS (
  SELECT id,
         lead_id,
         type,
         performed_at,
         sum(CASE WHEN type <> 'lead_cooled' THEN 1 ELSE 0 END) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
so_tipo AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio
           ORDER BY performed_at, id
         ) AS n
    FROM so_tipo_base
   WHERE type = 'lead_cooled'
),
a_apagar AS (
  SELECT id FROM com_pausa WHERE n > 1
),
mantidas AS (
  SELECT s.id
    FROM so_tipo AS s
   WHERE s.n > 1
     AND NOT EXISTS (SELECT 1 FROM a_apagar AS a WHERE a.id = s.id)
)
-- END IDENTIFICACAO
SELECT (SELECT count(*) FROM a_apagar) AS duplicatas_a_apagar,
       (SELECT count(*) FROM mantidas) AS mantidas_pelo_intervalo;

\echo '== fila de duplicatas =='
CREATE TEMP TABLE IF NOT EXISTS ops_esfriamento_duplicado (
  id uuid PRIMARY KEY
) ON COMMIT PRESERVE ROWS;
TRUNCATE ops_esfriamento_duplicado;

INSERT INTO pg_temp.ops_esfriamento_duplicado (id)
-- BEGIN FILA
WITH esfriamentos AS (
  SELECT id,
         lead_id,
         performed_at,
         lag(performed_at) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, id
         ) AS anterior
    FROM public.crm_lead_activities
   WHERE type = 'lead_cooled'
     AND (
          :'somente_leads' = ''
          OR lead_id = ANY (
            CASE
              WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
              ELSE string_to_array(:'somente_leads', ',')::uuid[]
            END
          )
        )
),
pausas AS (
  SELECT id
    FROM esfriamentos
   WHERE anterior IS NOT NULL
     AND performed_at - anterior >= :'intervalo_esfriamento'::interval
),
marcadores AS (
  SELECT a.id,
         a.lead_id,
         a.performed_at,
         a.type,
         CASE
           WHEN a.type <> 'lead_cooled' THEN 1
           WHEN a.id IN (SELECT pausas.id FROM pausas) THEN 1
           ELSE 0
         END AS quebra
    FROM public.crm_lead_activities AS a
   WHERE (
          :'somente_leads' = ''
          OR a.lead_id = ANY (
            CASE
              WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
              ELSE string_to_array(:'somente_leads', ',')::uuid[]
            END
          )
        )
     AND (
          a.type = 'lead_cooled'
          OR a.type IN (
            'ai_turn',
            'note',
            'lead_edited',
            'stage_changed',
            'next_action_approved',
            'voice_call',
            'lead_reactivated'
          )
        )
),
ordenados AS (
  SELECT id,
         lead_id,
         type,
         performed_at,
         sum(quebra) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
com_pausa AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio
           ORDER BY performed_at, id
         ) AS n
    FROM ordenados
   WHERE type = 'lead_cooled'
)
SELECT id
  FROM com_pausa
 WHERE n > 1
-- END FILA
;

-- Cada comando apaga no máximo 500 linhas. statement_timeout e lock_timeout
-- valem para ESSE comando. O \gexec repete até esvaziar a fila; não há teto
-- para o total. Nunca statement_timeout = 0: um CALL único não reinicia o
-- relógio a cada COMMIT interno.
\echo '== apagando em lotes de 500 =='
SET statement_timeout = '30s';
SET lock_timeout = '5s';
SELECT $q$WITH lote AS (
  SELECT id
    FROM pg_temp.ops_esfriamento_duplicado
   ORDER BY id
   LIMIT 500
),
apagados AS (
  DELETE FROM public.crm_lead_activities AS a
   USING lote
   WHERE a.id = lote.id
     AND a.type = 'lead_cooled'
  RETURNING a.id
)
DELETE FROM pg_temp.ops_esfriamento_duplicado AS d
 USING lote
 WHERE d.id = lote.id
   AND (SELECT count(*) FROM apagados) >= 0$q$
  FROM generate_series(
    1,
    GREATEST(
      (SELECT ceil(count(*)::numeric / 500)::int FROM pg_temp.ops_esfriamento_duplicado),
      0
    )
  );
-- ON_ERROR_STOP ligado: o primeiro lote que falha para o script. Rodar de
-- novo é seguro — a abertura derruba o índice que ficou e recalcula a fila.
\gexec

SET statement_timeout = '30s';
SET lock_timeout = '30s';
DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;

SELECT (count(*) > 0)::text AS restantes
  FROM pg_temp.ops_esfriamento_duplicado
\gset
\if :restantes
  \echo 'ainda há duplicatas na fila; o índice temporário foi removido. Rode de novo.'
  DO $$ BEGIN RAISE EXCEPTION 'limpeza incompleta'; END $$;
\endif

\echo '== contagem DEPOIS =='
SELECT count(*) AS atividades_total,
       count(*) FILTER (WHERE type = 'lead_cooled') AS negocio_esfriou,
       count(DISTINCT lead_id) FILTER (WHERE type = 'lead_cooled') AS negocios_com_esfriamento
  FROM public.crm_lead_activities
 WHERE (
        :'somente_leads' = ''
        OR lead_id = ANY (
          CASE
            WHEN :'somente_leads' = '' THEN ARRAY[]::uuid[]
            ELSE string_to_array(:'somente_leads', ',')::uuid[]
          END
        )
      );
