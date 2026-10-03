// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Breadcrumbs
 * Auto-generates breadcrumbs from the current URL path.
 *
 * A numeric segment is the record a detail page shows: it becomes the
 * current crumb, named by the page through BrokerBreadcrumbContext or by
 * its id (`#42`) until the page has named it. Segments that only redirect
 * (`safeguarding`, `moderation`) are plain text — a link there went
 * nowhere the broker meant to go.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import ChevronRight from 'lucide-react/icons/chevron-right';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import { useBrokerBreadcrumbRecordLabel } from '../BrokerBreadcrumbContext';

const SEGMENT_LABELS: Record<string, string> = {
  broker: 'breadcrumbs.dashboard',
  members: 'breadcrumbs.members',
  onboarding: 'breadcrumbs.onboarding',
  safeguarding: 'breadcrumbs.safeguarding',
  'safeguarding-options': 'breadcrumbs.safeguarding_options',
  'support-needs': 'nav.safeguarding_support_needs',
  guardians: 'nav.safeguarding_guardians',
  'support-actions': 'nav.safeguarding_support_actions',
  volunteering: 'nav.safeguarding_volunteering',
  vetting: 'breadcrumbs.vetting',
  exchanges: 'breadcrumbs.exchanges',
  'match-approvals': 'breadcrumbs.match_approvals',
  messages: 'breadcrumbs.messages',
  moderation: 'breadcrumbs.moderation',
  queue: 'breadcrumbs.moderation_queue',
  feed: 'breadcrumbs.moderation_feed',
  comments: 'breadcrumbs.moderation_comments',
  reviews: 'breadcrumbs.moderation_reviews',
  reports: 'breadcrumbs.moderation_reports',
  monitoring: 'breadcrumbs.monitoring',
  'risk-tags': 'breadcrumbs.risk_tags',
  insurance: 'breadcrumbs.insurance',
  archives: 'breadcrumbs.archives',
  configuration: 'breadcrumbs.configuration',
  help: 'breadcrumbs.help',
};

/** Paths that only redirect to a child page (routes.tsx), so never worth a link. */
const REDIRECT_ONLY_SEGMENTS = new Set(['safeguarding', 'moderation']);

interface Crumb {
  key: string;
  label: string;
  href?: string;
}

export function BrokerBreadcrumbs() {
  const { t } = useTranslation('broker');
  const location = useLocation();
  const { tenantSlug } = useTenant();
  const recordLabel = useBrokerBreadcrumbRecordLabel();

  let path = location.pathname;
  if (tenantSlug) {
    path = path.replace(`/${tenantSlug}`, '');
  }

  const segments = path.split('/').filter(Boolean);
  const crumbs: Crumb[] = [];

  let currentPath = tenantSlug ? `/${tenantSlug}` : '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    currentPath += `/${segment}`;
    const isLast = i === segments.length - 1;

    if (/^\d+$/.test(segment)) {
      // The record itself: the page's name for it, or its id meanwhile.
      const label = isLast && recordLabel ? recordLabel : `#${segment}`;
      crumbs.push({ key: `record-${segment}`, label, href: isLast ? undefined : currentPath });
      continue;
    }

    const labelKey = SEGMENT_LABELS[segment];
    const label = labelKey
      ? t(labelKey)
      : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    const linkable = !isLast && !REDIRECT_ONLY_SEGMENTS.has(segment);

    crumbs.push({ key: segment, label, href: linkable ? currentPath : undefined });
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label={t('breadcrumbs.aria_label')} className="mb-4 max-w-full overflow-x-auto pb-1">
      <ol className="flex w-max max-w-full items-center gap-1.5 text-sm text-muted">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <li key={crumb.key} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight size={14} className="shrink-0 text-muted/70" />}
              {index === 0 && <LayoutDashboard size={14} className="mr-1 shrink-0" />}
              {crumb.href ? (
                <Link to={crumb.href} className="max-w-[9rem] truncate hover:text-foreground transition-colors sm:max-w-[14rem]">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`truncate ${isCurrent ? 'max-w-[12rem] font-medium text-foreground sm:max-w-[18rem]' : 'max-w-[9rem] sm:max-w-[14rem]'}`}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default BrokerBreadcrumbs;
