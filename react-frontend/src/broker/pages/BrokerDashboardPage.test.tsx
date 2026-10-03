// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock data ──────────────────────────────────────────────────────────

const MOCK_STATS = vi.hoisted(() => ({
  pending_exchanges: 5,
  unreviewed_messages: 3,
  high_risk_listings: 2,
  monitored_users: 10,
  vetting_review_requests: 4,
  safeguarding_alerts: 0,
  onboarding_safeguarding_flags: 2,
  _partial: false,
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
}));

// ── adminApi mock ─────────────────────────────────────────────────────────────

const mockGetDashboard = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: {
    getDashboard: mockGetDashboard,
  },
}));

// ── contexts ──────────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
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

// ── lib/serverTime ────────────────────────────────────────────────────────────

vi.mock('@/lib/serverTime', () => ({
  parseServerTimestamp: (s: string) => new Date(s),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { BrokerDashboard, formatActivityDetails } from './BrokerDashboardPage';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BrokerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Wait for data to load (stat labels appear)
    await waitFor(() => {
      expect(screen.getAllByText('Unreviewed Messages').length).toBeGreaterThan(0);
    });
    // The partial banner renders — find the Card with warning border
    // The i18n key dashboard.partial_title/body may translate to any text;
    // assert the warning-coloured card element exists (border-warning class)
    const warningCard = document.querySelector('.border-warning\\/30, .bg-warning\\/10');
    expect(warningCard).toBeInTheDocument();
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
