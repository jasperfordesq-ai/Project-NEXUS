// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsBlockedUsersScreen from './settings-blocked-users';
import { getBlockedUsers, unblockUser } from '@/lib/api/settings';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
}));

const mockSettingsBlockedUsersT = (key: string, options?: Record<string, unknown>) => {
  const map: Record<string, string> = {
        'blockedUsers.title': 'Blocked users',
        'blockedUsers.privacyBadge': 'Privacy control',
        'blockedUsers.subtitle': 'Blocked members cannot contact you.',
        'blockedUsers.summaryLabel': 'Blocked members',
        'blockedUsers.count': `${options?.count ?? 0} blocked`,
        'blockedUsers.loading': 'Loading blocked users...',
        'blockedUsers.empty': 'No blocked users',
        'blockedUsers.emptyDesc': 'People you block will appear here.',
        'blockedUsers.blockedOn': `Blocked on ${options?.date ?? ''}`,
        'blockedUsers.unblock': 'Unblock',
        'blockedUsers.unblocking': 'Unblocking...',
        'blockedUsers.unblockConfirmTitle': `Unblock ${options?.name ?? ''}?`,
        'blockedUsers.unblockConfirmBody': 'They will be able to contact you again.',
        'blockedUsers.unblocked': 'User unblocked',
        'blockedUsers.unblockedDesc': `${options?.name ?? ''} has been unblocked.`,
        'blockedUsers.loadError': 'Could not load blocked users.',
        'blockedUsers.unblockError': 'Could not unblock this user.',
        'common:buttons.back': 'Back',
        'common:buttons.cancel': 'Cancel',
        // Read by <SourceRepositoryLink /> from the 'common' namespace.
        attribution: 'AGPL attribution',
        'sourceRepo.builtOn': 'Built on Project NEXUS by Jasper Ford',
        'sourceRepo.accessibilityLabel': 'Opens the source code repository on GitHub.',
        'common:errors.generic': 'Error',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockSettingsBlockedUsersT,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    error: '#ef4444',
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/api/settings', () => ({
  getBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: pressing the destructive button runs the action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

const mockGetBlockedUsers = getBlockedUsers as jest.MockedFunction<typeof getBlockedUsers>;
const mockUnblockUser = unblockUser as jest.MockedFunction<typeof unblockUser>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SettingsBlockedUsersScreen', () => {
  it('renders blocked users from the API', async () => {
    mockGetBlockedUsers.mockResolvedValue([
      {
        block_id: 1,
        user_id: 42,
        name: 'Sam Carter',
        first_name: 'Sam',
        last_name: 'Carter',
        avatar_url: null,
        reason: null,
        blocked_at: '2026-05-01T10:00:00Z',
      },
    ]);

    const { getByText } = render(<SettingsBlockedUsersScreen />);

    await waitFor(() => expect(getByText('Sam Carter')).toBeTruthy());
    expect(getByText('1 blocked')).toBeTruthy();
    expect(getByText('Unblock')).toBeTruthy();
  });

  it('confirms and unblocks a user', async () => {
    mockGetBlockedUsers.mockResolvedValue([
      {
        block_id: 1,
        user_id: 42,
        name: 'Sam Carter',
        first_name: 'Sam',
        last_name: 'Carter',
        avatar_url: null,
        reason: null,
        blocked_at: '2026-05-01T10:00:00Z',
      },
    ]);
    mockUnblockUser.mockResolvedValue({});

    const { getByText, queryByText } = render(<SettingsBlockedUsersScreen />);
    await waitFor(() => expect(getByText('Sam Carter')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Unblock'));
    });

    await waitFor(() => expect(mockUnblockUser).toHaveBeenCalledWith(42));
    await waitFor(() => expect(queryByText('Sam Carter')).toBeNull());
  });
});
