import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../src/api/middleware/errorHandler.js';
import {
  AppError,
  ConflictError,
  ImportParseError,
  NotFoundError,
  UnprocessableError,
  UnsupportedMediaError,
  ValidationError,
  ClassificationOverriddenError,
  isAppError,
} from '../../src/domain/errors.js';

describe('domain errors', () => {
  it('isAppError returns true for AppError subclasses', () => {
    expect(isAppError(new NotFoundError('Ticket', 'x'))).toBe(true);
    expect(isAppError(new ValidationError({}))).toBe(true);
  });

  it('isAppError returns false for plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });

  it('isAppError returns false for non-errors', () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError('oops')).toBe(false);
  });

  it('ConflictError exposes CONFLICT code and 409', () => {
    const e = new ConflictError('dup');
    expect(e.code).toBe('CONFLICT');
    expect(e.statusCode).toBe(409);
  });

  it('UnprocessableError exposes details', () => {
    const e = new UnprocessableError('bad', { row: 1 });
    expect(e.code).toBe('UNPROCESSABLE_ENTITY');
    expect(e.statusCode).toBe(422);
    expect(e.details).toEqual({ row: 1 });
  });

  it('UnsupportedMediaError formats accepted types', () => {
    const e = new UnsupportedMediaError('image/png', ['text/csv']);
    expect(e.statusCode).toBe(415);
    expect(e.message).toContain('text/csv');
  });

  it('ImportParseError is a 400 AppError', () => {
    const e = new ImportParseError('broken');
    expect(e.code).toBe('IMPORT_PARSE_ERROR');
    expect(e.statusCode).toBe(400);
  });

  it('ClassificationOverriddenError', () => {
    const e = new ClassificationOverriddenError();
    expect(e.code).toBe('CLASSIFICATION_OVERRIDDEN');
    expect(e.statusCode).toBe(409);
  });

  it('AppError preserves custom fields', () => {
    const e = new AppError('CUSTOM', 'msg', 418, { foo: 'bar' });
    expect(e.code).toBe('CUSTOM');
    expect(e.details).toEqual({ foo: 'bar' });
  });
});

describe('errorHandler middleware', () => {
  it('maps AppError to JSON status and body', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    const next = vi.fn() as NextFunction;
    errorHandler(new NotFoundError('Ticket', 'abc'), {} as Request, res, next);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Ticket abc not found', details: undefined },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('maps non-AppError to 500 INTERNAL_ERROR', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    errorHandler(new Error('boom'), {} as Request, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        }),
      }),
    );
  });

  it('maps string rejection to 500', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    errorHandler('not an Error object', {} as Request, res, vi.fn() as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
  });

  it('omits stack trace when NODE_ENV is test', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at test.ts:1:1';

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    const body = json.mock.calls[0][0] as { error: { stack?: string } };
    expect(body.error.stack).toBeUndefined();
  });
});
