// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('@/lib/prepareAuditedCsv', () => ({ prepareAuditedCsv: jest.fn() }));

jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import { prepareAuditedCsv } from '@/lib/prepareAuditedCsv';
import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  EVENT_REGISTRATION_PRODUCT_CONTRACT_HEADER,
  EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION,
  acceptRegistrationInvitation,
  attendeeRegistrationProductSchema,
  getAttendeeRegistrationProduct,
  saveRegistrationSubmission,
  getOrganizerRegistrationSettings,
  saveOrganizerRegistrationSettings,
  publishOrganizerRegistrationSettings,
  getOrganizerRegistrationForms,
  getOrganizerRegistrationSubmissions,
  getOrganizerRegistrationGuests,
  getOrganizerInvitationCampaigns,
  getOrganizerRetentionHistory,
  mutateOrganizerRetention,
  mutateOrganizerInvitationCampaign,
  type InvitationCampaignIntent,
  transitionOrganizerRegistrationGuest,
  reviewOrganizerRegistrationAnswers,
  prepareOrganizerRegistrationExport,
  getOwnRegistrationAnswers,
  mutateOrganizerRegistrationForm,
  type RegistrationFormIntent,
} from './eventRegistration';

const state = {
  settings: {
    id: 1,
    revision: 2,
    status: 'published',
    guests_enabled: true,
    max_guests_per_registration: 2,
    guest_retention_days: 30,
  },
  form: {
    id: 10,
    version_number: 1,
    revision: 1,
    status: 'published',
    name: 'Registration',
    description: null,
    questions: [{
      id: 11,
      stable_key: 'access_needs',
      position: 1,
      question_type: 'accessibility',
      prompt: 'What support would help?',
      help_text: null,
      is_required: false,
      data_classification: 'sensitive',
      purpose: 'Prepare adjustments',
      retention_days: 30,
      choice_options: null,
      validation_rules: { max_length: 500 },
      visibility_rules: null,
      displayed_text: null,
      displayed_text_version: null,
    }],
  },
  registrations: [{
    id: 20,
    registration_state: 'confirmed',
    registration_version: 3,
    party_size: 1,
    state_changed_at: '2030-01-01T10:00:00Z',
    invited_at: null,
    pending_at: null,
    confirmed_at: '2030-01-01T10:00:00Z',
    declined_at: null,
    cancelled_at: null,
  }],
  submissions: [],
  guests: [],
  invitations: [{
    id: 40,
    campaign_id: 30,
    status: 'issued',
    invitation_version: 1,
    token_expires_at: '2030-02-01T10:00:00Z',
  }],
};

const options = {
  headers: {
    'X-Events-Contract': '2',
    [EVENT_REGISTRATION_PRODUCT_CONTRACT_HEADER]: String(EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION),
  },
};

beforeEach(() => jest.clearAllMocks());

describe('mobile event registration product contract', () => {
  it('strictly validates the attendee projection and excludes answer payloads', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: state });

    const response = await getAttendeeRegistrationProduct(42);

    expect(response.data.form?.questions[0]?.data_classification).toBe('sensitive');
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/registration-product', undefined, options);
    expect(attendeeRegistrationProductSchema.safeParse({ ...state, answers: { secret: true } }).success).toBe(false);
  });

  it('fails closed on secret-bearing contract drift without logging the secret', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { ...state, source_snapshot_ciphertext: 'private-ciphertext' } });

    await expect(getAttendeeRegistrationProduct(42)).rejects.toHaveProperty(
      'code',
      'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT',
    );
    const telemetry = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
    expect(telemetry).not.toContain('private-ciphertext');
    expect(telemetry).toContain('/api/v2/events/{id}/registration-product');
  });

  it('binds submission saves and invitation acceptance to idempotency headers', async () => {
    const submission = {
      id: 50,
      registration_id: 20,
      form_version_id: 10,
      supersedes_submission_id: null,
      lineage_root_submission_id: null,
      attempt_number: 1,
      effective_slot: 1,
      revision: 1,
      status: 'draft',
      submitted_at: null,
      withdrawn_at: null,
      anonymised_at: null,
      superseded_at: null,
      created_at: '2030-01-01T10:00:00Z',
      updated_at: '2030-01-01T10:00:00Z',
    };
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { submission, changed: true, idempotent_replay: false } })
      .mockResolvedValueOnce({ data: { changed: true } });

    await saveRegistrationSubmission(42, {
      registrationId: 20,
      formVersionId: 10,
      expectedRevision: null,
      answers: { access_needs: 'A quiet space' },
    }, 'save-key');
    await acceptRegistrationInvitation(42, 40, 'accept-key');

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/api/v2/events/42/registration-product/submissions',
      expect.objectContaining({ idempotency_key: 'save-key' }),
      { headers: { ...options.headers, 'Idempotency-Key': 'save-key' } },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/api/v2/events/42/registration-product/invitations/40/accept',
      { idempotency_key: 'accept-key' },
      { headers: { ...options.headers, 'Idempotency-Key': 'accept-key' } },
    );
  });
});

describe('organiser registration settings', () => {
  const input = {
    approval_mode: 'manual' as const, per_member_limit: 1, guests_enabled: false,
    max_guests_per_registration: 0, guest_retention_days: 30,
    opens_at_utc: null, closes_at_utc: null, cancellation_cutoff_at_utc: null,
    expected_revision: 0,
  };
  const settings = {
    ...input, id: 1, event_id: 42, revision: 1, status: 'draft', form_state: 'none',
    published_form_version: null, event_timezone_snapshot: 'Europe/Dublin',
  };
  const receipt = { data: { settings, changed: true, idempotent_replay: false } };

  it('reads drafts without retaining unrelated personal records', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { settings, submissions: [{ member_name: 'Private' }] } });
    const result = await getOrganizerRegistrationSettings(42);
    expect(result.data.settings?.status).toBe('draft');
    expect(result.data).not.toHaveProperty('submissions');
    expect(attendeeRegistrationProductSchema.safeParse({ ...state, settings }).success).toBe(false);
  });

  it('preserves null removal and caller-owned keys across retries', async () => {
    jest.mocked(api.put).mockResolvedValue(receipt);
    await saveOrganizerRegistrationSettings(42, input, 'settings-key');
    await saveOrganizerRegistrationSettings(42, input, 'settings-key');
    expect(jest.mocked(api.put).mock.calls[0]).toEqual(jest.mocked(api.put).mock.calls[1]);
    expect(api.put).toHaveBeenCalledWith('/api/v2/events/42/registration-product/settings',
      { ...input, idempotency_key: 'settings-key' },
      { headers: { ...options.headers, 'Idempotency-Key': 'settings-key' } });
  });

  it('publishes the supplied revision and key', async () => {
    jest.mocked(api.post).mockResolvedValue(receipt);
    await publishOrganizerRegistrationSettings(42, 3, 'publish-key');
    expect(api.post).toHaveBeenCalledWith('/api/v2/events/42/registration-product/settings/publish',
      { expected_revision: 3, idempotency_key: 'publish-key' },
      { headers: { ...options.headers, 'Idempotency-Key': 'publish-key' } });
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid event ID %s before transport', async id => {
    await expect(getOrganizerRegistrationSettings(id)).rejects.toThrow();
    await expect(saveOrganizerRegistrationSettings(id, input, 'key')).rejects.toThrow();
    await expect(publishOrganizerRegistrationSettings(id, 1, 'key')).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    { opens_at_utc: '2030-01-01T10:00:00Z' },
    { opens_at_utc: '2030-01-01T11:00:00Z', closes_at_utc: '2030-01-01T10:00:00Z' },
    { expected_revision: -1 }, { per_member_limit: 11 },
    { guests_enabled: true, max_guests_per_registration: 0 },
  ])('rejects invalid settings %j before transport', async patch => {
    await expect(saveOrganizerRegistrationSettings(42, { ...input, ...patch }, 'key')).rejects.toThrow();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('refuses malformed acknowledgements rather than reporting success', async () => {
    jest.mocked(api.put).mockResolvedValue({ data: { settings } });
    await expect(saveOrganizerRegistrationSettings(42, input, 'key')).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
  });
});

describe('organiser registration forms', () => {
  const question = { stable_key: 'support', question_type: 'accessibility' as const,
    prompt: 'What support would help?', is_required: false, data_classification: 'sensitive' as const,
    purpose: 'Prepare adjustments', retention_days: 30 };
  const definition = { name: 'Registration', description: null, questions: [question] };
  const form = { ...definition, id: 10, event_id: 42, version_number: 1, revision: 1, status: 'draft',
    questions: [{ ...question, id: 11, position: 1 }] };
  const receipt = { data: { form, settings_revision: 3, changed: true, idempotent_replay: false } };
  const cases: [RegistrationFormIntent, string, 'post' | 'put', object][] = [
    [{ action: 'create', definition, settingsRevision: 2 }, '', 'post', { ...definition, expected_settings_revision: 2 }],
    [{ action: 'update', definition, formId: 10, formRevision: 1, settingsRevision: 2 }, '/10', 'put',
      { ...definition, expected_settings_revision: 2, expected_form_revision: 1 }],
    [{ action: 'fork', formId: 10, settingsRevision: 2 }, '/10/fork', 'post', { expected_settings_revision: 2 }],
    [{ action: 'publish', formId: 10, formRevision: 1, settingsRevision: 2 }, '/10/publish', 'post',
      { expected_settings_revision: 2, expected_form_revision: 1 }],
  ];
  it.each(cases)('sends the exact intent and caller key for %j', async (intent, suffix, method, payload) => {
    jest.mocked(api[method]).mockResolvedValue(receipt);
    await mutateOrganizerRegistrationForm(42, intent, 'saved-form-key');
    await mutateOrganizerRegistrationForm(42, intent, 'saved-form-key');
    expect(jest.mocked(api[method]).mock.calls[0]).toEqual(jest.mocked(api[method]).mock.calls[1]);
    expect(api[method]).toHaveBeenCalledWith(`/api/v2/events/42/registration-product/forms${suffix}`,
      { ...payload, idempotency_key: 'saved-form-key' },
      { headers: { ...options.headers, 'Idempotency-Key': 'saved-form-key' } });
  });
  it('reads organiser drafts without widening attendee contracts or retaining submissions', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { settings: null, forms: [form], submissions: ['private'] } });
    expect((await getOrganizerRegistrationForms(42)).data).toEqual({ settings: null, forms: [form] });
    expect(attendeeRegistrationProductSchema.safeParse({ ...state, form }).success).toBe(false);
  });
  it('rejects duplicate question keys and unsafe revisions before transport', async () => {
    await expect(mutateOrganizerRegistrationForm(42, { action: 'create', settingsRevision: 2,
      definition: { ...definition, questions: [question, question] } }, 'key')).rejects.toThrow();
    await expect(mutateOrganizerRegistrationForm(42, { action: 'publish', formId: 10,
      formRevision: Number.MAX_SAFE_INTEGER + 1, settingsRevision: 2 }, 'key')).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('refuses incomplete publication acknowledgements', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { form } });
    await expect(mutateOrganizerRegistrationForm(42, cases[3][0], 'key')).rejects.toMatchObject({
      code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT',
    });
  });
});


describe('organiser submission review', () => {
  const submission = { id: 7, registration_id: 4, form_version_id: 10, user_id: 9, member_name: 'Synthetic member',
    revision: 2, status: 'submitted', attempt_number: 1, effective_slot: 1, supersedes_submission_id: null,
    lineage_root_submission_id: 7, superseded_at: null, submitted_at: '2030-01-01', withdrawn_at: null, updated_at: '2030-01-01' };
  const pagination = { page: 2, per_page: 25, total: 26, last_page: 2, page_count: 1,
    from: 26, to: 26, has_more: false, previous_page: 1, next_page: null };
  const overview = { data: { forms: [], submissions: [submission], pagination: { submissions: pagination },
    permissions: { view_roster: true, view_sensitive_answers: false, export_answers: true },
    guests: [{ email: 'private@example.invalid' }], campaigns: ['private'], settings: {} } };
  const evidence = { purpose: 'Prepare venue adjustments', correlation_id: 'review-request-1', include_sensitive: false };
  const answer = { question_id: 11, value: 'Synthetic answer', purged: false, classification: 'internal' };
  it('uses independent page controls and retains only the submission projection', async () => {
    jest.mocked(api.get).mockResolvedValue(overview);
    const result = await getOrganizerRegistrationSubmissions(42, 2, 25);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/registration-product/manage',
      { submissions_page: '2', submissions_per_page: '25', campaigns_per_page: '1', guests_per_page: '1' }, options);
    expect(result.data).toEqual({ forms: [], submissions: [submission], pagination: { submissions: pagination }, permissions: overview.data.permissions });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('removes roster identity when the returned permission refuses it', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { ...overview.data, permissions: { ...overview.data.permissions, view_roster: false } } });
    expect((await getOrganizerRegistrationSubmissions(42)).data.submissions[0]).not.toHaveProperty('member_name');
  });
  it.each([[0, 1, 25], [42, 0, 25], [42, 1, 101], [42, 1.5, 25]])('rejects invalid page arguments %j', async (event, page, perPage) => {
    await expect(getOrganizerRegistrationSubmissions(event, page, perPage)).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('refuses an overview without explicit permissions or pagination', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { forms: [], submissions: [] } });
    await expect(getOrganizerRegistrationSubmissions(42)).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
  });
  it('sends the exact audit purpose and explicit sensitive choice', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { answers: { activity: answer } } });
    expect((await reviewOrganizerRegistrationAnswers(42, 7, evidence)).data.answers.activity).toEqual(answer);
    expect(api.post).toHaveBeenCalledWith('/api/v2/events/42/registration-product/submissions/7/answers', evidence, options);
  });
  it.each([{ purpose: ' ' }, { purpose: 'a'.repeat(501) }, { correlation_id: '' }, { correlation_id: 'é'.repeat(257) }])('requires bounded audit evidence %j', async patch => {
    await expect(reviewOrganizerRegistrationAnswers(42, 7, { ...evidence, ...patch })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('counts purpose characters like the backend rather than UTF-16 code units', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { answers: [] } });
    await expect(reviewOrganizerRegistrationAnswers(42, 7, { ...evidence, purpose: '📝'.repeat(500) })).resolves.toEqual({ data: { answers: {} } });
    await expect(reviewOrganizerRegistrationAnswers(42, 7, { ...evidence, purpose: '📝'.repeat(501) })).rejects.toThrow();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('retains purged status without returning a stale answer value', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { answers: { activity: { ...answer, purged: true } } } });
    expect((await reviewOrganizerRegistrationAnswers(42, 7, evidence)).data.answers.activity).toEqual({ ...answer, value: null, purged: true });
  });
  it('accepts PHP empty answer maps for both organiser and own-draft reads', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { answers: [] } });
    expect((await reviewOrganizerRegistrationAnswers(42, 7, evidence)).data.answers).toEqual({});
    expect(await getOwnRegistrationAnswers(42, 7, 'own-read')).toEqual({});
  });
  it('refuses nonempty arrays and unexpected sensitive answers', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { answers: [answer] } });
    await expect(reviewOrganizerRegistrationAnswers(42, 7, evidence)).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
    jest.mocked(api.post).mockResolvedValue({ data: { answers: { support: { ...answer, classification: 'sensitive' } } } });
    await expect(reviewOrganizerRegistrationAnswers(42, 7, evidence)).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
    expect(JSON.stringify(jest.mocked(Sentry.captureMessage).mock.calls)).not.toContain(answer.value);
    expect((await reviewOrganizerRegistrationAnswers(42, 7, { ...evidence, include_sensitive: true })).data.answers.support.classification).toBe('sensitive');
  });
  it('propagates permission refusal without retrying or supplying an empty success', async () => {
    const refused = new Error('refused'); jest.mocked(api.post).mockRejectedValue(refused);
    await expect(reviewOrganizerRegistrationAnswers(42, 7, evidence)).rejects.toBe(refused);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('explicit organizer export', () => {
  const evidence = { purpose: ' Synthetic review ', correlation_id: ' case-1 ', include_sensitive: false };
  it('uses the audited streaming POST adapter with the registration contract and current action guard', async () => {
    const active = () => true; const file = { uri: 'file:///private/export.csv' };
    jest.mocked(prepareAuditedCsv).mockResolvedValue(file as never);
    expect(await prepareOrganizerRegistrationExport(42, evidence, active)).toBe(file);
    expect(prepareAuditedCsv).toHaveBeenCalledWith('/api/v2/events/42/registration-product/submissions/export', 'event-registration-42.csv',
      { purpose: 'Synthetic review', correlation_id: 'case-1', include_sensitive: false }, expect.objectContaining({ 'X-Events-Contract': '2',
        [EVENT_REGISTRATION_PRODUCT_CONTRACT_HEADER]: String(EVENT_REGISTRATION_PRODUCT_CONTRACT_VERSION) }), active);
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([{ purpose: '' }, { purpose: '📝'.repeat(501) }, { correlation_id: 'é'.repeat(257) }])('refuses invalid evidence before downloading %j', async patch => {
    await expect(prepareOrganizerRegistrationExport(42, { ...evidence, ...patch }, () => true)).rejects.toThrow();
    expect(prepareAuditedCsv).not.toHaveBeenCalled();
  });
  it('accepts the full Unicode purpose and UTF-8 reference boundaries', async () => {
    await prepareOrganizerRegistrationExport(42, { purpose: '📝'.repeat(500), correlation_id: 'é'.repeat(256), include_sensitive: true }, () => true);
    expect(prepareAuditedCsv).toHaveBeenCalledTimes(1);
  });
  it('refuses invalid event IDs and departed actions without transport', async () => {
    await expect(prepareOrganizerRegistrationExport(0, evidence, () => true)).rejects.toThrow();
    await expect(prepareOrganizerRegistrationExport(42, evidence, () => false)).rejects.toThrow('download_cancelled');
    expect(prepareAuditedCsv).not.toHaveBeenCalled();
  });
});


describe('organizer guest overview', () => {
  const guest = { id: 9, registration_id: 7, guest_number: 1, revision: 2, status: 'captured',
    display_name: 'Synthetic guest', email: 'guest@example.invalid', phone: '+15555550100', notification_consent: false,
    retention_due_at: null, withdrawn_at: null, anonymised_at: null, attendance: null };
  const pagination = { page: 1, per_page: 25, total: 1, last_page: 1, page_count: 1, from: 1, to: 1,
    has_more: false, previous_page: null, next_page: null };
  const overview = { data: { guests: [guest], pagination: { guests: pagination },
    permissions: { view_roster: true, view_sensitive_answers: false, manage_attendance: true },
    submissions: ['unrelated'], campaigns: ['unrelated'] } };
  it('requests independent pagination and retains only guest workspace data', async () => {
    jest.mocked(api.get).mockResolvedValue(overview);
    const result = await getOrganizerRegistrationGuests(42, 2, 25);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/registration-product/manage',
      { guests_page: '2', guests_per_page: '25', submissions_per_page: '1', campaigns_per_page: '1' }, options);
    expect(result.data.pagination.guests).toEqual(pagination); // server can clamp a now-empty page
    expect(result.data).not.toHaveProperty('submissions'); expect(result.data).not.toHaveProperty('campaigns');
    expect(result.data.guests[0]).toMatchObject({ display_name: guest.display_name, attendance: null });
    expect(result.data.guests[0]).not.toHaveProperty('email'); expect(result.data.guests[0]).not.toHaveProperty('phone');
  });
  it('honours separate roster and sensitive-contact permissions', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { ...overview.data,
      permissions: { view_roster: false, view_sensitive_answers: true, manage_attendance: false } } });
    const result = await getOrganizerRegistrationGuests(42);
    expect(result.data.guests[0]).not.toHaveProperty('display_name');
    expect(result.data.guests[0]).toMatchObject({ email: guest.email, phone: guest.phone });
  });
  it('parses attendance versions without retaining unknown guest fields', async () => {
    const attendance = { id: 3, status: 'checked_in', version: 4, checked_in_at: '2026-09-20', checked_out_at: null, no_show_at: null };
    jest.mocked(api.get).mockResolvedValue({ data: { ...overview.data, guests: [{ ...guest, attendance, secret: 'discard' }] } });
    const result = await getOrganizerRegistrationGuests(42);
    expect(result.data.guests[0].attendance).toEqual(attendance); expect(result.data.guests[0]).not.toHaveProperty('secret');
  });
  it('rejects unknown attendance states rather than treating them as absent', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { ...overview.data, guests: [{ ...guest, attendance: { id: 3, status: 'future', version: 1 } }] } });
    await expect(getOrganizerRegistrationGuests(42)).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
  });
  it.each([[0, 1, 25], [42, 0, 25], [42, 1, 101]])('rejects invalid IDs/pages before a request', async (event, page, size) => {
    await expect(getOrganizerRegistrationGuests(event, page, size)).rejects.toThrow(); expect(api.get).not.toHaveBeenCalled();
  });
  it('propagates refusal without manufacturing an empty list', async () => {
    const error = new Error('refused'); jest.mocked(api.get).mockRejectedValue(error);
    await expect(getOrganizerRegistrationGuests(42)).rejects.toBe(error); expect(api.get).toHaveBeenCalledTimes(1);
  });
});


describe('organizer guest attendance writes', () => {
  const intent = { guestId: 9, action: 'check_in' as const, expectedVersion: 0 };
  const response = { data: { attendance: { id: 3, event_id: 42, guest_id: 9, attendance_status: 'checked_in', attendance_version: 1 },
    changed: true, replayed: false, history_id: 7 } };
  it('uses the caller-owned key and zero initial version exactly once', async () => {
    jest.mocked(api.post).mockResolvedValue(response);
    expect(await transitionOrganizerRegistrationGuest(42, intent, 'guest-action-1')).toEqual(response);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/v2/events/42/registration-product/guests/9/attendance/check_in',
      { expected_version: 0, reason: null, idempotency_key: 'guest-action-1' },
      { headers: { ...options.headers, 'Idempotency-Key': 'guest-action-1' } });
  });
  it('requires an undo reason before transport and preserves Unicode limits', async () => {
    await expect(transitionOrganizerRegistrationGuest(42, { ...intent, action: 'undo', reason: ' ' }, 'undo-1')).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
    jest.mocked(api.post).mockResolvedValue(response);
    await transitionOrganizerRegistrationGuest(42, { ...intent, action: 'undo', reason: '📝'.repeat(500) }, 'undo-1');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('rejects a response belonging to another guest', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { ...response.data, attendance: { ...response.data.attendance, guest_id: 10 } } });
    await expect(transitionOrganizerRegistrationGuest(42, intent, 'guest-action-1')).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
  });
  it('does not retry an ambiguous write', async () => {
    const error = new Error('connection lost'); jest.mocked(api.post).mockRejectedValue(error);
    await expect(transitionOrganizerRegistrationGuest(42, intent, 'guest-action-1')).rejects.toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});


describe('organizer invitation campaigns', () => {
  const campaign = { id: 12, event_id: 42, campaign_type: 'member', status: 'previewed', revision: 1,
    preview_count: 2, valid_count: 1, error_count: 1, preview_errors: [{ row: 2, code: 'member_not_found' }], default_locale: 'en' };
  const pagination = { page: 1, per_page: 25, total: 1, last_page: 1, page_count: 1, from: 1, to: 1,
    has_more: false, previous_page: null, next_page: null };
  it('reads independently paginated campaigns and strips unrelated and private data', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { campaigns: [{ ...campaign, source_snapshot_ciphertext: 'private', delivery_counts: [] }],
      guests: ['private'], pagination: { campaigns: pagination } } });
    const result = await getOrganizerInvitationCampaigns(42);
    expect(result.data.campaigns[0]).not.toHaveProperty('source_snapshot_ciphertext');
    expect(result.data).not.toHaveProperty('guests');
    expect(result.data.campaigns[0].delivery_counts).toEqual({});
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/events/42/registration-product/manage',
      { campaigns_page: '1', campaigns_per_page: '25', submissions_per_page: '1', guests_per_page: '1' }, expect.anything());
  });
  const cases: [InvitationCampaignIntent, string, Record<string, unknown>][] = [
    [{ action: 'preview', campaignType: 'member', source: { member_ids: [7, 8] }, defaultLocale: 'en' }, 'preview',
      { campaign_type: 'member', source: { member_ids: [7, 8] }, default_locale: 'en' }],
    [{ action: 'issue', campaignId: 12, expectedRevision: 1, expiresAt: '2026-10-01T12:00:00Z' }, '12/issue',
      { expected_revision: 1, expires_at: '2026-10-01T12:00:00Z' }],
    [{ action: 'schedule', campaignId: 12, expectedRevision: 1, scheduledFor: '2026-10-01T12:00:00Z' }, '12/schedule',
      { expected_revision: 1, scheduled_for: '2026-10-01T12:00:00Z' }],
    [{ action: 'cancel', campaignId: 12, expectedRevision: 1, reason: 'Cancelled event' }, '12/cancel',
      { expected_revision: 1, reason: 'Cancelled event' }],
  ];
  it.each(cases)('preserves caller-owned identity for %j', async (intent, path, body) => {
    jest.mocked(api.post).mockResolvedValue({ data: { campaign, changed: true, idempotent_replay: false, invitations: ['private'] } });
    const result = await mutateOrganizerInvitationCampaign(42, intent, 'saved-campaign-key');
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/events/42/registration-product/campaigns/' + path,
      { ...body, idempotency_key: 'saved-campaign-key' }, { headers: expect.objectContaining({ 'Idempotency-Key': 'saved-campaign-key' }) });
    expect(result.data).not.toHaveProperty('invitations');
  });
  it('rejects mismatched receipts and never automatically retries uncertain failures', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { campaign: { ...campaign, event_id: 99 }, changed: true, idempotent_replay: false } });
    await expect(mutateOrganizerInvitationCampaign(42, cases[1][0], 'saved-key')).rejects.toMatchObject({ code: 'EVENT_REGISTRATION_PRODUCT_CONTRACT_DRIFT' });
    jest.mocked(api.post).mockClear(); const failure = new Error('network uncertain'); jest.mocked(api.post).mockRejectedValue(failure);
    await expect(mutateOrganizerInvitationCampaign(42, cases[1][0], 'saved-key')).rejects.toBe(failure);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('organiser retention contracts', () => {
  const instant = '2027-01-01T12:00:00Z';
  const run = { id: 8, event_id: 42, mode: 'dry_run', dry_run_id: null, as_of_utc: instant,
    eligible_count: 3, affected_count: 0, completed_at: instant, created_at: instant };
  const pagination = { page: 1, per_page: 25, total: 1, last_page: 1, page_count: 1, from: 1, to: 1,
    has_more: false, previous_page: null, next_page: null };
  it('reads only the current event history projection with contract headers', async () => {
    jest.mocked(api.get).mockResolvedValue({ data: { event_id: 42, runs: [{ ...run, candidate_hash: 'private' }],
      permissions: { manage_retention: true }, pagination, unrelated: 'discard' } });
    const result = await getOrganizerRetentionHistory(42);
    expect(result.data.runs[0]).toEqual(run); expect(result.data).not.toHaveProperty('unrelated');
    expect(api.get).toHaveBeenLastCalledWith('/api/v2/events/42/registration-product/retention',
      { page: '1', per_page: '25' }, expect.objectContaining({ headers: expect.objectContaining({ 'X-Event-Registration-Product-Contract': '1' }) }));
  });
  it('preserves preview intent and caller retry key and accepts equivalent UTC instants', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { run, changed: true, idempotent_replay: false } });
    await mutateOrganizerRetention(42, { action: 'preview', asOf: '2027-01-01T13:00:00+01:00' }, 'saved-key');
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/events/42/registration-product/retention/dry-run',
      { as_of: '2027-01-01T13:00:00+01:00', idempotency_key: 'saved-key' }, expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'saved-key' }) }));
  });
  it('binds apply receipts to the chosen preview', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { run: { ...run, id: 9, mode: 'apply', dry_run_id: 8, affected_count: 2 }, changed: false, idempotent_replay: true } });
    const result = await mutateOrganizerRetention(42, { action: 'apply', dryRunId: 8 }, 'apply-key');
    expect(result.data.run.affected_count).toBe(2);
    expect(api.post).toHaveBeenLastCalledWith('/api/v2/events/42/registration-product/retention/8/apply', { idempotency_key: 'apply-key' }, expect.anything());
    await expect(mutateOrganizerRetention(42, { action: 'apply', dryRunId: 7 }, 'apply-key')).rejects.toThrow();
  });
  it.each([{ event_id: 99 }, { affected_count: 1 }, { as_of_utc: '2027-01-02T12:00:00Z' }, { dry_run_id: 7 }])('refuses unrelated or inconsistent preview receipt %j', async invalid => {
    jest.mocked(api.post).mockResolvedValue({ data: { run: { ...run, ...invalid }, changed: true, idempotent_replay: false } });
    await expect(mutateOrganizerRetention(42, { action: 'preview', asOf: instant }, 'key')).rejects.toThrow();
  });
  it('rejects invalid inputs before transport', async () => {
    jest.mocked(api.post).mockClear(); jest.mocked(api.get).mockClear();
    await expect(mutateOrganizerRetention(42, { action: 'preview', asOf: '2027-01-01' }, 'key')).rejects.toThrow();
    await expect(mutateOrganizerRetention(42, { action: 'apply', dryRunId: 0 }, 'key')).rejects.toThrow();
    await expect(getOrganizerRetentionHistory(42, 1, 101)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  });
});
