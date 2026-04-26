import { IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { TransactionType } from '../models/transaction.model';

export class GetTransactionsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^ACC-[A-Za-z0-9]{5}$/, {
    message: 'Account must match format ACC-XXXXX',
  })
  accountId?: string;

  @IsOptional()
  @IsEnum(['deposit', 'withdrawal', 'transfer'], {
    message: 'Type must be one of: deposit, withdrawal, transfer',
  })
  type?: TransactionType;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO 8601 date' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO 8601 date' })
  to?: string;
}
