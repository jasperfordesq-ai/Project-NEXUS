// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { mutateOrganizerRetention, organizerRetentionRunSchema, retentionIntentSchema, type RetentionIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191) });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending'), intent: retentionIntentSchema }).strict(),
  base.extend({ status: z.literal('acknowledged'), run: organizerRetentionRunSchema }).strict(),
]);
export type RetentionScope = z.infer<typeof scopeSchema>;
export type SavedRetentionOperation = z.infer<typeof savedSchema>;
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: RetentionScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: RetentionScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-retention', tenantId: scope.tenantId, userId: scope.userId, contextId: String(scope.eventId) };
}
async function ordered<T>(scope: RetentionScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: RetentionScope): Promise<SavedRetentionOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope) || (saved.status === 'acknowledged' && saved.run.event_id !== scope.eventId)) {
    throw new Error('Retention owner mismatch');
  }
  return saved;
}
/** Reading saved work must never apply retention or create a preview. */
export const loadRetentionOperation = (scope: RetentionScope) => ordered(scope, () => read(scope));
async function prepare(scope: RetentionScope, intent: RetentionIntent) {
  return ordered(scope, async () => {
    const parsed = retentionIntentSchema.parse(intent);
    const previous = await read(scope);
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new Error('Pending retention request differs');
      return previous;
    }
    const saved = savedSchema.parse({ ...scope, schemaVersion: 1, status: 'pending', intent: parsed,
      key: mutationIdempotencyKey('mobile-retention') });
    if (!await saveCreationDraft(draftScope(scope), saved)) throw new Error('Retention request not saved');
    return saved;
  });
}
async function run(scope: RetentionScope, current: () => boolean, reserve: () => Promise<SavedRetentionOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!current() || active.has(owner)) throw new Error('Retention inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!current()) throw new Error('Retention departed');
    if (pending?.status !== 'pending') throw new Error('No pending retention request');
    // Any failure retains the exact request. Do not infer non-application from
    // a network error, validation failure, conflict, or a changed permission.
    const response = await mutateOrganizerRetention(scope.eventId, pending.intent, pending.key);
    await ordered(scope, async () => {
      const saved = await read(scope);
      const receipt = organizerRetentionRunSchema.parse(response.data.run);
      const intent = pending.intent;
      if (saved?.status !== 'pending' || saved.key !== pending.key || receipt.event_id !== scope.eventId
        || response.data.changed === response.data.idempotent_replay
        || (intent.action === 'preview' ? receipt.mode !== 'dry_run' || Date.parse(receipt.as_of_utc) !== Date.parse(intent.asOf)
          : receipt.mode !== 'apply' || receipt.dry_run_id !== intent.dryRunId)) throw new Error('Retention receipt mismatch');
      // Keep the minimal validated result even after departure, without storing personal data.
      const acknowledged = savedSchema.parse({ ...scope, schemaVersion: 1, key: saved.key, status: 'acknowledged', run: receipt });
      if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new Error('Retention receipt not saved');
    });
    return response;
  } finally { active.delete(owner); }
}
/** The caller must obtain explicit confirmation of apply before invoking this. */
export const executeRetentionOperation = (scope: RetentionScope, intent: RetentionIntent, current: () => boolean) =>
  run(scope, current, () => prepare(scope, intent));
export const recoverRetentionOperation = (scope: RetentionScope, current: () => boolean) =>
  run(scope, current, () => loadRetentionOperation(scope));
