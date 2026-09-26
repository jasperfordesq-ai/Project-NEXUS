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

export type GroupJoinRequestDecisionAction = 'accept' | 'reject';

export interface GroupJoinRequestDecisionOperation {
  storageKey: string;
  key: string;
  groupId: number;
  requesterId: number;
  action: GroupJoinRequestDecisionAction;
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
  if (!user?.id || !tenant || groupId <= 0) throw new Error('Group join decision identity unavailable');
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([tenant, user.id, groupId]));
  return {
    userId: user.id,
    tenant,
    storageKey: `nexus_group_join_decision_${hash}`,
    draftScope: {
      kind: 'group-join-decision', tenantId: tenant, userId: user.id, contextId: groupId,
    } satisfies CreationDraftScope,
  };
}

function parse(savedValue: unknown, storageKey: string, groupId: number): GroupJoinRequestDecisionOperation | null {
  if (savedValue === null) return null;
  const saved = savedValue as (GroupJoinRequestDecisionOperation & { completed?: boolean }) | null;
  if (!saved || saved.storageKey !== storageKey) throw new Error('Group join decision record is unreadable');
  if (saved.completed === true) return null;
  if (
    !saved.key
    || saved.groupId !== groupId
    || !Number.isInteger(saved.requesterId)
    || saved.requesterId <= 0
    || !['accept', 'reject'].includes(saved.action)
    || !Number.isFinite(saved.createdAt)
  ) {
    throw new Error('Group join decision record is unreadable');
  }
  return saved;
}

export async function loadGroupJoinRequestDecisionOperation(
  groupId: number,
): Promise<GroupJoinRequestDecisionOperation | null> {
  const current = await scope(groupId);
  return parse(
    await loadCreationDraft(current.draftScope, { required: true }),
    current.storageKey,
    groupId,
  );
}

export async function reserveGroupJoinRequestDecisionOperation(
  groupId: number,
  requesterId: number,
  action: GroupJoinRequestDecisionAction,
): Promise<GroupJoinRequestDecisionOperation> {
  const original = await scope(groupId);
  return withStorage(original.storageKey, async () => {
    const saved = parse(
      await loadCreationDraft(original.draftScope, { required: true }),
      original.storageKey,
      groupId,
    );
    if (saved) {
      if (saved.requesterId !== requesterId || saved.action !== action) {
        throw new Error('A pending group join decision must be retried before making another decision');
      }
      return saved;
    }
    if (!Number.isInteger(requesterId) || requesterId <= 0 || !['accept', 'reject'].includes(action)) {
      throw new Error('Invalid group join decision');
    }
    const current = await scope(groupId);
    if (current.userId !== original.userId || current.tenant !== original.tenant || current.storageKey !== original.storageKey) {
      throw new Error('Group join decision identity changed before save');
    }
    const operation: GroupJoinRequestDecisionOperation = {
      storageKey: original.storageKey,
      key: mutationIdempotencyKey('mobile-group-join-decision'),
      groupId,
      requesterId,
      action,
      createdAt: Date.now(),
    };
    if (!await saveCreationDraft(original.draftScope, operation)) {
      throw new Error('Group join decision record could not be saved');
    }
    return operation;
  });
}

async function clearMatching(operation: GroupJoinRequestDecisionOperation): Promise<void> {
  await withStorage(operation.storageKey, async () => {
    const current = await scope(operation.groupId);
    if (current.storageKey !== operation.storageKey) throw new Error('Group join decision identity changed before cleanup');
    const saved = parse(
      await loadCreationDraft(current.draftScope, { required: true }),
      operation.storageKey,
      operation.groupId,
    );
    if (!saved || saved.key !== operation.key) return;
    if (!await clearCreationDraft(current.draftScope)) throw new Error('Group join decision record could not be cleared');
  });
}

export const completeGroupJoinRequestDecisionOperation = clearMatching;
export const discardGroupJoinRequestDecisionOperation = clearMatching;
