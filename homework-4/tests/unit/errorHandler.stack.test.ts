import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'development',
    EXPOSE_STACK_TRACE: true,
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { error: vi.fn() },
}));

const { errorHandler } = await import('../../src/api/middleware/errorHandler.js');

describe('errorHandler stack trace exposure', () => {
  it('includes stack when NODE_ENV is development and EXPOSE_STACK_TRACE is true', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    const err = new Error('dev boom');
    err.stack = 'Error: dev boom\n    at dev.ts:1:1';

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    const body = json.mock.calls[0][0] as { error: { stack?: string } };
    expect(body.error.stack).toBe('Error: dev boom\n    at dev.ts:1:1');
  });
});
