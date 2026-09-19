// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { storage } from './storage';
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
jest.mock('./api/events', () => ({ getEvent: jest.fn() }));
import { saveOrganizerRegistrationSettings as save, publishOrganizerRegistrationSettings as publish, getOrganizerRegistrationSettings as get } from './api/eventRegistration';
import { executeRegistrationSettingsOperation as execute, recoverRegistrationSettingsOperation as recover,
  loadRegistrationSettingsOperation as load, reviewRejectedRegistrationSettings as review } from './eventRegistrationSettingsOperation';
jest.mock('./storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'),
  saveOrganizerRegistrationSettings: jest.fn(), publishOrganizerRegistrationSettings: jest.fn(), getOrganizerRegistrationSettings: jest.fn() }));
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const input = { approval_mode: 'manual' as const, per_member_limit: 1, guests_enabled: false,
  max_guests_per_registration: 0, guest_retention_days: 30, opens_at_utc: null, closes_at_utc: null,
  cancellation_cutoff_at_utc: null, expected_revision: 0 };
const intent = { action: 'save' as const, input };
const receipt = () => ({ data: { settings: { ...input, id: 1, event_id: 42, revision: 1,
  status: 'draft' as const, form_state: 'none' as const, published_form_version: null,
  event_timezone_snapshot: 'UTC' }, changed: true, idempotent_replay: false } });
const values = new Map<string, string>();
beforeEach(() => {
  jest.resetAllMocks(); values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
  jest.mocked(save).mockResolvedValue(receipt());
  jest.mocked(getEvent).mockResolvedValue({ data: { id: 42, permissions: { manage_registration: true }, schedule: { start_at: '2030-07-20T10:00:00Z', timezone: 'Europe/Dublin' } } } as never);
});
it('retains exact payload and key after uncertain transport for explicit recovery', async () => {
  jest.mocked(save).mockRejectedValueOnce(new Error('Connection lost'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Connection lost');
  const pending = await load(scope);
  expect(pending).toMatchObject({ status: 'pending', intent });
  expect(save).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(save).mock.calls[1]).toEqual(jest.mocked(save).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', settingsRevision: 1 });
});
it('blocks replacement of unresolved intent', async () => {
  jest.mocked(save).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(execute(scope, { action: 'publish', expectedRevision: 1 }, () => true)).rejects.toThrow('Pending request differs');
  expect(publish).not.toHaveBeenCalled();
});
it.each(['tenantId', 'userId', 'eventId'] as const)('isolates %s', async field => {
  await execute(scope, intent, () => true);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('fails closed before transport when persistence fails', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});
it('blocks overlapping dispatch and persists acknowledgement after departure', async () => {
  let finish!: (value: ReturnType<typeof receipt>) => void;
  const started = new Promise<void>(resolve => jest.mocked(save).mockImplementationOnce(() => {
    resolve(); return new Promise(done => { finish = done; });
  }));
  let current = true;
  const first = execute(scope, intent, () => current);
  await started;
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Inactive or busy');
  current = false; finish(receipt()); await first;
  expect(save).toHaveBeenCalledTimes(1);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it('rejects foreign-event and stale receipts while retaining recovery', async () => {
  jest.mocked(save).mockResolvedValueOnce({ data: { ...receipt().data, settings: { ...receipt().data.settings, event_id: 99 } } });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('rechecks visit ownership after saving and before transport', async () => {
  let calls = 0;
  await expect(execute(scope, intent, () => ++calls === 1)).rejects.toThrow('Departed');
  expect(save).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('replays publishing with the original revision and key', async () => {
  const published = { data: { ...receipt().data, settings: { ...receipt().data.settings, revision: 2, status: 'published' as const } } };
  jest.mocked(publish).mockRejectedValueOnce(new Error('Lost')).mockResolvedValueOnce(published);
  await expect(execute(scope, { action: 'publish', expectedRevision: 1 }, () => true)).rejects.toThrow('Lost');
  await recover(scope, () => true);
  expect(jest.mocked(publish).mock.calls[1]).toEqual(jest.mocked(publish).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', settingsRevision: 2 });
});
it('retains pending intent when acknowledgement cannot be saved', async () => {
  jest.mocked(save).mockImplementationOnce(async () => {
    jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
    return receipt();
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('rejects a receipt whose revision has not advanced', async () => {
  const next = { ...intent, input: { ...input, expected_revision: 1 } };
  await expect(execute(scope, next, () => true)).rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it.each([undefined, 'idempotency_key'])('keeps ambiguous conflict pending (%s)', async field => {
  jest.mocked(save).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT', field));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('records a definitive stale-version rejection without erasing the original draft', async () => {
  jest.mocked(save).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT', 'expected_revision'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'rejected', reason: 'stale_revision', intent });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending request');
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Rejected request needs review');
  expect(save).toHaveBeenCalledTimes(1);
});
async function rejected() {
  jest.mocked(save).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT', 'expected_revision'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  return (await load(scope))!;
}
it('reloads a rejected request for review without sending and preserves it across reopening', async () => {
  const previous = await rejected();
  const settings = { ...receipt().data.settings, revision: 4 };
  jest.mocked(get).mockResolvedValue({ data: { settings } });
  await review(scope, previous.key, () => true);
  expect(await load(scope)).toMatchObject({ status: 'review', intent, settings: { id: settings.id, revision: 4, event_id: scope.eventId } });
  expect(save).toHaveBeenCalledTimes(1);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Review revision mismatch');
  jest.mocked(save).mockResolvedValue({ data: { ...receipt().data, settings: { ...settings, revision: 5 } } });
  await execute(scope, { ...intent, input: { ...input, expected_revision: 4 } }, () => true);
  expect(jest.mocked(save).mock.calls[1][2]).not.toBe(previous.key);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', settingsRevision: 5 });
});
it.each(['storage', 'read', 'departed'] as const)('keeps the rejected draft when review fails: %s', async failure => {
  const previous = await rejected();
  jest.mocked(get).mockResolvedValue({ data: { settings: receipt().data.settings } });
  if (failure === 'storage') jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Full'));
  if (failure === 'read') jest.mocked(get).mockRejectedValueOnce(new Error('Offline'));
  let calls = 0;
  await expect(review(scope, previous.key, () => failure !== 'departed' || ++calls === 1)).rejects.toThrow();
  expect(await load(scope)).toEqual(previous);
});
it('never treats an uncertain pending request as rejected', async () => {
  jest.mocked(save).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const previous = (await load(scope))!;
  jest.mocked(get).mockResolvedValue({ data: { settings: receipt().data.settings } });
  await expect(review(scope, previous.key, () => true)).rejects.toThrow('Review mismatch');
  expect(await load(scope)).toEqual(previous);
});
it('keeps the rejected request when fresh event permission is withdrawn', async () => {
  const previous = await rejected();
  jest.mocked(get).mockResolvedValue({ data: { settings: receipt().data.settings } });
  jest.mocked(getEvent).mockResolvedValue({ data: { id: 42, permissions: { manage_registration: false } } } as never);
  await expect(review(scope, previous.key, () => true)).rejects.toThrow('Review mismatch');
  expect(await load(scope)).toEqual(previous);
});
