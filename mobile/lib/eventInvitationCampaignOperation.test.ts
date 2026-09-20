// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { mutateOrganizerInvitationCampaign as mutate } from './api/eventRegistration';
import { executeInvitationCampaignOperation as execute, recoverInvitationCampaignOperation as recover, loadInvitationCampaignOperation as load } from './eventInvitationCampaignOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn() }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'), mutateOrganizerInvitationCampaign: jest.fn() }));
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
