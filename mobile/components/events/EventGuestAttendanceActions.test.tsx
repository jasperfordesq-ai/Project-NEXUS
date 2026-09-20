// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Actions from './EventGuestAttendanceActions';
let mockOperation: any;
jest.mock('@/lib/hooks/useGuestAttendanceOperations', () => ({ useGuestAttendanceOperations: () => mockOperation }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const guest = { id: 9, registration_id: 8, revision: 1, guest_number: 1, status: 'captured' as const, notification_consent: false,
  retention_due_at: null, withdrawn_at: null, anonymised_at: null, attendance: null };
const props = { scope: { tenantId: 2, userId: 7, eventId: 42, guestId: 9 }, guest, permitted: true, active: true, onRefresh: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); mockOperation = { saved: null, ready: true, storageFailed: false, busy: false,
  blocked: false, operationFailed: false, submit: jest.fn(), recover: jest.fn(), review: jest.fn(), reload: jest.fn() }; });
it('requires confirmation before recording attendance', () => {
  const view = render(<Actions {...props} />); fireEvent.press(view.getByText('guests.check_in')); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(mockOperation.submit).toHaveBeenCalledWith({ guestId: 9, action: 'check_in', expectedVersion: 0 });
});
it('requires a nonblank undo reason', () => {
  const attendance = { can_undo: true, id: 3, status: 'checked_in' as const, version: 2, checked_in_at: null, checked_out_at: null, no_show_at: null };
  const view = render(<Actions {...props} guest={{ ...guest, attendance }} />); fireEvent.press(view.getByText('guests.undo'));
  fireEvent.press(view.getByText('common:buttons.confirm')); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('guests.undo_reason'), 'Incorrect check-in'); fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(mockOperation.submit).toHaveBeenCalledWith({ guestId: 9, action: 'undo', expectedVersion: 2, reason: 'Incorrect check-in' });
});
it('offers explicit recovery without allowing another action', () => {
  mockOperation.saved = { status: 'pending' }; mockOperation.blocked = true;
  const view = render(<Actions {...props} />); expect(view.queryByText('guests.check_in')).toBeNull();
  expect(mockOperation.recover).not.toHaveBeenCalled(); fireEvent.press(view.getByText('event_communications:recovery_button'));
  expect(mockOperation.recover).toHaveBeenCalledTimes(1);
});
it('requires refreshed roster after reviewing a different version', () => {
  mockOperation.saved = { status: 'review', attendanceVersion: 2 };
  const view = render(<Actions {...props} />); expect(view.queryByText('guests.check_in')).toBeNull();
  fireEvent.press(view.getByText('common:buttons.retry')); expect(props.onRefresh).toHaveBeenCalledTimes(1);
});
it('does not expose actions for inactive guests or lost authority', () => {
  const view = render(<Actions {...props} guest={{ ...guest, status: 'withdrawn' }} />); expect(view.queryByText('guests.check_in')).toBeNull();
  view.rerender(<Actions {...props} permitted={false} />); expect(view.toJSON()).toBeNull();
});

it.each([false, undefined])('hides undo without server-confirmed availability (%s)', canUndo => {
  const attendance = { id: 3, status: 'checked_in' as const, version: 3, can_undo: canUndo, checked_in_at: null, checked_out_at: null, no_show_at: null };
  const view = render(<Actions {...props} guest={{ ...guest, attendance }} />);
  expect(view.queryByText('guests.undo')).toBeNull();
  expect(view.getByText('guests.check_out')).toBeTruthy();
});
