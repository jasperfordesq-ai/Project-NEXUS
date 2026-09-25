// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export interface FederationMessageCreationOperation { storageKey: string; key: string; createdAt: number }
const reservations = new Map<string, Promise<FederationMessageCreationOperation>>();
const completed = new Set<string>();
const writes = new Map<string, Promise<void>>();

function withStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}

export async function reserveFederationMessageCreationOperation(intent: string): Promise<FederationMessageCreationOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Federation message creation identity unavailable');

  const forOriginalIdentity = async (
    pending: Promise<FederationMessageCreationOperation>,
  ): Promise<FederationMessageCreationOperation> => {
    const operation = await pending;
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) {
      throw new Error('Federation message creation identity changed before save');
    }
    return operation;
  };

  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, intent]));
  const storageKey = `nexus_federation_message_creation_${hash}`;
  const pending = reservations.get(storageKey);
  if (pending) return forOriginalIdentity(pending);

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as FederationMessageCreationOperation & { completed?: boolean };
      if (!saved.completed && !completed.has(saved.key) && saved.key && Number.isFinite(saved.createdAt)) {
        return { storageKey, key: saved.key, createdAt: saved.createdAt };
      }
    }
    const operation = {
      storageKey,
      key: mutationIdempotencyKey('mobile-federation-message-create'),
      createdAt: Date.now(),
    };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(operation));
    return operation;
  });
  reservations.set(storageKey, reservation);
  try {
    return await forOriginalIdentity(reservation);
  } finally {
    reservations.delete(storageKey);
  }
}

export async function completeFederationMessageCreationOperation(
  operation: FederationMessageCreationOperation,
): Promise<void> {
  completed.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as FederationMessageCreationOperation).key !== operation.key) {
        completed.delete(operation.key);
        return;
      }
    } catch { return; }
    try {
      await SecureStore.deleteItemAsync(operation.storageKey);
      completed.delete(operation.key);
    } catch {
      try {
        await SecureStore.setItemAsync(operation.storageKey, JSON.stringify({ ...operation, completed: true }));
        completed.delete(operation.key);
      } catch { /* The durable server receipt keeps a replay safe. */ }
    }
  });
}
