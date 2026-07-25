// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VolunteeringFilterSheet — phone-only bottom sheet holding the volunteering
 * opportunities filters (distance + format).
 *
 * Built from the shared primitives: `FilterSheet` (DRAFT archetype — pinned
 * footer with "Clear all" + an apply button) and rose-accented
 * `FilterChipGroup` sections, matching `PublicPageHero accent="rose"`.
 *
 * Draft semantics: taps mutate a draft snapshot only, so the opportunity list
 * behind the sheet does not churn while the user experiments. Nothing refetches
 * until the footer's apply button commits.
 *
 * NO LIVE RESULT COUNT ON PURPOSE. `GET /v2/volunteering/opportunities` ends in
 * `BaseApiController::respondWithCollection`, whose meta is only
 * `{ base_url, per_page, has_more, cursor }` — there is no total. `resultCount`
 * therefore stays `null` and the footer correctly reads "Show results" rather
 * than a fabricated number. Do not add a `per_page=1` probe: it can only ever
 * report `1` plus `has_more`.
 *
 * Distance flattens the desktop `ProximityFilter` (a toggle plus a conditional
 * radius `Select`) into one tap-once chip row — the component itself is never
 * rendered here because it writes straight to page state and would bypass the
 * draft. The "no coordinates on your profile" toast is preserved.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';

/** `any` = no format filter; `remote` maps to the API's `is_remote=1`. */
export type VolunteeringFormat = 'any' | 'remote';

export interface VolunteeringFilterDraft {
  proximity: ProximityFilterParams | null;
  format: VolunteeringFormat;
}

/** What "Clear all" resets. Merged over the open draft by `useFilterDraft`. */
export const EMPTY_VOLUNTEERING_FILTER_DRAFT: Partial<VolunteeringFilterDraft> = {
  proximity: null,
  format: 'any',
};

export interface VolunteeringFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  draft: VolunteeringFilterDraft;
  onDraftChange: (patch: Partial<VolunteeringFilterDraft>) => void;
  onApply: () => void;
  onClearAll: () => void;
}

// Same radius steps the desktop ProximityFilter offers (common:radius_* keys).
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS = 25;

const ACCENT = 'rose';

export function VolunteeringFilterSheet({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  onApply,
  onClearAll,
}: VolunteeringFilterSheetProps) {
  const { t } = useTranslation(['volunteering', 'common']);
  const { user } = useAuth();
  const toast = useToast();

  function handleDistanceChange(key: string) {
    if (key === 'off') {
      onDraftChange({ proximity: null });
      return;
    }
    if (user?.latitude == null || user?.longitude == null) {
      toast.error(t('common:members.near_me_no_location'));
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

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent={ACCENT}
      // null → "Show results": this endpoint reports no total (see file header).
      resultCount={null}
      onApply={onApply}
      onClearAll={onClearAll}
    >
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_distance')}
          selected={draft.proximity ? String(draft.proximity.radius_km) : 'off'}
          options={[
            { key: 'off', label: t('filter_all') },
            ...RADIUS_OPTIONS.map((km) => ({
              key: String(km),
              label: t(`common:radius_${km}`, { defaultValue: `${km} km` }),
            })),
          ]}
          onChange={handleDistanceChange}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_format')}
          selected={draft.format}
          options={[
            { key: 'any', label: t('filter_all') },
            { key: 'remote', label: t('remote') },
          ]}
          onChange={(key) => onDraftChange({ format: key as VolunteeringFormat })}
        />
      </div>
    </FilterSheet>
  );
}

export default VolunteeringFilterSheet;
