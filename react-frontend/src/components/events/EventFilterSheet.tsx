// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * EventFilterSheet — phone-only bottom sheet holding every events-list filter
 * (when, category, step-free venue access, radius).
 *
 * Built from the shared primitives: `FilterSheet` (draft archetype — a pinned
 * footer with "Clear all" + an apply button) and amber-accented
 * `FilterChipGroup` sections, matching `PublicPageHero accent="amber"` on the
 * page. Works on a DRAFT copy of the page filter state: taps update the draft
 * only, and nothing refetches the visible list until the apply button is
 * pressed.
 *
 * NO LIVE RESULT COUNT ON PURPOSE. `GET /v2/events` answers through
 * `BaseApiController::respondWithCollection`, whose meta is only
 * `{ base_url, per_page, has_more, cursor }` — `total_items` appears nowhere in
 * `EventsController`, and the endpoint is deliberately cursor-paginated to avoid
 * a COUNT query. So `resultCount` is left unset, `useFilterDraft` is wired
 * without `countFor`, zero extra requests are issued, and the footer correctly
 * reads "Show results" instead of inventing a number.
 *
 * The month/agenda calendar date range is NOT a filter here: `changeView()`
 * writes `month`/`date`/`from`/`to` and `EventCalendarViews` owns them. A date
 * range does not fit the tap-once chip model, so it stays out of this sheet.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';
import type { EventCategory } from '@/lib/events-api';

export type EventWhenFilter = 'upcoming' | 'past' | 'all';
export type EventStepFreeFilter = 'any' | 'yes' | 'no' | 'unknown';

export interface EventFilterDraft {
  when: EventWhenFilter;
  /** `String(category.id)`, or the literal `'all'` sentinel. */
  category: string;
  stepFree: EventStepFreeFilter;
  proximity: ProximityFilterParams | null;
}

export interface EventFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  categories: EventCategory[];
  draft: EventFilterDraft;
  onDraftChange: (patch: Partial<EventFilterDraft>) => void;
  onApply: () => void;
  onClearAll: () => void;
}

/** Same radius steps the desktop ProximityFilter offers (events:radius_* keys). */
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS = 25;
const STEP_FREE_OPTIONS: readonly EventStepFreeFilter[] = ['any', 'yes', 'no', 'unknown'];

const ACCENT = 'amber';

export function EventFilterSheet({
  isOpen,
  onClose,
  categories,
  draft,
  onDraftChange,
  onApply,
  onClearAll,
}: EventFilterSheetProps) {
  const { t } = useTranslation(['events', 'event_accessibility', 'common']);
  const { user } = useAuth();
  const toast = useToast();

  /**
   * Mirrors the desktop ProximityFilter's guard: proximity uses the profile
   * coordinates (no geolocation prompt), so a member without them gets the same
   * toast instead of a chip that silently does nothing.
   */
  function handleDistanceChange(key: string) {
    if (key === 'off') {
      onDraftChange({ proximity: null });
      return;
    }
    if (user?.latitude == null || user?.longitude == null) {
      toast.error(t('near_me_no_location'));
      return;
    }
    onDraftChange({
      proximity: {
        near_lat: user.latitude,
        near_lng: user.longitude,
        radius_km: Number(key) || DEFAULT_RADIUS,
      },
    });
  }

  // No `resultCount` — see the "NO LIVE RESULT COUNT" note above.
  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent={ACCENT}
      onApply={onApply}
      onClearAll={onClearAll}
    >
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_when_label')}
          selected={draft.when}
          options={[
            { key: 'upcoming', label: t('filter_upcoming') },
            { key: 'past', label: t('filter_past') },
            { key: 'all', label: t('filter_all') },
          ]}
          onChange={(key) => onDraftChange({ when: key as EventWhenFilter })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_category_label')}
          selected={draft.category}
          options={[
            { key: 'all', label: t('category.all') },
            ...categories.map((cat) => ({ key: String(cat.id), label: cat.name })),
          ]}
          onChange={(key) => onDraftChange({ category: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('event_accessibility:filters.step_free_label')}
          selected={draft.stepFree}
          options={STEP_FREE_OPTIONS.map((option) => ({
            key: option,
            label: t(`event_accessibility:filters.step_free_options.${option}`),
          }))}
          onChange={(key) => onDraftChange({ stepFree: key as EventStepFreeFilter })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('radius_label')}
          selected={draft.proximity ? String(draft.proximity.radius_km) : 'off'}
          options={[
            { key: 'off', label: t('filter_any') },
            ...RADIUS_OPTIONS.map((km) => ({
              key: String(km),
              label: t(`radius_${km}`, { defaultValue: `${km} km` }),
            })),
          ]}
          onChange={handleDistanceChange}
        />
      </div>
    </FilterSheet>
  );
}

export default EventFilterSheet;
