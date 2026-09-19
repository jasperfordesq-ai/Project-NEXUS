// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { mobileEventBroadcastSchema } from '@/lib/api/eventCommunications';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from '@/lib/creationDraftStore';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';

const id = z.number().int().positive();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const inputSchema = z.object({
  variant: mobileEventBroadcastSchema.shape.variant,
  segments: mobileEventBroadcastSchema.shape.audience.shape.segments,
  channels: mobileEventBroadcastSchema.shape.channels,
  body: z.string().min(1).max(20000).refine(body => body.trim().length > 0),
}).strict();
const target = { broadcastId: id, expectedVersion: id };
const intentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), input: inputSchema }).strict(),
  z.object({ action: z.literal('revise'), ...target, input: inputSchema }).strict(),
  z.object({ action: z.literal('schedule'), ...target, scheduledAt: z.string().datetime({ offset: true }).nullable() }).strict(),
  z.object({ action: z.literal('cancel'), ...target, reason: z.string().min(1).max(500).refine(reason => reason.trim().length > 0) }).strict(),
  z.object({ action: z.literal('retry'), ...target }).strict(),
]);
const receiptSchema = mobileEventBroadcastSchema.pick({ id: true, event_id: true, version: true, status: true });
const savedBase = scopeSchema.extend({ version: z.literal(1), key: z.string().min(8).max(191), intent: intentSchema });
const savedSchema = z.discriminatedUnion('status', [
  savedBase.extend({ status: z.literal('pending') }).strict(),
  savedBase.extend({ status: z.literal('acknowledged'), receipt: receiptSchema }).strict(),
  savedBase.extend({ status: z.literal('rejected'), rejectionCode: z.string().min(1) }).strict(),
]);

export type EventCommunicationScope = z.infer<typeof scopeSchema>;
export type EventCommunicationIntent = z.infer<typeof intentSchema>;
export type EventCommunicationReceipt = z.infer<typeof receiptSchema>;
export type SavedEventCommunicationOperation = z.infer<typeof savedSchema>;
export class EventCommunicationStorageError extends Error {}
export class PendingEventCommunicationConflict extends Error {}
const operations = new Map<string, Promise<void>>();

function draftScope(scope: EventCommunicationScope): CreationDraftScope {
  if (!scopeSchema.safeParse(scope).success) throw new EventCommunicationStorageError('Invalid event operation owner');
  return { kind: 'event-communication', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.eventId };
}

async function ordered<T>(scope: EventCommunicationScope, operation: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
  const next = (operations.get(key) ?? Promise.resolve()).then(operation);
  const settled = next.then(() => undefined, () => undefined);
  operations.set(key, settled);
  try { return await next; }
  finally { if (operations.get(key) === settled) operations.delete(key); }
}

function receiptMatches(scope: EventCommunicationScope, intent: EventCommunicationIntent, receipt: EventCommunicationReceipt): boolean {
  return receipt.event_id === scope.eventId
    && (intent.action === 'create' || (receipt.id === intent.broadcastId && receipt.version > intent.expectedVersion));
}

async function read(scope: EventCommunicationScope): Promise<SavedEventCommunicationOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const parsed = savedSchema.safeParse(raw);
  if (!parsed.success) throw new EventCommunicationStorageError('Invalid saved event operation');
  const saved = parsed.data;
  if (saved.tenantId !== scope.tenantId || saved.userId !== scope.userId || saved.eventId !== scope.eventId
      || (saved.status === 'acknowledged' && !receiptMatches(scope, saved.intent, saved.receipt))) {
    throw new EventCommunicationStorageError('Event operation identity changed');
  }
  return saved;
}

export function loadEventCommunicationOperation(scope: EventCommunicationScope): Promise<SavedEventCommunicationOperation | null> {
  return ordered(scope, () => read(scope));
}

/** Persist the original request before transport; conflicting unresolved work cannot replace it. */
export function prepareEventCommunicationOperation(scope: EventCommunicationScope, intent: EventCommunicationIntent): Promise<SavedEventCommunicationOperation> {
  return ordered(scope, async () => {
    const parsed = intentSchema.safeParse(intent);
    if (!parsed.success) throw new EventCommunicationStorageError('Invalid event operation request');
    const existing = await read(scope);
    if (existing?.status === 'pending') {
      if (JSON.stringify(existing.intent) !== JSON.stringify(parsed.data)) {
        throw new PendingEventCommunicationConflict('Resolve the pending event operation first');
      }
      return existing;
    }
    const pending: SavedEventCommunicationOperation = {
      ...scope, version: 1, key: mutationIdempotencyKey('mobile-event-operation'), intent: parsed.data, status: 'pending',
    };
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new EventCommunicationStorageError('Event operation could not be saved');
    return pending;
  });
}

export function acknowledgeEventCommunicationOperation(scope: EventCommunicationScope, key: string, receipt: EventCommunicationReceipt): Promise<void> {
  return ordered(scope, async () => {
    const parsed = receiptSchema.safeParse(receipt);
    const current = await read(scope);
    if (!parsed.success || !current || current.key !== key || current.status === 'rejected'
        || !receiptMatches(scope, current.intent, parsed.data)) {
      throw new EventCommunicationStorageError('Event operation receipt does not match');
    }
    if (!await saveCreationDraft(draftScope(scope), { ...current, status: 'acknowledged', receipt: parsed.data })) {
      throw new EventCommunicationStorageError('Event operation receipt could not be saved');
    }
  });
}

/** Use only for an authoritative rejection proving the request did not take effect. */
export function rejectEventCommunicationOperation(scope: EventCommunicationScope, key: string, rejectionCode: string): Promise<void> {
  return ordered(scope, async () => {
    const current = await read(scope);
    if (!current || current.key !== key || current.status !== 'pending' || !rejectionCode.trim()) {
      throw new EventCommunicationStorageError('Event operation rejection does not match');
    }
    if (!await saveCreationDraft(draftScope(scope), { ...current, status: 'rejected', rejectionCode })) {
      throw new EventCommunicationStorageError('Event operation rejection could not be saved');
    }
  });
}
