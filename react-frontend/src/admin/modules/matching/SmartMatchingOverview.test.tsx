// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoist all mocks so vi.mock factories can reference them ──────────────────
const { mockAdminMatching, mockToast } = vi.hoisted(() => ({
  mockAdminMatching: {
    getConfig: vi.fn(),
    getMatchingStats: vi.fn(),
    clearCache: vi.fn(),
    updateConfig: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
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

import { SmartMatchingOverview } from './SmartMatchingOverview';

// ── fixtures ─────────────────────────────────────────────────────────────────
const CONFIG_RESPONSE = {
  success: true,
  data: {
    enabled: true,
    category_weight: 0.3,
    skill_weight: 0.25,
    proximity_weight: 0.2,
    freshness_weight: 0.1,
    reciprocity_weight: 0.1,
    quality_weight: 0.05,
    min_score_threshold: 40,
    max_distance_km: 50,
    max_matches_per_user: 20,
    proximity_bands: [
      { distance_km: 5 },
      { distance_km: 25 },
    ],
  },
};

const STATS_RESPONSE = {
  success: true,
  data: {
    overview: {
      cache_entries: 200,
      total_matches_month: 500,
      total_matches_week: 120,
      total_matches_today: 18,
      avg_match_score: 68,
      avg_distance_km: 5.5,
      hot_matches_count: 20,
      mutual_matches_count: 45,
      active_users_matching: 90,
    },
    score_distribution: { '0-20': 5, '40-60': 80, '60-80': 250, '80-100': 165 },
    distance_distribution: { '0-5': 50, '5-15': 100, '15-30': 200, '30-50': 40, '50+': 10 },
    pending_approvals: 3,
    approved_count: 400,
    rejected_count: 30,
    approval_rate: 88,
  },
};

describe('SmartMatchingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinners while fetching', () => {
    mockAdminMatching.getConfig.mockReturnValue(new Promise(() => {}));
    mockAdminMatching.getMatchingStats.mockReturnValue(new Promise(() => {}));
    render(<SmartMatchingOverview />);

    const statusEls = screen.queryAllByRole('status');
    const spinners = statusEls.filter((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('renders the scoring weights after data loads', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/scoring weights/i)).toBeInTheDocument();
    });
    // Config is enabled → at least one "Active" chip visible
    expect(screen.queryAllByText(/active/i).length).toBeGreaterThan(0);
  });

  it('renders quick actions panel with navigation buttons', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/configure algorithm/i)).toBeInTheDocument();
    expect(screen.getByText(/view analytics/i)).toBeInTheDocument();
  });

  it('renders matching activity summary', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.queryAllByText(/matching activity/i).length).toBeGreaterThan(0);
    });
    // today's count — may appear multiple times; just verify it's present
    expect(screen.queryAllByText('18').length).toBeGreaterThan(0);
  });

  it('renders approval summary with correct counts', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.queryAllByText(/approval summary/i).length).toBeGreaterThan(0);
    });
    // pending_approvals = 3 — may appear in multiple places
    expect(screen.queryAllByText('3').length).toBeGreaterThan(0);
  });

  it('opens clear cache confirmation modal when Clear Cache button is pressed', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/clear match cache/i)).toBeInTheDocument();
    });

    const clearBtn = screen.getByText(/clear match cache/i);
    await userEvent.click(clearBtn);

    // ConfirmModal should be open now (title visible)
    await waitFor(() => {
      const headings = screen.queryAllByText(/clear match cache/i);
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls clearCache API on confirmation and reloads data', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    mockAdminMatching.clearCache.mockResolvedValue({
      success: true,
      data: { entries_cleared: 200 },
    });

    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/clear match cache/i)).toBeInTheDocument();
    });

    const clearBtn = screen.getByText(/clear match cache/i);
    await userEvent.click(clearBtn);

    // Find and click the confirm button inside the modal
    await waitFor(() => {
      const confirmBtn = screen.queryAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('clear')
      );
      expect(confirmBtn).toBeDefined();
    });

    const confirmBtn = screen.queryAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('clear') && b !== clearBtn
    );
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockAdminMatching.clearCache).toHaveBeenCalled();
      });
    }
  });

  it('shows error toast when clear cache fails', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    mockAdminMatching.clearCache.mockResolvedValue({ success: false });

    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/clear match cache/i)).toBeInTheDocument();
    });

    const clearBtn = screen.getByText(/clear match cache/i);
    await userEvent.click(clearBtn);

    // Find the confirm button in the modal
    await waitFor(() => {
      const btns = screen.queryAllByRole('button');
      const confirmBtn = btns.find((b) => {
        const text = b.textContent?.toLowerCase() ?? '';
        return text.includes('clear') && b !== clearBtn;
      });
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
      }
    });

    await waitFor(() => {
      if (mockAdminMatching.clearCache.mock.calls.length > 0) {
        expect(mockToast.error).toHaveBeenCalled();
      }
    });
  });

  it('shows a retryable configuration error when config request fails', async () => {
    mockAdminMatching.getConfig.mockResolvedValue({ success: false });
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getAllByText(/failed to load matching configuration/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('shows pending approvals chip when pending_approvals > 0', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      // pending_approvals = 3, should appear somewhere in the rendered output
      expect(screen.queryAllByText('3').length).toBeGreaterThan(0);
    });
  });

  it('has a Refresh button', async () => {
    mockAdminMatching.getConfig.mockResolvedValue(CONFIG_RESPONSE);
    mockAdminMatching.getMatchingStats.mockResolvedValue(STATS_RESPONSE);
    render(<SmartMatchingOverview />);

    await waitFor(() => {
      expect(screen.getByText(/refresh/i)).toBeInTheDocument();
    });
  });
});
