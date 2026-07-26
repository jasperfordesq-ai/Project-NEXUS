// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BlogFilterSheet — phone-only bottom sheet holding the blog's single filter
 * dimension (category).
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no `onApply`, so no footer.
 * Blog has exactly ONE filter, so a draft machine would add two taps (open →
 * tap → Apply) for zero benefit, and `GET /v2/blog` responds through
 * `respondWithCollection`, whose meta is only `{base_url, per_page, has_more,
 * cursor}` — there is no total to power a live "Show N posts" count. Selecting a
 * category therefore applies immediately and closes the sheet, exactly like
 * `FeedFilterSheet`.
 *
 * Accent is `blue` to match the `accent="blue"` the page passes to
 * `PublicPageHero` on tablet/desktop.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

const ACCENT = 'blue' as const;

/** The subset of `BlogCategory` this sheet needs. */
export interface BlogFilterCategory {
  id: number;
  name: string;
  post_count: number;
}

export interface BlogFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  categories: BlogFilterCategory[];
  /** Selected category id, or `null` for "All". */
  selectedCategory: number | null;
  onCategoryChange: (categoryId: number | null) => void;
}

export function BlogFilterSheet({
  isOpen,
  onClose,
  categories,
  selectedCategory,
  onCategoryChange,
}: BlogFilterSheetProps) {
  const { t } = useTranslation(['blog', 'common']);

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent={ACCENT}
    >
      {/* <div>, never <section>: glass.css paints every <section> inside a
          [role="dialog"] with an opaque solid background. */}
      <div className="flex flex-col gap-4 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          ariaLabel={t('filter_by_category')}
          selected={selectedCategory === null ? 'all' : String(selectedCategory)}
          options={[
            { key: 'all', label: t('filter_all') },
            ...categories.map((cat) => ({
              key: String(cat.id),
              // Count suffix mirrors the tablet/desktop chip row. Category names
              // are unbounded tenant data, never translatable copy.
              label: cat.post_count > 0 ? `${cat.name} (${cat.post_count})` : cat.name,
            })),
          ]}
          onChange={(key) => {
            onCategoryChange(key === 'all' ? null : Number(key));
            onClose();
          }}
        />
      </div>
    </FilterSheet>
  );
}

export default BlogFilterSheet;
