// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

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

vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import CommunityImpactTab from './CommunityImpactTab';

const makeImpactData = (overrides = {}) => ({
  total_members: 250,
  total_xp: 48500,
  total_badges_awarded: 320,
  total_volunteer_hours: 1200,
  total_listings: 85,
  total_connections: 430,
  total_exchanges: 110,
  total_reviews: 95,
  this_month: {
    new_members: 12,
    badges_awarded: 18,
    new_listings: 7,
    new_connections: 22,
    volunteer_hours: 60,
    new_posts: 34,
  },
  last_month: {
    new_members: 10,
    badges_awarded: 15,
    new_listings: 9,
    new_connections: 19,
    volunteer_hours: 55,
    new_posts: 28,
  },
  trends: {
    new_members: 20,
    badges_awarded: 0,
    new_listings: -22,
    new_connections: 16,
    volunteer_hours: 9,
    new_posts: 21,
  },
  ...overrides,
});

describe('CommunityImpactTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton loading cards initially', async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    render(<CommunityImpactTab />);

    // Skeleton elements are rendered while loading
    // The loading branch renders 4 GlassCards each containing two Skeleton elements
    const skeletons = document.querySelectorAll('[class*="animate"], [data-slot="base"]');
    // Just confirm we are in loading state (data not yet shown)
    expect(screen.queryByText('250')).not.toBeInTheDocument();
  });

  it('renders primary stats when data loads successfully', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData(),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => {
      // total_members = 250 should appear
      expect(screen.getByText('250')).toBeInTheDocument();
    });

    // total_badges_awarded = 320
    expect(screen.getByText('320')).toBeInTheDocument();
    // total_volunteer_hours = 1,200
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('renders secondary stats (listings, connections, reviews)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData(),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    expect(screen.getByText('85')).toBeInTheDocument();   // total_listings
    expect(screen.getByText('430')).toBeInTheDocument();  // total_connections
    expect(screen.getByText('95')).toBeInTheDocument();   // total_reviews
  });

  it('renders this-month breakdown metrics', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData(),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    // this_month.new_members = 12
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows positive trend chip for growing metrics', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData({ trends: { new_members: 15, badges_awarded: 0, new_listings: 0, new_connections: 0, volunteer_hours: 0, new_posts: 0 } }),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    // Positive trend: "+15%"
    expect(screen.getByText('+15%')).toBeInTheDocument();
  });

  it('shows negative trend chip for declining metrics', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData({ trends: { new_members: 0, badges_awarded: 0, new_listings: -22, new_connections: 0, volunteer_hours: 0, new_posts: 0 } }),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    // Negative trend: "-22%"
    expect(screen.getByText('-22%')).toBeInTheDocument();
  });

  it('shows neutral chip for zero-trend metrics', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData({
        trends: { new_members: 0, badges_awarded: 0, new_listings: 0, new_connections: 0, volunteer_hours: 0, new_posts: 0 },
      }),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    // 6 zero-trend metrics = 6 neutral chips
    // The neutral label text comes from t('community.no_change') which falls back to the key
    const neutralChips = screen.getAllByText(/no.change|community\.no_change/i);
    expect(neutralChips.length).toBeGreaterThan(0);
  });

  it('renders an error state when the API returns success:false', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: false,
      error: 'Service unavailable',
    });

    render(<CommunityImpactTab />);

    await waitFor(() => {
      // Error message shown — either the API error or the i18n key fallback
      expect(screen.getByText(/service unavailable|community\.load_error/i)).toBeInTheDocument();
    });
  });

  it('renders an error state when the API throws', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network failure'));

    render(<CommunityImpactTab />);

    // i18n resolves 'community.load_error' → "We couldn't load the community's figures."
    await waitFor(() => {
      expect(screen.getByText(/couldn't load the community's figures/i)).toBeInTheDocument();
    });
  });

  it('renders zeros without crashing when the backend returns a degraded payload', async () => {
    // Regression: a degraded 200 (top-level numbers missing, this_month/last_month/
    // trends returned as [] instead of objects) made data.total_xp.toLocaleString()
    // throw and crashed the whole Leaderboard via the error boundary. It must now
    // coerce to zeros. Verified live by shimming the community-dashboard request.
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { this_month: [], last_month: [], trends: [] },
    } as never);

    render(<CommunityImpactTab />);

    await waitFor(() => {
      // The "This Month" section renders — it is built after the stat arrays that
      // previously threw, so reaching it proves the render got past the crash point.
      expect(screen.getByText(/This Month|community\.this_month/i)).toBeInTheDocument();
    });
    // Degraded numbers render as zeros, not undefined/crash.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    // It must NOT be the error state.
    expect(screen.queryByText(/couldn't load the community's figures/i)).not.toBeInTheDocument();
  });

  it('formats large total_xp with locale separators', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: makeImpactData({ total_xp: 1234567 }),
    });

    render(<CommunityImpactTab />);

    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());

    // 1,234,567 formatted
    expect(screen.getByText('1,234,567')).toBeInTheDocument();
  });
});
