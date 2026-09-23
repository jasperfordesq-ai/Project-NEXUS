// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { clearCreationDraft, loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { ApiResponseError } from './api/client';
import { eventAgendaSchema, eventAgendaSessionSchema, getEventAgenda } from './api/events';
import { createAgendaSession, updateAgendaSession, cancelAgendaSession, reorderAgendaSessions } from './api/eventAgendaManagement';

const id = z.number().int().positive().safe();
const version = z.number().int().nonnegative().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
// Validate the stored shape without rewriting user input or retry payloads.
export const agendaPayloadSchema = z.object({
  title: z.string().min(1).max(191), description: z.string().max(4000).nullable().optional(),
  session_type: eventAgendaSessionSchema.shape.type, visibility: eventAgendaSessionSchema.shape.visibility,
  start_at: z.string().datetime({ offset: true }), end_at: z.string().datetime({ offset: true }), timezone: z.string().min(1),
  track_name: z.string().max(120).nullable().optional(), room_name: z.string().max(120).nullable().optional(),
  capacity: id.max(100000).nullable().optional(),
  speakers: z.array(z.object({ user_id: id.optional(), display_name: z.string().optional(),
    role_label: z.string().nullable().optional() }).strict()).max(50),
  resources: z.array(z.object({ type: z.enum(['link', 'document', 'slides', 'download', 'stream', 'recording']),
    title: z.string().min(1), url: z.string().url(), visibility: z.enum(['public', 'registered', 'staff']) }).strict()).max(50),
}).strict();
const intentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), payload: agendaPayloadSchema }).strict(),
  z.object({ action: z.literal('update'), sessionId: id, expectedVersion: id, payload: agendaPayloadSchema }).strict(),
  z.object({ action: z.literal('cancel'), sessionId: id, expectedVersion: id, reason: z.string().min(1).max(500) }).strict(),
  z.object({ action: z.literal('reorder'), expectedAgendaVersion: version,
    orderedSessionIds: z.array(id).max(1000).refine(ids => new Set(ids).size === ids.length) }).strict(),
]);
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191),
  intent: intentSchema, attempts: version });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending') }).strict(),
  base.extend({ status: z.literal('acknowledged'), agendaVersion: version, historyEntryId: id.nullable() }).strict(),
  base.extend({ status: z.literal('rejected'), code: z.enum(['EVENT_AGENDA_CONFLICT', 'EVENT_AGENDA_VALIDATION_FAILED']) }).strict(),
  base.extend({ status: z.literal('review'), agenda: eventAgendaSchema }).strict(),
]);
export type AgendaOperationScope = z.infer<typeof scopeSchema>;
export type AgendaOperationIntent = z.infer<typeof intentSchema>;
export type SavedAgendaOperation = z.infer<typeof savedSchema>;
export class AgendaOperationError extends Error {}
const active = new Set<string>();
const queues = new Map<string, Promise<void>>();
const owner = (scope: AgendaOperationScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: AgendaOperationScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-agenda', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.eventId };
}
async function ordered<T>(scope: AgendaOperationScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = owner(scope);
  const next = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(key, settled);
  try { return await next; } finally { if (queues.get(key) === settled) queues.delete(key); }
}
async function read(scope: AgendaOperationScope): Promise<SavedAgendaOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (owner(saved) !== owner(scope)) throw new AgendaOperationError('Owner mismatch');
  return saved;
}
async function write(scope: AgendaOperationScope, saved: SavedAgendaOperation) {
  if (!await saveCreationDraft(draftScope(scope), savedSchema.parse(saved))) throw new AgendaOperationError('Operation not saved');
}
export function loadAgendaOperation(scope: AgendaOperationScope) { return ordered(scope, () => read(scope)); }
async function reserve(scope: AgendaOperationScope, input?: AgendaOperationIntent) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    const intent = input ? intentSchema.parse(input) : undefined;
    if (saved?.status === 'pending') {
      if (intent && JSON.stringify(intent) !== JSON.stringify(saved.intent)) throw new AgendaOperationError('Unsettled request differs');
      return saved;
    }
    if (!intent) throw new AgendaOperationError('No pending operation');
    if (saved?.status === 'rejected') throw new AgendaOperationError('Review required');
    if (saved?.status === 'review') {
      if (intent.action !== saved.intent.action
        || (('sessionId' in intent) && (!('sessionId' in saved.intent) || intent.sessionId !== saved.intent.sessionId))) {
        throw new AgendaOperationError('Reviewed operation differs');
      }
      if (intent.action === 'reorder' && intent.expectedAgendaVersion !== saved.agenda.agenda_version) throw new AgendaOperationError('Review version mismatch');
      if (intent.action === 'update' || intent.action === 'cancel') {
        const session = saved.agenda.sessions.find(item => item.id === intent.sessionId);
        if (!session || session.status !== 'scheduled' || session.version !== intent.expectedVersion) throw new AgendaOperationError('Review version mismatch');
      }
    }
    const pending: SavedAgendaOperation = { ...scope, schemaVersion: 1, status: 'pending', attempts: 0,
      key: mutationIdempotencyKey('mobile-agenda'), intent };
    await write(scope, pending);
    return pending;
  });
}
async function run(scope: AgendaOperationScope, current: () => boolean, input?: AgendaOperationIntent) {
  scopeSchema.parse(scope);
  const key = owner(scope);
  if (!current() || active.has(key)) throw new AgendaOperationError('Inactive or busy');
  active.add(key);
  try {
    const reserved = await reserve(scope, input);
    if (!current()) throw new AgendaOperationError('Departed');
    // Persist an attempt before dispatch. A crash at any later point makes the result uncertain.
    const pending = await ordered(scope, async () => {
      const saved = await read(scope);
      if (!saved || saved.status !== 'pending' || saved.key !== reserved.key) throw new AgendaOperationError('Pending operation changed');
      const next = { ...saved, attempts: saved.attempts + 1 };
      await write(scope, next);
      return next;
    });
    if (!current()) throw new AgendaOperationError('Departed');
    const intent = pending.intent;
    let result: Awaited<ReturnType<typeof createAgendaSession>> | Awaited<ReturnType<typeof reorderAgendaSessions>>;
    try {
      switch (intent.action) {
        case 'create': result = await createAgendaSession(scope.eventId, intent.payload, pending.key); break;
        case 'update': result = await updateAgendaSession(scope.eventId, intent.sessionId, intent.payload, intent.expectedVersion, pending.key); break;
        case 'cancel': result = await cancelAgendaSession(scope.eventId, intent.sessionId, intent.reason, intent.expectedVersion, pending.key); break;
        case 'reorder': result = await reorderAgendaSessions(scope.eventId, intent.orderedSessionIds, intent.expectedAgendaVersion, pending.key); break;
      }
    } catch (error) {
      // Generic later refusals remain uncertain. Only a locked receipt check plus an
      // obsolete version can prove this exact non-create request never applied and cannot apply.
      const terminalRefusal = intent.action !== 'create' && error instanceof ApiResponseError
        && error.status === 409 && error.code === 'EVENT_AGENDA_CONFLICT' && error.operationOutcome === 'not_applied';
      if ((pending.attempts === 1 || terminalRefusal) && error instanceof ApiResponseError
        && ((error.status === 409 && error.code === 'EVENT_AGENDA_CONFLICT')
          || (error.status === 422 && error.code === 'EVENT_AGENDA_VALIDATION_FAILED'))) {
        // Snapshot the classified value before queued work. On a fresh Hermes runtime,
        // capturing the catch binding inside this async callback loses it after read().
        const rejectionCode = error.code as 'EVENT_AGENDA_CONFLICT' | 'EVENT_AGENDA_VALIDATION_FAILED';
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (!saved || saved.status !== 'pending' || saved.key !== pending.key) throw new AgendaOperationError('Rejection mismatch');
          await write(scope, { ...saved, status: 'rejected', code: rejectionCode });
        });
      }
      throw error;
    }
    await ordered(scope, async () => {
      const saved = await read(scope);
      if (!saved || saved.status !== 'pending' || saved.key !== pending.key) throw new AgendaOperationError('Receipt mismatch');
      version.parse(result.data.agenda_version); id.nullable().parse(result.data.history_entry_id);
      if (intent.action === 'reorder') {
        if (result.data.agenda_version < intent.expectedAgendaVersion) throw new AgendaOperationError('Stale receipt');
      } else {
        const session = eventAgendaSessionSchema.parse(result.data.session);
        if (intent.action !== 'create' && (session.id !== intent.sessionId || session.version < intent.expectedVersion)) throw new AgendaOperationError('Stale receipt');
      }
      await write(scope, { ...saved, status: 'acknowledged', agendaVersion: result.data.agenda_version,
        historyEntryId: result.data.history_entry_id });
    });
    return result;
  } finally { active.delete(key); }
}
export function executeAgendaOperation(scope: AgendaOperationScope, intent: AgendaOperationIntent, current: () => boolean) {
  return run(scope, current, intent);
}
/** Explicit recovery only; mounting or reading storage never dispatches a mutation. */
export function recoverAgendaOperation(scope: AgendaOperationScope, current: () => boolean) { return run(scope, current); }
/** Confirmed local discard only. An uncertain operation must never be released this way. */
export function discardRejectedAgendaOperation(scope: AgendaOperationScope, key: string, current: () => boolean) {
  return ordered(scope, async () => {
    if (!current()) throw new AgendaOperationError('Departed');
    const saved = await read(scope);
    if (!current() || active.has(owner(scope))) throw new AgendaOperationError('Inactive or busy');
    if (!saved || saved.key !== key || (saved.status !== 'rejected' && saved.status !== 'review')) {
      throw new AgendaOperationError('No matching rejected change');
    }
    if (!await clearCreationDraft(draftScope(scope))) throw new AgendaOperationError('Discard not saved');
  });
}
/** Keep the rejected input intact while fetching authoritative versions for an explicit correction. */
export async function reviewAgendaOperation(scope: AgendaOperationScope, key: string, current: () => boolean) {
  if (!current()) throw new AgendaOperationError('Departed');
  const { data } = await getEventAgenda(scope.eventId, true);
  const agenda = eventAgendaSchema.parse(data);
  return ordered(scope, async () => {
    if (!current() || agenda.event_id !== scope.eventId || !agenda.permissions.manage) throw new AgendaOperationError('Review unavailable');
    const saved = await read(scope);
    if (!saved || saved.status !== 'rejected' || saved.key !== key) throw new AgendaOperationError('No rejected request');
    const { code: _code, ...original } = saved;
    const reviewed: SavedAgendaOperation = { ...original, status: 'review', agenda };
    await write(scope, reviewed);
    return reviewed;
  });
}
