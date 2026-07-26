// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockHasFeature = vi.fn(() => false);

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
  })
);

// The geography card lazy-loads @/components/location/LocationMap, which reads
// useTenant / useTheme from their DIRECT context paths — the '@/contexts' barrel
// mock above would not reach them, and neither context has a provider here.
// Total factories (never an importOriginal spread: TenantContext imports @/i18n,
// whose module-scope init() would clobber the synchronous English resources that
// src/test/setup.ts installs).
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: mockHasFeature,
    hasModule: vi.fn(() => true),
    mapProvider: 'openstreetmap',
  }),
  useFeature: () => false,
  useModule: () => true,
  useTenantLanguages: () => ['en'],
  useTenantDefaultLanguage: () => 'en',
  TenantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  default: {},
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    resolvedTheme: 'light' as const,
    theme: 'system' as const,
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  default: {},
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub AdminMetaContext ────────────────────────────────────────────────────
vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/chartColors', () => ({
  CHART_COLORS: ['#000'],
  CHART_COLOR_MAP: { primary: '#000', success: '#0f0' },
}));

// Stub recharts — they compute real SVG metrics, which jsdom cannot provide.
// Everything else (HeroUI Card/Table/Spinner/Button, the admin StatCard and
// PageHeader, and the real maps feature gate) renders for real.
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Bar: () => null,
  Pie: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const ANALYTICS_URL = '/v2/admin/community-analytics';
const GEOGRAPHY_URL = '/v2/admin/community-analytics/geography';

const makeAnalyticsData = () => ({
  overview: {
    total_credits_circulation: 1000,
    transaction_volume_30d: 25.5,
    transaction_count_30d: 15,
    active_traders_30d: 8,
    new_users_30d: 3,
    avg_transaction_size: 1.7,
  },
  monthly_trends: [
    { month: '2025-01', transaction_count: 5, total_volume: 10, new_users: 2 },
    { month: '2025-02', transaction_count: 8, total_volume: 16, new_users: 1 },
  ],
  weekly_trends: [
    { week: 'W1', transaction_count: 3, total_volume: 6 },
  ],
  top_earners: [
    { id: 1, name: 'Alice', total: 12.5 },
    { id: 2, name: 'Bob', total: 8.0 },
  ],
  top_spenders: [
    { id: 3, name: 'Charlie', total: 10.0 },
  ],
  gamification: { total_xp: 500, total_badges: 10, engagement_rate: 0.7 },
  matching: { total_matches: 20, conversion_rate: 0.5 },
  category_demand: [
    { name: 'Gardening', listing_count: 5, active_count: 3 },
    { name: 'Cooking', listing_count: 0, active_count: 0 },
  ],
  engagement_rate: 0.42,
});

const makeSuccess = (data: unknown) => ({ success: true, data });

const STAT_TILES = ['Hours Exchanged 30d', 'Active Traders 30d', 'New Users 30d', 'Engagement Rate'];
const CHART_CARDS = ['Exchange Trends', 'Member Growth', 'Category Demand'];

/**
 * The real StatCard exposes no test id — locate a tile by the label it actually
 * renders and assert exactly one match.
 */
function statCard(label: string): HTMLElement {
  const matches = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="card"]')).filter(
    (card) => card.querySelector('p')?.textContent === label
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** The chart Card that owns the given heading. */
function chartCard(heading: string): HTMLElement {
  const card = screen.getByRole('heading', { name: heading }).closest('[data-slot="card"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

/**
 * Live regions that actually carry aria-busy. A busy placeholder wraps a
 * Spinner that also exposes role="status" with the same label, so filtering on
 * aria-busy is what isolates the outer region.
 */
function busyRegions(name: string, container?: HTMLElement): HTMLElement[] {
  const scope = container ? within(container) : screen;
  return scope
    .queryAllByRole('status', { name })
    .filter((el) => el.getAttribute('aria-busy') === 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('CommunityAnalytics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasFeature.mockReturnValue(false);
    mockApi.get.mockResolvedValue(makeSuccess(makeAnalyticsData()));
    mockApi.download.mockResolvedValue(undefined);
  });

  it('shows loading spinners initially', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    // Every tile shows a busy skeleton instead of a value…
    for (const label of STAT_TILES) {
      expect(within(statCard(label)).getByRole('status', { name: 'Loading' })).toHaveAttribute(
        'aria-busy',
        'true'
      );
    }
    // …and every chart card shows exactly one busy placeholder.
    for (const heading of CHART_CARDS) {
      expect(busyRegions('Loading analytics', chartCard(heading))).toHaveLength(1);
    }
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('renders stat cards after data loads', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    await waitFor(() => expect(statCard('Hours Exchanged 30d')).toHaveTextContent('25.5'));
    expect(statCard('Active Traders 30d')).toHaveTextContent('8');
    expect(statCard('New Users 30d')).toHaveTextContent('3');
    expect(statCard('Engagement Rate')).toHaveTextContent('42%');
    // Nothing is still skeletonised once the payload resolved.
    expect(screen.queryAllByRole('status', { name: 'Loading' })).toHaveLength(0);
  });

  it('renders top earner names in the table', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    const grid = await screen.findByRole('grid', { name: 'Top Earners' });
    const rows = await waitFor(() => {
      const found = within(grid).getAllByRole('row');
      expect(found).toHaveLength(3); // header + Alice + Bob
      return found;
    });

    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('1');
    const aliceCells = within(rows[1]).getAllByRole('gridcell');
    expect(aliceCells[0]).toHaveTextContent('Alice');
    expect(aliceCells[1]).toHaveTextContent('12.5');

    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('2');
    const bobCells = within(rows[2]).getAllByRole('gridcell');
    expect(bobCells[0]).toHaveTextContent('Bob');
    expect(bobCells[1]).toHaveTextContent('8.0');
  });

  it('renders top spender names in the table', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    const grid = await screen.findByRole('grid', { name: 'Top Spenders' });
    const rows = await waitFor(() => {
      const found = within(grid).getAllByRole('row');
      expect(found).toHaveLength(2); // header + Charlie
      return found;
    });

    const charlieCells = within(rows[1]).getAllByRole('gridcell');
    expect(charlieCells[0]).toHaveTextContent('Charlie');
    expect(charlieCells[1]).toHaveTextContent('10.0');
  });

  it('shows chart placeholders when data is available', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    await waitFor(() => {
      expect(within(chartCard('Exchange Trends')).getByTestId('area-chart')).toBeInTheDocument();
    });
    expect(within(chartCard('Member Growth')).getByTestId('bar-chart')).toBeInTheDocument();
    expect(within(chartCard('Category Demand')).getByTestId('pie-chart')).toBeInTheDocument();
    // Each chart carries an accessible description for screen readers.
    for (const heading of CHART_CARDS) {
      expect(screen.getByRole('img', { name: heading })).toBeInTheDocument();
    }
  });

  it('calls export download endpoint when export button pressed', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    await waitFor(() => expect(statCard('Hours Exchanged 30d')).toHaveTextContent('25.5'));

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(mockApi.download).toHaveBeenCalledWith(
        '/v2/admin/community-analytics/export',
        expect.objectContaining({ filename: 'community-analytics.csv' })
      );
    });
  });

  it('calls refresh endpoint when refresh button pressed', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    await waitFor(() => expect(statCard('Hours Exchanged 30d')).toHaveTextContent('25.5'));
    expect(mockApi.get.mock.calls.filter(([url]: [string]) => url === ANALYTICS_URL)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockApi.get.mock.calls.filter(([url]: [string]) => url === ANALYTICS_URL)).toHaveLength(2);
    });
  });

  it('shows no-data message when api returns empty monthly_trends', async () => {
    mockApi.get.mockResolvedValue(
      makeSuccess({ ...makeAnalyticsData(), monthly_trends: [] })
    );
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    // The two trend charts fall back to their real empty-state copy…
    await waitFor(() => {
      expect(within(chartCard('Exchange Trends')).getByText('No exchange trend data')).toBeInTheDocument();
    });
    expect(within(chartCard('Member Growth')).getByText('No member growth data')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    // …while the unaffected category chart still renders.
    expect(within(chartCard('Category Demand')).getByTestId('pie-chart')).toBeInTheDocument();
    expect(busyRegions('Loading analytics')).toHaveLength(0);
  });

  it('does not render geo section when maps feature is off', async () => {
    mockHasFeature.mockReturnValue(false);
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    // Positive precondition: the page itself rendered and fetched its analytics.
    await waitFor(() => expect(statCard('Hours Exchanged 30d')).toHaveTextContent('25.5'));
    expect(mockApi.get).toHaveBeenCalledWith(ANALYTICS_URL);

    // With the maps feature off the geography card is neither rendered nor fetched.
    expect(screen.queryByRole('heading', { name: 'Geographic Distribution' })).toBeNull();
    expect(mockApi.get).not.toHaveBeenCalledWith(GEOGRAPHY_URL);
    expect(mockHasFeature).toHaveBeenCalledWith('maps');
  });

  it('shows error in chart area when api fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network error'));
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    // The failure surfaces as real copy inside each chart area, not a silent blank.
    await waitFor(() => {
      expect(
        within(chartCard('Exchange Trends')).getByText('Failed to load community analytics.')
      ).toBeInTheDocument();
    });
    expect(
      within(chartCard('Member Growth')).getByText('Failed to load community analytics.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    // Loading spinners should be gone after error
    expect(busyRegions('Loading analytics')).toHaveLength(0);
    expect(screen.queryAllByRole('status', { name: 'Loading' })).toHaveLength(0);
  });

  it('displays engagement rate formatted as percentage', async () => {
    const { CommunityAnalytics } = await import('./CommunityAnalytics');
    render(<CommunityAnalytics />);

    // formatPercentRatio(0.42) renders the ratio as a locale percentage.
    await waitFor(() => {
      expect(statCard('Engagement Rate')).toHaveTextContent('42%');
    });
  });
});
