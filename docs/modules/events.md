# Events Module Guide

Last reviewed: 2026-07-14

Project NEXUS Events is an authenticated, tenant-scoped event-management module. It covers discovery, lifecycle and moderation, registration and waitlists, staff and people operations, agenda sessions, reminders and broadcasts, calendars, safety controls, tickets, templates, offline check-in, analytics, and federation. This guide describes maintained behaviour; [`routes/api.php`](../../routes/api.php) is the authoritative endpoint inventory.

## Safety and product boundaries

- Events API routes require Sanctum authentication and the tenant `events` feature. The accessible frontend has the same authenticated and feature-gated boundary.
- `EventPolicy` is authoritative for event, roster, online-access, staff, registration-answer, finance, analytics, and export permissions. Client-side hiding is only defence in depth.
- Published or historically used events are archived through the lifecycle service. The maintained API does not treat ordinary deletion as an unaudited hard delete.
- Attendance is recorded independently from money or time credits. Automatic attendance-credit transfers are disabled. A future credit effect must use `EventCreditService`, an explicit funding source, an immutable claim, and a reviewed reversal policy.
- Free and time-credit ticket definitions are supported, but confirmed entitlements are deliberately free-only. Time-credit activation, holds, settlement and refunds remain fail-closed until an approved wallet policy and adapter are enabled. Cash payment processing is not provided by Events.
- Registration answers, guest contact details, meeting links, staff resources, notification evidence, and offline credentials are field-level protected data. They are never part of a general event projection.
- No maintained catalogue, detail, roster, organiser, or admin Events endpoint is anonymous. The only public exceptions are narrow capability-token operations such as a secret personal calendar feed and one-use guardian-consent grant; invalid guardian inputs are deliberately non-enumerable. A future public catalogue would require a separate, identity-free contract and approval.

## Capability map

| Area | Maintained behaviour |
| --- | --- |
| Discovery | Chronological/keyset listing, search and category/series/proximity filters, lifecycle and group-visibility enforcement, venue-accessibility filters |
| Lifecycle | Draft, review, publish, postpone, cancel, complete and archive transitions with row-locked versions, target-state replay safety, immutable history and admin moderation |
| Registration | Independent engagement, canonical registration, attendance and waitlist axes; capacity locking; timed single-use waitlist offers |
| Registration product | Versioned forms, conditional questions, encrypted answers, approval settings, invitations/campaigns, guests, audited export and retention runs |
| People and staff | Server-paginated roster, capability-scoped staff roles, bulk operations, check-in/out/no-show and formula-safe export |
| Agenda | Versioned sessions, speakers, tracks/rooms, capacity, attendee session registration, visibility-scoped encrypted resources and immutable history |
| Recurrence and calendar | Per-event IANA timezones, RFC 5545 recurrence, stable occurrence identity, exceptions, calendar views, feed tokens and ICS actions |
| Communications | Per-event/category/global preferences, versioned reminders, organiser broadcasts, frozen audiences, independent channels, delivery evidence and retries |
| Safety | Requirements, code-of-conduct acknowledgements, participation denial reviews and one-use guardian-consent capabilities |
| Check-in | Online/manual attendance plus signed attendee credentials, registered devices, offline manifests, encrypted sync batches and explicit conflict resolution |
| Tickets and templates | Versioned free/time-credit ticket definitions, free-only entitlement and inventory ledgers, and reusable versioned event templates with preview/materialisation audit |
| Analytics | Privacy-thresholded registration, attendance, communication and ticket aggregates with authorised formula-safe CSV export |
| Federation | Versioned privacy-safe upserts/tombstones, partner delivery ledger, signed inbound projection, retry and diagnostics |

## Canonical contracts and policy

Maintained clients parse explicit resources rather than raw Eloquent models:

- `EventListResource` and `EventDetailResource`
- `EventRegistrationResource` and `EventRosterResource`
- `EventSeriesResource` and `EventStaffResource`
- bounded resources for analytics, broadcasts, federation, templates and tickets

The detail contract separates:

- `schedule`: timezone, all-day state, publication state and operational state;
- `relationship`: engagement, registration, waitlist/offer and attendance facts;
- `permissions`: the concrete actions the caller may perform;
- `online_access`: a policy-redacted reveal state and URLs;
- `series`: named-series and recurrence/occurrence metadata.

Keep these axes separate. A legacy RSVP must not be treated as canonical registration where registration answers, agenda resources, capacity, reminders, or protected online access are involved.

## Core architecture

| Responsibility | Primary implementation |
| --- | --- |
| Legacy compatibility and discovery facade | `app/Services/EventService.php` |
| Lifecycle, publication and immutable history | `EventLifecycleService.php`, `EventPublicationWorkflowService.php`, `EventLifecycleHistoryQueryService.php` |
| Policy and field-level capabilities | `app/Policies/EventPolicy.php`, `EventRegistrationPolicy.php`, `EventTemplatePolicy.php` |
| Registration and waitlist | `EventRegistrationService.php`, `EventWaitlistService.php` |
| Registration forms/invitations/guests | `EventRegistration*Service.php`, `EventInvitation*Service.php` |
| Attendance and optional credit claims | `EventAttendanceService.php`, `EventCreditService.php` |
| Staff and People workspace | `EventRoleService.php`, `EventPeopleService.php`, `EventPeopleBulkService.php` |
| Agenda | `EventSessionService.php` |
| Recurrence and calendar | `EventRecurrenceService.php`, `EventCalendarService.php` |
| Reminders and notifications | `EventReminder*Service.php`, `EventNotification*Service.php` |
| Broadcasts | `EventBroadcast*Service.php` |
| Offline check-in | `EventCheckin*Service.php`, `EventOfflineCheckin*Service.php` |
| Tickets, templates, analytics and safety | their respective `EventTicket*`, `EventTemplate*`, `EventAnalytics*`, and `EventSafety*` services |
| Federation | `EventFederation*Service.php` |

Controllers authenticate, validate and delegate. Cross-aggregate side effects use the Events domain outbox and consumer-specific ledgers rather than reopening business decisions in a queue worker.

## Lifecycle, registration and capacity

Publication and operation are separate state machines. Lifecycle mutations lock the current event row, increment its lifecycle version only for a real transition, and treat an already-reached target as a no-op. Recurring-series operations coordinate through the canonical template lock before enumerating occurrences; child facts retain audit/federation evidence while one root notification carries the deduplicated affected audience. They write history in the transaction and reconcile search, reminders, communications, calendar and federation projections through durable work. The private manager history API and its React, accessible, and native views page through that immutable evidence with an event-bound cursor. Caller-supplied expected versions are used by bounded subdomains such as agenda and reminders, but are not part of the top-level publication lifecycle contract.

Registration has independent states such as invited, pending, confirmed, declined and cancelled. Interest is not registration. Capacity and waitlist actions lock their authoritative rows, and a full event issues a bounded offer rather than silently overbooking. Offer acceptance is available to the authenticated member even when email is disabled; email is an optional delivery channel, not the authority.

Registration forms are versioned after publication. Answers are encrypted and excluded from ordinary models/resources. Every authorised read or export records per-field access evidence; sensitive fields require an explicit elevated capability. CSV export is bounded and formula-safe. Retention first produces a dry-run and then applies only that reviewed run.

Ticket definitions have independent allocation, eligibility, sales-window and per-member rules. Only an authenticated member with a confirmed canonical registration can claim a free entitlement. Allocation and cancellation are idempotent, append entitlement and inventory evidence, and never mutate a wallet. When a confirmed registration exits—including an event lifecycle cancellation—its linked free entitlements are released in the same database transaction so inventory cannot remain stranded. Time-credit definitions may be prepared as drafts, but they cannot be activated, materialised, cancelled as a refund, or represented as settled. Money checkout is outside the Events contract. Registration lifecycle notifications remain authoritative; Events does not send payment receipts or refund messages for these zero-value entitlements.

## People, agenda and check-in

The organiser People workspace is server-paginated and projects only the fields needed for registration/waitlist/attendance operations. Staff roles are capability-scoped; being assigned to check-in does not grant finance, registration-answer, broadcast, or ownership permissions.

Agenda sessions have their own optimistic version and history. Public, registered and staff visibility are derived from current canonical facts. Session capacity is checked on every new or reactivated place, and idempotent replay returns a self-consistent current projection. Resource URLs are decrypted only for the permitted audience.

Online attendance and offline scanning converge on the attendance ledger. Offline QR payloads are signed and short-lived; server-issued device secrets and queued payloads are encrypted; manifests are bounded; repeated scans are idempotent; conflicts are staged for explicit resolution. Manual search remains available when a camera or network is unavailable.

## Reminders, broadcasts and notification preferences

The canonical defaults are:

- reminder mode: `canonical`;
- notification delivery: `outbox_authoritative`;
- notification outbox consumer: enabled.

Explicit environment and tenant overrides are preserved for controlled compatibility. Existing installations do not switch modes merely because code defaults changed.

Preferences resolve from global Events settings through category and event overrides. Channels are evaluated independently. Deferred email rows carry tenant/event context so the digest and instant workers recheck the current feature state, channel permission and cadence immediately before sending. Routine traffic is suppressed when Events is disabled; already-committed cancellation/retraction safety messages remain eligible according to current global Events consent. Legacy queue rows without event context retain their established global behaviour.

Every recipient-facing render must run inside `LocaleContext::withLocale($recipient, ...)`. Outbox payloads and delivery evidence must not contain raw email addresses, meeting URLs, registration answers, message bodies, offline secrets, or provider errors.

Organiser broadcasts use an authorised, frozen audience snapshot, preview counts, scheduled/revised/cancelled state, per-recipient locale, channel preference checks, delivery evidence and retry diagnostics. Audience membership is not recalculated midway through a send.

Organiser broadcast and invitation emails treat the community's default email cadence (`off` out of the box) as "no choice made" and send at once; a member's own cadence choice, including `off`, and the `email_events` opt-out still apply. `events:process-broadcasts` runs in the background every minute and keeps claiming batches while work is due, for up to `events.broadcast.budget_seconds` (default 50); retry and stale-claim limits are in `config/events.php` under `broadcast`. Each run also closes any broadcast left "sending" with no active deliveries. The list and detail endpoints accept `?include=summary` for an excerpt and identity-free counts of skipped and undelivered deliveries by reason. The local Docker stack has no scheduler container: run `php artisan schedule:work` (or `events:process-broadcasts`) in `nexus-php-app` to send broadcasts locally.

## Recurrence, calendars and federation

Recurrence uses `sabre/vobject` through the Events recurrence service. Store UTC timestamps with an explicit IANA timezone, stable occurrence key and immutable canonical UTC recurrence identity. Reject invalid zones, DST gaps and ambiguous fall-back wall times; test month-end and DST boundaries. Named series and recurrence templates remain explicit concepts.

The maintained “this and future” contract is preview-first: `POST /v2/events/{occurrenceId}/recurrence-revisions/preview` returns a bounded, participant-redacted impact projection and short-lived confidential token, and `/commit` requires that token plus `Idempotency-Key`. Commit rechecks the root, rule, revision and materialized-set versions/checksum under deterministic locks, appends immutable effective-dated revision and occurrence evidence, preserves occurrence/event identities, skips fields customized on individual occurrences, and emits at most one aggregate root update notification. Rolling materialization cumulatively applies the latest effective blueprint so later children inherit the revision. Rule-shape changes that cannot preserve ordinal mapping fail with an explicit reconciliation-required conflict; unmatched rows are never hard-deleted. Single-occurrence writers append `customized` evidence through `EventRecurrenceRevisionService::recordOccurrenceState()` in the same transaction; replay is a no-op and an existing member does not advance the materialized-set version. Revision and occurrence ledgers retain the numeric actor ID as an immutable pseudonymous audit reference without a user foreign key, so account erasure cannot delete evidence or be blocked by it.

Maintained clients discover recurrence support through authenticated `GET /v2/events/recurrence-capabilities` inside the tenant Events feature boundary. Its versioned, allowlisted payload reports the active engine, structured-input support, the four supported frequencies, the bounded occurrence cap, supported end types and separate rolling-never, effective-revision and definition-blueprint booleans. It fails closed under partial rollout: advanced flags default false, `never` disappears without a healthy rolling materializer, and `schema_ready` plus `rollout_state` communicate only the safe client behavior rather than internal diagnostics. Clients must use this contract instead of inferring capability from deployment version or endpoint presence.

Definition propagation is a separate, disabled-by-default canary boundary (`EVENTS_RECURRENCE_DEFINITION_BLUEPRINTS_ENABLED=false`) and also requires both the V2 writer and rolling materializer flags. A manager explicitly previews and commits a versioned manifest from one concrete V2 occurrence through `/v2/events/{occurrenceId}/recurrence-definition-blueprints/{preview,commit}`. The manager-authorized `GET /v2/events/{occurrenceId}/recurrence-definition-blueprints` endpoint provides bounded version-cursor history with sections, counts, hashes and pseudonymous actor evidence, but never returns manifest values or staff identities. Only selected agenda definitions, ticket-type definitions, registration settings plus a published form, published safety requirements, and explicitly opted-in active staff assignments are eligible. Session times, sales/registration windows, staff expiry and cutoffs are stored as offsets from the source occurrence and projected from each new occurrence's UTC start, preserving local recurrence behavior across DST. Protected resource URLs remain ciphertext in the at-rest manifest and API projections return counts/conflict codes, never manifest values or staff identities.

Blueprints apply transactionally and idempotently only when a concrete occurrence is newly inserted, with immutable application hash/version evidence. They never silently backfill existing occurrences. Registrations, waitlists, entitlements, inventory claims, submissions, answers, guests, invitations, attendance/check-in, broadcasts, reminder preferences, notifications/outbox/deliveries, analytics, federation delivery, financial settlement and prior audit rows are prohibited families. Active time-credit ticket definitions fail closed because wallet settlement is not part of this propagation contract; paused ticket state is operational and is captured as a draft definition. There is intentionally no client UI in the initial server/API slice.

The older `PUT /v2/events/{id}/recurring` `scope=all` compatibility path means “all remaining occurrences from the current time”, not “from the selected occurrence”. Maintained clients must use recurrence revision preview/commit for an explicit selected boundary. V2 recurrence rollout remains disabled by default until those clients adopt the contract.

Calendar feeds use revocable tokens, bounded ranges and policy-filtered projections. ICS output uses stable UIDs and standards-compliant escaping/serialization. Protected meeting links and private resources do not enter a calendar projection.

Federation sends only the versioned allow-listed event projection. Visibility removal, cancellation, archive and deletion produce tombstones. Partner failures remain in a tenant-scoped delivery ledger for retry; stale inbound versions cannot overwrite a newer local projection.

## Maintained clients

- React: `react-frontend/src/pages/events/` and typed APIs/schemas under `react-frontend/src/lib/`.
- Accessible HTML-first frontend: `app/Http/Controllers/GovukAlpha/Concerns/Event*Parity.php` and `accessible-frontend/views/event*.blade.php`.
- Native mobile: `mobile/app/(tabs)/events.tsx`, event modal screens, `mobile/components/events/`, and `mobile/lib/api/event*.ts`.

Essential attendee operations have a non-camera and HTML-first path. Do not add a backend capability without adding or explicitly bounding its React, accessible and native use.

## Operations and diagnostics

Useful commands include:

```bash
php artisan events:integrity-audit --dry-run --json
php artisan events:health
php artisan events:queue-reminders
php artisan events:process-notification-outbox
php artisan events:process-broadcasts
php artisan events:process-federation
php artisan events:expire-waitlist-offers
```

Use `php artisan list`/`schedule:list` for the exact registered signatures. Integrity and repair commands are dry-run first. Never replay notifications, repair production data, rotate credentials, or deploy without explicit authorization.

## Validation

The deterministic root harness creates and removes an isolated MariaDB database:

```bash
node scripts/test-events.mjs --php-only --php-batch=contract
node scripts/test-events.mjs --php-only --php-batch=registration
node scripts/test-events.mjs --php-only --php-batch=notifications
node scripts/test-events.mjs --php-only --php-batch=agenda
node scripts/test-events.mjs --php-only --php-batch=forms
node scripts/test-events.mjs --php-only --php-batch=offline
node scripts/test-events.mjs --react-only
node scripts/test-events.mjs --mobile-only
```

Before release, also run the full Laravel/PHPStan, React build/typecheck, accessible build/PHP/a11y, i18n, SPDX, documentation, changelog, version, licence, migration-safety and browser persona gates documented in `AGENTS.md`.

## Failure and recovery rules

- Disable the affected producer/consumer flag before investigating a duplicate, privacy leak, cross-tenant mutation or backlog.
- Preserve additive schema and immutable lifecycle, attendance, registration, outbox, delivery and audit evidence during application rollback.
- Do not use destructive migration rollback for ledgers containing evidence.
- Do not auto-refund time credits or replay notifications. Reconcile from the ledgers after a reviewed dry run.
- Treat suppressed delivery as an intentional policy outcome, not a transport failure.
- Keep Events disabled for member-facing/routine work while still allowing committed cancellation, retraction, financial reconciliation and audit work to settle safely.
