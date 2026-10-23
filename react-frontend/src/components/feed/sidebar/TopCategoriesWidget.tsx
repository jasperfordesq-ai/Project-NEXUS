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

const COLOR_CLASSES = [
  'bg-accent/10 text-accent dark:text-accent hover:bg-accent/20',
  'bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20',
  'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20',
  'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20',
  'bg-lime-500/10 text-lime-600 dark:text-lime-400 hover:bg-lime-500/20',
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
