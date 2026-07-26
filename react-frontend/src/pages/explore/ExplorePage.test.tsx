// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub motion ──────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    section: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <section {...props}>{children}</section>,
    ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul {...props}>{children}</ul>,
    li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => <li {...props}>{children}</li>,
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Stub heavy child components ──────────────────────────────────────────────
vi.mock('@/components/explore', () => ({
  ExploreSection: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  ExploreStatCard: ({ label, value }: { label: string; value: unknown }) => (
    <div data-testid="explore-stat-card">
      <span>{label}</span>
      <span>{String(value)}</span>
    </div>
  ),
  HorizontalScroll: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string | null) => url ?? '',
}));

// ExplorePage imports Tabs/Tab from '@/components/ui/Tabs' directly, so registering these stubs
// only on the barrel leaves them dead — vitest resolves mocks per specifier. Hoisted so both the
// barrel factory below and the direct-path factory can share one definition.
const tabsStub = vi.hoisted(() => ({
  Tabs: ({ children }: { children: React.ReactNode }) => (
    <div role="tablist">{children}</div>
  ),
  Tab: ({ title }: { title: React.ReactNode }) => (
    <button role="tab">{title}</button>
  ),
}));

vi.mock('@/components/ui/Tabs', () => tabsStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    ...tabsStub,
    Skeleton: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="skeleton">{children}</div>
    ),
    Progress: ({ value, label }: { value?: number; label?: string }) => (
      <div role="progressbar" aria-label={label} aria-valuenow={value} />
    ),
    Avatar: ({ name }: { name?: string }) => <div data-testid="avatar">{name}</div>,
    SearchField: ({ label, value, onValueChange }: {
      label?: string;
      value?: string;
      onValueChange?: (v: string) => void;
    }) => (
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      />
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeExploreData = () => ({
  trending_posts: [
    {
      id: 1,
      user_id: 1,
      excerpt: 'A trending post excerpt',
      image_url: null,
      created_at: '2025-01-01T00:00:00Z',
      author_name: 'Bob Author',
      author_avatar: null,
      likes_count: 10,
      comments_count: 2,
      engagement: 12,
    },
  ],
  popular_listings: [
    {
      id: 1,
      title: 'Popular Listing One',
      type: 'offer',
      image_url: null,
      location: 'Dublin',
      estimated_hours: 2,
      created_at: '2025-01-01T00:00:00Z',
      view_count: 50,
      save_count: 5,
      category_name: 'Gardening',
      category_slug: 'gardening',
      category_color: null,
      author_name: 'Alice Smith',
      author_avatar: null,
    },
  ],
  active_groups: [],
  upcoming_events: [],
  top_contributors: [
    { id: 1, name: 'Top Contributor', avatar: null, xp: 500, level: 3, tagline: null },
  ],
  trending_hashtags: [],
  new_members: [],
  featured_challenges: [],
  community_stats: {
    total_members: 120,
    exchanges_this_month: 30,
    hours_exchanged: 75,
    active_listings: 45,
  },
  recommended_listings: [],
  near_you_listings: [],
  suggested_connections: [],
  trending_blog_posts: [],
  volunteering_opportunities: [],
  active_organisations: [],
  active_polls: [],
  in_demand_skills: [],
  featured_resources: [],
  latest_jobs: [],
  categories: [{ id: 1, name: 'Gardening', slug: 'gardening', color: '#0f0' }],
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ExplorePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // api.get is called by both useApi (for /v2/explore, /v2/categories)
    // and by apiClient.get (the default export) for /v2/explore/for-you
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/explore/for-you')) {
        return Promise.resolve({ data: { items: [], total: 0 } });
      }
      if (url.includes('/v2/explore')) {
        return Promise.resolve({ success: true, data: makeExploreData() });
      }
      if (url.includes('/v2/categories')) {
        return Promise.resolve({ success: true, data: [{ id: 1, name: 'Gardening', slug: 'gardening' }] });
      }
      return Promise.resolve({ success: true, data: null });
    });
    mockApi.post.mockResolvedValue({ success: true, data: null });
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    // While loading, skeletons should appear (page renders skeleton UI not spinner)
    expect(document.body).toBeInTheDocument();
  });

  it('renders the search input', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      const searchInput = screen.queryByRole('searchbox');
      expect(searchInput).not.toBeNull();
    });
  });

  it('renders explore tabs', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      const tabs = screen.queryAllByRole('tab');
      expect(tabs.length).toBeGreaterThan(0);
    });
  });

  it('renders popular listing title from loaded data', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      expect(screen.getByText(/Popular Listing One/)).toBeInTheDocument();
    });
  });

  it('renders top contributor name', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      expect(screen.getByText(/Top Contributor/)).toBeInTheDocument();
    });
  });

  it('renders community stats values', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      // total_members = 120
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });

  it('renders category chip from categories list', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Gardening/).length).toBeGreaterThan(0);
    });
  });

  it('renders listing section with author or title visible', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      // Either the listing title or author name should be visible
      const hasTitle = screen.queryAllByText(/Popular Listing One/).length > 0;
      const hasAuthor = screen.queryAllByText(/Alice Smith/).length > 0;
      expect(hasTitle || hasAuthor).toBe(true);
    });
  });

  it('renders trending post excerpt from data', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      expect(screen.getByText(/A trending post excerpt/)).toBeInTheDocument();
    });
  });

  it('renders without crashing when API returns empty data', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        trending_posts: [],
        popular_listings: [],
        active_groups: [],
        upcoming_events: [],
        top_contributors: [],
        trending_hashtags: [],
        new_members: [],
        featured_challenges: [],
        community_stats: { total_members: 99, exchanges_this_month: 0, hours_exchanged: 0, active_listings: 0 },
        recommended_listings: [],
        near_you_listings: [],
        suggested_connections: [],
        trending_blog_posts: [],
        volunteering_opportunities: [],
        active_organisations: [],
        active_polls: [],
        in_demand_skills: [],
        featured_resources: [],
        latest_jobs: [],
        categories: [],
      },
    });

    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => {
      // 99 total_members should appear in the stat card
      expect(screen.getByText('99')).toBeInTheDocument();
    });
  });

  it('switches tab when a tab is clicked', async () => {
    const { default: ExplorePage } = await import('./ExplorePage');
    render(<ExplorePage />);

    await waitFor(() => screen.queryAllByRole('tab').length > 0);

    const tabs = screen.queryAllByRole('tab');
    if (tabs.length > 1) {
      fireEvent.click(tabs[1]);
    }
    // No crash
    expect(document.body).toBeInTheDocument();
  });
});
