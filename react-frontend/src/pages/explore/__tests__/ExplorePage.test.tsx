// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ExplorePage — the community explore/discovery page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// ── Stable mock references (avoid infinite re-render loops) ──────────────────

const mockTenantPath = (p: string) => `/test${p}`;
const mockHasFeature = vi.fn(() => true);
const mockTenant = {
  tenantPath: mockTenantPath,
  hasFeature: mockHasFeature,
  hasModule: vi.fn(() => true),
  tenant: { id: 1, name: 'Test', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null },
  features: [],
  configuration: {},
  isLoading: false,
};

const mockAuth = {
  user: { id: 1, name: 'Test User' },
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  updateUser: vi.fn(),
  refreshUser: vi.fn(),
  status: 'idle' as const,
  error: null,
};

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () => ({
  useTenant: () => mockTenant,
  useAuth: () => mockAuth,
  useToast: () => mockToast,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

// ── Mock useApi with configurable return ─────────────────────────────────────

const mockExecute = vi.fn();

const mockExploreData = {
  trending_posts: [
    { id: 1, user_id: 1, excerpt: 'A trending post', image_url: null, created_at: '2026-03-22T10:00:00Z', author_name: 'Alice', author_avatar: null, likes_count: 5, comments_count: 2, engagement: 7 },
  ],
  popular_listings: [
    { id: 10, title: 'Popular Listing', type: 'offer', image_url: null, location: 'Dublin', estimated_hours: 2, created_at: '2026-03-22T10:00:00Z', view_count: 50, save_count: 10, category_name: 'Tech', category_slug: 'tech', category_color: '#3b82f6', author_name: 'Bob', author_avatar: null },
  ],
  active_groups: [],
  upcoming_events: [],
  top_contributors: [],
  trending_hashtags: [
    { id: 1, tag: 'timebanking', post_count: 42, last_used_at: '2026-03-22T10:00:00Z' },
  ],
  new_members: [
    { id: 99, name: 'Newbie', avatar: null, tagline: 'Hello!', created_at: '2026-03-22T10:00:00Z' },
  ],
  featured_challenges: [],
  community_stats: { total_members: 100, exchanges_this_month: 25, hours_exchanged: 150, active_listings: 42 },
  recommended_listings: [
    { id: 200, title: 'Recommended Item', type: 'offer', image_url: null, location: null, category_name: 'Tech', category_slug: 'tech', author_name: 'Eve', author_avatar: null, match_reason: 'Skills match your expertise', match_score: 85, distance_km: 3.2 },
  ],
  // Phase 1+2 — new sections
  near_you_listings: [
    { id: 300, title: 'Nearby Listing', type: 'offer', image_url: null, location: 'Park', category_name: 'Gardening', category_slug: 'gardening', author_name: 'Frank', author_avatar: null, distance_km: 2.5 },
  ],
  suggested_connections: [
    { id: 400, name: 'Suggested User', avatar: null, tagline: 'Loves coding', reason: 'Similar interests' },
  ],
  trending_blog_posts: [
    { id: 500, title: 'Blog Post', slug: 'blog-post', excerpt: 'An excerpt', image_url: null, published_at: '2026-03-22T10:00:00Z', reading_time: 5, view_count: 100, author_name: 'Grace', author_avatar: null },
  ],
  volunteering_opportunities: [
    { id: 600, title: 'Help at Shelter', description: 'Volunteer work', location: 'City', skills_needed: 'care', org_name: 'Shelter Org', org_logo: null, application_count: 3, created_at: '2026-03-22T10:00:00Z' },
  ],
  active_organisations: [
    { id: 700, name: 'Community Org', description: 'Helping people', logo_url: null, website_url: null, opportunity_count: 5 },
  ],
  active_polls: [
    { id: 800, question: 'Best feature?', description: null, author_name: 'Admin', option_count: 4, vote_count: 20, closes_at: null, created_at: '2026-03-22T10:00:00Z' },
  ],
  in_demand_skills: [
    { skill_name: 'Gardening', request_count: 15, offer_count: 8 },
  ],
  featured_resources: [
    { id: 900, title: 'Getting Started Guide', description: 'How to use the platform', resource_type: 'guide', url: null, view_count: 50, category_name: 'Guides' },
  ],
  latest_jobs: [
    { id: 1000, title: 'Community Manager', description: 'Join our team', location: 'Remote', org_name: 'HQ', application_count: 7, deadline: '2026-04-01T00:00:00Z', created_at: '2026-03-22T10:00:00Z' },
  ],
};

const mockState = {
  useApiReturn: {
    data: mockExploreData,
    isLoading: false,
    error: null,
    execute: mockExecute,
  } as Record<string, unknown>,
  categoriesReturn: {
    data: [
      { id: 1, name: 'Tech', slug: 'tech', color: '#3b82f6' },
      { id: 2, name: 'Art', slug: 'art' },
    ],
    isLoading: false,
    error: null,
    execute: vi.fn(),
  } as Record<string, unknown>,
};

vi.mock('@/hooks/useApi', () => ({
  useApi: (url: string) => {
    if (url.includes('categories')) return mockState.categoriesReturn;
    return mockState.useApiReturn;
  },
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useApi: (url: string) => {
    if (url.includes('categories')) return mockState.categoriesReturn;
    return mockState.useApiReturn;
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : key;
      const vars = typeof fallbackOrOpts === 'object' ? fallbackOrOpts : opts;
      if (!vars) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? `{{${k}}}`));
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url || '',
  resolveAssetUrl: (url: string | null) => url || '',
}));

vi.mock('@/lib/api', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/explore', () => ({
  ExploreSection: ({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) => (
    <section>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </section>
  ),
  ExploreStatCard: ({ label, value, suffix }: { label: string; value: number; suffix?: string; icon: unknown }) => (
    <div data-testid="stat-card">
      <span>{value}{suffix}</span>
      <span>{label}</span>
    </div>
  ),
  HorizontalScroll: ({ children }: { children: React.ReactNode }) => <div data-testid="horizontal-scroll">{children}</div>,
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const safe: Record<string, unknown> = {};
      const skip = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
      for (const [k, v] of Object.entries(props)) { if (!skip.has(k)) safe[k] = v; }
      return <div {...safe}>{children as React.ReactNode}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

import ExplorePage from '../ExplorePage';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ExplorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockState.useApiReturn = {
      data: mockExploreData,
      isLoading: false,
      error: null,
      execute: mockExecute,
    };
    mockState.categoriesReturn = {
      data: [
        { id: 1, name: 'Tech', slug: 'tech', color: '#3b82f6' },
        { id: 2, name: 'Art', slug: 'art' },
      ],
      isLoading: false,
      error: null,
      execute: vi.fn(),
    };
  });

  it('renders without crashing', () => {
    render(<ExplorePage />);
    expect(screen.getByText('heading')).toBeInTheDocument();
  });

  it('renders the heading and subtitle', () => {
    render(<ExplorePage />);
    expect(screen.getByText('heading')).toBeInTheDocument();
    expect(screen.getByText('subtitle')).toBeInTheDocument();
  });

  it('renders the search bar', () => {
    render(<ExplorePage />);
    // The Input has placeholder text
    expect(screen.getByPlaceholderText('search_placeholder')).toBeInTheDocument();
  });

  it('renders category chips from the categories API', () => {
    render(<ExplorePage />);
    // "Tech" may appear in both category chips and listing category — use getAllByText
    expect(screen.getAllByText('Tech').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Art')).toBeInTheDocument();
  });

  it('renders community stats cards', () => {
    render(<ExplorePage />);
    const statCards = screen.getAllByTestId('stat-card');
    expect(statCards).toHaveLength(4);

    // Check specific values
    expect(screen.getByText('100')).toBeInTheDocument(); // total_members
    expect(screen.getByText('25')).toBeInTheDocument(); // exchanges_this_month
    expect(screen.getByText('150h')).toBeInTheDocument(); // hours_exchanged
    expect(screen.getByText('42')).toBeInTheDocument(); // active_listings
  });

  it('renders trending posts section with data', () => {
    render(<ExplorePage />);
    expect(screen.getByText('trending_posts.title')).toBeInTheDocument();
    expect(screen.getByText('A trending post')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders popular listings section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('popular_listings.title')).toBeInTheDocument();
    expect(screen.getByText('Popular Listing')).toBeInTheDocument();
  });

  it('renders trending hashtags section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('trending_hashtags.title')).toBeInTheDocument();
    expect(screen.getByText('timebanking')).toBeInTheDocument();
  });

  it('renders new members section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('new_members.title')).toBeInTheDocument();
    expect(screen.getByText('Newbie')).toBeInTheDocument();
  });

  it('shows loading skeletons when isLoading is true', () => {
    mockState.useApiReturn = {
      data: null,
      isLoading: true,
      error: null,
      execute: mockExecute,
    };
    render(<ExplorePage />);
    // Stat cards show skeletons instead of real values
    expect(screen.queryByTestId('stat-card')).not.toBeInTheDocument();
  });

  it('shows error banner when API returns an error', () => {
    mockState.useApiReturn = {
      data: null,
      isLoading: false,
      error: new Error('Network failure'),
      execute: mockExecute,
    };
    render(<ExplorePage />);
    expect(screen.getByText('error_loading')).toBeInTheDocument();
    expect(screen.getByText('retry')).toBeInTheDocument();
  });

  it('does not show error banner when loading', () => {
    mockState.useApiReturn = {
      data: null,
      isLoading: true,
      error: new Error('Network failure'),
      execute: mockExecute,
    };
    render(<ExplorePage />);
    expect(screen.queryByText('error_loading')).not.toBeInTheDocument();
  });

  it('hides sections when hasFeature returns false', () => {
    mockHasFeature.mockReturnValue(false);
    render(<ExplorePage />);
    // Events and groups sections should not render
    expect(screen.queryByText('upcoming_events.title')).not.toBeInTheDocument();
    expect(screen.queryByText('active_groups.title')).not.toBeInTheDocument();
    expect(screen.queryByText('top_contributors.title')).not.toBeInTheDocument();
  });

  it('does not render category chips when none are available', () => {
    mockState.categoriesReturn = {
      data: [],
      isLoading: false,
      error: null,
      execute: vi.fn(),
    };
    render(<ExplorePage />);
    // "Tech" may still appear in the popular listings section (category chip),
    // but the category quick-filter chips section (with "Art") should be gone
    expect(screen.queryByText('Art')).not.toBeInTheDocument();
  });

  // ── Phase 1+2 new section tests ─────────────────────────────────────────

  it('renders recommended listings with match score', () => {
    render(<ExplorePage />);
    expect(screen.getByText('recommended.title')).toBeInTheDocument();
    expect(screen.getByText('Recommended Item')).toBeInTheDocument();
    expect(screen.getByText('Skills match your expertise')).toBeInTheDocument();
  });

  it('renders near you listings section for authenticated users', () => {
    render(<ExplorePage />);
    expect(screen.getByText('near_you.title')).toBeInTheDocument();
    expect(screen.getByText('Nearby Listing')).toBeInTheDocument();
  });

  it('renders suggested connections section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('suggested_connections.title')).toBeInTheDocument();
    expect(screen.getByText('Suggested User')).toBeInTheDocument();
  });

  it('renders blog posts section when feature is enabled', () => {
    render(<ExplorePage />);
    expect(screen.getByText('blog_posts.title')).toBeInTheDocument();
    expect(screen.getByText('Blog Post')).toBeInTheDocument();
  });

  it('renders volunteering section when feature is enabled', () => {
    render(<ExplorePage />);
    expect(screen.getByText('volunteering.title')).toBeInTheDocument();
    expect(screen.getByText('Help at Shelter')).toBeInTheDocument();
  });

  it('renders active polls section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('polls.title')).toBeInTheDocument();
    expect(screen.getByText('Best feature?')).toBeInTheDocument();
  });

  it('renders in-demand skills section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('in_demand_skills.title')).toBeInTheDocument();
    // "Gardening" appears in both near_you and in_demand_skills sections
    expect(screen.getAllByText('Gardening').length).toBeGreaterThanOrEqual(1);
  });

  it('renders organisations section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('organisations.title')).toBeInTheDocument();
    expect(screen.getByText('Community Org')).toBeInTheDocument();
  });

  it('hides organisations when its own switch is disabled', () => {
    mockHasFeature.mockImplementation((feature?: string) => feature !== 'organisations');

    render(<ExplorePage />);

    expect(screen.queryByText('organisations.title')).not.toBeInTheDocument();
    expect(screen.queryByText('Community Org')).not.toBeInTheDocument();
  });

  it('renders job opportunities section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('jobs.title')).toBeInTheDocument();
    expect(screen.getByText('Community Manager')).toBeInTheDocument();
  });

  it('renders featured resources section', () => {
    render(<ExplorePage />);
    expect(screen.getByText('resources.title')).toBeInTheDocument();
    expect(screen.getByText('Getting Started Guide')).toBeInTheDocument();
  });

  it('hides new Phase 2 sections when features are disabled', () => {
    mockHasFeature.mockReturnValue(false);
    render(<ExplorePage />);
    expect(screen.queryByText('blog_posts.title')).not.toBeInTheDocument();
    expect(screen.queryByText('volunteering.title')).not.toBeInTheDocument();
    expect(screen.queryByText('organisations.title')).not.toBeInTheDocument();
    expect(screen.queryByText('polls.title')).not.toBeInTheDocument();
    expect(screen.queryByText('jobs.title')).not.toBeInTheDocument();
    expect(screen.queryByText('resources.title')).not.toBeInTheDocument();
  });

  it('hides members-directory sections when connections feature is disabled', () => {
    mockHasFeature.mockImplementation((feature?: string) => feature !== 'connections');

    render(<ExplorePage />);

    expect(screen.queryByText('tabs.people')).not.toBeInTheDocument();
    expect(screen.queryByText('suggested_connections.title')).not.toBeInTheDocument();
    expect(screen.queryByText('new_members.title')).not.toBeInTheDocument();
    expect(screen.getByText('blog_posts.title')).toBeInTheDocument();
  });
});
