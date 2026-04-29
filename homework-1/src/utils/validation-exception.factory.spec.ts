import { ValidationError } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception.factory';

describe('validationExceptionFactory', () => {
  it('formats validation errors into expected structure', () => {
    const errors: ValidationError[] = [
      {
        property: 'amount',
        constraints: {
          min: 'Amount must be a positive number',
        },
        children: [],
      } as ValidationError,
    ];

    const exception = validationExceptionFactory(errors);
    const response = exception.getResponse() as {
      error: string;
      details: Array<{ field: string; message: string }>;
    };

    expect(response.error).toBe('Validation failed');
    expect(response.details[0]).toEqual({
      field: 'amount',
      message: 'Amount must be a positive number',
    });
  });
});
