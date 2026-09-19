// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from './storage';
import { registerEventAgendaSession as register, withdrawEventAgendaSession as withdraw } from './api/events';
import { loadEventSessionOperation as load, prepareEventSessionOperation as prepare } from './eventSessionOperationStore';
import { executeEventSessionOperation as execute, recoverEventSessionOperation as recover,
  EventSessionOperationBusy, EventSessionOperationDeparted, NoPendingEventSessionOperation } from './eventSessionOperation';
jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('./api/events', () => ({ registerEventAgendaSession: jest.fn(), withdrawEventAgendaSession: jest.fn() }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42, sessionId: 51 };
const intent = { action: 'register' as const, expectedVersion: 0 };
type Result = Awaited<ReturnType<typeof register>>;
const result: Result = { data: { session: null, registration_version: 1, history_entry_id: 10, changed: true, idempotent_replay: false } };
beforeEach(() => {
  jest.resetAllMocks(); values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
  jest.mocked(register).mockResolvedValue(result);
  jest.mocked(withdraw).mockResolvedValue(result);
});
it.each(['register', 'withdraw'] as const)('recovers original %s after response loss', async action => {
  const send = action === 'register' ? register : withdraw;
  jest.mocked(send).mockRejectedValueOnce(new Error('Response lost'));
  await expect(execute(scope, { ...intent, action }, () => true)).rejects.toThrow();
  const pending = await load(scope);
  expect(pending?.status).toBe('pending');
  await recover(scope, () => true);
  expect(jest.mocked(send).mock.calls[1]).toEqual(jest.mocked(send).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(NoPendingEventSessionOperation);
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not send an unsaved request', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(register).not.toHaveBeenCalled();
});
it('checks departure before and after storage', async () => {
  await expect(execute(scope, intent, () => false)).rejects.toBeInstanceOf(EventSessionOperationDeparted);
  expect(storage.set).not.toHaveBeenCalled();
  let current = true;
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); current = false; });
  await expect(execute(scope, intent, () => current)).rejects.toBeInstanceOf(EventSessionOperationDeparted);
  expect(register).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('blocks overlapping recovery and saves acceptance after departure', async () => {
  let finish!: (value: Result) => void;
  let started!: () => void;
  let current = true;
  const ready = new Promise<void>(resolve => { started = resolve; });
  jest.mocked(register).mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const first = execute(scope, intent, () => current);
  await ready;
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(EventSessionOperationBusy);
  current = false; finish(result); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
  expect(register).toHaveBeenCalledTimes(1);
});
it('retains pending work on receipt-save failure and releases the overlap guard', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
  await recover(scope, () => true);
  expect(jest.mocked(register).mock.calls[1]).toEqual(jest.mocked(register).mock.calls[0]);
});
it('never recovers another owner or session', async () => {
  await prepare(scope, intent);
  for (const field of ['tenantId', 'userId', 'eventId', 'sessionId'] as const) {
    await expect(recover({ ...scope, [field]: scope[field] + 1 }, () => true)).rejects.toBeInstanceOf(NoPendingEventSessionOperation);
  }
  expect(register).not.toHaveBeenCalled();
});
it('preserves pending work after a mismatched session receipt', async () => {
  jest.mocked(register).mockResolvedValueOnce({ data: { ...result.data,
    session: { id: 99, registration: { version: 1 } } } } as never);
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
