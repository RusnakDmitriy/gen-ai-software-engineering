import { NotFoundException } from '@nestjs/common';
import { CreateTransactionDto } from '../validators/create-transaction.dto';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const basePayload: CreateTransactionDto = {
    fromAccount: 'ACC-AAAA1',
    toAccount: 'ACC-BBBB2',
    amount: 120.5,
    currency: 'USD',
    type: 'transfer',
  };

  beforeEach(() => {
    service = new TransactionsService();
  });

  it('creates a transaction', () => {
    const transaction = service.createTransaction(basePayload);

    expect(transaction.id).toBeDefined();
    expect(transaction.status).toBe('completed');
    expect(transaction.timestamp).toBeDefined();
  });

  it('returns filtered transactions by account and type', () => {
    service.createTransaction(basePayload);
    service.createTransaction({
      ...basePayload,
      fromAccount: 'ACC-ZZZZ9',
      toAccount: 'ACC-AAAA1',
      type: 'deposit',
    });

    const filtered = service.getTransactions({ accountId: 'ACC-AAAA1', type: 'deposit' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('deposit');
  });

  it('filters by date range', () => {
    service.createTransaction(basePayload);
    const all = service.getTransactions();

    const txDate = all[0].timestamp.slice(0, 10);
    const filtered = service.getTransactions({ from: txDate, to: txDate });

    expect(filtered).toHaveLength(1);
  });

  it('throws when date range is invalid', () => {
    expect.assertions(1);
    try {
      service.getTransactions({
        from: '2025-01-02T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
      });
    } catch (error: unknown) {
      const response = (error as { getResponse: () => { details: Array<{ message: string }> } }).getResponse();
      expect(response.details[0].message).toBe('from date must be earlier than or equal to to date');
    }
  });

  it('returns transaction by id', () => {
    const created = service.createTransaction(basePayload);

    expect(service.getTransactionById(created.id)).toEqual(created);
  });

  it('throws not found when transaction id does not exist', () => {
    expect(() => service.getTransactionById('missing-id')).toThrow(NotFoundException);
  });

  it('calculates account balance', () => {
    service.createTransaction({ ...basePayload, amount: 100 });
    service.createTransaction({ ...basePayload, fromAccount: 'ACC-CCCC3', toAccount: 'ACC-AAAA1', amount: 25.25 });

    expect(service.getAccountBalance('ACC-AAAA1')).toEqual({
      accountId: 'ACC-AAAA1',
      balance: -74.75,
    });
  });

  it('returns account summary', () => {
    service.createTransaction({ ...basePayload, amount: 100 });
    service.createTransaction({ ...basePayload, fromAccount: 'ACC-CCCC3', toAccount: 'ACC-AAAA1', amount: 40 });

    const summary = service.getAccountSummary('ACC-AAAA1');

    expect(summary.accountId).toBe('ACC-AAAA1');
    expect(summary.totalDeposits).toBe(40);
    expect(summary.totalWithdrawals).toBe(100);
    expect(summary.transactionCount).toBe(2);
    expect(summary.mostRecentTransactionDate).not.toBeNull();
  });
});
