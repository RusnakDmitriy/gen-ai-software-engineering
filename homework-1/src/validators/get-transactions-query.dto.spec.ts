import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetTransactionsQueryDto } from './get-transactions-query.dto';

describe('GetTransactionsQueryDto', () => {
  it('passes validation for valid query params', async () => {
    const dto = plainToInstance(GetTransactionsQueryDto, {
      accountId: 'ACC-AAAA1',
      type: 'transfer',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T00:00:00.000Z',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('fails validation for invalid account and date', async () => {
    const dto = plainToInstance(GetTransactionsQueryDto, {
      accountId: 'wrong',
      from: 'invalid-date',
    });

    const errors = await validate(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toContain('accountId');
    expect(fields).toContain('from');
  });
});
