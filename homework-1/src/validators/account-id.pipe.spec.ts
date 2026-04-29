import { BadRequestException } from '@nestjs/common';
import { AccountIdPipe } from './account-id.pipe';

describe('AccountIdPipe', () => {
  const pipe = new AccountIdPipe();

  it('returns valid account id', () => {
    expect(pipe.transform('ACC-AB123')).toBe('ACC-AB123');
  });

  it('throws for invalid account id', () => {
    expect(() => pipe.transform('invalid')).toThrow(BadRequestException);
  });
});
