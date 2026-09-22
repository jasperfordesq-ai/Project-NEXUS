// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAgendaOperations } from './useAgendaOperations';
import { loadAgendaOperation, type SavedAgendaOperation } from '../eventAgendaOperation';
import { executeAgendaOperation, recoverAgendaOperation } from '../eventAgendaOperation';

jest.mock('../eventAgendaOperation', () => ({ loadAgendaOperation: jest.fn(), executeAgendaOperation: jest.fn(), recoverAgendaOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const intent = { action: 'reorder' as const, expectedAgendaVersion: 1, orderedSessionIds: [1, 2] };
const pending: SavedAgendaOperation = { ...scope, schemaVersion: 1, key: 'original', status: 'pending', attempts: 0, intent };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(loadAgendaOperation).mockResolvedValue(null); });

it.each(['resolve', 'reject'] as const)('ignores obsolete storage %s', async completion => {
  let finish!: (value: SavedAgendaOperation | null) => void;
  let fail!: (error: Error) => void;
  jest.mocked(loadAgendaOperation).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const { result } = renderHook(() => useAgendaOperations(scope, true, jest.fn()));
  jest.mocked(loadAgendaOperation).mockResolvedValue(pending);
  await act(async () => result.current.reload());
  await act(async () => { if (completion === 'resolve') finish(null); else fail(new Error('Old failure')); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.storageFailed).toBe(false);
});
it('does not replay on mount or replace pending work, and preserves failed explicit recovery', async () => {
  jest.mocked(loadAgendaOperation).mockResolvedValue(pending);
  jest.mocked(recoverAgendaOperation).mockRejectedValue(new Error('Lost response'));
  const accepted = jest.fn();
  const { result } = renderHook(() => useAgendaOperations(scope, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recoverAgendaOperation).not.toHaveBeenCalled();
  await act(async () => result.current.submit(intent));
  expect(executeAgendaOperation).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.submit()).rejects.toThrow(); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.operationFailed).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(accepted).not.toHaveBeenCalled();
});
it('blocks new requests until failed storage is explicitly reloaded', async () => {
  jest.mocked(loadAgendaOperation).mockRejectedValueOnce(new Error('Locked'));
  const { result } = renderHook(() => useAgendaOperations(scope, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent));
  expect(executeAgendaOperation).not.toHaveBeenCalled();
  await act(async () => result.current.reload());
  expect(result.current.blocked).toBe(false);
});
it.each(['unmount', 'permission'] as const)('suppresses completion after %s and rejects overlapping submissions', async departure => {
  let finish!: () => void;
  jest.mocked(executeAgendaOperation).mockImplementation(() => new Promise(resolve => { finish = () => resolve({} as never); }));
  const accepted = jest.fn();
  const { result, rerender, unmount } = renderHook<ReturnType<typeof useAgendaOperations>, { allowed: boolean }>(
    ({ allowed }) => useAgendaOperations(scope, allowed, accepted), { initialProps: { allowed: true } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  let running!: Promise<void>;
  act(() => { running = result.current.submit(intent); });
  await act(async () => result.current.submit(intent));
  expect(executeAgendaOperation).toHaveBeenCalledTimes(1);
  if (departure === 'unmount') unmount(); else rerender({ allowed: false });
  await act(async () => { finish(); await running; });
  expect(accepted).not.toHaveBeenCalled();
});
