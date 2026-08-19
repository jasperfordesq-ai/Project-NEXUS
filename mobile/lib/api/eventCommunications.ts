// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

const timestamp = z.string().datetime({ offset: true }).nullable();
const segmentSchema = z.enum([
  'registration_confirmed',
  'waitlist_active',
  'attendance_attended',
  'attendance_no_show',
]);
const channelSchema = z.enum(['email', 'in_app', 'push']);
const variantSchema = z.enum(['announcement', 'follow_up', 'review_request']);
const statusSchema = z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed']);

export const mobileEventBroadcastSchema = z.object({
  contract_version: z.literal(1),
  id: z.number().int().positive(),
  event_id: z.number().int().positive(),
  variant: variantSchema,
  status: statusSchema,
  version: z.number().int().positive(),
  audience: z.object({
    segments: z.array(segmentSchema).min(1),
    recipient_count: z.number().int().nonnegative(),
  }).strict(),
  channels: z.array(channelSchema).min(1),
  body: z.string().nullable(),
  delivery: z.object({
    total: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
    dead_lettered: z.number().int().nonnegative(),
    failure_code: z.string().regex(/^event_broadcast_[a-z0-9_]+$/).nullable(),
  }).strict(),
  capabilities: z.object({
    edit: z.boolean(),
    schedule: z.boolean(),
    cancel: z.boolean(),
    retry: z.boolean(),
  }).strict(),
  scheduled_at: timestamp,
  cancelled_at: timestamp,
  sent_at: timestamp,
  failed_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
}).strict();

export const mobileEventBroadcastHistorySchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  action: z.enum(['created', 'revised', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'retried']),
  from_status: statusSchema.nullable(),
  to_status: statusSchema,
  metadata: z.record(z.string(), z.unknown()),
  created_at: timestamp,
}).strict();

const historyMetaSchema = z.object({
  current_page: z.number().int().positive(),
  per_page: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_more: z.boolean(),
}).strict();

export const mobileEventBroadcastPreviewSchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  variant: variantSchema,
  segments: z.array(segmentSchema).min(1),
  channels: z.array(channelSchema).min(1),
  recipient_count: z.number().int().nonnegative(),
  delivery_count: z.number().int().nonnegative(),
  segment_counts: z.partialRecord(segmentSchema, z.number().int().nonnegative()),
  generated_at: z.string().datetime({ offset: true }),
}).strict();

const detailSchema = z.object({
  broadcast: mobileEventBroadcastSchema,
  history: z.array(mobileEventBroadcastHistorySchema),
  history_meta: historyMetaSchema,
}).strict();
const mutationSchema = detailSchema.extend({
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
}).strict();
const listEnvelopeSchema = z.object({
  data: z.array(mobileEventBroadcastSchema),
  meta: z.object({
    base_url: z.string(),
    current_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
    has_more: z.boolean(),
  }).strict(),
}).strict();
const responseMetaSchema = z.object({ base_url: z.string() }).strict();
const previewEnvelopeSchema = z.object({
  data: mobileEventBroadcastPreviewSchema,
  meta: responseMetaSchema,
}).strict();
const detailEnvelopeSchema = z.object({ data: detailSchema, meta: responseMetaSchema }).strict();
const mutationEnvelopeSchema = z.object({ data: mutationSchema, meta: responseMetaSchema }).strict();

export type MobileEventBroadcast = z.infer<typeof mobileEventBroadcastSchema>;
export type MobileEventBroadcastHistory = z.infer<typeof mobileEventBroadcastHistorySchema>;
export type MobileEventBroadcastDetail = z.infer<typeof detailSchema>;
export type MobileEventBroadcastPreview = z.infer<typeof mobileEventBroadcastPreviewSchema>;
export type MobileEventBroadcastSegment = z.infer<typeof segmentSchema>;
export type MobileEventBroadcastChannel = z.infer<typeof channelSchema>;
export type MobileEventBroadcastVariant = z.infer<typeof variantSchema>;

export interface MobileEventBroadcastInput {
  variant: MobileEventBroadcastVariant;
  segments: MobileEventBroadcastSegment[];
  channels: MobileEventBroadcastChannel[];
  body: string;
}

function stableEndpoint(endpoint: string): string {
  return endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}');
}

function parseContract<T>(endpoint: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Event communications contract drift', {
    level: 'warning',
    tags: { module: 'events', endpoint: stableEndpoint(endpoint) },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, 'EVENTS_CONTRACT_DRIFT');
}

function idempotencyOptions(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

export async function getEventCommunications(eventId: number, page = 1, perPage = 50) {
  const endpoint = `${API_V2}/events/${eventId}/broadcasts`;
  const response = await api.get<unknown>(endpoint, {
    page: String(page),
    per_page: String(perPage),
  });
  return parseContract(endpoint, listEnvelopeSchema, response);
}

export async function previewEventCommunication(
  eventId: number,
  input: Omit<MobileEventBroadcastInput, 'body'>,
): Promise<MobileEventBroadcastPreview> {
  const endpoint = `${API_V2}/events/${eventId}/broadcasts/preview`;
  const response = await api.post<unknown>(endpoint, input);
  return parseContract(endpoint, previewEnvelopeSchema, response).data;
}

export async function createEventCommunication(
  eventId: number,
  input: MobileEventBroadcastInput,
  idempotencyKey: string,
): Promise<MobileEventBroadcast> {
  const endpoint = `${API_V2}/events/${eventId}/broadcasts`;
  const response = await api.post<unknown>(endpoint, input, idempotencyOptions(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data.broadcast;
}

export async function getEventCommunicationDetail(
  broadcastId: number,
  historyPage = 1,
  historyPerPage = 50,
): Promise<MobileEventBroadcastDetail> {
  const endpoint = `${API_V2}/event-broadcasts/${broadcastId}`;
  const response = await api.get<unknown>(endpoint, {
    history_page: String(historyPage),
    history_per_page: String(historyPerPage),
  });
  return parseContract(endpoint, detailEnvelopeSchema, response).data;
}

export async function reviseEventCommunication(
  broadcastId: number,
  expectedVersion: number,
  input: MobileEventBroadcastInput,
  idempotencyKey: string,
): Promise<MobileEventBroadcast> {
  const endpoint = `${API_V2}/event-broadcasts/${broadcastId}/revisions`;
  const response = await api.post<unknown>(endpoint, {
    ...input,
    expected_version: expectedVersion,
  }, idempotencyOptions(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data.broadcast;
}

export async function scheduleEventCommunication(
  broadcastId: number,
  expectedVersion: number,
  scheduledAt: string | null,
  idempotencyKey: string,
): Promise<MobileEventBroadcast> {
  const endpoint = `${API_V2}/event-broadcasts/${broadcastId}/schedule`;
  const response = await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
    scheduled_at: scheduledAt,
  }, idempotencyOptions(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data.broadcast;
}

export async function cancelEventCommunication(
  broadcastId: number,
  expectedVersion: number,
  reason: string,
  idempotencyKey: string,
): Promise<MobileEventBroadcast> {
  const endpoint = `${API_V2}/event-broadcasts/${broadcastId}/cancel`;
  const response = await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
    reason,
  }, idempotencyOptions(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data.broadcast;
}

export async function retryEventCommunication(
  broadcastId: number,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MobileEventBroadcast> {
  const endpoint = `${API_V2}/event-broadcasts/${broadcastId}/retry`;
  const response = await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
  }, idempotencyOptions(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data.broadcast;
}
