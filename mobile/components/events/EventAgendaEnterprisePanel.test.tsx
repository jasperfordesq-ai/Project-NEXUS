// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Button } from '@/components/ui/NativeButton';
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
let mockSaved: import('@/lib/eventSessionOperationStore').SavedEventSessionOperation | null = null;
let mockStorageFailure = false;
let mockUserId = 7;
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/eventSessionOperationStore', () => ({
  loadEventSessionOperation: jest.fn(async () => { if (mockStorageFailure) throw new Error('Locked'); return mockSaved; }),
  prepareEventSessionOperation: jest.fn(async (scope, intent) => {
    mockSaved = { ...scope, schemaVersion: 1, key: 'saved-key', intent, status: 'pending' };
    return mockSaved;
  }),
  acknowledgeEventSessionOperation: jest.fn(async () => { mockSaved = null; }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShowToast }) }));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
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

async function renderReady(element: React.ReactElement) {
  const view = render(element);
  await act(async () => { await Promise.resolve(); });
  return view;
}

describe('EventAgendaEnterprisePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaved = null; mockStorageFailure = false; mockUserId = 7;
    jest.mocked(registerEventAgendaSession).mockReset();
    jest.mocked(withdrawEventAgendaSession).mockReset();
  });

  it('reopens with pending work, does not auto-replay, and recovers its original request explicitly', async () => {
    jest.mocked(registerEventAgendaSession).mockRejectedValueOnce(new Error('Lost'))
      .mockResolvedValueOnce({ data: { session: session() } } as never);
    const first = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={session()} onSessionChange={jest.fn()} />);
    fireEvent.press(first.getByText('Register for session'));
    await first.findByText('event_communications:recovery_button');
    const request = jest.mocked(registerEventAgendaSession).mock.calls[0];
    first.unmount();
    const next = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={session()} onSessionChange={jest.fn()} />);
    expect(registerEventAgendaSession).toHaveBeenCalledTimes(1);
    expect(next.getByRole('button', { name: 'Register for session' })).toBeDisabled();
    fireEvent.press(next.getByText('event_communications:recovery_button'));
    await waitFor(() => expect(registerEventAgendaSession).toHaveBeenCalledTimes(2));
    expect(jest.mocked(registerEventAgendaSession).mock.calls[1]).toEqual(request);
    await waitFor(() => expect(next.queryByText('event_communications:recovery_button')).toBeNull());
  });

  it('requires an explicit storage reload before enabling registration', async () => {
    mockStorageFailure = true;
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={session()} onSessionChange={jest.fn()} />);
    expect(view.getByText('event_communications:recovery_storage_title')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Register for session' })).toBeDisabled();
    mockStorageFailure = false;
    fireEvent.press(view.getByText('event_communications:recovery_reload'));
    await waitFor(() => expect(view.getByRole('button', { name: 'Register for session' })).not.toBeDisabled());
    expect(registerEventAgendaSession).not.toHaveBeenCalled();
  });

  it('announces failed recovery and keeps the unresolved request blocked', async () => {
    mockSaved = { tenantId: 2, userId: 7, eventId: 101, sessionId: session().id, schemaVersion: 1,
      key: 'original', status: 'pending', intent: { action: 'register', expectedVersion: 0 } };
    jest.mocked(registerEventAgendaSession).mockRejectedValue(new Error('Private transport detail'));
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={session()} onSessionChange={jest.fn()} />);
    fireEvent.press(view.getByText('event_communications:recovery_button'));
    await view.findByText('common:errors.generic');
    expect(view.queryByText('Private transport detail')).toBeNull();
    expect(view.getByRole('button', { name: 'Register for session' })).toBeDisabled();
    expect(view.getByText('event_communications:recovery_button')).toBeTruthy();
  });

  it.each(['register', 'withdraw'] as const)('retries an uncertain %s with its original key and version', async (action) => {
    const api = action === 'register' ? registerEventAgendaSession : withdrawEventAgendaSession;
    const current = session({ registration: { state: action === 'register' ? 'not_registered' : 'registered',
      version: 4, can_register: action === 'register', can_withdraw: action === 'withdraw' } });
    jest.mocked(api).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: { session: current } } as never);
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />);
    const submit = async () => {
      await act(async () => {
        fireEvent.press(view.getByText(action === 'register' ? 'Register for session' : 'Withdraw from session'));
        if (action === 'withdraw') await mockConfirm.mock.calls.at(-1)![0].onConfirm();
      });
    };
    await submit();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    const original = jest.mocked(api).mock.calls[0];
    fireEvent.press(view.getByText('event_communications:recovery_button'));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(jest.mocked(api).mock.calls[1]).toEqual(original);
  });

  it('submits once when the same rendered registration callback is invoked twice', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(registerEventAgendaSession).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    const current = session({ resources: [] });
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />);
    const press = view.UNSAFE_getAllByType(Button)[0]!.props.onPress;
    act(() => { press(); press(); });
    await waitFor(() => expect(registerEventAgendaSession).toHaveBeenCalledTimes(1));
    await act(async () => finish({ data: { session: current } }));
  });

  it('keeps unresolved original work when refreshed registration has a different version', async () => {
    jest.mocked(registerEventAgendaSession).mockRejectedValue(new Error('Unknown outcome'));
    const current = session();
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />);
    fireEvent.press(view.getByText('Register for session'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    view.rerender(<EventAgendaEnterprisePanel eventId={101} session={{ ...current,
      registration: { ...current.registration, version: 2 } }} onSessionChange={jest.fn()} />);
    fireEvent.press(view.getByText('Register for session'));
    expect(registerEventAgendaSession).toHaveBeenCalledTimes(1);
    expect(view.getByText('event_communications:recovery_button')).toBeTruthy();
  });

  it('does not withdraw through a confirmation retained after unmount', async () => {
    const current = session({ registration: { state: 'registered', version: 4, can_register: false, can_withdraw: true } });
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />);
    fireEvent.press(view.getByText('Withdraw from session'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    view.unmount();
    await act(async () => confirm());
    expect(withdrawEventAgendaSession).not.toHaveBeenCalled();
  });

  it.each(['version', 'permission'] as const)('rejects a retained confirmation after its %s changes', async (change) => {
    const current = session({ registration: { state: 'registered', version: 4, can_register: false, can_withdraw: true } });
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={jest.fn()} />);
    fireEvent.press(view.getByText('Withdraw from session'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    const next = { ...current, registration: { ...current.registration,
      version: change === 'version' ? 5 : 4, can_withdraw: change !== 'permission' } };
    view.rerender(<EventAgendaEnterprisePanel eventId={101} session={next} onSessionChange={jest.fn()} />);
    await act(async () => confirm());
    expect(withdrawEventAgendaSession).not.toHaveBeenCalled();
  });

  it('ignores completion after leaving the session panel', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(registerEventAgendaSession).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    const current = session();
    const onSessionChange = jest.fn();
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={onSessionChange} />);
    fireEvent.press(view.getByText('Register for session'));
    await waitFor(() => expect(registerEventAgendaSession).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => finish({ data: { session: current } }));
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not replace a newer registration projection with a delayed receipt', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(registerEventAgendaSession).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    const current = session();
    const changed = jest.fn();
    const view = await renderReady(<EventAgendaEnterprisePanel eventId={101} session={current} onSessionChange={changed} />);
    fireEvent.press(view.getByText('Register for session'));
    await waitFor(() => expect(registerEventAgendaSession).toHaveBeenCalledTimes(1));
    view.rerender(<EventAgendaEnterprisePanel eventId={101} session={{ ...current,
      registration: { ...current.registration, version: 3 } }} onSessionChange={changed} />);
    await act(async () => finish({ data: { session: current, registration_version: 1 } }));
    expect(changed).not.toHaveBeenCalled();
  });

  it('shows aggregate capacity and opens only server-revealed resources', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);
    const current = session();
    const view = await renderReady(
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
    const view = await renderReady(
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
    const view = await renderReady(
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
