// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useId, useState } from 'react';
import { Label } from '@heroui/react/label';
import { SearchField } from '@heroui/react/search-field';
import Check from 'lucide-react/icons/check';
import Search from 'lucide-react/icons/search';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { eventsApi, type EventMemberSearchResult } from '@/lib/events-api';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface EventMemberPickerProps {
  /** Members chosen so far, in the order they were picked. */
  selected: EventMemberSearchResult[];
  onChange: (members: EventMemberSearchResult[]) => void;
  /** Most members that may be picked; further picks are ignored. */
  max: number;
  className?: string;
}

export function eventMemberName(member: EventMemberSearchResult): string {
  return member.name?.trim() || resolveUserDisplayName(member);
}

/**
 * Search-and-pick for community members, so an organiser never has to know a
 * member's numeric ID (B15). It searches the same member directory as the
 * People tab's invite search (`GET /v2/users`), which the server scopes to the
 * community the event belongs to.
 */
export function EventMemberPicker({ selected, onChange, max, className }: EventMemberPickerProps) {
  const { t } = useTranslation('events');
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventMemberSearchResult[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setState('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState('loading');
      void eventsApi.searchMembers(normalized, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          if (!response.success || !response.data) {
            setResults([]);
            setState('error');
            return;
          }
          setResults(response.data);
          setState('ready');
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          logError('Failed to search members for an Event invitation', caught);
          setResults([]);
          setState('error');
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const selectedIds = new Set(selected.map((member) => member.id));
  const toggle = (member: EventMemberSearchResult) => {
    if (selectedIds.has(member.id)) {
      onChange(selected.filter((item) => item.id !== member.id));
    } else if (selected.length < max) {
      onChange([...selected, member]);
    }
  };

  return (
    <div className={className}>
      <div className="relative">
        <SearchField
          className="w-full"
          value={query}
          onChange={setQuery}
          aria-describedby={hintId}
        >
          <Label>{t('manage.people.invite_search_label')}</Label>
          <SearchField.Group>
            <SearchField.SearchIcon><Search className="h-4 w-4" aria-hidden="true" /></SearchField.SearchIcon>
            <SearchField.Input placeholder={t('manage.people.invite_search_placeholder')} />
            {query && <SearchField.ClearButton aria-label={t('manage.people.clear_invite_search')} />}
          </SearchField.Group>
        </SearchField>
        <p id={hintId} className="mt-1 text-xs text-theme-subtle">
          {t('manage.people.invite_search_hint')}
        </p>
        {query.trim().length >= 2 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-theme-default bg-theme-surface shadow-lg">
            {state === 'loading' || state === 'idle' ? (
              <div className="flex items-center gap-2 p-4 text-sm text-theme-muted" role="status">
                <Spinner size="sm" /> {t('manage.people.searching')}
              </div>
            ) : state === 'error' ? (
              <p className="p-4 text-sm text-danger" role="alert">{t('manage.people.invite_search_error')}</p>
            ) : results.length === 0 ? (
              <p className="p-4 text-sm text-theme-muted" role="status">{t('manage.people.no_invite_results')}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto p-1" aria-label={t('manage.people.invite_results_aria')}>
                {results.map((member) => {
                  const name = eventMemberName(member);
                  const isSelected = selectedIds.has(member.id);
                  return (
                    <li key={member.id}>
                      <Button
                        className="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
                        variant="ghost"
                        onPress={() => toggle(member)}
                        isDisabled={!isSelected && selected.length >= max}
                        aria-pressed={isSelected}
                      >
                        <Avatar
                          size="sm"
                          name={name}
                          src={resolveAvatarUrl(member.avatar_url ?? member.avatar ?? null)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                        {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
          {selected.map((member) => (
            <Chip key={member.id} size="sm" variant="flat" onClose={() => toggle(member)}>
              {eventMemberName(member)}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
