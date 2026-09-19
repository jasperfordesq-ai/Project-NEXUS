// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import type { mutateEventRegistrations } from './api/eventPeople';
import { acknowledgeEventPeopleOperation as acknowledge, loadEventPeopleOperation as load,
  prepareEventPeopleOperation as prepare, eventPeopleRequest, PendingEventPeopleConflict,
  type EventPeopleIntent } from './eventPeopleOperationStore';

jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const intent: EventPeopleIntent = { action: 'approve', reason: null, targets: [{ userId: 10, version: 2 }, { userId: 11, version: 3 }] };
type Receipt = Awaited<ReturnType<typeof mutateEventRegistrations>>;
function receipt(): Receipt {
  return { requested: 2, succeeded: 1, failed: 1, results: [
    { index: 0, user_id: 10, action: 'approve', expected_version: 2, success: true,
      mutation: { registration_id: 8, version: 3, state: 'confirmed', changed: true, idempotent_replay: false, history_entry_id: 19 } },
    { index: 1, user_id: 11, action: 'approve', expected_version: 3, success: false,
      error: { code: 'VERSION_CONFLICT', message: 'Private response wording' } },
  ] };
}
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

it('durably reuses each original key and version after interrupted work', async () => {
  const first = await prepare(scope, intent);
  const recovered = await load(scope);
  expect(recovered).toEqual(first);
  expect(await prepare(scope, intent)).toEqual(first);
  expect(eventPeopleRequest(recovered!)).toEqual(intent.targets.map((target, index) => ({
    user_id: target.userId, expected_version: target.version, action: 'approve', reason: null, idempotency_key: `${first.key}-${index}`,
  })));
  expect(storage.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), { required: true });
});
it('serializes preparations and refuses a different unresolved batch', async () => {
  const [one, two] = await Promise.all([prepare(scope, intent), prepare(scope, intent)]);
  expect(one.key).toBe(two.key);
  await expect(prepare(scope, { ...intent, action: 'invite' })).rejects.toBeInstanceOf(PendingEventPeopleConflict);
  expect(await load(scope)).toEqual(one);
});
it('isolates accounts, communities and events', async () => {
  await prepare(scope, intent);
  for (const other of [{ ...scope, userId: 8 }, { ...scope, tenantId: 3 }, { ...scope, eventId: 43 }]) {
    expect(await load(other)).toBeNull();
  }
});
it('stores correlated partial outcomes without server messages, regardless of response order', async () => {
  const pending = await prepare(scope, intent);
  const result = receipt(); result.results.reverse();
  await acknowledge(scope, pending.key, result);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', outcomes: [
    { userId: 10, success: true, registrationId: 8, version: 3, state: 'confirmed' },
    { userId: 11, success: false, code: 'VERSION_CONFLICT' },
  ] });
  expect(JSON.stringify(await load(scope))).not.toContain('Private response wording');
  expect((await prepare(scope, intent)).key).not.toBe(pending.key);
});
it.each(['missing', 'duplicate', 'member', 'action', 'version', 'counts'] as const)('keeps pending keys after a %s receipt mismatch', async kind => {
  const pending = await prepare(scope, intent);
  const result = receipt();
  if (kind === 'missing') result.results.pop();
  if (kind === 'duplicate') result.results[1] = result.results[0];
  if (kind === 'member') result.results[1].user_id = 99;
  if (kind === 'action') result.results[1].action = 'invite';
  if (kind === 'version') result.results[1].expected_version = 8;
  if (kind === 'counts') result.succeeded = 2;
  await expect(acknowledge(scope, pending.key, result)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
});
it('retains pending work if receipt storage fails', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(acknowledge(scope, pending.key, receipt())).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
});
it('never supplies a new request when its initial manifest cannot commit', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(prepare(scope, intent)).rejects.toThrow();
  expect(await load(scope)).toBeNull();
});
it('does not replace an unreadable pending operation', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.get).mockRejectedValueOnce(new Error('Locked storage'));
  await expect(prepare(scope, intent)).rejects.toThrow('Locked storage');
  expect(await load(scope)).toEqual(pending);
});
it('rejects stale acknowledgements for the next operation', async () => {
  const first = await prepare(scope, intent);
  await acknowledge(scope, first.key, receipt());
  const next = await prepare(scope, intent);
  await expect(acknowledge(scope, first.key, receipt())).rejects.toThrow();
  expect(await load(scope)).toEqual(next);
});
it('fits 100 people with the maximum escaped shared reason and receipts', async () => {
  const large: EventPeopleIntent = { action: 'cancel', reason: '\u0001'.repeat(4000),
    targets: Array.from({ length: 100 }, (_, i) => ({ userId: i + 1, version: 1 })) };
  const pending = await prepare(scope, large);
  expect(await load(scope)).toEqual(pending);
  await acknowledge(scope, pending.key, { requested: 100, succeeded: 100, failed: 0,
    results: large.targets.map((target, index) => ({ index, user_id: target.userId, action: 'cancel', expected_version: 1,
      success: true, mutation: { registration_id: target.userId, version: 2, state: 'cancelled', changed: true, idempotent_replay: false, history_entry_id: null } })) });
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', outcomes: expect.any(Array) });
});
