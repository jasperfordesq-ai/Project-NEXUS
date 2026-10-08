// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:alerts.title': 'Urgent shift requests',
        'volunteeringVolunteer:alerts.intro': 'Organisers send these when a shift suddenly needs someone.',
        'volunteeringVolunteer:alerts.empty': 'No urgent requests right now.',
        'volunteeringVolunteer:alerts.pendingCount': `${String(opts?.count ?? 0)} waiting for your answer`,
        'volunteeringVolunteer:alerts.priority.normal': 'Normal',
        'volunteeringVolunteer:alerts.priority.urgent': 'Urgent',
        'volunteeringVolunteer:alerts.priority.critical': 'Critical',
        'volunteeringVolunteer:alerts.from': `From ${String(opts?.name ?? '')}`,
        'volunteeringVolunteer:alerts.expires': `Expires ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:alerts.skills': 'Skills needed',
        'volunteeringVolunteer:alerts.accept': 'Accept',
        'volunteeringVolunteer:alerts.decline': 'Decline',
        'volunteeringVolunteer:alerts.acceptLabel': `Accept the request for ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:alerts.declineLabel': `Decline the request for ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:alerts.accepted': 'Accepted',
        'volunteeringVolunteer:alerts.declined': 'Declined',
        'volunteeringVolunteer:alerts.acceptedTitle': 'You have accepted',
        'volunteeringVolunteer:alerts.acceptedBody': 'The organiser has been told.',
        'volunteeringVolunteer:alerts.declinedTitle': 'Declined',
        'volunteeringVolunteer:alerts.declinedBody': 'Thanks for letting the organiser know.',
        'volunteeringVolunteer:alerts.respondError': 'Could not send your answer.',
        'volunteeringVolunteer:alerts.loadError': 'Could not load urgent requests.',
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'volunteeringVolunteer:common.timeRange': `${String(opts?.start ?? '')}–${String(opts?.end ?? '')}`,
        'volunteeringVolunteer:common.dateUnknown': 'Date unavailable',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2, slug: 'e2e', volunteering_config: mockVolunteeringConfig } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#f8f9fa', text: '#000', textSecondary: '#666', textMuted: '#999',
    border: '#ddd', borderSubtle: '#eee', error: '#e53e3e', success: '#16a34a', warning: '#f59e0b',
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getEmergencyAlerts: jest.fn(),
  respondToEmergencyAlert: jest.fn(),
}));

import MyAlertsScreen from './volunteering-my-alerts';
import { getEmergencyAlerts, respondToEmergencyAlert } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const alert = {
  id: 5,
  priority: 'urgent',
  message: 'Two people dropped out of Saturday.',
  my_response: 'pending',
  required_skills: ['Driving'],
  shift: { id: 44, start_time: '2026-11-07T09:00:00Z', end_time: '2026-11-07T12:00:00Z' },
  opportunity: { title: 'Food run', location: 'Cork' },
  organization: { name: 'Meals Together' },
  coordinator: { name: 'Sam Organiser' },
  expires_at: '2026-11-06T18:00:00Z',
  created_at: '2026-11-05 10:00:00',
};
const answered = { ...alert, id: 6, my_response: 'accepted', priority: 'normal', opportunity: { title: 'Litter pick', location: null } };

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  // The server puts the list at data.alerts (never paged past twenty).
  jest.mocked(getEmergencyAlerts).mockResolvedValue({ data: { alerts: [alert, answered] } });
  jest.mocked(respondToEmergencyAlert).mockResolvedValue({ data: { id: 5, response: 'accepted' } });
});

describe('MyAlertsScreen', () => {
  it('lists requests with priority, organiser and skills, offering buttons only while unanswered', async () => {
    const { getByText, getAllByText, getByTestId, queryByTestId } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByText('Food run')).toBeTruthy());
    expect(getByText('Urgent')).toBeTruthy();
    // Both fixtures name the same organiser, so there are two of these.
    expect(getAllByText('From Sam Organiser')).toHaveLength(2);
    expect(getAllByText('Driving')).toHaveLength(2);
    expect(getByText('1 waiting for your answer')).toBeTruthy();
    expect(getByTestId('alert-accept-5')).toBeTruthy();
    expect(queryByTestId('alert-accept-6')).toBeNull();
    expect(getByText('Accepted')).toBeTruthy();
  });

  it('🔴 accepts with the `response` field and reloads', async () => {
    const { getByTestId } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByTestId('alert-accept-5')).toBeTruthy());
    fireEvent.press(getByTestId('alert-accept-5'));
    await waitFor(() => expect(respondToEmergencyAlert).toHaveBeenCalledWith(5, 'accepted'));
    await waitFor(() => expect(getEmergencyAlerts).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'You have accepted', variant: 'success' }));
  });

  it('declines', async () => {
    const { getByTestId } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByTestId('alert-decline-5')).toBeTruthy());
    fireEvent.press(getByTestId('alert-decline-5'));
    await waitFor(() => expect(respondToEmergencyAlert).toHaveBeenCalledWith(5, 'declined'));
  });

  it('shows the server\'s reason when an answer is refused, and reloads because the alert may be gone', async () => {
    jest.mocked(respondToEmergencyAlert).mockRejectedValueOnce(new ApiResponseError(400, 'This request has expired'));
    const { getByTestId } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByTestId('alert-accept-5')).toBeTruthy());
    fireEvent.press(getByTestId('alert-accept-5'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This request has expired', variant: 'danger' })));
    expect(getEmergencyAlerts).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state', async () => {
    jest.mocked(getEmergencyAlerts).mockResolvedValue({ data: { alerts: [] } });
    const { getByText } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByText('No urgent requests right now.')).toBeTruthy());
  });

  it('offers a retry when the list cannot be loaded', async () => {
    jest.mocked(getEmergencyAlerts).mockRejectedValueOnce(new ApiResponseError(422, 'down'));
    const { getByTestId } = render(<MyAlertsScreen />);
    await waitFor(() => expect(getByTestId('alerts-error')).toBeTruthy());
  });

  it('refuses the screen when the community has alerts off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_alerts': false };
    const { getByText } = render(<MyAlertsScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getEmergencyAlerts).not.toHaveBeenCalled();
  });
});
