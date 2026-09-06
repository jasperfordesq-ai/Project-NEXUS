// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { EventAgendaEnterprisePanel } from './EventAgendaEnterprisePanel';
import {
  registerEventAgendaSession,
  withdrawEventAgendaSession,
  type EventAgendaSession,
} from '@/lib/api/events';

const mockShowToast = jest.fn();
const mockConfirm = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShowToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => {
  const actual = jest.requireActual('@/lib/hooks/useTheme');
  return { ...actual, useTheme: () => actual.DARK };
});
jest.mock('@/lib/api/events', () => ({
  registerEventAgendaSession: jest.fn(),
  withdrawEventAgendaSession: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => ({
      'agenda.enterprise.capacityLimited': `${String(options?.registered ?? 0)} of ${String(options?.limit ?? 0)} registered`,
      'agenda.enterprise.full': 'Full',
      'agenda.enterprise.resourcesTitle': 'Session resources',
      'agenda.enterprise.resourceType.slides': 'Slides',
      'agenda.enterprise.resourceType.stream': 'Live stream',
      'agenda.enterprise.openResource': `Open ${String(options?.title ?? '')}`,
      'agenda.enterprise.register': 'Register for session',
      'agenda.enterprise.registering': 'Registering…',
      'agenda.enterprise.withdraw': 'Withdraw from session',
      'agenda.enterprise.withdrawConfirmTitle': 'Withdraw from this session?',
      'agenda.enterprise.withdrawConfirmDescription': `Release ${String(options?.title ?? '')}`,
      'agenda.enterprise.keepRegistration': 'Keep my place',
      'agenda.enterprise.withdrawing': 'Withdrawing…',
      'agenda.enterprise.registered': 'Registered for this session',
      'agenda.enterprise.ineligible': 'Your event registration is no longer eligible for this session.',
      'agenda.enterprise.registerSuccessTitle': 'Session registered',
      'agenda.enterprise.registerSuccessDescription': 'Your place in the session is reserved.',
      'agenda.enterprise.withdrawSuccessTitle': 'Session withdrawn',
      'agenda.enterprise.withdrawSuccessDescription': 'Your session place has been released.',
    }[key] ?? key),
  }),
}));

const sharedAgenda = require('../../../contracts/events/v2/event-agenda.json') as {
  sessions: EventAgendaSession[];
};

function session(overrides: Partial<EventAgendaSession> = {}): EventAgendaSession {
  return {
    ...sharedAgenda.sessions[0]!,
    registration: {
      state: 'not_registered',
      version: 0,
      can_register: true,
      can_withdraw: false,
    },
    ...overrides,
  };
}

describe('EventAgendaEnterprisePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows aggregate capacity and opens only server-revealed resources', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
    const current = session();
    const view = render(
      <EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />,
    );

    expect(view.getByText('12 of 24 registered')).toBeTruthy();
    expect(view.getByText('Session resources')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Open Workshop slides'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(
      'https://events.example.test/resources/workshop-slides',
    ));
  });

  it('registers with the viewer version and replaces only the returned session projection', async () => {
    const current = session();
    const updated = session({
      registration: {
        state: 'registered',
        version: 1,
        can_register: false,
        can_withdraw: true,
      },
    });
    (registerEventAgendaSession as jest.Mock).mockResolvedValue({
      data: {
        session: updated,
        registration_version: 1,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 9,
      },
    });
    const onSessionChange = jest.fn();
    const view = render(
      <EventAgendaEnterprisePanel
        eventId={101}
        session={current}
        onSessionChange={onSessionChange}
      />,
    );

    fireEvent.press(view.getByText('Register for session'));

    await waitFor(() => expect(registerEventAgendaSession).toHaveBeenCalledWith(
      101,
      current.id,
      0,
      expect.any(String),
    ));
    expect(withdrawEventAgendaSession).not.toHaveBeenCalled();
    expect(onSessionChange).toHaveBeenCalledWith(updated);
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('does not release a session place before destructive confirmation', async () => {
    const current = session({
      title: 'Community workshop',
      registration: {
        state: 'registered',
        version: 4,
        can_register: false,
        can_withdraw: true,
      },
    });
    (withdrawEventAgendaSession as jest.Mock).mockResolvedValue({
      data: { session: current },
    });
    const view = render(
      <EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />,
    );

    fireEvent.press(view.getByText('Withdraw from session'));
    expect(withdrawEventAgendaSession).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Withdraw from this session?',
      message: 'Release Community workshop',
      variant: 'danger',
    }));

    await act(async () => {
      await mockConfirm.mock.calls[0][0].onConfirm();
    });
    expect(withdrawEventAgendaSession).toHaveBeenCalledWith(
      101,
      current.id,
      4,
      expect.any(String),
    );
  });
});
