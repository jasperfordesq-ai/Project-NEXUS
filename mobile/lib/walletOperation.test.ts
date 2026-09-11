// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { reserveWalletOperation, completeWalletOperation } from './walletOperation';
import { getWalletOperationStatus } from '@/lib/api/wallet';
jest.mock('@/lib/api/wallet', () => ({ getWalletOperationStatus: jest.fn() }));
const mockIdentity = { user: 1, tenant: 'one' };
jest.mock('@/lib/storage', () => ({ storage: {
  get: async () => mockIdentity.tenant,
  getJson: async () => ({ id: mockIdentity.user }),
} }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_: unknown, text: string) => require('crypto').createHash('sha256').update(text).digest('hex'),
}));
const persisted = new Map<string, string>();
beforeEach(() => {
  jest.clearAllMocks();
  persisted.clear();
  mockIdentity.user = 1;
  mockIdentity.tenant = 'one';
  jest.mocked(getWalletOperationStatus).mockResolvedValue({ data: { status: 'unknown' } });
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persisted.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persisted.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { persisted.delete(key); });
});

it.each(['transfer', 'federation'] as const)('retains an unresolved %s key across module reload and starts a new operation after confirmation', async (kind) => {
  const intent = kind === 'federation' ? '[1,5,2,"help"]' : '[1,2,"help"]';
  const first = await reserveWalletOperation(kind, intent);
  let reloaded!: typeof import('./walletOperation');
  jest.isolateModules(() => { reloaded = require('./walletOperation'); });
  expect((await reloaded.reserveWalletOperation(kind, intent)).key).toBe(first.key);
  await completeWalletOperation(first);
  expect((await reserveWalletOperation(kind, intent)).key).not.toBe(first.key);
});

it('isolates account, community, operation kind and changed intent', async () => {
  const keys = [(await reserveWalletOperation('transfer', 'same')).key];
  mockIdentity.user = 2;
  keys.push((await reserveWalletOperation('transfer', 'same')).key);
  mockIdentity.tenant = 'two';
  keys.push((await reserveWalletOperation('transfer', 'same')).key);
  keys.push((await reserveWalletOperation('donation', 'same')).key);
  keys.push((await reserveWalletOperation('donation', 'different')).key);
  expect(new Set(keys).size).toBe(5);
});

it('does not let a late duplicate success erase the next intentional transfer retry key', async () => {
  const first = await reserveWalletOperation('transfer', 'repeated intent');
  await completeWalletOperation(first);
  const second = await reserveWalletOperation('transfer', 'repeated intent');
  await completeWalletOperation(first);
  let reloaded!: typeof import('./walletOperation');
  jest.isolateModules(() => { reloaded = require('./walletOperation'); });
  expect((await reloaded.reserveWalletOperation('transfer', 'repeated intent')).key).toBe(second.key);
});

it('persists completion when deletion fails so an intentional repeat gets a new key after reload', async () => {
  const first = await reserveWalletOperation('transfer', 'cleanup failure');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Delete unavailable'));
  await expect(completeWalletOperation(first)).resolves.toBeUndefined();
  let reloaded!: typeof import('./walletOperation');
  jest.isolateModules(() => { reloaded = require('./walletOperation'); });
  expect((await reloaded.reserveWalletOperation('transfer', 'cleanup failure')).key).not.toBe(first.key);
});

it('waits for delayed cleanup before persisting the next identical intent', async () => {
  const first = await reserveWalletOperation('transfer', 'overlapping cleanup');
  let finishDelete!: () => void;
  const deleting = new Promise<void>(resolve => { finishDelete = resolve; });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async key => {
    await deleting;
    persisted.delete(key);
  });
  const completion = completeWalletOperation(first);
  const reservation = reserveWalletOperation('transfer', 'overlapping cleanup');
  finishDelete();
  await completion;
  const second = await reservation;
  expect(second.key).not.toBe(first.key);
  expect(JSON.parse(persisted.get(second.storageKey)!).key).toBe(second.key);
});

it('does not overwrite an unreadable record when success arrives', async () => {
  const first = await reserveWalletOperation('transfer', 'unreadable completion');
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Locked'));
  await expect(completeWalletOperation(first)).resolves.toBeUndefined();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(JSON.parse(persisted.get(first.storageKey)!).key).toBe(first.key);
  expect((await reserveWalletOperation('transfer', 'unreadable completion')).key).not.toBe(first.key);
});

it('keeps success during a total cleanup outage but refuses a new send until it can persist', async () => {
  const first = await reserveWalletOperation('transfer', 'storage outage');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Delete unavailable'));
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Write unavailable'));
  await expect(completeWalletOperation(first)).resolves.toBeUndefined();
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Still unavailable'));
  await expect(reserveWalletOperation('transfer', 'storage outage')).rejects.toThrow('Still unavailable');
  expect((await reserveWalletOperation('transfer', 'storage outage')).key).not.toBe(first.key);
});

it('refuses to send if encrypted persistence fails or the server replay window has elapsed', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Disk full'));
  await expect(reserveWalletOperation('transfer', 'same')).rejects.toThrow('Disk full');
  const saved = await reserveWalletOperation('transfer', 'same');
  persisted.set(saved.storageKey, JSON.stringify({ ...saved, createdAt: Date.now() - 24 * 60 * 60 * 1000 }));
  await expect(reserveWalletOperation('transfer', 'same')).rejects.toThrow('earlier transfer');
  expect(persisted.has(saved.storageKey)).toBe(true);
});

it.each(['transfer', 'federation'] as const)('recovers an expired confirmed %s operation using its original retry identity', async (kind) => {
  const intent = kind === 'federation' ? '[2,5,3,"help"]' : '[2,3,"help"]';
  const saved = await reserveWalletOperation(kind, intent);
  persisted.set(saved.storageKey, JSON.stringify({ ...saved, createdAt: Date.now() - 48 * 60 * 60 * 1000 }));
  jest.mocked(getWalletOperationStatus).mockResolvedValueOnce({ data: { status: 'confirmed' } });
  expect((await reserveWalletOperation(kind, intent)).key).toBe(saved.key);
  expect(getWalletOperationStatus).toHaveBeenCalledWith(kind, saved.key, JSON.parse(intent));
  expect(JSON.parse(persisted.get(saved.storageKey)!).key).toBe(saved.key);
});

it.each(['unknown', 'offline'])('keeps an expired %s operation blocked without replacing its key', async (state) => {
  const intent = '[2,3,"help"]';
  const saved = await reserveWalletOperation('transfer', intent);
  persisted.set(saved.storageKey, JSON.stringify({ ...saved, createdAt: Date.now() - 48 * 60 * 60 * 1000 }));
  if (state === 'offline') jest.mocked(getWalletOperationStatus).mockRejectedValueOnce(new Error('Offline'));
  await expect(reserveWalletOperation('transfer', intent)).rejects.toThrow('earlier transfer');
  expect(JSON.parse(persisted.get(saved.storageKey)!).key).toBe(saved.key);
});

it.each(['user', 'tenant'] as const)('rejects recovery when the %s changes while confirmation is pending', async (identityField) => {
  const intent = '[2,3,"help"]';
  const saved = await reserveWalletOperation('transfer', intent);
  persisted.set(saved.storageKey, JSON.stringify({ ...saved, createdAt: Date.now() - 48 * 60 * 60 * 1000 }));
  jest.mocked(getWalletOperationStatus).mockImplementationOnce(async () => {
    if (identityField === 'user') mockIdentity.user = 9;
    else mockIdentity.tenant = 'another-community';
    return { data: { status: 'confirmed' } };
  });
  await expect(reserveWalletOperation('transfer', intent)).rejects.toThrow();
  expect(JSON.parse(persisted.get(saved.storageKey)!).key).toBe(saved.key);
});
