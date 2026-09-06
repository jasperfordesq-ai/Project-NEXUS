// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    upload: jest.fn(),
  },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    code?: string;
    constructor(mockStatus: number, mockMessage: string, _mockErrors?: unknown, mockCode?: string) {
      super(mockMessage);
      this.status = mockStatus;
      this.code = mockCode;
      this.name = 'ApiResponseError';
    }
  },
  registerUnauthorizedCallback: jest.fn(),
}));

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  EVENT_AGENDA_CONTRACT_VERSION,
  EVENTS_CONTRACT_HEADER,
  EVENTS_CONTRACT_VERSION,
  acceptEventWaitlistOffer,
  checkInEventAttendee,
  commitEventRecurrenceDefinitions,
  commitEventRecurrenceRevision,
  createEvent,
  createRecurringEvent,
  deleteEventReminders,
  eventAgendaSchema,
  eventAgendaSpeakerSchema,
  eventRegistrationResponseSchema,
  eventAttendanceRosterResponseSchema,
  eventRosterMemberSchema,
  eventSchema,
  eventSeriesSchema,
  eventsResponseSchema,
  getCanonicalEvents,
  getEvent,
  getEventAgenda,
  getEventAttendees,
  getEventAttendanceRoster,
  getEventCategories,
  getEventRecurrenceCapabilities,
  getEventRecurrenceDefinitionHistory,
  getEventPolls,
  getEventReminders,
  getEvents,
  getEventSeries,
  joinEventWaitlist,
  leaveEventWaitlist,
  previewEventRecurrenceRevision,
  previewEventRecurrenceDefinitions,
  removeRsvp,
  registerEventAgendaSession,
  rsvpEvent,
  transitionEventAttendance,
  updateEvent,
  updateRecurringEvent,
  updateEventReminders,
  voteEventPoll,
  withdrawEventAgendaSession,
} from './events';

const eventDetailFixture: unknown = require('../../../contracts/events/v2/event-detail.json');
const eventListFixture: unknown = require('../../../contracts/events/v2/event-list-response.json');
const eventRegistrationFixture: unknown = require('../../../contracts/events/v2/event-registration.json');
const eventRosterFixture: unknown = require('../../../contracts/events/v2/event-roster-item.json');
const eventSeriesFixture: unknown = require('../../../contracts/events/v2/event-series.json');
const eventAgendaFixture: unknown = require('../../../contracts/events/v2/event-agenda.json');

const contractOptions = {
  headers: { [EVENTS_CONTRACT_HEADER]: String(EVENTS_CONTRACT_VERSION) },
};

const reminderPreferencesFixture = {
  revision: 3,
  overrides: {
    email_enabled: true,
    in_app_enabled: true,
    web_push_enabled: false,
    fcm_enabled: true,
    realtime_enabled: true,
    cadence: 'instant' as const,
    reminders_enabled: true,
  },
  rules: [{
    id: 9,
    offset_minutes: 60,
    enabled: true,
    rule_version: 2,
    email_enabled: null,
    in_app_enabled: null,
    web_push_enabled: null,
    fcm_enabled: null,
    realtime_enabled: null,
  }],
  resolved: {
    channels: { email: true, in_app: true, web_push: false, fcm: true, realtime: true },
    channel_sources: { email: 'event' },
    cadence: 'instant' as const,
    cadence_source: 'event',
    reminders_enabled: true,
    reminders_source: 'event',
  },
  limits: {
    minimum_offset_minutes: 5,
    maximum_offset_minutes: 43_200,
    maximum_rules: 8,
    default_offsets_minutes: [10_080, 1_440, 60],
  },
  capabilities: { independent_channels: true, diagnostics_supported: false },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Events v2 shared contract fixtures', () => {
  it('parses every shared backend fixture', () => {
    expect(eventSchema.parse(eventDetailFixture).id).toBe(101);
    expect(eventsResponseSchema.parse(eventListFixture).data[0].id).toBe(202);
    expect(eventRegistrationResponseSchema.parse(eventRegistrationFixture).event_id).toBe(101);
    expect(eventRosterMemberSchema.parse(eventRosterFixture).member.id).toBe(44);
    expect(eventSeriesSchema.parse(eventSeriesFixture).id).toBe(12);
    expect(eventAgendaSchema.parse(eventAgendaFixture).agenda_version).toBe(3);
  });

  it('rejects agenda resource URLs that are not credential-free HTTPS', () => {
    const unsafeScheme = JSON.parse(JSON.stringify(eventAgendaFixture)) as {
      sessions: { resources: { url: string | null }[] }[];
    };
    unsafeScheme.sessions[0]!.resources[0]!.url = 'http://events.example.test/slides';
    expect(eventAgendaSchema.safeParse(unsafeScheme).success).toBe(false);

    const embeddedCredentials = JSON.parse(JSON.stringify(eventAgendaFixture)) as typeof unsafeScheme;
    embeddedCredentials.sessions[0]!.resources[0]!.url = 'https://member:secret@events.example.test/slides';
    expect(eventAgendaSchema.safeParse(embeddedCredentials).success).toBe(false);
  });
});

describe('read-only Event agenda contract', () => {
  it('strictly parses agenda v1 and negotiates the canonical Events header', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: eventAgendaFixture,
      meta: { base_url: 'https://test.api' },
    });

    const result = await getEventAgenda(101);

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/agenda', undefined, contractOptions);
    expect(result.data.contract_version).toBe(EVENT_AGENDA_CONTRACT_VERSION);
    expect(result.data.sessions[0].speakers[0]).toEqual(expect.objectContaining({
      kind: 'member',
      member_id: 7,
    }));
    expect(eventAgendaSpeakerSchema.safeParse({
      kind: 'external',
      member_id: 7,
      display_name: 'Private identity mismatch',
      role: null,
      position: 1,
    }).success).toBe(false);
  });

  it('rejects unknown agenda fields without sending response values to drift telemetry', async () => {
    const agenda = eventAgendaFixture as Record<string, unknown>;
    const sessions = agenda.sessions as Record<string, unknown>[];
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        ...agenda,
        sessions: [{ ...sessions[0], private_notes: 'never report this agenda note' }],
      },
      meta: { base_url: 'https://test.api' },
    });

    await expect(getEventAgenda(101)).rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');

    expect(Sentry.captureMessage).toHaveBeenCalledWith('Events contract drift', expect.objectContaining({
      tags: expect.objectContaining({
        module: 'events',
        contract_version: '1',
        endpoint: '/api/v2/events/{id}/agenda',
      }),
      extra: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'data.sessions.0', code: 'unrecognized_keys' }),
        ]),
      },
    }));
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls[0][1]))
      .not.toContain('never report this agenda note');
  });

  it('uses versioned idempotent session registration endpoints without changing event registration', async () => {
    const session = (eventAgendaFixture as { sessions: unknown[] }).sessions[0];
    const mutation = {
      data: {
        session,
        registration_version: 2,
        changed: true,
        idempotent_replay: false,
        history_entry_id: 81,
      },
    };
    (api.post as jest.Mock).mockResolvedValueOnce(mutation).mockResolvedValueOnce(mutation);

    await registerEventAgendaSession(101, 501, 1, 'mobile-session-register');
    await withdrawEventAgendaSession(101, 501, 2, 'mobile-session-withdraw');

    expect(api.post).toHaveBeenNthCalledWith(1,
      '/api/v2/events/101/agenda/sessions/501/registration',
      { expected_version: 1 },
      { headers: { ...contractOptions.headers, 'Idempotency-Key': 'mobile-session-register' } },
    );
    expect(api.post).toHaveBeenNthCalledWith(2,
      '/api/v2/events/101/agenda/sessions/501/registration/withdraw',
      { expected_version: 2 },
      { headers: { ...contractOptions.headers, 'Idempotency-Key': 'mobile-session-withdraw' } },
    );
  });
});

describe('canonical Events boundary', () => {
  it('negotiates and parses the list contract', async () => {
    (api.get as jest.Mock).mockResolvedValue(eventListFixture);

    const result = await getCanonicalEvents('upcoming', 'cursor-abc', 10, {
      groupId: 9,
      stepFree: 'unknown',
    });

    expect(api.get).toHaveBeenCalledWith('/api/v2/events', {
      when: 'upcoming',
      per_page: '10',
      cursor: 'cursor-abc',
      group_id: '9',
      step_free: 'unknown',
    }, contractOptions);
    expect(result.data[0].location.label).toBe('Town square');
  });

  it('keeps the Group tab compatible without leaking legacy shape into Events screens', async () => {
    (api.get as jest.Mock).mockResolvedValue(eventListFixture);

    const result = await getEvents();

    expect(result.data[0]).toEqual(expect.objectContaining({
      id: 202,
      start_date: '2030-06-01T10:00:00+00:00',
      location: 'Town square',
      is_online: false,
      attendees_count: 0,
    }));
  });

  it('negotiates and parses detail, create, and update responses', async () => {
    const envelope = { data: eventDetailFixture };
    (api.get as jest.Mock).mockResolvedValue(envelope);
    (api.post as jest.Mock).mockResolvedValue(envelope);
    (api.put as jest.Mock).mockResolvedValue(envelope);

    const detail = await getEvent(101);
    const payload = {
      title: 'Community repair morning',
      description: 'Repair together.',
      start_time: '2030-05-01T10:15:00+00:00',
      timezone: 'Europe/Dublin',
      all_day: false,
      category_id: 4,
    };
    const created = await createEvent(payload);
    const updated = await updateEvent(101, payload);

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101', undefined, contractOptions);
    expect(api.post).toHaveBeenCalledWith('/api/v2/events', payload, contractOptions);
    expect(api.put).toHaveBeenCalledWith('/api/v2/events/101', payload, contractOptions);
    expect(detail.data.organizer.display_name).toBe('Alex Morgan');
    expect(created.data.schedule.state).toBe('upcoming');
    expect(updated.data.permissions.edit).toBe(false);
  });

  it('uses structured recurring create and preview/commit revision contracts', async () => {
    const payload = {
      title: 'Recurring repair morning',
      description: 'Repair together.',
      start_time: '2030-05-01T10:15:00+00:00',
      timezone: 'Europe/Dublin',
      all_day: false,
      recurrence_frequency: 'weekly' as const,
      recurrence_interval: 2,
      recurrence_days: 'MO',
      recurrence_ends_type: 'never' as const,
    };
    const patch = { title: 'Updated series', local_start_time: '11:30' };
    const impact = {
      affected_event_ids: [101], affected_count: 1,
      changed_event_ids: [101], changed_count: 1,
      moved_occurrences: [], created_occurrences: [], retired_occurrences: [],
      registrations_count: 2, waitlist_count: 0, ticket_count: 0, reminder_count: 1,
      unique_recipient_count: 2, customized_exception_conflicts: [], blocking_conflicts: [],
    };
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { template: eventDetailFixture, occurrences_created: 10 } })
      .mockResolvedValueOnce({
        data: {
          preview_token: 'preview-token', preview_expires_at: '2030-04-01T08:05:00Z',
          scope: 'this_and_future', selected_event_id: 101, root_event_id: 99,
          effective_from_utc: '2030-05-01 10:15:00', can_commit: true, impact,
        },
      })
      .mockResolvedValueOnce({
        data: {
          revision_id: 8, root_event_id: 99, revision_version: 2,
          effective_from_utc: '2030-05-01 10:15:00', changed_event_ids: [101], changed_count: 1,
          notification_recipient_count: 2, notification_outbox_id: 900,
          idempotent_replay: false, created_at: '2030-04-01T08:00:00Z',
        },
      });
    (api.put as jest.Mock).mockResolvedValue({ data: eventDetailFixture });

    const created = await createRecurringEvent(payload);
    const updated = await updateRecurringEvent(101, { ...payload, scope: 'single' });
    const preview = await previewEventRecurrenceRevision(101, patch);
    const committed = await commitEventRecurrenceRevision(101, patch, preview.data.preview_token, 'mobile-revision-1');

    expect(created.data.occurrences_created).toBe(10);
    expect(updated.data.id).toBe(101);
    expect(committed.data.revision_version).toBe(2);
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/events/recurring', payload, contractOptions);
    expect(api.put).toHaveBeenCalledWith('/api/v2/events/101/recurring', { ...payload, scope: 'single' }, contractOptions);
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/events/101/recurrence-revisions/preview', { patch }, contractOptions);
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/v2/events/101/recurrence-revisions/commit', {
      patch,
      preview_token: 'preview-token',
    }, { headers: { ...contractOptions.headers, 'Idempotency-Key': 'mobile-revision-1' } });
  });

  it('strictly parses the authoritative runtime recurrence capability contract', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        contract_version: 1,
        engine: 'legacy',
        structured_input: true,
        supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
        max_occurrences: 52,
        supported_end_types: ['after_count', 'on_date'],
        supports_rolling_never: false,
        supports_effective_revisions: false,
        supports_definition_blueprints: false,
        schema_ready: true,
        rollout_state: 'legacy',
      },
      meta: { contract: 'events-v2' },
    });

    const response = await getEventRecurrenceCapabilities();

    expect(response.data.max_occurrences).toBe(52);
    expect(response.data.supports_effective_revisions).toBe(false);
    expect(api.get).toHaveBeenCalledWith(
      '/api/v2/events/recurrence-capabilities',
      undefined,
      contractOptions,
    );
  });

  it('uses canonical blueprint pagination and signed preview/idempotent commit contracts', async () => {
    const sections = {
      agenda: true,
      ticket_types: false,
      registration: true,
      safety: false,
      staff: false,
    };
    const counts = {
      sessions: 2,
      speakers: 1,
      resources: 0,
      ticket_types: 0,
      registration_settings: 1,
      published_forms: 1,
      form_questions: 3,
      safety_requirements: 0,
      staff_assignments: 0,
    };
    const historyItem = {
      blueprint_id: 9,
      blueprint_version: 4,
      schema_version: 1,
      effective_from_recurrence_id: '20300501T101500Z',
      source_event_id: 101,
      source_recurrence_id: '20300501T101500Z',
      selected_sections: sections,
      counts,
      manifest_hash: 'a'.repeat(64),
      captured_by_user_id: 7,
      created_at: '2030-04-01T08:00:00Z',
    };
    const preview = {
      preview_token: 'signed-preview-token',
      preview_expires_at: '2030-04-01T08:05:00Z',
      schema_version: 1,
      root_event_id: 99,
      source_event_id: 101,
      source_recurrence_id: '20300501T101500Z',
      effective_from_recurrence_id: '20300501T101500Z',
      selected_sections: sections,
      manifest_hash: 'b'.repeat(64),
      blueprint_set_version: 3,
      counts,
      conflicts: [],
      can_commit: true,
    };
    const commit = {
      blueprint_id: 10,
      blueprint_version: 4,
      schema_version: 1,
      root_event_id: 99,
      source_event_id: 101,
      source_recurrence_id: '20300501T101500Z',
      effective_from_recurrence_id: '20300501T101500Z',
      selected_sections: sections,
      manifest_hash: 'b'.repeat(64),
      counts,
      idempotent_replay: false,
      created_at: '2030-04-01T08:01:00Z',
    };
    (api.get as jest.Mock).mockResolvedValue({
      data: { items: [historyItem], next_before_version: 4 },
    });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: commit });

    const history = await getEventRecurrenceDefinitionHistory(101, 7);
    const prepared = await previewEventRecurrenceDefinitions(
      101,
      '20300501T101500Z',
      sections,
    );
    const saved = await commitEventRecurrenceDefinitions(
      101,
      '20300501T101500Z',
      sections,
      prepared.data.preview_token,
      'mobile-definition-stable-retry',
    );

    expect(history.data.next_before_version).toBe(4);
    expect(saved.data.blueprint_version).toBe(4);
    expect(api.get).toHaveBeenCalledWith(
      '/api/v2/events/101/recurrence-definition-blueprints',
      { limit: '10', before_version: '7' },
      contractOptions,
    );
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/api/v2/events/101/recurrence-definition-blueprints/preview',
      { effective_from_recurrence_id: '20300501T101500Z', sections },
      contractOptions,
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/api/v2/events/101/recurrence-definition-blueprints/commit',
      {
        effective_from_recurrence_id: '20300501T101500Z',
        sections,
        preview_token: 'signed-preview-token',
      },
      {
        headers: {
          ...contractOptions.headers,
          'Idempotency-Key': 'mobile-definition-stable-retry',
        },
      },
    );
  });

  it('rejects blueprint history that leaks manifest values outside the manager projection', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        items: [{
          blueprint_id: 9,
          blueprint_version: 1,
          schema_version: 1,
          effective_from_recurrence_id: '20300501T101500Z',
          source_event_id: 101,
          source_recurrence_id: '20300501T101500Z',
          selected_sections: {
            agenda: true,
            ticket_types: false,
            registration: false,
            safety: false,
            staff: false,
          },
          counts: {},
          manifest_hash: 'c'.repeat(64),
          captured_by_user_id: 7,
          created_at: '2030-04-01T08:00:00Z',
          manifest: { attendees: ['private-member'] },
        }],
        next_before_version: null,
      },
    });

    await expect(getEventRecurrenceDefinitionHistory(101))
      .rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls[0][1]))
      .not.toContain('private-member');
  });

  it('reports privacy-safe, stable drift telemetry and rejects the response', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { ...(eventDetailFixture as Record<string, unknown>), title: 42, description: 'private description' },
    });

    await expect(getEvent(101)).rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');

    expect(Sentry.captureMessage).toHaveBeenCalledWith('Events contract drift', expect.objectContaining({
      tags: expect.objectContaining({
        module: 'events',
        contract_version: '2',
        endpoint: '/api/v2/events/{id}',
      }),
      extra: {
        issues: expect.arrayContaining([expect.objectContaining({ path: 'data.title', code: expect.any(String) })]),
      },
    }));
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls[0][1])).not.toContain('private description');
  });
});

describe('canonical registration, roster, and series resources', () => {
  it('parses RSVP relationship state from the shared fixture', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: eventRegistrationFixture });

    const result = await rsvpEvent(101, 'going', 'mobile-rsvp-stable-1');

    expect(api.post).toHaveBeenCalledWith('/api/v2/events/101/rsvp', { status: 'going' }, {
      headers: { ...contractOptions.headers, 'Idempotency-Key': 'mobile-rsvp-stable-1' },
    });
    expect(result.data.relationship.registration.state).toBe('confirmed');
    expect(result.data.metrics.confirmed_count).toBe(19);
  });

  it('parses roster members and negotiates organizer filters', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [eventRosterFixture],
      meta: { per_page: 25, has_more: false, cursor: null },
    });

    const result = await getEventAttendees(101, { perPage: 25, status: 'all' });

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/attendees', {
      per_page: '25',
      status: 'all',
    }, contractOptions);
    expect(result.data[0].attendance.state).toBe('checked_in');
  });

  it('parses the canonical series resource', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: eventSeriesFixture });

    const result = await getEventSeries(12);

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/series/12', undefined, contractOptions);
    expect(result.data.occurrences[0].id).toBe(101);
  });

  it('parses dynamic event categories including legacy plural type rows', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ id: 4, name: 'Workshops', slug: 'workshops', color: '#2563eb', type: 'events' }],
    });

    const result = await getEventCategories();

    expect(api.get).toHaveBeenCalledWith('/api/v2/categories', { type: 'event' }, contractOptions);
    expect(result.data[0].slug).toBe('workshops');
  });
});

describe('bounded mobile attendance operations', () => {
  const attendancePerson = {
    member: { id: 44, display_name: 'Taylor Member', avatar_url: null },
    registration: { state: 'confirmed' as const },
    attendance: {
      id: null,
      state: 'not_checked_in' as const,
      version: null,
      changed_at: null,
      checked_in_at: null,
      checked_out_at: null,
    },
    management_actions: {
      check_in: true,
      check_out: false,
      no_show: true,
      undo_attendance: false,
      idempotency_key_required: true as const,
    },
    privacy: { projection: 'attendance' as const, sensitive_fields_redacted: true as const },
  };
  const attendanceMeta = {
    base_url: 'https://test.api',
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
    sort: 'name' as const,
    direction: 'asc' as const,
    sensitive_fields_redacted: true as const,
    projection: 'attendance' as const,
    capabilities: {
      view_roster: true as const,
      view_waitlist: false,
      manage_registration: false,
      manage_attendance: true as const,
      export_people: false,
      view_history: true,
    },
    metrics: { confirmed: 1, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
  };

  it('strictly parses the redacted projection and sends only bounded query fields', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [attendancePerson], meta: attendanceMeta });

    const result = await getEventAttendanceRoster(101, {
      page: 2,
      search: ' Taylor ',
      attendanceState: 'not_checked_in',
    });

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/people', {
      page: '2',
      per_page: '25',
      sort: 'name',
      direction: 'asc',
      search: 'Taylor',
      attendance_state: 'not_checked_in',
    }, contractOptions);
    expect(result.meta.projection).toBe('attendance');
    expect(result.data[0].member.display_name).toBe('Taylor Member');
  });

  it('rejects accidental sensitive fields in the mobile roster contract', () => {
    const parsed = eventAttendanceRosterResponseSchema.safeParse({
      data: [{ ...attendancePerson, member: { ...attendancePerson.member, email: 'private@example.test' } }],
      meta: attendanceMeta,
    });

    expect(parsed.success).toBe(false);
  });

  it('binds the caller-stable idempotency key to both attendance request locations', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        member: { id: 44, display_name: 'Taylor Member' },
        mutation: {
          attendance_id: 501,
          event_id: 101,
          user_id: 44,
          action: 'check_in',
          from_state: 'not_checked_in',
          to_state: 'checked_in',
          changed: true,
          idempotent_replay: false,
          attendance_version: 1,
          changed_at: '2030-06-01T10:00:00Z',
          checked_in_at: '2030-06-01T10:00:00Z',
          checked_out_at: null,
          history_entry_id: 700,
        },
      },
      meta: { base_url: 'https://test.api' },
    });

    const result = await transitionEventAttendance(101, 44, {
      action: 'check_in',
      expectedVersion: 0,
      idempotencyKey: 'mobile-attendance-stable-1',
    });

    expect(result.data.mutation.attendance_version).toBe(1);
    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/101/people/44/attendance',
      {
        action: 'check_in',
        expected_version: 0,
        idempotency_key: 'mobile-attendance-stable-1',
      },
      {
        headers: {
          ...contractOptions.headers,
          'Idempotency-Key': 'mobile-attendance-stable-1',
        },
      },
    );
  });

  /**
   * 🔴 Every manual event check-in reported failure while succeeding, and this suite
   * stayed green throughout — because the fixture above was written from the schema
   * rather than from the server.
   *
   * `EventAttendanceTransitionResult::toArray()` has always returned `credit_status`.
   * The `mutation` object is `.strict()` and did not declare it, so `parseContract`
   * threw `EVENTS_CONTRACT_DRIFT` (a 422) AFTER the server had committed the
   * transition. Measured on a device 2026-08-23: the attendance row landed
   * (`checked_in`, version 1), the RSVP moved to `attended`, and the organiser saw
   * "Attendance not updated" over a roster still reading "Not checked in".
   *
   * So this test sends the payload the server actually sends. A fixture that omits a
   * field the server always includes cannot detect the failure it is there to prevent.
   */
  it('accepts the credit_status the server always sends with an attendance transition', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        member: { id: 44, display_name: 'Taylor Member' },
        mutation: {
          attendance_id: 501,
          event_id: 101,
          user_id: 44,
          action: 'check_in',
          from_state: 'not_checked_in',
          to_state: 'checked_in',
          changed: true,
          idempotent_replay: false,
          attendance_version: 1,
          changed_at: '2030-06-01T10:00:00Z',
          checked_in_at: '2030-06-01T10:00:00Z',
          checked_out_at: null,
          history_entry_id: 700,
          // 'disabled' when the community awards no credit for attendance; otherwise one
          // of EventCreditService::SETTLED_STATUSES.
          credit_status: 'disabled',
        },
      },
      meta: { base_url: 'https://test.api' },
    });

    const result = await transitionEventAttendance(101, 44, {
      action: 'check_in',
      expectedVersion: 0,
      idempotencyKey: 'mobile-attendance-credit-1',
    });

    expect(result.data.mutation.to_state).toBe('checked_in');
    expect(result.data.mutation.credit_status).toBe('disabled');
  });

  it('still accepts a settled credit status, so a new one cannot break check-in again', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        member: { id: 44, display_name: 'Taylor Member' },
        mutation: {
          attendance_id: 502,
          event_id: 101,
          user_id: 44,
          action: 'check_out',
          from_state: 'checked_in',
          to_state: 'checked_out',
          changed: true,
          idempotent_replay: false,
          attendance_version: 2,
          changed_at: '2030-06-01T12:00:00Z',
          checked_in_at: '2030-06-01T10:00:00Z',
          checked_out_at: '2030-06-01T12:00:00Z',
          history_entry_id: 701,
          credit_status: 'settled',
        },
      },
      meta: { base_url: 'https://test.api' },
    });

    const result = await transitionEventAttendance(101, 44, {
      action: 'check_out',
      expectedVersion: 1,
      idempotencyKey: 'mobile-attendance-credit-2',
    });

    expect(result.data.mutation.credit_status).toBe('settled');
  });
});

describe('remaining Events calls', () => {
  it('accepts a waitlist offer with a caller-stable idempotency key', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        relationship: {
          registration: { state: 'confirmed' },
          waitlist: { state: 'accepted', position: 1, offer_active: false },
        },
        mutation: {
          changed: true,
          idempotent_replay: false,
          history_entry_id: 901,
          next_offer_created: false,
        },
      },
    });

    const result = await acceptEventWaitlistOffer(101, 'mobile-accept-offer-1');

    expect(result.data.relationship.registration.state).toBe('confirmed');
    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/101/registration/waitlist/accept',
      {},
      {
        headers: {
          ...contractOptions.headers,
          'Idempotency-Key': 'mobile-accept-offer-1',
        },
      },
    );
  });

  it('negotiates check-in, waitlist, RSVP removal, and reminders', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { checked_in: true, attendee_id: 44, event_id: 101, credit_status: 'disabled', hours_credited: null } })
      .mockResolvedValueOnce({ data: { waitlisted: true, position: 3 } });
    (api.delete as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ data: reminderPreferencesFixture });
    (api.get as jest.Mock).mockResolvedValue({ data: reminderPreferencesFixture });
    (api.put as jest.Mock).mockResolvedValue({ data: reminderPreferencesFixture });

    await checkInEventAttendee(101, 44);
    await joinEventWaitlist(101);
    await leaveEventWaitlist(101);
    await removeRsvp(101);
    await getEventReminders(101);
    await updateEventReminders(101, {
      expected_revision: 3,
      overrides: reminderPreferencesFixture.overrides,
      rules: reminderPreferencesFixture.rules,
    });
    await deleteEventReminders(101, 3);

    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/events/101/attendees/44/check-in', undefined, contractOptions);
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/events/101/waitlist', undefined, contractOptions);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/events/101/waitlist', contractOptions);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/events/101/rsvp', contractOptions);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/reminders', undefined, contractOptions);
    expect(api.put).toHaveBeenCalledWith('/api/v2/events/101/reminders', {
      expected_revision: 3,
      overrides: reminderPreferencesFixture.overrides,
      rules: reminderPreferencesFixture.rules,
    }, contractOptions);
    expect(api.delete).toHaveBeenCalledWith('/api/v2/events/101/reminders?expected_revision=3', contractOptions);
  });

  it('leaves non-Events poll endpoints on their own contract', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 5, question: 'Which time?', options: [] } });

    await getEventPolls(101);
    await voteEventPoll(5, 9);

    expect(api.get).toHaveBeenCalledWith('/api/v2/polls', {
      event_id: '101',
      status: 'all',
      per_page: '50',
    });
    expect(api.post).toHaveBeenCalledWith('/api/v2/polls/5/vote', { option_id: 9 });
  });
});
