// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ListingFilterSheet — phone-only bottom sheet holding every listings filter
 * (type, sort, category, duration, format, posted date, distance).
 *
 * Works on a DRAFT copy of the page filter state: taps update the draft and a
 * live result count in the footer, but nothing refetches the visible grid
 * until "Show N listings" applies the draft. Category offers a quick chip row
 * plus a searchable full-list view for tenants with many categories.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';
import Check from 'lucide-react/icons/check';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';

import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
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

const CHIP_CLASS =
  'min-h-11 shrink-0 rounded-full border border-theme-default bg-theme-elevated px-4 text-sm text-theme-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 data-[selected=true]:border-transparent data-[selected=true]:bg-emerald-600 data-[selected=true]:font-medium data-[selected=true]:text-white data-[selected=true]:shadow-sm';

interface ChipGroupProps {
  label: string;
  selected: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
  trailing?: React.ReactNode;
  extra?: React.ReactNode;
}

/** One labelled section of single-select filter chips. */
function ChipGroup({ label, selected, options, onChange, trailing, extra }: ChipGroupProps) {
  return (
    <section>
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-theme-subtle">{label}</h3>
        {trailing}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleButtonGroup
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={new Set<Key>([selected])}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            if (key != null) onChange(String(key));
          }}
          className="flex flex-wrap items-center gap-2 p-0"
        >
          {options.map((opt) => (
            <ToggleButton key={opt.key} id={opt.key} variant="ghost" className={CHIP_CLASS}>
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {extra}
      </div>
    </section>
  );
}

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

  const showResultsLabel = resultCount != null
    ? t('sheet_show_results', { count: resultCount })
    : t('sheet_show_results_unknown');

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('filters_label')}
      footer={
        <div className="flex items-center gap-3">
          <Button
            variant="flat"
            onPress={view === 'category' ? () => setView('filters') : onClearAll}
            className="min-h-12 shrink-0 rounded-xl bg-theme-elevated px-4 font-medium text-theme-primary"
          >
            {view === 'category' ? t('category_back') : t('clear_all')}
          </Button>
          <Button
            variant="solid"
            onPress={onApply}
            className="min-h-12 min-w-0 flex-1 rounded-xl bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <span className="truncate">{showResultsLabel}</span>
          </Button>
        </div>
      }
    >
      {view === 'category' ? (
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
      ) : (
        <div className="flex flex-col gap-5">
          <ChipGroup
            label={t('filter_type_label')}
            selected={draft.type}
            options={[
              { key: 'all', label: t('filters.all') },
              { key: 'offer', label: t('filters.offers') },
              { key: 'request', label: t('filters.requests') },
            ]}
            onChange={(key) => onDraftChange({ type: key as ListingFilterDraft['type'] })}
          />

          <ChipGroup
            label={t('sort_label')}
            selected={draft.sort}
            options={[
              { key: 'recommended', label: t('sort_recommended') },
              { key: 'newest', label: t('sort_newest') },
            ]}
            onChange={(key) => onDraftChange({ sort: key as ListingFilterDraft['sort'] })}
            trailing={<AlgorithmLabel area="listings" />}
          />

          <ChipGroup
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
                  className="min-h-11 rounded-full px-3 text-sm font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                >
                  {t('show_all_categories', { count: categories.length })}
                </Button>
              ) : undefined
            }
          />

          <ChipGroup
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

          <ChipGroup
            label={t('filter_service_mode')}
            selected={draft.service}
            options={[
              { key: 'any', label: t('filter_any') },
              { key: 'remote', label: t('service_remote_short') },
              { key: 'in_person', label: t('service_in_person_short') },
            ]}
            onChange={(key) => onDraftChange({ service: key })}
          />

          <ChipGroup
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

          <ChipGroup
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
      )}
    </BottomSheet>
  );
}

export default ListingFilterSheet;
