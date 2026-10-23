// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for BlogPostPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Test', last_name: 'User', avatar: null },
  })),
  useTenant: vi.fn(() => ({
    tenantPath: (p: string) => `/test${p}`,
    branding: { name: 'Test Community', logo: '/tenant-logo.png' },
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),

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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  resolveThumbnailUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  getFormattingLocale: vi.fn(() => 'en-GB'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/seo', async () => ({
  PageMeta: () => null,
  PrerenderStatusCode: (await import('@/components/seo/PrerenderStatusCode')).PrerenderStatusCode,
}));
vi.mock('@/components/navigation', () => ({
  Breadcrumbs: () => <nav aria-label="breadcrumb" />,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/social/SocialInteractionPanel', () => ({
  SocialInteractionPanel: ({ targetType, targetId }: { targetType: string; targetId: number }) => (
    <div data-testid="social-panel" data-target-type={targetType} data-target-id={targetId} />
  ),
}));

vi.mock('dompurify', () => ({
  default: { addHook: vi.fn(), sanitize: (html: string) => html },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ slug: 'my-test-post' }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'layout', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BlogPostPage } from './BlogPostPage';
import { api } from '@/lib/api';

const mockApiGet = vi.mocked(api.get);

const mockPost = {
  id: 1,
  title: 'How Timebanking Works',
  slug: 'my-test-post',
  excerpt: 'A guide to timebanking.',
  content: '<p>Timebanking is a way of exchanging time.</p>',
  featured_image: null,
  published_at: '2026-01-15T10:00:00Z',
  created_at: '2026-01-15T10:00:00Z',
  views: 120,
  reading_time: 3,
  meta_title: null,
  meta_description: null,
  author: { id: 5, name: 'Jane Doe', avatar: null },
  category: { id: 1, name: 'Community', color: 'blue' },
  is_liked: false,
  likes_count: 4,
  comments_count: 2,
};

describe('BlogPostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton while fetching post', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<BlogPostPage />);
    // Loading state renders — page does not crash
    expect(document.body).toBeInTheDocument();
  });

  it('renders the post title after loading', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: mockPost });
      }
      return Promise.resolve({ success: true, data: null });
    });

    render(<BlogPostPage />);

    await waitFor(() => {
      expect(screen.getByText('How Timebanking Works')).toBeInTheDocument();
    });
  });

  it('renders the post content', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: mockPost });
      }
      return Promise.resolve({ success: true, data: null });
    });

    render(<BlogPostPage />);

    await waitFor(() => {
      expect(screen.getByText(/Timebanking is a way of exchanging time/i)).toBeInTheDocument();
    });
  });

  it('does not render account-derived author identity or profile links', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: mockPost });
      }
      return Promise.resolve({ success: true, data: null });
    });

    render(<BlogPostPage />);

    await waitFor(() => {
      expect(screen.getByText('How Timebanking Works')).toBeInTheDocument();
    });
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="/profile/5"]')).toBeNull();
  });

  it('uses the tenant organization, never a member Person, in Article JSON-LD', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: mockPost });
      }
      return Promise.resolve({ success: true, data: null });
    });

    render(<BlogPostPage />);

    await waitFor(() => {
      expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    });
    const structuredData = document.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
    expect(structuredData).toContain('"@type":"Organization"');
    expect(structuredData).toContain('Test Community');
    expect(structuredData).not.toContain('"@type":"Person"');
    expect(structuredData).not.toContain('Jane Doe');
    expect(structuredData).not.toContain('/profile/5');
  });

  it('renders the shared social panel for blog comments', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: mockPost });
      }
      return Promise.resolve({ success: true, data: null });
    });

    render(<BlogPostPage />);

    await waitFor(() => {
      expect(screen.getByTestId('social-panel')).toHaveAttribute('data-target-type', 'blog');
      expect(screen.getByTestId('social-panel')).toHaveAttribute('data-target-id', '1');
    });
  });

  it('shows error state when post is not found', async () => {
    mockApiGet.mockResolvedValue({ success: false });
    render(<BlogPostPage />);

    await waitFor(() => {
      // Error state shows back to blog link and retry button
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('shows error state when API throws', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(<BlogPostPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });


  // 2026-10-23 SEO audit: a missing post answered crawlers 200 (a soft 404).
  describe('crawler status for a missing post', () => {
    const statusMeta = () => document.querySelector('meta[name="prerender-status-code"]');

    it('tells crawlers 404 when the server says the post does not exist', async () => {
      mockApiGet.mockResolvedValue({ success: false, code: 'NOT_FOUND' });
      render(<BlogPostPage />);
      await waitFor(() => expect(statusMeta()?.getAttribute('content')).toBe('404'));
    });

    it('does not claim 404 for a server error', async () => {
      mockApiGet.mockResolvedValue({ success: false, code: 'SERVER_ERROR' });
      render(<BlogPostPage />);
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
      expect(statusMeta()).toBeNull();
    });

    it('does not claim 404 when the request fails', async () => {
      mockApiGet.mockRejectedValue(new Error('Network error'));
      render(<BlogPostPage />);
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
      expect(statusMeta()).toBeNull();
    });
  });

  describe('Article dates', () => {
    const articleDates = async () => {
      await waitFor(() => expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull());
      const data = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
      return { published: data.datePublished, modified: data.dateModified };
    };

    it('turns the database date form into ISO 8601 (UTC)', async () => {
      mockApiGet.mockResolvedValue({
        success: true,
        data: { ...mockPost, published_at: '2026-10-23 14:00:00', updated_at: '2026-10-24 09:30:00' },
      });
      render(<BlogPostPage />);
      expect(await articleDates()).toEqual({ published: '2026-10-23T14:00:00Z', modified: '2026-10-24T09:30:00Z' });
    });

    it('leaves ISO 8601 dates alone', async () => {
      mockApiGet.mockResolvedValue({
        success: true,
        data: { ...mockPost, published_at: '2026-10-23T14:00:00+01:00', updated_at: null },
      });
      render(<BlogPostPage />);
      expect(await articleDates()).toEqual({
        published: '2026-10-23T14:00:00+01:00',
        modified: '2026-10-23T14:00:00+01:00',
      });
    });
  });

  // Real-user speed: the hero picture is the largest paint.
  it('loads the hero image eagerly, at high priority, with its size reserved', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { ...mockPost, featured_image: '/uploads/hero.jpg' } });
    render(<BlogPostPage />);
    const img = await screen.findByRole('img', { name: 'How Timebanking Works' });
    expect(img).not.toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('width', '1200');
    expect(img).toHaveAttribute('height', '675');
  });
});
