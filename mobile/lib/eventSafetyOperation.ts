// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { ApiResponseError } from './api/client';
import { safetyRequirementDraftSchema, safetyReviewInputSchema, saveEventSafetyDraft, publishEventSafety, archiveEventSafety, recordEventSafetyReview, withdrawEventSafetyReview } from './api/eventSafetyManagement';
import { loadCreationDraft, saveCreationDraft, clearCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const revision = z.number().int().nonnegative().safe().nullable();
const intentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft'), payload: safetyRequirementDraftSchema, expectedRevision: revision }).strict(),
  z.object({ action: z.literal('publish'), expectedRevision: id, expectedVersion: id }).strict(),
  z.object({ action: z.literal('archive'), expectedRevision: id, expectedVersion: id }).strict(),
  z.object({ action: z.literal('review'), payload: safetyReviewInputSchema }).strict(),
  z.object({ action: z.literal('withdraw'), denialId: id, expectedVersion: id }).strict(),
]);
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().regex(/^[A-Za-z0-9._:-]{1,170}$/) });
const unfinished = base.extend({ intent: intentSchema, attempts: z.number().int().nonnegative().safe() });
const savedSchema = z.discriminatedUnion('status', [
  unfinished.extend({ status: z.literal('pending') }).strict(),
  unfinished.extend({ status: z.literal('rejected'), code: z.string().min(1) }).strict(),
  base.extend({ status: z.literal('acknowledged') }).strict(),
]);
export type SafetyOperationScope = z.infer<typeof scopeSchema>;
export type SafetyOperationIntent = z.infer<typeof intentSchema>;
export type SavedSafetyOperation = z.infer<typeof savedSchema>;
export class SafetyOperationError extends Error {}
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const owner = (scope: SafetyOperationScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: SafetyOperationScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-safety', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.eventId };
}
async function ordered<T>(scope: SafetyOperationScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = owner(scope);
  const next = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(key, settled);
  try { return await next; } finally { if (queues.get(key) === settled) queues.delete(key); }
}
async function read(scope: SafetyOperationScope): Promise<SavedSafetyOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (owner(saved) !== owner(scope)) throw new SafetyOperationError('Saved owner mismatch');
  return saved;
}
async function write(scope: SafetyOperationScope, value: SavedSafetyOperation) {
  if (!await saveCreationDraft(draftScope(scope), savedSchema.parse(value))) throw new SafetyOperationError('Operation not saved');
}
/** Loading pending work never submits it. Recovery requires an explicit user action. */
export const loadSafetyOperation = (scope: SafetyOperationScope) => ordered(scope, () => read(scope));

async function run(scope: SafetyOperationScope, input: SafetyOperationIntent | null, current: () => boolean) {
  scopeSchema.parse(scope);
  const ownerId = owner(scope);
  if (!current() || active.has(ownerId)) throw new SafetyOperationError('Inactive or busy');
  active.add(ownerId);
  try {
    const pending = await ordered(scope, async () => {
      const previous = await read(scope);
      if (!current()) throw new SafetyOperationError('Departed');
      if (previous?.status === 'rejected') throw new SafetyOperationError('Rejected change needs review');
      const parsed = input === null ? null : intentSchema.parse(input);
      if (previous?.status === 'pending' && parsed && JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new SafetyOperationError('Pending request differs');
      const reserved = previous?.status === 'pending' ? previous : parsed ? {
        ...scope, schemaVersion: 1 as const, status: 'pending' as const,
        key: mutationIdempotencyKey('mobile-event-safety'), intent: parsed, attempts: 0,
      } : null;
      if (!reserved) throw new SafetyOperationError('No pending safety change');
      // Persist the attempt before dispatch; a crash after this point is uncertain.
      const attempted = { ...reserved, attempts: reserved.attempts + 1 };
      await write(scope, attempted);
      return attempted;
    });
    if (!current()) throw new SafetyOperationError('Departed');
    let response: Awaited<ReturnType<typeof dispatch>>;
    try {
      response = await dispatch(scope.eventId, pending.intent, pending.key);
    } catch (error) {
      // Projection can fail AFTER a committed mutation (including 403/422).
      // Only first-attempt 409 proves non-application: projection emits no conflicts.
      // After uncertainty, even a conflict may precede lookup of the original key.
      const rejected = pending.attempts === 1 && error instanceof ApiResponseError
        && error.status === 409 && error.code === 'EVENT_SAFETY_CONFLICT';
      if (rejected) {
        const code = 'EVENT_SAFETY_CONFLICT';
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (saved?.status !== 'pending' || saved.key !== pending.key) throw new SafetyOperationError('Rejection mismatch');
          await write(scope, { ...saved, status: 'rejected', code });
        });
      }
      throw error;
    }
    await ordered(scope, async () => {
      const saved = await read(scope);
      if (saved?.status !== 'pending' || saved.key !== pending.key) throw new SafetyOperationError('Acknowledgement mismatch');
      // A successful mutation response acknowledges this request. Its current
      // projection is NOT an immutable receipt; don't retain names or history,
      // or require the changed review to appear on the returned first page.
      await write(scope, { ...scope, schemaVersion: 1, key: pending.key, status: 'acknowledged' });
    });
    return response;
  } finally { active.delete(ownerId); }
}
export const executeSafetyOperation = (scope: SafetyOperationScope, intent: SafetyOperationIntent, current: () => boolean) => run(scope, intent, current);
export const recoverSafetyOperation = (scope: SafetyOperationScope, current: () => boolean) => run(scope, null, current);

/** Call only after explicit confirmation. Uncertain pending work cannot be discarded. */
export async function discardRejectedSafetyOperation(scope: SafetyOperationScope, key: string, current: () => boolean) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    if (!current() || active.has(owner(scope))) throw new SafetyOperationError('Inactive or busy');
    if (saved?.status !== 'rejected' || saved.key !== key) throw new SafetyOperationError('No matching rejected change');
    if (!await clearCreationDraft(draftScope(scope))) throw new SafetyOperationError('Discard not saved');
  });
}

async function dispatch(eventId: number, intent: SafetyOperationIntent, key: string) {
  switch (intent.action) {
    case 'draft': return saveEventSafetyDraft(eventId, intent.payload, intent.expectedRevision, key);
    case 'publish': return publishEventSafety(eventId, intent.expectedRevision, intent.expectedVersion, key);
    case 'archive': return archiveEventSafety(eventId, intent.expectedRevision, intent.expectedVersion, key);
    case 'review': return recordEventSafetyReview(eventId, intent.payload, key);
    case 'withdraw': return withdrawEventSafetyReview(eventId, intent.denialId, intent.expectedVersion, key);
  }
}
