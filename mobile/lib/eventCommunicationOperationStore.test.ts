// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import {
  acknowledgeEventCommunicationOperation as acknowledge,
  loadEventCommunicationOperation as load,
  prepareEventCommunicationOperation as prepare,
  rejectEventCommunicationOperation as reject,
  PendingEventCommunicationConflict,
  type EventCommunicationIntent,
} from './eventCommunicationOperationStore';

jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const input = { variant: 'announcement' as const, segments: ['registration_confirmed' as const], channels: ['in_app' as const], body: 'Original wording' };
const intent: EventCommunicationIntent = { action: 'create', input };
const receipt = { id: 19, event_id: 42, version: 1, status: 'draft' as const };

beforeEach(() => {
  jest.resetAllMocks();
  values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => {
    const raw = values.get(key); return raw === undefined ? null : JSON.parse(raw);
  });
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
});

it.each<EventCommunicationIntent>([
  intent,
  { action: 'revise', broadcastId: 19, expectedVersion: 1, input },
  { action: 'schedule', broadcastId: 19, expectedVersion: 1, scheduledAt: '2030-01-01T10:00:00Z' },
  { action: 'cancel', broadcastId: 19, expectedVersion: 2, reason: 'Changed plans' },
  { action: 'retry', broadcastId: 19, expectedVersion: 3 },
])('persists and reuses the exact $action request', async request => {
  const first = await prepare(scope, request);
  expect(await load(scope)).toEqual(first);
  expect(await prepare(scope, request)).toEqual(first);
  expect(storage.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), { required: true });
});

it('supports maximum body length and keeps a receipt without duplicating the body', async () => {
  const request: EventCommunicationIntent = { action: 'create', input: { ...input, body: '\u0001'.repeat(20000) } };
  const pending = await prepare(scope, request);
  await acknowledge(scope, pending.key, receipt);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', receipt, intent: request });
});

it('serializes simultaneous preparations and refuses different unresolved work', async () => {
  const [one, two] = await Promise.all([prepare(scope, intent), prepare(scope, intent)]);
  expect(one.key).toBe(two.key);
  await expect(prepare(scope, { action: 'create', input: { ...input, body: 'Changed wording' } }))
    .rejects.toBeInstanceOf(PendingEventCommunicationConflict);
  expect(await load(scope)).toEqual(one);
});

it('isolates tenant, account and event journals', async () => {
  await prepare(scope, intent);
  expect(await load({ ...scope, tenantId: 3 })).toBeNull();
  expect(await load({ ...scope, userId: 8 })).toBeNull();
  expect(await load({ ...scope, eventId: 43 })).toBeNull();
});

it('fails closed on unavailable required storage instead of replacing the pending key', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.get).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(prepare(scope, intent)).rejects.toThrow('Storage unavailable');
  expect(await load(scope)).toEqual(pending);
});

it('does not return an operation before its durable manifest commits', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Storage full'));
  await expect(prepare(scope, intent)).rejects.toThrow('could not be saved');
  expect(await load(scope)).toBeNull();
});

it('keeps the original replayable operation when receipt persistence fails', async () => {
  const pending = await prepare(scope, intent);
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Storage full'));
  await expect(acknowledge(scope, pending.key, receipt)).rejects.toThrow('could not be saved');
  expect(await load(scope)).toEqual(pending);
});

it('allows a genuinely new identical request only after confirmed success', async () => {
  const pending = await prepare(scope, intent);
  await acknowledge(scope, pending.key, receipt);
  await expect(reject(scope, pending.key, 'VALIDATION_FAILED')).rejects.toThrow();
  const next = await prepare(scope, intent);
  expect(next.key).not.toBe(pending.key);
  await expect(acknowledge(scope, pending.key, receipt)).rejects.toThrow();
  expect(await load(scope)).toEqual(next);
});

it('records definitive rejection before allowing corrected wording', async () => {
  const pending = await prepare(scope, intent);
  await reject(scope, pending.key, 'VALIDATION_FAILED');
  expect(await load(scope)).toMatchObject({ status: 'rejected', rejectionCode: 'VALIDATION_FAILED' });
  const next = await prepare(scope, { action: 'create', input: { ...input, body: 'Corrected wording' } });
  expect(next.key).not.toBe(pending.key);
});

it('refuses receipts for another event or record', async () => {
  const pending = await prepare(scope, { action: 'revise', broadcastId: 19, expectedVersion: 1, input });
  await expect(acknowledge(scope, pending.key, { ...receipt, event_id: 43 })).rejects.toThrow();
  await expect(acknowledge(scope, pending.key, { ...receipt, id: 20 })).rejects.toThrow();
  await expect(acknowledge(scope, pending.key, receipt)).rejects.toThrow();
  expect(await load(scope)).toEqual(pending);
  await acknowledge(scope, pending.key, { ...receipt, version: 2 });
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', receipt: { version: 2 } });
});

it('rejects malformed stored ownership and preserves the unreadable record', async () => {
  const pending = await prepare(scope, intent);
  // Replace the saved generation with a complete but wrongly owned payload.
  const manifestKey = 'nexus_creation_draft_v1_event-communication_2_7_42';
  const manifest = JSON.parse(values.get(manifestKey)!);
  values.set(`${manifestKey}_${manifest.generation}_0`, JSON.stringify({ ...pending, userId: 8 }));
  values.set(manifestKey, JSON.stringify({ ...manifest, chunks: 1 }));
  await expect(load(scope)).rejects.toThrow('identity changed');
  await expect(prepare(scope, intent)).rejects.toThrow('identity changed');
});
