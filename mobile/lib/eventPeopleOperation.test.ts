// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from './storage';
import { mutateEventRegistrations } from './api/eventPeople';
import { loadEventPeopleOperation as load, prepareEventPeopleOperation as prepare,
  type EventPeopleIntent } from './eventPeopleOperationStore';
import { executeEventPeopleOperation as execute, recoverEventPeopleOperation as recover,
  EventPeopleOperationBusy, EventPeopleOperationDeparted, NoPendingEventPeopleOperation } from './eventPeopleOperation';

jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('./api/eventPeople', () => ({ mutateEventRegistrations: jest.fn() }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const intent: EventPeopleIntent = { action: 'approve', reason: null, targets: [{ userId: 10, version: 2 }] };
type Result = Awaited<ReturnType<typeof mutateEventRegistrations>>;
const result: Result = { requested: 1, succeeded: 1, failed: 0, results: [
  { index: 0, user_id: 10, action: 'approve', expected_version: 2, success: true,
    mutation: { registration_id: 8, version: 3, state: 'confirmed', changed: true, idempotent_replay: false, history_entry_id: 19 } },
] };
const transport = jest.mocked(mutateEventRegistrations);
beforeEach(() => {
  jest.resetAllMocks(); values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => {
    const raw = values.get(key); return raw === undefined ? null : JSON.parse(raw);
  });
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
});

it('replays original keys and versions only on explicit recovery after a lost response', async () => {
  transport.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce(result);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Response lost');
  expect(transport).toHaveBeenCalledTimes(1);
  const firstRequest = transport.mock.calls[0];
  expect(await load(scope)).toMatchObject({ status: 'pending' });
  expect(await recover(scope, () => true)).toEqual(result);
  expect(transport.mock.calls[1]).toEqual(firstRequest);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(NoPendingEventPeopleOperation);
  expect(transport).toHaveBeenCalledTimes(2);
});
it('does not transport before a durable save', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full storage'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('does not save or send after departure', async () => {
  await expect(execute(scope, intent, () => false)).rejects.toBeInstanceOf(EventPeopleOperationDeparted);
  expect(storage.set).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});
it('checks identity again after storage and retains recoverable work', async () => {
  let current = true;
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => {
    values.set(key, JSON.stringify(value)); current = false;
  });
  await expect(execute(scope, intent, () => current)).rejects.toBeInstanceOf(EventPeopleOperationDeparted);
  expect(transport).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('prevents overlapping sends and persists acceptance after departure', async () => {
  let current = true;
  let finish!: (value: Result) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  transport.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const first = execute(scope, intent, () => current);
  await ready;
  await expect(execute(scope, intent, () => true)).rejects.toBeInstanceOf(EventPeopleOperationBusy);
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(EventPeopleOperationBusy);
  current = false; finish(result); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('retains a request on receipt-save failure and releases the busy guard for recovery', async () => {
  const pending = await prepare(scope, intent);
  transport.mockResolvedValue(result);
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Receipt unavailable'));
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
  await recover(scope, () => true);
  expect(transport.mock.calls[1]).toEqual(transport.mock.calls[0]);
});
it('does not recover another account, community or event', async () => {
  await prepare(scope, intent);
  for (const other of [{ ...scope, userId: 8 }, { ...scope, tenantId: 3 }, { ...scope, eventId: 43 }]) {
    await expect(recover(other, () => true)).rejects.toBeInstanceOf(NoPendingEventPeopleOperation);
  }
  expect(transport).not.toHaveBeenCalled();
});
it('blocks changed intent after an uncertain contract response', async () => {
  transport.mockResolvedValueOnce({ ...result, requested: 2 });
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const pending = await load(scope);
  await expect(execute(scope, { ...intent, action: 'invite' }, () => true)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
  expect(transport).toHaveBeenCalledTimes(1);
});
it('returns and stores per-person failure without assuming HTTP success means acceptance', async () => {
  const rejected: Result = { requested: 1, succeeded: 0, failed: 1, results: [
    { index: 0, user_id: 10, action: 'approve', expected_version: 2, success: false,
      error: { code: 'VERSION_CONFLICT', message: 'Changed elsewhere' } },
  ] };
  transport.mockResolvedValueOnce(rejected);
  expect(await execute(scope, intent, () => true)).toEqual(rejected);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', outcomes: [{ userId: 10, success: false, code: 'VERSION_CONFLICT' }] });
});
