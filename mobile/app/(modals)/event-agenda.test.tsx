// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import React from 'react';
import { AppState, ScrollView } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import Editor from '@/components/events/EventAgendaEditor';
let mockId: string | string[] | undefined = '101';
let mockFocused = true;
let mockState: any;
let mockOperation: any;
const mockUseOperation = jest.fn();
const mockConfirm = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: jest.fn() }));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: () => mockState }));
jest.mock('@/lib/hooks/useAgendaOperations', () => ({ useAgendaOperations: (scope: unknown, allowed: boolean, accepted: unknown) => {
  mockUseOperation(scope, allowed, accepted); return { ...mockOperation, blocked: mockOperation.blocked || !allowed };
} }));
jest.mock('@/components/events/EventAgendaEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-agenda';
const event = require('../../../contracts/events/v2/event-detail.json');
const agenda = require('../../../contracts/events/v2/event-agenda.json');
const session = agenda.sessions[0];
beforeEach(() => {
  jest.clearAllMocks(); mockId = '101'; mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  mockState = { data: { event: { ...event, permissions: { ...event.permissions, manage_agenda: true } },
    agenda: { ...agenda, permissions: { manage: true }, sessions: [session, { ...session, id: 502, title: 'Second' }] } },
  isLoading: false, error: null, errorStatus: null, refresh: jest.fn() };
  mockOperation = { saved: null, blocked: false, busy: false, storageFailed: false, operationFailed: false,
    submit: jest.fn().mockResolvedValue(undefined), review: jest.fn().mockResolvedValue(undefined), reload: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(true) };
});
it.each([undefined, '0', '1.5', '01', ['101']])('rejects invalid route %s', id => {
  mockId = id; render(<Screen />); expect(mockUseOperation).not.toHaveBeenCalled();
});
it('opens organiser editing with the observed session and version', () => {
  const v = render(<Screen />); fireEvent.press(v.getAllByText('manage.agenda.edit_session')[0]);
  expect(v.UNSAFE_getByType(Editor).props).toMatchObject({ session, blocked: false });
  expect(mockUseOperation).toHaveBeenCalledWith({ tenantId: 2, userId: 7, eventId: 101 }, true, expect.any(Function));
});
it('reorders against the displayed agenda version', () => {
  const v = render(<Screen />); fireEvent.press(v.getAllByText('manage.agenda.move_down')[0]);
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'reorder', orderedSessionIds: [502, session.id], expectedAgendaVersion: agenda.agenda_version });
});
it('hides authoring after permission loss and disables it in the background', () => {
  const v = render(<Screen />); fireEvent.press(v.getByText('manage.agenda.add_session'));
  mockFocused = false; v.rerender(<Screen />); expect(v.UNSAFE_getByType(Editor).props.blocked).toBe(true);
  mockState.data.agenda.permissions.manage = false; v.rerender(<Screen />); expect(v.UNSAFE_queryByType(Editor)).toBeNull();
});
it('offers explicit pending recovery without sending on mount', () => {
  mockOperation.saved = { status: 'pending' }; mockOperation.blocked = true;
  const v = render(<Screen />); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('event_communications:recovery_button')); expect(mockOperation.submit).toHaveBeenCalledWith();
});
it('restores reviewed editing and can reopen it after closing', () => {
  mockOperation.saved = { status: 'review', key: 'saved', agenda: mockState.data.agenda,
    intent: { action: 'update', sessionId: session.id, payload: { title: 'Preserved' } } };
  const v = render(<Screen />);
  expect(v.UNSAFE_getByType(Editor).props.recoveredInput).toEqual({ title: 'Preserved' });
  act(() => v.UNSAFE_getByType(Editor).props.onClose());
  expect(v.UNSAFE_queryByType(Editor)).toBeNull();
  fireEvent.press(v.getByText('manage.agenda.review'));
  expect(v.UNSAFE_getByType(Editor).props.recoveredInput).toEqual({ title: 'Preserved' });
  expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('requires a cancellation reason and submits the observed version', async () => {
  const v = render(<Screen />); fireEvent.press(v.getAllByText('manage.agenda.cancel_session')[0]);
  fireEvent.press(v.getByText('manage.agenda.confirm_cancel')); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.changeText(v.getByLabelText('manage.agenda.cancel_reason'), 'Unavailable');
  await act(async () => fireEvent.press(v.getByText('manage.agenda.confirm_cancel')));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'cancel', sessionId: session.id, expectedVersion: session.version, reason: 'Unavailable' });
});
it('brings the recovery notice into view after a save fails below the fold', () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const v = render(<Screen />);
  fireEvent.press(v.getByText('manage.agenda.add_session'));
  mockOperation.saved = { status: 'pending' }; mockOperation.blocked = true; mockOperation.operationFailed = true;
  v.rerender(<Screen />);
  expect(scroll).toHaveBeenCalledWith({ y: 0, animated: true });
  scroll.mockRestore();
});
it('shows the end date as well as the start date for a session spanning calendar days', () => {
  mockState.data.agenda.sessions = [{ ...session, end_at: '2031-01-02T12:00:00Z' }];
  const v = render(<Screen />);
  expect(v.getByText(/2031/)).toBeTruthy();
});
it.each(['cancelled', 'missing'])('offers a confirmed exit when the reviewed target is %s', async status => {
  mockOperation.saved = { status: 'review', key: 'rejected-key',
    agenda: { ...mockState.data.agenda, sessions: status === 'missing' ? [] : [{ ...session, status: 'cancelled' }] },
    intent: { action: 'update', sessionId: session.id, payload: { title: 'Preserved' } } };
  const v = render(<Screen />);
  expect(v.getByText('manage.agenda.review_unavailable')).toBeTruthy();
  expect(v.queryByText('manage.agenda.review')).toBeNull();
  fireEvent.press(v.getByText('manage.agenda.discard'));
  expect(mockOperation.discard).not.toHaveBeenCalled();
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(mockOperation.discard).toHaveBeenCalledWith('rejected-key');
  expect(mockOperation.submit).not.toHaveBeenCalled();
  expect(mockState.refresh).toHaveBeenCalled();
});
it('does not offer discard for an uncertain operation', () => {
  mockOperation.saved = { status: 'pending' }; mockOperation.blocked = true;
  const v = render(<Screen />);
  expect(v.queryByText('manage.agenda.discard')).toBeNull();
});
it('closes the obsolete editor when conflict review discovers a cancelled target', () => {
  const v = render(<Screen />);
  fireEvent.press(v.getAllByText('manage.agenda.edit_session')[0]);
  expect(v.UNSAFE_getByType(Editor)).toBeTruthy();
  mockOperation.saved = { status: 'review', key: 'cancelled-target',
    agenda: { ...mockState.data.agenda, sessions: [{ ...session, status: 'cancelled' }] },
    intent: { action: 'update', sessionId: session.id, payload: { title: 'Preserved' } } };
  v.rerender(<Screen />);
  expect(v.UNSAFE_queryByType(Editor)).toBeNull();
  expect(v.getByText('manage.agenda.discard')).toBeTruthy();
});
