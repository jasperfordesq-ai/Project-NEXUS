// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the Tabs / Tab wrapper components.
 *
 * Design notes
 * ─────────────
 * • HeroUI v3 Tabs renders ALL panels into the DOM simultaneously but only the
 *   active panel has `tabindex="0"` (or is otherwise visible to userEvent).
 *   Content from inactive panels IS queryable by string because the elements
 *   exist in the DOM — they are just hidden via CSS.
 * • We therefore test:
 *     – The tab list is present.
 *     – Each tab trigger renders with the right accessible name.
 *     – The initially-active panel content is accessible.
 *     – Clicking a tab trigger changes the selected state of that trigger.
 * • We avoid asserting which *panel* content appears/disappears via show/hide
 *   because the HeroUI v3 implementation keeps both panels mounted and jsdom
 *   does not honour CSS visibility / display none for `getByText`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { act, render, screen, fireEvent } from '@/test/test-utils';
import { Tabs, Tab } from './Tabs';

// React Aria queues a mount update for its shared tab indicator. Keep that
// update inside act so the strict console gate can catch real warnings.
async function renderSettled(ui: ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result;
}

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test' }, branding: { name: 'Test' }, tenantPath: (p: string) => `/test${p}`, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useTheme: () => ({ resolvedTheme: 'light', theme: 'system', toggleTheme: vi.fn(), setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  usePresence: () => ({ status: 'offline', setStatus: vi.fn(), getPresence: vi.fn(), isOnline: vi.fn(() => false) }),
  usePresenceOptional: () => null,
}));

describe('Tabs component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a tab list (role="tablist")', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders the correct number of tab triggers', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
        <Tab title="Gamma">Content C</Tab>
      </Tabs>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('renders each tab with its title text', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: /Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Beta/i })).toBeInTheDocument();
  });

  it('first tab is selected by default (aria-selected="true")', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="First">First panel content</Tab>
        <Tab title="Second">Second panel content</Tab>
      </Tabs>,
    );
    const firstTab = screen.getByRole('tab', { name: /First/i });
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking the second tab selects it (aria-selected toggles)', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="First">First panel content</Tab>
        <Tab title="Second">Second panel content</Tab>
      </Tabs>,
    );
    const secondTab = screen.getByRole('tab', { name: /Second/i });
    expect(secondTab).toHaveAttribute('aria-selected', 'false');
    await act(async () => fireEvent.click(secondTab));
    expect(secondTab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks the first tab as no longer selected after switching', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="First">First panel content</Tab>
        <Tab title="Second">Second panel content</Tab>
      </Tabs>,
    );
    const firstTab = screen.getByRole('tab', { name: /First/i });
    const secondTab = screen.getByRole('tab', { name: /Second/i });
    await act(async () => fireEvent.click(secondTab));
    expect(firstTab).toHaveAttribute('aria-selected', 'false');
  });

  it('applies aria-label to the tab list', async () => {
    await renderSettled(
      <Tabs aria-label="My custom tabs">
        <Tab title="One">One</Tab>
      </Tabs>,
    );
    expect(screen.getByRole('tablist', { name: 'My custom tabs' })).toBeInTheDocument();
  });

  it('renders a disabled tab with the disabled attribute', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Active">Active content</Tab>
        <Tab title="Disabled" isDisabled>Disabled content</Tab>
      </Tabs>,
    );
    const disabledTab = screen.getByRole('tab', { name: /Disabled/i });
    // React Aria marks disabled tabs with aria-disabled
    expect(disabledTab).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders tab panels (role="tabpanel") in the DOM', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    // HeroUI v3 mounts all panels; at least the active one gets role=tabpanel
    const panels = screen.getAllByRole('tabpanel');
    expect(panels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders panel content for the active tab', async () => {
    await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    // The first panel content is in the DOM
    expect(screen.getByText('Content A')).toBeInTheDocument();
  });

  it('supports vertical orientation', async () => {
    await renderSettled(
      <Tabs aria-label="Vertical tabs" isVertical>
        <Tab title="Vert1">Vert content 1</Tab>
        <Tab title="Vert2">Vert content 2</Tab>
      </Tabs>,
    );
    // Just assert it renders without error and tab list is present
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('maps the legacy underlined variant to the documented v3 secondary style', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Underlined tabs" variant="underlined">
        <Tab title="Alpha">Content A</Tab>
      </Tabs>,
    );

    expect(container.querySelector('[data-slot="tabs"]')).toHaveClass('tabs--secondary');
    expect(container.querySelector('[data-slot="tabs-indicator"]')).toBeInTheDocument();
  });
});

describe('Tabs scrollAffordance', () => {
  // The two edge scroll buttons are the only aria-hidden, non-focusable buttons
  // the wrapper adds — a stable selector regardless of how React Aria renders tabs.
  const scrollButtons = (container: HTMLElement) =>
    container.querySelectorAll('button[aria-hidden="true"][tabindex="-1"]');

  it('renders scroll buttons by default (affordance is default-on for horizontal strips)', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs">
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(scrollButtons(container)).toHaveLength(2);
  });

  it('does NOT render scroll buttons when scrollAffordance is disabled', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" scrollAffordance={false}>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(scrollButtons(container)).toHaveLength(0);
  });

  it('does NOT render scroll buttons for vertical tabs', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" isVertical>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(scrollButtons(container)).toHaveLength(0);
  });

  it('renders two edge scroll buttons when scrollAffordance is set', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" scrollAffordance>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    expect(scrollButtons(container)).toHaveLength(2);
  });

  it('scroll buttons are hidden from AT and non-focusable (no duplicate tab stops)', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" scrollAffordance>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    scrollButtons(container).forEach((btn) => {
      expect(btn).toHaveAttribute('aria-hidden', 'true');
      expect(btn).toHaveAttribute('tabindex', '-1');
    });
    // The tab triggers themselves remain the real, accessible controls.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('applies the hidden-scrollbar class to the real scroll container', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" scrollAffordance>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    const scroller = container.querySelector('[data-slot="tabs-list-container"]');
    expect(scroller?.className).toContain('scrollbar-hide');
  });

  it('wraps the scroller in a min-w-0 flex item so it can clamp to the viewport', async () => {
    // Regression guard: the wrapper is a flex item of HeroUI's column `.tabs`
    // flexbox. Without `min-w-0` its `min-width: auto` expands to the full
    // content width and the inner overflow-x-auto scroller never scrolls —
    // i.e. the exact "can't reach the later tabs on mobile" bug this fixes.
    const { container } = await renderSettled(
      <Tabs aria-label="Test tabs" scrollAffordance>
        <Tab title="Alpha">Content A</Tab>
        <Tab title="Beta">Content B</Tab>
      </Tabs>,
    );
    const wrapper = container.querySelector('[data-slot="tabs-list-container"]')?.parentElement;
    expect(wrapper?.className).toContain('min-w-0');
  });

  it('ignores scrollAffordance for vertical orientation', async () => {
    const { container } = await renderSettled(
      <Tabs aria-label="Vertical tabs" isVertical scrollAffordance>
        <Tab title="Vert1">Vert content 1</Tab>
        <Tab title="Vert2">Vert content 2</Tab>
      </Tabs>,
    );
    expect(scrollButtons(container)).toHaveLength(0);
  });
});
