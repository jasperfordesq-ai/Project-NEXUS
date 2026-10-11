// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eventPeoplePersonSchema,
  eventsApi,
  type EventPeopleFullPerson,
  type EventPeopleMeta,
  type EventPeopleResponse,
} from '@/lib/events-api';
import { renderEventComponent } from '@/test/events-test-harness';
import { EventCheckInWorkspace } from './EventCheckInWorkspace';
import { EventPeopleWorkspace } from './EventPeopleWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const CHIP = 'Answers outstanding';

function person(id: number, name: string, outstanding: boolean | undefined): EventPeopleFullPerson {
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
      ...(outstanding === undefined ? {} : { required_answers_outstanding: outstanding }),
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
      check_in: !outstanding,
      check_out: false,
      no_show: true,
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
    total: 2,
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
    metrics: { confirmed: 2, waitlisted: 0, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
  };
}

function mockPeople(): ReturnType<typeof vi.spyOn> {
  const response: EventPeopleResponse = {
    success: true,
    data: [person(11, 'Owing Member', true), person(12, 'Answered Member', false)],
    meta: meta(),
  };

  return vi.spyOn(eventsApi, 'people').mockResolvedValue(response);
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`No row for ${name}`);

  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('required registration answers on the organiser people screens', () => {
  it('labels members who still owe answers on the People screen, and asks for the flag', async () => {
    const people = mockPeople();
    renderEventComponent(<EventPeopleWorkspace eventId={1} />);

    expect(await screen.findByText('Owing Member')).toBeInTheDocument();
    expect(within(rowFor('Owing Member')).getByText(CHIP)).toBeInTheDocument();
    expect(within(rowFor('Answered Member')).queryByText(CHIP)).not.toBeInTheDocument();
    expect(people).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ include: 'required_answers' }),
      expect.anything(),
    );
  });

  it('labels members who still owe answers on the check-in screen, and asks for the flag', async () => {
    const people = mockPeople();
    renderEventComponent(<EventCheckInWorkspace eventId={1} />);

    expect(await screen.findByText('Owing Member')).toBeInTheDocument();
    expect(within(rowFor('Owing Member')).getByText(CHIP)).toBeInTheDocument();
    expect(within(rowFor('Answered Member')).queryByText(CHIP)).not.toBeInTheDocument();
    expect(people).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ include: 'required_answers' }),
      expect.anything(),
    );
  });

  it('accepts rows with and without the opt-in flag', () => {
    expect(eventPeoplePersonSchema.safeParse(person(1, 'A', undefined)).success).toBe(true);
    expect(eventPeoplePersonSchema.safeParse(person(1, 'A', true)).success).toBe(true);
  });
});
