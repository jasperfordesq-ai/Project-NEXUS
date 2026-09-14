// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export interface PodcastCreationOperation { storageKey: string; key: string; createdAt: number }

const reservations = new Map<string, Promise<PodcastCreationOperation>>();
const completedKeys = new Set<string>();
const writes = new Map<string, Promise<void>>();

function withStorage<T>(storageKey: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(storageKey) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(storageKey, settled);
  void settled.then(() => { if (writes.get(storageKey) === settled) writes.delete(storageKey); });
  return result;
}

export async function reservePodcastCreationOperation(intent: string): Promise<PodcastCreationOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Podcast creation identity unavailable');

  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, intent]));
  const storageKey = `nexus_podcast_creation_${hash}`;
  const pending = reservations.get(storageKey);
  if (pending) return pending;

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as PodcastCreationOperation & { completed?: boolean };
      if (!saved.completed && !completedKeys.has(saved.key) && saved.key && Number.isFinite(saved.createdAt)) {
        return { storageKey, key: saved.key, createdAt: saved.createdAt };
      }
    }
    const operation = { storageKey, key: mutationIdempotencyKey('mobile-podcast-create'), createdAt: Date.now() };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(operation));
    return operation;
  });
  reservations.set(storageKey, reservation);
  try {
    const operation = await reservation;
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) {
      throw new Error('Podcast creation identity changed before save');
    }
    return operation;
  } finally {
    reservations.delete(storageKey);
  }
}

export async function completePodcastCreationOperation(operation: PodcastCreationOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as PodcastCreationOperation).key !== operation.key) {
        completedKeys.delete(operation.key);
        return;
      }
    } catch { return; }
    try {
      await SecureStore.deleteItemAsync(operation.storageKey);
      completedKeys.delete(operation.key);
    } catch {
      try {
        await SecureStore.setItemAsync(operation.storageKey, JSON.stringify({ ...operation, completed: true }));
        completedKeys.delete(operation.key);
      } catch {
        // The confirmed server receipt makes replay safe. In-process state still
        // gives an immediate new creation a fresh operation key.
      }
    }
  });
}
