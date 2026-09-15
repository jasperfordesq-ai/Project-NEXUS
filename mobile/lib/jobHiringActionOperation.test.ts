// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import {
  completeJobHiringActionOperation,
  reserveJobHiringActionOperation,
} from './jobHiringActionOperation';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(),
}));
jest.mock('@/lib/storage', () => ({
  storage: { getJson: jest.fn(), get: jest.fn() },
}));
jest.mock('@/lib/utils/idempotencyKey', () => ({ mutationIdempotencyKey: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(storage.getJson).mockResolvedValue({ id: 7 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(digestStringAsync).mockResolvedValue('intent-hash');
  jest.mocked(mutationIdempotencyKey).mockReturnValue('durable-key');
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
});

it('persists one key and reuses it after a process-style retry', async () => {
  const first = await reserveJobHiringActionOperation('interview:44:tomorrow');
  expect(first.key).toBe('durable-key');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(first.storageKey, expect.stringContaining('durable-key'));

  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(first));
  jest.mocked(mutationIdempotencyKey).mockReturnValue('must-not-be-used');
  const retry = await reserveJobHiringActionOperation('interview:44:tomorrow');
  expect(retry).toEqual(first);
});

it('removes the durable attempt only after the server result is confirmed', async () => {
  const operation = { storageKey: 'nexus_job_hiring_action_hash', key: 'durable-key', createdAt: 1 };
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(operation));

  await completeJobHiringActionOperation(operation);

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(operation.storageKey);
});

it('refuses to send when the account changes while reserving the key', async () => {
  jest.mocked(storage.getJson)
    .mockResolvedValueOnce({ id: 7 })
    .mockResolvedValueOnce({ id: 99 });

  await expect(reserveJobHiringActionOperation('offer:44')).rejects.toThrow('identity changed');
});
