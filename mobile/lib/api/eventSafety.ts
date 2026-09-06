// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';
import { api, ApiResponseError, type RequestOptions } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export const EVENT_SAFETY_CONTRACT_VERSION = 1 as const;
export const EVENT_SAFETY_CONTRACT_HEADER = 'X-Event-Safety-Contract' as const;

const nullableTimestamp = z.string().nullable();

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
    status: z.enum(['draft', 'published', 'archived']),
    revision: z.number().int().positive(),
    current_version: z.number().int().positive(),
    published_version: z.number().int().positive().nullable(),
    version: z.object({
      number: z.number().int().positive(),
      minimum_age: z.number().int().min(0).max(150).nullable(),
      guardian_consent_required: z.boolean(),
      minor_age_threshold: z.number().int().min(1).max(150).nullable(),
      code_of_conduct: z.object({
        required: z.boolean(),
        text: z.string().nullable(),
        text_version: z.string().nullable(),
        text_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
      }).strict(),
      published_at: nullableTimestamp,
    }).strict(),
  }).strict().nullable(),
  eligibility: z.object({
    status: z.enum(['allow', 'deny', 'unavailable', 'not_evaluated']),
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
      status: z.enum(['not_required', 'required', 'pending', 'active', 'withdrawn', 'expired']),
      consent_id: z.number().int().positive().nullable(),
      consent_version: z.number().int().positive().nullable(),
      expires_at: nullableTimestamp,
      granted_at: nullableTimestamp,
    }).strict(),
    active_denial: z.object({
      id: z.number().int().positive(),
      decision: z.enum(['deny', 'remove']),
      reason_code: z.enum([
        'safeguarding_policy',
        'minimum_age',
        'guardian_consent',
        'code_of_conduct',
        'conduct_violation',
        'safety_review',
        'user_block',
      ]),
      status: z.enum(['active', 'withdrawn', 'expired']),
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
    request_guardian_consent: z.boolean(),
    withdraw_guardian_consent: z.boolean(),
  }).strict(),
  privacy: z.object({
    guardian_identity_redacted: z.literal(true),
    guardian_token_redacted: z.literal(true),
    safeguarding_policy_evidence_redacted: z.literal(true),
    free_text_review_notes_supported: z.literal(false),
  }).strict(),
}).strict();

const eventSafetyEnvelopeSchema = z.object({ data: eventSafetySchema }).passthrough();

export type EventSafety = z.infer<typeof eventSafetySchema>;
export type GuardianRelationship = 'parent' | 'guardian' | 'legal_guardian' | 'carer';

function requestOptions(idempotencyKey?: string): RequestOptions {
  return {
    headers: {
      'X-Events-Contract': '2',
      [EVENT_SAFETY_CONTRACT_HEADER]: String(EVENT_SAFETY_CONTRACT_VERSION),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  };
}

function parseSafety(endpoint: string, response: unknown): { data: EventSafety } {
  const parsed = eventSafetyEnvelopeSchema.safeParse(response);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Event Safety contract drift', {
    level: 'warning',
    tags: {
      module: 'events',
      contract_version: String(EVENT_SAFETY_CONTRACT_VERSION),
      endpoint: endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}'),
    },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_SAFETY_CONTRACT_DRIFT');
}

export async function getEventSafety(eventId: number): Promise<{ data: EventSafety }> {
  const endpoint = `${API_V2}/events/${eventId}/safety`;
  return parseSafety(endpoint, await api.get<unknown>(endpoint, undefined, requestOptions()));
}

export async function acknowledgeEventCode(
  eventId: number,
  textVersion: string,
  textHash: string,
  idempotencyKey: string,
): Promise<{ data: EventSafety }> {
  const endpoint = `${API_V2}/events/${eventId}/safety/code-of-conduct/acknowledgements`;
  return parseSafety(endpoint, await api.post<unknown>(endpoint, {
    text_version: textVersion,
    text_hash: textHash,
  }, requestOptions(idempotencyKey)));
}

export async function withdrawEventCode(
  eventId: number,
  acknowledgementId: number,
  idempotencyKey: string,
): Promise<{ data: EventSafety }> {
  const endpoint = `${API_V2}/events/${eventId}/safety/code-of-conduct/acknowledgements/${acknowledgementId}`;
  return parseSafety(endpoint, await api.delete<unknown>(endpoint, requestOptions(idempotencyKey)));
}

export async function requestEventGuardianConsent(
  eventId: number,
  input: {
    guardianName: string;
    guardianEmail: string;
    relationship: GuardianRelationship;
    preferredLanguage: string;
  },
  idempotencyKey: string,
): Promise<{ data: EventSafety }> {
  const endpoint = `${API_V2}/events/${eventId}/safety/guardian-consents`;
  return parseSafety(endpoint, await api.post<unknown>(endpoint, {
    guardian_name: input.guardianName,
    guardian_email: input.guardianEmail,
    relationship_code: input.relationship,
    preferred_language: input.preferredLanguage,
  }, requestOptions(idempotencyKey)));
}

export async function withdrawEventGuardianConsent(
  eventId: number,
  consentId: number,
  idempotencyKey: string,
): Promise<{ data: EventSafety }> {
  const endpoint = `${API_V2}/events/${eventId}/safety/guardian-consents/${consentId}`;
  return parseSafety(endpoint, await api.delete<unknown>(endpoint, requestOptions(idempotencyKey)));
}
