// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  formatMarketplaceCurrency,
  formatMarketplaceMinorAmount,
  marketplaceCurrencyFractionDigits,
  normalizeSupportedMarketplaceCurrency,
} from './marketplaceNumbers';

describe('minor-unit amounts (fixed coupon discounts)', () => {
  it('knows how many fraction digits each supported currency has', () => {
    expect(marketplaceCurrencyFractionDigits('EUR')).toBe(2);
    expect(marketplaceCurrencyFractionDigits('gbp')).toBe(2);
    expect(marketplaceCurrencyFractionDigits('JPY')).toBe(0);
    // Unknown or blank codes fall back to the two-decimal common case.
    expect(marketplaceCurrencyFractionDigits('')).toBe(2);
    expect(marketplaceCurrencyFractionDigits('NOPE')).toBe(2);
  });

  it('divides a two-decimal currency by 100', () => {
    expect(formatMarketplaceMinorAmount(500, 'EUR')).toMatch(/5[.,]00/);
    expect(formatMarketplaceMinorAmount(1234, 'GBP')).toMatch(/12[.,]34/);
  });

  it('does not divide a zero-decimal currency at all', () => {
    // 500 yen is 500 yen: the minor unit IS the major unit.
    const formatted = formatMarketplaceMinorAmount(500, 'JPY');
    expect(formatted).toMatch(/500/);
    expect(formatted).not.toMatch(/\b5\b/);
  });

  it('treats a non-finite value as zero', () => {
    expect(formatMarketplaceMinorAmount(Number.NaN, 'EUR')).toMatch(/0[.,]00/);
  });
});

describe('marketplace currency helpers', () => {
  it('preserves major-unit amounts for decimal currencies', () => {
    expect(formatMarketplaceCurrency(25.5, 'GBP')).toMatch(/25\.50/);
  });

  it('does not invent decimals for zero-decimal currencies', () => {
    const formatted = formatMarketplaceCurrency(2500, 'JPY');

    expect(formatted).toMatch(/2[,.]500/);
    expect(formatted).not.toMatch(/[,.]00(?:\D|$)/);
  });

  it('normalizes supported tenant currencies without assuming EUR', () => {
    expect(normalizeSupportedMarketplaceCurrency(' jpy ')).toBe('JPY');
    expect(normalizeSupportedMarketplaceCurrency(null)).toBe('');
  });
});
