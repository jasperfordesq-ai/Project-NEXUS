// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api, type ApiResponse } from '@/lib/api';

export type RegistrationQuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'dietary'
  | 'accessibility'
  | 'consent'
  | 'waiver';

export type RegistrationClassification = 'public' | 'internal' | 'confidential' | 'sensitive';

export interface RegistrationQuestion {
  id?: number;
  stable_key: string;
  position?: number;
  question_type: RegistrationQuestionType;
  prompt: string;
  help_text?: string | null;
  is_required: boolean;
  data_classification: RegistrationClassification;
  purpose: string;
  retention_days: number;
  choice_options?: string[] | null;
  validation_rules?: Record<string, unknown> | null;
  visibility_rules?: Record<string, unknown> | null;
  displayed_text?: string | null;
  displayed_text_version?: string | null;
}

export interface RegistrationForm {
  id: number;
  version_number: number;
  revision: number;
  status: 'draft' | 'published';
  name: string;
  description?: string | null;
  questions: RegistrationQuestion[];
  published_at?: string | null;
}

export interface RegistrationSettings {
  id: number;
  revision: number;
  status: 'draft' | 'published';
  approval_mode: 'auto' | 'manual';
  form_state: 'none' | 'draft' | 'published';
  published_form_version?: number | null;
  per_member_limit: number;
  guests_enabled: boolean;
  max_guests_per_registration: number;
  guest_retention_days: number;
  opens_at_utc?: string | null;
  closes_at_utc?: string | null;
  cancellation_cutoff_at_utc?: string | null;
  event_timezone_snapshot?: string | null;
  published_at?: string | null;
}

export interface RegistrationSettingsInput {
  approval_mode: RegistrationSettings['approval_mode'];
  opens_at_utc: string | null;
  closes_at_utc: string | null;
  cancellation_cutoff_at_utc: string | null;
  per_member_limit: number;
  guests_enabled: boolean;
  max_guests_per_registration: number;
  guest_retention_days: number;
  expected_revision: number;
}

export interface RegistrationSubmission {
  id: number;
  registration_id: number;
  form_version_id: number;
  user_id?: number;
  member_name?: string;
  revision: number;
  status: 'draft' | 'submitted' | 'withdrawn' | 'anonymised';
  attempt_number: number;
  effective_slot: 1 | null;
  supersedes_submission_id?: number | null;
  superseded_at?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
}

export interface AttendeeRegistration {
  id: number;
  registration_state: 'invited' | 'pending' | 'confirmed' | 'declined' | 'cancelled';
  registration_version: number;
  party_size: number;
  state_changed_at?: string | null;
  invited_at?: string | null;
  pending_at?: string | null;
  confirmed_at?: string | null;
  declined_at?: string | null;
  cancelled_at?: string | null;
}

export interface RegistrationAnswerReview {
  answers: Record<string, {
    question_id: number;
    value: unknown;
    purged: boolean;
    classification: RegistrationClassification;
  }>;
}

export interface InvitationCampaign {
  id: number;
  campaign_type: 'member' | 'email' | 'group' | 'audience' | 'csv';
  status: 'previewed' | 'scheduled' | 'issuing' | 'issued' | 'cancelled';
  revision: number;
  preview_count: number;
  valid_count: number;
  error_count: number;
  preview_errors: Array<{ row: number; code: string }>;
  segment_criteria_summary?: Record<string, unknown> | null;
  default_locale: string;
  scheduled_for_utc?: string | null;
  issued_at?: string | null;
  cancelled_at?: string | null;
  delivery_counts?: Record<string, number>;
  invitations_count?: number;
}

export interface RegistrationGuest {
  id: number;
  registration_id: number;
  ticket_entitlement_id?: number | null;
  guest_number: number;
  revision: number;
  status: 'captured' | 'withdrawn' | 'anonymised';
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_locale?: string | null;
  notification_consent: boolean;
  retention_due_at?: string | null;
  attendance?: {
    id: number;
    status: 'not_checked_in' | 'checked_in' | 'checked_out' | 'attended' | 'no_show';
    version: number;
    /** Server-derived: the latest attendance change exists and is not itself an undo. */
    can_undo?: boolean;
  } | null;
}

export interface RegistrationRetentionRun {
  id: number;
  mode: 'dry_run' | 'apply';
  dry_run_id?: number | null;
  as_of_utc: string;
  eligible_count: number;
  affected_count: number;
  completed_at: string;
}

export interface RegistrationOverviewPage {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
  page_count: number;
  from: number | null;
  to: number | null;
  has_more: boolean;
  previous_page: number | null;
  next_page: number | null;
}

export interface RegistrationOverviewQuery {
  submissions_page?: number;
  submissions_per_page?: number;
  campaigns_page?: number;
  campaigns_per_page?: number;
  guests_page?: number;
  guests_per_page?: number;
}

export interface EventRegistrationOverview {
  settings: RegistrationSettings | null;
  forms: RegistrationForm[];
  submissions: RegistrationSubmission[];
  campaigns: InvitationCampaign[];
  guests: RegistrationGuest[];
  pagination?: {
    submissions: RegistrationOverviewPage;
    campaigns: RegistrationOverviewPage;
    guests: RegistrationOverviewPage;
  };
  summary?: {
    submissions_total: number;
    campaigns_total: number;
    guests_total: number;
  };
  permissions: {
    view_roster: boolean;
    view_sensitive_answers: boolean;
    export_answers: boolean;
    manage_retention: boolean;
    manage_attendance: boolean;
  };
}

export interface AttendeeRegistrationState {
  settings: RegistrationSettings | null;
  form: RegistrationForm | null;
  registrations: AttendeeRegistration[];
  submissions: RegistrationSubmission[];
  guests: RegistrationGuest[];
  invitations: Array<{
    id: number;
    campaign_id: number;
    status: 'issued' | 'accepted' | 'revoked' | 'expired';
    invitation_version: number;
    token_expires_at: string;
  }>;
}

export interface MutationResult<T> {
  changed: boolean;
  idempotent_replay: boolean;
  value: T;
}

function key(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mutation<T>(response: ApiResponse<Record<string, unknown>>, field: string): ApiResponse<MutationResult<T>> {
  if (!response.success || !response.data || !(field in response.data)) {
    return {
      success: false,
      message: response.message,
      error: response.error,
      code: response.code,
      errors: response.errors,
      meta: response.meta,
    };
  }
  return {
    ...response,
    data: {
      value: response.data[field] as T,
      changed: Boolean(response.data.changed),
      idempotent_replay: Boolean(response.data.idempotent_replay),
    },
  };
}

function questionPayload(question: RegistrationQuestion): Omit<RegistrationQuestion, 'id' | 'position'> {
  const { id: _id, position: _position, ...payload } = question;
  return payload;
}

export const eventRegistrationApi = {
  organizerOverview: (eventId: number, query: RegistrationOverviewQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([name, value]) => {
      if (value !== undefined) params.set(name, String(value));
    });
    const suffix = params.size > 0 ? `?${params.toString()}` : '';

    return api.get<EventRegistrationOverview>(`/v2/events/${eventId}/registration-product/manage${suffix}`);
  },

  attendeeState: (eventId: number) =>
    api.get<AttendeeRegistrationState>(`/v2/events/${eventId}/registration-product`),

  saveSettings: async (eventId: number, input: RegistrationSettingsInput) =>
    mutation<RegistrationSettings>(await api.put<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/settings`,
      { ...input, idempotency_key: key('registration-settings-save') },
    ), 'settings'),

  publishSettings: async (eventId: number, expectedRevision: number) =>
    mutation<RegistrationSettings>(await api.post<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/settings/publish`,
      {
        expected_revision: expectedRevision,
        idempotency_key: key('registration-settings-publish'),
      },
    ), 'settings'),

  createForm: async (
    eventId: number,
    input: { name: string; description?: string; questions: RegistrationQuestion[]; expected_settings_revision: number },
  ) => mutation<RegistrationForm>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/forms`,
    {
      ...input,
      questions: input.questions.map(questionPayload),
      idempotency_key: key('registration-form-create'),
    },
  ), 'form'),

  updateForm: async (
    eventId: number,
    formId: number,
    input: {
      name: string;
      description?: string;
      questions: RegistrationQuestion[];
      expected_form_revision: number;
      expected_settings_revision: number;
    },
  ) => mutation<RegistrationForm>(await api.put<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/forms/${formId}`,
    {
      ...input,
      questions: input.questions.map(questionPayload),
      idempotency_key: key('registration-form-update'),
    },
  ), 'form'),

  forkForm: async (
    eventId: number,
    formId: number,
    expectedSettingsRevision: number,
  ) => mutation<RegistrationForm>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/forms/${formId}/fork`,
    {
      expected_settings_revision: expectedSettingsRevision,
      idempotency_key: key('registration-form-fork'),
    },
  ), 'form'),

  publishForm: async (
    eventId: number,
    formId: number,
    expectedFormRevision: number,
    expectedSettingsRevision: number,
  ) => mutation<RegistrationForm>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/forms/${formId}/publish`,
    {
      expected_form_revision: expectedFormRevision,
      expected_settings_revision: expectedSettingsRevision,
      idempotency_key: key('registration-form-publish'),
    },
  ), 'form'),

  saveSubmission: async (
    eventId: number,
    input: {
      registration_id: number;
      form_version_id: number;
      expected_revision: number | null;
      answers: Record<string, unknown>;
    },
  ) => mutation<RegistrationSubmission>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/submissions`,
    { ...input, idempotency_key: key('registration-submission-save') },
  ), 'submission'),

  submit: async (eventId: number, submissionId: number, expectedRevision: number) =>
    mutation<RegistrationSubmission>(await api.post<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/submissions/${submissionId}/submit`,
      { expected_revision: expectedRevision, idempotency_key: key('registration-submission-submit') },
    ), 'submission'),

  amend: (eventId: number, submissionId: number, expectedRevision: number) =>
    api.post<{ submission: RegistrationSubmission; superseded_submission: RegistrationSubmission; changed: boolean }>(
      `/v2/events/${eventId}/registration-product/submissions/${submissionId}/amend`,
      { expected_revision: expectedRevision, idempotency_key: key('registration-submission-amend') },
    ),

  reviewAnswers: (eventId: number, submissionId: number, input: {
    purpose: string;
    correlation_id: string;
    include_sensitive: boolean;
  }) => api.post<RegistrationAnswerReview>(
    `/v2/events/${eventId}/registration-product/submissions/${submissionId}/answers`,
    input,
  ),

  exportAnswers: (
    eventId: number,
    purpose: string,
    correlationId: string,
    includeSensitive: boolean,
  ) => api.download(`/v2/events/${eventId}/registration-product/submissions/export`, {
    method: 'POST',
    body: {
      purpose,
      correlation_id: correlationId,
      include_sensitive: includeSensitive,
    },
    filename: `event-registration-${eventId}.csv`,
  }),

  previewCampaign: async (
    eventId: number,
    campaignType: InvitationCampaign['campaign_type'],
    source: Record<string, unknown>,
    defaultLocale: string,
  ) => mutation<InvitationCampaign>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/campaigns/preview`,
    {
      campaign_type: campaignType,
      source,
      default_locale: defaultLocale,
      idempotency_key: key('invitation-preview'),
    },
  ), 'campaign'),

  issueCampaign: (eventId: number, campaignId: number, revision: number, expiresAt: string) =>
    api.post<{ campaign: InvitationCampaign; changed: boolean }>(
      `/v2/events/${eventId}/registration-product/campaigns/${campaignId}/issue`,
      { expected_revision: revision, expires_at: expiresAt, idempotency_key: key('invitation-issue') },
    ),

  scheduleCampaign: async (
    eventId: number,
    campaignId: number,
    revision: number,
    scheduledFor: string,
  ) => mutation<InvitationCampaign>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/campaigns/${campaignId}/schedule`,
    { expected_revision: revision, scheduled_for: scheduledFor, idempotency_key: key('invitation-schedule') },
  ), 'campaign'),

  cancelCampaign: async (
    eventId: number,
    campaignId: number,
    revision: number,
    reason: string,
  ) => mutation<InvitationCampaign>(await api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/campaigns/${campaignId}/cancel`,
    { expected_revision: revision, reason, idempotency_key: key('invitation-cancel') },
  ), 'campaign'),

  acceptMemberInvitation: (eventId: number, invitationId: number) =>
    api.post<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/invitations/${invitationId}/accept`,
      { idempotency_key: key('invitation-accept') },
    ),

  captureGuest: (eventId: number, registrationId: number, input: {
    expected_registration_version: number;
    display_name: string;
    email?: string;
    phone?: string;
    preferred_locale?: string;
    consent_accepted: boolean;
    consent_text: string;
    consent_text_version: string;
    notification_consent: boolean;
    notification_consent_text?: string;
    notification_consent_version?: string;
    ticket_entitlement_id?: number;
  }) => api.post<{ guest: RegistrationGuest; party_size: number }>(
    `/v2/events/${eventId}/registration-product/registrations/${registrationId}/guests`,
    input,
  ),

  cancelGuest: (eventId: number, guestId: number, revision: number, reason: string) =>
    api.post<{ guest: RegistrationGuest; party_size: number; changed: boolean }>(
      `/v2/events/${eventId}/registration-product/guests/${guestId}/cancel`,
      { expected_revision: revision, reason },
    ),

  transitionGuestAttendance: (
    eventId: number,
    guestId: number,
    action: 'check_in' | 'check_out' | 'no_show' | 'undo',
    expectedVersion: number,
    reason?: string,
  ) => api.post<Record<string, unknown>>(
    `/v2/events/${eventId}/registration-product/guests/${guestId}/attendance/${action}`,
    { expected_version: expectedVersion, reason, idempotency_key: key(`guest-${action}`) },
  ),

  retentionDryRun: async (eventId: number, asOf: string) =>
    mutation<RegistrationRetentionRun>(await api.post<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/retention/dry-run`,
      { as_of: asOf, idempotency_key: key('registration-retention-preview') },
    ), 'run'),

  retentionApply: async (eventId: number, runId: number) =>
    mutation<RegistrationRetentionRun>(await api.post<Record<string, unknown>>(
      `/v2/events/${eventId}/registration-product/retention/${runId}/apply`,
      { idempotency_key: key('registration-retention-apply') },
    ), 'run'),
};
