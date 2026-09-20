// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { ApiResponseError } from './api/client';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { getOrganizerInvitations, revokeOrganizerInvitation, revokedInvitationSchema, invitationRevocationIntentSchema, type InvitationRevocationIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191) });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending'), intent: invitationRevocationIntentSchema }).strict(),
  base.extend({ status: z.literal('rejected'), intent: invitationRevocationIntentSchema }).strict(),
  base.extend({ status: z.literal('review'), invitationId: id, invitationVersion: id }).strict(),
  base.extend({ status: z.literal('acknowledged'), invitation: revokedInvitationSchema }).strict(),
]);
export type InvitationRevocationScope = z.infer<typeof scopeSchema>;
export type SavedInvitationRevocationOperation = z.infer<typeof savedSchema>;
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: InvitationRevocationScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: InvitationRevocationScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-invitation-revoke', tenantId: scope.tenantId, userId: scope.userId, contextId: String(scope.eventId) };
}
async function ordered<T>(scope: InvitationRevocationScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: InvitationRevocationScope): Promise<SavedInvitationRevocationOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope) || (saved.status === 'acknowledged' && saved.invitation.event_id !== scope.eventId)) {
    throw new Error('InvitationRevocation owner mismatch');
  }
  return saved;
}
/** Reading saved work must never revoke an invitation. */
export const loadInvitationRevocationOperation = (scope: InvitationRevocationScope) => ordered(scope, () => read(scope));
async function prepare(scope: InvitationRevocationScope, intent: InvitationRevocationIntent) {
  return ordered(scope, async () => {
    const parsed = invitationRevocationIntentSchema.parse(intent);
    const previous = await read(scope);
    if (previous?.status === 'rejected') throw new Error('Rejected revocation needs review');
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new Error('Pending invitation revocation request differs');
      return previous;
    }
    const saved = savedSchema.parse({ ...scope, schemaVersion: 1, status: 'pending', intent: parsed,
      key: mutationIdempotencyKey('mobile-invitation-revoke') });
    if (!await saveCreationDraft(draftScope(scope), saved)) throw new Error('InvitationRevocation request not saved');
    return saved;
  });
}
async function run(scope: InvitationRevocationScope, current: () => boolean, reserve: () => Promise<SavedInvitationRevocationOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!current() || active.has(owner)) throw new Error('InvitationRevocation inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!current()) throw new Error('InvitationRevocation departed');
    if (pending?.status !== 'pending') throw new Error('No pending invitation revocation request');
    let response: Awaited<ReturnType<typeof revokeOrganizerInvitation>>;
    try {
      response = await revokeOrganizerInvitation(scope.eventId, pending.intent, pending.key);
    } catch (error) {
      // Only the server's after-replay state refusal proves this exact request did not apply.
      if (error instanceof ApiResponseError && error.status === 422
        && error.code === 'EVENT_REGISTRATION_VALIDATION_FAILED' && error.field === 'invitation_state') {
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (saved?.status !== 'pending' || saved.key !== pending.key) throw new Error('Revocation rejection mismatch');
          if (!await saveCreationDraft(draftScope(scope), { ...saved, status: 'rejected' })) throw new Error('Rejection not saved');
        });
      }
      throw error;
    }
    await ordered(scope, async () => {
      const saved = await read(scope);
      const receipt = revokedInvitationSchema.parse(response.data.invitation);
      const intent = pending.intent;
      if (saved?.status !== 'pending' || saved.key !== pending.key || receipt.event_id !== scope.eventId
        || response.data.changed === response.data.idempotent_replay
        || receipt.id !== intent.invitationId) throw new Error('InvitationRevocation receipt mismatch');
      // Keep the minimal validated result even after departure, without storing personal data.
      const acknowledged = savedSchema.parse({ ...scope, schemaVersion: 1, key: saved.key, status: 'acknowledged', invitation: receipt });
      if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new Error('InvitationRevocation receipt not saved');
    });
    return response;
  } finally { active.delete(owner); }
}
/** The caller must obtain explicit confirmation of revocation before invoking this. */
export const executeInvitationRevocationOperation = (scope: InvitationRevocationScope, intent: InvitationRevocationIntent, current: () => boolean) =>
  run(scope, current, () => prepare(scope, intent));
export const recoverInvitationRevocationOperation = (scope: InvitationRevocationScope, current: () => boolean) =>
  run(scope, current, () => loadInvitationRevocationOperation(scope));

/** Read-only explicit review cannot discard an uncertain request. */
export async function reviewInvitationRevocationOperation(scope: InvitationRevocationScope, key: string, current: () => boolean) {
  const rejected = await loadInvitationRevocationOperation(scope);
  if (!current() || rejected?.status !== 'rejected' || rejected.key !== key) throw new Error('No rejected revocation');
  const seen = new Set<number>(); let page: number | null = 1;
  while (page !== null) {
    if (!current() || seen.has(page)) throw new Error('Review departed or invalid pagination');
    seen.add(page);
    const { data } = await getOrganizerInvitations(scope.eventId, page, 100);
    if (!current() || data.event_id !== scope.eventId || !data.permissions.manage_invitations) throw new Error('Review unavailable');
    const invitation = data.invitations.find(item => item.id === rejected.intent.invitationId);
    if (invitation) {
      if (invitation.event_id !== scope.eventId) throw new Error('Review owner mismatch');
      await ordered(scope, async () => {
        const saved = await read(scope);
        if (!current() || saved?.status !== 'rejected' || saved.key !== key) throw new Error('Review mismatch');
        const reviewed = savedSchema.parse({ ...scope, schemaVersion: 1, key, status: 'review',
          invitationId: invitation.id, invitationVersion: invitation.invitation_version });
        if (!await saveCreationDraft(draftScope(scope), reviewed)) throw new Error('Review not saved');
      });
      return invitation;
    }
    page = data.pagination.next_page;
  }
  throw new Error('Invitation no longer available');
}
