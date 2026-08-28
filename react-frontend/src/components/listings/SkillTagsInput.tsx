// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
/**
 * SkillTagsInput - Tag input for listing skill tags
 *
 * Provides autocomplete suggestions and popular tags for quick selection.
 */

import { useState, useCallback, useRef, useEffect, useId } from 'react';import Tag from 'lucide-react/icons/tag';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface SkillTagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
}

export function SkillTagsInput({ tags, onChange, maxTags = 10 }: SkillTagsInputProps) {
  const { t } = useTranslation('listings');
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listboxId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const fetchSuggestions = useCallback(async (prefix: string) => {
    if (prefix.length < 2) {
      setSuggestions([]);
      return;
    }
    if (prefix.length > 100) return;

    try {
      const response = await api.get<string[]>(`/v2/listings/tags/autocomplete?q=${encodeURIComponent(prefix)}&limit=8`);
      if (response.success && response.data) {
        // Filter out already-selected tags
        setSuggestions(response.data.filter((s) => !tags.includes(s)));
      }
    } catch (error) {
      logError('Failed to fetch tag suggestions', error);
    }
  }, [tags]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setSelectedIndex(-1);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(value);
      setShowSuggestions(true);
    }, 200);
  };

  const addTag = (tag: string) => {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !tags.includes(normalized) && tags.length < maxTags) {
      onChange([...tags, normalized]);
    }
    setInputValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const hasSuggestions = showSuggestions && suggestions.length > 0;

    if (hasSuggestions && e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
      return;
    }
    if (hasSuggestions && e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
      return;
    }
    if (hasSuggestions && e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (hasSuggestions && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        const picked = suggestions[selectedIndex];
        if (picked) addTag(picked);
      } else if (inputValue.trim()) {
        addTag(inputValue.trim());
      }
      return;
    }
    if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      const lastTag = tags[tags.length - 1];
      if (lastTag) removeTag(lastTag);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-theme-muted flex items-center gap-1">
        <Tag className="w-4 h-4" />
        {t('skill_tags.label')}
        <span className="text-theme-subtle">({tags.length}/{maxTags})</span>
      </label>

      {/* Tag chips */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Chip
              key={tag}
              variant="flat"
              color="primary"
              onClose={() => removeTag(tag)}
              size="sm"
            >
              {tag}
            </Chip>
          ))}
        </div>
      )}

      {/* Input with autocomplete */}
      {tags.length < maxTags && (
        <div className="relative">
          <Input
            size="sm"
            placeholder={t('skill_tags.placeholder')}
            aria-label={t('skill_tags.aria_add_count', { current: tags.length, max: maxTags })}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay hiding to allow clicking suggestions
              blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 200);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              selectedIndex >= 0 && selectedIndex < suggestions.length
                ? `${listboxId}-opt-${selectedIndex}`
                : undefined
            }
            aria-autocomplete="list"
          />

          {/* Screen-reader suggestion count */}
          <div className="sr-only" role="status" aria-live="polite">
            {showSuggestions && suggestions.length > 0
              ? t('skill_tags.aria_results', { count: suggestions.length })
              : ''}
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              id={listboxId}
              role="listbox"
              className="absolute z-10 w-full mt-1 bg-theme-elevated border border-theme-default rounded-lg shadow-lg overflow-hidden"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  // Focusable but not tabbable. The ARIA combobox pattern keeps
                  // real focus on the text input and points at the active option
                  // with aria-activedescendant, so an option must never be its
                  // own tab stop — but it does have to be focusable for the
                  // `option` role to be valid. Added 2026-08-28.
                  tabIndex={-1}
                  className={`min-h-9 w-full cursor-pointer rounded-none px-3 py-2 text-left text-sm text-theme-primary transition-colors ${
                    index === selectedIndex ? 'bg-theme-hover' : 'hover:bg-theme-hover'
                  }`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent input blur
                    addTag(suggestion);
                  }}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SkillTagsInput;
