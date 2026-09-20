// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { mutateOrganizerRetention as mutate } from './api/eventRegistration';
import { executeRetentionOperation as execute, recoverRetentionOperation as recover, loadRetentionOperation as load } from './eventRetentionOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn() }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'), mutateOrganizerRetention: jest.fn() }));
jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const instant = '2027-01-01T12:00:00Z';
const preview = { action: 'preview' as const, asOf: instant };
const apply = { action: 'apply' as const, dryRunId: 8 };
const receipt = { data: { run: { id: 9, event_id: 42, mode: 'apply' as const, dry_run_id: 8,
  as_of_utc: instant, eligible_count: 3, affected_count: 2, completed_at: instant, created_at: instant }, changed: true, idempotent_replay: false } };
const values = new Map<string, unknown>();
beforeEach(() => {
  jest.clearAllMocks(); values.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async owner => values.get(JSON.stringify(owner)) ?? null);
  jest.mocked(saveCreationDraft).mockImplementation(async (owner, value) => { values.set(JSON.stringify(owner), JSON.parse(JSON.stringify(value))); return true; });
  jest.mocked(mutate).mockResolvedValue(receipt);
});
it('persists before apply, never applies on read, and recovers the exact original key', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => { expect(await load(scope)).toMatchObject({ status: 'pending', intent: apply }); throw new Error('Lost response'); });
  await expect(execute(scope, apply, () => true)).rejects.toThrow('Lost response');
  const pending = await load(scope); expect(mutate).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', key: pending!.key, run: receipt.data.run });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
  expect(mutate).toHaveBeenCalledTimes(2);
});
it('does not replace an uncertain apply with a preview or another apply', async () => {
  jest.mocked(mutate).mockRejectedValue(new Error('Uncertain'));
  await expect(execute(scope, apply, () => true)).rejects.toThrow();
  await expect(execute(scope, preview, () => true)).rejects.toThrow('request differs');
  await expect(execute(scope, { ...apply, dryRunId: 10 }, () => true)).rejects.toThrow('request differs');
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('requires durable storage and active ownership before dispatch', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, apply, () => true)).rejects.toThrow('request not saved');
  let checks = 0;
  await expect(execute(scope, apply, () => ++checks === 1)).rejects.toThrow('departed');
  expect(mutate).not.toHaveBeenCalled(); expect((await load(scope))?.status).toBe('pending');
});
it('blocks overlapping submissions and persists a late receipt without applying again', async () => {
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
it.each([{ event_id: 99 }, { dry_run_id: 10 }, { affected_count: 4 }])('rejects mismatched receipt %j without discarding the request', async changes => {
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, run: { ...receipt.data.run, ...changes } } });
  await expect(execute(scope, apply, () => true)).rejects.toThrow();
  expect((await load(scope))?.status).toBe('pending');
});
it('acknowledges preview and assigns a distinct key to a later confirmed apply', async () => {
  jest.mocked(mutate).mockResolvedValueOnce({ data: { ...receipt.data, run: { ...receipt.data.run, id: 8, mode: 'dry_run', dry_run_id: null, affected_count: 0 } } });
  await execute(scope, preview, () => true); await execute(scope, apply, () => true);
  expect(jest.mocked(mutate).mock.calls[0][2]).not.toBe(jest.mocked(mutate).mock.calls[1][2]);
});
it('refuses corrupted owner data before sending', async () => {
  jest.mocked(loadCreationDraft).mockResolvedValue({ ...scope, userId: 999, schemaVersion: 1, status: 'pending', intent: apply, key: 'wrong-owner' });
  await expect(recover(scope, () => true)).rejects.toThrow('owner mismatch');
  expect(mutate).not.toHaveBeenCalled();
});
