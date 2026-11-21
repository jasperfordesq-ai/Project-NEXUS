// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatCurrency } from '@/lib/helpers';

/** The money a plan row carries. Decimals arrive from the database as strings. */
export interface PlanMoney {
  price_monthly?: number | string | null;
  price_yearly?: number | string | null;
  setup_fee?: number | string | null;
  price_monthly_gbp?: number | string | null;
  price_yearly_gbp?: number | string | null;
  setup_fee_gbp?: number | string | null;
}

export interface PlanFactLine {
  currency: 'EUR' | 'GBP';
  /** Formatted, or null when the plan is not sold for that period. */
  monthly: string | null;
  yearly: string | null;
  /** Formatted one-off setup fee, or null when there is none. */
  setup: string | null;
}

function positive(value: number | string | null | undefined): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole amounts without ".00" (a plan reads "£199"), anything else to the penny. */
function show(value: number | null, currency: 'EUR' | 'GBP'): string | null {
  if (value === null) return null;
  return Number.isInteger(value)
    ? formatCurrency(value, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : formatCurrency(value, currency);
}

/**
 * A plan's prices as one line per currency it is sold in: monthly, yearly and
 * the one-off setup fee. Euro first. A currency with no recurring price at all
 * is left out, so a plan not sold in pounds has one line.
 *
 * For Billing control's Assign plan dialog, whose list of plans gave a name
 * and nothing else (owner, 21 Nov 2026: the setup fee and the member number
 * were not visible).
 */
export function planFactLines(plan: PlanMoney): PlanFactLine[] {
  const lines: PlanFactLine[] = [];

  for (const [currency, monthly, yearly, setup] of [
    ['EUR', plan.price_monthly, plan.price_yearly, plan.setup_fee],
    ['GBP', plan.price_monthly_gbp, plan.price_yearly_gbp, plan.setup_fee_gbp],
  ] as const) {
    const m = positive(monthly);
    const y = positive(yearly);
    if (m === null && y === null) continue;
    lines.push({ currency, monthly: show(m, currency), yearly: show(y, currency), setup: show(positive(setup), currency) });
  }

  return lines;
}
