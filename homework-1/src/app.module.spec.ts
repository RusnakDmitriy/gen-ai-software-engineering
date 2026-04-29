import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AccountsController } from './routes/accounts.controller';
import { TransactionsController } from './routes/transactions.controller';

describe('AppModule', () => {
  it('compiles and exposes controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(TransactionsController)).toBeDefined();
    expect(moduleRef.get(AccountsController)).toBeDefined();
  });
});
