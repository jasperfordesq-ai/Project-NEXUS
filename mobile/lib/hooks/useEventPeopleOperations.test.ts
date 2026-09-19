// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useEventPeopleOperations } from './useEventPeopleOperations';
import { loadEventPeopleOperation, type SavedEventPeopleOperation } from '../eventPeopleOperationStore';
import { recoverEventPeopleOperation } from '../eventPeopleOperation';

jest.mock('../eventPeopleOperationStore', () => ({ loadEventPeopleOperation: jest.fn() }));
jest.mock('../eventPeopleOperation', () => ({ executeEventPeopleOperation: jest.fn(), recoverEventPeopleOperation: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const pending: SavedEventPeopleOperation = { ...scope, version: 1, key: 'original-key', status: 'pending',
  intent: { action: 'approve', reason: null, targets: [{ userId: 44, version: 2 }] } };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(loadEventPeopleOperation).mockResolvedValue(null); });

it.each(['resolve', 'reject'] as const)('ignores an obsolete storage %s after a newer pending request is loaded', async completion => {
  let finish!: (value: SavedEventPeopleOperation | null) => void;
  let fail!: (error: Error) => void;
  jest.mocked(loadEventPeopleOperation).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const { result } = renderHook(() => useEventPeopleOperations(scope, true, jest.fn()));
  jest.mocked(loadEventPeopleOperation).mockResolvedValue(pending);
  await act(async () => result.current.reload());
  expect(result.current.saved).toEqual(pending);
  await act(async () => { if (completion === 'resolve') finish(null); else fail(new Error('Obsolete storage failure')); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.ready).toBe(true);
  expect(result.current.storageFailed).toBe(false);
  expect(result.current.blocked).toBe(true);
});

it('never replays on load and preserves pending intent after failed explicit recovery', async () => {
  jest.mocked(loadEventPeopleOperation).mockResolvedValue(pending);
  jest.mocked(recoverEventPeopleOperation).mockRejectedValue(new Error('Response lost'));
  const accepted = jest.fn();
  const { result } = renderHook(() => useEventPeopleOperations(scope, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(recoverEventPeopleOperation).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.submit()).rejects.toThrow('Response lost'); });
  expect(result.current.saved).toEqual(pending);
  expect(result.current.busy).toBe(false);
  expect(result.current.operationFailed).toBe(true);
  expect(accepted).not.toHaveBeenCalled();
});

it('does not publish completion after departure', async () => {
  let finish!: () => void;
  jest.mocked(loadEventPeopleOperation).mockResolvedValue(pending);
  jest.mocked(recoverEventPeopleOperation).mockImplementation(() => new Promise(resolve => { finish = () => resolve({} as never); }));
  const accepted = jest.fn();
  const { result, unmount } = renderHook(() => useEventPeopleOperations(scope, true, accepted));
  await waitFor(() => expect(result.current.ready).toBe(true));
  let running!: Promise<void>;
  act(() => { running = result.current.submit(); });
  unmount();
  await act(async () => { finish(); await running; });
  expect(accepted).not.toHaveBeenCalled();
});
