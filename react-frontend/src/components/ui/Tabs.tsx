// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type Key,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Tabs as HeroUITabs } from '@heroui/react/tabs';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';

type HeroUITabsProps = ComponentPropsWithoutRef<typeof HeroUITabs>;
type TabsVariant = 'solid' | 'bordered' | 'light' | 'underlined' | 'primary' | 'secondary';

export type TabProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  children?: ReactNode;
  isDisabled?: boolean;
  title?: ReactNode;
};

export type TabsProps = Omit<
  HeroUITabsProps,
  'children' | 'className' | 'color' | 'onChange' | 'orientation' | 'variant'
> & {
  'aria-label'?: string;
  children?: ReactNode;
  className?: string;
  classNames?: {
    base?: string;
    tabList?: string;
    tab?: string;
    tabContent?: string;
    cursor?: string;
    panel?: string;
  };
  color?: string;
  disableAnimation?: boolean;
  disableCursorAnimation?: boolean;
  fullWidth?: boolean;
  isVertical?: boolean;
  orientation?: 'horizontal' | 'vertical';
  placement?: string;
  radius?: string;
  /**
   * An overflowing horizontal tab strip gets touch panning, edge chevron
   * buttons (shown only when there is more to scroll), and keeps the selected
   * tab in view. Fixes the "can't reach tabs past the visible ones on mobile"
   * trap — a hidden-scrollbar strip that only scrolls by an easily-missed
   * swipe. Default ON for horizontal strips; pass false for a strip that
   * manages its own overflow.
   */
  scrollAffordance?: boolean;
  size?: string;
  variant?: TabsVariant;
};

function combineClasses(...classes: Array<string | false | undefined>): string | undefined {
  const className = classes.filter(Boolean).join(' ');

  return className || undefined;
}

/**
 * Recover the caller's own key from the one `Children.toArray` assigns.
 *
 * toArray encodes each child's path: a top-level `<Tab key="all">` becomes
 * ".$all", but a tab produced by a `.map()` placed beside a fixed tab becomes
 * ".1:$like" — the array's position, then the key, with "=" and ":" inside the
 * key escaped as "=0" and "=2". Stripping only the leading prefix left
 * "1:$like" as the tab id, so `onSelectionChange` handed callers a key they
 * never wrote and a `selectedKey` of "like" matched nothing (8 Nov 2026: the
 * reactions dialog asked the API for reaction type "1:$like").
 */
function normalizeKey(key: Key | null, fallback: number): string {
  if (key == null) {
    return String(fallback);
  }

  const raw = String(key);
  // Escaped keys never contain ":", so the last segment is this child's own.
  const ownSegment = raw.slice(raw.lastIndexOf(':') + 1).replace(/^\./, '');
  if (ownSegment.startsWith('$')) {
    return ownSegment.slice(1).replace(/=[02]/g, (escape) => (escape === '=0' ? '=' : ':'));
  }

  // No caller key (an index-only path): keep the established ids.
  return raw
    .replace(/^\.\$/, '')
    .replace(/^\./, '')
    .replace(/^\$/, '')
    .replace(/=0/g, '=')
    .replace(/=2/g, ':');
}

function mapVariant(variant?: TabsVariant): HeroUITabsProps['variant'] {
  return variant === 'underlined' || variant === 'secondary' ? 'secondary' : 'primary';
}

export function Tab(_props: TabProps) {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scroll affordance
//
// HeroUI's `Tabs.ListContainer` (data-slot="tabs-list-container") is the real
// horizontal scroller; the inner `Tabs.List` is `min-w-max` so it never scrolls
// itself. On a phone that scroller has no visible scrollbar and a horizontal
// swipe on a ~32px strip is easily lost to vertical page scroll — so tabs past
// the visible ones become unreachable. This wraps the scroller with edge
// chevron buttons (pointer/touch) and nudges the selected tab into view. Keyboard
// users are already served by React Aria's arrow-key + scroll-into-view, so the
// buttons are aria-hidden and non-focusable to avoid duplicate tab stops.
// ─────────────────────────────────────────────────────────────────────────────

function ScrollAffordance({
  selectedKey,
  children,
}: {
  selectedKey?: Key | null;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });

  const getScroller = useCallback(
    (): HTMLElement | null =>
      (wrapperRef.current?.querySelector('[data-slot="tabs-list-container"]') as HTMLElement | null) ?? null,
    [],
  );

  const update = useCallback(() => {
    const el = getScroller();
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px tolerance for sub-pixel rounding on fractional widths.
    setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
  }, [getScroller]);

  useEffect(() => {
    const el = getScroller();
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(el);
      const list = el.querySelector('[data-slot="tabs-list"]');
      if (list) observer.observe(list); // content width can change (i18n labels, conditional tabs)
    }
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [getScroller, update]);

  // Keep the selected tab visible — deep links (?tab=safeguarding) or programmatic
  // selection can land on a tab that starts off-screen.
  useEffect(() => {
    const el = getScroller();
    if (!el) return;
    const selected = el.querySelector('[data-slot="tabs-tab"][data-selected="true"]') as HTMLElement | null;
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }
    const id = window.setTimeout(update, 350);
    return () => window.clearTimeout(id);
  }, [selectedKey, getScroller, update]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const el = getScroller();
      if (!el || typeof el.scrollBy !== 'function') return;
      const amount = Math.max(120, Math.round(el.clientWidth * 0.75));
      el.scrollBy({ left: dir * amount, behavior: 'smooth' });
    },
    [getScroller],
  );

  const edgeButton =
    'absolute inset-y-0 z-10 flex w-10 items-center text-theme-muted transition-opacity duration-150 hover:text-theme-primary';

  return (
    // `min-w-0` is load-bearing: this wrapper is a flex item of HeroUI's column
    // `.tabs` flexbox. Without it the item's `min-width: auto` expands to the
    // full tab-strip content width, so the inner `overflow-x-auto` scroller never
    // clamps to the viewport and nothing scrolls (the un-wrapped ListContainer
    // avoided this only because its own overflow gives it `min-width: 0`).
    <div ref={wrapperRef} className="relative w-full min-w-0">
      {children}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => step(-1)}
        className={combineClasses(
          edgeButton,
          'left-0 justify-start rounded-l-xl bg-gradient-to-r from-[var(--background)] via-[var(--background)]/80 to-transparent pl-1',
          edges.start ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => step(1)}
        className={combineClasses(
          edgeButton,
          'right-0 justify-end rounded-r-xl bg-gradient-to-l from-[var(--background)] via-[var(--background)]/80 to-transparent pr-1',
          edges.end ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Tabs({
  'aria-label': ariaLabel,
  children,
  className,
  classNames,
  color: _color,
  disableAnimation: _disableAnimation,
  disableCursorAnimation,
  fullWidth,
  isVertical,
  orientation,
  placement: _placement,
  radius: _radius,
  scrollAffordance = true,
  size: _size,
  variant,
  ...props
}: TabsProps) {
  const tabChildren = Children.toArray(children).filter(isValidElement) as Array<ReactElement<TabProps>>;
  const isHorizontal = !isVertical && orientation !== 'vertical';

  const listRegion = (
    <HeroUITabs.ListContainer
      className={combineClasses(
        'max-w-full overflow-x-auto',
        // touch-pan-x keeps horizontal finger-drags panning the strip even when
        // a tab's own press handling would otherwise capture the gesture. It
        // must not apply to vertical lists, where it would block vertical pans.
        isHorizontal && 'touch-pan-x',
        scrollAffordance && isHorizontal && 'scrollbar-hide scroll-smooth overscroll-x-contain',
      )}
    >
      <HeroUITabs.List
        aria-label={ariaLabel}
        className={combineClasses('min-w-max', fullWidth && 'w-full', classNames?.tabList)}
      >
        {tabChildren.map((child, index) => {
          const id = normalizeKey(child.key, index);

          return (
            <HeroUITabs.Tab
              key={id}
              className={combineClasses(
                'w-fit min-w-fit shrink-0 whitespace-nowrap',
                fullWidth && 'flex-1 justify-center',
                classNames?.tab,
                child.props.className,
              )}
              id={id}
              isDisabled={child.props.isDisabled}
            >
              <span className={combineClasses('whitespace-nowrap', classNames?.tabContent)}>
                {child.props.title ?? child.props.children}
              </span>
              {disableCursorAnimation ? null : <HeroUITabs.Indicator className={classNames?.cursor} />}
            </HeroUITabs.Tab>
          );
        })}
      </HeroUITabs.List>
    </HeroUITabs.ListContainer>
  );

  return (
    <HeroUITabs
      className={combineClasses(classNames?.base, className)}
      orientation={isVertical ? 'vertical' : orientation}
      variant={mapVariant(variant)}
      {...props}
    >
      {scrollAffordance && isHorizontal ? (
        <ScrollAffordance selectedKey={props.selectedKey as Key | null | undefined}>{listRegion}</ScrollAffordance>
      ) : (
        listRegion
      )}
      {tabChildren.map((child, index) => {
        const id = normalizeKey(child.key, index);

        return (
          <HeroUITabs.Panel key={id} className={classNames?.panel} id={id}>
            {child.props.children}
          </HeroUITabs.Panel>
        );
      })}
    </HeroUITabs>
  );
}
