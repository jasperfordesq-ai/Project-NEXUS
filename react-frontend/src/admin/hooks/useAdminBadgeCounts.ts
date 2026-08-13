// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Actionable counts for the admin sidebar badges.
 *
 * 🔴 Why this exists. The sidebar's NavItem type has always had a `badge`
 * field, and `renderBadge` has always known how to draw one — but nothing in
 * the codebase ever set a badge value, and the backend service that computes
 * the counts (AdminBadgeCountService) had no route reaching it. So the admin
 * panel listed "Pending approvals" with no number beside it, and a coordinator
 * could not tell that somebody was locked out waiting for them without opening
 * the screen to look. Reported from a live community (Minehead & Coast,
 * 2026-08-13). This hook is the frontend half of that missing wire.
 *
 * Deliberately quiet on failure: a badge is a convenience, and a sidebar that
 * throws or shows an error because a count could not be fetched is worse than
 * one showing no number. `api.ts` never throws, so the `res.success` check
 * below is the real guard — a `catch` here would be dead code.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface AdminBadgeCounts {
  pending_users?: number;
  pending_listings?: number;
  pending_orgs?: number;
  fraud_alerts?: number;
  gdpr_requests?: number;
  pending_exchanges?: number;
  unreviewed_messages?: number;
  '404_errors'?: number;
}

/** How often to re-check while the admin sits on a page. */
const REFRESH_MS = 60_000;

export function useAdminBadgeCounts() {
  const [counts, setCounts] = useState<AdminBadgeCounts>({});

  const load = useCallback(async () => {
    const res = await api.get<AdminBadgeCounts>('/v2/admin/badge-counts');
    if (res.success && res.data && typeof res.data === 'object') {
      setCounts(res.data);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (!cancelled) void load();
    };

    run();
    const timer = window.setInterval(run, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  return { counts, refresh: load };
}

/**
 * Badge text for a count.
 *
 * Returns undefined for zero — a badge reading "0" is visual noise that trains
 * people to ignore the badge, which defeats the point of adding it.
 */
export function badgeForCount(count: number | undefined): string | undefined {
  if (!count || count < 1) return undefined;
  return count > 99 ? '99+' : String(count);
}
