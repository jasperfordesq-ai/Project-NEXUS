// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetStatus = jest.fn();
const mockToast = jest.fn();
const mockBack = jest.fn();
const mockEnrolmentProps = jest.fn();

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: (...args: unknown[]) => mockBack(...args), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111827', textSecondary: '#4b5563', textMuted: '#6b7280', error: '#ef4444', success: '#16a34a' }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, email: 'alex@example.org' } }) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/lib/api/twoFactor', () => ({
  getTwoFactorStatus: (...args: unknown[]) => mockGetStatus(...args),
}));
jest.mock('@/components/security/TwoFactorEnrolment', () => {
  const { Pressable, Text } = require('react-native');
  return (props: { accountLabel?: string | null; onDone: () => void }) => {
    mockEnrolmentProps(props);
    return <Pressable testID="two-factor-enrolment" onPress={props.onDone}><Text>enrol</Text></Pressable>;
  };
});

import SettingsTwoFactorScreen from './settings-two-factor';

const status = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  enrollment_allowed: true,
  enforcement_required: false,
  setup_required: false,
  backup_codes_remaining: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('offers set-up when two-factor is off and allowed, labelled with the member’s email', async () => {
  mockGetStatus.mockResolvedValue(status());
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-enrolment');
  expect(mockEnrolmentProps).toHaveBeenCalledWith(expect.objectContaining({ accountLabel: 'alex@example.org' }));

  fireEvent.press(view.getByTestId('two-factor-enrolment'));
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'twoFactor.screen.success', variant: 'success' }));
  expect(mockBack).toHaveBeenCalled();
});

it('says it is on, and does not offer set-up again', async () => {
  mockGetStatus.mockResolvedValue(status({ enabled: true }));
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-settings-on');
  expect(view.getByText('twoFactor.screen.onBody')).toBeTruthy();
  expect(view.queryByTestId('two-factor-enrolment')).toBeNull();
});

it('says plainly when the community does not allow it', async () => {
  mockGetStatus.mockResolvedValue(status({ enrollment_allowed: false }));
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-settings-not-allowed');
  expect(view.queryByTestId('two-factor-enrolment')).toBeNull();
});

it('never guesses "off" when the status cannot be read', async () => {
  mockGetStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(status());
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-settings-error');
  expect(view.queryByTestId('two-factor-enrolment')).toBeNull();
  await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(1));
});
