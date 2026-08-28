// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MentionAutocomplete — Dropdown/popover for @mention user suggestions.
 *
 * Rendered absolutely positioned relative to the trigger element.
 * Supports keyboard navigation, loading states, and empty states.
 */

import { type Ref } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';

import UserCheck from 'lucide-react/icons/user-check';
import { useTranslation } from 'react-i18next';
import { resolveAvatarUrl } from '@/lib/helpers';
import { Avatar, Skeleton } from '@/components/ui';

/* ─── Types ─────────────────────────────────────────────────── */

export interface MentionSuggestion {
  id: number;
  name: string;
  username?: string | null;
  avatar_url: string | null;
  is_connection?: boolean;
}

export interface MentionAutocompleteProps {
  /** Whether the dropdown is visible */
  isOpen: boolean;
  /** List of user suggestions */
  suggestions: MentionSuggestion[];
  /** Index of the currently highlighted item */
  selectedIndex: number;
  /** Whether suggestions are being loaded */
  isLoading: boolean;
  /** The current search query (for text highlighting) */
  query: string;
  /** Called when a suggestion is selected */
  onSelect: (user: MentionSuggestion) => void;
  /** Called when the mouse enters an item (updates selectedIndex) */
  onHover: (index: number) => void;
  /** Position style — override for custom positioning */
  style?: React.CSSProperties;
  /** Additional className for the container */
  className?: string;
}

/* ─── Highlight helper ──────────────────────────────────────── */

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[var(--color-primary)] font-bold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

/* ─── Component ─────────────────────────────────────────────── */

export function MentionAutocomplete(
  { isOpen, suggestions, selectedIndex, isLoading, query, onSelect, onHover, style, className = '', ref }: MentionAutocompleteProps & { ref?: Ref<HTMLDivElement> },
) {
    const { t } = useTranslation('social');
    if (!isOpen) return null;

    return (
      <AnimatePresence>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className={`absolute z-50 w-full max-w-xs bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg overflow-hidden ${className}`}
          style={style}
          id="mention-listbox"
          role="listbox"
          aria-label={t('mention.suggestions_aria', { count: suggestions.length })}
        >
          {isLoading ? (
            /* Loading skeleton */
            <div className="p-2 space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                  <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-24 rounded" />
                    <Skeleton className="h-2.5 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : suggestions.length === 0 ? (
            /* Empty state */
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-[var(--text-subtle)]">{t('mention.no_users')}</p>
            </div>
          ) : (
            /* Results list */
            <div className="py-1">
              {suggestions.map((user, idx) => (
                /* Native role="option" element: a listbox option must expose
                   the `option` role + id so the combobox's aria-activedescendant
                   resolves. HeroUI Button does not forward role="option", so a
                   div is correct here. Keyboard activation is handled by the
                   combobox input (Enter in MentionInput); the option itself is
                   not in the tab order. */
                <div
                  key={user.id}
                  role="option"
                  id={`mention-option-${user.id}`}
                  aria-selected={idx === selectedIndex}
                  // Focusable but not tabbable, per the comment above: focus
                  // stays on the combobox input. Added 2026-08-28.
                  tabIndex={-1}
                  className={`w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 text-left transition-colors justify-start rounded-none cursor-pointer ${
                    idx === selectedIndex
                      ? 'bg-accent-soft dark:bg-accent-soft text-[var(--color-primary)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent input blur
                    onSelect(user);
                  }}
                  onMouseEnter={() => onHover(idx)}
                >
                  <Avatar
                    name={user.name}
                    src={resolveAvatarUrl(user.avatar_url)}
                    size="sm"
                    className="w-7 h-7 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      <HighlightText text={user.name} query={query} />
                    </p>
                    {user.username && (
                      <p className="text-[10px] text-[var(--text-subtle)] truncate">
                        @<HighlightText text={user.username} query={query} />
                      </p>
                    )}
                  </div>
                  {user.is_connection && (
                    <UserCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" aria-label={t('mention.connected')} />
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    );
}

export default MentionAutocomplete;
