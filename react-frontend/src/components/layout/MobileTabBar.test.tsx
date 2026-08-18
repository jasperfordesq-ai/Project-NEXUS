// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MobileTabBar component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

// --- Mocks ---

const mockNavigate = vi.fn();
let mockPathname = '/dashboard';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({
      pathname: mockPathname,
      search: '',
      hash: '',
      state: null,
      key: 'default',
    }),
  };
});

vi.mock('@/lib/motion', () => {
  const proxy = new Proxy({}, {
    get: (_t: object, prop: string | symbol) => {
      return ({ children, ref, ...p }: Record<string, unknown> & { ref?: React.Ref<unknown> }) => {
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) {
          if (!['variants', 'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'layout', 'viewport', 'layoutId'].includes(k)) safe[k] = v;
        }
        return React.createElement(typeof prop === 'string' ? prop : 'div', { ...safe, ref }, children);
      };
    },
  });
  return { motion: proxy, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();
const mockUseNotifications = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
}));

vi.mock('@/contexts/NotificationsContext', () => ({
  useNotificationsOptional: (...args: unknown[]) => mockUseNotifications(...args),
}));

vi.mock('./QuickCreateMenu', () => ({
  QuickCreateMenu: ({ isOpen }: { isOpen?: boolean }) => (
    isOpen ? <div data-testid="quick-create-menu">Quick Create</div> : null
  ),
}));

import { MobileTabBar } from './MobileTabBar';

function setupDefaultMocks(overrides: {
  auth?: Record<string, unknown>;
  tenant?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
} = {}) {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Test', last_name: 'User', role: 'member' },
    ...overrides.auth,
  });
  mockUseTenant.mockReturnValue({
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => p,
    ...overrides.tenant,
  });
  mockUseNotifications.mockReturnValue({
    counts: { messages: 0, notifications: 0 },
    ...overrides.notifications,
  });
}

describe('MobileTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/dashboard';
    setupDefaultMocks();
  });

  describe('Visibility', () => {
    it('renders when user is authenticated', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
    });

    it('does NOT render when user is not authenticated', () => {
      setupDefaultMocks({ auth: { isAuthenticated: false } });
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('does NOT render on login page', () => {
      mockPathname = '/login';
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('does NOT render on register page', () => {
      mockPathname = '/register';
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('does NOT render on onboarding page', () => {
      mockPathname = '/onboarding';
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('does NOT render on forgot-password page', () => {
      mockPathname = '/password/forgot';
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });
  });

  describe('Tab icons', () => {
    it('renders Feed tab', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Feed')).toBeInTheDocument();
    });

    it('renders Listings tab when module enabled', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Listings')).toBeInTheDocument();
    });

    it('renders Create tab', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Create new content')).toBeInTheDocument();
    });

    it('renders Messages tab when module enabled', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Messages')).toBeInTheDocument();
    });

    it('renders Menu tab', () => {
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Menu')).toBeInTheDocument();
    });

    it('keeps every tab label on one shared baseline', () => {
      render(<MobileTabBar />);

      const navigation = screen.getByLabelText('Mobile navigation');
      const labels = navigation.querySelectorAll('[data-mobile-tab-label]');

      expect(labels).toHaveLength(5);
      labels.forEach((label) => {
        expect(label).toHaveClass('absolute', 'inset-x-0', 'bottom-4');
      });
    });

    // Regression: the ACTIVE label must not inherit the wrapper's `text-accent`.
    // At 10px the default accent (#6366f1) on white measures 4.46:1 against a
    // 4.5:1 requirement, which failed the real-browser accessibility gate, and
    // 10px cannot reach the large-text exemption so a heavier weight would not
    // rescue it. Body text colour is safe for EVERY tenant accent, not just the
    // default one.
    it('gives the active tab label body text colour rather than the accent', () => {
      // This describe's beforeEach sets '/dashboard', which matches no tab, so
      // pick a route that actually marks one active.
      mockPathname = '/listings';
      render(<MobileTabBar />);

      const navigation = screen.getByLabelText('Mobile navigation');
      const activeTab = navigation.querySelector('[aria-current="page"]');
      expect(activeTab).not.toBeNull();

      const activeLabel = activeTab?.querySelector('[data-mobile-tab-label]');
      expect(activeLabel).toBeTruthy();
      expect(activeLabel).toHaveClass('text-theme-primary');

      // Inactive labels are unchanged — they inherit the muted colour and must
      // not silently pick up the active treatment.
      navigation.querySelectorAll('[data-mobile-tab-label]').forEach((label) => {
        if (label === activeLabel) return;
        expect(label).not.toHaveClass('text-theme-primary');
      });
    });

    it('reserves horizontal safe areas for landscape devices', () => {
      render(<MobileTabBar />);

      const navigation = screen.getByLabelText('Mobile navigation');
      const tabList = navigation.querySelector('.items-stretch');

      expect(tabList).toHaveClass(
        'ps-[calc(var(--safe-area-left)+0.25rem)]',
        'pe-[calc(var(--safe-area-right)+0.25rem)]',
      );
    });

    it('gives the badged Messages tab the same flexible width as its siblings', () => {
      render(<MobileTabBar />);

      const messagesButton = screen.getByLabelText('Messages');
      const badgeAnchor = messagesButton.closest('[data-slot="badge-anchor"]');

      expect(badgeAnchor).toHaveClass('flex', 'min-w-0', 'flex-1');
    });

    it('keeps the raised Create action clear of the shared label row', () => {
      render(<MobileTabBar />);

      const createButton = screen.getByLabelText('Create new content');

      expect(createButton.parentElement).toHaveClass('top-[-1rem]');
    });
  });

  describe('Module gating', () => {
    it('hides Listings tab when listings module is disabled', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn((mod: string) => mod !== 'listings'),
        },
      });
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Listings')).not.toBeInTheDocument();
    });

    it('hides Messages tab when messages module is disabled', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn((mod: string) => mod !== 'messages'),
        },
      });
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Messages')).not.toBeInTheDocument();
    });

    it('hides Feed tab when feed module is disabled', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn((mod: string) => mod !== 'feed'),
        },
      });
      render(<MobileTabBar />);
      expect(screen.queryByLabelText('Feed')).not.toBeInTheDocument();
    });

    it('always shows Create and Menu tabs regardless of modules', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn(() => false),
        },
      });
      render(<MobileTabBar />);
      expect(screen.getByLabelText('Create new content')).toBeInTheDocument();
      expect(screen.getByLabelText('Menu')).toBeInTheDocument();
    });
  });

  describe('Active state', () => {
    it('marks Feed tab as active on feed route', () => {
      mockPathname = '/feed';
      render(<MobileTabBar />);
      const feedButton = screen.getByLabelText('Feed');
      expect(feedButton).toHaveAttribute('aria-current', 'page');
    });

    it('marks Listings tab as active on listings route', () => {
      mockPathname = '/listings';
      render(<MobileTabBar />);
      const listingsButton = screen.getByLabelText('Listings');
      expect(listingsButton).toHaveAttribute('aria-current', 'page');
    });

    it('marks Messages tab as active on messages route', () => {
      mockPathname = '/messages';
      render(<MobileTabBar />);
      const messagesButton = screen.getByLabelText('Messages');
      expect(messagesButton).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('Menu callback', () => {
    it('calls onMenuOpen when Menu tab is pressed', () => {
      const onMenuOpen = vi.fn();
      render(<MobileTabBar onMenuOpen={onMenuOpen} />);
      const menuButton = screen.getByLabelText('Menu');
      menuButton.click();
      expect(onMenuOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message badge', () => {
    it('shows message count badge when there are unread messages', () => {
      setupDefaultMocks({
        notifications: { counts: { messages: 5, notifications: 0 } },
      });
      render(<MobileTabBar />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('does NOT show badge when there are no unread messages', () => {
      setupDefaultMocks({
        notifications: { counts: { messages: 0, notifications: 0 } },
      });
      render(<MobileTabBar />);
      // HeroUI Badge renders the element with data-invisible="true" when count is 0
      // so it's still in the DOM but visually hidden — check the attribute instead.
      // The "0" text lives inside the nested Badge.Label; the data-invisible flag
      // sits on the badge root ancestor ([data-slot="badge"]), so assert there.
      const badge = screen.queryByText('0');
      if (badge) {
        const root = (badge.closest('[data-slot="badge"]') as HTMLElement | null) ?? badge;
        expect(root).toHaveAttribute('data-invisible', 'true');
      }
    });

    it('shows 99+ when messages exceed 99', () => {
      setupDefaultMocks({
        notifications: { counts: { messages: 150, notifications: 0 } },
      });
      render(<MobileTabBar />);
      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });
});
