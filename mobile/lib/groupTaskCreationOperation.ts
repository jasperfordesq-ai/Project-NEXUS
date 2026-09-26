// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import {
  clearCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  type CreationDraftScope,
} from '@/lib/creationDraftStore';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import type { GroupTaskPriority } from '@/lib/api/groups';

export interface GroupTaskCreationDraft {
  title: string;
  description: string;
  priority: GroupTaskPriority;
  assignedTo: number | null;
  dueDate: string;
}

export interface GroupTaskCreationOperation {
  storageKey: string;
  key: string;
  groupId: number;
  intent: string;
  draft: GroupTaskCreationDraft;
  createdAt: number;
}

const writes = new Map<string, Promise<void>>();

function withStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}

async function scope(groupId: number) {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant || groupId <= 0) throw new Error('Group task creation identity unavailable');
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, groupId]));
  return {
    userId: user.id,
    tenant,
    storageKey: `nexus_group_task_creation_${hash}`,
    draftScope: { kind: 'group-task', tenantId: tenant, userId: user.id, contextId: groupId } satisfies CreationDraftScope,
  };
}

function parse(savedValue: unknown, storageKey: string, groupId: number): GroupTaskCreationOperation | null {
  if (savedValue === null) return null;
  const saved = savedValue as (GroupTaskCreationOperation & { completed?: boolean }) | null;
  if (!saved || saved.storageKey !== storageKey) throw new Error('Group task creation record is unreadable');
  if (saved.completed === true) return null;
  const draft = saved.draft;
  const validPriority = ['low', 'medium', 'high', 'urgent'].includes(draft?.priority);
  const validAssignee = draft?.assignedTo === null
    || (Number.isInteger(draft?.assignedTo) && Number(draft.assignedTo) > 0);
  if (
    !saved.key
    || !saved.intent
    || saved.groupId !== groupId
    || !Number.isFinite(saved.createdAt)
    || typeof draft?.title !== 'string'
    || typeof draft?.description !== 'string'
    || typeof draft?.dueDate !== 'string'
    || !validPriority
    || !validAssignee
  ) {
    throw new Error('Group task creation record is unreadable');
  }
  return saved;
}

export async function loadGroupTaskCreationOperation(groupId: number): Promise<GroupTaskCreationOperation | null> {
  const { storageKey, draftScope } = await scope(groupId);
  return parse(await loadCreationDraft(draftScope, { required: true }), storageKey, groupId);
}

export async function reserveGroupTaskCreationOperation(
  groupId: number,
  intent: string,
  draft: GroupTaskCreationDraft,
): Promise<GroupTaskCreationOperation> {
  const original = await scope(groupId);
  return withStorage(original.storageKey, async () => {
    const saved = parse(await loadCreationDraft(original.draftScope, { required: true }), original.storageKey, groupId);
    if (saved) {
      if (saved.intent !== intent) throw new Error('A pending group task must be retried before creating a different task');
      return saved;
    }
    const current = await scope(groupId);
    if (current.userId !== original.userId || current.tenant !== original.tenant || current.storageKey !== original.storageKey) {
      throw new Error('Group task creation identity changed before save');
    }
    const operation: GroupTaskCreationOperation = {
      storageKey: original.storageKey,
      key: mutationIdempotencyKey('mobile-group-task-create'),
      groupId,
      intent,
      draft,
      createdAt: Date.now(),
    };
    if (!await saveCreationDraft(original.draftScope, operation)) {
      throw new Error('Group task creation record could not be saved');
    }
    return operation;
  });
}

export async function completeGroupTaskCreationOperation(operation: GroupTaskCreationOperation): Promise<void> {
  await withStorage(operation.storageKey, async () => {
    const current = await scope(operation.groupId);
    if (current.storageKey !== operation.storageKey) throw new Error('Group task creation identity changed before cleanup');
    const saved = parse(await loadCreationDraft(current.draftScope, { required: true }), operation.storageKey, operation.groupId);
    if (!saved || saved.key !== operation.key) return;
    if (!await clearCreationDraft(current.draftScope)) throw new Error('Group task creation record could not be cleared');
  });
}

export async function discardGroupTaskCreationOperation(operation: GroupTaskCreationOperation): Promise<void> {
  await withStorage(operation.storageKey, async () => {
    const current = await scope(operation.groupId);
    if (current.storageKey !== operation.storageKey) throw new Error('Group task creation identity changed before cleanup');
    const saved = parse(await loadCreationDraft(current.draftScope, { required: true }), operation.storageKey, operation.groupId);
    if (!saved || saved.key !== operation.key) return;
    if (!await clearCreationDraft(current.draftScope)) throw new Error('Group task creation record could not be cleared');
  });
}
