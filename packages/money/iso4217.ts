// ISO 4217 Table A.1, retrieved 2026-08-24.
// Deliberately absent: fund codes (BOV, CHE, CHW, COU, MXV, USN, UYI, UYW),
// metals and special codes (XAU, XAG, XPT, XPD, XDR, XSU, XUA, XTS, XXX), and MGA/MRU,
// whose minor unit is 1/5 rather than a decimal exponent.

export type MinorUnitExponent = 0 | 2 | 3;

const EXPONENT_0 = [
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
] as const;

const EXPONENT_3 = [
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
] as const;

const EXPONENT_2 = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN',
  'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CNY', 'COP', 'CRC', 'CUP',
  'CVE', 'CZK', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD',
  'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL',
  'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR',
  'KPW', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL',
  'MKD', 'MMK', 'MNT', 'MOP', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'PAB', 'PEN', 'PGK', 'PHP',
  'PKR', 'PLN', 'QAR', 'RON', 'RSD', 'RUB', 'SAR', 'SBD', 'SCR', 'SDG',
  'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP',
  'SZL', 'THB', 'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH',
  'USD', 'UYU', 'UZS', 'VED', 'VES', 'WST', 'XCD', 'XCG', 'YER', 'ZAR',
  'ZMW', 'ZWG',
] as const;

export type Currency =
  | (typeof EXPONENT_0)[number]
  | (typeof EXPONENT_2)[number]
  | (typeof EXPONENT_3)[number];

const TABLE: ReadonlyMap<string, MinorUnitExponent> = new Map<string, MinorUnitExponent>([
  ...EXPONENT_0.map((code): readonly [string, MinorUnitExponent] => [code, 0]),
  ...EXPONENT_2.map((code): readonly [string, MinorUnitExponent] => [code, 2]),
  ...EXPONENT_3.map((code): readonly [string, MinorUnitExponent] => [code, 3]),
]);

export class UnknownCurrencyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`currency is not in the project ISO 4217 table: ${JSON.stringify(code)}`);
    this.name = 'UnknownCurrencyError';
    this.code = code;
  }
}

export function isSupportedCurrency(code: string): code is Currency {
  return TABLE.has(code);
}

export function exponentOf(code: string): MinorUnitExponent {
  const exponent = TABLE.get(code);
  if (exponent === undefined) {
    throw new UnknownCurrencyError(code);
  }
  return exponent;
}
