import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../src/utils/asyncHandler.js';

describe('asyncHandler', () => {
  it('forwards resolved handlers without calling next', async () => {
    const fn = vi.fn(async () => {
      /* ok */
    });
    const wrapped = asyncHandler(fn);
    const next = vi.fn();
    await wrapped({} as Request, {} as Response, next);
    expect(fn).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards rejection to next', async () => {
    const err = new Error('fail');
    const fn = vi.fn(async () => {
      throw err;
    });
    const wrapped = asyncHandler(fn);
    const next = vi.fn();
    wrapped({} as Request, {} as Response, next);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(err);
  });
});
