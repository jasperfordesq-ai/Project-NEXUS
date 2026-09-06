// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();
const rate = z.object({
  numerator: count,
  denominator: count,
  basis_points: count.max(1_000_000).nullable(),
  suppressed: z.boolean(),
}).strict();
const privateCount = z.object({ value: nullableCount, suppressed: z.boolean() })
  .strict()
  .superRefine((value, context) => {
    if (value.suppressed !== (value.value === null)) {
      context.addIssue({ code: 'custom', message: 'invalid_privacy_suppression' });
    }
  });
const deliveries = z.object({
  pending: count,
  delivered: count,
  suppressed: count,
  failed: count,
  dead_lettered: count,
}).strict();

export const eventAnalyticsSchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  event_title: z.string().min(1),
  generated_at: z.string().datetime({ offset: true }),
  privacy_threshold: z.number().int().min(5),
  registration: z.object({
    capacity_limit: nullableCount,
    confirmed: count,
    pending: count,
    invited: count,
    declined: count,
    cancelled: count,
    remaining: nullableCount,
    completion_transitions: count,
    cancellation_transitions: count,
  }).strict(),
  invitation: z.object({
    available: z.boolean(),
    issued: count,
    accepted: count,
    revoked: count,
    expired: count,
    conversion: rate,
  }).strict(),
  waitlist: z.object({
    current_waiting: count,
    current_offered: count,
    joined: count,
    offered: count,
    accepted: count,
    expired: count,
    cancelled: count,
    conversion: rate,
  }).strict(),
  attendance: z.object({
    checked_in: count,
    checked_out: count,
    attended: count,
    no_show: count,
    attendance_rate: rate,
  }).strict(),
  tickets: z.object({
    available: z.boolean(),
    redacted: z.boolean(),
    confirmed_entitlements: nullableCount,
    confirmed_units: nullableCount,
    cancelled_units: nullableCount,
    confirmed_credit_value: z.string().regex(/^\d+\.\d{2}$/).nullable(),
  }).strict(),
  credits: z.object({
    completed_claims: count,
    completed_amount: z.string().regex(/^\d+\.\d{2}$/),
    pending_claims: count,
    failed_claims: count,
    reversed_claims: count,
  }).strict(),
  communications: deliveries.extend({
    delivery_rate: rate,
    by_channel: z.record(z.string().min(1), deliveries),
  }).strict(),
  optional_funnel: z.object({
    event_views: privateCount,
    registration_starts: privateCount,
    start_to_registration_conversion: rate,
  }).strict(),
  safeguarding: z.object({
    available: z.boolean(),
    guardian_consents: privateCount,
  }).strict(),
}).strict();

const envelope = z.object({
  data: eventAnalyticsSchema,
  meta: z.object({ base_url: z.string().min(1) }).passthrough(),
}).strict();

export type EventAnalyticsSummary = z.infer<typeof eventAnalyticsSchema>;

export async function getEventAnalytics(eventId: number): Promise<{
  data: EventAnalyticsSummary;
  meta: { base_url: string };
}> {
  const endpoint = `${API_V2}/events/${eventId}/analytics`;
  const response = await api.get<unknown>(endpoint);
  const parsed = envelope.safeParse(response);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Events analytics contract drift', {
    level: 'warning',
    tags: { module: 'events', contract_version: '1', endpoint: `${API_V2}/events/{id}/analytics` },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_ANALYTICS_CONTRACT_DRIFT');
}
