// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Breadcrumbs
 * Auto-generates breadcrumbs for the dedicated super-admin route area.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import ChevronRight from 'lucide-react/icons/chevron-right';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';

const SEGMENT_LABEL_KEYS: Record<string, string> = {
  'super-admin': 'breadcrumbs.super_admin',
  tenants: 'breadcrumbs.tenants',
  create: 'breadcrumbs.create',
  edit: 'breadcrumbs.edit',
  hierarchy: 'breadcrumbs.hierarchy',
  users: 'breadcrumbs.users',
  bulk: 'breadcrumbs.bulk',
  audit: 'breadcrumbs.audit',
  federation: 'breadcrumbs.federation',
  whitelist: 'breadcrumbs.whitelist',
  partnerships: 'breadcrumbs.partnerships',
  tenant: 'breadcrumbs.tenant',
  features: 'breadcrumbs.features',
  billing: 'breadcrumbs.billing',
  revenue: 'breadcrumbs.revenue',
  platform: 'breadcrumbs.platform',
  'pilot-inquiries': 'breadcrumbs.pilot_inquiries',
  translation: 'breadcrumbs.translation',
  'provisioning-requests': 'breadcrumbs.provisioning_requests',
  national: 'breadcrumbs.national',
  kiss: 'breadcrumbs.kiss',
  'regional-analytics': 'breadcrumbs.regional_analytics',
  subscriptions: 'breadcrumbs.subscriptions',
};

export function SuperAdminBreadcrumbs() {
  const { t } = useTranslation('super_admin');
  const location = useLocation();
  const { tenantSlug } = useTenant();

  let path = location.pathname;
  if (tenantSlug) {
    path = path.replace(`/${tenantSlug}`, '');
  }

  const segments = path.split('/').filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [];
  let currentPath = tenantSlug ? `/${tenantSlug}` : '';

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!segment || /^\d+$/.test(segment)) continue;

    currentPath += `/${segment}`;
    const labelKey = SEGMENT_LABEL_KEYS[segment] ?? 'breadcrumbs.unknown';
    const isLast = index === segments.length - 1;

    crumbs.push({
      label: t(labelKey, { segment }),
      href: isLast ? undefined : currentPath,
    });
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label={t('breadcrumbs.aria_label')} className="mb-4 max-w-full overflow-x-auto pb-1">
      <ol className="flex w-max max-w-full items-center gap-1.5 text-sm text-muted">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight size={14} className="shrink-0 text-muted/70" />}
            {index === 0 && <LayoutDashboard size={14} className="mr-1 shrink-0" />}
            {crumb.href ? (
              <Link to={crumb.href} className="max-w-[9rem] truncate transition-colors hover:text-foreground sm:max-w-[14rem]">
                {crumb.label}
              </Link>
            ) : (
              <span className="max-w-[12rem] truncate font-medium text-foreground sm:max-w-[18rem]">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default SuperAdminBreadcrumbs;
