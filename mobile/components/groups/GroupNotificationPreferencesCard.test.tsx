// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockToast = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', error: '#c00' }) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/lib/api/groups', () => ({
  getGroupNotificationPreferences: (...args: unknown[]) => mockGet(...args),
  updateGroupNotificationPreferences: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock('@/components/ui/Toggle', () => {
  const { Pressable, Text } = require('react-native');
  return ({ value, onValueChange, disabled, label }: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; label: string }) => (
    <Pressable testID={`toggle-${label}`} disabled={disabled} onPress={() => onValueChange(!value)}>
      <Text>{`${label}:${String(value)}`}</Text>
    </Pressable>
  );
});
jest.mock('@/components/ui/ErrorState', () => {
  const { Pressable, Text } = require('react-native');
  return ({ subtitle, onRetry }: { subtitle: string; onRetry: () => void }) => (
    <Pressable testID="preference-retry" onPress={onRetry}><Text>{subtitle}</Text></Pressable>
  );
});

import GroupNotificationPreferencesCard from './GroupNotificationPreferencesCard';

const INITIAL = {
  frequency: 'instant' as const,
  email_enabled: true,
  push_enabled: true,
  updated_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(INITIAL);
  mockUpdate.mockResolvedValue({ ...INITIAL, frequency: 'digest', email_enabled: false, updated_at: '2026-09-26T12:00:00Z' });
});

it('loads only the selected group and sends the complete edited contract', async () => {
  const screen = render(<GroupNotificationPreferencesCard groupId={23} refreshToken={0} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith(23));

  fireEvent.press(screen.getByTestId('group-notification-frequency-digest'));
  fireEvent.press(screen.getByTestId('toggle-detail.notifications.email'));
  fireEvent.press(screen.getByTestId('group-notification-save'));

  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(23, {
    frequency: 'digest',
    email_enabled: false,
    push_enabled: true,
  }));
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'detail.notifications.saved', variant: 'success' }));
});

it('fails closed on read error and retries without exposing editable defaults', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(INITIAL);
  const screen = render(<GroupNotificationPreferencesCard groupId={23} refreshToken={0} />);

  expect(await screen.findByTestId('preference-retry')).toBeTruthy();
  expect(screen.queryByTestId('group-notification-frequency-instant')).toBeNull();

  fireEvent.press(screen.getByTestId('preference-retry'));
  expect(await screen.findByTestId('group-notification-frequency-instant')).toBeTruthy();
});

it('keeps edits available after a failed save and disables channels while muted', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('offline'));
  const screen = render(<GroupNotificationPreferencesCard groupId={23} refreshToken={0} />);
  await screen.findByTestId('group-notification-frequency-instant');

  fireEvent.press(screen.getByTestId('group-notification-frequency-muted'));
  expect(screen.getByTestId('toggle-detail.notifications.email').props.accessibilityState?.disabled ?? screen.getByTestId('toggle-detail.notifications.email').props.disabled).toBeTruthy();
  fireEvent.press(screen.getByTestId('group-notification-save'));

  await waitFor(() => expect(screen.getByText('detail.notifications.saveFailed')).toBeTruthy());
  expect(screen.getByTestId('group-notification-frequency-muted').props.accessibilityState?.selected).toBe(true);
});

it('reloads the authoritative values on the parent refresh signal', async () => {
  const screen = render(<GroupNotificationPreferencesCard groupId={23} refreshToken={0} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  screen.rerender(<GroupNotificationPreferencesCard groupId={23} refreshToken={1} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
});
