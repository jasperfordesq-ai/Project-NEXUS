// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { completeGoalCreationOperation, reserveGoalCreationOperation } from './goalCreationOperation';

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

it('reuses an unresolved intent and rotates after the server confirms it', async () => {
  const first = await reserveGoalCreationOperation('goal:help neighbours');
  expect((await reserveGoalCreationOperation('goal:help neighbours')).key).toBe(first.key);
  await completeGoalCreationOperation(first);
  expect((await reserveGoalCreationOperation('goal:help neighbours')).key).not.toBe(first.key);
});

it('separates goal and template intent and account identity', async () => {
  const goal = await reserveGoalCreationOperation('goal:one');
  expect((await reserveGoalCreationOperation('template:one')).key).not.toBe(goal.key);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  expect((await reserveGoalCreationOperation('goal:one')).key).not.toBe(goal.key);
});

it('persists a completion tombstone when secure deletion fails', async () => {
  const operation = await reserveGoalCreationOperation('goal:confirmed');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(completeGoalCreationOperation(operation)).resolves.toBeUndefined();
  expect([...persisted.values()].some(value => value.includes('"completed":true'))).toBe(true);
});
