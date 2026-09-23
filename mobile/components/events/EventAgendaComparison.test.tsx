// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Comparison from './EventAgendaComparison';
import { agendaDraft, agendaPayload } from '@/lib/eventAgendaDraft';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: { value?: string }) => values?.value === undefined ? key : `${key}: ${values.value}` }) }));
const event = require('../../../contracts/events/v2/event-detail.json');
const session = { ...require('../../../contracts/events/v2/event-agenda.json').sessions[0],
  start_at: event.schedule.start_at, end_at: event.schedule.end_at, timezone: event.schedule.timezone };
it('compares current values with live edits, including explicit removal', () => {
  const original = agendaPayload(agendaDraft(event, session), event, session)!;
  const draft = { ...agendaDraft(event, session), title: 'My proposed title', room: '' };
  const v = render(<Comparison event={event} session={{ ...session, room: 'New room' }} draft={draft} original={original} />);
  expect(v.getByText(`registrationSettings.current_value: ${session.title}`)).toBeTruthy();
  expect(v.getByText('registrationSettings.proposed_value: My proposed title')).toBeTruthy();
  expect(v.getByText('registrationSettings.current_value: New room')).toBeTruthy();
  expect(v.getByText('registrationSettings.proposed_value: registrationSettings.not_set')).toBeTruthy();
  v.rerender(<Comparison event={event} session={session} draft={{ ...draft, title: 'Revised title' }} original={original} />);
  expect(v.queryByText('registrationSettings.proposed_value: My proposed title')).toBeNull();
  expect(v.getByText('registrationSettings.proposed_value: Revised title')).toBeTruthy();
});
it('exposes full ordered speaker and resource changes when expanded', () => {
  const original = agendaPayload(agendaDraft(event, session), event, session)!;
  const draft = { ...agendaDraft(event, session), speakers: [{ userId: 99, name: 'New member', role: 'Host' }],
    resources: [{ type: 'slides' as const, title: 'Replacement slides', url: 'https://example.org/new', visibility: 'staff' as const }] };
  const v = render(<Comparison event={event} session={session} draft={draft} original={original} />);
  expect(v.queryByText(/New member/)).toBeNull();
  fireEvent.press(v.getByText('manage.agenda.speakers_title'));
  expect(v.getByText(/New member.*#99.*Host/)).toBeTruthy();
  expect(v.getByText(/#7/)).toBeTruthy();
  fireEvent.press(v.getByText('manage.agenda.resources.resources_title'));
  expect(v.getByText(/Replacement slides\s+https:\/\/example.org\/new/)).toBeTruthy();
  expect(v.getByText(/resource_types.slides.*visibilities.staff/)).toBeTruthy();
});
it('does not hide a difference in original seconds behind identical minute inputs', () => {
  const latest = { ...session, start_at: '2030-05-01T09:30:37Z' };
  const original = { ...agendaPayload(agendaDraft(event, session), event, session)!, start_at: '2030-05-01T09:30:15Z' };
  const draft = agendaDraft(event, latest, original);
  const v = render(<Comparison event={event} session={latest} draft={draft} original={original} />);
  expect(v.getByText('manage.agenda.start_label')).toBeTruthy();
  expect(v.getByText(/current_value:.*:37/)).toBeTruthy();
  expect(v.getByText(/proposed_value:.*:15/)).toBeTruthy();
});
