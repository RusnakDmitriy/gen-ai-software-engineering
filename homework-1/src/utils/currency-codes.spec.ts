import { isSupportedCurrency } from './currency-codes';

describe('currency-codes', () => {
  it('returns true for supported currency', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
  });

  it('returns false for unsupported currency', () => {
    expect(isSupportedCurrency('INR')).toBe(false);
  });
});
