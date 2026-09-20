// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import Input from '@/components/ui/Input';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
let mockId: string | string[] | undefined = '42'; let mockFocused = true; let mockUser = 7;
let mockState: any; let mockOperation: any; const mockUseApi = jest.fn(); const mockUseOperation = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => { mockUseApi(...args); return mockState; } }));
jest.mock('@/lib/hooks/useInvitationRevocationOperations', () => ({ useInvitationRevocationOperations: (...args: unknown[]) => { mockUseOperation(...args); return mockOperation; } }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-invitation-recipients';

const invitation = { id: 9, event_id: 42, campaign_id: 3, target_type: 'member', status: 'issued', invitation_version: 1,
  token_expires_at: '2027-01-01T12:00:00Z', accepted_at: null, revoked_at: null, expired_at: null, member_name: 'Synthetic Member', recipient_email: 'synthetic@example.test' };
beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() }); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.clearAllMocks(); mockId = '42'; mockFocused = true; mockUser = 7;
  mockState = { isLoading: false, error: null, errorStatus: null, refresh: jest.fn(), data: { event_id: 42,
    invitations: [invitation], permissions: { manage_invitations: true, view_roster: true, view_recipient_email: true },
    pagination: { page: 1, last_page: 2, previous_page: null, next_page: 2 } } };
  mockOperation = { ready: true, blocked: false, busy: false, saved: null, submit: jest.fn(), recover: jest.fn(), reload: jest.fn(), review: jest.fn() };
});
function openEditor(view: ReturnType<typeof render>) { fireEvent.press(view.getByText('revocation.view')); fireEvent.press(view.getByText('revocation.revoke')); }
it('requires a valid reason and separate confirmation before revoking the selected invitation', () => {
  const view = render(<Screen />); openEditor(view); fireEvent.press(view.getByText('revocation.review'));
  expect(view.queryByText('common:buttons.confirm')).toBeNull(); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('revocation.reason'), '  Duplicate invitation  '); fireEvent.press(view.getByText('revocation.review'));
  expect(mockOperation.submit).not.toHaveBeenCalled(); expect(view.getByText('revocation.warning')).toBeTruthy();
  fireEvent.press(view.getByText('common:buttons.confirm')); expect(mockOperation.submit).toHaveBeenCalledWith({ invitationId: 9, reason: 'Duplicate invitation' });
});
it('refuses an oversized reason before confirmation', () => {
  const view = render(<Screen />); openEditor(view); fireEvent.changeText(view.getByLabelText('revocation.reason'), '😀'.repeat(501)); fireEvent.press(view.getByText('revocation.review'));
  expect(view.queryByText('common:buttons.confirm')).toBeNull(); expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('only explicitly recovers pending work and never replaces it', () => {
  mockOperation.blocked = true; mockOperation.saved = { status: 'pending', intent: { invitationId: 9, reason: 'Saved reason' } };
  const view = render(<Screen />); expect(mockOperation.recover).not.toHaveBeenCalled(); openEditor(view);
  expect(view.UNSAFE_queryByType(Input)).toBeNull(); fireEvent.press(view.getByText('event_communications:recovery_button')); expect(mockOperation.recover).toHaveBeenCalledTimes(1);
});
it('reviews a rejected request without sending and updates the selected status', () => {
  mockOperation.blocked = true; mockOperation.saved = { status: 'rejected', intent: { invitationId: 9 } };
  const view = render(<Screen />); fireEvent.press(view.getByText('revocation.review_current')); expect(mockOperation.review).toHaveBeenCalledTimes(1);
  act(() => mockUseOperation.mock.calls.at(-1)?.[4]({ ...invitation, status: 'accepted', invitation_version: 2 }));
  expect(view.getByText('statuses.accepted')).toBeTruthy(); expect(view.queryByText('revocation.revoke')).toBeNull(); expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('clears reason and confirmation after background or account change', () => {
  const view = render(<Screen />); openEditor(view); fireEvent.changeText(view.getByLabelText('revocation.reason'), 'Private reason'); fireEvent.press(view.getByText('revocation.review'));
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('background')); expect(view.queryByText('common:buttons.confirm')).toBeNull();
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('active')); expect(view.queryByText('common:buttons.confirm')).toBeNull();
  openEditor(view); fireEvent.changeText(view.getByLabelText('revocation.reason'), 'Another reason'); mockUser = 8; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Input)).toBeNull();
});
it('removes private recipient fields as permissions change and blocks a mutation refusal', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('revocation.view'));
  mockState.data.permissions.view_roster = false; mockState.data.permissions.view_recipient_email = false; view.rerender(<Screen />);
  expect(view.queryByText('Synthetic Member')).toBeNull(); expect(view.queryByText('synthetic@example.test')).toBeNull();
  mockOperation.errorStatus = 403; view.rerender(<Screen />); expect(view.queryByText('revocation.revoke')).toBeNull(); expect(mockUseOperation.mock.calls.at(-1)?.[1]).toBe(false);
});
it('shows a saved acknowledgement without revoking on load and overlays current list status', () => {
  mockOperation.saved = { status: 'acknowledged', invitation: { id: 9, event_id: 42, campaign_id: 3, status: 'revoked', invitation_version: 2, revoked_at: '2026-09-20T12:00:00Z' } };
  const view = render(<Screen />); fireEvent.press(view.getByText('revocation.view')); expect(view.getByText('statuses.revoked')).toBeTruthy();
  expect(view.queryByText('revocation.revoke')).toBeNull(); expect(view.getByText('revocation.completed')).toBeTruthy(); expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('updates a selected invitation from an accepted receipt and supports pagination', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:attendance.next')); expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 2]);
  fireEvent.press(view.getByText('revocation.view')); act(() => mockUseOperation.mock.calls.at(-1)?.[3]({ data: { invitation: { ...invitation, status: 'revoked', invitation_version: 2 } } }));
  expect(view.getByText('statuses.revoked')).toBeTruthy(); expect(view.queryByText('revocation.revoke')).toBeNull();
});
it.each(['0', ['42', '43'], undefined])('rejects malformed route IDs', id => { mockId = id; render(<Screen />); expect(mockUseApi).not.toHaveBeenCalled(); });
jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));

it('applies a late saved receipt to a selection already open', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('revocation.view'));
  mockOperation.saved = { status: 'acknowledged', invitation: { id: 9, event_id: 42, campaign_id: 3, status: 'revoked', invitation_version: 2, revoked_at: '2026-09-20T12:00:00Z' } };
  view.rerender(<Screen />); expect(view.getByText('statuses.revoked')).toBeTruthy(); expect(view.queryByText('revocation.revoke')).toBeNull();
});

it('keeps fresh reviewed state when closing and reopening an invitation', () => {
  const view = render(<Screen />);
  act(() => mockUseOperation.mock.calls.at(-1)?.[4]({ ...invitation, status: 'accepted', invitation_version: 2 }));
  fireEvent.press(view.getByText('common:close'));
  expect(view.getByText('statuses.accepted')).toBeTruthy();
  fireEvent.press(view.getByText('revocation.view'));
  expect(view.queryByText('revocation.revoke')).toBeNull();
});

it('prefers a newer server version over a previously reviewed state', () => {
  const view = render(<Screen />);
  act(() => mockUseOperation.mock.calls.at(-1)?.[4]({ ...invitation, status: 'accepted', invitation_version: 2 }));
  fireEvent.press(view.getByText('common:close'));
  mockState.data.invitations = [{ ...invitation, status: 'expired', invitation_version: 3 }];
  view.rerender(<Screen />);
  expect(view.getByText('statuses.expired')).toBeTruthy();
  expect(view.queryByText('statuses.accepted')).toBeNull();
});

it('refreshes the list but refuses a pull during an active operation', () => {
  const view = render(<Screen />);
  const refreshControl = () => view.UNSAFE_getByType(require('react-native').RefreshControl);
  act(() => refreshControl().props.onRefresh());
  expect(mockState.refresh).toHaveBeenCalledTimes(1);
  mockOperation.busy = true; view.rerender(<Screen />);
  expect(refreshControl().props.enabled).toBe(false);
  act(() => refreshControl().props.onRefresh());
  expect(mockState.refresh).toHaveBeenCalledTimes(1);
});

it('does not refresh away an active draft', () => {
 const view=render(<Screen />); openEditor(view); fireEvent.changeText(view.getByLabelText('revocation.reason'), 'Keep my reason');
 const control=view.UNSAFE_getByType(require('react-native').RefreshControl);
 expect(control.props.enabled).toBe(false); act(() => control.props.onRefresh());
 expect(mockState.refresh).not.toHaveBeenCalled();
});
