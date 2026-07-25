// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VolunteeringSectionsSheet — phone-only section picker for the volunteering page.
 *
 * Volunteering is not a single directory: it is up to sixteen sections behind one
 * `ToggleButtonGroup` that WRAPS on a phone (five primary pills over ~3 rows,
 * plus a "More (11)" disclosure that unfurls ~6 more rows). That tab wall, not
 * the hero, is the tallest piece of chrome on the page, so on phones the pills
 * are replaced by a single control that opens this sheet.
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer, because choosing a
 * section navigates immediately and the sheet closes itself. Rose-accented to
 * match `PublicPageHero accent="rose"`.
 *
 * Desktop and tablet keep the original pills untouched — this component is only
 * ever mounted behind the page's `isPhone` gate.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

export interface VolunteeringSectionOption {
  key: string;
  label: string;
}

export interface VolunteeringSectionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Every section the viewer may see, already filtered by auth + tenant config. */
  sections: VolunteeringSectionOption[];
  activeSection: string;
  /** Switches section; the sheet closes itself straight after. */
  onSelect: (key: string) => void;
}

const ACCENT = 'rose';

export function VolunteeringSectionsSheet({
  isOpen,
  onClose,
  sections,
  activeSection,
  onSelect,
}: VolunteeringSectionsSheetProps) {
  const { t } = useTranslation('volunteering');
  const label = t('aria.volunteering_sections');

  return (
    <FilterSheet isOpen={isOpen} onClose={onClose} title={label} accent={ACCENT}>
      <FilterChipGroup
        accent={ACCENT}
        ariaLabel={label}
        selected={activeSection}
        options={sections}
        onChange={(key) => {
          onSelect(key);
          onClose();
        }}
      />
    </FilterSheet>
  );
}

export default VolunteeringSectionsSheet;
