// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
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

// ─── Toast / Auth ─────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User', first_name: 'Test', avatar: null },
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
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub hooks that touch DOM/IntersectionObserver ──────────────────────────
vi.mock('@/hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => {
    const ref = React.useRef<HTMLDivElement>(null);
    return ref;
  },
}));

vi.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pullDistance: 0, isRefreshing: false }),
}));

// ─── Stub feedSync ───────────────────────────────────────────────────────────
vi.mock('@/lib/feedSync', () => ({
  applyFeedSyncToItem: (item: unknown) => item,
  dispatchFeedSync: vi.fn(),
  FEED_SYNC_EVENT: 'feed_sync',
}));

// ─── Stub animation lib ──────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => {
      // strip non-DOM props
      const { initial: _i, animate: _a, transition: _t, layout: _l, ...domRest } = rest as Record<string, unknown>;
      return <div {...(domRest as Record<string, unknown>)}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Stub heavy child components ─────────────────────────────────────────────
vi.mock('@/components/feed/FeedCard', () => ({
  FeedCard: ({ item, onHidePost, onDeletePost }: {
    item: { id: number; type: string; content?: string; author?: { name?: string } };
    onHidePost?: (item: unknown) => void;
    onDeletePost?: (item: unknown) => void;
  }) => (
    <div data-testid={`feed-card-${item.id}`}>
      <span data-testid="feed-card-type">{item.type}</span>
      {item.content && <span data-testid="feed-card-content">{item.content}</span>}
      {item.author?.name && <span>{item.author.name}</span>}
      {/* Expose the action callbacks so the hide/delete handlers are testable. */}
      <button data-testid={`hide-${item.id}`} onClick={() => onHidePost?.(item)}>hide</button>
      <button data-testid={`delete-${item.id}`} onClick={() => onDeletePost?.(item)}>delete</button>
    </div>
  ),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

// NOTE: no `vi.mock('@/components/ui', ...)` here on purpose. ProfileFeed imports
// Button/GlassCard/Separator/Skeleton from their DIRECT paths, so a barrel override
// would never be reached — the real components render and the assertions below
// target the real DOM they emit.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeFeedItem = (overrides = {}) => ({
  id: 1,
  type: 'post' as const,
  content: 'Hello world',
  created_at: '2025-05-01T10:00:00Z',
  is_liked: false,
  likes_count: 0,
  comments_count: 0,
  author: { id: 1, name: 'Alice', avatar_url: null },
  reactions: { counts: {}, total: 0, user_reaction: null, top_reactors: [] },
  ...overrides,
});

const makeResponse = (items = [] as unknown[], meta = {}) => ({
  success: true,
  data: items,
  meta: { has_more: false, cursor: null, ...meta },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ProfileFeed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeResponse());
  });

  it('shows loading skeletons initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { ProfileFeed } = await import('./ProfileFeed');
    const { container } = render(<ProfileFeed userId={42} />);

    // The real Skeleton renders `.skeleton`, the real GlassCard `.glass-card`.
    // ProfileFeed's loading branch is `[1,2,3,4].map(<FeedSkeleton/>)`, and each
    // FeedSkeleton is one card holding 7 shimmer blocks (avatar, name, meta,
    // 2 body lines, 2 action pills).
    const skeletonCards = container.querySelectorAll('.glass-card');
    expect(skeletonCards).toHaveLength(4);
    skeletonCards.forEach((card) => {
      expect(card.querySelectorAll('.skeleton')).toHaveLength(7);
    });
    expect(container.querySelectorAll('.skeleton')).toHaveLength(28);

    // Still loading — neither the resolved empty state nor any feed card is showing.
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-card-1')).not.toBeInTheDocument();
  });

  it('shows empty state when feed is empty', async () => {
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders feed cards when items are returned', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem()]));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
    });
  });

  it('does not remove the post (and shows an error) when hide returns success:false', async () => {
    // Regression: handleHidePost did an UNCHECKED `await api.post(.../hide)` then removed
    // the post + a "hidden" success toast. api.post resolves { success:false } on a 4xx
    // WITHOUT throwing, so a rejected hide used to make the post vanish with a fake
    // confirmation (it reappeared on reload). It must keep the post + show an error.
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem({ id: 7, type: 'post' })]));
    mockApi.post.mockResolvedValue({ success: false, error: 'Cannot hide' });
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => expect(screen.getByTestId('feed-card-7')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hide-7'));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/feed/posts/7/hide', expect.objectContaining({ type: 'post' }));
    });
    // The post is NOT removed on a rejected hide; an error (not success) is shown.
    expect(screen.getByTestId('feed-card-7')).toBeInTheDocument();
    // Name the copy: profile:hide_failed, so a wrong/blank toast key still fails.
    expect(mockToast.error).toHaveBeenCalledWith('Failed to hide');
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('does not remove the post (and shows an error) when delete returns success:false', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem({ id: 9, type: 'post' })]));
    mockApi.post.mockResolvedValue({ success: false, error: 'Cannot delete' });
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => expect(screen.getByTestId('feed-card-9')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-9'));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/feed/posts/9/delete');
    });
    expect(screen.getByTestId('feed-card-9')).toBeInTheDocument();
    // Name the copy: profile:delete_failed.
    expect(mockToast.error).toHaveBeenCalledWith('Delete failed');
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('renders multiple feed cards', async () => {
    const items = [makeFeedItem({ id: 1 }), makeFeedItem({ id: 2 }), makeFeedItem({ id: 3 })];
    mockApi.get.mockResolvedValue(makeResponse(items));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('feed-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('feed-card-3')).toBeInTheDocument();
    });
  });

  it('fetches feed with correct userId param', async () => {
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={99} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('user_id=99')
      );
    });
  });

  it('shows own-profile empty description for isOwnProfile=true', async () => {
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={1} isOwnProfile={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { ProfileFeed } = await import('./ProfileFeed');
    const { container } = render(<ProfileFeed userId={42} />);

    // Error renders the real profile:feed_error copy inside a GlassCard, with a retry button.
    await waitFor(() => {
      expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
    });
    expect(container.querySelector('.glass-card')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The error branch replaces the empty state and the loading skeletons.
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0);
  });

  it('shows retry button on error', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retries loading when retry button clicked', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network'));
    mockApi.get.mockResolvedValueOnce(makeResponse([makeFeedItem()]));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    const retryBtn = await waitFor(() => screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledTimes(2);
    });
    // The second attempt succeeded: the item renders and the error is cleared.
    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
    });
    expect(screen.queryByText('Failed to load activity')).not.toBeInTheDocument();
  });

  it('shows load more button when has_more is true', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem()], { has_more: true, cursor: 'abc123' }));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    });
  });

  it('hides the load more button when has_more is false', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem()], { has_more: false, cursor: null }));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    // Positive precondition first, so the absence below cannot pass vacuously.
    await waitFor(() => {
      expect(screen.getByTestId('feed-card-1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('calls API with cursor on load more', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeFeedItem()], { has_more: true, cursor: 'cursor-xyz' }));
    const { ProfileFeed } = await import('./ProfileFeed');
    render(<ProfileFeed userId={42} />);

    const loadMoreBtn = await waitFor(() => screen.getByRole('button', { name: 'Load more' }));

    mockApi.get.mockResolvedValueOnce(makeResponse([], { has_more: false }));
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('cursor=cursor-xyz')
      );
    });
  });
});
