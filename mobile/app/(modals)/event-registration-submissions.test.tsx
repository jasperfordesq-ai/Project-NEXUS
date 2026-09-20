// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { AppState, RefreshControl, ScrollView } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import Export from '@/components/events/EventRegistrationExport';
import Review from '@/components/events/EventRegistrationAnswerReview';
let mockId: string | string[] | undefined = '42'; let mockFocused = true; let mockUser = 7;
let mockState: any; const mockUseApi = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => { mockUseApi(...args); return mockState; } }));
jest.mock('@/components/events/EventRegistrationExport', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/events/EventRegistrationAnswerReview', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-registration-submissions';
const item = { id: 1, revision: 2, form_version_id: 10, member_name: 'Synthetic member', attempt_number: 1, status: 'submitted', effective_slot: 1, superseded_at: null };
beforeEach(() => { jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() }); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true }); jest.clearAllMocks(); mockId = '42'; mockFocused = true; mockUser = 7;
  mockState = { isLoading: false, error: null, errorStatus: null, refresh: jest.fn(), data: { permitted: true,
    forms: [{ id: 10, name: 'Form' }], submissions: [item], permissions: { view_roster: true, view_sensitive_answers: false, export_answers: false },
    pagination: { submissions: { page: 2, last_page: 3, previous_page: 1, next_page: 3 } } } };
});
it('lists attempts without mounting answer access until explicitly selected', () => {
  const view = render(<Screen />); expect(view.getByText('Synthetic member')).toBeTruthy();
  expect(view.UNSAFE_queryByType(Review)).toBeNull();
  fireEvent.press(view.getByText('submissions.review'));
  expect(view.UNSAFE_getByType(Review).props).toMatchObject({ eventId: 42, tenantId: 2, userId: 7, submissionId: 1, revision: 2, sensitive: false });
  expect(view.UNSAFE_queryByType(RefreshControl)).toBeNull();
});
it('uses returned pagination controls rather than assuming requested page', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:attendance.next'));
  expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 3]);
  fireEvent.press(view.getByText('events:attendance.previous')); expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 1]);
});
it('refreshes only the list and hides restricted identities', () => {
  mockState.data.permissions.view_roster = false;
  const view = render(<Screen />); expect(view.queryByText('Synthetic member')).toBeNull();
  expect(view.getByText('submissions.member_hidden')).toBeTruthy();
  act(() => view.UNSAFE_getByType(RefreshControl).props.onRefresh()); expect(mockState.refresh).toHaveBeenCalledTimes(1);
});
it('removes answer view on blur and requires selecting again on return', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('submissions.review'));
  mockFocused = false; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Review)).toBeNull();
  mockFocused = true; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Review)).toBeNull();
});
it('removes answer view on background', () => {
  const listener = jest.spyOn(AppState, 'addEventListener'); const view = render(<Screen />);
  fireEvent.press(view.getByText('submissions.review'));
  act(() => { listener.mock.calls.at(-1)?.[1]('background'); });
  expect(view.UNSAFE_queryByType(Review)).toBeNull();
});
it('does not carry a selection to a different signed-in member', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('submissions.review'));
  mockUser = 8; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Review)).toBeNull();
});
it.each([403, 404, 410])('clears selected content on refusal %s', status => {
  const view = render(<Screen />); fireEvent.press(view.getByText('submissions.review'));
  mockState = { ...mockState, error: 'refused', errorStatus: status }; view.rerender(<Screen />);
  expect(view.UNSAFE_queryByType(Review)).toBeNull(); expect(view.queryByText('Synthetic member')).toBeNull();
});
it('shows retry for failed list reads and empty state for an accepted empty page', () => {
  mockState.error = 'offline'; const view = render(<Screen />); fireEvent.press(view.getByText('common:buttons.retry'));
  expect(mockState.refresh).toHaveBeenCalledTimes(1); expect(view.queryByText('Synthetic member')).toBeNull();
  mockState.error = null; mockState.data.submissions = []; view.rerender(<Screen />); expect(view.getByText('submissions.empty')).toBeTruthy();
});
it.each(['0', '1.5', ['42', '43'], undefined])('does not load invalid route IDs %j', id => {
  mockId = id; render(<Screen />); expect(mockUseApi).not.toHaveBeenCalled();
});

it('hides redundant pagination on a single-page result', () => {
 mockState.data.pagination.submissions = { page: 1, last_page: 1, previous_page: null, next_page: null };
 const view = render(<Screen />); expect(view.queryByText('events:attendance.previous')).toBeNull(); expect(view.queryByText('events:attendance.next')).toBeNull();
});

it('only offers export with its separate permission and keeps refresh away from its evidence form', () => {
  const view = render(<Screen />); expect(view.queryByText('submissions.export')).toBeNull();
  mockState.data.permissions.export_answers = true; view.rerender(<Screen />); fireEvent.press(view.getByText('submissions.export'));
  expect(view.UNSAFE_getByType(Export).props).toMatchObject({ permitted: true, sensitive: false, eventId: 42, userId: 7, tenantId: 2 });
  expect(view.UNSAFE_queryByType(RefreshControl)).toBeNull();
  mockState.data.permissions.export_answers = false; view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Export)).toBeNull();
});
it('removes the export form on background and returns to the roster', () => {
  mockState.data.permissions.export_answers = true; const view = render(<Screen />); fireEvent.press(view.getByText('submissions.export'));
  act(() => { jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('background'); });
  expect(view.UNSAFE_queryByType(Export)).toBeNull();
  act(() => { jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('active'); });
  expect(view.UNSAFE_queryByType(Export)).toBeNull(); expect(view.getByText('Synthetic member')).toBeTruthy();
});

it('reveals an export failure after layout but ignores its callback after the form is closed', () => {
  mockState.data.permissions.export_answers = true; const view = render(<Screen />);
  fireEvent.press(view.getByText('submissions.export'));
  const scroll = jest.spyOn(view.UNSAFE_getByType(ScrollView).instance, 'scrollToEnd');
  const form = view.UNSAFE_getByType(Export); const reveal = form.props.onErrorLayout;
  act(() => reveal()); expect(scroll).toHaveBeenCalledWith({ animated: false });
  act(() => form.props.onClose()); scroll.mockClear();
  act(() => reveal()); expect(scroll).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('submissions.export'));
  act(() => reveal()); expect(scroll).not.toHaveBeenCalled();
  act(() => view.UNSAFE_getByType(Export).props.onErrorLayout()); expect(scroll).toHaveBeenCalledTimes(1);
});

it('reveals answer-review errors only while that attempt remains selected', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('submissions.review'));
  const scroll = jest.spyOn(view.UNSAFE_getByType(ScrollView).instance, 'scrollToEnd');
  const reveal = view.UNSAFE_getByType(Review).props.onErrorLayout;
  act(() => reveal()); expect(scroll).toHaveBeenCalledWith({ animated: false }); scroll.mockClear();
  mockFocused = false; view.rerender(<Screen />); act(() => reveal()); expect(scroll).not.toHaveBeenCalled();
});
