// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { api } from './client';
import { API_V2 } from '../constants';
import { eventAgendaSessionSchema, EVENTS_CONTRACT_HEADER, EVENTS_CONTRACT_VERSION,
  type EventAgendaSession, type EventAgendaResource } from './events';

export interface AgendaSessionPayload {
  title: string;
  description?: string | null;
  session_type: EventAgendaSession['type'];
  visibility: EventAgendaSession['visibility'];
  start_at: string;
  end_at: string;
  timezone: string;
  track_name?: string | null;
  room_name?: string | null;
  capacity?: number | null;
  speakers: { user_id?: number; display_name?: string; role_label?: string | null }[];
  resources: { type: EventAgendaResource['type']; title: string; url: string;
    visibility: EventAgendaResource['visibility'] }[];
}

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const receiptFields = {
  agenda_version: version,
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: positive.nullable(),
};
const sessionReceipt = z.object({ data: z.object({
  ...receiptFields, session: eventAgendaSessionSchema,
}).passthrough() }).passthrough();
const orderReceipt = z.object({ data: z.object({
  ...receiptFields, sessions: z.array(eventAgendaSessionSchema),
}).passthrough() }).passthrough();

function options(idempotencyKey: string) {
  z.string().trim().min(1).max(191).refine(key => !/[\u0000-\u001f\u007f]/.test(key)).parse(idempotencyKey);
  return { headers: { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION),
    'Idempotency-Key': idempotencyKey } };
}

/** The owner must persist the intent/key before sending and reuse both after response loss. */
export async function createAgendaSession(eventId: number, payload: AgendaSessionPayload, idempotencyKey: string) {
  positive.parse(eventId);
  return sessionReceipt.parse(await api.post<unknown>(`${API_V2}/events/${eventId}/agenda/sessions`,
    payload, options(idempotencyKey)));
}

export async function updateAgendaSession(eventId: number, sessionId: number, payload: AgendaSessionPayload,
  expectedVersion: number, idempotencyKey: string) {
  positive.parse(eventId); positive.parse(sessionId); positive.parse(expectedVersion);
  const result = sessionReceipt.parse(await api.put<unknown>(`${API_V2}/events/${eventId}/agenda/sessions/${sessionId}`,
    { ...payload, expected_version: expectedVersion }, options(idempotencyKey)));
  z.literal(sessionId).parse(result.data.session.id);
  return result;
}

export async function cancelAgendaSession(eventId: number, sessionId: number, reason: string,
  expectedVersion: number, idempotencyKey: string) {
  positive.parse(eventId); positive.parse(sessionId); positive.parse(expectedVersion);
  z.string().trim().min(1).parse(reason);
  const result = sessionReceipt.parse(await api.post<unknown>(`${API_V2}/events/${eventId}/agenda/sessions/${sessionId}/cancel`,
    { reason, expected_version: expectedVersion }, options(idempotencyKey)));
  z.literal(sessionId).parse(result.data.session.id);
  return result;
}

export async function reorderAgendaSessions(eventId: number, orderedSessionIds: number[],
  expectedAgendaVersion: number, idempotencyKey: string) {
  positive.parse(eventId); version.parse(expectedAgendaVersion);
  z.array(positive).max(1000).refine(ids => new Set(ids).size === ids.length).parse(orderedSessionIds);
  return orderReceipt.parse(await api.put<unknown>(`${API_V2}/events/${eventId}/agenda/order`,
    { ordered_session_ids: orderedSessionIds, expected_agenda_version: expectedAgendaVersion }, options(idempotencyKey)));
}
