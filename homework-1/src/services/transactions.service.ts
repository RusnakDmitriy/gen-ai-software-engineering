import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateTransactionDto } from '../validators/create-transaction.dto';
import { GetTransactionsQueryDto } from '../validators/get-transactions-query.dto';
import { Transaction } from '../models/transaction.model';

@Injectable()
export class TransactionsService {
  private readonly transactions: Transaction[] = [];

  private parseFromDate(value: string): Date {
    return new Date(value);
  }

  private parseToDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }

  createTransaction(payload: CreateTransactionDto): Transaction {
    const transaction: Transaction = {
      id: randomUUID(),
      fromAccount: payload.fromAccount,
      toAccount: payload.toAccount,
      amount: payload.amount,
      currency: payload.currency,
      type: payload.type,
      timestamp: new Date().toISOString(),
      status: 'completed',
    };

    this.transactions.push(transaction);
    return transaction;
  }

  getTransactions(filters?: GetTransactionsQueryDto): Transaction[] {
    let results = [...this.transactions];

    if (
      filters?.from &&
      filters?.to &&
      this.parseFromDate(filters.from).getTime() > this.parseToDate(filters.to).getTime()
    ) {
      throw new BadRequestException({
        error: 'Validation failed',
        details: [{ field: 'from', message: 'from date must be earlier than or equal to to date' }],
      });
    }

    if (filters?.accountId) {
      results = results.filter(
        (transaction) =>
          transaction.fromAccount === filters.accountId || transaction.toAccount === filters.accountId,
      );
    }

    if (filters?.type) {
      results = results.filter((transaction) => transaction.type === filters.type);
    }

    if (filters?.from) {
      const fromDate = this.parseFromDate(filters.from);
      results = results.filter((transaction) => new Date(transaction.timestamp) >= fromDate);
    }

    if (filters?.to) {
      const toDate = this.parseToDate(filters.to);
      results = results.filter((transaction) => new Date(transaction.timestamp) <= toDate);
    }

    return results;
  }

  getTransactionById(id: string): Transaction {
    const transaction = this.transactions.find((entry) => entry.id === id);
    if (!transaction) {
      throw new NotFoundException(`Transaction with id '${id}' not found`);
    }
    return transaction;
  }

  getAccountBalance(accountId: string): { accountId: string; balance: number } {
    const balance = this.transactions.reduce((runningBalance, transaction) => {
      const incoming = transaction.toAccount === accountId ? transaction.amount : 0;
      const outgoing = transaction.fromAccount === accountId ? transaction.amount : 0;
      return runningBalance + incoming - outgoing;
    }, 0);

    return {
      accountId,
      balance: Number(balance.toFixed(2)),
    };
  }

  getAccountSummary(accountId: string): {
    accountId: string;
    totalDeposits: number;
    totalWithdrawals: number;
    transactionCount: number;
    mostRecentTransactionDate: string | null;
  } {
    const relatedTransactions = this.transactions.filter(
      (transaction) => transaction.fromAccount === accountId || transaction.toAccount === accountId,
    );

    const totalDeposits = relatedTransactions
      .filter((transaction) => transaction.toAccount === accountId)
      .reduce((total, transaction) => total + transaction.amount, 0);

    const totalWithdrawals = relatedTransactions
      .filter((transaction) => transaction.fromAccount === accountId)
      .reduce((total, transaction) => total + transaction.amount, 0);

    const mostRecent = relatedTransactions
      .map((transaction) => transaction.timestamp)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    return {
      accountId,
      totalDeposits: Number(totalDeposits.toFixed(2)),
      totalWithdrawals: Number(totalWithdrawals.toFixed(2)),
      transactionCount: relatedTransactions.length,
      mostRecentTransactionDate: mostRecent ?? null,
    };
  }
}
