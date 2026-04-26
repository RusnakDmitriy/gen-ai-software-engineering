import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateTransactionDto } from '../validators/create-transaction.dto';
import { GetTransactionsQueryDto } from '../validators/get-transactions-query.dto';
import { TransactionsService } from '../services/transactions.service';
import { Transaction } from '../models/transaction.model';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Body() payload: CreateTransactionDto): Transaction {
    return this.transactionsService.createTransaction(payload);
  }

  @Get()
  findAll(@Query() query: GetTransactionsQueryDto): Transaction[] {
    return this.transactionsService.getTransactions(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Transaction {
    return this.transactionsService.getTransactionById(id);
  }
}
