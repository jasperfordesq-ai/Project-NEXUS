// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which wellbeing alert the drawer has open, kept in step with the address.
 *
 * Every wellbeing bell and email links to a page with ?alert={id}: the admin
 * Wellbeing page for admins, the broker Safeguarding › Volunteering page for
 * brokers and coordinators. Both pages open that alert at once, and closing
 * the drawer takes ?alert= out of the address again.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WellbeingAlert } from './WellbeingAlertsPanel';

export interface WellbeingAlertDeepLink {
  openId: number | null;
  open: (alert: WellbeingAlert) => void;
  close: () => void;
}

export function useWellbeingAlertDeepLink(): WellbeingAlertDeepLink {
  const [searchParams, setSearchParams] = useSearchParams();
  const [openId, setOpenId] = useState<number | null>(null);

  // A bell or email link lands on ?alert={id}: open that alert at once.
  useEffect(() => {
    const raw = searchParams.get('alert');
    const id = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isInteger(id) && id > 0) {
      setOpenId(id);
    }
  }, [searchParams]);

  const open = useCallback((alert: WellbeingAlert) => {
    const id = typeof alert.id === 'string' ? Number.parseInt(alert.id, 10) : alert.id;
    if (typeof id === 'number' && Number.isInteger(id)) {
      setOpenId(id);
    }
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    if (searchParams.has('alert')) {
      const next = new URLSearchParams(searchParams);
      next.delete('alert');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return { openId, open, close };
}
