// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import EventPeopleConfirmation from './EventPeopleConfirmation';
import { Button } from '@/components/ui/NativeButton';

const targets = [{ userId: 10, version: 2 }];
it.each(['reject', 'cancel'] as const)('requires a nonblank reason for %s', async action => {
  const confirm = jest.fn().mockResolvedValue(undefined);
  const screen = render(<EventPeopleConfirmation action={action} targets={targets} onConfirm={confirm} onCancel={jest.fn()} />);
  const label = action === 'reject' ? 'Reject' : 'Cancel registration';
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Reason'), '   ');
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Reason'), ' Changed plans ');
  fireEvent.press(screen.getByText(label));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith({ action, targets, reason: 'Changed plans' }));
});
it('approves without requiring a reason and prevents overlapping confirmation or cancellation', async () => {
  let finish!: () => void;
  const confirm = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const cancel = jest.fn();
  const screen = render(<EventPeopleConfirmation action="approve" targets={targets} onConfirm={confirm} onCancel={cancel} />);
  expect(screen.queryByLabelText('Reason')).toBeNull();
  fireEvent.press(screen.getByText('Approve'));
  fireEvent.press(screen.getByText('Approve'));
  fireEvent.press(screen.getByText('Keep unchanged'));
  expect(confirm).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith({ action: 'approve', targets, reason: null });
  await act(async () => finish());
});
it('clears the reason when the selection or expected version changes', () => {
  const props = { action: 'reject' as const, targets, onConfirm: jest.fn(), onCancel: jest.fn() };
  const screen = render(<EventPeopleConfirmation {...props} />);
  fireEvent.changeText(screen.getByLabelText('Reason'), 'Reason for old version');
  screen.rerender(<EventPeopleConfirmation {...props} targets={[{ userId: 10, version: 3 }]} />);
  expect(screen.getByLabelText('Reason').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
});
it('ignores a retained callback from an obsolete confirmation', async () => {
  const confirm = jest.fn();
  const props = { action: 'approve' as const, targets, onConfirm: confirm, onCancel: jest.fn() };
  const screen = render(<EventPeopleConfirmation {...props} />);
  const oldPress = screen.UNSAFE_getAllByType(Button)[0].props.onPress;
  screen.rerender(<EventPeopleConfirmation {...props} targets={[{ userId: 11, version: 1 }]} />);
  await act(async () => oldPress());
  expect(confirm).not.toHaveBeenCalled();
});
it('shows translated submission failure without claiming a successful update', async () => {
  const screen = render(<EventPeopleConfirmation action="approve" targets={targets}
    onConfirm={jest.fn().mockRejectedValue(new Error('Transport details'))} onCancel={jest.fn()} />);
  fireEvent.press(screen.getByText('Approve'));
  expect(await screen.findByText('The people records could not be updated.')).toBeTruthy();
  expect(screen.queryByText('Transport details')).toBeNull();
});
it('bounds Unicode reasons without cutting a surrogate pair', () => {
  const screen = render(<EventPeopleConfirmation action="reject" targets={targets} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Reason'), '😀'.repeat(4001));
  expect(screen.getByLabelText('Reason').props.value).toBe('😀'.repeat(4000));
});
it('prevents invalid or withdrawn selection submission', () => {
  const confirm = jest.fn();
  const props = { action: 'approve' as const, targets: [], onConfirm: confirm, onCancel: jest.fn() };
  const screen = render(<EventPeopleConfirmation {...props} />);
  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  screen.rerender(<EventPeopleConfirmation {...props} targets={targets} disabled />);
  fireEvent.press(screen.getByText('Approve'));
  expect(confirm).not.toHaveBeenCalled();
});
