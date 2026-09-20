// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { digestStringAsync, randomUUID } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { acknowledgeMarketplaceCheckout, reserveMarketplaceCheckout, reviseMarketplaceCheckout } from './marketplaceCheckoutOperation';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');

const records = new Map<string, string>();
const identity = { userId: 99, tenantSlug: 'hour-timebank' };
const payload = { listing_id: 9, quantity: 1, payment_method: 'cash' as const };
beforeEach(() => {
  jest.resetAllMocks();
  records.clear();
  let sequence = 0;
  jest.mocked(randomUUID).mockImplementation(() => `uuid-${++sequence}`);
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm, value) => value);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 99 });
  jest.mocked(storage.get).mockResolvedValue('hour-timebank');
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => records.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { records.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { records.delete(key); });
});

it('recovers the persisted identity and original terms after a new reservation', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  const retry = await reserveMarketplaceCheckout(identity, { ...payload, payment_method: 'time_credits' });
  expect(first.recovered).toBe(false);
  expect(retry).toEqual({ operation: first.operation, recovered: true });
  expect(retry.operation.payload.payment_method).toBe('cash');
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

it('serializes simultaneous reservations without overwriting the purchase identity', async () => {
  const results = await Promise.all([
    reserveMarketplaceCheckout(identity, payload), reserveMarketplaceCheckout(identity, payload),
  ]);
  expect(results[0].operation.key).toBe(results[1].operation.key);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

it('recovers a record from an earlier process without an in-memory reservation', async () => {
  const storageKey = `nexus_marketplace_checkout_${JSON.stringify(['hour-timebank', 99, 9])}`;
  const previous = { storageKey, key: 'previous-process-purchase', payload };
  records.set(storageKey, JSON.stringify(previous));
  expect(await reserveMarketplaceCheckout(identity, payload)).toEqual({ operation: previous, recovered: true });
  expect(randomUUID).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it('creates a new purchase only after the previous result is acknowledged', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  await acknowledgeMarketplaceCheckout(first.operation);
  const second = await reserveMarketplaceCheckout(identity, payload);
  expect(second.operation.key).not.toBe(first.operation.key);
  await acknowledgeMarketplaceCheckout(first.operation);
  expect((await reserveMarketplaceCheckout(identity, payload)).operation.key).toBe(second.operation.key);
});

it('retains recovery when acknowledgement storage is unavailable', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Locked'));
  await expect(acknowledgeMarketplaceCheckout(first.operation)).rejects.toThrow('Locked');
  expect((await reserveMarketplaceCheckout(identity, payload)).operation.key).toBe(first.operation.key);
});

it('fails before returning an intent when secure persistence fails', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Locked'));
  await expect(reserveMarketplaceCheckout(identity, payload)).rejects.toThrow('Locked');
  expect(records.size).toBe(0);
});

it('refuses corrupt recovery rather than replacing it with a new purchase', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  records.set(first.operation.storageKey, '{broken');
  await expect(reserveMarketplaceCheckout(identity, payload)).rejects.toThrow();
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

it('separates different members and communities', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  jest.mocked(storage.getJson).mockResolvedValue({ id: 100 });
  const second = await reserveMarketplaceCheckout({ ...identity, userId: 100 }, payload);
  jest.mocked(storage.get).mockResolvedValue('another-community');
  const third = await reserveMarketplaceCheckout({ userId: 100, tenantSlug: 'another-community' }, payload);
  expect(new Set([first, second, third].map(result => result.operation.storageKey)).size).toBe(3);
});

it('refuses a reservation if account replacement occurs during persistence', async () => {
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
    records.set(key, value);
    jest.mocked(storage.getJson).mockResolvedValue({ id: 100 });
  });
  await expect(reserveMarketplaceCheckout(identity, payload)).rejects.toThrow('Checkout identity changed');
  expect(records.size).toBe(1);
});

it('corrects purchase choices while retaining the original durable key', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  const revised = await reviseMarketplaceCheckout(identity, first.operation, { ...payload, payment_method: 'time_credits' });
  expect(revised.key).toBe(first.operation.key);
  expect((await reserveMarketplaceCheckout(identity, payload)).operation.payload.payment_method).toBe('time_credits');
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

it('cannot revise another account or listing reservation', async () => {
  const first = await reserveMarketplaceCheckout(identity, payload);
  await expect(reviseMarketplaceCheckout(identity, first.operation, { ...payload, listing_id: 10 })).rejects.toThrow();
  jest.mocked(storage.getJson).mockResolvedValue({ id: 100 });
  await expect(reviseMarketplaceCheckout({ ...identity, userId: 100 }, first.operation, payload)).rejects.toThrow();
});
