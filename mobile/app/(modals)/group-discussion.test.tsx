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

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiResponseError } from '@/lib/api/client';

let mockParams: Record<string, string> = { id: '7', discussionId: '42' };
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

jest.mock('@/lib/api/groups', () => ({
  getGroupDiscussionThread: (...a: unknown[]) => mockGetThread(...a),
  postGroupDiscussionMessage: (...a: unknown[]) => mockPostMessage(...a),
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
      expect(mockPostMessage).toHaveBeenCalledWith(7, 42, { content: 'Thank you, that would be great.' }),
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
