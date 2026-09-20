// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Actions from './EventInvitationCampaignActions';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const campaign = { id: 4, event_id: 42, campaign_type: 'email' as const, status: 'previewed' as const,
  revision: 2, valid_count: 1, error_count: 0, preview_count: 1, preview_errors: [], default_locale: 'en' };
const props = { campaign, timezone: 'Europe/Dublin', eventStart: '2027-08-20T12:00:00Z', disabled: false, onSubmit: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-08-01T00:00:00Z')); });
afterEach(() => jest.restoreAllMocks());
it.each([null, 'invalid', '2027-08-01T00:00:00Z', '2027-07-31T00:00:00Z'])('does not offer impossible sending or scheduling for start %s', eventStart => {
  const view = render(<Actions {...props} eventStart={eventStart} />);
  expect(view.queryByText('invitations.send_now')).toBeNull();
  expect(view.queryByText('invitations.schedule')).toBeNull();
  expect(view.getByText('invitations.cancel')).toBeTruthy();
});
it('requires a valid expiry and explicit confirmation, interpreting event-local time', () => {
  const view = render(<Actions {...props} />); fireEvent.press(view.getByText('invitations.send_now'));
  expect(props.onSubmit).not.toHaveBeenCalled(); fireEvent.press(view.getByText('common:buttons.confirm')); expect(props.onSubmit).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('invitations.expires_at'), '2027-08-19 10:00'); fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(props.onSubmit).toHaveBeenCalledWith({ action: 'issue', campaignId: 4, expectedRevision: 2, expiresAt: '2027-08-19T09:00:00.000Z' });
});
it.each(['2027-07-31 10:00', '2027-08-20 13:00', '2027-08-21 10:00', '2027-02-30 10:00'])('rejects invalid schedule %s', value => {
  const view = render(<Actions {...props} />); fireEvent.press(view.getByText('invitations.schedule'));
  fireEvent.changeText(view.getByLabelText('invitations.scheduled_for'), value); fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(props.onSubmit).not.toHaveBeenCalled();
});
it('requires a cancellation reason and respects disabled state', () => {
  const view = render(<Actions {...props} />); fireEvent.press(view.getByText('invitations.cancel')); fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(props.onSubmit).not.toHaveBeenCalled(); fireEvent.changeText(view.getByLabelText('invitations.cancel_reason'), 'Correction');
  view.rerender(<Actions {...props} disabled />); fireEvent.press(view.getByText('common:buttons.confirm')); expect(props.onSubmit).not.toHaveBeenCalled();
  view.rerender(<Actions {...props} />); fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(props.onSubmit).toHaveBeenCalledWith({ action: 'cancel', campaignId: 4, expectedRevision: 2, reason: 'Correction' });
});
it('only offers send for scheduled campaigns once due and hides terminal actions', () => {
  const view = render(<Actions {...props} campaign={{ ...campaign, status: 'scheduled', scheduled_for_utc: '2027-08-02T00:00:00Z' }} />);
  expect(view.queryByText('invitations.send_now')).toBeNull(); expect(view.queryByText('invitations.schedule')).toBeNull();
  view.rerender(<Actions {...props} campaign={{ ...campaign, status: 'scheduled', scheduled_for_utc: '2027-07-31T00:00:00Z' }} />);
  expect(view.getByText('invitations.send_now')).toBeTruthy();
  view.rerender(<Actions {...props} campaign={{ ...campaign, status: 'issued' }} />); expect(view.queryByText('invitations.cancel')).toBeNull();
});
