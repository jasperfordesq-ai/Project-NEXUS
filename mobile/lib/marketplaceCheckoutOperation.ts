// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import type { createMarketplaceOrder } from '@/lib/api/marketplace';

export type CheckoutPayload = Omit<Parameters<typeof createMarketplaceOrder>[0], 'idempotency_key'>;
export interface CheckoutIdentity { userId: number; tenantSlug: string }
export interface CheckoutOperation {
  storageKey: string;
  key: string;
  payload: CheckoutPayload;
}

// Serialize reservations and acknowledgements for one member/listing. The secure
// record, rather than this queue, owns recovery after process death.
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(key, result);
  void result.finally(() => {
    if (queues.get(key) === result) queues.delete(key);
  }).catch(() => undefined);
  return result;
}

async function assertIdentity(identity: CheckoutIdentity): Promise<void> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!identity.userId || !identity.tenantSlug || user?.id !== identity.userId || tenant !== identity.tenantSlug) {
    throw new Error('Checkout identity changed');
  }
}

async function checkoutStorageKey(identity: CheckoutIdentity, listingId: number): Promise<string> {
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
    JSON.stringify([identity.tenantSlug, identity.userId, listingId]));
  return `nexus_marketplace_checkout_${digest}`;
}

function parseOperation(raw: string, storageKey: string, listingId: number): CheckoutOperation {
  const saved = JSON.parse(raw) as CheckoutOperation;
  if (typeof saved.key !== 'string' || !saved.key || saved.storageKey !== storageKey || saved.payload?.listing_id !== listingId) {
    throw new Error('Invalid checkout recovery record');
  }
  return saved;
}

export async function readMarketplaceCheckout(identity: CheckoutIdentity, listingId: number): Promise<CheckoutOperation | null> {
  await assertIdentity(identity);
  const storageKey = await checkoutStorageKey(identity, listingId);
  return serialize(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    await assertIdentity(identity);
    return raw === null ? null : parseOperation(raw, storageKey, listingId);
  });
}

/** Return the ORIGINAL unresolved payload, even if the newly selected terms differ.
 * The caller must explicitly offer recovery of those terms, never silently send
 * changed terms under a new key or automatically start another payment.
 */
export async function reserveMarketplaceCheckout(
  identity: CheckoutIdentity,
  payload: CheckoutPayload,
): Promise<{ operation: CheckoutOperation; recovered: boolean }> {
  await assertIdentity(identity);
  const storageKey = await checkoutStorageKey(identity, payload.listing_id);
  return serialize(storageKey, async () => {
    await assertIdentity(identity);
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw !== null) {
      // Corrupt/unreadable recovery must fail closed, not create another purchase.
      const saved = parseOperation(raw, storageKey, payload.listing_id);
      await assertIdentity(identity);
      return { operation: saved, recovered: true };
    }
    const operation: CheckoutOperation = {
      storageKey,
      key: `mobile-marketplace-${randomUUID()}`,
      payload,
    };
    // Never send a purchase until the recovery identity is durably stored.
    await SecureStore.setItemAsync(storageKey, JSON.stringify(operation));
    await assertIdentity(identity);
    return { operation, recovered: false };
  });
}

/** Acknowledge only a known result that has been delivered to the current member.
 * If deletion fails, keep replay protection. Never rotate a key on a timer.
 */
export async function acknowledgeMarketplaceCheckout(operation: CheckoutOperation): Promise<void> {
  await serialize(operation.storageKey, async () => {
    const raw = await SecureStore.getItemAsync(operation.storageKey);
    if (raw !== null && (JSON.parse(raw) as CheckoutOperation).key === operation.key) {
      await SecureStore.deleteItemAsync(operation.storageKey);
    }
  });
}

/** Correct the original attempt without ever allocating a second purchase key. */
export async function reviseMarketplaceCheckout(
  identity: CheckoutIdentity, operation: CheckoutOperation, payload: CheckoutPayload,
): Promise<CheckoutOperation> {
  await assertIdentity(identity);
  const storageKey = await checkoutStorageKey(identity, payload.listing_id);
  if (storageKey !== operation.storageKey) throw new Error('Checkout identity changed');
  return serialize(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw === null) throw new Error('Checkout recovery changed');
    const saved = parseOperation(raw, storageKey, payload.listing_id);
    if (saved.key !== operation.key) throw new Error('Checkout recovery changed');
    const revised = { ...saved, payload };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(revised));
    await assertIdentity(identity);
    return revised;
  });
}
