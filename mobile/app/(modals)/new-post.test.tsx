// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The success fixture below is a real `POST /api/v2/feed/posts` 201 body, captured on
 * 2026-08-23 against the local API. It is NOT a restatement of `CreatedPost`.
 *
 * That distinction is the whole reason this file is written this way. Three fixtures
 * written from the client's own types passed on the same day while the feature was
 * broken on real data — event check-in, offline check-in and the Matches screen. Note
 * `title: null` in the body: `FeedItem` declared `title` a required `string`, so a
 * fixture copied from the type would have asserted a field the server never sends.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();

/*
  🔴 Every member of this mock is a lazy arrow, not a direct reference to the spy.
  `jest.mock` factories are hoisted above the `const mockRouterReplace = …` line and
  Babel compiles that const to a `var`, so a direct reference is captured as `undefined`
  — silently, with no TDZ error. That is not a cosmetic detail: the screen checks
  `typeof router.replace === 'function'` and falls back to `push`, so the test read as
  "navigation never happened" while the app navigated perfectly well.
*/
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    push: (...args: unknown[]) => mockRouterReplace(...args),
    back: () => mockRouterBack(),
    canGoBack: () => false,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'home:newPost.title': 'Create post',
        'home:newPost.placeholder': "What's on your mind?",
        'home:newPost.submit': 'Post',
        'home:newPost.created': 'Post created!',
        'home:newPost.failed': 'Failed to create post.',
        'home:newPost.empty': 'Post content cannot be empty.',
        'home:composer.title': 'Share something with your community',
        'home:feed.title': 'Community Feed',
        'home:feed.emptySubtitle': 'Start connecting with your community to see posts here.',
        'common:buttons.back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'common:errors.notFound': 'Not found',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const mockHasModule = jest.fn(() => true);
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasModule: mockHasModule }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff', surface: '#f8f9fa', text: '#000000', textSecondary: '#666666',
    textMuted: '#999999', border: '#dddddd', borderSubtle: '#eeeeee', error: '#e53e3e',
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

const mockCreatePost = jest.fn();
jest.mock('@/lib/api/feed', () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
  MAX_POST_LENGTH: 50000,
}));

const mockMarkFeedStale = jest.fn();
jest.mock('@/lib/feedRefreshSignal', () => ({
  markFeedStale: () => mockMarkFeedStale(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

import NewPostRoute from './new-post';

/** Copied verbatim from the live 201 response. `title` really is null for a post. */
const created201 = {
  data: {
    id: 184,
    type: 'post',
    title: null,
    content: 'Probe post from the contract check.',
    content_truncated: false,
    image_url: null,
    author: { id: 675, name: 'E2E UserB', avatar_url: '/assets/img/defaults/default_avatar.png' },
    likes_count: 0,
    comments_count: 0,
    is_liked: false,
    created_at: '2026-08-23 17:54:21',
    reactions: { counts: [], total: 0, user_reaction: null, top_reactors: [] },
    media: [],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHasModule.mockReturnValue(true);
  mockCreatePost.mockResolvedValue(created201);
});

describe('NewPostRoute', () => {
  it('offers the composer with the community wording', () => {
    const { getAllByText, getByPlaceholderText } = render(<NewPostRoute />);

    expect(getAllByText('Create post').length).toBeGreaterThan(0);
    expect(getByPlaceholderText("What's on your mind?")).toBeTruthy();
    expect(getAllByText('Share something with your community').length).toBeGreaterThan(0);
  });

  it('sends the trimmed content and opens the post it created', async () => {
    const { getByPlaceholderText, getByText } = render(<NewPostRoute />);

    fireEvent.changeText(getByPlaceholderText("What's on your mind?"), '  Hello neighbours  ');
    fireEvent.press(getByText('Post'));

    await waitFor(() => {
      expect(mockCreatePost).toHaveBeenCalledWith({ content: 'Hello neighbours' });
    });
    // The id comes from the server's body, so the member lands on the real post.
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/feed-item-detail',
        params: { id: '184', type: 'post' },
      });
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Post created!', variant: 'success' }),
    );
  });

  it('marks the feed stale so the list the member returns to re-reads', async () => {
    // 🔴 The load-bearing assertion. The home feed does not refetch on focus, so without
    // this the member goes back and their own post is missing — which reads as a post
    // that was never saved.
    const { getByPlaceholderText, getByText } = render(<NewPostRoute />);

    fireEvent.changeText(getByPlaceholderText("What's on your mind?"), 'Anyone free Saturday?');
    fireEvent.press(getByText('Post'));

    await waitFor(() => expect(mockMarkFeedStale).toHaveBeenCalledTimes(1));
  });

  it('does not post whitespace, and does not claim it did', async () => {
    const { getByPlaceholderText, getByText } = render(<NewPostRoute />);

    fireEvent.changeText(getByPlaceholderText("What's on your mind?"), '     ');
    fireEvent.press(getByText('Post'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Post content cannot be empty.', variant: 'warning' }),
      );
    });
    expect(mockCreatePost).not.toHaveBeenCalled();
    expect(mockMarkFeedStale).not.toHaveBeenCalled();
  });

  it('refuses a post longer than the server accepts instead of losing it to a 422', async () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(<NewPostRoute />);

    fireEvent.changeText(getByPlaceholderText("What's on your mind?"), 'x'.repeat(50001));
    // The counter appears near the limit so the member can see why submit is refused.
    expect(getByTestId('new-post-counter')).toBeTruthy();

    fireEvent.press(getByText('Post'));

    await waitFor(() => expect(mockCreatePost).not.toHaveBeenCalled());
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('keeps the writing on screen when the post fails', async () => {
    mockCreatePost.mockRejectedValue(new Error('Network request failed'));

    const { getByPlaceholderText, getByText } = render(<NewPostRoute />);
    const field = getByPlaceholderText("What's on your mind?");

    fireEvent.changeText(field, 'Something worth keeping');
    fireEvent.press(getByText('Post'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to create post.', variant: 'danger' }),
      );
    });
    // Nothing navigates away, so the member still has their words.
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(field.props.value).toBe('Something worth keeping');
    expect(mockMarkFeedStale).not.toHaveBeenCalled();
  });

  it('says so plainly when the community has its feed switched off', () => {
    mockHasModule.mockReturnValue(false);

    const { queryByPlaceholderText, getByText } = render(<NewPostRoute />);

    expect(queryByPlaceholderText("What's on your mind?")).toBeNull();
    expect(getByText('Not found')).toBeTruthy();
  });
});
