// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

export type CourseAuthoringResource = 'cohort' | 'section' | 'lesson' | 'quiz' | 'question';
export interface CourseAuthoringCreationOperation { storageKey: string; key: string; createdAt: number }

const reservations = new Map<string, Promise<CourseAuthoringCreationOperation>>();
const completed = new Set<string>();
const writes = new Map<string, Promise<void>>();

function withStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}

export async function reserveCourseAuthoringCreationOperation(
  resource: CourseAuthoringResource,
  courseId: number,
  intent: unknown,
): Promise<CourseAuthoringCreationOperation> {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant || !Number.isInteger(courseId) || courseId <= 0) {
    throw new Error('Course authoring identity unavailable');
  }

  const fingerprint = JSON.stringify([tenant, user.id, courseId, resource, intent]);
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, fingerprint);
  const storageKey = `nexus_course_authoring_${hash}`;
  const pending = reservations.get(storageKey);
  if (pending) return pending;

  const reservation = withStorage(storageKey, async () => {
    const raw = await SecureStore.getItemAsync(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as CourseAuthoringCreationOperation & { completed?: boolean };
      if (!saved.completed && !completed.has(saved.key) && saved.key && Number.isFinite(saved.createdAt)) {
        return { storageKey, key: saved.key, createdAt: saved.createdAt };
      }
    }
    const operation = {
      storageKey,
      key: mutationIdempotencyKey(`mobile-course-${resource}`),
      createdAt: Date.now(),
    };
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
      throw new Error('Course authoring identity changed before save');
    }
    return operation;
  } finally {
    reservations.delete(storageKey);
  }
}

export async function completeCourseAuthoringCreationOperation(
  operation: CourseAuthoringCreationOperation,
): Promise<void> {
  completed.add(operation.key);
  await withStorage(operation.storageKey, async () => {
    try {
      const raw = await SecureStore.getItemAsync(operation.storageKey);
      if (!raw || (JSON.parse(raw) as CourseAuthoringCreationOperation).key !== operation.key) {
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
