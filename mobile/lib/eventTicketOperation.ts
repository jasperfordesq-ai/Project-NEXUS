// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';
import { STORAGE_KEYS } from '@/lib/constants';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export type EventTicketRequest = ['allocate', number, number, number] | ['cancel', number, number, number, string];
export interface EventTicketOperation { storageKey: string; key: string; createdAt: number; intent: string; newlyCreated?: boolean }
export class EventTicketOperationChangedError extends Error {
  constructor() {
    super('Ticket operation changed');
    this.name = 'EventTicketOperationChangedError';
  }
}
const writes = new Map<string, Promise<void>>();
const completedKeys = new Set<string>();

function withStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}

export function eventTicketRequest(intent: string): EventTicketRequest {
  const value: unknown = JSON.parse(intent);
  if (!Array.isArray(value) || !['allocate', 'cancel'].includes(value[0])
    || ![value[1], value[2], value[3]].every(item => Number.isInteger(item) && item > 0)
    || (value[0] === 'allocate' ? value.length !== 4
      : value.length !== 5 || typeof value[4] !== 'string' || !value[4].trim() || value[4].length > 500)) {
    throw new Error('Ticket operation request unreadable');
  }
  return value as EventTicketRequest;
}

function readRecord(raw: string, storageKey: string, legacyIntent?: string): EventTicketOperation & { completed?: boolean } {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object' || typeof saved.key !== 'string' || !saved.key
    || typeof saved.createdAt !== 'number' || !Number.isFinite(saved.createdAt)
    || (saved.completed !== undefined && typeof saved.completed !== 'boolean')) {
    throw new Error('Ticket operation record unreadable');
  }
  const intent = saved.intent ?? legacyIntent;
  if (typeof intent !== 'string') throw new Error('Ticket operation request unreadable');
  eventTicketRequest(intent);
  return { storageKey, key: saved.key, createdAt: saved.createdAt, intent, completed: saved.completed };
}

async function operationContext(eventId: number) {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant) throw new Error('Ticket operation identity unavailable');
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, eventId]));
  const storageKey = `nexus_event_ticket_pending_${hash}`;
  const checkIdentity = async () => {
    const [currentUser, currentTenant] = await Promise.all([
      storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
      storage.get(STORAGE_KEYS.TENANT_SLUG),
    ]);
    if (currentUser?.id !== user.id || currentTenant !== tenant) throw new Error('Ticket operation identity changed');
  };
  return { storageKey, userId: user.id, tenant, checkIdentity };
}

export async function getPendingEventTicketOperation(eventId: number): Promise<EventTicketOperation | null> {
  const context = await operationContext(eventId);
  const pending = await withStorage(context.storageKey, async () => {
    const raw = await SecureStore.getItemAsync(context.storageKey);
    if (raw === null) return null;
    const saved = readRecord(raw, context.storageKey);
    if (eventTicketRequest(saved.intent)[1] !== eventId) throw new Error('Ticket operation event mismatch');
    return saved.completed || completedKeys.has(saved.key) ? null : saved;
  });
  await context.checkIdentity();
  return pending;
}

/** One unresolved operation per event; never turn an edited request into another claim. */
export async function reserveEventTicketOperation(intent: string, expectedKey?: string): Promise<EventTicketOperation> {
  const request = eventTicketRequest(intent);
  const context = await operationContext(request[1]);
  const { storageKey } = context;
  const operation = await withStorage(storageKey, async () => {
    let previousCompletedKey: string | undefined;
    const raw = await SecureStore.getItemAsync(storageKey);
    if (expectedKey !== undefined) {
      if (raw === null) throw new EventTicketOperationChangedError();
      const saved = readRecord(raw, storageKey);
      if (saved.key !== expectedKey || saved.intent !== intent || saved.completed || completedKeys.has(saved.key)) {
        throw new EventTicketOperationChangedError();
      }
      return saved;
    }
    if (raw !== null) {
      const saved = readRecord(raw, storageKey);
      if (!saved.completed && !completedKeys.has(saved.key)) {
        if (saved.intent !== intent) throw new Error('Ticket operation unresolved');
        return saved;
      }
      previousCompletedKey = saved.key;
    } else {
      // Migrate a matching record from the earlier, unreleased per-request format.
      const legacyHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([context.tenant, context.userId, intent]));
      const legacy = await SecureStore.getItemAsync(`nexus_event_ticket_operation_${legacyHash}`);
      if (legacy !== null) {
        const saved = readRecord(legacy, storageKey, intent);
        if (saved.intent !== intent) throw new Error('Ticket operation request mismatch');
        if (!saved.completed && !completedKeys.has(saved.key)) {
          await SecureStore.setItemAsync(storageKey, JSON.stringify(saved));
          return saved;
        }
      }
    }
    const next = { storageKey, key: mutationIdempotencyKey('mobile-event-ticket'), createdAt: Date.now(), intent };
    await SecureStore.setItemAsync(storageKey, JSON.stringify(next));
    if (previousCompletedKey) completedKeys.delete(previousCompletedKey);
    return { ...next, newlyCreated: true };
  });
  await context.checkIdentity();
  return operation;
}

/** Record a confirmed success or definite first-attempt refusal, preserving newer keys. */
export async function completeEventTicketOperation(operation: EventTicketOperation): Promise<void> {
  completedKeys.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as EventTicketOperation).key !== operation.key) {
        completedKeys.delete(operation.key);
        return;
      }
      await SecureStore.setItemAsync(operation.storageKey, JSON.stringify({ ...operation, completed: true }));
      completedKeys.delete(operation.key);
    } catch {
      // Success is already confirmed. Retain the original record for conservative
      // replay after restart, and remember completion for this process.
    }
  });
}
