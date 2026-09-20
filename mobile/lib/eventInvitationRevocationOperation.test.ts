// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { revokeOrganizerInvitation as mutate } from './api/eventRegistration';
import { executeInvitationRevocationOperation as execute, recoverInvitationRevocationOperation as recover, loadInvitationRevocationOperation as load } from './eventInvitationRevocationOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn() }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'), revokeOrganizerInvitation: jest.fn() }));
jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const instant = '2027-01-01T12:00:00Z';
const other = { invitationId: 10, reason: 'Duplicate invitation' };
const apply = { invitationId: 9, reason: 'Duplicate invitation' };
const receipt = { data: { invitation: { id: 9, event_id: 42, campaign_id: 3, status: 'revoked' as const,
  invitation_version: 2, revoked_at: instant }, changed: true, idempotent_replay: false } };
const values = new Map<string, unknown>();
beforeEach(() => {
  jest.clearAllMocks(); values.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async owner => values.get(JSON.stringify(owner)) ?? null);
  jest.mocked(saveCreationDraft).mockImplementation(async (owner, value) => { values.set(JSON.stringify(owner), JSON.parse(JSON.stringify(value))); return true; });
  jest.mocked(mutate).mockResolvedValue(receipt);
});
it('persists before revocation, never sends on read, and recovers the exact original key', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => { expect(await load(scope)).toMatchObject({ status: 'pending', intent: apply }); throw new Error('Lost response'); });
  await expect(execute(scope, apply, () => true)).rejects.toThrow('Lost response');
  const pending = await load(scope); expect(mutate).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', key: pending!.key, invitation: receipt.data.invitation });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
  expect(mutate).toHaveBeenCalledTimes(2);
});
it('does not replace an uncertain revocation with another invitation or reason', async () => {
  jest.mocked(mutate).mockRejectedValue(new Error('Uncertain'));
  await expect(execute(scope, apply, () => true)).rejects.toThrow();
  await expect(execute(scope, other, () => true)).rejects.toThrow('request differs');
  await expect(execute(scope, { ...apply, reason: 'Changed reason' }, () => true)).rejects.toThrow('request differs');
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('requires durable storage and active ownership before dispatch', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, apply, () => true)).rejects.toThrow('request not saved');
  let checks = 0;
  await expect(execute(scope, apply, () => ++checks === 1)).rejects.toThrow('departed');
  expect(mutate).not.toHaveBeenCalled(); expect((await load(scope))?.status).toBe('pending');
});
it('blocks overlapping submissions and persists a late receipt without revoking again', async () => {
  let finish!: (value: typeof receipt) => void;
  const started = new Promise<void>(resolve => jest.mocked(mutate).mockImplementationOnce(() => { resolve(); return new Promise(done => { finish = done; }); }));
  let active = true;
  const first = execute(scope, apply, () => active); await started;
  await expect(execute(scope, apply, () => true)).rejects.toThrow('busy');
  active = false; finish(receipt); await first;
  expect((await load(scope))?.status).toBe('acknowledged'); expect(mutate).toHaveBeenCalledTimes(1);
});
it.each(['tenantId', 'userId', 'eventId'] as const)('separates saved work by %s', async field => {
  await execute(scope, apply, () => true);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('keeps pending work if receipt persistence fails', async () => {
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); return true; }).mockResolvedValueOnce(false);
  await expect(execute(scope, apply, () => true)).rejects.toThrow('receipt not saved');
  expect((await load(scope))?.status).toBe('pending');
});
it.each([{ event_id: 99 }, { id: 10 }, { invitation_version: 1 }])('rejects mismatched receipt %j without discarding the request', async changes => {
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, invitation: { ...receipt.data.invitation, ...changes } } });
  await expect(execute(scope, apply, () => true)).rejects.toThrow();
  expect((await load(scope))?.status).toBe('pending');
});
it('normalises reason whitespace but assigns a new key for a later confirmed invitation', async () => {
  await execute(scope, { ...apply, reason: '  Duplicate invitation  ' }, () => true);
  expect(jest.mocked(mutate).mock.calls[0][1]).toEqual(apply);
  jest.mocked(mutate).mockResolvedValueOnce({ data: { ...receipt.data, invitation: { ...receipt.data.invitation, id: 10 } } });
  await execute(scope, other, () => true);
  expect(jest.mocked(mutate).mock.calls[0][2]).not.toBe(jest.mocked(mutate).mock.calls[1][2]);
  const saved = await load(scope); expect(saved).not.toHaveProperty('intent');
});
it('refuses corrupted owner data before sending', async () => {
  jest.mocked(loadCreationDraft).mockResolvedValue({ ...scope, userId: 999, schemaVersion: 1, status: 'pending', intent: apply, key: 'wrong-owner' });
  await expect(recover(scope, () => true)).rejects.toThrow('owner mismatch');
  expect(mutate).not.toHaveBeenCalled();
});
