// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisation dashboard › Wellbeing on the phone (deep audit 21 Oct 2026, finding 4).
 * The push for an organisation's owner, admins and safeguarding leads links to
 * `/volunteering/org/{id}/dashboard?tab=wellbeing`; the app had no such tab.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'org.wellbeing.intro': 'Volunteers who asked for someone to get in touch.',
        'org.wellbeing.forbidden': "You don't have access to this organisation's wellbeing alerts.",
        'org.wellbeing.switchedOff': 'This community has switched wellbeing check-ins off.',
        'org.wellbeing.rateLimited': 'Please wait a moment and try again.',
        'org.wellbeing.loadError': 'Wellbeing alerts could not be loaded.',
        'org.wellbeing.empty': 'Nobody has asked for help',
        'org.wellbeing.emptyDesc': 'None of your volunteers has shared a low check-in.',
        'org.wellbeing.summary': `${String(opts?.count ?? 0)} waiting`,
        'org.wellbeing.moodStruggling': "Said they're struggling",
        'org.wellbeing.moodLow': "Said they're feeling low",
        'org.wellbeing.status.active': 'Nobody has responded yet',
        'org.wellbeing.status.acknowledged': "The community's team is on it",
        'org.wellbeing.status.resolved': 'Resolved',
        'org.wellbeing.status.dismissed': 'Closed',
        'org.wellbeing.checkedIn': `Checked in ${String(opts?.date ?? '')}`,
        'org.wellbeing.toldOn': `You were told ${String(opts?.date ?? '')}`,
        'org.wellbeing.notTold': 'You were told: not yet',
        'org.wellbeing.whatToDo': 'Please check in with them soon.',
        'org.wellbeing.closedHelp': 'The community team has closed this.',
        'org.wellbeing.message': `Message ${String(opts?.name ?? '')}`,
        'org.wellbeing.viewProfile': 'View profile',
        'org.wellbeing.confidentiality': 'Treat this as confidential.',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#6366f1', useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999', error: '#e53e3e', warning: '#f59e0b', success: '#16a34a' }),
}));
jest.mock('@/lib/api/volunteering', () => ({ getOrganisationWellbeing: jest.fn() }));

import { getOrganisationWellbeing } from '@/lib/api/volunteering';
import { formatWellbeingDateTime } from '@/lib/utils/wellbeingTime';
import OrgWellbeingPanel from './OrgWellbeingPanel';

const items = [
  { alert_id: 1, volunteer: { id: 9, name: 'Alex Volunteer', avatar_url: null }, mood: 1, checkin_at: '2026-10-20 09:30:00', status: 'active', told_at: '2026-10-20T09:31:00+00:00' },
  { alert_id: 2, volunteer: { id: 10, name: 'Sam Helper', avatar_url: null }, mood: 2, checkin_at: '2026-10-01T10:00:00+00:00', status: 'resolved', told_at: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getOrganisationWellbeing).mockResolvedValue({ data: { organisation: { id: 5, name: 'Green Spaces' }, items } });
});

describe('OrgWellbeingPanel', () => {
  it('lists the volunteers who asked for someone to get in touch, with their mood, status and times', async () => {
    const { getByText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByText('Alex Volunteer')).toBeTruthy());
    expect(getOrganisationWellbeing).toHaveBeenCalledWith(5);
    expect(getByText("Said they're struggling")).toBeTruthy();
    expect(getByText('Nobody has responded yet')).toBeTruthy();
    expect(getByText('1 waiting')).toBeTruthy();
    // The legacy UTC stamp and the ISO stamp are both read as UTC instants.
    expect(getByText(`Checked in ${formatWellbeingDateTime('2026-10-20T09:30:00Z')}`)).toBeTruthy();
    expect(getByText(`You were told ${formatWellbeingDateTime('2026-10-20T09:31:00Z')}`)).toBeTruthy();
    expect(getByText('Resolved')).toBeTruthy();
    expect(getByText('Treat this as confidential.')).toBeTruthy();
  });

  it('opens a message to the volunteer and their profile', async () => {
    const { getByLabelText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByLabelText('Message Alex Volunteer')).toBeTruthy());
    fireEvent.press(getByLabelText('Message Alex Volunteer'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(modals)/thread', params: expect.objectContaining({ recipientId: '9' }) }));
  });

  it('says so when the member cannot see this organisation\'s alerts', async () => {
    jest.mocked(getOrganisationWellbeing).mockRejectedValue(new ApiResponseError(403, 'Not an organisation contact', undefined, 'NOT_ORGANISATION_CONTACT'));
    const { getByTestId, queryByText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByTestId('org-wellbeing-forbidden')).toBeTruthy());
    expect(queryByText('Nobody has asked for help')).toBeNull();
  });

  it('says the community switched wellbeing off, not "try again"', async () => {
    jest.mocked(getOrganisationWellbeing).mockRejectedValue(new ApiResponseError(403, 'Switched off', undefined, 'FEATURE_DISABLED'));
    const { getByTestId, queryByText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByTestId('org-wellbeing-switched-off')).toBeTruthy());
    expect(queryByText('Retry')).toBeNull();
  });

  it('shows an empty state only when the list really is empty', async () => {
    jest.mocked(getOrganisationWellbeing).mockResolvedValue({ data: { organisation: { id: 5, name: 'Green Spaces' }, items: [] } });
    const { getByText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByText('Nobody has asked for help')).toBeTruthy());
  });

  it('offers a retry when the list could not be loaded', async () => {
    jest.mocked(getOrganisationWellbeing).mockRejectedValue(new ApiResponseError(422, 'Broken'));
    const { getByTestId, getByText } = render(<OrgWellbeingPanel orgId={5} />);
    await waitFor(() => expect(getByTestId('org-wellbeing-error')).toBeTruthy());
    expect(getByText('Retry')).toBeTruthy();
  });
});
