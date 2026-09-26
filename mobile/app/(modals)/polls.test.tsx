// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

let mockPollSearchParams: Record<string, string | string[]> = {};
const mockPollDraftGuard = jest.fn();
const mockPollConfirm = jest.fn((opts: { onConfirm: () => void | Promise<void> }) => {
  void opts.onConfirm();
});
const mockLoadCreationDraft = jest.fn();
const mockSaveCreationDraft = jest.fn();
const mockClearCreationDraft = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), push: jest.fn() },
  useLocalSearchParams: () => mockPollSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'pollsScreen.title': 'Polls',
        'pollsScreen.heroEyebrow': 'Community voice',
        'pollsScreen.subtitle': 'Vote on open questions and see what your community thinks.',
        'pollsScreen.emptyTitle': 'No polls yet',
        'pollsScreen.emptySubtitle': 'When members create polls, they will appear here.',
        'pollsScreen.errorTitle': 'Could not load polls',
        'pollsScreen.feedItemTitle': opts ? String(opts.title ?? 'Poll') : 'Poll',
        'pollsScreen.statusOpen': 'Open',
        'pollsScreen.statusClosed': 'Closed',
        'pollsScreen.totalVotes': opts ? `${String(opts.count ?? 0)} votes` : '0 votes',
        'pollsScreen.createPoll': 'Create poll',
        'pollsScreen.createTitle': 'Create a poll',
        'pollsScreen.questionLabel': 'Question',
        'pollsScreen.questionPlaceholder': 'Ask a question',
        'pollsScreen.descriptionLabel': 'Description',
        'pollsScreen.descriptionPlaceholder': 'Add context',
        'pollsScreen.optionsLabel': 'Options',
        'pollsScreen.optionPlaceholder': opts ? `Option ${String(opts.number ?? 1)}` : 'Option',
        'pollsScreen.addOption': 'Add option',
        'pollsScreen.removeOption': opts ? `Remove option ${String(opts.number ?? 1)}` : 'Remove option',
        'pollsScreen.submitPoll': 'Publish poll',
        'pollsScreen.creating': 'Publishing',
        'pollsScreen.createMissingTitle': 'Poll not ready',
        'pollsScreen.createQuestionRequired': 'Add a question.',
        'pollsScreen.createOptionsRequired': 'Add at least two options.',
        'pollsScreen.createdTitle': 'Poll created',
        'pollsScreen.createdMessage': 'Your poll is now open.',
        'pollsScreen.createError': 'Could not create poll.',
        'pollsScreen.typeLabel': 'Poll type',
        'pollsScreen.typeStandard': 'Pick one',
        'pollsScreen.typeRanked': 'Rank choices',
        'pollsScreen.anonymous': 'Anonymous responses',
        'common:buttons.retry': 'Retry',
        'common:cancel': 'Cancel',
        'common:errors.alertTitle': 'Something went wrong',
        'common:endOfList': 'End of list',
        'common:buttons.cancel': 'Cancel',
        'common:unsavedChanges.title': 'Leave without saving?',
        'common:unsavedChanges.message': 'Your changes have not been saved.',
        'common:unsavedChanges.discard': 'Discard',
        'common:unsavedSaving.title': 'Still saving',
        'common:unsavedSaving.message': 'Your changes are still being saved.',
        'common:unsavedSaving.leave': 'Leave anyway',
        'common:unsavedSaving.wait': 'Keep waiting',
        'common:draftStorage.title': 'Draft not protected',
        'common:draftStorage.message': 'This draft could not be saved securely.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/pollCreationOperation', () => ({
  reservePollCreationOperation: jest.fn().mockResolvedValue({ storageKey: 'poll-operation', key: 'poll-key', createdAt: 1 }),
  completePollCreationOperation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/creationDraftStore', () => ({
  loadCreationDraft: (...args: unknown[]) => mockLoadCreationDraft(...args),
  saveCreationDraft: (...args: unknown[]) => mockSaveCreationDraft(...args),
  clearCreationDraft: (...args: unknown[]) => mockClearCreationDraft(...args),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    onPrimary: '#ffffff',
    border: '#d1d5db',
    error: '#dc2626',
  }),
}));

let mockRealRead = false;
const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockRealRead ? jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi(...args) : mockUsePaginatedApi(...args),
}));

jest.mock('@/components/PollCard', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return ({ pollData, itemId, onVoted }: {
    pollData: { question: string; total_votes?: number };
    itemId: number;
    onVoted?: (updated: unknown) => void;
  }) => (
    <View>
      <Text>{pollData.question}</Text>
      <Text>{`${String(pollData.total_votes ?? 0)} votes`}</Text>
      <Pressable
        testID={`vote-${itemId}`}
        onPress={() => onVoted?.({ ...pollData, total_votes: (pollData.total_votes ?? 0) + 1 })}
      >
        <Text>Vote</Text>
      </Pressable>
    </View>
  );
});

jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});

// Stable references so screens that put `show` in a useCallback/useEffect
// dependency array don't re-run their effects on every render.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockPollConfirm, confirmDialog: null }),
}));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (options: unknown) => mockPollDraftGuard(options),
}));

jest.mock('@/lib/api/feed', () => ({
  getFeed: jest.fn(),
  getFeedAuthor: () => ({ id: 4, name: 'Poll Author', avatar: null }),
}));

jest.mock('@/lib/api/polls', () => ({
  createPoll: jest.fn().mockResolvedValue({ data: { id: 99 } }),
}));

import PollsScreen from './polls';
import { createPoll } from '@/lib/api/polls';
import { completePollCreationOperation } from '@/lib/pollCreationOperation';
import { useAppToast } from '@/components/ui/AppToast';

const mockShowToast = useAppToast().show as jest.Mock;

const defaultState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

describe('PollsScreen', () => {
  beforeEach(() => {
    mockRealRead = false;
    mockPollSearchParams = {};
    mockUsePaginatedApi.mockReset();
    mockUsePaginatedApi.mockReturnValue(defaultState);
    mockShowToast.mockClear();
    (createPoll as jest.Mock).mockClear();
    jest.mocked(completePollCreationOperation).mockClear();
    mockPollDraftGuard.mockClear();
    mockPollConfirm.mockClear();
    mockPollConfirm.mockImplementation((opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    });
    mockLoadCreationDraft.mockResolvedValue(null);
    mockSaveCreationDraft.mockResolvedValue(true);
    mockClearCreationDraft.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries the failed poll page without losing earlier polls', async () => {
    mockRealRead = true;
    const { getFeed } = require('@/lib/api/feed');
    const poll = { id: 1, type: 'poll', poll_data: { question: 'First question?', total_votes: 3, options: [] } };
    getFeed.mockResolvedValueOnce({ data: [poll], meta: { cursor: 'page-two', has_more: true } })
      .mockRejectedValueOnce(new Error('Page failed'))
      .mockResolvedValueOnce({ data: [{ ...poll, id: 2, poll_data: { ...poll.poll_data, question: 'Second question?' } }], meta: { cursor: null, has_more: false } });
    const screen = render(<PollsScreen />);
    await screen.findAllByText('First question?');
    await act(async () => screen.UNSAFE_getByType(ReactNative.FlatList).props.onEndReached());
    const failedRequest = getFeed.mock.calls[1];
    fireEvent(screen.UNSAFE_getByType(ReactNative.FlatList), 'endReached');
    expect(getFeed).toHaveBeenCalledTimes(2);
    fireEvent.press(screen.getByText('Retry'));
    await screen.findAllByText('Second question?');
    expect(getFeed.mock.calls[2]).toEqual(failedRequest);
    expect(screen.getAllByText('First question?').length).toBeGreaterThan(0);
  });

  it('keeps loaded polls visible with Retry instead of an end marker after failure', () => {
    const retry = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultState, items: [{ id: 1, type: 'poll', poll_data: { question: 'Bike shelter?', total_votes: 3, options: [] } }], error: 'Polls unavailable', refresh: retry });
    const screen = render(<PollsScreen />);
    expect(screen.getAllByText('Bike shelter?').length).toBeGreaterThan(0);
    expect(screen.getByText('Polls unavailable')).toBeTruthy();
    expect(screen.queryByText('End of list')).toBeNull();
    fireEvent.press(screen.getByText('Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the native poll list frame full height with an explicit background', () => {
    const { getByTestId } = render(<PollsScreen />);
    const screen = getByTestId('polls-screen');
    const list = getByTestId('polls-list');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(list.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(list.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 112,
    }));
  });

  it('renders the translated polls empty state', () => {
    const { getAllByText, getByText } = render(<PollsScreen />);

    expect(getAllByText('Polls').length).toBeGreaterThan(0);
    expect(getByText('No polls yet')).toBeTruthy();
    expect(getByText('When members create polls, they will appear here.')).toBeTruthy();
  });

  it('renders active poll cards from the feed polls query', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultState,
      items: [
        {
          id: 12,
          type: 'poll',
          title: 'Lunch choice',
          content: null,
          poll_data: {
            id: 12,
            question: 'Which lunch should we host?',
            total_votes: 4,
            user_vote_option_id: null,
            is_active: true,
            options: [
              { id: 1, text: 'Soup', vote_count: 2, percentage: 50 },
              { id: 2, text: 'Sandwiches', vote_count: 2, percentage: 50 },
            ],
          },
        },
      ],
    });

    const { getByText } = render(<PollsScreen />);

    expect(getByText('Lunch choice')).toBeTruthy();
    expect(getByText('Which lunch should we host?')).toBeTruthy();
    expect(getByText('4 votes')).toBeTruthy();
  });

  it('stacks and unclips the hero and poll identity at large text', () => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 360,
      height: 800,
      scale: 3,
      fontScale: 2,
    });
    mockUsePaginatedApi.mockReturnValue({
      ...defaultState,
      items: [{
        id: 42,
        type: 'poll',
        title: 'Which repair should the community prioritise next?',
        poll_data: {
          id: 42,
          question: 'Which repair should the community prioritise next?',
          total_votes: 3,
          user_vote_option_id: null,
          is_active: false,
          options: [{ id: 1, text: 'Community transport', vote_count: 2, percentage: 67 }],
        },
      }],
    });

    const { getByTestId } = render(<PollsScreen />);

    expect(getByTestId('polls-hero-layout').props.className).not.toContain('flex-row');
    expect(getByTestId('poll-feed-header-42').props.className).not.toContain('flex-row');
    expect(getByTestId('poll-feed-title-42')).toHaveProp('numberOfLines', 0);
  });

  it('creates a standard poll from the native create form', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultState, refresh });

    const { getByPlaceholderText, getByText } = render(<PollsScreen />);

    fireEvent.press(getByText('Create poll'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Which lunch should we host?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), 'Soup');
    fireEvent.changeText(getByPlaceholderText('Option 2'), 'Sandwiches');
    fireEvent.press(getByText('Publish poll'));

    await waitFor(() => expect(createPoll).toHaveBeenCalledWith({
      question: 'Which lunch should we host?',
      description: undefined,
      options: ['Soup', 'Sandwiches'],
      poll_type: 'standard',
      is_anonymous: false,
    }, 'poll-key'));
    await Promise.resolve();
    expect(mockShowToast).toHaveBeenCalledWith({
      title: 'Poll created',
      description: 'Your poll is now open.',
      variant: 'success',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('scopes the group poll draft, read and creation to the requested group', async () => {
    mockPollSearchParams = { create: '1', group_id: '23' };
    const { getFeed } = require('@/lib/api/feed');
    mockRealRead = true;
    getFeed.mockResolvedValue({ data: [], meta: { cursor: null, has_more: false } });
    const { getByPlaceholderText, getByText } = render(<PollsScreen />);

    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(1, null, expect.objectContaining({ groupId: 23 })));
    await waitFor(() => expect(mockLoadCreationDraft).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'group:23' })));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Which project comes first?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), 'Garden');
    fireEvent.changeText(getByPlaceholderText('Option 2'), 'Transport');
    fireEvent.press(getByText('Publish poll'));

    await waitFor(() => expect(createPoll).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Which project comes first?',
      group_id: 23,
    }), 'poll-key'));
  });

  it('creates ranked anonymous polls instead of silently forcing standard named voting', async () => {
    const { getByPlaceholderText, getByText } = render(<PollsScreen />);
    fireEvent.press(getByText('Create poll'));
    fireEvent.press(getByText('Rank choices'));
    fireEvent.press(getByText('Anonymous responses'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Rank the workshop topics');
    fireEvent.changeText(getByPlaceholderText('Option 1'), 'Repairs');
    fireEvent.changeText(getByPlaceholderText('Option 2'), 'Gardening');
    fireEvent.press(getByText('Publish poll'));

    await waitFor(() => expect(createPoll).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Rank the workshop topics',
      poll_type: 'ranked',
      is_anonymous: true,
    }), 'poll-key'));
  });

  it('serializes rapid publish taps before the creating state renders', async () => {
    let resolveCreate!: (value: { data: { id: number } }) => void;
    (createPoll as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    mockUsePaginatedApi.mockReturnValue({ ...defaultState, refresh: jest.fn() });
    const { getByPlaceholderText, getByText } = render(<PollsScreen />);

    fireEvent.press(getByText('Create poll'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Which lunch should we host?');
    fireEvent.changeText(getByPlaceholderText('Option 1'), 'Soup');
    fireEvent.changeText(getByPlaceholderText('Option 2'), 'Sandwiches');
    const publish = getByText('Publish poll');
    fireEvent.press(publish);
    fireEvent.press(publish);

    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveCreate({ data: { id: 99 } });
    });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  });

  it('opens the native create panel from the create deep-link flag', () => {
    mockPollSearchParams = { create: '1' };

    const { getByPlaceholderText, getByText } = render(<PollsScreen />);

    expect(getByText('Create a poll')).toBeTruthy();
    expect(getByPlaceholderText('Ask a question')).toBeTruthy();
  });

  it('protects a poll draft on route leave and keeps it until discard is confirmed', async () => {
    let pendingConfirmation: { onConfirm: () => void | Promise<void> } | undefined;
    const appStateHandlers: ((state: string) => void)[] = [];
    jest.spyOn(ReactNative.AppState, 'addEventListener').mockImplementation((_, handler) => {
      appStateHandlers.push(handler as (state: string) => void);
      return { remove: jest.fn() };
    });
    mockPollConfirm.mockImplementation((options) => { pendingConfirmation = options; });
    const { getByPlaceholderText, getByText, queryByText } = render(<PollsScreen />);

    fireEvent.press(getByText('Create poll'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Where should we meet?');

    expect(mockPollDraftGuard).toHaveBeenLastCalledWith(expect.objectContaining({ isDirty: true, isSaving: false }));
    fireEvent.press(getByText('Cancel'));
    expect(mockPollConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Leave without saving?',
      confirmLabel: 'Discard',
      variant: 'danger',
    }));
    expect(getByPlaceholderText('Ask a question').props.value).toBe('Where should we meet?');

    await act(async () => {
      await pendingConfirmation?.onConfirm();
    });
    await waitFor(() => expect(queryByText('Create a poll')).toBeNull());
    mockSaveCreationDraft.mockClear();
    act(() => { appStateHandlers.forEach((handler) => handler('background')); });
    expect(mockSaveCreationDraft).not.toHaveBeenCalled();
    fireEvent.press(getByText('Create poll'));
    expect(getByPlaceholderText('Ask a question').props.value).toBe('');
    expect(mockClearCreationDraft).toHaveBeenCalledWith({ kind: 'poll', tenantId: 2, userId: 7 });
  });

  it('keeps a poll composer and shows a persistent warning when secure discard fails', async () => {
    mockClearCreationDraft.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, getByTestId } = render(<PollsScreen />);

    fireEvent.press(getByText('Create poll'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Do not resurrect this poll');
    fireEvent.press(getByText('Cancel'));

    await waitFor(() => expect(mockClearCreationDraft).toHaveBeenCalled());
    expect(getByPlaceholderText('Ask a question').props.value).toBe('Do not resurrect this poll');
    expect(getByTestId('poll-draft-storage-warning')).toBeTruthy();
  });

  it('retains the replay identity and form when an accepted poll cannot clear its local draft', async () => {
    mockClearCreationDraft.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, getByTestId } = render(<PollsScreen />);

    fireEvent.press(getByText('Create poll'));
    fireEvent.changeText(getByPlaceholderText('Ask a question'), 'Accepted poll with failed cleanup');
    fireEvent.changeText(getByPlaceholderText('Option 1'), 'First');
    fireEvent.changeText(getByPlaceholderText('Option 2'), 'Second');
    fireEvent.press(getByText('Publish poll'));

    await waitFor(() => expect(createPoll).toHaveBeenCalled());
    expect(completePollCreationOperation).not.toHaveBeenCalled();
    expect(getByPlaceholderText('Ask a question').props.value).toBe('Accepted poll with failed cleanup');
    expect(getByTestId('poll-draft-storage-warning')).toBeTruthy();
  });

  it('restores the account-scoped poll draft and opens its composer after a restart', async () => {
    mockLoadCreationDraft.mockResolvedValueOnce({
      question: 'Which repair should happen next?',
      description: 'Keep the background and choices after process death.',
      options: ['Community hall roof', 'Accessible minibus'],
      pollType: 'ranked',
      isAnonymous: true,
    });

    const { findByPlaceholderText } = render(<PollsScreen />);

    expect((await findByPlaceholderText('Ask a question')).props.value).toBe('Which repair should happen next?');
    expect((await findByPlaceholderText('Add context')).props.value).toBe('Keep the background and choices after process death.');
    expect((await findByPlaceholderText('Option 1')).props.value).toBe('Community hall roof');
    expect((await findByPlaceholderText('Option 2')).props.value).toBe('Accessible minibus');
    expect(mockLoadCreationDraft).toHaveBeenCalledWith({ kind: 'poll', tenantId: 2, userId: 7 });
  });

  /*
    🔴 Voting used to call `refresh()`, which resets the paginated list to page one. A
    member who had scrolled through several pages, voted on one poll, and was thrown
    back to the top with everything below page one gone. Refreshing was never needed:
    the vote endpoint returns the poll's new state and the card renders from it.
    Audit 2026-09-07 F-17, fixed 2026-09-08.
  */
  describe('voting does not throw away the loaded list', () => {
    const twoPolls = [
      { id: 1, poll_data: { question: 'Bike shelter?', total_votes: 3, options: [] } },
      { id: 2, poll_data: { question: 'Tool library?', total_votes: 8, options: [] } },
    ];

    it('does not reload the list when a vote lands', () => {
      const refresh = jest.fn();
      mockUsePaginatedApi.mockReturnValue({ ...defaultState, items: twoPolls, refresh });

      const screen = render(<PollsScreen />);
      fireEvent.press(screen.getByTestId('vote-1'));

      expect(refresh).not.toHaveBeenCalled();
    });

    it('keeps the new count on screen without re-fetching', () => {
      mockUsePaginatedApi.mockReturnValue({ ...defaultState, items: twoPolls, refresh: jest.fn() });

      const screen = render(<PollsScreen />);
      expect(screen.getByText('3 votes')).toBeTruthy();

      fireEvent.press(screen.getByTestId('vote-1'));

      // The voted poll shows its new count; the other one is untouched.
      expect(screen.getByText('4 votes')).toBeTruthy();
      expect(screen.getByText('8 votes')).toBeTruthy();
    });

    it('still starts over on a deliberate pull to refresh', () => {
      const refresh = jest.fn();
      mockUsePaginatedApi.mockReturnValue({ ...defaultState, items: twoPolls, refresh });

      const screen = render(<PollsScreen />);
      fireEvent.press(screen.getByTestId('vote-1'));
      expect(screen.getByText('4 votes')).toBeTruthy();

      const list = screen.getByTestId('polls-list');
      act(() => { list.props.refreshControl.props.onRefresh(); });

      // Pulling to refresh is the member asking for the server's counts again.
      expect(refresh).toHaveBeenCalled();
    });
  });
});
