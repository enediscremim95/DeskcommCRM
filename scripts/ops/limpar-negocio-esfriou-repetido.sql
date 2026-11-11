-- Limpeza MANUAL das repetições de "Negócio esfriou" (crm_lead_activities.type = lead_cooled).
--
-- NÃO é migration. NÃO entra em supabase/baseline.sql. NÃO é aplicada por
-- install.sh, update.sh nem pelo CI. Quem roda é uma pessoa, no banco, depois
-- do código novo já estar no ar — senão o worker continua gravando enquanto
-- este script apaga.
--
-- ANTES DE RODAR, faça uma cópia só desta tabela. Sem o dump, não há volta:
-- o DELETE abaixo é definitivo.
--
--   pg_dump --format=custom --table=public.crm_lead_activities \
--     --file=crm_lead_activities-antes.dump "$SUPABASE_DB_URL"
--
-- O que fica: a primeira linha de cada sequência contínua de esfriamento de
-- cada negócio. Uma sequência nova começa quando, entre dois lead_cooled,
-- existe atividade que encerra o episódio — a lista positiva de
-- fn_update_last_activity_at (interação real, inclusive voice_call) ou
-- lead_reactivated. O resto da timeline não é tocado.
--
-- Idempotente: a segunda execução recalcula e não acha duplicata.
-- Lotes de 500, cada um na própria transação, para não segurar lock na tabela
-- inteira de uma instalação carregada.
--
-- Rode com psql em autocommit. NÃO envolva o arquivo num BEGIN: o índice
-- concorrente e o COMMIT de cada lote recusam transação externa. O editor SQL
-- do painel costuma embrulhar o script; use o psql.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/ops/limpar-negocio-esfriou-repetido.sql
--
-- Se o script morrer no meio, rode de novo: o que já saiu não volta, e o que
-- ficou é recalculado. Se sobrar o índice ops_tmp_messages_activity_id, apague
-- com: DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;

\set ON_ERROR_STOP on

\echo '== contagem ANTES =='
SELECT count(*) AS atividades_total,
       count(*) FILTER (WHERE type = 'lead_cooled') AS negocio_esfriou,
       count(DISTINCT lead_id) FILTER (WHERE type = 'lead_cooled') AS negocios_com_esfriamento
  FROM public.crm_lead_activities;

-- Sem este índice, cada DELETE confere messages.activity_id varrendo a tabela
-- (a FK é ON DELETE SET NULL e a coluna não tem índice). O índice é parcial e
-- sai no fim: isto não é mudança de schema do produto.
\echo '== índice temporário para a FK de messages.activity_id =='
SET statement_timeout = 0;
SET lock_timeout = '5s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ops_tmp_messages_activity_id
  ON public.messages (activity_id)
  WHERE activity_id IS NOT NULL;

\echo '== duplicatas desta passada =='
CREATE TEMP TABLE IF NOT EXISTS ops_esfriamento_duplicado (
  id uuid PRIMARY KEY
) ON COMMIT PRESERVE ROWS;
TRUNCATE ops_esfriamento_duplicado;

INSERT INTO pg_temp.ops_esfriamento_duplicado (id)
-- BEGIN IDENTIFICACAO
WITH marcadores AS (
  SELECT id,
         lead_id,
         performed_at,
         created_at,
         type,
         CASE WHEN type = 'lead_cooled' THEN 0 ELSE 1 END AS quebra
    FROM public.crm_lead_activities
   WHERE type = 'lead_cooled'
      OR type IN (
        'ai_turn',
        'note',
        'lead_edited',
        'stage_changed',
        'next_action_approved',
        'voice_call',
        'lead_reactivated'
      )
),
ordenados AS (
  SELECT id,
         lead_id,
         type,
         performed_at,
         created_at,
         sum(quebra) OVER (
           PARTITION BY lead_id
           ORDER BY performed_at, created_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
posicao AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio
           ORDER BY performed_at, created_at, id
         ) AS n
    FROM ordenados
   WHERE type = 'lead_cooled'
)
SELECT id
  FROM posicao
 WHERE n > 1
-- END IDENTIFICACAO
;

SELECT count(*) AS duplicatas_a_apagar FROM pg_temp.ops_esfriamento_duplicado;

-- O procedimento vive só nesta sessão (pg_temp) e só apaga id que o cálculo
-- acima marcou, e só se a linha ainda for lead_cooled.
CREATE OR REPLACE PROCEDURE pg_temp.limpar_negocio_esfriou_repetido(p_lote integer)
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  IF p_lote IS NULL OR p_lote < 1 OR p_lote > 5000 THEN
    RAISE EXCEPTION 'lote invalido: use entre 1 e 5000';
  END IF;
  LOOP
    WITH lote AS (
      SELECT id
        FROM pg_temp.ops_esfriamento_duplicado
       LIMIT p_lote
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
       AND (SELECT count(*) FROM apagados) >= 0;

    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
    EXIT WHEN n = 0;
    RAISE NOTICE 'lote apagado da fila: %', n;
    PERFORM pg_sleep(0.05);
  END LOOP;
END;
$$;

SET statement_timeout = '30s';
SET lock_timeout = '2s';
CALL pg_temp.limpar_negocio_esfriou_repetido(500);

\echo '== contagem DEPOIS =='
SELECT count(*) AS atividades_total,
       count(*) FILTER (WHERE type = 'lead_cooled') AS negocio_esfriou,
       count(DISTINCT lead_id) FILTER (WHERE type = 'lead_cooled') AS negocios_com_esfriamento
  FROM public.crm_lead_activities;

DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
