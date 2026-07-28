// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminSettings } = vi.hoisted(() => ({
  mockAdminSettings: {
    getAlgorithmConfig: vi.fn(),
    updateAlgorithmConfig: vi.fn(),
    getAlgorithmHealth: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

// ─── Toast / Contexts / Hooks ─────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub admin components ────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' directly, and vitest keys mocks per
// resolved module, so a barrel-only mock never installs for that import.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <span>{title}</span>
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeAlgorithmConfig = (overrides = {}) => ({
  feed: {
    enabled: true,
    affinity_weight: 0.3,
    content_type_weight: 0.25,
    time_decay_weight: 0.25,
    engagement_weight: 0.2,
    freshness_minimum: 0.1,
    half_life_hours: 24,
  },
  listings: {
    enabled: true,
    skill_match_weight: 0.3,
    location_weight: 0.2,
    quality_weight: 0.2,
    freshness_weight: 0.15,
    engagement_weight: 0.1,
    reputation_weight: 0.05,
  },
  members: {
    enabled: true,
    reputation_weight: 0.2,
    contribution_weight: 0.25,
    activity_weight: 0.25,
    connectivity_weight: 0.2,
    proximity_weight: 0.1,
  },
  matching: {
    enabled: true,
    skill_weight: 0.4,
    location_weight: 0.25,
    rating_weight: 0.2,
    availability_weight: 0.15,
  },
  ...overrides,
});

const makeHealth = (overrides = {}) => ({
  fulltext: {
    listings: true,
    users: true,
    feed_activity: true,
  },
  collaborative_filtering: {
    listing_interactions: 50,
    member_interactions: 30,
  },
  embeddings: {
    listing_count: 100,
    user_count: 80,
    total: 180,
  },
  search: {
    meilisearch_available: true,
    listing_index_count: 95,
  },
  ...overrides,
});

const configRes = (data = makeAlgorithmConfig()) => ({ success: true, data });
const healthRes = (data = makeHealth()) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('AlgorithmSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSettings.getAlgorithmConfig.mockResolvedValue(configRes());
    mockAdminSettings.getAlgorithmHealth.mockResolvedValue(healthRes());
    mockAdminSettings.updateAlgorithmConfig.mockResolvedValue({ success: true });
  });

  it('shows loading spinner while config is fetching', async () => {
    mockAdminSettings.getAlgorithmConfig.mockImplementationOnce(() => new Promise(() => {}));
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders page header after config loads', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });
  });

  it('shows error toast and renders defaults when config load throws', async () => {
    mockAdminSettings.getAlgorithmConfig.mockRejectedValueOnce(new Error('network'));
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      // Should still render with defaults
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });
  });

  it('renders all four algorithm area cards (feed, listings, members, matching)', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // Each area has a Save Area button when enabled
      const saveBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('save')
      );
      // 4 algorithm areas + 1 health refresh = at least 4 save buttons
      expect(saveBtns.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('calls updateAlgorithmConfig when save is clicked for an area', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() =>
      screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('save')
      ).length > 0
    );

    const saveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('save')
    );

    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(mockAdminSettings.updateAlgorithmConfig).toHaveBeenCalled();
    });
  });

  it('shows success toast on successful save', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() =>
      screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('save')
      ).length > 0
    );

    const saveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when save fails', async () => {
    mockAdminSettings.updateAlgorithmConfig.mockRejectedValueOnce(new Error('fail'));
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() =>
      screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('save')
      ).length > 0
    );

    const saveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders health dashboard with fulltext chips when health loads', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // Fulltext chips: listings, users, feed_activity
      expect(screen.getByText('listings')).toBeInTheDocument();
      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.getByText('feed_activity')).toBeInTheDocument();
    });
  });

  it('renders collaborative filtering interaction counts', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
    });
  });

  it('renders Meilisearch online chip when available', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // The chip text contains "meilisearch" + online/offline
      const elements = screen.getAllByText(/meilisearch/i);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('shows health unavailable message when health returns null data', async () => {
    mockAdminSettings.getAlgorithmHealth.mockResolvedValueOnce({ success: true, data: null });
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // health is null → shows unavailable text
      // Also healthLoading is false so the "unavailable" branch renders
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });

    // The health section shows "unavailable" when health=null and not loading
    // We check that fulltext chips are NOT present (health didn't load)
    expect(screen.queryByText('feed_activity')).not.toBeInTheDocument();
  });

  it('renders Refresh button for health and calls getAlgorithmHealth again on click', async () => {
    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('refresh')
      )
    );

    const refreshBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh')
    );
    expect(refreshBtn).toBeDefined();
    fireEvent.click(refreshBtn!);

    await waitFor(() => {
      // called once on mount, once on click
      expect(mockAdminSettings.getAlgorithmHealth.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows algorithm_disabled_msg when area is toggled off', async () => {
    // Load config with feed disabled
    const disabledFeedConfig = makeAlgorithmConfig({
      feed: { ...makeAlgorithmConfig().feed, enabled: false },
    });
    mockAdminSettings.getAlgorithmConfig.mockResolvedValueOnce(configRes(disabledFeedConfig));

    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // When an area is disabled, the component renders the algorithm_disabled_msg
      // text (i18n key falls back to key string in test env)
      // Also the Switch label shows "disabled" text
      // Check for the disabled label text rendered beside the switch
      const disabledLabel = screen.getAllByText(/disabled/i);
      expect(disabledLabel.length).toBeGreaterThan(0);
    });
  });

  it('shows warning hint when fulltext index is missing', async () => {
    mockAdminSettings.getAlgorithmHealth.mockResolvedValueOnce(
      healthRes(makeHealth({
        fulltext: { listings: false, users: true, feed_activity: true },
      }))
    );

    const { AlgorithmSettings } = await import('./AlgorithmSettings');
    render(<AlgorithmSettings />);

    await waitFor(() => {
      // When any fulltext index is false, warning hint appears
      // The hint text contains "safe_migrate.php"
      expect(screen.getByText(/safe_migrate\.php/i)).toBeInTheDocument();
    });
  });
});
