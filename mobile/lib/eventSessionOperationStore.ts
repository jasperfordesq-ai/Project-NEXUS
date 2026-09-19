// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import type { registerEventAgendaSession } from './api/events';

const id = z.number().int().positive().safe();
const version = z.number().int().nonnegative().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id, sessionId: id }).strict();
const intentSchema = z.object({ action: z.enum(['register', 'withdraw']), expectedVersion: version }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191), intent: intentSchema });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending') }).strict(),
  base.extend({ status: z.literal('acknowledged'), registrationVersion: version, historyEntryId: id.nullable() }).strict(),
]);
export type EventSessionScope = z.infer<typeof scopeSchema>;
export type EventSessionIntent = z.infer<typeof intentSchema>;
export type SavedEventSessionOperation = z.infer<typeof savedSchema>;
export class EventSessionStorageError extends Error {}
export class PendingEventSessionConflict extends Error {}
const queues = new Map<string, Promise<void>>();

function draftScope(scope: EventSessionScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-session-registration', tenantId: scope.tenantId, userId: scope.userId,
    contextId: `${scope.eventId}-${scope.sessionId}` };
}
async function ordered<T>(scope: EventSessionScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = `${scope.tenantId}:${scope.userId}:${scope.eventId}:${scope.sessionId}`;
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: EventSessionScope): Promise<SavedEventSessionOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (saved.tenantId !== scope.tenantId || saved.userId !== scope.userId
    || saved.eventId !== scope.eventId || saved.sessionId !== scope.sessionId) throw new EventSessionStorageError('Owner mismatch');
  return saved;
}
export function loadEventSessionOperation(scope: EventSessionScope) { return ordered(scope, () => read(scope)); }
export function prepareEventSessionOperation(scope: EventSessionScope, intent: EventSessionIntent) {
  return ordered(scope, async () => {
    const parsed = intentSchema.parse(intent);
    const existing = await read(scope);
    if (existing?.status === 'pending') {
      if (existing.intent.action !== parsed.action || existing.intent.expectedVersion !== parsed.expectedVersion) throw new PendingEventSessionConflict();
      return existing;
    }
    const pending: SavedEventSessionOperation = { ...scope, schemaVersion: 1, status: 'pending',
      intent: parsed, key: mutationIdempotencyKey('mobile-event-session') };
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new EventSessionStorageError('Request not saved');
    return pending;
  });
}
export function acknowledgeEventSessionOperation(scope: EventSessionScope, key: string,
  response: Awaited<ReturnType<typeof registerEventAgendaSession>>) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    const receipt = response.data;
    if (!saved || saved.status !== 'pending' || saved.key !== key
      || !version.safeParse(receipt.registration_version).success
      || receipt.registration_version < saved.intent.expectedVersion
      || !id.nullable().safeParse(receipt.history_entry_id).success
      || (receipt.session !== null && (receipt.session.id !== scope.sessionId
        || receipt.session.registration.version !== receipt.registration_version))) throw new EventSessionStorageError('Receipt mismatch');
    const acknowledged = savedSchema.parse({ ...saved, status: 'acknowledged',
      registrationVersion: receipt.registration_version, historyEntryId: receipt.history_entry_id });
    if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new EventSessionStorageError('Receipt not saved');
  });
}
