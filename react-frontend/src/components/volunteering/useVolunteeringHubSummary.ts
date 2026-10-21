// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { extractCollectionItems } from '@/pages/volunteering/extractCollectionItems';

/** Upper bound the API accepts for `per_page`; counts at this size read "50+". */
const COUNT_PAGE = 50;

export interface VolunteeringHubSummary {
  /** Applications still waiting for an organisation. `null` = not loaded / unavailable. */
  pendingApplications: number | null;
  /** True when there are more pending applications than one page returns. */
  pendingApplicationsCapped: boolean;
  /** Hours an organisation has approved. `null` = not loaded / unavailable. */
  approvedHours: number | null;
  /** The soonest shift still to come, if any. */
  nextShift: { startTime: string; title: string } | null;
  /** Urgent requests for help this member has not answered yet. */
  urgentRequests: number;
  /**
   * Whether this member has an approved application, which is what lets them
   * log hours (besides being an organisation member — the page knows that).
   * `null` while unknown, so callers can avoid flashing the wrong button.
   */
  hasApprovedApplication: boolean | null;
}

const EMPTY: VolunteeringHubSummary = {
  pendingApplications: null,
  pendingApplicationsCapped: false,
  approvedHours: null,
  nextShift: null,
  urgentRequests: 0,
  hasApprovedApplication: null,
};

interface Options {
  /** Only the hub preview, for a signed-in member, asks for any of this. */
  enabled: boolean;
  /** Section keys the member can see — a switched-off section is never fetched. */
  sections: ReadonlySet<string>;
}

interface HeldShift { start_time: string; opportunity_title: string }
interface UrgentRequest { my_response?: string }
interface HoursSummaryPayload { total_verified?: number | string }

/**
 * The few live facts the volunteering hub shows beside its links. Each request
 * is independent and fails quietly: a missing number just leaves its link plain,
 * it never blocks the page or shows an error.
 */
export function useVolunteeringHubSummary({ enabled, sections }: Options): VolunteeringHubSummary {
  const [summary, setSummary] = useState<VolunteeringHubSummary>(EMPTY);
  const wantsApplications = enabled && sections.has('applications');
  const wantsHours = enabled && sections.has('hours');
  const wantsAlerts = enabled && sections.has('alerts');

  useEffect(() => {
    if (!wantsApplications && !wantsHours && !wantsAlerts) {
      setSummary(EMPTY);
      return;
    }
    let cancelled = false;
    const patch = (next: Partial<VolunteeringHubSummary>) => {
      if (!cancelled) setSummary((prev) => ({ ...prev, ...next }));
    };
    const quietly = (label: string, request: Promise<void>) => {
      request.catch((err) => logError(`Volunteering hub: failed to load ${label}`, err));
    };

    if (wantsApplications) {
      quietly('pending applications', api.get<unknown>(`/v2/volunteering/applications?status=pending&per_page=${COUNT_PAGE}`)
        .then((res) => {
          if (!res.success) return;
          const count = extractCollectionItems(res.data).length;
          patch({ pendingApplications: count, pendingApplicationsCapped: Boolean(res.meta?.has_more) });
        }));
    }

    if (wantsHours) {
      quietly('approved applications', api.get<unknown>('/v2/volunteering/applications?status=approved&per_page=1')
        .then((res) => {
          patch({ hasApprovedApplication: res.success ? extractCollectionItems(res.data).length > 0 : false });
        }));

      quietly('hours summary', api.get<HoursSummaryPayload>('/v2/volunteering/hours/summary')
        .then((res) => {
          const hours = Number(res.data?.total_verified);
          if (res.success && Number.isFinite(hours)) patch({ approvedHours: hours });
        }));

      // The list is newest-first and includes past shifts, so pick the soonest
      // one still to come from a full page rather than trusting the order.
      quietly('shifts', api.get<unknown>(`/v2/volunteering/shifts?per_page=${COUNT_PAGE}`)
        .then((res) => {
          if (!res.success) return;
          const now = Date.now();
          const upcoming = extractCollectionItems<HeldShift>(res.data)
            .filter((shift) => {
              const start = Date.parse(shift.start_time);
              return Number.isFinite(start) && start > now;
            })
            .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))[0];
          patch({ nextShift: upcoming ? { startTime: upcoming.start_time, title: upcoming.opportunity_title } : null });
        }));
    }

    if (wantsAlerts) {
      // The API already drops expired and closed requests; count the ones still
      // waiting for this member's answer.
      quietly('urgent requests', api.get<{ alerts?: UrgentRequest[] } | UrgentRequest[]>('/v2/volunteering/emergency-alerts')
        .then((res) => {
          if (!res.success || !res.data) return;
          const alerts = Array.isArray(res.data) ? res.data : (res.data.alerts ?? []);
          patch({ urgentRequests: alerts.filter((alert) => (alert.my_response ?? 'pending') === 'pending').length });
        }));
    }

    return () => { cancelled = true; };
  }, [wantsApplications, wantsHours, wantsAlerts]);

  return summary;
}
