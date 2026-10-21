// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Deep audit 21 Oct 2026, finding 4: a staff wellbeing push used to land on the
 * notification list (or nowhere). This screen says where the alert is and opens it there.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:staffAlert.title': 'Wellbeing alert',
        'volunteeringVolunteer:staffAlert.heading': 'This wellbeing alert is on the website',
        'volunteeringVolunteer:staffAlert.body': 'Wellbeing alerts are for your community staff.',
        'volunteeringVolunteer:staffAlert.open': 'Open on the website',
        'volunteeringVolunteer:staffAlert.openFailed': 'This phone could not open the website.',
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
      };
      return map[key] ?? key;
    },
  }),
}));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999', error: '#e53e3e', warning: '#f59e0b' }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }) }));
const mockOpen = jest.fn();
jest.mock('@/lib/utils/openExternalUrl', () => ({ openExternalUrl: (...args: unknown[]) => mockOpen(...args) }));

import WellbeingStaffAlertScreen from './volunteering-wellbeing-staff-alert';

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue('opened');
});

describe('wellbeing staff alert hand-off', () => {
  it('says the alert is on the website and opens the admin alert there, in this community', async () => {
    mockParams = { area: 'admin', alert: '3' };
    const { getByText, getByTestId } = render(<WellbeingStaffAlertScreen />);
    expect(getByText('This wellbeing alert is on the website')).toBeTruthy();
    fireEvent.press(getByTestId('wellbeing-staff-alert-open'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('https://app.project-nexus.ie/hour-timebank/admin/volunteering/wellbeing?alert=3'));
  });

  it('opens the broker page for a broker link', async () => {
    mockParams = { area: 'broker', alert: '12' };
    const { getByTestId } = render(<WellbeingStaffAlertScreen />);
    fireEvent.press(getByTestId('wellbeing-staff-alert-open'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('https://app.project-nexus.ie/hour-timebank/broker/safeguarding/volunteering?alert=12'));
  });

  it('never puts anything but a numeric id into the web address', async () => {
    mockParams = { area: 'elsewhere', alert: 'javascript:alert(1)' };
    const { getByTestId } = render(<WellbeingStaffAlertScreen />);
    fireEvent.press(getByTestId('wellbeing-staff-alert-open'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('https://app.project-nexus.ie/hour-timebank/admin/volunteering/wellbeing'));
  });

  it('says so when the phone cannot open the website', async () => {
    mockParams = { area: 'admin', alert: '3' };
    mockOpen.mockResolvedValue('unopenable');
    const { getByTestId } = render(<WellbeingStaffAlertScreen />);
    fireEvent.press(getByTestId('wellbeing-staff-alert-open'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This phone could not open the website.' })));
  });
});
