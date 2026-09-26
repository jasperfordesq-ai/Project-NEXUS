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
const mockLoadDecision = jest.fn();
const mockReserveDecision = jest.fn();
const mockCompleteDecision = jest.fn();
const mockDiscardDecision = jest.fn();
const mockRefresh = jest.fn();

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
jest.mock('@/lib/groupJoinRequestDecisionOperation', () => ({
  loadGroupJoinRequestDecisionOperation: (...args: unknown[]) => mockLoadDecision(...args),
  reserveGroupJoinRequestDecisionOperation: (...args: unknown[]) => mockReserveDecision(...args),
  completeGroupJoinRequestDecisionOperation: (...args: unknown[]) => mockCompleteDecision(...args),
  discardGroupJoinRequestDecisionOperation: (...args: unknown[]) => mockDiscardDecision(...args),
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
    refresh: mockRefresh,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandleRequest.mockResolvedValue({});
  mockLoadDecision.mockResolvedValue(null);
  mockReserveDecision.mockImplementation(async (groupId: number, requesterId: number, action: 'accept' | 'reject') => ({
    storageKey: `scope-${groupId}`,
    key: `decision-${groupId}-${requesterId}-${action}`,
    groupId,
    requesterId,
    action,
    createdAt: 1,
  }));
  mockCompleteDecision.mockResolvedValue(undefined);
  mockDiscardDecision.mockResolvedValue(undefined);
  api();
});

describe('GroupJoinRequestsCard', () => {
  it('does not release a newer action when an older group request completes', async () => {
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    mockHandleRequest.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);
    fireEvent.press(await screen.findByTestId('group-accept-21'));
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(1));
    screen.rerender(<GroupJoinRequestsCard groupId={2} canManage onAccepted={onAccepted} />);
    let button = await screen.findByTestId('group-accept-21');
    while (!button.props.onPress && button.parent) button = button.parent;
    const acceptNew = button.props.onPress;
    act(() => { acceptNew(); });
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(2));
    await act(async () => { finishOld({}); });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    act(() => { acceptNew(); });
    expect(mockHandleRequest).toHaveBeenCalledTimes(2);
    await act(async () => { finishNew({}); });
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it.each(['permission', 'group', 'refusal'])('does not revive an old confirmation after scope returns: %s', async (change) => {
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);
    fireEvent.press(await screen.findByTestId('group-decline-21'));
    const oldConfirm = mockConfirm.mock.calls[0][0].onConfirm;
    if (change === 'refusal') api({ errorStatus: 403 });
    screen.rerender(<GroupJoinRequestsCard groupId={change === 'group' ? 2 : 1} canManage={change !== 'permission'} onAccepted={onAccepted} />);
    api();
    screen.rerender(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);
    await act(async () => { await oldConfirm(); });
    expect(mockHandleRequest).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId('group-decline-21'));
    await act(async () => { await mockConfirm.mock.calls[1][0].onConfirm(); });
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(1));
  });

  it.each(['unmount', 'permission', 'group'])('ignores a decline confirmation after scope changes: %s', async (change) => {
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);
    fireEvent.press(await screen.findByTestId('group-decline-21'));
    if (change === 'unmount') screen.unmount();
    else screen.rerender(<GroupJoinRequestsCard groupId={change === 'group' ? 2 : 1} canManage={change !== 'permission'} onAccepted={onAccepted} />);
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(mockHandleRequest).not.toHaveBeenCalled();
  });

  it('locks the same callback immediately and suppresses accepted feedback after departure', async () => {
    let resolve!: (value: unknown) => void;
    mockHandleRequest.mockReturnValue(new Promise((done) => { resolve = done; }));
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);
    let button = await screen.findByTestId('group-accept-21');
    while (!button.props.onPress && button.parent) button = button.parent;
    const accept = button.props.onPress;
    act(() => { accept(); accept(); });
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { resolve({}); });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows who is waiting, and lets an admin let them in', async () => {
    const onAccepted = jest.fn();
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={onAccepted} />);

    expect(await screen.findByTestId('group-join-requests')).toBeTruthy();
    expect(screen.getByText('Bea Waiting')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-accept-21'));

    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledWith(1, 21, 'accept', 'decision-1-21-accept'));
    // The member list and the group's own counts are now stale.
    expect(onAccepted).toHaveBeenCalled();
  });

  it('asks before turning somebody away', async () => {
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('group-decline-21'));

    // Asked, not done. They are not told why, and would have to ask again.
    expect(mockHandleRequest).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));

    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledWith(1, 21, 'reject', 'decision-1-21-reject'));
  });

  it('passes on the reason when the server refuses — a full group is not a glitch', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockHandleRequest.mockRejectedValue(new ApiResponseError(409, 'This group is full.'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    const accept = await screen.findByTestId('group-accept-21');
    fireEvent.press(accept);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'This group is full.',
      variant: 'danger',
    })));
  });

  it('renders nothing at all when nobody is waiting', async () => {
    api({ data: { data: [] } });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    // An empty queue is the normal state; a card announcing it every visit is noise.
    await waitFor(() => expect(screen.queryByTestId('group-join-requests')).toBeNull());
  });

  it('renders nothing for a member who cannot manage the group', async () => {
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage={false} onAccepted={jest.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('group-join-requests')).toBeNull());
  });

  it('stays silent when the server says the viewer is not an admin after all', async () => {
    // 🔴 The server is the authority, not the group payload. A refusal here must not
    // put an error the member can do nothing about on top of a working tab.
    api({ data: null, error: 'Forbidden', errorStatus: 403 });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    expect(screen.queryByTestId('group-join-requests')).toBeNull();
    expect(screen.queryByTestId('group-join-requests-error')).toBeNull();
    await waitFor(() => expect(mockLoadDecision).not.toHaveBeenCalled());
  });

  it('offers a retry when the queue genuinely failed to load', async () => {
    api({ data: null, error: 'Server error', errorStatus: 500 });
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    expect(await screen.findByTestId('group-join-requests-error')).toBeTruthy();
  });

  it('does not ask twice while the first answer is still in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mockHandleRequest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    const accept = await screen.findByTestId('group-accept-21');
    fireEvent.press(accept);
    fireEvent.press(accept);
    fireEvent.press(screen.getByTestId('group-decline-21'));

    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(1));
    await act(async () => { release({}); });
  });

  it('persists the exact decision before dispatching it', async () => {
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);
    const accept = await screen.findByTestId('group-accept-21');
    fireEvent.press(accept);

    await waitFor(() => expect(mockReserveDecision).toHaveBeenCalledWith(1, 21, 'accept'));
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalled());
    expect(mockReserveDecision.mock.invocationCallOrder[0]).toBeLessThan(mockHandleRequest.mock.invocationCallOrder[0]);
  });

  it('restores an unfinished decision and retries the same operation key', async () => {
    const restored = {
      storageKey: 'scope-1', key: 'restored-key', groupId: 1, requesterId: 21, action: 'reject', createdAt: 1,
    };
    mockLoadDecision.mockResolvedValue(restored);
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    const retry = await screen.findByTestId('group-join-decision-retry');
    expect(mockHandleRequest).not.toHaveBeenCalled();
    fireEvent.press(retry);
    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledWith(1, 21, 'reject', 'restored-key'));
    expect(mockReserveDecision).not.toHaveBeenCalled();
    expect(mockCompleteDecision).toHaveBeenCalledWith(restored);
  });

  it('keeps an uncertain decision for exact retry', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockHandleRequest.mockRejectedValue(new ApiResponseError(503, 'Unavailable'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    const accept = await screen.findByTestId('group-accept-21');
    fireEvent.press(accept);

    expect(await screen.findByTestId('group-join-decision-pending')).toBeTruthy();
    expect(mockDiscardDecision).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'detail.manage.decisionPending' }));
  });

  it('reuses the same key after response loss and clears the confirmed receipt', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockHandleRequest
      .mockRejectedValueOnce(new ApiResponseError(503, 'Response lost'))
      .mockResolvedValueOnce({});
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('group-accept-21'));
    fireEvent.press(await screen.findByTestId('group-join-decision-retry'));

    await waitFor(() => expect(mockHandleRequest).toHaveBeenCalledTimes(2));
    expect(mockHandleRequest).toHaveBeenNthCalledWith(1, 1, 21, 'accept', 'decision-1-21-accept');
    expect(mockHandleRequest).toHaveBeenNthCalledWith(2, 1, 21, 'accept', 'decision-1-21-accept');
    expect(mockCompleteDecision).toHaveBeenCalledTimes(1);
  });

  it('discards a definitely refused decision and refreshes authority', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockHandleRequest.mockRejectedValue(new ApiResponseError(403, 'Forbidden'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    const accept = await screen.findByTestId('group-accept-21');
    fireEvent.press(accept);

    await waitFor(() => expect(mockDiscardDecision).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByTestId('group-join-requests')).toBeNull();
  });

  it('blocks transport when secure recovery cannot be loaded or saved', async () => {
    mockLoadDecision.mockRejectedValueOnce(new Error('secure storage unavailable'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);
    expect(await screen.findByTestId('group-join-decision-recovery-error')).toBeTruthy();
    expect(mockHandleRequest).not.toHaveBeenCalled();
  });

  it('blocks transport when the decision cannot be saved', async () => {
    mockReserveDecision.mockRejectedValueOnce(new Error('secure storage unavailable'));
    const screen = render(<GroupJoinRequestsCard groupId={1} canManage onAccepted={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('group-accept-21'));

    expect(await screen.findByTestId('group-join-decision-recovery-error')).toBeTruthy();
    expect(mockHandleRequest).not.toHaveBeenCalled();
  });
});
