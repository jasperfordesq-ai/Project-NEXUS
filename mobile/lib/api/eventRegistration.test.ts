// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
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
