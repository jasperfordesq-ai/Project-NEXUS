// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import AppTopBar from '@/components/ui/AppTopBar';

// --- Mocks ---
jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShowToast }) }));

let mockSearchParams: { id?: string | string[]; openComments?: string } = { id: '7' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'detail.title': 'Blog Post',
        'detail.invalidId': 'Invalid post ID.',
        'detail.invalidIdHint': 'We could not identify which article to open.',
        'detail.notFound': 'Post not found.',
        'detail.notFoundHint': 'This article may have been removed.',
        'detail.goBack': 'Go Back',
        'detail.backToBlog': 'Back to blog',
        'detail.share': 'Share post',
        'detail.readFull': 'Read the full post on the web.',
        'detail.tags': 'Topics',
        'detail.article': 'Article',
        'home:comment': 'Comment',
        'publishedOn': opts ? String(opts.date ?? '') : '',
        'by': opts ? `By ${String(opts.name ?? '')}` : 'By',
        'readingTime': opts ? `${String(opts.minutes ?? 0)} min read` : '0 min read',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    info: '#3182ce',
    infoBg: '#ebf8ff',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/blog', () => ({
  getBlogPost: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
const mockCommentSheet = jest.fn((_props: unknown) => null);
const mockCommentUnmount = jest.fn();
jest.mock('@/components/comments/CommentSheet', () => {
  const React = require('react');
  return function MockCommentSheet(props: unknown) {
    React.useEffect(() => () => mockCommentUnmount(), []);
    return mockCommentSheet(props);
  };
});

// --- Tests ---

import BlogPostScreen from './blog-post';

const mockPost = {
  id: 7,
  title: 'Building Community Through Timebanking',
  slug: 'building-community-timebanking',
  excerpt: 'An exploration of how timebanking brings communities together.',
  content: 'Full content here. Timebanking is a reciprocal service exchange...',
  featured_image: null,
  published_at: '2026-03-01T10:00:00Z',
  reading_time: 5,
  category: { id: 3, name: 'Community', color: 'blue' },
};

beforeEach(() => {
  jest.restoreAllMocks();
  mockShowToast.mockClear();
  mockSearchParams = { id: '7' };
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
});

describe('BlogPostScreen', () => {
  it.each([[['first', 'second']], [['first']], [undefined]])('does not crash or load an article for ambiguous or missing route input %s', id => {
    mockSearchParams = { id };
    const screen = render(<BlogPostScreen />);
    expect(screen.toJSON()).toBeTruthy();
    expect(mockUseApi.mock.calls.at(-1)[2].enabled).toBe(false);
  });
  it.each([undefined, '1'])('resets comment visibility for the next article (openComments=%s)', (openComments) => {
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<BlogPostScreen />);
    fireEvent.press(screen.getByText('Comment'));
    mockSearchParams = { id: 'next-article', openComments };
    mockUseApi.mockReturnValue({ data: { data: { ...mockPost, id: 8, slug: 'next-article' } }, isLoading: false, error: null, refresh: jest.fn() });
    screen.rerender(<BlogPostScreen />);
    expect(mockCommentSheet).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: 8, visible: openComments === '1' }));
  });

  it('ignores a retained share action from the previous article', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: null, refresh: jest.fn() });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    const screen = render(<BlogPostScreen />);
    const action = screen.UNSAFE_getByType(AppTopBar).props.rightAction;
    mockSearchParams = { id: 'next-article' };
    screen.rerender(<BlogPostScreen />);
    await act(async () => { await action.onPress(); });
    expect(share).not.toHaveBeenCalled();
  });
  it('does not show a late share failure after leaving the article', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: null, refresh: jest.fn() });
    let rejectShare!: (error: Error) => void;
    jest.spyOn(Share, 'share').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectShare = reject; }));
    const screen = render(<BlogPostScreen />);
    const pending = screen.UNSAFE_getByType(AppTopBar).props.rightAction.onPress();
    screen.unmount();
    await act(async () => {
      rejectShare(new Error('Native share unavailable'));
      await pending;
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });
  it.each(['failure', 'dismissed'] as const)('handles native sharing %s without an unhandled rejection', async (outcome) => {
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: null, refresh: jest.fn() });
    const share = jest.spyOn(Share, 'share');
    if (outcome === 'failure') share.mockRejectedValueOnce(new Error('Native share unavailable'));
    else share.mockResolvedValueOnce({ action: Share.dismissedAction });
    const screen = render(<BlogPostScreen />);
    const action = screen.UNSAFE_getByType(AppTopBar).props.rightAction;
    await act(async () => {
      await expect(action.onPress()).resolves.toBeUndefined();
    });
    expect(share).toHaveBeenCalledTimes(1);
    if (outcome === 'failure') expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    else expect(mockShowToast).not.toHaveBeenCalled();
    share.mockRestore();
  });
  it('keeps the article and open comment sheet mounted during refresh', () => {
    const state = { data: { data: mockPost }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockReturnValue(state);
    const screen = render(<BlogPostScreen />);
    fireEvent.press(screen.getByText('Comment'));
    mockCommentUnmount.mockClear();
    mockUseApi.mockReturnValue({ ...state, isLoading: true });
    screen.rerender(<BlogPostScreen />);
    expect(mockCommentUnmount).not.toHaveBeenCalled();
    expect(screen.getByText(mockPost.title)).toBeTruthy();
  });
  it('keeps the loaded article with a retry notice after a transient refresh failure', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: 'Server error', errorStatus: 500, refresh });
    const screen = render(<BlogPostScreen />);
    expect(screen.getByText(mockPost.title)).toBeTruthy();
    expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('common:buttons.retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('does not retain an article after the server refuses access on refresh', () => {
    mockUseApi.mockReturnValue({ data: { data: mockPost }, isLoading: false, error: 'Unavailable', errorStatus: 403, refresh: jest.fn() });
    const screen = render(<BlogPostScreen />);
    expect(screen.getByTestId('blog-post-refused')).toBeTruthy();
    expect(screen.queryByText(mockPost.title)).toBeNull();
  });
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<BlogPostScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the post title when loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Building Community Through Timebanking')).toBeTruthy();
  });

  it('renders the API category name', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Community')).toBeTruthy();
  });

  it('renders the post content', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Full content here. Timebanking is a reciprocal service exchange...')).toBeTruthy();
  });

  it('opens comments from both the action and a notification deep link', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, rerender } = render(<BlogPostScreen />);
    expect(mockCommentSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, targetId: 7 }));

    fireEvent.press(getByText('Comment'));
    expect(mockCommentSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, targetId: 7 }));

    mockSearchParams = { id: '7', openComments: '1' };
    rerender(<BlogPostScreen />);
    expect(mockCommentSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, targetId: 7 }));
  });

  it('resolves relative cover image URLs', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockPost, featured_image: '/uploads/blog/community.jpg' } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText } = render(<BlogPostScreen />);
    /*
      The cover now renders through `RemoteImage`, which draws a placeholder when the load
      fails instead of a blank rectangle. The claim is unchanged — the RESOLVED absolute url
      is what gets loaded — but
      expo-image normalises `source` to an array on the way through, so this reads the entry.
    */
    const source = getByLabelText('Building Community Through Timebanking').props.source as { uri: string } | { uri: string }[];
    expect((Array.isArray(source) ? source[0] : source).uri).toBe(
      'https://api.project-nexus.ie/uploads/blog/community.jpg',
    );
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<BlogPostScreen />)).not.toThrow();
  });

  it('renders not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Post not found.')).toBeTruthy();
    expect(getByText('Back to blog')).toBeTruthy();
  });
  it('🔴 says an unpublished or removed post is not available, rather than offering a Retry', async () => {
    // A 4xx is a REFUSAL. An unpublished post, a deleted one, or one this member is
    // not allowed to read all answered 404 or 403, and all three were rendered as
    // "could not load" with a Retry that could never succeed (F/F-8).
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Not found',
      errorStatus: 404,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId, queryByTestId } = render(<BlogPostScreen />);

    expect(getByTestId('blog-post-refused')).toBeTruthy();
    expect(queryByTestId('blog-post-error')).toBeNull();
  });

  it('still shows a retry when the failure really is transient', async () => {
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Server error',
      errorStatus: 500,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<BlogPostScreen />);

    expect(getByTestId('blog-post-error')).toBeTruthy();
  });
});
