import { BadRequestException, ValidationError } from '@nestjs/common';

function flattenValidationErrors(errors: ValidationError[]): Array<{ field: string; message: string }> {
  return errors.flatMap((error) => {
    const current = Object.values(error.constraints ?? {}).map((message) => ({
      field: error.property,
      message,
    }));

    const nested = error.children ? flattenValidationErrors(error.children) : [];

    return [...current, ...nested];
  });
}

export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({
    error: 'Validation failed',
    details: flattenValidationErrors(errors),
  });
}
