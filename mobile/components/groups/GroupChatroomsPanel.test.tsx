// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockApi = {
  getRooms: jest.fn(), getMessages: jest.fn(), getPinned: jest.fn(), postMessage: jest.fn(),
  createRoom: jest.fn(), deleteRoom: jest.fn(), deleteMessage: jest.fn(), pin: jest.fn(), unpin: jest.fn(),
};
const mockOperation = { load: jest.fn(), reserve: jest.fn(), complete: jest.fn(), discard: jest.fn() };
const mockToast = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006fee' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({
  text: '#111', textSecondary: '#555', surface: '#fff', error: '#c00', onPrimary: '#fff',
}) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/ErrorState', () => {
  const { Pressable, Text } = require('react-native');
  return ({ subtitle, onRetry }: { subtitle: string; onRetry: () => void }) => <Pressable testID="chatroom-retry" onPress={onRetry}><Text>{subtitle}</Text></Pressable>;
});
jest.mock('@/lib/api/groups', () => ({
  getGroupChatrooms: (...args: unknown[]) => mockApi.getRooms(...args),
  getGroupChatroomMessages: (...args: unknown[]) => mockApi.getMessages(...args),
  getPinnedGroupChatroomMessages: (...args: unknown[]) => mockApi.getPinned(...args),
  postGroupChatroomMessage: (...args: unknown[]) => mockApi.postMessage(...args),
  createGroupChatroom: (...args: unknown[]) => mockApi.createRoom(...args),
  deleteGroupChatroom: (...args: unknown[]) => mockApi.deleteRoom(...args),
  deleteGroupChatroomMessage: (...args: unknown[]) => mockApi.deleteMessage(...args),
  pinGroupChatroomMessage: (...args: unknown[]) => mockApi.pin(...args),
  unpinGroupChatroomMessage: (...args: unknown[]) => mockApi.unpin(...args),
}));
jest.mock('@/lib/groupContentCreationOperation', () => ({
  loadGroupContentCreationOperation: (...args: unknown[]) => mockOperation.load(...args),
  reserveGroupContentCreationOperation: (...args: unknown[]) => mockOperation.reserve(...args),
  completeGroupContentCreationOperation: (...args: unknown[]) => mockOperation.complete(...args),
  discardGroupContentCreationOperation: (...args: unknown[]) => mockOperation.discard(...args),
}));

import GroupChatroomsPanel from './GroupChatroomsPanel';

const room = { id: 7, group_id: 23, name: 'General', description: null, category: null, is_default: true, is_private: false, created_by: 4, created_at: null };
const message = { id: 9, body: 'Hello', user_id: 4, author: { id: 4, name: 'Alex', avatar_url: null }, created_at: '2026-09-26T12:00:00Z', updated_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getRooms.mockResolvedValue({ data: [room] });
  mockApi.getMessages.mockResolvedValue({ data: [message], meta: { cursor: null, has_more: false } });
  mockApi.getPinned.mockResolvedValue({ data: [] });
  mockApi.postMessage.mockResolvedValue({ data: { id: 10, _idempotent_replay: false } });
  mockOperation.load.mockResolvedValue(null);
  mockOperation.complete.mockResolvedValue(undefined);
  mockOperation.reserve.mockImplementation(async (_groupId: number, kind: string, payload: unknown) => ({
    storageKey: `saved-${kind}`, key: `key-${kind}`, kind, groupId: 23, intent: JSON.stringify(payload), payload, createdAt: 1,
  }));
});

it('keeps the chatroom API closed to a non-member', async () => {
  const screen = render(<GroupChatroomsPanel groupId={23} currentUserId={4} canManage={false} canView={false} refreshToken={0} />);
  expect(screen.getByText('detail.chatrooms.joinTitle')).toBeTruthy();
  expect(mockApi.getRooms).not.toHaveBeenCalled();
  expect(mockApi.getMessages).not.toHaveBeenCalled();
});

it('loads the selected group channel and sends with the durable operation key', async () => {
  const screen = render(<GroupChatroomsPanel groupId={23} currentUserId={4} canManage={false} canView refreshToken={0} />);
  await waitFor(() => expect(mockApi.getMessages).toHaveBeenCalledWith(7, null));

  fireEvent.changeText(screen.getByTestId('group-chatroom-message-input'), '  New status  ');
  fireEvent.press(screen.getByTestId('group-chatroom-send'));

  await waitFor(() => expect(mockOperation.reserve).toHaveBeenCalledWith(23, 'chatroom-message', { chatroomId: 7, body: '  New status  ' }));
  expect(mockApi.postMessage).toHaveBeenCalledWith(7, '  New status  ', 'key-chatroom-message');
  expect(mockOperation.complete).toHaveBeenCalledWith(expect.objectContaining({ key: 'key-chatroom-message' }));
});

it('restores an interrupted message into its exact channel', async () => {
  mockOperation.load.mockImplementation(async (_groupId: number, kind: string) => kind === 'chatroom-message' ? ({
    storageKey: 'saved-message', key: 'retry-key', kind, groupId: 23,
    intent: JSON.stringify({ chatroomId: 7, body: 'Saved message' }),
    payload: { chatroomId: 7, body: 'Saved message' }, createdAt: 1,
  }) : null);

  const screen = render(<GroupChatroomsPanel groupId={23} currentUserId={4} canManage={false} canView refreshToken={0} />);
  expect(await screen.findByDisplayValue('Saved message')).toBeTruthy();
  expect(screen.getByTestId('group-chatroom-recovery')).toBeTruthy();
});

it('reloads channel membership on the parent pull-to-refresh signal', async () => {
  const screen = render(<GroupChatroomsPanel groupId={23} currentUserId={4} canManage={false} canView refreshToken={0} />);
  await waitFor(() => expect(mockApi.getRooms).toHaveBeenCalledTimes(1));
  screen.rerender(<GroupChatroomsPanel groupId={23} currentUserId={4} canManage={false} canView refreshToken={1} />);
  await waitFor(() => expect(mockApi.getRooms).toHaveBeenCalledTimes(2));
});

it('opens the exact channel named by a notification deep link', async () => {
  const secondRoom = { ...room, id: 8, name: 'Planning' };
  mockApi.getRooms.mockResolvedValue({ data: [room, secondRoom] });
  render(<GroupChatroomsPanel groupId={23} initialChatroomId={8} currentUserId={4} canManage={false} canView refreshToken={0} />);
  await waitFor(() => expect(mockApi.getMessages).toHaveBeenCalledWith(8, null));
});
