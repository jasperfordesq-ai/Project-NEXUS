// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { ApiResponseError } from './api/client';
import { loadCreationDraft, saveCreationDraft, clearCreationDraft } from './creationDraftStore';
import { saveEventSafetyDraft, publishEventSafety, archiveEventSafety, recordEventSafetyReview, withdrawEventSafetyReview } from './api/eventSafetyManagement';
import { executeSafetyOperation as execute, recoverSafetyOperation as recover, loadSafetyOperation as load, discardRejectedSafetyOperation as discard, type SafetyOperationIntent } from './eventSafetyOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn(), clearCreationDraft: jest.fn() }));
jest.mock('./api/eventSafetyManagement', () => ({ ...jest.requireActual('./api/eventSafetyManagement'), saveEventSafetyDraft: jest.fn(), publishEventSafety: jest.fn(), archiveEventSafety: jest.fn(), recordEventSafetyReview: jest.fn(), withdrawEventSafetyReview: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const draft = { minimum_age: null, guardian_consent_required: false, minor_age_threshold: null, code_of_conduct_required: true, code_of_conduct_text: 'é'.repeat(50000), code_of_conduct_text_version: 'v1' };
const intent: SafetyOperationIntent = { action: 'draft', payload: draft, expectedRevision: 2 };
const result = { data: { private: 'projection is not retained' } };
const values = new Map<string, unknown>();
beforeEach(() => {
  jest.clearAllMocks(); values.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async owner => values.get(JSON.stringify(owner)) ?? null);
  jest.mocked(saveCreationDraft).mockImplementation(async (owner, value) => { values.set(JSON.stringify(owner), JSON.parse(JSON.stringify(value))); return true; });
  jest.mocked(clearCreationDraft).mockImplementation(async owner => { values.delete(JSON.stringify(owner)); return true; });
  for (const api of [saveEventSafetyDraft, publishEventSafety, archiveEventSafety, recordEventSafetyReview, withdrawEventSafetyReview]) jest.mocked(api).mockReset().mockResolvedValue(result as never);
});
it('persists full exact intent before dispatch, never auto-replays and recovers with the original key', async () => {
  jest.mocked(saveEventSafetyDraft).mockImplementationOnce(async () => {
    expect(await load(scope)).toMatchObject({ status: 'pending', intent, attempts: 1 });
    throw new Error('Lost response');
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  const saved = await load(scope);
  expect(saveEventSafetyDraft).toHaveBeenCalledTimes(1);
  await expect(discard(scope, saved!.key, () => true)).rejects.toThrow('No matching');
  await expect(execute(scope, { action: 'archive', expectedRevision: 3, expectedVersion: 1 }, () => true)).rejects.toThrow('differs');
  await recover(scope, () => true);
  expect(jest.mocked(saveEventSafetyDraft).mock.calls[1]).toEqual(jest.mocked(saveEventSafetyDraft).mock.calls[0]);
  expect(await load(scope)).toEqual({ ...scope, schemaVersion: 1, key: saved!.key, status: 'acknowledged' });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
});
it.each([
  [{ action: 'publish', expectedRevision: 2, expectedVersion: 1 }, publishEventSafety, [7, 2, 1]],
  [{ action: 'archive', expectedRevision: 2, expectedVersion: 1 }, archiveEventSafety, [7, 2, 1]],
  [{ action: 'withdraw', denialId: 8, expectedVersion: 4 }, withdrawEventSafetyReview, [7, 8, 4]],
  [{ action: 'review', payload: { user_id: 9, decision: 'deny', reason_code: 'safety_review', effective_from: '2026-09-23T12:00:00Z', effective_until: null, expected_version: null } }, recordEventSafetyReview, null],
] as const)('recovers %j without requiring the affected member on the returned first page', async (action, api, args) => {
  jest.mocked(api).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, action, () => true)).rejects.toThrow('Lost');
  const saved = await load(scope);
  await recover(scope, () => true);
  expect(jest.mocked(api).mock.calls[1]).toEqual(jest.mocked(api).mock.calls[0]);
  if (args) expect(api).toHaveBeenLastCalledWith(...args, saved!.key);
  expect((await load(scope))?.status).toBe('acknowledged');
});
it('allows confirmed discard of a first conflict, preserving input until then', async () => {
  jest.mocked(saveEventSafetyDraft).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_SAFETY_CONFLICT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const saved = await load(scope); expect(saved).toMatchObject({ status: 'rejected', intent });
  await expect(recover(scope, () => true)).rejects.toThrow('needs review');
  await expect(discard(scope, 'wrong', () => true)).rejects.toThrow('No matching');
  await discard(scope, saved!.key, () => true);
  await execute(scope, intent, () => true);
  expect(jest.mocked(saveEventSafetyDraft).mock.calls[1][3]).not.toBe(saved!.key);
});
it.each([[403, 'EVENT_SAFETY_FORBIDDEN'], [422, 'EVENT_SAFETY_VALIDATION_FAILED'], [422, 'EVENT_SAFETY_CONTRACT_DRIFT'], [503, 'EVENT_SAFETY_UNAVAILABLE']])('retains uncertainty for a potentially post-write %s/%s failure', async (status, code) => {
  jest.mocked(saveEventSafetyDraft).mockRejectedValueOnce(new ApiResponseError(status as number, 'Failure', undefined, code as string));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', intent });
});
it('does not treat a conflict after a lost response as proof of rejection', async () => {
  jest.mocked(saveEventSafetyDraft).mockRejectedValueOnce(new Error('Lost')).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_SAFETY_CONFLICT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', attempts: 2 });
});
it('does not send when persistence fails or ownership departs before dispatch', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('not saved');
  let active = true;
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); active = false; return true; });
  await expect(execute(scope, intent, () => active)).rejects.toThrow('Departed');
  expect(saveEventSafetyDraft).not.toHaveBeenCalled();
});
it('blocks overlapping requests and does not resurrect a purged operation', async () => {
  let finish!: (value: any) => void;
  const started = new Promise<void>(ready => jest.mocked(saveEventSafetyDraft).mockImplementationOnce(() => { ready(); return new Promise(resolve => { finish = resolve; }); }));
  const task = execute(scope, intent, () => true); await started;
  await expect(execute(scope, intent, () => true)).rejects.toThrow('busy');
  values.clear(); finish(result);
  await expect(task).rejects.toThrow('Acknowledgement mismatch');
  expect(await load(scope)).toBeNull();
});
it.each(['tenantId', 'userId', 'eventId'] as const)('isolates %s', async field => {
  await execute(scope, intent, () => true);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('preserves pending intent if acknowledgement cannot be stored', async () => {
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); return true; }).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('not saved');
  expect(await load(scope)).toMatchObject({ status: 'pending', intent });
});
