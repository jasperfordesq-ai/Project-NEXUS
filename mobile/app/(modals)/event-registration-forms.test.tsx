// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { AppState, ScrollView } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import Editor from '@/components/events/EventRegistrationFormEditor';
let mockId: string | string[] | undefined = '42';
let mockSelection: string | string[] | undefined;
let mockFocused = true;
let mockState: any;
let mockOperation: any;
const mockUseOperation = jest.fn();
const mockConfirm = jest.fn();
const mockPush = jest.fn();
const mockToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId, form: mockSelection }), router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: () => mockState }));
jest.mock('@/lib/hooks/useRegistrationFormOperations', () => ({ useRegistrationFormOperations: (scope: unknown, allowed: boolean, accepted: unknown) => {
  mockUseOperation(scope, allowed, accepted); return { ...mockOperation, blocked: mockOperation.blocked || !allowed };
} }));
jest.mock('@/components/events/EventRegistrationFormEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-registration-forms';
const settings = { id: 1, event_id: 42, revision: 3, status: 'published' };
const form = { id: 10, event_id: 42, revision: 1, version_number: 1, status: 'draft', name: 'Original', questions: [] };
beforeEach(() => {
  jest.clearAllMocks(); mockId = '42'; mockSelection = undefined; mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  mockState = { data: { event: { permissions: { manage_registration: true } }, settings, forms: [form] },
    isLoading: false, error: null, errorStatus: null, refresh: jest.fn() };
  mockOperation = { saved: null, blocked: false, busy: false, storageFailed: false, operationFailed: false,
    submit: jest.fn().mockResolvedValue(undefined), review: jest.fn().mockResolvedValue(undefined), reload: jest.fn().mockResolvedValue(undefined) };
});
it.each(['0', '01', '1.5', ['42']])('rejects malformed form selector %j', selection => {
  mockSelection = selection; render(<Screen />); expect(mockUseOperation).not.toHaveBeenCalled();
});
it('opens draft editing as navigation and sends no mutation', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('forms.edit'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/event-registration-forms', params: { id: '42', form: '10' } });
  expect(mockOperation.submit).not.toHaveBeenCalled();
});
it.each([undefined, '10'])('offers pull refresh only outside the draft editor (%s)', selection => {
  mockSelection = selection;
  const view = render(<Screen />);
  const control = view.UNSAFE_getByType(ScrollView).props.refreshControl;
  if (selection) expect(control).toBeUndefined();
  else {
    act(() => control.props.onRefresh());
    expect(mockState.refresh).toHaveBeenCalledTimes(1);
    expect(mockOperation.submit).not.toHaveBeenCalled();
  }
});
it.each(['draft', 'published'])('confirms an acknowledged %s result without announcing initial reads', status => {
  render(<Screen />);
  expect(mockToast).not.toHaveBeenCalled();
  act(() => mockUseOperation.mock.calls.at(-1)[2]({ data: { form: { ...form, status }, settings_revision: 4 } }));
  expect(mockToast).toHaveBeenCalledWith({ title: status === 'published' ? 'messages.form_published' : 'messages.form_saved', variant: 'success' });
});
it('saves an existing draft with both base revisions', async () => {
  mockSelection = '10'; const view = render(<Screen />); const definition = { name: 'Edited', description: '', questions: [] };
  await act(async () => view.UNSAFE_getByType(Editor).props.onSave(definition));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'update', formId: 10, formRevision: 1, settingsRevision: 3, definition });
});
it('keeps a confirmed publication after a subsequent fork without reverting to an older read', () => {
  const view = render(<Screen />);
  act(() => mockUseOperation.mock.calls.at(-1)[2]({ data: { form: { ...form, status: 'published', revision: 2 }, settings_revision: 4 } }));
  act(() => mockUseOperation.mock.calls.at(-1)[2]({ data: { form: { ...form, id: 11, version_number: 2 }, settings_revision: 5 } }));
  expect(view.getAllByText('forms.edit')).toHaveLength(1);
  expect(view.getAllByText('forms.publish')).toHaveLength(1);
  expect(view.getAllByText('forms.create_revision')).toHaveLength(1);
});
it('prefers newer server revisions over retained mutation receipts', () => {
  const view = render(<Screen />);
  act(() => mockUseOperation.mock.calls.at(-1)[2]({ data: { form: { ...form, name: 'Saved draft', revision: 2 }, settings_revision: 4 } }));
  mockState = { ...mockState, data: { ...mockState.data, settings: { ...settings, revision: 5 },
    forms: [{ ...form, name: 'Published elsewhere', status: 'published', revision: 3 }] } };
  view.rerender(<Screen />);
  expect(view.queryByText('Saved draft')).toBeNull();
  expect(view.getByText('Published elsewhere')).toBeTruthy();
  expect(view.queryByText('forms.edit')).toBeNull();
});
it.each(['focus', 'permission', 'revision', 'unmount'] as const)('refuses old publication confirmation after %s', async change => {
  const view = render(<Screen />); fireEvent.press(view.getByText('forms.publish'));
  expect(mockOperation.submit).not.toHaveBeenCalled(); const confirm = mockConfirm.mock.calls[0][0].onConfirm;
  if (change === 'focus') mockFocused = false;
  if (change === 'permission') mockState = { ...mockState, data: { ...mockState.data, event: { permissions: { manage_registration: false } } } };
  if (change === 'revision') mockState = { ...mockState, data: { ...mockState.data, settings: { ...settings, revision: 4 } } };
  if (change === 'unmount') view.unmount(); else view.rerender(<Screen />);
  await act(async () => confirm()); expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('does not turn a missing reviewed form into a new form', () => {
  mockOperation.saved = { status: 'review', key: 'old', settings, forms: [], intent: { action: 'update', formId: 99, definition: { name: 'Recovered', description: '', questions: [] } } };
  const view = render(<Screen />); expect(view.UNSAFE_getByType(Editor).props.blocked).toBe(true);
  expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('does not turn a reviewed create into an update of the currently selected form', async () => {
  mockSelection = '10'; const definition = { name: 'Recovered', description: '', questions: [] };
  mockOperation.saved = { status: 'review', key: 'old', settings, forms: [form], intent: { action: 'create', definition } };
  const view = render(<Screen />); expect(view.UNSAFE_getByType(Editor).props.form).toBeNull();
  await act(async () => view.UNSAFE_getByType(Editor).props.onSave(definition));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'create', definition, settingsRevision: 3 });
});
it('hides the editor when access is revoked', () => {
  mockSelection = '10'; const view = render(<Screen />);
  mockState = { ...mockState, data: { ...mockState.data, event: { permissions: { manage_registration: false } } } };
  view.rerender(<Screen />); expect(view.UNSAFE_queryByType(Editor)).toBeNull();
});
it('creates a fresh version rather than updating a published reviewed target', async () => {
  const definition = { name: 'Recovered', description: '', questions: [] };
  mockOperation.saved = { status: 'review', key: 'old', settings, forms: [{ ...form, status: 'published' }],
    intent: { action: 'update', formId: 10, definition } };
  const view = render(<Screen />);
  expect(view.UNSAFE_getByType(Editor).props).toMatchObject({ createRevision: true, recovered: definition, form: { id: 10, status: 'published' } });
  await act(async () => view.UNSAFE_getByType(Editor).props.onSave(definition));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'create', definition, settingsRevision: 3 });
});
