// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Visiting-manager banner — a permanent notice that this account is looking
 * around a community it manages from above, not taking part as a member.
 *
 * Owner, 15 Oct 2026: a tenant super admin should "be able to browse the
 * children so he can see what's going on", with "strict rules to stop any
 * confusion, like acting as an ordinary member on the site". The server
 * refuses every member action from a visitor (CrossTenantEntry); this banner
 * says so before anyone tries, and explains the refusal when someone does.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { isVisitingManager } from '@/lib/access';
import { VISITOR_READ_ONLY_EVENT } from '@/lib/api';

export function VisitingManagerBanner() {
  const { t } = useTranslation('common');
  const { user, isAuthenticated } = useAuth();
  const { tenant, tenantPath } = useTenant();
  const { warning } = useToast();
  const lastToastAt = useRef(0);
  const visiting = isAuthenticated && isVisitingManager(user, tenant?.id);

  useEffect(() => {
    if (!visiting) return undefined;
    const handleRefused = () => {
      const now = Date.now();
      if (now - lastToastAt.current < 4000) return;
      lastToastAt.current = now;
      warning(t('visiting_manager.refused_title'), t('visiting_manager.refused_body'));
    };
    window.addEventListener(VISITOR_READ_ONLY_EVENT, handleRefused);
    return () => window.removeEventListener(VISITOR_READ_ONLY_EVENT, handleRefused);
  }, [visiting, warning, t]);

  if (!visiting) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[10000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[var(--color-warning)] px-4 py-2 text-sm font-medium text-black"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t('visiting_manager.banner', { community: tenant?.name ?? '' })}</span>
      <span>{t('visiting_manager.read_only')}</span>
      <Link to={tenantPath('/admin')} className="underline underline-offset-2">
        {t('visiting_manager.open_admin')}
      </Link>
    </div>
  );
}

export default VisitingManagerBanner;
