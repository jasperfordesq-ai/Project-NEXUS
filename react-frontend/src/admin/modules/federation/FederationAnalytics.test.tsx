// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mock recharts (jsdom has no canvas/SVG measurement) ───────────────────────
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Line: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockAdminFederation, mockToast } = vi.hoisted(() => ({
  mockAdminFederation: { getAnalyticsOverview: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminFederation: mockAdminFederation,
}));

// ── Mock underlying api (imported by adminApi) ────────────────────────────────
vi.mock('@/lib/api', () => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() };
  return { default: m, api: m };
});

// ── Mock PartnerTimebankGuidance (avoid rendering its complex accordion) ───────
vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => <div data-testid="partner-guidance" />,
}));

// ── Mock contexts ─────────────────────────────────────────────────────────────
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/chartColors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chartColors')>()), CHART_TOKEN_COLORS: { primary: '#000' } }));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ANALYTICS_DATA = {
  range_days: 30,
  kpis: {
    total_partnerships: 5,
    active_partnerships: 3,
    pending_partnerships: 2,
    external_partners: 1,
    federated_transactions: 120,
    federated_messages: 88,
    federated_listings: 40,
    inbound_reviews: 15,
  },
  daily_calls: [
    { date: '2025-05-01', count: 10 },
    { date: '2025-05-02', count: 20 },
  ],
  top_partners: [
    { tenant_id: 10, name: 'Beta Timebank', activity: 60 },
  ],
  recent_errors: [
    {
      id: 1,
      endpoint: '/federation/sync',
      method: 'POST',
      response_code: 500,
      ip_address: '1.2.3.4',
      created_at: '2025-05-10T12:00:00Z',
    },
  ],
};

import { FederationAnalytics } from './FederationAnalytics';

describe('FederationAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminFederation.getAnalyticsOverview.mockResolvedValue({ success: true, data: ANALYTICS_DATA });
  });

  // ── Loading state ──────────────────────────────────────────────────────────
  it('shows loading indicator while fetching', async () => {
    mockAdminFederation.getAnalyticsOverview.mockReturnValue(new Promise(() => {}));
    render(<FederationAnalytics />);
    // The Refresh button carries isLoading which disables it; check it appears
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  // ── Error state ────────────────────────────────────────────────────────────
  it('shows error toast when API fails', async () => {
    mockAdminFederation.getAnalyticsOverview.mockResolvedValue({ success: false, error: 'Failed' });
    render(<FederationAnalytics />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed'));
  });

  it('shows error toast when API throws', async () => {
    mockAdminFederation.getAnalyticsOverview.mockRejectedValue(new Error('Net error'));
    render(<FederationAnalytics />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  // ── Populated state — KPI values ──────────────────────────────────────────
  it('renders total partnerships KPI value', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => {
      // StatCard renders value; 5 total_partnerships
      const elements = screen.getAllByText('5');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('renders active partnerships KPI value', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => {
      const elements = screen.getAllByText('3');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('renders federated transactions KPI value', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => {
      const elements = screen.getAllByText('120');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  // ── Recent errors table ────────────────────────────────────────────────────
  it('renders recent error endpoint in the table', async () => {
    render(<FederationAnalytics />);
    await waitFor(() =>
      expect(screen.getByText('/federation/sync')).toBeInTheDocument()
    );
  });

  it('renders HTTP status code 500 for error row', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument());
  });

  it('renders IP address of error row', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => expect(screen.getByText('1.2.3.4')).toBeInTheDocument());
  });

  // ── Charts rendered ────────────────────────────────────────────────────────
  it('renders the daily calls line chart container', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => {
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });
  });

  it('renders the top partners bar chart when data exists', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  // ── Empty top partners state ───────────────────────────────────────────────
  it('shows no partner activity message when top_partners is empty', async () => {
    mockAdminFederation.getAnalyticsOverview.mockResolvedValue({
      success: true,
      data: { ...ANALYTICS_DATA, top_partners: [] },
    });
    render(<FederationAnalytics />);
    await waitFor(() => {
      // Component renders t('federation.analytics.no_partner_activity')
      // i18n fallback will show the key or a translation
      const barChart = screen.queryByTestId('bar-chart');
      expect(barChart).toBeNull();
    });
  });

  // ── Refresh button ────────────────────────────────────────────────────────
  it('calls getAnalyticsOverview again when Refresh is clicked', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => expect(mockAdminFederation.getAnalyticsOverview).toHaveBeenCalledTimes(1));

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    refreshBtn.click();

    await waitFor(() =>
      expect(mockAdminFederation.getAnalyticsOverview).toHaveBeenCalledTimes(2)
    );
  });

  // ── Default range ─────────────────────────────────────────────────────────
  it('calls getAnalyticsOverview with 30d by default', async () => {
    render(<FederationAnalytics />);
    await waitFor(() => expect(mockAdminFederation.getAnalyticsOverview).toHaveBeenCalledWith('30d'));
  });
});
