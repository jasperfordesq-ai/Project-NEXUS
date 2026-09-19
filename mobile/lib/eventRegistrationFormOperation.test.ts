// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { storage } from './storage';
import { ApiResponseError } from './api/client';
import { getEvent } from './api/events';
import * as FileSystem from 'expo-file-system/legacy';
jest.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(require('crypto').randomBytes(size)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///private/', EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(), writeAsStringAsync: jest.fn(), readAsStringAsync: jest.fn(), deleteAsync: jest.fn() }));
jest.mock('./api/events', () => ({ getEvent: jest.fn() }));
import { mutateOrganizerRegistrationForm as mutate, getOrganizerRegistrationForms as get, type RegistrationFormIntent } from './api/eventRegistration';
import { executeRegistrationFormOperation as execute, recoverRegistrationFormOperation as recover,
  loadRegistrationFormOperation as load, reviewRejectedRegistrationForm as review } from './eventRegistrationFormOperation';
jest.mock('./storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
jest.mock('./api/eventRegistration', () => ({ ...jest.requireActual('./api/eventRegistration'), mutateOrganizerRegistrationForm: jest.fn(), getOrganizerRegistrationForms: jest.fn() }));
const values = new Map<string, string>();
const files = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, eventId: 42 };
const question = { stable_key: 'help', question_type: 'short_text' as const, prompt: 'How can we help?',
  is_required: false, data_classification: 'internal' as const, purpose: 'Prepare event', retention_days: 30 };
const definition = { name: 'Registration', description: null, questions: [question] };
const intent: RegistrationFormIntent = { action: 'create', settingsRevision: 1, definition };
const receipt = () => ({ data: { form: { ...definition, id: 10, event_id: 42, revision: 1,
  version_number: 1, status: 'draft' as const, questions: [{ ...question, id: 11, position: 1 }] },
  settings_revision: 2, changed: true, idempotent_replay: false } });
beforeEach(() => {
  jest.resetAllMocks(); values.clear(); files.clear();
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path, value) => { files.set(path, value); });
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async path => {
    const value = files.get(path); if (value === undefined) throw new Error('Missing file'); return value;
  });
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async path => { files.delete(path); });
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => values.has(key) ? JSON.parse(values.get(key)!) : null);
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
  jest.mocked(mutate).mockResolvedValue(receipt());
  jest.mocked(getEvent).mockResolvedValue({ data: { id: 42, permissions: { manage_registration: true } } } as never);
});
it('persists before dispatch and recovers the exact original form request and key', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => {
    expect(await load(scope)).toMatchObject({ status: 'pending', intent });
    throw new Error('Lost response');
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  await load(scope);
  expect(mutate).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', formId: 10, settingsRevision: 2 });
});
it('never replaces an unresolved draft with different input', async () => {
  jest.mocked(mutate).mockRejectedValueOnce(new Error('Offline'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  await expect(execute(scope, { action: 'publish', formId: 10, formRevision: 1, settingsRevision: 2 }, () => true))
    .rejects.toThrow('Pending request differs');
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('persists and recovers a valid full-length consent form beyond the old chunk limit', async () => {
  const consent = { ...question, question_type: 'consent' as const, displayed_text: 'Consent.'.repeat(2500), displayed_text_version: 'v1' };
  const largeIntent: RegistrationFormIntent = { ...intent, definition: { ...definition, questions: [consent] } };
  const response: Awaited<ReturnType<typeof mutate>> = receipt();
  response.data.form.questions = [{ ...consent, id: 11, position: 1 }];
  jest.mocked(mutate).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(response);
  await expect(execute(scope, largeIntent, () => true)).rejects.toThrow('Offline');
  expect(await load(scope)).toMatchObject({ status: 'pending', intent: largeIntent });
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it.each(['tenantId', 'userId', 'eventId'] as const)('isolates %s', async field => {
  await execute(scope, intent, () => true);
  expect(await load({ ...scope, [field]: scope[field] + 1 })).toBeNull();
});
it('requires persistence before transport', async () => {
  jest.mocked(storage.set).mockRejectedValueOnce(new Error('Storage full'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(mutate).not.toHaveBeenCalled();
});
it('rechecks screen ownership before dispatch', async () => {
  let calls = 0;
  await expect(execute(scope, intent, () => ++calls === 1)).rejects.toThrow('Departed');
  expect(mutate).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('prevents overlapping requests and acknowledges success after departure', async () => {
  let finish!: (value: ReturnType<typeof receipt>) => void;
  const started = new Promise<void>(resolve => jest.mocked(mutate).mockImplementationOnce(() => {
    resolve(); return new Promise(done => { finish = done; });
  }));
  let current = true;
  const first = execute(scope, intent, () => current);
  await started;
  await expect(recover(scope, () => true)).rejects.toThrow('Inactive or busy');
  current = false; finish(receipt()); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it.each(['event', 'settings', 'form', 'revision'] as const)('retains pending request for mismatched %s receipt', async mismatch => {
  const response = receipt();
  if (mismatch === 'event') response.data.form.event_id = 99;
  if (mismatch === 'settings') response.data.settings_revision = 1;
  if (mismatch === 'form') response.data.form.id = 99;
  const update: RegistrationFormIntent = { action: 'update', formId: 10, formRevision: 1, settingsRevision: 1, definition };
  response.data.form.revision = mismatch === 'revision' ? 1 : 2;
  jest.mocked(mutate).mockResolvedValue(response);
  await expect(execute(scope, update, () => true)).rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('retains recovery if the receipt cannot be persisted', async () => {
  jest.mocked(mutate).mockImplementationOnce(async () => {
    jest.mocked(storage.set).mockRejectedValueOnce(new Error('Storage full'));
    return receipt();
  });
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it.each(['fork', 'publish'] as const)('recovers %s with its original revisions and key', async action => {
  const operation: RegistrationFormIntent = action === 'fork'
    ? { action, formId: 8, settingsRevision: 1 }
    : { action, formId: 10, formRevision: 1, settingsRevision: 1 };
  const response: Awaited<ReturnType<typeof mutate>> = receipt();
  response.data.form.revision = 2;
  if (action === 'publish') response.data.form.status = 'published';
  jest.mocked(mutate).mockRejectedValueOnce(new Error('Lost')).mockResolvedValueOnce(response);
  await expect(execute(scope, operation, () => true)).rejects.toThrow();
  await recover(scope, () => true);
  expect(jest.mocked(mutate).mock.calls[1]).toEqual(jest.mocked(mutate).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', formId: 10 });
});
it('rejects a fork receipt which identifies the source form', async () => {
  await expect(execute(scope, { action: 'fork', formId: 10, settingsRevision: 1 }, () => true))
    .rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('never acknowledges publication from a draft-form response', async () => {
  const response = receipt(); response.data.form.revision = 2;
  jest.mocked(mutate).mockResolvedValue(response);
  await expect(execute(scope, { action: 'publish', formId: 10, formRevision: 1, settingsRevision: 1 }, () => true))
    .rejects.toThrow('Receipt mismatch');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
const fresh = () => ({ data: { settings: { id: 1, event_id: 42, revision: 4, status: 'published' as const,
  approval_mode: 'auto' as const, form_state: 'draft' as const, published_form_version: null, per_member_limit: 1,
  guests_enabled: false, max_guests_per_registration: 0, guest_retention_days: 30,
  opens_at_utc: null, closes_at_utc: null, cancellation_cutoff_at_utc: null, event_timezone_snapshot: 'UTC' },
  forms: [receipt().data.form] } });
async function reject(field = 'expected_revision') {
  jest.mocked(mutate).mockRejectedValueOnce(new ApiResponseError(409, 'Conflict', undefined, 'EVENT_REGISTRATION_CONFLICT', field));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  return (await load(scope))!;
}
it.each(['expected_revision', 'expected_form_revision', 'form_status'])('preserves a definitively rejected draft (%s)', async field => {
  await reject(field);
  expect(await load(scope)).toMatchObject({ status: 'rejected', intent });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending request');
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Rejected request needs review');
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('reviews without mutation and requires the refreshed revision with a new key', async () => {
  const previous = await reject();
  jest.mocked(get).mockResolvedValue(fresh());
  await review(scope, previous.key, () => true);
  expect(await load(scope)).toMatchObject({ status: 'review', intent, settings: { revision: 4 } });
  expect(mutate).toHaveBeenCalledTimes(1);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Review revision mismatch');
  const response = receipt(); response.data.settings_revision = 5;
  jest.mocked(mutate).mockResolvedValue(response);
  await execute(scope, { ...intent, settingsRevision: 4 }, () => true);
  expect(jest.mocked(mutate).mock.calls[1][2]).not.toBe(previous.key);
});
it.each(['permission', 'storage', 'departed', 'foreign'] as const)('preserves rejection when review fails: %s', async failure => {
  const previous = await reject();
  const response = fresh();
  if (failure === 'foreign') response.data.forms[0].event_id = 99;
  jest.mocked(get).mockResolvedValue(response);
  if (failure === 'permission') jest.mocked(getEvent).mockResolvedValue({ data: { id: 42, permissions: { manage_registration: false } } } as never);
  if (failure === 'storage') jest.mocked(storage.set).mockRejectedValueOnce(new Error('Full'));
  let calls = 0;
  await expect(review(scope, previous.key, () => failure !== 'departed' || ++calls === 1)).rejects.toThrow();
  expect(await load(scope)).toEqual(previous);
});
it('keeps generic conflicts uncertain and refuses to turn them into reviewed drafts', async () => {
  const previous = await reject('idempotency_key');
  expect(previous.status).toBe('pending');
  jest.mocked(get).mockResolvedValue(fresh());
  await expect(review(scope, previous.key, () => true)).rejects.toThrow('Review mismatch');
  expect(await load(scope)).toEqual(previous);
});
it.each(['stale', 'published', 'missing', 'fork_draft'] as const)('blocks invalid reviewed form selection: %s', async failure => {
  const previous = await reject();
  const response: Awaited<ReturnType<typeof get>> = fresh();
  if (failure === 'published') response.data.forms[0].status = 'published';
  if (failure === 'missing') response.data.forms = [];
  jest.mocked(get).mockResolvedValue(response);
  await review(scope, previous.key, () => true);
  const operation: RegistrationFormIntent = failure === 'fork_draft'
    ? { action: 'fork', formId: 10, settingsRevision: 4 }
    : { action: 'update', formId: 10, formRevision: failure === 'stale' ? 2 : 1, settingsRevision: 4, definition };
  await expect(execute(scope, operation, () => true)).rejects.toThrow(/Review (form|source) mismatch/);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(await load(scope)).toMatchObject({ status: 'review', intent });
});
