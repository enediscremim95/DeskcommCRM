# Limpar "Negócio esfriou" repetido

O vigia de risco gravou a mesma parada várias vezes em `crm_lead_activities`.
O código novo para de repetir. As linhas que já estão no banco só saem com o
script manual.

O script **não** roda no `install.sh`, no `update.sh` nem no baseline. Não
embrulhe o arquivo num `BEGIN`: cada lote faz o próprio `COMMIT`, e o índice
temporário é criado com `CONCURRENTLY`.

## Antes

Cópia só desta tabela. Sem ela não há como desfazer o `DELETE`.

```bash
pg_dump --format=custom --table=public.crm_lead_activities \
  --file=crm_lead_activities-antes.dump "$SUPABASE_DB_URL"
```

Confira que o arquivo existe e não está vazio antes de seguir. O código novo
do vigia já precisa estar no ar; senão a próxima passada grava de novo o que
o script acabou de apagar.

`crm_lead_activities` está na publicação `supabase_realtime`. Apagar cerca de
um milhão de linhas (a tabela passou de 700 MB) gera muito WAL e uma rajada de
eventos no realtime. Rode de madrugada. Antes, confira o espaço em disco: o
WAL e a cópia do `pg_dump` precisam caber junto com o banco.

## Rodar

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f scripts/ops/limpar-negocio-esfriou-repetido.sql
```

A saída começa com a contagem de antes (`negocio_esfriou`), mostra quantas
duplicatas entram na fila e termina com a contagem de depois. A segunda
execução tem de imprimir `duplicatas_a_apagar` igual a zero.

Fica a primeira linha de cada sequência contínua de esfriamento do negócio.
Uma anotação, uma mensagem, uma ligação atendida ou um "voltou a andar" entre
dois esfriamentos abre outra sequência. Um intervalo de pelo menos 6 horas
entre dois "Negócio esfriou" do mesmo lead também abre outra sequência, mesmo
sem atividade no meio: é o caso de o negócio ter saído da parada por um
compromisso e esfriado de novo. Seis horas é de propósito largo. As repetições
do defeito saem a cada passada, cerca de 15 minutos, sem buracos. Na dúvida a
linha fica. Para outro intervalo:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -v intervalo_esfriamento='12 hours' \
  -f scripts/ops/limpar-negocio-esfriou-repetido.sql
```

## Pré-medição

Rode isto antes do script. Não apaga nada. `seriam_apagadas` é a fila.
`mantidas_pelo_intervalo` são frases que a regra antiga apagaria e que o
intervalo de 6 horas mantém. Se `mantidas_pelo_intervalo` parecer pequeno
demais para a operação, aumente o intervalo e meça de novo.

```sql
WITH esfriamentos AS (
  SELECT id, lead_id, performed_at,
         lag(performed_at) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
         ) AS anterior
    FROM public.crm_lead_activities
   WHERE type = 'lead_cooled'
),
pausas AS (
  SELECT id FROM esfriamentos
   WHERE anterior IS NOT NULL
     AND performed_at - anterior >= interval '6 hours'
),
marcadores AS (
  SELECT a.id, a.lead_id, a.performed_at, a.type,
         CASE
           WHEN a.type <> 'lead_cooled' THEN 1
           WHEN a.id IN (SELECT id FROM pausas) THEN 1
           ELSE 0
         END AS quebra
    FROM public.crm_lead_activities AS a
   WHERE a.type = 'lead_cooled'
      OR a.type IN (
        'ai_turn', 'note', 'lead_edited', 'stage_changed',
        'next_action_approved', 'voice_call', 'lead_reactivated'
      )
),
ordenados AS (
  SELECT id, lead_id, type, performed_at,
         sum(quebra) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
com_pausa AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio ORDER BY performed_at, id
         ) AS n
    FROM ordenados WHERE type = 'lead_cooled'
),
so_tipo_base AS (
  SELECT id, lead_id, performed_at,
         sum(CASE WHEN type <> 'lead_cooled' THEN 1 ELSE 0 END) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores WHERE type = 'lead_cooled'
),
so_tipo AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio ORDER BY performed_at, id
         ) AS n
    FROM so_tipo_base
),
a_apagar AS (
  SELECT id FROM com_pausa WHERE n > 1
)
SELECT (SELECT count(*) FROM a_apagar) AS seriam_apagadas,
       (SELECT count(*) FROM so_tipo AS s
         WHERE s.n > 1
           AND NOT EXISTS (SELECT 1 FROM a_apagar AS a WHERE a.id = s.id)
       ) AS mantidas_pelo_intervalo;
```

O script imprime as mesmas duas colunas (`duplicatas_a_apagar` e
`mantidas_pelo_intervalo`) de novo, imediatamente antes de apagar.

## Se parar no meio

Rode o mesmo comando de novo. O que já foi apagado não volta; o restante é
recalculado. Se sobrar o índice `ops_tmp_messages_activity_id`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
```
