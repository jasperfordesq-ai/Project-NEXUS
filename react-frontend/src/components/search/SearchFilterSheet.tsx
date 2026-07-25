// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SearchFilterSheet — phone-only bottom sheet holding every advanced search
 * filter: content type, sort, category, skill tags, date range and location.
 *
 * Built from the shared primitives: `FilterSheet` (draft archetype — footer with
 * "Clear all" + a live-count apply button) and `FilterChipGroup` sections, all
 * emerald-accented to match this page's `PublicPageHero accent="emerald"`.
 * It works on a DRAFT copy of `AdvancedSearchFilters`' `SearchFilters`, so taps
 * update the draft and the footer's result count but never refetch the results
 * behind the sheet until "Show N results" applies.
 *
 * Three dimensions deliberately are NOT chip groups:
 * - Skill tags are multi-value free text (comma-joined), so they keep a text
 *   field (Enter to add) plus tap-to-add popular tags and tap-to-remove chips.
 * - `date_from`/`date_to` form a real range, so they keep two native date
 *   fields — a tap-once chip cannot express an arbitrary window.
 * - Location is free text with no lat/lng plumbing on this page.
 * Collapsing any of them into chips would drop functionality the desktop panel
 * has today, which is why they are carried over verbatim instead.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Calendar from 'lucide-react/icons/calendar';
import X from 'lucide-react/icons/x';

import { Button } from '@/components/ui/Button';
import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { Input } from '@/components/ui/Input';
import { filterAccentClasses } from '@/components/ui/filterAccent';
import type { SearchFilters } from '@/components/search/AdvancedSearchFilters';
import type { Category } from '@/types/api';

/** Matches `PublicPageHero accent="emerald"` on SearchPage. */
const ACCENT = 'emerald' as const;
const accentTone = filterAccentClasses(ACCENT);

const POPULAR_TAG_LIMIT = 8;

/** Same anatomy as `FilterChipGroup`'s heading so custom sections line up with it. */
const SECTION_HEADING_CLASS =
  'mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-theme-subtle';
const APPLIED_SKILL_CLASS =
  'inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium';
const POPULAR_TAG_CLASS =
  'min-h-11 min-w-0 rounded-full border border-theme-default bg-theme-elevated px-3 text-xs font-medium text-theme-muted';
const FIELD_CLASS_NAMES = {
  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
  inputWrapper: 'bg-theme-elevated border-theme-default',
} as const;

export interface SearchFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Draft copy of the page's advanced filters — never the live state. */
  draft: SearchFilters;
  onDraftChange: (patch: Partial<SearchFilters>) => void;
  /** Loaded when the sheet opens; an empty list hides the category section. */
  categories: Category[];
  popularTags: string[];
  /**
   * Gated by the page (`hasFeature('podcasts')`) rather than re-checked here, so
   * the tab strip, the desktop select and this sheet cannot disagree.
   */
  podcastsEnabled: boolean;
  /** Live count for the draft filters; null while unknown. */
  resultCount: number | null;
  onApply: () => void;
  onClearAll: () => void;
}

export function SearchFilterSheet({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  categories,
  popularTags,
  podcastsEnabled,
  resultCount,
  onApply,
  onClearAll,
}: SearchFilterSheetProps) {
  const { t } = useTranslation(['search_page', 'common']);
  const [tagInput, setTagInput] = useState('');

  const skillsList = draft.skills ? draft.skills.split(',').filter(Boolean) : [];
  const suggestedTags = popularTags
    .filter((tag) => !skillsList.includes(tag))
    .slice(0, POPULAR_TAG_LIMIT);

  function addSkill(skill: string) {
    const value = skill.trim().toLowerCase();
    if (!value) return;
    if (!skillsList.includes(value)) {
      onDraftChange({ skills: [...skillsList, value].join(',') });
    }
    setTagInput('');
  }

  function removeSkill(skill: string) {
    onDraftChange({ skills: skillsList.filter((s) => s !== skill).join(',') });
  }

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('advanced_filters')}
      accent={ACCENT}
      resultCount={resultCount}
      onApply={onApply}
      onClearAll={onClearAll}
    >
      {/* <div>, never <section>: glass.css paints every <section> inside a
          [role="dialog"] with an opaque solid background. */}
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_content_type')}
          selected={draft.type || 'all'}
          options={[
            { key: 'all', label: t('filter_all_types') },
            { key: 'listings', label: t('filter_listings') },
            { key: 'users', label: t('filter_members') },
            { key: 'events', label: t('filter_events') },
            { key: 'groups', label: t('filter_groups') },
            ...(podcastsEnabled ? [{ key: 'podcasts', label: t('filter_podcasts') }] : []),
          ]}
          onChange={(key) => onDraftChange({ type: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_sort_by')}
          selected={draft.sort || 'relevance'}
          options={[
            { key: 'relevance', label: t('filter_relevance') },
            { key: 'newest', label: t('filter_newest') },
            { key: 'oldest', label: t('filter_oldest') },
          ]}
          onChange={(key) => onDraftChange({ sort: key })}
        />

        {categories.length > 0 && (
          <FilterChipGroup
            accent={ACCENT}
            label={t('filter_category')}
            selected={draft.category_id || 'all'}
            options={[
              { key: 'all', label: t('filter_all_categories') },
              ...categories.map((cat) => ({ key: String(cat.id), label: cat.name })),
            ]}
            onChange={(key) => onDraftChange({ category_id: key === 'all' ? '' : key })}
          />
        )}

        {/* Skill tags: multi-value, so a single-select chip group cannot hold them. */}
        <div>
          <h3 className={SECTION_HEADING_CLASS}>{t('filter_skills')}</h3>
          <Input
            size="lg"
            placeholder={t('filter_skills_placeholder')}
            aria-label={t('filter_skills_placeholder')}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill(tagInput);
              }
            }}
            classNames={FIELD_CLASS_NAMES}
          />
          {skillsList.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {skillsList.map((skill) => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={t('common:filter_bar.remove_filter', { filter: skill })}
                  className={`${APPLIED_SKILL_CLASS} ${accentTone.appliedChip}`}
                >
                  <span className="max-w-32 truncate">{skill}</span>
                  <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {suggestedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-theme-subtle">{t('filter_popular')}</span>
              {suggestedTags.map((tag) => (
                <Button
                  key={tag}
                  size="sm"
                  variant="tertiary"
                  onPress={() => addSkill(tag)}
                  className={POPULAR_TAG_CLASS}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Date range: two halves of one window, so real date fields, not chips. */}
        <div className="flex flex-col gap-3">
          <Input
            type="date"
            size="lg"
            label={t('filter_from_date')}
            value={draft.date_from}
            onChange={(e) => onDraftChange({ date_from: e.target.value })}
            startContent={<Calendar className="h-4 w-4 text-theme-subtle" aria-hidden="true" />}
            classNames={FIELD_CLASS_NAMES}
          />
          <Input
            type="date"
            size="lg"
            label={t('filter_to_date')}
            value={draft.date_to}
            onChange={(e) => onDraftChange({ date_to: e.target.value })}
            startContent={<Calendar className="h-4 w-4 text-theme-subtle" aria-hidden="true" />}
            classNames={FIELD_CLASS_NAMES}
          />
        </div>

        <Input
          size="lg"
          label={t('filter_location')}
          placeholder={t('filter_location_placeholder')}
          value={draft.location}
          onChange={(e) => onDraftChange({ location: e.target.value })}
          classNames={FIELD_CLASS_NAMES}
        />
      </div>
    </FilterSheet>
  );
}

export default SearchFilterSheet;
