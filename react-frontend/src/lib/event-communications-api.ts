// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { api, type ApiResponse, type RequestOptions } from '@/lib/api';
import { logError } from '@/lib/logger';

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

export const eventBroadcastSchema = z.object({
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

export const eventBroadcastHistorySchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  action: z.enum(['created', 'revised', 'scheduled', 'sending', 'sent', 'cancelled', 'failed', 'retried']),
  from_status: statusSchema.nullable(),
  to_status: statusSchema,
  metadata: z.record(z.string(), z.unknown()),
  created_at: timestamp,
}).strict();

const paginationMetaSchema = z.object({
  current_page: z.number().int().positive(),
  per_page: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_more: z.boolean(),
}).passthrough();

export const eventBroadcastDetailSchema = z.object({
  broadcast: eventBroadcastSchema,
  history: z.array(eventBroadcastHistorySchema),
  history_meta: paginationMetaSchema,
}).strict();

export const eventBroadcastPreviewSchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  variant: variantSchema,
  segments: z.array(segmentSchema).min(1),
  channels: z.array(channelSchema).min(1),
  recipient_count: z.number().int().nonnegative(),
  delivery_count: z.number().int().nonnegative(),
  // 🔴 partialRecord, NOT record — an enum-keyed z.record() is EXHAUSTIVE in
  // Zod 4. It demands ALL FOUR segment keys, but the backend only counts the
  // segments that were actually requested (`segments` above allows as few as
  // one, and EventBroadcastAudienceResolver fills one key per requested
  // segment). So previewing a broadcast for a subset — the normal case —
  // failed its own successful response as contract drift and the organiser's
  // preview broke. Observed in production 2026-08-02 on
  // /events/129/manage/federation (Sentry NEXUS-REACT-W).
  //
  // The mobile client already had this right (mobile/lib/api/eventCommunications.ts);
  // only the web schema was missed when both were written.
  //
  // Zero-filling the missing keys on the backend instead would be worse: it
  // would assert "0 attended" for a segment nobody asked about.
  segment_counts: z.partialRecord(segmentSchema, z.number().int().nonnegative()),
  generated_at: z.string().datetime({ offset: true }),
}).strict();

const eventBroadcastMutationSchema = eventBroadcastDetailSchema.extend({
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
}).strict();

export type EventBroadcast = z.infer<typeof eventBroadcastSchema>;
export type EventBroadcastHistory = z.infer<typeof eventBroadcastHistorySchema>;
export type EventBroadcastDetail = z.infer<typeof eventBroadcastDetailSchema>;
export type EventBroadcastPreview = z.infer<typeof eventBroadcastPreviewSchema>;
export type EventBroadcastSegment = z.infer<typeof segmentSchema>;
export type EventBroadcastChannel = z.infer<typeof channelSchema>;
export type EventBroadcastVariant = z.infer<typeof variantSchema>;

export interface EventBroadcastContentInput {
  variant: EventBroadcastVariant;
  segments: EventBroadcastSegment[];
  channels: EventBroadcastChannel[];
  body: string;
}

export type EventBroadcastListResponse = Omit<ApiResponse<EventBroadcast[]>, 'meta'> & {
  meta?: z.infer<typeof paginationMetaSchema>;
};

function optionsWithIdempotency(key: string): RequestOptions {
  return { headers: { 'Idempotency-Key': key } };
}

function reportContractDrift(endpoint: string, error: z.ZodError): void {
  logError('Event communications contract drift', {
    endpoint,
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    })),
  });
}

function parseResponse<T>(
  endpoint: string,
  response: ApiResponse<unknown>,
  schema: z.ZodType<T>,
): ApiResponse<T> {
  if (!response.success) return response as ApiResponse<T>;
  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ...response, data: parsed.data };
  reportContractDrift(endpoint, parsed.error);
  return { ...response, success: false, data: undefined, code: 'EVENTS_CONTRACT_DRIFT' };
}

function queryString(values: Record<string, number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export const eventCommunicationsApi = {
  async list(eventId: number, page = 1, perPage = 20): Promise<EventBroadcastListResponse> {
    const endpoint = `/v2/events/${eventId}/broadcasts${queryString({ page, per_page: perPage })}`;
    const response = await api.get(endpoint);
    const parsed = parseResponse(endpoint, response, z.array(eventBroadcastSchema));
    if (!parsed.success) return { ...parsed, meta: undefined };
    const meta = paginationMetaSchema.safeParse(response.meta);
    if (meta.success) return { ...parsed, meta: meta.data };
    reportContractDrift(`${endpoint}#meta`, meta.error);
    return { ...parsed, success: false, data: undefined, code: 'EVENTS_CONTRACT_DRIFT', meta: undefined };
  },

  async get(
    broadcastId: number,
    historyPage = 1,
    historyPerPage = 50,
  ): Promise<ApiResponse<EventBroadcastDetail>> {
    const endpoint = `/v2/event-broadcasts/${broadcastId}${queryString({
      history_page: historyPage,
      history_per_page: historyPerPage,
    })}`;
    return parseResponse(endpoint, await api.get(endpoint), eventBroadcastDetailSchema);
  },

  async preview(eventId: number, input: Omit<EventBroadcastContentInput, 'body'>): Promise<ApiResponse<EventBroadcastPreview>> {
    const endpoint = `/v2/events/${eventId}/broadcasts/preview`;
    return parseResponse(endpoint, await api.post(endpoint, input), eventBroadcastPreviewSchema);
  },

  async create(eventId: number, input: EventBroadcastContentInput, idempotencyKey: string) {
    const endpoint = `/v2/events/${eventId}/broadcasts`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, input, optionsWithIdempotency(idempotencyKey)),
      eventBroadcastMutationSchema,
    );
  },

  async revise(
    broadcastId: number,
    expectedVersion: number,
    input: EventBroadcastContentInput,
    idempotencyKey: string,
  ) {
    const endpoint = `/v2/event-broadcasts/${broadcastId}/revisions`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { ...input, expected_version: expectedVersion },
        optionsWithIdempotency(idempotencyKey),
      ),
      eventBroadcastMutationSchema,
    );
  },

  async schedule(
    broadcastId: number,
    expectedVersion: number,
    scheduledAt: string | null,
    idempotencyKey: string,
  ) {
    const endpoint = `/v2/event-broadcasts/${broadcastId}/schedule`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion, scheduled_at: scheduledAt },
        optionsWithIdempotency(idempotencyKey),
      ),
      eventBroadcastMutationSchema,
    );
  },

  async cancel(broadcastId: number, expectedVersion: number, reason: string, idempotencyKey: string) {
    const endpoint = `/v2/event-broadcasts/${broadcastId}/cancel`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion, reason },
        optionsWithIdempotency(idempotencyKey),
      ),
      eventBroadcastMutationSchema,
    );
  },

  async retry(broadcastId: number, expectedVersion: number, idempotencyKey: string) {
    const endpoint = `/v2/event-broadcasts/${broadcastId}/retry`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion },
        optionsWithIdempotency(idempotencyKey),
      ),
      eventBroadcastMutationSchema,
    );
  },
};
