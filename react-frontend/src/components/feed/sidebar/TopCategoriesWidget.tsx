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
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour } from '@/lib/categoryColours';

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

// The first chip is the community colour itself; the rest take the colours
// that go with it (`paletteFor`: its own family and the opposite side of the
// wheel), as soft bands — the -800 shade on -100, 6:1 or better; the -600 text
// on a -500/10 tint measured 3.3–4.5:1 (axe, 9 Nov 2026). Until 12 Nov 2026
// the rest was one fixed list (pink, green, amber…) whatever the community chose.
const ACCENT_CHIP = 'bg-accent-soft text-accent-soft-foreground';

export function TopCategoriesWidget({ categories }: TopCategoriesWidgetProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');
  const palette = useSitePalette();
  const chipClasses = (idx: number) =>
    idx === 0 ? ACCENT_CHIP : categoryColour(palette[(idx - 1) % palette.length]).band;

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
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition duration-200 hover:brightness-95 ${chipClasses(idx)}`}
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
