// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
import { loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { mutateOrganizerInvitationCampaign as mutate, getOrganizerInvitationCampaigns as campaigns } from './api/eventRegistration';
import { executeInvitationCampaignOperation as execute, recoverInvitationCampaignOperation as recover, loadInvitationCampaignOperation as load, reviewInvitationCampaignOperation as review } from './eventInvitationCampaignOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn() }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'), mutateOrganizerInvitationCampaign: jest.fn(), getOrganizerInvitationCampaigns: jest.fn() }));
jest.mock('./api/events', () => ({ getEvent: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const intent = { action: 'preview' as const, campaignType: 'csv' as const, source: { csv: 'email\nsynthetic@example.invalid' }, defaultLocale: 'en' as const };
const receipt = { data: { campaign: { id: 12, event_id: 42, campaign_type: 'csv' as const, status: 'previewed' as const,
  revision: 1, preview_count: 1, valid_count: 1, error_count: 0, preview_errors: [], default_locale: 'en' }, changed: true, idempotent_replay: false } };
const values = new Map<string, unknown>();
beforeEach(() => {
  jest.clearAllMocks(); values.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async owner => values.get(JSON.stringify(owner)) ?? null);
  jest.mocked(saveCreationDraft).mockImplementation(async (owner, value) => { values.set(JSON.stringify(owner), JSON.parse(JSON.stringify(value))); return true; });
  jest.mocked(mutate).mockResolvedValue(receipt);
});
it('saves before sending, never sends on load, and explicitly replays the original key', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => { expect(await load(scope)).toMatchObject({ status: 'pending', intent }); throw new Error('Lost response'); });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  await load(scope); expect(mutate).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', campaignId: 12 });
  expect(await load(scope)).not.toHaveProperty('intent');
});
it('preserves uncertain work and blocks replacement', async () => {
  jest.mocked(mutate).mockRejectedValue(new Error('Conflict'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(execute(scope, { ...intent, source: { csv: 'different' } }, () => true)).rejects.toThrow('Pending request differs');
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('requires durable storage and current ownership before dispatch', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Request not saved');
  expect(mutate).not.toHaveBeenCalled();
  let checks = 0;
  await expect(execute(scope, intent, () => ++checks === 1)).rejects.toThrow('Departed');
  expect(mutate).not.toHaveBeenCalled(); expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('blocks concurrent requests and saves a confirmed receipt after departure', async () => {
  let finish!: (value: typeof receipt) => void;
  const started = new Promise<void>(resolve => jest.mocked(mutate).mockImplementationOnce(() => { resolve(); return new Promise(done => { finish = done; }); }));
  let current = true; const first = execute(scope, intent, () => current); await started;
  await expect(execute(scope, intent, () => true)).rejects.toThrow('busy');
  current = false; finish(receipt); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it.each(['tenantId', 'userId', 'eventId'] as const)('isolates %s', async field => {
  await execute(scope, intent, () => true); expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('keeps the pending request when storing a receipt fails', async () => {
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); return true; }).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Receipt not saved');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('rejects a receipt for a different event without dropping the pending request', async () => {
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, campaign: { ...receipt.data.campaign, event_id: 99 } } });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});

it.each([
  ['issue', 'issued', 3], ['schedule', 'scheduled', 2], ['cancel', 'cancelled', 2],
] as const)('acknowledges a correlated %s receipt', async (action, status, revision) => {
  const operation = action === 'issue' ? { action, campaignId: 12, expectedRevision: 1, expiresAt: '2027-01-01T00:00:00Z' }
    : action === 'schedule' ? { action, campaignId: 12, expectedRevision: 1, scheduledFor: '2027-01-01T00:00:00Z' }
      : { action, campaignId: 12, expectedRevision: 1, reason: 'Synthetic cancellation' };
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, campaign: { ...receipt.data.campaign, status, revision } } });
  await execute(scope, operation, () => true);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', campaignId: 12, campaignRevision: revision });
});

const cancellation = { action: 'cancel' as const, campaignId: 12, expectedRevision: 1, reason: 'Synthetic cancellation' };
const conflict = (field?: string) => new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT', field);
const reviewedCampaign = { ...receipt.data.campaign, revision: 2, status: 'scheduled' as const };
function mockReview() {
  jest.mocked(campaigns).mockResolvedValue({ data: { campaigns: [reviewedCampaign], pagination: { campaigns: { page: 1, per_page: 100, total: 1, page_count: 1, from: 1, to: 1, has_more: false, last_page: 1, next_page: null, previous_page: null } } } });
  jest.mocked(getEvent).mockResolvedValue({ data: { id: 42, permissions: { manage_registration: true } } } as Awaited<ReturnType<typeof getEvent>>);
}
async function rejectCancellation() {
  jest.mocked(mutate).mockRejectedValueOnce(conflict('expected_campaign_revision'));
  await expect(execute(scope, cancellation, () => true)).rejects.toThrow();
  const saved = await load(scope); expect(saved?.status).toBe('rejected'); return saved!.key;
}
it('requires explicit current review before replacing a rejected request and binds its revision', async () => {
  const key = await rejectCancellation(); mockReview();
  await expect(execute(scope, cancellation, () => true)).rejects.toThrow('needs review');
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
  expect(await review(scope, key, () => true)).toEqual(reviewedCampaign);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(await load(scope)).toMatchObject({ status: 'review', key, campaignRevision: 2 });
  expect(await load(scope)).not.toHaveProperty('intent');
  await expect(execute(scope, cancellation, () => true)).rejects.toThrow('revision mismatch');
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, campaign: { ...reviewedCampaign, status: 'cancelled', revision: 3 } } });
  await execute(scope, { ...cancellation, expectedRevision: 2 }, () => true);
  expect(jest.mocked(mutate).mock.calls[1][2]).not.toBe(key);
});
it.each([undefined, 'expected_revision'])('keeps uncertain conflict field %s pending and refuses review', async field => {
  jest.mocked(mutate).mockRejectedValueOnce(conflict(field));
  await expect(execute(scope, cancellation, () => true)).rejects.toThrow();
  const saved = await load(scope);
  await expect(review(scope, saved!.key, () => true)).rejects.toThrow('No rejected');
  expect(saved?.status).toBe('pending'); expect(campaigns).not.toHaveBeenCalled();
});
it('does not treat a preview conflict as a rejected campaign operation', async () => {
  jest.mocked(mutate).mockRejectedValueOnce(conflict('expected_campaign_revision'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect((await load(scope))?.status).toBe('pending');
});
it('retains rejection when review loses permission, departs or cannot persist', async () => {
  const key = await rejectCancellation(); mockReview();
  jest.mocked(getEvent).mockResolvedValueOnce({ data: { id: 42, permissions: { manage_registration: false } } } as Awaited<ReturnType<typeof getEvent>>);
  await expect(review(scope, key, () => true)).rejects.toThrow('unavailable');
  await expect(review(scope, key, () => false)).rejects.toThrow();
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(review(scope, key, () => true)).rejects.toThrow('Review not saved');
  expect((await load(scope))?.status).toBe('rejected');
});
it('finds later campaigns and rejects a pagination cycle', async () => {
  const key = await rejectCancellation(); mockReview();
  const emptyPage = { data: { campaigns: [], pagination: { campaigns: { page: 1, per_page: 100, total: 101, page_count: 0, from: null, to: null, has_more: true, last_page: 2, next_page: 2, previous_page: null } } } };
  jest.mocked(campaigns).mockResolvedValueOnce(emptyPage);
  await review(scope, key, () => true);
  expect(campaigns).toHaveBeenLastCalledWith(42, 2, 100);
  jest.mocked(mutate).mockRejectedValueOnce(conflict('expected_campaign_revision'));
  await expect(execute(scope, { ...cancellation, expectedRevision: 2 }, () => true)).rejects.toThrow();
  const nextKey = (await load(scope))!.key;
  jest.mocked(campaigns).mockResolvedValue(emptyPage);
  await expect(review(scope, nextKey, () => true)).rejects.toThrow('invalid pagination');
});

jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));
