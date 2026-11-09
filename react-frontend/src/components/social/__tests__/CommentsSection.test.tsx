// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CommentsSection component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { name?: string; fallbackValue?: string }) => {
      if (key === 'write_reply_to' && typeof options === 'object') {
        return `Reply to ${options.name}...`;
      }
      return typeof options === 'string' ? options : options?.fallbackValue ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  // TranslateButton asks whether a member is signed in (9 Nov 2026); language checks are off in tests.
  useAuthOptional: () => null,
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url || '/default-avatar.png',
  formatRelativeTime: vi.fn(() => '1 hour ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/hooks/useSocialInteractions', () => ({
  COMMENT_REACTION_EMOJI_MAP: {
    like: '\uD83D\uDC4D',
    love: '\u2764\uFE0F',
    laugh: '\uD83D\uDE02',
    wow: '\uD83D\uDE2E',
    sad: '\uD83D\uDE22',
    celebrate: '\uD83C\uDF89',
  },
  AVAILABLE_REACTIONS: ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'],
}));

import { CommentsSection } from '../CommentsSection';
import type { FeedComment } from '@/components/feed/types';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

const mockComment: FeedComment = {
  id: 1,
  content: 'This is a test comment',
  created_at: '2026-01-01T00:00:00Z',
  author: { id: 10, name: 'Alice', avatar: null },
  replies: [],
  reactions: {},
  user_reactions: [],
  edited: false,
  is_own: false,
};

const defaultProps = {
  comments: [] as FeedComment[],
  commentsCount: 0,
  commentsLoading: false,
  commentsLoaded: true,
  loadComments: vi.fn().mockResolvedValue(undefined),
  submitComment: vi.fn().mockResolvedValue(true),
  editComment: vi.fn().mockResolvedValue(true),
  deleteComment: vi.fn().mockResolvedValue(true),
  toggleReaction: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
  currentUserId: 1,
  currentUserAvatar: undefined,
  currentUserName: 'Test User',
};

describe('CommentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><CommentsSection {...defaultProps} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows "Comments" header', () => {
    render(<W><CommentsSection {...defaultProps} /></W>);
    expect(screen.getByText('Comments')).toBeInTheDocument();
  });

  it('shows count in header when commentsCount > 0', () => {
    render(
      <W><CommentsSection {...defaultProps} commentsCount={5} /></W>,
    );
    expect(screen.getByText(/Comments.*\(5\)/)).toBeInTheDocument();
  });

  it('shows "No comments yet" when empty and loaded', () => {
    render(
      <W><CommentsSection {...defaultProps} comments={[]} commentsLoaded={true} /></W>,
    );
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it('shows loading skeletons when commentsLoading is true', () => {
    const { container } = render(
      <W><CommentsSection {...defaultProps} commentsLoading={true} commentsLoaded={false} /></W>,
    );
    // Skeleton elements
    expect(container.querySelector('[class*="rounded-full"]')).toBeTruthy();
  });

  it('renders comment input when authenticated', () => {
    render(<W><CommentsSection {...defaultProps} /></W>);
    expect(screen.getByPlaceholderText('Write a comment...')).toBeInTheDocument();
  });

  it('hides comment input when not authenticated', () => {
    render(
      <W><CommentsSection {...defaultProps} isAuthenticated={false} /></W>,
    );
    expect(screen.queryByPlaceholderText('Write a comment...')).not.toBeInTheDocument();
  });

  it('renders comments list', () => {
    render(
      <W>
        <CommentsSection
          {...defaultProps}
          comments={[mockComment]}
          commentsCount={1}
        />
      </W>,
    );
    expect(screen.getByText('This is a test comment')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows send comment button', () => {
    render(<W><CommentsSection {...defaultProps} /></W>);
    expect(screen.getByLabelText('Send comment')).toBeInTheDocument();
  });

  it('shows Reply button on comments', () => {
    render(
      <W>
        <CommentsSection
          {...defaultProps}
          comments={[mockComment]}
          commentsCount={1}
        />
      </W>,
    );
    expect(screen.getByText('Reply')).toBeInTheDocument();
  });

  it('shows Edit and Delete for own comments', () => {
    const ownComment: FeedComment = {
      ...mockComment,
      author: { id: 1, name: 'Test User', avatar: null },
      is_own: true,
    };
    render(
      <W>
        <CommentsSection
          {...defaultProps}
          comments={[ownComment]}
          commentsCount={1}
          currentUserId={1}
        />
      </W>,
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('submits replies to nested comments with the nested comment as parent', async () => {
    const user = userEvent.setup();
    const submitComment = vi.fn().mockResolvedValue(true);
    const commentWithReply: FeedComment = {
      ...mockComment,
      replies: [
        {
          id: 2,
          content: 'Nested reply',
          created_at: '2026-01-01T00:01:00Z',
          author: { id: 11, name: 'Bob', avatar: null },
          replies: [],
          reactions: {},
          user_reactions: [],
          edited: false,
          is_own: false,
        },
      ],
    };

    render(
      <W>
        <CommentsSection
          {...defaultProps}
          comments={[commentWithReply]}
          commentsCount={2}
          submitComment={submitComment}
        />
      </W>,
    );

    await user.click(screen.getAllByText('Reply')[1]);
    await user.type(screen.getByPlaceholderText('Reply to Bob...'), 'Thanks Bob');
    await user.click(screen.getByLabelText('Send reply'));

    expect(submitComment).toHaveBeenCalledWith('Thanks Bob', 2);
  });
});
