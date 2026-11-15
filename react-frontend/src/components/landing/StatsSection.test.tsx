// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { api } from '@/lib/api';
import { StatsSection, formatStatNumber } from './StatsSection';

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

const mockStats = {
  members: 1200,
  hours_exchanged: 4500,
  listings: 89,
  communities: 12,
};

describe('formatStatNumber', () => {
  it('returns the number as-is when below 1 000', () => {
    expect(formatStatNumber(42)).toBe('42');
    expect(formatStatNumber(999)).toBe('999');
  });

  it('formats thousands with K+ suffix', () => {
    expect(formatStatNumber(1000)).toBe('1K+');
    expect(formatStatNumber(2500)).toBe('2.5K+');
    expect(formatStatNumber(10000)).toBe('10K+');
  });

  it('formats millions with M+ suffix', () => {
    expect(formatStatNumber(1000000)).toBe('1M+');
    expect(formatStatNumber(1500000)).toBe('1.5M+');
  });
});

describe('StatsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state (aria-busy) while the API call is pending', () => {
    // Never resolves
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = render(<StatsSection />);
    // The outer motion.div carries role="status" + aria-busy="true" during load
    const statusEl = container.querySelector('[aria-busy="true"]');
    expect(statusEl).toBeInTheDocument();
  });

  it('renders stat labels from i18n after API responds successfully', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });
    render(<StatsSection />);
    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
    expect(screen.getByText('Hours Exchanged')).toBeInTheDocument();
    expect(screen.getByText('Active offers and requests')).toBeInTheDocument();
    expect(screen.getByText('Communities')).toBeInTheDocument();
  });

  it('leaves out the communities tile when there is only one — "1 Communities" says nothing', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { ...mockStats, communities: 1 } });
    render(<StatsSection />);
    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
    expect(screen.getByText('Hours Exchanged')).toBeInTheDocument();
    expect(screen.queryByText('Communities')).not.toBeInTheDocument();
  });

  it('renders formatted stat values after successful API response', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });
    render(<StatsSection />);
    await waitFor(() => {
      // 1200 → "1.2K+"
      expect(screen.getByText('1.2K+', { selector: '.sr-only' })).toBeInTheDocument();
    });
    // 4500 → "4.5K+"
    expect(screen.getByText('4.5K+', { selector: '.sr-only' })).toBeInTheDocument();
    // 89 → "89"
    expect(screen.getByText('89', { selector: '.sr-only' })).toBeInTheDocument();
    // 12 → "12"
    expect(screen.getByText('12', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('renders em-dash placeholders when API returns no data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false });
    render(<StatsSection />);
    await waitFor(() => {
      // em-dash placeholders — rendered as the Unicode em-dash character
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBe(4);
    });
  });

  it('renders em-dash placeholders when API rejects', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
    render(<StatsSection />);
    await waitFor(() => {
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBe(4);
    });
  });

  it('returns null when show_live_stats is explicitly false', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <StatsSection content={{ show_live_stats: false }} />
    );
    // When the component returns null, nothing from StatsSection renders.
    // The wrapper div from the test provider may still be present, so we
    // assert that the stat grid/labels are absent rather than testing firstChild.
    expect(container.querySelector('[aria-busy]')).toBeNull();
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('does NOT call the API when show_live_stats is false', () => {
    render(<StatsSection content={{ show_live_stats: false }} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  // ---- The community's shared goal (warmth phase 6, D1) ----

  it("shows a small progress line for the community's shared goal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        ...mockStats,
        communities: 1,
        community_goal: { title: "Let's share 500 hours by spring", metric: 'hours', target: 500, current: 212.5 },
      },
    });
    render(<StatsSection />);

    const line = await screen.findByTestId('landing-community-goal');
    expect(line).toHaveTextContent('Our shared goal');
    expect(line).toHaveTextContent("Let's share 500 hours by spring");
    expect(line).toHaveTextContent('212.5 of 500 hours shared');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42.5');
    expect(line).not.toHaveTextContent(/\{\{/);
  });

  it('words the goal for what it counts', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...mockStats, community_goal: { title: 'Ten events', metric: 'events', target: 10, current: 3 } },
    });
    render(<StatsSection />);
    expect(await screen.findByTestId('landing-community-goal')).toHaveTextContent('3 of 10 events held');
  });

  it('shows no goal line when the community has no goal running', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { ...mockStats, community_goal: null } });
    render(<StatsSection />);
    await screen.findByText('Active Members');
    expect(screen.queryByTestId('landing-community-goal')).toBeNull();
  });
});
