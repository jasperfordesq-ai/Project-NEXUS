// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { reserveEventTicketOperation, completeEventTicketOperation, getPendingEventTicketOperation } from './eventTicketOperation';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');
jest.mock('@/lib/utils/idempotencyKey', () => ({ mutationIdempotencyKey: jest.fn() }));
const persisted = new Map<string, string>();
let sequence = 0;
const claim = JSON.stringify(['allocate', 4, 7, 1]);

beforeEach(() => {
  persisted.clear();
  jest.clearAllMocks();
  jest.mocked(mutationIdempotencyKey).mockImplementation(() => `ticket-${++sequence}`);
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm, value) => value);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
  jest.mocked(storage.get).mockResolvedValue('community');
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persisted.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persisted.set(key, value); });
});

it('serializes reservations and reuses a saved key after module reload', async () => {
  const [first, second] = await Promise.all([reserveEventTicketOperation(claim), reserveEventTicketOperation(claim)]);
  expect(first.key).toBe(second.key);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  let reloaded!: typeof import('./eventTicketOperation');
  jest.isolateModules(() => { reloaded = require('./eventTicketOperation'); });
  expect((await reloaded.reserveEventTicketOperation(claim)).key).toBe(first.key);
  expect((await reloaded.getPendingEventTicketOperation(4))?.intent).toBe(claim);
});

it('blocks an edited or competing request while the original outcome is unresolved', async () => {
  const original = await reserveEventTicketOperation(claim);
  await expect(reserveEventTicketOperation(JSON.stringify(['allocate', 4, 7, 2]))).rejects.toThrow('unresolved');
  expect((await getPendingEventTicketOperation(4))?.key).toBe(original.key);
  await completeEventTicketOperation(original);
  await expect(getPendingEventTicketOperation(4)).resolves.toBeNull();
  await expect(reserveEventTicketOperation(JSON.stringify(['allocate', 4, 7, 2]))).resolves.toHaveProperty('intent');
});

it('migrates a matching unresolved record from the earlier per-request format', async () => {
  persisted.set(`nexus_event_ticket_operation_${JSON.stringify(['community', 41, claim])}`, JSON.stringify({ key: 'legacy-key', createdAt: 1 }));
  const operation = await reserveEventTicketOperation(claim);
  expect(operation.key).toBe('legacy-key');
  expect((await getPendingEventTicketOperation(4))?.key).toBe('legacy-key');
});

it('rotates after completion and leaves a newer key intact on duplicate completion', async () => {
  const first = await reserveEventTicketOperation(claim);
  await completeEventTicketOperation(first);
  const second = await reserveEventTicketOperation(claim);
  expect(second.key).not.toBe(first.key);
  await completeEventTicketOperation(first);
  expect((await reserveEventTicketOperation(claim)).key).toBe(second.key);
});

it('separates account and community identity', async () => {
  const first = await reserveEventTicketOperation(claim);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  const second = await reserveEventTicketOperation(claim);
  jest.mocked(storage.get).mockResolvedValue('another-community');
  const third = await reserveEventTicketOperation(claim);
  expect(new Set([first.key, second.key, third.key]).size).toBe(3);
});

it('rejects identity replacement during persistence', async () => {
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
    persisted.set(key, value);
    jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  });
  await expect(reserveEventTicketOperation(claim)).rejects.toThrow('identity changed');
  expect(persisted.size).toBe(1);
});

it.each(['{', '{}', 'null', '{"key":"old","createdAt":1,"completed":"yes"}'])('refuses a malformed record instead of minting another key: %s', async raw => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(raw);
  await expect(reserveEventTicketOperation(claim)).rejects.toThrow();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('does not return a sendable key when persistence fails', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(reserveEventTicketOperation(claim)).rejects.toThrow('Storage unavailable');
});

it('keeps confirmed success successful when completion storage fails', async () => {
  const first = await reserveEventTicketOperation(claim);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(completeEventTicketOperation(first)).resolves.toBeUndefined();
  let reloaded!: typeof import('./eventTicketOperation');
  jest.isolateModules(() => { reloaded = require('./eventTicketOperation'); });
  expect((await reloaded.reserveEventTicketOperation(claim)).key).toBe(first.key);
});
