// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { invitationCampaignIntentSchema, mutateOrganizerInvitationCampaign, organizerInvitationCampaignSchema, type InvitationCampaignIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191) });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending'), intent: invitationCampaignIntentSchema }).strict(),
  base.extend({ status: z.literal('acknowledged'), campaignId: id, campaignRevision: id }).strict(),
]);
export type InvitationCampaignScope = z.infer<typeof scopeSchema>;
export type SavedInvitationCampaignOperation = z.infer<typeof savedSchema>;
export class InvitationCampaignOperationError extends Error {}
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: InvitationCampaignScope) => `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
function draftScope(scope: InvitationCampaignScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-invitation-campaign', tenantId: scope.tenantId, userId: scope.userId, contextId: String(scope.eventId) };
}
async function ordered<T>(scope: InvitationCampaignScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: InvitationCampaignScope): Promise<SavedInvitationCampaignOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope)) throw new InvitationCampaignOperationError('Owner mismatch');
  return saved;
}
/** Reading saved state never dispatches an invitation operation. */
export function loadInvitationCampaignOperation(scope: InvitationCampaignScope) {
  return ordered(scope, () => read(scope));
}
async function prepare(scope: InvitationCampaignScope, intent: InvitationCampaignIntent) {
  return ordered(scope, async () => {
    const parsed = invitationCampaignIntentSchema.parse(intent);
    const previous = await read(scope);
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new InvitationCampaignOperationError('Pending request differs');
      return previous;
    }
    const pending = savedSchema.parse({ ...scope, schemaVersion: 1, status: 'pending', intent: parsed,
      key: mutationIdempotencyKey('mobile-invitation-campaign') });
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new InvitationCampaignOperationError('Request not saved');
    return pending;
  });
}
async function run(scope: InvitationCampaignScope, isCurrent: () => boolean,
  reserve: () => Promise<SavedInvitationCampaignOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!isCurrent() || active.has(owner)) throw new InvitationCampaignOperationError('Inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!isCurrent()) throw new InvitationCampaignOperationError('Departed');
    if (!pending || pending.status !== 'pending') throw new InvitationCampaignOperationError('No pending request');
    // Conflict, validation and network errors can follow a successful earlier request.
    // Preserve them as uncertain until the server provides definitive non-application evidence.
    const response = await mutateOrganizerInvitationCampaign(scope.eventId, pending.intent, pending.key);
    await ordered(scope, async () => {
      const saved = await read(scope);
      const campaign = organizerInvitationCampaignSchema.parse(response.data.campaign);
      const intent = pending.intent;
      const minimumRevision = intent.action === 'preview' ? 1 : intent.expectedRevision + (intent.action === 'issue' ? 2 : 1);
      if (!saved || saved.status !== 'pending' || saved.key !== pending.key || campaign.event_id !== scope.eventId
        || campaign.revision < minimumRevision || response.data.changed === response.data.idempotent_replay
        || (intent.action === 'preview' ? campaign.campaign_type !== intent.campaignType : campaign.id !== intent.campaignId)
        || (intent.action === 'schedule' && !['scheduled', 'issued', 'cancelled'].includes(campaign.status))
        || (intent.action === 'issue' && campaign.status !== 'issued')
        || (intent.action === 'cancel' && campaign.status !== 'cancelled')) {
        throw new InvitationCampaignOperationError('Receipt mismatch');
      }
      // Acknowledge even after departure, retaining only the receipt, not recipient input.
      const acknowledged = savedSchema.parse({ ...scope, schemaVersion: 1, key: saved.key, status: 'acknowledged',
        campaignId: campaign.id, campaignRevision: campaign.revision });
      if (!await saveCreationDraft(draftScope(scope), acknowledged)) throw new InvitationCampaignOperationError('Receipt not saved');
    });
    return response;
  } finally { active.delete(owner); }
}
export function executeInvitationCampaignOperation(scope: InvitationCampaignScope, intent: InvitationCampaignIntent, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => prepare(scope, intent));
}
export function recoverInvitationCampaignOperation(scope: InvitationCampaignScope, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => loadInvitationCampaignOperation(scope));
}
