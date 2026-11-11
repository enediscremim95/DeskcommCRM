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
dois esfriamentos abre outra sequência, e a primeira linha dessa sequência
também fica.

## Se parar no meio

Rode o mesmo comando de novo. O que já foi apagado não volta; o restante é
recalculado. Se sobrar o índice `ops_tmp_messages_activity_id`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id;
```
