// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { completePostCreationOperation, reservePostCreationOperation } from './postCreationOperation';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');
jest.mock('@/lib/utils/idempotencyKey', () => ({ mutationIdempotencyKey: jest.fn() }));

const persisted = new Map<string, string>();
let sequence = 0;

beforeEach(() => {
  persisted.clear();
  sequence = 0;
  jest.clearAllMocks();
  jest.mocked(mutationIdempotencyKey).mockImplementation(prefix => `${prefix}-${++sequence}`);
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm: CryptoDigestAlgorithm, value: string) => `${value.length}:${value}`);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persisted.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persisted.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { persisted.delete(key); });
});

it('reuses the exact unresolved post intent and rotates after confirmation', async () => {
  const first = await reservePostCreationOperation('{"content":"hello","group_id":23}');
  expect((await reservePostCreationOperation('{"content":"hello","group_id":23}')).key).toBe(first.key);
  await completePostCreationOperation(first);
  expect((await reservePostCreationOperation('{"content":"hello","group_id":23}')).key).not.toBe(first.key);
});

it('does not reuse a group post operation for community or another group', async () => {
  const group = await reservePostCreationOperation('{"content":"hello","group_id":23}');
  expect((await reservePostCreationOperation('{"content":"hello"}')).key).not.toBe(group.key);
  expect((await reservePostCreationOperation('{"content":"hello","group_id":24}')).key).not.toBe(group.key);
});

it('persists a completion tombstone when secure deletion fails', async () => {
  const operation = await reservePostCreationOperation('{"content":"confirmed"}');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(completePostCreationOperation(operation)).resolves.toBeUndefined();
  expect([...persisted.values()].some(value => value.includes('"completed":true'))).toBe(true);
});
