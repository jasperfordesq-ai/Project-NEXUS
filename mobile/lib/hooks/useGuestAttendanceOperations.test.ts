// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGuestAttendanceOperations } from './useGuestAttendanceOperations';
import { loadGuestAttendanceOperation as load, executeGuestAttendanceOperation as execute,
  recoverGuestAttendanceOperation as recover, reviewGuestAttendanceOperation as review, type SavedGuestAttendanceOperation } from '../eventGuestAttendanceOperation';
jest.mock('../eventGuestAttendanceOperation', () => ({ loadGuestAttendanceOperation: jest.fn(), executeGuestAttendanceOperation: jest.fn(),
  recoverGuestAttendanceOperation: jest.fn(), reviewGuestAttendanceOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42, guestId: 9 };
const intent = { guestId: 9, action: 'check_in' as const, expectedVersion: 0 };
const pending: SavedGuestAttendanceOperation = { ...scope, schemaVersion: 1, status: 'pending', key: 'original', intent };
const receipt = { data: { attendance: { id: 3, event_id: 42, guest_id: 9, attendance_status: 'checked_in' as const, attendance_version: 1 },
  changed: true, replayed: false, history_id: 5 } };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(load).mockResolvedValue(null); jest.mocked(execute).mockResolvedValue(receipt); });
it('loads pending work without replay and only recovers on an explicit action', async () => {
  jest.mocked(load).mockResolvedValue(pending); jest.mocked(recover).mockResolvedValue(receipt);
  const accepted = jest.fn(); const { result } = renderHook(() => useGuestAttendanceOperations(scope, true, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recover).not.toHaveBeenCalled(); expect(result.current.blocked).toBe(true);
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
  await act(async () => result.current.recover()); expect(recover).toHaveBeenCalledTimes(1); expect(accepted).toHaveBeenCalledWith(receipt);
});
it('reports failed storage and refuses any write', async () => {
  jest.mocked(load).mockRejectedValue(new Error('Storage unavailable'));
  const { result } = renderHook(() => useGuestAttendanceOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores an obsolete read completing after a newer reload', async () => {
  let finish!: (value: SavedGuestAttendanceOperation | null) => void;
  jest.mocked(load).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useGuestAttendanceOperations(scope, true, true, jest.fn()));
  jest.mocked(load).mockResolvedValue(pending); await act(async () => result.current.reload());
  await act(async () => finish(null)); expect(result.current.saved).toEqual(pending);
});
it.each(['tenantId', 'userId', 'eventId', 'guestId'] as const)('invalidates old callbacks when %s changes', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useGuestAttendanceOperations>, { owner: typeof scope }>(({ owner }) => useGuestAttendanceOperations(owner, true, true, jest.fn()), { initialProps: { owner: scope } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ owner: { ...scope, [field]: scope[field] + 1 } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it.each(['active', 'permitted'] as const)('keeps a departed callback invalid after %s is restored', async field => {
  const { result, rerender } = renderHook<ReturnType<typeof useGuestAttendanceOperations>, { active: boolean; permitted: boolean }>(({ active, permitted }) => useGuestAttendanceOperations(scope, permitted, active, jest.fn()),
    { initialProps: { active: true, permitted: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit;
  rerender({ active: true, permitted: true, [field]: false }); expect(result.current.saved).toBeNull(); expect(result.current.blocked).toBe(true);
  rerender({ active: true, permitted: true }); await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => old(intent)); expect(execute).not.toHaveBeenCalled();
});
it('ignores late success after departure and prevents duplicate taps', async () => {
  let finish!: (value: typeof receipt) => void;
  jest.mocked(execute).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const accepted = jest.fn(); const { result, rerender } = renderHook<ReturnType<typeof useGuestAttendanceOperations>, { active: boolean }>(({ active }) => useGuestAttendanceOperations(scope, true, active, accepted),
    { initialProps: { active: true } });
  await waitFor(() => expect(result.current.ready).toBe(true)); let first!: Promise<void>;
  act(() => { first = result.current.submit(intent); });
  await act(async () => result.current.submit(intent)); expect(execute).toHaveBeenCalledTimes(1);
  const guard = jest.mocked(execute).mock.calls[0][2]; rerender({ active: false }); expect(guard()).toBe(false);
  await act(async () => { finish(receipt); await first; }); expect(accepted).not.toHaveBeenCalled(); expect(result.current.busy).toBe(false);
});
it('reviews only rejected work and leaves failures visible after reloading', async () => {
  jest.mocked(load).mockResolvedValue({ ...pending, status: 'rejected' }); jest.mocked(review).mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useGuestAttendanceOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => result.current.recover()); expect(recover).not.toHaveBeenCalled();
  await act(async () => result.current.review()); expect(review).toHaveBeenCalledWith(scope, 'original', expect.any(Function));
  expect(result.current.operationFailed).toBe(true); expect(result.current.saved?.status).toBe('rejected'); expect(result.current.busy).toBe(false);
});
it('refuses callbacks after unmount', async () => {
  const { result, unmount } = renderHook(() => useGuestAttendanceOperations(scope, true, true, jest.fn()));
  await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.submit; unmount();
  await old(intent); expect(execute).not.toHaveBeenCalled();
});
