// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FilterSheet — thin shell over `BottomSheet` for the two filter-sheet archetypes
 * every directory page needs.
 *
 * 1. DRAFT archetype (Listings): pass `onApply`. A pinned footer renders
 *    "Clear all" (only when `onClearAll` is given) + a primary apply button
 *    labelled from the live draft count ("Show 23 results", or "Show results"
 *    when the count is unknown — which is the correct label for the six
 *    endpoints whose meta has no total). Pair it with `useFilterDraft` so
 *    nothing applies until the button is pressed.
 *
 * 2. SIMPLE archetype (Feed): omit `onApply`. No footer is rendered; each tap
 *    applies immediately and the page closes the sheet itself.
 *
 * SUB-VIEWS: pass `subView` (e.g. a searchable category list) and it replaces the
 * body; the footer's left button becomes "Back" and calls `onBack`. This works in
 * BOTH archetypes — a simple sheet gets a Back-only footer so the sub-view is
 * escapable without discarding the sheet. That is the whole mechanism —
 * deliberately not a router.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet, type BottomSheetProps } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { filterAccentClasses, type FilterAccent } from '@/components/ui/filterAccent';

export interface FilterSheetLabels {
  /** Footer's left action in the main view. Default `common:filter_bar.clear_all`. */
  clearAll?: string;
  /** Footer's left action while a sub-view is open. Default `common:filter_bar.back`. */
  back?: string;
  /** Apply-button label for a known count. Default `common:filter_bar.show_results` (pluralised). */
  showResults?: (count: number) => string;
  /** Apply-button label when the count is unknown. Default `common:filter_bar.show_results_unknown`. */
  showResultsUnknown?: string;
}

export interface FilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Visible sheet title and accessible dialog name. */
  title: string;
  /** Main body — typically a stack of `FilterChipGroup`s. */
  children: ReactNode;
  /** Draft archetype: commits the draft. Omit for the simple (immediate-apply) archetype. */
  onApply?: () => void;
  /** Footer's left action in the main view. Omit it and no secondary button is rendered. */
  onClearAll?: () => void;
  /** Live count for the apply button; `null`/omitted renders the unknown-count label. */
  resultCount?: number | null;
  /**
   * When set to a renderable node, replaces `children` and turns the footer's
   * left button into "Back". Falsy nodes (`false`, `''`, `null`) mean "no
   * sub-view", so `subView={isSearching && <List/>}` is safe.
   */
  subView?: ReactNode;
  /** Required whenever `subView` can be set — returns to the main view. */
  onBack?: () => void;
  /** Per-page accent (Listings is `emerald`, Feed/default is `accent`). */
  accent?: FilterAccent;
  labels?: FilterSheetLabels;
  snapPoints?: BottomSheetProps['snapPoints'];
  /** Extra classes on the sheet surface. */
  className?: string;
}

/**
 * True only for a node React would actually paint. `null`/`undefined` are the
 * explicit "no sub-view" values; `false` and `''` are what `cond && <View/>` and
 * `str && <View/>` collapse to, and neither means "a sub-view is open".
 */
function isRenderableNode(node: ReactNode): boolean {
  return node != null && node !== false && node !== '';
}

const SECONDARY_BUTTON_CLASS =
  'min-h-12 shrink-0 rounded-xl bg-theme-elevated px-4 font-medium text-theme-primary';
const APPLY_BUTTON_CLASS = 'min-h-12 min-w-0 flex-1 rounded-xl font-semibold';

export function FilterSheet({
  isOpen,
  onClose,
  title,
  children,
  onApply,
  onClearAll,
  resultCount = null,
  subView,
  onBack,
  accent = 'accent',
  labels,
  snapPoints,
  className,
}: FilterSheetProps) {
  const { t } = useTranslation('common');
  const tone = filterAccentClasses(accent);
  // `subView={cond && <View/>}` is the idiomatic React spelling, so a falsy
  // non-element node (`false` / `''`) must NOT count as an open sub-view —
  // otherwise the body renders nothing and the footer silently swaps
  // "Clear all" for a dead "Back".
  const isSubView = isRenderableNode(subView);

  const applyLabel = resultCount != null
    ? (labels?.showResults?.(resultCount) ?? t('filter_bar.show_results', { count: resultCount }))
    : (labels?.showResultsUnknown ?? t('filter_bar.show_results_unknown'));

  // The secondary action only exists when the current view has a handler for it,
  // so a page with a single filter dimension (no sensible clear-all) never ships
  // a visible, focusable button that does nothing.
  const secondaryPress = isSubView ? onBack : onClearAll;
  const secondaryLabel = isSubView
    ? (labels?.back ?? t('filter_bar.back'))
    : (labels?.clearAll ?? t('filter_bar.clear_all'));

  // A sub-view needs its Back affordance in BOTH archetypes — a simple
  // (immediate-apply) sheet that opens a searchable long list must be able to
  // get back without discarding the whole sheet. Never render an empty footer.
  const footer = onApply || (isSubView && onBack) ? (
    <div className="flex items-center gap-3">
      {secondaryPress && (
        <Button variant="flat" onPress={secondaryPress} className={SECONDARY_BUTTON_CLASS}>
          {secondaryLabel}
        </Button>
      )}
      {onApply && (
        <Button
          variant="solid"
          onPress={onApply}
          className={`${APPLY_BUTTON_CLASS} ${tone.applyButton}`}
        >
          <span className="truncate">{applyLabel}</span>
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      snapPoints={snapPoints}
      className={className}
    >
      {isSubView ? subView : children}
    </BottomSheet>
  );
}

export default FilterSheet;
