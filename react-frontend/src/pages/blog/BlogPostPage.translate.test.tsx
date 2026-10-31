// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BlogPostPage — Translate (owner, 31 Oct 2026: the post itself, not only its
 * comments, must be translatable). Title and body go in one press; the body is
 * sent as words and shown as plain text until "Show original".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

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

// dompurify is NOT stubbed here: the body is turned into words by the real sanitizer.

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
    div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
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

const mockApiPost = vi.mocked(api.post);

describe('BlogPostPage — Translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/blog/')) {
        return Promise.resolve({ success: true, data: { ...mockPost, content: '<p>Timebanking is a <strong>way</strong> of exchanging time.</p>' } });
      }
      return Promise.resolve({ success: true, data: null });
    });
    mockApiPost.mockImplementation((_url: string, body?: unknown) => {
      const type = (body as { content_type: string }).content_type;
      const translated = type === 'blog_post_title' ? 'Cómo funciona el banco de tiempo' : 'El banco de tiempo es una forma de intercambiar tiempo.';
      return Promise.resolve({
        success: true,
        data: { translated_text: translated, source_locale: 'en', target_locale: 'es', cached: false },
      });
    });
  });

  it('translates the title and the body together, then restores the formatted original', async () => {
    render(<BlogPostPage />);
    await screen.findByRole('heading', { level: 1, name: 'How Timebanking Works' });

    fireEvent.click(screen.getByRole('button', { name: /^translate$/i }));

    await screen.findByText('El banco de tiempo es una forma de intercambiar tiempo.');
    expect(screen.getByRole('heading', { level: 1, name: 'Cómo funciona el banco de tiempo' })).toBeInTheDocument();
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'blog_post',
      content_id: 1,
      source_text: 'Timebanking is a way of exchanging time.',
    }));
    expect(mockApiPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'blog_post_title',
      content_id: 1,
      source_text: 'How Timebanking Works',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(screen.getByText('way').tagName).toBe('STRONG'));
    expect(screen.getByRole('heading', { level: 1, name: 'How Timebanking Works' })).toBeInTheDocument();
  });
});
