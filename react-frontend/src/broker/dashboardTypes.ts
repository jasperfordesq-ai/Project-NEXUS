// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Compatibility re-exports. The broker dashboard's October 2026 payload
 * additions (oldest waiting item per queue, a fortnight of arrivals, the
 * viewer's own week) were declared here while `admin/api/types.ts` was being
 * edited by another session. They now live there, on `BrokerDashboardStats`
 * itself, so `adminBroker.getDashboard()` returns the full shape with no
 * cast. Import from `@/admin/api/types`; these aliases keep older imports
 * compiling.
 */

import type { BrokerActivityEntry, BrokerDashboardStats, MatchApprovalStats } from '@/admin/api/types';

export type {
  BrokerTrendQueue,
  BrokerQueueTrend,
  BrokerMyWeek,
  BrokerDashboardParams,
} from '@/admin/api/types';

/** @deprecated Use `BrokerDashboardStats` — the extras are on it now. */
export type BrokerDashboardExtras = Pick<BrokerDashboardStats, 'oldest_waiting' | 'trends' | 'my_week' | 'recent_activity'>;

/** @deprecated Use `BrokerActivityEntry` — `target_user_id` is on it now. */
export type BrokerDashboardActivityEntry = BrokerActivityEntry;

/** @deprecated Use `BrokerDashboardStats`. */
export type BrokerDashboardPayload = BrokerDashboardStats;

/** @deprecated Use `MatchApprovalStats` — `avg_review_hours` is on it now. */
export type MatchApprovalStatsWithReviewTime = MatchApprovalStats;
