// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Breadcrumbs - Structured navigation for detail pages
 *
 * Renders a chain of links: Home > Section > Current Page
 * Supports aria breadcrumb navigation for screen readers.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Home from 'lucide-react/icons/house';
import { useTenant } from '@/contexts/TenantContext';
import { isNavigationPathEnabled } from './navigationRegistry';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Whether to show a home icon at the start (default: true) */
  showHome?: boolean;
}

export function Breadcrumbs({ items, showHome = true }: BreadcrumbsProps) {
  const { t } = useTranslation('common');
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const visibleItems = items.filter((item) => (
    !item.href || isNavigationPathEnabled(item.href, { hasFeature, hasModule }, tenantPath(''))
  ));
  if (visibleItems.length === 0) return null;

  return (
    <nav aria-label={t('accessibility.breadcrumb')} className="mb-4">
      <ol className="flex items-center gap-1 text-sm overflow-x-auto">
        {showHome && (
          <li className="flex items-center">
            <Link
              to={tenantPath('/')}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-theme-subtle hover:text-theme-primary transition-colors"
              aria-label={t('nav.home')}
            >
              <Home className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
            <ChevronRight className="w-3 h-3 text-theme-subtle/50 mx-1" aria-hidden="true" />
          </li>
        )}

        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center">
              {isLast || !item.href ? (
                <span
                  className="text-theme-primary font-medium truncate max-w-[120px] sm:max-w-[200px]"
                  aria-current="page"
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <>
                  <Link
                    to={tenantPath(item.href)}
                    className="inline-flex items-center min-h-[44px] px-1 text-theme-subtle hover:text-theme-primary transition-colors"
                  >
                    {item.label}
                  </Link>
                  <ChevronRight className="w-3 h-3 text-theme-subtle/50 mx-1" aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
