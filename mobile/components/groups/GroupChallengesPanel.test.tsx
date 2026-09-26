// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockApi = { list: jest.fn(), create: jest.fn(), cancel: jest.fn() };
const mockOperation = { load: jest.fn(), reserve: jest.fn(), complete: jest.fn(), discard: jest.fn() };
const mockToast = jest.fn();

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006fee' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', error: '#c00' }) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: ({ onConfirm }: { onConfirm: () => void }) => void onConfirm(), confirmDialog: null }) }));
jest.mock('@/components/ui/ErrorState', () => {
  const { Pressable, Text } = require('react-native');
  return ({ subtitle, onRetry }: { subtitle: string; onRetry: () => void }) => <Pressable testID="challenge-retry" onPress={onRetry}><Text>{subtitle}</Text></Pressable>;
});
jest.mock('@/lib/api/groups', () => ({
  getGroupChallenges: (...args: unknown[]) => mockApi.list(...args),
  createGroupChallenge: (...args: unknown[]) => mockApi.create(...args),
  cancelGroupChallenge: (...args: unknown[]) => mockApi.cancel(...args),
}));
jest.mock('@/lib/groupContentCreationOperation', () => ({
  loadGroupContentCreationOperation: (...args: unknown[]) => mockOperation.load(...args),
  reserveGroupContentCreationOperation: (...args: unknown[]) => mockOperation.reserve(...args),
  completeGroupContentCreationOperation: (...args: unknown[]) => mockOperation.complete(...args),
  discardGroupContentCreationOperation: (...args: unknown[]) => mockOperation.discard(...args),
}));

import GroupChallengesPanel from './GroupChallengesPanel';

const challenge = {
  id: 4, group_id: 23, title: 'Helpful posts', description: 'Share useful local updates.', metric: 'posts',
  target_value: 10, current_value: 3, reward_xp: 25, status: 'active', progress_percentage: 30,
  starts_at: '2026-09-20T00:00:00Z', ends_at: '2026-10-20T00:00:00Z', completed_at: null,
  creator: { id: 2, name: 'Alex', avatar_url: null }, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.list.mockResolvedValue({ data: [challenge] });
  mockApi.create.mockResolvedValue({ data: challenge });
  mockApi.cancel.mockResolvedValue({ data: { challenge: { ...challenge, status: 'cancelled' }, changed: true, message: 'ok' } });
  mockOperation.load.mockResolvedValue(null);
  mockOperation.complete.mockResolvedValue(undefined);
  mockOperation.reserve.mockImplementation(async (_groupId: number, kind: string, payload: unknown) => ({ storageKey: 'saved', key: 'challenge-key', kind, groupId: 23, intent: JSON.stringify(payload), payload, createdAt: 1 }));
});

it('keeps challenge data closed to outsiders', () => {
  const screen = render(<GroupChallengesPanel groupId={23} canManage={false} canView={false} refreshToken={0} />);
  expect(screen.getByText('detail.challenges.joinTitle')).toBeTruthy();
  expect(mockApi.list).not.toHaveBeenCalled();
});

it('shows member progress without manager controls', async () => {
  const screen = render(<GroupChallengesPanel groupId={23} canManage={false} canView refreshToken={0} />);
  expect(await screen.findByText('Helpful posts')).toBeTruthy();
  expect(screen.queryByText('detail.challenges.create')).toBeNull();
  expect(screen.queryByText('detail.challenges.cancelAction')).toBeNull();
});

it('fails closed when the challenge contract is malformed', async () => {
  mockApi.list.mockResolvedValue({ data: [{ ...challenge, group_id: 999 }] });
  const screen = render(<GroupChallengesPanel groupId={23} canManage={false} canView refreshToken={0} />);
  expect(await screen.findByText('detail.challenges.loadError')).toBeTruthy();
  expect(screen.queryByText('Helpful posts')).toBeNull();
});

it('restores an interrupted challenge into the manager form', async () => {
  mockOperation.load.mockResolvedValue({
    storageKey: 'saved', key: 'retry-key', kind: 'challenge', groupId: 23, createdAt: 1, intent: '{}',
    payload: { title: 'Restored title', description: 'Restored description text', metric: 'files', targetValue: 8, rewardXp: 50, endsAt: '2026-11-01T00:00:00.000Z' },
  });
  const screen = render(<GroupChallengesPanel groupId={23} canManage canView refreshToken={0} />);
  expect(await screen.findByDisplayValue('Restored title')).toBeTruthy();
  expect(screen.getByTestId('group-challenge-recovery')).toBeTruthy();
});

it('creates through the durable operation key', async () => {
  const screen = render(<GroupChallengesPanel groupId={23} canManage canView refreshToken={0} />);
  await screen.findByText('Helpful posts');
  fireEvent.press(screen.getByText('detail.challenges.create'));
  fireEvent.changeText(screen.getByLabelText('detail.challenges.titleLabel'), 'New group challenge');
  fireEvent.changeText(screen.getByLabelText('detail.challenges.targetLabel'), '5');
  const pickerButton = screen.getByText('detail.challenges.endDateLabel');
  fireEvent.press(pickerButton);
  const picker = screen.UNSAFE_getByType('DateTimePicker' as never);
  act(() => picker.props.onChange({ type: 'set' }, new Date('2026-12-01T00:00:00.000Z')));
  fireEvent.press(screen.getByTestId('group-challenge-create'));
  await waitFor(() => expect(mockOperation.reserve).toHaveBeenCalledWith(23, 'challenge', expect.objectContaining({ title: 'New group challenge', targetValue: 5 })));
  expect(mockApi.create).toHaveBeenCalledWith(23, expect.objectContaining({ target_value: 5 }), 'challenge-key');
});

it('cancels an active challenge and refreshes authoritative state', async () => {
  const screen = render(<GroupChallengesPanel groupId={23} canManage canView refreshToken={0} />);
  await screen.findByText('Helpful posts');
  fireEvent.press(screen.getByText('detail.challenges.cancelAction'));
  await waitFor(() => expect(mockApi.cancel).toHaveBeenCalledWith(23, 4));
  await waitFor(() => expect(mockApi.list).toHaveBeenCalledTimes(2));
});
