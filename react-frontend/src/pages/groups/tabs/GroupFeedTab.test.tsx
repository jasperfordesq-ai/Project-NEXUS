// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice', first_name: 'Alice', avatar: null },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
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

// Stub hooks used internally
vi.mock('@/hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}));
vi.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pullDistance: 0, isRefreshing: false }),
}));

// Stub heavy child components
vi.mock('@/components/feed/FeedCard', () => ({
  FeedCard: ({ item }: { item: { id: number; type: string } }) => (
    <div data-testid={`feed-card-${item.id}`}>{item.type} post</div>
  ),
}));

vi.mock('@/components/feed/types', () => ({
  getAuthor: (item: { author?: { id: number } }) => item.author ?? { id: 0 },
  // Real behaviour, not a stub: the tab must actually drop gamification
  // milestones, and a pass-through mock would hide a regression.
  excludeGamificationMilestones: (items: { type: string }[]) =>
    items.filter((item) => item.type !== 'badge_earned' && item.type !== 'level_up'),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div data-testid="empty-state-action">{action}</div>}
    </div>
  ),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    GlassCard: ({ children, onClick, role, tabIndex, onKeyDown, 'aria-label': ariaLabel, className }: {
      children: React.ReactNode; onClick?: () => void; role?: string; tabIndex?: number;
      onKeyDown?: (e: React.KeyboardEvent) => void; 'aria-label'?: string; className?: string;
    }) => (
      <div
        data-testid="glass-card"
        onClick={onClick}
        role={role}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        className={className}
      >{children}</div>
    ),
    Button: ({ children, onPress, isLoading, isDisabled, startContent }: {
      children?: React.ReactNode; onPress?: () => void; isLoading?: boolean; isDisabled?: boolean;
      startContent?: React.ReactNode; className?: string;
    }) => (
      <button onClick={() => onPress?.()} disabled={isDisabled || isLoading}>
        {startContent}{children}
      </button>
    ),
    Avatar: ({ name }: { name?: string }) => <div data-testid="avatar" aria-label={name} />,
    Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={className} />,
    Separator: () => <hr />,
  };
});

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, layout: _layout, initial: _initial, animate: _animate, transition: _transition, className }: {
      children: React.ReactNode; layout?: boolean; initial?: object; animate?: object; transition?: object; className?: string;
    }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
    resolveAssetUrl: (url: string | null | undefined) => url ?? '',
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeFeedItem = (overrides = {}) => ({
  id: 1,
  type: 'post' as const,
  author: { id: 10, name: 'Alice', avatar: null },
  content: 'Hello group!',
  created_at: '2025-01-01T00:00:00Z',
  likes_count: 0,
  liked: false,
  comments_count: 0,
  reactions: [],
  ...overrides,
});

const defaultProps = {
  isMember: true,
  isJoining: false,
  feedItems: [],
  feedLoading: false,
  feedHasMore: false,
  feedLoadingMore: false,
  onJoinLeave: vi.fn(),
  onComposeOpen: vi.fn(),
  onLoadMore: vi.fn(),
  onToggleLike: vi.fn(),
  onReact: vi.fn(),
  onHidePost: vi.fn(),
  onMuteUser: vi.fn(),
  onReportPost: vi.fn(),
  onDeletePost: vi.fn(),
  onVotePoll: vi.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
describe('GroupFeedTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows locked empty state when not a member', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} isMember={false} />);

    const emptyState = screen.getByTestId('empty-state');
    expect(emptyState).toBeInTheDocument();
  });

  it('shows join button in locked state for authenticated user', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} isMember={false} />);

    const joinBtn = screen.getByRole('button');
    expect(joinBtn).toBeInTheDocument();
  });

  it('calls onJoinLeave when join button is pressed', async () => {
    const onJoinLeave = vi.fn();
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} isMember={false} onJoinLeave={onJoinLeave} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onJoinLeave).toHaveBeenCalledTimes(1);
  });

  it('shows loading skeletons when feedLoading=true and no items', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedLoading={true} feedItems={[]} />);

    // Multiple role="status" elements exist (ToastProvider + loading div) — find the aria-busy one
    const statuses = screen.getAllByRole('status');
    const loadingContainer = statuses.find(el => el.getAttribute('aria-busy') === 'true');
    expect(loadingContainer).toBeDefined();
    expect(loadingContainer?.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
  });

  it('shows empty feed state when member with no items and not loading', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[]} feedLoading={false} />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('shows create post button in empty feed action for authenticated member', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[]} feedLoading={false} />);

    const actionEl = screen.getByTestId('empty-state-action');
    expect(actionEl).toBeInTheDocument();
  });

  it('renders compose prompt card when member and has items', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    const items = [makeFeedItem()];
    render(<GroupFeedTab {...defaultProps} feedItems={items} />);

    // The compose card has an aria-label
    const composeCard = screen.getByRole('button', { name: /post/i });
    expect(composeCard).toBeInTheDocument();
  });

  it('calls onComposeOpen when compose card is clicked', async () => {
    const onComposeOpen = vi.fn();
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[makeFeedItem()]} onComposeOpen={onComposeOpen} />);

    const composeCard = screen.getByRole('button', { name: /post/i });
    fireEvent.click(composeCard);
    expect(onComposeOpen).toHaveBeenCalledTimes(1);
  });

  it('renders feed cards for feed items', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    const items = [makeFeedItem({ id: 10 }), makeFeedItem({ id: 20 })];
    render(<GroupFeedTab {...defaultProps} feedItems={items} />);

    expect(screen.getByTestId('feed-card-10')).toBeInTheDocument();
    expect(screen.getByTestId('feed-card-20')).toBeInTheDocument();
  });

  it('shows load more button when feedHasMore is true', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[makeFeedItem()]} feedHasMore={true} feedLoadingMore={false} />);

    const loadMoreBtn = screen.getByRole('button', { name: /load more|more/i });
    expect(loadMoreBtn).toBeInTheDocument();
  });

  it('calls onLoadMore when load more button is clicked', async () => {
    const onLoadMore = vi.fn();
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[makeFeedItem()]} feedHasMore={true} feedLoadingMore={false} onLoadMore={onLoadMore} />);

    const loadMoreBtn = screen.getByRole('button', { name: /load more|more/i });
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not show load more button when feedHasMore is false', async () => {
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[makeFeedItem()]} feedHasMore={false} />);

    // No load more button when at end of feed
    const buttons = screen.queryAllByRole('button');
    const loadMoreBtn = buttons.find(b => b.textContent?.match(/load more|more posts/i));
    expect(loadMoreBtn).toBeUndefined();
  });

  it('composeOpen triggered via keyboard Enter on compose card', async () => {
    const onComposeOpen = vi.fn();
    const { GroupFeedTab } = await import('./GroupFeedTab');
    render(<GroupFeedTab {...defaultProps} feedItems={[makeFeedItem()]} onComposeOpen={onComposeOpen} />);

    const composeCard = screen.getByRole('button', { name: /post/i });
    fireEvent.keyDown(composeCard, { key: 'Enter' });
    expect(onComposeOpen).toHaveBeenCalledTimes(1);
  });
});
