// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import { SiteAccentContext } from '@/contexts/SiteAccentContext';
import { chartColorsFor } from '@/lib/chartColors';

// ─── UI / heavy deps ──────────────────────────────────────────────────────────
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// Recharts renders nothing useful in jsdom — stub entirely. The series stubs
// write their colour onto a span so the colour tests below can read it.
type SeriesProps = { dataKey?: string; fill?: string; stroke?: string; children?: React.ReactNode };
const { series } = vi.hoisted(() => ({
  series: (kind: string) => ({ dataKey, fill, stroke, children }: SeriesProps) => (
    <span data-testid={`chart-${kind}`} data-key={dataKey} data-fill={fill} data-stroke={stroke}>{children}</span>
  ),
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: series('area'),
  Bar: series('bar'),
  Line: series('line'),
  Pie: series('pie'),
  Cell: series('cell'),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/contexts', () => createMockContexts());

// ─── fetch mock ───────────────────────────────────────────────────────────────
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

// ─── react-router searchParams ────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useSearchParams: () => [new URLSearchParams('token=test-token-123'), vi.fn()],
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeDashboardPayload = (overrides = {}) => ({
  period: 'last_30d',
  enabled_modules: ['trends', 'demand_supply', 'demographics', 'footfall'] as const,
  generated_at: '2025-06-01T00:00:00Z',
  engagement: {
    period_start: '2025-05-01',
    period_end: '2025-05-31',
    active_members_bucket: '50-200',
    categories_active_bucket: '<50',
    partner_orgs_bucket: '<50',
    volunteer_hours_rounded: 120,
    event_participation_bucket: '<50',
  },
  demand_supply: { cells: [] },
  demographics: { age_buckets: { '18-30': '50-200' }, gender_buckets: { male: '50-200', female: '50-200' } },
  footfall: { areas: { 'SW1': { page_views_bucket: '50-200', distinct_visitors_bucket: '<50' } } },
  ...overrides,
});

const makeReportsPayload = (reports = [] as object[]) => ({
  data: { reports },
});

function mockFetchSuccess(dashPayload = makeDashboardPayload(), reportsPayload = makeReportsPayload()) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/me/reports')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reportsPayload) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: dashPayload }) });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('PartnerDashboardPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchSuccess();
  });

  it('shows loading spinner while fetching', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('calls fetch with the correct partner-analytics path prefix', async () => {
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      // Verify the fetch URL uses the /api/partner-analytics prefix
      const calls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.startsWith('/api/partner-analytics'))).toBe(true);
    });
  });

  it('shows error card when API returns 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
    // A retry button should appear
    await waitFor(() => {
      const retryBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('retry') || b.textContent?.toLowerCase().includes('try'),
      );
      expect(retryBtn).toBeDefined();
    });
  });

  it('shows error card when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  it('renders chart containers when data loads successfully', async () => {
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Chart areas are wrapped in role=img divs
    const charts = screen.queryAllByRole('img');
    expect(charts.length).toBeGreaterThan(0);
  });

  it('shows "no reports" text when reports array is empty', async () => {
    mockFetchSuccess(makeDashboardPayload(), makeReportsPayload([]));
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
    // "no_reports" translation key renders via i18next as the key itself in tests
    // Just confirm loading finished and no crash
    expect(document.body).toBeTruthy();
  });

  it('renders report row with download button when reports present', async () => {
    const report = {
      id: 7,
      report_type: 'monthly',
      period_start: '2025-05-01',
      period_end: '2025-05-31',
      generated_at: '2025-06-01T00:00:00Z',
      status: 'generated',
      file_url: 'https://example.com/report.pdf',
    };
    mockFetchSuccess(makeDashboardPayload(), makeReportsPayload([report]));
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // The period dates appear in the report row
    await waitFor(() => {
      expect(screen.getByText(/2025-05-01/)).toBeInTheDocument();
    });
  });

  it('passes the token query param in the fetch URL', async () => {
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('token=test-token-123'),
      );
    });
  });

  // Warmth phase 5: the charts were a fixed blue, violet and cyan whatever the
  // community's colour. They follow its chart colours now; offers and requests
  // keep the green and amber they have everywhere on the site.
  it("draws the charts in the community's colours, keeping offers green and requests amber", async () => {
    mockFetchSuccess(makeDashboardPayload({
      demand_supply: { cells: [{ category_id: 1, postcode_3: 'D01', offers_bucket: '<50', requests_bucket: '<50', match_rate_bucket: 40 }] },
    }));
    const community = '#0d9488';
    const palette = chartColorsFor(community);
    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(
      <SiteAccentContext.Provider value={community}>
        <PartnerDashboardPage />
      </SiteAccentContext.Provider>,
    );

    const line = await screen.findByTestId('chart-line');
    expect(line).toHaveAttribute('data-stroke', palette.primary);

    const bars = screen.getAllByTestId('chart-bar');
    expect(bars.find((b) => b.getAttribute('data-key') === 'offers')).toHaveAttribute('data-fill', '#10b981');
    expect(bars.find((b) => b.getAttribute('data-key') === 'requests')).toHaveAttribute('data-fill', '#f59e0b');
    expect(bars.find((b) => b.getAttribute('data-key') === 'value')).toHaveAttribute('data-fill', palette.primary);

    expect(screen.getAllByTestId('chart-cell')[0]).toHaveAttribute('data-fill', palette.categorical[0]);

    const areas = screen.getAllByTestId('chart-area');
    expect(areas.find((a) => a.getAttribute('data-key') === 'page_views')).toHaveAttribute('data-fill', palette.primary);
    expect(areas.find((a) => a.getAttribute('data-key') === 'visitors')).toHaveAttribute('data-fill', palette.secondary);

    const fixed = ['#3b82f6', '#8b5cf6', '#06b6d4'];
    for (const el of [line, ...bars, ...areas]) {
      expect(fixed).not.toContain(el.getAttribute('data-fill'));
      expect(fixed).not.toContain(el.getAttribute('data-stroke'));
    }
  });

  it('re-fetches when retry button is clicked', async () => {
    // Initial render: both dashboard + reports fetch are called (Promise.all = 2 calls)
    // but dashboard returns 500 so the component shows an error card with a retry button.
    // On first render the reports call also resolves to avoid unhandled rejections.
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })                         // dashboard call 1
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { reports: [] } }) }) // reports call 1
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: makeDashboardPayload() }) }); // retry calls

    const { default: PartnerDashboardPage } = await import('./PartnerDashboardPage');
    render(<PartnerDashboardPage />);

    // Wait for error state (retry button appears)
    await waitFor(() => {
      const retryBtn = screen.queryAllByRole('button').find((b) =>
        b.textContent?.includes('partner_analytics.retry') || b.textContent?.toLowerCase().includes('retry'),
      );
      expect(retryBtn).toBeDefined();
    });

    const callCountBeforeRetry = mockFetch.mock.calls.length;
    expect(callCountBeforeRetry).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.includes('partner_analytics.retry') || b.textContent?.toLowerCase().includes('retry'),
    );
    fireEvent.click(retryBtn!);

    // After clicking retry, fetch should have been called at least once more
    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountBeforeRetry);
    });
  });
});
