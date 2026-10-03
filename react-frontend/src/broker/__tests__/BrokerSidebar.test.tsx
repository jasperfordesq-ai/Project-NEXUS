// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();
const mockLocation = { pathname: '/broker', search: '', hash: '', state: null, key: 'default' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => mockLocation,
  };
});

vi.mock('@/contexts', () => ({
  useAuth: () => mockUseAuth(),
  useTenant: () => mockUseTenant(),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'sidebar.section_overview': 'Overview',
      'sidebar.section_daily': 'Daily',
      'sidebar.section_compliance': 'Compliance',
      'sidebar.section_records': 'Records',
      'sidebar.section_settings': 'Settings',
      'sidebar.title': 'Broker Panel',
      'sidebar.expand': 'Expand',
      'sidebar.collapse': 'Collapse',
      'sidebar.nav_label': 'Broker navigation',
      'sidebar.full_admin': 'Full Admin',
      'nav.dashboard': 'Dashboard',
      'nav.members': 'Members',
      'nav.onboarding': 'Onboarding',
      'nav.exchanges': 'Exchanges',
      'nav.match_approvals': 'Match Approvals',
      'nav.moderation_queue': 'Content Queue',
      'nav.moderation_feed': 'Feed Posts',
      'nav.moderation_comments': 'Comments',
      'nav.moderation_reviews': 'Reviews',
      'nav.moderation_reports': 'Reports',
      'nav.safeguarding_options': 'Safeguarding Options',
      'sidebar.section_moderation': 'Moderation',
      'nav.messages': 'Messages',
      'nav.safeguarding': 'Safeguarding',
      'nav.vetting': 'Vetting',
      'nav.monitoring': 'Monitoring',
      'nav.risk_tags': 'Risk Tags',
      'nav.insurance': 'Insurance',
      'nav.archives': 'Archives',
      'nav.configuration': 'Configuration',
      'nav.help': 'Help',
    }[key] ?? key),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { BrokerSidebar, type BrokerBadgeCounts } from '../components/BrokerSidebar';

const EMPTY_BADGES: BrokerBadgeCounts = {
  pending_members: 0,
  safeguarding_alerts: 0,
  vetting_review_requests: 0,
  pending_exchanges: 0,
  unreviewed_messages: 0,
  monitored_users: 0,
  high_risk_listings: 0,
  pending_matches: 0,
  support_needs_unseen: 0,
  pending_support_actions: 0,
};

describe('BrokerSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: () => true,
      hasModule: () => true,
    });
  });

  it('shows the Moderation section with the content queue and reports items', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.getByText('Content Queue')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Safeguarding Options')).toBeInTheDocument();
  });

  it('hides Feed Posts moderation when the feed module is off', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: () => true,
      hasModule: (m: string) => m !== 'feed',
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.queryByText('Feed Posts')).not.toBeInTheDocument();
    // Non-feed moderation items remain.
    expect(screen.getByText('Content Queue')).toBeInTheDocument();
  });

  it('gives safeguarding its own section, support needs first, and hides volunteering incidents without the feature', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: (f: string) => f !== 'volunteering',
      hasModule: () => true,
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    const safeguarding = links.filter((href) => href?.startsWith('/broker/safeguarding'));
    expect(safeguarding).toEqual([
      '/broker/safeguarding/support-needs',
      '/broker/safeguarding/flagged-messages',
      '/broker/safeguarding/guardians',
      '/broker/safeguarding/support-actions',
      '/broker/safeguarding-options',
    ]);
    expect(screen.queryByText('Volunteering incidents')).not.toBeInTheDocument();
  });

  it('hides Reviews moderation when the reviews feature is off', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: (f: string) => f !== 'reviews',
      hasModule: () => true,
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.queryByText('Reviews')).not.toBeInTheDocument();
    expect(screen.getByText('Content Queue')).toBeInTheDocument();
  });

  it('does not show the Full Admin link for broker users with stale admin flags', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'broker', is_admin: true },
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.queryByText('Full Admin')).not.toBeInTheDocument();
  });

  it('shows the Full Admin link for real admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'admin', is_admin: true },
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.getByText('Full Admin')).toBeInTheDocument();
  });

  it('shows the Exchanges nav item when exchange_workflow is enabled', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.getByText('Exchanges')).toBeInTheDocument();
  });

  it('hides the Exchanges nav item when exchange_workflow is disabled', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: (f: string) => f !== 'exchange_workflow',
      hasModule: () => true,
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.queryByText('Exchanges')).not.toBeInTheDocument();
    // Non-exchange items remain available regardless of the feature.
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('shows the Match Approvals nav item with its pending badge when the feature is on', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });

    render(
      <BrokerSidebar
        collapsed={false}
        onToggle={vi.fn()}
        badges={{ ...EMPTY_BADGES, pending_matches: 7 }}
      />
    );

    expect(screen.getByText('Match Approvals')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('hides the Match Approvals nav item when exchange_workflow is disabled', () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: 'broker' } });
    mockUseTenant.mockReturnValue({
      tenant: { id: 2, slug: 'test-tenant', name: 'Test Tenant' },
      tenantPath: (path: string) => path,
      hasFeature: (f: string) => f !== 'exchange_workflow',
      hasModule: () => true,
    });

    render(<BrokerSidebar collapsed={false} onToggle={vi.fn()} badges={EMPTY_BADGES} />);

    expect(screen.queryByText('Match Approvals')).not.toBeInTheDocument();
  });
});
