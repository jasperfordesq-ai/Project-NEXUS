// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockFiles = new Map<string, string>();
const mockStorage = new Map<string, string>();
const mockWrite = jest.fn();
let mockSequence = 0;
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', EncodingType: { UTF8: 'utf8' },
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async (path: string) => {
    for (const key of mockFiles.keys()) if (key === path || key.startsWith(`${path}/`)) mockFiles.delete(key);
  }),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: async (_algorithm: string, value: string) => require('crypto').createHash('sha256').update(value).digest('hex'),
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
  randomUUID: () => `operation-${++mockSequence}`,
}));
jest.mock('@/lib/storage', () => ({ storage: {
  get: async (key: string) => mockStorage.get(key) ?? null,
  set: async (key: string, value: string) => { mockStorage.set(key, value); },
  remove: async (key: string) => { mockStorage.delete(key); },
} }));
jest.mock('@/lib/observability/reportSink', () => ({ reportToSink: jest.fn() }));
jest.mock('@/lib/api/eventOfflineCheckin', () => ({ syncOfflineCheckinBatch: jest.fn() }));

import {
  reserveOfflineRegistration, getPendingOfflineRegistration, updatePendingOfflineRegistration,
  completeOfflineRegistration, purgeAllMobileOfflineCheckinData,
} from './eventOfflineCheckinStore';
import { STORAGE_KEYS } from './constants';

beforeEach(() => {
  mockFiles.clear(); mockStorage.clear(); jest.clearAllMocks();
  mockStorage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: 41 }));
  mockStorage.set(STORAGE_KEYS.TENANT_SLUG, 'community');
  mockWrite.mockImplementation(async (path: string, value: string) => { mockFiles.set(path, value); });
});

it('persists one encrypted request before returning and reuses it across reservations', async () => {
  const [first, second] = await Promise.all([reserveOfflineRegistration(91, 'Door'), reserveOfflineRegistration(91, 'Door')]);
  expect(second).toEqual(first);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(await getPendingOfflineRegistration(91)).toEqual(first);
  expect([...mockFiles.values()].join()).not.toContain('Door');
  await expect(reserveOfflineRegistration(91, 'Changed')).rejects.toThrow('unresolved');
});

it('encrypts the one-shot secret and refuses stale updates or completion', async () => {
  const first = await reserveOfflineRegistration(91, 'Door');
  const next = await updatePendingOfflineRegistration(first, {
    ...first, stage: 'activate', device: { id: 22, version: 1 }, secret: 'nxd1_private_test_secret',
  });
  expect(await getPendingOfflineRegistration(91)).toEqual(next);
  expect([...mockFiles.values()].join()).not.toContain('nxd1_private_test_secret');
  await expect(updatePendingOfflineRegistration(first, first)).rejects.toThrow('changed');
  await expect(completeOfflineRegistration(first)).rejects.toThrow('changed');
  await completeOfflineRegistration(next);
  expect(await getPendingOfflineRegistration(91)).toBeNull();
  const fresh = await reserveOfflineRegistration(91, 'New door');
  expect(fresh.idempotencyKey).not.toBe(first.idempotencyKey);
  await expect(completeOfflineRegistration(next)).rejects.toThrow('changed');
  expect(await getPendingOfflineRegistration(91)).toEqual(fresh);
});

it('isolates both member and community identities', async () => {
  const first = await reserveOfflineRegistration(91, 'Door');
  mockStorage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: 42 }));
  expect(await getPendingOfflineRegistration(91)).toBeNull();
  await expect(updatePendingOfflineRegistration(first, first)).rejects.toThrow('changed');
  mockStorage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: 41 }));
  mockStorage.set(STORAGE_KEYS.TENANT_SLUG, 'other');
  expect(await getPendingOfflineRegistration(91)).toBeNull();
  mockStorage.set(STORAGE_KEYS.TENANT_SLUG, 'community');
  expect(await getPendingOfflineRegistration(91)).toEqual(first);
});

it('fails reservation when persistence fails and does not claim a saved request', async () => {
  mockWrite.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(reserveOfflineRegistration(91, 'Door')).rejects.toThrow('disk unavailable');
  expect(await getPendingOfflineRegistration(91)).toBeNull();
});

it('restores a persisted request after the store module is recreated', async () => {
  const first = await reserveOfflineRegistration(91, 'Door');
  let reloaded!: typeof import('./eventOfflineCheckinStore');
  jest.isolateModules(() => { reloaded = require('./eventOfflineCheckinStore'); });
  expect(await reloaded.getPendingOfflineRegistration(91)).toEqual(first);
  expect((await reloaded.reserveOfflineRegistration(91, 'Door')).idempotencyKey).toBe(first.idempotencyKey);
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('preserves the prior step if saving a returned secret fails', async () => {
  const first = await reserveOfflineRegistration(91, 'Door');
  mockWrite.mockImplementationOnce(async (path: string) => {
    mockFiles.set(path, 'partial file');
    throw new Error('disk full');
  });
  await expect(updatePendingOfflineRegistration(first, {
    ...first, stage: 'activate', device: { id: 22, version: 1 }, secret: 'nxd1_private_test_secret',
  })).rejects.toThrow('disk full');
  expect(await getPendingOfflineRegistration(91)).toEqual(first);
});

it('rejects corrupted pending data instead of registering a replacement', async () => {
  await reserveOfflineRegistration(91, 'Door');
  const path = [...mockFiles.keys()][0];
  mockFiles.set(path, 'corrupt');
  await expect(reserveOfflineRegistration(91, 'Door')).rejects.toThrow();
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('includes pending records in logout cleanup even when their write is in flight', async () => {
  let finish!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  mockWrite.mockImplementationOnce(async (path: string, value: string) => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    mockFiles.set(path, value);
  });
  const pending = reserveOfflineRegistration(91, 'Door').then(() => 'saved', () => 'cancelled');
  await writing;
  const cleanup = purgeAllMobileOfflineCheckinData();
  finish();
  await cleanup;
  expect(await pending).toBe('cancelled');
  expect(mockFiles.size).toBe(0);
  expect(mockStorage.has('nexus_event_checkin_encryption_key_v1')).toBe(false);
});
