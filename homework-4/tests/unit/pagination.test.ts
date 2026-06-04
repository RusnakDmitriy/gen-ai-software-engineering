import { describe, it, expect } from 'vitest';
import { buildPaginationMeta } from '../../src/utils/pagination.js';

describe('buildPaginationMeta', () => {
  it('computes totalPages from total and pageSize', () => {
    expect(buildPaginationMeta(1, 20, 45)).toEqual({
      page: 1,
      pageSize: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('returns 0 totalPages when total is 0', () => {
    expect(buildPaginationMeta(1, 20, 0).totalPages).toBe(0);
  });
});
