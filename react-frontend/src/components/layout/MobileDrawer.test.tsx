// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MobileDrawer component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

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
      return <a href={to} className={cls}>{children}</a>;
    },
  };
});

const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();
const mockUseNotifications = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useCookieConsent: () => ({ showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn() }),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn(), accentColor: '#3b82f6', setAccentColor: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
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
vi.mock('@/contexts/CookieConsentContext', () => ({
  useCookieConsent: () => ({ resetConsent: vi.fn() }),
}));
vi.mock('@/contexts/MenuContextCore', () => ({
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
}));
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn(), accentColor: '#3b82f6', setAccentColor: vi.fn() }),
}));

const i18nMap: Record<string, string> = {
  'nav.home': 'Home', 'nav.dashboard': 'Dashboard', 'nav.feed': 'Feed',
  'nav.listings': 'Listings', 'nav.messages': 'Messages', 'nav.groups': 'Groups',
  'nav.events': 'Events', 'nav.connections': 'Connections', 'nav.exchanges': 'Exchanges',
  'nav.wallet': 'Wallet', 'nav.volunteering': 'Volunteering', 'nav.blog': 'Blog',
  'nav.resources': 'Resources', 'nav.members': 'Members', 'nav.about': 'About',
  'nav.caring_community': 'Caring Community', 'nav.premium': 'Premium',
  'nav.achievements': 'Achievements', 'nav.leaderboard': 'Leaderboard', 'nav.goals': 'Goals',
  'nav.ai_chat': 'AI Chat', 'nav.our_impact': 'Our Impact',
  'nav.timebanking_guide': 'Timebanking Guide', 'nav.faq': 'FAQ',
  'nav.strategic_plan': 'Strategic Plan', 'nav.social_prescribing': 'Social Prescribing',
  'nav.partner_with_us': 'Partner With Us', 'nav.impact_report': 'Impact Report',
  'nav.organisations': 'Organisations', 'nav.partner_communities': 'Partner Communities',
  'nav.group_exchanges': 'Group Exchanges',
  'nav.accessibility_alpha': 'WCAG 2.2 AA Version',
  'nav.federation_hub': 'Federation Hub', 'nav.federated_members': 'Federated Members',
  'nav.federation_hub_short': 'Hub', 'nav.federation_partners_short': 'Communities',
  'nav.federation_members_short': 'Members', 'nav.federation_messages_short': 'Messages',
  'nav.federation_listings_short': 'Listings', 'nav.federation_events_short': 'Events',
  'nav.federation_settings_short': 'Settings',
  'nav.federated_listings': 'Federated Listings', 'nav.federated_messages': 'Federated Messages',
  'nav.federated_events': 'Federated Events',
  'auth.log_in': 'Log In', 'auth.sign_up': 'Sign Up',
  'account.settings': 'Settings', 'account.log_out': 'Log Out',
  'report_problem.trigger': 'Report a problem',
  // Admin tool keys used by MobileDrawer (user_menu namespace)
  'user_menu.admin_panel': 'Admin Panel',
  'broker:sidebar.title': 'Broker Panel',
  'user_menu.legacy_admin': 'Legacy Admin',
  'user_menu.help_center': 'Help Center',
  'sections.main': 'Main',
  'sections.about': 'About', 'sections.support': 'Support', 'sections.legal': 'Legal',
  'sections.community': 'Community', 'sections.explore': 'Explore',
  'sections.federation': 'Federation', 'sections.partner_communities': 'Partner Communities',
  'sections.account': 'Account',
  'accessibility.close_menu': 'Close menu',
  'accessibility.accessibility_alpha_new_tab': 'Open WCAG 2.2 AA accessible version in a new tab',
  'aria.open_search': 'Open search',
  'aria.mobile_navigation': 'Mobile navigation',
  'aria.main_navigation': 'Main navigation',
  'aria.timebanking_navigation': 'Timebanking navigation',
  'aria.community_navigation': 'Community navigation',
  'aria.engage_navigation': 'Engage navigation',
  'aria.explore_navigation': 'Explore navigation',
  'aria.federation_navigation': 'Federation navigation',
  'aria.about_navigation': 'About navigation',
  'aria.legal_navigation': 'Legal navigation',
  'sections.language': 'Language',
  'nav.timebanking': 'Timebanking',
  'support.help_center': 'Help Center', 'support.contact': 'Contact',
  'legal.terms_of_service': 'Terms of Service', 'legal.privacy_policy': 'Privacy Policy',
  'legal.cookie_policy': 'Cookie Policy', 'legal.accessibility': 'Accessibility',
  'legal.legal_hub': 'Legal Hub',
  'footer.project_nexus': 'Project NEXUS',
  'footer.source_repo': 'GitHub repo',
  'footer.source_repo_aria': 'Open the Project NEXUS GitHub repository',
  'footer.source_repo_tooltip': 'Open the Project NEXUS source repository on GitHub',
  'footer.agpl_notice': 'AGPL-3.0 \u2014 Copyright \u00A9 2024\u2013{{year}} Jasper Ford',
  'footer.terms': 'Terms',
  'footer.privacy': 'Privacy',
  'cookie_consent.manage': 'Manage Cookies',
  'stats.credits': 'Credits', 'stats.messages': 'Messages', 'stats.alerts': 'Alerts',
  'search.placeholder': 'Search...',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let value = i18nMap[key] ?? key;
      Object.entries(options ?? {}).forEach(([optionKey, optionValue]) => {
        value = value.replace(`{{${optionKey}}}`, String(optionValue));
      });
      return value;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));

vi.mock('@/components/pwa/InstallAppButton', () => ({
  InstallAppButton: ({ children }: {
    children: (args: { onClick: () => void; label: string; sublabel: string }) => React.ReactNode;
  }) => children({
    onClick: vi.fn(),
    label: 'Install app',
    sublabel: 'Faster access, works offline',
  }),
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

import { MobileDrawer } from './MobileDrawer';
import { PROJECT_NEXUS_REPO_URL } from './SourceRepositoryLink';

function setupDefaultMocks(overrides: {
  auth?: Record<string, unknown>;
  tenant?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
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
}

describe('MobileDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSearchOpen: vi.fn(),
  };

  // Locate an accordion section header by accessible name and expand it.
  // The real component renders a HeroUI Accordion trigger button; under the
  // shared UI mock the AccordionItem title may render without a
  // data-slot="trigger" attribute, so fall back to the section header text and
  // click its nearest clickable ancestor. Returns the element used as trigger.
  function expandSection(name: RegExp): HTMLElement {
    const buttons = screen.queryAllByRole('button', { name });
    const trigger =
      buttons.find((btn) => btn.getAttribute('data-slot') === 'trigger') ??
      buttons[0];
    if (trigger) {
      fireEvent.click(trigger);
      return trigger;
    }
    // No matching button — fall back to the header text node and click it.
    const header = screen.getAllByText(name)[0] as HTMLElement;
    const clickable = (header.closest('button') as HTMLElement | null) ?? header;
    fireEvent.click(clickable);
    return clickable;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Rendering when open', () => {
    it('renders the drawer when isOpen is true', () => {
      render(<MobileDrawer {...defaultProps} />);
      // The drawer renders a Close menu button
      expect(screen.getByLabelText('Close menu')).toBeInTheDocument();
    });

    it('opens the navigation as a mobile bottom sheet', () => {
      render(<MobileDrawer {...defaultProps} />);
      const dialog = screen.getByRole('dialog', { name: 'Mobile navigation' });
      expect(dialog).toHaveAttribute('data-placement', 'bottom');
      expect(dialog).toHaveClass('nexus-mobile-navigation-sheet');
      expect(document.querySelector('[data-slot="drawer-backdrop"]')).toHaveClass(
        'z-[var(--z-modal-backdrop)]',
      );
      expect(document.querySelector('.drawer__content--bottom')).toHaveClass(
        'z-[var(--z-modal)]',
      );
    });

    it('renders the brand name', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });

    it('renders the search button', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByLabelText('Open search')).toBeInTheDocument();
    });

    it('uses readable semantic text colors for the install affordance', () => {
      render(<MobileDrawer {...defaultProps} />);

      const installButton = screen.getByRole('button', { name: /Install app/i });
      expect(installButton).toHaveClass('h-auto', 'text-theme-primary');
      expect(screen.getByText('Faster access, works offline')).toHaveClass('text-theme-secondary');
      expect(
        screen.getByRole('button', { name: 'Sign Up' }).compareDocumentPosition(installButton)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('renders full-width account stat cards without clipping their labels', () => {
      setupDefaultMocks({
        auth: {
          user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com', balance: 12 },
          isAuthenticated: true,
          logout: vi.fn(),
        },
      });
      render(<MobileDrawer {...defaultProps} />);

      const stats = screen.getByTestId('mobile-account-stats');
      expect(stats).toHaveClass('w-full', 'grid-cols-3');

      const statButtons = Array.from(stats.querySelectorAll('button'));
      expect(statButtons).toHaveLength(3);
      for (const [index, label] of ['Credits', 'Messages', 'Alerts'].entries()) {
        const button = statButtons[index];
        const labelNode = Array.from(button.querySelectorAll('span')).find((node) => node.textContent === label);
        expect(labelNode).toHaveClass('whitespace-normal', 'text-sm', 'text-theme-secondary');
        expect(button).toHaveClass('h-auto', 'min-h-[76px]', 'w-full');
      }
    });
  });

  describe('Navigation links', () => {
    it('renders Home navigation link', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('renders Listings navigation link when module is enabled', () => {
      setupDefaultMocks({
        tenant: {
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // Listings is in the 'Timebanking' accordion section (collapsed by default).
      // Open the section by clicking the accordion trigger, then verify the item.
      const timebankingTrigger = screen.getByRole('button', { name: /timebanking/i });
      fireEvent.click(timebankingTrigger);
      expect(screen.getByText('Listings')).toBeInTheDocument();
    });

    it('renders About section with universal items', () => {
      render(<MobileDrawer {...defaultProps} />);
      // The 'About' accordion section header renders its title; expand it then verify items.
      const aboutTrigger = expandSection(/^about$/i);
      expect(aboutTrigger).toBeDefined();
      expect(screen.getByText('FAQ')).toBeInTheDocument();
      expect(screen.getByText('Timebanking Guide')).toBeInTheDocument();
    });

    it('renders Contact in utility row for unauthenticated users', () => {
      // For unauthenticated users the utility row shows a Contact button (not Help Center)
      // Help Center is shown only for authenticated users
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Contact')).toBeInTheDocument();
    });

    it('renders a tenant-aware accessible frontend link in the mobile utility row', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      const link = screen.getByRole('link', { name: 'Open WCAG 2.2 AA accessible version in a new tab' });
      expect(link).toHaveAttribute('href', 'https://accessible.project-nexus.ie/hour-timebank/accessible');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByText('WCAG 2.2 AA Version')).toBeInTheDocument();
    });

    it('renders Legal section', () => {
      render(<MobileDrawer {...defaultProps} />);
      // Legal section is collapsed by default — expand the trigger first.
      const legalTrigger = expandSection(/^legal$/i);
      expect(legalTrigger).toBeDefined();
      expect(screen.getByText('Terms of Service')).toBeInTheDocument();
      expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
      expect(screen.getByText('Accessibility')).toBeInTheDocument();
    });
  });

  describe('Unauthenticated state', () => {
    it('shows Log In button when not authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    it('shows Sign Up button when not authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Sign Up')).toBeInTheDocument();
    });

    it('does NOT show user info when not authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.queryByText('Credits')).not.toBeInTheDocument();
    });

    it('does NOT show Settings when not authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('does NOT show Log Out when not authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.queryByText('Log Out')).not.toBeInTheDocument();
    });
  });

  describe('Authenticated state', () => {
    beforeEach(() => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 1,
            first_name: 'Jane',
            last_name: 'Smith',
            email: 'jane@example.com',
            avatar_url: '/jane.jpg',
            role: 'member',
            balance: 10,
          },
          isAuthenticated: true,
        },
      });
    });

    it('shows user name when authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    it('shows user email when authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('shows user balance in quick stats', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Credits')).toBeInTheDocument();
    });

    it('does NOT show Log In / Sign Up when authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.queryByText('Log In')).not.toBeInTheDocument();
      expect(screen.queryByText('Sign Up')).not.toBeInTheDocument();
    });

    it('shows Settings link when authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('shows Log Out button when authenticated', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Log Out')).toBeInTheDocument();
    });

    it('shows a report problem action in mobile support navigation', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument();
    });

    it('shows Dashboard link when authenticated and module enabled', () => {
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  describe('Admin tools', () => {
    it('shows Admin Panel button for admin users', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 1,
            first_name: 'Admin',
            last_name: 'User',
            // Legacy Admin button only renders for jasper.ford.esq@gmail.com;
            // use that email so both buttons appear.
            email: 'jasper.ford.esq@gmail.com',
            role: 'admin',
            is_admin: true,
          },
          isAuthenticated: true,
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.getByText('Admin Panel')).toBeInTheDocument();
      // Legacy Admin (PHP /admin-legacy/) was decommissioned — see root CLAUDE.md.
    });

    it('does NOT show Admin Tools for regular members', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 1,
            first_name: 'Regular',
            last_name: 'User',
            email: 'user@example.com',
            role: 'member',
          },
          isAuthenticated: true,
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
      expect(screen.queryByText('Legacy Admin')).not.toBeInTheDocument();
    });

    it('shows Broker Panel instead of Admin Panel for broker users with stale admin flags', () => {
      setupDefaultMocks({
        auth: {
          user: {
            id: 1,
            first_name: 'Broker',
            last_name: 'User',
            email: 'broker@example.com',
            role: 'broker',
            is_admin: true,
          },
          isAuthenticated: true,
        },
      });

      render(<MobileDrawer {...defaultProps} />);

      expect(screen.getByText('Broker Panel')).toBeInTheDocument();
      expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    });
  });

  describe('Tenant-specific about items', () => {
    it('shows hOUR Timebank specific items when slug is hour-timebank', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // hOUR Timebank items are in the 'About' accordion section (collapsed by default).
      const aboutTrigger = expandSection(/^about$/i);
      expect(aboutTrigger).toBeDefined();
      expect(screen.getByText('Partner With Us')).toBeInTheDocument();
      expect(screen.getByText('Social Prescribing')).toBeInTheDocument();
      expect(screen.getByText('Our Impact')).toBeInTheDocument();
      expect(screen.getByText('Impact Report')).toBeInTheDocument();
      expect(screen.getByText('Strategic Plan')).toBeInTheDocument();
    });

    it('does NOT show hOUR Timebank items for other tenants', () => {
      setupDefaultMocks({
        tenant: {
          tenant: { id: 3, name: 'Other', slug: 'other-tenant' },
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // Open the About accordion to confirm the items are truly absent
      const aboutTrigger = expandSection(/^about$/i);
      expect(aboutTrigger).toBeDefined();
      expect(screen.queryByText('Partner With Us')).not.toBeInTheDocument();
      expect(screen.queryByText('Social Prescribing')).not.toBeInTheDocument();
      expect(screen.queryByText('Our Impact')).not.toBeInTheDocument();
    });
  });

  describe('Feature-gated items', () => {
    it('shows Events link when events feature is enabled', () => {
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn((f: string) => f === 'events'),
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // Events is in the 'Community' accordion section (collapsed by default) — open it first.
      const communityTrigger = expandSection(/^community$/i);
      expect(communityTrigger).toBeDefined();
      expect(screen.getByText('Events')).toBeInTheDocument();
    });

    it('does NOT show Events link when events feature is disabled', () => {
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn(() => false),
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // Community section is hidden when no community features are enabled,
      // so Events will not appear regardless.
      expect(screen.queryByText('Events')).not.toBeInTheDocument();
    });

    it('shows Organisations when the volunteering module feature is enabled', () => {
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn((feature: string) => feature === 'volunteering'),
          hasModule: vi.fn(() => false),
        },
      });

      render(<MobileDrawer {...defaultProps} />);
      expandSection(/^community$/i);

      expect(screen.getByText('Volunteering')).toBeInTheDocument();
      expect(screen.getByText('Organisations')).toBeInTheDocument();
    });

    it('renders Caring Community, Premium, and federation partners from the shared registry', () => {
      setupDefaultMocks({
        auth: {
          user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com' },
          isAuthenticated: true,
          logout: vi.fn(),
        },
        tenant: {
          hasFeature: vi.fn((feature: string) => [
            'caring_community',
            'member_premium',
            'federation',
          ].includes(feature)),
          hasModule: vi.fn(() => false),
        },
      });

      render(<MobileDrawer {...defaultProps} />);
      expandSection(/^community$/i);
      expect(screen.getByText('Caring Community')).toBeInTheDocument();
      expect(screen.getByText('Premium')).toBeInTheDocument();

      expandSection(/^partner communities$/i);
      expect(screen.getByText('Communities')).toBeInTheDocument();
    });

    it('shows Explore section when gamification feature is enabled', () => {
      setupDefaultMocks({
        tenant: {
          hasFeature: vi.fn((f: string) => f === 'gamification'),
          hasModule: vi.fn(() => true),
        },
      });
      render(<MobileDrawer {...defaultProps} />);
      // Achievements/Leaderboard are in the 'Explore' accordion section — open it first.
      const exploreTrigger = expandSection(/^explore$/i);
      expect(exploreTrigger).toBeDefined();
      expect(screen.getByText('Achievements')).toBeInTheDocument();
      expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    });
  });

  describe('AGPL attribution', () => {
    it('renders Built on Project NEXUS attribution link', () => {
      render(<MobileDrawer {...defaultProps} />);
      const link = screen.getByRole('link', { name: 'Open the Project NEXUS GitHub repository' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute(
        'href',
        PROJECT_NEXUS_REPO_URL,
      );
      expect(screen.getByText('GitHub repo')).toBeInTheDocument();
      const year = new Date().getFullYear();
      expect(screen.getByText(`AGPL-3.0 \u2014 Copyright \u00A9 2024\u2013${year} Jasper Ford`)).toBeInTheDocument();
    });
  });

  describe('Accessibility — tap target sizing (WCAG 2.5.5 AAA)', () => {
    // Reads min-h / h-* / min-h-[Npx] from each interactive element and asserts >= 44px.
    // Catches regressions where a button is shrunk below the AAA target-size threshold.
    function extractMinHeightPx(el: Element): number {
      const cls = el.getAttribute('class') ?? '';
      const style = el.getAttribute('style') ?? '';
      // Inline style: min-height: var(--nav-row-min-h, 48px) — extract fallback
      const styleFallback = style.match(/min-height:\s*[^;]*?(\d+)px/);
      if (styleFallback) return parseInt(styleFallback[1], 10);
      // Tailwind arbitrary: min-h-[48px] / min-w-[44px]
      const arbMin = cls.match(/min-h-\[(\d+)px\]/);
      if (arbMin) return parseInt(arbMin[1], 10);
      // Tailwind h-N (rem-based, 1 = 0.25rem = 4px @ 16px root)
      const hN = cls.match(/(?:^|\s)h-(\d+)(?:\s|$)/);
      if (hN) return parseInt(hN[1], 10) * 4;
      return 0;
    }

    it('every nav-link button is at least 44px tall (AAA)', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com' }, isAuthenticated: true, logout: vi.fn() },
        tenant: { hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true), tenantPath: (p: string) => p, tenant: { id: 2, slug: 'test', name: 'T' }, branding: { name: 'T', logo: null, tagline: '' } },
      });
      render(<MobileDrawer {...defaultProps} />);
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const offenders = buttons
        .map((b) => ({ el: b, px: extractMinHeightPx(b), label: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 60) }))
        .filter((row) => row.px > 0 && row.px < 44);
      expect(offenders, `Buttons under 44px: ${JSON.stringify(offenders.map((o) => ({ px: o.px, label: o.label })), null, 2)}`).toEqual([]);
    });

    it('header close button has min-w/min-h of 48px', () => {
      render(<MobileDrawer {...defaultProps} />);
      const close = screen.getByLabelText('Close menu');
      expect(close.className).toMatch(/min-w-\[48px\]/);
      expect(close.className).toMatch(/min-h-\[48px\]/);
    });

    it('drawer contains zero text-xs or text-[10px] sizing', () => {
      render(<MobileDrawer {...defaultProps} />);
      const root = document.querySelector('[role="dialog"]') ?? document.body;
      const all = Array.from(root.querySelectorAll('*'));
      const tooSmall = all.filter((el) => {
        const c = el.getAttribute('class') ?? '';
        return /(?:^|\s)text-xs(?:\s|$)/.test(c) || /text-\[10px\]/.test(c) || /text-\[11px\]/.test(c);
      });
      expect(tooSmall.length, `Elements with sub-12px text classes: ${tooSmall.length}`).toBe(0);
    });

    it('drawer uses zero text-theme-subtle (which fails 4.5:1 contrast)', () => {
      render(<MobileDrawer {...defaultProps} />);
      const root = document.querySelector('[role="dialog"]') ?? document.body;
      const subtle = Array.from(root.querySelectorAll('.text-theme-subtle'));
      expect(subtle.length).toBe(0);
    });
  });

  describe('Federation section labelling', () => {
    it('renders the Partner Communities section header (not "Federation")', () => {
      setupDefaultMocks({
        auth: { user: { id: 1, first_name: 'A', last_name: 'B', email: 'a@b.com' }, isAuthenticated: true, logout: vi.fn() },
        tenant: { hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true), tenantPath: (p: string) => p, tenant: { id: 2, slug: 'test', name: 'T' }, branding: { name: 'T', logo: null, tagline: '' } },
      });
      render(<MobileDrawer {...defaultProps} />);
      const headers = screen.getAllByText('Partner Communities');
      expect(headers.length).toBeGreaterThan(0);
    });
  });
});
