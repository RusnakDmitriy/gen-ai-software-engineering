import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

describe('CreateTransactionDto', () => {
  it('passes validation for a valid payload', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      fromAccount: 'ACC-AAAA1',
      toAccount: 'ACC-BBBB2',
      amount: 100.25,
      currency: 'usd',
      type: 'transfer',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.currency).toBe('USD');
  });

  it('fails on invalid amount, account and currency', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      fromAccount: 'invalid',
      toAccount: 'ACC-BBBB2',
      amount: -1.123,
      currency: 'inr',
      type: 'transfer',
    });

    const errors = await validate(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toContain('fromAccount');
    expect(fields).toContain('amount');
    expect(fields).toContain('currency');
  });
});
