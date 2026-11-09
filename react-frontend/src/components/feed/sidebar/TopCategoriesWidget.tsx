// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * TopCategoriesWidget - Shows trending categories as colored chips
 */

import { Link } from 'react-router-dom';
import Flame from 'lucide-react/icons/flame';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

export interface Category {
  id: number;
  name: string;
  /** The listings page and `GET /v2/listings` filter `?category=` by slug, never by id. */
  slug: string;
  count: number;
}

interface TopCategoriesWidgetProps {
  categories: Category[];
}

// A pale tint with the colour's deep shade (-800 on -100, 6:1 or better);
// the -600 text on a -500/10 tint measured 3.3–4.5:1 (axe, 9 Nov 2026).
const COLOR_CLASSES = [
  'bg-accent-soft text-accent-soft-foreground hover:brightness-95',
  'bg-pink-100 text-pink-800 hover:bg-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:hover:bg-pink-500/25',
  'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25',
  'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25',
  'bg-violet-100 text-violet-800 hover:bg-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25',
  'bg-cyan-100 text-cyan-800 hover:bg-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:hover:bg-cyan-500/25',
  'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25',
  'bg-lime-100 text-lime-800 hover:bg-lime-200 dark:bg-lime-500/15 dark:text-lime-300 dark:hover:bg-lime-500/25',
];

export function TopCategoriesWidget({ categories }: TopCategoriesWidgetProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');

  if (categories.length === 0) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {t('sidebar.categories.title')}
          </h3>
        </div>
        <Link
          to={tenantPath('/listings')}
          className="text-xs text-accent hover:text-accent transition-colors duration-200"
        >
          {t('sidebar.categories.all_listings')}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((category, idx) => (
          <Link
            key={category.id}
            to={tenantPath(`/listings?category=${encodeURIComponent(category.slug)}`)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 ${
              COLOR_CLASSES[idx % COLOR_CLASSES.length]
            }`}
          >
            {category.name}
            <span className="opacity-70">({category.count})</span>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

export default TopCategoriesWidget;
