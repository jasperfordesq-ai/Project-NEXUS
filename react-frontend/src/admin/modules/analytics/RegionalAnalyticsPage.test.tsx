// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock api (default export) ───────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ default: mockApi, api: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── AdminMetaContext ─────────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Contexts / hooks ─────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// NOTE: deliberately no '@/components/ui' or '../../components' stubs. The real
// HeroUI v3 widgets and the real StatCard / PageHeader render here, so these
// tests assert the DOM users actually get — including the fact that the real
// Tabs auto-selects its first tab on mount and therefore loads the heatmap
// section without any click.

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeOverview = () => ({
  active_members: 120,
  vol_hours_this_month: 340,
  help_requests_this_month: 15,
  most_needed_category: 'Gardening',
});

const makeHeatmapData = () => [
  { lat: 53.33, lng: -6.25, count: 50 },
  { lat: 53.34, lng: -6.26, count: 30 },
];

const makeDemandData = () => [
  {
    category_id: 1,
    category_name: 'Gardening',
    request_count: 40,
    offer_count: 20,
    ratio: 2,
    trend: '↑' as const,
  },
];

const BASE = '/v2/admin/regional-analytics';

/**
 * The real StatCard exposes no test id — locate a hero tile by the label it
 * actually renders, and assert there is exactly one match so a duplicated or
 * missing tile can never be silently tolerated.
 */
function statCard(label: string): HTMLElement {
  const matches = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="card"]')).filter(
    (card) => card.querySelector('p')?.textContent === label
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** The single element that carries aria-busy for a named live region. */
function busyRegions(name: string): HTMLElement[] {
  return screen
    .queryAllByRole('status', { name })
    .filter((el) => el.getAttribute('aria-busy') === 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('RegionalAnalyticsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: overview succeeds, other GETs return empty
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ success: true, data: makeOverview() });
      }
      if (url.includes('/heatmap')) {
        return Promise.resolve({ success: true, data: makeHeatmapData() });
      }
      if (url.includes('/demand')) {
        return Promise.resolve({ success: true, data: makeDemandData() });
      }
      return Promise.resolve({ success: true, data: {} });
    });
  });

  it('shows loading spinner while overview data is fetching', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    // Every hero tile swaps its value for a busy skeleton while the overview loads.
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(4);
    for (const label of ['Active members', 'Volunteer hours', 'Help requests', 'Most needed category']) {
      expect(statCard(label)).toBeInTheDocument();
    }
    // …and the auto-selected heatmap panel shows its own busy region.
    expect(busyRegions('Loading analytics')).toHaveLength(1);
  });

  it('renders stat cards with overview data after load', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => {
      expect(statCard('Active members')).toHaveTextContent('120');
    });
    expect(statCard('Volunteer hours')).toHaveTextContent('340');
    expect(statCard('Help requests')).toHaveTextContent('15');
    // Skeletons are gone once the overview resolved.
    expect(screen.queryAllByRole('status', { name: 'Loading' })).toHaveLength(0);
  });

  it('renders most_needed_category in stat cards', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => {
      expect(statCard('Most needed category')).toHaveTextContent('Gardening');
    });
  });

  it('renders tab navigation for section panels', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Member heatmap',
      'Demographics',
      'Demand and supply',
      'Engagement',
      'Volunteer',
      'Help requests',
    ]);
    expect(screen.getByRole('tab', { name: 'Member heatmap' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders period selector control', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));

    const periodTrigger = screen.getByRole('button', { name: /Period/ });
    expect(periodTrigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(periodTrigger).toHaveTextContent('Last 30 days');
  });

  it('fetches heatmap data when heatmap tab is selected', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    // The heatmap tab is the default selection, so its section loads for the
    // current period without the user touching anything.
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(`${BASE}/heatmap?period=last_30d`);
    });
    expect(screen.getByRole('tab', { name: 'Member heatmap' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows demand-supply table rows after selecting demand tab', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));

    await userEvent.click(screen.getByRole('tab', { name: 'Demand and supply' }));

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(`${BASE}/demand-supply?period=last_30d`);
    });

    const grid = await screen.findByRole('grid', { name: 'Demand vs supply by category' });
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(2); // header + the single demand row
    const row = rows[1];
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Gardening');
    const cells = within(row).getAllByRole('gridcell');
    expect(cells[0]).toHaveTextContent('40');
    expect(cells[1]).toHaveTextContent('20');
    expect(cells[2]).toHaveTextContent('2.00');
    expect(cells[3]).toHaveTextContent('↑');
  });

  it('calls POST invalidate-cache when refresh/invalidate button is clicked', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));

    await userEvent.click(screen.getByRole('button', { name: 'Refresh cache' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(`${BASE}/invalidate-cache`);
    });
    // The overview is re-requested after a successful cache purge.
    await waitFor(() => {
      expect(mockApi.get.mock.calls.filter(([url]: [string]) => url === `${BASE}/overview`)).toHaveLength(2);
    });
  });

  it('calls GET export endpoint when Export button is clicked', async () => {
    // jsdom does not implement URL.createObjectURL — stub it
    const createObjectURL = vi.fn(() => 'blob:fake');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));

    await userEvent.click(screen.getByRole('button', { name: 'Export report' }));

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(`${BASE}/export?period=last_30d`);
    });
    // The report is turned into a downloadable blob rather than silently dropped.
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('shows error alert when overview API returns an error shape', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ success: true, data: { error: 'data_unavailable' } });
      }
      if (url.includes('/heatmap')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: {} });
    });

    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Data is unavailable for this period.'
    );
    // The tiles fall back to the empty-value placeholder instead of a stale number.
    expect(statCard('Active members')).toHaveTextContent('-');
  });

  it('shows tab loading spinner when a tab section is loading', async () => {
    let resolveHeatmap: (v: unknown) => void = () => {};
    const heatmapPending = new Promise((res) => { resolveHeatmap = res; });

    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/overview')) return Promise.resolve({ success: true, data: makeOverview() });
      if (url.includes('heatmap')) return heatmapPending;
      return Promise.resolve({ success: true, data: {} });
    });

    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    // The overview settles but the heatmap request never does, so the selected
    // panel keeps exactly one busy region and shows its spinner label.
    await waitFor(() => expect(statCard('Active members')).toHaveTextContent('120'));
    expect(busyRegions('Loading analytics')).toHaveLength(1);
    expect(screen.getByText('Loading analytics')).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Geographic activity density' })).toBeNull();

    // Cleanup: resolve the pending call
    resolveHeatmap({ success: true, data: makeHeatmapData() });
    await waitFor(() =>
      expect(screen.getByRole('grid', { name: 'Geographic activity density' })).toBeInTheDocument()
    );
    expect(busyRegions('Loading analytics')).toHaveLength(0);
  });

  it('renders heatmap table rows with lat/lng values', async () => {
    const { default: RegionalAnalyticsPage } = await import('./RegionalAnalyticsPage');
    render(<RegionalAnalyticsPage />);

    const grid = await screen.findByRole('grid', { name: 'Geographic activity density' });
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two heatmap cells

    const firstCells = within(rows[1]).getAllByRole('gridcell');
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('1');
    expect(firstCells[0]).toHaveTextContent('53.33');
    expect(firstCells[1]).toHaveTextContent('-6.25');
    expect(firstCells[2]).toHaveTextContent('50');

    const secondCells = within(rows[2]).getAllByRole('gridcell');
    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('2');
    expect(secondCells[0]).toHaveTextContent('53.34');
    expect(secondCells[1]).toHaveTextContent('-6.26');
    expect(secondCells[2]).toHaveTextContent('30');
  });
});
