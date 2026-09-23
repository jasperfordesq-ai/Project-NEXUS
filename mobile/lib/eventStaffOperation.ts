// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { ApiResponseError } from './api/client';
import { eventStaffGrantSchema, grantEventStaff, revokeEventStaff } from './api/eventStaff';
import { loadCreationDraft, saveCreationDraft, clearCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const intentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('grant'), payload: eventStaffGrantSchema }).strict(),
  z.object({ action: z.literal('revoke'), assignmentId: id }).strict(),
]);
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().regex(/^[A-Za-z0-9._:-]{1,170}$/) });
const unfinished = base.extend({ intent: intentSchema, attempts: z.number().int().nonnegative().safe() });
const savedSchema = z.discriminatedUnion('status', [
  unfinished.extend({ status: z.literal('pending') }).strict(),
  unfinished.extend({ status: z.literal('rejected'), code: z.string().min(1) }).strict(),
  base.extend({ status: z.literal('acknowledged'), assignmentId: id, assignmentVersion: id, historyEntryId: id.nullable() }).strict(),
]);
export type StaffOperationScope = z.infer<typeof scopeSchema>;
export type StaffOperationIntent = z.infer<typeof intentSchema>;
export type SavedStaffOperation = z.infer<typeof savedSchema>;
export class StaffOperationError extends Error {}
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const owner = (scope: StaffOperationScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: StaffOperationScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-staff', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.eventId };
}
async function ordered<T>(scope: StaffOperationScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = owner(scope);
  const next = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(key, settled);
  try { return await next; } finally { if (queues.get(key) === settled) queues.delete(key); }
}
async function read(scope: StaffOperationScope): Promise<SavedStaffOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (owner(saved) !== owner(scope)) throw new StaffOperationError('Saved owner mismatch');
  return saved;
}
async function write(scope: StaffOperationScope, value: SavedStaffOperation) {
  if (!await saveCreationDraft(draftScope(scope), savedSchema.parse(value))) throw new StaffOperationError('Operation not saved');
}
/** Loading pending work never submits it. Recovery requires an explicit user action. */
export const loadStaffOperation = (scope: StaffOperationScope) => ordered(scope, () => read(scope));

async function run(scope: StaffOperationScope, input: StaffOperationIntent | null, current: () => boolean) {
  scopeSchema.parse(scope);
  const ownerId = owner(scope);
  if (!current() || active.has(ownerId)) throw new StaffOperationError('Inactive or busy');
  active.add(ownerId);
  try {
    const pending = await ordered(scope, async () => {
      const previous = await read(scope);
      if (!current()) throw new StaffOperationError('Departed');
      if (previous?.status === 'rejected') throw new StaffOperationError('Rejected change needs review');
      const parsed = input === null ? null : intentSchema.parse(input);
      if (previous?.status === 'pending' && parsed && JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new StaffOperationError('Pending request differs');
      const reserved = previous?.status === 'pending' ? previous : parsed ? {
        ...scope, schemaVersion: 1 as const, status: 'pending' as const,
        key: mutationIdempotencyKey('mobile-event-staff'), intent: parsed, attempts: 0,
      } : null;
      if (!reserved) throw new StaffOperationError('No pending staff change');
      // Persist the attempt before dispatch; a crash after this point is uncertain.
      const attempted = { ...reserved, attempts: reserved.attempts + 1 };
      await write(scope, attempted);
      return attempted;
    });
    if (!current()) throw new StaffOperationError('Departed');
    let response: Awaited<ReturnType<typeof grantEventStaff>>;
    try {
      response = pending.intent.action === 'grant'
        ? await grantEventStaff(scope.eventId, scope.userId, pending.intent.payload, pending.key)
        : await revokeEventStaff(scope.eventId, scope.userId, pending.intent.assignmentId, pending.key);
    } catch (error) {
      // Only the grant expiry check runs AFTER accepted-key lookup. Other refusal
      // codes prove non-application only on the first attempt, never after uncertainty.
      const knownFirstRefusal = error instanceof ApiResponseError && pending.attempts === 1
        && ((error.status === 403 && error.code === 'EVENT_STAFF_FORBIDDEN')
          || (error.status === 404 && ['EVENT_NOT_FOUND', 'USER_NOT_FOUND', 'EVENT_STAFF_ASSIGNMENT_NOT_FOUND'].includes(error.code ?? ''))
          || (error.status === 422 && ['EVENT_STAFF_VALIDATION_FAILED', 'EVENT_STAFF_OWNER_ROLE_IMPLICIT', 'EVENT_STAFF_IDEMPOTENCY_KEY_INVALID'].includes(error.code ?? '')));
      const expiredBeforeApplication = error instanceof ApiResponseError && pending.intent.action === 'grant'
        && error.status === 422 && error.code === 'EVENT_STAFF_EXPIRY_INVALID' && error.field === 'expires_at';
      if (knownFirstRefusal || expiredBeforeApplication) {
        const code = (error as ApiResponseError).code!;
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (saved?.status !== 'pending' || saved.key !== pending.key) throw new StaffOperationError('Rejection mismatch');
          await write(scope, { ...saved, status: 'rejected', code });
        });
      }
      throw error;
    }
    await ordered(scope, async () => {
      const saved = await read(scope);
      const assignment = response.data.assignment;
      if (saved?.status !== 'pending' || saved.key !== pending.key || assignment.event_id !== scope.eventId
        || (pending.intent.action === 'grant'
          ? assignment.member.id !== pending.intent.payload.user_id || assignment.role !== pending.intent.payload.role
          : assignment.id !== pending.intent.assignmentId)) throw new StaffOperationError('Receipt mismatch');
      // API validates immutable receipt identity. Persist only minimal recovery data,
      // not member names, avatars or a potentially unbounded history array.
      await write(scope, { ...scope, schemaVersion: 1, key: pending.key, status: 'acknowledged',
        assignmentId: assignment.id, assignmentVersion: assignment.version, historyEntryId: response.data.history_entry_id });
    });
    return response;
  } finally { active.delete(ownerId); }
}
export const executeStaffOperation = (scope: StaffOperationScope, intent: StaffOperationIntent, current: () => boolean) => run(scope, intent, current);
export const recoverStaffOperation = (scope: StaffOperationScope, current: () => boolean) => run(scope, null, current);

/** Call only after explicit confirmation. Uncertain pending work cannot be discarded. */
export async function discardRejectedStaffOperation(scope: StaffOperationScope, key: string, current: () => boolean) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    if (!current() || active.has(owner(scope))) throw new StaffOperationError('Inactive or busy');
    if (saved?.status !== 'rejected' || saved.key !== key) throw new StaffOperationError('No matching rejected change');
    if (!await clearCreationDraft(draftScope(scope))) throw new StaffOperationError('Discard not saved');
  });
}
