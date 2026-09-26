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

export type GroupContentCreationKind = 'discussion' | 'announcement' | 'question' | 'answer' | 'wiki-page' | 'gallery-media' | 'chatroom-message' | 'chatroom' | 'challenge' | 'scheduled-post';

export interface GroupContentCreationPayloads {
  discussion: { title: string; content: string };
  announcement: { title: string; content: string; is_pinned: boolean };
  question: { title: string; body: string };
  answer: { questionId: number; body: string };
  'wiki-page': { title: string; content: string; parent_id: number | null };
  'gallery-media': {
    type: 'image' | 'video';
    uri: string;
    fileName: string;
    mimeType: string | null;
    size: number;
    md5: string | null;
  };
  'chatroom-message': { chatroomId: number; body: string };
  chatroom: { name: string };
  challenge: {
    title: string;
    description: string;
    metric: 'posts' | 'discussions' | 'members' | 'files';
    targetValue: number;
    rewardXp: 0 | 25 | 50 | 100;
    endsAt: string;
  };
  'scheduled-post': {
    postType: 'discussion' | 'announcement';
    title: string;
    content: string;
    scheduledAt: string;
    isRecurring: boolean;
    recurrencePattern: 'daily' | 'weekly' | 'monthly' | null;
  };
}

export interface GroupContentCreationOperation<K extends GroupContentCreationKind = GroupContentCreationKind> {
  storageKey: string;
  key: string;
  kind: K;
  groupId: number;
  intent: string;
  payload: GroupContentCreationPayloads[K];
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

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid group content creation payload');
  return value.trim();
}

function normalizePayload<K extends GroupContentCreationKind>(
  kind: K,
  payload: GroupContentCreationPayloads[K],
): GroupContentCreationPayloads[K] {
  const raw = payload as unknown as Record<string, unknown>;
  let normalized: GroupContentCreationPayloads[GroupContentCreationKind];
  switch (kind) {
    case 'discussion':
      normalized = { title: requiredText(raw.title), content: requiredText(raw.content) };
      break;
    case 'announcement':
      if (typeof raw.is_pinned !== 'boolean') throw new Error('Invalid group content creation payload');
      normalized = { title: requiredText(raw.title), content: requiredText(raw.content), is_pinned: raw.is_pinned };
      break;
    case 'question':
      normalized = { title: requiredText(raw.title), body: requiredText(raw.body) };
      break;
    case 'answer': {
      const questionId = Number(raw.questionId);
      if (!Number.isInteger(questionId) || questionId <= 0) throw new Error('Invalid group content creation payload');
      normalized = { questionId, body: requiredText(raw.body) };
      break;
    }
    case 'wiki-page': {
      const parentId = raw.parent_id === null || raw.parent_id === undefined ? null : Number(raw.parent_id);
      if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
        throw new Error('Invalid group content creation payload');
      }
      normalized = { title: requiredText(raw.title), content: requiredText(raw.content), parent_id: parentId };
      break;
    }
    case 'gallery-media': {
      const size = Number(raw.size);
      const mimeType = raw.mimeType === null || raw.mimeType === undefined ? null : requiredText(raw.mimeType);
      const md5 = raw.md5 === null || raw.md5 === undefined ? null : requiredText(raw.md5).toLowerCase();
      if ((raw.type !== 'image' && raw.type !== 'video')
        || !Number.isFinite(size) || size < 0
        || (md5 !== null && !/^[a-f0-9]{32}$/.test(md5))) {
        throw new Error('Invalid group content creation payload');
      }
      normalized = {
        type: raw.type,
        uri: requiredText(raw.uri),
        fileName: requiredText(raw.fileName),
        mimeType,
        size,
        md5,
      };
      break;
    }
    case 'chatroom-message': {
      const chatroomId = Number(raw.chatroomId);
      if (!Number.isInteger(chatroomId) || chatroomId <= 0) throw new Error('Invalid group content creation payload');
      normalized = { chatroomId, body: requiredText(raw.body) };
      break;
    }
    case 'chatroom':
      normalized = { name: requiredText(raw.name) };
      break;
    case 'challenge': {
      const metric = requiredText(raw.metric);
      const targetValue = Number(raw.targetValue);
      const rewardXp = Number(raw.rewardXp);
      const endsAt = requiredText(raw.endsAt);
      if (!['posts', 'discussions', 'members', 'files'].includes(metric)
        || !Number.isSafeInteger(targetValue) || targetValue < 1 || targetValue > 1_000_000
        || ![0, 25, 50, 100].includes(rewardXp)
        || !Number.isFinite(Date.parse(endsAt))) throw new Error('Invalid group content creation payload');
      normalized = {
        title: requiredText(raw.title),
        description: typeof raw.description === 'string' ? raw.description.trim() : '',
        metric: metric as GroupContentCreationPayloads['challenge']['metric'],
        targetValue,
        rewardXp: rewardXp as GroupContentCreationPayloads['challenge']['rewardXp'],
        endsAt,
      };
      break;
    }
    case 'scheduled-post': {
      const postType = requiredText(raw.postType);
      const scheduledAt = requiredText(raw.scheduledAt);
      const recurrencePattern = raw.recurrencePattern === null ? null : requiredText(raw.recurrencePattern);
      if (!['discussion', 'announcement'].includes(postType)
        || !Number.isFinite(Date.parse(scheduledAt))
        || typeof raw.isRecurring !== 'boolean'
        || (raw.isRecurring && !['daily', 'weekly', 'monthly'].includes(String(recurrencePattern)))
        || (!raw.isRecurring && recurrencePattern !== null)) {
        throw new Error('Invalid group content creation payload');
      }
      normalized = {
        postType: postType as GroupContentCreationPayloads['scheduled-post']['postType'],
        title: requiredText(raw.title),
        content: requiredText(raw.content),
        scheduledAt,
        isRecurring: raw.isRecurring,
        recurrencePattern: recurrencePattern as GroupContentCreationPayloads['scheduled-post']['recurrencePattern'],
      };
      break;
    }
  }
  return normalized as GroupContentCreationPayloads[K];
}

async function scope(groupId: number, kind: GroupContentCreationKind) {
  const [user, tenant] = await Promise.all([
    storage.getJson<{ id: number }>(STORAGE_KEYS.USER_DATA),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!user?.id || !tenant || !Number.isInteger(groupId) || groupId <= 0) {
    throw new Error('Group content creation identity unavailable');
  }
  const contextId = `${groupId}:${kind}`;
  const hash = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([tenant, user.id, groupId, kind]),
  );
  return {
    userId: user.id,
    tenant,
    storageKey: `nexus_group_content_creation_${hash}`,
    draftScope: {
      kind: 'group-content', tenantId: tenant, userId: user.id, contextId,
    } satisfies CreationDraftScope,
  };
}

function parse<K extends GroupContentCreationKind>(
  savedValue: unknown,
  storageKey: string,
  groupId: number,
  kind: K,
): GroupContentCreationOperation<K> | null {
  if (savedValue === null) return null;
  const saved = savedValue as (GroupContentCreationOperation<K> & { completed?: boolean }) | null;
  if (!saved || saved.storageKey !== storageKey) throw new Error('Group content creation record is unreadable');
  if (saved.completed === true) return null;
  try {
    const payload = normalizePayload(kind, saved.payload);
    const intent = JSON.stringify(payload);
    if (
      !saved.key
      || saved.kind !== kind
      || saved.groupId !== groupId
      || saved.intent !== intent
      || !Number.isFinite(saved.createdAt)
    ) {
      throw new Error('invalid');
    }
    return { ...saved, payload, intent };
  } catch {
    throw new Error('Group content creation record is unreadable');
  }
}

export async function loadGroupContentCreationOperation<K extends GroupContentCreationKind>(
  groupId: number,
  kind: K,
): Promise<GroupContentCreationOperation<K> | null> {
  const current = await scope(groupId, kind);
  return parse(
    await loadCreationDraft(current.draftScope, { required: true }),
    current.storageKey,
    groupId,
    kind,
  );
}

export async function reserveGroupContentCreationOperation<K extends GroupContentCreationKind>(
  groupId: number,
  kind: K,
  payload: GroupContentCreationPayloads[K],
): Promise<GroupContentCreationOperation<K>> {
  const normalized = normalizePayload(kind, payload);
  const intent = JSON.stringify(normalized);
  const original = await scope(groupId, kind);
  return withStorage(original.storageKey, async () => {
    const saved = parse(
      await loadCreationDraft(original.draftScope, { required: true }),
      original.storageKey,
      groupId,
      kind,
    );
    if (saved) {
      if (saved.intent !== intent) {
        throw new Error(`A pending group ${kind} must be retried before creating different content`);
      }
      return saved;
    }
    const current = await scope(groupId, kind);
    if (
      current.userId !== original.userId
      || current.tenant !== original.tenant
      || current.storageKey !== original.storageKey
    ) {
      throw new Error('Group content creation identity changed before save');
    }
    const operation: GroupContentCreationOperation<K> = {
      storageKey: original.storageKey,
      key: mutationIdempotencyKey(`mobile-group-${kind}-create`),
      kind,
      groupId,
      intent,
      payload: normalized,
      createdAt: Date.now(),
    };
    if (!await saveCreationDraft(original.draftScope, operation)) {
      throw new Error('Group content creation record could not be saved');
    }
    return operation;
  });
}

async function clearMatching(operation: GroupContentCreationOperation): Promise<void> {
  await withStorage(operation.storageKey, async () => {
    const current = await scope(operation.groupId, operation.kind);
    if (current.storageKey !== operation.storageKey) {
      throw new Error('Group content creation identity changed before cleanup');
    }
    const saved = parse(
      await loadCreationDraft(current.draftScope, { required: true }),
      operation.storageKey,
      operation.groupId,
      operation.kind,
    );
    if (!saved || saved.key !== operation.key) return;
    if (!await clearCreationDraft(current.draftScope)) {
      throw new Error('Group content creation record could not be cleared');
    }
  });
}

export const completeGroupContentCreationOperation = clearMatching;
export const discardGroupContentCreationOperation = clearMatching;
