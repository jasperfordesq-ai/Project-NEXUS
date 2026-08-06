// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── adminApi mock ────────────────────────────────────────────────────────────
const { mockAdminMatching, mockToast, mockNavigate } = vi.hoisted(() => ({
  mockAdminMatching: {
    getMatchingStats: vi.fn(),
    getConfig: vi.fn(),
    clearCache: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  mockNavigate: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminMatching: mockAdminMatching,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { MatchingAnalytics } from './MatchingAnalytics';

// ── fixtures ─────────────────────────────────────────────────────────────────
const STATS_RESPONSE = {
  success: true,
  data: {
    overview: {
      cache_entries: 120,
      total_matches_month: 450,
      total_matches_week: 98,
      total_matches_today: 12,
      avg_match_score: 73,
      avg_distance_km: 4.2,
      cache_hit_rate: 75,
      hot_matches_count: 15,
      mutual_matches_count: 30,
      active_users_matching: 80,
    },
    score_distribution: { '0-40': 10, '40-60': 50, '60-80': 200, '80-100': 190 },
    distance_distribution: { walking: 40, local: 80, city: 150, regional: 60, distant: 20 },
    pending_approvals: 5,
    approved_count: 300,
    rejected_count: 25,
    approval_rate: 92,
    broker_approval_enabled: true,
  },
};

const EMPTY_STATS_RESPONSE = {
  success: true,
  data: {
    overview: {
      cache_entries: 0,
      total_matches_month: 0,
      total_matches_week: 0,
      total_matches_today: 0,
      avg_match_score: 0,
      avg_distance_km: 0,
      cache_hit_rate: 0,
      hot_matches_count: 0,
      mutual_matches_count: 0,
      active_users_matching: 0,
    },
    score_distribution: {},
    distance_distribution: {},
    pending_approvals: 0,
    approved_count: 0,
    rejected_count: 0,
    approval_rate: 0,
    broker_approval_enabled: false,
  },
};

/**
 * What Laravel actually returns for a tenant with no cached matches — captured
 * from the container on tenant 2. The fixtures above use canonical UI names and
 * `{}` for the count maps, which no backend produces: the service emits
 * analytics-service names, list-shaped distributions, and `[]` for every empty
 * string-keyed map (PHP's `json_encode` cannot distinguish an empty map from an
 * empty list). Rejecting that shape blanked the page with "Failed to load".
 */
const LIVE_EMPTY_TENANT_RESPONSE = {
  success: true,
  data: {
    overview: {
      total_cached_matches: 0,
      total_matches_month: 0,
      average_score: 0,
      average_distance_km: 0,
      match_type_breakdown: [],
      active_users_with_matches: 0,
      hot_matches: 0,
    },
    score_distribution: [
      { range: '0-20', count: 0 },
      { range: '21-40', count: 0 },
      { range: '41-60', count: 0 },
      { range: '61-80', count: 0 },
      { range: '81-100', count: 0 },
    ],
    distance_distribution: [
      { range: '0-5km', count: 0 },
      { range: '5-15km', count: 0 },
      { range: '15-30km', count: 0 },
      { range: '30-50km', count: 0 },
      { range: '50+km', count: 0 },
    ],
    broker_approval_enabled: true,
    pending_approvals: 0,
    approved_count: 0,
    rejected_count: 0,
    approval_rate: 0,
    gate_impact: {
      degraded_users_count: 4,
      active_users_count: 4,
      listings_without_coords: 1,
      remote_listings_count: 0,
      active_listings_count: 1,
      dismiss_reasons: [],
      algorithm_version_mix: [],
    },
    pillar_averages: { sample_size: 0, pillars: [] },
  },
};

describe('MatchingAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the live Laravel envelope for a tenant with no matches yet', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(LIVE_EMPTY_TENANT_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/score distribution/i)).toBeInTheDocument();
    });

    // The page must render its analytics, not the error state.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    expect(screen.getByText(/distance distribution/i)).toBeInTheDocument();
    // gate_impact parsed despite its empty `[]` count maps: its degraded-member
    // count only renders when the whole envelope survived validation.
    expect(screen.getByText(/location data readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/degraded members/i)).toBeInTheDocument();
    expect(screen.getByText(/of 4 active users/i)).toBeInTheDocument();
  });

  it('shows loading spinner while fetching', () => {
    mockAdminMatching.getMatchingStats.mockReturnValue(new Promise(() => {}));
    render(<MatchingAnalytics />);
    const statusEls = screen.queryAllByRole('status');
    const spinner = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders legitimate numeric zeroes without treating them as a load failure', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(EMPTY_STATS_RESPONSE);
    render(<MatchingAnalytics />);
    await waitFor(() => {
      // A fully shaped all-zero response is valid data, not an empty/error response.
      expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/no score data/i)).toBeInTheDocument();
    expect(screen.getByText(/no distance data/i)).toBeInTheDocument();
  });

  it('renders stat cards after data loads', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      // Approval rate stat card — StatCard renders value as <p>; use getAllByText since the
      // value also appears in the approval metrics section (two occurrences is expected)
      expect(screen.getAllByText('92%').length).toBeGreaterThan(0);
    });

    // Total matches this month — appears in both StatCard and activity row
    expect(screen.getAllByText(/^450$|^450,?0*$/).length).toBeGreaterThan(0);
  });

  it('renders score distribution bars', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/score distribution/i)).toBeInTheDocument();
    });
  });

  it('renders distance distribution bars', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/distance distribution/i)).toBeInTheDocument();
    });
  });

  it('renders matching activity panel with activity rows', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/matching activity/i)).toBeInTheDocument();
    });
  });

  it('renders approval metrics panel', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/approval metrics/i)).toBeInTheDocument();
    });
  });

  it('shows a retryable error without a toast when API fails', async () => {
    mockAdminMatching.getMatchingStats.mockRejectedValue(new Error('Network error'));
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load matching analytics/i);
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('has a Back button that navigates', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /back/i }).length).toBeGreaterThan(0);
    });
  });

  it('has a Refresh button that re-fetches data', async () => {
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<MatchingAnalytics />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent(refreshBtn, new MouseEvent('click', { bubbles: true }));

    await waitFor(() => {
      expect(mockAdminMatching.getMatchingStats).toHaveBeenCalledTimes(2);
    });
  });
});
