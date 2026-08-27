// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── react-router — preserve real impl, override useParams ─────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '42', type: undefined })),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    useNavigate: vi.fn(() => vi.fn()),
  };
});

// ── api mock ─────────────────────────────────────────────────────────────────
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── feedSync stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/feedSync', () => ({
  applyFeedSyncToItem: vi.fn((_item: unknown, _payload: unknown) => _item),
  dispatchFeedSync: vi.fn(),
  FEED_SYNC_EVENT: 'nexus:feed-sync',
}));

// ── contexts ─────────────────────────────────────────────────────────────────
const mockToastError = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice', first_name: 'Alice', avatar: null },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({
      success: mockToastSuccess,
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
      showToast: vi.fn(),
    }),
  })
);

// ── SEO stub ─────────────────────────────────────────────────────────────────
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

// ── FeedCard + FeedSkeleton stubs ─────────────────────────────────────────────
// FeedCard pulls in a very large dep tree; stub it completely
vi.mock('@/components/feed/FeedCard', () => ({
  FeedCard: ({
    item,
    onToggleLike,
    onReportPost,
  }: {
    item: { id: number; content: string; type: string; is_liked: boolean; likes_count: number };
    onToggleLike: (item: unknown) => void;
    onReportPost: (item: unknown) => void;
  }) => (
    <article aria-label="feed-card">
      <p>{item.content}</p>
      <button onClick={() => onToggleLike(item)} aria-label="like">Like ({item.likes_count})</button>
      <button onClick={() => onReportPost(item)} aria-label="report">Report</button>
    </article>
  ),
}));

vi.mock('@/components/feed/FeedSkeleton', () => ({
  FeedSkeleton: () => <div role="status" aria-busy="true" aria-label="Loading post" />,
}));

// ── hooks ─────────────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import { PostDetailPage } from './PostDetailPage';

const FEED_ITEM = {
  id: 42,
  type: 'post',
  content: 'Hello World from the feed!',
  author: { id: 5, name: 'Bob', avatar: null },
  is_liked: false,
  likes_count: 3,
  comments_count: 0,
  created_at: '2026-01-01T00:00:00Z',
};

describe('PostDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: FEED_ITEM });
    mockApi.post.mockResolvedValue({ success: true, data: { action: 'liked', likes_count: 4 } });
  });

  it('shows loading skeleton while fetching', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<PostDetailPage />);
    const statusEls = screen.getAllByRole('status');
    const loading = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loading).toBeTruthy();
  });

  it('renders post content after successful load', async () => {
    render(<PostDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Hello World from the feed!')).toBeInTheDocument();
    });
  });

  /*
   * 🔴 The back controls are LINKS, not buttons.
   *
   * This suite was quarantined for exactly this: it asked for
   * `getAllByRole('button')` and found none, so it read as "there is no way back
   * from a missing post" when the way back was there and working. The page
   * renders `<Button as={Link} to={tenantPath('/feed')}>`, which produces an
   * `<a href>` — implicit ARIA role `link`. That is the correct element for a
   * control that navigates, so the page stays as it is and the query is fixed.
   *
   * The `expect(allText).toBeTruthy()` line that stood here is also gone: the
   * body always has some text, so it asserted nothing. The error message itself
   * is now checked.
   */
  it('renders the error state and a way back when the post cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, data: null });
    render(<PostDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Item not found')).toBeInTheDocument();
    });

    const backLinks = screen.getAllByRole('link', { name: /back to feed/i });
    expect(backLinks.length).toBeGreaterThan(0);
    for (const link of backLinks) {
      expect(link).toHaveAttribute('href', '/test/feed');
    }
  });

  it('calls POST /v2/feed/like on like button click', async () => {
    render(<PostDetailPage />);
    await waitFor(() => expect(screen.getByText('Hello World from the feed!')).toBeInTheDocument());

    const likeBtn = screen.getByRole('button', { name: /like/i });
    await userEvent.click(likeBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/feed/like', expect.objectContaining({
        target_type: 'post',
        target_id: 42,
      }));
    });
  });

  it('optimistically updates like count before server response', async () => {
    // Block the API so we can see the optimistic update
    let resolvePost!: (v: unknown) => void;
    mockApi.post.mockReturnValue(new Promise((res) => { resolvePost = res; }));

    render(<PostDetailPage />);
    await waitFor(() => expect(screen.getByText(/Like \(3\)/)).toBeInTheDocument());

    const likeBtn = screen.getByRole('button', { name: /like/i });
    await userEvent.click(likeBtn);

    // Optimistic update: count goes to 4 immediately
    expect(screen.getByText(/Like \(4\)/)).toBeInTheDocument();

    resolvePost({ success: true, data: { action: 'liked', likes_count: 4 } });
  });

  it('reverts like count on API failure', async () => {
    mockApi.post.mockRejectedValue(new Error('Network fail'));

    render(<PostDetailPage />);
    await waitFor(() => expect(screen.getByText(/Like \(3\)/)).toBeInTheDocument());

    const likeBtn = screen.getByRole('button', { name: /like/i });
    await userEvent.click(likeBtn);

    // After revert: count should go back to 3
    await waitFor(() => {
      expect(screen.getByText(/Like \(3\)/)).toBeInTheDocument();
    });
  });

  it('opens report modal when report button clicked', async () => {
    render(<PostDetailPage />);
    await waitFor(() => expect(screen.getByText('Hello World from the feed!')).toBeInTheDocument());

    const reportBtn = screen.getByRole('button', { name: /report/i });
    await userEvent.click(reportBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('fetches post via polymorphic endpoint for listing type', async () => {
    const { useParams } = await import('react-router-dom');
    vi.mocked(useParams).mockReturnValue({ id: '99', type: 'listing' });
    render(<PostDetailPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/feed/items/listing/99');
    });
    vi.mocked(useParams).mockReturnValue({ id: '42', type: undefined });
  });

  it('fetches post via post endpoint for default type', async () => {
    render(<PostDetailPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/feed/posts/42');
    });
  });

  it('renders a back link to the feed above a loaded post', async () => {
    render(<PostDetailPage />);
    await waitFor(() => expect(screen.getByText('Hello World from the feed!')).toBeInTheDocument());

    // Role `link`, not `button` — see the note on the error-state test above.
    expect(screen.getByRole('link', { name: /back to feed/i })).toHaveAttribute(
      'href',
      '/test/feed',
    );
  });
});
