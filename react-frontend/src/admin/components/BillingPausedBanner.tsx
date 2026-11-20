// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tells a community's admins that it is paused for non-payment, since when,
 * and who it pays. Members see only the paused page, which never says why.
 *
 * And, for a community that is NOT paused, one warning line before anything
 * happens to it (Stage 3c): its payment is overdue, or it is approaching, at
 * or over its package's member limit. The server measures both the way the
 * daily check does, so the banner and the check's emails agree.
 *
 * That means one request whenever the admin panel is open, paused or not.
 * Nothing to say renders nothing.
 *
 * 🔴 When a PAUSED community's reason cannot be loaded the banner still says
 * it is paused. "Could not be read" must never look like "nothing is wrong":
 * the admin is looking at a community its members cannot use. For an open
 * community a failed request is silent: it was only ever a warning.
 *
 * 🔴 The API client answers `{ success: false }` for a 403 or a 500; it does
 * not throw. Both failure shapes are handled.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface MemberLimit {
  used: number;
  max: number;
  percent: number;
  stage: 'approaching' | 'reached' | 'over' | null;
}

/** GET /v2/admin/billing/standing — pinned by BillingPausedFlagTest and BillingAutomationEndpointsTest. */
interface BillingStanding {
  paused: boolean;
  own: boolean | null;
  since: string | null;
  payee: 'parent' | 'platform' | null;
  payee_name: string | null;
  /** Who this community itself pays; read by the admin sidebar. */
  payer?: 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';
  /** Whole days the payment is late; null when it is not. */
  overdue_days?: number | null;
  /** Null without a standard package with a limit. */
  member_limit?: MemberLimit | null;
}

type Loaded = BillingStanding | 'unknown' | null;
type Translate = (key: string, options?: Record<string, unknown>) => string;

export function BillingPausedBanner() {
  const { t, i18n } = useTranslation('admin_billing');
  const { tenant } = useTenant();
  const paused = tenant?.billing_paused === true;
  const [standing, setStanding] = useState<Loaded>(null);

  useEffect(() => {
    let alive = true;
    setStanding(null);

    const load = async () => {
      try {
        const response = await api.get<BillingStanding>('/v2/admin/billing/standing');
        if (!alive) return;
        if (response?.success && response.data) {
          setStanding(response.data);
          return;
        }
        logError('Could not load the billing standing', response?.code ?? response?.error);
      } catch (error: unknown) {
        if (!alive) return;
        logError('Could not load the billing standing', error);
      }
      setStanding('unknown');
    };

    void load();

    return () => {
      alive = false;
    };
  }, [paused]);

  if (standing === null) return null;

  // Paused, as the bootstrap or the server says: the paused line, even when
  // the reason could not be read.
  if (standing === 'unknown' ? paused : standing.paused) {
    return (
      <div
        role="alert"
        data-testid="billing-paused-banner"
        className="mb-3 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground"
      >
        <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words font-medium">{pausedWording(standing, t)}</p>
      </div>
    );
  }

  if (standing === 'unknown') return null;

  const warning = warningWording(standing, t, i18n.language);
  if (warning === null) return null;

  return (
    <div
      role="status"
      data-testid="billing-warning-banner"
      className="mb-3 flex items-start gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground"
    >
      <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words font-medium">{warning}</p>
    </div>
  );
}

function pausedWording(standing: BillingStanding | 'unknown', t: Translate): string {
  if (standing === 'unknown') {
    return t('paused_banner.unknown');
  }

  const date = standing.since ? formatDate(standing.since) : '';

  if (standing.own === false) {
    return t('paused_banner.inherited', { date });
  }

  if (standing.payee === 'parent' && standing.payee_name) {
    return t('paused_banner.own_parent', { payee: standing.payee_name, date });
  }

  return t('paused_banner.own_platform', { date });
}

/** One line: an overdue payment first, because that is what leads to a pause. */
function warningWording(standing: BillingStanding, t: Translate, language: string): string | null {
  const number = (value: number) => value.toLocaleString(language);

  if (typeof standing.overdue_days === 'number' && standing.overdue_days > 0) {
    return t('paused_banner.overdue', { days: number(standing.overdue_days) });
  }

  const limit = standing.member_limit;
  if (!limit || limit.stage === null) return null;

  const values = { used: number(limit.used), max: number(limit.max), percent: number(limit.percent) };
  if (limit.stage === 'approaching') return t('paused_banner.limit_approaching', values);
  if (limit.stage === 'reached') return t('paused_banner.limit_reached', values);
  if (limit.stage === 'over') return t('paused_banner.limit_over', values);

  return null;
}

export default BillingPausedBanner;
