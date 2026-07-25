// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MemberFilterSheet — phone-only bottom sheet holding every members-directory
 * filter (sort order + "Near me" radius).
 *
 * Built from the shared primitives: `FilterSheet` (draft archetype — footer with
 * "Clear all" + a live-count apply button) and `FilterChipGroup` sections, both
 * blue-accented to match `PublicPageHero accent="blue"` on this page. Works on a
 * DRAFT copy of the page filter state: taps update the draft and the footer's
 * live result count, but nothing refetches the visible grid until the apply
 * button commits.
 *
 * Two deliberate shapes:
 * - The desktop page's "Quick filters" row (All / New / Most Active) is a FACADE
 *   over `sortBy`, so the sheet exposes ONE combined sort group rather than two
 *   groups that render the same value twice. "Newest" is the old "New Members"
 *   and "Most Active" is the old "Most Active".
 * - Desktop splits proximity into a "Near me" toggle plus a dependent radius
 *   Select. The sheet collapses both into one distance group (Off + radii) so
 *   there is no disabled-until-you-tap-something-else dependency on a phone.
 *   That is the same shape `ListingFilterSheet` ships for distance.
 */

import { useTranslation } from 'react-i18next';

import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

export type MemberSortOption = 'communityrank' | 'name' | 'joined' | 'rating' | 'hours_given';

export interface MemberFilterDraft {
  sort: MemberSortOption;
  nearMe: boolean;
  radiusKm: number;
}

export interface MemberFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  draft: MemberFilterDraft;
  onDraftChange: (patch: Partial<MemberFilterDraft>) => void;
  /** Live count for the draft filters; null while unknown. */
  resultCount: number | null;
  onApply: () => void;
  onClearAll: () => void;
  /** Adds the Community Rank sort chip — only when the tenant runs that algorithm. */
  hasCommunityRank: boolean;
  /**
   * The signed-in user has coordinates. Without them the server cannot answer
   * `/v2/members/nearby`, so tapping a radius reports why instead of arming a
   * draft that would fail on apply.
   */
  canUseNearMe: boolean;
  /** Reports the "no location on your profile" failure (page owns the toast). */
  onNearMeUnavailable: () => void;
}

/** Same radius steps the desktop radius Select offers (common:radius_* keys). */
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS_KM = 25;

const ACCENT = 'blue';

export function MemberFilterSheet({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  resultCount,
  onApply,
  onClearAll,
  hasCommunityRank,
  canUseNearMe,
  onNearMeUnavailable,
}: MemberFilterSheetProps) {
  const { t } = useTranslation('common');

  function handleDistanceChange(key: string) {
    if (key === 'off') {
      onDraftChange({ nearMe: false });
      return;
    }
    if (!canUseNearMe) {
      onNearMeUnavailable();
      return;
    }
    onDraftChange({ nearMe: true, radiusKm: Number(key) || DEFAULT_RADIUS_KM });
  }

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('filter_bar.filters')}
      accent={ACCENT}
      resultCount={resultCount}
      onApply={onApply}
      onClearAll={onClearAll}
    >
      <div className="flex flex-col gap-6 pb-2">
        {/*
          Disabled while a radius is armed: /v2/members/nearby ignores sort
          entirely, which is exactly why the desktop sort Select carries
          isDisabled={isNearbyMode}.
        */}
        <FilterChipGroup
          accent={ACCENT}
          label={t('members.sort_by')}
          selected={draft.sort}
          isDisabled={draft.nearMe}
          options={[
            ...(hasCommunityRank
              ? [{ key: 'communityrank', label: t('members.sort_communityrank') }]
              : []),
            { key: 'name', label: t('members.sort_name') },
            { key: 'joined', label: t('members.sort_newest') },
            { key: 'rating', label: t('members.sort_rated') },
            { key: 'hours_given', label: t('members.sort_active') },
          ]}
          onChange={(key) => onDraftChange({ sort: key as MemberSortOption })}
          trailing={hasCommunityRank ? <AlgorithmLabel area="members" /> : undefined}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('members.near_me')}
          selected={draft.nearMe ? String(draft.radiusKm) : 'off'}
          options={[
            { key: 'off', label: t('proximity.off') },
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

export default MemberFilterSheet;
