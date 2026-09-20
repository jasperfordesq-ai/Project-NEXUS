// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import Editor from '@/components/events/EventInvitationSourceEditor';
import Actions from '@/components/events/EventInvitationCampaignActions';
let mockId: string | string[] | undefined = '42'; let mockFocused = true; let mockUser = 7;
let mockState: any; let mockOperation: any; const mockUseApi = jest.fn(); const mockUseOperation = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => { mockUseApi(...args); return mockState; } }));
jest.mock('@/lib/hooks/useInvitationCampaignOperations', () => ({ useInvitationCampaignOperations: (...args: unknown[]) => { mockUseOperation(...args); return mockOperation; } }));
jest.mock('@/components/events/EventInvitationSourceEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/events/EventInvitationCampaignActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-registration-invitations';
const campaign = { id: 9, revision: 1, campaign_type: 'email', status: 'previewed', valid_count: 1, preview_count: 2, error_count: 1, preview_errors: [{ row: 2, code: 'email_invalid' }] };
beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() }); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.clearAllMocks(); mockId = '42'; mockFocused = true; mockUser = 7;
  mockState = { isLoading: false, error: null, errorStatus: null, refresh: jest.fn(), data: { permitted: true,
    campaigns: [campaign], schedule: { timezone: 'Europe/Dublin', start_at: '2027-08-20T12:00:00Z' },
    pagination: { campaigns: { page: 1, last_page: 2, previous_page: null, next_page: 2 } } } };
  mockOperation = { ready: true, blocked: false, busy: false, saved: null, submit: jest.fn(), recover: jest.fn(), reload: jest.fn() };
});
it('opens the editor only on request and routes preview to the durable operation', () => {
  const view = render(<Screen />); expect(view.UNSAFE_queryByType(Editor)).toBeNull();
  fireEvent.press(view.getByText('invitations.builder_title')); const editor = view.UNSAFE_getByType(Editor);
  const intent = { action: 'preview' }; act(() => editor.props.onPreview(intent)); expect(mockOperation.submit).toHaveBeenCalledWith(intent);
  expect(mockUseOperation.mock.calls.at(-1)?.slice(0, 3)).toEqual([{ eventId: 42, tenantId: 2, userId: 7 }, true, true]);
});
it('reviews preview errors and does not invent missing delivery evidence', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:registrationSettings.review'));
  expect(view.getByText('invitations.row_error')).toBeTruthy(); expect(view.queryByText('invitations.delivery_summary')).toBeNull();
  expect(view.UNSAFE_getByType(Actions).props).toMatchObject({ campaign, timezone: 'Europe/Dublin', disabled: false });
});
it('only explicitly recovers a pending request and blocks new work', () => {
  mockOperation.blocked = true; mockOperation.saved = { status: 'pending', intent: { action: 'issue' } };
  const view = render(<Screen />); expect(mockOperation.recover).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('invitations.builder_title')); expect(view.UNSAFE_queryByType(Editor)).toBeNull();
  fireEvent.press(view.getByText('event_communications:recovery_button')); expect(mockOperation.recover).toHaveBeenCalledTimes(1);
});
it('shows accepted preview even if outside the current history page', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('invitations.builder_title'));
  act(() => mockUseOperation.mock.calls.at(-1)?.[3]({ data: { campaign: { ...campaign, id: 10 } } }));
  expect(view.UNSAFE_queryByType(Editor)).toBeNull(); expect(view.UNSAFE_getByType(Actions).props.campaign.id).toBe(10);
});
it('clears private editor state on background and identity change', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('invitations.builder_title'));
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('background'));
  expect(view.UNSAFE_queryByType(Editor)).toBeNull();
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('active'));
  expect(view.UNSAFE_queryByType(Editor)).toBeNull();
  fireEvent.press(view.getByText('invitations.builder_title')); mockUser = 8; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Editor)).toBeNull();
});
it('hides controls when permission is removed and pages history independently', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:attendance.next'));
  expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 2]);
  mockState.data.permitted = false; view.rerender(<Screen />); expect(view.queryByText('invitations.builder_title')).toBeNull();
});
it.each(['0', ['42', '43'], undefined])('rejects malformed route IDs', id => {
  mockId = id; render(<Screen />); expect(mockUseApi).not.toHaveBeenCalled();
});

it('offers current campaign review for a definitive rejection without retrying the mutation', () => {
  mockOperation = { ...mockOperation, blocked: true, saved: { status: 'rejected' }, review: jest.fn() };
  const view = render(<Screen />);
  expect(view.getByText('invitations.conflict_description')).toBeTruthy();
  fireEvent.press(view.getByText('invitations.review_current'));
  expect(mockOperation.review).toHaveBeenCalledTimes(1);
  expect(mockOperation.recover).not.toHaveBeenCalled();
  act(() => mockUseOperation.mock.calls.at(-1)?.[4]({ ...campaign, revision: 2, status: 'scheduled' }));
  expect(view.UNSAFE_getByType(Actions).props.campaign.revision).toBe(2);
});

jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));
