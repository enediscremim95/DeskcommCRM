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
dois esfriamentos abre outra sequência. Um intervalo de pelo menos 1 hora
entre dois "Negócio esfriou" do mesmo lead também abre outra sequência, mesmo
sem atividade no meio: é o caso de o negócio ter saído da parada por um
compromisso e esfriado de novo. Uma frase com `payload.de` igual a `em_voo`
ou `em_dia` também fica, mesmo com intervalo menor que 1 hora: o vigia leu o
estado anterior. A repetição do defeito vinha com `de` nulo. A troca antiga
`em_risco` → `critico` sai de propósito — era uma segunda frase da mesma
parada, e o radar continua mostrando a faixa nova. Uma frase que alguma
mensagem aponta (`messages.activity_id`) também fica: a chave estrangeira é
`ON DELETE SET NULL`, e apagar desligaria a mensagem da frase.
`mantidas_por_mensagem` conta essas linhas. As repetições do defeito saem a
cada passada, cerca de 15 minutos, sem buracos. Intervalo menor mantém mais
frases. Se `mantidas_pelo_intervalo` parecer pequeno demais, diminua o
intervalo e meça de novo. As duplicatas que sobrarem saem numa segunda limpeza.

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -v intervalo_esfriamento='30 minutes' \
  -f scripts/ops/limpar-negocio-esfriou-repetido.sql
```

## Pré-medição

Rode o histograma antes de escolher o intervalo. Não apaga nada. A faixa
`15–30 min` é a cadência do defeito. Um vale entre essa faixa e os intervalos
de horas é um bom corte. O padrão do script é 1 hora.

```sql
WITH pares AS (
  SELECT performed_at - lag(performed_at) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
         ) AS intervalo
    FROM public.crm_lead_activities
   WHERE type = 'lead_cooled'
)
SELECT
  CASE
    WHEN intervalo < interval '15 minutes' THEN 1
    WHEN intervalo < interval '30 minutes' THEN 2
    WHEN intervalo < interval '1 hour' THEN 3
    WHEN intervalo < interval '6 hours' THEN 4
    WHEN intervalo < interval '1 day' THEN 5
    ELSE 6
  END AS ordem,
  CASE
    WHEN intervalo < interval '15 minutes' THEN '< 15 min'
    WHEN intervalo < interval '30 minutes' THEN '15–30 min'
    WHEN intervalo < interval '1 hour' THEN '30–60 min'
    WHEN intervalo < interval '6 hours' THEN '1–6 h'
    WHEN intervalo < interval '1 day' THEN '6–24 h'
    ELSE '>= 1 dia'
  END AS faixa,
  count(*) AS pares
  FROM pares
 WHERE intervalo IS NOT NULL
 GROUP BY 1, 2
 ORDER BY 1;
```

A pré-medição abaixo também não apaga nada. `seriam_apagadas` é a fila.
`mantidas_pelo_intervalo` são frases que a regra só por tipo de atividade
apagaria e que o intervalo de 1 hora mantém. Se esse número parecer pequeno
demais, diminua o intervalo na consulta (`interval '1 hour'`) e meça de novo.
`mantidas_pelo_estado` são frases que o intervalo apagaria e que ficam porque
o `payload.de` é `em_voo` ou `em_dia`. `mantidas_por_mensagem` são frases que
sairiam e que ficam porque uma mensagem aponta para elas.

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
     AND performed_at - anterior >= interval '1 hour'
),
marcadores AS (
  SELECT a.id, a.lead_id, a.performed_at, a.type,
         CASE
           WHEN a.type <> 'lead_cooled' THEN 1
           WHEN a.payload->>'de' IN ('em_voo', 'em_dia') THEN 1
           WHEN a.id IN (SELECT id FROM pausas) THEN 1
           ELSE 0
         END AS quebra,
         CASE
           WHEN a.type <> 'lead_cooled' THEN 1
           WHEN a.id IN (SELECT id FROM pausas) THEN 1
           ELSE 0
         END AS quebra_sem_estado
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
         ) AS episodio,
         sum(quebra_sem_estado) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio_sem_estado
    FROM marcadores
),
com_pausa AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio ORDER BY performed_at, id
         ) AS n
    FROM ordenados WHERE type = 'lead_cooled'
),
com_intervalo AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio_sem_estado ORDER BY performed_at, id
         ) AS n
    FROM ordenados WHERE type = 'lead_cooled'
),
so_tipo_base AS (
  SELECT id, lead_id, type, performed_at,
         sum(CASE WHEN type <> 'lead_cooled' THEN 1 ELSE 0 END) OVER (
           PARTITION BY lead_id ORDER BY performed_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS episodio
    FROM marcadores
),
so_tipo AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, episodio ORDER BY performed_at, id
         ) AS n
    FROM so_tipo_base
   WHERE type = 'lead_cooled'
),
a_apagar AS (
  SELECT a.id FROM com_pausa AS a
   WHERE a.n > 1
     AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.activity_id = a.id)
),
com_mensagem AS (
  SELECT a.id FROM com_pausa AS a
   WHERE a.n > 1
     AND EXISTS (SELECT 1 FROM public.messages m WHERE m.activity_id = a.id)
)
SELECT (SELECT count(*) FROM a_apagar) AS seriam_apagadas,
       (SELECT count(*) FROM so_tipo AS s
         WHERE s.n > 1
           AND NOT EXISTS (
             SELECT 1 FROM com_intervalo AS c WHERE c.id = s.id AND c.n > 1
           )
       ) AS mantidas_pelo_intervalo,
       (SELECT count(*) FROM com_intervalo AS c
         WHERE c.n > 1
           AND NOT EXISTS (SELECT 1 FROM a_apagar AS a WHERE a.id = c.id)
           AND NOT EXISTS (SELECT 1 FROM com_mensagem AS g WHERE g.id = c.id)
       ) AS mantidas_pelo_estado,
       (SELECT count(*) FROM com_mensagem) AS mantidas_por_mensagem;
```

O script imprime as mesmas quatro colunas (`duplicatas_a_apagar`,
`mantidas_pelo_intervalo`, `mantidas_pelo_estado` e
`mantidas_por_mensagem`) de novo, imediatamente antes de apagar.

## Dois vigias ao mesmo tempo

O agendamento é um `curl` a cada 15 minutos. Duas passadas que se cruzam — a
anterior ainda gravando quando outra começa — podem as duas ler o estado
antigo e as duas inserir a frase, antes do upsert. Não há trava: cada
consulta do vigia abre a própria conexão, e um advisory lock solto numa delas
não cobre o insert da outra. Fechar isso pediria uma função no banco, na
mesma transação, que travasse o negócio, conferisse a frase e gravasse. Não
entrou aqui.

O estrago é uma frase a mais naquela travessia, não a repetição a cada 15
minutos. Se o `payload.de` for `em_voo` ou `em_dia`, a limpeza deixa as duas.
Se `de` for nulo e nenhuma mensagem apontar para a segunda, ela sai.

## Se parar no meio

Rode o mesmo comando de novo. O que já foi apagado não volta; o restante é
recalculado. Se sobrar o índice `ops_tmp_messages_activity_id`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
```
