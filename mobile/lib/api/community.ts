// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * What the member's own community has shared so far this calendar month —
 * totals only, no names (GET /api/v2/community/this-month, signed-in members,
 * cached ten minutes per community and month on the server).
 */
export interface CommunityMonthTotals {
  /** 'YYYY-MM' */
  month: string;
  /** Completed exchanges and member-to-member transfers. */
  hours_shared: number;
  /** Joined, approved and active. */
  new_members: number;
  /** Offers and requests posted this month that are live or completed. */
  new_listings: number;
}

export function getCommunityThisMonth(): Promise<{ data: CommunityMonthTotals }> {
  return api.get<{ data: CommunityMonthTotals }>(`${API_V2}/community/this-month`);
}
