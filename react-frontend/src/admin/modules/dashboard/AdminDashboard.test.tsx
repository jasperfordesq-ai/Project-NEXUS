// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import type { User } from '@/types/api';
import type { AdminDashboardStats } from '@/admin/api/types';

// ── @/contexts ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockHasFeature = vi.hoisted(() => vi.fn((_feature: string) => true));
const mockHasModule = vi.hoisted(() => vi.fn((_module: string) => true));
const mockAuthUser = vi.hoisted(() => ({ current: { id: 1, role: 'admin' } as Record<string, unknown> }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({ user: mockAuthUser.current as unknown as User, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: mockHasModule,
    }),
  }),
);

// ── adminApi ──────────────────────────────────────────────────────────────────
const mockGetStats = vi.fn();
const mockGetActivity = vi.fn();
const mockGetTrends = vi.fn();

vi.mock('@/admin/api/adminApi', () => ({
  adminDashboard: {
    getStats: (...args: unknown[]) => mockGetStats(...args),
    getActivity: (...args: unknown[]) => mockGetActivity(...args),
    getTrends: (...args: unknown[]) => mockGetTrends(...args),
  },
}));

// ── badge counts ("Needs your attention") ─────────────────────────────────────
const mockBadges = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  loaded: true,
  refresh: vi.fn(),
}));
vi.mock('@/admin/hooks/useAdminBadgeCounts', () => ({
  useAdminBadgeCounts: () => mockBadges,
}));

// ── AdminMetaContext ───────────────────────────────────────────────────────────
vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ── useOnboardingConfig ───────────────────────────────────────────────────────
const mockUseOnboardingConfig = vi.fn();
vi.mock('@/hooks/useOnboardingConfig', () => ({
  useOnboardingConfig: () => mockUseOnboardingConfig(),
}));

// ── recharts (jsdom has no layout; the chart's children are enough) ───────────
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import { AdminDashboard } from './AdminDashboard';

const STATS: AdminDashboardStats = {
  total_users: 120,
  total_users_start_of_month: 100,
  members_delta_pct: 20,
  active_users: 80,
  active_users_window_days: 30,
  approved_users: 118,
  pending_users: 0,
  total_listings: 60,
  active_listings: 45,
  active_listings_delta_pct: null,
  pending_listings: 0,
  pending_organisations: 0,
  total_transactions: 300,
  total_hours_exchanged: 850,
  exchanges_this_month: 12,
  exchanges_last_month: 8,
  exchanges_delta_pct: 50,
  exchange_hours_this_month: 31.5,
  exchange_hours_last_month: 42,
  exchange_hours_delta_pct: -25,
  new_users_this_month: 10,
  new_users_last_month: 5,
  new_users_delta_pct: 100,
  new_listings_this_month: 5,
  new_listings_last_month: 2,
  _partial: false,
  _failed_metrics: [],
};

const ACTIVITY = [
  { id: 1, user_id: 7, user_name: 'Alice', action: 'listing_create', description: 'created a listing', created_at: '2026-06-01T10:00:00Z' },
  { id: 2, user_id: 8, user_name: 'Bob', action: 'blog', description: null, description_code: 'blog_post_created', description_params: { id: 4, title: 'Spring news' }, created_at: '2026-06-02T09:00:00Z' },
];

const TRENDS = [
  { month: '2026-05', users: 3, listings: 2, transactions: 4, hours: 80 },
  { month: '2026-06', users: 1, listings: 0, transactions: 6, hours: 95 },
];

function setupSuccessfulLoad(overrides: Partial<AdminDashboardStats> = {}) {
  mockGetStats.mockResolvedValue({ success: true, data: { ...STATS, ...overrides } });
  mockGetActivity.mockResolvedValue({ success: true, data: ACTIVITY });
  mockGetTrends.mockResolvedValue({ success: true, data: TRENDS, meta: { months: 12, _partial: false, _failed_metrics: [] } });
  mockUseOnboardingConfig.mockReturnValue({
    config: { step_safeguarding_enabled: true },
    isLoading: false,
  });
}

/** The card is a link: the accessible name is the label. */
function cardLink(label: RegExp) {
  return screen.getByRole('link', { name: label });
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockImplementation(() => true);
    mockHasModule.mockImplementation(() => true);
    mockAuthUser.current = { id: 1, role: 'admin' };
    mockBadges.counts = {};
    mockBadges.loaded = true;
    mockUseOnboardingConfig.mockReturnValue({ config: { step_safeguarding_enabled: true }, isLoading: false });
  });

  it('shows a page-shaped skeleton while the first load is in flight', () => {
    mockGetStats.mockReturnValue(new Promise(() => {}));
    mockGetActivity.mockReturnValue(new Promise(() => {}));
    mockGetTrends.mockReturnValue(new Promise(() => {}));
    render(<AdminDashboard />);
    expect(screen.getByTestId('dashboard-skeleton')).toHaveAttribute('aria-busy', 'true');
  });

  it('asks for twelve months of trends', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(mockGetTrends).toHaveBeenCalledWith(12));
  });

  it('renders the four headline cards as links into the right pages', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());

    expect(cardLink(/^Members$/)).toHaveAttribute('href', '/test/admin/users');
    expect(cardLink(/^Active Listings$/)).toHaveAttribute('href', '/test/admin/listings?status=active');
    expect(cardLink(/^Exchanges this month$/)).toHaveAttribute('href', '/test/admin/timebanking');
    expect(cardLink(/^Hours exchanged this month$/)).toHaveAttribute('href', '/test/admin/reports/hours');

    const headline = screen.getByTestId('headline-stats');
    expect(within(headline).getByText('120')).toBeInTheDocument();
    expect(within(headline).getByText('45')).toBeInTheDocument();
    expect(within(headline).getByText('12')).toBeInTheDocument();
    expect(within(headline).getByText('31.5')).toBeInTheDocument();
  });

  it('shows the change against last month, up and down', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('+50%')).toBeInTheDocument());
    expect(screen.getByText('-25%')).toBeInTheDocument();
    expect(screen.getByText('+20%')).toBeInTheDocument();
    expect(screen.getAllByText('vs last month').length).toBeGreaterThanOrEqual(3);
  });

  it('labels the active-members card with the 30-day window and links the supporting cards', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('secondary-stats')).toBeInTheDocument());

    expect(cardLink(/Active in the last 30 days/)).toHaveAttribute('href', '/test/admin/reports/members');
    expect(cardLink(/^New members this month$/)).toHaveAttribute('href', '/test/admin/reports/members');
    expect(cardLink(/^Total Listings$/)).toHaveAttribute('href', '/test/admin/listings');
    expect(cardLink(/^Hours exchanged, all time$/)).toHaveAttribute('href', '/test/admin/timebanking');
    expect(within(screen.getByTestId('secondary-stats')).getByText('80')).toBeInTheDocument();
  });

  it('sends the exchange cards elsewhere when the wallet module is off', async () => {
    mockHasModule.mockImplementation((m: string) => m !== 'wallet');
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());
    expect(cardLink(/^Exchanges this month$/)).toHaveAttribute('href', '/test/admin/community-analytics');
    expect(cardLink(/^Hours exchanged this month$/)).toHaveAttribute('href', '/test/admin/community-analytics');
  });

  // ── Needs your attention ─────────────────────────────────────────────────────

  it('says all clear when nothing is waiting', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('attention-strip-clear')).toBeInTheDocument());
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('never says all clear before the badge counts have answered', async () => {
    mockBadges.loaded = false;
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('attention-strip-loading')).toBeInTheDocument());
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('lists every waiting queue as a link with its count and filter', async () => {
    mockBadges.counts = { pending_users: 6, pending_listings: 2, unreviewed_messages: 3, pending_exchanges: 1, fraud_alerts: 0, gdpr_requests: 4 };
    setupSuccessfulLoad({ pending_organisations: 1, pending_users: 6 });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('attention-strip')).toBeInTheDocument());

    const strip = screen.getByTestId('attention-strip');
    expect(within(strip).getByText('13 items are waiting for a decision')).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: 'Members awaiting approval: 6' })).toHaveAttribute('href', '/test/admin/users?filter=pending');
    expect(within(strip).getByRole('link', { name: 'Listings awaiting review: 2' })).toHaveAttribute('href', '/test/admin/listings?status=pending');
    expect(within(strip).getByRole('link', { name: 'Organisations awaiting approval: 1' })).toHaveAttribute('href', '/test/admin/volunteering/organizations');
    expect(within(strip).getByRole('link', { name: 'Messages to review: 3' })).toHaveAttribute('href', '/broker/messages?status=unreviewed'.replace(/^/, '/test'));
    expect(within(strip).getByRole('link', { name: 'Exchanges needing a broker: 1' })).toHaveAttribute('href', '/test/broker/exchanges?status=needs_action');
    // Zero queues are not listed, and GDPR requests are god-only.
    expect(within(strip).queryByText(/Fraud alerts/)).toBeNull();
    expect(within(strip).queryByText(/Data requests/)).toBeNull();
  });

  it('shows data requests to a god account and hides organisations when volunteering is off', async () => {
    mockAuthUser.current = { id: 1, role: 'admin', is_god: true };
    mockHasFeature.mockImplementation((f: string) => f !== 'volunteering');
    mockBadges.counts = { gdpr_requests: 2, pending_orgs: 5 };
    setupSuccessfulLoad({ pending_organisations: 5 });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('attention-strip')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Data requests: 2' })).toHaveAttribute('href', '/test/admin/enterprise/gdpr/requests');
    expect(screen.queryByText(/Organisations awaiting approval/)).toBeNull();
  });

  // ── Activity and chart ───────────────────────────────────────────────────────

  it('puts structured activity rows into words instead of leaving them blank', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText(/created a listing/)).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText(/Created blog post #4: Spring news/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View All' })).toHaveAttribute('href', '/test/admin/activity-log');
  });

  it('renders the exchange chart with its footnote about what is excluded', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('area-chart')).toBeInTheDocument());
    expect(screen.getByText('Exchange activity')).toBeInTheDocument();
    expect(screen.getByText(/Opening balances, admin adjustments, donations and reversals are left out/)).toBeInTheDocument();
  });

  it('shows an empty message when there are no exchanges in the period', async () => {
    setupSuccessfulLoad();
    mockGetTrends.mockResolvedValue({ success: true, data: TRENDS.map((r) => ({ ...r, transactions: 0, hours: 0 })), meta: { _failed_metrics: [] } });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('No exchanges in this period yet')).toBeInTheDocument());
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('marks the chart as not loaded when the transactions series failed', async () => {
    setupSuccessfulLoad();
    mockGetTrends.mockResolvedValue({ success: true, data: TRENDS.map((r) => ({ ...r, transactions: null, hours: null })), meta: { _partial: true, _failed_metrics: ['transactions'] } });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('The chart could not be loaded.')).toBeInTheDocument());
  });

  // ── Failure modes ────────────────────────────────────────────────────────────

  it('shows an error state with a retry when the stats request fails (api never throws)', async () => {
    mockGetStats.mockResolvedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    mockGetActivity.mockResolvedValue({ success: false });
    mockGetTrends.mockResolvedValue({ success: false });
    render(<AdminDashboard />);

    await waitFor(() => expect(screen.getByText('The dashboard could not load')).toBeInTheDocument());
    expect(screen.queryByTestId('headline-stats')).toBeNull();
    // No toast on the first load: the page already says so.
    expect(mockToast.error).not.toHaveBeenCalled();

    setupSuccessfulLoad();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());
  });

  it('shows a partial banner and marks the failed tile when one figure could not be computed', async () => {
    setupSuccessfulLoad({ active_users: null, _partial: true, _failed_metrics: ['active_users'] });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('dashboard-partial-banner')).toBeInTheDocument());
    expect(screen.getByText('Some figures could not be loaded')).toBeInTheDocument();
    const active = cardLink(/Active in the last 30 days/);
    expect(within(active).getByText('Could not load')).toBeInTheDocument();
    expect(within(active).getByText('—')).toBeInTheDocument();
    // The other tiles are untouched.
    expect(within(screen.getByTestId('headline-stats')).queryByText('Could not load')).toBeNull();
  });

  it('re-fetches, refreshes the badges and toasts on a failed refresh', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(1));

    mockGetStats.mockResolvedValue({ success: false });
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(2));
    expect(mockBadges.refresh).toHaveBeenCalled();
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    // The last good figures stay on screen rather than being replaced by an error page.
    expect(screen.getByTestId('headline-stats')).toBeInTheDocument();
  });

  // ── Quick links ──────────────────────────────────────────────────────────────

  it('shows the quick links, with the newsletter one only when the feature is on', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /send newsletter/i })).toHaveAttribute('href', '/test/admin/newsletters');
    });
    expect(screen.getByRole('link', { name: /activity log/i })).toHaveAttribute('href', '/test/admin/activity-log');
    expect(screen.getByRole('link', { name: /manage users/i })).toHaveAttribute('href', '/test/admin/users');
  });

  it('hides the newsletter quick link when the feature is off', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'newsletter');
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /send newsletter/i })).not.toBeInTheDocument();
  });

  // The Enterprise dashboard is god accounts only (owner decision 2026-10-02).
  it('hides the Enterprise link from an ordinary admin and shows it to a god account', async () => {
    setupSuccessfulLoad();
    const { unmount } = render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());
    expect(document.querySelector('a[href="/test/admin/enterprise"]')).toBeNull();
    unmount();

    mockAuthUser.current = { id: 1, role: 'admin', is_god: true };
    render(<AdminDashboard />);
    await waitFor(() => expect(document.querySelector('a[href="/test/admin/enterprise"]')).not.toBeNull());
  });

  // ── Safeguarding banner ──────────────────────────────────────────────────────

  it('shows the safeguarding disabled banner when step_safeguarding_enabled is false', async () => {
    setupSuccessfulLoad();
    mockUseOnboardingConfig.mockReturnValue({ config: { step_safeguarding_enabled: false }, isLoading: false });
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('safeguarding-disabled-banner')).toBeInTheDocument());
  });

  it('does not show the safeguarding banner when the step is on', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId('headline-stats')).toBeInTheDocument());
    expect(screen.queryByTestId('safeguarding-disabled-banner')).toBeNull();
  });
});
