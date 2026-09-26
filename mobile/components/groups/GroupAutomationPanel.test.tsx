// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockApi = {
  list: jest.fn(), create: jest.fn(), cancel: jest.fn(), getWelcome: jest.fn(), saveWelcome: jest.fn(),
};
const mockOperation = { load: jest.fn(), reserve: jest.fn(), complete: jest.fn(), discard: jest.fn() };
const mockToast = jest.fn();

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: ({ onConfirm }: { onConfirm: () => void }) => void onConfirm(), confirmDialog: null }) }));
jest.mock('@/components/ui/ErrorState', () => {
  const { Pressable, Text } = require('react-native');
  return ({ subtitle, onRetry }: { subtitle: string; onRetry: () => void }) => <Pressable testID="automation-retry" onPress={onRetry}><Text>{subtitle}</Text></Pressable>;
});
jest.mock('@/lib/api/groups', () => ({
  getGroupScheduledPosts: (...args: unknown[]) => mockApi.list(...args),
  createGroupScheduledPost: (...args: unknown[]) => mockApi.create(...args),
  cancelGroupScheduledPost: (...args: unknown[]) => mockApi.cancel(...args),
  getGroupWelcomeConfig: (...args: unknown[]) => mockApi.getWelcome(...args),
  updateGroupWelcomeConfig: (...args: unknown[]) => mockApi.saveWelcome(...args),
}));
jest.mock('@/lib/groupContentCreationOperation', () => ({
  loadGroupContentCreationOperation: (...args: unknown[]) => mockOperation.load(...args),
  reserveGroupContentCreationOperation: (...args: unknown[]) => mockOperation.reserve(...args),
  completeGroupContentCreationOperation: (...args: unknown[]) => mockOperation.complete(...args),
  discardGroupContentCreationOperation: (...args: unknown[]) => mockOperation.discard(...args),
}));

import GroupAutomationPanel from './GroupAutomationPanel';

const post = {
  id: 4, tenant_id: 2, group_id: 23, user_id: 7, post_type: 'discussion', title: 'Weekly check-in',
  content: 'Share this week’s updates.', scheduled_at: '2026-12-01T10:00:00.000Z', is_recurring: 1,
  recurrence_pattern: 'weekly', status: 'scheduled', author_name: 'Alex',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.list.mockResolvedValue({ data: [post] });
  mockApi.create.mockResolvedValue({ data: { id: 5 } });
  mockApi.cancel.mockResolvedValue({ data: { message: 'ok' } });
  mockApi.getWelcome.mockResolvedValue({ data: { enabled: false, message: '' } });
  mockApi.saveWelcome.mockResolvedValue({ data: { enabled: true, message: 'Welcome!' } });
  mockOperation.load.mockResolvedValue(null);
  mockOperation.complete.mockResolvedValue(undefined);
  mockOperation.reserve.mockImplementation(async (_groupId: number, kind: string, payload: unknown) => ({ storageKey: 'saved', key: 'scheduled-key', kind, groupId: 23, intent: JSON.stringify(payload), payload, createdAt: 1 }));
});

it('only offers content types enabled by group configuration', async () => {
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled={false} />);
  await screen.findByText('Weekly check-in');
  fireEvent.press(screen.getByText('Schedule post'));
  expect(screen.getAllByText(/Discussion/).length).toBeGreaterThan(1);
  expect(screen.queryByText(/Announcement/)).toBeNull();
});

it('restores an unfinished scheduled post into the manager form', async () => {
  mockOperation.load.mockResolvedValue({
    storageKey: 'saved', key: 'retry-key', kind: 'scheduled-post', groupId: 23, createdAt: 1, intent: '{}',
    payload: { postType: 'announcement', title: 'Restored title', content: 'Restored content', scheduledAt: '2026-12-02T10:00:00.000Z', isRecurring: false, recurrencePattern: null },
  });
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled />);
  expect(await screen.findByDisplayValue('Restored title')).toBeTruthy();
  expect(screen.getByTestId('group-automation-recovery')).toBeTruthy();
});

it('fails closed when a scheduled row belongs to another group', async () => {
  mockApi.list.mockResolvedValue({ data: [{ ...post, group_id: 999 }] });
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled />);
  expect(await screen.findByText('Scheduled posts could not be loaded.')).toBeTruthy();
  expect(screen.queryByText('Weekly check-in')).toBeNull();
});

it('creates through the durable scheduled-post operation key', async () => {
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled />);
  await screen.findByText('Weekly check-in');
  fireEvent.press(screen.getByText('Schedule post'));
  fireEvent.changeText(screen.getByLabelText('Title'), 'Planned update');
  fireEvent.changeText(screen.getByLabelText('Content'), 'Content for members');
  fireEvent.press(screen.getByText('Choose date'));
  const picker = screen.UNSAFE_getByType('DateTimePicker' as never);
  act(() => picker.props.onChange({ type: 'set' }, new Date('2026-12-03T11:00:00.000Z')));
  fireEvent.press(screen.getByTestId('group-automation-create'));
  await waitFor(() => expect(mockOperation.reserve).toHaveBeenCalledWith(23, 'scheduled-post', expect.objectContaining({ title: 'Planned update' })));
  expect(mockApi.create).toHaveBeenCalledWith(23, expect.objectContaining({ title: 'Planned update' }), 'scheduled-key');
});

it('uses welcome readback to confirm a response-lost save', async () => {
  mockApi.saveWelcome.mockRejectedValue(new Error('response lost'));
  mockApi.getWelcome.mockResolvedValueOnce({ data: { enabled: false, message: '' } }).mockResolvedValueOnce({ data: { enabled: true, message: 'Welcome!' } });
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled />);
  await waitFor(() => expect(mockApi.getWelcome).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByText(/Send a welcome message/));
  fireEvent.changeText(screen.getByLabelText('Message'), 'Welcome!');
  fireEvent.press(screen.getByTestId('group-welcome-save'));
  await waitFor(() => expect(mockApi.getWelcome).toHaveBeenCalledTimes(2));
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Welcome message saved', variant: 'success' }));
});

it('uses list readback to confirm a response-lost cancellation', async () => {
  mockApi.cancel.mockRejectedValue(new Error('response lost'));
  mockApi.list.mockResolvedValueOnce({ data: [post] }).mockResolvedValue({ data: [] });
  render(<GroupAutomationPanel groupId={23} discussionEnabled announcementsEnabled />);
  await screen.findByText('Weekly check-in');
  fireEvent.press(screen.getByText('Cancel scheduled post'));
  await waitFor(() => expect(mockApi.list).toHaveBeenCalledTimes(3));
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Scheduled post cancelled', variant: 'success' }));
});
