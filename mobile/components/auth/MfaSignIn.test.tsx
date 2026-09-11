// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import MfaSignIn from './MfaSignIn';
import { beginMfaSetup, verifyMfa } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';

const mockComplete = jest.fn();
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ completeMfa: mockComplete }) }));
jest.mock('@/lib/api/auth', () => ({ beginMfaSetup: jest.fn(), verifyMfa: jest.fn() }));

const challenge = { success: false as const, requires_2fa: true, two_factor_token: 'challenge' };
const session = { access_token: 'issued', refresh_token: 'refresh', backup_codes: ['RECOVERY-ONE'] };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(beginMfaSetup).mockResolvedValue({ data: { secret: 'SETUPKEY' } });
  jest.mocked(verifyMfa).mockResolvedValue(session as never);
});

it('keeps issued setup tokens while recovery codes are saved and retries profile completion without consuming another code', async () => {
  mockComplete.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined);
  const view = render(<MfaSignIn challenge={{ ...challenge, requires_2fa_setup: true }} onCancel={jest.fn()} />);
  await view.findByText('SETUPKEY');
  fireEvent.changeText(view.getByDisplayValue(''), '123456');
  fireEvent.press(view.getByText('Verify'));
  await view.findByText('RECOVERY-ONE');
  expect(mockComplete).not.toHaveBeenCalled();
  expect(view.queryByText('SETUPKEY')).toBeNull();
  fireEvent.press(view.getByText('I have saved my recovery codes'));
  await view.findByText('Setup could not be completed. Retry, or return to sign in if your session has expired.');
  fireEvent.press(view.getByText('I have saved my recovery codes'));
  await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(2));
  expect(verifyMfa).toHaveBeenCalledTimes(1);
  expect(beginMfaSetup).toHaveBeenCalledTimes(1);
});

it('offers backup-code verification and stops accepting an expired challenge', async () => {
  jest.mocked(verifyMfa).mockRejectedValueOnce(new ApiResponseError(401, 'Expired', undefined, 'AUTH_2FA_TOKEN_EXPIRED'));
  const cancel = jest.fn();
  const view = render(<MfaSignIn challenge={challenge} onCancel={cancel} />);
  fireEvent.press(view.getByText('Use backup code instead'));
  fireEvent.changeText(view.getByDisplayValue(''), 'ABCD-EFGH');
  await act(async () => fireEvent.press(view.getByText('Verify')));
  expect(verifyMfa).toHaveBeenCalledWith(challenge, 'ABCD-EFGH', true);
  expect(view.queryByDisplayValue('ABCD-EFGH')).toBeNull();
  fireEvent.press(view.getByText('Return to sign in'));
  expect(cancel).toHaveBeenCalled();
});

it('returns to password sign-in if issued credentials are rejected while loading the profile', async () => {
  jest.mocked(verifyMfa).mockResolvedValueOnce({ access_token: 'expired' } as never);
  mockComplete.mockRejectedValueOnce(new ApiResponseError(401, 'Expired'));
  const view = render(<MfaSignIn challenge={challenge} onCancel={jest.fn()} />);
  fireEvent.changeText(view.getByDisplayValue(''), '123456');
  fireEvent.press(view.getByText('Verify'));
  await view.findByText('Your two-factor authentication session expired. Please sign in again.');
  expect(view.queryByText('Verify')).toBeNull();
  expect(view.getByText('Return to sign in')).toBeTruthy();
});

// Two-factor security review (E-004): one code submission per press, no matter
// how many times the button is hit while the request is in flight.
it('submits a code once while the verification request is still in flight', async () => {
  let release: (value: typeof session) => void = () => {};
  jest.mocked(verifyMfa).mockReturnValueOnce(new Promise((resolve) => { release = resolve as never; }));
  const view = render(<MfaSignIn challenge={challenge} onCancel={jest.fn()} />);
  fireEvent.changeText(view.getByDisplayValue(''), '123456');
  fireEvent.press(view.getByText('Verify'));
  fireEvent.press(view.getByText('Verify'));
  fireEvent.press(view.getByText('Verify'));
  expect(verifyMfa).toHaveBeenCalledTimes(1);
  await act(async () => { release(session); });
  await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(0));
  expect(view.getByText('RECOVERY-ONE')).toBeTruthy();
});

// E-004: the setup secret is requested exactly once and never again on re-render or edits.
it('does not request a second setup secret when the code field changes', async () => {
  const view = render(<MfaSignIn challenge={{ ...challenge, requires_2fa_setup: true }} onCancel={jest.fn()} />);
  await view.findByText('SETUPKEY');
  fireEvent.changeText(view.getByDisplayValue(''), '1');
  fireEvent.changeText(view.getByDisplayValue('1'), '12');
  view.rerender(<MfaSignIn challenge={{ ...challenge, requires_2fa_setup: true }} onCancel={jest.fn()} />);
  expect(beginMfaSetup).toHaveBeenCalledTimes(1);
});

it('keeps server failures readable without exposing an internal exception', async () => {
  jest.mocked(beginMfaSetup).mockRejectedValueOnce(new ApiResponseError(500, 'SQLSTATE internal database failure'));
  const view = render(<MfaSignIn challenge={{ ...challenge, requires_2fa_setup: true }} onCancel={jest.fn()} />);
  await view.findByText('Setup could not be completed. Retry, or return to sign in if your session has expired.');
  expect(view.queryByText(/SQLSTATE/)).toBeNull();
});
