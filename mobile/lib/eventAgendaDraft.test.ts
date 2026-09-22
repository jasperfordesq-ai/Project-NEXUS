// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import { agendaDraft, agendaPayload } from './eventAgendaDraft';
import type { CanonicalEvent, EventAgendaSession } from './api/events';
const raw = require('../../contracts/events/v2/event-detail.json');
const event: CanonicalEvent = { ...raw, schedule: { ...raw.schedule, start_at: '2030-05-01T08:00:00Z', end_at: '2030-05-01T17:00:00Z', timezone: 'Europe/Dublin' } };
const session: EventAgendaSession = require('../../contracts/events/v2/event-agenda.json').sessions[0];
it('roundtrips event-local times and retains linked speaker identity and resource order', () => {
  const draft = agendaDraft(event, session);
  expect(draft.start).toBe('2030-05-01T10:30');
  expect(agendaPayload(draft, event)).toMatchObject({ start_at: '2030-05-01T09:30:00.000Z',
    speakers: [{ user_id: 7, role_label: 'Facilitator' }], resources: session.resources.map(({ type, title, url, visibility }) => ({ type, title, url, visibility })) });
});
it('preserves explicit cleared values in a rejected edit against changed server data', () => {
  const payload = agendaPayload(agendaDraft(event, session), event)!;
  const restored = agendaDraft(event, session, { ...payload, description: null, track_name: null, room_name: null, capacity: null, speakers: [], resources: [] });
  expect(restored).toMatchObject({ description: '', track: '', room: '', capacity: '', speakers: [], resources: [] });
});
it.each(['2030-05-01T07:00', '2030-05-02T10:00', 'bad'])('rejects invalid or out-of-event start %s', start => {
  expect(agendaPayload({ ...agendaDraft(event, session), start }, event)).toBeNull();
});
it('rejects daylight-saving ambiguity instead of choosing a different instant', () => {
  const autumn = { ...event, schedule: { ...event.schedule, start_at: '2030-10-27T00:00:00Z', end_at: '2030-10-27T08:00:00Z' } };
  expect(agendaPayload({ ...agendaDraft(autumn, session), start: '2030-10-27T01:30', end: '2030-10-27T03:00' }, autumn)).toBeNull();
});
it.each(['0', '-1', '1.5', '1e3', '100001'])('rejects invalid capacity %s', capacity => {
  expect(agendaPayload({ ...agendaDraft(event, session), capacity }, event)).toBeNull();
});
it('does not silently remove an unavailable protected resource', () => {
  const draft = agendaDraft(event, { ...session, resources: [{ ...session.resources[0], url: null }] });
  expect(draft.resources).toHaveLength(1);
  expect(agendaPayload(draft, event)).toBeNull();
});
it.each(['http://example.org/file', 'https://user:secret@example.org/file', 'javascript:alert(1)'])('rejects unsafe resource %s', url => {
  const draft = agendaDraft(event, session); draft.resources[0].url = url;
  expect(agendaPayload(draft, event)).toBeNull();
});
it('does not permit public streams or blank external speaker names', () => {
  const draft = agendaDraft(event, session); draft.resources[1].visibility = 'public';
  expect(agendaPayload(draft, event)).toBeNull();
  draft.resources = []; draft.speakers = [{ name: ' ', role: '' }];
  expect(agendaPayload(draft, event)).toBeNull();
});
it('keeps exact event boundary seconds when the default minute fields are unchanged', () => {
  const precise = { ...event, schedule: { ...event.schedule, start_at: '2030-05-01T08:00:37Z', end_at: '2030-05-01T17:00:42Z' } };
  const draft = { ...agendaDraft(precise), title: 'Session' };
  expect(agendaPayload(draft, precise)).toMatchObject({ start_at: '2030-05-01T08:00:37Z', end_at: '2030-05-01T17:00:42Z' });
});
it('preserves an edited session timestamp while converting a deliberately changed field', () => {
  const precise = { ...session, start_at: '2030-05-01T09:30:37Z', end_at: '2030-05-01T10:15:42Z' };
  const draft = agendaDraft(event, precise);
  draft.end = '2030-05-01T12:00';
  expect(agendaPayload(draft, event, precise)).toMatchObject({ start_at: precise.start_at, end_at: '2030-05-01T11:00:00.000Z' });
});
