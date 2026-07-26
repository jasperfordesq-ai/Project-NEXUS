// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ExchangeFilterSheet — phone-only bottom sheet holding the exchanges page's one
 * filter dimension: the exchange status that the desktop renders as a tab strip.
 *
 * The SIMPLE archetype of the shared `FilterSheet`: no footer, because picking a
 * status applies it immediately and closes the sheet. There is deliberately NO
 * draft machine and NO live result count — `GET /v2/exchanges` goes through
 * `respondWithCollection`, whose meta is only `{ base_url, per_page, has_more }`
 * (+ `cursor`), so there is no total to count with and a "Show N" footer would
 * have to be fabricated.
 *
 * Uses the theme accent (`accent`) — the page's own CTA and card hover colours are
 * the accent token, and it has no `PublicPageHero` to take a hue from.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

/**
 * The four status buckets, in the same order as the desktop `Tabs` in
 * `ExchangesPage`. Kept here so the sticky bar's label and the sheet's chips
 * cannot disagree.
 *
 * 🔴 These keys are sent verbatim as `?status=` (except `all`, which is omitted).
 * `pending_confirmation` is an exact status match; the service also understands
 * the alias `needs_confirmation` (= completed OR pending_confirmation). Do NOT
 * "helpfully" swap them — it changes which rows appear.
 *
 * If a status is added/removed here it must also be added/removed from the
 * desktop `<Tab>` list in `ExchangesPage`.
 */
export const EXCHANGE_STATUS_FILTERS = [
  { key: 'active', labelKey: 'tabs.active' },
  { key: 'pending_confirmation', labelKey: 'tabs.needs_confirmation' },
  { key: 'completed', labelKey: 'tabs.completed' },
  { key: 'all', labelKey: 'tabs.all' },
] as const;

export interface ExchangeFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Currently applied status key (may be an unrecognised value from `?status=`). */
  status: string;
  onStatusChange: (status: string) => void;
}

export function ExchangeFilterSheet({
  isOpen,
  onClose,
  status,
  onStatusChange,
}: ExchangeFilterSheetProps) {
  const { t } = useTranslation(['exchanges', 'common']);

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent="accent"
    >
      {/* One unlabelled chip row — the sheet title already names the section, and
          the four status names are self-describing (same shape as FeedFilterSheet). */}
      <div className="pb-2">
        <FilterChipGroup
          accent="accent"
          ariaLabel={t('tabs.aria_label')}
          selected={status}
          options={EXCHANGE_STATUS_FILTERS.map((option) => ({
            key: option.key,
            label: t(option.labelKey),
          }))}
          onChange={(key) => {
            onStatusChange(key);
            onClose();
          }}
        />
      </div>
    </FilterSheet>
  );
}

export default ExchangeFilterSheet;
