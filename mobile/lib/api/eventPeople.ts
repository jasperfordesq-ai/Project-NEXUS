// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { z } from 'zod';
import { api, ApiResponseError } from './client';
import { API_V2 } from '@/lib/constants';
import { EVENTS_CONTRACT_HEADER, EVENTS_CONTRACT_VERSION, eventAttendanceRosterMetaSchema, eventAttendanceRosterResponseSchema } from './events';
import { downloadAuthenticatedFile } from '@/lib/volunteering/authenticatedFileDownload';

const peopleQuerySchema = z.object({
  page: z.number().int().min(1).max(400).default(1),
  search: z.string().trim().refine(value => Array.from(value).length <= 100).optional(),
  registration_state: z.enum(['none', 'invited', 'pending', 'confirmed', 'declined', 'cancelled']).nullish(),
  waitlist_state: z.enum(['none', 'active', 'waiting', 'offered', 'accepted', 'expired', 'cancelled']).nullish(),
  attendance_state: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']).nullish(),
  engagement_state: z.enum(['none', 'interested']).nullish(),
  sort: z.enum(['name', 'registration_changed', 'queue_rank', 'attendance_changed']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
}).strict();
export type EventPeopleQuery = z.input<typeof peopleQuerySchema>;

/** Export all matching rows, not the current roster page. */
export async function exportEventPeople(eventId: number, query: EventPeopleQuery, isActive: () => boolean): Promise<void> {
  const parsed = peopleQuerySchema.safeParse({ ...query, page: 1 });
  if (!Number.isSafeInteger(eventId) || eventId <= 0 || !parsed.success) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENTS_PEOPLE_INVALID_INPUT');
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key !== 'page' && value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  await downloadAuthenticatedFile(`${API_V2}/events/${eventId}/people/export.csv?${params.toString()}`,
    `event-${eventId}-people.csv`, { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION) }, { isActive });
}

const historyEntrySchema = z.object({
  axis: z.enum(['registration', 'waitlist', 'attendance']),
  entry_id: z.number().int().positive().safe(),
  version: z.number().int().positive().safe(),
  sequence: z.number().int().positive().safe().nullable(),
  action: z.string().min(1),
  from_state: z.string().nullable(),
  to_state: z.string().min(1),
  actor: z.object({ id: z.number().int().positive().safe().nullable(), display_name: z.string().nullable() }).strict(),
  reason: z.string().nullable(),
  created_at: z.string().min(1),
}).strict();
const historyResponseSchema = z.object({
  data: z.array(historyEntrySchema).max(50),
  meta: z.object({
    base_url: z.string(), current_page: z.number().int().positive(), per_page: z.literal(50),
    total: z.number().int().nonnegative(), total_pages: z.number().int().nonnegative(), has_more: z.boolean(),
    projection: z.enum(['full', 'attendance']), sensitive_fields_redacted: z.literal(true),
  }).strict(),
});
export type EventPeopleHistory = z.infer<typeof historyResponseSchema>;

export async function getEventPeopleHistory(eventId: number, userId: number, page = 1): Promise<EventPeopleHistory> {
  if (![eventId, userId].every(id => Number.isSafeInteger(id) && id > 0)
    || !Number.isInteger(page) || page < 1 || page > 200) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENTS_PEOPLE_INVALID_INPUT');
  }
  const response = await api.get<unknown>(`${API_V2}/events/${eventId}/people/${userId}/history`, {
    page: String(page), per_page: '50',
  }, { headers: { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION) } });
  const parsed = historyResponseSchema.safeParse(response);
  if (!parsed.success) throw contractError();
  const history = parsed.data;
  if (history.meta.current_page !== page
    || history.meta.total_pages !== Math.ceil(history.meta.total / 50)
    || history.meta.has_more !== (page < history.meta.total_pages)
    || new Set(history.data.map(entry => `${entry.axis}:${entry.entry_id}`)).size !== history.data.length
    || (history.meta.projection === 'attendance' && history.data.some(entry => entry.axis !== 'attendance'))) throw contractError();
  return history;
}

const inviteMemberSchema = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
});
export type EventInviteMember = z.infer<typeof inviteMemberSchema>;

/** Directory search returns only the identity fields needed for invitation selection. */
export async function searchEventInviteMembers(query: string): Promise<EventInviteMember[]> {
  const normalized = query.trim();
  if (Array.from(normalized).length < 2) return [];
  const response = await api.get<unknown>(`${API_V2}/users`, { q: normalized, limit: '10' });
  const parsed = z.object({ data: z.array(inviteMemberSchema).max(10) }).safeParse(response);
  if (!parsed.success || new Set(parsed.data.data.map(member => member.id)).size !== parsed.data.data.length) throw contractError();
  return parsed.data.data;
}

// Registration managers can receive the full projection without attendance powers.
const fullPeopleMeta = eventAttendanceRosterMetaSchema.options[1].extend({
  capabilities: eventAttendanceRosterMetaSchema.options[1].shape.capabilities.extend({ manage_attendance: z.boolean() }),
});
const peopleResponseSchema = eventAttendanceRosterResponseSchema.extend({
  meta: z.discriminatedUnion('projection', [eventAttendanceRosterMetaSchema.options[0], fullPeopleMeta]),
});
export type EventPeopleResponse = z.infer<typeof peopleResponseSchema>;

export async function getEventPeople(eventId: number, query: EventPeopleQuery = {}): Promise<EventPeopleResponse> {
  const input = peopleQuerySchema.safeParse(query);
  if (!Number.isSafeInteger(eventId) || eventId <= 0 || !input.success) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENTS_PEOPLE_INVALID_INPUT');
  }
  const params: Record<string, string> = { per_page: '25' };
  for (const [key, value] of Object.entries(input.data)) {
    if (value !== null && value !== undefined && value !== '') params[key] = String(value);
  }
  const response = await api.get<unknown>(`${API_V2}/events/${eventId}/people`, params, {
    headers: { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION) },
  });
  const parsed = peopleResponseSchema.safeParse(response);
  if (!parsed.success) throw contractError();
  return parsed.data;
}

const registrationAction = z.enum(['invite', 'approve', 'reject', 'cancel']);
const operationSchema = z.object({
  user_id: z.number().int().positive().safe(),
  action: registrationAction,
  expected_version: z.number().int().nonnegative().safe(),
  idempotency_key: z.string().trim().min(1).refine(value => Array.from(value).length <= 191),
  reason: z.string().nullable().optional().refine(value => value == null || Array.from(value.trim()).length <= 4000),
}).strict().refine(operation => !['reject', 'cancel'].includes(operation.action) || Boolean(operation.reason?.trim()));
export type EventPeopleRegistrationOperation = z.infer<typeof operationSchema>;
const operationsSchema = z.array(operationSchema).min(1).max(100)
  .refine(operations => new Set(operations.map(operation => operation.user_id)).size === operations.length);
const resultBase = z.object({
  index: z.number().int().nonnegative(),
  user_id: z.number().int().positive(),
  action: registrationAction,
  expected_version: z.number().int().nonnegative(),
});
const resultSchema = z.discriminatedUnion('success', [
  resultBase.extend({
    success: z.literal(true),
    mutation: z.object({
      registration_id: z.number().int().positive(),
      state: z.enum(['invited', 'pending', 'confirmed', 'declined', 'cancelled']),
      version: z.number().int().nonnegative(),
      changed: z.boolean(),
      idempotent_replay: z.boolean(),
      history_entry_id: z.number().int().positive().nullable(),
    }).strict(),
  }).strict(),
  resultBase.extend({
    success: z.literal(false),
    error: z.object({ code: z.string().min(1), message: z.string().min(1), field: z.string().min(1).optional() }).strict(),
  }).strict(),
]);
const responseSchema = z.object({
  data: z.object({
    requested: z.number().int().min(1).max(100),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    results: z.array(resultSchema).min(1).max(100),
  }).strict(),
}).passthrough();

/** Each operation owns its retry key; a failed HTTP request may already have applied some items. */
export async function mutateEventRegistrations(eventId: number, operations: EventPeopleRegistrationOperation[]) {
  const input = operationsSchema.safeParse(operations);
  if (!Number.isSafeInteger(eventId) || eventId <= 0 || !input.success) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENTS_PEOPLE_INVALID_INPUT');
  }
  const response = await api.post<unknown>(`${API_V2}/events/${eventId}/people/bulk`, { operations: input.data }, {
    headers: { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION) },
  });
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw contractError();
  const result = parsed.data.data;
  const seen = new Set<number>();
  if (result.requested !== input.data.length || result.results.length !== input.data.length
    || result.succeeded !== result.results.filter(item => item.success).length
    || result.failed !== result.results.filter(item => !item.success).length) throw contractError();
  for (const item of result.results) {
    const requested = input.data[item.index];
    if (!requested || seen.has(item.index) || item.user_id !== requested.user_id
      || item.action !== requested.action || item.expected_version !== requested.expected_version) throw contractError();
    seen.add(item.index);
  }
  return result;
}

function contractError() {
  return new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENTS_PEOPLE_CONTRACT_DRIFT');
}
