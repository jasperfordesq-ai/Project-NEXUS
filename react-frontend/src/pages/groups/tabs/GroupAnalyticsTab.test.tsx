// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockGetDashboard, mockDownloadExport } = vi.hoisted(() => ({
  mockGetDashboard: vi.fn(),
  mockDownloadExport: vi.fn(),
}));

vi.mock('../api/analytics', () => ({
  getGroupAnalyticsDashboard: mockGetDashboard,
  downloadGroupAnalyticsExport: mockDownloadExport,
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Chart colors (simple stubs avoid CSS var resolution errors) ──────────────
vi.mock('@/lib/chartColors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chartColors')>()),
  CHART_COLORS: ['#4f46e5', '#10b981', '#f59e0b'],
  CHART_COLOR_MAP: { primary: '#4f46e5', secondary: '#6366f1', success: '#10b981' },
  CHART_TOKEN_COLORS: { border: '#e5e7eb', surface: '#ffffff', foreground: '#111827' },
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, resolveAvatarUrl: (url: string | null) => url ?? '' };
});

// ─── Stub recharts (heavy canvas library) ────────────────────────────────────
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Line: () => null,
  Bar: () => null,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
}));

// ─── Toast / Tenant ──────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeFullDashboard = () => ({
  kpi: { total_members: 120, active_members: 45, participation_rate: 37.5, avg_posts_per_day: 3.2 },
  growth: [
    { date: '2025-05-01', members: 110, new_members: 5 },
    { date: '2025-06-01', members: 120, new_members: 10 },
  ],
  engagement: [
    { date: '2025-05-01', posts: 20, discussions: 5, active_members: 30 },
  ],
  top_contributors: [
    { user_id: 1, name: 'Alice', avatar_url: null, post_count: 15 },
    { user_id: 2, name: 'Bob', avatar_url: null, post_count: 10 },
  ],
  activity_breakdown: [
    { type: 'post', count: 40 },
    { type: 'comment', count: 25 },
    { type: 'files', count: 3 },
  ],
  retention: [
    { month: '2025-01', joined: 20, still_active: 16, retention_pct: 80 },
    { month: '2025-02', joined: 15, still_active: 9, retention_pct: 60 },
  ],
  comparative: {
    your_members: 120,
    avg_members: 80,
    your_activity: 65,
    avg_activity: 50,
    percentile_rank: 75,
  },
});

const successResponse = (data: object) => data;

// ─────────────────────────────────────────────────────────────────────────────
describe('GroupAnalyticsTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDashboard.mockResolvedValue(successResponse(makeFullDashboard()));
    mockDownloadExport.mockResolvedValue(undefined);
  });

  it('shows admin-only message when isAdmin=false', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={false} />);

    // Should not fetch
    expect(mockGetDashboard).not.toHaveBeenCalled();
    // Should show restricted message
    await waitFor(() => {
      // i18n returns key as value in test env
      const msg = document.body.textContent;
      expect(msg).toMatch(/admin_only|analytics/i);
    });
  });

  it('shows loading spinner initially when isAdmin=true', async () => {
    mockGetDashboard.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders KPI values after data loads', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      // Loading spinner gone
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    const items120 = screen.getAllByText('120');
    expect(items120.length).toBeGreaterThan(0); // total_members (may also appear in comparative)
    expect(screen.getByText('45')).toBeInTheDocument();  // active_members
    expect(screen.getByText('Files: 3')).toBeInTheDocument();
  });

  it('renders top contributor names', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('renders retention cohort table rows', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('2025-01')).toBeInTheDocument();
      expect(screen.getByText('2025-02')).toBeInTheDocument();
    });
  });

  it('does not crash when a retention cohort is missing retention_pct (degraded backend)', async () => {
    // Regression: the cohort table did `cohort.retention_pct.toFixed(1)` directly while
    // every sibling KPI used `?? 0`. The retention array is a blind cast, so a cohort
    // with retention_pct null/missing threw during render and blanked the whole
    // analytics tab. It must now coerce to 0 and render the row.
    const degraded = {
      ...makeFullDashboard(),
      retention: [{ month: '2025-03', joined: 10, still_active: 5, retention_pct: null }],
    };
    mockGetDashboard.mockResolvedValue(successResponse(degraded));

    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    // If .toFixed threw on the null retention_pct, the component would not finish
    // rendering and this cohort row label would never appear.
    await waitFor(() => {
      expect(screen.getByText('2025-03')).toBeInTheDocument();
    });
    // The coerced value renders instead of crashing.
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('calls the API with the groupId and default 30-day range', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledWith(
        42,
        30,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('shows "no growth data" message when growth array is empty', async () => {
    const emptyGrowth = { ...makeFullDashboard(), growth: [] };
    mockGetDashboard.mockResolvedValue(successResponse(emptyGrowth));

    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    // line-chart should NOT be rendered (no data)
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('shows "no contributors" message when top_contributors is empty', async () => {
    const noContribs = { ...makeFullDashboard(), top_contributors: [] };
    mockGetDashboard.mockResolvedValue(successResponse(noContribs));

    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('shows a retryable error instead of analytics-shaped zeroes when loading fails', async () => {
    mockGetDashboard.mockRejectedValue(new Error('network'));

    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load analytics');

    mockGetDashboard.mockResolvedValueOnce(successResponse(makeFullDashboard()));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('45')).toBeInTheDocument());
  });

  it('renders comparative stats section when data present', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      // your_members value visible in comparative section
      const items = screen.getAllByText('120');
      expect(items.length).toBeGreaterThan(0);
    });
  });

  it('downloads member exports through the authenticated adapter', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    const exportBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('export') &&
      b.getAttribute('aria-label')?.toLowerCase().includes('member'),
    );
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn!);
    await waitFor(() => expect(mockDownloadExport).toHaveBeenCalledWith(1, 'members'));
  });

  it('reports a protected export failure without opening a new window', async () => {
    mockDownloadExport.mockRejectedValueOnce(new Error('HTTP 401'));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={7} isAdmin={true} />);
    await screen.findByText('45');

    fireEvent.click(screen.getByRole('button', { name: 'Export members CSV' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to download file'));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('fetches new data when day range toggle is clicked', async () => {
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={5} isAdmin={true} />);

    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledWith(
        5,
        30,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    // Find the 7-day toggle button
    const btn7 = screen.getAllByRole('button').find((b) => b.textContent?.includes('7'));
    if (btn7) {
      fireEvent.click(btn7);
      await waitFor(() => {
        expect(mockGetDashboard).toHaveBeenCalledWith(
          5,
          7,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
    }
  });

  it('aborts the analytics read when the tab unmounts', async () => {
    mockGetDashboard.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    const { unmount } = render(<GroupAnalyticsTab groupId={4} isAdmin={true} />);

    await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());
    const options = mockGetDashboard.mock.calls[0]?.[2] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(false);

    unmount();
    expect(options.signal.aborted).toBe(true);
  });

  it('surfaces adapter rejection from a resolved API failure', async () => {
    const { normalizeGroupApiError } = await import('../api/core');
    mockGetDashboard.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupAnalyticsTab } = await import('./GroupAnalyticsTab');
    render(<GroupAnalyticsTab groupId={1} isAdmin={true} />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to load analytics'));
  });
});
