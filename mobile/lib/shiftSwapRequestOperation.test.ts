// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import {
  completeShiftSwapRequestOperation,
  reserveShiftSwapRequestOperation,
} from './shiftSwapRequestOperation';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');
jest.mock('@/lib/utils/idempotencyKey', () => ({ mutationIdempotencyKey: jest.fn() }));

const persisted = new Map<string, string>();
let keySequence = 0;

beforeEach(() => {
  persisted.clear();
  keySequence = 0;
  jest.clearAllMocks();
  jest.mocked(mutationIdempotencyKey).mockImplementation(prefix => `${prefix}-${++keySequence}`);
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm: CryptoDigestAlgorithm, value: string) => {
    const checksum = [...value].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381);
    return `${value.length}-${checksum}`;
  });
  jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persisted.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persisted.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { persisted.delete(key); });
});

it('reuses an unresolved swap-request key and rotates it after confirmation', async () => {
  const first = await reserveShiftSwapRequestOperation('[66,67]');
  expect((await reserveShiftSwapRequestOperation('[66,67]')).key).toBe(first.key);
  await completeShiftSwapRequestOperation(first);
  expect((await reserveShiftSwapRequestOperation('[66,67]')).key).not.toBe(first.key);
});

it('separates swap intent, account and community identity', async () => {
  const first = await reserveShiftSwapRequestOperation('[66,67]');
  expect((await reserveShiftSwapRequestOperation('[66,68]')).key).not.toBe(first.key);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  expect((await reserveShiftSwapRequestOperation('[66,67]')).key).not.toBe(first.key);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 41 });
  jest.mocked(storage.get).mockResolvedValue('another-community');
  expect((await reserveShiftSwapRequestOperation('[66,67]')).key).not.toBe(first.key);
});

it('writes a completion tombstone when confirmed cleanup cannot delete', async () => {
  const operation = await reserveShiftSwapRequestOperation('[66,67]');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(completeShiftSwapRequestOperation(operation)).resolves.toBeUndefined();
  expect([...persisted.values()].some(value => value.includes('"completed":true'))).toBe(true);
});
