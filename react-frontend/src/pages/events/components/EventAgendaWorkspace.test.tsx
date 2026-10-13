// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventsApi,
  type Event,
  type EventAgenda,
  type EventAgendaSession,
} from '@/lib/events-api';
import { createCanonicalEventFixture, renderEventComponent } from '@/test/events-test-harness';
import { EventAgendaWorkspace } from './EventAgendaWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const mockConfirm = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

function session(overrides: Partial<EventAgendaSession> = {}): EventAgendaSession {
  return {
    id: 501,
    version: 1,
    title: 'Opening workshop',
    description: 'Practical repair skills.',
    type: 'workshop',
    visibility: 'registered',
    capacity: {
      limit: null,
      registered: 0,
      remaining: null,
      is_full: false,
    },
    registration: {
      state: 'not_registered',
      version: 0,
      can_register: false,
      can_withdraw: false,
    },
    status: 'scheduled',
    start_at: '2030-06-01T10:00:00Z',
    end_at: '2030-06-01T11:00:00Z',
    timezone: 'UTC',
    track: 'Practical skills',
    room: 'Workshop room',
    position: 1,
    cancellation_reason: null,
    speakers: [{
      kind: 'external',
      member_id: null,
      display_name: 'Alex Morgan',
      role: 'Facilitator',
      position: 1,
    }],
    resources: [],
    ...overrides,
  };
}

function agenda(overrides: Partial<EventAgenda> = {}): EventAgenda {
  return {
    contract_version: 1,
    event_id: 1,
    agenda_version: 2,
    timezone: 'UTC',
    permissions: { manage: true },
    sessions: [
      session(),
      session({
        id: 502,
        title: 'Closing panel',
        type: 'panel',
        visibility: 'public',
        start_at: '2030-06-01T12:00:00Z',
        end_at: '2030-06-01T13:00:00Z',
        position: 2,
        track: null,
        room: null,
        speakers: [],
      }),
    ],
    ...overrides,
  };
}

function manageableEvent(overrides: Partial<Event> = {}): Event {
  const base = createCanonicalEventFixture();

  return createCanonicalEventFixture({
    ...overrides,
    permissions: {
      ...base.permissions,
      manage_agenda: true,
      ...(overrides.permissions ?? {}),
    },
  });
}

describe('EventAgendaWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it('renders the authorised running order, visibility, rooms, tracks, and speakers', async () => {
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({ success: true, data: agenda() });
    renderEventComponent(<EventAgendaWorkspace event={manageableEvent()} />);

    expect(await screen.findByRole('heading', { name: 'Opening workshop' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed attendees')).toBeInTheDocument();
    expect(screen.getByText('Workshop room')).toBeInTheDocument();
    expect(screen.getByText('Practical skills')).toBeInTheDocument();
    expect(screen.getByText('Alex Morgan, Facilitator')).toBeInTheDocument();
    expect(eventsApi.agenda).toHaveBeenCalledWith(1, true, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('does not expose mutation controls when the server denies agenda management', async () => {
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({
      success: true,
      data: agenda({ permissions: { manage: false } }),
    });
    renderEventComponent(<EventAgendaWorkspace event={createCanonicalEventFixture()} />);

    await screen.findByRole('heading', { name: 'Opening workshop' });
    expect(screen.queryByRole('button', { name: 'Add session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Opening workshop' })).not.toBeInTheDocument();
    expect(eventsApi.agenda).toHaveBeenCalledWith(1, false, expect.any(Object));
  });

  it('creates a timezone-explicit session with speaker data and a unique idempotency key', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({ success: true, data: agenda() });
    const createSpy = vi.spyOn(eventsApi, 'createAgendaSession').mockResolvedValue({
      success: true,
      data: {
        session: session({ id: 503, title: 'Community keynote', type: 'session', speakers: [] }),
        agenda_version: 3,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 900,
      },
    });
    renderEventComponent(<EventAgendaWorkspace event={manageableEvent()} />);

    await user.click(await screen.findByRole('button', { name: 'Add session' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Session title' }), 'Community keynote');
    await user.click(within(dialog).getByRole('button', { name: 'Add speaker' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Speaker name' }), 'Taylor Reed');
    await user.type(within(dialog).getByRole('textbox', { name: 'Role (optional)' }), 'Keynote speaker');
    await user.click(within(dialog).getByRole('button', { name: 'Create session' }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: 'Community keynote',
          start_at: '2030-06-01T10:00:00+00:00',
          end_at: '2030-06-01T11:00:00+00:00',
          timezone: 'UTC',
          speakers: [{ display_name: 'Taylor Reed', role_label: 'Keynote speaker' }],
        }),
        expect.any(String),
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith('The session was added to the agenda.');
  });

  it('edits a session in the event zone and writes that zone offset (B12)', async () => {
    const user = userEvent.setup();
    const base = createCanonicalEventFixture();
    const dublinEvent = manageableEvent({
      schedule: { ...base.schedule, timezone: 'Europe/Dublin' },
    });
    // A session stored with a different zone label must still be read in the
    // event zone, because that is the zone the save is written in.
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({
      success: true,
      data: agenda({ timezone: 'Europe/Dublin', sessions: [session({ timezone: 'UTC' })] }),
    });
    const updateSpy = vi.spyOn(eventsApi, 'updateAgendaSession').mockResolvedValue({
      success: true,
      data: {
        session: session(),
        agenda_version: 3,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 902,
      },
    });
    renderEventComponent(<EventAgendaWorkspace event={dublinEvent} />);

    await user.click(await screen.findByRole('button', { name: 'Edit Opening workshop' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Start date and time')).toHaveValue('2030-06-01T11:00');
    expect(within(dialog).getByLabelText('End date and time')).toHaveValue('2030-06-01T12:00');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        501,
        1,
        expect.objectContaining({
          start_at: '2030-06-01T11:00:00+01:00',
          end_at: '2030-06-01T12:00:00+01:00',
          timezone: 'Europe/Dublin',
        }),
        expect.any(String),
      );
    });
  });

  it('reorders with the aggregate version and keeps cancellation evidence visible', async () => {
    const user = userEvent.setup();
    const current = agenda({
      sessions: [
        ...agenda().sessions,
        session({
          id: 503,
          title: 'Cancelled briefing',
          status: 'cancelled',
          position: 3,
          cancellation_reason: 'Speaker unavailable',
        }),
      ],
    });
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({ success: true, data: current });
    const reorderSpy = vi.spyOn(eventsApi, 'reorderAgendaSessions').mockResolvedValue({
      success: true,
      data: {
        sessions: [current.sessions[1], current.sessions[0]],
        agenda_version: 3,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 901,
      },
    });
    renderEventComponent(<EventAgendaWorkspace event={manageableEvent()} />);

    expect(await screen.findByText('Cancellation reason: Speaker unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move Opening workshop later' }));

    await waitFor(() => {
      expect(reorderSpy).toHaveBeenCalledWith(1, [502, 501], 2, expect.any(String));
    });
  });

  it('shows privacy-safe capacity and resources and registers with the optimistic viewer version', async () => {
    const user = userEvent.setup();
    const current = session({
      capacity: { limit: 24, registered: 12, remaining: 12, is_full: false },
      registration: {
        state: 'withdrawn',
        version: 2,
        can_register: true,
        can_withdraw: false,
      },
      resources: [{
        id: 701,
        type: 'stream',
        title: 'Registered live stream',
        visibility: 'registered',
        position: 1,
        protected: true,
        available: true,
        url: 'https://events.example.test/live/workshop',
      }],
    });
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({
      success: true,
      data: agenda({ permissions: { manage: false }, sessions: [current] }),
    });
    const registerSpy = vi.spyOn(eventsApi, 'registerAgendaSession').mockResolvedValue({
      success: true,
      data: {
        session: session({
          ...current,
          registration: {
            state: 'registered',
            version: 3,
            can_register: false,
            can_withdraw: true,
          },
        }),
        registration_version: 3,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 902,
      },
    });
    renderEventComponent(<EventAgendaWorkspace event={createCanonicalEventFixture()} />);

    expect(await screen.findByText('12 of 24 registered')).toBeInTheDocument();
    const resource = screen.getByRole('link', { name: /Registered live stream/ });
    expect(resource).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(screen.getByRole('button', { name: 'Register for session' }));

    await waitFor(() => expect(registerSpy).toHaveBeenCalledWith(
      1,
      501,
      2,
      expect.any(String),
    ));
    expect(mockToast.success).toHaveBeenCalledWith('You are registered for this session.');
  });

  it('preserves a session place until the attendee confirms withdrawal', async () => {
    const user = userEvent.setup();
    const current = session({
      title: 'Opening workshop',
      registration: {
        state: 'registered',
        version: 3,
        can_register: false,
        can_withdraw: true,
      },
    });
    vi.spyOn(eventsApi, 'agenda').mockResolvedValue({
      success: true,
      data: agenda({ permissions: { manage: false }, sessions: [current] }),
    });
    const withdraw = vi.spyOn(eventsApi, 'withdrawAgendaSession').mockResolvedValue({
      success: true,
      data: {
        session: session({
          ...current,
          registration: {
            state: 'withdrawn',
            version: 4,
            can_register: true,
            can_withdraw: false,
          },
        }),
        registration_version: 4,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 903,
      },
    });
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderEventComponent(<EventAgendaWorkspace event={createCanonicalEventFixture()} />);

    const button = await screen.findByRole('button', { name: 'Withdraw from session' });
    await user.click(button);
    expect(withdraw).not.toHaveBeenCalled();

    await user.click(button);
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(1, 501, 3, expect.any(String)));
    expect(mockConfirm).toHaveBeenLastCalledWith(expect.objectContaining({
      body: 'Your place in Opening workshop will be released and may be taken by someone else.',
      status: 'danger',
    }));
  });
});
