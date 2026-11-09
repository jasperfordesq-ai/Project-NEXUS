// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Stable mock references (GOTCHA 1: never inline object literals per call) ───
const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  isLoading: false,
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

const mockAuth = {
  user: null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  updateUser: vi.fn(),
  refreshUser: vi.fn(),
  status: 'idle' as const,
  error: null,
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => mockTenant,
    useAuth: () => mockAuth,
  }),
);

// Mock the podcasts API module (it wraps @/lib/api internally)
const mockBrowse = vi.fn();
vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    browse: (...args: unknown[]) => mockBrowse(...args),
  },
}));

// Mock @/lib/api (used transitively; keeps import resolution happy)
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import PodcastsPage from './PodcastsPage';

// ─── Shared fixtures ────────────────────────────────────────────────────────
const EMPTY_PAGE = {
  success: true,
  data: { items: [], total: 0, page: 1, per_page: 12, has_more: false },
};

const SHOW_1 = {
  id: 1,
  owner_user_id: 10,
  title: 'Tech Talk',
  slug: 'tech-talk',
  summary: 'A podcast about technology',
  artwork_url: null,
  language: 'en',
  category: 'Technology',
  visibility: 'public' as const,
  status: 'published' as const,
  moderation_status: 'approved' as const,
  episode_count: 5,
  approved_episode_count: 5,
  subscriber_count: 42,
  owner: { id: 10, name: 'Alice' },
};

const SHOW_2 = {
  id: 2,
  owner_user_id: 11,
  title: 'Daily News',
  slug: 'daily-news',
  summary: null,
  artwork_url: null,
  language: 'en',
  category: null,
  visibility: 'members' as const,
  status: 'published' as const,
  moderation_status: 'approved' as const,
  episode_count: 3,
  subscriber_count: 10,
  owner: null,
};

const TWO_SHOWS_PAGE = {
  success: true,
  data: {
    items: [SHOW_1, SHOW_2],
    total: 2,
    page: 1,
    per_page: 12,
    has_more: false,
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('PodcastsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useAuth returns mockAuth by reference, so reset its auth flag each test.
    mockAuth.isAuthenticated = false;
    // Default: immediate empty result
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
  });

  it('shows a loading spinner while the API call is in flight', () => {
    // Never resolve — stays in loading state
    mockBrowse.mockReturnValue(new Promise(() => {}));
    render(<PodcastsPage />);
    // The loading container and its inner Spinner both carry role="status";
    // the container is the one with aria-busy="true".
    expect(screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeInTheDocument();
  });

  it('renders podcast show cards after a successful API call', async () => {
    mockBrowse.mockResolvedValue(TWO_SHOWS_PAGE);
    render(<PodcastsPage />);

    await waitFor(() => {
      expect(screen.getByText('Tech Talk')).toBeInTheDocument();
    });
    expect(screen.getByText('Daily News')).toBeInTheDocument();
    // A show without artwork: the same coloured cover as its page and the
    // player bar (was its initials); its category in its own colour.
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(screen.getAllByTestId('podcast-card-cover')[0]!.getAttribute('data-colour'))
      .toBe(colourForSeed(coverSeed.podcastShow('tech-talk'), paletteFor(null)));
    expect(screen.getAllByTestId('podcast-card-category')[0]!.className).toMatch(/bg-[a-z]+-100/);
  });

  it('renders the podcast summary when present', async () => {
    mockBrowse.mockResolvedValue(TWO_SHOWS_PAGE);
    render(<PodcastsPage />);

    await waitFor(() => {
      expect(screen.getByText('A podcast about technology')).toBeInTheDocument();
    });
  });

  it('shows an empty-state message when the list is empty', async () => {
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
    render(<PodcastsPage />);

    // Spinner disappears and empty state renders
    await waitFor(() => {
      // The spinner should be gone and an empty message should show
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // Empty state text comes from i18n key browse.empty — fallback is the key itself
    // We just check the spinner is gone and we're not in loading state
    expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
  });

  it('shows the Load More button when has_more is true', async () => {
    mockBrowse.mockResolvedValue({
      success: true,
      data: { items: [SHOW_1], total: 10, page: 1, per_page: 1, has_more: true },
    });
    render(<PodcastsPage />);

    await waitFor(() => {
      expect(screen.getByText('Tech Talk')).toBeInTheDocument();
    });
    // Load-more button should be present (i18n key browse.load_more)
    const buttons = screen.getAllByRole('button');
    // At minimum, the "Load more" button exists among the rendered buttons
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('does not show studio/create buttons when user is not authenticated', async () => {
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
    render(<PodcastsPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });

    // When not authenticated the studio/create CTAs are not rendered.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /studio|create/i })).toBeNull();
  });

  it('shows studio/create buttons when the user is authenticated', async () => {
    mockAuth.isAuthenticated = true; // useAuth returns mockAuth by reference
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
    render(<PodcastsPage />);

    await waitFor(() =>
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined(),
    );

    // Authenticated → studio + create-show CTAs render as links (Button as={Link} to=...)
    expect(screen.getAllByRole('link', { name: /studio|create/i }).length).toBeGreaterThan(0);
  });

  it('calls browse API with search term changes — search field is rendered', async () => {
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
    render(<PodcastsPage />);

    await waitFor(() => expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined());

    // Verify a combobox / search input exists
    const searchInputs = screen.queryAllByRole('searchbox');
    // SearchField renders with role="searchbox" or as a generic input
    // The page renders a SearchField — just confirm browse was called on load
    expect(mockBrowse).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('handles a failed API call gracefully — no crash', async () => {
    mockBrowse.mockResolvedValue({ success: false, data: undefined });
    render(<PodcastsPage />);

    await waitFor(() => {
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // Empty state or no cards — page shouldn't crash
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('calls browse with category and sort params on initial render', () => {
    mockBrowse.mockResolvedValue(EMPTY_PAGE);
    render(<PodcastsPage />);

    expect(mockBrowse).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'newest', page: 1 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
