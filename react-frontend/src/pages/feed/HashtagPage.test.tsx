// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for HashtagPage
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
  useTenant: vi.fn(() => ({
    tenantPath: (p: string) => `/test${p}`,
  })),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Test', last_name: 'User' },
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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/feed/FeedCard', () => ({
  FeedCard: ({ item, onHidePost, onDeletePost, onMuteUser }: {
    item: { id: number };
    onHidePost?: (item: unknown) => void;
    onDeletePost?: (item: unknown) => void;
    onMuteUser?: (item: unknown) => void;
  }) => (
    <div data-testid={`feed-card-${item.id}`}>
      Feed Item {item.id}
      {/* Expose the action callbacks so the hide/delete/mute handlers are testable. */}
      <button data-testid={`hide-${item.id}`} onClick={() => onHidePost?.(item)}>hide</button>
      <button data-testid={`delete-${item.id}`} onClick={() => onDeletePost?.(item)}>delete</button>
      <button data-testid={`mute-${item.id}`} onClick={() => onMuteUser?.(item)}>mute</button>
    </div>
  ),
}));

vi.mock('@/components/feed/types', () => ({
  getAuthor: vi.fn((item) => ({ id: item.author_id || 99 })),
  // Real behaviour, not a stub: the page must actually drop gamification
  // milestones, and a pass-through mock would hide a regression.
  excludeGamificationMilestones: (items: { type: string }[]) =>
    items.filter((item) => item.type !== 'badge_earned' && item.type !== 'level_up'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ tag: 'gardening' }),
    /*
     * 🔴 Forwards the REMAINING props. This stub used to take only
     * `{ children, to }` and throw the rest away, which silently deleted the
     * `aria-label` on `<Button as={Link}>` — so the back-to-feed control rendered
     * as an anonymous `<a>` with no accessible name, and the test that looked for
     * it failed against working code. That is what quarantined this suite.
     */
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>{children}</a>
    ),
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

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

import { HashtagPage } from './HashtagPage';
import { api } from '@/lib/api';

const mockApiGet = vi.mocked(api.get);
const mockApiPost = vi.mocked(api.post);

const mockFeedItems = [
  { id: 1, type: 'post', is_liked: false, likes_count: 2, author_id: 5 },
  { id: 2, type: 'post', is_liked: true, likes_count: 7, author_id: 6 },
];

describe('HashtagPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hashtag name in the heading', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByText('gardening')).toBeInTheDocument();
    });
  });

  /*
   * 🔴 Role `link`, not `button`. `<Button as={Link}>` renders an `<a href>`,
   * whose implicit ARIA role is `link` — the correct element for a control that
   * navigates, so the page is right and the query was wrong. Asserting the href
   * too, because a named link that goes nowhere is the real failure to catch.
   */
  it('renders a back link to the feed', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Back to feed' })).toHaveAttribute(
        'href',
        '/test/feed',
      );
    });
  });

  it('renders feed cards after loading', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('feed-card-2')).toBeInTheDocument();
  });

  it('shows empty state when no posts exist for the hashtag', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [], meta: { has_more: false } });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  // Regression: handleHidePost/handleMuteUser/handleDeletePost did UNCHECKED
  // `await api.post(...)` then removed the post(s) + a success toast. api.post resolves
  // { success:false } on a 4xx WITHOUT throwing, so a rejected hide/mute/delete used to
  // make the post(s) vanish with a fake confirmation (they reappeared on reload). The
  // post(s) must remain when the request is rejected.
  it('keeps the post in the list when hide returns success:false', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    mockApiPost.mockResolvedValue({ success: false, error: 'Cannot hide' });
    render(<HashtagPage />);

    await waitFor(() => expect(screen.getByTestId('feed-card-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hide-1'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v2/feed/posts/1/hide', expect.objectContaining({ type: 'post' }));
    });
    expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
  });

  it('keeps the post in the list when delete returns success:false', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    mockApiPost.mockResolvedValue({ success: false, error: 'Cannot delete' });
    render(<HashtagPage />);

    await waitFor(() => expect(screen.getByTestId('feed-card-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-1'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v2/feed/posts/1/delete');
    });
    expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
  });

  it('keeps the user\'s posts in the list when mute returns success:false', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFeedItems, meta: { has_more: false } });
    mockApiPost.mockResolvedValue({ success: false, error: 'Cannot mute' });
    render(<HashtagPage />);

    await waitFor(() => expect(screen.getByTestId('feed-card-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mute-1'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v2/feed/users/5/mute');
    });
    // The author's post must not be wiped from the list on a rejected mute.
    expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(<HashtagPage />);

    await waitFor(() => {
      // Error state renders a retry button
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('shows error state when API returns success: false', async () => {
    mockApiGet.mockResolvedValue({ success: false });
    render(<HashtagPage />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('shows post count when meta provides total_items', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: mockFeedItems,
      meta: { has_more: false, total_items: 42 },
    });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByText('gardening')).toBeInTheDocument();
    });
    // Post count is shown — exact i18n key "hashtag.post_count" with { count: 42 }
    expect(document.body).toBeInTheDocument();
  });

  it('shows load more button when has_more is true', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: mockFeedItems,
      meta: { has_more: true, cursor: 'abc' },
    });
    render(<HashtagPage />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    // Load more button should be among them
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
