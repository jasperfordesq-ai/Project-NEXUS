// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared vocabulary for the User Monitoring page and its form modal: the
 * duration presets, and one definition of "expiring soon" that the KPI
 * header, the tab filter and the row chips all use.
 */

import { parseServerTimestamp } from '@/lib/serverTime';
import type { MonitoredUser } from '@/admin/api/types';

// Duration options offered by the modal's Select (in days). Prefilling the
// Select on edit only reflects a record whose remaining days match one of these.
export const DURATION_OPTIONS = ['7', '14', '30', '60', '90'] as const;

export const DAY_MS = 86_400_000;
export const EXPIRING_SOON_DAYS = 7;
/** How far the row "Extend" action pushes an expiry (from today). */
export const EXTEND_DAYS = 30;

export type ExpiryState = 'expired' | 'soon' | 'ok';

/** Countdown state for an expiry timestamp. */
export function expiryState(expiresAt: Date): { days: number; state: ExpiryState } {
  if (expiresAt.getTime() <= Date.now()) {
    return { days: 0, state: 'expired' };
  }
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS);
  return { days, state: days <= EXPIRING_SOON_DAYS ? 'soon' : 'ok' };
}

/** True when the record has an expiry inside the "soon" window. */
export function isExpiringSoon(item: MonitoredUser): boolean {
  const expiresAt = parseServerTimestamp(item.monitoring_expires_at);
  return !!expiresAt && expiryState(expiresAt).state === 'soon';
}

/** Whole days left on a record, at least 1; null when it has no expiry. */
export function remainingDays(item: MonitoredUser): number | null {
  const expiresAt = parseServerTimestamp(item.monitoring_expires_at);
  if (!expiresAt) return null;
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS));
}

export const MONITORING_TABS = ['all', 'messaging_off', 'expiring_soon'] as const;
export type MonitoringTab = (typeof MONITORING_TABS)[number];

/** The tab filter, then the search box (name or reason), over the loaded rows. */
export function filterMonitoredUsers(items: MonitoredUser[], tab: MonitoringTab, search: string): MonitoredUser[] {
  const byTab =
    tab === 'messaging_off'
      ? items.filter((i) => !!i.messaging_disabled)
      : tab === 'expiring_soon'
        ? items.filter(isExpiringSoon)
        : items;
  const q = search.trim().toLowerCase();
  if (!q) return byTab;
  return byTab.filter(
    (i) =>
      (i.user_name ?? '').toLowerCase().includes(q) ||
      (i.monitoring_reason ?? '').toLowerCase().includes(q),
  );
}
