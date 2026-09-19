// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import type { mutateEventRegistrations, EventPeopleRegistrationOperation } from './api/eventPeople';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const intentSchema = z.object({
  action: z.enum(['invite', 'approve', 'reject', 'cancel']),
  reason: z.string().trim().refine(value => Array.from(value).length <= 4000).nullable(),
  targets: z.array(z.object({ userId: id, version: z.number().int().nonnegative().safe() }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.targets.map(target => target.userId)).size === value.targets.length)
  .refine(value => !['reject', 'cancel'].includes(value.action) || Boolean(value.reason?.trim()));
const outcomeSchema = z.discriminatedUnion('success', [
  z.object({ userId: id, success: z.literal(true), registrationId: id, version: z.number().int().nonnegative().safe(), state: z.enum(['invited', 'pending', 'confirmed', 'declined', 'cancelled']) }).strict(),
  z.object({ userId: id, success: z.literal(false), code: z.string().min(1) }).strict(),
]);
const savedBase = scopeSchema.extend({ version: z.literal(1), key: z.string().min(1).max(170), intent: intentSchema });
const savedSchema = z.discriminatedUnion('status', [
  savedBase.extend({ status: z.literal('pending') }).strict(),
  savedBase.extend({ status: z.literal('acknowledged'), outcomes: z.array(outcomeSchema).min(1).max(100) }).strict(),
]);
export type EventPeopleScope = z.infer<typeof scopeSchema>;
export type EventPeopleIntent = z.infer<typeof intentSchema>;
export type SavedEventPeopleOperation = z.infer<typeof savedSchema>;
export class EventPeopleStorageError extends Error {}
export class PendingEventPeopleConflict extends Error {}
const queues = new Map<string, Promise<void>>();

function draftScope(scope: EventPeopleScope): CreationDraftScope {
  if (!scopeSchema.safeParse(scope).success) throw new EventPeopleStorageError('Invalid owner');
  return { kind: 'event-people', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.eventId };
}
async function ordered<T>(scope: EventPeopleScope, fn: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
  const next = (queues.get(key) ?? Promise.resolve()).then(fn);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(key, settled);
  try { return await next; } finally { if (queues.get(key) === settled) queues.delete(key); }
}
async function read(scope: EventPeopleScope): Promise<SavedEventPeopleOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const parsed = savedSchema.safeParse(raw);
  if (!parsed.success) throw new EventPeopleStorageError('Invalid saved operation');
  const saved = parsed.data;
  if (saved.tenantId !== scope.tenantId || saved.userId !== scope.userId || saved.eventId !== scope.eventId) throw new EventPeopleStorageError('Owner changed');
  if (saved.status === 'acknowledged' && (saved.outcomes.length !== saved.intent.targets.length
    || saved.outcomes.some((outcome, index) => outcome.userId !== saved.intent.targets[index].userId))) throw new EventPeopleStorageError('Receipt does not match');
  return saved;
}
export function loadEventPeopleOperation(scope: EventPeopleScope) { return ordered(scope, () => read(scope)); }

export function prepareEventPeopleOperation(scope: EventPeopleScope, intent: EventPeopleIntent) {
  return ordered(scope, async () => {
    const parsed = intentSchema.safeParse(intent);
    if (!parsed.success) throw new EventPeopleStorageError('Invalid intent');
    const existing = await read(scope);
    if (existing?.status === 'pending') {
      if (JSON.stringify(existing.intent) !== JSON.stringify(parsed.data)) throw new PendingEventPeopleConflict('Resolve pending changes first');
      return existing;
    }
    const pending: SavedEventPeopleOperation = { ...scope, version: 1, key: mutationIdempotencyKey('mobile-event-people'), intent: parsed.data, status: 'pending' };
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new EventPeopleStorageError('Could not save operation');
    return pending;
  });
}

export function eventPeopleRequest(saved: SavedEventPeopleOperation): EventPeopleRegistrationOperation[] {
  return saved.intent.targets.map((target, index) => ({ user_id: target.userId, expected_version: target.version,
    action: saved.intent.action, reason: saved.intent.reason, idempotency_key: `${saved.key}-${index}` }));
}

export function acknowledgeEventPeopleOperation(scope: EventPeopleScope, key: string, result: Awaited<ReturnType<typeof mutateEventRegistrations>>) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    if (!saved || saved.status !== 'pending' || saved.key !== key || result.requested !== saved.intent.targets.length
      || result.results.length !== saved.intent.targets.length
      || result.succeeded !== result.results.filter(item => item.success).length
      || result.failed !== result.results.filter(item => !item.success).length) throw new EventPeopleStorageError('Receipt does not match');
    const sorted = [...result.results].sort((a, b) => a.index - b.index);
    if (sorted.some((item, index) => item.index !== index || item.user_id !== saved.intent.targets[index].userId
      || item.expected_version !== saved.intent.targets[index].version || item.action !== saved.intent.action)) throw new EventPeopleStorageError('Receipt does not match');
    const acknowledged = savedSchema.safeParse({ ...saved, status: 'acknowledged', outcomes: sorted.map(item => item.success
      ? { userId: item.user_id, success: true, registrationId: item.mutation.registration_id, version: item.mutation.version, state: item.mutation.state }
      : { userId: item.user_id, success: false, code: item.error.code }) });
    if (!acknowledged.success || !await saveCreationDraft(draftScope(scope), acknowledged.data)) throw new EventPeopleStorageError('Could not save receipt');
  });
}
