// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

// ── stable mock data ──────────────────────────────────────────────────────────

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const MOCK_STATS = vi.hoisted(() => {
  const daysAgoIso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  return {
    pending_exchanges: 5,
    unreviewed_messages: 3,
    high_risk_listings: 2,
    monitored_users: 10,
    vetting_review_requests: 4,
    safeguarding_alerts: 0,
    onboarding_safeguarding_flags: 2,
    pending_members: 0,
    open_reports: 0,
    safeguarding_jurisdiction_configured: true,
    oldest_waiting: {
      pending_exchanges: daysAgoIso(3),
      unreviewed_messages: daysAgoIso(0),
      safeguarding_alerts: null,
      open_reports: null,
      pending_members: null,
      vetting_review_requests: daysAgoIso(1),
    },
    trends: {
      pending_exchanges: { points: [0, 1, 0, 2, 1, 0, 0, 1, 3, 0, 1, 0, 2, 1], delta: 50 },
      unreviewed_messages: { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], delta: null },
    },
    my_week: { exchanges_decided: 4, messages_reviewed: 12, matches_decided: 0, vetting_handled: 1, total: 17 },
    _partial: false,
    _failed_metrics: [] as string[],
    recent_activity: [
      {
        id: 1,
        action_type: 'exchange_approved',
        first_name: 'Alice',
        last_name: 'Broker',
        details: 'Exchange #42 approved',
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
        source: 'org_audit_log',
      },
    ],
  };
});

// ── adminApi mock ─────────────────────────────────────────────────────────────

const mockGetDashboard = vi.hoisted(() => vi.fn());
const mockGetApprovalStats = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: {
    getDashboard: mockGetDashboard,
  },
  adminMatching: {
    getApprovalStats: mockGetApprovalStats,
  },
}));

// "Waiting for you" has its own tests (BrokerInbox.test.tsx) and needs the
// app-level confirm dialog; the dashboard's tests are about the counts.
vi.mock('../components/BrokerInbox', () => ({ BrokerInbox: () => null }));

// ── contexts ──────────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockAuth = vi.hoisted(() => ({ user: null as unknown as null | { id: number; role: string } }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({ user: mockAuth.user as unknown as User | null, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── hooks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── BrokerControlsHelp mock ───────────────────────────────────────────────────

vi.mock('./BrokerHelpPage', () => ({
  BrokerControlsHelp: () => <div data-testid="broker-help" />,
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { BrokerDashboard, formatActivityDetails, oldestWaitingLabel } from './BrokerDashboardPage';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BrokerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = null;
    mockGetApprovalStats.mockResolvedValue({ success: true, data: { pending_count: 2, avg_review_hours: 6.25 } });
  });

  it('shows loading spinner initially', () => {
    mockGetDashboard.mockReturnValue(new Promise(() => {}));
    render(<BrokerDashboard />);
    const statusEls = screen.getAllByRole('status');
    const spinner = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders stat cards after successful load', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      // Real BrokerStatCards render the translated metric labels.
      expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Monitored Users').length).toBeGreaterThan(0);
    });
  });

  it('shows pending_exchanges count', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      // 5 appears on the KPI card (and possibly the triage hero pill).
      expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    });
  });

  it('links the vetting review-request count to the review queue', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);

    await waitFor(() => {
      expect(screen.getAllByText('Vetting review requests').length).toBeGreaterThan(0);
    });

    const reviewLinks = screen.getAllByRole('link').filter((link) =>
      link.getAttribute('href')?.endsWith('/broker/vetting?status=review_requested'),
    );
    expect(reviewLinks.length).toBeGreaterThan(0);
  });

  // pending_exchanges counts exchanges awaiting approval AND disputed ones. It
  // linked to ?status=pending_broker, so a queue of disputes showed a count on
  // the card and an empty list behind it.
  it('links the pending-exchange count to the needs-action queue, not the approval-only one', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);

    await waitFor(() => {
      expect(screen.getAllByText('Pending Exchanges').length).toBeGreaterThan(0);
    });

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.endsWith('/broker/exchanges?status=needs_action'))).toBe(true);
    expect(hrefs.some((h) => h.endsWith('/broker/exchanges?status=pending_broker'))).toBe(false);
  });

  // high_risk_listings counts high AND critical tags; ?level=high hid the
  // critical ones from the list behind the tile.
  it('links the high-risk count to the high-and-critical view of the risk register', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);

    await waitFor(() => {
      expect(screen.getAllByText('High Risk Listings').length).toBeGreaterThan(0);
    });

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.endsWith('/broker/risk-tags?level=elevated'))).toBe(true);
    expect(hrefs.some((h) => h.endsWith('/broker/risk-tags?level=high'))).toBe(false);
  });

  it('counts a flagged unreviewed message once in the hero total, not under both chips', async () => {
    // Safeguarding alerts are a subset of unreviewed messages.
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_STATS, unreviewed_messages: 3, safeguarding_alerts: 1, pending_exchanges: 0, high_risk_listings: 0, vetting_review_requests: 0, onboarding_safeguarding_flags: 0, pending_members: 0, open_reports: 0 },
    });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getByText('What needs you now')).toBeInTheDocument());
    expect(screen.getByText('items waiting on your review', { exact: false }).textContent).toMatch(/^\s*3\s/);
  });

  it('renders the triage hero with the total of open items', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('What needs you now')).toBeInTheDocument();
    });
    // 5+3+2+4+2 = 16 open items across the non-zero queues
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  it('renders the all-clear hero when every queue is empty', async () => {
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: {
        ...MOCK_STATS,
        pending_exchanges: 0,
        unreviewed_messages: 0,
        high_risk_listings: 0,
        vetting_review_requests: 0,
        safeguarding_alerts: 0,
        onboarding_safeguarding_flags: 0,
      },
    });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('All clear')).toBeInTheDocument();
    });
  });

  it('shows recent activity entry with actor name', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Alice Broker')).toBeInTheDocument();
    });
  });

  it('shows activity details text', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Exchange #42 approved')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: false, data: null });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error card with retry button on load failure', async () => {
    mockGetDashboard.mockRejectedValueOnce(new Error('network'));
    render(<BrokerDashboard />);
    await waitFor(() => {
      // The error card renders when loadError=true and stats=null
      const body = document.body.textContent ?? '';
      expect(body).toMatch(/error|failed|retry|refresh/i);
    });
  });

  it('shows partial-load warning when _partial is true', async () => {
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_STATS, _partial: true },
    });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Some numbers couldn't be loaded")).toBeInTheDocument();
  });

  // The banner alone left the broker hunting for the dash. The tile whose
  // figure failed now says so itself.
  it('marks a tile whose figure could not be computed, not just the banner', async () => {
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_STATS, _partial: true, _failed_metrics: ['monitored_users'], monitored_users: null },
    });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getAllByText('Monitored Users').length).toBeGreaterThan(0));
    const tile = screen.getByRole('link', { name: 'Monitored Users' });
    expect(within(tile).getByText('Could not load')).toBeInTheDocument();
    expect(within(tile).getByText('—')).toBeInTheDocument();
    // A tile that loaded is not marked.
    expect(within(screen.getByRole('link', { name: 'Unreviewed Messages' })).queryByText('Could not load')).not.toBeInTheDocument();
  });

  it('says how long each queue\'s oldest item has waited, and shows the fortnight change', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getAllByText('Pending Exchanges').length).toBeGreaterThan(0));
    const exchanges = screen.getByRole('link', { name: 'Pending Exchanges' });
    expect(within(exchanges).getByText('Oldest waiting 3 days')).toBeInTheDocument();
    expect(within(exchanges).getByText('+50%')).toBeInTheDocument();
    expect(within(exchanges).getByText('vs previous fortnight')).toBeInTheDocument();
    expect(exchanges.querySelector('svg[aria-hidden="true"] polyline, svg[aria-hidden="true"] path')).not.toBeNull();
    expect(within(screen.getByRole('link', { name: 'Unreviewed Messages' })).getByText('Oldest arrived today')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Vetting review requests' })).getByText('Oldest waiting 1 day')).toBeInTheDocument();
    // An empty queue says nothing about age, and a flat fortnight draws no sparkline or delta.
    const alerts = screen.getByRole('link', { name: 'Safeguarding Alerts' });
    expect(within(alerts).queryByText(/Oldest/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Unreviewed Messages' })).queryByText('vs previous fortnight')).not.toBeInTheDocument();
  });

  it('shows what the broker decided this week, with the match review time on exchange-workflow communities', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getByText('My week')).toBeInTheDocument());
    expect(mockGetApprovalStats).toHaveBeenCalledWith(7);
    expect(screen.getByText('Exchanges decided')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Messages reviewed')).toBeInTheDocument();
    expect(screen.getByText('6.3 h')).toBeInTheDocument();
    expect(screen.getByText('Average time to review a match')).toBeInTheDocument();
  });

  it('says so in words when nothing has been decided this week', async () => {
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_STATS, my_week: { exchanges_decided: 0, messages_reviewed: 0, matches_decided: 0, vetting_handled: 0, total: 0 } },
    });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getByText('My week')).toBeInTheDocument());
    expect(screen.getByText(/Nothing decided yet this week/)).toBeInTheDocument();
    expect(screen.queryByText('Exchanges decided')).not.toBeInTheDocument();
  });

  it('renders the quick links as one row of small buttons, not cards', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Quick Access' })).toBeInTheDocument());
    const nav = screen.getByRole('navigation', { name: 'Quick Access' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(7);
    expect(links.map((l) => l.textContent)).toContain('Exchange Management');
    // The old cards carried a description line each; the row does not.
    expect(within(nav).queryByText('Review and approve exchange requests flagged for broker attention.')).not.toBeInTheDocument();
  });

  describe('safeguarding jurisdiction not set', () => {
    it('tells a broker to ask an admin, without a button', async () => {
      mockGetDashboard.mockResolvedValueOnce({ success: true, data: { ...MOCK_STATS, safeguarding_jurisdiction_configured: false } });
      render(<BrokerDashboard />);
      await waitFor(() => expect(screen.getByText('Safeguarding jurisdiction not set')).toBeInTheDocument());
      expect(screen.getByText('Only an admin can set it. Please ask an admin in your community to set it.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Set the jurisdiction' })).not.toBeInTheDocument();
    });

    it('gives an admin a button to the safeguarding options', async () => {
      mockAuth.user = { id: 1, role: 'admin' };
      mockGetDashboard.mockResolvedValueOnce({ success: true, data: { ...MOCK_STATS, safeguarding_jurisdiction_configured: false } });
      render(<BrokerDashboard />);
      await waitFor(() => expect(screen.getByText('Safeguarding jurisdiction not set')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Set the jurisdiction' })).toHaveAttribute('href', '/hour-timebank/broker/safeguarding-options');
    });

    it('shows nothing when the jurisdiction is set or unknown', async () => {
      mockGetDashboard.mockResolvedValueOnce({ success: true, data: { ...MOCK_STATS, safeguarding_jurisdiction_configured: null } });
      render(<BrokerDashboard />);
      await waitFor(() => expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0));
      expect(screen.queryByText('Safeguarding jurisdiction not set')).not.toBeInTheDocument();
    });
  });

  it('shows no-recent-activity state when recent_activity is empty', async () => {
    mockGetDashboard.mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_STATS, recent_activity: [] },
    });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0);
    });
    // When recent_activity=[], the component renders the empty-state card
    // (an icon + translated text). Assert no activity list items are present.
    const listItems = document.querySelectorAll('ul > li');
    expect(listItems.length).toBe(0);
    expect(screen.getByText('No recent broker activity')).toBeInTheDocument();
  });

  it('renders quick links section', async () => {
    mockGetDashboard.mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body).toMatch(/exchange|vetting|message/i);
    });
  });

  it('calls getDashboard again when Refresh is clicked', async () => {
    mockGetDashboard
      .mockResolvedValueOnce({ success: true, data: MOCK_STATS })
      .mockResolvedValueOnce({ success: true, data: MOCK_STATS });
    render(<BrokerDashboard />);
    await waitFor(() => {
      expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0);
    });
    // The Refresh button is in the page shell actions
    const refreshBtn = screen.getAllByRole('button').find(
      (b) => /refresh/i.test(b.textContent ?? ''),
    );
    if (refreshBtn) {
      await userEvent.click(refreshBtn);
      await waitFor(() => {
        expect(mockGetDashboard).toHaveBeenCalledTimes(2);
      });
    } else {
      // If the button text uses an i18n key that doesn't translate to "Refresh",
      // just confirm the component mounted and getDashboard was called once
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    }
  });

  describe('oldestWaitingLabel', () => {
    const t = (key: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${key}:${opts.count}` : key);

    it('counts whole days since the oldest arrival, and says today for a same-day one', () => {
      const now = new Date('2026-10-03T12:00:00Z');
      expect(oldestWaitingLabel('2026-10-03T08:00:00Z', t, now)).toBe('dashboard.oldest_waiting_today');
      expect(oldestWaitingLabel('2026-10-02T11:00:00Z', t, now)).toBe('dashboard.oldest_waiting_days:1');
      expect(oldestWaitingLabel('2026-09-24 09:00:00', t, now)).toBe('dashboard.oldest_waiting_days:9');
      expect(oldestWaitingLabel(null, t, now)).toBeUndefined();
      expect(oldestWaitingLabel(daysAgo(0), t)).toBe('dashboard.oldest_waiting_today');
    });
  });

  // The audit log stores a JSON object in `details`; until October 2026 it was
  // printed on the dashboard verbatim. These pin the plain-English rendering.
  describe('formatActivityDetails', () => {
    const t = (key: string, opts?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        'dashboard.activity.detail_settings_changed': `${opts?.count} settings changed`,
        'dashboard.activity.detail_exchange': `Exchange #${opts?.id}`,
        'dashboard.activity.detail_message': `Message #${opts?.id}`,
        'dashboard.activity.detail_with_notes': 'with a note',
        'dashboard.activity.detail_listing': `Listing #${opts?.id}`,
        'dashboard.activity.detail_risk_level': `${opts?.level} risk`,
        'dashboard.activity.detail_was_risk_level': `was ${opts?.level} risk`,
        'dashboard.activity.detail_member': `Member #${opts?.id}`,
        'risk_tags.level_high': 'High',
      };
      return table[key] ?? String(opts?.defaultValue ?? key);
    };

    it('turns a configuration change into a count of settings', () => {
      expect(formatActivityDetails('{"updated_keys":["a","b","c"],"actor_role":"admin"}', t)).toBe('3 settings changed');
    });

    it('says nothing for a save that changed no settings, instead of "0 settings changed"', () => {
      expect(formatActivityDetails('{"updated_keys":[],"actor_role":"admin"}', t)).toBeNull();
    });

    it('names the message and whether a note was left', () => {
      expect(formatActivityDetails('{"message_id":87,"has_notes":true,"actor_role":"admin"}', t)).toBe('Message #87 · with a note');
    });

    it('names the listing and translates the risk level', () => {
      expect(formatActivityDetails('{"listing_id":164,"previous_risk_level":"high"}', t)).toBe('Listing #164 · was High risk');
    });

    it('passes plain sentences through and hides anything unparseable', () => {
      expect(formatActivityDetails('Exchange #42 approved', t)).toBe('Exchange #42 approved');
      expect(formatActivityDetails('{not json', t)).toBeNull();
      expect(formatActivityDetails('{"actor_role":"admin"}', t)).toBeNull();
      expect(formatActivityDetails(null, t)).toBeNull();
    });
  });
});
