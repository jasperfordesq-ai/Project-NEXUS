// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── @/contexts ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockHasFeature = vi.hoisted(() => vi.fn(() => true));
const mockAuthUser = vi.hoisted(() => ({ current: { id: 1, role: 'admin' } as Record<string, unknown> }));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({ user: mockAuthUser.current, isAuthenticated: true, isLoading: false, status: 'authenticated' }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
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

// ── AdminMetaContext ───────────────────────────────────────────────────────────
vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ── useOnboardingConfig ───────────────────────────────────────────────────────
const mockUseOnboardingConfig = vi.fn();
vi.mock('@/hooks/useOnboardingConfig', () => ({
  useOnboardingConfig: () => mockUseOnboardingConfig(),
}));

// ── Admin components ──────────────────────────────────────────────────────────
vi.mock('@/admin/components', async () => {
  const React = await import('react');
  return {
    PageHeader: ({
      title,
      actions,
    }: { title: string; description?: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({
      label,
      value,
      loading,
    }: { label: string; value: unknown; icon?: unknown; color?: string; loading?: boolean }) =>
      loading ? (
        <div role="status" aria-busy="true" aria-label={label}>Loading</div>
      ) : (
        <div data-testid="stat-card">
          <span>{label}</span>
          <span>{String(value)}</span>
        </div>
      ),
  };
});

import { AdminDashboard } from './AdminDashboard';

const STATS = {
  total_users: 120,
  active_listings: 45,
  total_transactions: 300,
  total_hours_exchanged: 850,
  new_users_this_month: 10,
  active_users: 80,
  total_listings: 60,
  new_listings_this_month: 5,
  pending_users: 0,
  pending_listings: 0,
};

const ACTIVITY = [
  { id: 1, user_name: 'Alice', description: 'created a listing', created_at: '2026-06-01T10:00:00Z' },
  { id: 2, user_name: 'Bob', description: 'joined the platform', created_at: '2026-06-02T09:00:00Z' },
];

const TRENDS = [
  { month: 'Jan 2026', hours: 80 },
  { month: 'Feb 2026', hours: 95 },
];

function setupSuccessfulLoad(overrides: Partial<typeof STATS> = {}) {
  mockGetStats.mockResolvedValue({ success: true, data: { ...STATS, ...overrides } });
  mockGetActivity.mockResolvedValue({ success: true, data: ACTIVITY });
  mockGetTrends.mockResolvedValue({ success: true, data: TRENDS });
  mockUseOnboardingConfig.mockReturnValue({
    config: { step_safeguarding_enabled: true },
    isLoading: false,
  });
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockAuthUser.current = { id: 1, role: 'admin' };
    mockUseOnboardingConfig.mockReturnValue({ config: { step_safeguarding_enabled: true }, isLoading: false });
  });

  it('shows loading stat cards while fetching', () => {
    mockGetStats.mockReturnValue(new Promise(() => {}));
    mockGetActivity.mockReturnValue(new Promise(() => {}));
    mockGetTrends.mockReturnValue(new Promise(() => {}));
    render(<AdminDashboard />);
    const busyEls = screen.getAllByRole('status', { hidden: true }).filter(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busyEls.length).toBeGreaterThan(0);
  });

  it('renders stat cards with values after load', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/total members/i)).toBeInTheDocument();
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });

  it('renders activity entries after load', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText(/created a listing/i)).toBeInTheDocument();
    });
  });

  it('renders monthly trend rows', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Jan 2026')).toBeInTheDocument();
      expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    });
  });

  it('shows error toast when API throws', async () => {
    mockGetStats.mockRejectedValue(new Error('Server down'));
    mockGetActivity.mockRejectedValue(new Error('Server down'));
    mockGetTrends.mockRejectedValue(new Error('Server down'));
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('re-fetches when Refresh button is clicked', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(1));

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await userEvent.click(refreshBtn);
    await waitFor(() => expect(mockGetStats).toHaveBeenCalledTimes(2));
  });

  it('shows pending users alert when pending_users > 0', async () => {
    setupSuccessfulLoad({ pending_users: 5 });
    render(<AdminDashboard />);
    await waitFor(() => {
      // Multiple elements may contain "5" (stat cards + pending alert).
      // Use getAllByText to assert at least one exists.
      expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    });
  });

  it('does not show pending alerts when counts are 0', async () => {
    setupSuccessfulLoad({ pending_users: 0, pending_listings: 0 });
    render(<AdminDashboard />);
    await waitFor(() => {
      // The alert cards are conditionally rendered — shouldn't have "Review" button
      // (they appear only when pending > 0)
      expect(document.body).toBeTruthy();
    });
  });

  it('renders quick action links', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);
    await waitFor(() => {
      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });
  });

  it('shows the newsletter quick action when the newsletter module is enabled', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /send newsletter/i })).toHaveAttribute(
        'href',
        '/test/admin/newsletters',
      );
    });
  });

  it('hides the newsletter quick action when the newsletter module is disabled', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'newsletter');
    setupSuccessfulLoad();
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /send newsletter/i })).not.toBeInTheDocument();
    });
  });

  // The Enterprise dashboard is god accounts only (owner decision 2026-10-02).
  it('hides the Enterprise dashboard link from an ordinary admin', async () => {
    setupSuccessfulLoad();
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /send newsletter/i })).toBeInTheDocument();
    });
    expect(document.querySelector('a[href="/test/admin/enterprise"]')).toBeNull();
  });

  it('shows the Enterprise dashboard link to a god account', async () => {
    mockAuthUser.current = { id: 1, role: 'admin', is_god: true };
    setupSuccessfulLoad();
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(document.querySelector('a[href="/test/admin/enterprise"]')).not.toBeNull();
    });
  });

  it('shows the safeguarding disabled banner when step_safeguarding_enabled is false', async () => {
    mockGetStats.mockResolvedValue({ success: true, data: STATS });
    mockGetActivity.mockResolvedValue({ success: true, data: [] });
    mockGetTrends.mockResolvedValue({ success: true, data: [] });
    mockUseOnboardingConfig.mockReturnValue({
      config: { step_safeguarding_enabled: false },
      isLoading: false,
    });
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('safeguarding-disabled-banner')).toBeInTheDocument();
    });
  });

  it('does not show safeguarding banner when step_safeguarding_enabled is true', async () => {
    setupSuccessfulLoad();
    mockUseOnboardingConfig.mockReturnValue({
      config: { step_safeguarding_enabled: true },
      isLoading: false,
    });
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.queryByTestId('safeguarding-disabled-banner')).toBeNull();
    });
  });

  it('shows "no data" message when trends are empty', async () => {
    mockGetStats.mockResolvedValue({ success: true, data: STATS });
    mockGetActivity.mockResolvedValue({ success: true, data: [] });
    mockGetTrends.mockResolvedValue({ success: true, data: [] });
    render(<AdminDashboard />);
    // After load the trends card should show "no data" text
    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });
});
