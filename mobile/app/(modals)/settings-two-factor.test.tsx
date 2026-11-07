// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), confirmDialog: null, dismiss: jest.fn() }),
}));
jest.mock('@/lib/api/twoFactor', () => ({
  getTwoFactorStatus: (...args: unknown[]) => mockGetStatus(...args),
}));
jest.mock('@/components/security/TwoFactorEnrolment', () => {
  const { Pressable, Text, View } = require('react-native');
  return (props: { accountLabel?: string | null; onDone: () => void; onStageChange?: (stage: string) => void; onFieldFocus?: () => void }) => {
    mockEnrolmentProps(props);
    return (
      <View>
        <Pressable testID="two-factor-enrolment" onPress={props.onDone}><Text>enrol</Text></Pressable>
        {/* Stands in for a verified code: two-factor is on and the backup codes are shown once. */}
        <Pressable testID="enrolment-show-codes" onPress={() => props.onStageChange?.('codes')}><Text>codes</Text></Pressable>
        {/* Stands in for the six-digit code box getting focus. */}
        <Pressable testID="enrolment-focus-code" onPress={() => props.onFieldFocus?.()}><Text>focus</Text></Pressable>
      </View>
    );
  };
});

const mockBringEndIntoView = jest.fn();
const mockScrollRef: { current: unknown } = { current: null };
jest.mock('@/lib/hooks/useScrollToEndOnKeyboard', () => ({
  useScrollToEndOnKeyboard: () => ({ scrollRef: mockScrollRef, bringEndIntoView: mockBringEndIntoView }),
}));

import SettingsTwoFactorScreen from './settings-two-factor';
import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

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

it('asks before leaving while the backup codes are on screen, and only then', async () => {
  // Back (the top bar, Android's button or an iOS swipe) threw the codes away, and they
  // are shown once (found while walking the wizard's version, 7 November 2026).
  mockGetStatus.mockResolvedValue(status());
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-enrolment');
  expect(isGuardArmed()).toBe(false);

  fireEvent.press(view.getByTestId('enrolment-show-codes'));
  expect(isGuardArmed()).toBe(true);

  act(() => { firePreventedRemoval(); });
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'twoFactor.codes.title',
    message: 'twoFactor.codes.warning',
    // The app's usual short "Leave": "I have saved them. Continue" wrapped over three
    // lines in the dialog's half-width button (emulator walk, 7 November 2026).
    confirmLabel: 'common:unsavedChanges.discard',
    cancelLabel: 'twoFactor.cancel',
  }));
  expect(mockBack).not.toHaveBeenCalled();
});

it('brings the code box and its button above the keyboard', async () => {
  // The number pad covered the code box and "Verify and turn on", so the member typed
  // blind (emulator walk, 7 November 2026). The wizard already did this.
  mockGetStatus.mockResolvedValue(status());
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-enrolment');
  expect(mockScrollRef.current).toBeTruthy();

  fireEvent.press(view.getByTestId('enrolment-focus-code'));
  expect(mockBringEndIntoView).toHaveBeenCalledTimes(1);
});

it('"I have saved them" leaves without asking', async () => {
  mockGetStatus.mockResolvedValue(status());
  const view = render(<SettingsTwoFactorScreen />);
  await view.findByTestId('two-factor-enrolment');
  fireEvent.press(view.getByTestId('enrolment-show-codes'));
  expect(isGuardArmed()).toBe(true);

  fireEvent.press(view.getByTestId('two-factor-enrolment'));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(isGuardArmed()).toBe(false);
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
