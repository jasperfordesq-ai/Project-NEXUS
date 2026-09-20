// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { ApiResponseError } from '@/lib/api/client';

const mockUseApi = jest.fn();
let mockRealRead = false;
let mockId: string | string[] = '7';
const mockGetKbArticle = jest.fn();
const mockSubmitFeedback = jest.fn();
const mockDownload = jest.fn();
const mockPush = jest.fn();
const mockOpenExternal = jest.fn();
const mockBlurListeners = new Set<() => void>();
const mockNavigation = {
  addListener: (event: string, callback: () => void) => {
    if (event === 'blur') mockBlurListeners.add(callback);
    return () => { mockBlurListeners.delete(callback); };
  },
  dispatch: jest.fn(), setOptions: jest.fn(),
};
jest.mock('@/components/ui/useOpenExternalUrl', () => ({ useOpenExternalUrl: () => mockOpenExternal }));
jest.mock('@/lib/volunteering/authenticatedFileDownload', () => ({ downloadAuthenticatedFile: (...args: unknown[]) => mockDownload(...args), SHARING_UNAVAILABLE: 'sharing_unavailable' }));
jest.mock('@/lib/api/resources', () => ({ getKbArticle: (...args: unknown[]) => mockGetKbArticle(...args), submitKbFeedback: (...args: unknown[]) => mockSubmitFeedback(...args) }));

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useNavigation: () => mockNavigation,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: mockId }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockRealRead ? jest.requireActual('@/lib/hooks/useApi').useApi(...args) : mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    info: '#2563eb',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'resources:articleTitle': 'Article',
        'resources:views': opts ? `${String(opts.count)} views` : 'views',
        'resources:helpful': opts ? `${String(opts.yes)} helpful` : 'helpful',
        'resources:errorTitle': 'Could not load resources',
        'resources:emptyTitle': 'Nothing found',
      };
      return map[key] ?? key;
    },
  }),
}));

import KbArticleScreen from './kb-article';

describe('KbArticleScreen', () => {
  beforeEach(() => {
    mockRealRead = false;
    mockId = '7';
    mockGetKbArticle.mockReset();
    mockSubmitFeedback.mockReset();
    mockDownload.mockReset();
    mockPush.mockClear();
    mockOpenExternal.mockReset();
    mockBlurListeners.clear();
    mockUseApi.mockReturnValue({
      data: {
        id: 7,
        title: 'Using time credits',
        content: '<p>Time credits are exchanged hour for hour.</p>',
        category_name: 'Basics',
        views_count: 12,
        helpful_yes: 3,
        helpful_no: 1,
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('reflects the saved vote and confirms server totals with single-flight submission', async () => {
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, my_feedback: false } });
    let finish!: (value: unknown) => void;
    mockSubmitFeedback.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<KbArticleScreen />);
    expect(screen.getByRole('button', { name: 'resources:feedback.no (1)', selected: true })).toBeTruthy();
    fireEvent.press(screen.getByText('resources:feedback.yes (3)'));
    fireEvent.press(screen.getByText('resources:feedback.no (1)'));
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(mockSubmitFeedback).toHaveBeenCalledWith(7, true);
    expect(screen.queryByText('resources:feedbackThanks')).toBeNull();
    await act(async () => finish({ ...base.data, my_feedback: true, helpful_yes: 8, helpful_no: 2 }));
    expect(screen.getByRole('button', { name: 'resources:feedback.yes (8)', selected: true })).toBeTruthy();
    expect(screen.getByText('resources:feedback.no (2)')).toBeTruthy();
    expect(screen.getByText('resources:feedbackThanks')).toBeTruthy();
    // Android must rebuild a nonempty description after busy clears.
    expect(screen.getByRole('button', { name: 'resources:feedback.yes (8)' }).props.accessibilityLabel).toBe('resources:feedback.yes (8)');
  });

  it('retains counts after failure and retries the same choice without claiming success', async () => {
    mockSubmitFeedback.mockRejectedValueOnce(new Error('Confirmation failed'));
    const screen = render(<KbArticleScreen />);
    await act(async () => fireEvent.press(screen.getByText('resources:feedback.no (1)')));
    expect(screen.getByText('resources:feedbackFailed')).toBeTruthy();
    expect(screen.getByText('resources:feedback.yes (3)')).toBeTruthy();
    expect(screen.queryByText('resources:feedbackThanks')).toBeNull();
    mockSubmitFeedback.mockResolvedValue({ ...mockUseApi().data, my_feedback: false, helpful_no: 2 });
    await act(async () => fireEvent.press(screen.getByText('common:buttons.retry')));
    expect(mockSubmitFeedback).toHaveBeenNthCalledWith(2, 7, false);
    expect(screen.getByText('resources:feedback.no (2)')).toBeTruthy();
  });

  it.each([401, 403, 404])('hides feedback actions and rechecks the article on refusal %s', async (status) => {
    const base = mockUseApi();
    mockSubmitFeedback.mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
    const screen = render(<KbArticleScreen />);
    await act(async () => fireEvent.press(screen.getByText('resources:feedback.yes (3)')));
    expect(screen.queryByText('resources:feedback.yes (3)')).toBeNull();
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(base.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('common:buttons.retry')).toBeNull();
  });

  it('rechecks after a vote completes across a newer article refresh', async () => {
    const base = mockUseApi();
    let finish!: (value: unknown) => void;
    mockSubmitFeedback.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<KbArticleScreen />);
    fireEvent.press(screen.getByText('resources:feedback.yes (3)'));
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, helpful_yes: 10 } });
    screen.rerender(<KbArticleScreen />);
    await act(async () => finish({ ...base.data, my_feedback: true, helpful_yes: 4 }));
    expect(screen.getByText('resources:feedback.yes (10)')).toBeTruthy();
    expect(base.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('resources:feedbackThanks')).toBeNull();
  });

  it('does not carry late feedback into a newly opened article', async () => {
    let finish!: (value: unknown) => void;
    mockSubmitFeedback.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<KbArticleScreen />);
    fireEvent.press(screen.getByText('resources:feedback.yes (3)'));
    mockId = '8';
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, id: 8, helpful_yes: 9 } });
    screen.rerender(<KbArticleScreen />);
    await act(async () => finish({ ...base.data, my_feedback: true, helpful_yes: 4 }));
    expect(screen.getByText('resources:feedback.yes (9)')).toBeTruthy();
    expect(screen.queryByText('resources:feedbackThanks')).toBeNull();
  });

  it('opens the article video through the shared link handler and omits empty video actions', async () => {
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, video_url: 'https://www.youtube.com/watch?v=example' } });
    const screen = render(<KbArticleScreen />);
    await act(async () => fireEvent.press(screen.getByText('resources:watchVideo')));
    expect(mockOpenExternal).toHaveBeenCalledWith('https://www.youtube.com/watch?v=example');
    expect(screen.getByText('resources:videoExternalHint')).toBeTruthy();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, video_url: ' ' } });
    screen.rerender(<KbArticleScreen />);
    expect(screen.queryByText('resources:watchVideo')).toBeNull();
  });

  it('opens related articles and downloads attachments once, with retry after failure', async () => {
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data,
      children: [{ id: 8, title: 'Next article' }],
      attachments: [{ id: 11, file_name: 'Member guide.pdf' }],
    } });
    let rejectDownload!: (error: unknown) => void;
    mockDownload.mockImplementation(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const screen = render(<KbArticleScreen />);
    fireEvent.press(screen.getByText('Next article'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/kb-article', params: { id: '8' } });
    fireEvent.press(screen.getByText('Member guide.pdf'));
    fireEvent.press(screen.getByText('Member guide.pdf'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith('/api/v2/kb/7/attachments/11/download', 'Member guide.pdf', {}, { isActive: expect.any(Function) });
    const downloadLifetime = mockDownload.mock.calls[0][3];
    expect(downloadLifetime.isActive()).toBe(true);
    expect(screen.getByRole('button', { name: 'Member guide.pdf' }).props.accessibilityLabel).toBe('Member guide.pdf');
    await act(async () => rejectDownload(new Error('Offline')));
    expect(screen.getByText('resources:downloadFailed')).toBeTruthy();
    mockDownload.mockResolvedValue(undefined);
    await act(async () => fireEvent.press(screen.getByText('common:buttons.retry')));
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Member guide.pdf' }).props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(screen.queryByText('resources:downloadFailed')).toBeNull();
    screen.unmount();
    expect(downloadLifetime.isActive()).toBe(false);
  });

  it('invalidates a pending attachment share on blur even if the article stays mounted', async () => {
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, attachments: [{ id: 11, file_name: 'Guide.pdf' }] } });
    let rejectDownload!: (error: unknown) => void;
    mockDownload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const screen = render(<KbArticleScreen />);
    fireEvent.press(screen.getByText('Guide.pdf'));
    const originalLifetime = mockDownload.mock.calls[0][3];
    expect(originalLifetime.isActive()).toBe(true);
    act(() => { for (const blur of mockBlurListeners) blur(); });
    expect(originalLifetime.isActive()).toBe(false);
    await act(async () => rejectDownload(new Error('download_cancelled')));
    expect(screen.queryByText('resources:downloadFailed')).toBeNull();
    mockDownload.mockResolvedValue(undefined);
    await act(async () => fireEvent.press(screen.getByText('Guide.pdf')));
    expect(mockDownload.mock.calls[1][3].isActive()).toBe(true);
    expect(originalLifetime.isActive()).toBe(false);
  });

  it.each([403, 404])('removes a refused attachment after download status %s', async (status) => {
    const base = mockUseApi();
    mockUseApi.mockReturnValue({ ...base, data: { ...base.data, attachments: [{ id: 11, file_name: 'Removed.pdf' }] } });
    mockDownload.mockRejectedValue(new ApiResponseError(status, 'Unavailable'));
    const screen = render(<KbArticleScreen />);
    await act(async () => fireEvent.press(screen.getByText('Removed.pdf')));
    expect(screen.queryByText('Removed.pdf')).toBeNull();
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(screen.queryByText('common:buttons.retry')).toBeNull();
    expect(screen.getByText('Time credits are exchanged hour for hour.')).toBeTruthy();
  });

  it('restores a refused attachment only after a successful article refresh', async () => {
    mockRealRead = true;
    const article = { id: 7, title: 'Guide', content: 'Body', attachments: [{ id: 11, file_name: 'Guide.pdf' }] };
    mockGetKbArticle.mockResolvedValueOnce(article).mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ ...article, attachments: [...article.attachments] });
    mockDownload.mockRejectedValueOnce(new ApiResponseError(404, 'Unavailable')).mockResolvedValue(undefined);
    const screen = render(<KbArticleScreen />);
    await waitFor(() => expect(screen.getByText('Guide.pdf')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByText('Guide.pdf')));
    expect(screen.queryByText('Guide.pdf')).toBeNull();
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(screen.queryByText('Guide.pdf')).toBeNull();
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(screen.getByText('Guide.pdf')).toBeTruthy();
    expect(screen.queryByText('common:errors.notAvailableTitle')).toBeNull();
    await act(async () => fireEvent.press(screen.getByText('Guide.pdf')));
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('does not apply an old download refusal to a refreshed attachment list', async () => {
    mockRealRead = true;
    const article = { id: 7, title: 'Guide', content: 'Body', attachments: [{ id: 11, file_name: 'Guide.pdf' }] };
    mockGetKbArticle.mockResolvedValueOnce(article).mockResolvedValueOnce({ ...article, attachments: [...article.attachments] });
    let rejectDownload!: (error: unknown) => void;
    mockDownload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const screen = render(<KbArticleScreen />);
    await waitFor(() => expect(screen.getByText('Guide.pdf')).toBeTruthy());
    fireEvent.press(screen.getByText('Guide.pdf'));
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    fireEvent.press(screen.getByText('Guide.pdf'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await act(async () => rejectDownload(new ApiResponseError(404, 'Old refusal')));
    expect(screen.getByText('Guide.pdf')).toBeTruthy();
    expect(screen.queryByText('common:errors.notAvailableTitle')).toBeNull();
  });

  it.each([401, 403, 404])('removes the title and body on refusal %s and keeps them absent during recovery', async (status) => {
    mockRealRead = true;
    mockGetKbArticle.mockResolvedValueOnce({ id: 7, title: 'Old title', content: 'Old body' })
      .mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
    const screen = render(<KbArticleScreen />);
    await waitFor(() => expect(screen.getByText('Old body')).toBeTruthy());
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(screen.getByTestId('kb-article-refused')).toBeTruthy();
    expect(screen.queryByText('Old body')).toBeNull();
    expect(screen.queryAllByText('Old title')).toHaveLength(0);
    let finish!: (value: unknown) => void;
    mockGetKbArticle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(screen.queryByText('Old body')).toBeNull();
    expect(screen.queryAllByText('Old title')).toHaveLength(0);
    await act(async () => finish({ id: 7, title: 'Fresh title', content: 'Fresh body' }));
    expect(screen.getByText('Fresh body')).toBeTruthy();
  });

  it.each(['0', '-1', '1.5', 'Infinity', '9007199254740992', '7garbage'])('does not request invalid article id %s', (id) => {
    mockRealRead = true;
    mockId = id;
    const screen = render(<KbArticleScreen />);
    expect(mockGetKbArticle).not.toHaveBeenCalled();
    expect(screen.getByTestId('kb-article-refused')).toBeTruthy();
  });

  it('ignores a late response after opening another article', async () => {
    mockRealRead = true;
    let finishOld!: (value: unknown) => void;
    mockGetKbArticle.mockImplementation((id: number) => id === 7
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve({ id, title: 'Current article', content: 'Current body' }));
    const screen = render(<KbArticleScreen />);
    mockId = ['8', '7'];
    await act(async () => screen.rerender(<KbArticleScreen />));
    expect(screen.getByText('Current body')).toBeTruthy();
    await act(async () => finishOld({ id: 7, title: 'Previous article', content: 'Previous body' }));
    expect(screen.queryByText('Previous body')).toBeNull();
    expect(screen.getByText('Current body')).toBeTruthy();
  });

  /**
   * 🔴 The failure this closes. `useApi` keeps the previous `data` when a refresh fails,
   * and this screen's branch is `article ? <article/> : <error/>` — so a pull that failed
   * left the old article on screen with nothing to say it was out of date, and the pull
   * gesture simply snapped back. A member on a train came out of a tunnel, pulled, and was
   * told nothing at all.
   */
  it('says so when a refresh fails and the article on screen is now out of date', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({
      data: {
        id: 7,
        title: 'Using time credits',
        content: '<p>Time credits are exchanged hour for hour.</p>',
        category_name: 'Basics',
        views_count: 12,
        helpful_yes: 3,
        helpful_no: 1,
      },
      isLoading: false,
      error: 'Network error. Please check your connection.',
      errorStatus: null,
      refresh,
    });

    const { getByTestId, getByText } = render(<KbArticleScreen />);

    // The article is still there — a failed refresh must never throw content away.
    expect(getByText('Time credits are exchanged hour for hour.')).toBeTruthy();
    expect(getByTestId('refresh-failed-notice')).toBeTruthy();
  });

  it('stays quiet while the article is up to date', () => {
    const { queryByTestId } = render(<KbArticleScreen />);
    expect(queryByTestId('refresh-failed-notice')).toBeNull();
  });

  it('renders article content and metadata', () => {
    const { getAllByText, getByText } = render(<KbArticleScreen />);

    expect(getAllByText('Using time credits').length).toBeGreaterThan(0);
    expect(getByText('Time credits are exchanged hour for hour.')).toBeTruthy();
    expect(getByText('Basics')).toBeTruthy();
    expect(getByText('12 views')).toBeTruthy();
    expect(getByText('resources:feedback.yes (3)')).toBeTruthy();
  });
});
