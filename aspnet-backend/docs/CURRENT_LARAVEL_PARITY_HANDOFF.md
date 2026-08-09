# Laravel Backend Contract-Parity Handoff History

Last reviewed: 2026-07-14

Status: **Historical archive — not a current status or resume source**

> **Historical archive — not current status.** For backend status or resumption,
> read `docs/CURRENT_ASPNET_CONTRACT_STATUS.md`, then
> `docs/FULL_PARITY_REMEDIATION_RUNBOOK.md`. Do not copy a score, route count,
> queue, or dirty-worktree statement from this archive into a status report.
> Every “latest”,
> “current”, “previous”, score, route count, and test count below is historical
> evidence scoped to its checkpoint date; none overrides the current status
> document.

This file preserves detailed implementation history and older verification
commands. Regenerate live state at named Laravel and ASP.NET SHAs before editing
code or claiming progress.

## Historical Checkpoints

### 2026-07-14 Zero Active Static Gaps And Retired Vetting Writes

The seven apparent remaining gaps were stale OpenAPI-only document-era vetting writes,
not current Laravel routes. Laravel deliberately removed generic create/bulk/update/
delete/upload/verify/reject, its controller prohibits sensitive evidence, its feature
tests assert 404/405, and canonical React uses only the replacement metadata workflow.
The comparator now conditionally retires those entries only while live Laravel route
files omit them. Fixture proof passes, and the live result is 2,601/2,601 active
operations matched with zero missing plus seven retired OpenAPI-only operations.

ASP.NET runtime proof confirms all seven removed methods return Laravel-compatible
404/405 without changing either legacy or current vetting rows. Implementation remains
875/1000; certification is 755/1000; the combined estimate is 80%. Static route parity
is closed, but the goal remains active. Resume with real fiat settlement and the
broader complete-suite/CI, unchanged-frontend runtime, schema/localization, federation-
transport, and live-provider certification queue.

### 2026-07-14 Prerender Invalidation And Reset-All

The external invalidation alias now matches Laravel's bearer/HMAC/platform-super-admin
authentication modes, timestamp and replay protection, route canonicalization and
500-route bound, external rate limit, active-tenant lookup, real safe bundle-deletion
count, durable recache job, and audit envelope. Recache intent commits before deletion;
filesystem containment rejects traversal, encoded separators, reparse/symlink escapes,
and status-bearing snapshots. The admin control plane now requires platform-super-admin
privilege, while the explicitly anonymous webhook still performs its own authentication.

Reset-all requires the exact confirmation, rate-limits the operator, serializes global
state, cancels/fences older work, creates one global high-priority force rebuild with a
fresh active-tenant route count, transactionally audits it, and returns 202. Focused
runtime proof passes 7/7 on isolated PostgreSQL; the combined admin ownership gate
passes 121/121; comparator fixtures and Debug/Release builds are green. The live
comparator is 2,601/2,608 with only the seven document-era vetting writes missing.
Provisional scores are 875/1000 implementation, 750/1000 certification, and 79%
overall. Resume by tracing those legacy routes against the forward-only safeguarding
model; never let document evidence authorize contact. Fiat settlement, complete-suite/
CI, unchanged-frontend smoke, schema/localization depth, federation transport, and
live-provider certification remain open.

### 2026-07-14 Group Auto-Assignment Workflow

Administrator group auto-assignment list/create/update/delete now use a typed
`group_auto_assign_rules` aggregate rather than recorded-only compatibility writes.
The workflow matches Laravel's partial update fields, allowed types, default active
state, canonical list projection, statuses, and data/meta envelopes. Same-tenant group
checks conceal foreign identifiers; list excludes poisoned cross-tenant joins; update
and delete lock the tenant row; and every mutation writes actor/before/after audit data
inside the same serializable transaction.

Migration 146 applies on both maintained disposable PostgreSQL histories. Focused
proof passes 2/2 on each, the focused plus route-ownership gate passes 116/116, model
drift is clean, comparator fixtures pass, and Debug/Release builds have zero errors.
The live comparator reports 4,551 ASP.NET operations and 2,599/2,608 matched with nine
static misses. Provisional global scores are 870/1000 implementation, 745/1000
certification, and 78% overall. Resume with the two prerender operations; keep the
seven document-era vetting writes gated until their legacy-evidence safety contract is
traced. Real fiat settlement, complete-suite/CI, unchanged canonical frontend smoke,
schema/localization depth, federation transport, and live-provider certification
remain open.

### 2026-07-14 Podcast Artwork Uploads

The canonical React show-artwork and episode-cover multipart calls now have explicit
legacy and V2 owners. Both require the `image` field, use the platform image allowlist,
persist tenant/subject-bound files, return the canonical nested URL envelope, reset
approved content to pending moderation, and roll back staged files after not-found,
forbidden, validation, or persistence failures. Ownership is creator-or-admin, tenant
lookups fail closed, and a dedicated authenticated policy matches Laravel's 10 uploads
per 60 seconds.

Focused controller/runtime proof passes 4/4; route ownership passes 114/114; comparator
fixtures pass; and Release builds have zero errors. The live comparator reports 4,550
ASP.NET operations and 2,598/2,608 matched with 10 static misses. Provisional global
scores were 865/1000 implementation, 740/1000 certification, and 77% overall. Resume
with prerender or group auto-assignment; keep the seven document-era vetting writes
gated until their legacy-evidence safety contract is traced. Real fiat settlement,
complete-suite/CI, unchanged canonical frontend smoke, schema/localization depth,
federation transport, and live-provider certification remain open.

### 2026-07-14 Atomic Notification Settings

The canonical React settings save now owns all three Laravel persistence domains in
one serializable tenant/user transaction: general/federation flags on the user, match
frequency/hot/mutual fields on the unique match-preference row, and global activity-
digest cadence in the notification-settings ledger. Every canonical boolean is
required and typed, weekly values normalize to monthly, invalid input produces no
partial write, and the response returns the canonical saved projection. A dedicated
authenticated fixed-window policy enforces Laravel's 10 updates per 60 seconds.

Migration 145 adds the exact four canonical columns with safe defaults and applies to
upgraded and blank-chain disposable PostgreSQL. Model drift is clean; focused proof
passes 2/2 on each database; the affected member-settings set passes 6/6; route
ownership passes 114/114; comparator fixtures pass; and Debug/Release builds have zero
errors. The live comparator reports 4,546 ASP.NET operations and 2,596/2,608 matched
with 12 static misses. Provisional global scores were 860/1000 implementation, 735/1000
certification, and 76% overall. Resume was podcast artwork, prerender, or group auto-
assignment; keep the seven document-era vetting writes gated until their legacy-
evidence safety contract is traced. Real fiat settlement, complete-suite/CI, unchanged
canonical frontend smoke, schema/localization depth, federation transport, and live-
provider certification remain open.

## Objective

Make the ASP.NET backend contract-compatible with the Laravel backend so both
unchanged canonical frontends can run against either backend by configuration
only:

| Frontend | Laravel backend | ASP.NET backend |
| --- | --- | --- |
| Canonical Laravel React | Production source-of-truth baseline | Contract-correct and runtime-certified |
| Shared accessible Web UK | Laravel-first implementation and certification | Same Web UK code and workflows, runtime-certified after backend parity |

The target is not "similar behavior". The target is compatible methods, paths,
aliases, request bodies, query strings, multipart fields, response envelopes,
pagination metadata, validation errors, status codes, auth behavior, tenant
behavior, upload behavior, feature flags, realtime/bootstrap config, and
workflow side effects.

## Source Of Truth

| Surface | Source |
| --- | --- |
| Laravel backend | `C:\platforms\htdocs\staging` |
| Laravel OpenAPI | `C:\platforms\htdocs\staging\openapi.json` |
| Laravel routes | `C:\platforms\htdocs\staging\routes` |
| Laravel React frontend contract | `C:\platforms\htdocs\staging\react-frontend` |
| Laravel accessible browser contract | `C:\platforms\htdocs\staging\accessible-frontend` and `routes\govuk-alpha*` |
| ASP.NET backend target | `C:\platforms\htdocs\asp.net-backend` |
| Shared accessible frontend target | `C:\platforms\htdocs\asp.net-backend\apps\web-uk` |

The Laravel repo is read-only reference material from this workspace. Do not
edit it, deploy it, run destructive commands in it, or touch Laravel production
containers from this repo.

## Non-Negotiable Rules

- Do not recreate `apps/react-frontend/`. It was deleted on 2026-08-09; this
  repository has no React frontend.
- Do not make the Laravel React frontend weaker or add ASP.NET-specific frontend
  branches to hide backend incompatibility.
- Do not claim 1000/1000 parity until generated docs show no open gaps and
  runtime smoke tests prove the Laravel React frontend can exercise the ASP.NET
  backend without contract failures.
- Do not overwrite dirty files created by another active agent. Check status and
  diffs before editing.
- Keep generated scratch artifacts out of committed docs unless curated into a
  maintained map.

## Historical Detailed Backend Record

The remaining sections preserve dated evidence and old queue state. They are
not the current score, current blocker list, or current resume point.

### Latest Verified Backend Slice At That Checkpoint — 2026-07-12

The latest backend-only slice closes all eight Event People workspace routes:
redacted roster listing, formula-safe CSV export, bounded bulk operations,
per-member unified history, attendance transitions, and manager
approve/reject/cancel. The strict React projections expose no email, notes, or
other sensitive attendance detail. Attendance writes enforce expected versions,
action-scoped idempotency, manager/tenant boundaries, and check-in/check-out/
no-show/undo transition rules; bulk operations return isolated per-row results.

Migration `20260712221737_EventPeopleAttendanceWorkflowParity` safely backfills
existing attendance facts to version 1 with state/check-in/check-out timestamps
and adds exact append-only `event_attendance_activity`. All 124 migrations
replayed on blank disposable PostgreSQL, EF model drift is clean, and focused
privacy/history/manager/attendance/bulk/CSV/tenant proof passed 4/4.

The live comparator now reports 4,461 ASP.NET operations, 2,541/2,592 matched,
and 51 missing. The schema comparator reports 377 Laravel migration files, 132
ASP.NET migration source files, 130 runtime IDs, 383 ASP.NET table names, 192
exact matches, 263 missing Laravel names, and 191 ASP.NET-only names.

Event Ticketing is the latest completed backend slice. All nine catalogue,
quote, type lifecycle, allocation, cancellation, and reconciliation route
shapes are owned under both prefixes. Free allocation requires a confirmed
registration and serialized capacity/per-member limits; time-credit
materialization fails closed with HTTP 503 and no entitlement write. Type,
entitlement, and inventory changes are versioned and idempotent, and focused
strict-projection/provider/tenant/lifecycle proof passed 4/4.

Migration `20260713025352_EventTicketingWorkflowParity` adds all five exact
Laravel ticketing tables, 27 checks, and 12 validation/immutability/no-delete
triggers. Blank PostgreSQL replay applied 130/130 migrations, EF reports no
model drift, and an invalid occurrence insert failed with PostgreSQL `P0001`.

Event Safety is the latest completed backend slice. Requirements use versioned
draft/publish/archive heads plus immutable snapshots and history. Code-of-
conduct evidence is append-only and policy-hash bound. Guardian identity and
email are protected at rest; capability tokens are one-shot SHA-256 verifiers,
delivered through the real email boundary, publicly granted through a non-
enumerable response, and recorded in versioned history. Participation denials
and withdrawals are manager-only, versioned, tenant-scoped, and projected with
privacy-safe member/reviewer history. Focused lifecycle/privacy/tenant proof
passed 4/4.

Migration `20260713015034_EventSafetyWorkflowParity` adds all eight exact
Laravel safety tables, eight workflow checks, and thirteen immutability/no-
delete triggers. Blank PostgreSQL replay applied 129/129 migrations and EF
reports no model drift.

Event Offline Check-in is the latest completed backend slice. All fourteen
workspace, credential, device, manifest, sync, batch, conflict, resolution, and
online-scan routes are owned under both route prefixes. Credentials are PII-free
Ed25519 `nqx2` tokens with deterministic public verification keys and one-way
server verifiers; credential and device secrets are one-shot and never returned
on idempotent replay. Sync batches, immutable submitted items, append-only
decisions, attendance transitions, and conflict resolution are tenant-scoped,
versioned, and idempotent. Strict projections match the canonical React schemas
and redact contact, profile, credential, and device-secret material.

Migration `20260713004944_EventOfflineCheckinWorkflowParity` adds all five exact
Laravel table names, 21 workflow checks, and seven append-only/no-delete
triggers. All 128 migrations replayed on blank disposable PostgreSQL, EF model
drift is clean, direct item tampering failed with PostgreSQL `P0001`, and focused
signed-token/device/manifest/sync/conflict/privacy/tenant proof passed 4/4.

Event Calendar is the latest completed backend slice. Its seven calendar,
ICS/action, feed-token, and anonymous personal-feed routes now share one
identity-free lifecycle projection; use hashed one-time secrets with owner and
revocation enforcement; and restrict personal feeds to confirmed canonical
registrations. Focused proof is 4/4; blank migration replay is 127/127 with no
EF model drift. No production resource was touched.

Event Staff is the latest completed backend slice. Its list/grant/revoke routes
now use real tenant-scoped assignments, the canonical capability map, effective
expiry semantics, contained co-organizer delegation, operation-bound
idempotency, monotonic history, and domain-outbox evidence. Focused proof is
4/4; blank migration replay is 126/126 with no EF model drift and both staff
history immutability triggers present. No production resource was touched.

Event Agenda is the latest completed backend slice. All seven Laravel/React
agenda routes are owned under both route prefixes with real versioned,
idempotent persistence, member visibility/registration/capacity behavior,
protected resources, collision checks, and durable evidence. Focused proof is
4/4; blank migration replay is 125/125 with no EF model drift and all three
agenda immutability/no-delete triggers present. No production resource was
touched.

The latest backend-only slice closes canonical event registration confirm and
withdraw plus waitlist join, leave, and active/tokenized offer acceptance.
Transitions serialize on tenant/event capacity, maintain monotonic registration
and queue versions, replay action-scoped idempotency, append immutable history,
and record domain outbox evidence. Capacity release promotes the oldest waiting
entry to a 24-hour offer; acceptance atomically consumes the offer and creates
or reactivates confirmed registration. Queue cycles preserve their sequence and
full evidence.

Migration `20260712214912_EventRegistrationWaitlistLifecycleParity` safely
upgrades existing audience rows with deterministic pool/version/timestamp and
queue-sequence backfills, adds exact `event_registration_history` and
`event_waitlist_entry_history` tables, and installs PostgreSQL immutability
guards. All 123 migrations replayed on blank disposable PostgreSQL, EF model
drift is clean, and focused capacity/queue/offer/idempotency/tenant proof passed
4/4.

The preceding registration/waitlist checkpoint reported 2,482/2,592 matched
and 110 missing, with 164 exact schema names. The newer Event People baseline
above supersedes those counts.

The latest backend-only slice closes all eight event-broadcast route shapes:
list/show/preview/create/revise/schedule/cancel/retry across `/api` and
`/api/v2`. It implements the strict canonical React projections, manager
authorization, optimistic versions, action-bound idempotency, exact organizer
prose preservation, and private/no-store responses. Scheduling deliberately
uses only canonical registration, waitlist, and attendance ledgers, applies
safeguarding contact policy, and freezes durable recipient/channel deliveries;
legacy RSVP rows are not an audience fallback.

Migration `20260712204651_EventBroadcastWorkflowParity` adds those three
canonical audience ledgers and four exact Laravel broadcast/evidence tables.
PostgreSQL enforces state values, aggregate identity, lifecycle/version
transitions, post-draft content freeze, terminal immutability, delivery
transitions, and append-only history/attempt evidence. All 122 migrations
replayed on blank disposable PostgreSQL, EF model drift is clean, and focused
HTTP/database proof passed 4/4.

The preceding event-broadcast checkpoint reported 2,477/2,592 matched and 115
missing, with 162 exact schema names. The newer registration/waitlist baseline
above supersedes those counts.

The latest backend-only slice closes Laravel's event-template workflow across
both `/api` and `/api/v2`: safe capture preview/capture, list/show/history,
revision, archive, materialization preview, and materialization. Capture uses a
strict allowlist; versions, audit, and materialization evidence are immutable;
mutations are tenant-scoped, idempotent, and optimistic-versioned; and a
materialized event is always a fresh private non-federated record without
copied operational state. Migration `20260712191551_EventTemplateWorkflowParity`
adds the four exact Laravel tables and safe event fields. All 121 migrations
replayed on blank disposable PostgreSQL, EF model drift is clean, focused proof
passed 4/4, and the combined event lifecycle/template gate passed 8/8.

The preceding event-template checkpoint reported 4,368 ASP.NET operations,
2,469/2,592 matched, and 123 missing, with 155 exact schema names. The newer
event-broadcast baseline above supersedes those counts.

The current backend-only slice implements Laravel's metadata-only safeguarding
attestation model, onboarding/admin/member workflows, message restriction
lifecycle, direct-send and voice hardening, durable direct-message state, and
the group-exchange policy cutover. Laravel at `C:\platforms\htdocs\staging` and
the canonical React frontend remain read-only sources of truth. No frontend
file was intentionally changed by this slice; preserve the unrelated dirty
`apps/web-uk` workstream.

Five exact Laravel tables now store only safeguarding metadata:
`tenant_safeguarding_settings`, `member_vetting_attestations`,
`member_vetting_attestation_events`, `safeguarding_vetting_review_requests`,
and `safeguarding_policy_rotation_events`. New contact policy never trusts a
legacy `VettingRecord`. Attestation and rotation events are append-only, direct
attestation deletion is blocked outside an explicit principal cascade, and the
new controllers reject certificate files, reference numbers, arbitrary status,
free text, expiry dates, and other sensitive evidence fields.

Focused route owners cover onboarding option read/save, member preference and
vetting status/policy-review/review-request/revoke, administrator or broker
vetting list/stats/policy/rotation/review/confirm/revoke, and safeguarding
option CRUD/reorder. Option mutations validate the Laravel trigger/type
catalog, serialize writes, protect options used by live selections, re-evaluate
affected members, and audit. The rate buckets are onboarding 5/minute, option
mutation and vetting decision 60/minute, policy update 20/minute, policy
rotation 5/minute, member mutation 10/minute, and message restriction status
30/minute, with canonical vetting 429 headers and `errors[]`.

Message restriction status and admin monitoring now use live persisted state.
Expired monitoring is cleared, `messaging_disabled` is exposed and mutated,
the reason and tenant/user boundary are validated, and removal clears the
safeguarding-created approval state. The physical
`user_monitoring_restrictions.messaging_disabled` column is an explicit adapter
for Laravel's `user_messaging_restrictions`, not an identical-schema claim.

Direct sends now use detected attachment content, full staged/partial cleanup,
plain-text sanitization and Unicode length, deterministic first-conversation
locking, Laravel's same-tenant inactive-recipient behavior, corrected inbox
partner identity/attachment aliases, and awaited notification/XP/realtime
effects. Blocked POST attempts create the staff safeguarding alert once;
read-only loads do not. Voice messages use a separate detected-audio policy,
preflight plus locked policy recheck, one transaction for every persisted row,
independent rollback/file cleanup, minimum-one-second duration, and normal
message effects. Spoofed audio and restricted senders leave no ghost data or
files. Provider transcription remains open.

The direct-message P0 state contract is now implemented. Sender-only edit
accepts React's `body`, enforces the 24-hour window, sanitizes and rechecks the
current policy, and persists edited metadata. Message delete is participant-
scoped and records durable `scope=self|everyone` visibility instead of hard
deletion. Conversation archive/restore treats the route id as the partner user,
uses per-user state, separates active and archived inboxes, excludes hidden
rows from unread results, and restores the caller's view without deleting
history.

Group exchange now follows Laravel's create/add role order, participant identity
and dual-role semantics, caller-visible status, lifecycle guards, deterministic
locks with caller-order policy evaluation, canonical provider transaction rows,
hidden ledger adapters, and exact failure contracts. Conservation,
idempotency, and first-writer race behavior have focused coverage; frontend
runtime and notification depth remain open.

The current latest migration is
`20260712221737_EventPeopleAttendanceWorkflowParity`, runtime ID 124. The historical
checkpoint below describes migrations 112 through 116; later group and event
workflow evidence is recorded at the start of this section and in the
maintained runbook.
Migration 112 creates the five safeguarding tables and legacy-redaction/policy-
review fields; migration 113 adds `messaging_disabled`; migration 114 widens
preference values, makes consent time required, installs unique
tenant/user/option selection, and cascades tenant/option dependencies. A blank
The preceding safeguarding replay applied all 114 migrations to blank
PostgreSQL. A valid populated 113-to-114
upgrade preserved rows and filled null consent time from `CreatedAt`; a
duplicate tenant/user/option fixture raised `P0001` before DDL or data mutation,
left history at 113, and left no partial migration-114 schema. Exact catalog
containment is green. Migration 115 adds durable edit/delete/archive state with
false/null defaults and a nullable deletion-audit user relationship using
`ON DELETE SET NULL`. Blank 115 and populated 114-to-115 PostgreSQL replays are
green; existing content and read timestamps were preserved. It is forward-only,
and `has-pending-model-changes` is green. No production resource was touched.

Migration 116 adds Laravel's snake_case `message_reactions` table with
`id`, `tenant_id`, `message_id`, `user_id`, `emoji`, and `created_at`, cascading
tenant/message/user foreign keys, lookup indexes, and the exact unique
tenant/message/user/emoji key. A blank all-migrations PostgreSQL replay through
116 passed, catalog inspection matched, and `has-pending-model-changes` is
green.

The coordinator-help P1 contract is now real rather than a compatibility stub.
Both route aliases re-evaluate the current tenant-scoped safeguarding policy,
reject self/nonpositive, missing/cross-tenant, unrestricted, and unavailable
requests with Laravel-style HTTP 422 `errors[]`, and only deliver for
`VETTING_REQUIRED` or `SAFEGUARDING_CONTACT_RESTRICTED`. Active tenant staff in
Laravel's admin/tenant-admin/broker/super-admin roles receive an in-app bell and
email; a PostgreSQL transaction advisory lock and persisted notification
signature suppress successful repeat delivery for ten minutes without
suppressing retries after delivery failure or a no-staff result. Every accepted
request writes an audit row. The independent authenticated limit is 5 requests
per 300 seconds. Focused PostgreSQL coverage passed 16/16 and route ownership
passed 1/1; the disposable external test hook was removed after verification.

Durable message reactions and batch aggregation are also complete. Adds use the
exact six-emoji allowlist and current ordinary/safeguarding contact checks;
withdrawal remains available after a later block or policy closure. Concurrent
toggles serialize, participant-only batch reads expose Laravel
`emoji/count/user_ids` groups including soft-deleted messages, and toggle/batch
use independent 60/minute and 30/minute buckets. Focused PostgreSQL plus route
ownership coverage passed 9/9.

Typing indicators are also complete. React's `recipient_id/is_typing` request
now runs the full direct-message preflight before any event, works before a
conversation exists without creating one, and sends exact `typing`
`user_id/is_typing` data to the recipient's
`private-tenant.{tenantId}.user.{recipientId}` Pusher channel. The publisher
constructs and signs Pusher's REST event request; delivery remains best-effort
when credentials or the provider are unavailable. The response contains only
`data.sent`, and the route has its own 60/minute bucket. Focused endpoint/route
coverage passed 7/7 and the signed transport test passed 1/1.

Read/unread is now complete for the canonical React contract. `GET
/api/v2/messages/unread-count` applies receiver archive/delete visibility and
returns only `data.count`; `PUT /api/v2/messages/{otherUserId}/read` resolves a
tenant-scoped partner conversation, marks only that partner's unread messages,
returns only `data.marked_read`, and emits no Laravel-absent V2 read-receipt
event. The operations have independent authenticated 60/minute buckets. Route
and policy ownership passed 1/1, focused disposable-PostgreSQL runtime passed
3/3, and the combined messaging regression passed 44/44.

The final deterministic direct-message state gate passed 39/39 with zero
failed or skipped, covering migration/model contracts, edit/delete,
archive/restore, concurrency, rate limits, unread metadata, sanitizer oracles,
and corrected route ownership. The broader exact regression completed 57/58; its sole failure was
an existing first-writer race that subsequently passed in isolation. A separate
class aggregate completed 12/13 and was interrupted only by a disposable
PostgreSQL OOM kill (`exit 137`); the race was green in isolation. Do not call
either aggregate fully green. The full ASP.NET suite, CI, unchanged-frontend
runtime smoke, and backend 1000/1000 remain open.

The preceding backend slice implements Laravel's canonical volunteer-hours ledger
without modifying the read-only Laravel source, canonical React frontend,
frozen legacy React copy, or concurrent `apps/web-uk` workstream. One
`VolunteerHoursService` now owns member list/create/summary/pending-review/
verify, organisation pending review, administrator list, and administrator
verify across all eight Laravel method/path pairs. It replaces the former 503
and recorded-only paths with tenant-scoped locked `vol_logs`, strict action and
request parsing, surface-specific status/error envelopes, feature/policy gates,
and independent rate limits.

Approving a whole-hour log atomically mints the personal time-credit transaction,
records the organisation payment, permits Laravel's negative organisation
balance, and writes the configured volunteer-hour XP exactly once. Sub-hour
approval awards XP but creates no rounded-zero personal or organisation ledger
rows. Replayed payout and XP evidence must match the tenant, user, organisation,
type, amount, status, source, and reference; conflicting evidence aborts and
rolls back instead of being reused by proximity. Caring support relationship
hour logging and decisions now use the same canonical ledger and respect the
configured flag administrators, approval-required setting, and trusted-review
policy.

Direct Caring logging accepts sub-hour values. The raw request hours drive the
whole-hour floor and regional-points calculation before the canonical stored
hours value is rounded to two decimals. Normal non-Caring reviewed decisions run
post-commit decision bell/push side effects. Approved decisions force immediate
email; declined decisions send immediate email only when the global
notification frequency is explicitly `instant`. Tenant-default frequency
fallback, daily/monthly notification-queue delivery, and recipient
locale/provider breadth remain open. The post-approval badge sweep covers every
badge family represented in ASP.NET; Laravel-only badge families and realtime
badge broadcast remain open. Reviewed Caring decisions deliberately emit no
decision bell, push, or email.

The tenant-scoped `FeedActivity` entity/configuration/service now owns the
Laravel-aligned idempotent feed projection. Approved hours publish with the
distinct `volunteer_hours` source type only when `show_on_leaderboard` permits;
the organisation-facing free-text description is never copied into feed content
or metadata. Other feed producers, admin moderation consumers, compatibility
cleanup, and historical backfill remain open.

The preceding slice implements Laravel's four-route volunteer QR-attendance
workflow. `GET /api/v2/volunteering/shifts/{id}/checkin` issues or reuses one
globally unique token for the authenticated volunteer's exact approved shift
assignment, while authorized tenant/organisation coordinators verify, checkout,
and read sanitized history. QR attendance itself still creates no hours,
transactions, balances, XP, or rewards; those effects belong only to the
separate canonical hours workflow. The outgoing `shift.completed` webhook and
child-to-parent tenant-domain inheritance remain open.

Generic organisation visibility is now status/tenant/member aware. Wallet
writes require verified organisations, canonical owners/managers/admins, and
shared lifecycle/advisory locks. Organisation deletion takes the same lifecycle
lock and refuses deletion when balance, counters, or wallet history exists; a
concurrency regression proves an in-flight wallet write wins and evidence is
retained. Membership writes prevent cross-tenant relationships and owner/admin
escalation. Wallet user search is same-tenant, active-user, name-only, excludes
the caller and suspended users, hides email, and is limited to 30/minute.

Group exchange now has server-owned draft/start/confirm/complete/cancel
transitions, immutable positive splits, role separation, all-party
confirmation, shared personal-wallet locks, and real `group_exchange` ledger
evidence. V15 community-fund summary/history, pending count, and starting
balance read persisted tenant data; starting-balance configuration is
admin-only. Compatibility donation/deposit/withdraw aliases remain explicit
HTTP 503 because no certified canonical writer exists.

Caring loyalty debits/refunds and positive hour-estate settlements now carry
authoritative tenant-composite transaction links. Legacy applied loyalty rows
without valid debit evidence cannot be reversed, preventing an unproven refund.
Legacy null links remain for manual reconciliation; they are not guessed from
amount or timestamp similarity.

At the volunteer-hours checkpoint, the then-latest migration was
`20260711192124_VolunteerHoursLedgerParity`, runtime ID 111. Its source creates
`feed_activity` and the nullable public-hours preference
alongside the hours-ledger provenance. It never inserts legacy transaction,
payment, or XP value. Uniquely provable existing evidence may be linked;
evidence-free approved whole-hour
organisation rows are downgraded to `pending`, and approved Caring sub-hour rows
remain valid without fabricated evidence. That checkpoint's non-production
certification applied all 111 migrations to a blank PostgreSQL database through
`20260711192124_VolunteerHoursLedgerParity` and directly verified the exact
13-column/eight-index `feed_activity` schema, nullable-boolean
`users.show_on_leaderboard` defaulting to `true`, all 11 column-specific
`ON DELETE SET NULL` relationships, and the volunteer-user `CASCADE`
relationship. A valid populated 110-to-111 upgrade preserved and linked existing
evidence without minting. A deliberately invalid fixture raised PostgreSQL
`P0001` atomically, left history at 110, and left no partial migration-111 DDL.
`has-pending-model-changes` is green; disposable Docker cleanup left zero
matching resources. No production resource was touched.

The Debug API/test builds and required solution-wide Release build complete with
zero errors; the only warnings are the same four pre-existing `xUnit1031`
warnings in the test project. The Release build took 4m36s. One disposable Linux run
discovered 3,007 tests and passed 53/53: all 51
`VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`.
Windows Smart App Control blocks loading the freshly rebuilt unsigned API
assembly, so the run used Linux without weakening host policy. The clean
affected rerun then discovered 3,007 tests, selected 243, and passed 243/243 with
zero failed and zero skipped in 418.639s. The full 3,007-test suite, CI, and
unchanged-frontend runtime proof remain open.

Do not report CI green. Descendant run `29154079189` was later cancelled after
its completed Integration Tests job reported 51 failures out of 2,888 tests.
Only the nested-transaction failure was a direct regression from
the preceding `bfeafb2e` slice; that case is fixed and green locally. The other
failures still require independent triage.

| Area | Verified completed behavior | Explicit remaining gap |
| --- | --- | --- |
| Safeguarding metadata and workflows | Five exact metadata-only Laravel tables, append-only event/rotation history, jurisdiction/policy services, onboarding save, member status/review/revoke, admin/broker vetting decisions, and protected option CRUD/reorder use one locked policy domain. Legacy vetting records do not authorize contact and sensitive certificate evidence is prohibited. | Dedicated permission-only roles beyond current broker/admin policy, queued email/provider depth, legacy evidence privacy disposition, non-v2 route-alias reconciliation, and frontend runtime smoke remain. |
| Messaging safety | Live `messaging_disabled` lifecycle, direct-send policy/attachment/race/side-effect hardening, staff blocked-attempt alerting, transactional detected-audio voice writes, sender-only 24-hour edit, participant-scoped durable delete, partner-ID per-user archive/restore, restricted-only coordinator help, durable policy-aware reactions, full-preflight signed-Pusher typing, and exact tenant-scoped read/unread envelopes and rates are implemented. | Provider transcription and unchanged-frontend runtime smoke remain open. |
| Roles | `CanonicalRoleSemantics` adds `is_admin`, `is_super_admin`, `is_tenant_super_admin`, and `is_god`; named policies read current DB state and reject inactive, deleted, role-drifted, or tenant-drifted users; v2 failures use canonical errors. Role-only `god` never satisfies `GodOnly`, and explicit-God targets cannot be deleted, suspended, banned, reset, or impersonated by lower privilege tiers. | Resource-level SuperPanel/hub rules, notifications, audit side effects, and full application-runtime proof remain. |
| 2FA | Password login uses opaque 64-character challenges bound to user, tenant, and TOTP enrollment; `/api/totp/verify` supports TOTP and backup codes, limits attempts, consumes successful or drifted challenges, and rechecks account/tenant state. Canonical setup/verify/disable uses a real SVG QR code, atomic enabled-state/backup-code persistence, and password-confirmed disable. Unsupported forced first-login admin enrollment now fails startup when either legacy flag is enabled instead of emitting a lockout challenge. | Challenges are process-local; trusted-device lifecycle, security notifications, a TOTP-specific encryption key, multi-node proof, and a compatible first-login enrollment client remain open. |
| Passkeys | `PasskeysController` solely owns all ten canonical `/api/webauthn/*` routes. Registration/authentication use real FIDO options; challenges expire after 120 seconds and are atomically consumed once per process; credential management uses opaque IDs scoped to the authenticated user and tenant. Password, TOTP, backup-code, or recent UV-passkey proof now issues a signed five-minute security-confirmation token, and enrollment/remove/rename/remove-all enforce its user/tenant binding. | Federated-login recent-session proof, last-sign-in-method protection, session revocation/notifications, anonymous tenantless discovery, process-local challenge state, sign-counter concurrency, multi-instance behavior, and browser smoke remain open. |
| Scheduler | Natural and manual runs share one execution gate/body; real run/registry outcomes are recorded; per-tenant jobs exclude inactive tenants and aggregate tenant failures, while guardian-consent expiry intentionally remains a global all-tenant sweep. V2 manual execution requires platform-super access. `listing-expiry`, `job-expiry`, `volunteer-expire-consents`, and `recurring-shifts` execute real jobs; unmapped jobs return 501, busy returns 409, and non-persisted/failure outcomes return 500. The list reports these four mappings active and the other 38 disabled with `execution_supported:false`. | 38 of 42 catalog jobs remain unmapped; cross-replica exactly-one execution still relies on data-level idempotence rather than a distributed job lock. |
| Broker writes | Canonical risk-tag, monitoring, unreviewed-count, and configuration aliases have one `AdminBrokerController` owner under DB-backed `BrokerOrAdmin` authorization. Monitoring persists `messaging_disabled`, expiry and reason, clears stale/removal state, and audits/notifies; tenant-wide configuration writes remain admin-only rather than allowing unsafe arbitrary broker keys. | Exact Laravel risk-tag storage, deeper notification/provider fidelity, and granular broker-safe configuration keys remain incomplete. Monitoring uses the documented `user_monitoring_restrictions` adapter. Archive reads are still compatibility scaffolding. |
| Federation partnership decisions | Canonical `/api[/v2]/admin/federation/partnerships` lists incoming and outgoing rows without changing the legacy outgoing-only route. Approve/reject require the receiving tenant, conditionally transition only `pending`, atomically persist one receiver-to-requester audit row, return Laravel status/error envelopes, and notify initiating-tenant admins only after commit. Same-action and approve-versus-reject races produce one winner and one side-effect set. | Laravel federation-level permission initialization, durable rejection actor/time/reason columns, localized link/push notifications, durable initial-sync scheduling, and canonical audit-log read visibility remain open. This is core decision-state parity, not complete federation parity. |
| Generic organisations and wallets | Public reads expose only verified/public organisations; private/pending/suspended reads require canonical tenant owner/member/admin access. Membership roles and tenant relationships are validated. Verified-only donate/transfer/admin-grant writes and deletion share lifecycle/advisory locks; deletion refuses any wallet balance, counters, or history, including an in-flight write. | Notification/audit fidelity and unchanged-frontend runtime smoke remain open. Legacy ambiguous organisation-wallet rows need the read-only operator audit and manual disposition. |
| Group exchange | Create/add/start/confirm/complete/cancel use Laravel caller and role semantics, caller-visible status, lifecycle guards, deterministic locks with caller-order policy evaluation, canonical provider transaction rows, hidden ledger adapters, all-party confirmation, credit conservation, and first-writer race handling. | Notification fidelity and frontend runtime smoke remain. Legacy one-to-one `Exchange` completion is a separate fail-closed gap. |
| V15 wallet reads and privacy | Community fund/history, pending count, and starting balance use persisted tenant data; starting-balance writes are admin-only. User search is active same-tenant name-only, excludes self/suspended users and email, and is 30/minute. | Community-fund donation/deposit/withdraw and `/api/wallet/donate` remain HTTP 503 until a canonical writer exists. Username search remains unavailable because the .NET user schema has no Laravel username column. |
| Caring loyalty and estate evidence | New loyalty debit/refund and positive estate settlement rows persist unique tenant-composite transaction links. Concurrent reversal has one winner; unlinked legacy loyalty cannot mint a refund; repeat estate lifecycle mutations are rejected. | Legacy null links require manual reconciliation. Same-platform Caring hour transfers still lack authoritative transaction-id columns; remote transfers remain a federation-saga gap. |
| Federation external boundary | Listing/member reads enforce opt-in, active state, visibility, tenant match, and blocked-partner rules. Caller-supplied message/review identity, partner webhook list/create, V2 ingest, non-pristine transfer cancellation, and unsupported financial settlement return stable 503 with no mutation. | Durable authenticated remote identity, webhook/ingest processing, cancellation protocol, and settlement saga remain incomplete; fail-closed behavior is not parity completion. |
| Transactional volunteering core | Selected-shift applications/decisions, direct signup/cancellation, reservations, waitlists, guardian consent, recurrence, organisation lifecycle/wallets, QR attendance, V2 shift swaps, and all eight member/organisation/admin volunteer-hours routes use tenant-scoped transactional storage and canonical gates. `VolunteerHoursService` locks the canonical `vol_logs` row, uses strict Laravel action/request contracts, converges Caring relationship logging, and creates one semantically linked personal credit, organisation payment, and XP record for an approved whole-hour log; sub-hour approvals award XP without zero-value ledgers. Direct Caring logging preserves raw fractional semantics for whole-hour flooring and regional points while storing rounded hours. QR attendance remains deliberately side-effect free. | Volunteer-hours/feed focused proof is one 53/53 disposable-Linux run: all 51 `VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`, with 3,007 tests discovered. Final migration replay and model-drift gates are green. The clean affected rerun selected and passed 243/243 with zero failed/skipped in 418.639s. The full 3,007-test suite, CI, and unchanged-frontend runtime smoke remain open. Swap notification/localization, cross-workflow serialization against a concurrently approved third overlapping assignment, outgoing `shift.completed`, child-to-parent domain inheritance, provider/localization depth, and wider runtime certification also remain open. |
| Route ownership | Synthetic duplicate owners were removed, six federation credit-agreement actions use literal routes, and the live endpoint-table test enforces one owner per verb/normalized admin template plus expected owners for high-risk routes. The comparator requires all six literal actions before treating Laravel's constrained `{action}` route as covered. | Ownership covers admin routes, not all API routes, and does not prove handler semantics. Recorded-only/catch-all handlers remain elsewhere. |

The shift-swap concurrency residual specifically includes the absence of one
global per-user assignment lock shared by two distinct concurrent swaps and by
other approval writers. Duplicate requests and a single decision are serialized;
the broader writer namespace is not yet closed. ASP.NET also returns canonical
HTTP 400 for swap messages above its persisted 1,000-character limit, whereas
Laravel's text column accepts longer input.

Retained verification evidence for the preceding volunteer-hours slice:

- Debug API/test and solution-wide Release builds: 0 errors; only the same 4 pre-
  existing `xUnit1031` warnings, with Release completing in 4m36s;
- focused volunteer-hours/feed proof: one disposable-Linux run discovered 3,007
  tests and passed 53/53, comprising 51/51 `VolunteerHoursParityTests` and 2/2
  `V15FeedActivityCompatibilityTests`;
- affected regression: 3,007 discovered, 243 selected, 243/243 passed with zero
  failed/skipped in 418.639s; the full 3,007-test suite, CI, and unchanged-
  frontend runtime proof remain open;
- then-latest migration: `20260711192124_VolunteerHoursLedgerParity`, recorded runtime
  ID 111; source contracts assert no legacy-value insert and conditional Caring/
  non-Caring hours checks;
- migration runtime gates: blank replay applied all 111 migrations through the
  latest ID and verified the exact 13-column/eight-index feed schema, nullable-
  boolean/default-true privacy field, 11 `SET NULL` foreign keys, and volunteer-
  user `CASCADE`; valid populated 110-to-111 behavior passed; invalid `P0001`
  abort left history at 110 with no partial DDL; `has-pending-model-changes` is
  green; disposable cleanup is zero and no production resource was touched; and
- descendant CI run `29154079189`: later cancelled after its completed
  Integration Tests job reported 51/2,888 failures. The direct
  nested-transaction regression from `bfeafb2e` is fixed and green locally; the
  other failures remain open.

Preceding financial slice evidence retained for context:

- test-project build: 0 errors and 4 pre-existing `xUnit1031` warnings;
- high-risk wallet/federation/organisation/group/loyalty/estate run: 103/106 on
  the initial command; after correcting two test assertions and isolating one
  fixture-startup timeout, all three affected tests passed 3/3;
- fail-closed contract suite: 119/119 passed, proving explicit unavailable
  results and no ledger/balance mutation across the then-scoped legacy exchange,
  sub-account, volunteer-attendance, wallet-alias, and federation paths;
- latest migration:
  `20260711100817_LoyaltyEstateOrganisationEvidence`; EF reports no pending
  model changes and discovers 109 migrations;
- blank disposable PostgreSQL: all 109 IDs applied from
  `20260202085043_InitialCreate` through the latest ID after restoring
  `AddAiMessageTenantId` discovery metadata; history has 109 rows and the
  non-null `ai_messages.TenantId` column, tenant index, and foreign key were
  inspected directly;
- populated disposable PostgreSQL at the preceding migration: latest upgrade
  passed with legacy users/organisation/member/wallet/wallet-transaction/
  loyalty/estate rows retained and known membership-role casing normalized;
- deliberately invalid cross-tenant wallet-transaction clone: latest upgrade
  aborted in preflight, migration history stayed at
  `20260711083852_WalletLedgerFederationPartnerParity`, and latest schema
  additions were absent;
- all disposable databases and the uniquely named container were removed; no
  production database or container was touched;
- schema comparator fixture: green; current live result: 333 Laravel migration
  files, 117 ASP.NET migration source files, 115 runtime migrations, 368
  Laravel source tables, 336 ASP.NET tables, 142 exact matches, 226 missing,
  and 194 ASP.NET-only;
- copy-ready, read-only financial candidate SQL is maintained in
  `docs/database-migrations.md`. It reports balance impact and requires manual
  disposition; it never auto-fixes or auto-links evidence.

Earlier published slice evidence retained for context:

- historical pre-volunteering combined Release build: success, 4 pre-existing
  `xUnit1031` warnings, 0 errors;
- `AdminRouteOwnershipParityTests` + `AdminV2RouteAliasUnitTests`: 134/134;
- roles, hidden privilege routes, role writers, 2FA, TOTP, and passkeys: 63/63;
- `Phase73NewScheduledJobsTests`: 16/16 after one Testcontainers-only startup retry;
- exact React cron/security contracts: 3/3;
- canonical broker persistence contract: 1/1;
- API comparator fixture: green; live regeneration reports 4,318 ASP.NET
  controller operations, 2,439/2,583 Laravel source operations matched, and 144
  missing. Seven are the deliberately unresolved document-era admin
  vetting writes (root create, record update/delete, upload/verify/reject, and
  bulk). The expanded remainder is dominated by event-product routes, with
  prerender reset/invalidate and guardian-consent token verification also open.
  The legacy vetting routes cannot be
  restored as contact-authorizing document workflows;
- pre-volunteering EF Release baseline: 75 migrations, latest
  `20260710092435_CanonicalRoleSemantics`; no pending model changes.
- pre-volunteering migration discovery quarantine baseline: 1/1, with 104 source classes split into
  75 EF-discovered and 29 explicitly quarantined classes.
- federation partnership workflow: 6/6 PostgreSQL-backed tests, including
  simultaneous approve/approve and approve/reject races;
- adjacent legacy federation, compatibility, and route-ownership regressions:
  129/129; corrected dual-route reflection coverage: 2/2;
- post-federation-review API Release build: 0 warnings, 0 errors; test-project
  build: 4 pre-existing `xUnit1031` warnings, 0 errors; EF reported no model
  drift at that pre-volunteering baseline.
- prior transactional volunteering core regression: 61/61 passed;
- clean guardian-consent lifecycle regression: 7/7 passed;
- combined workflow/guardian/ownership filter: 67/68 passed in one run; the
  only failure was a PostgreSQL fixture-clear timeout before its test body, and
  that exact case passed 1/1 on an isolated fresh-fixture retry;
- guardian ownership/migration focus: 97/97 passed; exact admin config, cron,
  and legacy-mutation contracts: 3/3 passed;
- recurring-pattern CRUD integration: 13/13 passed, including explicit-zero
  capacity, unsigned failures, lossless decoded day arrays, tenant hiding,
  exact role authorization, partial/same-value/no-op PUT semantics, two-stage
  cleanup, pre-throttle auth/feature gates, and the canonical 429 contract;
- recurring-pattern route ownership: 1/1 passed, proving exactly four v2
  aliases with authorization and independent list/create/update/delete buckets;
- recurring-shift generation and scheduled-run regression: 13/13 passed;
- refreshed admin cron plus migration-discovery contracts: 2/2 passed;
- volunteer-organisation relationship/lifecycle integration: 13/13 passed,
  including transactional rollback, cross-tenant schema rejection, exact role
  policy, public field safety, dashboard authorization, payout uniqueness,
  fresh-chain-safe aggregates, protected opportunity deletion, paginated
  `my-organisations`, and feature-before-rate ordering;
- current wider affected controller/auth/route/migration regression: 180/180
  passed; direct compatibility-controller factory regression: 7/7;
- volunteer-organisation wallet integration: 6/6 passed, including atomic
  personal debit/organisation credit, validation and authorization guards,
  signed admin adjustments, feature-before-rate ordering, plain-cursor history,
  and five-way overspend concurrency with exactly three winners;
- combined affected route-ownership sets: 95/95 passed; exact volunteering
  runtime aliases: 6/6 passed. The much broader all-alias runtime class exceeded
  ten minutes without a diagnostic and is not counted as green;
- earlier disjoint wallet-affected groups: 213/213 passed across ownership,
  wallet integration, downstream ledger analytics, existing wallet contracts,
  exact aliases, relationship regression, and migration discovery;
- earlier API build: 0 warnings, 0 errors; a clean test-project build had 4
  pre-existing `xUnit1031` warnings and 0 errors, while the final incremental
  build completed with 0 warnings and 0 errors;
- earlier volunteering-chain proof reached
  `20260711031959_NullableTransactionLedgerLegs`; the current migration proof
  is recorded above;
- current API route comparator: 2,541/2,592 Laravel/supplemental operations
  matched, with 51 route-shape gaps after Event Ticketing closure;
- historical schema comparator: 134/361 Laravel tables matched, 227 missing, 194
  ASP.NET-only; the current result above supersedes it and remains a global red
  gate.

The two preceding volunteering migrations deliberately reject unsafe downgrade
paths.
`AdminVolunteerApprovalWorkflow.Down()` fails before changing schema because
the former unique tenant/opportunity/user application index cannot be restored
after legitimate declined/withdrawn reapplication history without data loss.
`GuardianConsentLifecycle.Down()` fails because rollback would discard hashed
guardian credentials and restore unsafe legacy status/verification semantics.
`VolunteerQrAttendanceParity.Down()` also throws before changing schema because
a downgrade would discard QR token, lifecycle-status, and coordinator evidence
and would make pending attendance timestamps non-nullable. Restore a tested
pre-migration backup or implement a reviewed forward remediation; do not force
or improvise a destructive down migration.
`VolunteerHoursLedgerParity.Down()` likewise throws before changing schema: a
downgrade would remove immutable feedback plus personal, organisation, and XP
ledger provenance. Restore a verified pre-migration backup or use a reviewed
forward remediation.
`RecurringShiftGenerationParity` is reversible, but its upgrade fails closed
when historical duplicate occurrences exist because automatically deleting a
shift could destroy linked operational history.
`RecurringShiftPatternCrudParity` is reversible and fails its upgrade before
schema loss if shadow/current creators diverge, the creator is missing, or the
creator belongs to another tenant. It also rejects negative legacy values before
installing the four unsigned-equivalent checks. Its downgrade repopulates the
shadow FK from `CreatedBy` rather than silently disconnecting creator
navigations. The required creator FK deliberately uses non-destructive
`RESTRICT` instead of Laravel's user-delete cascade until deletion side effects
are explicitly reconciled and tested.

`VolunteerOrganisationRelationshipsParity` performed no data backfill. Its new
organisation/member/opportunity relationships use tenant-composite keys; the
opportunity relationship uses non-destructive `RESTRICT`. Its nullable
transaction `vol_log_id` began as a scalar; the current
`VolunteerHoursLedgerParity` migration now binds it to canonical tenant-scoped
`vol_logs`, adds the personal `transactions.VolunteerLogId` evidence link, and
enforces unique active log/payment/XP evidence. It does not mint legacy value:
evidence-free approved whole-hour organisation rows become `pending`, while
approved Caring sub-hour rows do not require fabricated payout/XP evidence.
Historical opportunities remain
NULL-linked by design; operators must map them to a tenant organisation before
organisation-manager decisions can work. Never infer an organisation id from
`OrganizerId`, which is a user key. The nullable-ledger-leg migration
supports one-sided member debits/credits without fabricating counterpart users
and adds participant-specific history-hide flags. Its downgrade is intentionally
unsupported because the former required-leg model cannot preserve one-sided
balance effects without losing or silently changing financial history.

Migration metadata was restored only after auditing the formerly invisible
manual classes. Discovery includes the essential designer-less
`AddAiMessageTenantId`; the recorded runtime inventory is now 115 through
`20260712060051_DirectMessageStateParity`. Blank 115, populated 114-to-115, and
model-drift gates are green for the latest source; existing content and read
timestamps were preserved, new state uses false/null defaults, and the nullable
deletion-audit relationship uses `SET NULL`. Migration 115 is forward-only.
The invalid atomic-abort and catalog-containment gates remain retained proof for
migration 114, and migration 111's no-mint evidence remains retained historical
proof. The
overlapping `FederationCoreExpansion` class remains intentionally outside the
runtime chain because its later superset already creates the same schema. The
obsolete `AddTenantUpdatedAt` class also remains outside because `InitialCreate`
already creates `tenants.UpdatedAt`. The gate must prevent silent inventory
drift without making duplicate DDL
discoverable. `WalletLedgerFederationPartnerParity`,
`LoyaltyEstateOrganisationEvidence`, and `VolunteerHoursLedgerParity` are
intentionally irreversible. Use the
read-only candidate report in `docs/database-migrations.md` and record a manual
disposition and balance impact before any forward remediation. No production
database or container was touched.

## Historical Snapshot (2026-07-07)

Snapshot captured during documentation handoff work on 2026-07-07. Regenerate
before trusting it.

| Item | Last observed state |
| --- | --- |
| Backend branch | `main` in `C:\platforms\htdocs\asp.net-backend` |
| Backend head commit | `44695cf0 Add Laravel React backend parity endpoints` |
| Backend remote delta | `main...origin/main [ahead 52]` |
| Backend dirty files seen | `src/Nexus.Api/Controllers/ShiftManagementController.cs`, `src/Nexus.Api/Services/ShiftManagementService.cs`, `tests/Nexus.Api.Tests/LaravelReactFrontendContractTests.cs`, plus `codex-write-test.tmp` |
| Working estimate | about `600/1000` implementation parity |
| Documentation readiness after this handoff | `1000/1000` for resuming safely, assuming agents rerun the refresh protocol |

The latest earlier audit found static API route coverage closed but deeper
backend parity still incomplete:

| Comparator | Last observed result |
| --- | --- |
| API source operations | `2432` Laravel source ops, `2432` matched, `0` missing |
| ASP.NET static operations | `4221` operations |
| Schema | `361` Laravel tables, `319` ASP.NET table names, `127` exact matches, `234` missing, `192` extra |
| Localization | `11` Laravel locales vs `7` .NET locales; `605` Laravel namespaces vs `280` .NET namespaces; `49` namespace matches; `4942` missing English keys in matched namespaces |
| Build | `dotnet build Nexus.sln --configuration Release --no-restore` passed earlier on 2026-07-07 |
| Test risk | Full `dotnet test` was previously blocked by Windows Application Control loading `OpenTelemetry.Exporter.Prometheus.AspNetCore.dll` |

## Refresh Protocol

Run this in the backend checkout before continuing work or reporting a score:

```powershell
cd C:\platforms\htdocs\asp.net-backend
git status --short --branch
git log --oneline --decorate -n 20
git diff --stat

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-api-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-localization-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-export-laravel-parity-backlog.ps1

dotnet build Nexus.sln --configuration Release --no-restore
dotnet test Nexus.sln --configuration Release --no-restore
```

If `dotnet test` is blocked by Windows Application Control, record the exact
blocked DLL and command output in the final handoff note. Do not treat that as a
passing test run.

## Documents To Trust

Read these in order:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/README.md`
4. `docs/CURRENT_ASPNET_CONTRACT_STATUS.md`
5. `apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`
6. `docs/FULL_PARITY_REMEDIATION_RUNBOOK.md`
7. `docs/API_PARITY.md`
8. `docs/LARAVEL_PARITY_MAP.md`
9. `docs/SCHEMA_PARITY.md`
10. `docs/LOCALIZATION_PARITY.md`
11. `docs/PARITY_BACKLOG.md`
12. `docs/REACT_FRONTEND_RETIREMENT.md`

Some older count tables are intentionally historical. The comparator commands
above are the source of current numeric truth.

## What Counts As Done

A module or endpoint family is not complete until all of these are true:

- Laravel React call sites are identified.
- Laravel OpenAPI and route declarations are matched by ASP.NET.
- `/api/v2` aliases exist where Laravel React expects them.
- Request/query/multipart shapes match.
- Response envelopes, pagination, validation errors, auth errors, tenant errors,
  and not-found behavior match.
- Tenant scoping and feature/module gates match Laravel behavior.
- Focused ASP.NET regression tests cover the contract.
- Runtime smoke tests prove the Laravel React frontend can use the ASP.NET
  backend for the workflow.
- The same unchanged, Laravel-certified Web UK frontend can exercise the
  equivalent ASP.NET workflow by changing configuration only.
- Docs are updated with evidence and any remaining gaps.

## Historical Remaining-Work Snapshot

The queue below is retained as implementation history. Use
`CURRENT_ASPNET_CONTRACT_STATUS.md` for the current ordered queue.

Prioritize workflow-complete slices over raw endpoint count. Route declarations
are mostly closed; the remaining work is contract correctness.

1. Continue the canonical-frontend-used fallback inventory after the completed
   direct-message state, coordinator-help, reaction, typing, and read/unread
   slices. Replace shallow or false-oracle tests rather than accepting route
   success.
2. Run the full ASP.NET suite and CI, then complete unchanged-frontend
   member/organisation/admin/Caring runtime smoke. The focused 53/53 and affected
   243/243 gates are green, but the discovery count is not a full-suite pass.
3. Implement the workflows that currently fail closed: two-party legacy
   exchange confirmation, managed-user sub-account approval, a canonical
   community-fund donation/deposit/withdraw writer, and the durable
   authenticated federation settlement saga. Preserve explicit HTTP 503/no-write
   behavior until each is real.
4. Add the outgoing `shift.completed` webhook and child-to-parent tenant-domain
   inheritance without weakening the completed QR attendance contract.
5. Complete opportunity list/create/update/application-list contracts, admin
   organisation members/DLP, public review listing, and explicit reconciliation
   for historical NULL organisation links.
6. Run the read-only legacy financial audit, assign a documented manual
   disposition and balance impact to every ambiguous self-transfer/admin grant/
   starting-balance/loyalty/estate/hour-transfer candidate, and implement only
   reviewed forward remediations. Never auto-link or auto-fix by similarity.
6. Replace the remaining 38 unmapped cron definitions with real jobs or keep
   them explicitly disabled/unsupported until equivalent work executes.
7. Finish federation permission/rejection schema, initial-sync/outbox,
   localized notification, and canonical audit-read parity before broker
   archive reads.
8. Complete multi-node challenge storage, trusted devices, auth security
   notifications, TOTP key separation, and WebAuthn sign-counter concurrency.
9. Close or explicitly alias schema gaps, especially renamed-table families.
10. Close localization gaps for backend, admin, email, API, and accessible copy.
11. Convert static API matches into runtime-proven Laravel React workflows and
   add browser smoke for the highest-risk auth/admin/provider paths.
12. Update `docs/PARITY_BACKLOG.md` after each completed workflow batch.

## Scoring Guide

Use scores only as working estimates. They are not a substitute for acceptance
criteria.

| Range | Meaning |
| --- | --- |
| `0-300` | Inventory or skeleton only |
| `300-600` | Broad routes exist, limited contract proof |
| `600-800` | Most route/API surface exists, major runtime/schema/localization gaps remain |
| `800-950` | Runtime-proven workflows dominate, remaining gaps are narrow and documented |
| `950-1000` | No known route/API/schema/localization gaps; full regression and smoke suites pass |

The current slice was not converted into a new numeric score because the full
API/schema/localization inventories, full ASP.NET suite, and unchanged-frontend
runtime smoke were not rerun together. The previous `690/1000` implementation
and `500/1000` certification estimates therefore remain historical baselines,
not current scores. The 1000/1000 gate is still red despite the green focused
financial, migration, and fail-closed evidence above.

## Final Handoff Checklist

Before leaving this job for another agent, write a short note containing:

- branch and head commit;
- dirty files and whether each is yours or pre-existing;
- refreshed comparator counts;
- latest build/test commands and results;
- current implementation score out of 1000;
- next 5 concrete tasks;
- any blocked commands with exact error text;
- files changed in the handoff.
