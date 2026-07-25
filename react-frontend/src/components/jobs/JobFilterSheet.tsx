// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * JobFilterSheet — phone-only bottom sheet holding every browse filter of the
 * jobs directory (type, commitment, sort, remote-only).
 *
 * Built from the shared primitives: `FilterSheet` in its DRAFT archetype (footer
 * with "Clear all" + a live-count apply button) plus `FilterChipGroup` sections.
 * It works on a DRAFT copy of the page's filter state — taps update the draft and
 * the footer's live result count, but the list behind the sheet does not refetch
 * until the apply button commits the draft.
 *
 * Modelled on `FeedFilterSheet` rather than `ListingFilterSheet`: jobs has no
 * category tree and no proximity filter, so there is no sub-view and no
 * searchable drill-in.
 *
 * Copy: the sheet chrome deliberately falls back to the shared
 * `common:filter_bar.*` vocabulary ("Filters", "Clear all", "Show N results")
 * instead of duplicating it into the jobs namespace. Only the section headings
 * are jobs-specific, and each reuses a key the namespace already ships.
 */

import { useTranslation } from 'react-i18next';

import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';

/** The jobs browse filters, as a snapshot the sheet may mutate freely. */
export interface JobFilterDraft {
  type: string;
  commitment: string;
  sort: string;
  remoteOnly: boolean;
}

export interface JobFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  draft: JobFilterDraft;
  onDraftChange: (patch: Partial<JobFilterDraft>) => void;
  /** Live count for the draft filters; null while unknown. */
  resultCount: number | null;
  onApply: () => void;
  onClearAll: () => void;
}

/**
 * Matches the page's own blue identity (the hero icon tile and the job-card icon
 * are both blue), which is the accent `PublicPageHero` would be given here.
 */
const ACCENT = 'blue' as const;

const TYPE_KEYS = ['all', 'paid', 'volunteer', 'timebank'] as const;
const COMMITMENT_KEYS = ['all', 'full_time', 'part_time', 'flexible', 'one_off'] as const;

/**
 * Sort API values paired with their label keys. `salary_desc` is deliberately
 * mapped to `sort.salary` — the label key does NOT mirror the API value.
 */
const SORT_OPTIONS = [
  { key: 'newest', labelKey: 'sort.newest' },
  { key: 'deadline', labelKey: 'sort.deadline' },
  { key: 'salary_desc', labelKey: 'sort.salary' },
] as const;

export function JobFilterSheet({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  resultCount,
  onApply,
  onClearAll,
}: JobFilterSheetProps) {
  const { t } = useTranslation(['jobs', 'common']);

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('common:filter_bar.filters')}
      accent={ACCENT}
      resultCount={resultCount}
      onApply={onApply}
      onClearAll={onClearAll}
    >
      <div className="flex flex-col gap-6 pb-2">
        {/* `form.type_label` ("Job Type"), not the page's `filter_aria` — that
            string reads "Filter by category", a pre-existing mislabel we do not
            want to propagate into the sheet. */}
        <FilterChipGroup
          accent={ACCENT}
          label={t('form.type_label')}
          selected={draft.type}
          options={TYPE_KEYS.map((key) => ({ key, label: t(`type.${key}`) }))}
          onChange={(key) => onDraftChange({ type: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('form.commitment_label')}
          selected={draft.commitment}
          options={COMMITMENT_KEYS.map((key) => ({ key, label: t(`commitment.${key}`) }))}
          onChange={(key) => onDraftChange({ commitment: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('sort.label')}
          selected={draft.sort}
          options={SORT_OPTIONS.map((opt) => ({ key: opt.key, label: t(opt.labelKey) }))}
          onChange={(key) => onDraftChange({ sort: key })}
        />

        {/* Remote is the one boolean filter here, so it becomes a two-chip
            single-select rather than a switch — one anatomy for every section. */}
        <FilterChipGroup
          accent={ACCENT}
          label={t('remote_only')}
          selected={draft.remoteOnly ? 'remote' : 'any'}
          options={[
            { key: 'any', label: t('filter_any') },
            { key: 'remote', label: t('remote') },
          ]}
          onChange={(key) => onDraftChange({ remoteOnly: key === 'remote' })}
        />
      </div>
    </FilterSheet>
  );
}

export default JobFilterSheet;
