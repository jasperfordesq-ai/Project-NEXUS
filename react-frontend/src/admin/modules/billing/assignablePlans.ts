// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The plans a community may be put on: active ones only.
 *
 * GET /v2/admin/plans also returns the retired `legacy-…` plans, kept so that
 * a community already on one keeps its terms. Nobody new is put on one. The
 * database sends `is_active` as 0/1; a boolean is accepted too.
 */
export function assignablePlans<T extends { is_active?: number | boolean | string | null }>(plans: T[]): T[] {
  return plans.filter((plan) => plan.is_active === true || Number(plan.is_active) === 1);
}
