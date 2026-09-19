// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
import { organizerRegistrationSettingsSchema, registrationSettingsInputSchema,
  getOrganizerRegistrationSettings, saveOrganizerRegistrationSettings, publishOrganizerRegistrationSettings } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const intentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), input: registrationSettingsInputSchema }).strict(),
  z.object({ action: z.literal('publish'), expectedRevision: id }).strict(),
]);
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191), intent: intentSchema });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending') }).strict(),
  base.extend({ status: z.literal('acknowledged'), settingsId: id, settingsRevision: id }).strict(),
  base.extend({ status: z.literal('rejected'), reason: z.literal('stale_revision') }).strict(),
  base.extend({ status: z.literal('review'), settings: organizerRegistrationSettingsSchema,
    schedule: z.object({ start_at: z.string().datetime({ offset: true }), timezone: z.string().min(1) }).strict() }).strict(),
]);
export type RegistrationSettingsScope = z.infer<typeof scopeSchema>;
export type RegistrationSettingsIntent = z.infer<typeof intentSchema>;
export type SavedRegistrationSettingsOperation = z.infer<typeof savedSchema>;
export class RegistrationSettingsOperationError extends Error {}
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: RegistrationSettingsScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;

function draftScope(scope: RegistrationSettingsScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-registration-settings', tenantId: scope.tenantId, userId: scope.userId, contextId: String(scope.eventId) };
}
async function ordered<T>(scope: RegistrationSettingsScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: RegistrationSettingsScope): Promise<SavedRegistrationSettingsOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope)) throw new RegistrationSettingsOperationError('Owner mismatch');
  return saved;
}
export function loadRegistrationSettingsOperation(scope: RegistrationSettingsScope) {
  return ordered(scope, () => read(scope));
}
async function prepare(scope: RegistrationSettingsScope, intent: RegistrationSettingsIntent) {
  return ordered(scope, async () => {
    const parsed = intentSchema.parse(intent);
    const previous = await read(scope);
    if (previous?.status === 'rejected') throw new RegistrationSettingsOperationError('Rejected request needs review');
    if (previous?.status === 'review') {
      const expected = parsed.action === 'save' ? parsed.input.expected_revision : parsed.expectedRevision;
      if (expected !== previous.settings.revision) throw new RegistrationSettingsOperationError('Review revision mismatch');
    }
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new RegistrationSettingsOperationError('Pending request differs');
      return previous;
    }
    const pending: SavedRegistrationSettingsOperation = { ...scope, schemaVersion: 1, status: 'pending',
      intent: parsed, key: mutationIdempotencyKey('mobile-registration-settings') };
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new RegistrationSettingsOperationError('Request not saved');
    return pending;
  });
}
async function acknowledge(scope: RegistrationSettingsScope, key: string,
  response: Awaited<ReturnType<typeof saveOrganizerRegistrationSettings>>) {
  return ordered(scope, async () => {
    const saved = await read(scope);
    const settings = organizerRegistrationSettingsSchema.parse(response.data.settings);
    const expected = saved?.intent.action === 'save' ? saved.intent.input.expected_revision : saved?.intent.expectedRevision;
    if (!saved || saved.status !== 'pending' || saved.key !== key || settings.event_id !== scope.eventId
      || expected === undefined || settings.revision <= expected) throw new RegistrationSettingsOperationError('Receipt mismatch');
    const acknowledged = savedSchema.parse({ ...saved, status: 'acknowledged', settingsId: settings.id, settingsRevision: settings.revision });
    if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new RegistrationSettingsOperationError('Receipt not saved');
  });
}
async function run(scope: RegistrationSettingsScope, isCurrent: () => boolean,
  reserve: () => Promise<SavedRegistrationSettingsOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!isCurrent() || active.has(owner)) throw new RegistrationSettingsOperationError('Inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!isCurrent()) throw new RegistrationSettingsOperationError('Departed');
    if (!pending || pending.status !== 'pending') throw new RegistrationSettingsOperationError('No pending request');
    let response: Awaited<ReturnType<typeof saveOrganizerRegistrationSettings>>;
    try {
      response = pending.intent.action === 'save'
        ? await saveOrganizerRegistrationSettings(scope.eventId, pending.intent.input, pending.key)
        : await publishOrganizerRegistrationSettings(scope.eventId, pending.intent.expectedRevision, pending.key);
    } catch (error) {
      // Only the server's exact settings-version rejection proves this intent was not applied.
      if (error instanceof ApiResponseError && error.status === 409
        && error.code === 'EVENT_REGISTRATION_CONFLICT' && error.field === 'expected_revision') {
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (!saved || saved.status !== 'pending' || saved.key !== pending.key) throw new RegistrationSettingsOperationError('Rejection mismatch');
          const rejected = savedSchema.parse({ ...saved, status: 'rejected', reason: 'stale_revision' });
          if (!await saveCreationDraft(draftScope(scope), rejected)) throw new RegistrationSettingsOperationError('Rejection not saved');
        });
      }
      throw error;
    }
    // Persist accepted outcomes even if the originating view has since departed.
    await acknowledge(scope, pending.key, response);
    return response;
  } finally { active.delete(owner); }
}
export function executeRegistrationSettingsOperation(scope: RegistrationSettingsScope, intent: RegistrationSettingsIntent, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => prepare(scope, intent));
}
/** Explicit user recovery only. Loading a draft never dispatches a request. */
export function recoverRegistrationSettingsOperation(scope: RegistrationSettingsScope, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => loadRegistrationSettingsOperation(scope));
}

/** Reload after a definitive rejection; preserve the rejected draft and never send a mutation. */
export async function reviewRejectedRegistrationSettings(scope: RegistrationSettingsScope, key: string, isCurrent: () => boolean) {
  if (!isCurrent()) throw new RegistrationSettingsOperationError('Departed');
  const [response, event] = await Promise.all([getOrganizerRegistrationSettings(scope.eventId), getEvent(scope.eventId)]);
  return ordered(scope, async () => {
    if (!isCurrent()) throw new RegistrationSettingsOperationError('Departed');
    const saved = await read(scope);
    const settings = response.data.settings;
    if (!saved || saved.status !== 'rejected' || saved.key !== key || !settings || settings.event_id !== scope.eventId
      || event.data.id !== scope.eventId || !event.data.permissions.manage_registration) {
      throw new RegistrationSettingsOperationError('Review mismatch');
    }
    const { reason: _reason, ...original } = saved;
    const reviewed = savedSchema.parse({ ...original, status: 'review', settings,
      schedule: { start_at: event.data.schedule.start_at, timezone: event.data.schedule.timezone } });
    if (!await saveCreationDraft(draftScope(scope), reviewed)) throw new RegistrationSettingsOperationError('Review not saved');
    return reviewed;
  });
}
