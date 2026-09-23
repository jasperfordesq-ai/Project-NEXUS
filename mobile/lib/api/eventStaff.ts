// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import i18n from 'i18next';
import { z } from 'zod';
import { api, ApiResponseError } from './client';
import { API_V2 } from '@/lib/constants';

const id = z.number().int().positive().safe();
const timestamp = z.string().datetime({ offset: true }).nullable();
export const eventStaffRoles = ['co_organizer', 'registration_manager', 'communications_manager', 'check_in_staff', 'finance_manager'] as const;
export const eventStaffRoleSchema = z.enum(eventStaffRoles);
const status = z.enum(['active', 'revoked']);
const historySchema = z.object({
  id, version: id, action: z.enum(['granted', 'revoked']),
  from_status: status.nullable(), to_status: status,
  previous_expires_at: timestamp, new_expires_at: timestamp,
  actor_user_id: id, idempotency_key: z.string().nullable(),
  created_at: timestamp, immutable: z.literal(true),
});
export const eventStaffAssignmentSchema = z.object({
  id, event_id: id,
  member: z.object({ id, name: z.string().nullable(), first_name: z.string().nullable(), last_name: z.string().nullable(), avatar_url: z.string().nullable() }),
  role: eventStaffRoleSchema,
  capabilities: z.array(z.string().min(1)),
  status, effective: z.boolean(), version: id,
  granted_at: timestamp, granted_by_user_id: id,
  revoked_at: timestamp, revoked_by_user_id: id.nullable(), expires_at: timestamp,
  history: z.array(historySchema),
});
export const eventStaffGrantSchema = z.object({ user_id: id, role: eventStaffRoleSchema, expires_at: timestamp }).strict();
const mutationSchema = z.object({
  assignment: eventStaffAssignmentSchema, changed: z.boolean(), idempotent_replay: z.boolean(), history_entry_id: id.nullable(),
});
export type EventStaffAssignment = z.infer<typeof eventStaffAssignmentSchema>;
export type EventStaffGrant = z.infer<typeof eventStaffGrantSchema>;
export type EventStaffMutation = z.infer<typeof mutationSchema>;

function drift(): never {
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_STAFF_CONTRACT_DRIFT');
}
function requestIdentity(eventId: number, actorId?: number, key?: string) {
  if (!id.safeParse(eventId).success || (actorId !== undefined && !id.safeParse(actorId).success)
    || (key !== undefined && !/^[A-Za-z0-9._:-]{1,170}$/.test(key))) drift();
}
function parse<T>(schema: z.ZodType<T>, response: unknown): T {
  const parsed = z.object({ data: schema }).safeParse(response);
  if (!parsed.success) drift();
  return parsed.data.data;
}
const sameTime = (a: string | null, b: string | null) => a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);

/** Includes revoked and expired assignments so the organiser can inspect history. */
export async function getEventStaff(eventId: number): Promise<{ data: EventStaffAssignment[] }> {
  requestIdentity(eventId);
  const data = parse(z.array(eventStaffAssignmentSchema), await api.get<unknown>(`${API_V2}/events/${eventId}/staff`, { include_inactive: 'true' }));
  if (data.some(item => item.event_id !== eventId) || new Set(data.map(item => item.id)).size !== data.length) drift();
  return { data };
}

function receipt(response: unknown, eventId: number, actorId: number, key: string, action: 'granted' | 'revoked', target: EventStaffGrant | { assignmentId: number }) {
  const data = parse(mutationSchema, response);
  const assignment = data.assignment;
  if (assignment.event_id !== eventId || (data.changed && data.idempotent_replay)) drift();
  if ('assignmentId' in target ? assignment.id !== target.assignmentId : assignment.member.id !== target.user_id || assignment.role !== target.role) drift();
  if (data.history_entry_id !== null) {
    const matches = assignment.history.filter(entry => entry.id === data.history_entry_id);
    const entry = matches[0];
    if (matches.length !== 1 || entry.action !== action || entry.actor_user_id !== actorId || entry.idempotency_key !== key
      || entry.version > assignment.version || entry.to_status !== (action === 'granted' ? 'active' : 'revoked')
      || ('expires_at' in target && !sameTime(entry.new_expires_at, target.expires_at))) drift();
    if (!data.changed && !data.idempotent_replay) drift();
    // A replay returns today's assignment plus the original immutable receipt.
    // Its current status may have changed since this request was accepted.
  } else if (data.changed || data.idempotent_replay || assignment.status !== (action === 'granted' ? 'active' : 'revoked')
    || ('expires_at' in target && !sameTime(assignment.expires_at, target.expires_at))) drift();
  return { data };
}

export async function grantEventStaff(eventId: number, actorId: number, payload: EventStaffGrant, key: string): Promise<{ data: EventStaffMutation }> {
  requestIdentity(eventId, actorId, key);
  const input = eventStaffGrantSchema.safeParse(payload);
  if (!input.success) drift();
  const response = await api.post<unknown>(`${API_V2}/events/${eventId}/staff`, input.data, { headers: { 'Idempotency-Key': key } });
  return receipt(response, eventId, actorId, key, 'granted', input.data);
}

export async function revokeEventStaff(eventId: number, actorId: number, assignmentId: number, key: string): Promise<{ data: EventStaffMutation }> {
  requestIdentity(eventId, actorId, key);
  if (!id.safeParse(assignmentId).success) drift();
  const response = await api.delete<unknown>(`${API_V2}/events/${eventId}/staff/${assignmentId}`, { headers: { 'Idempotency-Key': key } });
  return receipt(response, eventId, actorId, key, 'revoked', { assignmentId });
}
