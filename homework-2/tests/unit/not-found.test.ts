import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { notFound } from '../../src/api/middleware/notFound.js';

describe('notFound middleware', () => {
  it('returns 404 JSON payload', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    notFound({} as Request, res, (() => {}) as NextFunction);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
});
