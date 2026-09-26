// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { storage } from '@/lib/storage';
import {
  completeGroupFileUploadOperation,
  reserveGroupFileUploadOperation,
} from './groupFileUploadOperation';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hash:${value}`),
}));
jest.mock('@/lib/storage', () => ({
  storage: { getJson: jest.fn(), get: jest.fn() },
}));
jest.mock('@/lib/utils/idempotencyKey', () => ({
  mutationIdempotencyKey: jest.fn(() => 'mobile-group-file-upload-fixed-key'),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(storage.getJson).mockResolvedValue({ id: 42 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});

it('reuses an unfinished upload operation for the same account, tenant, and file intent', async () => {
  const first = await reserveGroupFileUploadOperation('{"groupId":7,"name":"notes.txt","size":20}');
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(first));

  const replay = await reserveGroupFileUploadOperation('{"groupId":7,"name":"notes.txt","size":20}');

  expect(replay).toEqual(first);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

it('scopes the upload operation to the selected file intent', async () => {
  const first = await reserveGroupFileUploadOperation('{"groupId":7,"name":"notes.txt","size":20}');
  const changed = await reserveGroupFileUploadOperation('{"groupId":7,"name":"other.txt","size":20}');

  expect(changed.storageKey).not.toBe(first.storageKey);
});

it('removes the reservation only after confirmed server success', async () => {
  const operation = await reserveGroupFileUploadOperation('{"groupId":7,"name":"notes.txt","size":20}');
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(operation));

  await completeGroupFileUploadOperation(operation);

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(operation.storageKey);
});

it('refuses an account replacement before transport', async () => {
  jest.mocked(storage.getJson).mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99 });

  await expect(reserveGroupFileUploadOperation('{"groupId":7,"name":"notes.txt","size":20}'))
    .rejects.toThrow('identity changed');
});
