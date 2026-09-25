// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import { api, type ApiResponse, type RequestOptions } from '@/lib/api';
import { logError } from '@/lib/logger';

export const EVENT_SAFETY_CONTRACT_VERSION = 1 as const;
export const EVENT_SAFETY_CONTRACT_HEADER = 'X-Event-Safety-Contract' as const;

const nullableTimestamp = z.string().nullable();
const safetyRequirementStatusSchema = z.enum(['draft', 'published', 'archived']);
const safetyEligibilityStatusSchema = z.enum(['allow', 'deny', 'unavailable', 'not_evaluated']);
// Guardian consent is retired (adults-only decision 2026-09-25). The server may
// still send the old guardian fields for a while, or may drop them, so every one
// of them is optional here: the strict schemas must accept both shapes.
const guardianConsentStatusSchema = z.enum([
  'not_required',
  'required',
  'pending',
  'active',
  'withdrawn',
  'expired',
]);
const participationDecisionSchema = z.enum(['deny', 'remove']);
const participationReasonSchema = z.enum([
  'safeguarding_policy',
  'minimum_age',
  'guardian_consent',
  'code_of_conduct',
  'conduct_violation',
  'safety_review',
  'user_block',
]);
const participationStatusSchema = z.enum(['active', 'withdrawn', 'expired']);

const eventSafetyVersionSchema = z.object({
  number: z.number().int().positive(),
  minimum_age: z.number().int().min(0).max(150).nullable(),
  guardian_consent_required: z.boolean().optional(),
  minor_age_threshold: z.number().int().min(1).max(150).nullable().optional(),
  code_of_conduct: z.object({
    required: z.boolean(),
    text: z.string().nullable(),
    text_version: z.string().nullable(),
    text_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }).strict(),
  published_at: nullableTimestamp,
}).strict();

export const eventSafetySchema = z.object({
  contract_version: z.literal(EVENT_SAFETY_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  rollout: z.object({
    mode: z.enum(['off', 'shadow', 'enforce']),
    source: z.enum(['global', 'tenant_override']),
    configuration_valid: z.boolean(),
    enforcement_active: z.boolean(),
  }).strict(),
  requirements: z.object({
    status: safetyRequirementStatusSchema,
    revision: z.number().int().positive(),
    current_version: z.number().int().positive(),
    published_version: z.number().int().positive().nullable(),
    version: eventSafetyVersionSchema,
  }).strict().nullable(),
  eligibility: z.object({
    status: safetyEligibilityStatusSchema,
    reason_codes: z.array(z.string().min(1)),
    required_actions: z.array(z.string().min(1)),
    requirements_version: z.number().int().positive().nullable(),
    age_at_event: z.number().int().min(0).max(150).nullable(),
    minor_at_event: z.boolean().nullable(),
  }).strict(),
  evidence: z.object({
    code_of_conduct: z.object({
      status: z.enum(['not_required', 'required', 'acknowledged']),
      acknowledgement_id: z.number().int().positive().nullable(),
      text_version: z.string().nullable(),
      acknowledged_at: nullableTimestamp,
    }).strict(),
    guardian_consent: z.object({
      status: guardianConsentStatusSchema,
      consent_id: z.number().int().positive().nullable(),
      consent_version: z.number().int().positive().nullable(),
      expires_at: nullableTimestamp,
      granted_at: nullableTimestamp,
    }).strict().optional(),
    active_denial: z.object({
      id: z.number().int().positive(),
      decision: participationDecisionSchema,
      reason_code: participationReasonSchema,
      status: participationStatusSchema,
      decision_version: z.number().int().positive(),
      effective_from: z.string(),
      effective_until: nullableTimestamp,
    }).strict().nullable(),
  }).strict(),
  permissions: z.object({
    manage_requirements: z.boolean(),
    review_participation: z.boolean(),
    acknowledge_code_of_conduct: z.boolean(),
    withdraw_code_of_conduct: z.boolean(),
    request_guardian_consent: z.boolean().optional(),
    withdraw_guardian_consent: z.boolean().optional(),
  }).strict(),
  privacy: z.object({
    guardian_identity_redacted: z.literal(true).optional(),
    guardian_token_redacted: z.literal(true).optional(),
    safeguarding_policy_evidence_redacted: z.literal(true),
    free_text_review_notes_supported: z.literal(false),
  }).strict(),
}).strict();

const reviewActorSchema = z.object({
  id: z.number().int().positive(),
  display_name: z.string(),
}).strict();

const reviewHistorySchema = z.object({
  decision_version: z.number().int().positive(),
  decision: participationDecisionSchema,
  reason_code: participationReasonSchema,
  status: participationStatusSchema,
  action: z.enum(['recorded', 'withdrawn', 'expired']),
  effective_from: z.string(),
  effective_until: nullableTimestamp,
  reviewed_at: z.string(),
  reviewer: reviewActorSchema,
}).strict();

export const eventSafetyReviewsSchema = z.object({
  items: z.array(z.object({
    denial: z.object({
      id: z.number().int().positive(),
      decision: participationDecisionSchema,
      reason_code: participationReasonSchema,
      status: participationStatusSchema,
      decision_version: z.number().int().positive(),
      effective_from: z.string(),
      effective_until: nullableTimestamp,
      reviewed_at: z.string(),
    }).strict(),
    member: z.object({
      id: z.number().int().positive(),
      display_name: z.string(),
      avatar_url: z.string().nullable(),
    }).strict(),
    reviewer: reviewActorSchema,
    history: z.array(reviewHistorySchema),
  }).strict()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
}).strict();

export type EventSafety = z.infer<typeof eventSafetySchema>;
export type EventSafetyReviews = z.infer<typeof eventSafetyReviewsSchema>;
export type EventSafetyRequirementDraft = {
  minimum_age: number | null;
  guardian_consent_required: boolean;
  minor_age_threshold: number | null;
  code_of_conduct_required: boolean;
  code_of_conduct_text: string | null;
  code_of_conduct_text_version: string | null;
};
export type ParticipationReviewRequest = {
  user_id: number;
  decision: z.infer<typeof participationDecisionSchema>;
  reason_code: z.infer<typeof participationReasonSchema>;
  effective_from: string;
  effective_until: string | null;
  expected_version: number | null;
};

function withContract(options?: RequestOptions, idempotencyKey?: string): RequestOptions {
  const headers = new Headers(options?.headers);
  headers.set('X-Events-Contract', '2');
  headers.set(EVENT_SAFETY_CONTRACT_HEADER, String(EVENT_SAFETY_CONTRACT_VERSION));
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  return { ...options, headers };
}

function reportContractDrift(endpoint: string, error: z.ZodError): void {
  // Never include payload values: safety responses can reveal age and review state.
  logError('Event Safety contract drift', {
    endpoint,
    version: EVENT_SAFETY_CONTRACT_VERSION,
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    })),
  });
}

export function parseEventSafetyResponse<T>(
  endpoint: string,
  response: ApiResponse<unknown>,
  schema: z.ZodType<T>,
): ApiResponse<T> {
  if (!response.success) return response as ApiResponse<T>;
  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ...response, data: parsed.data };
  reportContractDrift(endpoint, parsed.error);

  return {
    ...response,
    success: false,
    data: undefined,
    error: undefined,
    code: 'EVENT_SAFETY_CONTRACT_DRIFT',
  };
}

export const eventSafetyApi = {
  async get(eventId: number, options?: RequestOptions): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety`;
    return parseEventSafetyResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventSafetySchema,
    );
  },

  async saveDraft(
    eventId: number,
    draft: EventSafetyRequirementDraft,
    expectedRevision: number | null,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety/requirements`;
    return parseEventSafetyResponse(
      endpoint,
      await api.put(endpoint, { ...draft, expected_revision: expectedRevision }, withContract(undefined, idempotencyKey)),
      eventSafetySchema,
    );
  },

  async publish(
    eventId: number,
    expectedRevision: number,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety/requirements/publish`;
    return parseEventSafetyResponse(
      endpoint,
      await api.post(endpoint, {
        expected_revision: expectedRevision,
        expected_version: expectedVersion,
      }, withContract(undefined, idempotencyKey)),
      eventSafetySchema,
    );
  },

  async archive(
    eventId: number,
    expectedRevision: number,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety/requirements/archive`;
    return parseEventSafetyResponse(
      endpoint,
      await api.post(endpoint, {
        expected_revision: expectedRevision,
        expected_version: expectedVersion,
      }, withContract(undefined, idempotencyKey)),
      eventSafetySchema,
    );
  },

  async acknowledgeCode(
    eventId: number,
    textVersion: string,
    textHash: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety/code-of-conduct/acknowledgements`;
    return parseEventSafetyResponse(
      endpoint,
      await api.post(endpoint, {
        text_version: textVersion,
        text_hash: textHash,
      }, withContract(undefined, idempotencyKey)),
      eventSafetySchema,
    );
  },

  async withdrawCode(
    eventId: number,
    acknowledgementId: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafety>> {
    const endpoint = `/v2/events/${eventId}/safety/code-of-conduct/acknowledgements/${acknowledgementId}`;
    return parseEventSafetyResponse(
      endpoint,
      await api.delete(endpoint, withContract(undefined, idempotencyKey)),
      eventSafetySchema,
    );
  },

  async reviews(
    eventId: number,
    page = 1,
    perPage = 25,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventSafetyReviews>> {
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const endpoint = `/v2/events/${eventId}/safety/reviews?${query}`;
    return parseEventSafetyResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventSafetyReviewsSchema,
    );
  },

  async recordReview(
    eventId: number,
    payload: ParticipationReviewRequest,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafetyReviews>> {
    const endpoint = `/v2/events/${eventId}/safety/reviews`;
    return parseEventSafetyResponse(
      endpoint,
      await api.post(endpoint, payload, withContract(undefined, idempotencyKey)),
      eventSafetyReviewsSchema,
    );
  },

  async withdrawReview(
    eventId: number,
    denialId: number,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventSafetyReviews>> {
    const endpoint = `/v2/events/${eventId}/safety/reviews/${denialId}`;
    return parseEventSafetyResponse(
      endpoint,
      await api.delete(endpoint, withContract({ body: { expected_version: expectedVersion } }, idempotencyKey)),
      eventSafetyReviewsSchema,
    );
  },
};
