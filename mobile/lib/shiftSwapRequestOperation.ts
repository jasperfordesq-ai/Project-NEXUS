// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export interface ShiftSwapRequestOperation { storageKey: string; key: string; createdAt: number }

const reservations = new Map<string, Promise<ShiftSwapRequestOperation>>();
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

export async function reserveShiftSwapRequestOperation(intent: string): Promise<ShiftSwapRequestOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Shift swap identity unavailable');

  const forOriginalIdentity = async (pending: Promise<ShiftSwapRequestOperation>): Promise<ShiftSwapRequestOperation> => {
    const operation = await pending;
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) throw new Error('Shift swap identity changed before save');
    return operation;
  };

  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, intent]));
  const storageKey = `nexus_shift_swap_request_${hash}`;
  const pending = reservations.get(storageKey);
  if (pending) return forOriginalIdentity(pending);

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as ShiftSwapRequestOperation & { completed?: boolean };
      if (!saved.completed && !completedKeys.has(saved.key) && saved.key && Number.isFinite(saved.createdAt)) {
        return { storageKey, key: saved.key, createdAt: saved.createdAt };
      }
    }

    const operation = { storageKey, key: mutationIdempotencyKey('mobile-shift-swap'), createdAt: Date.now() };
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

export async function completeShiftSwapRequestOperation(operation: ShiftSwapRequestOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as ShiftSwapRequestOperation).key !== operation.key) {
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
        // A confirmed server result can safely retain its replay tombstone.
      }
    }
  });
}
