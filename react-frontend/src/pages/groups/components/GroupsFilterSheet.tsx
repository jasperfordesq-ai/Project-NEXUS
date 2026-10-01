// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupsFilterSheet — phone-only bottom sheet holding the Groups directory's
 * filters: scope + visibility (all | joined | public | private) and, when the
 * community defines any, the group type.
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer and deliberately no
 * draft machine. Each dimension is one mutually exclusive enum, so deferring a
 * single tap behind an Apply button would cost an extra tap and deliver nothing,
 * and the endpoint (`GET /v2/groups`, `respondWithCollection`) exposes no total to
 * drive a live "Show N" count anyway. Each tap commits immediately and closes the
 * sheet — exactly like `FeedFilterSheet`.
 *
 * Accent is `indigo` to match `PublicPageHero accent="indigo"` on GroupsPage
 * (`indigo` is an alias of the tenant theme accent in `filterAccent`).
 *
 * Every label comes from the caller or the shared `common:filter_bar.*`
 * vocabulary, so this sheet adds no i18n keys of its own.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup, type FilterChipOption } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

export interface GroupsFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Currently applied filter key. */
  filter: string;
  /** Available options — the caller drops "joined" for guests. */
  options: FilterChipOption[];
  /** Commits the tapped filter; the sheet closes itself straight afterwards. */
  onFilterChange: (key: string) => void;
  /** Section heading for the group-type chips. */
  typeLabel?: string;
  /** Currently applied type key. */
  typeFilter?: string;
  /** Type options including the "all types" entry; empty hides the section. */
  typeOptions?: FilterChipOption[];
  /** Commits the tapped type; the sheet closes itself straight afterwards. */
  onTypeChange?: (key: string) => void;
}

export function GroupsFilterSheet({
  isOpen,
  onClose,
  filter,
  options,
  onFilterChange,
  typeLabel,
  typeFilter,
  typeOptions = [],
  onTypeChange,
}: GroupsFilterSheetProps) {
  const { t } = useTranslation('groups');

  return (
    <FilterSheet isOpen={isOpen} onClose={onClose} title={t('filters_aria')} accent="indigo">
      {/* FilterChipGroup renders a <div>, never a <section>: glass.css paints every
          <section> inside a [role="dialog"] with an opaque solid background. */}
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent="indigo"
          ariaLabel={t('filters_aria')}
          selected={filter}
          options={options}
          onChange={(key) => {
            onFilterChange(key);
            onClose();
          }}
        />
        {typeOptions.length > 0 && typeFilter !== undefined && onTypeChange && (
          <FilterChipGroup
            accent="indigo"
            label={typeLabel}
            ariaLabel={typeLabel}
            selected={typeFilter}
            options={typeOptions}
            onChange={(key) => {
              onTypeChange(key);
              onClose();
            }}
          />
        )}
      </div>
    </FilterSheet>
  );
}

export default GroupsFilterSheet;
