// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import { acknowledgeEventSessionOperation as acknowledge, loadEventSessionOperation as load,
  prepareEventSessionOperation as prepare, PendingEventSessionConflict } from './eventSessionOperationStore';
import type { registerEventAgendaSession } from './api/events';
jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42, sessionId: 51 };
const intent = { action: 'register' as const, expectedVersion: 0 };
const receipt = (): Awaited<ReturnType<typeof registerEventAgendaSession>> => ({ data: {
  session: null, registration_version: 1, history_entry_id: 10, changed: true, idempotent_replay: false,
} });
beforeEach(() => {
  jest.resetAllMocks(); values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
});
it('recovers the original key/version from durable chunks, including concurrent preparation', async () => {
  const [first, second] = await Promise.all([prepare(scope, intent), prepare(scope, intent)]);
  expect(second).toEqual(first);
  expect(await load(scope)).toEqual(first);
  expect(values.size).toBeGreaterThan(0);
});
it.each(['tenantId', 'userId', 'eventId', 'sessionId'] as const)('isolates %s', async field => {
  await prepare(scope, intent);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('preserves unresolved intent when action or expected version changes', async () => {
  const pending = await prepare(scope, intent);
  await expect(prepare(scope, { action: 'withdraw', expectedVersion: 0 })).rejects.toBeInstanceOf(PendingEventSessionConflict);
  await expect(prepare(scope, { action: 'register', expectedVersion: 2 })).rejects.toBeInstanceOf(PendingEventSessionConflict);
  expect(await load(scope)).toEqual(pending);
});
it('keeps pending work when receipt persistence fails', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(acknowledge(scope, pending.key, receipt())).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
});
it('fails closed on unreadable storage and cannot dispatch an unsaved request', async () => {
  jest.mocked(storage.get).mockRejectedValueOnce(new Error('Locked'));
  await expect(prepare(scope, intent)).rejects.toThrow();
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
  await expect(prepare(scope, intent)).rejects.toThrow();
  expect(await load(scope)).toBeNull();
});
it('acknowledges a correlated receipt and rejects stale acknowledgement of the next request', async () => {
  const first = await prepare(scope, intent);
  await acknowledge(scope, first.key, receipt());
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', registrationVersion: 1 });
  const next = await prepare(scope, { action: 'withdraw', expectedVersion: 1 });
  expect(next.key).not.toBe(first.key);
  await expect(acknowledge(scope, first.key, receipt())).rejects.toThrow();
  expect(await load(scope)).toEqual(next);
});
it('rejects a receipt belonging to another session', async () => {
  const pending = await prepare(scope, intent);
  const result = receipt();
  result.data.session = { id: 99, registration: { version: 1 } } as never;
  await expect(acknowledge(scope, pending.key, result)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
});
