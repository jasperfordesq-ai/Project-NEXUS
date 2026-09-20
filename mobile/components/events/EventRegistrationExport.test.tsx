// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { shareAuditedCsv as share } from '@/lib/shareAuditedCsv';
import { prepareOrganizerRegistrationExport as prepare } from '@/lib/api/eventRegistration';
import Export from './EventRegistrationExport';
jest.mock('@/lib/shareAuditedCsv', () => ({ shareAuditedCsv: jest.fn() }));
jest.mock('@/lib/api/eventRegistration', () => ({ prepareOrganizerRegistrationExport: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const props = { tenantId: 2, userId: 3, eventId: 4, permitted: true, sensitive: true, active: true, onClose: jest.fn() };
beforeEach(() => { jest.resetAllMocks(); jest.mocked(share).mockImplementation(async prepareFile => { await prepareFile(); }); });
function evidence(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('submissions.purpose'), 'Prepare venue');
  fireEvent.changeText(view.getByLabelText('submissions.correlation'), 'case-1');
}
it('requires evidence before explicit export and keeps sensitive answers excluded by default', async () => {
  const view = render(<Export {...props} />); fireEvent.press(view.getByText('submissions.export_action')); expect(share).not.toHaveBeenCalled();
  evidence(view); await act(async () => { fireEvent.press(view.getByText('submissions.export_action')); });
  expect(prepare).toHaveBeenCalledWith(4, { purpose: 'Prepare venue', correlation_id: 'case-1', include_sensitive: false }, expect.any(Function));
});
it('requires explicit sensitive opt-in and never exports merely on toggle', async () => {
  const view = render(<Export {...props} />); evidence(view); fireEvent.press(view.getByText('common:yes'));
  expect(share).not.toHaveBeenCalled(); await act(async () => { fireEvent.press(view.getByText('submissions.export_action')); });
  expect(prepare).toHaveBeenCalledWith(4, expect.objectContaining({ include_sensitive: true }), expect.any(Function));
});
it('hides sensitive controls without their separate permission and closes without exporting', () => {
  const view = render(<Export {...props} sensitive={false} />); expect(view.queryByText('submissions.include_sensitive')).toBeNull();
  fireEvent.press(view.getByText('common:close')); expect(props.onClose).toHaveBeenCalledTimes(1); expect(share).not.toHaveBeenCalled();
});
it('retains evidence after a failed export, shows an honest warning and waits for another explicit action', async () => {
  jest.mocked(share).mockRejectedValueOnce(new Error('network')); const view = render(<Export {...props} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.export_action')); });
  expect(view.getByText('submissions.export_error')).toBeTruthy(); expect(view.getByLabelText('submissions.purpose').props.value).toBe('Prepare venue');
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.press(view.getByText('submissions.export_action')); }); expect(share).toHaveBeenCalledTimes(2);
});
it('clears evidence on access loss and does not resume automatically', () => {
  const view = render(<Export {...props} />); evidence(view);
  view.rerender(<Export {...props} active={false} />); expect(view.queryByText('submissions.export_title')).toBeNull();
  view.rerender(<Export {...props} />); expect(view.getByLabelText('submissions.purpose').props.value).toBe(''); expect(share).not.toHaveBeenCalled();
});
it('prevents a reference exceeding the backend UTF-8 boundary', () => {
  const view = render(<Export {...props} />); evidence(view);
  fireEvent.changeText(view.getByLabelText('submissions.correlation'), 'é'.repeat(257));
  fireEvent.press(view.getByText('submissions.export_action')); expect(share).not.toHaveBeenCalled();
});

it('requests visibility after the failure text is laid out and preserves the evidence', async () => {
  const onErrorLayout = jest.fn(); jest.mocked(share).mockRejectedValueOnce(new Error('network'));
  const view = render(<Export {...props} onErrorLayout={onErrorLayout} />); evidence(view);
  await act(async () => { fireEvent.press(view.getByText('submissions.export_action')); });
  expect(onErrorLayout).not.toHaveBeenCalled();
  const error = view.getByText('submissions.export_error'); fireEvent(error, 'layout', { nativeEvent: { layout: { x: 0, y: 1400, width: 320, height: 100 } } });
  expect(onErrorLayout).toHaveBeenCalledTimes(1);
  expect(error.props.accessibilityLiveRegion).toBe('polite');
  expect(view.getByLabelText('submissions.correlation').props.value).toBe('case-1');
});
