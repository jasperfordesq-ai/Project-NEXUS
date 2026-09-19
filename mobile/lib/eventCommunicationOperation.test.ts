// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import { ApiResponseError } from '@/lib/api/client';
import * as api from '@/lib/api/eventCommunications';
import { loadEventCommunicationOperation as load, prepareEventCommunicationOperation as prepare, type EventCommunicationIntent } from './eventCommunicationOperationStore';
import { executeEventCommunicationOperation as execute, recoverEventCommunicationOperation as recover, EventCommunicationOperationBusy, EventCommunicationOperationDeparted, NoPendingEventCommunicationOperation } from './eventCommunicationOperation';

jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('@/lib/api/eventCommunications', () => ({
  ...jest.requireActual('@/lib/api/eventCommunications'),
  createEventCommunication: jest.fn(), reviseEventCommunication: jest.fn(), scheduleEventCommunication: jest.fn(),
  cancelEventCommunication: jest.fn(), retryEventCommunication: jest.fn(),
}));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const input = { variant: 'announcement' as const, segments: ['registration_confirmed' as const], channels: ['in_app' as const], body: 'Exact wording' };
const create: EventCommunicationIntent = { action: 'create', input };
const broadcast: api.MobileEventBroadcast = {
  contract_version: 1, id: 19, event_id: 42, version: 5, status: 'sent', variant: 'announcement',
  audience: { segments: input.segments, recipient_count: 1 }, channels: input.channels, body: input.body,
  delivery: { total: 1, delivered: 1, suppressed: 0, dead_lettered: 0, failure_code: null },
  capabilities: { edit: false, schedule: false, cancel: false, retry: false },
  scheduled_at: null, cancelled_at: null, sent_at: null, failed_at: null, created_at: null, updated_at: null,
};

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

it.each([
  [create, api.createEventCommunication, [42, input]],
  [{ action: 'revise', broadcastId: 19, expectedVersion: 1, input }, api.reviseEventCommunication, [19, 1, input]],
  [{ action: 'schedule', broadcastId: 19, expectedVersion: 2, scheduledAt: null }, api.scheduleEventCommunication, [19, 2, null]],
  [{ action: 'cancel', broadcastId: 19, expectedVersion: 2, reason: 'Changed plans' }, api.cancelEventCommunication, [19, 2, 'Changed plans']],
  [{ action: 'retry', broadcastId: 19, expectedVersion: 3 }, api.retryEventCommunication, [19, 3]],
] as const)('replays the saved %j action after a lost response with the original key and payload', async (intent, transport, args) => {
  const mock = transport as jest.Mock;
  mock.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce(broadcast);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Response lost');
  const pending = await load(scope);
  expect(pending?.status).toBe('pending');
  expect(mock).toHaveBeenNthCalledWith(1, ...args, pending?.key);
  expect(await recover(scope, () => true)).toEqual(broadcast);
  expect(mock).toHaveBeenNthCalledWith(2, ...args, pending?.key);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', receipt: { status: 'sent', version: 5 } });
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(NoPendingEventCommunicationOperation);
  expect(mock).toHaveBeenCalledTimes(2);
});

it('does not transport when persistence fails', async () => {
  jest.mocked(storage.set).mockRejectedValue(new Error('Storage unavailable'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  expect(api.createEventCommunication).not.toHaveBeenCalled();
});

it('checks ownership again after storage and leaves recoverable intent on departure', async () => {
  let current = true;
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => {
    values.set(key, JSON.stringify(value)); current = false;
  });
  await expect(execute(scope, create, () => current)).rejects.toBeInstanceOf(EventCommunicationOperationDeparted);
  expect(api.createEventCommunication).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});

it('acknowledges an accepted response after departure and prevents overlapping transports', async () => {
  let current = true;
  let finish!: (value: api.MobileEventBroadcast) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  jest.mocked(api.createEventCommunication).mockImplementation(() => {
    started(); return new Promise(resolve => { finish = resolve; });
  });
  const first = execute(scope, create, () => current);
  await startedPromise;
  await expect(recover(scope, () => true)).rejects.toBeInstanceOf(EventCommunicationOperationBusy);
  current = false; finish(broadcast); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
  expect(api.createEventCommunication).toHaveBeenCalledTimes(1);
});

it('keeps the key when receipt persistence fails and replays without creating new intent', async () => {
  const pending = await prepare(scope, create);
  jest.mocked(api.createEventCommunication).mockResolvedValue(broadcast);
  jest.mocked(storage.set).mockRejectedValueOnce(new Error('Receipt storage failed'));
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', key: pending.key });
  await recover(scope, () => true);
  expect(api.createEventCommunication).toHaveBeenNthCalledWith(2, 42, input, pending.key);
});

it('never recovers another account or invents a pending request', async () => {
  await prepare(scope, create);
  await expect(recover({ ...scope, userId: 8 }, () => true)).rejects.toBeInstanceOf(NoPendingEventCommunicationOperation);
  expect(api.createEventCommunication).not.toHaveBeenCalled();
});

it('retains uncertain contract failures and refuses changed wording until recovery', async () => {
  jest.mocked(api.createEventCommunication).mockRejectedValueOnce(Object.assign(new Error('Contract drift'), { status: 422, code: 'EVENTS_CONTRACT_DRIFT' }));
  await expect(execute(scope, create, () => true)).rejects.toThrow('Contract drift');
  const pending = await load(scope);
  await expect(execute(scope, { action: 'create', input: { ...input, body: 'New wording' } }, () => true)).rejects.toThrow('Resolve the pending event operation first');
  expect(await load(scope)).toEqual(pending);
  expect(api.createEventCommunication).toHaveBeenCalledTimes(1);
});

it('permits a genuinely new identical operation only after acknowledgement', async () => {
  jest.mocked(api.createEventCommunication).mockResolvedValue(broadcast);
  await execute(scope, create, () => true);
  const first = await load(scope);
  await execute(scope, create, () => true);
  const second = await load(scope);
  expect(second?.status).toBe('acknowledged');
  expect(second?.key).not.toBe(first?.key);
  expect(api.createEventCommunication).toHaveBeenCalledTimes(2);
});

it('releases a proven rejected schedule so its time can be corrected', async () => {
  const intent: EventCommunicationIntent = { action: 'schedule', broadcastId: 19, expectedVersion: 1, scheduledAt: '2020-01-01T10:00:00Z' };
  jest.mocked(api.scheduleEventCommunication).mockRejectedValueOnce(new ApiResponseError(422, 'Past time', undefined, 'EVENT_BROADCAST_SCHEDULE_IN_PAST'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Past time');
  const rejected = await load(scope);
  expect(rejected).toMatchObject({ status: 'rejected', rejectionCode: 'EVENT_BROADCAST_SCHEDULE_IN_PAST' });
  jest.mocked(api.scheduleEventCommunication).mockResolvedValueOnce(broadcast);
  await execute(scope, { ...intent, scheduledAt: null }, () => true);
  expect(api.scheduleEventCommunication).toHaveBeenLastCalledWith(19, 1, null, expect.any(String));
  expect((await load(scope))?.key).not.toBe(rejected?.key);
});

it.each(['EVENT_BROADCAST_VALIDATION_FAILED', 'EVENTS_CONTRACT_DRIFT', 'EVENT_BROADCAST_CONFLICT'])('retains uncertain %s schedules for recovery', async code => {
  jest.mocked(api.scheduleEventCommunication).mockRejectedValueOnce(new ApiResponseError(code.endsWith('CONFLICT') ? 409 : 422, 'Uncertain', undefined, code));
  await expect(execute(scope, { action: 'schedule', broadcastId: 19, expectedVersion: 1, scheduledAt: null }, () => true)).rejects.toThrow('Uncertain');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
