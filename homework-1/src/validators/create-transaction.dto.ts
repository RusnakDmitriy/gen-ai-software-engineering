import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { isSupportedCurrency } from '../utils/currency-codes';
import { TransactionType } from '../models/transaction.model';

@ValidatorConstraint({ name: 'isSupportedCurrency', async: false })
export class IsSupportedCurrencyConstraint implements ValidatorConstraintInterface {
  validate(currencyCode: string): boolean {
    return isSupportedCurrency(currencyCode);
  }

  defaultMessage(): string {
    return 'Invalid currency code';
  }
}

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^ACC-[A-Za-z0-9]{5}$/, {
    message: 'Account must match format ACC-XXXXX',
  })
  fromAccount!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^ACC-[A-Za-z0-9]{5}$/, {
    message: 'Account must match format ACC-XXXXX',
  })
  toAccount!: string;

  @Transform(({ value }: { value: number }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must have at most 2 decimal places' })
  @Min(0.01, { message: 'Amount must be a positive number' })
  @Max(1000000000)
  amount!: number;

  @Transform(({ value }: { value: string }) => String(value).toUpperCase())
  @IsString()
  @Validate(IsSupportedCurrencyConstraint)
  currency!: string;

  @IsEnum(['deposit', 'withdrawal', 'transfer'], {
    message: 'Type must be one of: deposit, withdrawal, transfer',
  })
  type!: TransactionType;
}
