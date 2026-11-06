// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockConfirm = jest.fn();
const mockSetup = jest.fn();
const mockVerify = jest.fn();
const mockOpen = jest.fn();
const mockClipboard = jest.fn();

jest.mock('@/lib/api/twoFactor', () => ({
  ...jest.requireActual('@/lib/api/twoFactor'),
  confirmSecurityWithPassword: (...args: unknown[]) => mockConfirm(...args),
  beginTwoFactorSetupFromSession: (...args: unknown[]) => mockSetup(...args),
  verifyTwoFactorSetupFromSession: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock('@/lib/utils/openExternalUrl', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpen(...args),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockClipboard(...args) }));
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return ({ value }: { value: string }) => <View testID="two-factor-qr" accessibilityLabel={value} />;
});

import TwoFactorEnrolment from './TwoFactorEnrolment';
import { ApiResponseError } from '@/lib/api/client';

const SECRET = 'JBSWY3DPEHPK3PXP';

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockResolvedValue('confirm-token');
  mockSetup.mockResolvedValue({ secret: SECRET, qr_code_url: 'data:image/svg+xml;base64,xx' });
  mockVerify.mockResolvedValue({ backup_codes: ['AAAA-1111', 'BBBB-2222'] });
  mockOpen.mockResolvedValue('opened');
  mockClipboard.mockResolvedValue(true);
});

async function reachSetup(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByTestId('two-factor-password'), 'correct horse');
  fireEvent.press(view.getByTestId('two-factor-password-continue'));
  await view.findByTestId('two-factor-secret');
}

it('confirms the password first and sends that confirmation to setup and verify', async () => {
  const onDone = jest.fn();
  const view = render(<TwoFactorEnrolment accountLabel="alex@example.org" onDone={onDone} />);
  await reachSetup(view);

  expect(mockConfirm).toHaveBeenCalledWith('correct horse');
  expect(mockSetup).toHaveBeenCalledWith('confirm-token');
  expect(view.getByTestId('two-factor-secret').props.children).toBe('JBSW Y3DP EHPK 3PXP');
  // The password is not kept once it has done its job.
  expect(view.queryByTestId('two-factor-password')).toBeNull();

  fireEvent.changeText(view.getByTestId('two-factor-code'), '123456');
  fireEvent.press(view.getByTestId('two-factor-verify'));
  await view.findByText('AAAA-1111');

  expect(mockVerify).toHaveBeenCalledWith('123456', 'confirm-token');
  expect(view.getByText('BBBB-2222')).toBeTruthy();
  expect(view.getByText(/You will not see them again/)).toBeTruthy();
  // The key is gone once set-up is finished.
  expect(view.queryByTestId('two-factor-secret')).toBeNull();

  fireEvent.press(view.getByTestId('two-factor-done'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('never calls setup when the password is refused', async () => {
  mockConfirm.mockRejectedValueOnce(new ApiResponseError(403, 'Validation failed', undefined, 'SECURITY_CONFIRMATION_REQUIRED'));
  const view = render(<TwoFactorEnrolment onDone={jest.fn()} />);
  fireEvent.changeText(view.getByTestId('two-factor-password'), 'wrong');
  fireEvent.press(view.getByTestId('two-factor-password-continue'));
  await view.findByText('That password is not right. Please try again.');
  expect(mockSetup).not.toHaveBeenCalled();
  expect(view.getByTestId('two-factor-password')).toBeTruthy();
});

it('opens the authenticator with the otpauth link and explains when nothing can open it', async () => {
  const view = render(<TwoFactorEnrolment accountLabel="alex@example.org" onDone={jest.fn()} />);
  await reachSetup(view);
  mockOpen.mockResolvedValueOnce('unopenable');
  await act(async () => { fireEvent.press(view.getByTestId('two-factor-open-authenticator')); });

  expect(mockOpen).toHaveBeenCalledWith(
    'otpauth://totp/Project%20NEXUS%3Aalex%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Project%20NEXUS',
    { allowSchemes: ['otpauth:'] },
  );
  expect(view.getByTestId('two-factor-notice').props.children).toMatch(/No authenticator app on this phone/);
  // The same link is drawn as a QR code for an app on another device.
  expect(view.getByTestId('two-factor-qr').props.accessibilityLabel).toContain('otpauth://totp/');
});

it('asks for the password again when the confirmation has run out before verify', async () => {
  mockVerify.mockRejectedValueOnce(new ApiResponseError(403, 'Validation failed', undefined, 'SECURITY_CONFIRMATION_REQUIRED'));
  const view = render(<TwoFactorEnrolment onDone={jest.fn()} />);
  await reachSetup(view);
  fireEvent.changeText(view.getByTestId('two-factor-code'), '654321');
  fireEvent.press(view.getByTestId('two-factor-verify'));
  await view.findByText('For your security, please enter your password again.');
  expect(view.getByTestId('two-factor-password')).toBeTruthy();
  expect(view.queryByTestId('two-factor-secret')).toBeNull();
});

it('says plainly when the code is wrong and keeps the key on screen', async () => {
  mockVerify.mockRejectedValueOnce(new ApiResponseError(400, 'Invalid verification code', undefined, 'VERIFICATION_FAILED', 'code'));
  const view = render(<TwoFactorEnrolment onDone={jest.fn()} />);
  await reachSetup(view);
  fireEvent.changeText(view.getByTestId('two-factor-code'), '000000');
  fireEvent.press(view.getByTestId('two-factor-verify'));
  await view.findByText('That code did not work. Enter the newest code from your app.');
  expect(view.getByTestId('two-factor-secret')).toBeTruthy();
});

it('copies and shares the backup codes', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  const view = render(<TwoFactorEnrolment onDone={jest.fn()} />);
  await reachSetup(view);
  fireEvent.changeText(view.getByTestId('two-factor-code'), '123456');
  fireEvent.press(view.getByTestId('two-factor-verify'));
  await view.findByText('AAAA-1111');

  await act(async () => { fireEvent.press(view.getByTestId('two-factor-copy-codes')); });
  expect(mockClipboard).toHaveBeenCalledWith('AAAA-1111\nBBBB-2222');

  await act(async () => { fireEvent.press(view.getByTestId('two-factor-share-codes')); });
  await waitFor(() => expect(share).toHaveBeenCalled());
  expect(share.mock.calls[0]![0]).toEqual({ message: expect.stringContaining('AAAA-1111\nBBBB-2222') });
  share.mockRestore();
});
