// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { api, type ApiResponse, type RequestOptions } from '@/lib/api';
import { logError } from '@/lib/logger';

const countSchema = z.number().int().nonnegative();
const nullableCountSchema = countSchema.nullable();
const rateSchema = z.object({
  numerator: countSchema,
  denominator: countSchema,
  basis_points: countSchema.max(1_000_000).nullable(),
  suppressed: z.boolean(),
}).strict();
const privacyCountSchema = z.object({
  value: nullableCountSchema,
  suppressed: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.suppressed !== (value.value === null)) {
    context.addIssue({ code: 'custom', message: 'Suppressed analytics values must be null.' });
  }
});
const deliveryCountsSchema = z.object({
  pending: countSchema,
  delivered: countSchema,
  suppressed: countSchema,
  failed: countSchema,
  dead_lettered: countSchema,
}).strict();

export const eventAnalyticsSummarySchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  event_title: z.string().min(1),
  generated_at: z.string().datetime({ offset: true }),
  privacy_threshold: z.number().int().min(5),
  registration: z.object({
    capacity_limit: nullableCountSchema,
    confirmed: countSchema,
    pending: countSchema,
    invited: countSchema,
    declined: countSchema,
    cancelled: countSchema,
    remaining: nullableCountSchema,
    completion_transitions: countSchema,
    cancellation_transitions: countSchema,
  }).strict(),
  invitation: z.object({
    available: z.boolean(),
    issued: countSchema,
    accepted: countSchema,
    revoked: countSchema,
    expired: countSchema,
    conversion: rateSchema,
  }).strict(),
  waitlist: z.object({
    current_waiting: countSchema,
    current_offered: countSchema,
    joined: countSchema,
    offered: countSchema,
    accepted: countSchema,
    expired: countSchema,
    cancelled: countSchema,
    conversion: rateSchema,
  }).strict(),
  attendance: z.object({
    checked_in: countSchema,
    checked_out: countSchema,
    attended: countSchema,
    no_show: countSchema,
    attendance_rate: rateSchema,
  }).strict(),
  tickets: z.object({
    available: z.boolean(),
    redacted: z.boolean(),
    confirmed_entitlements: nullableCountSchema,
    confirmed_units: nullableCountSchema,
    cancelled_units: nullableCountSchema,
    confirmed_credit_value: z.string().regex(/^\d+\.\d{2}$/).nullable(),
  }).strict(),
  credits: z.object({
    completed_claims: countSchema,
    completed_amount: z.string().regex(/^\d+\.\d{2}$/),
    pending_claims: countSchema,
    failed_claims: countSchema,
    reversed_claims: countSchema,
  }).strict(),
  communications: deliveryCountsSchema.extend({
    delivery_rate: rateSchema,
    by_channel: z.record(z.string().min(1), deliveryCountsSchema),
  }).strict(),
  optional_funnel: z.object({
    event_views: privacyCountSchema,
    registration_starts: privacyCountSchema,
    start_to_registration_conversion: rateSchema,
  }).strict(),
  safeguarding: z.object({
    available: z.boolean(),
    // Guardian consent is retired (adults-only decision 2026-09-25): the count
    // is no longer displayed and the server may stop sending it.
    guardian_consents: privacyCountSchema.optional(),
  }).strict(),
}).strict();

export type EventAnalyticsSummary = z.infer<typeof eventAnalyticsSummarySchema>;

function contractDrift(endpoint: string, error: z.ZodError): void {
  logError('Events analytics contract validation failed', {
    endpoint,
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  });
}

function parseSummary(
  endpoint: string,
  response: ApiResponse<unknown>,
): ApiResponse<EventAnalyticsSummary> {
  if (!response.success || response.data === undefined) {
    return response as ApiResponse<EventAnalyticsSummary>;
  }
  const parsed = eventAnalyticsSummarySchema.safeParse(response.data);
  if (!parsed.success) {
    contractDrift(endpoint, parsed.error);
    return {
      ...response,
      success: false,
      data: undefined,
      code: 'EVENT_ANALYTICS_CONTRACT_DRIFT',
    };
  }

  return { ...response, data: parsed.data };
}

export const eventAnalyticsApi = {
  async get(
    eventId: number,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventAnalyticsSummary>> {
    const endpoint = `/v2/events/${eventId}/analytics`;
    return parseSummary(endpoint, await api.get(endpoint, options));
  },

  download(eventId: number): Promise<Blob> {
    const endpoint = `/v2/events/${eventId}/analytics/export.csv`;
    return api.download(endpoint, { filename: `event-${eventId}-analytics.csv` });
  },
};
