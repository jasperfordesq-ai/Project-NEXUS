// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRegistrationFormOperations } from './useRegistrationFormOperations';
import { loadRegistrationFormOperation, type SavedRegistrationFormOperation } from '../eventRegistrationFormOperation';
import { executeRegistrationFormOperation, recoverRegistrationFormOperation } from '../eventRegistrationFormOperation';

jest.mock('../eventRegistrationFormOperation', () => ({ loadRegistrationFormOperation: jest.fn(), executeRegistrationFormOperation: jest.fn(), recoverRegistrationFormOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const intent = { action: 'publish' as const, formId: 10, formRevision: 1, settingsRevision: 1 };
const pending: SavedRegistrationFormOperation = { ...scope, schemaVersion: 1, key: 'original', status: 'pending', intent };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(loadRegistrationFormOperation).mockResolvedValue(null); });

it.each(['resolve', 'reject'] as const)('ignores obsolete storage %s', async completion => {
  let finish!: (value: SavedRegistrationFormOperation | null) => void;
  let fail!: (error: Error) => void;
  jest.mocked(loadRegistrationFormOperation).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const { result } = renderHook(() => useRegistrationFormOperations(scope, true, jest.fn()));
  jest.mocked(loadRegistrationFormOperation).mockResolvedValue(pending);
  await act(async () => result.current.reload());
  await act(async () => { if (completion === 'resolve') finish(null); else fail(new Error('Old failure')); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.storageFailed).toBe(false);
});
it('does not replay on mount or replace pending work, and preserves failed explicit recovery', async () => {
  jest.mocked(loadRegistrationFormOperation).mockResolvedValue(pending);
  jest.mocked(recoverRegistrationFormOperation).mockRejectedValue(new Error('Lost response'));
  const accepted = jest.fn();
  const { result } = renderHook(() => useRegistrationFormOperations(scope, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recoverRegistrationFormOperation).not.toHaveBeenCalled();
  await act(async () => result.current.submit(intent));
  expect(executeRegistrationFormOperation).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.submit()).rejects.toThrow(); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.operationFailed).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(accepted).not.toHaveBeenCalled();
});
it('blocks new requests until failed storage is explicitly reloaded', async () => {
  jest.mocked(loadRegistrationFormOperation).mockRejectedValueOnce(new Error('Locked'));
  const { result } = renderHook(() => useRegistrationFormOperations(scope, true, jest.fn()));
  await waitFor(() => expect(result.current.storageFailed).toBe(true));
  await act(async () => result.current.submit(intent));
  expect(executeRegistrationFormOperation).not.toHaveBeenCalled();
  await act(async () => result.current.reload());
  expect(result.current.blocked).toBe(false);
});
it.each(['unmount', 'permission'] as const)('suppresses completion after %s and rejects overlapping submissions', async departure => {
  let finish!: () => void;
  jest.mocked(executeRegistrationFormOperation).mockImplementation(() => new Promise(resolve => { finish = () => resolve({} as never); }));
  const accepted = jest.fn();
  const { result, rerender, unmount } = renderHook<ReturnType<typeof useRegistrationFormOperations>, { allowed: boolean }>(
    ({ allowed }) => useRegistrationFormOperations(scope, allowed, accepted), { initialProps: { allowed: true } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  let running!: Promise<void>;
  act(() => { running = result.current.submit(intent); });
  await act(async () => result.current.submit(intent));
  expect(executeRegistrationFormOperation).toHaveBeenCalledTimes(1);
  if (departure === 'unmount') unmount(); else rerender({ allowed: false });
  await act(async () => { finish(); await running; });
  expect(accepted).not.toHaveBeenCalled();
});
