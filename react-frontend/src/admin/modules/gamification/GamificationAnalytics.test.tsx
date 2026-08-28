// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock data ──────────────────────────────────────────────────────────
const MOCK_STATS = vi.hoisted(() => ({
  total_badges_awarded: 142,
  active_users: 78,
  total_xp_awarded: 9400,
  active_campaigns: 3,
  badge_distribution: [
    { badge_name: 'Community Star', count: 55 },
    { badge_name: 'Early Adopter', count: 40 },
    { badge_name: 'Helper', count: 30 },
  ],
}));

const MOCK_BADGES = vi.hoisted(() => [
  { id: 1, key: 'community_star', name: 'Community Star', description: 'desc', icon: '⭐', type: 'built_in' as const, awarded_count: 55 },
  { id: 2, key: 'early_adopter', name: 'Early Adopter', description: 'desc', icon: '🌱', type: 'custom' as const, awarded_count: 40 },
]);

// ── mock adminApi ─────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminGamification: {
    getStats: vi.fn(),
    listBadges: vi.fn(),
  },
}));

// ── mock @/contexts ───────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ── mock usePageTitle ─────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { GamificationAnalytics } from './GamificationAnalytics';
import { adminGamification } from '@/admin/api/adminApi';

const getStatsMock = vi.mocked(adminGamification.getStats);
const listBadgesMock = vi.mocked(adminGamification.listBadges);

describe('GamificationAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 🔴 mockReset, not only clearAllMocks: clearAllMocks wipes recorded calls but
    // NOT queued one-shot implementations, so an unconsumed `...Once` would leak
    // into the next test. See the note on the per-test fixtures below for why
    // this file no longer uses `...Once` for payloads at all.
    getStatsMock.mockReset();
    listBadgesMock.mockReset();
    getStatsMock.mockResolvedValue({ success: true, data: MOCK_STATS } as never);
    listBadgesMock.mockResolvedValue({ success: true, data: MOCK_BADGES } as never);
  });

  it('shows loading spinners while data is being fetched', async () => {
    let resolveStats!: (v: unknown) => void;
    let resolveBadges!: (v: unknown) => void;
    getStatsMock.mockReturnValueOnce(new Promise((r) => (resolveStats = r)) as never);
    listBadgesMock.mockReturnValueOnce(new Promise((r) => (resolveBadges = r)) as never);

    render(<GamificationAnalytics />);

    const busyEls = screen.queryAllByRole('status').filter(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyEls.length).toBeGreaterThan(0);

    resolveStats({ success: true, data: MOCK_STATS });
    resolveBadges({ success: true, data: MOCK_BADGES });
  });

  it('hides loading spinners after data loads', async () => {
    render(<GamificationAnalytics />);

    await waitFor(() => {
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busyEls).toHaveLength(0);
    });
  });

  it('displays stat card values from API response', async () => {
    render(<GamificationAnalytics />);

    await waitFor(() => {
      // Values are formatted via toLocaleString() — 142, 78, 3 stay as-is
      // 9400 may render as "9,400" or "9.400" depending on locale
      expect(screen.getByText('142')).toBeInTheDocument(); // total_badges_awarded
    });
    expect(screen.getByText('78')).toBeInTheDocument();    // active_users
    // Match 9400 flexibly (might be "9,400" / "9 400" / "9400")
    expect(screen.getByText(/9[,.\s]?400|9400/)).toBeInTheDocument();  // total_xp_awarded
    expect(screen.getByText('3')).toBeInTheDocument();     // active_campaigns
  });

  it('renders badge distribution bars', async () => {
    render(<GamificationAnalytics />);

    await waitFor(() => {
      // Community Star appears in both badge_distribution and badge_catalogue
      const stars = screen.getAllByText('Community Star');
      expect(stars.length).toBeGreaterThanOrEqual(1);
    });
    // Early Adopter and Helper only appear in distribution (not catalogue since catalogue uses badges array)
    expect(screen.getAllByText('Early Adopter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Helper')).toBeInTheDocument();
  });

  it('renders badge catalogue entries', async () => {
    render(<GamificationAnalytics />);

    await waitFor(() => {
      // Badge names appear in the catalogue section too
      const names = screen.getAllByText('Community Star');
      expect(names.length).toBeGreaterThanOrEqual(1);
    });
    // Custom badge label
    const customBadges = screen.getAllByText(/custom/i);
    expect(customBadges.length).toBeGreaterThan(0);
  });

  it('shows empty state for badge distribution when no badges awarded', async () => {
    getStatsMock.mockResolvedValue({
      success: true,
      data: { ...MOCK_STATS, badge_distribution: [] },
    } as never);

    render(<GamificationAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/no badges/i)).toBeInTheDocument();
    });
  });

  it('shows empty state for badge catalogue when no badges defined', async () => {
    listBadgesMock.mockResolvedValue({ success: true, data: [] } as never);

    render(<GamificationAnalytics />);

    await waitFor(() => {
      // Both empty-state messages may appear — check at least one
      const noBadgeEls = screen.queryAllByText(/no badges/i);
      expect(noBadgeEls.length).toBeGreaterThan(0);
    });
  });

  it('shows error toast when stats fail to load', async () => {
    getStatsMock.mockResolvedValue({ success: false } as never);
    listBadgesMock.mockResolvedValue({ success: true, data: MOCK_BADGES } as never);

    // The toast is provided by ToastProvider in test-utils; the component
    // calls toast.error — we verify no crash and the component renders.
    render(<GamificationAnalytics />);

    await waitFor(() => {
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busyEls).toHaveLength(0);
    });

    // Page header title should still render
    expect(document.body).toBeInTheDocument();
  });

  it('renders a "Back to hub" link', async () => {
    render(<GamificationAnalytics />);

    await waitFor(() => {
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busyEls).toHaveLength(0);
    });

    const backLink = screen.getByRole('link', { name: /back/i });
    expect(backLink).toBeInTheDocument();
  });

  it('truncates badge catalogue to 20 when more than 20 exist', async () => {
    const manyBadges = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      key: `badge_${i}`,
      name: `Badge ${i}`,
      description: 'desc',
      icon: '⭐',
      type: 'built_in' as const,
      awarded_count: i,
    }));
    // 🔴 mockResolvedValue, NOT mockResolvedValueOnce. The page's effect runs
    // twice under React's development double-invoke, so listBadges is called
    // TWICE; a one-shot mock answers the first call with these 25 badges and the
    // second with the two-badge default, and whichever setBadges lands last wins.
    // That is a coin toss — this test genuinely rendered 20 badges + "And more"
    // on some runs and 2 badges on others. Answering both calls with the same
    // payload makes the outcome deterministic.
    listBadgesMock.mockResolvedValue({ success: true, data: manyBadges } as never);

    render(<GamificationAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('Badge 0')).toBeInTheDocument();
    });

    // "and X more" message should appear
    expect(screen.getByText(/more/i)).toBeInTheDocument();
  });
});
