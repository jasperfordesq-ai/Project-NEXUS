// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── mock api ──────────────────────────────────────────────────────────────────
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ default: mockApi, api: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── mock contexts ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ── mock motion shim so framer-motion doesn't cause issues in test env ────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import PersonalJourneyTab from './PersonalJourneyTab';

const MOCK_JOURNEY = {
  summary: {
    xp: 1500,
    level: 3,
    level_name: 'MasterConnector',  // unique string to avoid multiple-match issues
    total_badges: 5,
    total_listings: 10,
    volunteer_hours: 20,
    total_connections: 8,
    total_reviews: 4,
    member_since: '2024-03-15',  // unique date string
  },
  monthly_activity: [
    { month: 'Jan 2024', badges: 1, xp_earned: 300 },
    { month: 'Feb 2024', badges: 2, xp_earned: 600 },
  ],
  badge_progression: [
    { badge_key: 'first_trade', name: 'First Trade Badge', icon: '🤝', earned_at: '2024-01-20' },
    { badge_key: 'connector', name: 'Network Connector', icon: '🔗', earned_at: null },
  ],
  milestones: [
    { type: 'joined', label: 'Joined the platform community', date: '2024-01-15' },
    { type: 'first_listing', label: 'Posted a first listing item', date: '2024-01-16' },
  ],
};

describe('PersonalJourneyTab', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── loading state ─────────────────────────────────────────────────────────

  it('shows skeleton cards while fetching (no summary content)', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<PersonalJourneyTab />);

    // Loading state renders skeleton placeholders — level_name not yet visible
    expect(screen.queryByText('MasterConnector')).not.toBeInTheDocument();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders level_name in summary after successful load', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(screen.getAllByText('MasterConnector').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders total_badges count', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      // total_badges = 5; total_listings = 10; etc — use getAllByText for numeric values
      expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders monthly activity bars', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      // XP values appear as labels above bars
      expect(screen.getByText('300')).toBeInTheDocument();
      expect(screen.getByText('600')).toBeInTheDocument();
    });
  });

  it('renders badge progression entries', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(screen.getByText('First Trade Badge')).toBeInTheDocument();
      expect(screen.getByText('Network Connector')).toBeInTheDocument();
    });
  });

  it('renders milestone entries', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(screen.getByText('Joined the platform community')).toBeInTheDocument();
      expect(screen.getByText('Posted a first listing item')).toBeInTheDocument();
    });
  });

  it('renders member_since summary card', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      // member_since value is displayed as-is in the SummaryCard
      expect(screen.getAllByText('2024-03-15').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── empty sections ────────────────────────────────────────────────────────

  it('does not render activity chart when monthly_activity is empty', async () => {
    const emptyActivity = { ...MOCK_JOURNEY, monthly_activity: [] };
    mockApi.get.mockResolvedValueOnce({ success: true, data: emptyActivity });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(screen.getAllByText('MasterConnector').length).toBeGreaterThanOrEqual(1);
    });
    // No XP bar labels
    expect(screen.queryByText('300')).not.toBeInTheDocument();
    expect(screen.queryByText('600')).not.toBeInTheDocument();
  });

  it('does not render badge timeline when badge_progression is empty', async () => {
    const noBadges = { ...MOCK_JOURNEY, badge_progression: [] };
    mockApi.get.mockResolvedValueOnce({ success: true, data: noBadges });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(screen.getAllByText('MasterConnector').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('First Trade Badge')).not.toBeInTheDocument();
  });

  // ── degraded backend fallback ─────────────────────────────────────────────

  it('renders without crashing when summary comes back as an empty array', async () => {
    // Regression: the backend's catch-fallback returns summary:[] (an array, not
    // the typed object) inside a 200 { success:true } envelope. The component used
    // to read summary.xp.toLocaleString() unconditionally, which threw a TypeError
    // on the [] fallback and crashed the whole Leaderboard via its error boundary.
    // It must now degrade to zeros instead. Verified live by shimming the endpoint.
    mockApi.get.mockResolvedValueOnce({
      success: true,
      data: { summary: [], monthly_activity: [], badge_progression: [], milestones: [] },
    });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/gamification/personal-journey');
    });
    // The summary grid renders past the previously-throwing XP card — the zeroed
    // numeric cards (badges/listings/volunteer/connections) are present.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    // It is a (degraded) success, not the error state.
    expect(document.querySelector('.text-danger-soft-foreground')).toBeNull();
  });

  // ── error state ───────────────────────────────────────────────────────────

  it('renders error paragraph when API returns success=false', async () => {
    mockApi.get.mockResolvedValueOnce({ success: false, error: 'Server error' });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      // Error state renders a <p> with class text-danger-soft-foreground
      const errorEl = document.querySelector('.text-danger-soft-foreground');
      expect(errorEl).not.toBeNull();
    });
  });

  it('renders error paragraph when API call throws', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('Network failure'));
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      const errorEl = document.querySelector('.text-danger-soft-foreground');
      expect(errorEl).not.toBeNull();
    });
  });

  // ── API call ──────────────────────────────────────────────────────────────

  it('calls /v2/gamification/personal-journey on mount', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: MOCK_JOURNEY });
    render(<PersonalJourneyTab />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/gamification/personal-journey');
    });
  });
});
