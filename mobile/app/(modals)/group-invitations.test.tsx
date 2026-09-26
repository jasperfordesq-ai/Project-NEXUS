// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

let mockParams: Record<string, string> = { id: '7' };
const mockConfirm = jest.fn();

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => () => null);
jest.mock('@/components/ui/Input', () => ({ testID, label, ...props }: Record<string, unknown>) => {
  const { TextInput } = require('react-native');
  return <TextInput testID={testID} accessibilityLabel={label} {...props} />;
});
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({
  'groups:invite_manage.title': 'Manage invitations', 'groups:invite_manage.invalid_group': 'Invalid group',
  'groups:invite_manage.link_title': 'Invitation link', 'groups:invite_manage.link_description': 'Create a link',
  'groups:invite_manage.expiry_label': 'Expires after', 'groups:invite_manage.create_link': 'Create and share link',
  'groups:invite_manage.email_title': 'Email invitations', 'groups:invite_manage.email_label': 'Email addresses',
  'groups:invite_manage.message_label': 'Optional message', 'groups:invite_manage.send': 'Send invitations',
  'groups:invite_manage.email_error': 'Enter valid email addresses', 'groups:invite_manage.email_limit': 'Maximum 50 invitations', 'groups:invite_manage.pending_title': 'Pending invitations',
  'groups:invite_manage.pending_empty': 'No pending invitations', 'groups:invite_manage.share_link': 'Share link',
  'groups:invite_manage.expires': 'Expires soon', 'groups:invite_manage.share': 'Share', 'groups:invite_manage.revoke': 'Revoke',
  'groups:invite_manage.uncertain': 'Check the refreshed list before trying again.',
  'groups:invite_manage.access_denied': 'Invitation access denied', 'groups:invite_manage.load_error': 'Could not load invitations',
  'common:loading': 'Loading', 'common:back': 'Back', 'common:errors.generic': 'Something went wrong',
}[key] ?? key) }) }));
jest.mock('@/lib/api/groups', () => ({
  getGroupInvites: jest.fn(), createGroupInviteLink: jest.fn(), sendGroupEmailInvites: jest.fn(), revokeGroupInvite: jest.fn(),
}));

import Screen, { parseGroupInviteEmails } from './group-invitations';
import { createGroupInviteLink, getGroupInvites, revokeGroupInvite, sendGroupEmailInvites } from '@/lib/api/groups';
import { ApiResponseError } from '@/lib/api/client';

const linkInvite = { id: 4, type: 'link', email: null, status: 'pending', invite_url: 'https://example.test/invite/token',
  expires_at: '2026-10-10T00:00:00Z', created_at: '2026-09-26T00:00:00Z', invited_by: 2, inviter_name: 'Manager', capabilities: { can_revoke: true } };

describe('group invitation manager', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockParams = { id: '7' };
    jest.mocked(getGroupInvites).mockResolvedValue([]);
    jest.mocked(createGroupInviteLink).mockResolvedValue(linkInvite as never);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });

  it('normalizes and deduplicates recipients while reporting invalid entries', () => {
    expect(parseGroupInviteEmails('A@EXAMPLE.test, a@example.test\nbad')).toEqual({ emails: ['a@example.test'], invalid: ['bad'] });
  });

  it('loads pending invitations and creates then shares an expiry-bounded link', async () => {
    jest.mocked(getGroupInvites).mockResolvedValueOnce([]).mockResolvedValueOnce([linkInvite as never]);
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.press(view.getByText('Create and share link'));
    await waitFor(() => expect(createGroupInviteLink).toHaveBeenCalledWith(7, 14));
    expect(Share.share).toHaveBeenCalledWith({ message: linkInvite.invite_url });
    expect(view.getByText('Share link')).toBeTruthy();
  });

  it('serializes same-frame link creation taps', async () => {
    let release!: (value: never) => void;
    jest.mocked(createGroupInviteLink).mockReturnValue(new Promise(resolve => { release = resolve; }));
    jest.mocked(getGroupInvites).mockResolvedValueOnce([]).mockResolvedValueOnce([linkInvite as never]);
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    const button = view.getByText('Create and share link');
    fireEvent.press(button); fireEvent.press(button);
    expect(createGroupInviteLink).toHaveBeenCalledTimes(1);
    release(linkInvite as never);
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
  });

  it('does not open the share sheet after the manager leaves during link creation', async () => {
    let release!: (value: never) => void;
    jest.mocked(createGroupInviteLink).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.press(view.getByText('Create and share link'));
    view.unmount();
    await act(async () => { release(linkInvite as never); });
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('keeps an invalid email draft and does not call the server', async () => {
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('group-invite-emails'), 'member@example.test bad');
    fireEvent.press(view.getByText('Send invitations'));
    expect(await view.findByText('Enter valid email addresses')).toBeTruthy();
    expect(view.getByTestId('group-invite-emails').props.value).toBe('member@example.test bad');
    expect(sendGroupEmailInvites).not.toHaveBeenCalled();
  });

  it('explains the server batch limit before transport', async () => {
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('group-invite-emails'), Array.from({ length: 51 }, (_, index) => `member${index}@example.test`).join(','));
    fireEvent.press(view.getByText('Send invitations'));
    expect(await view.findByText('Maximum 50 invitations')).toBeTruthy();
    expect(sendGroupEmailInvites).not.toHaveBeenCalled();
  });

  it('preserves refused email work for correction', async () => {
    jest.mocked(sendGroupEmailInvites).mockRejectedValue(new ApiResponseError(422, 'Invitation refused'));
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('group-invite-emails'), 'member@example.test');
    fireEvent.press(view.getByText('Send invitations'));
    expect(await view.findByText('Invitation refused')).toBeTruthy();
    expect(view.getByTestId('group-invite-emails').props.value).toBe('member@example.test');
  });

  it('confirms revocation and removes the confirmed pending invitation', async () => {
    jest.mocked(getGroupInvites).mockResolvedValue([linkInvite as never]);
    jest.mocked(revokeGroupInvite).mockResolvedValue(undefined);
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('Revoke')).toBeTruthy());
    fireEvent.press(view.getByText('Revoke'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { await mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(revokeGroupInvite).toHaveBeenCalledWith(7, 4);
    expect(view.queryByText('Revoke')).toBeNull();
  });

  it('refreshes authoritative pending state instead of repeating an uncertain mutation', async () => {
    jest.mocked(createGroupInviteLink).mockRejectedValue(new ApiResponseError(0, 'Connection lost'));
    jest.mocked(getGroupInvites).mockResolvedValueOnce([]).mockResolvedValueOnce([linkInvite as never]);
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.press(view.getByText('Create and share link'));
    expect(await view.findByText('Check the refreshed list before trying again.')).toBeTruthy();
    await waitFor(() => expect(getGroupInvites).toHaveBeenCalledTimes(2));
    expect(createGroupInviteLink).toHaveBeenCalledTimes(1);
    expect(await view.findByText('Share link')).toBeTruthy();
  });

  it('clears invitation controls when an action reveals lost authority', async () => {
    jest.mocked(createGroupInviteLink).mockRejectedValue(new ApiResponseError(403, 'Forbidden'));
    jest.mocked(getGroupInvites)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiResponseError(403, 'Forbidden'));
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('No pending invitations')).toBeTruthy());
    fireEvent.press(view.getByText('Create and share link'));
    expect(await view.findByText('Invitation access denied')).toBeTruthy();
    expect(getGroupInvites).toHaveBeenCalledTimes(2);
    expect(view.queryByText('Create and share link')).toBeNull();
  });

  it('renders a translated error when sharing an existing link fails', async () => {
    jest.mocked(getGroupInvites).mockResolvedValue([linkInvite as never]);
    jest.mocked(Share.share).mockRejectedValueOnce(new Error('Native share failed'));
    const view = render(<Screen />);
    await waitFor(() => expect(view.getByText('Share')).toBeTruthy());
    fireEvent.press(view.getByText('Share'));
    expect(await view.findByText('Something went wrong')).toBeTruthy();
  });
});
