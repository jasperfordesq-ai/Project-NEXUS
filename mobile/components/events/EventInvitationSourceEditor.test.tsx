// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Editor from './EventInvitationSourceEditor';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('requires valid selection and explicit preview, retaining duplicates', () => {
  const onPreview = jest.fn(); const view = render(<Editor disabled={false} onPreview={onPreview} />);
  expect(onPreview).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('invitations.preview')); expect(onPreview).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('invitations.sources.member.label'), '12,12');
  fireEvent.press(view.getByText('invitations.preview'));
  expect(onPreview).toHaveBeenCalledWith({ action: 'preview', campaignType: 'member', source: { member_ids: [12, 12] }, defaultLocale: 'en' });
});
it('retains source drafts independently and submits the selected language', () => {
  const onPreview = jest.fn(); const view = render(<Editor disabled={false} onPreview={onPreview} />);
  fireEvent.changeText(view.getByLabelText('invitations.sources.member.label'), '12');
  fireEvent.press(view.getByText('invitations.types.csv'));
  const csv = 'email\r\na@example.test\r\n'; fireEvent.changeText(view.getByLabelText('invitations.sources.csv.label'), csv);
  fireEvent.press(view.getByText('invitations.locale_label: locales.en')); fireEvent.press(view.getByText('locales.fr'));
  fireEvent.press(view.getByText('invitations.preview'));
  expect(onPreview).toHaveBeenLastCalledWith({ action: 'preview', campaignType: 'csv', source: { csv }, defaultLocale: 'fr' });
  fireEvent.press(view.getByText('invitations.types.member')); expect(view.getByDisplayValue('12')).toBeTruthy();
});
it('prevents preview while operation storage or screen state blocks editing', () => {
  const onPreview = jest.fn(); const view = render(<Editor disabled={false} onPreview={onPreview} />);
  fireEvent.changeText(view.getByLabelText('invitations.sources.member.label'), '12');
  view.rerender(<Editor disabled onPreview={onPreview} />);
  fireEvent.press(view.getByText('invitations.preview')); expect(onPreview).not.toHaveBeenCalled();
  expect(view.getByLabelText('invitations.sources.member.label').props.editable).toBe(false);
});
it('offers all audience filters without requiring a role restriction', () => {
  const onPreview = jest.fn(); const view = render(<Editor disabled={false} onPreview={onPreview} />);
  fireEvent.press(view.getByText('invitations.types.audience'));
  for (const key of ['roles', 'languages', 'groups', 'excluded', 'joinedAfter', 'joinedBefore']) expect(view.getByLabelText('invitations.filters.' + key)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('invitations.filters.groups'), '4');
  fireEvent.press(view.getByText('invitations.filters.all')); fireEvent.press(view.getByText('invitations.preview'));
  expect(onPreview).toHaveBeenCalledWith({ action: 'preview', campaignType: 'audience', source: { criteria: { all_active: true, group_ids: [4], group_match: 'all' } }, defaultLocale: 'en' });
});
