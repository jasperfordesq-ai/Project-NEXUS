// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('./client', () => ({ api: { post: jest.fn(), put: jest.fn() } }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import { api } from './client';
import { createAgendaSession, updateAgendaSession, cancelAgendaSession, reorderAgendaSessions,
  type AgendaSessionPayload } from './eventAgendaManagement';

const agenda = require('../../../contracts/events/v2/event-agenda.json');
const session = agenda.sessions[0];
const payload: AgendaSessionPayload = {
  title: 'Workshop', session_type: 'workshop', visibility: 'registered',
  start_at: session.start_at, end_at: session.end_at, timezone: session.timezone,
  speakers: [{ user_id: 7, role_label: 'Host' }],
  resources: [{ type: 'slides', title: 'Slides', url: 'https://example.org/slides', visibility: 'registered' }],
};
const receipt = { data: { session, agenda_version: 4, changed: true,
  idempotent_replay: false, history_entry_id: 81 } };
const headers = { headers: { 'X-Events-Contract': '2', 'Idempotency-Key': 'stable-intent' } };
beforeEach(() => { jest.clearAllMocks(); (api.post as jest.Mock).mockResolvedValue(receipt);
  (api.put as jest.Mock).mockResolvedValue(receipt); });

it('creates with the complete speaker/resource payload and caller-owned retry identity', async () => {
  expect(await createAgendaSession(101, payload, 'stable-intent')).toEqual(receipt);
  expect(api.post).toHaveBeenCalledWith('/api/v2/events/101/agenda/sessions', payload, headers);
});
it('retains the same identity and payload when a response is lost', async () => {
  (api.post as jest.Mock).mockRejectedValueOnce(new Error('response lost'));
  await expect(createAgendaSession(101, payload, 'stable-intent')).rejects.toThrow('response lost');
  await createAgendaSession(101, payload, 'stable-intent');
  expect((api.post as jest.Mock).mock.calls[0]).toEqual((api.post as jest.Mock).mock.calls[1]);
});
it('updates against the observed session version', async () => {
  await updateAgendaSession(101, session.id, payload, 3, 'stable-intent');
  expect(api.put).toHaveBeenCalledWith(`/api/v2/events/101/agenda/sessions/${session.id}`,
    { ...payload, expected_version: 3 }, headers);
});
it('cancels with the explicit reason and observed version', async () => {
  await cancelAgendaSession(101, session.id, 'Speaker unavailable', 3, 'stable-intent');
  expect(api.post).toHaveBeenCalledWith(`/api/v2/events/101/agenda/sessions/${session.id}/cancel`,
    { reason: 'Speaker unavailable', expected_version: 3 }, headers);
});
it('reorders against the agenda version, including an empty agenda at version zero', async () => {
  (api.put as jest.Mock).mockResolvedValue({ data: { ...receipt.data, session: undefined, sessions: [] } });
  await reorderAgendaSessions(101, [], 0, 'stable-intent');
  expect(api.put).toHaveBeenCalledWith('/api/v2/events/101/agenda/order',
    { ordered_session_ids: [], expected_agenda_version: 0 }, headers);
});
it('propagates version conflicts without silently rebasing or retrying', async () => {
  const conflict = { status: 409, code: 'EVENT_AGENDA_VERSION_CONFLICT' };
  (api.put as jest.Mock).mockRejectedValue(conflict);
  await expect(updateAgendaSession(101, session.id, payload, 3, 'stable-intent')).rejects.toBe(conflict);
  expect(api.put).toHaveBeenCalledTimes(1);
});
it.each([0, -1, 1.5, NaN])('refuses invalid event id %s before sending', async id => {
  await expect(createAgendaSession(id, payload, 'stable-intent')).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it('refuses blank retry identities and cancellation reasons', async () => {
  await expect(createAgendaSession(101, payload, ' ')).rejects.toThrow();
  await expect(cancelAgendaSession(101, session.id, ' ', 3, 'stable-intent')).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it('refuses invalid versions and duplicate reorder identities before sending', async () => {
  await expect(updateAgendaSession(101, session.id, payload, 0, 'stable-intent')).rejects.toThrow();
  await expect(reorderAgendaSessions(101, [1, 1], 3, 'stable-intent')).rejects.toThrow();
  await expect(reorderAgendaSessions(101, [1], -1, 'stable-intent')).rejects.toThrow();
  expect(api.put).not.toHaveBeenCalled();
});
it('does not accept a malformed success receipt as settled', async () => {
  (api.post as jest.Mock).mockResolvedValue({ data: { ...receipt.data, agenda_version: -1 } });
  await expect(createAgendaSession(101, payload, 'stable-intent')).rejects.toThrow();
});
it('rejects a response for a different edited session', async () => {
  await expect(updateAgendaSession(101, session.id + 1, payload, 3, 'stable-intent')).rejects.toThrow();
});
