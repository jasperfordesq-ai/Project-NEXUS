// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from './creationDraftStore';
import { ApiResponseError } from './api/client';
import { getEventAgenda } from './api/events';
import { createAgendaSession, updateAgendaSession, cancelAgendaSession, reorderAgendaSessions } from './api/eventAgendaManagement';
import { executeAgendaOperation as execute, recoverAgendaOperation as recover,
  loadAgendaOperation as load, reviewAgendaOperation as review, discardRejectedAgendaOperation as discard, type AgendaOperationIntent } from './eventAgendaOperation';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn(), saveCreationDraft: jest.fn(), clearCreationDraft: jest.fn() }));
jest.mock('./api/eventAgendaManagement', () => ({ createAgendaSession: jest.fn(), updateAgendaSession: jest.fn(),
  cancelAgendaSession: jest.fn(), reorderAgendaSessions: jest.fn() }));
jest.mock('./api/events', () => ({ ...jest.requireActual('./api/events'), getEventAgenda: jest.fn() }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
const agenda = require('../../contracts/events/v2/event-agenda.json');
const session = agenda.sessions[0];
const scope = { tenantId: 2, userId: 7, eventId: agenda.event_id };
const payload = { title: 'Workshop', session_type: 'workshop' as const, visibility: 'public' as const,
  start_at: session.start_at, end_at: session.end_at, timezone: session.timezone, speakers: [], resources: [] };
const create: AgendaOperationIntent = { action: 'create', payload };
const receipt = { data: { session, agenda_version: agenda.agenda_version, changed: true,
  idempotent_replay: false, history_entry_id: 7 } };
const saved = new Map<string, unknown>();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
beforeEach(() => {
  jest.clearAllMocks(); saved.clear();
  jest.mocked(loadCreationDraft).mockImplementation(async key => clone(saved.get(JSON.stringify(key)) ?? null) as never);
  jest.mocked(saveCreationDraft).mockImplementation(async (key, value) => { saved.set(JSON.stringify(key), clone(value)); return true; });
  jest.mocked(clearCreationDraft).mockImplementation(async key => { saved.delete(JSON.stringify(key)); return true; });
  jest.mocked(createAgendaSession).mockResolvedValue(receipt);
  jest.mocked(updateAgendaSession).mockResolvedValue(receipt);
  jest.mocked(cancelAgendaSession).mockResolvedValue(receipt);
  jest.mocked(reorderAgendaSessions).mockResolvedValue({ data: { ...receipt.data, sessions: [session] } });
  jest.mocked(getEventAgenda).mockResolvedValue({ data: { ...agenda, permissions: { manage: true } }, meta: { base_url: 'https://example.org' } });
});
const cases: [AgendaOperationIntent, typeof createAgendaSession | typeof updateAgendaSession | typeof cancelAgendaSession | typeof reorderAgendaSessions][] = [
  [create, createAgendaSession],
  [{ action: 'update', sessionId: session.id, expectedVersion: session.version, payload }, updateAgendaSession],
  [{ action: 'cancel', sessionId: session.id, expectedVersion: session.version, reason: 'Speaker unavailable' }, cancelAgendaSession],
  [{ action: 'reorder', orderedSessionIds: [session.id], expectedAgendaVersion: agenda.agenda_version }, reorderAgendaSessions],
];
it.each(cases)('recovers the exact saved payload/key/version after lost $action response', async (intent, send) => {
  (send as jest.Mock).mockRejectedValueOnce(new Error('Lost response'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost response');
  const pending = await load(scope);
  expect(pending).toMatchObject({ status: 'pending', attempts: 1, intent });
  await load(scope); // Mounting/reopening reads only.
  expect(send).toHaveBeenCalledTimes(1);
  await recover(scope, () => true);
  expect((send as jest.Mock).mock.calls[1]).toEqual((send as jest.Mock).mock.calls[0]);
  expect(await load(scope)).toMatchObject({ status: 'acknowledged', attempts: 2, key: pending?.key });
  await expect(recover(scope, () => true)).rejects.toThrow('No pending');
});
it('does not send unless the intent and attempt marker both persist', async () => {
  jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
  await expect(execute(scope, create, () => true)).rejects.toThrow('not saved');
  expect(createAgendaSession).not.toHaveBeenCalled();
  jest.mocked(saveCreationDraft).mockImplementationOnce(async (key, value) => { saved.set(JSON.stringify(key), clone(value)); return true; })
    .mockResolvedValueOnce(false);
  await expect(execute(scope, create, () => true)).rejects.toThrow('not saved');
  expect(createAgendaSession).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending', attempts: 0 });
});
it('blocks changed input while the original result is uncertain', async () => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  await expect(execute(scope, { ...create, payload: { ...payload, title: 'Changed' } }, () => true)).rejects.toThrow('differs');
  expect(createAgendaSession).toHaveBeenCalledTimes(1);
  expect(await load(scope)).toMatchObject({ intent: create });
});
it('never dispatches for a departed screen or a different owner/event', async () => {
  await expect(execute(scope, create, () => false)).rejects.toThrow('Inactive');
  expect(saveCreationDraft).not.toHaveBeenCalled();
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  for (const field of ['tenantId', 'userId', 'eventId'] as const) {
    await expect(recover({ ...scope, [field]: scope[field] + 1 }, () => true)).rejects.toThrow('No pending');
  }
  expect(createAgendaSession).toHaveBeenCalledTimes(1);
});
it('checks permission/visit again after persistence before sending', async () => {
  let current = true;
  jest.mocked(saveCreationDraft).mockImplementation(async (key, value) => {
    saved.set(JSON.stringify(key), clone(value)); current = false; return true;
  });
  await expect(execute(scope, create, () => current)).rejects.toThrow('Departed');
  expect(createAgendaSession).not.toHaveBeenCalled();
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('prevents concurrent sends and records acceptance even after the view departs', async () => {
  let resolve!: (value: typeof receipt) => void;
  let started!: () => void;
  let current = true;
  const ready = new Promise<void>(done => { started = done; });
  jest.mocked(createAgendaSession).mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
  const first = execute(scope, create, () => current);
  await ready;
  await expect(recover(scope, () => true)).rejects.toThrow('busy');
  current = false; resolve(receipt); await first;
  expect(await load(scope)).toMatchObject({ status: 'acknowledged' });
});
it('keeps a pending identity when the acceptance cannot be saved', async () => {
  jest.mocked(createAgendaSession).mockImplementationOnce(async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false); return receipt;
  });
  await expect(execute(scope, create, () => true)).rejects.toThrow('not saved');
  await recover(scope, () => true);
  expect(jest.mocked(createAgendaSession).mock.calls[1]).toEqual(jest.mocked(createAgendaSession).mock.calls[0]);
});
it.each([[409, 'EVENT_AGENDA_CONFLICT'], [422, 'EVENT_AGENDA_VALIDATION_FAILED']] as const)(
  'preserves a first-attempt definitive %s rejection for explicit review', async (status, code) => {
    jest.mocked(createAgendaSession).mockRejectedValueOnce(new ApiResponseError(status, 'Refused', undefined, code));
    await expect(execute(scope, create, () => true)).rejects.toThrow('Refused');
    const rejected = await load(scope);
    expect(rejected).toMatchObject({ status: 'rejected', code, intent: create });
    await expect(execute(scope, create, () => true)).rejects.toThrow('Review required');
    await review(scope, rejected!.key, () => true);
    expect(createAgendaSession).toHaveBeenCalledTimes(1);
    expect(await load(scope)).toMatchObject({ status: 'review', intent: create });
    await execute(scope, create, () => true);
    expect((await load(scope))?.key).not.toBe(rejected?.key);
  });
it.each([403, 404, 409, 422, 500, 503])('never releases an uncertain earlier attempt after later %s', async status => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Lost'))
    .mockRejectedValueOnce(new ApiResponseError(status, 'Refused', undefined,
      status === 409 ? 'EVENT_AGENDA_CONFLICT' : 'EVENT_AGENDA_VALIDATION_FAILED'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  const original = await load(scope);
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', key: original!.key, attempts: 2 });
  await expect(review(scope, original!.key, () => true)).rejects.toThrow('No rejected');
});
it('keeps rejected input when review access is withdrawn', async () => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new ApiResponseError(409, 'Refused', undefined, 'EVENT_AGENDA_CONFLICT'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  const original = await load(scope);
  jest.mocked(getEventAgenda).mockResolvedValueOnce({ data: { ...agenda, permissions: { manage: false } }, meta: { base_url: 'https://example.org' } });
  await expect(review(scope, original!.key, () => true)).rejects.toThrow('unavailable');
  expect(await load(scope)).toEqual(original);
});
it.each(['update', 'cancel', 'reorder'] as const)('settles an uncertain %s only on an authoritative terminal refusal', async action => {
  const [intent, send] = cases.find(([item]) => item.action === action)!;
  (send as jest.Mock).mockRejectedValueOnce(new Error('Lost response'))
    .mockRejectedValueOnce(Object.assign(new ApiResponseError(409, 'Obsolete', undefined, 'EVENT_AGENDA_CONFLICT'),
      { operationOutcome: 'not_applied' }));
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Lost');
  const pending = await load(scope);
  await expect(recover(scope, () => true)).rejects.toThrow('Obsolete');
  expect(await load(scope)).toMatchObject({ status: 'rejected', intent, key: pending!.key });
  await review(scope, pending!.key, () => true);
  expect(await load(scope)).toMatchObject({ status: 'review', intent });
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not treat a create refusal as proof that an uncertain creation never committed', async () => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Lost'))
    .mockRejectedValueOnce(Object.assign(new ApiResponseError(409, 'Refused', undefined, 'EVENT_AGENDA_CONFLICT'),
      { operationOutcome: 'not_applied' }));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  await expect(recover(scope, () => true)).rejects.toThrow();
  expect(await load(scope)).toMatchObject({ status: 'pending', attempts: 2 });
});
it('rejects corrupt and wrong-owner saved data instead of replacing it', async () => {
  jest.mocked(loadCreationDraft).mockResolvedValueOnce({ schemaVersion: 99 });
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  expect(saveCreationDraft).not.toHaveBeenCalled();
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Lost'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  const pending = await load(scope);
  jest.mocked(loadCreationDraft).mockResolvedValueOnce({ ...pending, userId: 999 });
  await expect(load(scope)).rejects.toThrow('Owner mismatch');
});
it('requires a reviewed current version and the same target before replacing a rejected edit', async () => {
  const intent = { action: 'update' as const, sessionId: session.id, expectedVersion: session.version, payload };
  jest.mocked(updateAgendaSession).mockRejectedValueOnce(new ApiResponseError(409, 'Refused', undefined, 'EVENT_AGENDA_CONFLICT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const original = await load(scope);
  const freshSession = { ...session, version: session.version + 1 };
  jest.mocked(getEventAgenda).mockResolvedValueOnce({ data: { ...agenda, permissions: { manage: true }, sessions: [freshSession] }, meta: { base_url: 'https://example.org' } });
  await review(scope, original!.key, () => true);
  await expect(execute(scope, intent, () => true)).rejects.toThrow('version mismatch');
  await expect(execute(scope, create, () => true)).rejects.toThrow('differs');
  jest.mocked(updateAgendaSession).mockResolvedValueOnce({ data: { ...receipt.data, session: freshSession } });
  await execute(scope, { ...intent, expectedVersion: freshSession.version }, () => true);
  expect((await load(scope))?.key).not.toBe(original?.key);
});
it('retains the original pending record if persisting a rejection fails', async () => {
  jest.mocked(createAgendaSession).mockImplementationOnce(async () => {
    jest.mocked(saveCreationDraft).mockResolvedValueOnce(false);
    throw new ApiResponseError(409, 'Refused', undefined, 'EVENT_AGENDA_CONFLICT');
  });
  await expect(execute(scope, create, () => true)).rejects.toThrow('not saved');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('does not settle a wrong-session or stale-version receipt', async () => {
  const intent = { action: 'update' as const, sessionId: session.id, expectedVersion: session.version, payload };
  jest.mocked(updateAgendaSession).mockResolvedValueOnce({ data: { ...receipt.data, session: { ...session, id: session.id + 1 } } });
  await expect(execute(scope, intent, () => true)).rejects.toThrow('Stale receipt');
  expect(await load(scope)).toMatchObject({ status: 'pending' });
});
it('can explicitly discard a rejected edit after its target is cancelled, without a mutation', async () => {
  const intent = { action: 'update' as const, sessionId: session.id, expectedVersion: session.version, payload };
  jest.mocked(updateAgendaSession).mockRejectedValueOnce(new ApiResponseError(409, 'Refused', undefined, 'EVENT_AGENDA_CONFLICT'));
  await expect(execute(scope, intent, () => true)).rejects.toThrow();
  const original = await load(scope);
  jest.mocked(getEventAgenda).mockResolvedValueOnce({ data: { ...agenda, permissions: { manage: true },
    sessions: [{ ...session, status: 'cancelled' }] }, meta: { base_url: 'https://example.org' } });
  await review(scope, original!.key, () => true);
  await discard(scope, original!.key, () => true);
  expect(await load(scope)).toBeNull();
  expect(updateAgendaSession).toHaveBeenCalledTimes(1);
  await execute(scope, create, () => true);
  expect(createAgendaSession).toHaveBeenCalledTimes(1);
});
it('never discards an uncertain operation, an obsolete confirmation, or another owner', async () => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new Error('Uncertain'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  const pending = await load(scope);
  await expect(discard(scope, pending!.key, () => true)).rejects.toThrow();
  await expect(discard({ ...scope, userId: 99 }, pending!.key, () => true)).rejects.toThrow();
  expect(clearCreationDraft).not.toHaveBeenCalled();
  expect(await load(scope)).toEqual(pending);
});
it('preserves rejected input when discard storage fails or the confirmation becomes stale', async () => {
  jest.mocked(createAgendaSession).mockRejectedValueOnce(new ApiResponseError(422, 'Invalid', undefined, 'EVENT_AGENDA_VALIDATION_FAILED'));
  await expect(execute(scope, create, () => true)).rejects.toThrow();
  const rejected = await load(scope);
  await expect(discard(scope, 'old-key', () => true)).rejects.toThrow();
  await expect(discard(scope, rejected!.key, () => false)).rejects.toThrow();
  expect(clearCreationDraft).not.toHaveBeenCalled();
  jest.mocked(clearCreationDraft).mockResolvedValueOnce(false);
  await expect(discard(scope, rejected!.key, () => true)).rejects.toThrow();
  expect(await load(scope)).toEqual(rejected);
});
