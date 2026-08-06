// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/api', () => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() };
  return { default: m, api: m };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import { api } from '@/lib/api';
import PerformanceDashboard from './PerformanceDashboard';

const makeStats = (overrides = {}) => ({
  slowest_requests: [],
  slowest_queries: [],
  memory_spikes: [],
  request_volume: {},
  n_plus_one_warnings: 0,
  total_requests: 42,
  total_slow_queries: 7,
  ...overrides,
});

describe('PerformanceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while fetching', async () => {
    // Never resolve — keep in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<PerformanceDashboard />);
    const spinner = getAllByRoleHelper(() => screen.getAllByRole('status'));
    const busy = spinner.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stat cards when data loads successfully', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeStats() });
    render(<PerformanceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows empty state message when there are no slow requests', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeStats() });
    render(<PerformanceDashboard />);
    // The "requests" tab is selected by default
    await waitFor(() => {
      // some text indicating no slow requests
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('renders slow request cards when data has requests', async () => {
    const stats = makeStats({
      slowest_requests: [
        {
          timestamp: '2024-01-01T00:00:00.000Z',
          endpoint: '/api/users',
          method: 'GET',
          duration_ms: 800,
          query_count: 5,
          memory_mb: 32,
        },
      ],
    });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: stats });
    render(<PerformanceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('/api/users')).toBeInTheDocument();
    });
    expect(screen.getByText('GET')).toBeInTheDocument();
    // Intl unit formatting puts a space before the unit ("800 ms"), and the
    // separator can vary by locale — match on the digits plus unit only.
    expect(screen.getByText(/800\s*ms/)).toBeInTheDocument();
  });

  it('shows N+1 warning banner when n_plus_one_warnings > 0', async () => {
    const stats = makeStats({ n_plus_one_warnings: 3 });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: stats });
    render(<PerformanceDashboard />);
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('re-fetches data when a time filter button is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeStats() });
    const user = userEvent.setup();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));

    // Click 1 hour filter
    const oneHourBtn = screen.getByRole('button', { name: /1.hour|1h/i });
    await user.click(oneHourBtn);
    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        expect.stringContaining('hours=1'),
      );
    });
  });

  it('re-fetches when refresh button is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeStats() });
    const user = userEvent.setup();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2));
  });

  it('renders slow query entries when present', async () => {
    const stats = makeStats({
      slowest_queries: [
        {
          timestamp: '2024-01-01T00:00:00.000Z',
          duration_ms: 1200,
          sql: 'SELECT * FROM users',
        },
      ],
    });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: stats });
    const user = userEvent.setup();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    // Click queries tab
    const queriesTab = screen.getByRole('tab', { name: /slow.queries/i });
    await user.click(queriesTab);
    await waitFor(() => {
      expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument();
    });
  });

  it('renders memory spike entries when present', async () => {
    const stats = makeStats({
      memory_spikes: [
        {
          timestamp: '2024-01-01T00:00:00.000Z',
          endpoint: '/api/export',
          memory_mb: 256,
          peak_memory_mb: 512,
        },
      ],
    });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: stats });
    const user = userEvent.setup();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument()); // memory_spikes.length

    const memoryTab = screen.getByRole('tab', { name: /memory/i });
    await user.click(memoryTab);
    await waitFor(() => {
      expect(screen.getByText('/api/export')).toBeInTheDocument();
    });
  });

  it('reads the admin performance endpoint, not the event-counter one', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeStats() });
    render(<PerformanceDashboard />);

    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringContaining('/v2/admin/performance/summary'),
    );
    // The old address returned a completely different report and crashed the page.
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith(
      expect.stringContaining('/v2/metrics/summary'),
    );
  });

  it('says recording is off, rather than showing zeroes, when the server reports it off', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: makeStats({ total_requests: 0, total_slow_queries: 0 }),
      meta: { recording_enabled: false, per_page: 0, has_more: false },
    });
    render(<PerformanceDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/not being collected/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: /slow.requests/i })).not.toBeInTheDocument();
  });

  // Regression: the page used to read /v2/metrics/summary, the event-counter
  // endpoint. It answers 200 with this shape, which has none of the profiling
  // keys this page reads. Before the shape guard, summary.memory_spikes.length
  // threw and the admin error boundary replaced the whole page.
  it('does not crash when the endpoint returns the event-counter payload', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: {
        period: 'week',
        total_events: 12,
        events_by_type: { login: 12 },
        start: '2024-01-01T00:00:00.000Z',
        end: '2024-01-08T00:00:00.000Z',
      },
    });
    render(<PerformanceDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    });
    // No stat cards, and specifically no fabricated zeroes.
    expect(screen.queryByRole('tab', { name: /slow.requests/i })).not.toBeInTheDocument();
  });

  it('reports a load failure when the request fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<PerformanceDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    });
  });

  it('tolerates a partial payload without crashing', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { slowest_requests: [] },
    });
    render(<PerformanceDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /slow.requests/i })).toBeInTheDocument();
    });
    // memory_spikes was absent; the card must still render a count.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('renders request volume bars when present', async () => {
    const stats = makeStats({
      request_volume: { '2024-01-01 00': 50, '2024-01-01 01': 75 },
    });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: stats });
    const user = userEvent.setup();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

    const volumeTab = screen.getByRole('tab', { name: /volume/i });
    await user.click(volumeTab);
    await waitFor(() => {
      expect(screen.getByText('2024-01-01 00')).toBeInTheDocument();
    });
  });
});

// Helper to avoid crashing when getAllByRole returns nothing
function getAllByRoleHelper(fn: () => HTMLElement[]) {
  try { return fn(); } catch { return []; }
}
