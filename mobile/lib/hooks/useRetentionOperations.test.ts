// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRetentionOperations } from './useRetentionOperations';
import { loadRetentionOperation as load, executeRetentionOperation as execute,
  recoverRetentionOperation as recover, type SavedRetentionOperation } from '../eventRetentionOperation';
jest.mock('../eventRetentionOperation', () => ({ loadRetentionOperation: jest.fn(), executeRetentionOperation: jest.fn(),
  recoverRetentionOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const intent = { action: 'preview' as const, asOf: '2026-09-20T00:00:00Z' };
const pending: SavedRetentionOperation = { ...scope, schemaVersion: 1, status: 'pending', key: 'original', intent };
const receipt = { data: { run: { id: 12, event_id: 42, mode: 'dry_run' as const, dry_run_id: null,
  as_of_utc: intent.asOf, eligible_count: 2, affected_count: 0, completed_at: intent.asOf, created_at: intent.asOf },
  changed: true, idempotent_replay: false } };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(load).mockResolvedValue(null); jest.mocked(execute).mockResolvedValue(receipt); });
it('loads pending work without replay and only recovers on an explicit action', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockResolvedValue(receipt);
  const accepted = jest.fn(); const { result } = renderHook(() => useRetentionOperations(scope, true, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recover).not.toHaveBeenCalled(); expect(result.current.blocked).toBe(true);
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
  await act(async () => result.current.recover()); expect(recover).toHaveBeenCalledTimes(1); expect(accepted).toHaveBeenCalledWith(receipt);
});
it('reports failed storage and refuses any write', async () => {
  jest.mocked(load).mockRejectedValue(new Error('Storage unavailable'));
  const { result } = renderHook(() => useRetentionOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores an obsolete read completing after a newer reload', async () => {
  let finish!: (value: SavedRetentionOperation | null) => void;
  jest.mocked(load).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useRetentionOperations(scope, true, true, jest.fn()));
  jest.mocked(load).mockResolvedValue(pending); await act(async () => result.current.reload());
  await act(async () => finish(null)); expect(result.current.saved).toEqual(pending);
});
it.each(['tenantId', 'userId', 'eventId'] as const)('invalidates old callbacks when %s changes', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useRetentionOperations>, { owner: typeof scope }>(({ owner }) => useRetentionOperations(owner, true, true, jest.fn()), { initialProps: { owner: scope } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ owner: { ...scope, [field]: scope[field] + 1 } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it.each(['active', 'permitted'] as const)('keeps a departed callback invalid after %s is restored', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useRetentionOperations>, { active: boolean; permitted: boolean }>(({ active, permitted }) => useRetentionOperations(scope, permitted, active, jest.fn()),
    { initialProps: { active: true, permitted: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ active: true, permitted: true, [field]: false }); expect(result.current.saved).toBeNull(); expect(result.current.blocked).toBe(true);
  rerender({ active: true, permitted: true }); await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores late success after departure and prevents duplicate taps', async () => {
  let finish!: (value: typeof receipt) => void;
  jest.mocked(execute).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const accepted = jest.fn(); const { result, rerender } = renderHook<ReturnType<typeof useRetentionOperations>, { active: boolean }>(({ active }) => useRetentionOperations(scope, true, active, accepted),
    { initialProps: { active: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); let first!: Promise<void>;
  act(() => { first = result.current.submit(intent); });
  await act(async () => result.current.submit(intent)); expect(execute).toHaveBeenCalledTimes(1);
  const guard = jest.mocked(execute).mock.calls[0][2]; rerender({ active: false }); expect(guard()).toBe(false);
  await act(async () => { finish(receipt); await first; }); expect(accepted).not.toHaveBeenCalled(); expect(result.current.busy).toBe(false);
});
it('refuses callbacks after unmount', async () => {
  const { result, unmount } = renderHook(() => useRetentionOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit; unmount();
  await old(intent); expect(execute).not.toHaveBeenCalled();
});

it('keeps recovery errors visible after reloading the pending request', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useRetentionOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.recover());
  expect(result.current.operationFailed).toBe(true); expect(result.current.saved).toEqual(pending);
  expect(result.current.busy).toBe(false); expect(result.current.blocked).toBe(true);
});
