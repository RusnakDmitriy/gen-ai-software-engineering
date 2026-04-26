export const SUPPORTED_CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'] as const;

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCY_CODES.includes(code as (typeof SUPPORTED_CURRENCY_CODES)[number]);
}
