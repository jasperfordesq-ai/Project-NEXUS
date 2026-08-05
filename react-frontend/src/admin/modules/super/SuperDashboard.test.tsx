// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

// Swapped per test so one render can be the platform owner and the next the
// super-admin of a branch community.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: mockUser.current,
      isAuthenticated: mockUser.current !== null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 1, name: 'Master', slug: 'master' },
      tenantPath: (p: string) => `/master${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ── Mock adminSuper API ───────────────────────────────────────────────────────
const { mockGetDashboard, mockListTenants } = vi.hoisted(() => ({
  mockGetDashboard: vi.fn(),
  mockListTenants: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminSuper: {
    getDashboard: mockGetDashboard,
    listTenants: mockListTenants,
  },
  adminSystem: { getActivityLog: vi.fn() },
  adminEnterprise: { getLogFiles: vi.fn(), getGdprBreaches: vi.fn(), createBreach: vi.fn() },
  adminTools: { getRedirects: vi.fn(), createRedirect: vi.fn(), deleteRedirect: vi.fn() },
}));

import { SuperDashboard } from './SuperDashboard';

const MOCK_STATS = {
  total_tenants: 5,
  active_tenants: 4,
  total_users: 1200,
  total_listings: 340,
};

const MOCK_TENANTS = [
  { id: 1, name: 'hOUR Timebank', slug: 'hour-timebank', domain: 'hour-timebank.ie', is_active: true, user_count: 200, allows_subtenants: false },
  { id: 2, name: 'Coventry TBank', slug: 'coventry', domain: null, is_active: false, user_count: 50, allows_subtenants: true },
];

describe('SuperDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 1, super_panel_level: 'master', is_super_admin: true };
    mockGetDashboard.mockResolvedValue({ success: true, data: MOCK_STATS });
    mockListTenants.mockResolvedValue({ success: true, data: MOCK_TENANTS });
  });

  /*
   * 🔴 Tier-B controls must not be offered to a branch super-admin.
   *
   * Federation Controls is platform-only: `/admin/super/federation/*` sits behind
   * `EnsureIsSuperAdmin` and answers 403 to a `regional` caller — confirmed by
   * hand against a running server on 2026-08-05, where the card was rendered and
   * would have led straight to a refusal. A panel that offers a control the API
   * refuses is worse than one that omits it, because the user cannot tell whether
   * they lack permission or the platform is broken.
   */
  describe('tier-B controls by panel level', () => {
    it('offers Federation Controls to the platform owner', async () => {
      mockUser.current = { id: 1, super_panel_level: 'master', is_super_admin: true };
      render(<SuperDashboard />);
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /federation/i })).toBeInTheDocument();
      });
    });

    it('hides Federation Controls from the super-admin of a branch', async () => {
      mockUser.current = { id: 2, super_panel_level: 'regional', is_tenant_super_admin: true };
      render(<SuperDashboard />);
      // Wait for load to finish so absence is not merely "not rendered yet".
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /hierarchy/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('link', { name: /federation/i })).not.toBeInTheDocument();
    });

    it('does not describe a branch view as platform-wide', async () => {
      mockUser.current = { id: 2, super_panel_level: 'regional', is_tenant_super_admin: true };
      render(<SuperDashboard />);
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /hierarchy/i })).toBeInTheDocument();
      });
      expect(screen.queryByText(/platform-wide/i)).not.toBeInTheDocument();
    });
  });

  // ── loading ────────────────────────────────────────────────────────────────
  it('shows loading spinner while fetching', () => {
    mockGetDashboard.mockReturnValue(new Promise(() => {}));
    mockListTenants.mockReturnValue(new Promise(() => {}));
    render(<SuperDashboard />);
    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  // ── populated ──────────────────────────────────────────────────────────────
  it('hides spinner and shows tenant cards after load', async () => {
    render(<SuperDashboard />);
    await waitFor(() => {
      const statuses = screen.queryAllByRole('status');
      const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
    expect(screen.getByText('hOUR Timebank')).toBeInTheDocument();
    expect(screen.getByText('Coventry TBank')).toBeInTheDocument();
  });

  it('shows stat values from the dashboard response', async () => {
    render(<SuperDashboard />);
    await waitFor(() => screen.getByText('hOUR Timebank'));
    // Stats shown via StatCard — values go through toLocaleString() so 1200 → "1,200"
    expect(screen.getByText('5')).toBeInTheDocument();    // total_tenants
    expect(screen.getByText('4')).toBeInTheDocument();    // active_tenants
    // total_users 1200 may render as "1,200" depending on locale; match either
    expect(screen.getByText(/^1[,.]?200$/)).toBeInTheDocument();
  });

  it('shows "View all tenants" link when tenants are present', async () => {
    render(<SuperDashboard />);
    await waitFor(() => screen.getByText('hOUR Timebank'));
    // The "View all tenants" element is a Button as={Link} → renders as <a> (role=link)
    // or it may fall back to button depending on HeroUI version; check both
    const viewAllEl =
      screen.queryByText(/view all tenants/i) ??
      screen.queryByText(/super\.view_all_tenants/i);
    // At minimum, the element exists somewhere in the tree
    expect(viewAllEl).toBeInTheDocument();
  });

  // ── empty tenants ──────────────────────────────────────────────────────────
  it('shows empty tenants state when list is empty', async () => {
    mockListTenants.mockResolvedValue({ success: true, data: [] });
    render(<SuperDashboard />);
    await waitFor(() => {
      const statuses = screen.queryAllByRole('status');
      const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
    expect(screen.queryByText('hOUR Timebank')).not.toBeInTheDocument();
  });

  // ── error state ────────────────────────────────────────────────────────────
  it('calls toast.error when dashboard API fails', async () => {
    mockGetDashboard.mockResolvedValue({ success: false, error: 'Forbidden' });
    mockListTenants.mockResolvedValue({ success: true, data: [] });
    render(<SuperDashboard />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls toast.error when both APIs throw', async () => {
    mockGetDashboard.mockRejectedValue(new Error('Network'));
    mockListTenants.mockRejectedValue(new Error('Network'));
    render(<SuperDashboard />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────
  it('re-fetches on refresh button click', async () => {
    const user = userEvent.setup();
    render(<SuperDashboard />);
    await waitFor(() => screen.getByText('hOUR Timebank'));

    mockGetDashboard.mockResolvedValue({ success: true, data: MOCK_STATS });
    mockListTenants.mockResolvedValue({ success: true, data: MOCK_TENANTS });

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);
    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(2);
    });
  });

  // ── quick actions ──────────────────────────────────────────────────────────
  it('renders the quick actions section heading', async () => {
    render(<SuperDashboard />);
    await waitFor(() => screen.getByText('hOUR Timebank'));
    // Quick actions are Button as={Link} → rendered as <a> elements in DOM.
    // At minimum a heading or label for the section should be present.
    // The i18n key 'super.quick_actions' resolves to "Quick Actions" in test env.
    const heading = screen.queryByText(/quick actions/i) ?? screen.queryByText(/super\.quick_actions/i);
    expect(heading).toBeInTheDocument();
  });
});
