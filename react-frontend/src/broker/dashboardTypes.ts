// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker dashboard payload additions (October 2026): how long each queue's
 * oldest item has waited, a fortnight of arrivals per queue, and what the
 * viewer themselves decided this week.
 *
 * These belong in `admin/api/types.ts` beside `BrokerDashboardStats` and
 * `BrokerActivityEntry`; they live here because that file was being edited by
 * another session when they were written. Move them there when it is free and
 * intersect no more — `adminBroker.getDashboard()` can then return the full
 * shape directly.
 *
 * Parity: AdminBrokerController::dashboard().
 */

import type { BrokerActivityEntry, BrokerDashboardStats, MatchApprovalStats } from '@/admin/api/types';

/** The queues that carry an oldest-item age and a trend. */
export type BrokerTrendQueue =
  | 'pending_exchanges'
  | 'unreviewed_messages'
  | 'safeguarding_alerts'
  | 'open_reports'
  | 'pending_members'
  | 'vetting_review_requests';

export interface BrokerQueueTrend {
  /** Items that arrived each day for the last 14 days, oldest first, today last. */
  points: number[];
  /** Percent change of those 14 days against the 14 before; null when the earlier fortnight had none. */
  delta: number | null;
}

export interface BrokerMyWeek {
  exchanges_decided: number;
  messages_reviewed: number;
  matches_decided: number;
  vetting_handled: number;
  total: number;
}

export interface BrokerDashboardExtras {
  /** ISO-8601 arrival time of each queue's oldest waiting item; null when the queue is empty or the figure failed. */
  oldest_waiting?: Partial<Record<BrokerTrendQueue, string | null>>;
  /** Per queue; a queue whose trend failed is simply absent (and named in `_failed_metrics` as `trends.<queue>`). */
  trends?: Partial<Record<BrokerTrendQueue, BrokerQueueTrend>>;
  /** The viewer's own decisions in the last 7 days; null when the figure failed. */
  my_week?: BrokerMyWeek | null;
  recent_activity: BrokerDashboardActivityEntry[];
}

/** `BrokerActivityEntry` plus the member an audit row is about (org_audit_log only). */
export type BrokerDashboardActivityEntry = BrokerActivityEntry & {
  target_user_id?: number | null;
};

export type BrokerDashboardPayload = BrokerDashboardStats & BrokerDashboardExtras;

/** Parameters `GET /v2/admin/broker/dashboard` accepts since October 2026. */
export interface BrokerDashboardParams {
  /** Rows in `recent_activity` (1–100, default 20). */
  activity_limit?: number;
  /** `activity`: return `recent_activity` alone, skipping every count. */
  only?: 'activity';
}

/**
 * `MatchApprovalStats` as `/v2/admin/matching/approvals/stats` actually
 * returns it (MatchApprovalWorkflowService::getStatistics) — `avg_review_hours`
 * is on the wire but not yet on the declared type.
 */
export type MatchApprovalStatsWithReviewTime = MatchApprovalStats & {
  avg_review_hours?: number;
};
