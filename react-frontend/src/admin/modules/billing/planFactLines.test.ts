// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { planFactLines } from './planFactLines';

describe('planFactLines', () => {
  it('gives the monthly price, the yearly price and the setup fee in each currency', () => {
    // The standard "Local" package as GET /v2/admin/plans sends it: strings.
    expect(planFactLines({
      price_monthly: '229.00', price_yearly: '2290.00', setup_fee: '750.00',
      price_monthly_gbp: '199.00', price_yearly_gbp: '1990.00', setup_fee_gbp: '645.00',
    })).toEqual([
      { currency: 'EUR', monthly: '€229', yearly: '€2,290', setup: '€750' },
      { currency: 'GBP', monthly: '£199', yearly: '£1,990', setup: '£645' },
    ]);
  });

  it('reports no setup fee as null, never as a zero amount', () => {
    // Spark: no setup fee in either currency.
    const lines = planFactLines({
      price_monthly: 175, price_yearly: 1750, setup_fee: 0,
      price_monthly_gbp: 150, price_yearly_gbp: 1500, setup_fee_gbp: 0,
    });

    expect(lines.map((line) => line.setup)).toEqual([null, null]);
  });

  it('leaves out a currency the plan is not sold in', () => {
    expect(planFactLines({
      price_monthly: 49, price_yearly: 490, setup_fee: 0,
      price_monthly_gbp: null, price_yearly_gbp: null, setup_fee_gbp: null,
    })).toEqual([{ currency: 'EUR', monthly: '€49', yearly: '€490', setup: null }]);
  });

  it('keeps a plan sold for one period only, with the other period empty', () => {
    expect(planFactLines({ price_monthly: 0, price_yearly: 1200 })).toEqual([
      { currency: 'EUR', monthly: null, yearly: '€1,200', setup: null },
    ]);
  });

  it('gives no lines for a free plan', () => {
    expect(planFactLines({ price_monthly: 0, price_yearly: '0.00', setup_fee: 0 })).toEqual([]);
  });

  it('keeps the pennies when an amount is not whole', () => {
    expect(planFactLines({ price_monthly: '49.50', price_yearly: 0 })[0]!.monthly).toBe('€49.50');
  });
});
