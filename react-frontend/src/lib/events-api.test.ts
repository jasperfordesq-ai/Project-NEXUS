// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock, logErrorMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
  },
  logErrorMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/logger', () => ({ logError: logErrorMock }));

import {
  EVENTS_CONTRACT_HEADER,
  EVENTS_CONTRACT_VERSION,
  eventAgendaSchema,
  eventRegistrationResponseSchema,
  eventRosterMemberSchema,
  eventSchema,
  eventSeriesSchema,
  eventsApi,
} from './events-api';
import eventDetailFixture from '../../../contracts/events/v2/event-detail.json';
import eventAgendaFixture from '../../../contracts/events/v2/event-agenda.json';
import eventListResponseFixture from '../../../contracts/events/v2/event-list-response.json';
import eventRegistrationFixture from '../../../contracts/events/v2/event-registration.json';
import eventRosterItemFixture from '../../../contracts/events/v2/event-roster-item.json';
import eventSeriesFixture from '../../../contracts/events/v2/event-series.json';

function canonicalEvent(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 2,
    id: 101,
    title: 'Community repair morning',
    description: 'Bring an item.',
    primary_image: null,
    organizer: {
      id: 7,
      display_name: 'Alex Morgan',
      avatar_url: null,
      relationship: 'member',
      actions: { view_profile: true, message: false },
    },
    category: { id: 4, name: 'Workshops', slug: 'workshops', colour: '#2563eb' },
    location: { label: 'Community Hall', latitude: 53.3, longitude: -6.2, mode: 'hybrid' },
    schedule: {
      start_at: '2030-05-01T10:15:00+00:00',
      end_at: '2030-05-01T12:00:00+00:00',
      timezone: 'UTC',
      all_day: false,
      state: 'upcoming',
      publication_state: 'published',
      operational_state: 'scheduled',
      lifecycle_version: 1,
      cancellation_reason: null,
    },
    relationship: {
      engagement: { state: 'none', can_change: true },
      registration: {
        state: 'none',
        waitlist_position: null,
        can_register: true,
        can_withdraw: false,
        can_join_waitlist: false,
        can_leave_waitlist: false,
      },
      attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
      capacity: { limit: 20, confirmed: 8, remaining: 12, is_full: false, waitlist_count: 0 },
    },
    online_access: {
      mode: 'hybrid',
      reveal_state: 'restricted',
      join_url: null,
      video_url: null,
      reveal_at: '2030-05-01T09:45:00+00:00',
      expires_at: '2030-05-01T14:00:00+00:00',
    },
    series: { named: null, recurrence: null },
    permissions: {
      edit: false,
      cancel: false,
      manage_people: false,
      check_in: false,
      message: false,
      export: false,
      publish: false,
      submit_for_review: false,
      manage_agenda: false,
      manage_staff: false,
      manage_registration: false,
      broadcast: false,
      manage_finance: false,
      reconcile_credits: false,
      reconcile_tickets: false,
      transfer_ownership: false,
    },
    metrics: { confirmed_count: 8, interested_count: 2, waitlist_count: 0 },
    created_at: '2030-04-01T08:00:00+00:00',
    updated_at: null,
    group: null,
    ...overrides,
  };
}

function canonicalStaffAssignment() {
  return {
    id: 501,
    event_id: 101,
    member: {
      id: 44,
      name: 'Sam Lee',
      first_name: 'Sam',
      last_name: 'Lee',
      avatar_url: null,
    },
    role: 'check_in_staff',
    capabilities: ['view', 'viewRoster', 'manageAttendance'],
    status: 'active',
    effective: true,
    version: 1,
    granted_at: '2030-04-01T08:00:00+00:00',
    granted_by_user_id: 7,
    revoked_at: null,
    revoked_by_user_id: null,
    expires_at: null,
    history_metadata: {
      immutable: true,
      entry_count: 1,
      latest_entry_id: 900,
      latest_version: 1,
    },
    history: [{
      id: 900,
      version: 1,
      action: 'granted',
      from_status: null,
      to_status: 'active',
      previous_expires_at: null,
      new_expires_at: null,
      actor_user_id: 7,
      idempotency_key: 'grant-501',
      metadata: { schema_version: 1 },
      created_at: '2030-04-01T08:00:00+00:00',
      immutable: true,
    }],
    created_at: '2030-04-01T08:00:00+00:00',
    updated_at: '2030-04-01T08:00:00+00:00',
  };
}

function reminderPreferences() {
  return {
    revision: 4,
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
      id: 11,
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
      channel_sources: { email: 'event', in_app: 'event' },
      cadence: 'instant' as const,
      cadence_source: 'event',
      reminders_enabled: true,
      reminders_source: 'event',
    },
    limits: {
      minimum_offset_minutes: 5,
      maximum_offset_minutes: 525_600,
      maximum_rules: 10,
      default_offsets_minutes: [10_080, 1_440, 60],
    },
    capabilities: { independent_channels: true, diagnostics_supported: false },
  };
}

describe('Events v2 API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('negotiates contract 2 and validates event lists at runtime', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: [canonicalEvent()] });

    const response = await eventsApi.list({ when: 'upcoming', category_id: 4 });

    expect(response.success).toBe(true);
    expect(response.data?.[0]?.schedule.state).toBe('upcoming');
    const [endpoint, options] = apiMock.get.mock.calls[0];
    expect(endpoint).toBe('/v2/events?when=upcoming&category_id=4');
    expect(new Headers(options.headers).get(EVENTS_CONTRACT_HEADER)).toBe(String(EVENTS_CONTRACT_VERSION));
  });

  it('strictly validates the authoritative recurrence capability contract', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
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

    const response = await eventsApi.recurrenceCapabilities();

    expect(response.success).toBe(true);
    expect(response.data?.max_occurrences).toBe(52);
    expect(response.data?.supports_effective_revisions).toBe(false);
    const [endpoint, options] = apiMock.get.mock.calls[0];
    expect(endpoint).toBe('/v2/events/recurrence-capabilities');
    expect(new Headers(options.headers).get(EVENTS_CONTRACT_HEADER)).toBe('2');
  });

  it('submits and publishes using the unchanged strict canonical Event envelope', async () => {
    const pending = canonicalEvent();
    pending.schedule = {
      ...pending.schedule,
      state: 'pending_review',
      publication_state: 'pending_review',
    };
    apiMock.post
      .mockResolvedValueOnce({ success: true, data: pending })
      .mockResolvedValueOnce({ success: true, data: canonicalEvent() });

    const submitted = await eventsApi.submitForReview(101);
    const published = await eventsApi.publish(101);

    expect(submitted.success).toBe(true);
    expect(submitted.data?.schedule.publication_state).toBe('pending_review');
    expect(published.success).toBe(true);
    expect(apiMock.post).toHaveBeenNthCalledWith(1, '/v2/events/101/submit', {}, expect.any(Object));
    expect(apiMock.post).toHaveBeenNthCalledWith(2, '/v2/events/101/publish', {}, expect.any(Object));
  });

  it('sends explicit recurrence scope with a cover image upload', async () => {
    apiMock.upload.mockResolvedValue({ success: true, data: { image_url: '/uploads/events/cover.jpg' } });
    const formData = new FormData();

    const response = await eventsApi.uploadCover(101, formData, 'all');

    expect(response).toMatchObject({ success: true, data: { image_url: '/uploads/events/cover.jpg' } });
    expect(apiMock.upload).toHaveBeenCalledWith(
      '/v2/events/101/image?scope=all',
      formData,
      'image',
      expect.any(Object),
    );
  });

  it('previews and commits effective-dated recurrence revisions with a stable idempotency key', async () => {
    const patch = { title: 'Updated workshop', local_start_time: '11:30', timezone: 'Europe/Dublin' };
    const impact = {
      affected_event_ids: [101, 102],
      affected_count: 2,
      changed_event_ids: [101, 102],
      changed_count: 2,
      moved_occurrences: [],
      created_occurrences: [],
      retired_occurrences: [],
      registrations_count: 4,
      waitlist_count: 1,
      ticket_count: 0,
      reminder_count: 3,
      unique_recipient_count: 4,
      customized_exception_conflicts: [],
      blocking_conflicts: [],
    };
    apiMock.post
      .mockResolvedValueOnce({
        success: true,
        data: {
          preview_token: 'private-preview-token',
          preview_expires_at: '2030-04-01T08:05:00Z',
          scope: 'this_and_future',
          selected_event_id: 101,
          root_event_id: 99,
          effective_from_utc: '2030-05-01 10:15:00',
          can_commit: true,
          impact,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          revision_id: 7,
          root_event_id: 99,
          revision_version: 2,
          effective_from_utc: '2030-05-01 10:15:00',
          changed_event_ids: [101, 102],
          changed_count: 2,
          notification_recipient_count: 4,
          notification_outbox_id: 501,
          idempotent_replay: false,
          created_at: '2030-04-01T08:00:00Z',
        },
      });

    const preview = await eventsApi.previewRecurrenceRevision(101, patch);
    const committed = await eventsApi.commitRecurrenceRevision(
      101,
      patch,
      preview.data!.preview_token,
      'web-recurrence-revision-1',
    );

    expect(preview.data?.impact.changed_count).toBe(2);
    expect(committed.data?.revision_version).toBe(2);
    expect(apiMock.post).toHaveBeenNthCalledWith(
      1,
      '/v2/events/101/recurrence-revisions/preview',
      { patch },
      expect.any(Object),
    );
    expect(apiMock.post).toHaveBeenNthCalledWith(
      2,
      '/v2/events/101/recurrence-revisions/commit',
      { patch, preview_token: 'private-preview-token' },
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const commitHeaders = new Headers(apiMock.post.mock.calls[1]?.[2]?.headers);
    expect(commitHeaders.get('Idempotency-Key')).toBe('web-recurrence-revision-1');
  });

  it('validates definition blueprint history, preview and commit with contracted idempotency', async () => {
    const sections = {
      agenda: true,
      ticket_types: true,
      registration: true,
      safety: true,
      staff: false,
    };
    const counts = { sessions: 2, ticket_types: 1, registration_settings: 1 };
    const historyItem = {
      blueprint_id: 41,
      blueprint_version: 2,
      schema_version: 1,
      effective_from_recurrence_id: '20300506T090000Z',
      source_event_id: 101,
      source_recurrence_id: '20300506T090000Z',
      selected_sections: sections,
      counts,
      manifest_hash: 'a'.repeat(64),
      captured_by_user_id: 7,
      created_at: '2030-04-01 08:00:00',
    };
    const preview = {
      preview_token: 'signed-private-preview-token',
      preview_expires_at: '2030-04-01T08:05:00+00:00',
      schema_version: 1,
      root_event_id: 99,
      source_event_id: 101,
      source_recurrence_id: '20300506T090000Z',
      effective_from_recurrence_id: '20300506T090000Z',
      selected_sections: sections,
      manifest_hash: 'a'.repeat(64),
      blueprint_set_version: 1,
      counts,
      conflicts: [],
      can_commit: true,
    };
    const commit = {
      blueprint_id: 42,
      blueprint_version: 3,
      schema_version: 1,
      root_event_id: 99,
      source_event_id: 101,
      source_recurrence_id: '20300506T090000Z',
      effective_from_recurrence_id: '20300506T090000Z',
      selected_sections: sections,
      manifest_hash: 'a'.repeat(64),
      counts,
      idempotent_replay: false,
      created_at: '2030-04-01 08:01:00',
    };
    apiMock.get.mockResolvedValueOnce({
      success: true,
      data: { items: [historyItem], next_before_version: 2 },
    });
    apiMock.post
      .mockResolvedValueOnce({ success: true, data: preview })
      .mockResolvedValueOnce({ success: true, data: commit });

    const history = await eventsApi.recurrenceDefinitionHistory(101, 10, 3);
    const reviewed = await eventsApi.previewRecurrenceDefinitions(
      101,
      '20300506T090000Z',
      sections,
    );
    const committed = await eventsApi.commitRecurrenceDefinitions(
      101,
      '20300506T090000Z',
      sections,
      reviewed.data!.preview_token,
      'web-definition-blueprint-1',
    );

    expect(history.data?.items[0]?.blueprint_version).toBe(2);
    expect(reviewed.data?.can_commit).toBe(true);
    expect(committed.data?.blueprint_version).toBe(3);
    expect(apiMock.get).toHaveBeenCalledWith(
      '/v2/events/101/recurrence-definition-blueprints?limit=10&before_version=3',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(apiMock.post).toHaveBeenNthCalledWith(
      1,
      '/v2/events/101/recurrence-definition-blueprints/preview',
      { effective_from_recurrence_id: '20300506T090000Z', sections },
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(apiMock.post).toHaveBeenNthCalledWith(
      2,
      '/v2/events/101/recurrence-definition-blueprints/commit',
      {
        effective_from_recurrence_id: '20300506T090000Z',
        sections,
        preview_token: 'signed-private-preview-token',
      },
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const historyHeaders = new Headers(apiMock.get.mock.calls[0]?.[1]?.headers);
    const previewHeaders = new Headers(apiMock.post.mock.calls[0]?.[2]?.headers);
    const commitHeaders = new Headers(apiMock.post.mock.calls[1]?.[2]?.headers);
    expect(historyHeaders.get(EVENTS_CONTRACT_HEADER)).toBe('2');
    expect(previewHeaders.get(EVENTS_CONTRACT_HEADER)).toBe('2');
    expect(commitHeaders.get(EVENTS_CONTRACT_HEADER)).toBe('2');
    expect(commitHeaders.get('Idempotency-Key')).toBe('web-definition-blueprint-1');
  });

  it('fails closed if a blueprint history response exposes manifest or staff identities', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: {
        items: [{
          blueprint_id: 41,
          blueprint_version: 2,
          schema_version: 1,
          effective_from_recurrence_id: '20300506T090000Z',
          source_event_id: 101,
          source_recurrence_id: '20300506T090000Z',
          selected_sections: {
            agenda: true,
            ticket_types: false,
            registration: false,
            safety: false,
            staff: false,
          },
          counts: { sessions: 1 },
          manifest_hash: 'a'.repeat(64),
          captured_by_user_id: 7,
          created_at: '2030-04-01 08:00:00',
          manifest: { private: true },
          staff_user_ids: [44],
        }],
        next_before_version: null,
      },
    });

    const response = await eventsApi.recurrenceDefinitionHistory(101);

    expect(response).toMatchObject({ success: false, code: 'EVENTS_CONTRACT_DRIFT' });
    expect(response.data).toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledWith(
      'Events contract drift',
      expect.objectContaining({ endpoint: expect.stringContaining('recurrence-definition-blueprints') }),
    );
  });

  it('normalizes canonical and legacy waitlist mutation responses', async () => {
    const event = canonicalEvent();
    apiMock.post
      .mockResolvedValueOnce({
        success: true,
        data: {
          contract_version: 2,
          event_id: 101,
          relationship: {
            ...event.relationship,
            registration: {
              ...event.relationship.registration,
              state: 'waitlisted',
              waitlist_position: 3,
              can_register: false,
              can_join_waitlist: false,
              can_leave_waitlist: true,
            },
          },
          metrics: { ...event.metrics, waitlist_count: 1 },
          status: null,
          rsvp_counts: { going: 8, interested: 2 },
          waitlist_position: 3,
          message: null,
        },
      })
      .mockResolvedValueOnce({ success: true, data: { waitlisted: true, position: 4 } });

    const canonical = await eventsApi.joinWaitlist(101);
    const legacy = await eventsApi.joinWaitlist(101);

    expect(canonical).toMatchObject({ success: true, data: { waitlisted: true, position: 3 } });
    expect(legacy).toMatchObject({ success: true, data: { waitlisted: true, position: 4 } });
    expect(apiMock.post).toHaveBeenNthCalledWith(1, '/v2/events/101/waitlist', {}, expect.any(Object));
    expect(new Headers(apiMock.post.mock.calls[0]?.[2]?.headers).get(EVENTS_CONTRACT_HEADER))
      .toBe(String(EVENTS_CONTRACT_VERSION));
  });

  it('validates versioned reminder preferences and sends reset revision in the query', async () => {
    const preferences = reminderPreferences();
    apiMock.get.mockResolvedValue({ success: true, data: preferences });
    apiMock.put.mockResolvedValue({ success: true, data: preferences });
    apiMock.delete.mockResolvedValue({ success: true, data: { ...preferences, revision: 0 } });

    const read = await eventsApi.reminders(101);
    const update = await eventsApi.updateReminders(101, {
      expected_revision: preferences.revision,
      overrides: preferences.overrides,
      rules: preferences.rules,
    });
    const reset = await eventsApi.deleteReminders(101, preferences.revision);

    expect(read.data?.revision).toBe(4);
    expect(update.data?.resolved.channels.fcm).toBe(true);
    expect(reset.data?.revision).toBe(0);
    expect(apiMock.get).toHaveBeenCalledWith('/v2/events/101/reminders', expect.any(Object));
    expect(apiMock.put).toHaveBeenCalledWith('/v2/events/101/reminders', {
      expected_revision: 4,
      overrides: preferences.overrides,
      rules: preferences.rules,
    }, expect.any(Object));
    expect(apiMock.delete).toHaveBeenCalledWith('/v2/events/101/reminders', expect.objectContaining({
      body: { expected_revision: 4 },
    }));
  });

  it('rejects legacy events instead of silently accepting an ambiguous payload', () => {
    expect(eventSchema.safeParse({ id: 101, title: 'Legacy event', start_date: '2030-05-01' }).success).toBe(false);
  });

  it('logs only endpoint, version, Zod paths and codes on contract drift', async () => {
    const privatePayload = canonicalEvent({
      id: 'private-member-value',
      description: 'private attendee and location details',
    });
    apiMock.get.mockResolvedValue({ success: true, data: privatePayload });

    const response = await eventsApi.get(101);

    expect(response).toMatchObject({ success: false, code: 'EVENTS_CONTRACT_DRIFT' });
    expect(response.error).toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith('Events contract drift', {
      endpoint: '/v2/events/101',
      version: 2,
      issues: expect.arrayContaining([{ path: 'id', code: 'invalid_type' }]),
    });

    const diagnostic = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(diagnostic).not.toContain('private-member-value');
    expect(diagnostic).not.toContain('private attendee and location details');
    expect(diagnostic).not.toContain('Invalid input');
    expect(diagnostic).not.toContain('expected number');
  });

  it('accepts both singular and legacy plural event category types', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: [{ id: 4, name: 'Workshops', slug: 'workshops', color: null, type: 'events' }],
    });

    const response = await eventsApi.categories();

    expect(response.success).toBe(true);
    expect(response.data?.[0]?.id).toBe(4);
  });

  it('validates registration, roster and series resources', () => {
    const relationship = canonicalEvent().relationship;
    expect(eventRegistrationResponseSchema.safeParse({
      contract_version: 2,
      event_id: 101,
      relationship,
      metrics: { confirmed_count: 9, interested_count: 2, waitlist_count: 0 },
      status: 'going',
      rsvp_counts: { going: 9, interested: 2 },
      waitlist_position: null,
      message: null,
    }).success).toBe(true);

    expect(eventRosterMemberSchema.safeParse({
      contract_version: 2,
      member: { id: 44, display_name: 'Sam Lee', avatar_url: null },
      engagement: relationship.engagement,
      registration: { ...relationship.registration, state: 'confirmed' },
      attendance: relationship.attendance,
      registered_at: '2030-04-10T09:00:00+00:00',
    }).success).toBe(true);

    expect(eventSeriesSchema.safeParse({
      contract_version: 2,
      id: 12,
      title: 'Repair Together',
      description: null,
      event_count: 1,
      next_event_at: '2030-05-01T10:15:00+00:00',
      creator: 'Alex Morgan',
      created_at: null,
      occurrences: [{
        id: 101,
        title: 'Community repair morning',
        start_at: '2030-05-01T10:15:00+00:00',
        end_at: null,
        status: 'active',
        location_label: null,
      }],
    }).success).toBe(true);
  });

  it('parses every shared cross-client Events v2 fixture', () => {
    expect(eventSchema.safeParse(eventDetailFixture).success).toBe(true);
    expect(eventAgendaSchema.safeParse(eventAgendaFixture).success).toBe(true);
    expect(eventSchema.array().safeParse(eventListResponseFixture.data).success).toBe(true);
    expect(eventRegistrationResponseSchema.safeParse(eventRegistrationFixture).success).toBe(true);
    expect(eventRosterMemberSchema.safeParse(eventRosterItemFixture).success).toBe(true);
    expect(eventSeriesSchema.safeParse(eventSeriesFixture).success).toBe(true);
  });

  it('rejects agenda resource URLs that are not credential-free HTTPS', () => {
    const unsafeScheme = JSON.parse(JSON.stringify(eventAgendaFixture)) as {
      sessions: Array<{ resources: Array<{ url: string | null }> }>;
    };
    unsafeScheme.sessions[0]!.resources[0]!.url = 'http://events.example.test/slides';
    expect(eventAgendaSchema.safeParse(unsafeScheme).success).toBe(false);

    const embeddedCredentials = JSON.parse(JSON.stringify(eventAgendaFixture)) as typeof unsafeScheme;
    embeddedCredentials.sessions[0]!.resources[0]!.url = 'https://member:secret@events.example.test/slides';
    expect(eventAgendaSchema.safeParse(embeddedCredentials).success).toBe(false);
  });

  it('validates staff assignments and sends idempotency keys on grant and revoke', async () => {
    const assignment = canonicalStaffAssignment();
    const mutation = {
      assignment,
      changed: true,
      idempotent_replay: false,
      history_entry_id: 900,
    };
    apiMock.get.mockResolvedValueOnce({ success: true, data: [assignment] });
    apiMock.post.mockResolvedValueOnce({ success: true, data: mutation });
    apiMock.delete.mockResolvedValueOnce({ success: true, data: mutation });

    const list = await eventsApi.listStaff(101, true);
    const granted = await eventsApi.assignStaff(101, {
      user_id: 44,
      role: 'check_in_staff',
      expires_at: null,
    }, 'grant-request-1');
    const revoked = await eventsApi.revokeStaff(101, 501, 'revoke-request-1');

    expect(list.data?.[0]?.capabilities).toEqual(['view', 'viewRoster', 'manageAttendance']);
    expect(granted.data?.assignment.version).toBe(1);
    expect(revoked.data?.history_entry_id).toBe(900);
    expect(apiMock.get).toHaveBeenCalledWith(
      '/v2/events/101/staff?include_inactive=true',
      expect.any(Object),
    );
    const postOptions = apiMock.post.mock.calls[0]?.[2];
    const deleteOptions = apiMock.delete.mock.calls[0]?.[1];
    expect(new Headers(postOptions.headers).get('Idempotency-Key')).toBe('grant-request-1');
    expect(new Headers(deleteOptions.headers).get('Idempotency-Key')).toBe('revoke-request-1');
    expect(new Headers(postOptions.headers).get(EVENTS_CONTRACT_HEADER)).toBe('2');
  });

  it('validates agenda projections and sends versioned idempotent mutations', async () => {
    const agendaMutation = {
      session: eventAgendaFixture.sessions[0],
      agenda_version: 4,
      changed: true,
      idempotent_replay: false,
      history_entry_id: 902,
    };
    const registrationMutation = {
      session: eventAgendaFixture.sessions[0],
      registration_version: 3,
      changed: true,
      idempotent_replay: false,
      history_entry_id: 904,
    };
    apiMock.get.mockResolvedValueOnce({ success: true, data: eventAgendaFixture });
    apiMock.post
      .mockResolvedValueOnce({ success: true, data: agendaMutation })
      .mockResolvedValueOnce({ success: true, data: agendaMutation })
      .mockResolvedValueOnce({ success: true, data: registrationMutation })
      .mockResolvedValueOnce({ success: true, data: registrationMutation });
    apiMock.put
      .mockResolvedValueOnce({ success: true, data: agendaMutation })
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: eventAgendaFixture.sessions,
          agenda_version: 5,
          changed: true,
          idempotent_replay: false,
          history_entry_id: 903,
        },
      });

    const payload = {
      title: 'Repair skills workshop',
      description: null,
      session_type: 'workshop' as const,
      visibility: 'registered' as const,
      start_at: '2030-05-01T09:30:00Z',
      end_at: '2030-05-01T10:15:00Z',
      timezone: 'Europe/Dublin',
      track_name: 'Practical skills',
      room_name: 'Workshop room',
      capacity: 24,
      speakers: [{ display_name: 'Alex Morgan', role_label: 'Facilitator' }],
      resources: [{
        type: 'slides' as const,
        title: 'Workshop slides',
        url: 'https://events.example.test/resources/workshop-slides',
        visibility: 'registered' as const,
      }],
    };
    const listed = await eventsApi.agenda(101, true);
    const created = await eventsApi.createAgendaSession(101, payload, 'agenda-create-1');
    const updated = await eventsApi.updateAgendaSession(101, 501, 2, payload, 'agenda-update-1');
    const cancelled = await eventsApi.cancelAgendaSession(101, 501, 2, 'Speaker unavailable', 'agenda-cancel-1');
    const reordered = await eventsApi.reorderAgendaSessions(101, [501], 4, 'agenda-reorder-1');
    const registered = await eventsApi.registerAgendaSession(101, 501, 2, 'agenda-register-1');
    const withdrawn = await eventsApi.withdrawAgendaSession(101, 501, 3, 'agenda-withdraw-1');

    expect(listed.data?.sessions[0]?.speakers[0]?.display_name).toBe('Alex Morgan');
    expect(created.data?.history_entry_id).toBe(902);
    expect(updated.data?.session.version).toBe(2);
    expect(cancelled.data?.changed).toBe(true);
    expect(reordered.data?.agenda_version).toBe(5);
    expect(registered.data?.registration_version).toBe(3);
    expect(withdrawn.data?.history_entry_id).toBe(904);
    expect(apiMock.get).toHaveBeenCalledWith('/v2/events/101/agenda?include_cancelled=true', expect.any(Object));
    expect(apiMock.post.mock.calls[0]?.[0]).toBe('/v2/events/101/agenda/sessions');
    expect(new Headers(apiMock.post.mock.calls[0]?.[2].headers).get('Idempotency-Key')).toBe('agenda-create-1');
    expect(apiMock.post.mock.calls[1]?.[1]).toEqual({ expected_version: 2, reason: 'Speaker unavailable' });
    expect(apiMock.post.mock.calls[2]?.[0]).toBe('/v2/events/101/agenda/sessions/501/registration');
    expect(apiMock.post.mock.calls[2]?.[1]).toEqual({ expected_version: 2 });
    expect(apiMock.post.mock.calls[3]?.[0]).toBe('/v2/events/101/agenda/sessions/501/registration/withdraw');
    expect(apiMock.post.mock.calls[3]?.[1]).toEqual({ expected_version: 3 });
    expect(apiMock.put.mock.calls[0]?.[1]).toEqual({ ...payload, expected_version: 2 });
    expect(new Headers(apiMock.put.mock.calls[1]?.[2].headers).get('Idempotency-Key')).toBe('agenda-reorder-1');
  });

  it('uses the maintained member directory for server-backed staff search', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: [{ id: 44, name: 'Sam Lee', first_name: 'Sam', avatar: null }],
    });

    const response = await eventsApi.searchMembers('  Sam  ');

    expect(response.data?.[0]?.id).toBe(44);
    expect(apiMock.get).toHaveBeenCalledWith('/v2/users?q=Sam&limit=10', undefined);
  });

  it('parses archive-first lifecycle responses and sends stable mutation evidence', async () => {
    apiMock.delete.mockResolvedValueOnce({
      success: true,
      data: {
        action: 'archive',
        requested_action: 'delete',
        outcome: 'archived',
        event_id: 101,
        changed: true,
        replayed: false,
        idempotent_replay: false,
        archived: true,
        already_archived: false,
        deleted: false,
        publication_status: 'archived',
        operational_status: 'cancelled',
        lifecycle_version: 2,
        reason: 'Programme complete',
      },
    });

    const response = await eventsApi.archive(101, 'archive-request-1', ' Programme complete ');

    expect(response.data?.deleted).toBe(false);
    const options = apiMock.delete.mock.calls[0]?.[1];
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('archive-request-1');
    expect(options.body).toEqual({ reason: 'Programme complete' });
  });

  it('requires callers to attach an idempotency key to cancellation', async () => {
    apiMock.post.mockResolvedValueOnce({
      success: true,
      data: { cancelled: true, event_id: 101, reason: 'Venue unavailable' },
    });

    const response = await eventsApi.cancel(101, 'Venue unavailable', 'cancel-request-1');

    expect(response.data?.cancelled).toBe(true);
    const options = apiMock.post.mock.calls[0]?.[2];
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('cancel-request-1');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/v2/events/101/cancel',
      { reason: 'Venue unavailable' },
      expect.any(Object),
    );
  });

  it('accepts a live waitlist offer through the canonical idempotent endpoint', async () => {
    apiMock.post.mockResolvedValueOnce({
      success: true,
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

    const response = await eventsApi.acceptWaitlistOffer(101, 'accept-offer-request-1');

    expect(response.data?.relationship.registration.state).toBe('confirmed');
    expect(response.data?.relationship.waitlist.state).toBe('accepted');
    const options = apiMock.post.mock.calls[0]?.[2];
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('accept-offer-request-1');
    expect(new Headers(options.headers).get(EVENTS_CONTRACT_HEADER)).toBe('2');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/v2/events/101/registration/waitlist/accept',
      {},
      expect.any(Object),
    );
  });

  it('validates the strict People projection and pagination capabilities', async () => {
    const person = {
      member: { id: 44, display_name: 'Sam Lee', avatar_url: null },
      engagement: { state: 'interested', consumes_capacity: false },
      registration: {
        id: 7,
        state: 'confirmed',
        version: 2,
        capacity_pool_key: 'event',
        allocation_key: null,
        changed_at: '2030-05-01T08:00:00Z',
        confirmed_at: '2030-05-01T08:00:00Z',
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
        reject: true,
        cancel: true,
        check_in: true,
        check_out: false,
        no_show: false,
        undo_attendance: false,
        idempotency_key_required: true,
      },
      privacy: { sensitive_fields_redacted: true },
    };
    const meta = {
      base_url: 'https://api.example.test',
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
      metrics: {
        confirmed: 1,
        waitlisted: 0,
        checked_in: 0,
        checked_out: 0,
        no_show: 0,
        attended: 0,
      },
      projection: 'full',
      sensitive_fields_redacted: true,
      capabilities: {
        view_roster: true,
        view_waitlist: true,
        manage_registration: true,
        manage_attendance: true,
        export_people: true,
        view_history: true,
      },
    };
    apiMock.get.mockResolvedValueOnce({ success: true, data: [person], meta });

    const response = await eventsApi.people(101, { page: 1, search: 'Sam' });

    expect(response.success).toBe(true);
    expect(response.meta?.projection).toBe('full');
    expect(response.data?.[0]?.member.id).toBe(44);
    expect(apiMock.get).toHaveBeenCalledWith(
      '/v2/events/101/people?page=1&search=Sam',
      expect.any(Object),
    );

    apiMock.get.mockResolvedValueOnce({
      success: true,
      data: [{ ...person, member: { ...person.member, email: 'private@example.test' } }],
      meta,
    });
    const drift = await eventsApi.people(101);
    expect(drift).toMatchObject({ success: false, code: 'EVENTS_CONTRACT_DRIFT' });
  });

  it('binds attendance idempotency in both the header and strict body', async () => {
    apiMock.post.mockResolvedValueOnce({
      success: true,
      data: {
        member: { id: 44, display_name: 'Sam Lee' },
        mutation: {
          attendance_id: 91,
          event_id: 101,
          user_id: 44,
          action: 'check_in',
          from_state: 'not_checked_in',
          to_state: 'checked_in',
          changed: true,
          idempotent_replay: false,
          attendance_version: 1,
          changed_at: '2030-05-01T10:00:00Z',
          checked_in_at: '2030-05-01T10:00:00Z',
          checked_out_at: null,
          history_entry_id: 700,
        },
      },
    });

    const payload = {
      action: 'check_in' as const,
      expected_version: 0,
      idempotency_key: 'attendance-request-1',
    };
    const response = await eventsApi.transitionAttendance(101, 44, payload);

    expect(response.data?.mutation.attendance_version).toBe(1);
    const options = apiMock.post.mock.calls[0]?.[2];
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('attendance-request-1');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/v2/events/101/people/44/attendance',
      payload,
      expect.any(Object),
    );
  });

  it('validates the identity-free calendar projection and exact URL-backed interval', async () => {
    apiMock.get.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 101,
        uid: 'stable@example.test',
        title: 'Safe calendar event',
        description: 'View event details: https://app.example.test/events/101',
        starts_at: '2030-05-01T10:15:00+01:00',
        ends_at: '2030-05-01T11:15:00+01:00',
        timezone: 'Europe/Dublin',
        all_day: false,
        operational_status: 'scheduled',
        calendar_status: 'confirmed',
        sequence: 3,
        updated_at: '2030-04-01T08:00:00+00:00',
        detail_url: 'https://app.example.test/events/101',
      }],
    });

    const response = await eventsApi.calendar('2030-05-01', '2030-06-01');

    expect(response.data?.[0]?.timezone).toBe('Europe/Dublin');
    expect(apiMock.get).toHaveBeenCalledWith(
      '/v2/events/calendar?from=2030-05-01&to=2030-06-01',
      expect.any(Object),
    );

    apiMock.get.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 101,
        uid: 'stable@example.test',
        title: 'Unsafe drift',
        description: 'Safe',
        starts_at: '2030-05-01',
        ends_at: '2030-05-02',
        timezone: 'UTC',
        all_day: true,
        operational_status: 'scheduled',
        calendar_status: 'confirmed',
        sequence: 0,
        updated_at: '2030-04-01T08:00:00Z',
        detail_url: null,
        location: 'Must be rejected',
      }],
    });
    expect((await eventsApi.calendar('2030-05-01', '2030-06-01')).success).toBe(false);
  });

  it('keeps feed secrets creation-only and downloads authenticated calendar files', async () => {
    const baseToken = {
      id: 1,
      label: 'Laptop',
      token_prefix: 'nxc_12345678',
      locale: 'en',
      created_at: '2030-04-01T08:00:00Z',
      last_used_at: null,
      revoked_at: null,
      active: true,
    };
    apiMock.post.mockResolvedValueOnce({
      success: true,
      data: {
        ...baseToken,
        secret: `nxc_${'a'.repeat(64)}`,
        feed_url: `https://api.example.test/api/v2/events/calendar/personal/tenant/nxc_${'a'.repeat(64)}.ics`,
      },
    });
    apiMock.get.mockResolvedValueOnce({ success: true, data: [baseToken] });
    apiMock.download.mockResolvedValue(new Blob(['calendar']));

    const created = await eventsApi.createCalendarFeedToken(' Laptop ');
    const listed = await eventsApi.calendarFeedTokens();
    await eventsApi.downloadEventCalendar(101);

    expect(created.data?.secret).toMatch(/^nxc_/);
    expect(listed.data?.[0]).not.toHaveProperty('secret');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/v2/events/calendar/feed-tokens',
      { label: 'Laptop' },
      expect.any(Object),
    );
    expect(apiMock.download).toHaveBeenCalledWith(
      '/v2/events/101/calendar.ics',
      expect.objectContaining({ filename: 'event-101.ics' }),
    );
  });
});
