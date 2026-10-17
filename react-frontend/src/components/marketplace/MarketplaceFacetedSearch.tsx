// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceFacetedSearch - Filter sidebar for marketplace browse
 *
 * Provides category, price range, condition, listing type (for sale / free /
 * borrow & lend), seller type, delivery method, sort, and time-posted filters.
 * Collapsible on mobile via HeroUI Accordion.
 */

import { useState, useCallback } from 'react';

import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { CheckboxGroup, Checkbox } from '@/components/ui/Checkbox';
import { Label } from '@/components/ui/Label';
import { NumberField } from '@/components/ui/NumberField';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import type { MarketplaceFilters,
  MarketplaceCategory } from '@/types/marketplace';

interface MarketplaceFacetedSearchProps {
  filters: MarketplaceFilters;
  onChange: (filters: MarketplaceFilters) => void;
  categories: MarketplaceCategory[];
}

const CONDITION_OPTIONS = [
  { value: 'new' },
  { value: 'like_new' },
  { value: 'good' },
  { value: 'fair' },
  { value: 'poor' },
] as const;

/** Listing types the browse endpoint accepts as a single `price_type` filter. */
const PRICE_TYPE_OPTIONS = [
  { value: 'fixed' },
  { value: 'negotiable' },
  { value: 'free' },
  { value: 'lend' },
] as const;

const SORT_OPTIONS = [
  { value: 'newest' },
  { value: 'price_asc' },
  { value: 'price_desc' },
  { value: 'popular' },
] as const;

const POSTED_WITHIN_OPTIONS = [
  { value: '', tKey: 'filters.posted_any_time' },
  { value: '1', tKey: 'filters.posted_today' },
  { value: '3', tKey: 'filters.posted_last_days', count: 3 },
  { value: '7', tKey: 'filters.posted_last_days', count: 7 },
  { value: '30', tKey: 'filters.posted_last_days', count: 30 },
] as const;

export function MarketplaceFacetedSearch({
  filters,
  onChange,
  categories,
}: MarketplaceFacetedSearchProps) {
  const { t } = useTranslation('marketplace');
  const [localFilters, setLocalFilters] = useState<MarketplaceFilters>(filters);

  const updateFilter = useCallback(
    <K extends keyof MarketplaceFilters>(key: K, value: MarketplaceFilters[K]) => {
      setLocalFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    onChange(localFilters);
  }, [localFilters, onChange]);

  const handleClearAll = useCallback(() => {
    const cleared: MarketplaceFilters = {};
    setLocalFilters(cleared);
    onChange(cleared);
  }, [onChange]);

  const filterContent = (
    <div className="space-y-5">
      {/* Category */}
      <div>
        <Select
          label={t('filters.category')}
          aria-label={t('filters.category')}
          variant="secondary"
          size="sm"
          selectedKeys={localFilters.category_id != null ? [String(localFilters.category_id)] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0] as string | undefined;
            updateFilter('category_id', selected ? Number(selected) : undefined);
          }}
        >
          {categories.map((cat) => (
            <SelectItem key={String(cat.id)} id={String(cat.id)}>
              {cat.name}
            </SelectItem>
          ))}
        </Select>
      </div>

      {/* Price range */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-theme-muted">
          {t('filters.price_range')}
        </legend>
        <div className="flex gap-2">
          <NumberField
            className="flex-1"
            variant="secondary"
            minValue={0}
            value={localFilters.price_min ?? undefined}
            onChange={(v) => updateFilter('price_min', v)}
            aria-label={t('filters.min')}
          >
            <Label>{t('filters.min')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" aria-label={t('filters.min')} />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
          <NumberField
            className="flex-1"
            variant="secondary"
            minValue={0}
            value={localFilters.price_max ?? undefined}
            onChange={(v) => updateFilter('price_max', v)}
            aria-label={t('filters.max')}
          >
            <Label>{t('filters.max')}</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" aria-label={t('filters.max')} />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>
      </fieldset>

      {/* Condition */}
      <div>
        <CheckboxGroup
          label={t('filters.condition')}
          size="sm"
          value={localFilters.condition ?? []}
          onValueChange={(value) => updateFilter('condition', value as string[])}
        >
          {CONDITION_OPTIONS.map((opt) => (
            <Checkbox key={opt.value} value={opt.value}>
              {t(`condition.${opt.value}`)}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </div>

      {/* Listing type (price_type) */}
      <div>
        <RadioGroup
          label={t('filters.listing_type')}
          size="sm"
          value={localFilters.price_type ?? 'all'}
          onValueChange={(value) =>
            updateFilter('price_type', value === 'all' ? undefined : value)
          }
        >
          <Radio value="all">{t('filters.listing_type_any')}</Radio>
          {PRICE_TYPE_OPTIONS.map((opt) => (
            <Radio key={opt.value} value={opt.value}>
              {t(`price_type.${opt.value}`)}
            </Radio>
          ))}
        </RadioGroup>
      </div>

      {/* Seller type */}
      <div>
        <RadioGroup
          label={t('filters.seller_type')}
          size="sm"
          value={localFilters.seller_type ?? 'all'}
          onValueChange={(value) =>
            updateFilter('seller_type', value === 'all' ? undefined : value)
          }
        >
          <Radio value="all">{t('filters.seller_all')}</Radio>
          <Radio value="private">{t('filters.seller_private')}</Radio>
          <Radio value="business">{t('filters.seller_business')}</Radio>
        </RadioGroup>
      </div>

      {/* Delivery method */}
      <div>
        <RadioGroup
          label={t('filters.delivery_method')}
          size="sm"
          value={localFilters.delivery_method ?? 'all'}
          onValueChange={(value) =>
            updateFilter('delivery_method', value === 'all' ? undefined : value)
          }
        >
          <Radio value="all">{t('filters.delivery_all')}</Radio>
          <Radio value="shipping">{t('filters.delivery_shipping')}</Radio>
          <Radio value="pickup">{t('filters.delivery_pickup')}</Radio>
          <Radio value="both">{t('filters.delivery_both')}</Radio>
        </RadioGroup>
      </div>

      {/* Sort */}
      <div>
        <Select
          label={t('filters.sort')}
          aria-label={t('filters.sort')}
          variant="secondary"
          size="sm"
          selectedKeys={localFilters.sort ? [localFilters.sort] : ['newest']}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0] as string | undefined;
            updateFilter('sort', selected || undefined);
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} id={opt.value}>
              {t(`sort.${opt.value}`)}
            </SelectItem>
          ))}
        </Select>
      </div>

      {/* Posted within */}
      <div>
        <Select
          label={t('filters.posted_within')}
          aria-label={t('filters.posted_within')}
          variant="secondary"
          size="sm"
          selectedKeys={
            localFilters.posted_within != null
              ? [String(localFilters.posted_within)]
              : ['']
          }
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0] as string | undefined;
            updateFilter('posted_within', selected ? Number(selected) : undefined);
          }}
        >
          {POSTED_WITHIN_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} id={opt.value}>
              {t(opt.tKey, 'count' in opt ? { count: opt.count } : undefined)}
            </SelectItem>
          ))}
        </Select>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-[1fr_auto]">
        <Button size="sm" className="w-full" onPress={handleApply}>
          {t('filters.apply')}
        </Button>
        <Button variant="tertiary" size="sm" className="w-full sm:w-auto" onPress={handleClearAll}>
          {t('filters.clear')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: always visible sidebar */}
      <div className="hidden lg:block">{filterContent}</div>

      {/* Mobile/Tablet: collapsible accordion */}
      <div className="lg:hidden">
        <Accordion variant="surface">
          <AccordionItem
            key="filters" id="filters"
            aria-label={t('filters.title')}
            title={t('filters.title')}
            startContent={<SlidersHorizontal className="w-4 h-4" aria-hidden="true" />}
          >
            {filterContent}
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );
}

export default MarketplaceFacetedSearch;
