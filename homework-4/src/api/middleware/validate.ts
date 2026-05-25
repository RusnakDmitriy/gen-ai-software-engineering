import { Request, Response, NextFunction } from 'express';
import type { ZodSchema, z } from 'zod';
import { ValidationError } from '../../domain/errors.js';

export const validate =
  <S extends ZodSchema>(schema: S, target: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join('.');
        if (!fieldErrors[path]) {
          fieldErrors[path] = [];
        }
        fieldErrors[path].push(err.message);
      });
      return next(new ValidationError(fieldErrors));
    }

    const parsed: z.infer<S> = result.data;

    if (target === 'body') {
      (req as Request & { body: z.infer<S> }).body = parsed;
    } else if (target === 'query') {
      req.query = parsed as unknown as Request['query'];
    } else if (target === 'params') {
      req.params = parsed as unknown as Request['params'];
    }

    next();
  };
