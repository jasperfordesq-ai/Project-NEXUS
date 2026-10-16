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
 * - React Aria still does what it is good at: `FocusScope` traps focus and
 *   restores it to the trigger on close, `useInteractOutside` dismisses.
 */

import {
  useCallback,
  useEffect,
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
import { layoutMegaPanel, type MegaPanelLayout } from './megaPanelLayout';

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
  /** Width the panel may use; defaults to the nearest `[data-mega-panel-bounds]` ancestor's width, measured with ResizeObserver. */
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

type PanelPosition = 'full' | 'centre' | 'trigger';

function findBounds(node: Element | null): HTMLElement | null {
  return node?.closest<HTMLElement>(BOUNDS_SELECTOR) ?? null;
}

function viewportWidth(): number {
  const width = document.documentElement.clientWidth;
  return width > 0 ? width : window.innerWidth;
}

/**
 * Width of the bounds container, kept current with a ResizeObserver. Falls
 * back to the viewport when there is no bounds ancestor, and to a window
 * resize listener where ResizeObserver does not exist.
 */
function useBoundsWidth(rootRef: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return undefined;

    const bounds = findBounds(rootRef.current);
    const read = () => {
      const measured = bounds ? bounds.clientWidth : viewportWidth();
      setWidth(measured > 0 ? measured : viewportWidth());
    };
    read();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }

    const observer = new ResizeObserver(read);
    observer.observe(bounds ?? document.documentElement);
    return () => observer.disconnect();
  }, [enabled, rootRef]);

  return width;
}

function panelPosition(layout: MegaPanelLayout, groupCount: number): PanelPosition {
  if (layout.rows === 2) return 'full';
  return groupCount >= 3 ? 'centre' : 'trigger';
}

const POSITION_CLASSES: Record<PanelPosition, string> = {
  // Two rows only happen when one row would not fit, so fill the bounds.
  full: 'left-0 right-0',
  // Content-sized and capped at the bounds; at the cap this spans edge to edge.
  centre: 'left-1/2 -translate-x-1/2 w-max max-w-full',
  trigger: 'left-[var(--mega-panel-left)] w-max max-w-full',
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

  const visibleGroups = useMemo(() => groups.filter(group => group.items.length > 0), [groups]);
  const hasGroups = visibleGroups.length > 0;

  const measuredWidth = useBoundsWidth(rootRef, hasGroups && availableWidthPx === undefined);
  const width = availableWidthPx ?? measuredWidth ?? (typeof window === 'undefined' ? 0 : viewportWidth());
  const layout = layoutMegaPanel(visibleGroups.length, width);
  const position = panelPosition(layout, visibleGroups.length);

  const [anchorLeft, setAnchorLeft] = useState(0);

  // Anchor a one- or two-group panel under the trigger, pulled left just
  // enough to stay inside the bounds.
  useLayoutEffect(() => {
    if (!isOpen || position !== 'trigger') return;
    const root = rootRef.current;
    const panel = panelRef.current;
    const trigger = root?.querySelector<HTMLElement>('[data-mega-trigger]');
    if (!root || !panel || !trigger) return;

    const bounds = findBounds(root);
    const boundsLeft = bounds ? bounds.getBoundingClientRect().left : 0;
    const boundsWidth = bounds ? bounds.clientWidth : viewportWidth();
    const triggerLeft = trigger.getBoundingClientRect().left - boundsLeft;
    const next = Math.max(0, Math.min(triggerLeft, boundsWidth - panel.offsetWidth));
    setAnchorLeft(prev => (prev === next ? prev : next));
  }, [isOpen, position, width, visibleGroups]);

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
        className={`group w-full flex !h-auto min-h-[3.5rem] items-start gap-3 rounded-lg px-3 py-2.5 text-start transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 justify-start ${
          active
            ? 'bg-theme-active text-theme-primary'
            : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
        }`}
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--mega-tone)_12%,transparent)] text-[var(--mega-tone)]">
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
        className={`min-w-0 p-2 ${indexInRow > 0 ? 'border-l border-[var(--border-default)]' : ''} ${row > 0 ? 'border-t border-[var(--border-default)]' : ''}`}
      >
        <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-theme-subtle">
          {group.title}
        </p>
        <div className="mt-0.5 space-y-0.5">
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
  } as CSSProperties;

  return (
    <div ref={rootRef} className="contents">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isOpen ? t('accessibility.menu_opened') : ''}
      </div>
      <Button
        data-mega-trigger
        aria-haspopup="true"
        aria-expanded={isOpen}
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
          data-mega-panel
          data-position={position}
          style={panelStyle}
          className={`absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-dropdown)] shadow-2xl max-h-[75vh] ${POSITION_CLASSES[position]}`}
        >
          <FocusScope contain restoreFocus>
            <MegaPanelBody navRef={navRef}>
              <h2 className="sr-only">{ariaLabel}</h2>
              <ScrollShadow className="max-h-[75vh]" size={56}>
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
                  className={`grid gap-0 p-2 ${gridClasses}`}
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
