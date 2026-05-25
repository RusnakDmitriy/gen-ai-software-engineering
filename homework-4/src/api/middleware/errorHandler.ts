import { Request, Response, NextFunction } from 'express';
import { isAppError } from '../../domain/errors.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: error }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(env.NODE_ENV !== 'production' && { stack: error.stack }),
    },
  });
};
