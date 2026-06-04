import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../src/api/middleware/validate.js';
import { ValidationError } from '../../src/domain/errors.js';

describe('validate middleware', () => {
  it('passes parsed body on success', () => {
    const schema = z.object({ name: z.string() });
    const req = { body: { name: 'x' } } as Request;
    const next = vi.fn();
    validate(schema, 'body')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect((req as Request & { body: { name: string } }).body.name).toBe('x');
  });

  it('calls next with ValidationError when query is invalid', () => {
    const schema = z.object({ page: z.coerce.number().min(1) });
    const req = { query: { page: '-1' } } as unknown as Request;
    const next = vi.fn();
    validate(schema, 'query')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('assigns parsed params on success', () => {
    const schema = z.object({ id: z.string() });
    const req = { params: { id: 'abc' } } as unknown as Request;
    const next = vi.fn();
    validate(schema, 'params')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect((req as Request & { params: { id: string } }).params.id).toBe('abc');
  });
});
