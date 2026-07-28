// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminNewsletters } = vi.hoisted(() => ({
  mockAdminNewsletters: {
    getAnalytics: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminNewsletters: mockAdminNewsletters,
  default: { adminNewsletters: mockAdminNewsletters },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast ────────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// chartColors stub
vi.mock('@/lib/chartColors', () => ({
  CHART_TOKEN_COLORS: {
    accent: '#6366f1',
    warning: '#f59e0b',
    success: '#10b981',
    border: '#e5e7eb',
    surface: '#fff',
  },
}));

// Stub recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// Stub admin shared components
// Bound to the barrel AND to each component's own path: the page under test
// imports '@/admin/components/PageHeader' and '@/admin/components/StatCard'
// (as relative '../../components/...', which resolves to the same modules)
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({
      label,
      value,
      loading,
    }: {
      label: string;
      value: string | number;
      loading?: boolean;
      [key: string]: unknown;
    }) => (
      <div data-testid="stat-card">
        <span data-testid="stat-label">{label}</span>
        {!loading && <span data-testid="stat-value">{value}</span>}
        {loading && <span data-testid="stat-loading">…</span>}
      </div>
    ),
  };
}

vi.mock('@/admin/components', adminComponentsMock);
vi.mock('@/admin/components/PageHeader', adminComponentsMock);
vi.mock('@/admin/components/StatCard', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeAnalytics = (overrides: Record<string, unknown> = {}) => ({
  total_newsletters: 10,
  total_sent: 5000,
  avg_open_rate: 22.5,
  avg_click_rate: 3.1,
  total_subscribers: 1200,
  totals: {
    newsletters_sent: 10,
    total_sent: 5000,
    total_failed: 20,
    total_opens: 1500,
    unique_opens: 1200,
    total_clicks: 250,
    unique_clicks: 200,
  },
  monthly_breakdown: [
    { month: '2025-10', newsletters: 3, sent: 1500, opens: 400, clicks: 60 },
    { month: '2025-11', newsletters: 4, sent: 1800, opens: 500, clicks: 80 },
    { month: '2025-12', newsletters: 3, sent: 1700, opens: 600, clicks: 110 },
  ],
  top_performers: [
    { id: 1, subject: 'October Newsletter', sent_at: '2025-10-01T10:00:00Z', total_sent: 1500, open_rate: 28.5, click_rate: 4.0 },
    { id: 2, subject: 'November Update', sent_at: '2025-11-01T10:00:00Z', total_sent: 1800, open_rate: 25.0, click_rate: 3.5 },
  ],
  ...overrides,
});

const makeRes = (data: Record<string, unknown> | null = null) => ({
  success: data !== null,
  data,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('NewsletterAnalytics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminNewsletters.getAnalytics.mockResolvedValue(makeRes(makeAnalytics()));
  });

  it('shows loading stat cards while fetching', async () => {
    mockAdminNewsletters.getAnalytics.mockImplementationOnce(() => new Promise(() => {}));
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    const loadingEls = screen.getAllByTestId('stat-loading');
    expect(loadingEls.length).toBeGreaterThan(0);
  });

  it('renders 5 stat cards after loading', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBe(5);
    });
  });

  it('displays total campaigns sent', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      const values = screen.getAllByTestId('stat-value');
      const found = values.find((el) => el.textContent === '10');
      expect(found).toBeDefined();
    });
  });

  it('displays total subscribers', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      const values = screen.getAllByTestId('stat-value');
      const found = values.find((el) => el.textContent === '1200');
      expect(found).toBeDefined();
    });
  });

  it('renders engagement summary section when totals are present', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // unique_opens is 1200
      expect(screen.getByText('1,200')).toBeInTheDocument();
    });
  });

  it('renders monthly bar chart when chart data is present', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  it('renders top performers table with subject lines', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('October Newsletter')).toBeInTheDocument();
      expect(screen.getByText('November Update')).toBeInTheDocument();
    });
  });

  it('renders rank badges (1, 2) for top 2 performers', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // RankBadge renders inline span with rank number
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('renders benchmark comparison section when has data', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // industry avg for open rate is 21.3%
      expect(screen.getByText('21.3%')).toBeInTheDocument();
    });
  });

  it('renders empty state when no data / zero newsletters', async () => {
    mockAdminNewsletters.getAnalytics.mockResolvedValue(
      makeRes(makeAnalytics({ total_newsletters: 0, totals: undefined, monthly_breakdown: [], top_performers: [] }))
    );
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // Empty state card is rendered when total_newsletters === 0
      // Source line 504: !loading && !hasData → renders empty card
      const body = document.body.textContent ?? '';
      // Should not render top performers or chart sections
      expect(body).not.toContain('October Newsletter');
    });
  });

  it('gracefully handles null response data', async () => {
    mockAdminNewsletters.getAnalytics.mockResolvedValue({ success: false, data: null });
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBe(5);
      // stat values default to 0 when data is null
      const values = screen.getAllByTestId('stat-value');
      const zeroValues = values.filter((el) => el.textContent === '0' || el.textContent === '0%');
      expect(zeroValues.length).toBeGreaterThan(0);
    });
  });

  it('handles nested data response shape (data.data unwrapping)', async () => {
    const inner = makeAnalytics();
    mockAdminNewsletters.getAnalytics.mockResolvedValue({ success: true, data: { data: inner } });
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      const values = screen.getAllByTestId('stat-value');
      const found = values.find((el) => el.textContent === '10');
      expect(found).toBeDefined();
    });
  });

  it('re-fetches data when Refresh button is clicked', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const callsBefore = mockAdminNewsletters.getAnalytics.mock.calls.length;

    const buttons = screen.getAllByRole('button');
    const refreshBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('refresh'));
    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => {
        expect(mockAdminNewsletters.getAnalytics.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    }
  });

  it('renders avg click rate in benchmark section', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // industry benchmark click rate is 2.6%
      expect(screen.getByText('2.6%')).toBeInTheDocument();
    });
  });

  it('shows failed emails stat in engagement section when total_failed > 0', async () => {
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // total_failed is 20 in fixture
      expect(screen.getByText('20')).toBeInTheDocument();
    });
  });

  it('does not crash when API throws', async () => {
    mockAdminNewsletters.getAnalytics.mockRejectedValue(new Error('Network error'));
    const { NewsletterAnalytics } = await import('./NewsletterAnalytics');
    render(<NewsletterAnalytics />);

    await waitFor(() => {
      // Component catches exception and sets data=null, renders without crash
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBe(5);
    });
  });
});
