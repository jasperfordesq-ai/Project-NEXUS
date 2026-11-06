// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "You're registered and waiting for approval" — shown wherever a member who
 * cannot sign in yet, because their community approves new members, ends up:
 * the password sign-in page and, since E-121, the page a Google (or other
 * provider) sign-in returns to. One component so the two can never drift.
 *
 * 🔴 A way OUT, not just an explanation. A coordinator's words were that a
 * waiting member "would be better ... to be able to see something, even the
 * home page that they first saw". The explanation alone left them staring at a
 * form they could not pass — a dead end, on what is the normal experience of
 * joining a community that approves members. The community home page is a
 * public route, so it is offered first; contacting a coordinator is the
 * fallback.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import { Button } from '@/components/ui/Button';
import { useTenant } from '@/contexts/TenantContext';

export function PendingApprovalNotice() {
  const { t } = useTranslation('auth');
  const { tenantPath } = useTenant();

  return (
    <div className="flex items-start gap-2">
      <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div>
        <p className="text-theme-success font-medium">
          {t('login.pending_approval_title')}
        </p>
        <p className="text-theme-success text-xs mt-1">
          {t('login.pending_approval')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            as={Link}
            to={tenantPath('/')}
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          >
            {t('login.back_to_home')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            as={Link}
            to={tenantPath('/contact')}
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
          >
            {t('login.pending_approval_contact')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PendingApprovalNotice;
