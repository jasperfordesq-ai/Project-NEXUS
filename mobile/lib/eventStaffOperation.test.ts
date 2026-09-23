// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { ApiResponseError } from './api/client';
import { loadCreationDraft, saveCreationDraft, clearCreationDraft } from './creationDraftStore';
import { grantEventStaff, revokeEventStaff } from './api/eventStaff';
import { executeStaffOperation as execute, recoverStaffOperation as recover, loadStaffOperation as load, discardRejectedStaffOperation as discard } from './eventStaffOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn(), clearCreationDraft: jest.fn() }));
jest.mock('./api/eventStaff', () => ({ ...jest.requireActual('./api/eventStaff'), grantEventStaff: jest.fn(), revokeEventStaff: jest.fn() }));
const scope = { tenantId: 2, userId: 3, eventId: 7 };
const intent = { action: 'grant' as const, payload: { user_id: 9, role: 'check_in_staff' as const, expires_at: null } };
const result = { data: { assignment: { id: 8, event_id: 7, member: { id: 9, name: 'Private member' }, role: 'check_in_staff', version: 1 }, changed: true, idempotent_replay: false, history_entry_id: 10 } };
const values = new Map<string, unknown>();
beforeEach(() => {
  jest.clearAllMocks(); values.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async owner => values.get(JSON.stringify(owner)) ?? null);
  jest.mocked(saveCreationDraft).mockImplementation(async (owner, value) => { values.set(JSON.stringify(owner), JSON.parse(JSON.stringify(value))); return true; });
  jest.mocked(clearCreationDraft).mockImplementation(async owner => { values.delete(JSON.stringify(owner)); return true; });
  jest.mocked(grantEventStaff).mockReset().mockResolvedValue(result as never);
  jest.mocked(revokeEventStaff).mockReset().mockResolvedValue(result as never);
});
it('saves before dispatch and reuses the exact key and payload after a lost response', async () => {
  jest.mocked(grantEventStaff).mockImplementationOnce(async () => {
    expect(await load(scope)).toMatchObject({ status: 'pending', intent, attempts: 1 });
    throw new Error('Lost response');
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  const saved = await load(scope);
  expect(grantEventStaff).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(grantEventStaff).mock.calls[1]).toEqual(jest.mocked(grantEventStaff).mock.calls[0]);
  expect(await load(scope)).toEqual({ ...scope, schemaVersion: 1, key: saved!.key, status: 'acknowledged', assignmentId: 8, assignmentVersion: 1, historyEntryId: 10 });
  expect(JSON.stringify(await load(scope))).not.toContain('Private member');
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
  expect(grantEventStaff).toHaveBeenCalledTimes(2);
});
it('uses the same durable recovery path for revocation', async () => {
  jest.mocked(revokeEventStaff).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, { action: 'revoke', assignmentId: 8 }, () => true)).rejects.toThrow('Lost');
  await recover(scope, () => true);
  expect(jest.mocked(revokeEventStaff).mock.calls[1]).toEqual(jest.mocked(revokeEventStaff).mock.calls[0]);
  expect(grantEventStaff).not.toHaveBeenCalled();
});
it.each([
  { action: 'revoke' as const, assignmentId: 8 },
  { ...intent, payload: { ...intent.payload, user_id: 10 } },
  { ...intent, payload: { ...intent.payload, role: 'finance_manager' as const } },
])('never replaces an uncertain operation with %j', async next => {
  jest.mocked(grantEventStaff).mockRejectedValue(new Error('Uncertain'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(execute(scope, next, () => true)).rejects.toThrow('Pending request differs');
  expect(grantEventStaff).toHaveBeenCalledTimes(1);
  expect(revokeEventStaff).not.toHaveBeenCalled();
});
it('does not send if durable storage fails or ownership leaves before dispatch', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('not saved');
  let active = true;
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); active = false; return true; });
  await expect(execute(scope, intent, () => active)).rejects.toThrow('Departed');
  expect(grantEventStaff).not.toHaveBeenCalled();
});
it('serializes overlapping actions and records late receipts for their original owner', async () => {
  let finish!: (value: any) => void;
  const started = new Promise<void>(ready => jest.mocked(grantEventStaff).mockImplementationOnce(() => { ready(); return new Promise(resolve => { finish = resolve; }); }));
  let active = true;
  const first = execute(scope, intent, () => active); await started;
  await expect(execute(scope, intent, () => true)).rejects.toThrow('busy');
  active = false; finish(result); await first;
  expect((await load(scope))?.status).toBe('acknowledged');
  expect(grantEventStaff).toHaveBeenCalledTimes(1);
});
it('does not resurrect an operation purged while the request was in flight', async () => {
  let finish!: (value: any) => void;
  const started = new Promise<void>(ready => jest.mocked(grantEventStaff).mockImplementationOnce(() => { ready(); return new Promise(resolve => { finish = resolve; }); }));
  const task = execute(scope, intent, () => true); await started;
  values.clear(); finish(result);
  await expect(task).rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toBeNull();
});
it.each(['tenantId', 'userId', 'eventId'] as const)('isolates operations by %s', async field => {
  await execute(scope, intent, () => true);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('preserves pending intent when receipt storage fails', async () => {
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (owner, value) => { values.set(JSON.stringify(owner), value); return true; }).mockResolvedValueOnce(false);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('not saved');
  expect((await load(scope))?.status).toBe('pending');
});
it('requires confirmation to discard a definitively rejected first attempt', async () => {
  jest.mocked(grantEventStaff).mockRejectedValueOnce(new ApiResponseError(403, 'Forbidden', undefined, 'EVENT_STAFF_FORBIDDEN'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const saved = await load(scope); expect(saved?.status).toBe('rejected');
  await expect(recover(scope, () => true)).rejects.toThrow('needs review');
  await expect(discard(scope, 'wrong-key', () => true)).rejects.toThrow('No matching');
  await discard(scope, saved!.key, () => true);
  expect(await load(scope)).toBeNull();
  await execute(scope, intent, () => true);
  expect(jest.mocked(grantEventStaff).mock.calls[1][3]).not.toBe(saved!.key);
});
it.each([
  new ApiResponseError(403, 'Forbidden', undefined, 'EVENT_STAFF_FORBIDDEN'),
  new ApiResponseError(422, 'Invalid', undefined, 'EVENT_STAFF_VALIDATION_FAILED'),
  new ApiResponseError(409, 'Conflict', undefined, 'EVENT_STAFF_IDEMPOTENCY_CONFLICT'),
])('never converts a later refusal into proof an uncertain request was not accepted', async error => {
  jest.mocked(grantEventStaff).mockRejectedValueOnce(new Error('Uncertain')).mockRejectedValueOnce(error);
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(recover(scope, () => true)).rejects.toThrow();
  const saved = await load(scope); expect(saved).toMatchObject({ status: 'pending', attempts: 2 });
  await expect(discard(scope, saved!.key, () => true)).rejects.toThrow('No matching');
});
it('allows review when the server rejects expiry after finding no accepted receipt', async () => {
  jest.mocked(grantEventStaff).mockRejectedValueOnce(new Error('Uncertain'))
    .mockRejectedValueOnce(new ApiResponseError(422, 'Expired', undefined, 'EVENT_STAFF_EXPIRY_INVALID', 'expires_at'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'rejected', attempts: 2 });
});
it('does not classify a local response-contract failure as a server rejection', async () => {
  jest.mocked(grantEventStaff).mockRejectedValueOnce(new ApiResponseError(422, 'Drift', undefined, 'EVENT_STAFF_CONTRACT_DRIFT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect((await load(scope))?.status).toBe('pending');
});
it('rejects corrupted owner data without dispatch', async () => {
  jest.mocked(loadCreationDraft).mockResolvedValue({ ...scope, userId: 4, schemaVersion: 1, key: 'saved-key', status: 'pending', intent, attempts: 1 });
  await expect(recover(scope, () => true)).rejects.toThrow('owner mismatch');
  expect(grantEventStaff).not.toHaveBeenCalled();
});
