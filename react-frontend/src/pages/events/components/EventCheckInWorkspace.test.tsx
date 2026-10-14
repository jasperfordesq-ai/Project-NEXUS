// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eventsApi,
  type EventPeopleFullPerson,
  type EventPeopleMeta,
  type EventPeopleResponse,
} from '@/lib/events-api';
import { renderEventComponent } from '@/test/events-test-harness';
import { checkInWindow, EventCheckInWorkspace } from './EventCheckInWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

function person(id: number, name: string, canCheckIn: boolean): EventPeopleFullPerson {
  return {
    member: { id, display_name: name, avatar_url: null },
    engagement: { state: 'none', consumes_capacity: false },
    registration: {
      id: id + 1000,
      state: 'confirmed',
      version: 1,
      capacity_pool_key: 'event',
      allocation_key: null,
      changed_at: '2030-06-01T09:00:00Z',
      confirmed_at: '2030-06-01T09:00:00Z',
    },
    waitlist: {
      id: null,
      state: null,
      version: null,
      position: null,
      sequence: null,
      offered_at: null,
      offer_expires_at: null,
      accepted_at: null,
    },
    attendance: {
      id: null,
      state: 'not_checked_in',
      version: null,
      changed_at: null,
      checked_in_at: null,
      checked_out_at: null,
    },
    management_actions: {
      approve: false,
      reject: false,
      cancel: true,
      check_in: canCheckIn,
      check_out: false,
      no_show: canCheckIn,
      undo_attendance: false,
      idempotency_key_required: true,
    },
    privacy: { sensitive_fields_redacted: true },
  };
}

function meta(): EventPeopleMeta {
  return {
    base_url: '',
    current_page: 1,
    per_page: 25,
    total: 1,
    total_pages: 1,
    has_more: false,
    search: null,
    registration_state: null,
    waitlist_state: null,
    attendance_state: null,
    engagement_state: null,
    sort: 'name',
    direction: 'asc',
    sensitive_fields_redacted: true,
    capabilities: {
      view_roster: true,
      view_waitlist: true,
      manage_registration: true,
      manage_attendance: true,
      export_people: true,
      view_history: true,
    },
    projection: 'full',
    metrics: { confirmed: 1, waitlisted: 0, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
  };
}

function mockPeople(canCheckIn: boolean) {
  const response: EventPeopleResponse = {
    success: true,
    data: [person(11, 'Ben Member', canCheckIn)],
    meta: meta(),
  };

  return vi.spyOn(eventsApi, 'people').mockResolvedValue(response);
}

function iso(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkInWindow (E-105)', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('opens 30 minutes before the start and closes 24 hours after the end', () => {
    const window = checkInWindow('2026-10-13T13:00:00Z', '2026-10-13T15:00:00Z', now);
    expect(window.state).toBe('too_early');
    expect(window.opensAt?.toISOString()).toBe('2026-10-13T12:30:00.000Z');
    expect(window.closesAt?.toISOString()).toBe('2026-10-14T15:00:00.000Z');
    expect(checkInWindow('2026-10-13T12:20:00Z', '2026-10-13T15:00:00Z', now).state).toBe('open');
    expect(checkInWindow('2026-10-12T08:00:00Z', '2026-10-12T09:00:00Z', now).state).toBe('closed');
  });

  it('uses the start as the end when no end is given, and is unknown without a start', () => {
    expect(checkInWindow('2026-10-13T11:00:00Z', null, now).state).toBe('open');
    expect(checkInWindow('2026-10-12T11:00:00Z', null, now).state).toBe('closed');
    expect(checkInWindow(null, null, now).state).toBe('unknown');
    expect(checkInWindow('not a date', null, now).state).toBe('unknown');
  });
});

describe('EventCheckInWorkspace (E-105 plain-English check-in)', () => {
  it('explains why nothing can be done before check-in opens', async () => {
    mockPeople(false);
    renderEventComponent(<EventCheckInWorkspace eventId={1} eventStart={iso(7 * 24 * 60)} eventEnd={iso(7 * 24 * 60 + 120)} />);

    expect(await screen.findByText('Ben Member')).toBeInTheDocument();
    expect(screen.getByText('Not open yet')).toBeInTheDocument();
    expect(screen.getByText(/Check-in opens .* \(30 minutes before the start\)\./)).toBeInTheDocument();
    expect(screen.queryByText('No action available')).not.toBeInTheDocument();
  });

  it('says until when check-in is open while the event is running', async () => {
    mockPeople(true);
    renderEventComponent(<EventCheckInWorkspace eventId={1} eventStart={iso(-10)} eventEnd={iso(300)} />);

    expect(await screen.findByText('Ben Member')).toBeInTheDocument();
    expect(screen.getByText(/Check-in is open until .* \(24 hours after the end\)\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeInTheDocument();
  });

  it('says check-in has closed but check-out and undo still work, after the window', async () => {
    mockPeople(false);
    renderEventComponent(<EventCheckInWorkspace eventId={1} eventStart={iso(-3 * 24 * 60)} eventEnd={iso(-2 * 24 * 60)} />);

    expect(await screen.findByText('Ben Member')).toBeInTheDocument();
    expect(screen.getByText('Check-in closed')).toBeInTheDocument();
    expect(screen.getByText(/Check-in closed .*\. Check-out and Undo are still possible\./)).toBeInTheDocument();
  });

  it('shows the "How check-in works" panel by default and hides it on request', async () => {
    mockPeople(true);
    const { unmount } = renderEventComponent(<EventCheckInWorkspace eventId={1} />);
    expect(await screen.findByText('How check-in works')).toBeInTheDocument();
    expect(screen.getByText(/time-credit reward for attending/)).toBeInTheDocument();
    expect(screen.queryByText(/never changes balances/i)).not.toBeInTheDocument();
    unmount();

    mockPeople(true);
    renderEventComponent(<EventCheckInWorkspace eventId={1} showGuide={false} />);
    expect(await screen.findByText('Ben Member')).toBeInTheDocument();
    expect(screen.queryByText('How check-in works')).not.toBeInTheDocument();
  });
});
