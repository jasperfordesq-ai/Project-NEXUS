// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ResourceFilterSheet — phone-only bottom sheet holding the resources page's one
 * data filter (category).
 *
 * DRAFT archetype of the shared `FilterSheet`: taps mutate a draft copy only, so
 * the list behind the sheet does not refetch while the user experiments; the
 * footer's apply button is the single moment `selectedCategory` changes.
 *
 * `resultCount` is deliberately `null`. `/v2/resources` ends in
 * `respondWithCollection(...)`, whose meta is `{ base_url, per_page, has_more,
 * cursor? }` — there is no `total` / `total_items` to read, so the footer honestly
 * reads "Show results" rather than a made-up number (or, worse, the
 * loaded-so-far count).
 *
 * Categories arrive PRE-FLATTENED from the page: the desktop sidebar renders a
 * genuine tree, but a chip row cannot draw hierarchy, so the page flattens it
 * depth-first (children immediately follow their parent) and disambiguates
 * colliding child names with their parent's. Filtering semantics are unchanged —
 * the API matches `category_id` exactly, so a node's children were never
 * included by selecting the parent.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

/** The page's real filter state, snapshotted by `useFilterDraft`. */
export interface ResourceFilterDraft {
  category: number | null;
}

/** One selectable category, already flattened out of the tree by the page. */
export interface ResourceCategoryOption {
  id: number;
  /** Chip label — parent-prefixed when the bare name is ambiguous. */
  label: string;
}

/** Sentinel chip key for "no category filter" (the draft value is `null`). */
export const ALL_CATEGORIES_KEY = '__all__';

export interface ResourceFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Flattened category options — tree or flat fallback, the page decides which. */
  categoryOptions: ResourceCategoryOption[];
  draft: ResourceFilterDraft;
  onDraftChange: (patch: Partial<ResourceFilterDraft>) => void;
  onApply: () => void;
  onClearAll: () => void;
}

/** Matches `accent="amber"` on this page's `PublicPageHero` and its amber tree/upload accents. */
const ACCENT = 'amber';

export function ResourceFilterSheet({
  isOpen,
  onClose,
  categoryOptions,
  draft,
  onDraftChange,
  onApply,
  onClearAll,
}: ResourceFilterSheetProps) {
  const { t } = useTranslation(['utility', 'common']);

  const chipOptions = useMemo(
    () => [
      { key: ALL_CATEGORIES_KEY, label: t('resources.filter_all') },
      ...categoryOptions.map((option) => ({ key: String(option.id), label: option.label })),
    ],
    [categoryOptions, t],
  );

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent={ACCENT}
      onApply={onApply}
      onClearAll={onClearAll}
      // No total in this endpoint's meta — see the file header.
      resultCount={null}
    >
      {/* <div>, never <section>: glass.css paints every <section> inside a
          [role="dialog"] with an opaque solid background. */}
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('common:skills.categories')}
          ariaLabel={t('resources.filter_by_category')}
          selected={draft.category == null ? ALL_CATEGORIES_KEY : String(draft.category)}
          options={chipOptions}
          onChange={(key) =>
            onDraftChange({ category: key === ALL_CATEGORIES_KEY ? null : Number(key) })
          }
        />
      </div>
    </FilterSheet>
  );
}

export default ResourceFilterSheet;
