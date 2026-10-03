// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoist mock fns
// ---------------------------------------------------------------------------
const mockGetDashboard = vi.hoisted(() => vi.fn());
const mockApprovalStats = vi.hoisted(() => vi.fn());
const mockInsuranceStats = vi.hoisted(() => vi.fn());
const mockRole = vi.hoisted(() => ({ value: 'broker' as 'broker' | 'admin' }));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: {
    getDashboard: mockGetDashboard,
    getMessages: vi.fn(async () => ({ success: true, data: [] })),
  },
  adminMatching: {
    getApprovalStats: mockApprovalStats,
  },
  adminInsurance: {
    stats: mockInsuranceStats,
  },
  adminUsers: {
    list: vi.fn(async () => ({ success: true, data: [] })),
  },
}));

// The palette's help search reads the guide catalogue; the shell tests do not.
vi.mock('@/pages/help/guides/useHelpGuides', () => ({
  useHelpGuides: () => ({ search: () => [] }),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Broker User', email: 'broker@test.ie', role: mockRole.value },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// The panel-wide member window is a heavy child with its own suite
// (BrokerMemberWindow.test.tsx); here it only needs to mount quietly.
vi.mock('./components/MemberDetailModal', () => ({ default: () => null }));
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  hasAdminPanelAccess: vi.fn(() => true),
}));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: vi.fn(() => null),
  };
});

// Mock react-router Outlet — renders a sentinel so we can verify the shell mounts
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet-sentinel">outlet content<input aria-label="Field" /></div>,
  };
});

import { BrokerLayout } from './BrokerLayout';
import { API_WRITE_EVENT } from '@/lib/api';

const BROKER_DASHBOARD = {
  safeguarding_alerts: 2,
  vetting_review_requests: 1,
  pending_exchanges: 5,
  unreviewed_messages: 3,
  monitored_users: 0,
  high_risk_listings: 0,
  // The members and reports badges come from the dashboard, counted by the
  // rule their pages list with (since Oct 2026).
  pending_members: 4,
  open_reports: 1,
};

describe('BrokerLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    mockRole.value = 'broker';
    mockInsuranceStats.mockResolvedValue({ success: true, data: { total: 9, pending: 1, verified: 4, expired: 0, expiring_soon: 2, pending_review: 3 } });
    mockGetDashboard.mockResolvedValue({ success: true, data: BROKER_DASHBOARD });
    mockApprovalStats.mockResolvedValue({
      success: true,
      data: { pending_count: 2, approved_count: 1, rejected_count: 0, avg_approval_time: 0, approval_rate: 100 },
    });
  });

  it('renders the layout shell (main element with id main-content)', () => {
    render(<BrokerLayout />);
    expect(document.getElementById('main-content')).toBeInTheDocument();
  });

  it('renders the Outlet inside the main content area', () => {
    render(<BrokerLayout />);
    expect(screen.getByTestId('outlet-sentinel')).toBeInTheDocument();
  });

  it('renders the skip-navigation link', () => {
    render(<BrokerLayout />);
    const skipLink = screen.getByRole('link', { name: /skip/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  it('fetches broker dashboard badges on mount', async () => {
    render(<BrokerLayout />);
    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
      expect(mockApprovalStats).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes the badges once after a burst of broker actions, but not after a presence ping', async () => {
    render(<BrokerLayout />);
    await waitFor(() => expect(mockGetDashboard).toHaveBeenCalledTimes(1));

    const write = (endpoint: string) =>
      window.dispatchEvent(new CustomEvent(API_WRITE_EVENT, { detail: { method: 'POST', endpoint } }));

    write('/v2/presence/heartbeat');
    write('/v2/admin/broker/messages/7/review');
    write('/v2/admin/broker/messages/8/review');

    await waitFor(() => expect(mockGetDashboard).toHaveBeenCalledTimes(2), { timeout: 3000 });
    // The burst folded into one refresh, and the heartbeat added none.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(mockGetDashboard).toHaveBeenCalledTimes(2);
  });

  it('renders mobile drawer with role=dialog', () => {
    render(<BrokerLayout />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
  });

  it('opens the mobile drawer when the header menu button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerLayout />);

    // The drawer starts closed (inert attribute present)
    expect(screen.getByRole('dialog')).toHaveAttribute('inert');

    // The mobile header toggle has aria-label "Toggle sidebar" (from broker.header.toggle_sidebar)
    // The desktop sidebar has aria-label "Collapse sidebar" — we want the "toggle" variant
    const toggleBtn = screen.getByRole('button', { name: /toggle sidebar/i });
    await user.click(toggleBtn);

    // After opening the drawer, inert is removed
    await waitFor(() => {
      expect(screen.getByRole('dialog')).not.toHaveAttribute('inert');
    });
  });

  describe('sidebar collapse memory', () => {
    it('starts collapsed when the broker left it collapsed last time', () => {
      window.localStorage.setItem('nexus_broker_sidebar_collapsed', 'true');
      render(<BrokerLayout />);
      expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
    });

    it('starts expanded by default and remembers a collapse', async () => {
      const user = userEvent.setup();
      render(<BrokerLayout />);
      expect(screen.queryByRole('button', { name: /expand sidebar/i })).not.toBeInTheDocument();

      // Two sidebars mount (desktop + mobile drawer); the desktop one is first.
      await user.click(screen.getAllByRole('button', { name: /collapse sidebar/i })[0]!);
      expect(window.localStorage.getItem('nexus_broker_sidebar_collapsed')).toBe('true');
      expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
    });
  });

  describe('insurance badge', () => {
    it('counts certificates expiring soon plus those awaiting review on the Insurance link', async () => {
      render(<BrokerLayout />);
      await waitFor(() => expect(mockInsuranceStats).toHaveBeenCalledTimes(1));
      const [insurance] = screen.getAllByRole('link', { name: /^Insurance/i });
      await waitFor(() => expect(insurance).toHaveTextContent('5'));
    });

    it('shows no insurance count when the stats cannot be read', async () => {
      mockInsuranceStats.mockRejectedValue(new Error('403'));
      render(<BrokerLayout />);
      await waitFor(() => expect(mockGetDashboard).toHaveBeenCalledTimes(1));
      // The other badges still arrive…
      const [members] = screen.getAllByRole('link', { name: /^Members/i });
      await waitFor(() => expect(members).toHaveTextContent('4'));
      // …and Insurance stays plain.
      const [insurance] = screen.getAllByRole('link', { name: /^Insurance/i });
      expect(insurance).not.toHaveTextContent(/\d/);
    });
  });

  describe('recent pages', () => {
    it('records a visited broker page for the command palette, without the tenant slug', async () => {
      window.history.replaceState({}, '', '/test/broker/members');
      render(<BrokerLayout />);
      await waitFor(() => {
        expect(JSON.parse(window.localStorage.getItem('nexus_broker_recent') ?? '[]')).toEqual(['/broker/members']);
      });
    });

    it('does not record the dashboard', async () => {
      window.history.replaceState({}, '', '/test/broker');
      render(<BrokerLayout />);
      await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());
      expect(window.localStorage.getItem('nexus_broker_recent')).toBeNull();
    });
  });

  describe('keyboard shortcuts', () => {
    it('opens the shortcuts list on ? when focus is not in a field', async () => {
      const user = userEvent.setup();
      render(<BrokerLayout />);
      await user.keyboard('?');
      expect(await screen.findByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
      expect(screen.getByText(/open search/i)).toBeInTheDocument();
    });

    it('leaves ? alone while typing in a field', async () => {
      const user = userEvent.setup();
      render(<BrokerLayout />);
      await user.click(screen.getByRole('textbox', { name: 'Field' }));
      await user.keyboard('?');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole('heading', { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
    });
  });

  it('handles badge fetch failure silently without crashing', async () => {
    mockGetDashboard.mockRejectedValue(new Error('403'));
    render(<BrokerLayout />);

    // Should still render layout without throwing
    await waitFor(() => {
      expect(screen.getByTestId('outlet-sentinel')).toBeInTheDocument();
    });
  });
  // The safeguarding jurisdiction notice (owner decision, 3 Oct 2026): every
  // broker-panel page shows it while the community has no jurisdiction.
  describe('safeguarding jurisdiction notice', () => {
    const NOTICE = 'Safeguarding jurisdiction not set';

    // A list page: the dashboard is the one route that carries its own card.
    beforeEach(() => {
      window.history.replaceState({}, '', '/test/broker/members');
    });

    it('leaves the dashboard to its own compact card instead of doubling up', async () => {
      window.history.replaceState({}, '', '/test/broker');
      mockGetDashboard.mockResolvedValue({ success: true, data: { ...BROKER_DASHBOARD, safeguarding_jurisdiction_configured: false } });
      render(<BrokerLayout />);
      await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it('shows nothing when the jurisdiction is set', async () => {
      mockGetDashboard.mockResolvedValue({ success: true, data: { ...BROKER_DASHBOARD, safeguarding_jurisdiction_configured: true } });
      render(<BrokerLayout />);
      await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it('shows nothing when the server could not say (null or missing)', async () => {
      mockGetDashboard.mockResolvedValue({ success: true, data: { ...BROKER_DASHBOARD, safeguarding_jurisdiction_configured: null } });
      render(<BrokerLayout />);
      await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it('tells a broker to ask an admin, with no button to the setting', async () => {
      mockGetDashboard.mockResolvedValue({ success: true, data: { ...BROKER_DASHBOARD, safeguarding_jurisdiction_configured: false } });
      render(<BrokerLayout />);

      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
      expect(screen.getByText('Brokers cannot record vetting confirmations.')).toBeInTheDocument();
      expect(screen.getByText(/Please ask an admin in your community to set it/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Set the jurisdiction/ })).toBeNull();
    });

    it('gives an admin a button to the setting', async () => {
      mockRole.value = 'admin';
      mockGetDashboard.mockResolvedValue({ success: true, data: { ...BROKER_DASHBOARD, safeguarding_jurisdiction_configured: false } });
      render(<BrokerLayout />);

      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set the jurisdiction/ })).toBeInTheDocument();
      expect(screen.queryByText(/Please ask an admin in your community to set it/)).toBeNull();
    });
  });
});
