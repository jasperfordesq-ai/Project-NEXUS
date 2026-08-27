// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FeedCard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { comments: [] } }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
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

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || ''),
  resolveAssetUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  formatDate: vi.fn(() => '21 Feb 2026'),
  formatTime: vi.fn(() => '12:00'),
  getFormattingLocale: vi.fn(() => 'en'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, layout, ...rest } = props; void variants; void initial; void animate; void exit; void layout;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FeedCard } from './FeedCard';
import type { FeedItem } from './types';

const baseFeedItem: FeedItem = {
  id: 1,
  content: 'Hello world!',
  title: 'Test Post Title',
  author_name: 'Jane Doe',
  author_avatar: '/jane.png',
  author_id: 10,
  created_at: '2026-02-21T12:00:00Z',
  type: 'post',
  likes_count: 5,
  comments_count: 3,
  is_liked: false,
};

const defaultProps = {
  item: baseFeedItem,
  onToggleLike: vi.fn(),
  onHidePost: vi.fn(),
  onMuteUser: vi.fn(),
  onReportPost: vi.fn(),
  onDeletePost: vi.fn(),
  onVotePoll: vi.fn(),
  isAuthenticated: true,
  currentUserId: 99,
};

describe('FeedCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders author name and content', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Hello world!')).toBeInTheDocument();
  });

  it('renders title when different from content', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText('Test Post Title')).toBeInTheDocument();
  });

  it('does not render title when same as content', () => {
    const item = { ...baseFeedItem, title: 'Hello world!' };
    render(<FeedCard {...defaultProps} item={item} />);
    // Content appears once, not duplicated
    const matches = screen.getAllByText('Hello world!');
    expect(matches.length).toBe(1);
  });

  it('shows relative time', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
  });

  it('shows like count', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText(/5 likes/)).toBeInTheDocument();
  });

  it('shows comment count', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText(/3 comments/)).toBeInTheDocument();
  });

  it('shows type chip for non-post types', () => {
    const item = { ...baseFeedItem, type: 'event' as const };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.getByText('Event')).toBeInTheDocument();
  });

  it.each([
    ['podcast_show', 'Podcast show'],
    ['podcast_episode', 'Podcast episode'],
  ] as const)('renders %s activity without crashing', (type, label) => {
    const item: FeedItem = {
      ...baseFeedItem,
      type,
      slug: type === 'podcast_show' ? 'community-voices' : 'welcome',
      show_slug: type === 'podcast_episode' ? 'community-voices' : undefined,
    };

    render(<FeedCard {...defaultProps} item={item} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not render historical remote artwork from cached podcast activity', () => {
    const item: FeedItem = {
      ...baseFeedItem,
      type: 'podcast_episode',
      slug: 'welcome',
      show_slug: 'community-voices',
      image_url: 'https://tracking.example.test/pixel.png',
    };

    render(<FeedCard {...defaultProps} item={item} />);

    expect(screen.queryByRole('img', { name: /podcast episode image/i })).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="tracking.example.test"]')).not.toBeInTheDocument();
  });

  it('does not show type chip for posts', () => {
    render(<FeedCard {...defaultProps} />);
    // Post type has typeLabel = null
    expect(screen.queryByText('Post')).not.toBeInTheDocument();
  });

  it('renders image with proper alt text', () => {
    const item = { ...baseFeedItem, image_url: '/test-image.jpg' };
    render(<FeedCard {...defaultProps} item={item} />);
    const img = screen.getByAltText('Post image by Jane Doe');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('calls onToggleLike when Like button pressed', async () => {
    const user = userEvent.setup();
    render(<FeedCard {...defaultProps} />);
    const likeBtn = screen.getByText('Like');
    await user.click(likeBtn);
    expect(defaultProps.onToggleLike).toHaveBeenCalledOnce();
  });

  it('disables like button when not authenticated', () => {
    render(<FeedCard {...defaultProps} isAuthenticated={false} />);
    const likeBtn = screen.getByText('Like').closest('button');
    expect(likeBtn).toBeDisabled();
  });

  it('shows moderation menu for authenticated users', () => {
    render(<FeedCard {...defaultProps} />);
    // Two buttons exist (desktop dropdown + mobile bottom sheet trigger) — JSDOM renders both
    const buttons = screen.getAllByLabelText('Post options');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0]).toBeInTheDocument();
  });

  it('does not show moderation menu for unauthenticated users', () => {
    render(<FeedCard {...defaultProps} isAuthenticated={false} />);
    expect(screen.queryByLabelText('Post options')).not.toBeInTheDocument();
  });

  it('shows post options button for own posts', () => {
    // Set currentUserId to match author_id — dropdown items render on open,
    // but the trigger button should always be present
    render(<FeedCard {...defaultProps} currentUserId={10} />);
    const buttons = screen.getAllByLabelText('Post options');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows post options button for other users posts', () => {
    render(<FeedCard {...defaultProps} currentUserId={99} />);
    const buttons = screen.getAllByLabelText('Post options');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders review with rating stars', () => {
    const item: FeedItem = {
      ...baseFeedItem,
      type: 'review',
      rating: 4,
      receiver: { id: 20, name: 'John Smith' },
    };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('renders poll with vote buttons when user has not voted', () => {
    const item: FeedItem = {
      ...baseFeedItem,
      type: 'poll',
      poll_data: {
        id: 1,
        question: 'Favorite color?',
        options: [
          { id: 10, text: 'Red', vote_count: 3, percentage: 60 },
          { id: 11, text: 'Blue', vote_count: 2, percentage: 40 },
        ],
        total_votes: 5,
        user_vote_option_id: null,
        is_active: true,
      },
    };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.getByText('5 votes')).toBeInTheDocument();
  });

  it('renders poll results when user has voted', () => {
    const item: FeedItem = {
      ...baseFeedItem,
      type: 'poll',
      poll_data: {
        id: 1,
        question: 'Favorite color?',
        options: [
          { id: 10, text: 'Red', vote_count: 3, percentage: 60 },
          { id: 11, text: 'Blue', vote_count: 2, percentage: 40 },
        ],
        total_votes: 5,
        user_vote_option_id: 10,
        is_active: true,
      },
    };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('shows singular "1 like" and "1 comment"', () => {
    const item = { ...baseFeedItem, likes_count: 1, comments_count: 1 };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.getByText(/1 like$/)).toBeInTheDocument();
    expect(screen.getByText(/1 comment$/)).toBeInTheDocument();
  });

  it('hides stats row when both counts are zero', () => {
    const item = { ...baseFeedItem, likes_count: 0, comments_count: 0 };
    render(<FeedCard {...defaultProps} item={item} />);
    expect(screen.queryByText(/likes?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/comments?$/)).not.toBeInTheDocument();
  });

  /*
   * Gamification milestones were removed from the feed on the owner's
   * instruction (2026-08-27). They used to render as a full-width celebratory
   * card with an oversized icon and a confetti burst, and they crowded out
   * member content.
   *
   * The API no longer serves them and the feed lists filter them out, so this
   * asserts the last line of defence: handed one directly (a cached payload, a
   * stale service-worker response), the card renders NOTHING — not a smaller
   * card, not an empty shell.
   */
  describe('gamification milestones are not rendered', () => {
    it.each(['badge_earned', 'level_up'] as const)('renders nothing for a %s item', (type) => {
      const item = {
        ...baseFeedItem,
        type,
        title: type === 'level_up' ? 'Level 3' : 'Gift Giver',
        badge_name: 'Gift Giver',
        new_level: 3,
      } as unknown as FeedItem;

      const { container } = render(<FeedCard {...defaultProps} item={item} />);

      expect(container).toBeEmptyDOMElement();
    });
  });
});
