// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tells a community's admins that it is paused for non-payment, since when,
 * and who it pays. Members see only the paused page, which never says why.
 *
 * The public tenant bootstrap carries just the fact (`billing_paused`); this
 * asks the signed-in endpoint for the reason, and only when the fact is true,
 * so an open community costs no request.
 *
 * 🔴 When the reason cannot be loaded the banner still says the community is
 * paused. "Could not be read" must never look like "nothing is wrong": the
 * admin is looking at a community its members cannot use.
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

/** GET /v2/admin/billing/standing — pinned by BillingPausedFlagTest. */
interface BillingStanding {
  paused: boolean;
  own: boolean | null;
  since: string | null;
  payee: 'parent' | 'platform' | null;
  payee_name: string | null;
  /** Who this community itself pays; read by the admin sidebar. */
  payer?: 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';
}

type Loaded = BillingStanding | 'unknown' | null;

export function BillingPausedBanner() {
  const { t } = useTranslation('admin_billing');
  const { tenant } = useTenant();
  const paused = tenant?.billing_paused === true;
  const [standing, setStanding] = useState<Loaded>(null);

  useEffect(() => {
    if (!paused) {
      setStanding(null);
      return;
    }

    let alive = true;

    api
      .get<BillingStanding>('/v2/admin/billing/standing')
      .then((response) => {
        if (!alive) return;
        if (response.success && response.data) {
          setStanding(response.data);
          return;
        }
        logError('Could not load why this community is paused', response.code ?? response.error);
        setStanding('unknown');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        logError('Could not load why this community is paused', error);
        setStanding('unknown');
      });

    return () => {
      alive = false;
    };
  }, [paused]);

  if (!paused || standing === null) return null;
  if (standing !== 'unknown' && !standing.paused) return null;

  return (
    <div
      role="alert"
      data-testid="billing-paused-banner"
      className="mb-3 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground"
    >
      <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words font-medium">{wording(standing, t)}</p>
    </div>
  );
}

function wording(standing: BillingStanding | 'unknown', t: (key: string, options?: Record<string, unknown>) => string): string {
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

export default BillingPausedBanner;
