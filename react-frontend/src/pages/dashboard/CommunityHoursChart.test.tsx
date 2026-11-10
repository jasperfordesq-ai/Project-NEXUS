// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn() } }));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// The charting library draws nothing without a measured size, which the test
// DOM does not have. This stand-in draws one element per bar and records
// whether the bars would animate.
vi.mock('recharts', () => {
  let rows: Array<{ month: string; hours: number }> = [];
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    BarChart: ({ data, children, accessibilityLayer }: { data: typeof rows; children: ReactNode; accessibilityLayer?: boolean }) => {
      rows = data;
      return <div data-testid="hours-bar-chart" data-keyboard-layer={String(accessibilityLayer)}>{children}</div>;
    },
    Bar: ({ dataKey, fill, isAnimationActive }: { dataKey: 'hours'; fill: string; isAnimationActive: boolean }) => (
      <div data-testid="hours-bars" data-fill={fill} data-animated={String(isAnimationActive)}>
        {rows.map((row) => (
          <span key={row.month} data-testid="hours-bar" data-month={row.month} data-value={String(row[dataKey])} />
        ))}
      </div>
    ),
    XAxis: () => null,
    Tooltip: () => null,
  };
});

import { CommunityHoursChart } from './CommunityHoursChart';

const response = (hours: number[]) => ({
  success: true,
  data: {
    month: '2026-11',
    hours_shared: hours[hours.length - 1] ?? 0,
    new_members: 0,
    new_listings: 0,
    monthly_hours: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
      .slice(0, hours.length)
      .map((month, i) => ({ month, hours: hours[i] })),
  },
});

describe('CommunityHoursChart', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('draws one bar per month, in the community colour, from the monthly highlight request', async () => {
    mockApi.get.mockResolvedValueOnce(response([0, 4, 12.5, 3, 0, 42]));
    render(<CommunityHoursChart />);

    const card = await screen.findByTestId('community-hours-chart');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/community/this-month');
    expect(within(card).getByRole('heading', { name: 'Hours shared' })).toBeInTheDocument();

    const bars = await within(card).findAllByTestId('hours-bar');
    expect(bars.map((bar) => bar.getAttribute('data-month'))).toEqual([
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ]);
    expect(bars.map((bar) => bar.getAttribute('data-value'))).toEqual(['0', '4', '12.5', '3', '0', '42']);
    expect(within(card).getByTestId('hours-bars')).toHaveAttribute('data-fill', 'var(--accent-strong)');
  });

  it('gives the same numbers as text, one line per month, and hides the drawing from screen readers', async () => {
    mockApi.get.mockResolvedValueOnce(response([0, 4, 12.5, 3, 0, 42]));
    render(<CommunityHoursChart />);

    const list = await screen.findByTestId('community-hours-list');
    const lines = within(list).getAllByRole('listitem').map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short' });
    expect(lines).toEqual([
      `${monthName.format(new Date(2026, 5, 1))}: 0`,
      `${monthName.format(new Date(2026, 6, 1))}: 4`,
      `${monthName.format(new Date(2026, 7, 1))}: 12.5`,
      `${monthName.format(new Date(2026, 8, 1))}: 3`,
      `${monthName.format(new Date(2026, 9, 1))}: 0`,
      `${monthName.format(new Date(2026, 10, 1))}: 42`,
    ]);
    expect(list).toHaveClass('sr-only');

    const chart = await screen.findByTestId('hours-bar-chart');
    expect(chart.closest('[aria-hidden="true"]')).not.toBeNull();
    // Nothing inside a hidden box may take keyboard focus.
    expect(chart).toHaveAttribute('data-keyboard-layer', 'false');
  });

  it('shows nothing when every month is zero', async () => {
    mockApi.get.mockResolvedValueOnce(response([0, 0, 0, 0, 0, 0]));
    render(<CommunityHoursChart />);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('community-hours-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hours-bar-chart')).not.toBeInTheDocument();
  });

  it('shows nothing when the server sends no monthly figures, or the request fails', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: { month: '2026-11', hours_shared: 9, new_members: 1, new_listings: 1 } });
    const first = render(<CommunityHoursChart />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByTestId('community-hours-chart')).not.toBeInTheDocument();
    first.unmount();

    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    render(<CommunityHoursChart />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId('community-hours-chart')).not.toBeInTheDocument();
  });

  it('animates the bars normally, and not at all when reduced motion is asked for', async () => {
    mockApi.get.mockResolvedValueOnce(response([1, 2, 3, 4, 5, 6]));
    const first = render(<CommunityHoursChart />);
    expect(await screen.findByTestId('hours-bars')).toHaveAttribute('data-animated', 'true');
    first.unmount();

    document.documentElement.setAttribute('data-reduced-motion', 'true');
    mockApi.get.mockResolvedValueOnce(response([1, 2, 3, 4, 5, 6]));
    render(<CommunityHoursChart />);
    expect(await screen.findByTestId('hours-bars')).toHaveAttribute('data-animated', 'false');
  });
});
