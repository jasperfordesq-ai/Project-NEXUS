// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MobileSearchOverlay — Full-screen phone search experience for list pages.
 *
 * The Instagram/Facebook pattern: tapping a page's search pill slides up a
 * full-screen overlay with an autofocused search input and the page's recent
 * searches. Typing updates the page's own query state live (the list behind
 * keeps filtering); the keyboard's Search key or a recent-search tap commits
 * the query, records it, and closes the overlay to reveal the results.
 *
 * Rendered via createPortal at z-[400] above Navbar/MobileTabBar (z-300),
 * following the MobileComposeOverlay pattern. Desktop never renders this —
 * pages gate it behind their phone media query.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@react-aria/focus';
import { motion, AnimatePresence } from '@/lib/motion';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import { logError } from '@/lib/logger';
import { useAuth, useTenant } from '@/contexts';
import { userScopedStorageKey } from '@/lib/userScopedStorage';

const MAX_RECENT = 8;

function storageKey(recentKey: string): string {
  return `nexus:recent-searches:${recentKey}`;
}

function readRecents(recentKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(recentKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecents(recentKey: string, recents: string[]): void {
  try {
    window.localStorage.setItem(storageKey(recentKey), JSON.stringify(recents.slice(0, MAX_RECENT)));
  } catch (error) {
    // Quota/private-mode failures must never break search itself.
    logError('mobile-search-recents-write', error);
  }
}

export interface MobileSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** The page's live query state — typing propagates immediately. */
  value: string;
  onValueChange: (value: string) => void;
  /** Called when the user commits a query (Search key or recent tap). */
  onSubmit?: (value: string) => void;
  placeholder: string;
  /** Namespace for the page's recent-search history, e.g. 'listings'. */
  recentKey: string;
}

export function MobileSearchOverlay({
  isOpen,
  onClose,
  value,
  onValueChange,
  onSubmit,
  placeholder,
  recentKey: pageRecentKey,
}: MobileSearchOverlayProps) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { tenant } = useTenant();
  // F-109: search history is private to one member of one community; the key
  // names both, and sign-out clears every `nexus:recent-searches:` entry.
  const recentKey = userScopedStorageKey(pageRecentKey, tenant?.id, user?.id);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) setRecents(readRecents(recentKey));
  }, [isOpen, recentKey]);

  // Close on Escape key (parity with MobileComposeOverlay).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const commit = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed) {
      const next = [trimmed, ...readRecents(recentKey).filter((r) => r !== trimmed)];
      writeRecents(recentKey, next);
      setRecents(next.slice(0, MAX_RECENT));
    }
    onValueChange(query);
    onSubmit?.(query);
    onClose();
  }, [onClose, onSubmit, onValueChange, recentKey]);

  const clearRecents = useCallback(() => {
    writeRecents(recentKey, []);
    setRecents([]);
  }, [recentKey]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <FocusScope contain restoreFocus>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={placeholder}
            className="fixed inset-0 z-[400] flex flex-col bg-[var(--surface-base)] pt-[env(safe-area-inset-top,0px)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* ── Header: back + autofocused input ── */}
            <div className="flex items-center gap-2 min-h-14 px-3 py-1.5 border-b border-[var(--border-default)] shrink-0">
              <Button
                isIconOnly
                variant="tertiary"
                size="sm"
                onPress={onClose}
                aria-label={t('search.close_search')}
                className="size-11 min-h-11"
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </Button>
              <SearchField
                autoFocus
                placeholder={placeholder}
                aria-label={placeholder}
                value={value}
                onValueChange={onValueChange}
                onSubmit={(submitted: string) => commit(submitted)}
                className="flex-1"
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                }}
              />
            </div>

            {/* ── Recent searches ── */}
            <div className="flex-1 overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              {recents.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-2 pt-3 pb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                      {t('search.recent')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={clearRecents}
                      className="min-h-11 text-xs text-[var(--text-subtle)]"
                    >
                      {t('search.clear_recent')}
                    </Button>
                  </div>
                  <ul>
                    {recents.map((recent) => (
                      <li key={recent}>
                        <Button
                          variant="ghost"
                          onPress={() => commit(recent)}
                          className="min-h-11 w-full justify-start gap-3 px-2 text-sm font-normal text-[var(--text-primary)]"
                        >
                          <Clock className="w-4 h-4 shrink-0 text-[var(--text-subtle)]" aria-hidden="true" />
                          <span className="truncate">{recent}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        </FocusScope>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default MobileSearchOverlay;
