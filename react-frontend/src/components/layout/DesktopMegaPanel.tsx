// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Desktop mega panel — the open, self-sizing panel behind the header's
 * "More" and "Community" triggers.
 *
 * - One column per group that has items; nothing folds.
 * - Columns are content-sized. Descriptions never widen a column (they are
 *   zero-width with min-width 100%) and wrap to at most two lines.
 * - The panel is rendered inline, absolutely positioned under the nearest
 *   `[data-mega-panel-bounds]` ancestor (the header's content container,
 *   which must be the panel's containing block). HeroUI's Popover is not
 *   used because it can only place content relative to its trigger, so it
 *   cannot centre a wide panel under the bar.
 * - Width comes from the VIEWPORT less a 16px gutter each side, not from the
 *   bounds container: the panel is centred on the container (itself centred
 *   in the viewport) and may extend past its edges. Height is capped at the
 *   viewport below the panel's own top edge, less 16px.
 * - React Aria still does what it is good at: `FocusScope` traps focus and
 *   restores it to the trigger on close, `useInteractOutside` dismisses.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FocusScope } from '@react-aria/focus';
import { useInteractOutside } from '@react-aria/interactions';
import ChevronDown from 'lucide-react/icons/chevron-down';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import {
  layoutMegaPanel,
  MEGA_PANEL_MIN_COLUMN_PX,
  MEGA_PANEL_VIEWPORT_GUTTER_PX,
  type MegaPanelLayout,
} from './megaPanelLayout';

export type MegaPanelTone = 'main' | 'engage' | 'progress' | 'tools' | 'partner' | 'about' | 'community' | 'explore';

export interface MegaPanelItem {
  label: string;
  desc?: string;
  href: string;
  icon: LucideIcon;
}

export interface MegaPanelGroup {
  key: string;
  title: string;
  tone: MegaPanelTone;
  items: MegaPanelItem[];
}

export interface DesktopMegaPanelProps {
  ariaLabel: string;
  triggerLabel: string;
  triggerIcon: LucideIcon;
  isActive: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  groups: MegaPanelGroup[];
  onNavigate: (href: string) => void;
  /** Width the panel may use; defaults to the viewport width less a 16px gutter each side, re-measured on resize. */
  availableWidthPx?: number;
}

/**
 * Each group's colour, as a theme token defined for both light and dark in
 * `src/styles/tokens.css`. The `--text-*` status tokens are the
 * contrast-measured foreground shades, so the icon reads on its 12% tint.
 */
const TONE_COLOUR: Record<MegaPanelTone, string> = {
  main: 'var(--accent)',
  engage: 'var(--accent)',
  explore: 'var(--accent)',
  about: 'var(--accent)',
  progress: 'var(--text-warning)',
  tools: 'var(--text-muted)',
  partner: 'var(--text-success)',
  community: 'var(--text-danger)',
};

const BOUNDS_SELECTOR = '[data-mega-panel-bounds]';

/**
 * Column dividers are inset shadows rather than borders so they take no
 * width from the 150px description area. Keyed by `${hasLeft}-${hasTop}`.
 */
const DIVIDER_CLASSES: Record<string, string> = {
  'false-false': '',
  'true-false': 'shadow-[inset_1px_0_0_var(--border-default)]',
  'false-true': 'shadow-[inset_0_1px_0_var(--border-default)]',
  'true-true': 'shadow-[inset_1px_0_0_var(--border-default),inset_0_1px_0_var(--border-default)]',
};

type PanelPosition = 'full' | 'centre' | 'trigger';

function findBounds(node: Element | null): HTMLElement | null {
  return node?.closest<HTMLElement>(BOUNDS_SELECTOR) ?? null;
}

function viewportWidth(): number {
  const width = document.documentElement.clientWidth;
  return width > 0 ? width : window.innerWidth;
}

function availableViewportWidth(): number {
  return Math.max(0, viewportWidth() - 2 * MEGA_PANEL_VIEWPORT_GUTTER_PX);
}

/**
 * Width the panel may use: the viewport less the gutters, kept current on
 * resize (the ResizeObserver also catches a scrollbar appearing).
 */
function useViewportWidth(enabled: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return undefined;

    const read = () => setWidth(availableViewportWidth());
    read();

    window.addEventListener('resize', read);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  }, [enabled]);

  return width;
}

function panelPosition(layout: MegaPanelLayout, groupCount: number): PanelPosition {
  if (layout.rows === 2) return 'full';
  return groupCount >= 3 ? 'centre' : 'trigger';
}

const POSITION_CLASSES: Record<PanelPosition, string> = {
  // Two rows only happen when one row would not fit, so take the full
  // available width, centred.
  full: 'left-1/2 -translate-x-1/2 w-[var(--mega-panel-max-w)]',
  // Content-sized and capped at the available width.
  centre: 'left-1/2 -translate-x-1/2 w-max max-w-[var(--mega-panel-max-w)]',
  trigger: 'left-[var(--mega-panel-left)] w-max max-w-[var(--mega-panel-max-w)]',
};

export function DesktopMegaPanel({
  ariaLabel,
  triggerLabel,
  triggerIcon: TriggerIcon,
  isActive,
  isOpen,
  onOpenChange,
  groups,
  onNavigate,
  availableWidthPx,
}: DesktopMegaPanelProps): JSX.Element | null {
  const { t } = useTranslation('common');
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const panelId = useId();

  const visibleGroups = useMemo(() => groups.filter(group => group.items.length > 0), [groups]);
  const hasGroups = visibleGroups.length > 0;

  const measuredWidth = useViewportWidth(hasGroups && availableWidthPx === undefined);
  const width = availableWidthPx ?? measuredWidth ?? (typeof window === 'undefined' ? 0 : availableViewportWidth());
  const layout = layoutMegaPanel(visibleGroups.length, width);
  const position = panelPosition(layout, visibleGroups.length);

  const [anchorLeft, setAnchorLeft] = useState(0);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  // Anchor a one- or two-group panel under the trigger, pulled left just
  // enough to stay inside the viewport gutters.
  useLayoutEffect(() => {
    if (!isOpen || position !== 'trigger') return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const trigger = root?.querySelector<HTMLElement>('[data-mega-trigger]');
    if (!root || !panel || !trigger) return;

    const bounds = findBounds(root);
    const boundsLeft = bounds ? bounds.getBoundingClientRect().left : 0;
    const minLeft = MEGA_PANEL_VIEWPORT_GUTTER_PX - boundsLeft;
    const maxLeft = viewportWidth() - MEGA_PANEL_VIEWPORT_GUTTER_PX - boundsLeft - panel.offsetWidth;
    const triggerLeft = trigger.getBoundingClientRect().left - boundsLeft;
    const next = Math.max(minLeft, Math.min(triggerLeft, maxLeft));
    setAnchorLeft(prev => (prev === next ? prev : next));
  }, [isOpen, position, width, visibleGroups]);

  // Cap the height at the viewport below the panel's own top edge, less the
  // gutter. Measured on open and on every resize; 75vh until then.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const read = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const next = Math.max(0, Math.floor(window.innerHeight - panel.getBoundingClientRect().top - MEGA_PANEL_VIEWPORT_GUTTER_PX));
      setMaxHeight(prev => (prev === next ? prev : next));
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [isOpen]);

  useInteractOutside({
    ref: rootRef,
    isDisabled: !isOpen,
    // Close on the press itself, as the old popover did. The trigger lives
    // inside rootRef, so pressing it toggles rather than closing and reopening.
    onInteractOutsideStart: () => onOpenChange(false),
    onInteractOutside: () => undefined,
  });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    const nav = navRef.current;
    if (!nav) return;
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-mega-item]'));
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusedIndex = currentIndex >= 0 ? currentIndex : 0;
    const column = Number(buttons[focusedIndex]?.dataset.megaCol ?? 0);
    const firstOfColumn = (col: number) => buttons.find(button => Number(button.dataset.megaCol) === col);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        buttons[(focusedIndex + 1) % buttons.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        buttons[(focusedIndex - 1 + buttons.length) % buttons.length]?.focus();
        break;
      case 'ArrowRight':
        event.preventDefault();
        firstOfColumn(column + 1)?.focus();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        firstOfColumn(column - 1)?.focus();
        break;
      case 'Home':
        event.preventDefault();
        buttons[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        buttons[buttons.length - 1]?.focus();
        break;
      default:
        break;
    }
  }, [onOpenChange]);

  if (!hasGroups) return null;

  const renderItem = (item: MegaPanelItem, columnIndex: number) => {
    const active = location.pathname.startsWith(item.href);
    const Icon = item.icon;

    return (
      <Button
        key={item.href}
        data-desktop-nav-item
        data-mega-item
        data-mega-col={columnIndex}
        onPress={() => onNavigate(item.href)}
        variant="light"
        className={`group w-full flex !h-auto items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-start transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 justify-start ${
          active
            ? 'bg-theme-active text-theme-primary'
            : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
        }`}
      >
        <span className="mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--mega-tone)_12%,transparent)] text-[var(--mega-tone)]">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-nowrap text-sm font-semibold leading-tight">{item.label}</span>
          {item.desc ? (
            <span className="mt-0.5 w-0 min-w-full whitespace-normal line-clamp-2 text-xs leading-snug text-theme-subtle">
              {item.desc}
            </span>
          ) : null}
        </span>
      </Button>
    );
  };

  const renderColumn = (group: MegaPanelGroup, index: number) => {
    const perRow = Math.max(layout.columnsPerRow, 1);
    const row = layout.rows === 2 ? Math.floor(index / perRow) : 0;
    const indexInRow = layout.rows === 2 ? index % perRow : index;
    const toneStyle = { '--mega-tone': TONE_COLOUR[group.tone] } as CSSProperties;

    return (
      <div
        key={group.key}
        data-mega-group={group.key}
        style={toneStyle}
        className={`min-w-[var(--mega-col-min)] px-2.5 py-2 ${DIVIDER_CLASSES[`${indexInRow > 0}-${row > 0}`]}`}
      >
        <p className="mb-1 px-2.5 pt-1 text-xs font-semibold uppercase tracking-wider text-theme-subtle">
          {group.title}
        </p>
        <div className="space-y-0.5">
          {group.items.map(item => renderItem(item, index))}
        </div>
      </div>
    );
  };

  const gridClasses = layout.rows === 2
    ? 'grid-cols-[repeat(var(--mega-cols),minmax(0,auto))]'
    : 'grid-flow-col auto-cols-[minmax(0,auto)]';
  const panelStyle = {
    '--mega-panel-left': `${anchorLeft}px`,
    '--mega-cols': layout.columnsPerRow,
    // Every column is at least as wide as the layout rule assumed when it
    // chose one row or two. Without this a column of short labels ("Goals",
    // "Polls") shrinks to the label and squeezes its descriptions to a few
    // characters per line.
    '--mega-col-min': `${MEGA_PANEL_MIN_COLUMN_PX}px`,
    '--mega-panel-max-w': `${width}px`,
    ...(maxHeight === null ? {} : { '--mega-panel-max-h': `${maxHeight}px` }),
  } as CSSProperties;

  return (
    <div ref={rootRef} className="contents">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isOpen ? t('accessibility.menu_opened') : ''}
      </div>
      <Button
        data-mega-trigger
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        variant="light"
        size="sm"
        onPress={() => onOpenChange(!isOpen)}
        className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-all ${
          isActive
            ? 'bg-theme-active text-theme-primary'
            : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
        }`}
        endContent={<ChevronDown className="w-3 h-3" aria-hidden="true" />}
      >
        <TriggerIcon className="w-4 h-4" aria-hidden="true" />
        {triggerLabel}
      </Button>
      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          data-mega-panel
          data-position={position}
          style={panelStyle}
          className={`absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-dropdown)] shadow-2xl max-h-[var(--mega-panel-max-h,75vh)] ${POSITION_CLASSES[position]}`}
        >
          <FocusScope contain restoreFocus>
            <MegaPanelBody navRef={navRef}>
              <h2 className="sr-only">{ariaLabel}</h2>
              <ScrollShadow className="max-h-[calc(var(--mega-panel-max-h,75vh)-2px)]" size={56}>
                {/* The keydown handler is delegated roving-focus navigation for
                    the buttons inside (arrows / Home / End / Escape). The rule
                    reads <nav> as non-interactive; the listener adds keyboard
                    support rather than removing it. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                <nav
                  ref={navRef}
                  aria-label={ariaLabel}
                  data-rows={layout.rows}
                  data-columns={layout.columnsPerRow}
                  onKeyDown={handleKeyDown}
                  className={`grid gap-0 py-1 ${gridClasses}`}
                >
                  {visibleGroups.map(renderColumn)}
                </nav>
              </ScrollShadow>
            </MegaPanelBody>
          </FocusScope>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Focuses the first item once the panel has mounted. It sits inside the
 * FocusScope so the scope has already recorded the trigger as the element
 * to restore focus to.
 */
function MegaPanelBody({ navRef, children }: { navRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  useEffect(() => {
    navRef.current?.querySelector<HTMLButtonElement>('button[data-mega-item]')?.focus();
  }, [navRef]);

  return <>{children}</>;
}

export default DesktopMegaPanel;
