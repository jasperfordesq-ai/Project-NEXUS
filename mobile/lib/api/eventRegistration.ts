// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';
import { api, ApiResponseError, type RequestOptions } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export const EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION = 1 as const;
export const EVENT_REGISTRATION_PRODUCT_CONTRACT_HEADER = 'X-Event-Registration-Product-Contract' as const;

const classificationSchema = z.enum(['public', 'internal', 'confidential', 'sensitive']);
const questionTypeSchema = z.enum([
  'short_text',
  'long_text',
  'single_choice',
  'multiple_choice',
  'dietary',
  'accessibility',
  'consent',
  'waiver',
]);

export const registrationQuestionSchema = z.object({
  id: z.number().int().positive(),
  stable_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  position: z.number().int().positive(),
  question_type: questionTypeSchema,
  prompt: z.string().min(1),
  help_text: z.string().nullable().optional(),
  is_required: z.boolean(),
  data_classification: classificationSchema,
  purpose: z.string().min(1),
  retention_days: z.number().int().positive(),
  choice_options: z.array(z.string()).nullable().optional(),
  validation_rules: z.record(z.string(), z.unknown()).nullable().optional(),
  visibility_rules: z.record(z.string(), z.unknown()).nullable().optional(),
  displayed_text: z.string().nullable().optional(),
  displayed_text_version: z.string().nullable().optional(),
}).passthrough();

export const registrationFormSchema = z.object({
  id: z.number().int().positive(),
  version_number: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.literal('published'),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  questions: z.array(registrationQuestionSchema),
}).passthrough();

export const registrationSettingsSchema = z.object({
  id: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.literal('published'),
  guests_enabled: z.boolean(),
  max_guests_per_registration: z.number().int().nonnegative(),
  guest_retention_days: z.number().int().positive(),
}).passthrough();

export const registrationRecordSchema = z.object({
  id: z.number().int().positive(),
  registration_version: z.number().int().positive(),
  registration_state: z.enum(['invited', 'pending', 'confirmed', 'waitlisted', 'offered', 'declined', 'cancelled']),
  party_size: z.number().int().positive(),
  state_changed_at: z.string(),
  invited_at: z.string().nullable(),
  pending_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  declined_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
}).strict();

export const registrationSubmissionSchema = z.object({
  id: z.number().int().positive(),
  registration_id: z.number().int().positive(),
  form_version_id: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(['draft', 'submitted', 'withdrawn', 'anonymised']),
  attempt_number: z.number().int().positive(),
  effective_slot: z.number().int().nullable(),
  submitted_at: z.string().nullable().optional(),
  withdrawn_at: z.string().nullable().optional(),
  anonymised_at: z.string().nullable().optional(),
  superseded_at: z.string().nullable().optional(),
  supersedes_submission_id: z.number().int().positive().nullable(),
  lineage_root_submission_id: z.number().int().positive().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).strict();

export const registrationGuestSchema = z.object({
  id: z.number().int().positive(),
  registration_id: z.number().int().positive(),
  guest_number: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(['captured', 'withdrawn', 'anonymised']),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  preferred_locale: z.string().nullable().optional(),
  notification_consent: z.boolean(),
  ticket_entitlement_id: z.number().int().positive().nullable().optional(),
}).passthrough();

export const registrationInvitationSchema = z.object({
  id: z.number().int().positive(),
  campaign_id: z.number().int().positive(),
  status: z.enum(['issued', 'accepted', 'revoked', 'expired']),
  invitation_version: z.number().int().positive(),
  token_expires_at: z.string(),
}).passthrough();

export const attendeeRegistrationProductSchema = z.object({
  settings: registrationSettingsSchema.nullable(),
  form: registrationFormSchema.nullable(),
  registrations: z.array(registrationRecordSchema),
  submissions: z.array(registrationSubmissionSchema),
  guests: z.array(registrationGuestSchema),
  invitations: z.array(registrationInvitationSchema),
}).strict();

const attendeeEnvelopeSchema = z.object({ data: attendeeRegistrationProductSchema }).passthrough();
const submissionMutationEnvelopeSchema = z.object({
  data: z.object({
    submission: registrationSubmissionSchema,
    changed: z.boolean(),
    idempotent_replay: z.boolean(),
  }).passthrough(),
}).passthrough();
const amendmentEnvelopeSchema = z.object({
  data: z.object({
    submission: registrationSubmissionSchema,
    superseded_submission: registrationSubmissionSchema,
    changed: z.boolean(),
  }).passthrough(),
}).passthrough();
const answersEnvelopeSchema = z.object({
  data: z.object({
    answers: z.record(z.string(), z.object({
      question_id: z.number().int().positive(),
      value: z.unknown(),
      purged: z.boolean(),
      classification: classificationSchema,
    }).strict()),
  }).strict(),
}).passthrough();
const guestMutationEnvelopeSchema = z.object({
  data: z.object({ guest: registrationGuestSchema }).passthrough(),
}).passthrough();

export type AttendeeRegistrationProduct = z.infer<typeof attendeeRegistrationProductSchema>;
export type RegistrationQuestion = z.infer<typeof registrationQuestionSchema>;
export type RegistrationSubmission = z.infer<typeof registrationSubmissionSchema>;
export type RegistrationGuest = z.infer<typeof registrationGuestSchema>;

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true }).nullable();

// Organiser settings include drafts. Keep the attendee's published-only contract separate.
export const organizerRegistrationSettingsSchema = z.object({
  id: safeId,
  event_id: safeId,
  revision: safeId,
  status: z.enum(['draft', 'published']),
  approval_mode: z.enum(['auto', 'manual']),
  form_state: z.enum(['none', 'draft', 'published']),
  published_form_version: safeId.nullable(),
  per_member_limit: z.number().int().min(1).max(10),
  guests_enabled: z.boolean(),
  max_guests_per_registration: z.number().int().min(0).max(10),
  guest_retention_days: z.number().int().min(1).max(36500),
  opens_at_utc: instant,
  closes_at_utc: instant,
  cancellation_cutoff_at_utc: instant,
  event_timezone_snapshot: z.string().min(1),
});

export const registrationSettingsInputSchema = organizerRegistrationSettingsSchema.pick({
  approval_mode: true, per_member_limit: true, guests_enabled: true,
  max_guests_per_registration: true, guest_retention_days: true,
  opens_at_utc: true, closes_at_utc: true, cancellation_cutoff_at_utc: true,
}).extend({ expected_revision: revision }).strict().superRefine((input, ctx) => {
  if ((input.opens_at_utc === null) !== (input.closes_at_utc === null)
    || (input.opens_at_utc !== null && input.closes_at_utc !== null
      && Date.parse(input.opens_at_utc) >= Date.parse(input.closes_at_utc))) {
    ctx.addIssue({ code: 'custom', path: ['closes_at_utc'], message: 'Invalid registration window' });
  }
  if (input.guests_enabled ? input.max_guests_per_registration < 1 : input.max_guests_per_registration !== 0) {
    ctx.addIssue({ code: 'custom', path: ['max_guests_per_registration'], message: 'Invalid guest limit' });
  }
});

export type OrganizerRegistrationSettings = z.infer<typeof organizerRegistrationSettingsSchema>;
export type RegistrationSettingsInput = z.infer<typeof registrationSettingsInputSchema>;

const settingsReadSchema = z.object({ data: z.object({ settings: organizerRegistrationSettingsSchema.nullable() }) });
const settingsWriteSchema = z.object({ data: z.object({
  settings: organizerRegistrationSettingsSchema,
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
}) });

/** Read only the settings projection; do not retain unrelated roster/answer data. */
export async function getOrganizerRegistrationSettings(eventId: number) {
  safeId.parse(eventId);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/manage`;
  return parse(endpoint, settingsReadSchema, await api.get<unknown>(endpoint, undefined, requestOptions()));
}

export async function saveOrganizerRegistrationSettings(eventId: number, input: RegistrationSettingsInput, idempotencyKey: string) {
  safeId.parse(eventId);
  const payload = registrationSettingsInputSchema.parse(input);
  const key = z.string().min(1).max(191).refine(value => value.trim() === value).parse(idempotencyKey);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/settings`;
  return parse(endpoint, settingsWriteSchema, await api.put<unknown>(endpoint, {
    ...payload, idempotency_key: key,
  }, requestOptions(key)));
}

export async function publishOrganizerRegistrationSettings(eventId: number, expectedRevision: number, idempotencyKey: string) {
  safeId.parse(eventId);
  safeId.parse(expectedRevision);
  const key = z.string().min(1).max(191).refine(value => value.trim() === value).parse(idempotencyKey);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/settings/publish`;
  return parse(endpoint, settingsWriteSchema, await api.post<unknown>(endpoint, {
    expected_revision: expectedRevision, idempotency_key: key,
  }, requestOptions(key)));
}

function requestOptions(idempotencyKey?: string): RequestOptions {
  return {
    headers: {
      'X-Events-Contract': '2',
      [EVENT_REGISTRATION_PRODUCT_CONTRACT_HEADER]: String(EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  };
}

function parse<T>(endpoint: string, schema: z.ZodType<T>, response: unknown): T {
  const parsed = schema.safeParse(response);
  if (parsed.success) return parsed.data;
  reportSentryMessage('Event registration product contract drift', {
    level: 'warning',
    tags: {
      module: 'events',
      contract_version: String(EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION),
      endpoint: endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}'),
    },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT');
}

export async function getAttendeeRegistrationProduct(eventId: number): Promise<{ data: AttendeeRegistrationProduct }> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product`;
  return parse(endpoint, attendeeEnvelopeSchema, await api.get<unknown>(endpoint, undefined, requestOptions()));
}

export async function saveRegistrationSubmission(
  eventId: number,
  input: {
    registrationId: number;
    formVersionId: number;
    expectedRevision: number | null;
    answers: Record<string, unknown>;
  },
  idempotencyKey: string,
): Promise<{ data: { submission: RegistrationSubmission; changed: boolean; idempotent_replay: boolean } }> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/submissions`;
  return parse(endpoint, submissionMutationEnvelopeSchema, await api.post<unknown>(endpoint, {
    registration_id: input.registrationId,
    form_version_id: input.formVersionId,
    expected_revision: input.expectedRevision,
    answers: input.answers,
    idempotency_key: idempotencyKey,
  }, requestOptions(idempotencyKey)));
}

export async function submitRegistrationSubmission(
  eventId: number,
  submissionId: number,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<{ data: { submission: RegistrationSubmission; changed: boolean; idempotent_replay: boolean } }> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/submissions/${submissionId}/submit`;
  return parse(endpoint, submissionMutationEnvelopeSchema, await api.post<unknown>(endpoint, {
    expected_revision: expectedRevision,
    idempotency_key: idempotencyKey,
  }, requestOptions(idempotencyKey)));
}

export async function amendRegistrationSubmission(
  eventId: number,
  submissionId: number,
  expectedRevision: number,
  idempotencyKey: string,
) {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/submissions/${submissionId}/amend`;
  return parse(endpoint, amendmentEnvelopeSchema, await api.post<unknown>(endpoint, {
    expected_revision: expectedRevision,
    idempotency_key: idempotencyKey,
  }, requestOptions(idempotencyKey)));
}

export async function getOwnRegistrationAnswers(
  eventId: number,
  submissionId: number,
  correlationId: string,
): Promise<Record<string, unknown>> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/submissions/${submissionId}/answers`;
  const parsed = parse(endpoint, answersEnvelopeSchema, await api.post<unknown>(endpoint, {
    purpose: 'resume_own_registration_draft',
    correlation_id: correlationId,
    include_sensitive: true,
  }, requestOptions()));

  return Object.fromEntries(Object.entries(parsed.data.answers).map(([key, answer]) => [
    key,
    answer.purged ? null : answer.value,
  ]));
}

export async function acceptRegistrationInvitation(
  eventId: number,
  invitationId: number,
  idempotencyKey: string,
): Promise<void> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/invitations/${invitationId}/accept`;
  await api.post<unknown>(endpoint, { idempotency_key: idempotencyKey }, requestOptions(idempotencyKey));
}

export async function captureRegistrationGuest(
  eventId: number,
  registrationId: number,
  input: {
    expectedRegistrationVersion: number;
    displayName: string;
    email?: string;
    phone?: string;
    locale: string;
    consentAccepted: boolean;
    consentText: string;
    consentVersion: string;
    notificationConsent: boolean;
    notificationConsentText?: string;
    notificationConsentVersion?: string;
  },
): Promise<{ data: { guest: RegistrationGuest } }> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/registrations/${registrationId}/guests`;
  return parse(endpoint, guestMutationEnvelopeSchema, await api.post<unknown>(endpoint, {
    expected_registration_version: input.expectedRegistrationVersion,
    display_name: input.displayName,
    email: input.email,
    phone: input.phone,
    preferred_locale: input.locale,
    consent_accepted: input.consentAccepted,
    consent_text: input.consentText,
    consent_text_version: input.consentVersion,
    notification_consent: input.notificationConsent,
    notification_consent_text: input.notificationConsentText,
    notification_consent_version: input.notificationConsentVersion,
  }, requestOptions()));
}

export async function cancelRegistrationGuest(
  eventId: number,
  guestId: number,
  expectedRevision: number,
  reason: string,
): Promise<{ data: { guest: RegistrationGuest } }> {
  const endpoint = `${API_V2}/events/${eventId}/registration-product/guests/${guestId}/cancel`;
  return parse(endpoint, guestMutationEnvelopeSchema, await api.post<unknown>(endpoint, {
    expected_revision: expectedRevision,
    reason,
  }, requestOptions()));
}
