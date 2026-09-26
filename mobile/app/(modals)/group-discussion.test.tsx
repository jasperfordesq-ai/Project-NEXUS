// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A member could START a group discussion and then never read a single answer to it.
 * The Discussion tab listed titles and reply counts, the cards were not pressable, and
 * `lib/api/groups.ts` had no function for either endpoint that serves a thread
 * (`routes/api.php:665-666`). Found by the 2026-09-07 audit.
 */

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

import React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiResponseError } from '@/lib/api/client';

let mockParams: Record<string, string | string[]> = { id: '7', discussionId: '42' };
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: (...a: unknown[]) => mockBack(...a) },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useFocusEffect: jest.fn(),
}));

const mockGetThread = jest.fn();
const mockPostMessage = jest.fn();
const mockLoadReplyOperation = jest.fn();
const mockReserveReplyOperation = jest.fn();
const mockCompleteReplyOperation = jest.fn();
const mockDiscardReplyOperation = jest.fn();
let mockReplyKey = 0;

jest.mock('@/lib/api/groups', () => ({
  getGroupDiscussionThread: (...a: unknown[]) => mockGetThread(...a),
  postGroupDiscussionMessage: (...a: unknown[]) => mockPostMessage(...a),
}));

jest.mock('@/lib/groupDiscussionReplyOperation', () => ({
  loadGroupDiscussionReplyOperation: (...a: unknown[]) => mockLoadReplyOperation(...a),
  reserveGroupDiscussionReplyOperation: (...a: unknown[]) => mockReserveReplyOperation(...a),
  completeGroupDiscussionReplyOperation: (...a: unknown[]) => mockCompleteReplyOperation(...a),
  discardGroupDiscussionReplyOperation: (...a: unknown[]) => mockDiscardReplyOperation(...a),
  isGroupDiscussionReplyContentValid: (content: string) => new TextEncoder().encode(content.trim()).length <= 60000,
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

const mockToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockToast }),
}));

import GroupDiscussionScreen from './group-discussion';

const THREAD = {
  data: {
    discussion: {
      id: 42,
      title: 'Can anyone help with a lift on Tuesday?',
      content: '<p class="mb-1">I need a lift to the <strong>clinic</strong>.</p><p>Any time works.</p>',
      author: { id: 3, name: 'Aoife', avatar_url: null },
      reply_count: 1,
      is_pinned: false,
      created_at: '2026-09-01T09:00:00.000Z',
      last_reply_at: '2026-09-02T09:00:00.000Z',
    },
    messages: [
      {
        id: 900,
        content: 'I can do Tuesday morning.',
        author: { id: 5, name: 'Brendan', avatar_url: null },
        is_own: false,
        created_at: '2026-09-02T09:00:00.000Z',
      },
    ],
  },
  meta: { cursor: null, per_page: 30, has_more: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: '7', discussionId: '42' };
  mockGetThread.mockResolvedValue(THREAD);
  mockReplyKey = 0;
  mockLoadReplyOperation.mockResolvedValue(null);
  mockReserveReplyOperation.mockImplementation(async (groupId: number, discussionId: number, content: string) => ({
    storageKey: `reply:${groupId}:${discussionId}`,
    key: `reply-key-${++mockReplyKey}`,
    groupId,
    discussionId,
    content: content.trim(),
    createdAt: '2026-09-02T09:59:00.000Z',
  }));
  mockCompleteReplyOperation.mockResolvedValue(undefined);
  mockDiscardReplyOperation.mockResolvedValue(undefined);
  mockPostMessage.mockResolvedValue({
    data: {
      id: 901,
      content: 'Thank you, that would be great.',
      author: { id: 3, name: 'Aoife', avatar_url: null },
      is_own: true,
      created_at: '2026-09-02T10:00:00.000Z',
    },
  });
});

describe('GroupDiscussionScreen', () => {
  it.each(['id', 'discussionId'])('rejects invalid %s values without fetching a thread', async (field) => {
    for (const invalid of [['7'], ['7', '8'], '7.5', '9007199254740993', '0', '-1']) {
      mockParams = { id: '7', discussionId: '42', [field]: invalid };
      mockGetThread.mockClear();
      const screen = render(<GroupDiscussionScreen />);
      expect(screen.getByTestId('group-discussion-invalid')).toBeTruthy();
      expect(mockGetThread).not.toHaveBeenCalled();
      screen.unmount();
    }
  });

  it('retains an uncertain reply operation and retries with the same key', async () => {
    mockPostMessage.mockRejectedValueOnce(new ApiResponseError(503, 'Reply status unknown'));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'Thank you, that would be great.');
    await act(async () => fireEvent.press(screen.getByTestId('group-discussion-reply-send')));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Your reply may already have been posted. Retry the saved reply to confirm it without posting twice.',
    }));
    expect(screen.getByTestId('group-discussion-reply-input').props.value).toBe('Thank you, that would be great.');
    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    await screen.findByText('Thank you, that would be great.');
    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    expect(mockPostMessage).toHaveBeenNthCalledWith(
      1, 7, 42, { content: 'Thank you, that would be great.' }, 'reply-key-1',
    );
    expect(mockPostMessage).toHaveBeenNthCalledWith(
      2, 7, 42, { content: 'Thank you, that would be great.' }, 'reply-key-1',
    );
    expect(mockReserveReplyOperation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('group-discussion-reply-input').props.value).toBe('');
  });

  it('restores a saved reply without replaying it until the member chooses Retry', async () => {
    mockLoadReplyOperation.mockResolvedValue({
      storageKey: 'reply:7:42',
      key: 'saved-reply-key',
      groupId: 7,
      discussionId: 42,
      content: 'Saved after a lost response',
      createdAt: '2026-09-02T09:59:00.000Z',
    });

    const screen = render(<GroupDiscussionScreen />);
    await screen.findByDisplayValue('Saved after a lost response');
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Retry saved reply')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledWith(
      7,
      42,
      { content: 'Saved after a lost response' },
      'saved-reply-key',
    ));
    expect(mockReserveReplyOperation).not.toHaveBeenCalled();
  });

  it('blocks transport when the reply cannot be saved durably', async () => {
    mockReserveReplyOperation.mockRejectedValueOnce(new Error('The reply could not be saved.'));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'Do not send without recovery');

    await act(async () => fireEvent.press(screen.getByTestId('group-discussion-reply-send')));

    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-discussion-reply-recovery-error')).toBeTruthy();
  });

  it('rejects an oversized multibyte reply before persistence or transport', async () => {
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), '😀'.repeat(15001));

    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'This reply is too long. Shorten it before posting.',
    })));
    expect(mockReserveReplyOperation).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('blocks transport until failed saved-reply recovery succeeds', async () => {
    mockLoadReplyOperation.mockRejectedValueOnce(new Error('Unreadable saved operation'));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByTestId('group-discussion-reply-recovery-error');
    expect(mockPostMessage).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Retry'));
    await screen.findByTestId('group-discussion-reply-input');
    expect(mockLoadReplyOperation).toHaveBeenCalledTimes(2);
  });

  it('reconciles a posted reply with the refreshed server page without duplicates', async () => {
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'Thank you, that would be great.');
    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    await screen.findByText('Thank you, that would be great.');
    mockGetThread.mockResolvedValue({ ...THREAD, data: { ...THREAD.data, messages: [...THREAD.data.messages, { ...THREAD.data.messages[0], id: 901, content: 'Server edited reply' }] } });
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await screen.findByText('Server edited reply');
    expect(screen.queryByText('Thank you, that would be great.')).toBeNull();
    expect(screen.getAllByText('Server edited reply')).toHaveLength(1);
  });

  it('retains accepted replies when refresh fails and reports that failure', async () => {
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'Thank you, that would be great.');
    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    await screen.findByText('Thank you, that would be great.');
    mockGetThread.mockRejectedValue(new ApiResponseError(422, 'Temporary read failure'));
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await screen.findByTestId('group-discussion-refresh-error');
    expect(screen.getByText('Thank you, that would be great.')).toBeTruthy();
    expect(screen.getByText('I can do Tuesday morning.')).toBeTruthy();
  });

  it('does not append an older page that completes after a refresh', async () => {
    let resolvePage!: (value: unknown) => void;
    mockGetThread.mockResolvedValueOnce({ ...THREAD, meta: { cursor: 'older', has_more: true } });
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByTestId('group-discussion-show-earlier');
    mockGetThread.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    fireEvent.press(screen.getByTestId('group-discussion-show-earlier'));
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(mockGetThread).toHaveBeenCalledTimes(3));
    await act(async () => { resolvePage({ ...THREAD, data: { ...THREAD.data, messages: [{ ...THREAD.data.messages[0], id: 800, content: 'Obsolete older page' }] } }); });
    expect(screen.queryByText('Obsolete older page')).toBeNull();
  });

  it('hides retained discussion content when refreshed access is refused', async () => {
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    mockGetThread.mockRejectedValue(new ApiResponseError(403, 'Membership ended'));
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    await screen.findByTestId('group-discussion-forbidden');
    expect(screen.queryByText('I can do Tuesday morning.')).toBeNull();
    expect(screen.queryByTestId('group-discussion-reply-input')).toBeNull();
  });

  it('starts a changed route with a clean draft and ignores the previous send', async () => {
    let resolveSend!: (value: unknown) => void;
    mockPostMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'Old thread reply');
    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    mockParams = { id: '7', discussionId: '43' };
    screen.rerender(<GroupDiscussionScreen />);
    await screen.findByTestId('group-discussion-reply-input');
    await act(async () => { resolveSend({ data: { ...THREAD.data.messages[0], id: 901, content: 'Old thread reply' } }); });
    expect(screen.queryByText('Old thread reply')).toBeNull();
    expect(screen.getByTestId('group-discussion-reply-input').props.value).toBe('');
  });

  it('locks repeated send callbacks immediately and preserves a newer draft', async () => {
    let resolveSend!: (value: unknown) => void;
    mockPostMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'First reply');
    let button = screen.getByTestId('group-discussion-reply-send');
    while (!button.props.onPress && button.parent) button = button.parent;
    const send = button.props.onPress;
    act(() => { void send(); void send(); });
    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(1));
    // A native edit queued before the disabled state reached the input may arrive late.
    act(() => screen.getByTestId('group-discussion-reply-input').props.onChangeText('Next reply draft'));
    await act(async () => { resolveSend({ data: { ...THREAD.data.messages[0], id: 901, content: 'First reply' } }); });
    expect(screen.getByText('First reply')).toBeTruthy();
    expect(screen.getByTestId('group-discussion-reply-input').props.value).toBe('Next reply draft');
  });

  it('does not show a delayed send failure after leaving the discussion', async () => {
    let rejectSend!: (error: Error) => void;
    mockPostMessage.mockReturnValue(new Promise((_resolve, reject) => { rejectSend = reject; }));
    const screen = render(<GroupDiscussionScreen />);
    await screen.findByText('I can do Tuesday morning.');
    fireEvent.changeText(screen.getByTestId('group-discussion-reply-input'), 'First reply');
    fireEvent.press(screen.getByTestId('group-discussion-reply-send'));
    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { rejectSend(new Error('Delayed failure')); });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('shows the opening post and the replies, with the stored HTML turned into readable text', async () => {
    const { getByText, queryByText } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByText('Can anyone help with a lift on Tuesday?')).toBeTruthy());
    expect(getByText('I can do Tuesday morning.')).toBeTruthy();
    // The web composer stores HTML; `<Text>` would otherwise print the markup verbatim.
    expect(getByText(/I need a lift to the clinic\./)).toBeTruthy();
    expect(queryByText(/<p class=/)).toBeNull();
  });

  it('posts a reply and shows it without waiting for a reload', async () => {
    const { getByTestId, getByText } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByText('I can do Tuesday morning.')).toBeTruthy());

    fireEvent.changeText(getByTestId('group-discussion-reply-input'), 'Thank you, that would be great.');
    fireEvent.press(getByTestId('group-discussion-reply-send'));

    await waitFor(() =>
      expect(mockPostMessage).toHaveBeenCalledWith(
        7,
        42,
        { content: 'Thank you, that would be great.' },
        'reply-key-1',
      ),
    );
    await waitFor(() => expect(getByText('Thank you, that would be great.')).toBeTruthy());
  });

  it('tells the member why a reply was refused, in the server’s own words', async () => {
    mockPostMessage.mockRejectedValue(
      new ApiResponseError(409, 'This discussion has been closed by an admin.'),
    );

    const { getByTestId, getByText } = render(<GroupDiscussionScreen />);
    await waitFor(() => expect(getByText('I can do Tuesday morning.')).toBeTruthy());

    fireEvent.changeText(getByTestId('group-discussion-reply-input'), 'One more thought');
    fireEvent.press(getByTestId('group-discussion-reply-send'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'This discussion has been closed by an admin.' }),
      ),
    );
    expect(mockDiscardReplyOperation).toHaveBeenCalledWith(expect.objectContaining({ key: 'reply-key-1' }));
  });

  it('offers a way back rather than a Retry when access is refused', async () => {
    mockGetThread.mockRejectedValue(new ApiResponseError(403, 'You are not a member of this group.'));

    const { getByTestId, queryByText } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByTestId('group-discussion-forbidden')).toBeTruthy());
    // Retry can never turn a 403 into a thread.
    expect(queryByText('Try again')).toBeNull();
  });

  it('offers a way back rather than a Retry when the discussion is gone', async () => {
    mockGetThread.mockRejectedValue(new ApiResponseError(404, 'Discussion not found.'));

    const { getByTestId, queryByText } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByTestId('group-discussion-missing')).toBeTruthy());
    expect(queryByText('Try again')).toBeNull();
  });

  it('still offers a Retry when the failure really is transient', async () => {
    mockGetThread.mockRejectedValue(new ApiResponseError(500, 'Server error'));

    const { getByTestId } = render(<GroupDiscussionScreen />);

    // `useApi` retries a 500 once after two seconds before it gives up, so this state
    // legitimately takes longer to appear than a refusal does.
    await waitFor(() => expect(getByTestId('group-discussion-error')).toBeTruthy(), { timeout: 6000 });
  }, 12000);

  it('walks backwards through older replies and prepends them', async () => {
    mockGetThread.mockResolvedValueOnce({
      ...THREAD,
      meta: { cursor: 'older-1', per_page: 30, has_more: true },
    });
    mockGetThread.mockResolvedValueOnce({
      data: {
        discussion: THREAD.data.discussion,
        messages: [
          {
            id: 800,
            content: 'An older reply.',
            author: { id: 9, name: 'Cara', avatar_url: null },
            is_own: false,
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
      },
      meta: { cursor: null, per_page: 30, has_more: false },
    });

    const { getByTestId, getByText, queryByTestId } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByTestId('group-discussion-show-earlier')).toBeTruthy());
    fireEvent.press(getByTestId('group-discussion-show-earlier'));

    await waitFor(() => expect(getByText('An older reply.')).toBeTruthy());
    expect(mockGetThread).toHaveBeenLastCalledWith(7, 42, 'older-1');
    // Nothing left to page through, so the control goes away.
    await waitFor(() => expect(queryByTestId('group-discussion-show-earlier')).toBeNull());
  });

  it('does not call the API at all when the link carried no discussion id', async () => {
    mockParams = { id: '7', discussionId: 'nonsense' };

    const { getByTestId } = render(<GroupDiscussionScreen />);

    await waitFor(() => expect(getByTestId('group-discussion-invalid')).toBeTruthy());
    expect(mockGetThread).not.toHaveBeenCalled();
  });
});
