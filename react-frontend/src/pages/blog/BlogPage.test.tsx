// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for BlogPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
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
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// src/test/setup.ts stubs matchMedia to `matches: false` for EVERY query, so
// without this mock `isPhone` is permanently false and the phone branch gets
// zero coverage. Query-aware so a page/child asking a `min-width` question can
// never land in an impossible viewport.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('min-width') ? !isPhoneViewport : isPhoneViewport,
  ),
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  resolveThumbnailUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  getFormattingLocale: vi.fn(() => 'en-GB'),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { BlogPage } from './BlogPage';
import { api } from '@/lib/api';

const mockApiGet = vi.mocked(api.get);

const CATEGORY = { id: 3, name: 'Community News', slug: 'community-news', color: 'blue', post_count: 4 };
const POST = {
  id: 9,
  title: 'Community update',
  slug: 'community-update',
  excerpt: 'News from the community.',
  featured_image: null,
  published_at: '2026-07-11T09:00:00Z',
  created_at: '2026-07-11T09:00:00Z',
  views: 12,
  reading_time: 2,
  category: null,
};

/** `/v2/blog/categories` → one category; `/v2/blog?...` → one post. */
function mockBlogApi() {
  mockApiGet.mockImplementation((url: string) => Promise.resolve({
    success: true,
    data: url.includes('/categories') ? [CATEGORY] : [POST],
    meta: {},
  }));
}

describe('BlogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
  });

  it('renders without crashing', () => {
    render(<BlogPage />);
    expect(screen.getByText(/Blog/i)).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<BlogPage />);
    expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();
  });

  it('does not render account-derived author identity from a public blog response', async () => {
    mockApiGet.mockImplementation((url: string) => Promise.resolve({
      success: true,
      data: url.includes('/categories') ? [] : [{
        id: 9,
        title: 'Community update',
        slug: 'community-update',
        excerpt: 'News from the community.',
        featured_image: null,
        published_at: '2026-07-11T09:00:00Z',
        created_at: '2026-07-11T09:00:00Z',
        views: 12,
        reading_time: 2,
        author: { id: 987, name: 'Private Member Name', avatar: '/member-avatar.jpg' },
        category: null,
      }],
      meta: {},
    }));

    render(<BlogPage />);

    await waitFor(() => {
      expect(screen.getByText('Community update')).toBeInTheDocument();
    });
    expect(screen.queryByText('Private Member Name')).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="/profile/"]')).toBeNull();
    expect(document.querySelector('img[src*="member-avatar"]')).toBeNull();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
      mockBlogApi();
    });

    it('renders the sticky bar with a search pill and Filters button', () => {
      render(<BlogPage />);
      expect(screen.getByTestId('blog-filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search posts...')).toBeInTheDocument();
    });

    it('does not render the desktop hero or the inline filter row', () => {
      render(<BlogPage />);
      // Hero description — the hero is the only place it appears.
      expect(screen.queryByText('Community stories, updates, and announcements')).not.toBeInTheDocument();
      // The inline SearchField is the only element with a placeholder; the phone
      // pill is a Button showing text.
      expect(screen.queryByPlaceholderText(/Search posts/i)).not.toBeInTheDocument();
      // Screen readers still get a heading.
      expect(screen.getByRole('heading', { level: 1, name: 'Blog & News' })).toBeInTheDocument();
    });

    it('opens the filter sheet showing the category chip group', async () => {
      render(<BlogPage />);
      await waitFor(() => {
        expect(screen.getByText('Community update')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText('More filters'));

      // HeroUI single-select ToggleButtonGroup ⇒ role=radiogroup / role=radio.
      const group = await screen.findByRole('radiogroup', { name: 'Filter by category' });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Community News (4)' })).toBeInTheDocument();
      // Simple archetype: immediate apply, so there is no footer apply button.
      expect(screen.queryByText('Show results')).not.toBeInTheDocument();
    });

    it('applies a category immediately on tap and refetches the list', async () => {
      render(<BlogPage />);
      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/blog\?/));
      });
      mockApiGet.mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      const chip = await screen.findByRole('radio', { name: 'Community News (4)' });

      fireEvent.click(chip);

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(expect.stringContaining('category_id=3'));
      });
      // The applied filter surfaces as a removable chip in the sticky bar.
      expect(await screen.findByLabelText('Remove filter: Community News')).toBeInTheDocument();
    });

    it('shows the loaded-post count in place of the hero stat', async () => {
      render(<BlogPage />);
      await waitFor(() => {
        expect(screen.getByText('1 post shown')).toBeInTheDocument();
      });
    });
  });
});
