// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Related Pages - Cross-navigation strip for About sub-pages
 *
 * Displays links to sibling pages within the About section,
 * excluding the current page.
 */

import { Link } from 'react-router-dom';
import BookOpen from 'lucide-react/icons/book-open';
import Handshake from 'lucide-react/icons/handshake';
import Stethoscope from 'lucide-react/icons/stethoscope';
import TrendingUp from 'lucide-react/icons/trending-up';
import BarChart3 from 'lucide-react/icons/chart-column';
import Compass from 'lucide-react/icons/compass';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

interface AboutLink {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Universal about pages — shown for all tenants
const universalAboutPages: AboutLink[] = [
  { href: '/timebanking-guide', icon: BookOpen },
];

// Tenant 2 (hOUR Timebank) specific pages — contain hardcoded org content
const hourTimebankAboutPages: AboutLink[] = [
  { href: '/partner', icon: Handshake },
  { href: '/social-prescribing', icon: Stethoscope },
  { href: '/impact-summary', icon: TrendingUp },
  { href: '/impact-report', icon: BarChart3 },
  { href: '/strategic-plan', icon: Compass },
];

interface RelatedPagesProps {
  /** The href of the current page (e.g. '/timebanking-guide') — will be excluded from the list */
  current: string;
}

export function RelatedPages({ current }: RelatedPagesProps) {
  const { t } = useTranslation('about');
  const { tenant, tenantPath } = useTenant();
  const isHourTimebank = tenant?.slug === 'hour-timebank';
  const aboutPages = [
    ...universalAboutPages,
    ...(isHourTimebank ? hourTimebankAboutPages : []),
  ];
  const links = aboutPages.filter((p) => p.href !== current);
  // Most communities have only the one guide page, so there is nothing to relate it to.
  if (links.length === 0) return null;

  return (
    <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-sm font-semibold text-theme-subtle uppercase tracking-wider mb-4 px-1">
          {t('related.heading')}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {links.map((link) => (
            <Link key={link.href} to={tenantPath(link.href)}>
              <GlassCard className="p-4 flex items-center gap-3 group hover:scale-[1.01] transition-transform h-full">
                <div className="flex-shrink-0 p-2 rounded-lg bg-accent/10">
                  <link.icon className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-theme-primary truncate">{t(`related.link_${link.href.replace('/', '')}_label`)}</p>
                  <p className="text-xs text-theme-subtle truncate">{t(`related.link_${link.href.replace('/', '')}_description`)}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-theme-subtle group-hover:text-accent transition-colors flex-shrink-0" aria-hidden="true" />
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
