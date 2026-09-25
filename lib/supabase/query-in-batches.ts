/**
 * Teto conservador para filtros PostgREST `in.(...)`.
 *
 * O filtro viaja na URL. UUIDs em volume transformam uma leitura simples numa
 * query string de dezenas de KB, recusada pelo proxy antes de chegar ao banco.
 */
export const IN_FILTER_BATCH_SIZE = 200;

interface BatchQueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface BatchedQueryResult<T> {
  data: T[];
  error: string | null;
}

/**
 * Executa uma consulta baseada em `.in()` em lotes e reúne as linhas.
 *
 * O callback recebe no máximo 200 valores, mesmo que um chamador tente pedir
 * um lote maior. Assim a proteção mora na camada reutilizável, e não na memória
 * de cada rota que precisar cruzar uma lista de ids.
 */
export async function queryInBatches<T>(
  values: readonly string[],
  query: (batch: string[]) => PromiseLike<BatchQueryResult<T>>,
  requestedBatchSize = IN_FILTER_BATCH_SIZE,
): Promise<BatchedQueryResult<T>> {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) return { data: [], error: null };

  const batchSize = Math.min(
    Math.max(Math.trunc(requestedBatchSize) || IN_FILTER_BATCH_SIZE, 1),
    IN_FILTER_BATCH_SIZE,
  );
  const data: T[] = [];

  for (let index = 0; index < uniqueValues.length; index += batchSize) {
    const result = await query(uniqueValues.slice(index, index + batchSize));
    if (result.error) return { data: [], error: result.error.message };
    data.push(...(result.data ?? []));
  }

  return { data, error: null };
}
