// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import { Tooltip } from '@/components/ui/Tooltip';
import { REACTION_CONFIGS, type ReactionType } from './reactions';

interface ReactionPickerMenuProps {
  pickerId: string;
  userReaction: ReactionType | null;
  focusedIndex: number | null;
  onFocusedIndexChange: Dispatch<SetStateAction<number | null>>;
  onKeepOpen: () => void;
  onClose: () => void;
  onSelectReaction: (type: ReactionType) => void;
  focusTrigger: () => void;
}

export function ReactionPickerMenu({
  pickerId,
  userReaction,
  focusedIndex,
  onFocusedIndexChange,
  onKeepOpen,
  onClose,
  onSelectReaction,
  focusTrigger,
}: ReactionPickerMenuProps) {
  const { t } = useTranslation('feed');
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);

  useEffect(() => {
    if (focusedIndex !== null) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  // Clamp the menu within the viewport: measure the untransformed layout
  // (offsetLeft/offsetWidth are unaffected by the entrance scale animation)
  // and apply a corrective horizontal translate when the pill would clip at
  // a screen edge. Prioritises keeping the left edge visible.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const offsetParent = el.offsetParent as HTMLElement | null;
    const baseLeft = (offsetParent?.getBoundingClientRect().left ?? 0) + el.offsetLeft;
    const width = el.offsetWidth;
    const pad = 8;
    const viewportWidth = window.innerWidth;
    let shift = 0;
    if (baseLeft + width > viewportWidth - pad) {
      shift = viewportWidth - pad - (baseLeft + width);
    }
    if (baseLeft + shift < pad) {
      shift = pad - baseLeft;
    }
    setShiftX(Math.round(shift));
  }, []);

  const handlePickerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      focusTrigger();
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onFocusedIndexChange((index) => {
        const current = index ?? 0;
        const length = REACTION_CONFIGS.length;
        return e.key === 'ArrowRight'
          ? (current + 1) % length
          : (current - 1 + length) % length;
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      onFocusedIndexChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onFocusedIndexChange(REACTION_CONFIGS.length - 1);
    }
  };

  return (
    <motion.div
      ref={wrapperRef}
      initial={{ opacity: 0, scale: 0.6, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="absolute bottom-full left-0 pb-2 z-50 translate-x-[var(--reaction-menu-shift,0px)]"
      style={{ '--reaction-menu-shift': `${shiftX}px` } as CSSProperties}
      onMouseEnter={onKeepOpen}
      onKeyDown={handlePickerKeyDown}
    >
      <div
        id={pickerId}
        role="menu"
        aria-label={t('reaction.react_to_post')}
        className="flex items-center gap-0.5 px-2 py-1.5 rounded-full bg-[var(--surface-dropdown)]/95 backdrop-blur-xl border border-[var(--border-default)] shadow-xl shadow-black/20 max-w-[calc(100vw-1rem)] overflow-x-auto"
      >
        {REACTION_CONFIGS.map((config, index) => (
          <Tooltip
            key={config.type}
            content={t(config.label)}
            delay={200}
            closeDelay={0}
            size="sm"
            placement="top"
          >
            <motion.button
              ref={(element: HTMLButtonElement | null) => { itemRefs.current[index] = element; }}
              whileHover={{ scale: 1.35, y: -4 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className={`w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 shrink-0 flex items-center justify-center rounded-full cursor-pointer text-xl transition-colors
                ${userReaction === config.type
                  ? 'bg-[var(--surface-active)] ring-2 ring-[var(--color-primary)]/40'
                  : 'hover:bg-[var(--surface-hover)]'
                }`}
              onClick={() => onSelectReaction(config.type)}
              aria-label={t(config.label)}
              // `aria-pressed` is not a valid attribute on role="menuitem", so
              // assistive tech was told nothing about which reaction is
              // currently active. Inside a role="menu" the correct single-select
              // role is `menuitemradio`, whose state attribute is `aria-checked`
              // (only one reaction can be active at a time). Fixed 2026-08-28.
              aria-checked={userReaction === config.type}
              role="menuitemradio"
              tabIndex={focusedIndex === index ? 0 : -1}
              type="button"
            >
              {config.type === 'time_credit' ? (
                <Clock className="w-5 h-5 text-accent" aria-hidden="true" />
              ) : (
                <span role="img" aria-label={t(config.label)}>{config.emoji}</span>
              )}
            </motion.button>
          </Tooltip>
        ))}
      </div>
    </motion.div>
  );
}

export default ReactionPickerMenu;
