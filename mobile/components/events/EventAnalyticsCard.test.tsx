// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EventAnalyticsCard } from './EventAnalyticsCard';
import { DARK } from '@/lib/hooks/useTheme';
import type { EventAnalyticsSummary } from '@/lib/api/eventAnalytics';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

const rate = { numerator: 1, denominator: 2, basis_points: 5000, suppressed: false };
const deliveries = { pending: 0, delivered: 8, suppressed: 0, failed: 0, dead_lettered: 0 };
const summary: EventAnalyticsSummary = {
  contract_version: 1,
  event_id: 42,
  event_title: 'Community summit',
  generated_at: '2030-01-01T12:00:00+00:00',
  privacy_threshold: 5,
  registration: { capacity_limit: 20, confirmed: 10, pending: 1, invited: 0, declined: 0, cancelled: 1, remaining: 10, completion_transitions: 10, cancellation_transitions: 1 },
  invitation: { available: true, issued: 4, accepted: 2, revoked: 0, expired: 0, conversion: rate },
  waitlist: { current_waiting: 1, current_offered: 0, joined: 2, offered: 1, accepted: 1, expired: 0, cancelled: 0, conversion: rate },
  attendance: { checked_in: 1, checked_out: 1, attended: 4, no_show: 1, attendance_rate: rate },
  tickets: { available: true, redacted: false, confirmed_entitlements: 9, confirmed_units: 12, cancelled_units: 1, confirmed_credit_value: '24.00' },
  credits: { completed_claims: 3, completed_amount: '9.00', pending_claims: 1, failed_claims: 1, reversed_claims: 0 },
  communications: { ...deliveries, delivery_rate: rate, by_channel: { email: deliveries } },
  optional_funnel: {
    event_views: { value: null, suppressed: true },
    registration_starts: { value: 5, suppressed: false },
    start_to_registration_conversion: { ...rate, basis_points: null, suppressed: true },
  },
  safeguarding: { available: true, guardian_consents: { value: null, suppressed: true } },
};

const translations: Record<string, string> = {
  'analytics.title': 'Event analytics',
  'analytics.consent_bound': 'Consent-bound',
  'analytics.privacy_note': 'Optional metrics are privacy protected.',
  'analytics.suppressed': 'Suppressed',
  'analytics.not_limited': 'No limit',
  'analytics.metrics.confirmed': 'Confirmed registrations',
  'analytics.metrics.capacity_remaining': 'Capacity remaining',
  'analytics.metrics.waitlist_conversion': 'Waitlist conversion',
  'analytics.metrics.attendance_rate': 'Attendance rate',
  'analytics.metrics.no_show': 'No-shows',
  'analytics.metrics.delivered': 'Notifications delivered',
  'analytics.metrics.event_views': 'Event views',
  'analytics.metrics.start_conversion': 'View-to-registration conversion',
  'analytics.loading': 'Loading event analytics',
  'analytics.load_error': 'Event analytics could not be loaded.',
  'analytics.retry': 'Try again',
};
const t = (key: string) => translations[key] ?? key;

describe('EventAnalyticsCard', () => {
  it('renders only privacy-safe operational metrics and suppresses small funnels', () => {
    const { getByText, getAllByText, queryByText } = render(
      <EventAnalyticsCard
        summary={summary}
        isLoading={false}
        error={null}
        onRefresh={jest.fn()}
        primary="#6366f1"
        theme={DARK}
        t={t}
      />,
    );

    expect(getByText('Event analytics')).toBeTruthy();
    expect(getByText('Confirmed registrations')).toBeTruthy();
    expect(getAllByText('Suppressed').length).toBeGreaterThanOrEqual(1);
    expect(queryByText('24.00')).toBeNull();
    expect(queryByText('9.00')).toBeNull();
    expect(queryByText(/guardian/i)).toBeNull();
  });

  it('exposes an explicit retry action when the private summary fails to load', () => {
    const onRefresh = jest.fn();
    const { getByText } = render(
      <EventAnalyticsCard
        summary={null}
        isLoading={false}
        error="request_failed"
        onRefresh={onRefresh}
        primary="#6366f1"
        theme={DARK}
        t={t}
      />,
    );

    fireEvent.press(getByText('Try again'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
