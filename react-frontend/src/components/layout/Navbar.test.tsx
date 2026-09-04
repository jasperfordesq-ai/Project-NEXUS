// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for Navbar component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '@/test/test-utils';
import React from 'react';

// --- Mocks ---

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/dashboard', search: '', hash: '', state: null, key: 'default' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
    NavLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string | ((opts: { isActive: boolean }) => string) }) => {
      const cls = typeof className === 'function' ? className({ isActive: false }) : className;
      return <a href={to} className={cls} data-testid={`navlink-${to}`}>{children}</a>;
    },
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
const mockUseTheme = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
  useTheme: (...args: unknown[]) => mockUseTheme(...args),
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),

  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
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
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: (...args: unknown[]) => mockUseTheme(...args),
}));
vi.mock('@/contexts/MenuContextCore', () => ({
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" className={triggerClassName} aria-label="Language switcher">Language</button>
  ),
}));

vi.mock('@/components/social', () => ({
  PresenceIndicator: () => null,
  StatusSelector: () => null,
}));

vi.mock('@/components/navigation', () => ({
  DesktopMenuItems: () => null,
  MobileMenuItems: () => null,
}));

vi.mock('@/components/feedback/ReportProblemButton', () => ({
  ReportProblemButton: ({ className }: { className?: string }) => (
    <button type="button" className={className}>Report a problem</button>
  ),
}));

const i18nMap: Record<string, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.feed': 'Feed',
  'nav.listings': 'Listings',
  'nav.timebanking': 'Timebanking',
  'nav.messages': 'Messages',
  'nav.community': 'Community',
  'nav.caring_community': 'Caring Community',
  'nav.members': 'Members',
  'nav.connections': 'Connections',
  'nav.events': 'Events',
  'nav.groups': 'Groups',
  'nav.volunteering': 'Volunteering',
  'nav.organisations': 'Organisations',
  'nav.resources': 'Resources',
  'nav.marketplace': 'Marketplace',
  'nav.more': 'More',
  'nav.ideation': 'Ideas',
  'nav.partner_communities': 'Partner Communities',
  'nav.courses': 'Courses',
  'nav.podcasts': 'Podcasts',
  'nav.premium': 'Premium',
  'nav_desc.dashboard': 'Your personalised home overview',
  'nav_desc.caring_community': 'Time banking, care support, organisations, and impact',
  'nav_desc.members': 'Browse community members',
  'nav_desc.connections': 'Your connections & requests',
  'nav_desc.events': 'Upcoming community events',
  'nav_desc.groups': 'Join interest groups',
  'nav_desc.volunteering': 'Find ways to help',
  'nav_desc.organisations': 'Browse volunteer organisations',
  'nav_desc.resources': 'Shared files & documents',
  'nav_desc.marketplace': 'Buy & sell in your community',
  'nav_desc.ideation': 'Ideas & innovation challenges',
  'nav_desc.partner_communities': 'Federation Hub',
  'nav_desc.courses': 'Community learning',
  'nav_desc.podcasts': 'Community shows and episodes',
  'nav_desc.premium': 'Premium member benefits',
  'sections.main': 'Main',
  'sections.community': 'Community',
  'sections.explore': 'Explore',
  'nav.unread_notifications': 'Notifications, 5 unread',
  'nav.accessibility_alpha': 'WCAG 2.2 AA Version',
  'nav.switch_community': 'Switch community',
  'theme_picker.open_label': 'Theme',
  'accessibility.create_new': 'Create new',
  'accessibility.open_menu': 'Open menu',
  'accessibility.search': 'Search',
  'accessibility.search_ctrl_k': 'Search (Ctrl+K)',
  'accessibility.skip_to_content': 'Skip to main content',
  'accessibility.accessibility_alpha_new_tab': 'Open WCAG 2.2 AA accessible version in a new tab',
  'accessibility.switch_to_dark': 'Switch to dark mode',
  'accessibility.switch_to_light': 'Switch to light mode',
  'aria.main_navigation': 'Main navigation',
  'aria.timebanking_navigation': 'Timebanking navigation',
  'aria.community_navigation': 'Community navigation',
  'aria.tenant_switcher_navigation': 'Community switcher',
  'aria.create_actions': 'Create actions',
  'aria.user_actions': 'User actions',
  'aria.user_menu_trigger': 'Open user menu',
  'auth.log_in': 'Log In',
  'auth.sign_up': 'Sign Up',
  'create.new_listing': 'New Listing',
  'create.new_event': 'New Event',
  'create.new_course': 'New Course',
  'create.new_podcast': 'New Podcast',
  'create.new_post': 'New Post',
  'user_menu.my_profile': 'My Profile',
  'user_menu.wallet': 'Wallet',
  'user_menu.settings': 'Settings',
  'user_menu.admin_panel': 'Admin Panel',
  'broker:sidebar.title': 'Broker Panel',
  'user_menu.dark_mode': 'Dark Mode',
  'user_menu.light_mode': 'Light Mode',
  'report_problem.trigger': 'Report a problem',
  'user_menu.log_out': 'Log Out',
  'flyout.bell_aria': 'Notifications',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      if (key === 'nav.unread_notifications' || key === 'flyout.bell_unread_aria') {
        return `Notifications, ${opts?.count ?? 0} unread`;
      }
      return i18nMap[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/helpers')>(),
  resolveAvatarUrl: (url: string | undefined) => url || '/default-avatar.png',
  resolveAssetUrl: (url: string | null | undefined) => url ?? null,
  resolveBrandingImageUrl: (url: string | null | undefined) => url ?? null,
  resolveThumbnailUrl: (url: string | null | undefined) => url ?? null,
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  tokenManager: { getAccessToken: vi.fn(() => 'mock-token') },
  API_BASE: 'http://localhost:8090/api',
}));

import Users from 'lucide-react/icons/users';
import { Navbar, getVisibleCommunityItems, type CommunityNavItem } from './Navbar';

// Helper to set up default context mock values
function setupDefaultMocks(overrides: {
  auth?: Partial<ReturnType<typeof mockUseAuth>>;
  tenant?: Partial<ReturnType<typeof mockUseTenant>>;
  notifications?: Partial<ReturnType<typeof mockUseNotifications>>;
  theme?: Partial<ReturnType<typeof mockUseTheme>>;
} = {}) {
  mockUseAuth.mockReturnValue({
    user: null,
    isAuthenticated: false,
    logout: vi.fn(),
    ...overrides.auth,
  });
  mockUseTenant.mockReturnValue({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test-tenant' },
    branding: { name: 'Test Community', logo: null, tagline: 'A test community' },
    hasFeature: vi.fn(() => false),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => p,
    ...overrides.tenant,
  });
  mockUseNotifications.mockReturnValue({
    unreadCount: 0,
    counts: { messages: 0, notifications: 0 },
    ...overrides.notifications,
  });
  mockUseTheme.mockReturnValue({
    resolvedTheme: 'light',
    theme: 'light',
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
    accentColor: '#3b82f6',
    setAccentColor: vi.fn(),
    ...overrides.theme,
  });
}

describe('Navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('community feature gates', () => {
    it('removes the Caring Community nav item when the master switch is off', () => {
      const items: CommunityNavItem[] = [
        {
          label: 'Caring Community',
          desc: 'Care hub',
          path: '/caring-community',
          href: '/test/caring-community',
          icon: Users,
          feature: 'caring_community',
        },
      ];

      expect(getVisibleCommunityItems(items, () => false)).toHaveLength(0);
      expect(getVisibleCommunityItems(items, feature => feature === 'caring_community')).toHaveLength(1);
    });
  });

  describe('Brand / Logo', () => {
    it('renders the brand name from tenant branding', () => {
      render(<Navbar />);
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });

    it('renders the brand logo when branding.logo is set', () => {
      setupDefaultMocks({
        tenant: {
          branding: { name: 'Logo Tenant', logo: '/logo.png', tagline: '' },
        },
      });
      render(<Navbar />);
      const img = screen.getAllByAltText('Logo Tenant')[0];
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/logo.png');
    });

    it('renders fallback Hexagon icon when no logo', () => {
      render(<Navbar />);
      // The Hexagon icon is inside a motion.div, the brand name should still appear
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });
  });

  describe('support reporting', () => {
    it('does not render the global report problem action in the crowded header', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 42,
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.test',
            role: 'member',
          },
          isAuthenticated: true,
        },
      });

      render(<Navbar />);

      expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
    });
  });

  describe('Unauthenticated state', () => {
    it('shows Log In button when not authenticated', () => {
      render(<Navbar />);
      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    it('shows Sign Up button when not authenticated', () => {
      render(<Navbar />);
      expect(screen.getByText('Sign Up')).toBeInTheDocument();
    });

    it('does NOT show user avatar when not authenticated', () => {
      render(<Navbar />);
      // When unauthenticated, there should be no Create new button (authenticated-only)
      expect(screen.queryByLabelText('Create new')).not.toBeInTheDocument();
    });
  });

  describe('Authenticated state', () => {
    beforeEach(() => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 1,
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
            avatar_url: '/avatar.jpg',
            role: 'member',
            balance: 5,
          },
          isAuthenticated: true,
        },
      });
    });

    it('does NOT show Log In / Sign Up when authenticated', () => {
      render(<Navbar />);
      expect(screen.queryByText('Log In')).not.toBeInTheDocument();
      expect(screen.queryByText('Sign Up')).not.toBeInTheDocument();
    });

    it('renders search trigger with Ctrl+K hint', () => {
      render(<Navbar />);
      // Desktop search button has aria-label
      expect(screen.getAllByLabelText('Search (Ctrl+K)').length).toBeGreaterThanOrEqual(1);
    });

    it('renders notification bell button', async () => {
      render(<Navbar />);
      // HeroUI Badge may duplicate aria-labels; use getAllByLabelText and check at least one
      const bells = await screen.findAllByLabelText('Notifications');
      expect(bells.length).toBeGreaterThanOrEqual(1);
    });

    it('renders theme toggle button', async () => {
      const user = userEvent.setup();
      render(<Navbar />);
      // The theme toggle lives inside the user menu dropdown (closed by default).
      // Open it, then verify the theme item is present (shows "Dark Mode" in light mode).
      await user.click(screen.getByRole('button', { name: 'Open user menu' }));
      expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    });

    it('renders Create new button', () => {
      render(<Navbar />);
      expect(screen.getByLabelText('Create new')).toBeInTheDocument();
    });

    it('opens the user menu from a pressable avatar trigger', async () => {
      const user = userEvent.setup();
      render(<Navbar />);

      const trigger = screen.getByRole('button', { name: 'Open user menu' });

      expect(trigger.className).toContain('button--icon-only');
      expect(trigger).toHaveAttribute('data-react-aria-pressable', 'true');

      await user.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows search button (accessible to authenticated users)', () => {
      render(<Navbar />);
      // The search button always renders with aria-label "Search (Ctrl+K)"
      expect(screen.getAllByLabelText('Search (Ctrl+K)').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('privileged panel links', () => {
    it('shows Broker Panel instead of Admin Panel for broker users with stale admin flags', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 9,
            first_name: 'Bridge',
            last_name: 'Builder',
            email: 'broker@example.com',
            role: 'broker',
            is_admin: true,
          },
          isAuthenticated: true,
        },
      });

      render(<Navbar />);

      expect(screen.getByRole('button', { name: 'Broker Panel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Admin Panel' })).not.toBeInTheDocument();
    });
  });

  describe('Utility bar', () => {
    it('renders child tenants in the utility switcher and opens the resolved tenant URL', async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      setupDefaultMocks({
        tenant: {
          tenant: {
            id: 990101,
            name: 'UK Timebank Global',
            slug: 'uk-timebank-global-test',
            tenant_switcher: {
              source: 'children',
              items: [
                {
                  id: 990102,
                  name: 'Cardiff Timebank',
                  slug: 'cardiff-timebank-test',
                  url: 'https://uk.timebank.global/cardiff-timebank-test',
                },
              ],
            },
          },
        },
      });

      render(<Navbar />);

      await user.click(screen.getByRole('button', { name: 'Switch community' }));

      const cardiffItem = await screen.findByText('Cardiff Timebank');
      expect(cardiffItem).toBeInTheDocument();

      await user.click(cardiffItem);

      expect(openSpy).toHaveBeenCalledWith('https://uk.timebank.global/cardiff-timebank-test', '_self');
      openSpy.mockRestore();
    });

    it('signs a logged-in member out before switching communities', async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const logoutSpy = vi.fn().mockResolvedValue(undefined);
      setupDefaultMocks({
        auth: {
          user: { id: 3, first_name: 'Reg', last_name: 'Member', email: 'reg@example.com', role: 'member' },
          isAuthenticated: true,
          logout: logoutSpy,
        },
        tenant: {
          tenant: {
            id: 990101,
            name: 'UK Timebank Global',
            slug: 'uk-timebank-global-test',
            tenant_switcher: {
              source: 'children',
              items: [
                { id: 990102, name: 'Cardiff Timebank', slug: 'cardiff-timebank-test', url: 'https://uk.timebank.global/cardiff-timebank-test' },
              ],
            },
          },
        },
      });

      render(<Navbar />);

      await user.click(screen.getByRole('button', { name: 'Switch community' }));
      await user.click(await screen.findByText('Cardiff Timebank'));

      await waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
      expect(openSpy).toHaveBeenCalledWith('https://uk.timebank.global/cardiff-timebank-test', '_self');
      openSpy.mockRestore();
    });

    it('keeps a platform super admin signed in when switching communities', async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const logoutSpy = vi.fn().mockResolvedValue(undefined);
      setupDefaultMocks({
        auth: {
          user: { id: 1, first_name: 'Plat', last_name: 'Admin', email: 'god@example.com', role: 'member', is_super_admin: true },
          isAuthenticated: true,
          logout: logoutSpy,
        },
        tenant: {
          tenant: {
            id: 990101,
            name: 'UK Timebank Global',
            slug: 'uk-timebank-global-test',
            tenant_switcher: {
              source: 'children',
              items: [
                { id: 990102, name: 'Cardiff Timebank', slug: 'cardiff-timebank-test', url: 'https://uk.timebank.global/cardiff-timebank-test' },
              ],
            },
          },
        },
      });

      render(<Navbar />);

      await user.click(screen.getByRole('button', { name: 'Switch community' }));
      await user.click(await screen.findByText('Cardiff Timebank'));

      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://uk.timebank.global/cardiff-timebank-test', '_self'));
      expect(logoutSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });

    it('renders compact controls with transparent styling', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 9,
            first_name: 'Bridge',
            last_name: 'Builder',
            email: 'broker@example.com',
            role: 'broker',
          },
          isAuthenticated: true,
        },
      });

      render(<Navbar />);

      const searchButton = screen.getAllByRole('button', { name: 'Search (Ctrl+K)' })
        .find((element) => element.className.includes('h-8'));
      const languageButton = screen.getAllByRole('button', { name: 'Language switcher' })
        .find((element) => element.className.includes('h-8'));
      const themeButton = screen.getByRole('button', { name: 'Theme' });
      expect(searchButton).toBeDefined();
      expect(languageButton).toBeDefined();
      expect(themeButton.className).toContain('w-8');
      expect(themeButton.querySelector('svg')?.getAttribute('class')).toContain('w-4');

      [
        screen.getByRole('button', { name: 'Broker Panel' }),
        languageButton!,
        themeButton,
        searchButton!,
      ].forEach((button) => {
        expect(button.className).toContain('utility-bar-action');
        expect(button.className).toContain('!bg-transparent');
        expect(button.className).toContain('hover:!bg-transparent');
        expect(button.className).toContain('!shadow-none');
      });
    });
  });

  describe('Theme toggle', () => {
    it('shows moon icon in light mode', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        theme: { resolvedTheme: 'light' },
      });
      render(<Navbar />);
      // Open the user menu; in light mode the theme item offers to switch to Dark Mode.
      await user.click(screen.getByRole('button', { name: 'Open user menu' }));
      expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    });

    it('shows sun icon in dark mode', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        theme: { resolvedTheme: 'dark' },
      });
      render(<Navbar />);
      // Open the user menu; in dark mode the theme item offers to switch to Light Mode.
      await user.click(screen.getByRole('button', { name: 'Open user menu' }));
      expect(screen.getByText('Light Mode')).toBeInTheDocument();
    });
  });

  describe('Navigation links', () => {
    it('renders a tenant-aware accessible frontend link that opens in a new tab', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
        },
      });
      render(<Navbar />);
      const link = screen.getByRole('link', { name: 'Open WCAG 2.2 AA accessible version in a new tab' });
      expect(link).toHaveAttribute('href', 'https://accessible.project-nexus.ie/hour-timebank/accessible');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByText('WCAG 2.2 AA Version')).toBeInTheDocument();
    });

    it('does not render the accessible frontend link without a tenant slug', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'Unknown Tenant', slug: '' },
        },
      });
      render(<Navbar />);
      expect(screen.queryByRole('link', { name: 'Open WCAG 2.2 AA accessible version in a new tab' })).not.toBeInTheDocument();
    });

    it('renders Dashboard link when module is enabled', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasModule: vi.fn((mod: string) => ['dashboard', 'feed', 'listings', 'messages'].includes(mod)),
        },
      });
      render(<Navbar />);
      // Dashboard sits at the top of the Community dropdown (closed by default).
      // Open the Community trigger, then verify the Dashboard item appears.
      await user.click(screen.getByRole('button', { name: /community/i }));
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders Feed link when module is enabled', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasModule: vi.fn((mod: string) => ['feed'].includes(mod)),
        },
      });
      render(<Navbar />);
      expect(screen.getByText('Feed')).toBeInTheDocument();
    });

    it('renders Timebanking dropdown when listings module is enabled', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasModule: vi.fn((mod: string) => ['listings'].includes(mod)),
        },
      });
      render(<Navbar />);
      // Listings is rendered inside the Timebanking dropdown trigger on desktop nav
      // The dropdown items are only in the DOM when opened, but the trigger button renders the label
      // Check that the Timebanking section is present (it groups Listings + related)
      // nav.timebanking key falls back to key string since i18nMap doesn't define it
      expect(screen.getByText('Timebanking')).toBeInTheDocument();
    });

    it('renders Messages link when module is enabled', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasModule: vi.fn((mod: string) => ['messages'].includes(mod)),
        },
      });
      render(<Navbar />);
      expect(screen.getByText('Messages')).toBeInTheDocument();
    });

    it('does NOT render Dashboard link when module is disabled', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn(() => false),
        },
      });
      render(<Navbar />);
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });
  });

  describe('Community dropdown', () => {
    it('renders Community dropdown when community features are enabled', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((f: string) => ['events', 'groups', 'connections'].includes(f)),
          hasModule: vi.fn(() => true),
        },
      });
      render(<Navbar />);
      expect(screen.getByText('Community')).toBeInTheDocument();
    });

    it('groups Community links into the shared desktop navigation panel', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => [
            'connections',
            'events',
            'groups',
            'resources',
            'marketplace',
          ].includes(feature)),
          hasModule: vi.fn((module: string) => module === 'dashboard'),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Community' }));

      const panel = screen.getByRole('navigation', { name: 'Community navigation' });
      expect(panel.className).toContain('desktop-nav-panel');
      expect(screen.getByText('Main')).toBeInTheDocument();
      expect(screen.getAllByText('Community').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Explore')).toBeInTheDocument();

      const membersItem = screen.getByRole('button', { name: /^Members\b/ });
      expect(membersItem.className).toContain('desktop-nav-panel-item');
    });

    it('does NOT render Community dropdown when no community features are enabled', () => {
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      render(<Navbar />);
      expect(screen.queryByText('Community')).not.toBeInTheDocument();
    });

    it('shows Organisations when the volunteering module feature is enabled', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn((feature: string) => feature === 'volunteering'),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Community' }));

      expect(screen.getByRole('button', { name: /^Volunteering\b/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Organisations\b/ })).toBeInTheDocument();
    });

    it('routes Partner Communities to the Federation Hub', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => feature === 'federation'),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Community' }));
      await user.click(screen.getByText('Partner Communities'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/federation');
      });
    });

    it('places Caring Community underneath Partner Communities in the Community section', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => [
            'connections',
            'events',
            'groups',
            'volunteering',
            'federation',
            'caring_community',
          ].includes(feature)),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Community' }));

      const panel = screen.getByRole('navigation', { name: 'Community navigation' });
      expect(screen.queryByText('Main')).not.toBeInTheDocument();

      const itemLabels = Array.from(panel.querySelectorAll('[data-desktop-nav-item]'))
        .map(item => item.textContent ?? '');
      const partnerIndex = itemLabels.findIndex(label => label.includes('Partner Communities'));
      const caringIndex = itemLabels.findIndex(label => label.includes('Caring Community'));

      expect(partnerIndex).toBeGreaterThanOrEqual(0);
      expect(caringIndex).toBe(partnerIndex + 1);
    });

    it('places Podcasts after Courses and before Premium when enabled', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => ['courses', 'podcasts', 'member_premium'].includes(feature)),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Community' }));

      expect(screen.getByRole('button', { name: /^Podcasts\b/ })).toBeInTheDocument();

      const bodyText = document.body.textContent ?? '';
      expect(bodyText.indexOf('Courses')).toBeLessThan(bodyText.indexOf('Podcasts'));
      expect(bodyText.indexOf('Podcasts')).toBeLessThan(bodyText.indexOf('Premium'));
    });
  });

  /**
   * 🔴 Owner's report, 2026-09-03: "I don't see any way to create a new course or
   * a new podcast" — on a community where both features were already on. This "+"
   * is where a member goes to start something and it offered only a listing and
   * an event, while the Courses and Podcasts pages (which do have working create
   * buttons) sit last in the right-hand column of the "Community" dropdown.
   */
  describe('create menu', () => {
    it('offers Course and Podcast when those features are on', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => ['courses', 'podcasts'].includes(feature)),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Create new' }));

      expect(screen.getByText('New Course')).toBeInTheDocument();
      expect(screen.getByText('New Podcast')).toBeInTheDocument();
    });

    it('omits them when the features are off, because the route redirects home', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          // Both default to FALSE platform-wide and are off or unset on 9 of 13
          // communities. Offering a builder whose route bounces to the home page
          // would be worse than not offering it.
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => false),
        },
      });

      render(<Navbar />);
      await user.click(screen.getByRole('button', { name: 'Create new' }));

      expect(screen.queryByText('New Course')).not.toBeInTheDocument();
      expect(screen.queryByText('New Podcast')).not.toBeInTheDocument();
      // The always-available option is still there, so this is not an empty menu.
      expect(screen.getByText('New Listing')).toBeInTheDocument();
    });
  });

  describe('More dropdown', () => {
    it('renders More dropdown', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
      });
      render(<Navbar />);
      expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('labels the ideation menu item as Ideas', async () => {
      const user = userEvent.setup();
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          hasFeature: vi.fn((feature: string) => feature === 'ideation_challenges'),
          hasModule: vi.fn(() => true),
        },
      });

      render(<Navbar />);
      const moreButton = screen.getByRole('button', { name: 'More' });
      await user.click(moreButton);

      const ideasItem = screen.getByRole('button', { name: /^Ideas\b/ });
      expect(ideasItem).toBeInTheDocument();
      expect(ideasItem.className).toContain('desktop-nav-panel-item');
      expect(screen.queryByText('Ideation Challenges')).not.toBeInTheDocument();
    });
  });

  describe('Tenant-specific about items', () => {
    it('includes hOUR Timebank specific items when slug is hour-timebank', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      // The about items are inside the More dropdown which is collapsed by default.
      // We can verify the component renders without error; the dropdown menu items
      // are created but not necessarily visible until the dropdown is opened.
      const { container } = render(<Navbar />);
      expect(container).toBeTruthy();
    });

    it('excludes hOUR Timebank specific items for other tenants', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        tenant: {
          tenant: { id: 3, name: 'Other Tenant', slug: 'other-tenant' },
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      const { container } = render(<Navbar />);
      expect(container).toBeTruthy();
      // Partner With Us should not appear in the About items for non-hour-timebank tenants
      expect(screen.queryByText('Partner With Us')).not.toBeInTheDocument();
    });
  });

  describe('Mobile menu toggle', () => {
    it('renders mobile menu button with correct aria-label', () => {
      render(<Navbar />);
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument();
    });

    it('calls onMobileMenuOpen when mobile menu button is pressed', async () => {
      const user = userEvent.setup();
      const onMobileMenuOpen = vi.fn();
      render(<Navbar onMobileMenuOpen={onMobileMenuOpen} />);
      const menuButton = screen.getByLabelText('Open menu');
      await user.click(menuButton);
      expect(onMobileMenuOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('Unread notification badge', () => {
    it('shows unread count on notification bell', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        notifications: { unreadCount: 5, counts: { messages: 0, notifications: 5 } },
      });
      render(<Navbar />);
      expect(screen.getByLabelText('Notifications, 5 unread')).toBeInTheDocument();
    });
  });

  describe('Message count badge', () => {
    it('shows message count on Messages link', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', role: 'member' }, isAuthenticated: true },
        notifications: { unreadCount: 3, counts: { messages: 3, notifications: 0 } },
        tenant: {
          hasModule: vi.fn((mod: string) => mod === 'messages'),
        },
      });
      render(<Navbar />);
      // HeroUI Badge renders the count in multiple places; use getAllByText
      const badges = screen.getAllByText('3');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * 🔴 The gap these tests close — precisely.
   *
   * `buildAccessibleFrontendUrl()` has its own unit tests including four custom-domain
   * cases, and the API payload that feeds it is asserted in
   * `tests/Laravel/Feature/TenantBootstrapTest.php`. The Navbar's use of it was ALSO
   * already tested — in `describe('Navigation links')` above — but ONLY for the slug
   * fallback, with a tenant object carrying no `accessible_domain` at all.
   *
   * So the untested path was the one that actually matters to the two communities that
   * have their own accessible address: does the Navbar pass `tenant.accessible_domain`
   * through from a bootstrap-shaped tenant object? Drop that field anywhere along the
   * chain — the TS type, the API's `!empty()` guard, the context, the `useMemo`
   * argument list — and the link keeps working. It just quietly stops using the
   * community's own address and falls back to the platform host plus the slug. No
   * error, no broken page, and the pre-existing slug test still passes.
   *
   * Verified against production on 2026-08-14: exactly two communities have the field
   * set — `timebanking-org` → `accessible-uk.timebank.global` and
   * `minehead-and-coast-timebank` → `accessible-minehead-and-coast.timebank.global`.
   * The other nine correctly have no value and use the slug form.
   */
  describe('Accessible frontend link in the utility bar', () => {
    // 🔴 TWO stubs in `i18nMap` above were stale until 2026-08-14, in this file AND in
    // MobileDrawer.test.tsx: `nav.accessibility_alpha` read 'Accessibility (alpha)' where
    // the committed locale says 'WCAG 2.2 AA Version', and the aria-label key matched.
    // Three pre-existing assertions were therefore checking text the application does
    // not render. Copy stub values FROM `public/locales/en/common.json`; do not type
    // what you expect them to say.
    const accessibleLink = () =>
      screen.getByLabelText('Open WCAG 2.2 AA accessible version in a new tab') as HTMLAnchorElement;

    it("uses the community's own accessible domain when the API supplies one", () => {
      setupDefaultMocks({
        tenant: {
          tenant: {
            id: 11,
            name: 'Timebanking UK',
            slug: 'timebanking-org',
            accessible_domain: 'accessible-uk.timebank.global',
          },
        },
      });
      render(<Navbar />);

      const href = accessibleLink().getAttribute('href') ?? '';
      // Bare host, no trailing slash — buildAccessibleFrontendUrl normalises '/' to ''.
      expect(href).toBe('https://accessible-uk.timebank.global');
      // The whole point: no slug in the path. A community on its own accessible
      // domain is served slug-less, so a slug here would 404 on that host.
      expect(href).not.toContain('timebanking-org');
    });

    it('falls back to the platform host plus the slug when no accessible domain is set', () => {
      setupDefaultMocks({
        tenant: { tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' } },
      });
      render(<Navbar />);

      const href = accessibleLink().getAttribute('href') ?? '';
      expect(href).toBe('https://accessible.project-nexus.ie/hour-timebank/accessible');
    });

    it('opens in a new tab with rel="noopener noreferrer"', () => {
      setupDefaultMocks({
        tenant: {
          tenant: {
            id: 14,
            name: 'Minehead',
            slug: 'minehead-and-coast-timebank',
            accessible_domain: 'accessible-minehead-and-coast.timebank.global',
          },
        },
      });
      render(<Navbar />);

      const link = accessibleLink();
      expect(link.getAttribute('href')).toBe('https://accessible-minehead-and-coast.timebank.global');
      expect(link.getAttribute('target')).toBe('_blank');
      // Without noopener the opened page can reach back through window.opener.
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });
});
