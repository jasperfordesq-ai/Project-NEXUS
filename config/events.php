<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [

    /*
    |--------------------------------------------------------------------------
    | Negotiated Events read contract
    |--------------------------------------------------------------------------
    |
    | Existing clients remain on the legacy projection unless they explicitly
    | send X-Events-Contract: 2. Version 2 is additive at the endpoint level but
    | intentionally changes conflicting fields such as `location` from a string
    | to a structured object, so it must never be selected implicitly during the
    | compatibility window.
    |
    */

    'contract' => [
        'legacy_version' => 1,
        'canonical_version' => 2,
    ],

    /*
    |--------------------------------------------------------------------------
    | Online meeting access window
    |--------------------------------------------------------------------------
    |
    | Organisers and tenant administrators can always manage configured links.
    | Confirmed attendees receive them only inside this bounded window. Both
    | negotiated projections use the same fail-closed policy.
    |
    */

    'online_access' => [
        'reveal_before_minutes' => (int) env('EVENTS_ONLINE_REVEAL_BEFORE_MINUTES', 30),
        'grace_after_minutes' => (int) env('EVENTS_ONLINE_GRACE_AFTER_MINUTES', 120),
    ],

    /*
    |--------------------------------------------------------------------------
    | Event attendance credits
    |--------------------------------------------------------------------------
    |
    | Attendance rewards are OFF unless deliberately configured. The historical
    | implementation charged whichever organiser or tenant administrator
    | performed check-in and used mutable RSVP state as its idempotency claim;
    | that is what the immutable claim ledger replaced.
    |
    | Supported modes:
    |
    |   off       No credits are granted. The reviewed writer is not reachable.
    |             This remains the default everywhere.
    |
    |   treasury  Credits are MINTED to the attendee against the community
    |             (sender_id IS NULL, transaction_type event_attendance_reward —
    |             the same shape as starting_balance / community_fund /
    |             admin_grant). No member or organiser is debited: the community
    |             funds engagement rewards, so hosting is never a personal cost.
    |
    | Any other value still fails closed and logs at critical.
    |
    | A reward requires ALL THREE of: this mode, the tenant's
    | `event_attendance_credits` feature flag, and a per-event
    | `attendance_credit_amount`. The reviewed semantics are:
    |
    |   payer     the community treasury (funding_source_type tenant_treasury)
    |   amount    flat per event, clamped to attendance_credit_max below
    |   trigger   verified check-in only, once per (tenant, event, member) via
    |             the claim ledger's unique key — never RSVP, which is unverified
    |   consent   attendee consent is implicit in registering and attending;
    |             the payer's consent is the admin enabling the flag and setting
    |             an amount
    |   failure   never blocks attendance — the claim records `failed` and the
    |             check-in still stands
    |   reversal  admin-initiated only, as a child claim; no automatic clawback
    |
    */

    'attendance_credit_mode' => env('EVENTS_ATTENDANCE_CREDIT_MODE', 'off'),

    /**
     * Hard ceiling on a single event's attendance reward. An organiser can set
     * any amount up to this; the writer clamps rather than rejects so a stale
     * larger value on an existing event cannot mint more than the community
     * has agreed to.
     */
    'attendance_credit_max' => (float) env('EVENTS_ATTENDANCE_CREDIT_MAX', 2.0),

    /*
    |--------------------------------------------------------------------------
    | Monthly cap clock
    |--------------------------------------------------------------------------
    | The tenant monthly cap (attendance_credit_monthly_cap, set per tenant in
    | Event Settings) resets at the start of the calendar month in the APP
    | timezone (config('app.timezone')), not any tenant-local zone. Write and
    | read use the same clock, so accounting is internally consistent; a tenant
    | far from the app zone just sees its budget roll a few hours off local
    | midnight on the 1st. Revisit only if tenants gain a timezone setting.
    */

    'attendance' => [
        'opens_before_minutes' => (int) env('EVENTS_ATTENDANCE_OPENS_BEFORE_MINUTES', 30),
        'closes_after_hours' => (int) env('EVENTS_ATTENDANCE_CLOSES_AFTER_HOURS', 24),
    ],

    /*
    |--------------------------------------------------------------------------
    | Canonical registration and timed waitlist offers
    |--------------------------------------------------------------------------
    |
    | Capacity registration is independent of engagement (`interested`). The
    | canonical services dual-read/write the legacy tables during rollout, but
    | timed offers remain disabled until notification and client acceptance
    | flows are integrated. Allocation keys are reserved for future segmented
    | pools and therefore fail closed today.
    |
    */

    'registration' => [
        'default_capacity_pool_key' => env('EVENTS_DEFAULT_CAPACITY_POOL_KEY', 'event'),
        'allow_allocation_keys' => env('EVENTS_REGISTRATION_ALLOW_ALLOCATION_KEYS', false),
        'legacy_dual_read' => env('EVENTS_REGISTRATION_LEGACY_DUAL_READ', true),
        'legacy_dual_write' => env('EVENTS_REGISTRATION_LEGACY_DUAL_WRITE', true),
        'timed_waitlist_offers_enabled' => env('EVENTS_TIMED_WAITLIST_OFFERS_ENABLED', false),
        'offer_ttl_minutes' => (int) env('EVENTS_WAITLIST_OFFER_TTL_MINUTES', 15),
    ],

    /*
    |--------------------------------------------------------------------------
    | Event safety enforcement rollout
    |--------------------------------------------------------------------------
    |
    | off keeps the accepted safety evidence model available for configuration
    | and attendee actions without changing participation. shadow evaluates and
    | records privacy-safe decision telemetry. enforce makes every canonical and
    | compatibility participation writer fail closed on deny/unavailable. A
    | malformed global or tenant value is never treated as off implicitly.
    |
    */

    'safety' => [
        'enforcement_mode' => env('EVENTS_SAFETY_ENFORCEMENT_MODE', 'off'),
        'guardian_consent_ttl_days' => (int) env('EVENTS_GUARDIAN_CONSENT_TTL_DAYS', 30),
        'max_review_page_size' => (int) env('EVENTS_SAFETY_MAX_REVIEW_PAGE_SIZE', 50),
        'guardian_delivery_envelope' => [
            'active_key_version' => env(
                'EVENTS_GUARDIAN_DELIVERY_KEY_VERSION',
                'app-key-v1',
            ),
            'active_key' => env('EVENTS_GUARDIAN_DELIVERY_KEY'),
            'fallback_to_app_key' => env(
                'EVENTS_GUARDIAN_DELIVERY_FALLBACK_TO_APP_KEY',
                true,
            ),
            'previous_keys' => [],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Recurrence engine rollout
    |--------------------------------------------------------------------------
    |
    | Version 2 uses a standards-based RRULE adapter and deterministic concrete
    | occurrence identities. It remains an explicit tenant-canary/rollback flag
    | until client DTSTART, local-UNTIL and effective-dated revision parity is
    | complete. Never-ending v2 rules are topped up by a bounded, durable rolling
    | materializer; active legacy never roots remain a health blocker.
    |
    */

    'recurrence' => [
        'engine_v2_enabled' => env('EVENTS_RECURRENCE_V2_ENABLED', false),
        'max_occurrences' => (int) env('EVENTS_RECURRENCE_MAX_OCCURRENCES', 366),
        'max_horizon_years' => (int) env('EVENTS_RECURRENCE_MAX_HORIZON_YEARS', 20),
        'materialization' => [
            'enabled' => env('EVENTS_RECURRENCE_MATERIALIZATION_ENABLED', false),
            'lookahead_days' => (int) env('EVENTS_RECURRENCE_LOOKAHEAD_DAYS', 365),
            'refresh_margin_days' => (int) env('EVENTS_RECURRENCE_REFRESH_MARGIN_DAYS', 30),
            'overdue_grace_hours' => (int) env('EVENTS_RECURRENCE_OVERDUE_GRACE_HOURS', 6),
            'retry_grace_minutes' => (int) env('EVENTS_RECURRENCE_RETRY_GRACE_MINUTES', 15),
            'repair_lookback_days' => (int) env('EVENTS_RECURRENCE_REPAIR_LOOKBACK_DAYS', 30),
            'series_limit' => (int) env('EVENTS_RECURRENCE_SERIES_LIMIT', 50),
            'occurrence_limit' => (int) env('EVENTS_RECURRENCE_OCCURRENCE_LIMIT', 500),
            'scan_limit' => (int) env('EVENTS_RECURRENCE_SCAN_LIMIT', 2000),
        ],
        'revisions' => [
            'preview_ttl_seconds' => (int) env(
                'EVENTS_RECURRENCE_REVISION_PREVIEW_TTL_SECONDS',
                600,
            ),
            'max_affected_occurrences' => (int) env(
                'EVENTS_RECURRENCE_REVISION_MAX_AFFECTED_OCCURRENCES',
                1000,
            ),
            'preview_envelope' => [
                'active_key_version' => env(
                    'EVENTS_RECURRENCE_REVISION_KEY_VERSION',
                    'app-key-v1',
                ),
                'active_key' => env('EVENTS_RECURRENCE_REVISION_KEY'),
                'previous_keys' => json_decode((string) env(
                    'EVENTS_RECURRENCE_REVISION_PREVIOUS_KEYS',
                    '{}',
                ), true) ?: [],
                'fallback_to_app_key' => env(
                    'EVENTS_RECURRENCE_REVISION_FALLBACK_APP_KEY',
                    true,
                ),
            ],
        ],
        'definition_blueprints' => [
            // Definition propagation is a separate canary boundary. It must
            // never become active merely because the V2 writer is enabled.
            'enabled' => env('EVENTS_RECURRENCE_DEFINITION_BLUEPRINTS_ENABLED', false),
            'schema_version' => 1,
            // Preview envelopes intentionally share the recurrence revision
            // TTL/key ring so expiry and rotation semantics cannot diverge.
            'max_sessions' => 100,
            'max_speakers_per_session' => 50,
            'max_resources_per_session' => 50,
            'max_ticket_types' => 100,
            'max_form_questions' => 200,
            'max_staff_assignments' => 100,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Calendar projections and subscription feeds
    |--------------------------------------------------------------------------
    |
    | Calendar feeds export only the canonical privacy-safe projection. Feed
    | secrets are generated per member and stored as hashes; these settings
    | bound query horizons and the number of simultaneously active secrets.
    |
    */

    'calendar' => [
        'max_range_days' => (int) env('EVENTS_CALENDAR_MAX_RANGE_DAYS', 366),
        'tenant_feed_past_days' => (int) env('EVENTS_CALENDAR_TENANT_PAST_DAYS', 30),
        'tenant_feed_future_days' => (int) env('EVENTS_CALENDAR_TENANT_FUTURE_DAYS', 366),
        'personal_feed_past_days' => (int) env('EVENTS_CALENDAR_PERSONAL_PAST_DAYS', 365),
        'personal_feed_future_days' => (int) env('EVENTS_CALENDAR_PERSONAL_FUTURE_DAYS', 730),
        'max_active_feed_tokens' => (int) env('EVENTS_CALENDAR_MAX_ACTIVE_TOKENS', 10),
    ],

    /*
    |--------------------------------------------------------------------------
    | Versioned reminder schedule rollout
    |--------------------------------------------------------------------------
    |
    | Canonical is the fresh-install default and owns durable rule, schedule,
    | and outbox delivery. Legacy and shadow remain explicit rollback/comparison
    | overrides for existing installations. Unknown modes must be rejected by
    | the orchestration layer rather than guessed here.
    |
    */

    'reminders' => [
        'mode' => env('EVENTS_REMINDER_MODE', 'canonical'),
        'default_enabled' => env('EVENTS_REMINDER_DEFAULT_ENABLED', true),
        'default_cadence' => env('EVENTS_REMINDER_DEFAULT_CADENCE', 'off'),
        'default_channels' => [
            'email' => true,
            'in_app' => true,
            'web_push' => true,
            'fcm' => true,
            'realtime' => true,
        ],
        'default_offsets_minutes' => array_values(array_filter(
            array_map(
                'intval',
                explode(',', (string) env('EVENTS_REMINDER_DEFAULT_OFFSETS_MINUTES', '1440,60')),
            ),
            static fn (int $minutes): bool => $minutes > 0,
        )),
        'minimum_offset_minutes' => (int) env('EVENTS_REMINDER_MINIMUM_OFFSET_MINUTES', 5),
        'maximum_offset_minutes' => (int) env('EVENTS_REMINDER_MAXIMUM_OFFSET_MINUTES', 525600),
        'max_rules_per_event' => (int) env('EVENTS_REMINDER_MAX_RULES_PER_EVENT', 10),
        'catch_up_horizon_minutes' => (int) env('EVENTS_REMINDER_CATCH_UP_HORIZON_MINUTES', 1440),
        'batch_size' => (int) env('EVENTS_REMINDER_BATCH_SIZE', 200),
    ],

    /*
    |--------------------------------------------------------------------------
    | Privacy-governed Event analytics
    |--------------------------------------------------------------------------
    |
    | Operational totals are derived from canonical domain ledgers. This flag
    | controls only optional view/registration-start funnel facts, which also
    | require a current per-user analytics consent record. It remains disabled
    | until the client capture and privacy-withdrawal hooks are integrated.
    |
    */

    'analytics' => [
        'optional_capture_enabled' => env('EVENTS_ANALYTICS_OPTIONAL_CAPTURE_ENABLED', false),
        'retention_days' => (int) env('EVENTS_ANALYTICS_RETENTION_DAYS', 365),
        'late_after_hours' => (int) env('EVENTS_ANALYTICS_LATE_AFTER_HOURS', 24),
        'max_late_days' => (int) env('EVENTS_ANALYTICS_MAX_LATE_DAYS', 30),
        'max_future_minutes' => (int) env('EVENTS_ANALYTICS_MAX_FUTURE_MINUTES', 5),
        'privacy_threshold' => (int) env('EVENTS_ANALYTICS_PRIVACY_THRESHOLD', 5),
    ],

    /*
    |--------------------------------------------------------------------------
    | Event notification cutover
    |--------------------------------------------------------------------------
    |
    | Outbox-authoritative is the fresh-install default. Direct keeps the
    | established delivery path authoritative and shadow_outbox records
    | non-claimable comparison rows when an existing installation explicitly
    | chooses either override. The consumer can still be disabled separately
    | as an emergency operational stop.
    |
    */

    'notification_delivery' => [
        'mode' => env('EVENTS_NOTIFICATION_DELIVERY_MODE', 'outbox_authoritative'),
        'consumer_enabled' => env('EVENTS_NOTIFICATION_OUTBOX_CONSUMER_ENABLED', true),
        'batch_size' => (int) env('EVENTS_NOTIFICATION_OUTBOX_BATCH_SIZE', 50),
        'channels' => ['email', 'in_app', 'push'],
        'max_attempts' => (int) env('EVENTS_NOTIFICATION_OUTBOX_MAX_ATTEMPTS', 5),
        'base_retry_seconds' => (int) env('EVENTS_NOTIFICATION_OUTBOX_BASE_RETRY_SECONDS', 60),
        'max_retry_seconds' => (int) env('EVENTS_NOTIFICATION_OUTBOX_MAX_RETRY_SECONDS', 3600),
        'stale_claim_minutes' => (int) env('EVENTS_NOTIFICATION_OUTBOX_STALE_CLAIM_MINUTES', 10),
    ],

];
