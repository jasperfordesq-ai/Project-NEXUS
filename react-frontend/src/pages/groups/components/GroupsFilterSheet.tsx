// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupsFilterSheet — phone-only bottom sheet holding the Groups directory's one
 * filter dimension (scope + visibility: all | joined | public | private).
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer and deliberately no
 * draft machine. The four options are one mutually exclusive enum, so deferring a
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
}

export function GroupsFilterSheet({
  isOpen,
  onClose,
  filter,
  options,
  onFilterChange,
}: GroupsFilterSheetProps) {
  const { t } = useTranslation('groups');

  return (
    <FilterSheet isOpen={isOpen} onClose={onClose} title={t('filters_aria')} accent="indigo">
      {/* FilterChipGroup renders a <div>, never a <section>: glass.css paints every
          <section> inside a [role="dialog"] with an opaque solid background. */}
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
    </FilterSheet>
  );
}

export default GroupsFilterSheet;
