import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller';
import { TransactionsService } from '../services/transactions.service';

describe('AccountsController', () => {
  let controller: AccountsController;

  const serviceMock = {
    getAccountBalance: jest.fn(),
    getAccountSummary: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: TransactionsService, useValue: serviceMock }],
    }).compile();

    controller = module.get<AccountsController>(AccountsController);
    jest.clearAllMocks();
  });

  it('returns account balance', () => {
    serviceMock.getAccountBalance.mockReturnValue({ accountId: 'ACC-AAAA1', balance: 99.2 });

    const result = controller.getBalance('ACC-AAAA1');

    expect(serviceMock.getAccountBalance).toHaveBeenCalledWith('ACC-AAAA1');
    expect(result.balance).toBe(99.2);
  });

  it('returns account summary', () => {
    serviceMock.getAccountSummary.mockReturnValue({
      accountId: 'ACC-AAAA1',
      totalDeposits: 10,
      totalWithdrawals: 5,
      transactionCount: 2,
      mostRecentTransactionDate: '2026-01-01T00:00:00.000Z',
    });

    const result = controller.getSummary('ACC-AAAA1');

    expect(serviceMock.getAccountSummary).toHaveBeenCalledWith('ACC-AAAA1');
    expect(result.transactionCount).toBe(2);
  });
});
