// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Runtime-validated boundary for the negotiated Events v2 contract.
 *
 * Event screens must use this module instead of calling `/v2/events` directly.
 * Keeping negotiation and validation here prevents individual screens from
 * silently drifting back to the legacy, ambiguous event payload.
 */

import { z } from 'zod';
import { api, type ApiResponse, type RequestOptions } from '@/lib/api';
import { logError } from '@/lib/logger';

export const EVENTS_CONTRACT_VERSION = 2 as const;
export const EVENTS_CONTRACT_HEADER = 'X-Events-Contract' as const;

const nullableString = z.string().nullable();

export const eventEngagementSchema = z.object({
  state: z.enum(['none', 'interested']),
  can_change: z.boolean(),
});

export const eventRegistrationStateSchema = z.enum([
  'none',
  'invited',
  'pending',
  'confirmed',
  'waitlisted',
  'offered',
  'declined',
  'cancelled',
]);

export const eventRegistrationSchema = z.object({
  state: eventRegistrationStateSchema,
  waitlist_position: z.number().int().nonnegative().nullable(),
  can_register: z.boolean(),
  can_withdraw: z.boolean(),
  can_join_waitlist: z.boolean(),
  can_leave_waitlist: z.boolean(),
});

export const eventAttendanceSchema = z.object({
  state: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']),
  checked_in_at: nullableString,
  checked_out_at: nullableString,
});

export const eventCapacitySchema = z.object({
  limit: z.number().int().nonnegative().nullable(),
  confirmed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(),
  is_full: z.boolean(),
  waitlist_count: z.number().int().nonnegative(),
});

export const eventRelationshipSchema = z.object({
  engagement: eventEngagementSchema,
  registration: eventRegistrationSchema,
  attendance: eventAttendanceSchema,
  capacity: eventCapacitySchema,
});

export const eventMetricsSchema = z.object({
  confirmed_count: z.number().int().nonnegative(),
  interested_count: z.number().int().nonnegative(),
  waitlist_count: z.number().int().nonnegative(),
});

export const eventVenueAccessibilitySchema = z.object({
  schema_version: z.literal(1),
  provided: z.boolean(),
  step_free_access: z.boolean().nullable(),
  accessible_toilet: z.boolean().nullable(),
  hearing_loop: z.boolean().nullable(),
  quiet_space: z.boolean().nullable(),
  seating_available: z.boolean().nullable(),
  accessible_parking: z.boolean().nullable(),
  parking_details: nullableString,
  transit_details: nullableString,
  assistance_contact: nullableString,
  notes: nullableString,
});

const eventReminderChannelsSchema = z.object({
  email: z.boolean(),
  in_app: z.boolean(),
  web_push: z.boolean(),
  fcm: z.boolean(),
  realtime: z.boolean(),
});

const eventReminderOverrideSchema = z.object({
  email_enabled: z.boolean().nullable(),
  in_app_enabled: z.boolean().nullable(),
  web_push_enabled: z.boolean().nullable(),
  fcm_enabled: z.boolean().nullable(),
  realtime_enabled: z.boolean().nullable(),
  cadence: z.enum(['instant', 'daily', 'monthly', 'off']).nullable(),
  reminders_enabled: z.boolean().nullable(),
});

export const eventReminderRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  offset_minutes: z.number().int().positive(),
  enabled: z.boolean(),
  rule_version: z.number().int().nonnegative().optional(),
  email_enabled: z.boolean().nullable(),
  in_app_enabled: z.boolean().nullable(),
  web_push_enabled: z.boolean().nullable(),
  fcm_enabled: z.boolean().nullable(),
  realtime_enabled: z.boolean().nullable(),
});

export const eventReminderPreferencesSchema = z.object({
  revision: z.number().int().nonnegative(),
  overrides: eventReminderOverrideSchema,
  rules: z.array(eventReminderRuleSchema),
  resolved: z.object({
    channels: eventReminderChannelsSchema,
    channel_sources: z.record(z.string(), z.string()),
    cadence: z.enum(['instant', 'daily', 'monthly', 'off']),
    cadence_source: z.string(),
    reminders_enabled: z.boolean(),
    reminders_source: z.string(),
  }),
  limits: z.object({
    minimum_offset_minutes: z.number().int().positive(),
    maximum_offset_minutes: z.number().int().positive(),
    maximum_rules: z.number().int().positive(),
    default_offsets_minutes: z.array(z.number().int().positive()),
  }),
  capabilities: z.object({
    independent_channels: z.boolean(),
    diagnostics_supported: z.boolean(),
  }),
});

export type EventReminderRule = z.infer<typeof eventReminderRuleSchema>;
export type EventReminderPreferences = z.infer<typeof eventReminderPreferencesSchema>;
export type EventReminderUpdate = {
  expected_revision: number;
  overrides: z.infer<typeof eventReminderOverrideSchema>;
  rules: Array<Pick<EventReminderRule, 'offset_minutes' | 'enabled' | 'email_enabled' | 'in_app_enabled' | 'web_push_enabled' | 'fcm_enabled' | 'realtime_enabled'>>;
};

const eventSeriesOccurrenceSchema = z.object({
  id: z.number().int().nonnegative(),
  start_at: nullableString,
  date: nullableString,
});

export const eventSchema = z.object({
  contract_version: z.literal(EVENTS_CONTRACT_VERSION),
  id: z.number().int().positive(),
  title: z.string(),
  description: nullableString,
  primary_image: z.object({
    url: z.string(),
    alt_text: z.string(),
  }).nullable(),
  organizer: z.object({
    id: z.number().int().nonnegative(),
    display_name: nullableString,
    avatar_url: nullableString,
    relationship: z.enum(['self', 'member']),
    actions: z.object({
      view_profile: z.boolean(),
      message: z.boolean(),
    }),
  }),
  category: z.object({
    id: z.number().int().positive().nullable(),
    name: nullableString,
    slug: nullableString,
    colour: nullableString,
  }).nullable(),
  location: z.object({
    label: nullableString,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    mode: z.enum(['in_person', 'online', 'hybrid']),
    accessibility: eventVenueAccessibilitySchema.optional(),
  }),
  schedule: z.object({
    start_at: nullableString,
    end_at: nullableString,
    timezone: z.string(),
    all_day: z.boolean(),
    state: z.enum([
      'draft',
      'pending_review',
      'upcoming',
      'ongoing',
      'ended',
      'postponed',
      'cancelled',
      'completed',
      'archived',
    ]),
    publication_state: z.enum(['draft', 'pending_review', 'published', 'archived']),
    operational_state: z.enum(['scheduled', 'postponed', 'cancelled', 'completed']),
    lifecycle_version: z.number().int().nonnegative(),
    cancellation_reason: nullableString,
  }),
  relationship: eventRelationshipSchema,
  online_access: z.object({
    mode: z.enum(['in_person', 'online', 'hybrid']),
    reveal_state: z.enum([
      'not_applicable',
      'not_configured',
      'restricted',
      'scheduled',
      'available',
      'expired',
    ]),
    join_url: nullableString,
    video_url: nullableString,
    reveal_at: nullableString,
    expires_at: nullableString,
  }),
  series: z.object({
    named: z.object({
      id: z.number().int().positive().nullable(),
      title: nullableString,
      description: nullableString,
      event_count: z.number().int().nonnegative(),
    }).nullable(),
    recurrence: z.object({
      parent_event_id: z.number().int().positive().nullable(),
      root_event_id: z.number().int().nonnegative(),
      is_template: z.boolean(),
      frequency: nullableString,
      interval: z.number().int().positive(),
      rrule: nullableString,
      recurrence_id: z.string().regex(/^\d{8}T\d{6}Z$/).nullable(),
      engine: z.literal('sabre-vobject').nullable(),
      engine_version: z.literal('2').nullable(),
      occurrence_count: z.number().int().nonnegative(),
      occurrences: z.array(eventSeriesOccurrenceSchema),
    }).nullable(),
  }),
  permissions: z.object({
    edit: z.boolean(),
    cancel: z.boolean(),
    manage_people: z.boolean(),
    check_in: z.boolean(),
    message: z.boolean(),
    export: z.boolean(),
    publish: z.boolean(),
    submit_for_review: z.boolean(),
    manage_agenda: z.boolean(),
    manage_staff: z.boolean(),
    manage_registration: z.boolean(),
    broadcast: z.boolean(),
    manage_finance: z.boolean(),
    reconcile_credits: z.boolean(),
    reconcile_tickets: z.boolean(),
    transfer_ownership: z.boolean(),
  }),
  metrics: eventMetricsSchema,
  created_at: nullableString,
  updated_at: nullableString,
  group: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    slug: nullableString,
  }).nullable().optional(),
  distance_km: z.number().nonnegative().optional(),
  /** Present only when the event pays a treasury attendance reward. */
  attendance_credit_amount: z.number().positive().optional(),
}).passthrough();

export const eventRegistrationResponseSchema = z.object({
  contract_version: z.literal(EVENTS_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  relationship: eventRelationshipSchema,
  metrics: eventMetricsSchema,
  status: nullableString,
  rsvp_counts: z.object({
    going: z.number().int().nonnegative(),
    interested: z.number().int().nonnegative(),
  }),
  waitlist_position: z.number().int().nonnegative().nullable(),
  message: nullableString,
}).passthrough();

export const eventRosterMemberSchema = z.object({
  contract_version: z.literal(EVENTS_CONTRACT_VERSION),
  member: z.object({
    id: z.number().int().positive(),
    display_name: nullableString,
    avatar_url: nullableString,
  }),
  engagement: eventEngagementSchema,
  registration: eventRegistrationSchema,
  attendance: eventAttendanceSchema,
  registered_at: nullableString,
}).passthrough();

export const eventSeriesSchema = z.object({
  contract_version: z.literal(EVENTS_CONTRACT_VERSION),
  id: z.number().int().positive(),
  title: z.string(),
  description: nullableString,
  event_count: z.number().int().nonnegative(),
  next_event_at: nullableString,
  creator: nullableString,
  created_at: nullableString,
  occurrences: z.array(z.object({
    id: z.number().int().positive(),
    title: nullableString,
    start_at: nullableString,
    end_at: nullableString,
    status: z.string(),
    location_label: nullableString,
  })),
}).passthrough();

export const eventCategorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
  color: nullableString.optional(),
  type: z.enum(['event', 'events']).optional(),
}).passthrough();

export const eventStaffRoleSchema = z.enum([
  'co_organizer',
  'registration_manager',
  'communications_manager',
  'check_in_staff',
  'finance_manager',
]);

export const eventStaffCapabilitySchema = z.enum([
  'view',
  'viewMeetingLink',
  'viewRoster',
  'viewWaitlist',
  'manage',
  'manageStaff',
  'manageAttendance',
  'messagePeople',
  'exportPeople',
  'linkSeries',
  'manageRegistration',
  'broadcast',
  'manageFinance',
  'reconcileCredits',
  'reconcileTickets',
  'transferOwnership',
]);

const eventStaffHistoryEntrySchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  action: z.enum(['granted', 'revoked']),
  from_status: z.enum(['active', 'revoked']).nullable(),
  to_status: z.enum(['active', 'revoked']),
  previous_expires_at: nullableString,
  new_expires_at: nullableString,
  actor_user_id: z.number().int().positive(),
  idempotency_key: nullableString,
  metadata: z.record(z.string(), z.unknown()),
  created_at: nullableString,
  immutable: z.literal(true),
}).passthrough();

export const eventStaffAssignmentSchema = z.object({
  id: z.number().int().positive(),
  event_id: z.number().int().positive(),
  member: z.object({
    id: z.number().int().positive(),
    name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    avatar_url: nullableString,
  }),
  role: eventStaffRoleSchema,
  capabilities: z.array(eventStaffCapabilitySchema),
  status: z.enum(['active', 'revoked']),
  effective: z.boolean(),
  version: z.number().int().positive(),
  granted_at: nullableString,
  granted_by_user_id: z.number().int().positive(),
  revoked_at: nullableString,
  revoked_by_user_id: z.number().int().positive().nullable(),
  expires_at: nullableString,
  history_metadata: z.object({
    immutable: z.literal(true),
    entry_count: z.number().int().nonnegative(),
    latest_entry_id: z.number().int().positive().nullable(),
    latest_version: z.number().int().positive().nullable(),
  }),
  history: z.array(eventStaffHistoryEntrySchema),
  created_at: nullableString,
  updated_at: nullableString,
}).passthrough();

const eventStaffMutationResponseSchema = z.object({
  assignment: eventStaffAssignmentSchema,
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: z.number().int().positive().nullable(),
}).passthrough();

export const eventAgendaSpeakerSchema = z.object({
  kind: z.enum(['member', 'external']),
  member_id: z.number().int().positive().nullable(),
  display_name: nullableString,
  role: nullableString,
  position: z.number().int().nonnegative(),
}).passthrough();

const eventAgendaHttpsUrlSchema = z.string().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname !== ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
});

export const eventAgendaResourceSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(['link', 'document', 'slides', 'download', 'stream', 'recording']),
  title: z.string().min(1),
  visibility: z.enum(['public', 'registered', 'staff']),
  position: z.number().int().nonnegative(),
  protected: z.boolean(),
  available: z.boolean(),
  url: eventAgendaHttpsUrlSchema.nullable(),
}).passthrough();

export const eventAgendaSessionSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  title: z.string().min(1),
  description: nullableString,
  type: z.enum(['session', 'workshop', 'panel', 'keynote', 'break', 'networking', 'other']),
  visibility: z.enum(['public', 'registered', 'staff']),
  capacity: z.object({
    limit: z.number().int().positive().nullable(),
    registered: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative().nullable(),
    is_full: z.boolean(),
  }).strict(),
  registration: z.object({
    state: z.enum(['not_registered', 'registered', 'withdrawn', 'ineligible']),
    version: z.number().int().nonnegative(),
    can_register: z.boolean(),
    can_withdraw: z.boolean(),
  }).strict(),
  status: z.enum(['scheduled', 'cancelled']),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
  track: nullableString,
  room: nullableString,
  position: z.number().int().nonnegative(),
  cancellation_reason: nullableString,
  speakers: z.array(eventAgendaSpeakerSchema),
  resources: z.array(eventAgendaResourceSchema),
}).passthrough();

export const eventAgendaSchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  agenda_version: z.number().int().nonnegative(),
  timezone: z.string().min(1),
  permissions: z.object({
    manage: z.boolean(),
  }).strict(),
  sessions: z.array(eventAgendaSessionSchema),
}).passthrough();

const eventAgendaSessionMutationSchema = z.object({
  session: eventAgendaSessionSchema,
  agenda_version: z.number().int().nonnegative(),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: z.number().int().positive().nullable(),
}).passthrough();

const eventAgendaReorderMutationSchema = z.object({
  sessions: z.array(eventAgendaSessionSchema),
  agenda_version: z.number().int().nonnegative(),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: z.number().int().positive().nullable(),
}).passthrough();

const eventAgendaRegistrationMutationSchema = z.object({
  session: eventAgendaSessionSchema.nullable(),
  registration_version: z.number().int().nonnegative(),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: z.number().int().positive().nullable(),
}).passthrough();

export const eventMemberSearchResultSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
}).passthrough();

const checkInResponseSchema = z.object({
  checked_in: z.literal(true),
  attendee_id: z.number().int().positive(),
  event_id: z.number().int().positive(),
  credit_status: z.string(),
  hours_credited: z.number().nullable(),
}).passthrough();

const cancelResponseSchema = z.object({
  cancelled: z.literal(true),
  event_id: z.number().int().positive(),
  reason: z.string(),
}).passthrough();

export const eventArchiveResponseSchema = z.object({
  action: z.literal('archive'),
  requested_action: z.literal('delete'),
  outcome: z.enum(['archived', 'already_archived']),
  event_id: z.number().int().positive(),
  changed: z.boolean(),
  replayed: z.boolean(),
  idempotent_replay: z.boolean(),
  archived: z.literal(true),
  already_archived: z.boolean(),
  deleted: z.literal(false),
  publication_status: z.literal('archived'),
  operational_status: z.enum(['scheduled', 'postponed', 'cancelled', 'completed']),
  lifecycle_version: z.number().int().nonnegative(),
  reason: z.string().nullable(),
}).passthrough();

const legacyWaitlistResponseSchema = z.object({
  waitlisted: z.literal(true),
  position: z.number().int().nonnegative().nullable(),
}).passthrough();

const canonicalWaitlistResponseSchema = eventRegistrationResponseSchema
  .refine(
    (response) => response.relationship.registration.state === 'waitlisted',
    { path: ['relationship', 'registration', 'state'] },
  )
  .transform((response) => ({
    waitlisted: true as const,
    position: response.waitlist_position,
  }));

const waitlistResponseSchema = z.union([
  legacyWaitlistResponseSchema,
  canonicalWaitlistResponseSchema,
]);

export const eventWaitlistOfferAcceptanceResponseSchema = z.object({
  relationship: z.object({
    registration: z.object({
      state: z.literal('confirmed'),
    }).passthrough(),
    waitlist: z.object({
      state: z.literal('accepted'),
      position: z.number().int().nonnegative().nullable(),
      offer_active: z.literal(false),
    }).passthrough(),
  }).passthrough(),
  mutation: z.object({
    changed: z.boolean(),
    idempotent_replay: z.boolean(),
    history_entry_id: z.number().int().positive().nullable(),
    next_offer_created: z.boolean(),
  }).passthrough(),
}).passthrough();

const uploadResponseSchema = z.object({
  image_url: z.string(),
}).passthrough();

const recurringCreateResponseSchema = z.object({
  template: eventSchema,
  occurrences_created: z.number().int().nonnegative(),
});

export const eventRecurrenceCapabilitiesSchema = z.object({
  contract_version: z.literal(1),
  engine: z.enum(['legacy', 'v2']),
  structured_input: z.boolean(),
  supported_frequencies: z.array(z.enum(['daily', 'weekly', 'monthly', 'yearly'])),
  max_occurrences: z.number().int().min(1).max(5000),
  supported_end_types: z.array(z.enum(['after_count', 'on_date', 'never'])),
  supports_rolling_never: z.boolean(),
  supports_effective_revisions: z.boolean(),
  supports_definition_blueprints: z.boolean(),
  schema_ready: z.boolean(),
  rollout_state: z.enum(['legacy', 'v2_degraded', 'v2_finite', 'v2_rolling']),
}).strict();

const recurrenceIdentitySchema = z.string().regex(/^\d{8}T\d{6}Z$/);
export const eventRecurrenceDefinitionSectionSchema = z.enum([
  'agenda',
  'ticket_types',
  'registration',
  'safety',
  'staff',
]);
export const eventRecurrenceDefinitionSectionsSchema = z.object({
  agenda: z.boolean(),
  ticket_types: z.boolean(),
  registration: z.boolean(),
  safety: z.boolean(),
  staff: z.boolean(),
}).strict();
const eventRecurrenceDefinitionCountsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);
const eventRecurrenceDefinitionConflictSchema = z.object({
  section: eventRecurrenceDefinitionSectionSchema,
  code: z.string().min(1),
  count: z.number().int().positive(),
}).strict();

export const eventRecurrenceDefinitionHistoryItemSchema = z.object({
  blueprint_id: z.number().int().positive(),
  blueprint_version: z.number().int().positive(),
  schema_version: z.number().int().positive(),
  effective_from_recurrence_id: recurrenceIdentitySchema,
  source_event_id: z.number().int().positive(),
  source_recurrence_id: recurrenceIdentitySchema,
  selected_sections: eventRecurrenceDefinitionSectionsSchema,
  counts: eventRecurrenceDefinitionCountsSchema,
  manifest_hash: z.string().regex(/^[0-9a-f]{64}$/),
  captured_by_user_id: z.number().int().positive().nullable(),
  created_at: z.string().min(1),
}).strict();

export const eventRecurrenceDefinitionHistorySchema = z.object({
  items: z.array(eventRecurrenceDefinitionHistoryItemSchema),
  next_before_version: z.number().int().positive().nullable(),
}).strict();

export const eventRecurrenceDefinitionPreviewSchema = z.object({
  preview_token: z.string().min(1),
  preview_expires_at: z.string().min(1),
  schema_version: z.number().int().positive(),
  root_event_id: z.number().int().positive(),
  source_event_id: z.number().int().positive(),
  source_recurrence_id: recurrenceIdentitySchema,
  effective_from_recurrence_id: recurrenceIdentitySchema,
  selected_sections: eventRecurrenceDefinitionSectionsSchema,
  manifest_hash: z.string().regex(/^[0-9a-f]{64}$/),
  blueprint_set_version: z.number().int().nonnegative(),
  counts: eventRecurrenceDefinitionCountsSchema,
  conflicts: z.array(eventRecurrenceDefinitionConflictSchema),
  can_commit: z.boolean(),
}).strict();

export const eventRecurrenceDefinitionCommitSchema = z.object({
  blueprint_id: z.number().int().positive(),
  blueprint_version: z.number().int().positive(),
  schema_version: z.number().int().positive(),
  root_event_id: z.number().int().positive(),
  source_event_id: z.number().int().positive(),
  source_recurrence_id: recurrenceIdentitySchema,
  effective_from_recurrence_id: recurrenceIdentitySchema,
  selected_sections: eventRecurrenceDefinitionSectionsSchema,
  manifest_hash: z.string().regex(/^[0-9a-f]{64}$/),
  counts: eventRecurrenceDefinitionCountsSchema,
  idempotent_replay: z.boolean(),
  created_at: z.string().min(1),
}).strict();

export type EventRecurrenceDefinitionSection = z.infer<typeof eventRecurrenceDefinitionSectionSchema>;
export type EventRecurrenceDefinitionSections = z.infer<typeof eventRecurrenceDefinitionSectionsSchema>;
export type EventRecurrenceDefinitionHistoryItem = z.infer<typeof eventRecurrenceDefinitionHistoryItemSchema>;
export type EventRecurrenceDefinitionHistory = z.infer<typeof eventRecurrenceDefinitionHistorySchema>;
export type EventRecurrenceDefinitionPreview = z.infer<typeof eventRecurrenceDefinitionPreviewSchema>;
export type EventRecurrenceDefinitionCommit = z.infer<typeof eventRecurrenceDefinitionCommitSchema>;

const eventRecurrenceRevisionConflictSchema = z.object({
  code: z.string().min(1),
  event_id: z.number().int().positive().optional(),
  field: z.string().min(1).optional(),
}).passthrough();

const eventRecurrenceRevisionImpactSchema = z.object({
  affected_event_ids: z.array(z.number().int().positive()),
  affected_count: z.number().int().nonnegative(),
  changed_event_ids: z.array(z.number().int().positive()),
  changed_count: z.number().int().nonnegative(),
  moved_occurrences: z.array(z.object({
    event_id: z.number().int().positive(),
    occurrence_date: z.string(),
    from_start_utc: z.string(),
    from_end_utc: nullableString,
    to_start_utc: z.string(),
    to_end_utc: nullableString,
  }).passthrough()),
  created_occurrences: z.array(z.unknown()),
  retired_occurrences: z.array(z.unknown()),
  registrations_count: z.number().int().nonnegative(),
  waitlist_count: z.number().int().nonnegative(),
  ticket_count: z.number().int().nonnegative(),
  reminder_count: z.number().int().nonnegative(),
  unique_recipient_count: z.number().int().nonnegative(),
  customized_exception_conflicts: z.array(z.object({
    event_id: z.number().int().positive(),
    skipped_fields: z.array(z.string()),
  }).passthrough()),
  blocking_conflicts: z.array(eventRecurrenceRevisionConflictSchema),
}).passthrough();

const eventRecurrenceRevisionPreviewSchema = z.object({
  preview_token: z.string().min(1),
  preview_expires_at: z.string().min(1),
  scope: z.literal('this_and_future'),
  selected_event_id: z.number().int().positive(),
  root_event_id: z.number().int().positive(),
  effective_from_utc: z.string().min(1),
  can_commit: z.boolean(),
  impact: eventRecurrenceRevisionImpactSchema,
}).passthrough();

const eventRecurrenceRevisionCommitSchema = z.object({
  revision_id: z.number().int().positive(),
  root_event_id: z.number().int().positive(),
  revision_version: z.number().int().positive(),
  effective_from_utc: z.string().min(1),
  changed_event_ids: z.array(z.number().int().positive()),
  changed_count: z.number().int().nonnegative(),
  notification_recipient_count: z.number().int().nonnegative(),
  notification_outbox_id: z.number().int().positive().nullable(),
  idempotent_replay: z.boolean(),
  created_at: z.string().min(1),
}).passthrough();

export type EventRecurrenceRevisionPatch = Record<string, unknown>;
export type EventRecurrenceRevisionPreview = z.infer<typeof eventRecurrenceRevisionPreviewSchema>;
export type EventRecurrenceRevisionCommit = z.infer<typeof eventRecurrenceRevisionCommitSchema>;
export type EventRecurrenceCapabilities = z.infer<typeof eventRecurrenceCapabilitiesSchema>;

export const eventCalendarProjectionSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().min(1),
  title: z.string(),
  description: z.string(),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  timezone: z.string().min(1),
  all_day: z.boolean(),
  operational_status: z.enum(['scheduled', 'postponed', 'cancelled', 'completed']),
  calendar_status: z.enum(['confirmed', 'tentative', 'cancelled']),
  sequence: z.number().int().nonnegative(),
  updated_at: z.string().min(1),
  detail_url: z.string().url().nullable(),
}).strict();

export const eventCalendarActionsSchema = z.object({
  google_url: z.string().url(),
  outlook_url: z.string().url(),
  download_path: z.string().startsWith('/v2/events/'),
}).strict();

export const eventCalendarFeedTokenSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().nullable(),
  token_prefix: z.string().min(1),
  locale: z.string().min(2),
  created_at: nullableString,
  last_used_at: nullableString,
  revoked_at: nullableString,
  active: z.boolean(),
}).strict();

export const createdEventCalendarFeedTokenSchema = eventCalendarFeedTokenSchema.extend({
  secret: z.string().startsWith('nxc_'),
  feed_url: z.string().url(),
}).strict();

const revokeCalendarFeedTokenSchema = z.object({ revoked: z.literal(true) }).strict();

const eventPeopleMemberSchema = z.object({
  id: z.number().int().positive(),
  display_name: nullableString,
  avatar_url: nullableString,
}).strict();

const eventPeopleAttendanceFactSchema = z.object({
  id: z.number().int().positive().nullable(),
  state: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']),
  version: z.number().int().positive().nullable(),
  changed_at: nullableString,
  checked_in_at: nullableString,
  checked_out_at: nullableString,
}).strict();

const eventPeopleAttendanceActionsSchema = z.object({
  check_in: z.boolean(),
  check_out: z.boolean(),
  no_show: z.boolean(),
  undo_attendance: z.boolean(),
  idempotency_key_required: z.literal(true),
}).strict();

export const eventPeopleFullPersonSchema = z.object({
  member: eventPeopleMemberSchema,
  engagement: z.object({
    state: z.enum(['none', 'interested']),
    consumes_capacity: z.literal(false),
  }).strict(),
  registration: z.object({
    id: z.number().int().positive().nullable(),
    state: z.enum(['invited', 'pending', 'confirmed', 'declined', 'cancelled']).nullable(),
    version: z.number().int().nonnegative().nullable(),
    capacity_pool_key: z.string().min(1),
    allocation_key: nullableString,
    changed_at: nullableString,
    confirmed_at: nullableString,
  }).strict(),
  waitlist: z.object({
    id: z.number().int().positive().nullable(),
    state: z.enum(['waiting', 'offered', 'accepted', 'expired', 'cancelled']).nullable(),
    version: z.number().int().positive().nullable(),
    position: z.number().int().positive().nullable(),
    sequence: z.number().int().positive().nullable(),
    offered_at: nullableString,
    offer_expires_at: nullableString,
    accepted_at: nullableString,
  }).strict(),
  attendance: eventPeopleAttendanceFactSchema,
  management_actions: eventPeopleAttendanceActionsSchema.extend({
    approve: z.boolean(),
    reject: z.boolean(),
    cancel: z.boolean(),
  }).strict(),
  privacy: z.object({ sensitive_fields_redacted: z.literal(true) }).strict(),
}).strict();

export const eventPeopleAttendancePersonSchema = z.object({
  member: eventPeopleMemberSchema,
  registration: z.object({
    state: z.enum(['invited', 'pending', 'confirmed', 'declined', 'cancelled']).nullable(),
  }).strict(),
  attendance: eventPeopleAttendanceFactSchema,
  management_actions: eventPeopleAttendanceActionsSchema,
  privacy: z.object({
    projection: z.literal('attendance'),
    sensitive_fields_redacted: z.literal(true),
  }).strict(),
}).strict();

export const eventPeoplePersonSchema = z.union([
  eventPeopleFullPersonSchema,
  eventPeopleAttendancePersonSchema,
]);

const eventPeopleCapabilitiesSchema = z.object({
  view_roster: z.boolean(),
  view_waitlist: z.boolean(),
  manage_registration: z.boolean(),
  manage_attendance: z.boolean(),
  export_people: z.boolean(),
  view_history: z.boolean(),
}).strict();

const eventPeopleMetaBaseSchema = z.object({
  base_url: z.string(),
  current_page: z.number().int().positive(),
  per_page: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_more: z.boolean(),
  search: nullableString,
  registration_state: nullableString,
  waitlist_state: nullableString,
  attendance_state: nullableString,
  engagement_state: nullableString,
  sort: z.enum(['name', 'registration_changed', 'queue_rank', 'attendance_changed']),
  direction: z.enum(['asc', 'desc']),
  sensitive_fields_redacted: z.literal(true),
  capabilities: eventPeopleCapabilitiesSchema,
});

export const eventPeopleMetaSchema = z.discriminatedUnion('projection', [
  eventPeopleMetaBaseSchema.extend({
    projection: z.literal('full'),
    metrics: z.object({
      confirmed: z.number().int().nonnegative(),
      waitlisted: z.number().int().nonnegative(),
      checked_in: z.number().int().nonnegative(),
      checked_out: z.number().int().nonnegative(),
      no_show: z.number().int().nonnegative(),
      attended: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  eventPeopleMetaBaseSchema.extend({
    projection: z.literal('attendance'),
    metrics: z.object({
      confirmed: z.number().int().nonnegative(),
      checked_in: z.number().int().nonnegative(),
      checked_out: z.number().int().nonnegative(),
      no_show: z.number().int().nonnegative(),
      attended: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
]);

export const eventPeopleHistoryEntrySchema = z.object({
  axis: z.enum(['registration', 'waitlist', 'attendance']),
  entry_id: z.number().int().positive(),
  version: z.number().int().positive(),
  sequence: z.number().int().positive().nullable(),
  action: z.string().min(1),
  from_state: nullableString,
  to_state: z.string().min(1),
  actor: z.object({
    id: z.number().int().positive().nullable(),
    display_name: nullableString,
  }).strict(),
  reason: nullableString,
  created_at: z.string().min(1),
}).strict();

export const eventPeopleHistoryMetaSchema = z.object({
  base_url: z.string(),
  current_page: z.number().int().positive(),
  per_page: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_more: z.boolean(),
  projection: z.enum(['full', 'attendance']),
  sensitive_fields_redacted: z.literal(true),
}).strict();

const eventPeopleRegistrationMutationSchema = z.object({
  registration_id: z.number().int().positive(),
  state: z.enum(['invited', 'pending', 'confirmed', 'declined', 'cancelled']),
  version: z.number().int().positive(),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  history_entry_id: z.number().int().positive().nullable(),
}).strict();

export const eventPeopleAttendanceMutationSchema = z.object({
  attendance_id: z.number().int().positive(),
  event_id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  action: z.enum(['check_in', 'check_out', 'no_show', 'undo']),
  from_state: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']),
  to_state: z.enum(['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  attendance_version: z.number().int().positive(),
  changed_at: nullableString,
  checked_in_at: nullableString,
  checked_out_at: nullableString,
  history_entry_id: z.number().int().positive().nullable(),
}).strict();

const eventPeopleBulkResultBaseSchema = z.object({
  index: z.number().int().nonnegative(),
  user_id: z.number().int().positive(),
  action: z.enum([
    'invite', 'approve', 'reject', 'cancel', 'check_in', 'check_out', 'no_show',
    'undo_attendance',
  ]),
  expected_version: z.number().int().nonnegative(),
});

export const eventPeopleBulkResponseSchema = z.object({
  requested: z.number().int().min(1).max(100),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(z.union([
    eventPeopleBulkResultBaseSchema.extend({
      success: z.literal(true),
      mutation: z.union([
        eventPeopleRegistrationMutationSchema,
        eventPeopleAttendanceMutationSchema,
      ]),
    }).strict(),
    eventPeopleBulkResultBaseSchema.extend({
      success: z.literal(false),
      error: z.object({
        code: z.string().min(1),
        message: z.string().min(1),
        field: z.string().min(1).optional(),
      }).strict(),
    }).strict(),
  ])).max(100),
}).strict();

export const eventPeopleAttendanceResponseSchema = z.object({
  member: z.object({
    id: z.number().int().positive(),
    display_name: nullableString,
  }).strict(),
  mutation: eventPeopleAttendanceMutationSchema,
}).strict();

export type Event = z.infer<typeof eventSchema>;
export type EventVenueAccessibility = z.infer<typeof eventVenueAccessibilitySchema>;
export type EventRegistrationResponse = z.infer<typeof eventRegistrationResponseSchema>;
export type EventRosterMember = z.infer<typeof eventRosterMemberSchema>;
export type EventSeries = z.infer<typeof eventSeriesSchema>;
export type EventSeriesOccurrence = EventSeries['occurrences'][number];
export type EventCategory = z.infer<typeof eventCategorySchema>;
export type EventStaffRole = z.infer<typeof eventStaffRoleSchema>;
export type EventStaffCapability = z.infer<typeof eventStaffCapabilitySchema>;
export type EventStaffAssignment = z.infer<typeof eventStaffAssignmentSchema>;
export type EventAgenda = z.infer<typeof eventAgendaSchema>;
export type EventAgendaSession = z.infer<typeof eventAgendaSessionSchema>;
export type EventAgendaSpeaker = z.infer<typeof eventAgendaSpeakerSchema>;
export type EventAgendaResource = z.infer<typeof eventAgendaResourceSchema>;
export type EventMemberSearchResult = z.infer<typeof eventMemberSearchResultSchema>;
export type EventArchiveResponse = z.infer<typeof eventArchiveResponseSchema>;
export type EventCalendarProjection = z.infer<typeof eventCalendarProjectionSchema>;
export type EventCalendarActions = z.infer<typeof eventCalendarActionsSchema>;
export type EventCalendarFeedToken = z.infer<typeof eventCalendarFeedTokenSchema>;
export type CreatedEventCalendarFeedToken = z.infer<typeof createdEventCalendarFeedTokenSchema>;
export type EventPeopleFullPerson = z.infer<typeof eventPeopleFullPersonSchema>;
export type EventPeopleAttendancePerson = z.infer<typeof eventPeopleAttendancePersonSchema>;
export type EventPeoplePerson = z.infer<typeof eventPeoplePersonSchema>;
export type EventPeopleMeta = z.infer<typeof eventPeopleMetaSchema>;
export type EventPeopleHistoryEntry = z.infer<typeof eventPeopleHistoryEntrySchema>;
export type EventPeopleHistoryMeta = z.infer<typeof eventPeopleHistoryMetaSchema>;
export type EventPeopleBulkResponse = z.infer<typeof eventPeopleBulkResponseSchema>;
export type EventPeopleAttendanceResponse = z.infer<typeof eventPeopleAttendanceResponseSchema>;

export type EventPeopleResponse = Omit<ApiResponse<EventPeoplePerson[]>, 'meta'> & {
  meta?: EventPeopleMeta;
};

export type EventPeopleHistoryResponse = Omit<ApiResponse<EventPeopleHistoryEntry[]>, 'meta'> & {
  meta?: EventPeopleHistoryMeta;
};

export interface EventStaffGrantPayload {
  user_id: number;
  role: EventStaffRole;
  expires_at?: string | null;
}

export interface EventAgendaSpeakerInput {
  user_id?: number;
  display_name?: string;
  role_label?: string | null;
}

export interface EventAgendaResourceInput {
  type: EventAgendaResource['type'];
  title: string;
  url: string;
  visibility: EventAgendaResource['visibility'];
}

export interface EventAgendaSessionPayload {
  title: string;
  description?: string | null;
  session_type: EventAgendaSession['type'];
  visibility: EventAgendaSession['visibility'];
  start_at: string;
  end_at: string;
  timezone: string;
  track_name?: string | null;
  room_name?: string | null;
  capacity?: number | null;
  speakers: EventAgendaSpeakerInput[];
  resources: EventAgendaResourceInput[];
}

export interface EventPeopleQueryParams {
  page?: number;
  per_page?: number;
  search?: string;
  registration_state?: string;
  waitlist_state?: string;
  attendance_state?: string;
  engagement_state?: string;
  sort?: 'name' | 'registration_changed' | 'queue_rank' | 'attendance_changed';
  direction?: 'asc' | 'desc';
}

export type EventPeopleBulkAction =
  | 'invite'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'check_in'
  | 'check_out'
  | 'no_show'
  | 'undo_attendance';

export interface EventPeopleBulkOperation {
  user_id: number;
  action: EventPeopleBulkAction;
  expected_version: number;
  idempotency_key: string;
  reason?: string;
}

export interface EventAttendanceTransitionPayload {
  action: 'check_in' | 'check_out' | 'no_show' | 'undo';
  expected_version: number;
  idempotency_key: string;
  reason?: string;
}

type EventMutationPayload = Record<string, unknown>;

function withContract(options?: RequestOptions): RequestOptions {
  const headers = new Headers(options?.headers);
  headers.set(EVENTS_CONTRACT_HEADER, String(EVENTS_CONTRACT_VERSION));
  return { ...options, headers };
}

function withIdempotencyKey(key: string, options?: RequestOptions): RequestOptions {
  const contracted = withContract(options);
  const headers = new Headers(contracted.headers);
  headers.set('Idempotency-Key', key);

  return { ...contracted, headers };
}

function reportContractDrift(endpoint: string, error: z.ZodError): void {
  // Deliberately exclude issue messages, values and the response payload. Event
  // descriptions, locations and attendee records can contain private data.
  logError('Events contract drift', {
    endpoint,
    version: EVENTS_CONTRACT_VERSION,
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    })),
  });
}

function parseResponse<T>(
  endpoint: string,
  response: ApiResponse<unknown>,
  schema: z.ZodType<T>,
): ApiResponse<T> {
  if (!response.success) return response as ApiResponse<T>;

  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ...response, data: parsed.data };

  reportContractDrift(endpoint, parsed.error);
  return {
    ...response,
    success: false,
    data: undefined,
    error: undefined,
    code: 'EVENTS_CONTRACT_DRIFT',
  };
}

function parseResponseWithMeta<TData, TMeta>(
  endpoint: string,
  response: ApiResponse<unknown>,
  dataSchema: z.ZodType<TData>,
  metaSchema: z.ZodType<TMeta>,
): Omit<ApiResponse<TData>, 'meta'> & { meta?: TMeta } {
  const parsed = parseResponse(endpoint, response, dataSchema);
  const { meta: _ignoredMeta, ...parsedWithoutMeta } = parsed;
  if (!parsed.success) return parsedWithoutMeta;

  const parsedMeta = metaSchema.safeParse(response.meta);
  if (parsedMeta.success) {
    return { ...parsedWithoutMeta, meta: parsedMeta.data };
  }

  reportContractDrift(`${endpoint}#meta`, parsedMeta.error);
  return {
    ...parsedWithoutMeta,
    success: false,
    data: undefined,
    error: undefined,
    code: 'EVENTS_CONTRACT_DRIFT',
    meta: undefined,
  };
}

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export const eventsApi = {
  async list(
    params: Record<string, string | number | boolean | null | undefined> = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<Event[]>> {
    const endpoint = `/v2/events${queryString(params)}`;
    return parseResponse(endpoint, await api.get(endpoint, withContract(options)), z.array(eventSchema));
  },

  async get(id: number | string, options?: RequestOptions): Promise<ApiResponse<Event>> {
    const endpoint = `/v2/events/${id}`;
    return parseResponse(endpoint, await api.get(endpoint, withContract(options)), eventSchema);
  },

  async create(payload: EventMutationPayload): Promise<ApiResponse<Event>> {
    const endpoint = '/v2/events';
    return parseResponse(endpoint, await api.post(endpoint, payload, withContract()), eventSchema);
  },

  async update(id: number | string, payload: EventMutationPayload): Promise<ApiResponse<Event>> {
    const endpoint = `/v2/events/${id}`;
    return parseResponse(endpoint, await api.put(endpoint, payload, withContract()), eventSchema);
  },

  async recurrenceCapabilities(options?: RequestOptions): Promise<ApiResponse<EventRecurrenceCapabilities>> {
    const endpoint = '/v2/events/recurrence-capabilities';
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventRecurrenceCapabilitiesSchema,
    );
  },

  async submitForReview(id: number | string): Promise<ApiResponse<Event>> {
    const endpoint = `/v2/events/${id}/submit`;
    return parseResponse(endpoint, await api.post(endpoint, {}, withContract()), eventSchema);
  },

  async publish(id: number | string): Promise<ApiResponse<Event>> {
    const endpoint = `/v2/events/${id}/publish`;
    return parseResponse(endpoint, await api.post(endpoint, {}, withContract()), eventSchema);
  },

  async reminders(id: number | string): Promise<ApiResponse<EventReminderPreferences>> {
    const endpoint = `/v2/events/${id}/reminders`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract()),
      eventReminderPreferencesSchema,
    );
  },

  async updateReminders(
    id: number | string,
    payload: EventReminderUpdate,
  ): Promise<ApiResponse<EventReminderPreferences>> {
    const endpoint = `/v2/events/${id}/reminders`;
    return parseResponse(
      endpoint,
      await api.put(endpoint, payload, withContract()),
      eventReminderPreferencesSchema,
    );
  },

  async deleteReminders(
    id: number | string,
    expectedRevision: number,
  ): Promise<ApiResponse<EventReminderPreferences>> {
    const endpoint = `/v2/events/${id}/reminders${queryString({ expected_revision: expectedRevision })}`;
    return parseResponse(
      endpoint,
      await api.delete(endpoint, withContract()),
      eventReminderPreferencesSchema,
    );
  },

  async createRecurring(
    payload: EventMutationPayload,
  ): Promise<ApiResponse<z.infer<typeof recurringCreateResponseSchema>>> {
    const endpoint = '/v2/events/recurring';
    return parseResponse(
      endpoint,
      await api.post(endpoint, payload, withContract()),
      recurringCreateResponseSchema,
    );
  },

  async updateRecurring(id: number | string, payload: EventMutationPayload): Promise<ApiResponse<Event>> {
    const endpoint = `/v2/events/${id}/recurring`;
    return parseResponse(endpoint, await api.put(endpoint, payload, withContract()), eventSchema);
  },

  async previewRecurrenceRevision(
    id: number | string,
    patch: EventRecurrenceRevisionPatch,
  ): Promise<ApiResponse<EventRecurrenceRevisionPreview>> {
    const endpoint = `/v2/events/${id}/recurrence-revisions/preview`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, { patch }, withContract()),
      eventRecurrenceRevisionPreviewSchema,
    );
  },

  async commitRecurrenceRevision(
    id: number | string,
    patch: EventRecurrenceRevisionPatch,
    previewToken: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<EventRecurrenceRevisionCommit>> {
    const endpoint = `/v2/events/${id}/recurrence-revisions/commit`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { patch, preview_token: previewToken },
        withIdempotencyKey(idempotencyKey),
      ),
      eventRecurrenceRevisionCommitSchema,
    );
  },

  async recurrenceDefinitionHistory(
    id: number | string,
    limit = 25,
    beforeVersion?: number,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventRecurrenceDefinitionHistory>> {
    const endpoint = `/v2/events/${id}/recurrence-definition-blueprints${queryString({
      limit,
      before_version: beforeVersion,
    })}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventRecurrenceDefinitionHistorySchema,
    );
  },

  async previewRecurrenceDefinitions(
    id: number | string,
    effectiveFromRecurrenceId: string,
    sections: EventRecurrenceDefinitionSections,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventRecurrenceDefinitionPreview>> {
    const endpoint = `/v2/events/${id}/recurrence-definition-blueprints/preview`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        {
          effective_from_recurrence_id: effectiveFromRecurrenceId,
          sections,
        },
        withContract(options),
      ),
      eventRecurrenceDefinitionPreviewSchema,
    );
  },

  async commitRecurrenceDefinitions(
    id: number | string,
    effectiveFromRecurrenceId: string,
    sections: EventRecurrenceDefinitionSections,
    previewToken: string,
    idempotencyKey: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventRecurrenceDefinitionCommit>> {
    const endpoint = `/v2/events/${id}/recurrence-definition-blueprints/commit`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        {
          effective_from_recurrence_id: effectiveFromRecurrenceId,
          sections,
          preview_token: previewToken,
        },
        withIdempotencyKey(idempotencyKey, options),
      ),
      eventRecurrenceDefinitionCommitSchema,
    );
  },

  async archive(
    id: number | string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<ApiResponse<EventArchiveResponse>> {
    const endpoint = `/v2/events/${id}`;
    const body = reason?.trim() ? { reason: reason.trim() } : undefined;
    return parseResponse(
      endpoint,
      await api.delete(endpoint, withIdempotencyKey(idempotencyKey, { body })),
      eventArchiveResponseSchema,
    );
  },

  async rsvp(id: number | string, status: 'going' | 'interested' | 'not_going'): Promise<ApiResponse<EventRegistrationResponse>> {
    const endpoint = `/v2/events/${id}/rsvp`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, { status }, withContract()),
      eventRegistrationResponseSchema,
    );
  },

  removeRsvp(id: number | string): Promise<ApiResponse<unknown>> {
    return api.delete(`/v2/events/${id}/rsvp`, withContract());
  },

  async roster(
    id: number | string,
    params: Record<string, string | number | boolean | null | undefined> = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<EventRosterMember[]>> {
    const endpoint = `/v2/events/${id}/attendees${queryString(params)}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventRosterMemberSchema),
    );
  },

  async people(
    id: number | string,
    params: EventPeopleQueryParams = {},
    options?: RequestOptions,
  ): Promise<EventPeopleResponse> {
    const endpoint = `/v2/events/${id}/people${queryString({ ...params })}`;
    return parseResponseWithMeta(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventPeoplePersonSchema),
      eventPeopleMetaSchema,
    );
  },

  async bulkPeople(
    id: number | string,
    operations: EventPeopleBulkOperation[],
  ): Promise<ApiResponse<EventPeopleBulkResponse>> {
    const endpoint = `/v2/events/${id}/people/bulk`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, { operations }, withContract()),
      eventPeopleBulkResponseSchema,
    );
  },

  async transitionAttendance(
    id: number | string,
    userId: number,
    payload: EventAttendanceTransitionPayload,
  ): Promise<ApiResponse<EventPeopleAttendanceResponse>> {
    const endpoint = `/v2/events/${id}/people/${userId}/attendance`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        payload,
        withIdempotencyKey(payload.idempotency_key),
      ),
      eventPeopleAttendanceResponseSchema,
    );
  },

  async peopleHistory(
    id: number | string,
    userId: number,
    page = 1,
    perPage = 50,
    options?: RequestOptions,
  ): Promise<EventPeopleHistoryResponse> {
    const endpoint = `/v2/events/${id}/people/${userId}/history${queryString({
      page,
      per_page: perPage,
    })}`;
    return parseResponseWithMeta(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventPeopleHistoryEntrySchema),
      eventPeopleHistoryMetaSchema,
    );
  },

  downloadPeopleCsv(
    id: number | string,
    params: Omit<EventPeopleQueryParams, 'page' | 'per_page'> = {},
  ): Promise<Blob> {
    const endpoint = `/v2/events/${id}/people/export.csv${queryString({ ...params })}`;
    return api.download(endpoint, {
      ...withContract(),
      filename: `event-${id}-people.csv`,
    });
  },

  async checkIn(id: number | string, attendeeId: number): Promise<ApiResponse<z.infer<typeof checkInResponseSchema>>> {
    const endpoint = `/v2/events/${id}/attendees/${attendeeId}/check-in`;
    return parseResponse(endpoint, await api.post(endpoint, {}, withContract()), checkInResponseSchema);
  },

  async cancel(
    id: number | string,
    reason: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof cancelResponseSchema>>> {
    const endpoint = `/v2/events/${id}/cancel`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, { reason }, withIdempotencyKey(idempotencyKey)),
      cancelResponseSchema,
    );
  },

  async joinWaitlist(id: number | string): Promise<ApiResponse<z.infer<typeof waitlistResponseSchema>>> {
    const endpoint = `/v2/events/${id}/waitlist`;
    return parseResponse(endpoint, await api.post(endpoint, {}, withContract()), waitlistResponseSchema);
  },

  leaveWaitlist(id: number | string): Promise<ApiResponse<unknown>> {
    return api.delete(`/v2/events/${id}/waitlist`, withContract());
  },

  async acceptWaitlistOffer(
    id: number | string,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventWaitlistOfferAcceptanceResponseSchema>>> {
    const endpoint = `/v2/events/${id}/registration/waitlist/accept`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, {}, withIdempotencyKey(idempotencyKey)),
      eventWaitlistOfferAcceptanceResponseSchema,
    );
  },

  async series(id: number | string, options?: RequestOptions): Promise<ApiResponse<EventSeries>> {
    const endpoint = `/v2/events/series/${id}`;
    return parseResponse(endpoint, await api.get(endpoint, withContract(options)), eventSeriesSchema);
  },

  async categories(options?: RequestOptions): Promise<ApiResponse<EventCategory[]>> {
    const endpoint = '/v2/categories?type=event';
    return parseResponse(endpoint, await api.get(endpoint, withContract(options)), z.array(eventCategorySchema));
  },

  async listStaff(
    id: number | string,
    includeInactive = true,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventStaffAssignment[]>> {
    const endpoint = `/v2/events/${id}/staff${queryString({ include_inactive: includeInactive })}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventStaffAssignmentSchema),
    );
  },

  async agenda(
    id: number | string,
    includeCancelled = false,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventAgenda>> {
    const endpoint = `/v2/events/${id}/agenda${queryString({ include_cancelled: includeCancelled })}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventAgendaSchema,
    );
  },

  async createAgendaSession(
    id: number | string,
    payload: EventAgendaSessionPayload,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaSessionMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/sessions`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, payload, withIdempotencyKey(idempotencyKey)),
      eventAgendaSessionMutationSchema,
    );
  },

  async updateAgendaSession(
    id: number | string,
    sessionId: number,
    expectedVersion: number,
    payload: EventAgendaSessionPayload,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaSessionMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/sessions/${sessionId}`;
    return parseResponse(
      endpoint,
      await api.put(
        endpoint,
        { ...payload, expected_version: expectedVersion },
        withIdempotencyKey(idempotencyKey),
      ),
      eventAgendaSessionMutationSchema,
    );
  },

  async cancelAgendaSession(
    id: number | string,
    sessionId: number,
    expectedVersion: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaSessionMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/sessions/${sessionId}/cancel`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion, reason },
        withIdempotencyKey(idempotencyKey),
      ),
      eventAgendaSessionMutationSchema,
    );
  },

  async reorderAgendaSessions(
    id: number | string,
    orderedSessionIds: number[],
    expectedAgendaVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaReorderMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/order`;
    return parseResponse(
      endpoint,
      await api.put(
        endpoint,
        {
          ordered_session_ids: orderedSessionIds,
          expected_agenda_version: expectedAgendaVersion,
        },
        withIdempotencyKey(idempotencyKey),
      ),
      eventAgendaReorderMutationSchema,
    );
  },

  async registerAgendaSession(
    id: number | string,
    sessionId: number,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaRegistrationMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/sessions/${sessionId}/registration`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion },
        withIdempotencyKey(idempotencyKey),
      ),
      eventAgendaRegistrationMutationSchema,
    );
  },

  async withdrawAgendaSession(
    id: number | string,
    sessionId: number,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventAgendaRegistrationMutationSchema>>> {
    const endpoint = `/v2/events/${id}/agenda/sessions/${sessionId}/registration/withdraw`;
    return parseResponse(
      endpoint,
      await api.post(
        endpoint,
        { expected_version: expectedVersion },
        withIdempotencyKey(idempotencyKey),
      ),
      eventAgendaRegistrationMutationSchema,
    );
  },

  async assignStaff(
    id: number | string,
    payload: EventStaffGrantPayload,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventStaffMutationResponseSchema>>> {
    const endpoint = `/v2/events/${id}/staff`;
    return parseResponse(
      endpoint,
      await api.post(endpoint, payload, withIdempotencyKey(idempotencyKey)),
      eventStaffMutationResponseSchema,
    );
  },

  async revokeStaff(
    id: number | string,
    assignmentId: number,
    idempotencyKey: string,
  ): Promise<ApiResponse<z.infer<typeof eventStaffMutationResponseSchema>>> {
    const endpoint = `/v2/events/${id}/staff/${assignmentId}`;
    return parseResponse(
      endpoint,
      await api.delete(endpoint, withIdempotencyKey(idempotencyKey)),
      eventStaffMutationResponseSchema,
    );
  },

  async searchMembers(
    query: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventMemberSearchResult[]>> {
    const endpoint = `/v2/users${queryString({ q: query.trim(), limit: 10 })}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, options),
      z.array(eventMemberSearchResultSchema),
    );
  },

  async uploadCover(
    id: number | string,
    image: File | FormData,
    scope?: 'single' | 'all',
    options?: RequestOptions,
  ): Promise<ApiResponse<z.infer<typeof uploadResponseSchema>>> {
    const endpoint = `/v2/events/${id}/image${queryString({ scope })}`;
    return parseResponse(
      endpoint,
      await api.upload(endpoint, image, 'image', withContract(options)),
      uploadResponseSchema,
    );
  },

  async calendar(
    from: string,
    to: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventCalendarProjection[]>> {
    const endpoint = `/v2/events/calendar${queryString({ from, to })}`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventCalendarProjectionSchema),
    );
  },

  async calendarActions(
    id: number | string,
    options?: RequestOptions,
  ): Promise<ApiResponse<EventCalendarActions>> {
    const endpoint = `/v2/events/${id}/calendar-actions`;
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      eventCalendarActionsSchema,
    );
  },

  async calendarFeedTokens(
    options?: RequestOptions,
  ): Promise<ApiResponse<EventCalendarFeedToken[]>> {
    const endpoint = '/v2/events/calendar/feed-tokens';
    return parseResponse(
      endpoint,
      await api.get(endpoint, withContract(options)),
      z.array(eventCalendarFeedTokenSchema),
    );
  },

  async createCalendarFeedToken(
    label?: string,
  ): Promise<ApiResponse<CreatedEventCalendarFeedToken>> {
    const endpoint = '/v2/events/calendar/feed-tokens';
    return parseResponse(
      endpoint,
      await api.post(endpoint, { label: label?.trim() || null }, withContract()),
      createdEventCalendarFeedTokenSchema,
    );
  },

  async revokeCalendarFeedToken(id: number): Promise<ApiResponse<{ revoked: true }>> {
    const endpoint = `/v2/events/calendar/feed-tokens/${id}`;
    return parseResponse(
      endpoint,
      await api.delete(endpoint, withContract()),
      revokeCalendarFeedTokenSchema,
    );
  },

  downloadEventCalendar(id: number | string): Promise<Blob> {
    return api.download(`/v2/events/${id}/calendar.ics`, {
      ...withContract(),
      filename: `event-${id}.ics`,
    });
  },

  downloadTenantCalendar(): Promise<Blob> {
    return api.download('/v2/events/calendar/feed.ics', {
      ...withContract(),
      filename: 'events.ics',
    });
  },
};
