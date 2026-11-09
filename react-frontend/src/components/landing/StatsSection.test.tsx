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

  it('renders formatted stat values after successful API response', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });
    render(<StatsSection />);
    await waitFor(() => {
      // 1200 → "1.2K+"
      expect(screen.getByText('1.2K+')).toBeInTheDocument();
    });
    // 4500 → "4.5K+"
    expect(screen.getByText('4.5K+')).toBeInTheDocument();
    // 89 → "89"
    expect(screen.getByText('89')).toBeInTheDocument();
    // 12 → "12"
    expect(screen.getByText('12')).toBeInTheDocument();
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
});
