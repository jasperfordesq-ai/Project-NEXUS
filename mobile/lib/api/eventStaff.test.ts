// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { api, ApiResponseError } from './client';
import { getEventStaff, grantEventStaff, revokeEventStaff } from './eventStaff';
jest.mock('./client', () => ({ ...jest.requireActual('./client'), api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
const key = 'mobile-event-staff-test';
const payload = { user_id: 9, role: 'check_in_staff' as const, expires_at: '2026-09-25T12:00:00+00:00' };
const history = { id: 10, version: 1, action: 'granted', from_status: null, to_status: 'active', previous_expires_at: null,
  new_expires_at: payload.expires_at, actor_user_id: 3, idempotency_key: key, created_at: '2026-09-23T12:00:00+00:00', immutable: true };
const assignment = { id: 8, event_id: 7, member: { id: 9, name: 'Synthetic member', first_name: null, last_name: null, avatar_url: null },
  role: 'check_in_staff', capabilities: ['manageAttendance'], status: 'active', effective: true, version: 1,
  granted_at: history.created_at, granted_by_user_id: 3, revoked_at: null, revoked_by_user_id: null, expires_at: payload.expires_at, history: [history] };
const mutation = { assignment, changed: true, idempotent_replay: false, history_entry_id: 10 };
beforeEach(() => jest.clearAllMocks());
it('requests inactive assignments and validates event ownership', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [assignment] });
  const response = await getEventStaff(7);
  expect(response.data[0].member.name).toBe('Synthetic member');
  expect(api.get).toHaveBeenCalledWith('/api/v2/events/7/staff', { include_inactive: 'true' });
  jest.mocked(api.get).mockResolvedValue({ data: [{ ...assignment, event_id: 6 }] });
  await expect(getEventStaff(7)).rejects.toMatchObject({ code: 'EVENT_STAFF_CONTRACT_DRIFT' });
});
it('rejects duplicate assignments rather than presenting misleading history', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [assignment, assignment] });
  await expect(getEventStaff(7)).rejects.toBeInstanceOf(ApiResponseError);
});
it('sends the stable grant key and accepts the matching history receipt', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: mutation });
  const response = await grantEventStaff(7, 3, payload, key);
  expect(response.data.changed).toBe(true);
  expect(api.post).toHaveBeenCalledWith('/api/v2/events/7/staff', payload, { headers: { 'Idempotency-Key': key } });
});
it('accepts the original grant receipt even if the role was subsequently revoked', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { ...mutation, changed: false, idempotent_replay: true,
    assignment: { ...assignment, status: 'revoked', effective: false, version: 2 } } });
  const response = await grantEventStaff(7, 3, payload, key);
  expect(response.data.idempotent_replay).toBe(true);
  expect(response.data.assignment.status).toBe('revoked');
});
it.each([
  { actor_user_id: 4 }, { idempotency_key: 'different-request' }, { action: 'revoked' },
  { new_expires_at: null }, { version: 2 }, { to_status: 'revoked' },
])('does not acknowledge a mismatched grant receipt %j', async change => {
  jest.mocked(api.post).mockResolvedValue({ data: { ...mutation, assignment: { ...assignment, history: [{ ...history, ...change }] } } });
  await expect(grantEventStaff(7, 3, payload, key)).rejects.toMatchObject({ code: 'EVENT_STAFF_CONTRACT_DRIFT' });
});
it.each([{ event_id: 8 }, { member: { ...assignment.member, id: 10 } }, { role: 'finance_manager' }])('rejects wrong grant target %j', async change => {
  jest.mocked(api.post).mockResolvedValue({ data: { ...mutation, assignment: { ...assignment, ...change } } });
  await expect(grantEventStaff(7, 3, payload, key)).rejects.toBeInstanceOf(ApiResponseError);
});
it('accepts an unchanged matching grant without inventing a history receipt', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { ...mutation, changed: false, history_entry_id: null } });
  expect((await grantEventStaff(7, 3, payload, key)).data.idempotent_replay).toBe(false);
});
it('rejects missing history on a changed response', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: { ...mutation, history_entry_id: null } });
  await expect(grantEventStaff(7, 3, payload, key)).rejects.toBeInstanceOf(ApiResponseError);
});
it('sends revocation with the same supplied key and accepts the matching receipt', async () => {
  const revoked = { ...assignment, status: 'revoked', effective: false, history: [{ ...history, action: 'revoked', to_status: 'revoked' }] };
  jest.mocked(api.delete).mockResolvedValue({ data: { ...mutation, assignment: revoked } });
  expect((await revokeEventStaff(7, 3, 8, key)).data.assignment.status).toBe('revoked');
  expect(api.delete).toHaveBeenCalledWith('/api/v2/events/7/staff/8', { headers: { 'Idempotency-Key': key } });
});
it('rejects a revocation response for another assignment', async () => {
  jest.mocked(api.delete).mockResolvedValue({ data: mutation });
  await expect(revokeEventStaff(7, 3, 11, key)).rejects.toBeInstanceOf(ApiResponseError);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('makes no request for invalid identity %s', async eventId => {
  await expect(grantEventStaff(eventId, 3, payload, key)).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.post).not.toHaveBeenCalled();
});
it('rejects an empty operation key before sending', async () => {
  await expect(grantEventStaff(7, 3, payload, '')).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.post).not.toHaveBeenCalled();
});
it('preserves a transport failure for durable recovery by the caller', async () => {
  const error = new ApiResponseError(503, 'Unavailable');
  jest.mocked(api.post).mockRejectedValue(error);
  await expect(grantEventStaff(7, 3, payload, key)).rejects.toBe(error);
});
