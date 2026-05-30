export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListPaginationParams = {
  page?: number;
  pageSize?: number;
  search?: string;
};

export function parseListPaginationParams(
  pageStr?: string,
  pageSizeStr?: string,
  search?: string,
): { page: number; pageSize: number; search?: string; offset: number } {
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(pageSizeStr ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  const trimmed = search?.trim();
  return {
    page,
    pageSize,
    search: trimmed || undefined,
    offset: (page - 1) * pageSize,
  };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { data, total, page, pageSize };
}
