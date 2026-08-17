// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Search Overlay / Command Palette
 *
 * HeroUI Modal owns the overlay stack, focus containment/restoration, Escape,
 * backdrop dismissal, and document scroll locking. Search suggestions keep DOM
 * focus on the input and implement the ARIA combobox/listbox contract with
 * aria-activedescendant.
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo, useId, useRef } from 'react';
import { usePress } from '@react-aria/interactions';
import { useNavigate } from 'react-router-dom';
import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import ListTodo from 'lucide-react/icons/list-todo';
import Calendar from 'lucide-react/icons/calendar';
import Settings from 'lucide-react/icons/settings';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import UserCircle from 'lucide-react/icons/circle-user';
import HelpCircle from 'lucide-react/icons/circle-help';
import Clock from 'lucide-react/icons/clock';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useTheme } from '@/contexts';
import { canCreateEvents } from '@/lib/access';
import { api } from '@/lib/api';
import { safeLocalStorageGetJSON, safeLocalStorageSetJSON, safeLocalStorageRemove } from '@/lib/safeStorage';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { Modal, ModalBody, ModalContent } from '@/components/ui/Modal';

const RECENT_SEARCHES_KEY = 'nexus_recent_searches';

interface SearchSuggestion {
  id: number;
  title?: string;
  name?: string;
  type: 'listing' | 'user' | 'event' | 'group';
}

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ComboboxOptionProps {
  children: ReactNode;
  className: string;
  id: string;
  isSelected: boolean;
  onHover: () => void;
  onPress: () => void;
}

function ComboboxOption({
  children,
  className,
  id,
  isSelected,
  onHover,
  onPress,
}: ComboboxOptionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { isPressed, pressProps } = usePress({
    onPress,
    preventFocusOnPress: true,
    ref,
  });

  return (
    <div
      {...pressProps}
      ref={ref}
      aria-selected={isSelected}
      className={`${className} cursor-pointer select-none`}
      data-pressed={isPressed || undefined}
      id={id}
      onMouseEnter={onHover}
      role="option"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { tenantPath, hasFeature } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // ─── State ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // ─── Close and reset everything ────────────────────────────────────────
  const handleClose = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    setIsLoading(false);
    setSelectedIndex(-1);
    onClose();
  }, [onClose]);

  // ─── Load recent searches on open ──────────────────────────────────────
  // Done during render with a prev-prop comparison (not useEffect) so users
  // never see a stale frame. Reading localStorage is a pure read, safe here.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      const stored = safeLocalStorageGetJSON<string[]>(RECENT_SEARCHES_KEY, []);
      if (stored.length > 0) setRecentSearches(stored);
    }
  }

  const trimmedQuery = query.trim();
  const queryIsSearchable = isOpen && trimmedQuery.length >= 2 && !trimmedQuery.startsWith('>');

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(-1);
    setSuggestions([]);

    const nextQuery = value.trim();
    setIsLoading(nextQuery.length >= 2 && !nextQuery.startsWith('>'));
  }, []);

  // ─── Debounced search ──────────────────────────────────────────────────
  useEffect(() => {
    if (!queryIsSearchable) return;

    const controller = new AbortController();
    let isCurrentRequest = true;
    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await api.get<Record<string, SearchSuggestion[]>>(
          `/v2/search/suggestions?q=${encodeURIComponent(trimmedQuery)}&limit=5`,
          { signal: controller.signal },
        );
        if (isCurrentRequest && response.success && response.data) {
          const all: SearchSuggestion[] = [];
          const d = response.data;
          if (d.listings) all.push(...d.listings.map(s => ({ ...s, type: 'listing' as const })));
          if (d.users) all.push(...d.users.map(s => ({ ...s, type: 'user' as const })));
          if (d.events) all.push(...d.events.map(s => ({ ...s, type: 'event' as const })));
          if (d.groups) all.push(...d.groups.map(s => ({ ...s, type: 'group' as const })));
          setSelectedIndex(-1);
          setSuggestions(all.slice(0, 8));
        }
      } catch {
        // ignore
      } finally {
        if (isCurrentRequest) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      isCurrentRequest = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [queryIsSearchable, trimmedQuery]);

  // ─── Recent searches helpers ───────────────────────────────────────────
  const saveRecent = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) return;
    setRecentSearches(prev => {
      const updated = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 5);
      safeLocalStorageSetJSON(RECENT_SEARCHES_KEY, updated);
      return updated;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    safeLocalStorageRemove(RECENT_SEARCHES_KEY);
  }, []);

  // ─── Quick actions ─────────────────────────────────────────────────────
  const quickActions = useMemo(() => {
    const actions: { label: string; icon: typeof Search; action: () => void }[] = [];
    if (isAuthenticated) {
      actions.push({ label: t('create.new_listing'), icon: ListTodo, action: () => navigate(tenantPath('/listings/create')) });
      // Creation can be restricted to brokers/admins even with events enabled.
      if (hasFeature('events') && canCreateEvents(user)) {
        actions.push({ label: t('create.new_event'), icon: Calendar, action: () => navigate(tenantPath('/events/create')) });
      }
      actions.push(
        { label: t('user_menu.my_profile'), icon: UserCircle, action: () => navigate(tenantPath('/profile')) },
        { label: t('user_menu.settings'), icon: Settings, action: () => navigate(tenantPath('/settings')) }
      );
    }
    actions.push(
      { label: resolvedTheme === 'dark' ? t('user_menu.light_mode') : t('user_menu.dark_mode'), icon: resolvedTheme === 'dark' ? Sun : Moon, action: toggleTheme },
      { label: t('support.help_center'), icon: HelpCircle, action: () => navigate(tenantPath('/help')) }
    );
    return actions;
  }, [isAuthenticated, user, t, navigate, tenantPath, hasFeature, resolvedTheme, toggleTheme]);

  const isActionMode = query.startsWith('>');
  const filteredActions = useMemo(() => {
    if (!isActionMode) return [];
    const q = query.slice(1).trim().toLowerCase();
    return q ? quickActions.filter(a => a.label.toLowerCase().includes(q)) : quickActions;
  }, [query, quickActions, isActionMode]);

  // ─── Navigation helpers ────────────────────────────────────────────────
  const goToSuggestion = useCallback((s: SearchSuggestion) => {
    const paths: Record<string, string> = {
      listing: tenantPath(`/listings/${s.id}`),
      user: tenantPath(`/profile/${s.id}`),
      event: tenantPath(`/events/${s.id}`),
      group: tenantPath(`/groups/${s.id}`),
    };
    navigate(paths[s.type] || tenantPath('/search'));
    handleClose();
  }, [navigate, tenantPath, handleClose]);

  const goToSearch = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) {
      saveRecent(trimmed);
      navigate(tenantPath(`/search?q=${encodeURIComponent(trimmed)}`));
      handleClose();
    }
  }, [query, navigate, tenantPath, handleClose, saveRecent]);

  // ─── Keyboard navigation in input ──────────────────────────────────────
  const items = isActionMode ? filteredActions : suggestions;
  const itemCount = items.length;
  const isListboxVisible = itemCount > 0;
  const activeOptionId = selectedIndex >= 0 && selectedIndex < itemCount
    ? `${listboxId}-option-${selectedIndex}`
    : undefined;
  const showLoading = queryIsSearchable && isLoading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (itemCount > 0) {
        setSelectedIndex(i => (i < 0 ? 0 : (i + 1) % itemCount));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (itemCount > 0) {
        setSelectedIndex(i => (i <= 0 ? itemCount - 1 : i - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < itemCount) {
        if (isActionMode) {
          filteredActions[selectedIndex]?.action();
          handleClose();
        } else {
          const suggestion = suggestions[selectedIndex];
          if (suggestion) goToSuggestion(suggestion);
        }
      } else if (!isActionMode) {
        goToSearch();
      }
    }
  };

  // ─── Type badges ───────────────────────────────────────────────────────
  const typeLabels: Record<string, { label: string; color: string }> = {
    listing: { label: t('search.type_listing'), color: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' },
    user: { label: t('search.type_member'), color: 'bg-accent-soft text-accent dark:bg-accent-soft dark:text-accent' },
    event: { label: t('search.type_event'), color: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' },
    group: { label: t('search.type_group'), color: 'bg-surface-secondary text-accent dark:bg-surface-secondary dark:text-accent' },
  };

  return (
    <Modal
      backdrop="blur"
      classNames={{
        backdrop: 'z-[9999] bg-black/60',
        base: 'max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom)-2rem)] max-w-xl overflow-hidden rounded-xl border border-divider bg-overlay p-0 shadow-large sm:max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom)-5.5rem)]',
        body: '!m-0 flex min-h-0 flex-1 flex-col !overflow-hidden !p-0',
        wrapper: 'box-border items-start ps-[calc(var(--safe-area-left)+0.5rem)] pe-[calc(var(--safe-area-right)+0.5rem)] pt-[calc(var(--safe-area-top)+1rem)] pb-[calc(var(--safe-area-bottom)+1rem)] sm:ps-[calc(var(--safe-area-left)+2.5rem)] sm:pe-[calc(var(--safe-area-right)+2.5rem)] sm:pt-[calc(var(--safe-area-top)+4.5rem)]',
      }}
      hideCloseButton
      isDismissable
      isOpen={isOpen}
      onClose={handleClose}
      placement="top"
      scrollBehavior="inside"
      size="xl"
    >
      <ModalContent aria-label={t('search.placeholder')}>
        <ModalBody>
          <div className="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-3 sm:px-4">
            <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" />
            <input
              ref={inputRef}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              aria-busy={showLoading || undefined}
              aria-controls={isListboxVisible ? listboxId : undefined}
              aria-expanded={isListboxVisible}
              aria-haspopup="listbox"
              aria-label={t('search.placeholder')}
              autoComplete="off"
              autoFocus
              className="min-w-0 flex-1 appearance-none bg-transparent text-base text-foreground outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-search-cancel-button]:appearance-none"
              onChange={event => handleQueryChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('search.placeholder')}
              role="combobox"
              spellCheck={false}
              type="search"
              value={query}
            />
            {query && (
              <Button
                aria-label={t('aria.clear')}
                className="min-h-8 min-w-8 p-1 text-muted hover:text-foreground"
                isIconOnly
                onPress={() => {
                  handleQueryChange('');
                  inputRef.current?.focus();
                }}
                size="sm"
                variant="tertiary"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
            <Button
              aria-label={t('accessibility.close')}
              className="hidden min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs min-[360px]:flex"
              onPress={handleClose}
              size="sm"
              variant="secondary"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              <Kbd className="text-[10px]">
                <Kbd.Content>ESC</Kbd.Content>
              </Kbd>
            </Button>
          </div>

          <div aria-live="polite" className="sr-only" role="status">
            {showLoading
              ? t('search.searching')
              : itemCount > 0
                ? t('aria.search_results', { count: itemCount })
                : queryIsSearchable
                  ? t('search.no_suggestions')
                  : ''}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
            {isActionMode ? (
              <div>
                <p className="mb-2 text-xs text-muted">{t('search.actions')}</p>
                {filteredActions.length > 0 ? (
                  <div
                    aria-label={t('search.actions')}
                    className="space-y-1"
                    id={listboxId}
                    role="listbox"
                  >
                    {filteredActions.map((action, i) => {
                      const Icon = action.icon;
                      return (
                        <ComboboxOption
                          id={`${listboxId}-option-${i}`}
                          key={action.label}
                          className={`flex min-h-10 w-full min-w-0 items-center justify-start gap-3 rounded-lg px-3 py-2 text-start ${
                            i === selectedIndex ? 'bg-accent-soft' : 'hover:bg-surface-secondary'
                          }`}
                          isSelected={i === selectedIndex}
                          onHover={() => setSelectedIndex(i)}
                          onPress={() => {
                            action.action();
                            handleClose();
                          }}
                        >
                          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                          <span className="min-w-0 truncate text-sm text-foreground">{action.label}</span>
                        </ComboboxOption>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t('search.no_actions')}</p>
                )}
              </div>
            ) : suggestions.length > 0 ? (
              <div>
                <p className="mb-2 text-xs text-muted">{t('search.suggestions')}</p>
                <div
                  aria-label={t('search.suggestions')}
                  className="space-y-1"
                  id={listboxId}
                  role="listbox"
                >
                  {suggestions.map((suggestion, i) => {
                    const type = typeLabels[suggestion.type] || {
                      label: suggestion.type,
                      color: 'bg-surface-secondary text-muted',
                    };
                    return (
                      <ComboboxOption
                        id={`${listboxId}-option-${i}`}
                        key={`${suggestion.type}-${suggestion.id}`}
                        className={`flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-start ${
                          i === selectedIndex ? 'bg-accent-soft' : 'hover:bg-surface-secondary'
                        }`}
                        isSelected={i === selectedIndex}
                        onHover={() => setSelectedIndex(i)}
                        onPress={() => goToSuggestion(suggestion)}
                      >
                        <span className="min-w-0 truncate text-sm text-foreground">
                          {suggestion.title || suggestion.name}
                        </span>
                        <span className={`ms-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] ${type.color}`}>
                          {type.label}
                        </span>
                      </ComboboxOption>
                    );
                  })}
                </div>
                <Button
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-none border-t border-divider pt-3 text-sm text-accent hover:underline"
                  onPress={goToSearch}
                  variant="tertiary"
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                  {t('search.view_all')}
                  <ArrowRight aria-hidden="true" className="h-3 w-3" />
                </Button>
              </div>
            ) : showLoading ? (
              <div
                aria-busy="true"
                aria-label={t('loading')}
                className="flex items-center gap-2 py-4"
                role="status"
              >
                <div aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="text-sm text-muted">{t('search.searching')}</span>
              </div>
            ) : query.trim().length >= 2 ? (
              <div className="py-4 text-center">
                <p className="mb-2 text-sm text-muted">{t('search.no_suggestions')}</p>
                <Button
                  className="inline-flex min-h-10 items-center gap-2 text-sm text-accent hover:underline"
                  onPress={goToSearch}
                  variant="tertiary"
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                  {t('search.search_for')} "{query.trim()}"
                </Button>
              </div>
            ) : (
              <div>
                {recentSearches.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-muted">{t('search.recent')}</p>
                      <Button
                        className="min-h-7 min-w-0 px-1 py-0 text-[10px] text-muted hover:text-foreground"
                        onPress={clearRecent}
                        size="sm"
                        variant="tertiary"
                      >
                        {t('search.clear')}
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {recentSearches.map(recentQuery => (
                        <Button
                          key={recentQuery}
                          className="flex min-h-9 w-full min-w-0 items-center justify-start gap-2 rounded-lg px-3 py-1.5 text-start hover:bg-surface-secondary"
                          onPress={() => {
                            saveRecent(recentQuery);
                            navigate(tenantPath(`/search?q=${encodeURIComponent(recentQuery)}`));
                            handleClose();
                          }}
                          variant="tertiary"
                        >
                          <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
                          <span className="min-w-0 truncate text-sm text-muted">{recentQuery}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mb-2 text-xs text-muted">{t('search.quick_links')}</p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    { label: t('nav.listings'), path: tenantPath('/listings') },
                    ...(hasFeature('connections') ? [{ label: t('nav.members'), path: tenantPath('/members') }] : []),
                    { label: t('nav.events'), path: tenantPath('/events') },
                    { label: t('support.help_center'), path: tenantPath('/help') },
                  ].map(link => (
                    <Button
                      key={link.path}
                      className="min-h-9 rounded-lg px-3 py-1.5 text-sm"
                      onPress={() => {
                        navigate(link.path);
                        handleClose();
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {link.label}
                    </Button>
                  ))}
                </div>

                <p className="border-t border-divider pt-2 text-[11px] text-muted">
                  {t('search.actions_hint')}
                </p>
              </div>
            )}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default SearchOverlay;
