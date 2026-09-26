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
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
let mockSearchParams: Record<string, string | string[]> = {};
const mockLoadCreationDraft = jest.fn();
const mockSaveCreationDraft = jest.fn();
const mockClearCreationDraft = jest.fn();
const mockReservePostOperation = jest.fn();
const mockCompletePostOperation = jest.fn();

/*
  🔴 Every member of this mock is a lazy arrow, not a direct reference to the spy.
  `jest.mock` factories are hoisted above the `const mockRouterReplace = …` line and
  Babel compiles that const to a `var`, so a direct reference is captured as `undefined`
  — silently, with no TDZ error. That is not a cosmetic detail: the screen checks
  `typeof router.replace === 'function'` and falls back to `push`, so the test read as
  "navigation never happened" while the app navigated perfectly well.
*/
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockSearchParams,
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
  useTenant: () => ({ hasModule: mockHasModule, tenant: { id: 2, slug: 'hour-timebank' } }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/creationDraftStore', () => ({
  loadCreationDraft: (...args: unknown[]) => mockLoadCreationDraft(...args),
  saveCreationDraft: (...args: unknown[]) => mockSaveCreationDraft(...args),
  clearCreationDraft: (...args: unknown[]) => mockClearCreationDraft(...args),
}));
jest.mock('@/lib/postCreationOperation', () => ({
  reservePostCreationOperation: (...args: unknown[]) => mockReservePostOperation(...args),
  completePostCreationOperation: (...args: unknown[]) => mockCompletePostOperation(...args),
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

// Confirmations resolve immediately so the guarded discard runs in the test.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));

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
  mockSearchParams = {};
  mockHasModule.mockReturnValue(true);
  mockCreatePost.mockResolvedValue(created201);
  mockLoadCreationDraft.mockResolvedValue(null);
  mockSaveCreationDraft.mockResolvedValue(true);
  mockClearCreationDraft.mockResolvedValue(true);
  mockReservePostOperation.mockResolvedValue({ storageKey: 'post-operation', key: 'post-key', createdAt: 1 });
  mockCompletePostOperation.mockResolvedValue(undefined);
});

describe('NewPostRoute', () => {
  it('sends only one post when submit events arrive before a rerender', async () => {
    let finish!: (value: unknown) => void;
    mockCreatePost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<NewPostRoute />);
    fireEvent.changeText(screen.getByPlaceholderText("What's on your mind?"), 'One community post');
    act(() => {
      fireEvent.press(screen.getByText('Post'));
      fireEvent.press(screen.getByText('Post'));
    });
    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledTimes(1));
    await act(async () => { finish(created201); });
  });

  it('does not navigate or announce success after the composer has departed', async () => {
    let finish!: (value: unknown) => void;
    mockCreatePost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<NewPostRoute />);
    fireEvent.changeText(screen.getByPlaceholderText("What's on your mind?"), 'A pending community post');
    fireEvent.press(screen.getByText('Post'));
    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { finish(created201); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
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
      expect(mockCreatePost).toHaveBeenCalledWith({ content: 'Hello neighbours' }, 'post-key');
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

  it('keeps a group post bound to the group from the route', async () => {
    mockSearchParams = { group_id: '23' };
    const { getByPlaceholderText, getByText } = render(<NewPostRoute />);

    fireEvent.changeText(getByPlaceholderText("What's on your mind?"), 'Group-only update');
    fireEvent.press(getByText('Post'));

    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledWith({ content: 'Group-only update', group_id: 23 }, 'post-key'));
  });

  it('restores only the current group draft after a restart', async () => {
    mockSearchParams = { group_id: '23' };
    mockLoadCreationDraft.mockResolvedValue({ content: 'Recovered group update' });
    const screen = render(<NewPostRoute />);

    await waitFor(() => expect(screen.getByPlaceholderText("What's on your mind?").props.value).toBe('Recovered group update'));
    expect(mockLoadCreationDraft).toHaveBeenCalledWith({
      kind: 'post', tenantId: 2, userId: 7, contextId: 'group:23',
    }, { required: true });
  });

  it('keeps the replay identity and draft when accepted content cannot be cleared', async () => {
    mockClearCreationDraft.mockResolvedValue(false);
    const screen = render(<NewPostRoute />);
    fireEvent.changeText(screen.getByPlaceholderText("What's on your mind?"), 'Accepted but not cleared');
    fireEvent.press(screen.getByText('Post'));

    await waitFor(() => expect(mockCreatePost).toHaveBeenCalledWith({ content: 'Accepted but not cleared' }, 'post-key'));
    expect(mockCompletePostOperation).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("What's on your mind?").props.value).toBe('Accepted but not cleared');
  });

  it('does not silently turn an invalid group route into a community post', () => {
    mockSearchParams = { group_id: 'invalid' };
    const { queryByPlaceholderText, getByText } = render(<NewPostRoute />);

    expect(queryByPlaceholderText("What's on your mind?")).toBeNull();
    expect(getByText('Not found')).toBeTruthy();
    expect(mockCreatePost).not.toHaveBeenCalled();
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
