// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from './client';
import { exportEventPeople, getEventPeople, getEventPeopleHistory, mutateEventRegistrations, searchEventInviteMembers, type EventPeopleRegistrationOperation } from './eventPeople';
import { downloadAuthenticatedFile } from '@/lib/volunteering/authenticatedFileDownload';
jest.mock('@/lib/volunteering/authenticatedFileDownload', () => ({ downloadAuthenticatedFile: jest.fn() }));
jest.mock('./client', () => ({ ...jest.requireActual('./client'), api: { post: jest.fn(), get: jest.fn() } }));

const operations: EventPeopleRegistrationOperation[] = [
  { user_id: 44, action: 'approve', expected_version: 2, idempotency_key: 'first-stable-key' },
  { user_id: 45, action: 'reject', expected_version: 1, idempotency_key: 'second-stable-key', reason: 'Duplicate registration' },
];
const accepted = { index: 0, user_id: 44, action: 'approve', expected_version: 2, success: true,
  mutation: { registration_id: 12, state: 'confirmed', version: 3, changed: true, idempotent_replay: false, history_entry_id: 20 } };
const rejected = { index: 1, user_id: 45, action: 'reject', expected_version: 1, success: false,
  error: { code: 'event_registration_version_conflict', message: 'Registration changed' } };
const response = () => ({ data: { requested: 2, succeeded: 1, failed: 1, results: [accepted, rejected] } });

beforeEach(() => { jest.mocked(api.post).mockReset().mockResolvedValue(response()); jest.mocked(api.get).mockReset(); });

it('exports every filtered page through the authenticated downloader with an active identity guard', async () => {
  const active = () => true;
  await exportEventPeople(7, { page: 4, search: ' Alex & Sam ', registration_state: 'confirmed' }, active);
  expect(downloadAuthenticatedFile).toHaveBeenCalledWith(
    '/api/v2/events/7/people/export.csv?search=Alex+%26+Sam&registration_state=confirmed&sort=name&direction=asc',
    'event-7-people.csv', { 'X-Events-Contract': '2' }, { isActive: active });
});

const history = () => ({ data: [{ axis: 'registration', entry_id: 8, version: 2, sequence: null,
  action: 'approve', from_state: 'pending', to_state: 'confirmed', actor: { id: 7, display_name: 'Organiser' },
  reason: null, created_at: '2026-09-19 12:00:00' }], meta: { base_url: 'http://localhost', current_page: 1,
  per_page: 50, total: 1, total_pages: 1, has_more: false, projection: 'full', sensitive_fields_redacted: true } });

it('loads person history with canonical header and bounded pagination, preserving redacted facts', async () => {
  jest.mocked(api.get).mockResolvedValue(history());
  expect(await getEventPeopleHistory(7, 44)).toEqual(history());
  expect(api.get).toHaveBeenCalledWith('/api/v2/events/7/people/44/history', { page: '1', per_page: '50' }, { headers: { 'X-Events-Contract': '2' } });
});
it.each([0, 201, 1.5])('does not request invalid history page %s', async page => {
  await expect(getEventPeopleHistory(7, 44, page)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_INVALID_INPUT' });
  expect(api.get).not.toHaveBeenCalled();
});
it.each(['page', 'redaction', 'duplicate', 'projection', 'pagination'] as const)('rejects inconsistent history %s', async mismatch => {
  const payload = history();
  if (mismatch === 'page') payload.meta.current_page = 2;
  if (mismatch === 'redaction') payload.meta.sensitive_fields_redacted = false;
  if (mismatch === 'duplicate') payload.data.push(payload.data[0]);
  if (mismatch === 'projection') payload.meta.projection = 'attendance';
  if (mismatch === 'pagination') payload.meta.has_more = true;
  jest.mocked(api.get).mockResolvedValue(payload);
  await expect(getEventPeopleHistory(7, 44)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_CONTRACT_DRIFT' });
});

it('searches invitation candidates with the established directory contract and retains only identity fields', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: [{ id: 44, name: 'Alex', email: 'private@example.test', location: 'Private location' }] });
  expect(await searchEventInviteMembers(' Alex ')).toEqual([{ id: 44, name: 'Alex' }]);
  expect(api.get).toHaveBeenCalledWith('/api/v2/users', { q: 'Alex', limit: '10' });
});
it('does not query the member directory for fewer than two Unicode characters', async () => {
  expect(await searchEventInviteMembers(' 😀 ')).toEqual([]);
  expect(api.get).not.toHaveBeenCalled();
});
it.each([
  { data: [{ id: 0, name: 'Invalid' }] },
  { data: [{ id: 44 }, { id: 44 }] },
  { data: Array.from({ length: 11 }, (_, index) => ({ id: index + 1 })) },
])('rejects invalid invitation search identities: %j', async payload => {
  jest.mocked(api.get).mockResolvedValue(payload);
  await expect(searchEventInviteMembers('Alex')).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_CONTRACT_DRIFT' });
});

const roster = () => ({ data: [], meta: {
  base_url: 'http://localhost', current_page: 1, per_page: 25, total: 0, total_pages: 0, has_more: false,
  search: null, registration_state: null, waitlist_state: null, attendance_state: null, engagement_state: null,
  sort: 'name', direction: 'asc', sensitive_fields_redacted: true, projection: 'full',
  capabilities: { view_roster: true, view_waitlist: true, manage_registration: true, manage_attendance: false, export_people: false, view_history: true },
  metrics: { confirmed: 0, waitlisted: 0, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
} });

it('accepts full registration management without inventing attendance powers', async () => {
  jest.mocked(api.get).mockResolvedValue(roster());
  await expect(getEventPeople(7)).resolves.toEqual(roster());
  expect(api.get).toHaveBeenCalledWith('/api/v2/events/7/people', { per_page: '25', page: '1', sort: 'name', direction: 'asc' }, { headers: { 'X-Events-Contract': '2' } });
});

it('sends all selected filters, sorting and bounded pagination', async () => {
  jest.mocked(api.get).mockResolvedValue(roster());
  await getEventPeople(7, { page: 2, search: '  Alex  ', registration_state: 'pending', waitlist_state: 'active', attendance_state: 'not_checked_in', engagement_state: 'interested', sort: 'queue_rank', direction: 'desc' });
  expect(api.get).toHaveBeenCalledWith(expect.any(String), { per_page: '25', page: '2', search: 'Alex', registration_state: 'pending', waitlist_state: 'active', attendance_state: 'not_checked_in', engagement_state: 'interested', sort: 'queue_rank', direction: 'desc' }, expect.any(Object));
});

it.each([0, -1, 1.5, 401])('rejects invalid people page %s before transport', async page => {
  await expect(getEventPeople(7, { page })).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_INVALID_INPUT' });
  expect(api.get).not.toHaveBeenCalled();
});

it('preserves an attendance-only projection without manufacturing registration access', async () => {
  const value = roster();
  const { waitlisted: _waitlisted, ...metrics } = value.meta.metrics;
  const restricted = { data: [], meta: { ...value.meta, projection: 'attendance', metrics, capabilities: { ...value.meta.capabilities, view_waitlist: false, manage_registration: false, manage_attendance: true } } };
  jest.mocked(api.get).mockResolvedValue(restricted);
  await expect(getEventPeople(7)).resolves.toEqual(restricted);
});

it('rejects unredacted roster metadata', async () => {
  const value = roster(); value.meta.sensitive_fields_redacted = false;
  jest.mocked(api.get).mockResolvedValue(value);
  await expect(getEventPeople(7)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_CONTRACT_DRIFT' });
});

it('retains full registration and waitlist facts but rejects unexpected contact fields', async () => {
  const person = {
    member: { id: 44, display_name: 'Alex Member', avatar_url: null },
    engagement: { state: 'interested', consumes_capacity: false },
    registration: { id: 12, state: 'pending', version: 2, capacity_pool_key: 'event', allocation_key: null, changed_at: null, confirmed_at: null },
    waitlist: { id: 9, state: 'waiting', version: 1, position: 3, sequence: 3, offered_at: null, offer_expires_at: null, accepted_at: null },
    attendance: { id: null, state: 'not_checked_in', version: null, changed_at: null, checked_in_at: null, checked_out_at: null },
    management_actions: { approve: true, reject: true, cancel: true, check_in: false, check_out: false, no_show: false, undo_attendance: false, idempotency_key_required: true },
    privacy: { sensitive_fields_redacted: true },
  };
  const value = { ...roster(), data: [person] };
  jest.mocked(api.get).mockResolvedValue(value);
  await expect(getEventPeople(7)).resolves.toEqual(value);
  jest.mocked(api.get).mockResolvedValue({ ...value, data: [{ ...person, member: { ...person.member, email: 'synthetic@example.invalid' } }] });
  await expect(getEventPeople(7)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_CONTRACT_DRIFT' });
});

it('preserves partial results and each item retry key/version', async () => {
  await expect(mutateEventRegistrations(7, operations)).resolves.toEqual(response().data);
  expect(api.post).toHaveBeenCalledWith('/api/v2/events/7/people/bulk', { operations }, { headers: { 'X-Events-Contract': '2' } });
});

it.each(['count', 'missing', 'duplicate', 'member', 'action', 'version', 'index', 'error'])('rejects mismatched %s results', async fault => {
  const value = structuredClone(response());
  if (fault === 'count') value.data.succeeded = 2;
  if (fault === 'missing') value.data.results.pop();
  if (fault === 'duplicate') value.data.results[1].index = 0;
  if (fault === 'member') value.data.results[0].user_id = 99;
  if (fault === 'action') value.data.results[0].action = 'cancel';
  if (fault === 'version') value.data.results[0].expected_version = 9;
  if (fault === 'index') value.data.results[0].index = 10;
  if (fault === 'error') value.data.results[1] = { ...rejected, error: { code: '', message: '' } };
  jest.mocked(api.post).mockResolvedValue(value);
  await expect(mutateEventRegistrations(7, operations)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_CONTRACT_DRIFT' });
});

it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('does not post invalid event id %s', async id => {
  await expect(mutateEventRegistrations(id, operations)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_INVALID_INPUT' });
  expect(api.post).not.toHaveBeenCalled();
});

it.each([[], [operations[0], operations[0]], [{ ...operations[1], reason: ' ' }], [{ ...operations[0], idempotency_key: '' }]].map(input => ({ input })))('refuses invalid operations before transport', async ({ input }) => {
  await expect(mutateEventRegistrations(7, input)).rejects.toMatchObject({ code: 'EVENTS_PEOPLE_INVALID_INPUT' });
  expect(api.post).not.toHaveBeenCalled();
});

it('propagates uncertain transport failure without replaying the mutation', async () => {
  const error = new Error('Connection lost');
  jest.mocked(api.post).mockRejectedValue(error);
  await expect(mutateEventRegistrations(7, operations)).rejects.toBe(error);
  expect(api.post).toHaveBeenCalledTimes(1);
});
