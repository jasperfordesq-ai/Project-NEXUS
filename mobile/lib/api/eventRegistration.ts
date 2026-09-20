// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';
import { api, ApiResponseError, type RequestOptions } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { validRegistrationValidationRules, validRegistrationVisibilityRules } from '@/lib/eventRegistrationFormRules';

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
    answers: z.preprocess(value => Array.isArray(value) && value.length === 0 ? {} : value, z.record(z.string(), z.object({
      question_id: z.number().int().positive(),
      value: z.unknown(),
      purged: z.boolean(),
      classification: classificationSchema,
    }).strict())),
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

// Drafts belong to the organiser contract; attendee reads remain published-only.
export const organizerRegistrationFormSchema = registrationFormSchema.extend({
  id: safeId, event_id: safeId, revision: safeId, version_number: safeId,
  status: z.enum(['draft', 'published']),
  questions: z.array(registrationQuestionSchema.extend({ id: safeId, position: safeId }).strip()),
}).strip();
export const registrationFormDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(4000).nullable(),
  questions: z.array(registrationQuestionSchema.omit({ id: true, position: true }).extend({
    prompt: z.string().trim().min(1).max(2000), purpose: z.string().trim().min(1).max(500),
    help_text: z.string().max(4000).nullable().optional(), retention_days: z.number().int().min(1).max(36500),
  }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.questions.map(question => question.stable_key)).size === value.questions.length,
  { message: 'Duplicate question keys', path: ['questions'] }).superRefine((value, ctx) => {
  value.questions.forEach((question, index) => {
    const issue = (field: string) => ctx.addIssue({ code: 'custom', path: ['questions', index, field], message: 'Invalid question configuration' });
    if (!validRegistrationValidationRules(question.question_type, question.validation_rules)) issue('validation_rules');
    if (!validRegistrationVisibilityRules(question.visibility_rules, value.questions.slice(0, index).map(earlier => earlier.stable_key))) issue('visibility_rules');
    if (['dietary', 'accessibility'].includes(question.question_type)
      && !['confidential', 'sensitive'].includes(question.data_classification)) issue('data_classification');
    const choices = question.choice_options;
    if (['single_choice', 'multiple_choice'].includes(question.question_type)) {
      if (!choices || choices.length < 2 || choices.length > 100 || choices.some(choice => !choice.trim() || choice.trim().length > 191)
        || new Set(choices.map(choice => choice.trim())).size !== choices.length) issue('choice_options');
    } else if (choices && choices.length) issue('choice_options');
    if (['consent', 'waiver'].includes(question.question_type)) {
      if (!question.displayed_text?.trim() || question.displayed_text.trim().length > 20000) issue('displayed_text');
      if (!question.displayed_text_version?.trim() || question.displayed_text_version.trim().length > 64) issue('displayed_text_version');
    } else if (question.displayed_text != null || question.displayed_text_version != null) issue('displayed_text');
  });
});
export const registrationFormIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), definition: registrationFormDefinitionSchema, settingsRevision: safeId }).strict(),
  z.object({ action: z.literal('update'), formId: safeId, formRevision: safeId,
    settingsRevision: safeId, definition: registrationFormDefinitionSchema }).strict(),
  z.object({ action: z.literal('fork'), formId: safeId, settingsRevision: safeId }).strict(),
  z.object({ action: z.literal('publish'), formId: safeId, formRevision: safeId, settingsRevision: safeId }).strict(),
]);
export type OrganizerRegistrationForm = z.infer<typeof organizerRegistrationFormSchema>;
export type RegistrationFormIntent = z.infer<typeof registrationFormIntentSchema>;
export type RegistrationFormDefinition = z.infer<typeof registrationFormDefinitionSchema>;
const organizerFormsReadSchema = z.object({ data: z.object({
  settings: organizerRegistrationSettingsSchema.nullable(), forms: z.array(organizerRegistrationFormSchema),
}) });
const organizerFormWriteSchema = z.object({ data: z.object({
  form: organizerRegistrationFormSchema, settings_revision: safeId,
  changed: z.boolean(), idempotent_replay: z.boolean(),
}) });

/** Keep only policy and form definitions; discard unrelated submissions and guest data. */
export async function getOrganizerRegistrationForms(eventId: number) {
  safeId.parse(eventId);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/manage`;
  return parse(endpoint, organizerFormsReadSchema, await api.get<unknown>(endpoint, undefined, requestOptions()));
}

/** The caller must persist the intent and key before invoking this transport. */
export async function mutateOrganizerRegistrationForm(eventId: number, intent: RegistrationFormIntent, idempotencyKey: string) {
  safeId.parse(eventId);
  const input = registrationFormIntentSchema.parse(intent);
  const key = z.string().min(1).max(191).refine(value => value.trim() === value).parse(idempotencyKey);
  const suffix = input.action === 'create' ? '' : `/${input.formId}${input.action === 'update' ? '' : `/${input.action}`}`;
  const endpoint = `${API_V2}/events/${eventId}/registration-product/forms${suffix}`;
  const payload = {
    ...('definition' in input ? input.definition : {}),
    expected_settings_revision: input.settingsRevision,
    ...('formRevision' in input ? { expected_form_revision: input.formRevision } : {}),
    idempotency_key: key,
  };
  const response = input.action === 'update'
    ? await api.put<unknown>(endpoint, payload, requestOptions(key))
    : await api.post<unknown>(endpoint, payload, requestOptions(key));
  return parse(endpoint, organizerFormWriteSchema, response);
}

// The organiser projection differs from attendee submissions (no created_at/anonymised_at).
const organizerSubmissionSchema = z.object({
  id: safeId, registration_id: safeId, form_version_id: safeId, user_id: safeId,
  member_name: z.string().optional(), revision: safeId,
  status: z.enum(['draft', 'submitted', 'withdrawn', 'anonymised']), attempt_number: safeId,
  effective_slot: z.literal(1).nullable(), supersedes_submission_id: safeId.nullable(),
  lineage_root_submission_id: safeId.nullable(), superseded_at: z.string().nullable(),
  submitted_at: z.string().nullable(), withdrawn_at: z.string().nullable(), updated_at: z.string(),
});
const registrationOverviewPageSchema = z.object({
  page: safeId, per_page: z.number().int().min(1).max(100), total: revision, last_page: safeId,
  page_count: z.number().int().min(0).max(100), from: safeId.nullable(), to: safeId.nullable(),
  has_more: z.boolean(), previous_page: safeId.nullable(), next_page: safeId.nullable(),
});
const organizerSubmissionsSchema = z.object({ data: z.object({
  forms: z.array(organizerRegistrationFormSchema), submissions: z.array(organizerSubmissionSchema),
  pagination: z.object({ submissions: registrationOverviewPageSchema }),
  permissions: z.object({ view_roster: z.boolean(), view_sensitive_answers: z.boolean(), export_answers: z.boolean() }),
}) }).transform(response => ({ data: { ...response.data, submissions: response.data.submissions.map((submission): z.infer<typeof organizerSubmissionSchema> => {
  if (response.data.permissions.view_roster) return submission;
  const { member_name: _name, ...anonymous } = submission;
  return anonymous;
}) } }));
export type OrganizerRegistrationSubmissions = z.infer<typeof organizerSubmissionsSchema>['data'];
export async function getOrganizerRegistrationSubmissions(eventId: number, page = 1, perPage = 25) {
  safeId.parse(eventId); safeId.parse(page); z.number().int().min(1).max(100).parse(perPage);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/manage`;
  return parse(endpoint, organizerSubmissionsSchema.refine(response => response.data.forms.every(form => form.event_id === eventId)), await api.get<unknown>(endpoint,
    { submissions_page: String(page), submissions_per_page: String(perPage), campaigns_per_page: '1', guests_per_page: '1' }, requestOptions()));
}
// Organiser guests include attendance; keep this separate from attendee mutations.
const organizerGuestSchema = registrationGuestSchema.extend({
  phone: z.string().nullable().optional(), retention_due_at: z.string().nullable(),
  withdrawn_at: z.string().nullable(), anonymised_at: z.string().nullable(),
  attendance: z.object({
    id: safeId, status: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']),
    can_undo: z.boolean().optional(), version: revision, checked_in_at: z.string().nullable(), checked_out_at: z.string().nullable(), no_show_at: z.string().nullable(),
  }).nullable(),
}).strip();
const organizerGuestsSchema = z.object({ data: z.object({
  guests: z.array(organizerGuestSchema), pagination: z.object({ guests: registrationOverviewPageSchema }),
  permissions: z.object({ view_roster: z.boolean(), view_sensitive_answers: z.boolean(), manage_attendance: z.boolean() }),
}) }).transform(response => ({ data: { ...response.data, guests: response.data.guests.map(guest => {
  const { display_name, email, phone, ...record } = guest;
  return { ...record,
    ...(response.data.permissions.view_roster ? { display_name } : {}),
    ...(response.data.permissions.view_sensitive_answers ? { email, phone } : {}),
  };
}) } }));
export type OrganizerRegistrationGuests = z.infer<typeof organizerGuestsSchema>['data'];
export async function getOrganizerRegistrationGuests(eventId: number, page = 1, perPage = 25) {
  safeId.parse(eventId); safeId.parse(page); z.number().int().min(1).max(100).parse(perPage);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/manage';
  return parse(endpoint, organizerGuestsSchema, await api.get<unknown>(endpoint,
    { guests_page: String(page), guests_per_page: String(perPage), submissions_per_page: '1', campaigns_per_page: '1' }, requestOptions()));
}

export const registrationGuestAttendanceIntentSchema = z.object({
  guestId: safeId, action: z.enum(['check_in', 'check_out', 'no_show', 'undo']), expectedVersion: revision,
  reason: z.string().trim().refine(value => Array.from(value).length <= 500).optional(),
}).strict().refine(input => input.action !== 'undo' || Boolean(input.reason), { path: ['reason'], message: 'Reason required' });
export type RegistrationGuestAttendanceIntent = z.infer<typeof registrationGuestAttendanceIntentSchema>;
/** The caller owns the stable intent/key and must reconcile uncertain outcomes before another action. */
export async function transitionOrganizerRegistrationGuest(eventId: number, intent: RegistrationGuestAttendanceIntent, idempotencyKey: string) {
  safeId.parse(eventId);
  const input = registrationGuestAttendanceIntentSchema.parse(intent);
  const key = z.string().min(1).max(191).refine(value => value.trim() === value).parse(idempotencyKey);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/guests/' + input.guestId + '/attendance/' + input.action;
  const schema = z.object({ data: z.object({
    attendance: z.object({ id: safeId, event_id: z.literal(eventId), guest_id: z.literal(input.guestId),
      attendance_status: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']), attendance_version: safeId }),
    changed: z.boolean(), replayed: z.boolean(), history_id: safeId,
  }) });
  return parse(endpoint, schema, await api.post<unknown>(endpoint, {
    expected_version: input.expectedVersion, reason: input.reason || null, idempotency_key: key,
  }, requestOptions(key)));
}

const answerAccessSchema = z.object({
  purpose: z.string().trim().min(1).refine(value => Array.from(value).length <= 500),
  correlation_id: z.string().trim().min(1).refine(value => new TextEncoder().encode(value).length <= 512),
  include_sensitive: z.boolean(),
}).strict();
export type RegistrationAnswerAccess = z.infer<typeof answerAccessSchema>;
/** Explicit audited read. Never call this from automatic refresh, focus or retry effects. */
export async function reviewOrganizerRegistrationAnswers(eventId: number, submissionId: number, input: RegistrationAnswerAccess) {
  safeId.parse(eventId); safeId.parse(submissionId);
  const evidence = answerAccessSchema.parse(input);
  const endpoint = `${API_V2}/events/${eventId}/registration-product/submissions/${submissionId}/answers`;
  const schema = answersEnvelopeSchema.refine(response => evidence.include_sensitive
    || Object.values(response.data.answers).every(answer => answer.classification !== 'sensitive'));
  const response = parse(endpoint, schema, await api.post<unknown>(endpoint, evidence, requestOptions()));
  return { data: { answers: Object.fromEntries(Object.entries(response.data.answers)
    .map(([key, answer]) => [key, { ...answer, value: answer.purged ? null : answer.value }])) } };
}

/** Explicit audited export; the caller owns the returned private file until disposal. */
export async function prepareOrganizerRegistrationExport(eventId: number, input: RegistrationAnswerAccess, isActive: () => boolean) {
  safeId.parse(eventId); const evidence = answerAccessSchema.parse(input);
  if (!isActive()) throw new Error('download_cancelled');
  // Load native streaming support only for an explicit export, not ordinary registration reads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prepareAuditedCsv } = require('@/lib/prepareAuditedCsv') as typeof import('@/lib/prepareAuditedCsv');
  return prepareAuditedCsv(`${API_V2}/events/${eventId}/registration-product/submissions/export`,
    `event-registration-${eventId}.csv`, evidence, requestOptions().headers ?? {}, isActive);
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

// Campaign responses intentionally exclude encrypted source snapshots and recipient identities.
const campaignType = z.enum(['member', 'email', 'group', 'audience', 'csv']);
export const organizerInvitationCampaignSchema = z.object({
  id: safeId, event_id: safeId, campaign_type: campaignType,
  status: z.enum(['previewed', 'scheduled', 'issuing', 'issued', 'cancelled']), revision: safeId,
  preview_count: revision, valid_count: revision, error_count: revision,
  preview_errors: z.array(z.object({ row: safeId, code: z.string() })),
  default_locale: z.string(), scheduled_for_utc: z.string().nullable().optional(),
  issued_at: z.string().nullable().optional(), cancelled_at: z.string().nullable().optional(),
  segment_criteria_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  invitations_count: revision.optional(),
  delivery_counts: z.union([z.record(z.string(), revision), z.array(z.never()).length(0).transform((): Record<string, number> => ({}))]).optional(),
}).strip();
export type OrganizerInvitationCampaign = z.infer<typeof organizerInvitationCampaignSchema>;
export async function getOrganizerInvitationCampaigns(eventId: number, page = 1, perPage = 25) {
  safeId.parse(eventId); safeId.parse(page); z.number().int().min(1).max(100).parse(perPage);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/manage';
  const schema = z.object({ data: z.object({
    campaigns: z.array(organizerInvitationCampaignSchema.refine(item => item.event_id === eventId)),
    pagination: z.object({ campaigns: registrationOverviewPageSchema }),
  }) });
  return parse(endpoint, schema, await api.get<unknown>(endpoint,
    { campaigns_page: String(page), campaigns_per_page: String(perPage), submissions_per_page: '1', guests_per_page: '1' }, requestOptions()));
}
export const invitationCampaignIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), campaignType, source: z.record(z.string(), z.unknown()),
    defaultLocale: z.enum(['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) }).strict(),
  z.object({ action: z.literal('issue'), campaignId: safeId, expectedRevision: safeId, expiresAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('schedule'), campaignId: safeId, expectedRevision: safeId, scheduledFor: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('cancel'), campaignId: safeId, expectedRevision: safeId,
    reason: z.string().trim().min(1).refine(value => Array.from(value).length <= 500) }).strict(),
]);
export type InvitationCampaignIntent = z.infer<typeof invitationCampaignIntentSchema>;
/** Caller owns and persists the request key. Never automatically retries or issues a preview. */
export async function mutateOrganizerInvitationCampaign(eventId: number, intent: InvitationCampaignIntent, idempotencyKey: string) {
  safeId.parse(eventId);
  const input = invitationCampaignIntentSchema.parse(intent);
  const key = z.string().min(1).max(191).refine(value => value.trim() === value).parse(idempotencyKey);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/campaigns/'
    + (input.action === 'preview' ? 'preview' : input.campaignId + '/' + input.action);
  const body = input.action === 'preview'
    ? { campaign_type: input.campaignType, source: input.source, default_locale: input.defaultLocale }
    : { expected_revision: input.expectedRevision,
      ...(input.action === 'issue' ? { expires_at: input.expiresAt }
        : input.action === 'schedule' ? { scheduled_for: input.scheduledFor } : { reason: input.reason }) };
  const schema = z.object({ data: z.object({
    campaign: organizerInvitationCampaignSchema.refine(item => item.event_id === eventId
      && (input.action === 'preview' ? item.campaign_type === input.campaignType : item.id === input.campaignId)),
    changed: z.boolean(), idempotent_replay: z.boolean(),
  }) });
  return parse(endpoint, schema, await api.post<unknown>(endpoint, { ...body, idempotency_key: key }, requestOptions(key)));
}


export const organizerRetentionRunSchema = z.object({
  id: safeId, event_id: safeId, mode: z.enum(['dry_run', 'apply']), dry_run_id: safeId.nullable(),
  as_of_utc: z.string().datetime({ offset: true }), eligible_count: z.number().int().nonnegative().safe(),
  affected_count: z.number().int().nonnegative().safe(), completed_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
}).strip().refine(run => run.affected_count <= run.eligible_count
  && (run.mode === 'dry_run' ? run.dry_run_id === null && run.affected_count === 0 : run.dry_run_id !== null));
export type OrganizerRetentionRun = z.infer<typeof organizerRetentionRunSchema>;
export const retentionIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), asOf: z.string().datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('apply'), dryRunId: safeId }).strict(),
]);
export type RetentionIntent = z.infer<typeof retentionIntentSchema>;
export async function getOrganizerRetentionHistory(eventId: number, page = 1, perPage = 25) {
  safeId.parse(eventId); safeId.parse(page); z.number().int().min(1).max(100).parse(perPage);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/retention';
  const schema = z.object({ data: z.object({ event_id: z.literal(eventId),
    runs: z.array(organizerRetentionRunSchema.refine(run => run.event_id === eventId)),
    permissions: z.object({ manage_retention: z.boolean() }), pagination: registrationOverviewPageSchema,
  }) });
  return parse(endpoint, schema, await api.get<unknown>(endpoint, { page: String(page), per_page: String(perPage) }, requestOptions()));
}
export async function mutateOrganizerRetention(eventId: number, intent: RetentionIntent, key: string) {
  safeId.parse(eventId);
  z.string().min(1).max(191).refine(value => value === value.trim()).parse(key);
  const input = retentionIntentSchema.parse(intent);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/retention/'
    + (input.action === 'preview' ? 'dry-run' : input.dryRunId + '/apply');
  const schema = z.object({ data: z.object({
    run: organizerRetentionRunSchema.refine(run => run.event_id === eventId
      && (input.action === 'preview' ? run.mode === 'dry_run' && Date.parse(run.as_of_utc) === Date.parse(input.asOf)
        : run.mode === 'apply' && run.dry_run_id === input.dryRunId)),
    changed: z.boolean(), idempotent_replay: z.boolean(),
  }).refine(data => data.changed !== data.idempotent_replay) });
  return parse(endpoint, schema, await api.post<unknown>(endpoint, {
    ...(input.action === 'preview' ? { as_of: input.asOf } : {}), idempotency_key: key,
  }, requestOptions(key)));
}

/** Minimal organiser receipt: recipient identities and invitation tokens stay out of saved recovery state. */
export const revokedInvitationSchema = z.object({
  id: safeId, event_id: safeId, campaign_id: safeId, status: z.literal('revoked'),
  invitation_version: z.number().int().min(2).safe(), revoked_at: z.string().datetime({ offset: true }),
}).strip();
export const invitationRevocationIntentSchema = z.object({
  invitationId: safeId,
  reason: z.string().trim().min(1).refine(value => Array.from(value).length <= 500),
}).strict();
export type InvitationRevocationIntent = z.infer<typeof invitationRevocationIntentSchema>;
export async function revokeOrganizerInvitation(eventId: number, intent: InvitationRevocationIntent, key: string) {
  safeId.parse(eventId);
  z.string().min(1).max(191).refine(value => value === value.trim()).parse(key);
  const input = invitationRevocationIntentSchema.parse(intent);
  const endpoint = API_V2 + '/events/' + eventId + '/registration-product/invitations/' + input.invitationId + '/revoke';
  const schema = z.object({ data: z.object({
    invitation: revokedInvitationSchema.refine(value => value.event_id === eventId && value.id === input.invitationId),
    changed: z.boolean(), idempotent_replay: z.boolean(),
  }).refine(value => value.changed !== value.idempotent_replay) });
  return parse(endpoint, schema, await api.post<unknown>(endpoint,
    { reason: input.reason, idempotency_key: key }, requestOptions(key)));
}
