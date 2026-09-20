// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
import { getOrganizerInvitationCampaigns, invitationCampaignIntentSchema, mutateOrganizerInvitationCampaign, organizerInvitationCampaignSchema, type InvitationCampaignIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191) });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending'), intent: invitationCampaignIntentSchema }).strict(),
  base.extend({ status: z.literal('rejected'), intent: invitationCampaignIntentSchema }).strict(),
  base.extend({ status: z.literal('review'), campaignId: id, campaignRevision: id }).strict(),
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
    if (previous?.status === 'rejected') throw new InvitationCampaignOperationError('Conflict needs review');
    if (previous?.status === 'review' && parsed.action !== 'preview'
      && parsed.campaignId === previous.campaignId && parsed.expectedRevision < previous.campaignRevision) {
      throw new InvitationCampaignOperationError('Review revision mismatch');
    }
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
    let response: Awaited<ReturnType<typeof mutateOrganizerInvitationCampaign>>;
    try {
      response = await mutateOrganizerInvitationCampaign(scope.eventId, pending.intent, pending.key);
    } catch (error) {
      if (pending.intent.action !== 'preview' && error instanceof ApiResponseError && error.status === 409
        && error.code === 'EVENT_REGISTRATION_CONFLICT' && error.field === 'expected_campaign_revision') {
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (saved?.status !== 'pending' || saved.key !== pending.key) throw new InvitationCampaignOperationError('Rejection mismatch');
          if (!await saveCreationDraft(draftScope(scope), { ...saved, status: 'rejected' })) throw new InvitationCampaignOperationError('Rejection not saved');
        });
      }
      throw error;
    }
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

/** Explicit read-only review; uncertain requests cannot be replaced through this path. */
export async function reviewInvitationCampaignOperation(scope: InvitationCampaignScope, key: string, current: () => boolean) {
  const rejected = await loadInvitationCampaignOperation(scope);
  if (!current() || rejected?.status !== 'rejected' || rejected.key !== key || rejected.intent.action === 'preview') {
    throw new InvitationCampaignOperationError('No rejected campaign');
  }
  const campaignId = rejected.intent.campaignId;
  const seen = new Set<number>();
  let page: number | null = 1;
  while (page !== null) {
    if (!current() || seen.has(page)) throw new InvitationCampaignOperationError('Review departed or invalid pagination');
    seen.add(page);
    const { data } = await getOrganizerInvitationCampaigns(scope.eventId, page, 100);
    if (!current()) throw new InvitationCampaignOperationError('Review departed');
    const campaign = data.campaigns.find(item => item.id === campaignId);
    if (campaign) {
      const event = await getEvent(scope.eventId);
      if (!current() || event.data.id !== scope.eventId || !event.data.permissions.manage_registration
        || campaign.event_id !== scope.eventId) throw new InvitationCampaignOperationError('Review unavailable');
      await ordered(scope, async () => {
        const saved = await read(scope);
        if (!current() || saved?.status !== 'rejected' || saved.key !== key) throw new InvitationCampaignOperationError('Review mismatch');
        const reviewed = savedSchema.parse({ ...scope, schemaVersion: 1, key, status: 'review', campaignId, campaignRevision: campaign.revision });
        if (!await saveCreationDraft(draftScope(scope), reviewed)) throw new InvitationCampaignOperationError('Review not saved');
      });
      return campaign;
    }
    page = data.pagination.campaigns.next_page;
  }
  throw new InvitationCampaignOperationError('Campaign no longer available');
}
