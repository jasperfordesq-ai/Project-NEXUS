// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ---- vi.hoisted so refs are available inside vi.mock factories ----
const { mockAdminEnterprise } = vi.hoisted(() => ({
  mockAdminEnterprise: {
    getGdprDashboard: vi.fn(),
    getGdprStatistics: vi.fn(),
    getGdprTrends: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminEnterprise: mockAdminEnterprise,
}));

vi.mock('@/contexts', () => createMockContexts());

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/admin/AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { GdprDashboard } from './GdprDashboard';

const EMPTY_SUCCESS = { success: true, data: null };

const DASHBOARD_DATA = {
  success: true,
  data: { pending_requests: 5 },
};

const STATISTICS_DATA = {
  success: true,
  data: {
    compliance_score: 82,
    consent_coverage_percent: 91,
    active_breaches: 0,
    overdue_count: 0,
    requests_by_status: { completed: 12 },
    requests_by_type: { access: 3, erasure: 1 },
  },
};

const TRENDS_DATA = {
  success: true,
  data: {
    months: ['Jan', 'Feb'],
    requests: [4, 6],
    breaches: [0, 1],
    comparison: {
      this_month_requests: 6,
      last_month_requests: 4,
      this_month_completed: 5,
      last_month_completed: 3,
    },
  },
};

describe('GdprDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(EMPTY_SUCCESS);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue({ success: true, data: null });
    mockAdminEnterprise.getGdprTrends.mockResolvedValue({ success: true, data: null });
  });

  it('calls all three API endpoints on mount', async () => {
    render(<GdprDashboard />);
    await waitFor(() => {
      expect(mockAdminEnterprise.getGdprDashboard).toHaveBeenCalledTimes(1);
      expect(mockAdminEnterprise.getGdprStatistics).toHaveBeenCalledTimes(1);
      expect(mockAdminEnterprise.getGdprTrends).toHaveBeenCalledTimes(1);
    });
  });

  it('shows stat cards after data loads — compliance score ring', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue(STATISTICS_DATA);
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => {
      expect(screen.getByText('82%')).toBeInTheDocument();
    });
  });

  it('shows active breach alert when active_breaches > 0', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue({
      success: true,
      data: { ...STATISTICS_DATA.data, active_breaches: 2 },
    });
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('does not show breach alert when active_breaches is 0', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue(STATISTICS_DATA);
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => expect(screen.getByText('82%')).toBeInTheDocument());
    // ToastProvider adds a persistent empty role=alert container, so we check
    // that the breach-specific ShieldAlert banner content is NOT present.
    // The breach banner contains a "View Breaches" button.
    expect(screen.queryByRole('button', { name: /view breaches/i })).toBeNull();
  });

  it('shows overdue alert when overdue_count > 0', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue({
      success: true,
      data: { ...STATISTICS_DATA.data, overdue_count: 3 },
    });
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => {
      expect(screen.queryAllByRole('alert').length).toBeGreaterThan(0);
    });
  });

  it('renders request-type chips when statistics have types', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue(STATISTICS_DATA);
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/access.*3/i)).toBeInTheDocument();
    });
  });

  it('renders trend chart when trends are available', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue(STATISTICS_DATA);
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });
  });

  it('shows completed-this-month from the monthly figure, not the all-time total', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue(STATISTICS_DATA);
    mockAdminEnterprise.getGdprTrends.mockResolvedValue({
      ...TRENDS_DATA,
      data: { ...TRENDS_DATA.data, comparison: { ...TRENDS_DATA.data.comparison, this_month_completed: 7 } },
    });

    render(<GdprDashboard />);

    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    // 12 is the all-time completed count in requests_by_status.
    expect(screen.queryByText('12')).toBeNull();
  });

  // Until 2026-10-01 a missing figure was rendered as 0, which is how every
  // community was shown a compliance score of zero.
  it('shows "not available" rather than 0 when the statistics fail to load', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(DASHBOARD_DATA);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue({ success: false, data: null });
    mockAdminEnterprise.getGdprTrends.mockResolvedValue(TRENDS_DATA);

    render(<GdprDashboard />);

    await waitFor(() => expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('does not render chart when trends data is null', async () => {
    mockAdminEnterprise.getGdprDashboard.mockResolvedValue(EMPTY_SUCCESS);
    mockAdminEnterprise.getGdprStatistics.mockResolvedValue({ success: true, data: null });
    mockAdminEnterprise.getGdprTrends.mockResolvedValue({ success: true, data: null });

    render(<GdprDashboard />);

    await waitFor(() => {
      expect(mockAdminEnterprise.getGdprDashboard).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });
});
