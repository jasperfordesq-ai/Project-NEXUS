// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FeedFilterSheet — phone-only bottom sheet holding every feed filter.
 *
 * Selecting a filter applies it immediately; the sheet closes itself unless
 * the chosen filter has contextual sub-filters (e.g. Listings → Offers /
 * Requests), in which case it stays open so the sub-filter can be picked.
 */

import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
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
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('filter.filters')}>
      <div className="flex flex-col gap-4">
        <ToggleButtonGroup
          aria-label={t('filter.select')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={new Set<Key>([filter])}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            if (!key) return;
            const next = key as FeedFilter;
            onFilterChange(next);
            if (!filtersWithSubFilters.has(next)) onClose();
          }}
          className="flex w-full flex-wrap items-center justify-start gap-2 p-0"
        >
          {options.map((opt) => (
            <ToggleButton
              key={opt.key}
              id={opt.key}
              variant="ghost"
              className="min-h-11 shrink-0 rounded-full border border-theme-default bg-theme-elevated px-4 text-theme-muted transition-colors hover:bg-accent/5 hover:text-accent data-[selected=true]:border-transparent data-[selected=true]:bg-accent data-[selected=true]:text-white data-[selected=true]:shadow-sm"
            >
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <SubFilterChips
          filter={filter}
          subFilter={subFilter}
          onSubFilterChange={(sf) => {
            onSubFilterChange(sf);
            onClose();
          }}
        />
      </div>
    </BottomSheet>
  );
}

export default FeedFilterSheet;
