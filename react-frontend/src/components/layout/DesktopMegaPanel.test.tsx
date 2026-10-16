// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DesktopMegaPanel — the open, self-sizing header panel used by the
 * "More" and "Community" menus. Keyboard cases are ported from
 * __tests__/MegaMenu.test.tsx; every collapsible-section case is gone because
 * nothing in this panel folds.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { LucideIcon } from 'lucide-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'accessibility.menu_opened': 'Menu opened',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const StubIcon: LucideIcon = (({ ref, ...props }: Record<string, unknown> & { ref?: React.Ref<SVGSVGElement> }) =>
  React.createElement('svg', { ...props, ref, 'data-testid': 'icon' })
) as unknown as LucideIcon;
(StubIcon as { displayName: string }).displayName = 'StubIcon';

import { DesktopMegaPanel } from './DesktopMegaPanel';
import type { DesktopMegaPanelProps, MegaPanelGroup } from './DesktopMegaPanel';
import { MEGA_PANEL_MIN_COLUMN_PX } from './megaPanelLayout';

const LONG_DESC = 'A deliberately long description that goes on and on so that it would need far more than two lines to show'.padEnd(120, '.');

const groups: MegaPanelGroup[] = [
  {
    key: 'engage',
    title: 'Engage',
    tone: 'engage',
    items: [
      { label: 'Volunteering', desc: 'Give your time', href: '/volunteering', icon: StubIcon },
      { label: 'Goals', desc: 'Set a goal', href: '/goals', icon: StubIcon },
      { label: 'Ideas', desc: 'Share an idea', href: '/ideas', icon: StubIcon },
    ],
  },
  {
    key: 'tools',
    title: 'Tools',
    tone: 'tools',
    items: [
      { label: 'Wallet', href: '/wallet', icon: StubIcon },
      { label: 'Resources', href: '/resources', icon: StubIcon },
      { label: 'Search', href: '/search', icon: StubIcon },
      { label: 'Matches', href: '/matches', icon: StubIcon },
      { label: 'Help', href: '/help', icon: StubIcon },
    ],
  },
  {
    key: 'about',
    title: 'About',
    tone: 'about',
    items: [
      { label: 'About Us', desc: LONG_DESC, href: '/about', icon: StubIcon },
      { label: 'Contact', href: '/contact', icon: StubIcon },
      { label: 'Blog', desc: 'News', href: '/blog', icon: StubIcon },
      { label: 'Legal', desc: 'Terms', href: '/legal', icon: StubIcon },
      { label: 'Privacy', desc: 'Your data', href: '/privacy', icon: StubIcon },
      { label: 'Accessibility', desc: 'Our statement', href: '/accessibility', icon: StubIcon },
    ],
  },
  {
    key: 'empty',
    title: 'Empty Group Title',
    tone: 'community',
    items: [],
  },
];

function makeGroups(count: number): MegaPanelGroup[] {
  return Array.from({ length: count }, (_, g) => ({
    key: `g${g}`,
    title: `Group ${g}`,
    tone: 'main' as const,
    items: [
      { label: `G${g} first`, href: `/g${g}/a`, icon: StubIcon },
      { label: `G${g} second`, href: `/g${g}/b`, icon: StubIcon },
    ],
  }));
}

function baseProps(overrides: Partial<DesktopMegaPanelProps> = {}): DesktopMegaPanelProps {
  return {
    ariaLabel: 'More navigation',
    triggerLabel: 'More',
    triggerIcon: StubIcon,
    isActive: false,
    isOpen: true,
    onOpenChange: vi.fn(),
    groups,
    onNavigate: vi.fn(),
    availableWidthPx: 1360,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<DesktopMegaPanelProps> = {}) {
  const props = baseProps(overrides);
  const utils = render(
    <MemoryRouter>
      <DesktopMegaPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

function getNav() {
  return document.querySelector<HTMLElement>('nav[aria-label="More navigation"]')!;
}

function getItems() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-mega-item]'));
}

function getTrigger() {
  return document.querySelector<HTMLButtonElement>('button[data-mega-trigger]')!;
}

function itemButton(label: string) {
  return screen.getByText(label).closest('button')!;
}

describe('DesktopMegaPanel', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('renders nothing when every group is empty', () => {
      const { container } = renderPanel({
        groups: [{ key: 'empty', title: 'Empty', tone: 'main', items: [] }],
      });
      expect(container.firstChild).toBeNull();
    });

    it('renders the trigger with disclosure semantics, not menu semantics', () => {
      renderPanel({ isOpen: false });
      const trigger = getTrigger();
      expect(trigger).toBeInTheDocument();
      expect(trigger).not.toHaveAttribute('aria-haspopup');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).not.toHaveAttribute('aria-controls');
      expect(trigger).toHaveTextContent('More');
      expect(getNav()).toBeNull();
    });

    it('marks the trigger expanded and renders the panel when open', () => {
      renderPanel();
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
      expect(getNav()).toBeInTheDocument();
      const panel = document.querySelector<HTMLElement>('[data-mega-panel]')!;
      expect(panel.id).not.toBe('');
      expect(getTrigger()).toHaveAttribute('aria-controls', panel.id);
    });

    it('drops empty groups and renders one column per surviving group', () => {
      renderPanel();
      const cols = new Set(getItems().map(button => button.getAttribute('data-mega-col')));
      expect(cols).toEqual(new Set(['0', '1', '2']));
      expect(screen.queryByText('Empty Group Title')).not.toBeInTheDocument();
      expect(screen.getByText('Engage')).toBeInTheDocument();
      expect(screen.getByText('Tools')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });

    it('never renders a collapsed section or a chevron toggle', () => {
      renderPanel();
      expect(getNav().querySelectorAll('button[aria-expanded]')).toHaveLength(0);
      expect(getItems()).toHaveLength(14);
    });

    it('clamps a long description to two lines and omits the line when desc is missing', () => {
      renderPanel();
      const longDesc = screen.getByText(LONG_DESC);
      expect(longDesc).toHaveClass('line-clamp-2', 'whitespace-normal');

      const label = screen.getByText('About Us');
      expect(label.className).toContain('whitespace-nowrap');

      const contact = itemButton('Contact');
      const walker = document.createTreeWalker(contact, NodeFilter.SHOW_TEXT);
      const textNodes: string[] = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode.textContent ?? '');
      }
      expect(textNodes).toEqual(['Contact']);
    });

    it('holds every column to the minimum width the layout rule assumes', () => {
      renderPanel();
      const panel = document.querySelector<HTMLElement>('[data-mega-panel]')!;
      expect(panel.style.getPropertyValue('--mega-col-min')).toBe(`${MEGA_PANEL_MIN_COLUMN_PX}px`);
      const columns = Array.from(getNav().querySelectorAll('[data-mega-group]'));
      expect(columns).toHaveLength(3);
      for (const column of columns) {
        expect(column).toHaveClass('min-w-[var(--mega-col-min)]');
      }
    });

    it('keeps a 150px description area at the minimum column width', () => {
      renderPanel();
      // 230 − column padding 2×10 − item padding 2×10 − 30px tile − 10px gap = 150.
      expect(MEGA_PANEL_MIN_COLUMN_PX - 20 - 20 - 30 - 10).toBe(150);
      const column = getNav().querySelector('[data-mega-group]')!;
      expect(column).toHaveClass('px-2.5');
      // Column dividers are inset shadows, so they take no width from the text.
      expect(column.className).not.toMatch(/\bborder-[lt]\b/);
      const item = getItems()[0]!;
      expect(item).toHaveClass('px-2.5', 'py-1.5', 'gap-2.5');
      expect(item.querySelector('span')).toHaveClass('size-[30px]');
      const list = column.querySelector('p + div')!;
      expect(list).toHaveClass('space-y-0.5');
      expect(column.querySelector('p')).toHaveClass('mb-1');
    });

    it('lays out three groups in one row when they fit', () => {
      renderPanel();
      expect(getNav()).toHaveAttribute('data-rows', '1');
      expect(getNav()).toHaveAttribute('data-columns', '3');
    });

    it('lays out seven groups as two rows of four when the bounds are narrow', () => {
      renderPanel({ groups: makeGroups(7), availableWidthPx: 960 });
      expect(getNav()).toHaveAttribute('data-rows', '2');
      expect(getNav()).toHaveAttribute('data-columns', '4');
    });

    it('calls onNavigate with the item href when an item is pressed', () => {
      const { props } = renderPanel();
      fireEvent.click(itemButton('Wallet'));
      expect(props.onNavigate).toHaveBeenCalledWith('/wallet');
    });
  });

  describe('Positioning', () => {
    function getPanel() {
      return document.querySelector<HTMLElement>('[data-mega-panel]')!;
    }

    it('takes the full available width, centred, when the layout needs two rows', () => {
      renderPanel({ groups: makeGroups(7), availableWidthPx: 960 });
      const panel = getPanel();
      expect(panel).toHaveAttribute('data-position', 'full');
      expect(panel).toHaveClass('absolute', 'top-full', 'left-1/2', '-translate-x-1/2', 'w-[var(--mega-panel-max-w)]');
      expect(panel.style.getPropertyValue('--mega-panel-max-w')).toBe('960px');
    });

    it('centres three or more groups under the bar, capped at the available width', () => {
      renderPanel();
      const panel = getPanel();
      expect(panel).toHaveAttribute('data-position', 'centre');
      expect(panel).toHaveClass('absolute', 'top-full', 'left-1/2', '-translate-x-1/2', 'max-w-[var(--mega-panel-max-w)]');
      expect(panel).not.toHaveClass('right-0');
      expect(panel.style.getPropertyValue('--mega-panel-max-w')).toBe('1360px');
    });

    describe('measured from the viewport', () => {
      const original = {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        rect: Element.prototype.getBoundingClientRect,
      };

      function setViewport(width: number, height: number) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      }

      afterEach(() => {
        setViewport(original.innerWidth, original.innerHeight);
        Element.prototype.getBoundingClientRect = original.rect;
      });

      function renderInBounds(boundsWidth: number, groupCount: number) {
        const props = baseProps({ groups: makeGroups(groupCount), availableWidthPx: undefined });
        return render(
          <MemoryRouter>
            <div data-mega-panel-bounds ref={node => {
              if (node) Object.defineProperty(node, 'clientWidth', { configurable: true, value: boundsWidth });
            }}
            >
              <DesktopMegaPanel {...props} />
            </div>
          </MemoryRouter>,
        );
      }

      it('uses the viewport width minus a 16px gutter each side, not the bounds container', () => {
        setViewport(1440, 900);
        renderInBounds(900, 6);
        const panel = getPanel();
        expect(panel.style.getPropertyValue('--mega-panel-max-w')).toBe('1408px');
        // 6 x 230 = 1380 fits in 1408, though not in the 900px container.
        expect(getNav()).toHaveAttribute('data-rows', '1');
        expect(getNav()).toHaveAttribute('data-columns', '6');
      });

      it('caps the height at the viewport below the panel top, less 16px, and re-measures on resize', () => {
        setViewport(1024, 800);
        Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
          const top = this.hasAttribute('data-mega-panel') ? 109 : 0;
          return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        };
        renderInBounds(1000, 7);
        const panel = getPanel();
        expect(panel).toHaveClass('max-h-[var(--mega-panel-max-h,75vh)]');
        expect(panel.style.getPropertyValue('--mega-panel-max-h')).toBe('675px');

        act(() => {
          setViewport(1366, 768);
          window.dispatchEvent(new Event('resize'));
        });
        expect(getPanel().style.getPropertyValue('--mega-panel-max-h')).toBe('643px');
      });
    });

    it('anchors one or two groups under the trigger', () => {
      renderPanel({ groups: makeGroups(2) });
      expect(getPanel()).toHaveAttribute('data-position', 'trigger');
    });
  });

  describe('Keyboard navigation', () => {
    it('ArrowDown moves focus to next item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[0]?.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('ArrowDown wraps from last to first item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[buttons.length - 1]?.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('ArrowUp moves focus to previous item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[1]?.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowUp' });
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('ArrowUp wraps from first to last item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[0]?.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowUp' });
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });

    it('ArrowRight moves to the first item of the next column, including across the row break', () => {
      renderPanel({ groups: makeGroups(7), availableWidthPx: 960 });
      // Row 1 holds columns 0-3, row 2 holds columns 4-6.
      itemButton('G0 second').focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(itemButton('G1 first'));

      itemButton('G3 second').focus(); // last column of row 1
      fireEvent.keyDown(getNav(), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(itemButton('G4 first'));
      expect(document.activeElement).toHaveAttribute('data-mega-col', '4');
    });

    it('ArrowRight from the last column stays put', () => {
      renderPanel();
      const buttons = getItems();
      const last = buttons[buttons.length - 1]!;
      last.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(last);
    });

    it('ArrowLeft moves to the first item of the previous column, including across the row break', () => {
      renderPanel({ groups: makeGroups(7), availableWidthPx: 960 });
      itemButton('G4 second').focus(); // first column of row 2
      fireEvent.keyDown(getNav(), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(itemButton('G3 first'));
    });

    it('ArrowLeft from the first column stays put', () => {
      renderPanel();
      const buttons = getItems();
      buttons[2]?.focus();
      fireEvent.keyDown(getNav(), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(buttons[2]);
    });

    it('Home moves focus to first item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[2]?.focus();
      fireEvent.keyDown(getNav(), { key: 'Home' });
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('End moves focus to last item', () => {
      renderPanel();
      const buttons = getItems();
      buttons[0]?.focus();
      fireEvent.keyDown(getNav(), { key: 'End' });
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });

    it('Escape calls onOpenChange(false)', () => {
      const { props } = renderPanel();
      fireEvent.keyDown(getNav(), { key: 'Escape' });
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('Focus and dismissal', () => {
    it('focuses the first item when opened and restores focus to the trigger on close', async () => {
      const props = baseProps({ isOpen: false });
      const { rerender } = render(
        <MemoryRouter>
          <DesktopMegaPanel {...props} />
        </MemoryRouter>,
      );
      const trigger = getTrigger();
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      rerender(
        <MemoryRouter>
          <DesktopMegaPanel {...props} isOpen />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.activeElement).toBe(getItems()[0]));

      rerender(
        <MemoryRouter>
          <DesktopMegaPanel {...props} isOpen={false} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.activeElement).toBe(getTrigger()));
    });

    it('toggles open state from the trigger', () => {
      const { props } = renderPanel({ isOpen: false });
      fireEvent.click(getTrigger());
      expect(props.onOpenChange).toHaveBeenCalledWith(true);
    });

    it('closes on click outside', () => {
      const { props } = renderPanel();
      fireEvent.mouseDown(document.body);
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not treat a press on the trigger as an outside click', () => {
      const { props } = renderPanel();
      fireEvent.mouseDown(getTrigger());
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('announces menu opened politely', () => {
      renderPanel();
      const live = document.querySelector('[aria-live="polite"]')!;
      expect(live).toBeInTheDocument();
      expect(live.textContent).toBe('Menu opened');
    });

    it('keeps the live region empty while closed', () => {
      renderPanel({ isOpen: false });
      expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('');
    });
  });
});
