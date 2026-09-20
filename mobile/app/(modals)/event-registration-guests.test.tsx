// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { AppState, RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import Review from '@/components/events/EventGuestAttendanceActions';
let mockId: string | string[] | undefined = '42'; let mockFocused = true; let mockUser = 7;
let mockState: any; const mockUseApi = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => { mockUseApi(...args); return mockState; } }));
jest.mock('@/components/events/EventGuestAttendanceActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-registration-guests';

const guest = { id: 9, guest_number: 1, display_name: 'Synthetic guest', email: 'private@example.invalid', status: 'captured', attendance: null };
beforeEach(() => { jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() }); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true }); jest.clearAllMocks(); mockId = '42'; mockFocused = true; mockUser = 7;
  mockState = { isLoading: false, error: null, errorStatus: null, refresh: jest.fn(), data: { permitted: true,
    guests: [guest], permissions: { view_roster: true, view_sensitive_answers: false, manage_attendance: true },
    pagination: { guests: { page: 2, last_page: 3, previous_page: 1, next_page: 3 } } } };
});
it('opens guest actions explicitly without leaking restricted contact fields', () => {
  const view = render(<Screen />); expect(view.getByText('Synthetic guest')).toBeTruthy(); expect(view.queryByText(guest.email)).toBeNull();
  expect(view.UNSAFE_queryByType(Review)).toBeNull(); fireEvent.press(view.getByText('guests.manage_attendance'));
  expect(view.UNSAFE_getByType(Review).props).toMatchObject({ scope: { tenantId: 2, userId: 7, eventId: 42, guestId: 9 }, permitted: true, active: true });
  expect(view.UNSAFE_queryByType(RefreshControl)).toBeNull();
});
it('hides controls without attendance permission and names without roster permission', () => {
  mockState.data.permissions.manage_attendance = false; mockState.data.permissions.view_roster = false;
  const view = render(<Screen />); expect(view.queryByText('Synthetic guest')).toBeNull(); expect(view.queryByText('guests.manage_attendance')).toBeNull();
});
it('closes selected actions on background and returns to the roster', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('guests.manage_attendance'));
  act(() => { jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('background'); }); expect(view.UNSAFE_queryByType(Review)).toBeNull();
  act(() => { jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('active'); }); expect(view.UNSAFE_queryByType(Review)).toBeNull();
});
it('clears selected actions on owner change', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('guests.manage_attendance')); mockUser = 8; view.rerender(<Screen />);
  expect(view.UNSAFE_queryByType(Review)).toBeNull();
});
it('pages the guest roster independently', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:attendance.next'));
  expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 3]);
});
it.each(['0', ['42', '43'], undefined])('rejects malformed route IDs', id => {
  mockId = id; render(<Screen />); expect(mockUseApi).not.toHaveBeenCalled();
});
