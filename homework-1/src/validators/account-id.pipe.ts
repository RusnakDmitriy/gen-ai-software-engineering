import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class AccountIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^ACC-[A-Za-z0-9]{5}$/.test(value)) {
      throw new BadRequestException({
        error: 'Validation failed',
        details: [{ field: 'accountId', message: 'Account must match format ACC-XXXXX' }],
      });
    }
    return value;
  }
}
