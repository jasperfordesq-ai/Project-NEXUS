// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi, mockTokenManager } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  mockTokenManager: { getAccessToken: vi.fn(() => 'tok'), getTenantId: vi.fn(() => '2') },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  tokenManager: mockTokenManager,
  API_BASE: '/api',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/chartColors', () => ({
  CHART_COLORS: ['#aaa', '#bbb', '#ccc'],
  CHART_COLOR_MAP: { primary: '#aaa', success: '#bbb', warning: '#ccc', danger: '#ddd' },
  CHART_TOKEN_COLORS: { border: '#eee', surface: '#fff', foreground: '#000' },
}));

// ─── Stub recharts completely ─────────────────────────────────────────────────
// recharts measures real SVG geometry, which jsdom cannot provide. Everything
// else on this page — HeroUI Tabs/Table/Select/Input and the admin StatCard /
// PageHeader — renders for real.
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  Legend: () => null,
  AreaChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const makeSummary = (overrides = {}) => ({
  total_hours: 120.5,
  total_transactions: 44,
  avg_hours_per_transaction: 2.7,
  unique_givers: 15,
  unique_receivers: 18,
  min_hours: 0.5,
  max_hours: 8,
  ...overrides,
});

const makeCategoryData = () => ({
  categories: [
    { category: 'Gardening', total_hours: 30, transaction_count: 10, percentage: 25 },
    { category: 'Cooking', total_hours: 60, transaction_count: 20, percentage: 50 },
  ],
});

const makeMemberData = () => ({
  members: [
    {
      id: 1, name: 'Alice', profile_image_url: null,
      hours_given: 10, hours_received: 5, total_hours: 15, balance: 5,
    },
    {
      id: 2, name: 'Bob', profile_image_url: null,
      hours_given: 2, hours_received: 8, total_hours: 10, balance: -6,
    },
  ],
});

const makePeriodData = () => ({
  periods: [
    { month: '2025-01', total_hours: 40, transaction_count: 12, unique_givers: 5, unique_receivers: 7 },
    { month: '2025-02', total_hours: 55, transaction_count: 18, unique_givers: 8, unique_receivers: 10 },
  ],
});

const SUMMARY_TILES = ['Total Hours', 'Total Transactions', 'Unique Givers', 'Avg Hours Transaction'];

/**
 * The real StatCard exposes no test id — locate a summary tile by the label it
 * actually renders and assert exactly one match, so a missing or duplicated
 * tile cannot slip through.
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

// ─────────────────────────────────────────────────────────────────────────────

describe('HoursReportsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: first call is summary, second is data
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: makeSummary() })
      .mockResolvedValue({ success: true, data: makeCategoryData() });
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);

    // Each summary tile shows a busy skeleton in place of its value…
    for (const label of SUMMARY_TILES) {
      expect(within(statCard(label)).getByRole('status', { name: 'Loading' })).toHaveAttribute(
        'aria-busy',
        'true'
      );
    }
    // …and both category charts show a busy placeholder instead of a chart.
    for (const heading of ['Chart Hours by Category', 'Chart Category Distribution']) {
      expect(within(chartCard(heading)).getByRole('status', { name: 'Loading' })).toHaveAttribute(
        'aria-busy',
        'true'
      );
    }
    expect(screen.queryAllByTestId('responsive-container')).toHaveLength(0);
  });

  it('renders summary stat cards after load', async () => {
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);

    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));
    expect(statCard('Total Transactions')).toHaveTextContent('44');
    expect(statCard('Unique Givers')).toHaveTextContent('15');
    expect(statCard('Avg Hours Transaction')).toHaveTextContent('2.7');
    // No tile is still skeletonised once the summary resolved.
    expect(screen.queryAllByRole('status', { name: 'Loading' })).toHaveLength(0);
  });

  it('renders category charts when category data is returned', async () => {
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);

    await waitFor(() => {
      expect(screen.queryAllByTestId('responsive-container')).toHaveLength(2);
    });
    expect(within(chartCard('Chart Hours by Category')).getByTestId('bar-chart')).toBeInTheDocument();
    expect(within(chartCard('Chart Category Distribution')).getByTestId('pie-chart')).toBeInTheDocument();
    // Both charts carry their screen-reader description.
    expect(
      screen.getByRole('img', { name: 'Bar chart showing hours exchanged by category' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Pie chart showing distribution of time exchange hours' })
    ).toBeInTheDocument();
  });

  it('shows empty text when no category data', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: makeSummary() })
      .mockResolvedValue({ success: true, data: { categories: [] } });

    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);

    // Both chart cards replace the chart with the real empty-state copy.
    await waitFor(() => {
      expect(screen.getAllByText('No category data found')).toHaveLength(2);
    });
    expect(within(chartCard('Chart Hours by Category'))
      .getByText('No category data found')).toBeInTheDocument();
    expect(within(chartCard('Chart Category Distribution'))
      .getByText('No category data found')).toBeInTheDocument();
    // …and no chart is rendered at all.
    expect(screen.queryAllByTestId('responsive-container')).toHaveLength(0);
    expect(screen.queryByRole('img', { name: /chart showing/i })).toBeNull();
  });

  it('shows member table when member tab is selected', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: makeSummary() })
      .mockResolvedValue({ success: true, data: makeMemberData() });

    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));

    await userEvent.click(screen.getByRole('tab', { name: 'By Member' }));

    const grid = await screen.findByRole('grid', { name: 'Hours by Member' });
    const rows = await waitFor(() => {
      const found = within(grid).getAllByRole('row');
      expect(found).toHaveLength(3); // header + Alice + Bob
      return found;
    });

    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('Alice');
    const aliceCells = within(rows[1]).getAllByRole('gridcell');
    expect(aliceCells[0]).toHaveTextContent('10.0');
    expect(aliceCells[1]).toHaveTextContent('5.0');
    expect(aliceCells[2]).toHaveTextContent('15.0');
    expect(aliceCells[3]).toHaveTextContent('+5.0');

    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('Bob');
    const bobCells = within(rows[2]).getAllByRole('gridcell');
    expect(bobCells[0]).toHaveTextContent('2.0');
    expect(bobCells[1]).toHaveTextContent('8.0');
    expect(bobCells[2]).toHaveTextContent('10.0');
    expect(bobCells[3]).toHaveTextContent('-6.0');
  });

  it('shows period trend chart when period tab is selected', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: makeSummary() })
      .mockResolvedValue({ success: true, data: makePeriodData() });

    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));

    await userEvent.click(screen.getByRole('tab', { name: 'Monthly Trend' }));

    expect(
      await screen.findByRole('img', { name: 'Area chart showing hours exchanged over time' })
    ).toBeInTheDocument();
    expect(within(chartCard('Chart Monthly Hours Trend')).getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.queryAllByTestId('responsive-container')).toHaveLength(1);
    expect(screen.queryByText('No period data found')).toBeNull();
  });

  it('shows error toast when summary fetch fails', async () => {
    // mockReset clears the beforeEach mockResolvedValueOnce queue — without it the
    // summary request still succeeds and this test only ever exercised the
    // report-data failure path.
    mockApi.get.mockReset();
    mockApi.get.mockRejectedValue(new Error('network'));
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load summary data');
    });
  });

  it('shows error toast when data fetch fails', async () => {
    // Summary OK (already set in beforeEach), data fails — override only the fallback
    mockApi.get.mockRejectedValue(new Error('network error'));
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load report data');
    }, { timeout: 5000 });
  });

  it('renders date filter inputs', async () => {
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));

    // The header actions expose two labelled date pickers.
    for (const label of ['From Date', 'To Date']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('type', 'date');
      expect(input).toHaveValue('');
    }
  });

  it('renders export CSV and refresh buttons', async () => {
    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    // Refresh is disabled while a report request is in flight, so it must be
    // enabled again now that the initial load finished.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  });

  it('shows no_member_hours_data when member tab has no data', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: true, data: makeSummary() })
      .mockResolvedValue({ success: true, data: { members: [] } });

    const { HoursReportsPage } = await import('./HoursReportsPage');
    render(<HoursReportsPage />);
    await waitFor(() => expect(statCard('Total Hours')).toHaveTextContent('120.5'));

    await userEvent.click(screen.getByRole('tab', { name: 'By Member' }));

    const grid = await screen.findByRole('grid', { name: 'Hours by Member' });
    const rows = await waitFor(() => {
      const found = within(grid).getAllByRole('row');
      // Header row plus the single empty-state row — no member rows leak through.
      expect(found).toHaveLength(2);
      return found;
    });
    expect(within(rows[1]).getByText('No member hours data found')).toBeInTheDocument();
  });
});
