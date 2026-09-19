// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
import { mutateOrganizerRegistrationForm, organizerRegistrationFormSchema, registrationFormIntentSchema,
  getOrganizerRegistrationForms, organizerRegistrationSettingsSchema, type RegistrationFormIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191), intent: registrationFormIntentSchema });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending') }).strict(),
  base.extend({ status: z.literal('acknowledged'), formId: id, formRevision: id, settingsRevision: id }).strict(),
  base.extend({ status: z.literal('rejected'), reason: z.enum(['stale_revision', 'form_published']) }).strict(),
  base.extend({ status: z.literal('review'), settings: organizerRegistrationSettingsSchema,
    forms: z.array(organizerRegistrationFormSchema) }).strict(),
]);
export type RegistrationFormScope = z.infer<typeof scopeSchema>;
export type SavedRegistrationFormOperation = z.infer<typeof savedSchema>;
export class RegistrationFormOperationError extends Error {}
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: RegistrationFormScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: RegistrationFormScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-registration-form', tenantId: scope.tenantId, userId: scope.userId, contextId: String(scope.eventId) };
}
async function ordered<T>(scope: RegistrationFormScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: RegistrationFormScope): Promise<SavedRegistrationFormOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope)) throw new RegistrationFormOperationError('Owner mismatch');
  return saved;
}
/** Loading is read-only: recovery always requires an explicit action. */
export function loadRegistrationFormOperation(scope: RegistrationFormScope) {
  return ordered(scope, () => read(scope));
}
async function prepare(scope: RegistrationFormScope, intent: RegistrationFormIntent) {
  return ordered(scope, async () => {
    const parsed = registrationFormIntentSchema.parse(intent);
    const previous = await read(scope);
    if (previous?.status === 'rejected') throw new RegistrationFormOperationError('Rejected request needs review');
    if (previous?.status === 'review') {
      if (parsed.settingsRevision !== previous.settings.revision) throw new RegistrationFormOperationError('Review revision mismatch');
      if ('formRevision' in parsed) {
        const form = previous.forms.find(item => item.id === parsed.formId);
        if (!form || form.revision !== parsed.formRevision || form.status !== 'draft') {
          throw new RegistrationFormOperationError('Review form mismatch');
        }
      }
      if (parsed.action === 'fork' && !previous.forms.some(form => form.id === parsed.formId && form.status === 'published')) {
        throw new RegistrationFormOperationError('Review source mismatch');
      }
    }
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new RegistrationFormOperationError('Pending request differs');
      return previous;
    }
    const pending = savedSchema.parse({ ...scope, schemaVersion: 1, status: 'pending', intent: parsed,
      key: mutationIdempotencyKey('mobile-registration-form') });
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new RegistrationFormOperationError('Request not saved');
    return pending;
  });
}
async function run(scope: RegistrationFormScope, isCurrent: () => boolean,
  reserve: () => Promise<SavedRegistrationFormOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!isCurrent() || active.has(owner)) throw new RegistrationFormOperationError('Inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!isCurrent()) throw new RegistrationFormOperationError('Departed');
    if (!pending || pending.status !== 'pending') throw new RegistrationFormOperationError('No pending request');
    let response: Awaited<ReturnType<typeof mutateOrganizerRegistrationForm>>;
    try {
      response = await mutateOrganizerRegistrationForm(scope.eventId, pending.intent, pending.key);
    } catch (error) {
      // Generic conflict, validation and transport failures do not prove non-application.
      if (error instanceof ApiResponseError && error.status === 409 && error.code === 'EVENT_REGISTRATION_CONFLICT'
        && (error.field === 'expected_revision' || error.field === 'expected_form_revision' || error.field === 'form_status')) {
        const reason = error.field === 'form_status' ? 'form_published' : 'stale_revision';
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (!saved || saved.status !== 'pending' || saved.key !== pending.key) throw new RegistrationFormOperationError('Rejection mismatch');
          const rejected = savedSchema.parse({ ...saved, status: 'rejected', reason });
          if (!await saveCreationDraft(draftScope(scope), rejected)) throw new RegistrationFormOperationError('Rejection not saved');
        });
      }
      throw error;
    }
    // Save the receipt even if the originating view departed while transport was running.
    await ordered(scope, async () => {
      const saved = await read(scope);
      const form = organizerRegistrationFormSchema.parse(response.data.form);
      const settingsRevision = id.parse(response.data.settings_revision);
      const intent = pending.intent;
      const sameForm = intent.action === 'update' || intent.action === 'publish';
      if (!saved || saved.status !== 'pending' || saved.key !== pending.key || form.event_id !== scope.eventId
        || settingsRevision <= intent.settingsRevision
        || (sameForm && (form.id !== intent.formId || form.revision <= intent.formRevision))
        || (intent.action === 'publish' && form.status !== 'published')
        || (intent.action === 'fork' && form.id === intent.formId)) {
        throw new RegistrationFormOperationError('Receipt mismatch');
      }
      const acknowledged = savedSchema.parse({ ...saved, status: 'acknowledged',
        formId: form.id, formRevision: form.revision, settingsRevision });
      if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new RegistrationFormOperationError('Receipt not saved');
    });
    return response;
  } finally { active.delete(owner); }
}
export function executeRegistrationFormOperation(scope: RegistrationFormScope, intent: RegistrationFormIntent, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => prepare(scope, intent));
}
export function recoverRegistrationFormOperation(scope: RegistrationFormScope, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => loadRegistrationFormOperation(scope));
}

/** Explicit read-only review; preserve the rejected definition and original key. */
export async function reviewRejectedRegistrationForm(scope: RegistrationFormScope, key: string, isCurrent: () => boolean) {
  scopeSchema.parse(scope);
  if (!isCurrent()) throw new RegistrationFormOperationError('Departed');
  const [response, event] = await Promise.all([getOrganizerRegistrationForms(scope.eventId), getEvent(scope.eventId)]);
  return ordered(scope, async () => {
    if (!isCurrent()) throw new RegistrationFormOperationError('Departed');
    const saved = await read(scope);
    const { settings, forms } = response.data;
    if (!saved || saved.status !== 'rejected' || saved.key !== key || !settings || settings.event_id !== scope.eventId
      || forms.some(form => form.event_id !== scope.eventId) || event.data.id !== scope.eventId
      || !event.data.permissions.manage_registration) throw new RegistrationFormOperationError('Review mismatch');
    const { reason: _reason, ...original } = saved;
    const reviewed = savedSchema.parse({ ...original, status: 'review', settings, forms });
    if (!await saveCreationDraft(draftScope(scope), reviewed)) throw new RegistrationFormOperationError('Review not saved');
    return reviewed;
  });
}
