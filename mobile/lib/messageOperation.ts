// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export interface MessageOperation { storageKey: string; key: string; createdAt: number }

const reservations = new Map<string, Promise<MessageOperation>>();
const completedKeys = new Set<string>();
const storageWrites = new Map<string, Promise<void>>();

function withStorage<T>(storageKey: string, action: () => Promise<T>): Promise<T> {
  const result = (storageWrites.get(storageKey) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  storageWrites.set(storageKey, settled);
  void settled.then(() => {
    if (storageWrites.get(storageKey) === settled) storageWrites.delete(storageKey);
  });
  return result;
}

/** Persist one identity for an exact message intent before any bytes are sent. */
export async function reserveMessageOperation(intent: string): Promise<MessageOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Message identity unavailable');

  const forOriginalIdentity = async (pending: Promise<MessageOperation>): Promise<MessageOperation> => {
    const operation = await pending;
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) {
      throw new Error('Message identity changed before send');
    }
    return operation;
  };

  const identity = JSON.stringify([tenant, user.id, intent]);
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, identity);
  const storageKey = `nexus_message_operation_${hash}`;
  const existing = reservations.get(storageKey);
  if (existing) return forOriginalIdentity(existing);

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as MessageOperation & { completed?: boolean };
      if (saved.completed || completedKeys.has(saved.key)) {
        const next = { storageKey, key: mutationIdempotencyKey('mobile-message'), createdAt: Date.now() };
        await SecureStore.setItemAsync(storageKey, JSON.stringify(next));
        completedKeys.delete(saved.key);
        return next;
      }
      if (!saved.key || !Number.isFinite(saved.createdAt)) throw new Error('Message retry identity is unreadable');
      return { storageKey, key: saved.key, createdAt: saved.createdAt };
    }

    const operation = { storageKey, key: mutationIdempotencyKey('mobile-message'), createdAt: Date.now() };
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

/** A confirmed initial or replay response closes the durable attempt. */
export async function completeMessageOperation(operation: MessageOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as MessageOperation).key !== operation.key) {
        completedKeys.delete(operation.key);
        return;
      }
    } catch {
      return;
    }
    try {
      await SecureStore.deleteItemAsync(operation.storageKey);
      completedKeys.delete(operation.key);
    } catch {
      try {
        await SecureStore.setItemAsync(operation.storageKey, JSON.stringify({ ...operation, completed: true }));
        completedKeys.delete(operation.key);
      } catch {
        // The server already confirmed the send. In-process state prevents an
        // immediate duplicate; a retained record replays the same server receipt.
      }
    }
  });
}
