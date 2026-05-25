export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
