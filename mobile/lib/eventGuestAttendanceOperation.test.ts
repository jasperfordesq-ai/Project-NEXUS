// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { storage } from './storage';
import { ApiResponseError } from './api/client';
import { transitionOrganizerRegistrationGuest as mutate, getOrganizerRegistrationGuests as get } from './api/eventRegistration';
import { executeGuestAttendanceOperation as execute, recoverGuestAttendanceOperation as recover,
  loadGuestAttendanceOperation as load, reviewGuestAttendanceOperation as review } from './eventGuestAttendanceOperation';
jest.mock('./storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'),
  transitionOrganizerRegistrationGuest: jest.fn(), getOrganizerRegistrationGuests: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42, guestId: 9 };
const intent = { guestId: 9, action: 'check_in' as const, expectedVersion: 0 };
const receipt = { data: { attendance: { id: 3, event_id: 42, guest_id: 9, attendance_status: 'checked_in' as const, attendance_version: 1 },
  changed: true, replayed: false, history_id: 5 } };
const values = new Map<string, string>();
beforeEach(() => {
  jest.resetAllMocks(); values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
  jest.mocked(mutate).mockResolvedValue(receipt);
});
it('persists before dispatch, loads without sending and recovers the exact request', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => {
    expect(await load(scope)).toMatchObject({ status: 'pending', intent }); throw new Error('Lost response');
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  await load(scope); expect(mutate).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', attendanceVersion: 1, historyId: 5 });
});
it('does not replace uncertain work or automatically treat a generic conflict as rejected', async () => {
  jest.mocked(mutate).mockRejectedValue(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(execute(scope, { ...intent, action: 'no_show' }, () => true)).rejects.toThrow('Pending guest request differs');
  expect(mutate).toHaveBeenCalledTimes(1); expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it.each(['tenantId', 'userId', 'eventId', 'guestId'] as const)('isolates saved %s', async field => {
  await execute(scope, intent, () => true); expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('does not send when local persistence fails', async () => {
  jest.mocked(storage.set).mockRejectedValueOnce(new Error('Disk full'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow(); expect(mutate).not.toHaveBeenCalled();
});
it('rechecks departure after saving before dispatch', async () => {
  let calls = 0;
  await expect(execute(scope, intent, () => ++calls === 1)).rejects.toThrow('departed');
  expect(mutate).not.toHaveBeenCalled(); expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('prevents concurrent mutations and keeps a receipt after departure', async () => {
  let finish!: (value: typeof receipt) => void;
  const started = new Promise<void>(resolve => jest.mocked(mutate).mockImplementationOnce(() => {
    resolve(); return new Promise(done => { finish = done; });
  }));
  let current = true;
  const first = execute(scope, intent, () => current); await started;
  await expect(execute(scope, intent, () => true)).rejects.toThrow('busy');
  current = false; finish(receipt); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' }); expect(mutate).toHaveBeenCalledTimes(1);
});
it('retains pending work if the receipt version is inconsistent', async () => {
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, attendance: { ...receipt.data.attendance, attendance_version: 4 } } });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
async function rejectVersion() {
  jest.mocked(mutate).mockRejectedValueOnce(new ApiResponseError(409, 'Stale', undefined, 'EVENT_REGISTRATION_CONFLICT', 'expected_version'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Stale');
  const saved = await load(scope); expect(saved).toMatchObject({ status: 'rejected' });
  return saved!;
}
function page(number: number, next: number | null, includeGuest: boolean, permitted = true) {
  return { data: { guests: includeGuest ? [{ id: 9, registration_id: 8, guest_number: 1, revision: 1,
    status: 'captured' as const, notification_consent: false, display_name: 'Private name', email: 'private@example.invalid',
    retention_due_at: null, withdrawn_at: null, anonymised_at: null,
    attendance: { id: 3, status: 'checked_in' as const, version: 2, checked_in_at: null, checked_out_at: null, no_show_at: null } }] : [],
  pagination: { guests: { page: number, per_page: 100, total: 101, last_page: 2, page_count: includeGuest ? 1 : 0,
    from: null, to: null, has_more: next !== null, next_page: next, previous_page: number > 1 ? number - 1 : null } },
  permissions: { view_roster: true, view_sensitive_answers: true, manage_attendance: permitted } } };
}
it('reviews a stale version across pages without saving guest contact data', async () => {
  const saved = await rejectVersion();
  await expect(execute(scope, intent, () => true)).rejects.toThrow('needs review');
  jest.mocked(get).mockResolvedValueOnce(page(1, 2, false)).mockResolvedValueOnce(page(2, null, true));
  await review(scope, saved.key, () => true);
  expect(get).toHaveBeenNthCalledWith(2, 42, 2, 100);
  expect(await load(scope)).toMatchObject({ status: 'review', attendanceVersion: 2, key: saved.key, intent });
  expect(JSON.stringify([...values.values()])).not.toContain('Private name');
  expect(JSON.stringify([...values.values()])).not.toContain('private@example.invalid');
  await expect(execute(scope, intent, () => true)).rejects.toThrow('review version mismatch');
  jest.mocked(mutate).mockResolvedValue({ data: { ...receipt.data, attendance: { ...receipt.data.attendance, attendance_version: 3 } } });
  await execute(scope, { ...intent, expectedVersion: 2, action: 'check_out' }, () => true);
  expect(jest.mocked(mutate).mock.calls[1][2]).not.toBe(saved.key);
});
it('does not clear rejected work when permission is lost or the guest disappears', async () => {
  const saved = await rejectVersion();
  jest.mocked(get).mockResolvedValueOnce(page(1, null, true, false));
  await expect(review(scope, saved.key, () => true)).rejects.toThrow('unavailable');
  jest.mocked(get).mockResolvedValueOnce(page(1, null, false));
  await expect(review(scope, saved.key, () => true)).rejects.toThrow('no longer available');
  expect(await load(scope)).toMatchObject({ status: 'rejected', key: saved.key });
});
it('stops malformed pagination without mutation', async () => {
  const saved = await rejectVersion(); jest.mocked(get).mockResolvedValue(page(1, 1, false));
  await expect(review(scope, saved.key, () => true)).rejects.toThrow('invalid pagination');
  expect(get).toHaveBeenCalledTimes(1); expect(mutate).toHaveBeenCalledTimes(1);
});
it('keeps the original pending key when saving a successful receipt fails', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => {
    jest.mocked(storage.set).mockRejectedValueOnce(new Error('Receipt storage failed'));
    return receipt;
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', intent });
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it('ignores a review response arriving after departure', async () => {
  const saved = await rejectVersion(); let current = true;
  jest.mocked(get).mockImplementationOnce(async () => { current = false; return page(1, null, true); });
  await expect(review(scope, saved.key, () => current)).rejects.toThrow('unavailable');
  expect(await load(scope)).toMatchObject({ status: 'rejected', key: saved.key });
});

it('allows explicit review after a definitive invalid-action rejection', async () => {
  jest.mocked(mutate).mockRejectedValueOnce(new ApiResponseError(422, 'Invalid action', undefined, 'EVENT_REGISTRATION_VALIDATION_FAILED', 'attendance_action'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Invalid action');
  const saved = await load(scope); expect(saved).toMatchObject({ status: 'rejected', intent });
  jest.mocked(get).mockResolvedValueOnce(page(1, null, true));
  await review(scope, saved!.key, () => true);
  expect(await load(scope)).toMatchObject({ status: 'review', attendanceVersion: 2 });
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('keeps unmarked validation failures uncertain rather than discarding them', async () => {
  jest.mocked(mutate).mockRejectedValueOnce(new ApiResponseError(422, 'Window closed', undefined, 'EVENT_REGISTRATION_VALIDATION_FAILED'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
