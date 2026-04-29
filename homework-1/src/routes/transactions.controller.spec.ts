import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from '../services/transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const serviceMock = {
    createTransaction: jest.fn(),
    getTransactions: jest.fn(),
    getTransactionById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: serviceMock }],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
    jest.clearAllMocks();
  });

  it('creates a transaction', () => {
    const payload = {
      fromAccount: 'ACC-AAAA1',
      toAccount: 'ACC-BBBB2',
      amount: 55,
      currency: 'USD',
      type: 'transfer' as const,
    };
    serviceMock.createTransaction.mockReturnValue({ id: '1', status: 'completed', ...payload });

    const result = controller.create(payload);

    expect(serviceMock.createTransaction).toHaveBeenCalledWith(payload);
    expect(result.id).toBe('1');
  });

  it('returns all transactions with query filters', () => {
    serviceMock.getTransactions.mockReturnValue([{ id: '1' }]);
    const query = { type: 'transfer' as const };

    const result = controller.findAll(query);

    expect(serviceMock.getTransactions).toHaveBeenCalledWith(query);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('returns one transaction by id', () => {
    serviceMock.getTransactionById.mockReturnValue({ id: 'tx-1' });

    expect(controller.findOne('tx-1')).toEqual({ id: 'tx-1' });
    expect(serviceMock.getTransactionById).toHaveBeenCalledWith('tx-1');
  });
});
