// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — breadcrumbs, built from the address.
 *
 * A segment with no entry in SEGMENT_LABEL_KEYS shows as the segment itself
 * (`breadcrumbs.unknown`), so a newly mounted page is never blank here.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ShieldCheck from 'lucide-react/icons/shield-check';

const SEGMENT_LABEL_KEYS: Record<string, string> = {
  'platform-team': 'breadcrumbs.root',
  create: 'breadcrumbs.create',
  edit: 'breadcrumbs.edit',
};

export function PlatformTeamBreadcrumbs() {
  const { t } = useTranslation('platform_team');
  const location = useLocation();
  const { tenantSlug } = useTenant();

  let path = location.pathname;
  if (tenantSlug && (path === `/${tenantSlug}` || path.startsWith(`/${tenantSlug}/`))) {
    path = path.slice(tenantSlug.length + 1);
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
            {index === 0 && <ShieldCheck size={14} className="mr-1 shrink-0" />}
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

export default PlatformTeamBreadcrumbs;
