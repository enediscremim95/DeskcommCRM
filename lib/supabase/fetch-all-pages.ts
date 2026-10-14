import { logger, type LogContext } from "@/lib/logger";

const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_MAX_ROWS = 200_000;

interface PageError {
  message?: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: PageError | null;
}

interface FetchAllPagesOptions {
  resource: string;
  pageSize?: number;
  maxRows?: number;
  logContext?: LogContext;
}

export class FetchAllPagesError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FetchAllPagesError";
  }
}

/**
 * Lê uma consulta PostgREST inteira por intervalos inclusivos.
 *
 * A fábrica deve aplicar uma ordem estável e única antes de `range`, por exemplo
 * `order("occurred_on").order("id").range(from, to)`. Sem o desempate, linhas
 * com o mesmo valor na primeira coluna podem trocar de página durante a leitura.
 */
export async function fetchAllPages<T>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchAllPagesOptions,
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new FetchAllPagesError(`fetch_all_pages_invalid_page_size: ${options.resource}`);
  }
  if (!Number.isInteger(maxRows) || maxRows <= 0 || pageSize > maxRows) {
    throw new FetchAllPagesError(`fetch_all_pages_invalid_max_rows: ${options.resource}`);
  }

  const rows: T[] = [];
  for (let pageNumber = 1, from = 0; ; pageNumber += 1, from += pageSize) {
    const to = from + pageSize - 1;
    const result = await queryPage(from, to);
    if (result.error) {
      throw new FetchAllPagesError(
        `fetch_all_pages_query_failed: ${options.resource}; page=${pageNumber}`,
        result.error,
      );
    }

    const page = result.data ?? [];
    if (page.length > pageSize) {
      throw new FetchAllPagesError(
        `fetch_all_pages_oversized_page: ${options.resource}; page=${pageNumber}`,
      );
    }
    if (rows.length + page.length >= maxRows) {
      throw new FetchAllPagesError(
        `fetch_all_pages_row_limit_reached: ${options.resource}; max_rows=${maxRows}`,
      );
    }

    rows.push(...page);
    if (page.length < pageSize) {
      if (pageNumber > 1) {
        logger.info("supabase.fetch_all_pages.completed", {
          ...options.logContext,
          resource: options.resource,
          page_count: pageNumber,
          row_count: rows.length,
        });
      }
      return rows;
    }
  }
}
