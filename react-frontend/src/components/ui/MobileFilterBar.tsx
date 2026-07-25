// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MobileFilterBar — the phone-only sticky control bar for a directory page
 * (Listings, Members, Events, …). Extracted verbatim from ListingsPage so every
 * directory page gets the same native-app bar instead of ten copies.
 *
 * Anatomy (top row, left → right):
 *   [ search pill ] [ Filters ⌄ N ] [ trailing slot (e.g. a view-mode toggle) ]
 * followed by the applied-filter chip row + "Clear all", hidden when nothing is
 * applied.
 *
 * Contract:
 * - Phone only. It carries `sm:hidden` as belt-and-braces, but the CALLER still
 *   decides whether to mount it (`const isPhone = useMediaQuery('(max-width: 639px)')`)
 *   so tablets/desktops never pay for its subtree.
 * - The caller owns the auto-hide state: pass `useHeaderScroll(64).isUtilityBarVisible`
 *   as `isVisible`. The bar translates/fades itself out and drops pointer events.
 * - Every user-facing label defaults to the shared `common:filter_bar.*`
 *   vocabulary; pass `labels` to override with entity-specific copy
 *   ("Show 23 listings" rather than "Show 23 results").
 */

import type { ReactNode } from 'react';
import Search from 'lucide-react/icons/search';
import ListFilter from 'lucide-react/icons/list-filter';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { filterAccentClasses, type FilterAccent } from '@/components/ui/filterAccent';

/** One removable chip in the applied-filter row. */
export interface MobileFilterBarChip {
  /** Stable React key, e.g. the filter name ('category'). */
  key: string;
  /** Human label shown inside the chip, e.g. the category name. */
  label: string;
  /** Clears just this filter. */
  onRemove: () => void;
}

export interface MobileFilterBarLabels {
  /** `aria-label` for the sticky region. Default `common:filter_bar.filter_form`. */
  region?: string;
  /** Visible text on the Filters button. Default `common:filter_bar.filters`. */
  filters?: string;
  /** `aria-label` for the Filters button. Default `common:filter_bar.more_filters`. */
  moreFilters?: string;
  /** Placeholder inside the search pill when the query is empty. Default `common:filter_bar.search`. */
  search?: string;
  /** "Clear all" action after the chip row. Default `common:filter_bar.clear_all`. */
  clearAll?: string;
  /** `aria-label` for the chip row. Default `common:filter_bar.active_filters`. */
  activeFilters?: string;
  /** `aria-label` for one chip's remove button. Default `common:filter_bar.remove_filter`. */
  removeFilter?: (filter: string) => string;
}

export interface MobileFilterBarProps {
  /** Auto-hide state — pass `useHeaderScroll(64).isUtilityBarVisible`. */
  isVisible: boolean;
  /** Opens the page's filter sheet. */
  onFiltersPress: () => void;
  /**
   * Badge count on the Filters button; also switches it to the solid accent
   * style. Defaults to `chips.length`, so the badge and the applied-chip row
   * can never disagree. Override only when the page legitimately counts
   * something the chips don't represent (e.g. the search query).
   */
  filterCount?: number;
  /** Provide to render the search pill; omit and the pill is not rendered at all. */
  onSearchPress?: () => void;
  /** Current query — shown in the pill (falls back to the placeholder when empty). */
  searchValue?: string;
  /** Right-hand slot, e.g. a view-mode `ToggleButtonGroup`. Omitting it leaves no gap. */
  trailing?: ReactNode;
  /** Applied filters as removable chips. Empty/omitted hides the whole row. */
  chips?: MobileFilterBarChip[];
  /** Clears every filter; the "Clear all" action is only rendered when provided. */
  onClearAll?: () => void;
  /** Per-page accent (Listings is `emerald`, Feed/default is `accent`). */
  accent?: FilterAccent;
  labels?: MobileFilterBarLabels;
  /** Extra classes on the sticky region. */
  className?: string;
  /** Optional `data-testid` on the sticky region. */
  testId?: string;
}

const REGION_CLASS =
  'sticky top-[calc(var(--safe-area-top)+3.5rem)] z-20 w-full min-w-0 max-w-full overflow-hidden border-y border-theme-default bg-[var(--surface-base)]/95 px-3 py-2 shadow-sm backdrop-blur-md transition-[transform,opacity] duration-200 sm:hidden';
const HIDDEN_CLASS = 'pointer-events-none -translate-y-3 opacity-0';
const SEARCH_PILL_CLASS =
  'h-10 min-w-0 flex-1 justify-start gap-2 rounded-full border border-theme-default bg-theme-elevated px-3.5 text-sm font-normal';
const FILTERS_BUTTON_CLASS = 'h-10 shrink-0 rounded-full px-3.5 text-sm font-medium';
const APPLIED_CHIP_CLASS =
  'inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium';

export function MobileFilterBar({
  isVisible,
  onFiltersPress,
  filterCount,
  onSearchPress,
  searchValue = '',
  trailing,
  chips,
  onClearAll,
  accent = 'accent',
  labels,
  className,
  testId,
}: MobileFilterBarProps) {
  const { t } = useTranslation('common');
  const tone = filterAccentClasses(accent);
  const appliedChips = chips ?? [];
  // One source of truth: an unspecified count is the number of applied chips, so
  // passing `chips` alone can never render the chip row while the Filters button
  // still looks idle.
  const badgeCount = filterCount ?? appliedChips.length;
  const isFiltered = badgeCount > 0;

  const regionClass = [REGION_CLASS, isVisible ? '' : HIDDEN_CLASS, className]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      aria-label={labels?.region ?? t('filter_bar.filter_form')}
      data-testid={testId}
      className={regionClass}
    >
      <div className="flex min-w-0 items-center gap-2">
        {onSearchPress && (
          <Button variant="flat" onPress={onSearchPress} className={SEARCH_PILL_CLASS}>
            <Search className="h-4 w-4 shrink-0 text-theme-subtle" aria-hidden="true" />
            <span className={`truncate ${searchValue ? 'text-theme-primary' : 'text-theme-subtle'}`}>
              {searchValue || labels?.search || t('filter_bar.search')}
            </span>
          </Button>
        )}
        <Button
          size="sm"
          variant="flat"
          onPress={onFiltersPress}
          aria-label={labels?.moreFilters ?? t('filter_bar.more_filters')}
          startContent={<ListFilter className="h-4 w-4 shrink-0" aria-hidden="true" />}
          className={`${FILTERS_BUTTON_CLASS} ${isFiltered ? tone.filtersButtonActive : tone.filtersButtonIdle}`}
        >
          {labels?.filters ?? t('filter_bar.filters')}
          {isFiltered && (
            <span className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-xs font-bold">
              {badgeCount}
            </span>
          )}
        </Button>
        {trailing}
      </div>

      {/* Applied filters as removable chips — visible without reopening the sheet. */}
      {appliedChips.length > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          aria-label={labels?.activeFilters ?? t('filter_bar.active_filters')}
        >
          {appliedChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              aria-label={
                labels?.removeFilter?.(chip.label) ?? t('filter_bar.remove_filter', { filter: chip.label })
              }
              className={`${APPLIED_CHIP_CLASS} ${tone.appliedChip}`}
            >
              <span className="max-w-32 truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="min-h-7 rounded-full px-2 text-xs font-medium text-theme-muted transition-colors hover:text-theme-primary"
            >
              {labels?.clearAll ?? t('filter_bar.clear_all')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default MobileFilterBar;
