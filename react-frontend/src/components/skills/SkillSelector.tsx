import { Select, SelectItem, useDisclosure, Button, Chip, Spinner, Input, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SkillSelector - Autocomplete skill selector with category hierarchy
 *
 * Used in settings/profile to add skills with proficiency levels.
 * Fetches skill categories from API and supports search.
 */

import { useState, useEffect, useCallback, useRef, useId } from 'react';

import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import Star from 'lucide-react/icons/star';
import Sparkles from 'lucide-react/icons/sparkles';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillCategory {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  skills_count?: number;
  children?: SkillCategory[];
}

export interface UserSkill {
  id: number;
  skill_name: string;
  category_name?: string;
  category_id?: number;
  proficiency_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  endorsement_count?: number;
  created_at?: string;
}

interface SkillSearchResult {
  id: number;
  name: string;
  category_name: string;
  category_id: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proficiency Config
// ─────────────────────────────────────────────────────────────────────────────

const proficiencyConfig: Record<string, { color: string; dots: number }> = {
  beginner: { color: 'text-emerald-500', dots: 1 },
  intermediate: { color: 'text-[var(--color-info)]', dots: 2 },
  advanced: { color: 'text-accent', dots: 3 },
  expert: { color: 'text-[var(--color-warning)]', dots: 4 },
};

// ─────────────────────────────────────────────────────────────────────────────
// ProficiencyDots
// ─────────────────────────────────────────────────────────────────────────────

export function ProficiencyDots({ level }: { level: string }) {
  const { t } = useTranslation('common');
  const normalizedLevel = proficiencyConfig[level] ? level : 'beginner';
  const config = proficiencyConfig[normalizedLevel] ?? { color: 'text-emerald-500', dots: 1 };
  const label = t(`skills.proficiency.${normalizedLevel}`);

  return (
    <div className="flex items-center gap-1" aria-label={t('skills.proficiency_aria', { level: label })}>
      {[1, 2, 3, 4].map((dot) => (
        <div
          key={dot}
          className={`w-2 h-2 rounded-full ${
            dot <= config.dots
              ? `bg-current ${config.color}`
              : 'bg-theme-hover'
          }`}
        />
      ))}
      <span className={`text-xs ml-1 ${config.color}`}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillChip
// ─────────────────────────────────────────────────────────────────────────────

export function SkillChip({
  skill,
  onRemove,
  showProficiency = true,
  endorsementCount,
}: {
  skill: UserSkill;
  onRemove?: () => void;
  showProficiency?: boolean;
  endorsementCount?: number;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20">
      <span className="text-sm font-medium text-theme-primary">{skill.skill_name}</span>
      {showProficiency && (
        <ProficiencyDots level={skill.proficiency_level} />
      )}
      {endorsementCount !== undefined && endorsementCount > 0 && (
        <span className="flex items-center gap-0.5 text-xs text-[var(--color-warning)]">
          <Star className="w-3 h-3 fill-amber-500" aria-hidden="true" />
          {endorsementCount}
        </span>
      )}
      {onRemove && (
        <Button
          isIconOnly
          size="sm"
          variant="light"
          onPress={onRemove}
          className="ml-1 p-0.5 rounded-full hover:bg-red-500/20 text-theme-subtle hover:text-[var(--color-error)] transition-colors min-w-0 w-auto min-h-9"
          aria-label={t('skills.remove_skill_aria', { skill: skill.skill_name })}
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillSelector Component
// ─────────────────────────────────────────────────────────────────────────────

export function SkillSelector({
  userSkills,
  onSkillsChange,
}: {
  userSkills: UserSkill[];
  onSkillsChange: () => void;
}) {
  const toast = useToast();
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [proficiency, setProficiency] = useState<string>('intermediate');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listboxId = useId();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Load categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        setIsLoadingCategories(true);
        const response = await api.get<SkillCategory[]>('/v2/skills/categories');
        if (response.success && response.data) {
          setCategories(response.data);
        }
      } catch (err) {
        logError('Failed to load skill categories', err);
      } finally {
        setIsLoadingCategories(false);
      }
    };
    loadCategories();
  }, []);

  // Search skills
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    setSelectedIndex(-1);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsSearching(true);
      const response = await api.get<SkillSearchResult[]>(`/v2/skills/search?q=${encodeURIComponent(query)}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setSearchResults(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search skills', err);
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, []);

  // Add skill
  const handleAddSkill = async (skillName?: string, categoryId?: number) => {
    const name = skillName || selectedSkill.trim();
    if (!name) return;

    try {
      setIsAdding(true);
      const response = await api.post('/v2/users/me/skills', {
        skill_name: name,
        category_id: categoryId || (selectedCategory ? parseInt(selectedCategory) : undefined),
        proficiency_level: proficiency,
      });

      if (response.success) {
        toastRef.current.success(tRef.current('toasts.skill_added'));
        setSelectedSkill('');
        setSearchQuery('');
        setSearchResults([]);
        onSkillsChange();
        onClose();
      } else {
        toastRef.current.error(response.error || tRef.current('toasts.skill_add_failed'));
      }
    } catch (err) {
      logError('Failed to add skill', err);
      toastRef.current.error(tRef.current('toasts.skill_add_failed'));
    } finally {
      setIsAdding(false);
    }
  };

  // Select a search result into the form (shared by click + keyboard)
  const selectResult = (result: SkillSearchResult) => {
    setSelectedSkill(result.name);
    setSelectedCategory(result.category_id.toString());
    setSearchResults([]);
    setSearchQuery(result.name);
    setSelectedIndex(-1);
  };

  // Combobox keyboard navigation over the search results
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i < searchResults.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < searchResults.length) {
      e.preventDefault();
      const picked = searchResults[selectedIndex];
      if (picked) selectResult(picked);
    } else if (e.key === 'Escape') {
      setSearchResults([]);
      setSelectedIndex(-1);
    }
  };

  // Remove skill
  const handleRemoveSkill = async (skillId: number) => {
    try {
      const response = await api.delete(`/v2/users/me/skills/${skillId}`);
      if (response.success) {
        toastRef.current.success(tRef.current('toasts.skill_removed'));
        onSkillsChange();
      } else {
        toastRef.current.error(response.error || tRef.current('toasts.skill_remove_failed'));
      }
    } catch (err) {
      logError('Failed to remove skill', err);
      toastRef.current.error(tRef.current('toasts.skill_remove_failed'));
    }
  };

  return (
    <div className="space-y-4">
      {/* Current Skills */}
      <div className="flex flex-wrap gap-2">
        {userSkills.length > 0 ? (
          userSkills.map((skill) => (
            <SkillChip
              key={skill.id}
              skill={skill}
              onRemove={() => handleRemoveSkill(skill.id)}
              endorsementCount={skill.endorsement_count}
            />
          ))
        ) : (
          <p className="text-sm text-theme-subtle italic">{tc('skills.no_user_skills')}</p>
        )}
      </div>

      {/* Add Skill Button */}
      <Button
        variant="flat"
        className="bg-accent/10 text-accent dark:text-accent"
        startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        onPress={onOpen}
      >
        {tc('skills.add_skill')}
      </Button>

      {/* Add Skill Modal */}
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        classNames={{
          base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)]',
          backdrop: 'bg-black/60 backdrop-blur-sm',
        }}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-3 text-theme-primary">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-accent" aria-hidden="true" />
            </div>
            <ModalHeading>{tc('skills.add_a_skill')}</ModalHeading>
          </ModalHeader>
          <ModalBody>
            {/* Search */}
            <Input
              placeholder={tc('skills.search_placeholder')}
              aria-label={tc('aria.search_skills')}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              startContent={<Search className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              endContent={isSearching ? <Spinner size="sm" /> : undefined}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
              role="combobox"
              aria-expanded={searchResults.length > 0}
              aria-controls={listboxId}
              aria-activedescendant={
                selectedIndex >= 0 && selectedIndex < searchResults.length
                  ? `${listboxId}-opt-${selectedIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              autoFocus
            />

            {/* Screen-reader result count */}
            <div className="sr-only" role="status" aria-live="polite">
              {searchResults.length > 0
                ? tc('skills.aria_results', { count: searchResults.length })
                : ''}
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div
                id={listboxId}
                role="listbox"
                aria-label={tc('aria.search_skills')}
                className="space-y-1 max-h-48 overflow-y-auto"
              >
                {searchResults.map((result, index) => (
                  <div
                    key={result.id}
                    id={`${listboxId}-opt-${index}`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    // Focusable but not tabbable — the listbox pattern keeps
                    // real focus on the search input and tracks the active
                    // option with aria-activedescendant. Added 2026-08-28.
                    tabIndex={-1}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectResult(result);
                    }}
                    className={`w-full cursor-pointer px-3 py-2 rounded-lg transition-colors min-h-9 flex items-center ${
                      index === selectedIndex ? 'bg-theme-hover' : 'hover:bg-theme-hover'
                    }`}
                  >
                    <span className="text-sm font-medium text-theme-primary">{result.name}</span>
                    <span className="text-xs text-theme-subtle ml-2">{tc('skills.search_result_category', { category: result.category_name })}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Manual entry if no search results */}
            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <div className="px-3 py-2 rounded-lg bg-theme-elevated border border-theme-default">
                <p className="text-sm text-theme-muted">
                  {tc('skills.no_matching_custom', { query: searchQuery })}
                </p>
                <Button
                  size="sm"
                  variant="flat"
                  className="mt-2 bg-accent/10 text-accent"
                  onPress={() => setSelectedSkill(searchQuery)}
                >
                  {tc('skills.use_custom', { query: searchQuery })}
                </Button>
              </div>
            )}

            {/* Category selector */}
            {!isLoadingCategories && categories.length > 0 && (
              <Select
                label={tc('skills.category_optional')}
                placeholder={tc('aria.select_category')}
                selectedKeys={selectedCategory ? [selectedCategory] : []}
                onChange={(e) => setSelectedCategory(e.target.value)}
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default',
                  value: 'text-theme-primary',
                }}
              >
                {categories.map((cat) => (
                  <SelectItem key={cat.id.toString()} id={cat.id.toString()}>
                    {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                  </SelectItem>
                ))}
              </Select>
            )}

            {/* Proficiency selector */}
            <Select
              label={tc('skills.proficiency_level')}
              selectedKeys={[proficiency]}
              onChange={(e) => setProficiency(e.target.value)}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
            >
              <SelectItem key="beginner" id="beginner">{tc('skills.proficiency.beginner')}</SelectItem>
              <SelectItem key="intermediate" id="intermediate">{tc('skills.proficiency.intermediate')}</SelectItem>
              <SelectItem key="advanced" id="advanced">{tc('skills.proficiency.advanced')}</SelectItem>
              <SelectItem key="expert" id="expert">{tc('skills.proficiency.expert')}</SelectItem>
            </Select>

            {/* Selected skill preview */}
            {(selectedSkill || searchQuery) && (
              <div className="p-3 rounded-lg bg-theme-elevated border border-theme-default">
                <p className="text-xs text-theme-subtle mb-1">{tc('skills.skill_to_add')}</p>
                <div className="flex items-center gap-3">
                  <Chip variant="flat" className="bg-accent/20 text-accent dark:text-accent">
                    {selectedSkill || searchQuery}
                  </Chip>
                  <ProficiencyDots level={proficiency} />
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose} className="text-theme-muted">
              {tc('cancel')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={() => handleAddSkill()}
              isLoading={isAdding}
              isDisabled={!selectedSkill && !searchQuery}
            >
              {tc('skills.add_skill')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default SkillSelector;
