import { Module } from '@nestjs/common';
import { AccountsController } from './routes/accounts.controller';
import { TransactionsController } from './routes/transactions.controller';
import { TransactionsService } from './services/transactions.service';

@Module({
  imports: [],
  controllers: [TransactionsController, AccountsController],
  providers: [TransactionsService],
})
export class AppModule {}
