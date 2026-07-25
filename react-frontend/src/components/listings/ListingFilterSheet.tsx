// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ListingFilterSheet — phone-only bottom sheet holding every listings filter
 * (type, sort, category, duration, format, posted date, distance).
 *
 * Built from the shared primitives: `FilterSheet` (draft archetype — footer with
 * "Clear all" + a live-count apply button) and `FilterChipGroup` sections, both
 * emerald-accented. Works on a DRAFT copy of the page filter state: taps update
 * the draft and the footer's live result count, but nothing refetches the visible
 * grid until "Show N listings" applies the draft. Category offers a quick chip row
 * plus a searchable full-list sub-view for tenants with many categories.
 *
 * Copy stays listings-specific on purpose ("Show 23 listings", not the generic
 * "Show 23 results") — those strings are passed to `FilterSheet` as label
 * overrides rather than falling back to `common:filter_bar.*`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Check from 'lucide-react/icons/check';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';

import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { Button } from '@/components/ui/Button';
import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { SearchField } from '@/components/ui/SearchField';
import { filterAccentClasses } from '@/components/ui/filterAccent';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';
import type { Category } from '@/types/api';

export interface ListingFilterDraft {
  type: 'all' | 'offer' | 'request';
  category: string;
  sort: 'recommended' | 'newest';
  hours: string;
  service: string;
  posted: string;
  proximity: ProximityFilterParams | null;
}

export interface ListingFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  draft: ListingFilterDraft;
  onDraftChange: (patch: Partial<ListingFilterDraft>) => void;
  /** Live count for the draft filters; null while unknown. */
  resultCount: number | null;
  onApply: () => void;
  onClearAll: () => void;
}

// Same radius steps the desktop ProximityFilter offers (common:radius_* keys).
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const DEFAULT_RADIUS = 25;
const QUICK_CATEGORY_LIMIT = 5;

const ACCENT = 'emerald';
const accentTone = filterAccentClasses(ACCENT);

export function ListingFilterSheet({
  isOpen,
  onClose,
  categories,
  draft,
  onDraftChange,
  resultCount,
  onApply,
  onClearAll,
}: ListingFilterSheetProps) {
  const { t } = useTranslation(['listings', 'common']);
  const { user } = useAuth();
  const toast = useToast();

  // 'filters' is the main sheet; 'category' is the searchable full list.
  const [view, setView] = useState<'filters' | 'category'>('filters');
  const [categoryQuery, setCategoryQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setView('filters');
      setCategoryQuery('');
    }
  }, [isOpen]);

  // Quick chips: "All" + first few categories, always including the selection.
  const quickCategories = useMemo(() => {
    const quick = categories.slice(0, QUICK_CATEGORY_LIMIT);
    if (draft.category && !quick.some((c) => c.slug === draft.category)) {
      const selected = categories.find((c) => c.slug === draft.category);
      if (selected) quick.splice(QUICK_CATEGORY_LIMIT - 1, 1, selected);
    }
    return quick;
  }, [categories, draft.category]);

  const filteredCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryQuery]);

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

  const categorySubView = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Button
          isIconOnly
          variant="light"
          onPress={() => setView('filters')}
          aria-label={t('category_back')}
          className="min-h-[44px] min-w-[44px] text-theme-muted hover:text-theme-primary"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <h3 className="text-sm font-semibold text-theme-primary">{t('filter_category_label')}</h3>
      </div>
      <SearchField
        size="lg"
        autoFocus
        placeholder={t('form.category_search')}
        value={categoryQuery}
        onChange={(e) => setCategoryQuery(e.target.value)}
        aria-label={t('form.category_search')}
        classNames={{
          input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
          inputWrapper: 'bg-theme-elevated border-theme-default',
        }}
      />
      {/* Native buttons: HeroUI Button does not forward role="option" to the DOM. */}
      <div className="flex flex-col" role="listbox" aria-label={t('filter_category_label')}>
        {[{ slug: 'all', name: t('filter_all_categories') }, ...filteredCategories].map((cat) => {
          const isSelected = cat.slug === 'all' ? !draft.category : draft.category === cat.slug;
          return (
            <button
              key={cat.slug}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onDraftChange({ category: cat.slug === 'all' ? '' : cat.slug });
                setView('filters');
              }}
              className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm transition-colors hover:bg-theme-hover ${
                isSelected ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-theme-primary'
              }`}
            >
              <span className="truncate">{cat.name}</span>
              {isSelected && <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <FilterSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('filters_label')}
      accent={ACCENT}
      resultCount={resultCount}
      onApply={onApply}
      onClearAll={onClearAll}
      subView={view === 'category' ? categorySubView : undefined}
      onBack={() => setView('filters')}
      labels={{
        clearAll: t('clear_all'),
        back: t('category_back'),
        showResults: (count) => t('sheet_show_results', { count }),
        showResultsUnknown: t('sheet_show_results_unknown'),
      }}
    >
      <div className="flex flex-col gap-6 pb-2">
        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_type_label')}
          selected={draft.type}
          options={[
            { key: 'all', label: t('filters.all') },
            { key: 'offer', label: t('filters.offers') },
            { key: 'request', label: t('filters.requests') },
          ]}
          onChange={(key) => onDraftChange({ type: key as ListingFilterDraft['type'] })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('sort_label')}
          selected={draft.sort}
          options={[
            { key: 'recommended', label: t('sort_recommended') },
            { key: 'newest', label: t('sort_newest') },
          ]}
          onChange={(key) => onDraftChange({ sort: key as ListingFilterDraft['sort'] })}
          trailing={<AlgorithmLabel area="listings" />}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_category_label')}
          selected={draft.category || 'all'}
          options={[
            { key: 'all', label: t('filters.all') },
            ...quickCategories.map((cat) => ({ key: cat.slug, label: cat.name })),
          ]}
          onChange={(key) => onDraftChange({ category: key === 'all' ? '' : key })}
          extra={
            categories.length > QUICK_CATEGORY_LIMIT ? (
              <Button
                size="sm"
                variant="light"
                onPress={() => setView('category')}
                endContent={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
                className={`min-h-11 rounded-full px-3 text-sm font-medium ${accentTone.linkAction}`}
              >
                {t('show_all_categories', { count: categories.length })}
              </Button>
            ) : undefined
          }
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_hours')}
          selected={draft.hours}
          options={[
            { key: 'any', label: t('filter_any') },
            { key: 'quick', label: t('duration_under_1h') },
            { key: 'short', label: t('duration_1_3h') },
            { key: 'half_day', label: t('duration_3_6h') },
            { key: 'full_day', label: t('duration_6h_plus') },
          ]}
          onChange={(key) => onDraftChange({ hours: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_service_mode')}
          selected={draft.service}
          options={[
            { key: 'any', label: t('filter_any') },
            { key: 'remote', label: t('service_remote_short') },
            { key: 'in_person', label: t('service_in_person_short') },
          ]}
          onChange={(key) => onDraftChange({ service: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_posted_date')}
          selected={draft.posted}
          options={[
            { key: 'any', label: t('filter_any_time') },
            { key: '1', label: t('filter_today') },
            { key: '7', label: t('filter_this_week') },
            { key: '30', label: t('filter_this_month') },
          ]}
          onChange={(key) => onDraftChange({ posted: key })}
        />

        <FilterChipGroup
          accent={ACCENT}
          label={t('filter_distance')}
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

export default ListingFilterSheet;
