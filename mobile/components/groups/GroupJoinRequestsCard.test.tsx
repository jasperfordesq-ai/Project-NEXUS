// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 People could ask to join a group from the phone and a group admin could see the
 * count — but could do nothing about it. The two endpoints exercised here existed with
 * no caller in the app, so requests sat in the queue until somebody opened the website.
 * Audit 2026-09-07, fixed 2026-09-08.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockGetRequests = jest.fn();
const mockHandleRequest = jest.fn();
const mockShowToast = jest.fn();

// Records the question, does not answer it — see the note in group-detail.test.tsx.
const mockConfirm = jest.fn<void, [{ title: string; message?: string; variant?: string; onConfirm: () => void | Promise<void> }]>();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (
    opts && 'count' in opts ? `${key}:${String(opts.count)}` : key
  ) }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555', error: '#b00' }),
}));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => mockUseApi(...args) }));
jest.mock('@/lib/api/groups', () => ({
  getGroupJoinRequests: (...args: unknown[]) => mockGetRequests(...args),
  handleGroupJoinRequest: (...args: unknown[]) => mockHandleRequest(...args),
}));
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...(args as [never])), confirmDialog: null }),
}));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Button = ({ children, onPress, isDisabled, testID }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean; testID?: string }) => (
    <Pressable testID={testID} onPress={isDisabled ? undefined : onPress}><View>{children}</View></Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children, testID }: { children: React.ReactNode; testID?: string }) => <View testID={testID}>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  return { Button, Card, Spinner: () => null };
});

import GroupJoinRequestsCard from './GroupJoinRequestsCard';

const REQUEST = {
  id: 21,
  user_id: 21,
  name: 'Bea Waiting',
  avatar_url: null,
  user: { id: 21, name: 'Bea Waiting', avatar: null },
  requested_at: '2026-09-01T09:00:00Z',
};

function api(overrides: Record<string, unknown> = {}) {
  mockUseApi.mockReturnValue({
    data: { data: [REQUEST] },
    isLoading: false,
    error: null,
    errorStatus: null,
    errorCode: null,
    refresh: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandleRequest.mockResolvedValue({});
  api();
});

describe('GroupJoinRequestsCard', () => {
  it('shows who is waiting, and lets an admin let them in', async () => {
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);

    expect(screen.getByTestId('group-join-requests')).toBeTruthy();
    expect(screen.getByText('Bea Waiting')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('group-accept-21')); });

    expect(mockHandleRequest).toHaveBeenCalledWith(1, 21, 'accept');
    // The member list and the group's own counts are now stale.
    expect(onAccepted).toHaveBeenCalled();
  });

  it('asks before turning somebody away', async () => {
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    fireEvent.press(screen.getByTestId('group-decline-21'));

    // Asked, not done. They are not told why, and would have to ask again.
    expect(mockHandleRequest).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));

    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(mockHandleRequest).toHaveBeenCalledWith(1, 21, 'reject');
  });

  it('passes on the reason when the server refuses — a full group is not a glitch', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockHandleRequest.mockRejectedValue(new ApiResponseError(409, 'This group is full.'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    await act(async () => { fireEvent.press(screen.getByTestId('group-accept-21')); });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'This group is full.',
      variant: 'danger',
    })));
  });

  it('renders nothing at all when nobody is waiting', () => {
    api({ data: { data: [] } });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    // An empty queue is the normal state; a card announcing it every visit is noise.
    expect(screen.queryByTestId('group-join-requests')).toBeNull();
  });

  it('renders nothing for a member who cannot manage the group', () => {
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage={false} onAccepted={jest.fn()} />);
    expect(screen.queryByTestId('group-join-requests')).toBeNull();
  });

  it('stays silent when the server says the viewer is not an admin after all', () => {
    // 🔴 The server is the authority, not the group payload. A refusal here must not
    // put an error the member can do nothing about on top of a working tab.
    api({ data: null, error: 'Forbidden', errorStatus: 403 });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    expect(screen.queryByTestId('group-join-requests')).toBeNull();
    expect(screen.queryByTestId('group-join-requests-error')).toBeNull();
  });

  it('offers a retry when the queue genuinely failed to load', () => {
    api({ data: null, error: 'Server error', errorStatus: 500 });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    expect(screen.getByTestId('group-join-requests-error')).toBeTruthy();
  });

  it('does not ask twice while the first answer is still in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mockHandleRequest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    fireEvent.press(screen.getByTestId('group-accept-21'));
    fireEvent.press(screen.getByTestId('group-accept-21'));
    fireEvent.press(screen.getByTestId('group-decline-21'));

    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
    await act(async () => { release({}); });
  });
});
