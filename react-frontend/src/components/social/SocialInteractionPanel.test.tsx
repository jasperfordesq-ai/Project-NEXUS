// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub heavy children ─────────────────────────────────────────────────────
vi.mock('./CommentsSection', () => ({
  CommentsSection: ({ commentsLoading }: { commentsLoading: boolean }) => (
    <div data-testid="comments-section">{commentsLoading ? 'loading...' : 'comments'}</div>
  ),
}));

vi.mock('./ReactionDetailsModal', () => ({
  ReactionDetailsModal: ({ isOpen, entityType, entityId }: { isOpen: boolean; entityType: string; entityId: number }) => (
    isOpen ? <div data-testid="reaction-details-modal">{entityType}:{entityId}</div> : null
  ),
}));

vi.mock('./ShareButton', () => ({
  ShareButton: ({ isAuthenticated }: { isAuthenticated: boolean }) => (
    <button data-testid="share-button" disabled={!isAuthenticated}>Share</button>
  ),
}));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 10, name: 'Alice', first_name: 'Alice', last_name: '', avatar_url: null, avatar: null },
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

// ─── Default props ───────────────────────────────────────────────────────────
const defaultProps = {
  targetType: 'post',
  targetId: 42,
  initialCommentsCount: 0,
};

type Summary = {
  counts: Record<string, number>;
  total: number;
  user_reaction: string | null;
  top_reactors?: Array<{ id: number; name: string }>;
};

/**
 * The panel reads its reactions from the one store, GET /v2/reactions/batch.
 * `summary` is what that store holds for post:42; comments keep their own
 * endpoint.
 */
function serveReactions(summary: Summary | null) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.startsWith('/v2/reactions/batch')) {
      return Promise.resolve({ success: true, data: summary ? { 'post:42': summary } : {} });
    }
    return Promise.resolve({ success: true, data: { comments: [], count: 0 } });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SocialInteractionPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serveReactions(null);
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        action: 'added',
        reaction_type: 'like',
        reactions: { counts: { like: 1 }, total: 1, user_reaction: 'like', top_reactors: [{ id: 10, name: 'Alice' }] },
      },
    });
  });

  it('renders Like and Comment action buttons', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    const likeBtn = screen.getByRole('button', { name: /react to this post/i });
    const commentBtn = screen.getByRole('button', { name: /comment|open/i });
    expect(likeBtn).toBeInTheDocument();
    expect(likeBtn).toHaveTextContent('Like');
    expect(commentBtn).toBeInTheDocument();
  });

  it('can disable generic comments while preserving the other social actions', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(
      <SocialInteractionPanel
        {...defaultProps}
        targetType="discussion"
        initialCommentsCount={3}
        defaultShowComments
        allowComments={false}
      />,
    );

    expect(screen.getByRole('button', { name: /react to this post/i })).toBeInTheDocument();
    expect(screen.getByTestId('share-button')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comment|open/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('comments-section')).not.toBeInTheDocument();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(mockApi.get).not.toHaveBeenCalledWith(expect.stringContaining('/v2/comments'));
  });

  it('renders Share button for shareable target types', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} targetType="post" showShare />);

    await waitFor(() => {
      expect(screen.getByTestId('share-button')).toBeInTheDocument();
    });
  });

  it('does NOT render Share button for non-shareable target types', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} targetType="review" showShare />);

    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
  });

  it('shows the reactions the item already has, whatever the page passed in', async () => {
    // Regression: the panel used to show `initialLikesCount`, which most pages
    // could not fill in, so an earlier like was "forgotten" on every reload.
    serveReactions({
      counts: { like: 4, celebrate: 3 },
      total: 7,
      user_reaction: 'celebrate',
      top_reactors: [{ id: 3, name: 'Bea' }, { id: 4, name: 'Cal' }],
    });
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    expect(await screen.findByRole('button', { name: /view reactions: bea, cal, and 5 others/i })).toBeInTheDocument();
    // The member's own earlier reaction is remembered on the button.
    const mine = screen.getByRole('button', { name: /celebrate \(click to remove\)/i });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    // One batched request; other panels mounted in the same tick share it.
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/v2\/reactions\/batch\?items=.*post%3A42/),
    );
  });

  it('shows comments count and clicking it opens comments', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} initialCommentsCount={3} />);

    const countBtn = screen.getAllByRole('button').find(b => /3/.test(b.textContent ?? ''));
    expect(countBtn).toBeInTheDocument();

    await userEvent.click(countBtn!);
    await waitFor(() => {
      expect(screen.getByTestId('comments-section')).toBeInTheDocument();
    });
  });

  it('toggles comments section open/closed', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    const commentBtn = screen.getByRole('button', { name: /comment|open/i });
    await userEvent.click(commentBtn);

    await waitFor(() => {
      expect(screen.getByTestId('comments-section')).toBeInTheDocument();
    });

    await userEvent.click(commentBtn);
    await waitFor(() => {
      expect(screen.queryByTestId('comments-section')).not.toBeInTheDocument();
    });
  });

  it('opens with comments visible when defaultShowComments=true', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} defaultShowComments />);

    await waitFor(() => {
      expect(screen.getByTestId('comments-section')).toBeInTheDocument();
    });
  });

  it('calls API to load comments when section opens', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} defaultShowComments />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/comments'),
      );
    });
  });

  it('the reaction button is enabled and unpressed for a member who has not reacted', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    const likeBtn = screen.getByRole('button', { name: /react to this post/i });
    expect(likeBtn).not.toBeDisabled();
    expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the list of who reacted when the reactions count is clicked', async () => {
    serveReactions({ counts: { like: 5 }, total: 5, user_reaction: null, top_reactors: [{ id: 3, name: 'Bea' }] });
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    await userEvent.click(await screen.findByRole('button', { name: /view reactions/i }));

    // The same dialog the feed card opens, pointed at the same item.
    expect(await screen.findByTestId('reaction-details-modal')).toHaveTextContent('post:42');
  });

  it('reacts through the one reactions endpoint, not the old like endpoint', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    await userEvent.click(screen.getByRole('button', { name: /react to this post/i }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/reactions',
        { target_type: 'post', target_id: 42, reaction_type: 'like' },
      );
    });
    expect(mockApi.post).not.toHaveBeenCalledWith('/v2/feed/like', expect.anything());
    // The server's answer is what the panel shows.
    expect(await screen.findByRole('button', { name: /view reactions: alice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /like \(click to remove\)/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts the reaction back and says so when the server refuses it', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'nope' });
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);

    await userEvent.click(screen.getByRole('button', { name: /react to this post/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /react to this post/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /view reactions/i })).not.toBeInTheDocument();
  });

  it('follows a reaction made on the same item elsewhere on the page', async () => {
    const { dispatchFeedSync } = await import('@/lib/feedSync');
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('/v2/reactions/batch')));
    // Let the load settle before the outside change arrives.
    await new Promise((resolve) => setTimeout(resolve, 10));

    React.act(() => {
      dispatchFeedSync({
        targetType: 'post',
        targetId: 42,
        patch: { reactions: { counts: { wow: 2 }, total: 2, user_reaction: 'wow', top_reactors: [] } },
      });
    });

    expect(await screen.findByRole('button', { name: /view reactions: 2 reactions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /wow \(click to remove\)/i })).toBeInTheDocument();
  });

  it('does not show counts row when both counts are zero', async () => {
    const { SocialInteractionPanel } = await import('./SocialInteractionPanel');
    render(<SocialInteractionPanel {...defaultProps} initialCommentsCount={0} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('/v2/reactions/batch')));

    // Only action buttons visible, no count summary
    const buttons = screen.getAllByRole('button');
    // Should have Like and Comment buttons but NO view-reactions or view-comments count buttons
    const countButtons = buttons.filter(b => /^\d+/.test(b.textContent?.trim() ?? ''));
    expect(countButtons).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /view reactions/i })).not.toBeInTheDocument();
  });
});
