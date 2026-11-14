// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the shared SocialInteractionPanel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const useSocialInteractionsMock = vi.hoisted(() => vi.fn());
const useEntityReactionsMock = vi.hoisted(() => vi.fn());
const mockAuthState = vi.hoisted(() => ({ isAuthenticated: true }));

vi.mock('@/hooks/useSocialInteractions', () => ({
  useSocialInteractions: useSocialInteractionsMock,
}));

// Reactions come from the one reactions store, through this hook.
vi.mock('@/hooks/useEntityReactions', () => ({
  useEntityReactions: useEntityReactionsMock,
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: mockAuthState.isAuthenticated,
    user: mockAuthState.isAuthenticated ? {
      id: 7,
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      avatar_url: null,
      avatar: null,
    } : null,
  })),
  useTenant: vi.fn(() => ({
    tenantPath: (path: string) => `/test${path}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'likes_count') return `${options?.count ?? 0} likes`;
      if (key === 'comments_count') return `${options?.count ?? 0} comments`;
      const labels: Record<string, string> = {
        comment_action: 'Comment',
        share: 'Share',
        open_comments: 'Open comments',
        close_comments: 'Close comments',
        you: 'You',
        // feed namespace, used by the shared reaction picker and summary
        'card.like_action': 'Like',
        'reaction.react_to_post': 'React',
        'card.reactions': 'reactions',
        'card.and': 'and',
        'card.other': 'other',
        'card.others': 'others',
        'card.view_reactions_aria': 'View reactions: {{summary}}',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('../CommentsSection', () => ({
  CommentsSection: ({ commentsCount }: { commentsCount: number }) => (
    <div data-testid="comments-section" data-count={commentsCount} />
  ),
}));


vi.mock('../ShareButton', () => ({
  ShareButton: ({ canShareToFeed = true }: { canShareToFeed?: boolean }) => (
    <button data-testid="share-button" data-can-share-to-feed={String(canShareToFeed)}>Share</button>
  ),
}));

import { SocialInteractionPanel } from '../SocialInteractionPanel';

function renderPanel(ui: ReactElement) {
  return render(
    <>
      <MemoryRouter>{ui}</MemoryRouter>
    </>,
  );
}

function makeReactions(overrides: Record<string, unknown> = {}) {
  return {
    reactions: {
      counts: { like: 2, love: 1 },
      total: 3,
      user_reaction: null,
      top_reactors: [{ id: 3, name: 'Bea' }],
    },
    react: vi.fn().mockResolvedValue(undefined),
    isReacting: false,
    isLoaded: true,
    failed: false,
    ...overrides,
  };
}

function makeSocial(overrides: Record<string, unknown> = {}) {
  return {
    comments: [],
    commentsCount: 2,
    commentsLoading: false,
    commentsLoaded: false,
    loadComments: vi.fn().mockResolvedValue(undefined),
    submitComment: vi.fn().mockResolvedValue(true),
    editComment: vi.fn().mockResolvedValue(true),
    deleteComment: vi.fn().mockResolvedValue(true),
    availableReactions: ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'],
    toggleReaction: vi.fn().mockResolvedValue(undefined),
    shareToFeed: vi.fn().mockResolvedValue(true),
    searchMentions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('SocialInteractionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.isAuthenticated = true;
    window.history.replaceState(null, '', '/test/feed');
    useSocialInteractionsMock.mockReturnValue(makeSocial());
    useEntityReactionsMock.mockReturnValue(makeReactions());
  });

  it('renders counts and shared social actions', () => {
    renderPanel(<SocialInteractionPanel targetType="event" targetId={42} title="Event" />);

    expect(screen.getByRole('button', { name: 'View reactions: Bea and 2 others' })).toBeInTheDocument();
    expect(screen.getByText('2 comments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open comments' })).toBeInTheDocument();
    expect(screen.getByTestId('share-button')).toBeInTheDocument();
    expect(useSocialInteractionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    // The panel asks the reactions store about exactly this item, as this viewer.
    expect(useEntityReactionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'event', targetId: 42, viewerId: 7, enabled: true }),
    );
  });

  it('does not load identity-bearing social data while anonymous', async () => {
    mockAuthState.isAuthenticated = false;
    const loadComments = vi.fn().mockResolvedValue(undefined);
    useSocialInteractionsMock.mockReturnValue(makeSocial({ loadComments }));
    window.history.replaceState(null, '', '/test/events/42#comment-123');

    renderPanel(<SocialInteractionPanel targetType="event" targetId={42} />);

    expect(useSocialInteractionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getByRole('button', { name: 'Open comments' })).toBeDisabled();
    expect(loadComments).not.toHaveBeenCalled();
    expect(screen.queryByTestId('comments-section')).not.toBeInTheDocument();
    // Reactions are members-only on the server: a visitor's page must not ask.
    expect(useEntityReactionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    // A visitor sees how many reactions there are, but no names and no way to
    // open the list of who reacted, and cannot react.
    expect(screen.getByText('3 reactions')).toBeInTheDocument();
    expect(screen.queryByText(/Bea/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View reactions/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'React' })).toBeDisabled();
  });

  it('reacts through the shared reactions hook', async () => {
    const user = userEvent.setup();
    const react = vi.fn().mockResolvedValue(undefined);
    useEntityReactionsMock.mockReturnValue(makeReactions({ react }));

    renderPanel(<SocialInteractionPanel targetType="goal" targetId={9} />);
    await user.click(screen.getByRole('button', { name: 'React' }));

    // A plain tap is the "like" reaction.
    expect(react).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenCalledWith('like');
  });

  it('opens comments and loads them on demand', async () => {
    const user = userEvent.setup();
    const loadComments = vi.fn().mockResolvedValue(undefined);
    useSocialInteractionsMock.mockReturnValue(makeSocial({ commentsCount: 0, loadComments }));

    renderPanel(<SocialInteractionPanel targetType="job" targetId={5} />);
    await user.click(screen.getByRole('button', { name: 'Open comments' }));

    await waitFor(() => {
      expect(loadComments).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('comments-section')).toBeInTheDocument();
  });

  it('opens comments for notification deep links', async () => {
    const loadComments = vi.fn().mockResolvedValue(undefined);
    useSocialInteractionsMock.mockReturnValue(makeSocial({ loadComments }));
    window.history.replaceState(null, '', '/test/events/42#comment-123');

    renderPanel(<SocialInteractionPanel targetType="event" targetId={42} />);

    await waitFor(() => {
      expect(loadComments).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('comments-section')).toBeInTheDocument();
  });

  it('hides unsupported share targets while keeping comments and likes', () => {
    renderPanel(<SocialInteractionPanel targetType="review" targetId={11} />);

    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open comments' })).toBeInTheDocument();
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
  });

  it('keeps resource comments interactive while hiding share', () => {
    renderPanel(<SocialInteractionPanel targetType="resource" targetId={18} />);

    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open comments' })).toBeInTheDocument();
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
  });

  it('honors explicit share suppression for otherwise shareable targets', () => {
    renderPanel(<SocialInteractionPanel targetType="event" targetId={42} showShare={false} />);

    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open comments' })).toBeInTheDocument();
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
  });

  it('disables feed sharing for content owned by the current user', () => {
    renderPanel(<SocialInteractionPanel targetType="challenge" targetId={42} targetOwnerId={7} />);

    expect(screen.getByTestId('share-button')).toHaveAttribute('data-can-share-to-feed', 'false');
  });
});
