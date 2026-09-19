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
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

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
