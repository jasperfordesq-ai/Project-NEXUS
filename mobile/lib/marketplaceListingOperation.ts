// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export interface MarketplaceListingOperation { storageKey: string; key: string; createdAt: number }

const reservations = new Map<string, Promise<MarketplaceListingOperation>>();
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

export async function reserveMarketplaceListingOperation(intent: string): Promise<MarketplaceListingOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Marketplace listing identity unavailable');

  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, intent]));
  const storageKey = `nexus_marketplace_listing_operation_${hash}`;
  const pending = reservations.get(storageKey);
  if (pending) return pending;

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as MarketplaceListingOperation & { completed?: boolean };
      if (!saved.completed && !completedKeys.has(saved.key) && saved.key && Number.isFinite(saved.createdAt)) {
        return { storageKey, key: saved.key, createdAt: saved.createdAt };
      }
    }
    const operation = { storageKey, key: mutationIdempotencyKey('mobile-marketplace-listing'), createdAt: Date.now() };
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
      throw new Error('Marketplace listing identity changed before save');
    }
    return operation;
  } finally {
    reservations.delete(storageKey);
  }
}

export async function completeMarketplaceListingOperation(operation: MarketplaceListingOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as MarketplaceListingOperation).key !== operation.key) {
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
        // The server confirmed success. The retained record may safely replay;
        // in-process state gives an immediate new intent a fresh operation key.
      }
    }
  });
}
