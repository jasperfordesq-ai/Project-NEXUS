// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
/**
 * AdvancedSearchFilters - Collapsible panel with advanced search filter controls
 *
 * Supports:
 * - Date range filtering
 * - Category selection
 * - Skills/tags filtering
 * - Sort order
 * - Content type selection
 */

import { useState, useEffect, useCallback, useRef } from 'react';import Filter from 'lucide-react/icons/filter';
import X from 'lucide-react/icons/x';
import Calendar from 'lucide-react/icons/calendar';
import Tag from 'lucide-react/icons/tag';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { Category } from '@/types/api';
import { useTenant } from '@/contexts';

export interface SearchFilters {
  type: string;
  category_id: string;
  date_from: string;
  date_to: string;
  sort: string;
  skills: string;
  location: string;
}

interface AdvancedSearchFiltersProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onApply: () => void;
  onReset: () => void;
}

const defaultFilters: SearchFilters = {
  type: 'all',
  category_id: '',
  date_from: '',
  date_to: '',
  sort: 'relevance',
  skills: '',
  location: '',
};

export function AdvancedSearchFilters({
  filters,
  onChange,
  onApply,
  onReset,
}: AdvancedSearchFiltersProps) {
  const { t } = useTranslation('search_page');
  const { hasFeature } = useTenant();
  const [isExpanded, setIsExpanded] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  // Count active filters
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value && value !== defaultFilters[key as keyof SearchFilters]
  ).length;

  const loadCategories = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get<Category[]>('/v2/categories');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setCategories(response.data);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load categories', error);
    }
  }, []);

  const loadPopularTags = useCallback(async () => {
    try {
      const response = await api.get<Array<{ tag: string; count: number }>>('/v2/listings/tags/popular?limit=10');
      if (response.success && response.data) {
        setPopularTags(response.data.map((item) => item.tag));
      }
    } catch (error) {
      logError('Failed to load popular tags', error);
    }
  }, []);

  useEffect(() => {
    if (isExpanded) {
      loadCategories();
      loadPopularTags();
    }
  }, [isExpanded, loadCategories, loadPopularTags]);

  const updateFilter = (key: keyof SearchFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  const handleAddSkill = (skill: string) => {
    const currentSkills = filters.skills ? filters.skills.split(',').filter(Boolean) : [];
    if (!currentSkills.includes(skill.toLowerCase())) {
      const newSkills = [...currentSkills, skill.toLowerCase()].join(',');
      updateFilter('skills', newSkills);
    }
    setTagInput('');
  };

  const handleRemoveSkill = (skill: string) => {
    const currentSkills = filters.skills ? filters.skills.split(',').filter(Boolean) : [];
    const newSkills = currentSkills.filter((s) => s !== skill).join(',');
    updateFilter('skills', newSkills);
  };

  const skillsList = filters.skills ? filters.skills.split(',').filter(Boolean) : [];

  const handleReset = () => {
    onChange({ ...defaultFilters });
    onReset();
  };

  return (
    <div className="space-y-3">
      {/* Toggle button */}
      <Button
        variant="flat"
        size="sm"
        className="bg-theme-elevated text-theme-primary"
        startContent={<SlidersHorizontal className="w-4 h-4" />}
        endContent={
          activeFilterCount > 0 ? (
            <Chip size="sm" color="primary" variant="flat">
              {activeFilterCount}
            </Chip>
          ) : null
        }
        onPress={() => setIsExpanded(!isExpanded)}
        aria-label={t('advanced_filters')}
      >
        {t('advanced_filters')}
      </Button>

      {/* Expanded filter panel */}
      {isExpanded && (
        <GlassCard className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Content type */}
            <Select
              label={t('filter_content_type')}
              selectedKeys={filters.type ? [filters.type] : ['all']}
              onChange={(e) => updateFilter('type', e.target.value)}
              disallowEmptySelection
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
            >
              <SelectItem key="all" id="all">{t('filter_all_types')}</SelectItem>
              <SelectItem key="listings" id="listings">{t('filter_listings')}</SelectItem>
              <SelectItem key="users" id="users">{t('filter_members')}</SelectItem>
              <SelectItem key="events" id="events">{t('filter_events')}</SelectItem>
              <SelectItem key="groups" id="groups">{t('filter_groups')}</SelectItem>
              {hasFeature('podcasts') && (
                <SelectItem key="podcasts" id="podcasts">{t('filter_podcasts')}</SelectItem>
              )}
            </Select>

            {/* Category */}
            <Select
              label={t('filter_category')}
              selectedKeys={filters.category_id ? [filters.category_id] : []}
              onChange={(e) => updateFilter('category_id', e.target.value)}
              disallowEmptySelection
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
              items={[{ id: 0, name: t('filter_all_categories'), slug: '' }, ...categories]}
            >
              {(cat) => <SelectItem key={cat.id || ''} id={cat.id || ''}>{cat.name}</SelectItem>}
            </Select>

            {/* Sort */}
            <Select
              label={t('filter_sort_by')}
              selectedKeys={filters.sort ? [filters.sort] : ['relevance']}
              onChange={(e) => updateFilter('sort', e.target.value)}
              disallowEmptySelection
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
            >
              <SelectItem key="relevance" id="relevance">{t('filter_relevance')}</SelectItem>
              <SelectItem key="newest" id="newest">{t('filter_newest')}</SelectItem>
              <SelectItem key="oldest" id="oldest">{t('filter_oldest')}</SelectItem>
            </Select>

            {/* Date from */}
            <Input
              type="date"
              label={t('filter_from_date')}
              value={filters.date_from}
              onChange={(e) => updateFilter('date_from', e.target.value)}
              startContent={<Calendar className="w-4 h-4 text-theme-subtle" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />

            {/* Date to */}
            <Input
              type="date"
              label={t('filter_to_date')}
              value={filters.date_to}
              onChange={(e) => updateFilter('date_to', e.target.value)}
              startContent={<Calendar className="w-4 h-4 text-theme-subtle" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />

            {/* Location */}
            <Input
              label={t('filter_location')}
              placeholder={t('filter_location_placeholder')}
              value={filters.location}
              onChange={(e) => updateFilter('location', e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </div>

          {/* Skill tags */}
          <div>
            <label className="text-sm font-medium text-theme-muted mb-2 flex items-center gap-1">
              <Tag className="w-4 h-4" />
              {t('filter_skills')}
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                size="sm"
                placeholder={t('filter_skills_placeholder')}
                aria-label={t('filter_skills_placeholder')}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    handleAddSkill(tagInput.trim());
                  }
                }}
                classNames={{
                  input: 'bg-transparent text-theme-primary',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                }}
              />
            </div>

            {/* Active skill tags */}
            {skillsList.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {skillsList.map((skill) => (
                  <Chip
                    key={skill}
                    variant="flat"
                    color="primary"
                    onClose={() => handleRemoveSkill(skill)}
                    size="sm"
                  >
                    {skill}
                  </Chip>
                ))}
              </div>
            )}

            {/* Popular tags */}
            {popularTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-theme-subtle">{t('filter_popular')}</span>
                {popularTags
                  .filter((tag) => !skillsList.includes(tag))
                  .slice(0, 8)
                  .map((tag) => (
                    <Button
                      key={tag}
                      size="sm"
                      variant="tertiary"
                      onPress={() => handleAddSkill(tag)}
                      className="min-h-7 min-w-0 rounded-full bg-theme-hover px-2 py-0.5 text-xs text-theme-muted transition-colors hover:bg-accent/20 hover:text-accent-soft-foreground"
                    >
                      {tag}
                    </Button>
                  ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-theme-default">
            <Button
              size="sm"
              variant="light"
              startContent={<X className="w-4 h-4" />}
              onPress={handleReset}
            >
              {t('filter_reset')}
            </Button>
            <Button
              size="sm"
              color="primary"
              startContent={<Filter className="w-4 h-4" />}
              onPress={onApply}
            >
              {t('filter_apply')}
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

export { defaultFilters };
export default AdvancedSearchFilters;
