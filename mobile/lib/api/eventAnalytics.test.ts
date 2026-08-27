// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as Sentry from '@sentry/react-native';
import { ApiResponseError , api } from '@/lib/api/client';

import { eventAnalyticsSchema, getEventAnalytics } from './eventAnalytics';

jest.mock('@/lib/api/client', () => {
  class MockApiResponseError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  return { api: { get: jest.fn() }, ApiResponseError: MockApiResponseError };
});
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

const rate = { numerator: 1, denominator: 2, basis_points: 5000, suppressed: false };
const delivery = { pending: 0, delivered: 2, suppressed: 0, failed: 0, dead_lettered: 0 };
const summary = {
  contract_version: 1 as const,
  event_id: 42,
  event_title: 'Community summit',
  generated_at: '2030-01-01T12:00:00+00:00',
  privacy_threshold: 5,
  registration: { capacity_limit: 20, confirmed: 10, pending: 1, invited: 0, declined: 0, cancelled: 1, remaining: 10, completion_transitions: 10, cancellation_transitions: 1 },
  invitation: { available: true, issued: 4, accepted: 2, revoked: 0, expired: 0, conversion: rate },
  waitlist: { current_waiting: 1, current_offered: 0, joined: 2, offered: 1, accepted: 1, expired: 0, cancelled: 0, conversion: rate },
  attendance: { checked_in: 1, checked_out: 1, attended: 4, no_show: 1, attendance_rate: rate },
  tickets: { available: true, redacted: true, confirmed_entitlements: null, confirmed_units: null, cancelled_units: null, confirmed_credit_value: null },
  credits: { completed_claims: 0, completed_amount: '0.00', pending_claims: 0, failed_claims: 0, reversed_claims: 0 },
  communications: { ...delivery, delivery_rate: rate, by_channel: { email: delivery } },
  optional_funnel: { event_views: { value: null, suppressed: true }, registration_starts: { value: 5, suppressed: false }, start_to_registration_conversion: { ...rate, basis_points: null, suppressed: true } },
  safeguarding: { available: true, guardian_consents: { value: null, suppressed: true } },
};

describe('event analytics API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses the complete privacy-safe contract', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: summary, meta: { base_url: '/api/v2' } });

    const result = await getEventAnalytics(42);

    expect(result.data.registration.confirmed).toBe(10);
    expect(eventAnalyticsSchema.parse(result.data).event_id).toBe(42);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/analytics');
  });

  it('fails closed and records shape-only drift evidence', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { ...summary, optional_funnel: { ...summary.optional_funnel, event_views: { value: 4, suppressed: true } } },
      meta: { base_url: '/api/v2' },
    });

    await expect(getEventAnalytics(42)).rejects.toBeInstanceOf(ApiResponseError);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Events analytics contract drift',
      expect.objectContaining({ tags: expect.objectContaining({ endpoint: '/api/v2/events/{id}/analytics' }) }),
    );
  });
});
