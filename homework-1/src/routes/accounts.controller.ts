import { Controller, Get, Param } from '@nestjs/common';
import { TransactionsService } from '../services/transactions.service';
import { AccountIdPipe } from '../validators/account-id.pipe';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get(':accountId/balance')
  getBalance(@Param('accountId', AccountIdPipe) accountId: string): { accountId: string; balance: number } {
    return this.transactionsService.getAccountBalance(accountId);
  }

  @Get(':accountId/summary')
  getSummary(@Param('accountId', AccountIdPipe) accountId: string): {
    accountId: string;
    totalDeposits: number;
    totalWithdrawals: number;
    transactionCount: number;
    mostRecentTransactionDate: string | null;
  } {
    return this.transactionsService.getAccountSummary(accountId);
  }
}
