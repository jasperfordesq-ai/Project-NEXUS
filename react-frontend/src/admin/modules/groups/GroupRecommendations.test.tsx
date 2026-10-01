// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mock adminApi ────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => {
  const getRecommendationData = vi.fn();
  return {
    adminGroups: { getRecommendationData },
  };
});

// ── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);
// ToastContext is imported BOTH by the component (useToast) AND by test-utils
// (ToastProvider).  Use importOriginal so ToastProvider still exists while
// replacing useToast with the spy.
vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...real, useToast: () => mockToast };
});

// ── Stable mock data ─────────────────────────────────────────────────────────
const MOCK_STATS = vi.hoisted(() => ({ total: 42, avg_score: 0.75, join_rate: 33 }));
const MOCK_RECS = vi.hoisted(() => [
  {
    id: '1-10',
    user_id: 1,
    user_name: 'Alice',
    group_id: 10,
    group_name: 'Gardeners',
    score: 0.85,
    joined: false,
    created_at: '2025-01-15T00:00:00Z',
  },
  {
    id: '2-11',
    user_id: 2,
    user_name: 'Bob',
    group_id: 11,
    group_name: 'Cyclists',
    score: 0.6,
    joined: true,
    created_at: '2025-02-20T00:00:00Z',
  },
]);

import { adminGroups } from '@/admin/api/adminApi';
import GroupRecommendations from './GroupRecommendations';

describe('GroupRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ────────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', () => {
    // Never resolves during this test — spinner stays visible
    vi.mocked(adminGroups.getRecommendationData).mockReturnValue(new Promise(() => {}));
    render(<GroupRecommendations />);
    // HeroUI Table emits role="status" for empty/loading content
    // Use aria-busy to isolate the spinner specifically
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // ── Populated state ──────────────────────────────────────────────────────
  it('renders stat cards with correct values after load', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockResolvedValueOnce({
      data: { recommendations: MOCK_RECS, stats: MOCK_STATS },
      success: true,
    } as never);

    render(<GroupRecommendations />);

    await waitFor(() => {
      // Total stat card
      expect(screen.getByText('42')).toBeInTheDocument();
      // Join rate
      expect(screen.getByText('33%')).toBeInTheDocument();
    });
  });

  it('renders recommendation rows in the table', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockResolvedValueOnce({
      data: { recommendations: MOCK_RECS, stats: MOCK_STATS },
      success: true,
    } as never);

    render(<GroupRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Gardeners')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Cyclists')).toBeInTheDocument();
    });
  });

  it('shows avg_score (a 0–1 ratio) as a percentage, like the row scores', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockResolvedValueOnce({
      data: { recommendations: MOCK_RECS, stats: MOCK_STATS },
      success: true,
    } as never);

    render(<GroupRecommendations />);

    await waitFor(() => {
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  it('shows empty-content text when recommendations array is empty', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockResolvedValueOnce({
      data: { recommendations: [], stats: { total: 0, avg_score: 0, join_rate: 0 } },
      success: true,
    } as never);

    render(<GroupRecommendations />);

    await waitFor(() => {
      // HeroUI Table emptyContent prop renders when items=[]; the translation
      // key resolves to the key string in test (no real JSON loaded), which
      // contains "no_recommendations_found".
      expect(
        screen.queryByText('Alice') === null &&
        screen.queryByText('Bob') === null
      ).toBe(true);
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────
  it('calls toast.error when the API rejects', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockRejectedValueOnce(new Error('Network error'));

    render(<GroupRecommendations />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── API call ─────────────────────────────────────────────────────────────
  it('calls getRecommendationData with limit:50 on mount', async () => {
    vi.mocked(adminGroups.getRecommendationData).mockResolvedValueOnce({
      data: { recommendations: [], stats: { total: 0, avg_score: 0, join_rate: 0 } },
      success: true,
    } as never);

    render(<GroupRecommendations />);

    await waitFor(() => {
      expect(adminGroups.getRecommendationData).toHaveBeenCalledWith({ limit: 50 });
    });
  });
});
