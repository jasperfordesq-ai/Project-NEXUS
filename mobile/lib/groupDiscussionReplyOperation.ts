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

export interface GroupDiscussionReplyOperation {
  storageKey: string;
  key: string;
  groupId: number;
  discussionId: number;
  content: string;
  createdAt: number;
}

export const GROUP_DISCUSSION_REPLY_MAX_BYTES = 60000;

export function isGroupDiscussionReplyContentValid(content: string): boolean {
  const normalized = content.trim();
  return normalized.length > 0
    && new TextEncoder().encode(normalized).length <= GROUP_DISCUSSION_REPLY_MAX_BYTES;
}

const writes = new Map<string, Promise<void>>();

function withStorage<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => { if (writes.get(key) === settled) writes.delete(key); });
  return result;
}

async function scope(groupId: number, discussionId: number) {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant || groupId <= 0 || discussionId <= 0) {
    throw new Error('Group discussion reply identity unavailable');
  }
  const contextId = `${groupId}:${discussionId}`;
  const hash = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([tenant, user.id, groupId, discussionId]),
  );
  return {
    userId: user.id,
    tenant,
    storageKey: `nexus_group_discussion_reply_${hash}`,
    draftScope: {
      kind: 'group-discussion-reply', tenantId: tenant, userId: user.id, contextId,
    } satisfies CreationDraftScope,
  };
}

function parse(
  savedValue: unknown,
  storageKey: string,
  groupId: number,
  discussionId: number,
): GroupDiscussionReplyOperation | null {
  if (savedValue === null) return null;
  const saved = savedValue as (GroupDiscussionReplyOperation & { completed?: boolean }) | null;
  if (!saved || saved.storageKey !== storageKey) throw new Error('Group discussion reply record is unreadable');
  if (saved.completed === true) return null;
  if (
    !saved.key
    || saved.groupId !== groupId
    || saved.discussionId !== discussionId
    || typeof saved.content !== 'string'
    || !isGroupDiscussionReplyContentValid(saved.content)
    || !Number.isFinite(saved.createdAt)
  ) {
    throw new Error('Group discussion reply record is unreadable');
  }
  return saved;
}

export async function loadGroupDiscussionReplyOperation(
  groupId: number,
  discussionId: number,
): Promise<GroupDiscussionReplyOperation | null> {
  const current = await scope(groupId, discussionId);
  return parse(
    await loadCreationDraft(current.draftScope, { required: true }),
    current.storageKey,
    groupId,
    discussionId,
  );
}

export async function reserveGroupDiscussionReplyOperation(
  groupId: number,
  discussionId: number,
  content: string,
): Promise<GroupDiscussionReplyOperation> {
  const normalized = content.trim();
  if (!isGroupDiscussionReplyContentValid(normalized)) throw new Error('Invalid group discussion reply');
  const original = await scope(groupId, discussionId);
  return withStorage(original.storageKey, async () => {
    const saved = parse(
      await loadCreationDraft(original.draftScope, { required: true }),
      original.storageKey,
      groupId,
      discussionId,
    );
    if (saved) {
      if (saved.content !== normalized) {
        throw new Error('A pending group discussion reply must be retried before writing another reply');
      }
      return saved;
    }
    const current = await scope(groupId, discussionId);
    if (
      current.userId !== original.userId
      || current.tenant !== original.tenant
      || current.storageKey !== original.storageKey
    ) {
      throw new Error('Group discussion reply identity changed before save');
    }
    const operation: GroupDiscussionReplyOperation = {
      storageKey: original.storageKey,
      key: mutationIdempotencyKey('mobile-group-discussion-reply'),
      groupId,
      discussionId,
      content: normalized,
      createdAt: Date.now(),
    };
    if (!await saveCreationDraft(original.draftScope, operation)) {
      throw new Error('Group discussion reply record could not be saved');
    }
    return operation;
  });
}

async function clearMatching(operation: GroupDiscussionReplyOperation): Promise<void> {
  await withStorage(operation.storageKey, async () => {
    const current = await scope(operation.groupId, operation.discussionId);
    if (current.storageKey !== operation.storageKey) {
      throw new Error('Group discussion reply identity changed before cleanup');
    }
    const saved = parse(
      await loadCreationDraft(current.draftScope, { required: true }),
      operation.storageKey,
      operation.groupId,
      operation.discussionId,
    );
    if (!saved || saved.key !== operation.key) return;
    if (!await clearCreationDraft(current.draftScope)) {
      throw new Error('Group discussion reply record could not be cleared');
    }
  });
}

export const completeGroupDiscussionReplyOperation = clearMatching;
export const discardGroupDiscussionReplyOperation = clearMatching;
