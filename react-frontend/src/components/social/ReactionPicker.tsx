// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';

import Clock from 'lucide-react/icons/clock';
import Heart from 'lucide-react/icons/heart';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  REACTION_CONFIGS,
  type ReactionType,
} from './reactions';

const ReactionPickerMenu = lazy(() => import('./ReactionPickerMenu').then((module) => ({ default: module.ReactionPickerMenu })));

export type { ReactionType } from './reactions';
export { REACTION_CONFIGS, REACTION_EMOJI_MAP, REACTION_LABEL_MAP } from './reactions';

export interface ReactionPickerProps {
  userReaction: ReactionType | null;
  onReact: (type: ReactionType) => void;
  isAuthenticated: boolean;
  isDisabled?: boolean;
  size?: 'sm' | 'md';
}

// The member's own reaction, as a small coloured label on a white card. The
// -500 shades read at 2.5–3.7:1 there (axe, 10 Nov 2026: "Celebrate" at
// 2.47:1); -700 on light and -400 on dark clear 4.5:1.
const getReactionColor = (type: ReactionType | null): string => {
  if (!type) return 'text-[var(--text-muted)] hover:text-rose-500';

  switch (type) {
    case 'love':
      return 'text-rose-700 dark:text-rose-400 font-medium';
    case 'like':
      return 'text-[var(--color-info)] font-medium';
    case 'laugh':
    case 'wow':
      return 'text-[var(--color-warning)] font-medium';
    case 'sad':
      return 'text-blue-700 dark:text-blue-400 font-medium';
    case 'celebrate':
      return 'text-emerald-700 dark:text-emerald-400 font-medium';
    case 'clap':
      return 'text-orange-700 dark:text-orange-400 font-medium';
    case 'time_credit':
      return 'text-accent font-medium';
    default:
      return 'text-[var(--text-muted)]';
  }
};

export function ReactionPicker({
  userReaction,
  onReact,
  isAuthenticated,
  isDisabled = false,
  size = 'md',
}: ReactionPickerProps) {
  const { t } = useTranslation('feed');
  const pickerId = useId();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isLongPressRef = useRef(false);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (!isAuthenticated || isDisabled) return;

    hoverTimeoutRef.current = setTimeout(() => {
      setIsPickerOpen(true);
    }, 300);
  }, [isAuthenticated, isDisabled]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    closeTimeoutRef.current = setTimeout(() => {
      setIsPickerOpen(false);
      closeTimeoutRef.current = null;
    }, 300);
  }, []);

  const handleTouchStart = useCallback(() => {
    if (!isAuthenticated || isDisabled) return;

    isLongPressRef.current = false;
    longPressTimeoutRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setIsPickerOpen(true);
    }, 350);
  }, [isAuthenticated, isDisabled]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  const handleSelectReaction = useCallback(
    (type: ReactionType) => {
      onReact(type);
      setIsPickerOpen(false);
    },
    [onReact]
  );

  const handleKeepPickerOpen = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleQuickTap = useCallback(() => {
    if (!isAuthenticated || isDisabled) return;

    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }

    onReact(userReaction ?? 'like');
  }, [isAuthenticated, isDisabled, userReaction, onReact]);

  useEffect(() => {
    if (!isPickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPickerOpen]);

  useEffect(() => {
    if (!isPickerOpen) {
      setFocusedIndex(null);
    }
  }, [isPickerOpen]);

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!isAuthenticated || isDisabled) return;

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const startIndex = userReaction
          ? Math.max(0, REACTION_CONFIGS.findIndex((reaction) => reaction.type === userReaction))
          : 0;

        setIsPickerOpen(true);
        setFocusedIndex(startIndex);
      } else if (event.key === 'Escape' && isPickerOpen) {
        event.preventDefault();
        setIsPickerOpen(false);
        triggerRef.current?.focus();
      }
    },
    [isAuthenticated, isDisabled, isPickerOpen, userReaction]
  );

  const currentConfig = userReaction ? REACTION_CONFIGS.find((reaction) => reaction.type === userReaction) : null;
  const buttonLabel = currentConfig ? t(currentConfig.label) : t('card.like_action');
  const buttonEmoji = currentConfig ? currentConfig.emoji : null;

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isPickerOpen && (
        <Suspense fallback={null}>
          <ReactionPickerMenu
            pickerId={pickerId}
            userReaction={userReaction}
            focusedIndex={focusedIndex}
            onFocusedIndexChange={setFocusedIndex}
            onKeepOpen={handleKeepPickerOpen}
            onClose={() => setIsPickerOpen(false)}
            onSelectReaction={handleSelectReaction}
            focusTrigger={() => triggerRef.current?.focus()}
          />
        </Suspense>
      )}

      <Button
        ref={triggerRef}
        size={size}
        variant="light"
        className={`flex-1 max-w-[140px] ${getReactionColor(userReaction)} transition-colors`}
        startContent={
          buttonEmoji ? (
            userReaction === 'time_credit' ? (
              <Clock className="w-[18px] h-[18px]" aria-hidden="true" />
            ) : (
              <span className="text-lg leading-none" aria-hidden="true">{buttonEmoji}</span>
            )
          ) : (
            <Heart
              className={`w-[18px] h-[18px] transition-all ${userReaction === 'love' ? 'fill-rose-500 text-rose-500 scale-110' : ''}`}
              aria-hidden="true"
            />
          )
        }
        onPress={handleQuickTap}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleTriggerKeyDown}
        isDisabled={!isAuthenticated || isDisabled}
        aria-label={userReaction ? t('reaction.click_to_remove', { label: buttonLabel }) : t('reaction.react_to_post')}
        aria-haspopup="menu"
        aria-expanded={isPickerOpen}
        aria-controls={pickerId}
        aria-pressed={userReaction !== null}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}

export default ReactionPicker;
