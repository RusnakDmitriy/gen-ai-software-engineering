export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_ERROR', 'Request validation failed', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UNPROCESSABLE_ENTITY', message, 422, details);
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(received: string, accepted: string[]) {
    super(
      'UNSUPPORTED_MEDIA_TYPE',
      `Unsupported file type: ${received}. Accepted: ${accepted.join(', ')}`,
      415,
    );
  }
}

export class ImportParseError extends AppError {
  constructor(message: string) {
    super('IMPORT_PARSE_ERROR', message, 400);
  }
}

export class ClassificationOverriddenError extends AppError {
  constructor() {
    super(
      'CLASSIFICATION_OVERRIDDEN',
      'Ticket has been manually classified. Pass ?force=true to override.',
      409,
    );
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
