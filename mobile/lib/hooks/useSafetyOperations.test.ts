// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSafetyOperations } from './useSafetyOperations';
import { loadSafetyOperation as load, executeSafetyOperation as execute, recoverSafetyOperation as recover, discardRejectedSafetyOperation as discard, type SavedSafetyOperation } from '../eventSafetyOperation';
jest.mock('../eventSafetyOperation', () => ({ loadSafetyOperation: jest.fn(), executeSafetyOperation: jest.fn(), recoverSafetyOperation: jest.fn(), discardRejectedSafetyOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const intent = { action: 'withdraw' as const, denialId: 8, expectedVersion: 1 };
const pending: SavedSafetyOperation = { ...scope, schemaVersion: 1, status: 'pending', key: 'saved-key', intent, attempts: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(load).mockReset().mockResolvedValue(null);
  jest.mocked(execute).mockReset().mockResolvedValue({ data: {} } as never);
  jest.mocked(recover).mockReset().mockResolvedValue({ data: {} } as never);
  jest.mocked(discard).mockReset().mockResolvedValue(undefined);
});
it('loads pending work without resending, blocks new changes and permits explicit recovery', async () => {
  jest.mocked(load).mockResolvedValue(pending);
  const accepted = jest.fn();
  const { result } = renderHook(() => useSafetyOperations(scope, true, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.blocked).toBe(true); expect(recover).not.toHaveBeenCalled();
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
  await act(async () => result.current.recover());
  expect(recover).toHaveBeenCalledWith(scope, expect.any(Function)); expect(accepted).toHaveBeenCalledTimes(1);
});
it.each(['account', 'community', 'event', 'permission', 'background'] as const)('ignores a late receipt and old callbacks after %s changes', async change => {
  const accepted = jest.fn();
  const { result, rerender } = renderHook((props: { scope: typeof scope; permitted: boolean; active: boolean }) => useSafetyOperations(props.scope, props.permitted, props.active, accepted), {
    initialProps: { scope, permitted: true, active: true },
  });
  await waitFor(() => expect(result.current.ready).toBe(true));
  let finish!: (value: any) => void;
  jest.mocked(execute).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  const staleSubmit = result.current.submit;
  act(() => { task = result.current.submit(intent); });
  const next = { scope: { ...scope }, permitted: true, active: true };
  if (change === 'account') next.scope.userId++;
  if (change === 'community') next.scope.tenantId++;
  if (change === 'event') next.scope.eventId++;
  if (change === 'permission') next.permitted = false;
  if (change === 'background') next.active = false;
  rerender(next);
  await act(async () => { finish({ data: {} }); await task; await staleSubmit(intent); });
  expect(accepted).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);
});
it('does not submit when durable storage cannot be read', async () => {
  jest.mocked(load).mockRejectedValue(new Error('Unavailable'));
  const { result } = renderHook(() => useSafetyOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent));
  expect(execute).not.toHaveBeenCalled(); expect(result.current.blocked).toBe(true);
});
it('keeps recovery failure visible and retains the pending operation', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useSafetyOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.recover());
  expect(result.current.operationFailed).toBe(true); expect(result.current.saved).toEqual(pending);
});
it('allows only explicit discard of a definitively rejected change', async () => {
  jest.mocked(load).mockResolvedValue({ ...pending, status: 'rejected', code: 'EVENT_STAFF_FORBIDDEN' });
  const { result } = renderHook(() => useSafetyOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(discard).not.toHaveBeenCalled();
  await act(async () => { await result.current.submit(intent); await result.current.recover(); });
  expect(execute).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  await act(async () => result.current.discard());
  expect(discard).toHaveBeenCalledWith(scope, pending.key, expect.any(Function));
});
it('blocks callbacks retained after unmount', async () => {
  const { result, unmount } = renderHook(() => useSafetyOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const submit = result.current.submit; unmount();
  await submit(intent); expect(execute).not.toHaveBeenCalled();
});
