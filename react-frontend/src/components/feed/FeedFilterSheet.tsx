// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FeedFilterSheet — phone-only bottom sheet holding every feed filter.
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer, because selecting
 * a filter applies it immediately. The sheet closes itself unless the chosen
 * filter has contextual sub-filters (e.g. Listings → Offers / Requests), in which
 * case it stays open so the sub-filter can be picked.
 *
 * Uses the theme accent (`accent`), not a page-specific hue.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { SubFilterChips } from '@/components/feed/SubFilterChips';
import type { FeedFilter } from '@/components/feed/types';

export interface FeedFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  options: { key: FeedFilter; label: string }[];
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
  /** Filters that reveal sub-filter chips inside the sheet when selected. */
  filtersWithSubFilters: ReadonlySet<FeedFilter>;
  subFilter: string | null;
  onSubFilterChange: (subFilter: string | null) => void;
}

export function FeedFilterSheet({
  isOpen,
  onClose,
  options,
  filter,
  onFilterChange,
  filtersWithSubFilters,
  subFilter,
  onSubFilterChange,
}: FeedFilterSheetProps) {
  const { t } = useTranslation('feed');

  return (
    <FilterSheet isOpen={isOpen} onClose={onClose} title={t('filter.filters')} accent="accent">
      <div className="flex flex-col gap-4">
        <FilterChipGroup
          accent="accent"
          ariaLabel={t('filter.select')}
          selected={filter}
          options={options}
          onChange={(key) => {
            const next = key as FeedFilter;
            onFilterChange(next);
            if (!filtersWithSubFilters.has(next)) onClose();
          }}
        />

        <SubFilterChips
          filter={filter}
          subFilter={subFilter}
          onSubFilterChange={(sf) => {
            onSubFilterChange(sf);
            onClose();
          }}
        />
      </div>
    </FilterSheet>
  );
}

export default FeedFilterSheet;
