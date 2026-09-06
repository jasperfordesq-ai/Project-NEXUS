// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetCredential = jest.fn();
const mockIssueCredential = jest.fn();
const mockRotateCredential = jest.fn();
const mockRevokeCredential = jest.fn();
const mockClipboard = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  getMyEventCheckinCredential: (...args: unknown[]) => mockGetCredential(...args),
  issueMyEventCheckinCredential: (...args: unknown[]) => mockIssueCredential(...args),
  rotateMyEventCheckinCredential: (...args: unknown[]) => mockRotateCredential(...args),
  revokeMyEventCheckinCredential: (...args: unknown[]) => mockRevokeCredential(...args),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockClipboard(...args) }));
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ value }: { value: string }) => <View testID="attendee-checkin-qr" accessibilityLabel={value} />;
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'eventOfflineCheckin:credential.title': 'Your event check-in code',
        'eventOfflineCheckin:credential.description': 'Signed and PII-free.',
        'eventOfflineCheckin:credential.loading': 'Loading your check-in code',
        'eventOfflineCheckin:credential.load_error': 'Code status unavailable',
        'eventOfflineCheckin:credential.issue': 'Create check-in code',
        'eventOfflineCheckin:credential.expires': `Expires ${String(options?.date ?? '')}`,
        'eventOfflineCheckin:credential.one_shot': 'Shown only on creation or replacement.',
        'eventOfflineCheckin:credential.hide': 'Hide QR code',
        'eventOfflineCheckin:credential.copy': 'Copy code',
        'eventOfflineCheckin:credential.copied': 'Code copied',
        'eventOfflineCheckin:credential.share': 'Share code',
        'eventOfflineCheckin:credential.rotate': 'Replace copied or lost code',
        'eventOfflineCheckin:credential.rotate_title': 'Replace code?',
        'eventOfflineCheckin:credential.rotate_description': 'Old copies stop working.',
        'eventOfflineCheckin:credential.revoke': 'Revoke code',
        'eventOfflineCheckin:credential.revoke_title': 'Revoke code?',
        'eventOfflineCheckin:credential.revoke_description': 'This code stops working.',
        'eventOfflineCheckin:credential.reason': 'Reason',
        'eventOfflineCheckin:credential.reason_hint': 'No sensitive information',
        'eventOfflineCheckin:credential.reason_required': 'Enter a reason',
        'eventOfflineCheckin:credential.revoked': 'Code revoked',
        'eventOfflineCheckin:credential.qr_alt': 'Event check-in QR code',
        'eventOfflineCheckin:credential.status.active': 'Active',
        'eventOfflineCheckin:credential.unavailable': 'Code unavailable',
        'eventOfflineCheckin:credential.privacy': 'No personal data in QR',
        'eventOfflineCheckin:workspace.retry': 'Try again',
        'common:no': 'No',
      };
      return labels[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#006FEE' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111111', textSecondary: '#555555' }),
}));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: ({ onConfirm }: { onConfirm: () => void | Promise<void> }) => { void onConfirm(); },
    confirmDialog: null,
  }),
}));
jest.mock('@/components/ui/TextArea', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return ({ label, ...props }: { label: string }) => <TextInput accessibilityLabel={label} {...props} />;
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Box = ({ children, ...props }: { children?: React.ReactNode }) => <View {...props}>{children}</View>;
  const Button = ({ children, onPress, isDisabled, ...props }: {
    children?: React.ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
  }) => <Pressable accessibilityRole="button" disabled={isDisabled} onPress={onPress} {...props}>{children}</Pressable>;
  Button.Label = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>;
  const Card = Object.assign(Box, { Body: Box });
  const Chip = Object.assign(Box, {
    Label: ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>,
  });
  const Alert = Object.assign(Box, {
    Indicator: () => null,
    Content: Box,
    Title: ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>,
  });
  const Spinner = () => <View testID="spinner" />;
  return { Alert, Button, Card, Chip, Spinner, Surface: Box };
});

import EventCheckinCredentialCard from './EventCheckinCredentialCard';

const activeMetadata = {
  contract_version: 1,
  event_id: 7,
  credential: {
    id: 41,
    registration_id: 81,
    version: 1,
    status: 'active' as const,
    expires_at: '2026-07-13T09:00:00Z',
    token: null,
    token_one_shot: false,
    contains_pii: false as const,
  },
};

const issuedCredential = {
  ...activeMetadata,
  credential: {
    ...activeMetadata.credential,
    version: 2,
    token: 'nqx2_one-shot-code.signature',
    token_one_shot: true,
  },
  manifest_version: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCredential.mockResolvedValue({ contract_version: 1, event_id: 7, credential: null });
  mockIssueCredential.mockResolvedValue(issuedCredential);
  mockRotateCredential.mockResolvedValue(issuedCredential);
  mockRevokeCredential.mockResolvedValue({
    contract_version: 1,
    event_id: 7,
    credential: { id: 41, version: 2, status: 'revoked', revoked_at: '2026-07-12T10:00:00Z' },
  });
  mockClipboard.mockResolvedValue(true);
});

describe('EventCheckinCredentialCard', () => {
  it('creates and renders a PII-free one-shot signed QR credential', async () => {
    const screen = render(<EventCheckinCredentialCard eventId={7} />);
    const issueButton = await screen.findByText('Create check-in code');

    fireEvent.press(issueButton);

    await waitFor(() => expect(mockIssueCredential).toHaveBeenCalledWith(
      7,
      expect.stringMatching(/^mobile-event-checkin-code-/),
    ));
    expect(await screen.findByTestId('attendee-checkin-qr')).toHaveProp(
      'accessibilityLabel',
      'nqx2_one-shot-code.signature',
    );
    expect(screen.getByText('nqx2_one-shot-code.signature')).toBeTruthy();
    fireEvent.press(screen.getByText('Copy code'));
    await waitFor(() => expect(mockClipboard).toHaveBeenCalledWith('nqx2_one-shot-code.signature'));
  });

  it('requires replacement to reveal an existing active credential again', async () => {
    mockGetCredential.mockResolvedValue(activeMetadata);
    const screen = render(<EventCheckinCredentialCard eventId={7} />);

    expect(await screen.findByText('Shown only on creation or replacement.')).toBeTruthy();
    expect(screen.queryByTestId('attendee-checkin-qr')).toBeNull();
    fireEvent.press(screen.getByText('Replace copied or lost code'));

    await waitFor(() => expect(mockRotateCredential).toHaveBeenCalledWith(
      7,
      41,
      1,
      expect.stringMatching(/^mobile-event-checkin-code-rotate-/),
    ));
    expect(await screen.findByTestId('attendee-checkin-qr')).toBeTruthy();
  });

  it('requires an operational reason before revoking the credential', async () => {
    mockGetCredential.mockResolvedValue(activeMetadata);
    const screen = render(<EventCheckinCredentialCard eventId={7} />);
    await screen.findByText('Revoke code');

    fireEvent.press(screen.getByText('Revoke code'));
    expect(mockRevokeCredential).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));

    fireEvent.changeText(screen.getByLabelText('Reason'), 'Lost printed copy');
    fireEvent.press(screen.getByText('Revoke code'));
    await waitFor(() => expect(mockRevokeCredential).toHaveBeenCalledWith(
      7,
      41,
      1,
      'Lost printed copy',
    ));
  });
});
