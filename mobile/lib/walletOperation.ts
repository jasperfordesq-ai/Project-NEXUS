// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import i18n from 'i18next';
import { storage } from '@/lib/storage';
import { STORAGE_KEYS } from '@/lib/constants';
import { ApiResponseError } from '@/lib/api/client';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import { getWalletOperationStatus, type WalletOperationKind } from '@/lib/api/wallet';

export interface WalletOperation { storageKey: string; key: string; createdAt: number }
const reservations = new Map<string, Promise<WalletOperation>>();
const completedKeys = new Set<string>();
const storageWrites = new Map<string, Promise<void>>();

function withOperationStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (storageWrites.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  storageWrites.set(key, settled);
  void settled.then(() => {
    if (storageWrites.get(key) === settled) storageWrites.delete(key);
  });
  return result;
}

/** Persist BEFORE sending; an unreadable store must never manufacture a second debit. */
export async function reserveWalletOperation(kind: WalletOperationKind, intent: string): Promise<WalletOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Wallet identity unavailable');
  const forOriginalIdentity = async (pending: Promise<WalletOperation>): Promise<WalletOperation> => {
    const operation = await pending;
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) {
      // Keep the original account's retry record; a changed session must not
      // continue this submission with another account's credentials.
      throw new ApiResponseError(0, i18n.t('wallet:actions.unresolvedOperation'));
    }
    return operation;
  };
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, kind, intent]));
  const storageKey = `nexus_wallet_operation_${hash}`;
  const existing = reservations.get(storageKey);
  if (existing) return forOriginalIdentity(existing);
  const reservation = withOperationStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as WalletOperation & { completed?: boolean };
      if (saved.completed || completedKeys.has(saved.key)) {
        const next = { storageKey, key: mutationIdempotencyKey('mobile-wallet'), createdAt: Date.now() };
        // A new intentional operation still must be durable before it can send.
        await SecureStore.setItemAsync(storageKey, JSON.stringify(next));
        completedKeys.delete(saved.key);
        return next;
      }
      if (!saved.key || !Number.isFinite(saved.createdAt)) {
        throw new ApiResponseError(0, i18n.t('wallet:actions.unresolvedOperation'));
      }
      // Older servers used expiring cache receipts. Beyond that window only a
      // positive durable-ledger check permits replay, always with the SAME key.
      if (Date.now() - saved.createdAt >= 23 * 60 * 60 * 1000) {
        let confirmed = false;
        try {
          const parsedIntent: unknown = JSON.parse(intent);
          if (Array.isArray(parsedIntent)) {
            const result = await getWalletOperationStatus(kind, saved.key, parsedIntent);
            confirmed = result.data.status === 'confirmed';
          }
        } catch {
          // Offline, old API, or unreadable response: preserve the unresolved key.
        }
        if (!confirmed) throw new ApiResponseError(0, i18n.t('wallet:actions.unresolvedOperation'));
      }
      return { ...saved, storageKey };
    }
    const operation = { storageKey, key: mutationIdempotencyKey('mobile-wallet'), createdAt: Date.now() };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(operation));
    return operation;
  });
  reservations.set(storageKey, reservation);
  try { return await forOriginalIdentity(reservation); }
  finally { reservations.delete(storageKey); }
}

/** Only a confirmed API success ends an operation. Failures retain its retry identity. */
export async function completeWalletOperation(operation: WalletOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withOperationStorage(operation.storageKey, async () => {
    // A duplicate response may arrive after the next intentional transfer began.
    // Never remove or replace that newer operation's durable retry identity.
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as WalletOperation).key !== operation.key) {
        completedKeys.delete(operation.key);
        return;
      }
    } catch {
      // The debit is confirmed, but an unreadable record cannot safely be changed.
      return;
    }
    try {
      await SecureStore.deleteItemAsync(operation.storageKey);
      completedKeys.delete(operation.key);
    } catch {
      try {
        // A tombstone lets the next process distinguish success from an uncertain send.
        await SecureStore.setItemAsync(operation.storageKey, JSON.stringify({ ...operation, completed: true }));
        completedKeys.delete(operation.key);
      } catch {
        // The API already confirmed success. Never turn a storage outage into a
        // failed-transfer prompt. Keep the in-process completion; after a restart,
        // the retained original key conservatively replays rather than debits twice.
      }
    }
  });
}

