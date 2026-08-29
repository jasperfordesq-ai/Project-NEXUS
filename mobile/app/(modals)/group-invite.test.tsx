// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

const VALID_TOKEN = 'a'.repeat(40);

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'groups:invite_accept.title': 'Group invitation',
      'groups:invite_accept.description': 'You have been invited to join this group.',
      'groups:invite_accept.success_title': "You're in",
      'groups:invite_accept.success_description': 'You are now a member of this group.',
      'groups:invite_accept.accept': 'Accept invitation',
      'groups:invite_accept.accepting': 'Accepting…',
      'groups:invite_accept.go_to_group': 'Go to group',
      'groups:invite_accept.error_invalid': 'This invitation link is not valid.',
      'groups:detail.try_again': 'Try again',
      'groups:members_count': `${String(values?.count ?? 0)} members`,
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/groups', () => ({
  getGroupInvitePreview: jest.fn(),
  acceptGroupInvite: jest.fn(),
}));

import GroupInviteScreen from './group-invite';
import { acceptGroupInvite, getGroupInvitePreview } from '@/lib/api/groups';
import { ApiResponseError } from '@/lib/api/client';

const preview = (status: string) => ({
  group: { id: 9, name: 'Gardening Group', visibility: 'private', member_count: 12 },
  membership: { status },
  invite: { id: 1, type: 'link', status: 'pending' },
});

describe('GroupInviteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { token: VALID_TOKEN };
    jest.mocked(getGroupInvitePreview).mockResolvedValue(preview('none') as never);
    jest.mocked(acceptGroupInvite).mockResolvedValue({
      action: 'joined', group: { id: 9, name: 'Gardening Group' }, membership: { status: 'active', role: 'member' },
    } as never);
  });

  it('previews the group and accepts the invitation', async () => {
    const { getByText } = render(<GroupInviteScreen />);
    await waitFor(() => expect(getByText('Gardening Group')).toBeTruthy());
    expect(getGroupInvitePreview).toHaveBeenCalledWith(VALID_TOKEN);
    expect(getByText('12 members')).toBeTruthy();

    fireEvent.press(getByText('Accept invitation'));
    await waitFor(() => expect(getByText("You're in")).toBeTruthy());
    expect(acceptGroupInvite).toHaveBeenCalledWith(VALID_TOKEN);

    fireEvent.press(getByText('Go to group'));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '9' } });
  });

  it('sends an existing member straight to the group instead of re-accepting', async () => {
    jest.mocked(getGroupInvitePreview).mockResolvedValue(preview('active') as never);
    const { getByText } = render(<GroupInviteScreen />);
    await waitFor(() => expect(getByText('Go to group')).toBeTruthy());
    fireEvent.press(getByText('Go to group'));
    expect(acceptGroupInvite).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '9' } });
  });

  it('shows the reason when accepting is refused', async () => {
    jest.mocked(acceptGroupInvite).mockRejectedValue(new Error('This invitation has expired'));
    const { getByText } = render(<GroupInviteScreen />);
    await waitFor(() => expect(getByText('Accept invitation')).toBeTruthy());
    fireEvent.press(getByText('Accept invitation'));
    await waitFor(() => expect(getByText('This invitation has expired')).toBeTruthy());
  });

  it('rejects a malformed token without calling the API', () => {
    mockParams = { token: 'too-short' };
    const { getByText } = render(<GroupInviteScreen />);
    expect(getByText('This invitation link is not valid.')).toBeTruthy();
    expect(getGroupInvitePreview).not.toHaveBeenCalled();
  });

  it('offers a retry when the preview cannot be loaded', async () => {
    jest.mocked(getGroupInvitePreview).mockRejectedValue(new ApiResponseError(404, 'Invitation not found'));
    const { getByText } = render(<GroupInviteScreen />);
    await waitFor(() => expect(getByText('Invitation not found')).toBeTruthy());
    fireEvent.press(getByText('Try again'));
    await waitFor(() => expect(getGroupInvitePreview).toHaveBeenCalledTimes(2));
  });
});
