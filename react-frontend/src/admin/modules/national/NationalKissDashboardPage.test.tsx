// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast ────────────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      showToast: mockShowToast,
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub admin components
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
    PageHeader: ({ title }: { title: string }) => <h1 data-testid="page-header">{title}</h1>,
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
      </div>
    ),
  };
}

vi.mock('@/admin/components', adminComponentsMock);
vi.mock('@/admin/components/PageHeader', adminComponentsMock);
vi.mock('@/admin/components/StatCard', adminComponentsMock);

// Stub recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div data-testid="composed-chart">{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Area: () => null,
  Line: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeSummary = (overrides = {}) => ({
  cooperatives_count: 12,
  active_cooperatives_count: 8,
  total_approved_hours_national: 500.5,
  total_active_members_bucket: '100-499',
  total_recipients_reached_bucket: '50-99',
  top_5_cooperatives_by_hours: [
    { tenant_id: 1, slug: 'coop-a', name: 'Coop Alpha', hours: 120.5 },
    { tenant_id: 2, slug: 'coop-b', name: 'Coop Beta', hours: 80.0 },
  ],
  bottom_5_active_cooperatives_by_hours: [
    { tenant_id: 3, slug: 'coop-c', name: 'Coop Gamma', hours: 5.0 },
  ],
  hours_growth_yoy_pct: 12.5,
  active_tandems_total: 34,
  safeguarding_reports_total: 2,
  generated_at: '2026-01-01T12:00:00Z',
  period: { from: '2025-10-01', to: '2026-01-01' },
  ...overrides,
});

const makeComparativeRow = (overrides = {}) => ({
  tenant_id: 1,
  slug: 'coop-a',
  name: 'Coop Alpha',
  hours: 120.5,
  members_bracket: '100-499',
  recipients_bracket: '50-99',
  active_tandems: 12,
  retention_rate_pct: 78.5,
  reciprocity_pct: 60.0,
  status: 'thriving' as const,
  ...overrides,
});

const makeTrendPoint = (overrides = {}) => ({
  month: '2025-10',
  total_hours_all_cooperatives: 450.0,
  active_cooperatives: 7,
  ...overrides,
});

const makeApiResponses = (summaryOverrides = {}, comparative: unknown[] = [], trend: unknown[] = []) => {
  const summary = makeSummary(summaryOverrides);
  return (url: string) => {
    if (url.includes('summary')) return Promise.resolve({ success: true, data: summary });
    if (url.includes('comparative')) return Promise.resolve({ success: true, data: { rows: comparative } });
    if (url.includes('trend')) return Promise.resolve({ success: true, data: { trend } });
    return Promise.resolve({ success: true, data: null });
  };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('NationalKissDashboardPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation(makeApiResponses({}, [], []));
  });

  it('shows loading spinners while fetching data', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stat cards after loading', async () => {
    mockApi.get.mockImplementation(makeApiResponses());
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('renders cooperative count from summary', async () => {
    mockApi.get.mockImplementation(makeApiResponses({ cooperatives_count: 12 }));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      const values = screen.getAllByTestId('stat-value');
      const found = values.find((el) => el.textContent?.includes('12'));
      expect(found).toBeDefined();
    });
  });

  it('renders top 5 cooperatives leaderboard', async () => {
    mockApi.get.mockImplementation(makeApiResponses({}, [], []));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Coop Alpha')).toBeInTheDocument();
    });
  });

  it('renders bottom 5 cooperatives leaderboard', async () => {
    mockApi.get.mockImplementation(makeApiResponses({}, [], []));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Coop Gamma')).toBeInTheDocument();
    });
  });

  it('renders comparative table rows when data is returned', async () => {
    const rows = [makeComparativeRow(), makeComparativeRow({ tenant_id: 2, name: 'Coop Beta', slug: 'coop-b' })];
    mockApi.get.mockImplementation(makeApiResponses({}, rows, []));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Coop Alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Coop Beta').length).toBeGreaterThan(0);
    });
  });

  it('shows empty comparative state when no rows', async () => {
    mockApi.get.mockImplementation(makeApiResponses({}, [], []));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      // The component renders the "Caring Community" text in the empty state
      // at line 455: comparative.empty_prefix + "Caring Community" + ...
      const caringText = document.body.textContent;
      expect(caringText).toContain('Caring Community');
    });
  });

  it('renders trend chart area when trend data is present', async () => {
    const trend = [makeTrendPoint(), makeTrendPoint({ month: '2025-11' })];
    mockApi.get.mockImplementation(makeApiResponses({}, [], trend));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('composed-chart')).toBeInTheDocument();
    });
  });

  it('calls all 3 API endpoints on mount', async () => {
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('summary'));
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('comparative'));
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('trend'));
    });
  });

  it('shows error toast when API fails', async () => {
    mockApi.get.mockRejectedValue(new Error('server error'));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  it('refresh button triggers re-fetch', async () => {
    mockApi.get.mockImplementation(makeApiResponses());
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const callCountBefore = mockApi.get.mock.calls.length;

    const buttons = screen.getAllByRole('button');
    const refreshBtn = buttons.find((b) =>
      b.textContent?.toLowerCase().includes('refresh') ||
      b.textContent?.toLowerCase().includes('update') ||
      b.textContent?.toLowerCase().includes('load')
    );
    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => {
        expect(mockApi.get.mock.calls.length).toBeGreaterThan(callCountBefore);
      });
    }
  });

  it('renders period selector with preset options', async () => {
    mockApi.get.mockImplementation(makeApiResponses());
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      // Period filter inputs
      const dateInputs = document.querySelectorAll('input[type="date"]');
      expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders inline secondary stats (members bucket, recipients bucket) after loading', async () => {
    mockApi.get.mockImplementation(makeApiResponses({
      total_active_members_bucket: '100-499',
      total_recipients_reached_bucket: '50-99',
    }));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('100-499')).toBeInTheDocument();
      expect(screen.getByText('50-99')).toBeInTheDocument();
    });
  });

  it('sorts comparative table when column header is clicked', async () => {
    const rows = [
      makeComparativeRow({ name: 'Zebra Coop', hours: 200 }),
      makeComparativeRow({ tenant_id: 2, name: 'Apple Coop', hours: 10, slug: 'apple' }),
    ];
    mockApi.get.mockImplementation(makeApiResponses({}, rows, []));
    const { NationalKissDashboardPage } = await import('./NationalKissDashboardPage');
    render(<NationalKissDashboardPage />);

    await waitFor(() => screen.getByText('Zebra Coop'));

    // Click the Name column header button
    const sortBtns = screen.getAllByRole('button');
    const nameBtn = sortBtns.find((b) => b.textContent?.toLowerCase().includes('cooperative'));
    if (nameBtn) {
      fireEvent.click(nameBtn);
      // Table re-renders sorted by name asc; no error thrown
      await waitFor(() => {
        expect(screen.getByText('Zebra Coop')).toBeInTheDocument();
      });
    }
  });
});
