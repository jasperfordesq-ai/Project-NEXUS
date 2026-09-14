// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { completeListingOperation, reserveListingOperation } from './listingOperation';

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

it('reuses one unresolved listing key and rotates it after confirmation', async () => {
  const first = await reserveListingOperation('{"title":"Garden help"}');
  expect((await reserveListingOperation('{"title":"Garden help"}')).key).toBe(first.key);
  await completeListingOperation(first);
  expect((await reserveListingOperation('{"title":"Garden help"}')).key).not.toBe(first.key);
});

it('separates listing content and account identity', async () => {
  const first = await reserveListingOperation('first');
  expect((await reserveListingOperation('second')).key).not.toBe(first.key);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  expect((await reserveListingOperation('first')).key).not.toBe(first.key);
});

it('writes a completion tombstone when deletion fails', async () => {
  const operation = await reserveListingOperation('confirmed listing');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(completeListingOperation(operation)).resolves.toBeUndefined();
  expect([...persisted.values()].some(value => value.includes('"completed":true'))).toBe(true);
});
