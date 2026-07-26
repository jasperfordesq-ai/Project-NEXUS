// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceFilterSheet — phone-only bottom sheet holding the marketplace hub's
 * filters.
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer and no draft,
 * because the hub has exactly one filter dimension (category) and a tap applies
 * it immediately, then closes the sheet — the same shape as `FeedFilterSheet`.
 * A draft machine plus an apply footer for a single enum would be pure ceremony,
 * and the marketplace listings endpoint has no total in its meta, so a live
 * "Show N results" count is not available to justify one either.
 *
 * On phones the hub's inline `CategoryChips` row is hidden to reclaim vertical
 * space, so this sheet is the ONLY category entry point there — it does not
 * duplicate a visible control.
 *
 * Emerald accent to match `PublicPageHero accent="emerald"` on the hub page.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import type { MarketplaceCategory } from '@/types/marketplace';

/** Chip key standing in for "no category filter". */
const ALL_CATEGORIES = 'all';

const ACCENT = 'emerald';

export interface MarketplaceFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  categories: MarketplaceCategory[];
  /** Applied category id, or `undefined` for "All". */
  selectedCategoryId?: number;
  /** Applies immediately — there is no draft to commit. */
  onSelectCategory: (categoryId: number | undefined) => void;
}

export function MarketplaceFilterSheet({
  isOpen,
  onClose,
  categories,
  selectedCategoryId,
  onSelectCategory,
}: MarketplaceFilterSheetProps) {
  const { t } = useTranslation('marketplace');

  return (
    <FilterSheet isOpen={isOpen} onClose={onClose} title={t('filters.title')} accent={ACCENT}>
      {/* <div>, never <section>: glass.css paints sections inside a dialog opaque. */}
      <div className="flex flex-col gap-4 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('filters.category')}
          ariaLabel={t('categories.label')}
          selected={selectedCategoryId != null ? String(selectedCategoryId) : ALL_CATEGORIES}
          options={[
            { key: ALL_CATEGORIES, label: t('categories.all') },
            ...categories.map((category) => ({ key: String(category.id), label: category.name })),
          ]}
          onChange={(key) => {
            onSelectCategory(key === ALL_CATEGORIES ? undefined : Number(key));
            onClose();
          }}
        />
      </div>
    </FilterSheet>
  );
}

export default MarketplaceFilterSheet;
