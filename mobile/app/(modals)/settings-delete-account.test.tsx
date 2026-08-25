// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Account deletion is irreversible, so every gate is asserted rather than assumed.
 *
 * The load-bearing tests are the negatives: that nothing reaches the server without both
 * the keyword and the password, and that a FAILED deletion does not sign the member out.
 * Signing out on failure would look identical to success from the member's side — they
 * would land on the sign-in screen believing the account was gone, sign back in, and find
 * it still there.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsDeleteAccountScreen from './settings-delete-account';
import { deleteAccount } from '@/lib/api/settings';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
}));

const mockDeleteAccountT = (key: string, options?: Record<string, unknown>) => {
  const keyword = String(options?.keyword ?? '');
  const map: Record<string, string> = {
    'deleteAccount.title': 'Delete account',
    'deleteAccount.permanentBadge': 'Permanent',
    'deleteAccount.warning': 'This cannot be undone',
    'deleteAccount.warningBody': 'Deleting your account removes your personal data.',
    'deleteAccount.consequences.profile': 'Your profile is removed.',
    'deleteAccount.consequences.listings': 'Your listings are withdrawn.',
    'deleteAccount.consequences.messages': 'Messages you sent are cleared.',
    'deleteAccount.consequences.credits': 'Time-credit records stay in the accounts.',
    'deleteAccount.consequences.signIn': 'Your password and passkeys are deleted.',
    'deleteAccount.confirmTitle': 'Confirm deletion',
    'deleteAccount.typeConfirm': `Type ${keyword} below, then enter your password.`,
    'deleteAccount.confirmationLabel': `Type ${keyword}`,
    'deleteAccount.keyword': 'DELETE',
    'deleteAccount.passwordLabel': 'Current password',
    'deleteAccount.submit': 'Delete my account',
    'deleteAccount.deleting': 'Deleting...',
    'deleteAccount.done': 'Account deleted',
    'deleteAccount.doneBody': 'Your account and personal data have been deleted.',
    'deleteAccount.failed': 'Account not deleted',
    'deleteAccount.failedBody': 'Check your password and try again.',
    'deleteAccount.tooSoon': 'You tried a moment ago. Wait about a minute, then try again.',
    'deleteAccount.confirmRequired': 'Confirmation needed',
    'deleteAccount.confirmRequiredBody': `Type ${keyword} and enter your password.`,
    'deleteAccount.alternativeHint': 'If you only want a break, turn off notifications.',
    'common:buttons.back': 'Back',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockDeleteAccountT, i18n: { language: 'en' } }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    error: '#dc2626',
  }),
}));

// The screen itself uses no tenant colour, but <AppTopBar> does — without this the top
// bar throws "useTenantContext must be used within <TenantProvider>" and the whole screen
// is replaced by its error boundary.
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#6366f1' }));

jest.mock('@/lib/api/settings', () => ({ deleteAccount: jest.fn() }));

const mockLogout = jest.fn();
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ logout: mockLogout }) }));

const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));

const mockDelete = deleteAccount as jest.MockedFunction<typeof deleteAccount>;

beforeEach(() => {
  jest.clearAllMocks();
});

/** Fill the two gates. Split out because most tests need one, the other, or both. */
function fill(
  screen: ReturnType<typeof render>,
  { confirmation, password }: { confirmation?: string; password?: string },
) {
  if (confirmation !== undefined) {
    fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), confirmation);
  }
  if (password !== undefined) {
    fireEvent.changeText(screen.getByTestId('delete-account-password'), password);
  }
}

describe('SettingsDeleteAccountScreen', () => {
  it('tells the member what deletion actually does', () => {
    const screen = render(<SettingsDeleteAccountScreen />);

    expect(screen.getByText('This cannot be undone')).toBeTruthy();
    // All five consequences, not a vague summary. Each is a separate claim the server
    // really does honour — see the copy note in lib/api/settings.ts.
    for (const key of ['profile', 'listings', 'messages', 'credits', 'signIn']) {
      expect(screen.getByTestId(`delete-account-consequence-${key}`)).toBeTruthy();
    }
  });

  it('sends nothing with an empty form', async () => {
    const screen = render(<SettingsDeleteAccountScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('sends nothing with the keyword but no password', async () => {
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'DELETE' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('sends nothing with a password but the wrong keyword', async () => {
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'delete my account', password: 'hunter2' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('accepts the keyword in lower case', async () => {
    // Refusing "delete" because it is not "DELETE" is a self-inflicted GDPR failure; the
    // real gate is the password the server re-authenticates.
    mockDelete.mockResolvedValue({});
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: ' delete ', password: 'hunter2' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('hunter2'));
  });

  it('deletes the account, confirms it, and signs the member out', async () => {
    mockDelete.mockResolvedValue({});
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'DELETE', password: 'hunter2' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('hunter2'));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Account deleted', variant: 'success' }),
    );
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('does NOT sign the member out when the server refuses', async () => {
    // The case this protects: a wrong password. Signing out here would strand a member on
    // the sign-in screen believing their account was deleted when it still exists.
    mockDelete.mockRejectedValue(
      new ApiResponseError(403, 'The password you entered is incorrect.', undefined, 'INVALID_PASSWORD'),
    );
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'DELETE', password: 'wrong' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    expect(mockLogout).not.toHaveBeenCalled();
    // The server's own sentence, not a generic failure: "wrong password" and "you tried
    // this a moment ago" are both recoverable and indistinguishable once flattened.
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Account not deleted',
        description: 'The password you entered is incorrect.',
        variant: 'danger',
      }),
    );
  });

  it('explains a rate-limit refusal in words a member can act on', async () => {
    // Found by walking this on a device: one mistyped password put the retry inside the
    // server's one-per-60-seconds limit, and the server's own sentence is "Rate limit
    // exceeded. Please try again later." — jargon, and silent about how long.
    mockDelete.mockRejectedValue(
      new ApiResponseError(429, 'Rate limit exceeded. Please try again later.', undefined, 'RATE_LIMIT_EXCEEDED'),
    );
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'DELETE', password: 'hunter2' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'You tried a moment ago. Wait about a minute, then try again.',
        variant: 'danger',
      }),
    );
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('lets the member try again after a refusal', async () => {
    mockDelete
      .mockRejectedValueOnce(new ApiResponseError(403, 'Wrong password.', undefined, 'INVALID_PASSWORD'))
      .mockResolvedValueOnce({});
    const screen = render(<SettingsDeleteAccountScreen />);
    fill(screen, { confirmation: 'DELETE', password: 'wrong' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));

    // The button must be live again — a stuck loading state after a wrong password would
    // leave the member with no way forward but killing the app.
    fill(screen, { password: 'hunter2' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(2));
    expect(mockDelete).toHaveBeenLastCalledWith('hunter2');
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
