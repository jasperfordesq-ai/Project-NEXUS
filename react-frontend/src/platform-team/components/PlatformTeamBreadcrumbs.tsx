// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — breadcrumbs, built from the address.
 *
 * A segment with no wording of its own or in the admin menu shows as the
 * segment itself (`breadcrumbs.unknown`), so a newly mounted page is never
 * blank here.
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
  // No admin breadcrumb wording exists for these two.
  'search-analytics': 'breadcrumbs.search_analytics',
  '404-errors': 'breadcrumbs.errors_404',
  // The panel's own pages: named as on the home page and in the menu.
  'failed-jobs': 'home.card.failed_jobs',
  'phone-app': 'phone_app.title',
  // Pages that came from the super admin panel, or whose admin breadcrumb
  // wording would mislead: named with the wording their own menu entry uses.
  translation: 'super_admin:breadcrumbs.translation',
  'platform-capabilities': 'admin_nav:platform_capabilities',
  kiss: 'super_admin:nav.national_dashboard',
};

/**
 * Address steps that are not pages of their own (`/platform-team/seo` is
 * nothing; `/platform-team/seo/audit` is the page). They are shown as plain
 * text: a link would open the panel's "not in this panel" page.
 */
const NOT_A_PAGE = new Set([
  'seo', 'settings', 'analytics', 'platform', 'national', 'regional-analytics', 'builder', 'edit',
]);

export function PlatformTeamBreadcrumbs() {
  // All three are loaded here so a label never depends on the menu having
  // loaded its wording first. `t` still defaults to `platform_team`.
  const { t, i18n } = useTranslation(['platform_team', 'admin_nav', 'super_admin']);
  const location = useLocation();
  const { tenantSlug } = useTenant();

  // The moved pages keep the names they had in the admin panel: its
  // breadcrumb wording (`admin_nav:breadcrumbs.<segment>`) is reused, so there
  // is one name per page and nothing to translate twice.
  const labelFor = (segment: string): string => {
    const own = SEGMENT_LABEL_KEYS[segment];
    if (own) return String(t(own as never));

    const adminKey = `admin_nav:breadcrumbs.${segment.replace(/-/g, '_')}`;
    if (i18n.exists(adminKey)) return String(i18n.t(adminKey as never));

    return t('breadcrumbs.unknown', { segment });
  };

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
    const isLast = index === segments.length - 1;

    crumbs.push({
      label: labelFor(segment),
      href: isLast || NOT_A_PAGE.has(segment) ? undefined : currentPath,
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
            ) : index === crumbs.length - 1 ? (
              <span className="max-w-[12rem] truncate font-medium text-foreground sm:max-w-[18rem]">{crumb.label}</span>
            ) : (
              // A step that is not a page: plain text, not styled as the current page.
              <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default PlatformTeamBreadcrumbs;
