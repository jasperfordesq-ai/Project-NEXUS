# API Parity Map

Last reviewed: 2026-07-15

Status: **Maintained reference — current comparison method with dated evidence**

Evidence provenance: maintained policy and published backend prose were
re-audited on 2026-07-15 against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and repository commit
`9ad163c969a935407297eb459a9840798a1a9e78`. Dirty backend work is excluded.
Any older numeric table or narrative without its own exact source pair is a
historical, provenance-incomplete checkpoint and must not be cited as current.

Laravel source of truth: `C:\platforms\htdocs\staging\openapi.json` plus route
files under `C:\platforms\htdocs\staging\routes`.

Current overall score, baseline SHAs, in-flight boundary, and remaining
certification gates live only in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md).
Numbers in dated sections below are point-in-time evidence and never override
that status file.

Eleven backend commits from `60715dfd` through `9ad163c9` were published after
the restart scorecard. They include real contract behavior as well as harness
and expectation corrections. They have not received a complete fixed-rubric
rescore. A later post-pause exact-SHA CI aggregate is green at `dbafc5c3`, but
that execution result does not semantically regenerate or accept this detailed
map. Read their compact ledger under “Published But Not Rescored” in the
canonical status; do not infer new points from this map.

Published `main` subsequently advanced through merge `df8c8b96`, which adds the
nine schema families recorded in `SCHEMA_PARITY.md` plus test/documentation
transactions. It adds no API controller/route implementation beyond the
`9ad163c9` behavior boundary, so this API ledger remains anchored there and the
published schema delta remains unscored.

Published commit `c767050a` is the latest unscored product/API behavior delta.
It removes a
large compatibility-controller scaffold, changes authorization, offline Event
check-in, marketplace-report, fixture, test, and CI behavior, and adds runtime
migration 163. This detailed API ledger has not been completely regenerated or
semantically rescored for that delta. Later commits `b3f946b3` and `dbafc5c3`
change the required CI workflow and wallet-concurrency test evidence only; they
do not advance the product/API behavior boundary. Required CI is terminal green
at `dbafc5c3`, but the rows below remain evidence anchored at their named SHAs
and the `c767050a` semantic delta remains open until a contract audit accepts it.

Frontend contract consumers are the canonical React client at
`C:\platforms\htdocs\staging\react-frontend` and the unchanged Web UK client at
`apps/web-uk`. Web UK is Laravel-first but not yet runtime-certified; Laravel
routes, OpenAPI, controllers, and workflows remain authoritative for both.

The legacy ASP.NET React copy at `apps/react-frontend/` was deleted on
2026-08-09 and is not the target for API design. Contract identity means both unchanged frontend consumers can
use ASP.NET with the same consumed methods, paths, shapes, status/error
behavior, auth, tenancy, side effects, jobs, and provider outcomes. Static
method/path representation is one evidence category, not completion.

## 2026-07-15 Contract Re-audit Corrections

The committed marketplace provider sequence now extends beyond the dated
settlement checkpoints below. Connect onboarding/account webhooks, paid
transition delivery, escrow release, provider refunds, signed external-refund
reconciliation, held-escrow and paid-transfer charge-dispute recovery, and
refund notifications are implemented in commits `25110d7f`, `f562c497`,
`93417bd1`, `4f7b9f20`, `ef8a0cf8`, `027f35e6`, `9875fb5d`, and `b37a3cc5`.
Provider/economic evidence is durable and replay-safe; unsafe or incomplete
evidence fails closed. The general complete exact-SHA aggregate is green at
`dbafc5c3`; live Stripe/Connect execution, fixed-rubric module acceptance, and
unchanged-client runtime certification remain open.

Tenant SSO/OIDC is no longer administration-only. Commit `c20d064e` implements
public discovery, redirect, callback, and browser exchange with signed durable
state, browser/server PKCE, OIDC nonce/JWKS validation, public-HTTPS endpoint
checks, tenant-qualified identity linking, domain/provisioning gates, one-time
encrypted callback grants, refresh-token issuance, and logout-all invalidation.
Focused fake-IdP, controller, migration-SQL, and disposable-PostgreSQL evidence
is recorded in the canonical backend status. The general complete exact-SHA
aggregate is green at `dbafc5c3`; live IdP/browser proof, fixed-rubric module
acceptance, and unchanged-client runtime proof remain open.

The dated marketplace sections and aggregate rows below remain historical
evidence at their named implementation boundary. Their “remain open” lists are
superseded only for the committed slices named above; they do not override the
current deductions in `CURRENT_ASPNET_CONTRACT_STATUS.md`.

## 2026-07-14 Marketplace Connect Onboarding Refresh

`POST /api/v2/marketplace/seller/onboard` now creates/reuses a Stripe Express
account with stable tenant/user idempotency, requested card/transfers
capabilities, distributed serialization, tenant-correct refresh/return URLs,
and both Laravel `onboarding_url` and canonical-React `url` aliases. The status
read polls Stripe and persists completion only when details, charges, and
payouts are enabled. The signed marketplace webhook now handles replay-safe
`account.updated` completion and disablement, writes sanitized event evidence,
and emits an exactly-once localized bell with best-effort push. Migration
`20260714115746_MarketplaceConnectOnboardingParity` aligns Laravel's 100-character
field, enforces unique provider identity, and fails safely on unreconciled
legacy conflicts. Focused proof passes 13/13, onboarding plus route ownership
passes 115/115, upgraded PostgreSQL and model drift are green, and Release
builds have zero errors. Live Stripe credentials/runtime proof remain external.

## 2026-07-14 Marketplace Payment Settlement Refresh (Historical Checkpoint)

Marketplace fiat checkout now uses a provider-bound Stripe destination charge
instead of a local placeholder. Create validates buyer/tenant/order/seller,
currency precision, checkout mode and expiry; binds one intent with stable
idempotency; verifies destination, fee, amount, currency and identity metadata;
and cancels an unbound remote intent after a lost race. Confirm and the signed
marketplace webhook share provider-revalidated, exactly-once local settlement.
Seller payout and balance reads use the durable tenant-scoped payment ledger.
Migration `20260714105831_MarketplacePaymentSettlementParity` applies on
disposable PostgreSQL and model drift is clear. Release builds have zero errors,
payment service proof passes 9/9, and the BuyNow controller case passes. At this
checkpoint escrow, refunds/disputes, and payment-confirmation notifications were
open; the 2026-07-15 correction above names their later committed slices.
Live-provider proof, full-suite/CI, and unchanged-frontend runtime certification
remain open.

## 2026-07-14 Retired Vetting OpenAPI Reconciliation

The seven final apparent gaps were stale OpenAPI-only document-era vetting writes.
Laravel's live routes, metadata-only controller, feature tests, and canonical React
consumer all prove generic create/bulk/update/delete/upload/verify/reject are removed,
not missing implementation targets. The comparator now excludes each retired candidate
only while the live Laravel route files omit the same method/path. Fixture proof passes;
the live result is **2,601/2,601 active operations matched (0 missing, 100% static)**
with seven retired raw-OpenAPI entries reported separately. ASP.NET runtime proof also
matches Laravel's 404/405 behavior and proves no legacy/current vetting-row mutation.
This closes static route inventory, not behavioral or release certification.

## 2026-07-14 Prerender Control-Plane Refresh

External invalidation and administrator reset-all now have explicit owners. The
invalidation hook implements bearer/HMAC/platform-super-admin authentication, raw-body
signatures, skew and one-time replay protection, bounded canonical route validation,
external throttling, durable-before-destructive recache ordering, real safe bundle
deletion counts, and platform-global job/audit visibility. Reset-all confirms, rate-
limits, serializes, fences older work, creates one authoritative global force job,
transactionally audits it, and returns 202. Focused PostgreSQL proof passes 7/7, the
combined admin ownership gate passes 121/121, comparator fixtures pass, and Debug/
Release builds have zero errors. The refreshed live inventory is **2,601/2,608 matched
(7 missing, 99.7%)**; every remaining static miss is a document-era vetting write.

## 2026-07-14 Group Auto-Assignment Workflow Refresh

The administrator list/create/update/delete surface now uses a typed tenant-owned rule
aggregate rather than generic recorded-only writes. It matches canonical partial
updates and validation, conceals foreign groups/rules, excludes poisoned joins, locks
updates/deletes, and appends durable mutation audit data transactionally. Migration
146 applies on both maintained PostgreSQL histories, model drift is clean, focused
proof passes 2/2 on each, the combined ownership gate passes 116/116, comparator
fixtures pass, and Debug/Release builds have zero errors. The refreshed live inventory
is **2,599/2,608 matched (9 missing, 99.7%)**.

## 2026-07-14 Podcast Artwork Upload Refresh

Show artwork and episode cover uploads now own both legacy and V2 routes used by the
canonical React studio. Multipart `image` files pass through the platform image
allowlist and become tenant/subject-bound file records; only platform download URLs
enter podcast state. Creator/admin authorization, tenant-safe 404s, staged-file
rollback, Laravel validation envelopes, approved-to-pending moderation reset, and an
authenticated 10-per-minute bucket are covered. Focused controller/runtime proof
passes 4/4, route ownership passes 114/114, comparator fixtures pass, and Release builds
have zero errors. The refreshed live inventory is **2,598/2,608 matched (10 missing,
99.6%)**.

## 2026-07-14 Atomic Notification Settings Refresh

`PUT /api/v2/users/me/notification-settings` now atomically validates, normalizes,
persists, and returns the canonical React notification form across tenant-owned user,
match-preference, and global-digest stores. Every canonical boolean is required;
weekly match/digest values normalize to monthly; invalid payloads cannot partially
write; and a dedicated authenticated limiter matches Laravel's 10-per-minute bucket.
Migration 145 adds exact federation and match-notification columns with safe defaults.
It applies on upgraded and blank-chain PostgreSQL, model drift is clear, focused proof
passes 2/2 on each database, the affected member-settings set passes 6/6, route
ownership passes 114/114, and Debug/Release builds have zero errors. The refreshed
live inventory is **2,596/2,608 matched (12 missing, 99.5%)**.

## 2026-07-14 Event Configuration Policy Refresh

Administrator event configuration read, audit, update, and restore routes now have
explicit canonical owners. The durable tenant policy supports typed defaults and
overrides, optimistic versions, reasoned audit history, selective/full idempotent
restore, dependency validation, capability and impact projections, and server-side
confirmation for disruptive disables. Reminder shutdown cancels pending rows;
federation shutdown withdraws shared events and writes partner tombstone deliveries.
Unavailable timed-waitlist and authoritative-outbox modes fail closed. Focused
migrated-schema proof passes 3/3, route ownership passes 114/114, comparator fixtures
pass, and Debug/Release builds have zero errors. The refreshed live inventory is
**2,595/2,608 matched (13 missing, 99.5%)**.

## 2026-07-14 Marketplace Dispute Settlement Refresh

Order-dispute creation and administrator queue/resolution now have explicit owners.
The workflow is tenant-safe, serialized, state-guarded, replay-safe, and projects the
canonical participants, listing, order, evidence, and pagination fields. Free and
time-credit buyer resolutions restore inventory once; time-credit refunds require a
verified original ledger fact and append a linked full reversal. Seller/closed
outcomes restore the saved prior order state. Fiat resolution fails closed without
mutation until a real provider/escrow integration exists. Migration 144 replays from
blank PostgreSQL, model drift is clear, focused upgraded/blank proof passes 3/3 each,
the affected marketplace set passes 16/16, route ownership passes 114/114, and Debug/
Release builds have zero errors. The refreshed live inventory is **2,591/2,608
matched (17 missing, 99.3%)**.

## 2026-07-14 Marketplace Report Appeal Refresh

Member report list/show/appeal and admin appeal-resolution routes are explicitly
owned under both aliases. They share canonical creation validation, reporter/seller
privacy projections, serialized state transitions, safe evidence URLs, durable
notifications, and reversible listing/seller enforcement. Migration 143 replays from
blank PostgreSQL, EF model drift is clear, focused proof passes 2/2, the ownership/
admin marketplace gate passes 122/122, and Debug/Release builds have zero errors.
The refreshed live inventory is **2,589/2,608 matched (19 missing, 99.3%)**.

## 2026-07-14 Event Federation Reliability Refresh

Event lifecycle changes now enqueue durable, idempotent, versioned federation
upserts or tombstones for active/prior Nexus event partners. Organizer/admin status
at `/api/events/{id}/federation-status` and `/api/v2/events/{id}/federation-status`
returns a private, tenant-safe, payload-free health projection with latest partner
state, attempts, versions, timing, and sanitized error codes. Migration 142 replays
from blank PostgreSQL, EF model drift is clear, the combined lifecycle/federation
suite passes 14/14, route ownership passes 114/114, and Debug/Release builds have
zero errors. Outbound claim/sign/deliver/retry and inbound federation remain open.
The refreshed live inventory is **2,585/2,608 matched (23 missing, 99.1%)**.

## 2026-07-14 Event Recurrence And Series Lifecycle Refresh

Event reminder GET/PUT/DELETE now use a dedicated tenant-safe preference aggregate
on both API aliases. Strict overrides/rules, optimistic revisions, serializable
locking, reset-to-inherited behavior, resolved preferences, and bounded limits are
covered by 2/2 migrated-schema tests. Migration 141 replays cleanly and model drift
is clear.

All six recurrence capability, revision, and definition-blueprint route shapes now
have explicit owners under both API aliases, and `/events/recurring` uses the real
v2 workflow rather than the shallow parity handler. Finite and rolling series use
stable identities, signed/idempotent mutations, bounded tenant-safe materialization,
effective revision inheritance, future-only definition propagation, canonical
manifest hashes, immutable evidence, and DST gap/fold conflicts. Custom rules cover
the reviewed Laravel RRULE subset plus normalized EXDATE/RDATE and local wall-time
DST semantics. Publication converges the complete series; operational lifecycle
changes converge the root and future occurrences and emit one authoritative root
fact. Member/admin cancellation and deletion are transactional and non-destructive.
The recurrence, lifecycle, and route-ownership suites pass 9/9, 11/11, and 114/114,
and the scheduler is registered. Canonical self-relationship reads now return the
redacted registration/waitlist/attendance/capacity/action projection on both API
aliases. Personal calendar, guardian grant, and guest attendance also expose their
canonical aliases explicitly. The refreshed live inventory is **2,584/2,608 matched
(24 missing, 99.1%)**. This remains static route
representation plus focused workflow proof, not global frontend certification.

## 2026-07-13 Event Publication Lifecycle Refresh

Member event submit, publish, and lifecycle-history are now owned at both API
aliases with canonical moderation conflicts, manager authorization, strict V2 event
projection, durable queue/history effects, private history pagination, and focused
migrated-PostgreSQL proof passing 8/8. The live comparator confirms those three
operations matched. Because the Laravel source added 16 operations since the prior
snapshot, the refreshed global inventory is 2,573/2,608 matched (35 missing), not
the older 2,567/2,592 snapshot. Route matching alone remains non-certifying.

## Historical Static Source Counts (2026-07-14)

| Source | Count | Notes |
| --- | ---: | --- |
| Laravel `openapi.json` paths | 679 | Generated API contract, version `2.0.0`. |
| Laravel `openapi.json` operations | 1,064 | HTTP operations in the current live comparator input. |
| Retired OpenAPI-only operations | 7 | Document-era vetting writes omitted by live Laravel routes and guarded by removal tests. |
| Laravel route files | 16 | Includes supplemental route text files not necessarily in OpenAPI. |
| Laravel route declarations | 3,159 | Static scan of `Route::get/post/put/patch/delete/resource/apiResource`. |
| .NET static controller operations | 4,554 | Generated by `scripts/compare-laravel-api-parity.ps1`; not a parity score. |
| Script-generated source operations | 2,601 | Active Laravel OpenAPI plus de-duplicated supplemental static API route declarations; retired OpenAPI-only operations and Laravel `govuk-alpha*` accessible page routes are excluded. |
| Script-generated matched operations | 2,601 | Every active static method/path or method/shape matches. |
| Script-generated missing operations | 0 | Live 2026-07-14 regeneration after retired vetting reconciliation. Runtime contract verification remains endpoint/workflow-specific. |

The seven document-era admin vetting writes are retired source artifacts, not an
implementation queue. They must remain unavailable and must never authorize contact.
Zero active static gaps still does not prove the workflows.

The authentication-configuration owner now matches Laravel's typed six-key
admin contract and persists tenant-scoped policy. Backup-code count and passkey
enrollment/credential limits are enforced by their runtime services. Trusted-
device issuance and login bypass remain a separate known TOTP workflow gap;
persisting those two policy values is not certification of that missing device
lifecycle.

Group Q&A update/delete routes now have explicit owners backed by transactional
membership and author/manager checks, safeguarding gates, accepted-answer and
answer-count maintenance, and vote/answer cascade cleanup. The 117-migration
blank PostgreSQL replay is green through `GroupQaLifecycleParity`, which adds
Laravel's Q&A lifecycle counters, timestamps, acceptance flag, closure flag,
title bound, and query indexes while preserving the existing answer score as
the canonical vote count.

The canonical group editor now has typed capability discovery, tenant-scoped
types/templates and manageable parent candidates, multipart settings updates,
independent avatar/cover actions, manager authorization, location/coordinate
and branding validation, real stored-file compensation/cleanup, byte-signature
and dimension validation, and a schema-backed group form model. Blank
PostgreSQL applied all 124 migrations through
`EventPeopleAttendanceWorkflowParity`.

Group invite preview and acceptance now expose both `/api/groups` and canonical
`/api/v2/groups` routes with tenant-scoped token validation, email binding,
expiry/revocation status, reusable-link versus one-user email semantics,
idempotent membership activation, capacity limits, safeguarding cohort checks,
and cached member counts. Group data exports now use persisted queued records,
ten-minute request de-duplication, background generation with authorization
rechecks, a versioned section manifest, token/secret-safe projections, private
requester-only status/download routes, safe tenant/group storage prefixes,
expiry deletion, and retry/failure state. Focused lifecycle proof passed 3/3
and the combined affected group gate passed 6/6 on disposable PostgreSQL.

Admin event approve/reject/postpone/complete/archive/restore/reschedule now use
a serialized dual-axis lifecycle service rather than shallow status writes.
Real changes validate source states and reasons, increment a monotonic version,
maintain the legacy status mirror, close active RSVP/reminder state for terminal
transitions, append immutable history, record a transactional domain outbox
event, and deliver organizer/participant notifications after commit with
failure isolation. Same-state requests are idempotent and concurrent archive
requests create only one history/outbox version. Focused proof passed 4/4 and
the combined admin-event gate passed 10/10 on migrated PostgreSQL.

Event-template capture preview/capture, list/show/history, revision, archive,
materialization preview, and materialization now have explicit `/api` and
`/api/v2` owners. Capture uses a safe allowlist, versions are immutable,
mutations enforce tenant boundaries plus idempotency and optimistic versioning,
and materialization creates a fresh private non-federated event rather than
copying workflow state. Focused proof passed 4/4 and the combined event
lifecycle/template gate passed 8/8 after all 121 migrations replayed on a clean
disposable PostgreSQL database.

Event-broadcast list/show/preview/create/revise/schedule/cancel/retry now use a
versioned tenant-scoped aggregate with exact React response projections.
Scheduling resolves only canonical registration, waitlist, and attendance
facts, enforces safeguarding contact policy, and freezes one durable delivery
per recipient/channel. Legacy RSVP rows are deliberately ignored. Optimistic
versions, action-bound idempotency, lifecycle guards, terminal/content freeze,
append-only history/attempt evidence, and delivery transitions are enforced in
service code and PostgreSQL. Focused proof passed 4/4 after all 122 migrations
replayed on clean disposable PostgreSQL.

Canonical registration confirm/withdraw and waitlist join/leave/accept now use
serialized capacity locks, monotonic aggregate versions, action-scoped
idempotency, immutable histories, and domain outbox evidence. Capacity release
offers the oldest waiting entry, active/tokenized offers convert atomically to
confirmed registration, and queue cycles preserve sequence and evidence.
Focused HTTP/database proof passed 4/4 after all 123 migrations replayed.

The Event People workspace now provides redacted roster filtering/pagination,
formula-safe CSV export, manager approve/reject/cancel, versioned attendance
check-in/check-out/no-show/undo, unified three-axis history, and bounded bulk
results with per-operation errors. Exact React projections exclude contact and
notes fields. Focused HTTP/database proof passed 4/4 after all 124 migrations
replayed, including append-only attendance activity enforcement.

The seven-route Event Agenda aggregate now owns read, create, update, cancel,
reorder, session registration, and withdrawal under both `/api` and `/api/v2`.
It uses tenant/event advisory locks, monotonic agenda/session/registration
versions, request-bound idempotency, canonical event-registration eligibility,
independent capacity, room and speaker collision checks, visibility-filtered
speakers/resources, encrypted-at-rest HTTPS resource URLs, and private no-store
responses. Migration `20260712224838_EventAgendaWorkflowParity` creates the six
exact Laravel agenda tables, applies enum/range/time constraints, and installs
three history/no-delete triggers. Focused proof passed 4/4; blank PostgreSQL
replay applied all 125 migrations and EF reports no model drift.

Event Staff now owns list, grant, and revoke under both route prefixes with the
canonical five-role capability map and full React projection, including member
identity, effective expiry state, monotonic versions, immutable history, and
history metadata. Owner/tenant-admin authority is implicit; an effective
co-organizer may delegate only registration, communications, and check-in roles,
preventing co-organizer or finance privilege escalation. Mutations serialize on
tenant/event, normalize expiry to seconds, bind optional idempotency to the exact
actor/target/role/action/expiry operation, and append both history and event
domain-outbox evidence. Focused HTTP/database proof passed 4/4.

Event Calendar now owns the authenticated calendar collection, tenant and
single-event ICS downloads, vendor action links, feed-token list/create/revoke,
and anonymous personal subscription feed under both route prefixes. JSON,
Google/Outlook actions, and ICS derive from one lifecycle projection with stable
UID/sequence/status and no location, meeting-link, or member identity leakage.
Personal secrets are 256-bit `nxc_` values returned once, stored only as SHA-256
hashes, owner-scoped, limited under a serialized user lock, and rechecked during
use so revocation wins. Personal feeds include only confirmed canonical event
registrations. Focused security/contract proof passed 4/4 on isolated PostgreSQL.

Event Offline Check-in now owns all fourteen workspace, attendee credential,
device, manifest, batch sync/read, conflict list/resolution, and online scan
operations under both route prefixes. PII-free `nqx2` credentials are signed
with deterministic Ed25519 keys and persisted only as SHA-256 verifiers;
credential and device bearer values are one-shot. Manifests expose public keys
and confirmed-registration verifier rows without contact fields. Sync payloads
are bounded, device-authenticated, idempotent, version-aware, and persisted as
immutable items plus append-only decisions; accepted operations share the
canonical attendance ledger while conflicts require explicit versioned manager
resolution. Focused security, privacy, lifecycle, tenant, and persistence proof
passed 4/4 on isolated PostgreSQL.

Event Safety now owns requirement save/publish/archive, code acknowledgement and
withdrawal, guardian request/withdraw/public grant, and participation review
list/record/withdraw across both route prefixes. The strict React projection
separates manager and attendee permissions, eligibility, evidence, and rollout
state without returning guardian identity, capability tokens, safeguarding
evidence, or free-text review notes. Guardian contact fields are protected at
rest, public capabilities are stored only as hashes and delivered through the
email boundary, and all policy/evidence/review transitions are versioned and
idempotent. Focused lifecycle, privacy, authorization, and tenant proof passed
4/4 on isolated PostgreSQL.

Event Ticketing now owns catalogue, quote, ticket-type create/update/activate/
pause/archive, self and manager allocation, entitlement cancellation, and
read-only reconciliation under both route prefixes. The canonical React
projection uses fixed two-decimal credit strings, strict availability and
refund objects, private no-store responses, and explicit gateway capability.
Free tickets require confirmed canonical registration and enforce serialized
event capacity plus per-member limits; time-credit quotes remain visible but
materialization fails closed with HTTP 503 and no entitlement write until a
real payment boundary exists. Type and entitlement mutations are optimistic,
idempotent, tenant-scoped, and backed by immutable type, entitlement, and
inventory histories. Focused lifecycle/allocation/cancellation/provider/
authorization proof passed 4/4 on disposable PostgreSQL.

## 2026-07-12 Safeguarding, Messaging, And Group-Exchange Checkpoint

Laravel at `C:\platforms\htdocs\staging` and its canonical React frontend remain
the read-only sources of truth. This backend-only slice made no frontend edits.
It replaces sensitive legacy vetting-record authority with metadata-only,
tenant-scoped attestations: no certificate image, reference number, free-text
note, expiry date, or arbitrary status is accepted by the new controllers.
Legacy `vetting_records` can still be retained for controlled privacy review,
but they never authorize a new safeguarding contact decision.

The canonical V2 workflow now has focused owners for onboarding safeguarding
options/save, member preference/status/policy-review/review-request/revoke, and
administrator or broker vetting list/stats/policy rotation/review resolution/
member confirm/revoke. Admin safeguarding option create/update/delete/reorder is
no longer a generic recorded response: it validates option and trigger types,
serializes mutations, prevents weakening or deleting protection used by live
member selections, re-evaluates affected members, and records audit state.
Policy rotation and attestation-event rows are append-only, and direct deletion
of an attestation is rejected outside an explicit user/tenant cascade.

The rate contract is split by risk: onboarding save is 5/minute, option
mutation and vetting decisions are 60/minute, policy update is 20/minute,
policy rotation is 5/minute, member vetting mutation is 10/minute, and message
restriction status is 30/minute. Canonical vetting throttles return Laravel
`errors[]`, `Retry-After`, `API-Version`, and tenant headers rather than the
generic limiter body.

Four forward-only migrations extend the recorded runtime chain to 115, latest
`20260712060051_DirectMessageStateParity`. Migration 112 creates
the five exact Laravel metadata tables `tenant_safeguarding_settings`,
`member_vetting_attestations`, `member_vetting_attestation_events`,
`safeguarding_vetting_review_requests`, and
`safeguarding_policy_rotation_events`. Migration 113 adds the
`messaging_disabled` adapter flag to `user_monitoring_restrictions`. Migration
114 widens preference values, makes consent time required, installs one unique
tenant/user/option selection, and cascades the option and tenant dependencies.
The preceding safeguarding replay applied all 114 migrations to blank
PostgreSQL. A valid populated
113-to-114 upgrade preserved rows and losslessly filled null consent times from
`CreatedAt`; a duplicate tenant/user/option fixture raised PostgreSQL `P0001`
before DDL or data change, left history at 113, and left no partial migration-
114 schema. Migration 115 adds durable edit, scoped-delete, and per-user archive
state to messages, with false/null defaults and a nullable deletion-audit user
relationship that uses `ON DELETE SET NULL`. Its blank 115 replay and populated
114-to-115 replay are green; existing message content and read timestamps were
preserved. The migration is forward-only. Exact catalog containment and
`has-pending-model-changes` are green. No production resource was touched.

Messaging restriction reads and admin monitoring now use live persisted state,
expire stale restrictions, expose and mutate `messaging_disabled`, require the
Laravel reason/lifecycle fields, and clear the safeguarding-created approval
state when monitoring is removed. This is a documented storage adapter for
Laravel's `user_messaging_restrictions`, not a claim that the physical table
names are identical.

Direct text send/thread handling now trims and strips HTML, counts Unicode
characters, accepts same-tenant inactive recipients like Laravel, serializes
first-conversation creation, detects attachment content instead of trusting the
multipart MIME header, removes partial/staged files on every failed write, and
awaits the notification, XP, and realtime effects before returning Laravel's
plain 201 `data/meta` response. Blocked POST attempts create the staff
safeguarding alert once; read-only thread loads do not. Inbox partner identity
and attachment aliases/projections are also corrected.

The P0 direct-message state contract is now implemented. Edit accepts React's
`body`, is sender-only and limited to 24 hours, sanitizes content, rechecks the
current contact policy, and persists edited metadata. Delete is restricted to
conversation participants and records durable `scope=self|everyone` visibility
instead of hard-deleting the message. Conversation archive/restore treats the
route id as the partner user id, persists per-user archive state, separates
active and archived inbox reads, filters archived/deleted unread rows, and
restores the caller's view without deleting history.

Group exchange create/add/start/confirm/complete/cancel now follows Laravel's
caller and role semantics, evaluates participant policy in caller order while
locking users deterministically, persists caller-visible status, and writes the
canonical provider transaction rows plus the existing hidden ledger adapters.
Create is not broker-gated; add checks the broker boundary before contact
policy. Failure envelopes, conservation, idempotency, and first-writer race
coverage are focused, but frontend runtime smoke and notification depth remain
open.

Canonical `POST /api/v2/messages/voice` now has a dedicated detected-audio
allowlist without weakening ordinary attachment policy, preflight and locked
contact checks, 10 MB/five-minute guards, one transaction for conversation,
message, attachment, upload, and voice metadata, and independent rollback plus
physical-file cleanup. Spoofed WebM and messaging-disabled requests leave zero
message/file/notification/XP side effects; a valid WebM returns duration at
least one and runs the normal message effects. Provider transcription remains
open.

Coordinator help is now a runtime-backed P1 workflow. ASP.NET re-evaluates the
tenant safeguarding policy, returns Laravel-style HTTP 422 `errors[]` for
invalid, missing/cross-tenant, unrestricted, and unavailable requests, and only
accepts `VETTING_REQUIRED` or `SAFEGUARDING_CONTACT_RESTRICTED`. Active tenant
admin, tenant-admin, broker, and super-admin users receive in-app and email
alerts. A transaction advisory lock plus persisted signature suppresses
successful delivery for ten minutes without suppressing failed/no-staff
retries; every accepted request is audited and the route uses Laravel's
independent 5-per-300-second bucket. Focused PostgreSQL coverage passed 16/16
and route ownership passed 1/1.

Typing indicators are now a real first-contact workflow. `POST
/api/v2/messages/typing` accepts React's `recipient_id/is_typing`, runs the same
sender, tenant-recipient, messaging-restriction, bilateral-block, and
safeguarding preflight as a message send, and creates no conversation or other
database state. Allowed requests publish `typing` with exact
`user_id/is_typing` data to
`private-tenant.{tenantId}.user.{recipientId}` using a signed Pusher REST
request; missing credentials or delivery failure remain best-effort like
Laravel. The response is exactly `success/data.sent`, and the independent
authenticated bucket is 60/minute. Seven endpoint/route tests and one
transport-level request-signature test pass.

Read/unread now matches the canonical React/Laravel contract. The unread count
uses receiver archive/delete visibility and returns only `data.count`; mark-read
uses a tenant-scoped other-user conversation, updates only messages from that
partner, returns only `data.marked_read`, and does not emit the extra V2
read-receipt event. The routes use separate authenticated 60/minute buckets.
Route/policy ownership passed 1/1, focused disposable-PostgreSQL runtime passed
3/3, and the combined messaging regression passed 44/44.

The final deterministic direct-message state gate passed 39/39 with zero
failed or skipped, covering migration/model contracts, edit/delete,
archive/restore, concurrency, rate limits, unread metadata, sanitizer oracles,
and corrected route ownership. A broader exact regression completed 57/58; its sole failure was an
existing first-writer race that subsequently passed in isolation. A separate
class aggregate completed 12/13 and was interrupted only when the disposable
PostgreSQL process was killed for OOM (`exit 137`); the race case was green in
isolation. Neither interrupted aggregate is recorded as fully green. This is
not a full-suite pass, CI green, unchanged-frontend runtime proof, or 1000/1000
claim.

## 2026-07-12 Volunteer Hours Ledger Checkpoint (Preceding)

Laravel's canonical volunteer-hours workflow is now owned by focused ASP.NET
controllers on all eight React-facing routes: member list/create/summary/
pending-review/verify, organisation pending review, and administrator list/
verify. The route-alias convention creates legacy V2 volunteering aliases per
action and suppresses them when a focused method/path owner exists, avoiding
ambiguous money-changing routes while preserving unrelated compatibility paths.

`VolunteerHoursService` writes the canonical `vol_logs` ledger. It enforces the
Laravel feature gate, tenant and organisation status, opportunity ownership,
approved application or organisation relationship, natural-key duplicate
rules, strict action values, configurable verification policy, and the Caring
workflow policy. Approval awards XP and mints only whole hours into the derived
personal transaction ledger while debiting the organisation reconciliation
wallet even below zero. The personal leg uses a null sender so the organisation
owner's personal derived balance is not charged. Sub-hour approvals still award
XP but return `no_whole_hours`; QR attendance evidence remains unchanged.

Caring support-relationship and workflow review paths converge on the same
service, log table, payout links, and XP source. Direct Caring logging accepts
sub-hour input; the raw request value drives the whole-hour floor and regional-
points calculation before the canonical stored hours value is rounded to two
decimals. Flag-only tenant administrators are recognized, and approval-required/
trusted-reviewer settings are honoured. The request surface matches Laravel's
strict action, numeric, flexible-date, blank-description, feature-ordering, and
independent rate-limit contracts.

The backend now has the Laravel-aligned, tenant-scoped `FeedActivity` entity,
configuration, `DbSet`, and `FeedActivityService`, with migration 111's source
defining `feed_activity` and the public-hours preference. Approved-hour
publication uses
the idempotent `(tenant_id, source_type, source_id)` key and the distinct
`volunteer_hours` source type, honours `show_on_leaderboard`, and never copies
the organisation-facing volunteer description into feed content or metadata.
Other feed producers, admin moderation consumers, compatibility-state cleanup,
and historical backfill have not yet migrated to this canonical table.

Migration `20260711192124_VolunteerHoursLedgerParity` is runtime ID 111 and adds durable log/payment/
personal-mint/XP evidence, tenant-composite relationships, provenance checks,
active-natural-key uniqueness, and a fail-fast semantic preflight. It never
creates legacy transaction, payment, or XP value: uniquely provable existing
evidence may be linked, while evidence-free approved whole-hour organisation
rows are downgraded to `pending`. Approved Caring sub-hour rows remain valid
without fabricated payout/XP evidence. At that checkpoint, non-production
certification applied all 111 migrations to a blank PostgreSQL database and
verified the exact
13-column/eight-index `feed_activity` schema, nullable-boolean
`users.show_on_leaderboard` defaulting to `true`, all 11 column-specific
`ON DELETE SET NULL` relationships, and the volunteer-user `CASCADE`
relationship. A valid populated 110-to-111 upgrade preserved and linked existing
evidence without minting; a deliberately invalid fixture raised PostgreSQL
`P0001` atomically, left history at 110, and left no partial migration-111 DDL.
`has-pending-model-changes` is green, and disposable Docker cleanup left zero
matching resources.

The Debug API/test builds and required solution-wide Release build
(`dotnet build Nexus.sln --configuration Release --no-restore`) complete with
zero errors; the only warnings are the same four pre-existing `xUnit1031`
warnings in the test project. The Release build took 4m36s. One disposable Linux run
discovered 3,007 tests and passed 53/53: all 51
`VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`.
Windows Smart App Control blocks the freshly rebuilt unsigned API assembly, so
the run used Linux without weakening host policy. The clean affected rerun then
discovered 3,007 tests, selected 243, and passed 243/243 with zero failed and zero
skipped in 418.639s. The full 3,007-test suite, CI, and unchanged-frontend
runtime certification remain open.

## 2026-07-11 Volunteer QR Attendance Checkpoint

The Laravel QR-attendance workflow is now implemented on its exact four-route
surface:

- `GET /api/v2/volunteering/shifts/{id}/checkin` issues or reuses one personal
  token only for the authenticated volunteer's exact approved shift assignment;
- `POST /api/v2/volunteering/checkin/verify/{token}` records coordinator
  check-in within Laravel's early/stale time window;
- `POST /api/v2/volunteering/checkin/checkout/{token}` permits late checkout
  for an already checked-in volunteer; and
- `GET /api/v2/volunteering/shifts/{id}/checkins` returns sanitized attendance
  history/roster data without exposing the bearer token.

New tokens are globally unique, exactly 64 lowercase hexadecimal characters.
Management actions require an active tenant/platform administrator, the volunteer
organisation owner, or an active organisation `owner`, `admin`, `manager`, or
`coordinator`. Malformed, unknown, cross-tenant, and post-authorization token
failures that Laravel masks use the canonical 404 contract. An authenticated
same-tenant caller who lacks coordinator permission receives 403 `FORBIDDEN`;
anonymous requests remain subject to the route's authorization policy. Token
issuance requires the current exact approved assignment, while an already-issued
token can still verify and checkout after later shift/application lifecycle
changes, matching Laravel's token workflow. Verify is idempotent. Checkout
deliberately uses a safer conditional single-winner transition under concurrency
instead of allowing duplicate successful completions.

QR attendance remains evidence-only: it does not itself create volunteer
hours/logs, personal or organisation transactions, balance changes, XP, or
rewards, and it does not populate legacy `HoursLogged`/`TransactionId`
evidence. The separate canonical volunteer-hours workflow above owns those
effects. An outgoing `shift.completed` webhook and Laravel's child-to-parent
tenant-domain inheritance remain open.

Shift-swap duplicate requests and each individual decision are serialized, but
global per-user assignment locking across two distinct concurrent swaps or a
different approval writer remains open. Notification/localization side effects
and unchanged-frontend swap smoke also remain open. ASP.NET explicitly rejects
swap messages above its persisted 1,000-character limit with HTTP 400, while
Laravel's text column accepts longer messages.

Focused evidence is 32/32 for the PostgreSQL attendance suite, 1/1 for the
injected persistence-failure 500 contract, 12/12 for shift-swap assignment/
member/admin/concurrency behavior, 5/5 for the route/auth subset, and 90/90 for
the affected cross-module gate. The ambient-transaction regression is green.
The test-project build has 0 errors and 4 pre-existing `xUnit1031` warnings;
migration discovery was green for the then-current 111-migration chain through
`20260711192124_VolunteerHoursLedgerParity`. The current 114-migration chain and
latest model evidence are recorded in the safeguarding checkpoint above.
This is local focused evidence, not a green full-suite claim: descendant CI run
`29154079189` was later cancelled after its completed Integration Tests job
reported 51 failures out of 2,888 tests. The only direct
regression attributable to the preceding `bfeafb2e` backend slice was a nested
transaction failure; that regression is fixed and green locally, while the
remaining CI failures still require independent triage.

## Comparison Policy

Do not compare raw route declarations directly. For a reliable parity report:

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-api-parity.ps1`.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-api-parity.ps1`.
3. Export .NET Swagger/OpenAPI from a running local API.
4. Inventory Laravel React frontend API call sites from
   `C:\platforms\htdocs\staging\react-frontend`.
5. Normalize Laravel `/api/v2/...` and .NET `/api/...` compatibility prefixes.
   Add ASP.NET `/api/v2` aliases where the Laravel React frontend expects them.
6. Compare method + normalized path + auth policy + request schema + response
   schema.
7. Separately compare supplemental Laravel route files that are not represented
   in `openapi.json`; keep Laravel `govuk-alpha*` accessible page routes in the
   frontend parity report, not the API report.
8. Mark endpoints as one of:
   - `matched`
   - `missing`
   - `partial`
   - `renamed-compatible`
   - `replaced-by-equivalent-workflow`

For endpoints used by the Laravel React frontend, "matched" requires compatible
request bodies, query parameters, response envelopes, pagination metadata,
validation errors, auth/tenant errors, upload fields, status codes, and feature
disabled behavior. Static method/path matches are not enough.

## Laravel React Compatibility Rule

For every Laravel React API call, ASP.NET must expose the same method/path and
compatible request/response behavior. If a .NET route already exists under
`/api/...` but Laravel React calls `/api/v2/...`, add the `/api/v2` alias.

Prove contract identity with:

- route/API matrix rows linking Laravel React call sites, Laravel routes/OpenAPI,
  and ASP.NET routes/OpenAPI;
- focused ASP.NET regression tests;
- runtime smoke tests using the Laravel React frontend against the ASP.NET API.

See `REACT_FRONTEND_RETIREMENT.md` for the full frontend retirement policy.

Current backend-only Laravel React slice now has focused ASP.NET regression
coverage for `GET /api/v2/wallet/config`,
`GET/POST /api/v2/notifications/settings`, and
`POST /api/v2/support/reports`, including the admin support-report queue read
path used for operational follow-up.

The Laravel React donation checkout slice now has focused ASP.NET regression
coverage for `POST /api/v2/donations/payment-intent` and
`GET /api/v2/donations/{id}/receipt`. The .NET compatibility path persists a
tenant-scoped pending `MoneyDonation`, returns the React `client_secret` /
`donation_id` envelope, and returns JSON receipt data for the receipt component.

The Laravel React member-premium member slice now has focused ASP.NET contract
coverage for `GET /api/v2/member-premium/tiers`,
`GET /api/v2/member-premium/me`,
`POST /api/v2/member-premium/checkout`, and
`POST /api/v2/member-premium/billing-portal`, plus the local
`POST /api/v2/member-premium/cancel` envelope, driven from
`react-frontend/src/pages/premium/PricingPage.tsx` and
`react-frontend/src/pages/premium/MySubscriptionPage.tsx`. ASP.NET now projects
public active `SubscriptionPlan` rows into Laravel React `data.tiers[]`, with
numeric ids, slugs, price cents, feature arrays, sort order, and no Stripe price
ids; projects the current `UserSubscription`/`SubscriptionPlan` into
`subscription`, `entitled_tier`, and `unlocked_features`; accepts the React
`tier_id`, `interval`, and `return_url` checkout payload and returns
Laravel-style `success/data.checkout_url/session_id`; accepts billing portal
`return_url` while returning `success/data.portal_url` instead of the legacy
`data.url` mock; and marks active local subscriptions cancelled with
`success/data.cancelled`. Real Stripe member checkout/portal session creation,
provider-backed cancellation/webhook processing, billing-interval storage, and
exact Laravel member-premium tier/subscription schema parity remain deeper gaps.

The Laravel React admin member-premium tier read calls
`GET /api/v2/admin/member-premium/tiers` and
`GET /api/v2/admin/member-premium/tiers/{id}`, plus the create call
`POST /api/v2/admin/member-premium/tiers`, update call
`PUT /api/v2/admin/member-premium/tiers/{id}`, delete call
`DELETE /api/v2/admin/member-premium/tiers/{id}`, and subscriber list call
`GET /api/v2/admin/member-premium/subscribers`, from
`react-frontend/src/admin/api/memberPremiumApi.ts` and
`MemberPremiumAdminController::listTiers/showTier/createTier/updateTier/deleteTier/listSubscribers`,
now have focused ASP.NET regression coverage. ASP.NET returns `success/data.tiers[]`
for the tier list, includes inactive tenant-scoped `SubscriptionPlan` rows for admins,
projects Laravel React tier fields including `tenant_id`, price cents, features,
Stripe price id placeholders, and `active_subscriber_count`, returns
`success/data.tier` plus Laravel-style `TIER_NOT_FOUND` for detail reads, and
creates tiers with HTTP 201 while preserving Laravel-only tier metadata in tenant
config alongside `SubscriptionPlan`. Tier updates now accept the Laravel React
partial update payload, persist slug/yearly price/sort/features metadata, update
`SubscriptionPlan` fields, clear stale Stripe price metadata on price changes,
and return `success/data.tier`. Tier deletes now return `success/data.deleted`,
block active/past-due local subscribers with Laravel-style `DELETE_FAILED`, and
remove tier metadata with the local plan. Subscriber listing now returns
`success/data.rows/total/page/per_page` with tenant-scoped subscription, tier,
and user fields. Stripe sync now returns `success/data.tier` and persists
React-visible local `stripe_price_id_*` plus `stripe_price_account_id` metadata.
Real Stripe provider-backed product/price creation and exact `billing_interval`
storage remain deeper operational/schema gaps.

The Laravel React billing slice now has focused ASP.NET regression coverage for
`GET /api/v2/billing/plans`, `GET /api/v2/admin/billing/subscription`,
`POST /api/v2/admin/billing/checkout`, and `GET /api/v2/admin/billing/invoices`
as used by
`react-frontend/src/admin/api/billingApi.ts`. The .NET compatibility path uses
tenant-scoped `SubscriptionPlan`/`UserSubscription` rows instead of placeholder
lists, returns Laravel React `Plan` fields for public plans, returns the
singular admin `SubscriptionDetails` object with `plan_id`, `plan_name`,
`plan_tier_level`, `status`, period dates, cancellation flag, and
`stripe_subscription_id`, activates zero-price plans with the Laravel React
`{ activated: true, checkout_url: null }` data envelope, returns a local
Laravel-style `checkout_url` / `session_id` envelope for paid plans instead of a
generic `501`, and projects subscription-backed invoice rows with the React
`number`, `date`, `amount`, `currency`, `status`, `hosted_invoice_url`, and
`invoice_pdf` fields.
`POST /api/v2/admin/billing/portal` now returns Laravel's `NO_SUBSCRIPTION`
error envelope instead of a generic compatibility write when no Stripe customer
is available, and `POST /api/v2/admin/billing/upgrade-request` now returns the
Laravel `data.sent=true` envelope while recording an `AuditLog` entry for the
tenant request. Real Stripe paid checkout session creation, real Stripe
portal/invoice retrieval/session behavior, provider-backed upgrade email
delivery, billing-interval storage, and exact Laravel `pay_plans` /
`tenant_plan_assignments` schema parity remain deeper gaps.

The Laravel React admin matching configuration slice now has focused ASP.NET
regression coverage for `GET /api/v2/admin/matching/config` and
`PUT /api/v2/admin/matching/config` as used by
`react-frontend/src/admin/api/adminApi.ts` and the matching admin pages. The
.NET compatibility path returns Laravel's `data` envelope with
`category_weight`, `skill_weight`, `proximity_weight`, `freshness_weight`,
`reciprocity_weight`, `quality_weight`, five `proximity_bands`, gates,
`engine_version`, pillars, adjustments, and AI flags, and persists Laravel
React partial updates into tenant-scoped matching config while preserving the
legacy `/api/admin/matching/config` response. Deeper smart-matching engine
score parity, cache-table deletion semantics, analytics fidelity, broker
approval workflow parity, and runtime frontend smoke coverage remain gaps.

The 2026-07-09 static API route gap closure slice now has focused ASP.NET
regression coverage for the final three comparator misses:
`GET /api/v2/admin/volunteering/expenses/{id}/receipt`,
`GET /api/v2/media/thumbnail`, and
`POST /api/v2/merchant-onboarding/image`. That checkpoint's comparator reported
2,436/2,436 source operations matched and 0 missing operations. A later
2026-07-12 checkpoint superseded it with 2,439/2,583 matched and 144 exact
missing routes. Both are historical; the dated static source-count section at
the top of this document and `CURRENT_ASPNET_CONTRACT_STATUS.md` govern current
representation and scoring.
Static method/path coverage alone does not prove the deeper contract, schema,
service side-effect, and runtime smoke checks tracked in the module map and gap
register.

The tenant-aware install-manifest workflow now owns both `GET
/api/pwa/manifest` and `GET /api/v2/pwa/manifest`. It returns raw
`application/manifest+json; charset=UTF-8`, `public, max-age=300,
stale-while-revalidate=60`, and `Vary: Host`; overlays tenant name, short name,
id, start URL, scope, and shortcut prefixes; resolves path tenants on the shared
host; and restricts dedicated-domain path switching to active direct children
represented by `tenant_hierarchies`. The public route uses an independent
60/minute client bucket. Focused PostgreSQL runtime passes 2/2 and route/policy
ownership passes 1/1.

The Laravel React availability grid slice now has focused ASP.NET regression
coverage for `GET /api/v2/users/me/availability`,
`PUT /api/v2/users/me/availability`, and
`GET /api/v2/users/{id}/availability`. The .NET compatibility path accepts the
React `{ slots: [...] }` bulk payload, replaces tenant-scoped
`MemberAvailability` rows, and returns the React `success/data.weekly/timezone`
envelope.

The Laravel React theme bootstrap slice now has focused ASP.NET regression
coverage for `GET /api/v2/users/me`, `PUT /api/v2/users/me/theme`, and
`PUT /api/v2/users/me/theme-preferences`. The .NET compatibility path returns
`preferred_theme` and `theme_preferences` on the profile response, persists the
React theme payload, and returns Laravel-style `success/data` envelopes for
theme and theme-preference updates.

The Laravel React presence context slice now has a backend contract test for
`POST /api/v2/presence/heartbeat`, `GET /api/v2/presence/online-count`,
`GET /api/v2/presence/users?user_ids=...`, `PUT /api/v2/presence/status`, and
`PUT /api/v2/presence/privacy`. The .NET compatibility path accepts the empty
heartbeat body used by `PresenceContext.tsx`, persists tenant-scoped presence
status, returns the React user-id keyed presence dictionary with
`status`/`last_seen_at`/`custom_status`/`status_emoji`, and stores the custom
status/privacy metadata in tenant config. Runtime test execution is still
blocked in this Windows environment by Application Control on the copied
`Nexus.Api.dll`; the focused test currently builds but cannot be counted as run.

The Laravel React realtime bootstrap slice now has a backend contract test for
`GET /api/v2/realtime/config` and `POST /api/pusher/auth` requests. The
.NET compatibility path returns the Laravel React Pusher bootstrap envelope
(`success/data`, `driver`, `key`, `cluster`, `ws_host`, `ws_port`, `force_tls`,
`authEndpoint`, `enabled`), keeps realtime disabled unless key/secret/app id are
configured, and returns Laravel-style validation errors for missing
`socket_id`/`channel_name`. When Pusher is configured, `/api/pusher/auth` now
returns raw Pusher `{ auth }` / `{ auth, channel_data }` JSON instead of a
Laravel envelope, signs private and presence channels with the configured
secret, and rejects cross-tenant/private-user subscriptions with Laravel-style
forbidden errors. End-to-end broadcast smoke coverage remains a gap until a
configured Pusher app is available.

The Laravel React system cron-jobs slice now has focused ASP.NET regression
coverage for `GET /api/v2/admin/system/cron-jobs` and
`POST /api/v2/admin/system/cron-jobs/{id}/run` as used by
`react-frontend/src/admin/modules/system/CronJobs.tsx` and
`react-frontend/src/admin/api/adminApi.ts`. Natural and manual runs now share
one execution gate/body and persist their real result. `listing-expiry`,
`job-expiry`, `volunteer-expire-consents`, and `recurring-shifts` execute the
equivalent .NET jobs; the other 38 of 42 definitions report `status=disabled`,
`execution_supported=false`, and return HTTP 501 if
manually invoked. Busy, disabled, cancelled, non-persisted, and failed outcomes
cannot return success; per-tenant jobs exclude inactive tenants, the global
guardian-consent expiry intentionally remains all-tenant, and skipped/running
log statuses are preserved. Full scheduled-job service equivalence and
fresh-runtime `scheduled_job_runs` proof remain open.

The canonical 2FA/WebAuthn slice now uses opaque, short-lived, single-use
capabilities rather than temporary bearer tokens. TOTP login challenges bind
the user, tenant, and enrollment timestamp; tenant/enrollment drift consumes
the challenge before code verification. Canonical setup uses a real SVG QR
code, backup-code enablement is atomic, and disable requires the password.
Passkey registration/authentication challenges are atomically consumed once per
API process and all ten `/api/webauthn/*` routes have one real owner. Canonical
security confirmation accepts password, TOTP, backup code, or recent UV-passkey
proof and returns a signed five-minute user/tenant/method-bound token. Enrollment
challenge/verification and credential remove/rename/remove-all now enforce that
proof, with an independent authenticated 10-per-600-second bucket and no-store
responses. Focused PostgreSQL workflows and token contract tests pass 2/2 each.
Route/policy ownership passes 1/1. Both challenge stores remain process-local;
federated recent-session proof,
last-sign-in-method protection, session revocation/notifications, trusted
devices, TOTP-specific encryption-key separation, multi-node proof, WebAuthn
sign-counter concurrency, and browser smoke remain production-readiness gaps.

Forced first-login admin 2FA enrollment is explicitly unsupported while the
canonical React flow is incompatible. Enabling either `ForceAdmin2Fa` or
`FORCE_ADMIN_2FA` now blocks startup with a lockout-risk error; ordinary
enrolled-user login enforcement and voluntary authenticated setup remain live.

The Laravel React typing-indicator route is workflow-complete for `POST
/api/v2/messages/typing`: it accepts `recipient_id/is_typing`, applies the full
sender, recipient, restriction, bilateral-block, and safeguarding preflight,
works before a conversation exists without creating one, and publishes the
exact signed Pusher tenant-user channel/event contract. Endpoint/route coverage
passes 7/7 and transport request-signature coverage passes 1/1; live external
provider delivery remains part of final provider certification.

The Laravel React messaging restriction slice now uses live
`user_monitoring_restrictions` state for
`GET /api/v2/messages/restriction-status`. It returns the composer-gating
fields read by `MessagesPage.tsx` and `ConversationPage.tsx`:
`messaging_disabled`, `under_monitoring`, and `restriction_reason`; expired
monitoring is cleared persistently. Admin monitoring writes validate the
tenant/user/reason, store the flag and expiry, audit/notify, and clear the
safeguarding-created broker approval on removal. The physical table remains a
documented adapter for Laravel's `user_messaging_restrictions`.

The Laravel React message inbox slice now has focused ASP.NET regression
coverage for `GET /api/v2/messages`. The .NET route is no longer ambiguous
between the v1.5 member parity shim and `MessagesController`; the controller
now owns the `/api/v2/messages` alias, accepts Laravel's `per_page` query
parameter, and returns `success/data/meta` collection metadata while preserving
the older `pagination` object for existing .NET clients. Conversation archived
state remains a deeper parity gap because the current ASP.NET `Conversation`
entity does not yet store archived status.

The Laravel React message send/thread slice now has focused ASP.NET regression
coverage for `POST /api/v2/messages` and `GET /api/v2/messages/{id}` as used by
`ConversationPage.tsx`. The duplicate explicit v2 send route was removed so the
route-alias convention has a single owner, v2 sends now return the
`success/data` envelope consumed by the Laravel React API client, and v2 sends
now accept the multipart `attachments[]` form-data path used by
`ConversationPage.tsx`, including attachment-only sends with an empty `body`.
Uploaded files are stored through the .NET file service and returned as message
`attachments[]` rows with filename, MIME, size, and `/api/files/{id}/download`
URLs. V2 thread loads treat `{id}` as the other user id instead of an internal
conversation id. The thread response returns message rows in `data` with
`meta.conversation`, `per_page`, `cursor`, and `has_more`; the legacy
`/api/messages/{id}` path keeps its conversation-id response shape for existing
ASP.NET callers.

The Laravel React voice-message slice now has focused ASP.NET regression
coverage for `POST /api/v2/messages/voice` as used by `ConversationPage.tsx`.
ASP.NET accepts multipart `recipient_id` plus `voice_message`, validates bytes
through a dedicated audio allowlist, runs sender/restriction/block/safeguarding
preflight before staging, repeats the policy check under the write lock, and
commits conversation, message, upload, attachment, and voice metadata together.
Rollback and file cleanup remain independent, so spoofed audio, policy denial,
or persistence failure leaves no ghost row/file/effect. Success returns
Laravel-style `data/meta` with `is_voice`, `audio_url`, minimum-one-second
`audio_duration`, sender/recipient rows, and an attachment row, then runs the
normal message notification/XP/realtime effects. Provider transcription and
exact Laravel voice columns remain deeper workflow/schema gaps.

The Laravel React unread/read-receipt slice now has focused ASP.NET regression
coverage for `GET /api/v2/messages/unread-count` and
`PUT /api/v2/messages/{id}/read`. The unread-count route returns
`success/data.count` for `NotificationsContext.tsx`, filters receiver-archived,
receiver-deleted, and globally deleted rows, and resolves conversations within
the active tenant. The read route treats `{id}` as the other user id for
`ConversationPage.tsx`, marks only messages sent by that user as read, returns
only `success/data.marked_read`, and does not emit an extra read event absent
from Laravel. Both use independent authenticated 60/minute buckets. Legacy
`/api/messages/unread-count` and `/api/messages/{conversationId}/read` retain
their older response shapes, conversation-id semantics, and legacy realtime
side effect. Route/policy ownership is 1/1, focused runtime is 3/3, and combined
direct-message regression is 44/44.

The Laravel React message translation slice now has focused ASP.NET regression
coverage for `POST /api/v2/messages/{id}/translate` as used by
`MessageBubble.tsx` and `ConversationPage.tsx` auto-translate. The compatibility
handler now loads the stored message, verifies the current user participates in
the conversation, accepts Laravel's `target_language` payload, and returns
`success/data.translated_text` plus `source_type`. This is a deterministic
content fallback; provider-backed translation quality remains a deeper parity
gap.

The Laravel React message reaction P1 workflow is now durable. `POST
/api/v2/messages/{id}/reactions` accepts only Laravel's exact six emoji, stores
one tenant/message/user/emoji row in `message_reactions`, serializes concurrent
toggles, re-evaluates ordinary and safeguarding contact policy before an add,
and always permits withdrawal of an existing reaction after policy closes.
`GET /api/v2/messages/reactions/batch?ids=...` accepts at most 100 parsed IDs,
returns Laravel `emoji/count/user_ids` groups in first-reaction order, includes
reactions on soft-deleted messages, and suppresses nonparticipant/cross-tenant
data. Toggle and batch use independent 60/minute and 30/minute buckets. Focused
PostgreSQL and route-owner coverage passed 9/9. Migration 116 creates the exact
snake_case table and unique key; blank replay and model-drift checks are green.

The latest backend-only Laravel React utility slice also covers the final
static API parity gaps: public health, public changelog, public page/static
route content, notification unsubscribe, AI chat starters/feedback, admin
volunteering donations list/complete, and Postmark webhook aliases under both
`/api` and `/api/v2` where applicable.

The admin prerender React contract is also covered by focused ASP.NET
regression tests for the summary, inventory, coverage, events, failures, jobs,
job enqueue/cancel/retry, purge, invalidate, analytics, health, audit, reset,
CSV export, TTL inspector, sitemap explorer, metrics, and realtime-channel
routes. The .NET layer is a compatibility adapter; it does not execute the
Laravel/PHP prerender worker or delete snapshot files.

The admin/system utility slice now exposes Laravel React-compatible aliases for
registration breaker status/resume, retention policy reads/writes/runs, powered
by image uploads, header colour persistence, admin resend-verification-email,
and safe super-tenant purge preview/purge compatibility. The destructive tenant
purge endpoint deliberately returns a queued compatibility response and does not
delete tenant data from this development backend.

The member/auth utility slice exposes Laravel React-compatible aliases for
public SSO provider discovery/redirect, OAuth callback-code exchange, OS Places
lookup, exchange attention count, given reviews, goal insights, goal buddy
nudge, typed match dismissals, and coordinator assistance requests. The later
secure SSO slice replaces the former callback-error stub with signed state,
PKCE, OIDC token validation, tenant-qualified linked identity persistence,
domain/provisioning gates, and a one-time browser exchange. Live IdP/browser
proof remains open.

Connected-accounts OAuth is a separate workflow and still follows Laravel's
default `OAUTH_ENABLED=false` kill-switch behavior: enabled provider discovery
and `/me/identities` `enabled_providers` return empty arrays by default, while
supported providers remain discoverable; redirect/link attempts return Laravel-
style disabled-flow errors instead of synthetic redirect URLs. Real enabled-
provider credentials and browser OAuth smoke coverage remain deeper gaps for
that connected-accounts flow.

The Laravel React blocked-users settings slice now has focused PostgreSQL-backed
contract coverage for `POST /api/v2/users/{id}/block`, `GET
/api/v2/users/blocked`, `GET /api/v2/users/{id}/block-status`, and `DELETE
/api/v2/users/{id}/block`. ASP.NET now persists tenant-scoped rows in the
Laravel-compatible `user_blocks` table, returns blocked-user rows with
`block_id`, `user_id`, `name`, `first_name`, `last_name`, `avatar_url`,
`reason`, and `blocked_at`, removes same-tenant connection rows on block, and
returns Laravel-style `data.success` / `errors[].code=NOT_FOUND` envelopes for
unblock flows. Feed/search/message exclusion side effects remain broader
workflow gaps beyond this settings-page contract.

The Laravel React skills settings slice now has focused PostgreSQL-backed
contract coverage for `GET/POST /api/v2/users/me/skills`, `PUT
/api/v2/users/me/skills/{id}`, and `DELETE /api/v2/users/me/skills/{id}`.
ASP.NET now accepts Laravel React custom `skill_name` payloads, creates or
reuses tenant-scoped `skills` rows, persists `user_skills`, returns HTTP 201
with the refreshed Laravel `data` array, projects `skill_name`, category fields,
`proficiency_level`, offering/requesting flags, `endorsement_count`, and returns
a Laravel-style `data.message` envelope on delete. Exact Laravel
`skill_categories`, offering/requesting storage, endorsement table semantics,
and skill-search taxonomy fidelity remain deeper skills-module gaps.

The Laravel React safeguarding settings slice now has focused PostgreSQL-backed
contract coverage for `GET /api/v2/safeguarding/my-preferences` and `POST
/api/v2/safeguarding/revoke`, driven from
`react-frontend/src/pages/settings/tabs/SafeguardingTab.tsx` and Laravel
`SafeguardingMemberController`. ASP.NET now persists tenant-scoped
`user_safeguarding_preferences`, returns `data.preferences` plus `data.count`
with Laravel React `preference_id`, `option_id`, option labels, selected value,
consent/create timestamps, and `activations`, stamps annual review confirmation
on read, and soft-revokes the member's active preference by `option_id`.
Admin/broker notification side effects, trigger re-evaluation, exact Laravel
`tenant_safeguarding_options` naming, and runtime browser smoke coverage remain
deeper safeguarding gaps.

The Laravel React linked-accounts settings slice now has focused ASP.NET
contract coverage for `GET /api/v2/users/me/sub-accounts`, `GET
/api/v2/users/me/parent-accounts`, `POST /api/v2/users/me/sub-accounts`, `PUT
/api/v2/users/me/sub-accounts/{id}/approve`, `PUT
/api/v2/users/me/sub-accounts/{id}/permissions`, and `DELETE
/api/v2/users/me/sub-accounts/{id}` as used by
`react-frontend/src/components/subaccounts/SubAccountsManager.tsx`. ASP.NET now
accepts Laravel React email-based relationship requests, returns pending/active
relationship rows with `relationship_id`, `relationship_type`, permissions,
status, user identity fields, and timestamps, allows the child account to
approve a pending relationship, lets the parent update React permission keys,
and removes linked rows through the React delete call. Exact Laravel
`account_relationships` table naming, soft-revoked/rejected history,
notification side effects, maximum-child/nesting/circular validation parity,
activity summary fidelity, and browser smoke coverage remain deeper gaps.

The Laravel React FADP consent-banner slice now has focused ASP.NET contract
coverage for `POST /api/v2/me/fadp/consent` and `GET
/api/v2/me/fadp/consent-history`, driven from
`react-frontend/src/components/legal/FadpConsentBanner.tsx` and Laravel
`FadpComplianceController::recordConsent/myConsentHistory`. ASP.NET now accepts
Laravel's required `consent_type` plus `action=granted|withdrawn` payload,
returns `data.recorded`, `data.consent_type`, and `data.action`, persists the
grant/withdrawal state in `consent_records`, and projects history rows with the
Laravel `action` field. Exact append-only Laravel `fadp_consent_records`
schema, `consent_version`, `user_agent`, metadata storage, and service-side
FADP availability checks remain deeper compliance gaps.

The Laravel React feed-ad slice now has focused ASP.NET contract coverage for
`GET /api/v2/ads/active`, `POST /api/v2/ads/impression`, and `POST
/api/v2/ads/impression/{impressionId}/click`, driven from
`react-frontend/src/pages/feed/FeedPage.tsx`,
`react-frontend/src/components/feed/FeedAdCard.tsx`, and Laravel
`LocalAdvertisingController::getActiveAds/recordImpression/recordClick`.
ASP.NET now returns active tenant ad creatives as the React feed-card fields
`campaign_id`, `creative_id`, `advertiser_name`, `title`, `body`,
`image_url`, `cta_url`, `cta_label`, and `tracking_token`, accepts the React
`creative_id` plus `placement` impression payload, returns
`data.impression_id`, and returns `data.ok=true` for click tracking while
preserving legacy aliases. Exact Laravel `local_ad_*`, `ad_impressions`, and
`ad_clicks` storage, serveable-creative validation, signed tracking-token
verification, campaign counter/budget updates, and duplicate-click suppression
remain deeper local-advertising gaps.

The Laravel React feed profile-card stats slice now has focused ASP.NET
contract coverage for `GET /api/v2/me/stats`, driven from
`react-frontend/src/components/feed/sidebar/ProfileCardWidget.tsx` and Laravel
`UsersController::stats` / `UserService::getProfileStats`. ASP.NET now returns
the React `listings_count`, `given_count`, `received_count`, `offers_count`,
`requests_count`, and `wallet_balance` fields while retaining older stats
aliases. Exact Laravel `users.balance` column parity remains a schema gap;
.NET derives `wallet_balance` from completed time-credit transactions.

The Laravel React feed-sidebar aggregate slice now has focused ASP.NET
contract coverage for `GET /api/v2/feed/sidebar`, driven from
`react-frontend/src/components/feed/sidebar/FeedSidebar.tsx` and Laravel
`FeedSidebarController::sidebar`. ASP.NET now returns the Laravel-style
`success/data` envelope with `community_stats`, `top_categories`,
`upcoming_events`, `popular_groups`, `suggested_listings`, `friends`, and
`profile_stats`, while retaining legacy `trending_hashtags` and
`suggested_groups` aliases. Exact Laravel cache behavior, `categories.type`
filtering, group visibility/member status rules, friend/suggested-member
ranking, and runtime browser smoke coverage remain deeper social-feed gaps.

The Laravel React appreciations slice now has focused ASP.NET contract coverage
for `POST /api/v2/appreciations`, `GET /api/v2/users/{userId}/appreciations`,
`GET /api/v2/me/appreciations`, `POST /api/v2/appreciations/{id}/react`, and
`GET /api/v2/appreciations/most-appreciated`, driven from
`react-frontend/src/components/social/AppreciationModal.tsx`,
`react-frontend/src/pages/profile/AppreciationWallPage.tsx`,
`react-frontend/src/components/social/MostAppreciatedWidget.tsx`, and Laravel
`AppreciationsController` / `AppreciationService`. ASP.NET now returns the
Laravel `success/data` send envelope with HTTP 201, public wall and mine
pagination metadata including `total_pages`, sender and `my_reaction` fields,
reaction toggle results/counts, and most-appreciated leaderboard rows. Exact
Laravel `appreciations` / `appreciation_reactions` schema fidelity, daily
send-limit/cache behavior, notification/email/push side effects, delete-reaction
coverage, and runtime browser smoke coverage remain deeper social gaps.

The Laravel React link-preview compose hook now has focused runtime coverage for
`GET /api/v2/link-preview?url=...` and `POST /api/v2/link-preview`. ASP.NET
now returns Laravel-style `success/data` envelopes with `url`, `title`,
`description`, `site_name`, and `image`, and rejects non-HTTP(S) POST payloads
with `success=false` plus `errors[].code=VALIDATION_ERROR`. Full OpenGraph
fetching, caching, remote timeout handling, and provider-grade metadata fidelity
remain deeper parity gaps beyond the deterministic local fallback.

The Laravel React resources page now has focused ASP.NET contract coverage for
anonymous tenant-scoped `GET /api/v2/resources`, anonymous
`GET /api/v2/resources/categories`, authenticated multipart
`POST /api/v2/resources`, and authenticated
`GET /api/v2/resources/{id}/download`, driven from
`react-frontend/src/pages/resources/ResourcesPage.tsx` and Laravel
`Api\ResourcePublicController`. ASP.NET now returns the React-facing
`success/data/meta` collection envelope with cursor metadata, `per_page`,
`has_more`, `base_url`, search/category filters, `file_url`, `file_path`,
`file_type`, `file_size`, `downloads`, uploader rows, category color rows,
social count defaults, and Laravel's `sort_order` plus newest-first ordering
while preserving legacy `/api/resources` auth behavior. Uploads now use
Laravel's allowlisted resource file extensions and content-type inspection,
reject SVG with `errors[].code=FILE_TYPE_NOT_ALLOWED` before storage, persist
resource-linked `FileUpload` metadata, and stream the stored bytes back through
the download route with focused runtime coverage.
Downloads now increment a tenant-scoped compatibility counter and subsequent
list reads expose the updated `downloads` value. Exact Laravel
`resources.file_*`/`downloads` column fidelity, localized validation text,
update/delete authorization messages, category color persistence, resource
likes/comments, and browser smoke coverage remain deeper resource gaps.

The prior transactional volunteering core has 61/61 focused ASP.NET regression
tests plus a green pre-guardian 180/180 wider route/auth/notification/legacy
contract baseline. The guardian-consent lifecycle adds a clean 7/7 PostgreSQL-backed
regression result. A combined workflow/guardian/ownership filter exercised 68
cases: 67 passed in the combined run, and the sole PostgreSQL fixture-clear
timeout passed immediately in isolation. Tenant administrators can list and
conditionally approve or decline pending applications, while opportunity
organizers can make the same Laravel-shaped decision through
`PUT /api/v2/volunteering/applications/{id}` with persisted `org_note` data.
Selected-shift application, historical re-application after decline or
withdrawal, direct shift signup and movement, signup cancellation, application
withdrawal, group reservation create/add/remove/cancel, waitlist join/leave/
claim, released-place notification, and scheduled stale-offer expiry/reoffer
now mutate real tenant-scoped state with Laravel-compatible status and error
envelopes.

Every capacity-changing path uses a database transaction and the shared
tenant-scoped shift lock; application/opportunity, reservation, and waitlist
queue/offer locks serialize duplicate and final-place races. Capacity includes
approved shift assignments plus active group-reservation slots, and
post-commit side effects persist canonical bell notifications with top-level
links and object-valued data before attempting tenant-aware push and fallback
email delivery. The guardian gate is shared by application, direct signup,
waitlist join, and group-member addition: when enabled, a minor must have an
active, unwithdrawn and unexpired consent scoped to that opportunity or to the
whole tenant. Members can safely list and request consent; only a SHA-256 token
hash is stored, while the raw single-use credential is sent to the guardian by
email. The public tenant-scoped verification transition and owner/admin
withdrawal are conditional one-winner updates. Canonical admin reads are
status-filtered and cursor-paginated, the React module-config toggle is bridged
to the authoritative gate key, endpoint-specific limits are registered, email
attempts are audited, bell delivery follows durable state changes, and a daily
global job expires overdue pending or active records. Legacy admin mutation
routes return 410 instead of bypassing guardian verification. QR attendance and
the canonical volunteer-hours ledger are covered by the current checkpoints
above. Remaining confirmed gaps are localized built-in guardian copy and
Laravel's full tenant-link fallback chain, live provider delivery proof, and
Laravel React/browser runtime smoke against the ASP.NET backend.

Recurring-shift generation now matches Laravel's daily sweep rather than only
supporting one-off pattern calls. A registered per-tenant job aligns natural
runs to 06:00 UTC, processes active non-ended patterns through an inclusive
14-day horizon, and is available through the same real manual-run scheduler
path. Generation keeps the original recurrence anchor, uses strict ISO
weekday integers (`1=Monday` through `7=Sunday`), treats a truly empty weekly or
biweekly day list as every day, preserves biweekly week parity, clamps monthly
day 29/30/31 anchors to shorter month ends, and honors inclusive end dates and
cumulative maximums. A pattern-row lock, filtered unique occurrence key, and
targeted conflict handling make concurrent/repeated runs idempotent with an
accurate generated counter. Focused PostgreSQL coverage passes 13/13. Recurring
pattern CRUD now has Laravel envelopes, feature/rate gates, creator/admin
authorization, presence-aware partial updates, active-plus-inactive reads,
canonical lossless day-array writes, and two-stage delete cleanup, with 13/13
integration and 1/1 route-ownership coverage.

Volunteer-organisation wallet reads and mutations now use dedicated canonical
`vol_organizations` and `vol_org_transactions` storage. Member wallet summary,
plain-cursor transaction history, and whole-credit deposits share one focused
owner for both canonical and legacy routes; admin transaction history and
signed adjustments also have singular explicit owners. Deposits atomically
debit the member's derived .NET wallet ledger and credit the organisation,
while adjustments atomically enforce the no-negative-balance rule. Advisory
locks, tenant predicates, conditional validation, and PostgreSQL concurrency
coverage prevent overspend and cross-tenant mutation. The main .NET
`transactions` ledger uses nullable sender/receiver legs as an explicit adapter
for Laravel's direct `users.balance` mutations; this preserves externally
observable balances without claiming identical internal storage. The earlier
focused wallet suite passed 6/6. The current high-risk regression command
initially passed 103/106; the two corrected assertions and isolated retry of a
fixture-startup timeout then passed 3/3. The separate fail-closed contract suite
passes 119/119. QR attendance and canonical volunteer-hour reads, writes,
verification, payout, XP, badges, normal non-Caring decision bell/push, and
regional-points behavior now have the focused current evidence above. For those
normal decisions, approvals force immediate email; declines send immediate email
only when the global notification frequency is explicitly `instant`.
Tenant-default frequency fallback, daily/monthly notification-queue delivery,
and recipient locale/provider breadth remain open. The post-approval badge
sweep covers every badge family represented in ASP.NET; Laravel-only badge
families and realtime badge broadcast remain open. Reviewed Caring decisions
deliberately emit no decision bell, push, or email.
The definitive focused run is the single disposable-Linux 53/53 result above:
all 51 volunteer-hours cases and both feed-compatibility cases passed.

The current generic-organisation slice is separate from the volunteering
domain above. Public reads expose only public, verified organisations; private,
pending, and suspended organisations require tenant-scoped owner/member/admin
access. Membership writes validate both the organisation and user tenant,
prevent owner/admin role escalation by ordinary members, and treat canonical
`Organisation.OwnerId` as ownership rather than trusting a mutable membership
role. Organisation wallet donation, transfer, and admin grant paths require a
verified organisation and share lifecycle/advisory locks. Deletion uses the same
lifecycle lock and refuses to remove an organisation when wallet balance,
counters, or transaction history exists; a concurrency regression proves an
in-flight wallet write wins and its evidence remains. Wallet user search is
same-tenant, active-user, name-only, excludes the caller and suspended users,
does not expose email, and uses the Laravel 30-per-minute policy.

Group exchange now uses a server-owned lifecycle: drafts can be edited, start
validates provider/receiver roles and a positive immutable split, starting
resets any pre-fix confirmations, confirmation is allowed only while pending,
and completion requires every participant confirmation. One user cannot be on
both sides; zero, negative, and rounded-to-zero split entries are rejected;
settlement emits nonempty `group_exchange` ledger evidence under shared wallet
locks; and completed exchanges cannot be cancelled. This is real group-exchange
workflow evidence, not proof that the separate legacy one-to-one `Exchange`
workflow is complete.

The V15 wallet catch-all reads now use persisted data. Community-fund summary
and paged history derive from tenant-scoped `credit_donations`; pending count
comes from pending personal transactions; and starting balance uses
`wallet.starting_balance`, falls back to `general.welcome_credits`, then `5`.
The starting-balance write is admin-only and persisted. Unsafe donation,
community-fund deposit, and withdrawal aliases remain explicit HTTP 503 and do
not write. The legacy `/api/wallet/donate` alias is also explicit 503.

Caring loyalty redemption/reversal and positive hour-estate settlement now
persist authoritative, tenant-composite transaction IDs. Loyalty reversal
fails closed when a legacy applied row has no valid debit evidence, preventing
an unproven refund from minting credits. Repeated estate reporting/settlement
and post-settlement nomination are rejected. Ambiguous legacy evidence remains
null for operator review; it is not inferred from similar amounts or times.

Unsafe incomplete financial workflows remain deliberately unavailable rather
than reporting success: legacy one-to-one exchange completion lacks two-party
confirmation evidence; sub-account linking/pooling lacks managed-user approval;
and federation protocol, external financial-write, reconciliation, and member
exchange paths lack a durable authenticated settlement saga. Caller-supplied
federation message/review identity, partner webhook creation/listing, V2 ingest,
and cancellation after a transfer leaves pristine `Pending` also return stable
HTTP 503 without mutation. Federated listing/member reads now exclude blocked,
unopted, suspended, tenant-mismatched, or visibility-hidden owners. These HTTP 503 or
equivalent fail-closed contracts are safety improvements, not parity-complete
workflows.

At the volunteer-hours checkpoint, the then-latest migration was
`20260711192124_VolunteerHoursLedgerParity`, runtime ID 111. Its updated
contract does not insert legacy money or XP. It links only
uniquely provable existing evidence, downgrades evidence-free approved whole-hour
organisation rows to `pending`, and permits approved Caring sub-hour rows without
fabricated evidence. Blank ID-111 replay, valid populated 110-to-111 replay,
invalid `P0001` atomic-abort/no-partial-DDL proof, and
`has-pending-model-changes` are green; Docker cleanup left zero matching
resources. Debug API/test and solution-wide Release builds have zero errors and
only the same four pre-existing `xUnit1031` warnings; the Release build took
4m36s. Current focused proof is one 53/53 Linux run: all 51
`VolunteerHoursParityTests` plus both feed-compatibility tests, with 3,007 tests
discovered. The clean affected rerun selected and passed 243/243 with zero failed
or skipped in 418.639s. The full 3,007-test suite, CI, and unchanged-frontend
runtime certification remain open.
Migration discovery, the earlier 32/32 attendance suite, 1/1 persistence-failure
regression, 12/12 shift-swap suite, 5/5 route/auth subset, 90/90 affected-module
gate, and the ambient-transaction regression remain green historical evidence.
The earlier wallet/federation 103/106 plus corrected/retried 3/3, fail-closed
119/119, post-audit 24/24, and final 30/30 results also remain historical evidence
for the preceding slice.

## Known High-Risk API Gaps

Laravel volunteer-organisation wallet source references below use
`VolOrgWalletService.php` (not the retired descriptive filename).

The volunteer-hours portion of the broad volunteering row below is superseded
by the 2026-07-12 Volunteer Hours Ledger Checkpoint: `vol_logs`, all eight
canonical member/organisation/admin routes, verification, payouts, and XP now
have implementation and migration evidence. Any older wording in that aggregate
row that describes the ledger as absent or the hours writer as HTTP 503 is no
longer current.

The broad Marketplace row below is likewise historical where it describes real
Stripe settlement, Connect orchestration, escrow, refunds, or charge-dispute
recovery as absent. The dedicated marketplace rows and the 2026-07-15 contract
re-audit correction supersede those specific statements. The aggregate row
remains useful for the long-tail marketplace workflows that are still open.

Rows below that say a full suite or CI remained open preserve the evidence state
at each row's named implementation checkpoint. They are superseded for the
general aggregate only: exact-SHA run 29451087913 is green at `dbafc5c3`.
That later aggregate does not close live-provider, module-specific fixed-rubric,
or unchanged-client runtime gaps listed in those rows.

| Area | Laravel source | .NET source | Gap |
| --- | --- | --- | --- |
| Volunteering transactional workflows | `VolunteerController.php`, `AdminVolunteerController.php`, `VolunteerCommunityController.php`, `VolunteerService.php`, `ShiftWaitlistService.php`, `ShiftGroupReservationService.php`, `ShiftSwapService.php`, `GuardianConsentService.php`, `RecurringShiftService.php`, `VolOrgWalletService.php`, `vol_applications`, `vol_shift_waitlist`, `vol_shift_group_reservations`, `vol_shift_swap_requests`, `vol_guardian_consents`, `recurring_shift_patterns`, `vol_shifts`, `vol_organizations`, `org_members`, `vol_org_transactions` | `VolunteeringController.cs`, `VolunteeringParityController.cs`, `VolunteerAdminController.cs`, `ShiftManagementController.cs`, `AdminCompatibility2Controller.cs`, `VolunteerOrganisationWalletController.cs`, `AdminVolunteerOrganisationWalletController.cs`, `VolunteerHoursController.cs`, `VolunteerService.cs`, `VolunteerHoursService.cs`, `VolunteerAttendanceService.cs`, `AdminVolunteerApprovalService.cs`, `ShiftManagementService.cs`, `VolunteerGuardianConsentService.cs`, `VolunteerOrganisationWalletService.cs`, `VolunteerWaitlistOfferExpiryJob.cs`, `VolunteerGuardianConsentExpiryJob.cs`, `VolunteerRecurringShiftGenerationJob.cs`, `ShiftSwapAssignmentParityTests.cs`, `20260711010201_VolunteerOrganisationRelationshipsParity`, `20260711031959_NullableTransactionLedgerLegs`, `20260711143546_VolunteerQrAttendanceParity`, `20260711192124_VolunteerHoursLedgerParity`, `VolunteerHoursParityTests.cs`, focused workflow, attendance, ownership, wallet, swap, and concurrency tests | Transactional member, organizer, and admin application decisions; selected-shift apply/signup/cancel/withdraw; group reservation membership/cancellation; waitlist claim, released-place reoffer, stale-offer expiry; safe hashed-token guardian lifecycle; race-safe recurrence generation/CRUD; canonical volunteer-organisation lifecycle; member/admin wallet workflows; the canonical eight-route volunteer-hours ledger with verification, personal/organisation payout evidence, XP, threshold badges, normal non-Caring reviewed-decision bell/push, forced-immediate approved-decision email, immediate declined-decision email only for an explicit global `instant` frequency, represented-family post-approval badge sweep, explicit no-decision-notification behavior for reviewed Caring, and regional-points effects; the four Laravel QR-attendance routes; and the member/admin V2 shift-swap lifecycle are implemented. Direct and admin-approved swaps lock both shifts and exact approved applications, exchange only `VolunteerApplication.ShiftId`, preserve QR rows/tokens on their original shifts as historical evidence, reject started/stale/overlapping assignments atomically, derive admin approval from tenant config, serialize duplicate requests, and expose Laravel/React snake-case payloads, `{action}` decisions, envelopes, feature gates, and rate limits. Direct Caring logging retains raw fractional semantics for whole-hour flooring and regional points before rounded storage. QR attendance issues one global 64-lowercase-hex token for an exact approved assignment, authorizes tenant/org coordinators, masks malformed/unknown/cross-tenant token lookups with canonical 404, returns 403 `FORBIDDEN` to authenticated same-tenant non-coordinators, supports time-bounded verification and late checkout, retains sanitized history, and never mints hours, transactions, balances, XP, or rewards. Checkout intentionally uses a safer single-winner transition. Confirmed residuals are swap notification/localization side effects and cross-workflow serialization against a concurrently approved third overlapping assignment; the full 3,007-test suite and CI; outgoing `shift.completed`; child-to-parent tenant-domain inheritance; the recorded-only admin timebank overview; contract depth elsewhere; tenant-default notification-frequency fallback, daily/monthly notification-queue delivery, recipient locale/provider breadth, Laravel-only badge families, and realtime badge broadcast; and live Laravel React/browser runtime smoke. |
| Generic organisations and organisation wallets | Laravel organisation/profile/member/wallet controllers and services; `organisations`, `organisation_members`, `org_wallets`, `org_wallet_transactions` | `OrganisationsController.cs`, `OrgWalletController.cs`, `OrganisationService.cs`, `OrgWalletService.cs`, `OrganisationLifecycleLock.cs`, `OrganisationConfiguration.cs`, `OrgWalletConfiguration.cs`, `GenericOrganisationSecurityTests`, `20260711100817_LoyaltyEstateOrganisationEvidence` | Verified/public visibility, tenant-scoped private/member/admin access, canonical owner authorization, role-escalation protection, verified-only financial writes, lifecycle/wallet locking, tenant-composite constraints, and wallet-evidence-preserving delete refusal are implemented and concurrency-tested. Runtime frontend smoke and every Laravel notification/audit side effect remain open. |
| Group exchanges | Laravel `GroupExchangeController`, service, participant/split workflow, canonical React group-exchange pages | `GroupExchangeController.cs`, `GroupExchangeService.cs`, focused lifecycle/policy/conservation/race tests | Create/add/start/confirm/complete/cancel now enforce Laravel caller and role identity, create/add authorization order, participant and dual-role semantics, caller-visible status, deterministic locks with caller-order policy evaluation, lifecycle guards, canonical provider transaction rows, hidden ledger adapters, all-party confirmation, conservation, idempotency, and first-writer behavior. Notification fidelity and unchanged-frontend smoke remain open; this does not complete legacy one-to-one `Exchange`. |
| V15 wallet/community fund | Laravel wallet/community-fund/starting-balance routes and canonical wallet search | `V15MemberParityController.cs`, `ReactFrontendCompatibilityController.cs`, `WalletAliasSafetyTests.cs` | Community-fund summary/history and pending count read persisted tenant data; starting balance has persisted admin-only configuration with legacy fallback; name-only same-tenant user search is 30/min and hides email. Donation/deposit/withdraw compatibility aliases remain honest HTTP 503 until a canonical writer exists. |
| Caring Community | `routes/caring-community-*.txt`, `routes/municipality-survey-routes.txt`, `routes/caring-community-trust-tier-routes.txt`, `CaringCommunity*Controller.php`, `AdminCaringCommunityController::workflow/tandemSuggestions/dismissTandemSuggestion/assistedOnboarding`, `MunicipalSurveyController.php`, `TrustTierController.php`, `WarmthPassController.php`, `CaregiverApiController.php`, `VereinFederationMemberController.php`, `app/Services/CaringCommunity/*`, `app/Services/Verein/VereinFederationService.php`, `FutureCareFundService.php`, `AhvPensionExportService.php`, `CaregiverService.php`, `CaringCommunityWorkflowService.php`, `CaringTandemMatchingService.php`, `MunicipalSurveyService.php`, `TrustTierService.php`, `WarmthPassService.php` | Initial .NET parity now covers many municipal/KISS slices: emergency alerts, federation peers/admin plus member federation-directory, sub-regions, care providers, success stories, caregiver links plus burnout/schedule/request-on-behalf and cover-request reads/create/assign, public municipality events-calendar default/code routes, admin assisted onboarding, admin workflow dashboard read, policy update, review assignment, review decision, and review escalation routes, admin tandem suggestions read/dismiss routes, project announcements, municipal feedback, municipality surveys, trust-tier member/admin routes, warmth-pass member/admin read routes, hour-estate/hour-transfer, hour-gift inbox/sent reads plus send/accept/decline/revert mutations, KISS Treffen member list/detail reads plus admin upsert/minutes mutations, Caring Community Markt member feed, member offer-favour mutation, member request-help submission and voice prefill routes, member safeguarding report submission, invite codes, loyalty, lead nurture, operating policy, launch readiness, disclosure packs, KPI/forecasting, nudge analytics/config plus tandem-candidate dispatch, regional-points admin plus member summary/history/transfer/marketplace quote/redeem, research reads/writes plus member consent and agreement-template render, role-preset status/install, safeguarding reads plus report assignment/escalation/note/status actions, SLA/support reads plus admin support-relationship create/update/hour logging, admin and member Verein member import/preview plus admin assignment, isolated-node readiness, member GDPR/FADP data export, member Future Care Fund summary, and member AHV pension evidence-pack export. | Non-tandem nudge trigger parity, frontend survey/trust-tier/warmth-pass/workflow routes, and accessible coverage remain gaps. |
| Caring trust tier | `TrustTierController.php`, `TrustTierService.php`, `CaringCommunityApiController::myTrustTierBreakdown`, `routes/caring-community-trust-tier-routes.txt`, `caring_trust_tier_config`, `users.trust_tier` | `CaringCommunityTrustTierController.cs`, `AdminCaringCommunityTrustTierController`, `TrustTierService.cs`, `CaringTrustTierConfig`, `AddCaringTrustTierConfig`, `users.trust_tier` | Member `my-trust-tier` and breakdown plus admin config GET/PUT and recompute routes now match Laravel route surface with feature guard, tenant-scoped criteria JSON, default criteria merge, approved-hour/review/identity signals, active-user recompute, validation errors, and focused regression tests. Frontend trust-tier route coverage remains open. |
| Caring warmth pass | `WarmthPassController.php`, `WarmthPassService.php`, `GET /v2/caring-community/my-warmth-pass`, `GET /v2/admin/caring-community/warmth-pass/{userId}` | `CaringCommunityWarmthPassController.cs`, `AdminCaringCommunityWarmthPassController`, `WarmthPassService.cs` | Member and admin read routes now match Laravel route surface with caring feature guard, tenant-scoped user lookup, stored trust-tier label/eligibility, approved-hour aggregation, review count, identity verification signal, tenant/member names, date fields, categories envelope, and focused regression tests. .NET currently returns an empty category list until the Laravel `caring_help_requests.category_id` schema is represented. |
| Caring municipality surveys | `MunicipalSurveyController.php`, `MunicipalSurveyService.php`, `routes/municipality-survey-routes.txt` | `CaringCommunitySurveysController.cs`, `AdminCaringCommunitySurveysController`, `MunicipalSurveyService.cs`, `MunicipalitySurvey*` entities, `AddMunicipalitySurveys` migration | Member active list/detail/respond and admin list/create/show/update/publish/close/export routes now match Laravel route surface with feature guard, announcer/admin access, tenant scoping, draft/active/closed lifecycle, required-answer validation, duplicate prevention, anonymous response privacy, analytics, formula-safe CSV export, and focused regression tests. React/admin frontend route coverage remains open. |
| Marketplace | `Marketplace*Controller.php`, `Merchant*Controller.php`, `MerchantOnboardingController.php`, `MerchantOnboardingService.php`, `MarketplaceCommunityDeliveryController.php`, `MarketplaceGroupController.php`, `MarketplacePickupSlotController.php`, Laravel React `MerchantOnboardingPage.tsx`, `ShippingSelector.tsx`, `ShippingOptionsManager.tsx`, `MarketplaceCollectionsPage.tsx`, `SellerProfilePage.tsx`, `GroupMarketplaceTab.tsx`, `CreateMarketplaceListingPage.tsx`, `EditMarketplaceListingPage.tsx`, `PromotionSelector.tsx`, `CommunityDeliveryCard.tsx`, `MakeOfferForm.tsx`, `MyOffersPage.tsx`, `BuyerOrdersPage.tsx`, `SellerOrdersPage.tsx`, `RatingModal.tsx`, `SellerPickupSlotsPage.tsx`, `MyPickupsPage.tsx`, `SellerPickupScanPage.tsx`, `SellerCouponsPage.tsx`, `SellerCouponEditPage.tsx`, `BuyNowButton.tsx`, marketplace models/services | `MarketplaceController.cs`, `AdminMarketplaceController.cs`, `MarketplaceService.cs`, `MarketplaceEntities.cs`, `V15SocialCompatibilityController.cs`, `MemberParityController.cs`, `LaravelReactFrontendContractController.cs`, `MarketplaceControllerTests.cs`, `LaravelReactFrontendContractTests.cs` | Partial implementation. Laravel React merchant-onboarding wizard calls (`GET /api/v2/merchant-onboarding/status`, `POST /step-1`, `/step-2`, `/step-3`, `/complete`) now return the Laravel-shaped `has_profile`/`onboarding_completed`/`profile`, `data.profile`, and completion `badge_granted` envelopes with focused backend contract coverage. Buyer shipping selector calls (`GET /api/v2/marketplace/sellers/{sellerId}/shipping-options`) and seller shipping manager calls (`GET/POST/PUT/DELETE /api/v2/marketplace/seller/shipping-options`) now return the React `MarketplaceShippingOption` fields including `courier_name`, `price`, `currency`, `estimated_days`, `is_active`, and `is_default`. Collection and saved-search calls (`GET/POST /api/v2/marketplace/collections`, `GET/POST/DELETE /collections/{id}/items`, `GET/POST/DELETE /saved-searches`) now return React-compatible `is_public`, `item_count`, `collection_item_id`, nested listing, `search_query`, parsed `filters`, alert fields, and `is_active` shapes. Listing browse/detail/create/edit calls (`GET /api/v2/marketplace/listings`, `GET /listings/{id}`, `POST /listings`, `PUT /listings/{id}`, `POST /listings/{id}/images`, `POST /listings/{id}/video`, `DELETE /listings/{id}/images/{imageId}`, `DELETE /listings/{id}/video`, `POST/DELETE /listings/{id}/save`, `POST /listings/{id}/report`) now return React-compatible Laravel-style `success/data/meta`, cursor metadata, snake_case listing fields, nested category/user/image data, saved/own/promoted flags, detail image/template fields, save toggles, multipart media upload fields, and DSA report identifiers. Public seller profile calls (`GET /api/v2/marketplace/sellers/{id}`, `GET /sellers/{id}/listings`) now accept user-id or seller-profile-id lookups and return Laravel React `success/data` seller fields plus public active/approved listing cards for `SellerProfilePage.tsx`. Group marketplace calls (`GET /api/v2/marketplace/groups/{groupId}/listings`, `GET /groups/{groupId}/stats`) now require authenticated group membership, aggregate listings by active group-member sellers, and return React-compatible cursor metadata, listing cards, and stats/category breakdowns for `GroupMarketplaceTab.tsx`. Seller management calls (`GET /api/v2/marketplace/seller/dashboard`, own-listing `GET /listings?user_id=...&status=...`, `POST /listings/{id}/renew`, `DELETE /listings/{id}`) now return React-compatible dashboard counters/revenue, own listing rows, renewal data, and delete success envelopes. Promotion selector calls (`GET /api/v2/marketplace/promotions/products`, `POST /api/v2/marketplace/listings/{id}/promote`) now accept/return React `promotion_type`, `type`, `label`, `description`, price/currency/duration, and Laravel-style success/data envelopes. Marketplace offer-create calls (`POST /api/v2/marketplace/listings/{id}/offers`) now accept the React `amount`/`currency`/`message` payload, tenant-scope the offer from the listing, and return Laravel-style `success/data` with snake_case offer fields. MyOffers calls (`GET /api/v2/marketplace/my-offers/sent`, `GET /received`, `PUT /offers/{id}/counter`, `PUT /accept-counter`, `DELETE /offers/{id}`) now return React-compatible success envelopes, cursor metadata, nested listing/counterparty fields, counter fields, accepted counter status, and withdraw success data. Seller coupon calls (`GET/POST/PUT/DELETE /api/v2/marketplace/seller/coupons`) now accept the React coupon form payload, persist Laravel coupon fields, and return `data.items`, formatted coupon rows, and delete `deleted` data for the seller coupon list/edit pages. BuyNow calls (`POST /api/v2/coupons/validate`, `POST /api/v2/marketplace/orders`, `POST /api/v2/marketplace/payments/create-intent`) now accept the React `code`/`order_total_cents`/`listing_id`, `listing_id`/`coupon_code`, and `order_id` payloads and return Laravel-style coupon discount, order, and local payment-intent envelopes. Order history and rating calls (`GET /api/v2/marketplace/orders/purchases`, `GET /sales`, `PUT /orders/{id}/ship`, `PUT /orders/{id}/confirm-delivery`, `POST /orders/{id}/rate`, `GET /orders/{id}/ratings`) now support React `status`/`limit`/`cursor` filters, cursor metadata, nested listing/buyer/seller fields, tracking fields, completed-order rating validation, anonymous comment masking, duplicate-role prevention, and Laravel-style success/data envelopes. Seller pickup-slot calls (`GET/POST/DELETE /api/v2/marketplace/seller/pickup-slots`) now accept React `slot_start`/`slot_end`/`is_recurring` payloads, persist recurrence/booked-count fields, and return Laravel-style success/data with `slot_start`, `slot_end`, `booked_count`, `remaining`, `is_recurring`, and delete `deleted` data. Pickup reservation calls (`POST /api/v2/marketplace/orders/{id}/pickup-reservation`, `GET /api/v2/marketplace/me/pickups`, `POST /api/v2/marketplace/seller/pickup-scan`) now accept React `slot_id`/`qr_code` payloads, return Laravel pickup reservation fields including `slot_id`, `listing_id`, `listing_title`, `qr_code`, `reserved_at`, `picked_up_at`, and nested slot windows, and mark seller scans as `picked_up`. Community delivery calls (`GET/POST /api/v2/marketplace/orders/{orderId}/delivery-offers`, `PUT /accept`, `PUT /confirm`) now accept React `time_credits` payloads, return Laravel `order_id`/`deliverer_id`/`time_credits` rows with deliverer objects for list reads, and use message envelopes plus `accepted`/`completed` statuses for owner actions. Deeper seller profile storage fields (`cover_image_url`, separate community trust score, response metrics, partner badge timestamps), deeper seller-management analytics/media/bulk workflows, deeper order lifecycle schemas such as refunds/disputes/auto-complete, real Stripe/escrow/payment orchestration, coupon redemption/payment side effects, advertising, stricter offer action authorization/expiry/notification side effects, persisted delivery `notes`/`estimated_minutes`/timestamps, and deeper merchant workflows still need endpoint-by-endpoint audit. |
| Marketplace / seller Stripe onboarding | `MarketplaceSellerController::onboardStatus`, `MarketplacePaymentController::onboard`, Laravel React `StripeOnboardingPage.tsx` | `MarketplaceController.SellerOnboardStatus`, `MarketplaceController.SellerOnboard`, `MarketplacePaymentService`, `20260714115746_MarketplaceConnectOnboardingParity`, `MarketplacePaymentServiceTests` | `GET /api/v2/marketplace/seller/onboard/status` returns the React `stripe_account_id`, `stripe_onboarding_complete`, `details_submitted`, `charges_enabled`, and `payouts_enabled` shape. `POST /api/v2/marketplace/seller/onboard` creates or reuses a Stripe Express account under stable tenant/user idempotency and returns tenant-correct `onboarding_url`/`url` aliases. Status polling and signed replay-safe `account.updated` webhooks persist completion/disablement and deliver one localized completion bell. Live Stripe credentials/browser execution remain the provider proof gap. |
| Marketplace / paid transition notifications | `MarketplacePaymentService::handlePaymentIntentSucceeded`, Laravel localized marketplace mail/bell copy, Laravel React webhook-driven checkout flow | `MarketplacePaymentService`, `MarketplacePaidNotificationCopy`, `MarketplaceOrderNotificationDelivery`, `MarketplacePaymentServiceTests` | The signed `payment_intent.succeeded` transition commits payment state before independently delivering localized buyer/seller email and in-app bells, records tenant/order/event/user/channel delivery identity, retries failed or stale claims without duplicating delivered channels, preserves provider evidence, and persists non-enumerable `MKT-{ULID}` order numbers. The 16/16 focused checkpoint is retained historical evidence; refunds/disputes and their notification path are covered by the dedicated later rows. Live-provider delivery, full-suite/CI, and unchanged-frontend runtime proof remain open. |
| Marketplace / escrow settlement and payout | `MarketplacePaymentService::createPaymentIntent/confirmPayment`, `MarketplaceOrderService::confirmDelivery`, `MarketplaceEscrowService::releaseFunds/processAutoReleases`, hourly `marketplace:process-escrow-releases`, Laravel localized payout bell copy | `MarketplacePaymentService`, `MarketplaceEscrow`, `MarketplaceEscrowReleaseJob`, `MarketplacePayoutNotificationCopy`, `20260714150317_MarketplaceEscrowSettlementParity`, `MarketplacePaymentServiceTests` | Escrow-enabled checkout creates a Stripe separate charge under a stable transfer group, capture atomically records a tenant/order/payment-bound hold, and buyer-only delivery confirmation starts the dispute window without paying the seller. The hourly release job rechecks provider identity, source charge, delivery/deadline/dispute state, locks the order, and creates one source-charge-bound Connect transfer with stable idempotency before marking escrow paid and the order completed. Provider failure and ambiguous post-transfer state remain fail-closed, and one recipient-locale seller payout bell is persisted idempotently. Focused service/controller proof passed 20/20 twice; the migration applies to disposable upgraded PostgreSQL and EF reports no model drift. Refund/dispute handling is covered by the later dedicated rows. Live Stripe/Connect proof, full-suite/CI, and unchanged-frontend runtime proof remain open. |
| Marketplace / provider refunds | `MarketplacePaymentService::processRefund/handleChargeRefunded`, `MarketplaceDisputeService::resolve`, Stripe Refund and Transfer Reversal APIs | `MarketplacePaymentService.ProcessRefundAsync/ReconcileChargeRefundedAsync`, signed marketplace webhook, `MarketplaceDisputeService.ResolveAsync`, `MarketplacePaymentRefund`, `20260714165402_MarketplaceRefundReconciliationParity`, `MarketplacePaymentServiceTests` | Admin buyer resolutions execute real full or partial Stripe refunds. Destination charges request transfer/application-fee reversal; paid separate-charge payouts explicitly reverse the seller share with stable idempotency. Signed `charge.refunded` events bind charge/intent identity, require destination reversal evidence, recover separate-charge transfers, and record each expanded provider refund exactly once; unsafe or incomplete evidence fails closed. The migration applies to disposable upgraded PostgreSQL, EF reports no model drift, Release builds with zero errors, and the 26/26 focused checkpoint remains historical evidence. Charge-dispute recovery and refund notifications are covered by the later dedicated rows. Live Stripe proof, full-suite/CI, and unchanged-frontend runtime proof remain open. |
| Marketplace / held-escrow charge disputes | `MarketplacePaymentService::handleChargeDispute`, Stripe `charge.dispute.created/updated/closed` | `MarketplacePaymentService.ReconcileChargeDisputeAsync`, signed marketplace webhook, `MarketplacePaymentRefund`, `MarketplacePaymentServiceTests` | Signed dispute events bind charge/dispute identity, freeze held escrow and the order, restore prior state and immediate release eligibility on a win, and convert a loss into the durable refund ledger and refund state. Event replay is idempotent; the 28/28 focused gate and zero-error Release build are retained evidence. Paid-transfer recovery and refund notifications are covered by the next rows. Live-provider, full-suite/CI, and unchanged-client proof remain open. |
| Marketplace / paid-transfer charge disputes | `MarketplacePaymentService::handleChargeDispute`, Stripe charge retrieval, Transfer Reversal and Transfer APIs | `MarketplacePaymentService.ReconcileChargeDisputeAsync`, `MarketplaceStripeGateway.RetrieveChargeTransferIdAsync/ReverseTransferAsync/CreateTransferAsync`, durable dispute refund-ledger rows, `MarketplacePaymentServiceTests` | Paid separate-charge disputes reverse the proportional seller exposure once and reimburse the exact ledger-recorded share on a provider win. Destination-charge losses retrieve the transfer from the Stripe charge when needed and reverse the same exposure. Stable keys and ledger reuse prevent duplicate reversal/reimbursement. The 30/30 focused gate and zero-error Release build are retained evidence. Refund notification evidence is covered by the next row. Live Stripe proof, full-suite/CI, and unchanged-client runtime proof remain open. |
| Marketplace / refund notifications | Laravel refund mail/bell copy and webhook replay behavior | `MarketplacePaymentService`, `MarketplaceRefundNotificationCopy`, `MarketplaceOrderNotificationDelivery`, `MarketplacePaymentServiceTests` | Provider/admin refund outcomes commit before independently delivering buyer/seller email and bells. Durable tenant/order/refund/user/channel identity suppresses duplicate delivered channels while allowing failed claims to retry. The external partial-refund path proves English buyer and German seller delivery plus replay suppression; partial seller copy supports all 11 Laravel locales, while full-refund buyer/seller and partial-refund buyer copy remains English. The general complete exact-SHA aggregate is green at `dbafc5c3`; live-provider delivery, fixed-rubric module acceptance, broader localization, and unchanged-client runtime proof remain open. |
| Marketplace / seller profile uploads | Laravel React `MerchantOnboardingPage.tsx` `api.upload('/v2/marketplace/seller/profile', file, 'avatar'/'cover_image')` | `MarketplaceController.UpsertSellerProfile`, `MarketplaceControllerTests` | `POST /api/v2/marketplace/seller/profile` now accepts multipart `avatar` and `cover_image` uploads, stores files through the .NET upload service, and returns React-compatible `success/data.url` plus `avatar_url` or `cover_image_url`. Deeper persisted seller cover-image/profile media fields remain a schema gap. |
| Marketplace / offer accept-decline | `MarketplaceOfferController::accept/decline`, `MarketplaceOfferService::accept/decline`, Laravel React `MyOffersPage.tsx` | `MarketplaceController.AcceptOffer/DeclineOffer`, `MarketplaceControllerTests` | `PUT /api/v2/marketplace/offers/{id}/accept` and `/decline` now require the seller, return Laravel-style `success/data` envelopes, reject buyer-side direct accept, and accepted offers reserve the listing while declining competing pending/countered offers. Email/bell notification side effects remain a deeper workflow gap. |
| Marketplace / map search nearby listings | `MarketplaceListingController::nearby`, `MarketplaceListingService::getNearby`, Laravel React `MarketplaceMapSearchPage.tsx` | `MarketplaceController.NearbyListings`, `MarketplaceControllerTests` | `GET /api/v2/marketplace/listings/nearby` now accepts React `lat`/`lng` plus Laravel `latitude`/`longitude`, supports `radius_km`/`radius`, `q`, `category_id`, and `limit`, filters active approved geocoded listings, sorts by Haversine distance, and returns `distance_km` plus React-compatible listing cards. |
| Marketplace / categories and templates | `MarketplaceListingController::categories/categoryTemplate`, `MarketplaceListingService::getCategories`, `MarketplaceCategoryTemplate`, Laravel React `MarketplacePage.tsx`, `MarketplaceSearchPage.tsx`, `MarketplaceMapSearchPage.tsx`, `CreateMarketplaceListingPage.tsx`, `EditMarketplaceListingPage.tsx`, `MarketplaceCategoryPage.tsx` | `MarketplaceController.Categories/CategoryTemplate`, `MarketplaceCategoryListingsControllerUnitTests` | `GET /api/v2/marketplace/categories` now returns Laravel React `success/data/meta` rows with `id`, `name`, `slug`, `description`, `icon`, `parent_id`, and active-approved `listing_count`; `GET /api/v2/marketplace/categories/{id}/template` now returns the empty-template `success/data` envelope with `category_id`, `name: null`, and `fields: []`. Persisted category parent IDs, `MarketplaceCategoryTemplate` storage, and non-empty dynamic field definitions remain schema/workflow gaps. |
| Marketplace / admin dashboard and listings | `AdminMarketplaceController::dashboard/listings/approveListing/rejectListing/destroyListing/bulkReject`, Laravel React `MarketplaceAdmin.tsx`, `MarketplaceModerationPage.tsx`, `adminApi.ts adminMarketplace.bulkReject` | `AdminMarketplaceController.Dashboard/Listings/ApproveListing/RejectListing/DeleteListing/BulkReject`, `AdminMarketplaceControllerUnitTests` | `GET /api/v2/admin/marketplace/dashboard` now returns Laravel React stats (`total_listings`, `active_listings`, `pending_moderation`, `total_sellers`, `total_orders`, `revenue`, `currency`); `GET /api/v2/admin/marketplace/listings` now accepts `per_page`, `page`, `moderation_status`, `status`, and `q`, returns `success/data/meta`, and maps listing rows without raw EF cycles. `POST /listings/{id}/approve`, `POST /reject`, and `DELETE /listings/{id}` now return Laravel React success message envelopes; reject/delete soft-remove listings with rejected moderation status. `POST /bulk-reject` now accepts React `listing_ids`/`reason` and returns Laravel `data.success`, `data.failed`, and `data.skipped_ids`. Deeper audit/notification workflows remain gaps. |
| Marketplace / admin sellers | `AdminMarketplaceController::sellers/verifySeller/suspendSeller`, Laravel React `MarketplaceSellerAdmin.tsx` | `AdminMarketplaceController.Sellers/VerifySeller/SuspendSeller`, `AdminMarketplaceControllerUnitTests` | `GET /api/v2/admin/marketplace/sellers` now accepts React `page`, `per_page`, `search`, `seller_type`, and `verified` query parameters, returns `success/data/meta` with formatted seller rows (`display_name`, `business_verified`, `active_listings`, ratings, joined date, nested user), and avoids raw EF profile cycles. `POST /sellers/{id}/verify` now enforces business-seller verification and returns a Laravel-style message envelope. `POST /sellers/{id}/suspend` accepts the empty-body React call, marks the seller suspended, tenant-scopes active listing removal/rejection, and returns a success message envelope. Deeper seller analytics/media/bulk moderation workflows remain gaps. |
| Marketplace / admin coupons | `Admin\MerchantCouponAdminController::index/suspend/destroy`, Laravel React `AdminCouponsPage.tsx` | `AdminMarketplaceController.Coupons/SuspendCoupon/DeleteCoupon`, `AdminMarketplaceControllerUnitTests` | `GET /api/v2/admin/marketplace/coupons` now returns `success/data.items/meta` with formatted merchant coupon rows; `POST /coupons/{id}/suspend` now sets `status: paused` and returns formatted coupon data; `DELETE /coupons/{id}` now returns `success/data.deleted`. Deeper admin coupon search/filter/audit trails remain future workflow gaps. |
| Marketplace / BuyNow pickup slots | `MarketplacePickupSlotController::listForListing`, Laravel React `BuyNowButton.tsx` | `MarketplaceController.ListingPickupSlots`, `MarketplaceControllerTests` | `GET /api/v2/marketplace/listings/{id}/pickup-slots` now returns Laravel React `success/data/meta` with future active pickup slots that still have remaining capacity. |
| Marketplace / AI auto-reply | `MarketplaceAiController::autoReply`, `MarketplaceAiService::generateAutoReply`, Laravel React `AiReplySuggestion.tsx` | `MarketplaceController.AutoReply`, `MarketplaceControllerTests` | `POST /api/v2/marketplace/listings/{id}/auto-reply` now enforces listing-owner access, accepts the React `{ message }` payload, validates message length, and returns `data.reply`; provider-backed AI generation remains a deeper integration gap. |
| Gamification profile | `GET /api/v2/gamification/profile`, `GamificationV2Controller::profile`, Laravel React `AchievementsPage.tsx` | `GamificationController.GetProfile`, `GamificationControllerTests.LaravelReactProfileV2Alias_UsesSuccessDataEnvelope` | `/api/v2/gamification/profile` now returns the Laravel React `success/data/meta` envelope with `data.user`, `xp`, `level`, `level_progress`, `badges_count`, `showcased_badges`, `is_own_profile`, `xp_values`, and `level_thresholds`, while preserving legacy top-level fields for older .NET callers. Exact Laravel XP value table, public `user_id` profile lookup semantics, showcased badge fidelity, privacy rules, and browser smoke coverage remain gaps. |
| Gamification daily reward | `GamificationV2Controller::dailyRewardStatus/claimDailyReward`, `DailyRewardService`, Laravel React `AchievementsPage.tsx` | `ReactFrontendCompatibilityController.DailyRewardStatus/ClaimDailyReward`, `DailyReward`, `GamificationV2ControllerTests.LaravelReactDailyRewardV2Alias_UsesClaimedRewardDataEnvelope` | `GET /api/v2/gamification/daily-reward` now returns the Laravel React `data.claimed_today/current_streak/reward_xp/next_reward_xp/next_claim_at` shape, and `POST /api/v2/gamification/daily-reward` now returns `data.claimed` plus nested `data.reward.xp_earned/base_xp/milestone_bonus/streak_day/longest_streak`; duplicate claims now use Laravel-style HTTP 409 `errors[].code=RESOURCE_CONFLICT`. Broader gamification profile, badges, collections, XP shop, showcase, challenge claim, seasons, nexus-score, community dashboard, and engagement-history contracts still need endpoint-level audit. |
| Gamification badges | `GET /api/v2/gamification/badges`, `GET /api/v2/gamification/badges/{key}`, `GamificationV2Controller::badges/showBadge`, Laravel React `AchievementsPage.tsx` | `GamificationController.GetBadges/GetBadgeByKey`, `GamificationControllerTests.LaravelReactBadgesV2Alias_UsesBadgeKeyListAndStringDetailShape` | `/api/v2/gamification/badges` now returns tenant-scoped Laravel React rows with `badge_key`, `name`, `description`, `icon`, `type`, `earned`, `earned_at`, `is_showcased`, and `meta.available_types`; `/api/v2/gamification/badges/{badgeKey}` now accepts string badge keys and returns the detail-modal shape with `key`, `badge_key`, `threshold`, `xp_value`, `earned`, and `is_showcased`. Exact Laravel `user_badges.badge_key/is_showcased/showcase_order` schema fidelity, badge taxonomy/rarity detail, and browser smoke coverage remain gaps. |
| Gamification showcase | `PUT /api/v2/gamification/showcase`, `GamificationV2Controller::updateShowcase`, Laravel React `AchievementsPage.tsx` | `CompatibilityAliasController.UpdateShowcase`, `BadgeShowcase`, `GamificationControllerTests.LaravelReactShowcaseV2Alias_PersistsOwnedBadgeSelectionForBadgeReload` | `PUT /api/v2/gamification/showcase` now accepts React `{ badge_keys }`, enforces Laravel's max-five selection rule, validates tenant-scoped earned badge ownership, persists ordered `badge_showcases` rows, returns `success/data.message/showcased_badges`, and `/api/v2/gamification/badges` reloads expose `is_showcased: true` for selected badges. Exact Laravel `user_badges.is_showcased/showcase_order` storage-column fidelity, profile showcased badge enrichment, localized validation text, and browser smoke coverage remain gaps. |
| Donations / member premium | `DonationPaymentController.php`, `StripeDonationService.php`, `MemberPremiumController.php`, `Admin/MemberPremiumAdminController.php`, Laravel React `DonationCheckout.tsx`, `DonationReceipt.tsx`, `PricingPage.tsx`, `MySubscriptionPage.tsx`, `admin/api/memberPremiumApi.ts` | `MiscParityController.DonationPaymentIntent`, `MiscParityController.DonationReceipt`, `MemberParityController`, `AdminExplicitParityController`, `LaravelReactDonationContractTests.cs`, `LaravelReactMemberPremiumCompatibilityTests.cs`, `AdminExplicitParityControllerTests`, `MoneyDonation`, `SubscriptionPlan`, `UserSubscription` | Laravel React donation checkout calls (`POST /api/v2/donations/payment-intent`, `GET /api/v2/donations/{id}/receipt`) now return Laravel-style success/data envelopes, persist tenant-scoped donation rows, expose `client_secret`/`donation_id`, and return receipt fields consumed by the React component. Member premium public tiers, `me`, checkout, billing-portal, and local cancel calls now return the Laravel React tier/member subscription/redirect/cancel envelopes. Admin `GET /api/v2/admin/member-premium/tiers`, `GET /api/v2/admin/member-premium/tiers/{id}`, `POST /api/v2/admin/member-premium/tiers`, `PUT /api/v2/admin/member-premium/tiers/{id}`, `DELETE /api/v2/admin/member-premium/tiers/{id}`, `POST /api/v2/admin/member-premium/tiers/{id}/sync-stripe`, and `GET /api/v2/admin/member-premium/subscribers` now return Laravel React tier/subscriber envelopes, include inactive tenant-scoped tiers for admins, project `tenant_id`, price cents, features, Stripe price-id metadata, timestamps for detail reads, list `active_subscriber_count`, return `TIER_NOT_FOUND` for missing detail reads, create tiers with HTTP 201, persist partial updates while preserving Laravel-only tier metadata, guard deletes with active-subscriber conflicts, persist local sync price metadata, and return paginated subscriber rows. Real Stripe PaymentIntent/member checkout/portal/product/price creation, Gift Aid persistence, receipt email delivery, refunds, provider-backed cancellation/webhook processing, billing-interval storage, and full member-premium finance workflow parity remain gaps. |
| Verein / Clubs | `app/Http/Controllers/Api/Verein/*`, `ClubsApiController.php` | `VereineParityController.cs` | Compatibility routes need real workflow verification |
| Regional Analytics | `routes/regional-analytics-routes.txt`, `RegionalAnalyticsController.php`, `SuperAdmin/RegionalAnalyticsAdminController.php`, Laravel React `RegionalAnalyticsPage.tsx` and `RegionalAnalyticsAdminPage.tsx` | EF entities/configuration/migration/tests now cover the paid Regional Analytics subscription/cache/report/access-log tables; `RegionalAnalyticsSuperAdminController.cs` covers the Laravel React super-admin subscription list/create/update/cancel, report queue, and access-log calls; `RegionalAnalyticsAdminController.cs` now covers tenant-admin overview, heatmap, demand/supply, demographics, engagement trends, volunteer breakdown, help requests, export JSON, and cache invalidation calls with focused regression coverage; partner report downloads now return valid minimal `application/pdf` files instead of placeholder text | Billing, stored-file fidelity, monthly job orchestration, deeper service workflow parity, and runtime smoke coverage remain gaps |
| National KISS | `Admin/NationalKissDashboardController.php`, `NationalKissDashboardService.php`, Laravel React `NationalKissDashboardPage.tsx` | `NationalKissDashboardController.cs` now covers Laravel React summary, comparative, trend, and cooperatives calls with cross-tenant KISS aggregation, privacy bucket labels, `/api/v2` paths, and focused regression coverage | Laravel `tenants.tenant_category` schema alignment, stricter `national.kiss_dashboard.view` permission parity, runtime smoke coverage, caching, and deeper service equivalence remain gaps |
| Partner API | `app/Http/Controllers/Api/PartnerApi/*`, `app/Services/PartnerApi/*` | `AdminApiPartnersController.cs`, API partner service/entity | Admin setup exists; external partner API parity incomplete |
| Identity providers | provider services for Veriff, Onfido, Jumio, Idenfy; `GET/PUT /api/v2/admin/config/registration-policy`; `GET/PUT/DELETE /api/v2/admin/identity/provider-credentials*` | Mock, Stripe Identity, Veriff, Onfido, Jumio, and iDenfy adapters; React compatibility read/write payloads match the SPA contract; encrypted tenant provider credentials feed verification start/webhook config resolution | Live/sandbox HTTP contract, browser-level admin workflow coverage, and end-to-end provider webhook wiring still need verification |
| Admin and public tenant SSO/OIDC | `AdminSsoProvidersController.php`, `SsoOidcService::listForAdmin/upsert/delete/discover`, public discovery/redirect/callback/exchange routes, `tenant_sso_providers` | `AdminSsoProvidersController.cs`, `TenantSsoProviderService.cs`, `SsoOidcAuthenticationService.cs`, `LaravelReactUtilityCompatibilityController.cs`, `tenant_sso_providers`, `sso_oidc_flows`, `oauth_callback_grants`, `oauth_identities`, `20260714223452_SsoOidcAuthenticationParity` | Admin list/upsert/delete/test endpoints match Laravel with tenant scoping, presets, secret redaction, encrypted client-secret storage, discovery probe, and audit metadata. Public discovery, redirect, callback, and browser exchange use signed durable state, browser/server PKCE, nonce/JWKS validation, public-HTTPS endpoint checks, tenant-qualified linking, domain/provisioning gates, one-time encrypted grants, refresh-token issuance, and logout-all invalidation. The general complete exact-SHA aggregate is green at `dbafc5c3`; live IdP/browser proof, fixed-rubric module acceptance, and unchanged-client runtime certification remain open. |
| Caring emergency alerts | `EmergencyAlertController.php`, `EmergencyAlertService.php`, `caring_emergency_alerts` | `CaringCommunityEmergencyAlertsController.cs`, `AdminCaringCommunityEmergencyAlertsController`, `CaringEmergencyAlertService.cs` | Member active/dismiss plus admin list/create/deactivate endpoints now match route surface, tenant scoping, feature flag, active/expiry/target filtering, validation envelope, and analytics increment; real high-priority FCM broadcast transport remains a deeper integration gap |
| Caring external integrations | `Api/Admin/ExternalIntegrationController.php`, `ExternalIntegrationBacklogService.php`, tenant setting `caring.external_integrations` | `AdminCaringCommunityExternalIntegrationsController.cs`, `ExternalIntegrationBacklogService.cs`, `TenantConfig` JSON envelope | Admin list, seed-defaults, create, update, and delete route surface now matches Laravel with tenant scoping, feature flag guard, validation errors, not-found/conflict envelopes, and curated default backlog items |
| Caring federation peers | `AdminFederationPeerController.php`, `CaringCommunityApiController::federationDirectory`, `FederationPeerService.php`, `caring_federation_peers` | `AdminCaringCommunityFederationPeersController.cs`, `CaringCommunityFederationDirectoryController.cs`, `CaringFederationPeerService.cs`, `caring_federation_peers` EF table | Admin list, create, update-status, rotate-secret, and delete routes plus member `GET /api/caring-community/federation-directory` now match Laravel with tenant scoping, feature flag/auth guard, active-peer discoverability, member-safe directory rows, slug/HTTPS/status validation, one-time secret reveal, redacted list/status responses, and tenant-scoped deletes |
| Caring sub-regions | `CaringSubRegionController.php`, `CaringSubRegionService.php`, `caring_sub_regions` | `CaringCommunitySubRegionsController.cs`, `AdminCaringCommunitySubRegionsController`, `CaringSubRegionService.cs`, `caring_sub_regions` EF table | Public active-only listing and admin list/create/update/delete routes now match Laravel with tenant scoping, feature flag guard, search/type/page filters, slug normalization/uniqueness, JSON postal/boundary payloads, and soft-inactive deletes |
| Caring care providers | `CareProviderDirectoryController.php`, `CareProviderDirectoryService.php`, `caring_care_providers` | `CaringCommunityProvidersController.cs`, `AdminCaringCommunityProvidersController`, `CareProviderDirectoryService.cs`, `caring_care_providers` EF table | Member list/show plus admin list/create/update/delete/verify/duplicates routes now match Laravel with tenant scoping, feature flag guard, active/verified/type/search/sub-region filters, sub-region validation, JSON categories/opening-hours payloads, soft-inactive deletes, and duplicate scoring signals |
| Caring success stories | `SuccessStoryController.php`, `Admin/SuccessStoryAdminController.php`, `SuccessStoryService.php`, tenant setting `caring.success_stories` | `CaringCommunitySuccessStoriesController.cs`, `AdminCaringCommunitySuccessStoriesController`, `SuccessStoryService.cs`, `TenantConfig` key `caring.success_stories` | Member published index plus admin list/create/update/delete/seed-demo/refresh-live routes now match Laravel with tenant scoping, feature flag guard, validation envelopes, default demo/published behavior, conflict/not-found/manual-metric errors, and tenant-config JSON persistence; live pilot/municipal metric adapters remain a deeper integration gap |
| Caring caregiver support | `CaregiverApiController.php`, `CaregiverService.php`, `caring_caregiver_links`, `caring_cover_requests`, `caring_help_requests`, `caring_support_relationships`, `vol_logs`, `POST /v2/caring-community/caregiver/request-on-behalf`, `GET/POST /v2/caring-community/caregiver/cover-requests`, `GET /v2/caring-community/caregiver/cover-requests/{id}/candidates`, `POST /v2/caring-community/caregiver/cover-requests/{id}/assign` | `CaringCommunityCaregiverController.cs`, `CaregiverSupportService.cs`, `CaringCaregiverLink`, `CaringCoverRequest`, `CaringHelpRequest`, `caring_caregiver_links`, `caring_cover_requests`, `caring_help_requests`, `caring_support_relationships`, `vol_logs` EF tables | Member list/create/delete link routes plus `burnout-check`, `schedule/{caredForId}`, request-on-behalf help-request creation, cover-request list/create, cover-candidate suggestion, and candidate assignment routes now match Laravel with tenant scoping, feature guard, active-link schedule authorization, 7-day approved/pending burnout-hour thresholds, active support-relationship projection, 30-day recent log projection, on-behalf `caring_help_requests` persistence, owned cover-request ordering, matched supporter projection, create validation/persistence for active links, candidate validation before assignment, matched status/timestamp persistence, minimum trust-tier candidate filtering, busy-supporter overlap exclusion, validation/error envelopes, pending member-created links, duplicate/self/tenant conflict guards, and focused regression tests. Candidate scoring uses neutral fallbacks until Laravel-only `users.skills`, `users.location`, `users.verification_status`, and approval columns are represented. |
| Caring tandem suggestions | `AdminCaringCommunityController::tandemSuggestions/dismissTandemSuggestion`, `CaringTandemMatchingService.php`, `caring_tandem_suggestion_log`, `GET /v2/admin/caring-community/tandem-suggestions`, `POST /v2/admin/caring-community/tandem-suggestions/dismiss` | `AdminCaringCommunityTandemSuggestionsController.cs`, `CaringTandemMatchingService.cs`, `CaringTandemSuggestionLog`, `GET /api/admin/caring-community/tandem-suggestions`, `POST /api/admin/caring-community/tandem-suggestions/dismiss` | Admin read and dismiss routes now match Laravel route surface with admin policy, caring feature guard, limit clamping, tenant-scoped active-user candidate selection, busy-user filtering, normalized 90-day suppression log upsert, Laravel validation envelope, neutral fallback signals/score/reason when optional Laravel profile columns are absent, `generated_at`, and focused regression tests. Deeper scoring signal parity remains limited until optional Laravel profile columns such as skills/interests/availability/language/coordinates are represented in .NET. |
| Caring workflow dashboard | `AdminCaringCommunityController::workflow`, `CaringCommunityWorkflowService.php`, `CaringCommunityWorkflowPolicyService.php`, `GET /v2/admin/caring-community/workflow` | `AdminCaringCommunityWorkflowController.cs`, `CaringCommunityWorkflowService.cs`, `VolunteerLog`, `TenantConfig`, `CaringCommunityRolePresetService` | Admin read route now matches Laravel route surface with admin policy, caring feature guard, tenant-scoped stats, pending reviews, recent decisions, coordinator signals, coordinators, role-pack status, workflow-policy defaults/tenant overrides, and focused regression tests. `PUT /workflow/policy` and workflow review assign/escalate/decision mutations remain open gaps. |
| Caring project announcements | `ProjectAnnouncementController.php`, `ProjectAnnouncementService.php`, `caring_project_announcements`, `caring_project_updates`, `caring_project_subscriptions` | `CaringCommunityProjectsController.cs`, `AdminCaringCommunityProjectsController`, `AdminCaringCommunityProjectUpdatesController`, `ProjectAnnouncementService.cs`, `caring_project_announcements`, `caring_project_updates`, `caring_project_subscriptions` EF tables | Member published index/show plus subscribe/unsubscribe routes and admin list/show/create/update/publish/create-update/publish-update routes now match Laravel with tenant scoping, feature flag guard, published-status filtering, admin draft visibility, update ordering, validation envelopes, subscription upsert, subscriber-count refresh, and notification-count calculation; actual notification/push dispatch and frontend route coverage remain open gaps |
| Caring category coefficients | `AdminCaringCommunityController::listCategoryCoefficients/updateCategoryCoefficient`, Laravel `categories.substitution_coefficient` migration | `AdminCaringCommunityCategoryCoefficientsController.cs`, `CaringCategoryCoefficientService.cs`, `Category.SubstitutionCoefficient`, `categories.substitution_coefficient` EF migration | Admin list/update routes now match Laravel with tenant scoping, feature flag guard, active-category filtering, sort-order/name ordering, source-table validation, numeric/range validation, 2-decimal rounding, and Laravel error codes |
| Caring commercial boundary | `CommercialBoundaryController::matrix/setOverride`, `CommercialBoundaryService.php`, Laravel tenant setting `caring.commercial_boundary` | `AdminCaringCommunityCommercialBoundaryController.cs`, `CommercialBoundaryService.cs`, `TenantConfig` JSON envelope | Admin matrix/override routes now match Laravel with feature flag guard, tenant-scoped override storage, canonical category/classification/capability payloads, override sanitization, clear-on-null behavior, validation errors, and Laravel response envelope |
| Caring municipal copilot | `MunicipalCopilotController::index/generate/accept/reject`, `MunicipalCommunicationCopilotService.php`, Laravel tenant setting `caring.municipal_copilot.proposals` | `AdminCaringCommunityMunicipalCopilotController.cs`, `MunicipalCommunicationCopilotService.cs`, `TenantConfig` JSON envelope, `CaringEmergencyAlertService` publish path | Admin proposal list/generate/accept/reject routes now match Laravel with feature flag guard, tenant-scoped rolling JSON buffer, deterministic offline analysis, validation limits, accept-to-info-alert publishing, idempotent re-accept, rejection audit fields, not-found handling, and Laravel response envelope |
| Caring data quality | `Admin/TenantDataQualityController.php`, `TenantDataQualityService.php`, `GET /v2/admin/caring-community/data-quality/dashboard`, `GET /v2/admin/caring-community/data-quality/checks/{checkKey}/rows` | `AdminCaringCommunityDataQualityController.cs`, `TenantDataQualityService.cs` | Admin dashboard and affected-row routes now match Laravel route surface with feature flag guard, tenant-scoped read-only checks, duplicate-email/seed/organisation/member-role/setting counts, drill-down key validation, limit clamping, graceful partial-schema no-op rows, and Laravel response envelope |
| Caring civic digest | `CivicDigestController::myDigest/myPrefs/updateMyPrefs/tenantCadence/setTenantCadence`, `CivicDigestService.php`, Laravel tenant settings `caring.civic_digest.tenant_default_cadence` and `caring.civic_digest.user_prefs.{userId}` | `CaringCommunityCivicDigestController.cs`, `AdminCaringCommunityCivicDigestController.cs`, `CivicDigestService.cs`, `TenantConfig` keys for tenant cadence and member prefs | Member GET digest, GET prefs, PUT prefs plus admin GET/PUT tenant cadence routes now match Laravel route surface with feature flag/auth guard, monthly fallback, legacy weekly-to-monthly normalization, off/daily/monthly validation, opt-out source sanitizing, tenant-config persistence, ranked digest items from represented .NET sources, and Laravel response/error envelopes. Email dispatch claims, digest mail delivery, frontend route coverage, and optional Laravel-only source signals remain deeper gaps. |
| Caring disclosure pack | `AdminCaringCommunityController::disclosurePackShow/disclosurePackUpdate/disclosurePackExport`, `PilotDisclosurePackService.php`, Laravel tenant setting `caring.disclosure_pack` | `AdminCaringCommunityDisclosurePackController.cs`, `PilotDisclosurePackService.cs`, `TenantConfig` key `caring.disclosure_pack` | Admin show/update/export routes now match Laravel with feature flag guard, tenant-scoped default pack fallback, deep merge persistence, controller/incident-response validation, Markdown export envelope, and Laravel response/error shapes |
| Caring integration showcase | `Api/Admin/IntegrationShowcaseController.php`, `IntegrationShowcaseService.php`, `GET /v2/admin/caring-community/integration-showcase` | `AdminCaringCommunityIntegrationShowcaseController.cs`, `IntegrationShowcaseService.cs` | Admin manifest route now matches Laravel route surface with admin policy, caring feature guard, OpenAPI/Partner API/OAuth/webhook/federation/sample-payload/checklist sections, static sample payloads, and Laravel `FEATURE_DISABLED` envelope |
| Caring isolated-node decision gate | `Api/Admin/IsolatedNodeController.php`, `CaringCommunity/IsolatedNodeReadinessService.php`, tenant setting keys `caring.isolated_node.*` | `AdminCaringCommunityIsolatedNodeController.cs`, `IsolatedNodeReadinessService.cs`, `TenantConfig` keys `caring.isolated_node.*` | Admin index/update routes now match Laravel route surface with feature flag guard, 11-item schema, pending/in-progress/decided/blocked gate status, tenant-scoped JSON envelope persistence, partial updates, choice/url/status validation, and Laravel error envelopes |
| Caring KPI baselines | `AdminCaringCommunityController::listKpiBaselines/captureKpiBaseline/compareKpiBaseline`, `KpiBaselineService.php`, `caring_kpi_baselines` | `AdminCaringCommunityKpiBaselinesController.cs`, `CaringKpiBaselineService.cs`, `caring_kpi_baselines` EF table | Admin list/capture/compare routes now match Laravel route surface with feature flag guard, tenant-scoped newest-first snapshots, optional label/period/notes/metric overrides, current metric capture, comparison deltas/percentage changes, pilot/agoris claim targets, and Laravel not-found envelope |
| Caring launch readiness | `Api/Admin/PilotLaunchReadinessController.php`, `AdminCaringCommunityController::launchPilot`, `PilotLaunchReadinessService.php`, tenant settings `caring.launch_readiness.boundary_acknowledged`, `caring_community.pilot_launched_*` | `AdminCaringCommunityLaunchReadinessController.cs`, `PilotLaunchReadinessService.cs`, existing Caring services, `TenantConfig` keys | Admin report, acknowledge-boundary, and launch routes now match Laravel route surface with feature flag guard, seven-section readiness report, blocker list, one-way launch state, boundary acknowledgement persistence, and `CANNOT_LAUNCH` / `ALREADY_LAUNCHED` error envelopes |
| Caring pilot scoreboard | `AdminCaringCommunityController::pilotScoreboard/pilotScoreboardBaselines/capturePrePilotBaseline/captureQuarterlyReview`, `PilotScoreboardService.php`, `caring_kpi_baselines` with `kind=pilot_scoreboard` metric envelope | `AdminCaringCommunityPilotScoreboardController.cs`, `PilotScoreboardService.cs`, `caring_kpi_baselines` EF table | Admin scoreboard, baselines, pre-pilot capture, and quarterly capture routes now match Laravel route surface with feature flag guard, tenant-scoped current metrics, pilot-only baseline filtering, `pre_pilot` canonical label, quarterly label default/truncation, validation error for reserved labels, comparison deltas/percentage changes, quarterly due/overdue envelope, and Laravel response/error shapes. Several raw Laravel-only metric inputs still fall back to null/zero until their source tables are ported. |
| Caring recipient circle | `AdminCaringCommunityController::recipientCircle`, `caring_support_relationships`, `vol_logs`, `caring_help_requests`, `safeguarding_reports`, `users.trust_tier` | `AdminCaringCommunityRecipientCircleController.cs`, `CaringRecipientCircleService.cs`, `CaringSupportRelationship`, `VolunteerLog`, `CaringHelpRequest`, `SafeguardingReport`, `users.trust_tier` EF migration | Admin `GET /api/admin/caring-community/recipient/{userId}/circle` now matches Laravel route surface with feature flag guard, tenant-scoped recipient/supporter lookup, active relationship filtering, approved-hour aggregation, open-help count, safeguarding flag count, `trust_tier`/`member_since` recipient envelope, and Laravel not-found/feature-disabled errors. |
| Caring regional points | `AdminCaringCommunityController::regionalPointsConfig/updateRegionalPointsConfig/regionalPointsLedger/issueRegionalPoints/adjustRegionalPoints/getRegionalPointSellerSettings/updateRegionalPointSellerSettings`, `CaringCommunityApiController::regionalPointsSummary/regionalPointsHistory/regionalPointsTransfer/regionalPointsMarketplaceQuote/regionalPointsMarketplaceRedeem`, `CaringRegionalPointService.php`, `caring_regional_point_accounts`, `caring_regional_point_transactions`, `marketplace_seller_regional_point_settings`, tenant settings `caring_community.regional_points.*` | `AdminCaringCommunityRegionalPointsController.cs`, `CaringCommunityMemberController.cs`, `CaringRegionalPointService.cs`, `CaringRegionalPointAccount`, `CaringRegionalPointTransaction`, `MarketplaceSellerRegionalPointSetting`, `TenantConfig` keys `caring_community.regional_points.*` | Admin config, ledger, issue, adjust, seller-settings, member summary, member history, member transfer, marketplace quote, and marketplace redeem routes now match Laravel route surface with caring/regional-points feature guards, tenant-scoped account/history reads, public member config shape, quote reasons, wallet debit/credit ledger metadata, linked transfer transactions, balance/discount rounding, and Laravel response/error envelopes. |
| Caring research partnerships and role presets | `ResearchPartnershipController::adminListAgreementTemplates/adminRenderAgreementTemplate/adminIndex/adminStore/adminGenerateDataset/adminDatasetExports/adminRevokeDatasetExport/myConsent/updateMyConsent`, `AdminCaringCommunityController::rolePresets/installRolePresets`, `ResearchAgreementTemplateService.php`, `ResearchPartnershipService.php`, `CaringCommunityRolePresetService.php`, `caring_research_*` tables | `AdminCaringCommunityResearchController.cs`, `AdminCaringCommunityRolePresetsController.cs`, `CaringCommunityMemberController.cs`, `ResearchAgreementTemplateService.cs`, `CaringResearchPartnershipService.cs`, `CaringCommunityRolePresetService.cs`, `caring_research_partners`, `caring_research_consents`, `caring_research_dataset_exports` EF migration | Admin agreement-template catalog/render, research partner list/create, dataset generation, dataset-export list with partner filter, dataset-export revoke, member research-consent read/update, and role-preset status/install routes now match Laravel route surface with auth/admin policy, caring feature guard, tenant scoping, scalar-only placeholder rendering, partner validation, normalized data-scope persistence, active-partner export guard, aggregate research dataset suppression threshold, export hash/metadata persistence, revoke audit metadata, default opted-out consent row, consent status validation, optional single-preset install, unknown-preset fallback to all presets, Laravel envelopes, JSON null fallback, and focused regression tests. .NET role-preset install maps Laravel's separate `permissions`/`role_permissions` writes onto the existing `roles.Permissions` JSON model. |
| Caring safeguarding reads and mutations | `AdminCaringCommunityController::safeguardingDashboard/safeguardingList/safeguardingShow/safeguardingAssign/safeguardingEscalate/safeguardingNote/safeguardingStatus`, `SafeguardingService.php`, `safeguarding_reports`, `safeguarding_report_actions` | `AdminCaringCommunitySafeguardingController.cs`, `CaringSafeguardingService.cs`, `SafeguardingReport`, `SafeguardingReportAction`, `safeguarding_report_actions` EF migration | Admin dashboard, filtered report list, report detail, report assignment, report escalation, report note, and report status routes now match Laravel route surface with admin policy, caring feature guard, tenant scoping, status/severity ordering, overdue/open summary counts, actor-name action history, assignee validation, assignment/escalation/note/status audit action rows, lifecycle transition validation, resolution fields, note trimming/nulling, not-found and feature-disabled envelopes, and focused regression tests. Member report submission remains a gap. |
| Caring SLA and support relationships | `HelpRequestSlaController::dashboard`, `HelpRequestSlaService.php`, `AdminCaringCommunityController::supportRelationships/createSupportRelationship/logSupportRelationshipHours`, `CaringSupportRelationshipService.php`, `caring_help_requests`, `caring_support_relationships`, `caring_tandem_suggestion_log`, `vol_logs` | `AdminCaringCommunitySupportController.cs`, `CaringHelpRequestSlaService.cs`, `CaringSupportRelationshipService.cs`, `CaringHelpRequest`, `CaringSupportRelationship`, `CaringTandemSuggestionLog`, `VolunteerLog`, `caring.operating_policy.*` | Admin SLA dashboard, support-relationship list, support-relationship create, and support-hour logging routes now match Laravel route surface with admin policy, caring feature guard, tenant scoping, policy-driven SLA windows, breached/at-risk/on-track bucketing, recently resolved rows, status filtering, stats, participant names, Laravel create/log validation and normalization, duplicate log protection, relationship check-in updates, tandem-suggestion suppression logging, and focused regression tests. Admin support-relationship update and deeper workflow coverage remain gaps. |
| Caring member relationship and report reads | `CaringCommunityApiController::myRelationships`, `pauseRelationship`, `endRelationship`, `resumeRelationship`, `safeguardingMyReports`, `fetchRecentLogs`, `formatRelationship`, `SafeguardingService::myReports` | `CaringCommunityMemberController.cs`, `CaringSupportRelationshipService.ListForMemberAsync`, `PauseRelationshipAsync`, `EndRelationshipAsync`, `ResumeRelationshipAsync`, `CaringSafeguardingService.MyReportsAsync`, `caring_support_relationships`, `vol_logs`, `safeguarding_reports` | Member `GET /api/caring-community/my-relationships`, `POST /api/caring-community/my-relationships/{id}/pause`, `POST /api/caring-community/my-relationships/{id}/end`, `POST /api/caring-community/my-relationships/{id}/resume`, and `GET /api/caring-community/safeguarding/my-reports` now match Laravel route surface with auth, caring feature guard, tenant scoping, active/paused relationship filtering, current-user role and partner projection, latest-three relationship logs, owned relationship lifecycle state changes, Laravel `INVALID_STATE`/`VALIDATION_ERROR`/`NOT_FOUND` envelopes, report preview truncation, newest-first report ordering, and focused regression tests. Safeguarding report submission remains a gap. |
| Caring operating policy | `AdminCaringCommunityController::operatingPolicyShow/operatingPolicyUpdate`, `OperatingPolicyService.php`, tenant settings `caring.operating_policy.*` | `AdminCaringCommunityOperatingPolicyController.cs`, `OperatingPolicyService.cs`, `TenantConfig` keys `caring.operating_policy.*` | Admin show/update routes now match Laravel route surface with feature flag guard, default policy/schema envelope, partial update semantics, enum/int/float/url validation, discrete tenant setting persistence, latest-update timestamp, tenant scoping, and Laravel validation error envelopes |
| Caring member statements | `AdminCaringCommunityController::memberStatement`, `CaringCommunityMemberStatementService.php`, `GET /v2/admin/caring-community/member-statements/{userId}` | `AdminCaringCommunityMemberStatementsController.cs`, `CaringCommunityMemberStatementService.cs`, existing users/transactions/volunteer check-ins, `TenantConfig` keys `caring_community.workflow.*` | Admin JSON and CSV statement route now matches Laravel route surface with feature flag guard, tenant-scoped user lookup, period normalization, workflow-policy defaults, wallet ledger rows, signed CSV amounts, support-hour rollups from .NET volunteer check-ins, not-found envelope, and Laravel-style statement data shape |
| Caring municipal ROI | `AdminCaringCommunityController::municipalRoi/municipalRoiExport`, `GET /v2/admin/caring-community/municipal-roi`, `GET /v2/admin/caring-community/municipal-roi/export`, `categories.substitution_coefficient`, tenant setting `caring_community.formal_care_hourly_rate_chf` | `AdminCaringCommunityMunicipalRoiController.cs`, `MunicipalRoiService.cs`, completed volunteer check-ins, `CaringCaregiverLink`, `Category.SubstitutionCoefficient`, `TenantConfig` key `caring_community.formal_care_hourly_rate_chf` | Admin JSON and CSV export routes now match Laravel route surface with feature flag guard, tenant-scoped hour/relationship aggregation, category-weighted hours, default or tenant-configured CHF hourly rate, ROI/prevention metrics, period/filter envelope, BOM CSV download, and Laravel feature-disabled error envelope; sub-region breakdown remains limited until .NET has support-relationship-to-provider mapping parity |
| Caring nudge analytics | `AdminCaringCommunityController::nudgeAnalytics`, `CaringNudgeService::analytics`, `GET /v2/admin/caring-community/nudges/analytics`, `caring_smart_nudges` | `AdminCaringCommunityNudgesController.cs`, `CaringNudgeAnalyticsService.cs`, `CaringSmartNudge`, `caring_smart_nudges`, `TenantConfig` keys `caring_community.nudges.*` | Admin analytics route now matches Laravel route surface with feature flag guard, tenant-scoped config/defaults, sent/converted totals and 30-day conversion rate, recent nudge rows with target/related user names, opt-out count via .NET notification preferences, conversion marking for active caregiver links, and Laravel response/error envelope. Eligible candidate generation remains provisional until the full Laravel nudge candidate/dispatch engine is ported. |
| Caring paper onboarding | `AdminCaringCommunityController::paperOnboardingList/paperOnboardingUpload/paperOnboardingConfirm`, `PaperOnboardingIntakeService.php`, `caring_paper_onboarding_intakes` | `AdminCaringCommunityPaperOnboardingController.cs`, `PaperOnboardingIntakeService.cs`, `CaringPaperOnboardingIntake`, `caring_paper_onboarding_intakes` EF migration | Admin list/upload/confirm routes now match Laravel route surface with feature flag guard, tenant-scoped intake listing, PDF/JPEG/PNG/WebP 10 MB upload validation, manual-review OCR stub fields, local tenant-specific document storage metadata, confirmation-time member creation, corrected-field persistence, duplicate-email guard, and Laravel response/error envelopes. Rejection/download/OCR-provider replacement remains a deeper workflow gap if Laravel adds it. |
| Caring lead nurture | `LeadCaptureController.php`, `Admin/LeadNurtureAdminController.php`, `LeadNurtureService.php`, tenant setting `caring.lead_nurture.contacts` | `CaringCommunityLeadNurtureController.cs`, `LeadNurtureService.cs`, `TenantConfig` key `caring.lead_nurture.contacts` | Public capture plus admin list/summary/export/update/unsubscribe routes now match Laravel with feature flag guard, tenant-scoped JSON envelope storage, email/segment/consent validation, case-insensitive email dedupe, stage mutation, CSV export, and Laravel error envelopes |
| Caring loyalty bridge | `CaringCommunityApiController::loyaltyQuote/loyaltyRedeem/loyaltyMyHistory`, `AdminCaringCommunityController::listLoyaltyRedemptions/getLoyaltySellerSettings/updateLoyaltySellerSettings/reverseLoyaltyRedemption`, `CaringLoyaltyService.php`, `caring_loyalty_redemptions`, `marketplace_seller_loyalty_settings` | `CaringCommunityLoyaltyController.cs`, `CaringLoyaltyService.cs`, `CaringLoyaltyRedemption`, `MarketplaceSellerLoyaltySetting`, `CaringLoyaltyLedgerConcurrencyTests`, `20260711100817_LoyaltyEstateOrganisationEvidence` | Member quote/redeem/history and admin redemptions/settings/reversal retain the prior route/validation contract. New redemptions persist a unique tenant-composite debit link and reversals persist a unique refund link under a shared personal-wallet lock. Concurrent reversal produces one winner; a legacy applied row without authoritative debit evidence returns a manual-reconciliation failure and cannot mint a refund. Exact Laravel `users.balance` storage and operator disposition of legacy null links remain open. |
| Caring favours admin list | `AdminCaringCommunityController::listFavours`, `caring_favours` | `AdminCaringCommunityFavoursController.cs`, `CaringFavourService.cs`, `caring_favours` EF table | Admin `GET /api/admin/caring-community/favours` now matches Laravel with feature flag guard, tenant-scoped count, latest-50 ordering, anonymous offerer masking, snake_case response fields, and Laravel feature-disabled error envelope |
| Caring municipality feedback | `MunicipalityFeedbackController.php`, `Admin/AdminMunicipalityFeedbackController.php`, `MunicipalityFeedbackService.php`, `caring_municipality_feedback` | `CaringCommunityMunicipalityFeedbackController.cs`, `AdminCaringCommunityMunicipalityFeedbackController.cs`, `MunicipalityFeedbackService.cs`, `caring_municipality_feedback` EF table | Member submit/mine and admin list/show/dashboard/export/triage/resolve/close routes now match Laravel with feature flag guard, tenant scoping, validation codes, pagination metadata, anonymous submitter redaction rules, dashboard aggregates, CSV export, and status mutation envelopes |
| Caring hour estates | `HourEstateController.php`, `HourEstateService.php`, `caring_hour_estates` | `CaringCommunityHourEstateController.cs`, `AdminCaringCommunityHourEstatesController.cs`, `CaringHourEstateService.cs`, `CaringCommunityHourEstateControllerUnitTests`, `20260711100817_LoyaltyEstateOrganisationEvidence` | Member my-estate/nominate plus admin list/report-deceased/settle retain the prior route/validation contract. Positive settlement now persists a unique tenant-composite ledger link; repeat report/settle and post-settlement nomination are rejected. Existing settled rows are retained with null links for read-only operator audit and manual disposition rather than guessed backfill. |
| Caring hour transfers | `CaringCommunityApiController::hourTransferInitiate/hourTransferMyHistory`, `AdminCaringCommunityController::hourTransferPending/hourTransferApprove/hourTransferReject/hourTransferInbound`, `CaringHourTransferService.php`, `caring_hour_transfers` | `CaringCommunityHourTransferController.cs`, `AdminCaringCommunityHourTransferController.cs`, `CaringHourTransferService.cs`, `caring_hour_transfers` EF table | Member initiate/history and admin pending/approve/reject/inbound retain feature, tenant, validation, and same-platform debit/credit behavior. Source approval and rejection share a lifecycle lock, but same-platform tracking rows still lack authoritative transaction-id columns and remote cross-platform delivery still lacks the durable federation settlement saga. The read-only operator audit reports candidate balance effects; it never auto-links them. |
| Caring invite codes | `AdminCaringCommunityController::generateInviteCode/listInviteCodes`, `CaringCommunityApiController::lookupInvite`, `CaringInviteCodeService.php`, `caring_invite_codes` | `AdminCaringCommunityInviteCodesController.cs`, `CaringCommunityInviteController.cs`, `CaringInviteCodeService.cs`, `caring_invite_codes` EF table | Admin list/generate and public lookup routes now match Laravel route surface with feature flag guard on admin routes, tenant scoping, six-character invite-code alphabet, 1-365 day expiry clamp, latest-20 status list, `invite_url`, and always-200 lookup validity envelope |
| Caring forecast dashboard | `AdminCaringCommunityController::forecast`, `CaringCommunityForecastService.php`, `CaringCommunityAlertService.php` | `AdminCaringCommunityForecastController.cs`, `CaringCommunityForecastService.cs` | Admin `GET /api/admin/caring-community/forecast` now matches the Laravel route surface with feature flag guard, tenant-scoped forecast envelope, six-month history fallback, regression-based forecast contract, sub-region demand/helper churn/coefficient drift sections, proactive alert shape, schema-guarded raw SQL for Laravel-style tables, and fallback behavior when deeper caring tables are still absent |
| Admin users / bulk actions | `AdminUsersController::bulkApprove/bulkSuspend`, Laravel React `adminApi.ts` `adminUsers.bulkApprove/bulkSuspend`, `UserList.tsx` | `AdminExplicitParityController.BulkApproveUsers/BulkSuspendUsers`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users/bulk-approve` now accepts React `user_ids`, tenant-scopes eligible users, activates users, clears suspension fields, and returns Laravel `success/data.success/data.failed/data.skipped_ids`. `POST /api/v2/admin/users/bulk-suspend` now accepts React `user_ids` and `reason`, skips the acting/admin/out-of-tenant/missing users, sets suspension fields, and returns the same shared bulk-result contract. Laravel welcome-credit/email/in-app notification side effects and audit-log detail remain deeper workflow gaps. |
| Admin users / single actions | `AdminUsersController::approve/suspend/ban/reactivate/destroy/reset2fa`, Laravel React `adminApi.ts` `adminUsers.approve/suspend/ban/reactivate/delete/reset2fa` | `AdminCompatibilityController`, `AdminController`, `AdminExplicitParityControllerTests`, `AdminUserRoleWriterParityTests` | `POST /api/v2/admin/users/{id}/approve`, `POST /api/v2/admin/users/{id}/suspend`, `POST /api/v2/admin/users/{id}/ban`, `POST /api/v2/admin/users/{id}/reactivate`, `POST /api/v2/admin/users/{id}/reset-2fa`, and `DELETE /api/v2/admin/users/{id}` return Laravel-style `data` or `errors[]` envelopes, tenant-scope targets, guard self and flag-backed privileged targets (including explicit-God accounts), clear 2FA backup codes, and hard-delete eligible tenant users. Laravel welcome-credit/email/in-app notification side effects, status-column fidelity, and audit-log detail remain deeper workflow gaps. |
| Admin users / list detail update | `AdminUsersController::index/show/update`, Laravel React `adminApi.ts` `adminUsers.list/get/update` | `AdminController`, `AdminExplicitParityControllerTests` | `GET /api/v2/admin/users`, `GET /api/v2/admin/users/{id}`, and `PUT /api/v2/admin/users/{id}` now branch to Laravel React `data`/`meta` and `errors[]` contracts, tenant-scope rows, preserve legacy `/api/admin` response shapes, support React search/sort/page/limit filters, expose React user fields such as `name`, `status`, `balance`, `tenant_id`, `has_2fa_enabled`, `badges`, and `roles`, and return updated user data after edits. Status-column fidelity, welcome-credit/email/in-app notification side effects, and audit-log detail remain deeper workflow gaps. |
| Admin users / create | `AdminUsersController::store`, Laravel React `adminApi.ts` `adminUsers.create` | `AdminCompatibilityController.CreateLaravelUser`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users` now accepts Laravel React `first_name`, `last_name`, `email`, `password`, `role`, and `send_welcome_email`, validates required fields/role/password/email with Laravel-style `errors[]` and 422, tenant-scopes the created user, hashes the supplied/generated password, and returns HTTP 201 with `data.id/name/email/role/status` plus `meta.base_url`. Welcome email delivery, GDPR consent rows, starting-balance credits, and audit-log detail remain deeper workflow gaps. |
| Admin users / password and email helpers | `AdminUsersController::setPassword/sendPasswordReset/sendWelcomeEmail`, Laravel React `adminApi.ts` `adminUsers.setPassword/sendPasswordReset/sendWelcomeEmail` | `AdminCompatibilityController.SetUserPassword/SendPasswordReset/SendWelcomeEmail`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users/{id}/password`, `/send-password-reset`, and `/send-welcome-email` now return Laravel-style `data.password_set` or `data.sent` envelopes, use tenant-scoped target lookup, return Laravel `errors[]` for not-found and password validation, hash new passwords, revoke active refresh/reset tokens, and create password reset tokens. Provider-backed email delivery success, localized template fidelity, password-history parity, notification side effects, and audit-log detail remain deeper workflow gaps. |
| Admin users / consents | `AdminUsersController::getConsents`, Laravel React `adminApi.ts` `adminUsers.getConsents`, `UserEdit.tsx` | `AdminCompatibilityController.GetUserConsents`, `AdminExplicitParityControllerTests` | `GET /api/v2/admin/users/{id}/consents` now tenant-scopes the target user, returns Laravel-style `data[]` rows with `consent_type`, `name`, `description`, `category`, `is_required`, `consent_given`, `consent_version`, `given_at`, and `withdrawn_at`, and returns Laravel `errors[]` `NOT_FOUND` for missing/out-of-tenant users. Deeper consent-type metadata and version text remain limited by the current .NET `ConsentRecord` schema. |
| Admin users / import | `AdminUsersController::import/importTemplate`, Laravel React `adminApi.ts` `adminUsers.importUsers/downloadImportTemplate`, `UserList.tsx` | `AdminCompatibilityController.ImportUsers`, `AdminExplicitParityController`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users/import` now accepts Laravel React multipart `csv_file` plus `default_role`, validates CSV headers/rows, tenant-scopes duplicate checks, creates imported users, skips invalid rows, and returns Laravel-style `data.imported/skipped/errors/total_rows`. `GET /api/v2/admin/users/import/template` is routed for the React template download. Laravel federation-settings seeding, welcome/reset email side effects, richer audit-log detail, and full CSV edge-case parity remain deeper workflow gaps. |
| Admin user badges | `AdminUsersController::addBadge/removeBadge/recheckBadges`, Laravel React `adminApi.ts` `adminUsers.addBadge/removeBadge/recheckUserBadges`, `UserEdit.tsx` | `AdminCompatibilityController.GetUserBadges/AddUserBadge/RemoveUserBadge/RecheckUserBadges`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users/{id}/badges` now accepts React `badge_slug`, tenant-scopes user/badge lookup, returns Laravel HTTP 201 `data.awarded/user_id/badge_slug`, and `DELETE /api/v2/admin/users/{id}/badges/{badgeId}` now treats `{badgeId}` as the Laravel `user_badges.id` and returns `data.removed/user_id/badge_id`. `POST /api/v2/admin/users/{id}/badges/recheck` returns Laravel-style `data.rechecked/user_id/badges[]` for the React user edit page, with tenant-scoped `errors[]` not-found handling. Laravel notification side effects and deeper audit detail remain gaps. |
| Admin users / impersonation | `AdminUsersController::impersonate`, Laravel React `adminApi.ts` `adminUsers.impersonate`, `UserList.tsx`, `UserEdit.tsx` | `AdminCompatibilityController.ImpersonateUser`, `AdminExplicitParityControllerTests` | `POST /api/v2/admin/users/{id}/impersonate` now returns Laravel-style `data.token/user_id/user_name/tenant_id/tenant_slug`, tenant-scopes target lookup, blocks protected/self targets with Laravel `errors[]` envelopes, and keeps legacy `/api/admin` top-level token output. Laravel's short-lived single-use impersonation-token persistence/session semantics and deeper audit detail remain gaps. |
| Admin users / super-admin toggles | `AdminUsersController::setSuperAdmin/setGlobalSuperAdmin`, Laravel React `adminApi.ts` `adminUsers.setSuperAdmin/setGlobalSuperAdmin`, `UserEdit.tsx` | `AdminCompatibilityController.SetSuperAdmin/SetGlobalSuperAdmin`, `AdminUserRoleWriterParityTests` | `PUT /api/v2/admin/users/{id}/super-admin` and `/global-super-admin` accept the React `{ grant }` payload, tenant-scope targets, persist the dedicated `is_tenant_super_admin` and `is_super_admin` columns, and return Laravel-style flag envelopes. Platform-super policy gates the tenant flag; explicit `is_god` gates the global flag, so role-only `god` cannot cross `GodOnly`. Migration rollout/fresh-runtime proof, role-change notifications, and audit fidelity remain open. |
| Super admin panel / user privilege actions | `AdminSuperController::userGrantSuperAdmin/userRevokeSuperAdmin/userGrantGlobalSuperAdmin/userRevokeGlobalSuperAdmin`, Laravel React `adminApi.ts` `superAdminApi.grantSuperAdmin/revokeSuperAdmin/grantGlobalSuperAdmin/revokeGlobalSuperAdmin` | `AdminCompatibility3Controller`, `AdminCompatibility3ControllerAuthTests`, `HiddenPrivilegedRoutePolicyParityTests` | `POST /api/v2/admin/super/users/{id}/grant-super-admin`, `/revoke-super-admin`, `/grant-global-super-admin`, and `/revoke-global-super-admin` persist the dedicated tenant/global flags, return Laravel-style `data.granted`/`data.revoked`, use current DB-backed privilege state, and return canonical auth/not-found errors. Resource-level SuperPanel and hub-tenant validation, notification side effects, `SuperAdminAuditService` fidelity, and fresh migration/runtime certification remain deeper gaps. |
| Admin broker canonical writes | `AdminBrokerController::saveRiskTag/removeRiskTag/setMonitoring/getConfiguration/saveConfiguration`, Laravel React `adminBroker.*` | `AdminBrokerController`, `AdminRouteOwnershipParityTests`, `LaravelReactFrontendContractTests.AdminBrokerV2_CanonicalRiskAndMonitoringWritesPersistForBroker` | Canonical risk-tag, monitoring, unreviewed-count, and configuration routes now have one real owner under DB-backed `BrokerOrAdmin`; risk-tag and monitoring writes persist, canonical risk field aliases round-trip, and delete removes the row. Broker configuration reads are allowed, while tenant-wide configuration writes remain admin-only instead of accepting unsafe arbitrary enforcement keys. Missing risk/monitoring columns, granular broker-safe configuration keys, notifications/audits, and archive workflow persistence remain gaps. |
| Super admin panel / user movement | `AdminSuperController::userMoveTenant/userMoveAndPromote`, Laravel React `adminApi.ts` `superAdminApi.moveUserTenant/moveAndPromote` | `AdminCompatibility3Controller`, `AdminCompatibility3ControllerAuthTests` | `POST /api/v2/admin/super/users/{id}/move-tenant` now accepts React `new_tenant_id`, updates the target user's tenant, and returns Laravel-style `data.moved/user_id/old_tenant_id/new_tenant_id/records_moved/tables_failed`. `POST /api/v2/admin/super/users/{id}/move-and-promote` now accepts React `target_tenant_id`, updates the target tenant and `tenant_admin` role, and returns `data.moved/promoted/user_id/old_tenant_id/new_tenant_id`, with Laravel `errors[]` validation for missing tenant ids. Laravel's full `User::moveTenant` related-table migration, hub-tenant access validation, source/destination SuperPanelAccess checks, role-column fidelity, and SuperAdminAuditService detail remain deeper workflow gaps. |
| Super admin panel / bulk operations | `AdminSuperController::bulkMoveUsers/bulkUpdateTenants`, Laravel React `adminApi.ts` `superAdminApi.bulkMoveUsers/bulkUpdateTenants` | `AdminCompatibility3Controller`, `AdminCompatibility3ControllerAuthTests` | `POST /api/v2/admin/super/bulk/move-users` now accepts React `user_ids`, `target_tenant_id`, and `grant_super_admin`, moves valid users, optionally promotes them to `tenant_admin`, and returns Laravel-style `data.moved_count/total_requested/errors`. `POST /api/v2/admin/super/bulk/update-tenants` now accepts React `tenant_ids` and `action`, supports activate/deactivate directly on `Tenant.IsActive`, stores hub enable/disable compatibility metadata, and returns `data.updated_count/total_requested/action/errors`, with Laravel `errors[]` validation for invalid payloads. Laravel SuperPanelAccess checks, Master-tenant guard fidelity, real hub columns, related-table user move orchestration, and SuperAdminAuditService detail remain deeper gaps. |
| Super admin panel / audit log | `AdminSuperController::audit`, Laravel React `adminApi.ts` `superAdminApi.getAudit`, `SuperAuditLog.tsx`, `FederationAuditLog.tsx` | `AdminCompatibility3Controller.GetSuperAuditLog`, `AdminCompatibility3ControllerAuthTests` | `GET /api/v2/admin/super/audit` now accepts Laravel React `action_type`, `target_type`, `search`, `date_from`, `date_to`, `limit`, and `offset` query parameters and returns Laravel-style `data[]` entries with `action_type`, `target_type`, `target_id`, `target_label`, `actor_id`, `actor_name`, `actor_email`, parsed `old_value`/`new_value`, `description`, and `created_at`. Deeper Laravel `SuperAdminAuditService` storage fidelity, full access-level filtering, exact `target_name` semantics, and runtime frontend smoke coverage remain gaps. |
| Super admin panel / federation controls | `AdminSuperController::federationOverview/federationGetSystemControls/federationGetJwtStatus/federationUpdateSystemControls/federationEmergencyLockdown/federationLiftLockdown/federationGetWhitelist/federationAddToWhitelist/federationRemoveFromWhitelist/federationPartnerships/federationSuspendPartnership/federationReactivatePartnership/federationTerminatePartnership/federationGetTenantFeatures/federationUpdateTenantFeature`, `FederationFeatureService`, `FederationPartnershipService`, Laravel React `adminApi.ts` `superAdminApi.getFederationStatus/getSystemControls/getFederationJwtStatus/updateSystemControls/emergencyLockdown/liftLockdown/getWhitelist/addToWhitelist/removeFromWhitelist/getFederationPartnerships/suspendPartnership/reactivatePartnership/terminatePartnership/getTenantFederationFeatures/updateTenantFederationFeature` | `AdminCompatibility3Controller`, `AdminExplicitParityController`, `AdminCompatibility3ControllerAuthTests`, `FederationSystemControl`, `FederationTenantWhitelist`, `FederationTenantFeature`, `FederationPartner`, `SystemSetting` | `GET /api/v2/admin/super/federation` now returns Laravel React `data.system_controls`, `data.partnership_stats`, `data.whitelisted_count`, and `data.recent_audit`. `GET /system-controls` returns Laravel-style `data` fields for federation master switch, whitelist mode, max federation level, cross-tenant feature toggles, lockdown status/reason, and `updated_at`; `GET /jwt-status` now returns Laravel React `data.configured/issuer/key_bits/recommended_bits` without exposing secrets. `PUT /system-controls` accepts Laravel React partial payloads, clamps `max_federation_level` to Laravel's 0-4 range, persists native .NET fields plus compatibility settings, and returns `data.updated`. `POST /emergency-lockdown` and `/lift-lockdown` now persist and return Laravel-style `data.lockdown/message`. `GET/POST/DELETE /api/v2/admin/super/federation/whitelist` now return Laravel-style `data[]`, `data.added`, and `data.removed` envelopes with tenant name/domain, actor, timestamp, notes, typed persistence, and row deletion on removal. `GET /partnerships` now returns Laravel `data.partnerships/stats` with React row aliases, and suspend/reactivate/terminate actions update `FederationPartner.Status` with Laravel `data.suspended/reactivated/terminated` envelopes. `GET/PUT /api/v2/admin/super/federation/tenant/{tenantId}/features` now expose the Laravel React tenant-feature contract, return tenant/whitelist/partnership context plus flattened `cross_tenant_*` feature booleans, accept React toggle payloads, and persist normalized Laravel tenant feature keys. Exact Laravel columns for lockdown/termination metadata, related federation connection/transaction/credit-agreement side effects, and audit-service side effects remain deeper gaps. |
| Admin federation partnership decisions | `AdminFederationController::partnerships/approvePartnership/rejectPartnership`, `FederationPartnershipService`, Laravel React `adminFederation.getPartnerships/approvePartnership/rejectPartnership` | `AdminCompatibility2Controller`, `FederationService`, `FederationPartner`, `AdminFederationPartnershipWorkflowTests` | `GET /api/v2/admin/federation/partnerships` now exposes real incoming/outgoing tenant rows; approve/reject require the receiving tenant, conditionally update pending state, atomically persist one receiver-to-requester audit, preserve Laravel 404/409 error codes and `data/meta` envelopes, and create initiating-admin in-app notifications only after commit. PostgreSQL tests prove auth, tenant isolation, listing, state, audit direction, notification, retry, approve/approve, and approve/reject races. Remaining gaps are Laravel federation-level permission fields/defaults, durable rejection actor/time/reason, per-recipient localization/link/push, durable initial-sync scheduling, and wiring the canonical partnership audit-log read to these audit rows. |
| Admin impact report | `AdminImpactReportController::index/updateConfig`, Laravel React `adminApi.ts` `adminImpactReport.getData/updateConfig`, `admin/modules/impact/ImpactReport.tsx` | `AdminCompatibilityController.GetImpactReport/UpdateImpactReportConfig`, `AdminCompatibilityControllerTests` | `GET /api/v2/admin/impact-report?months=N` now returns Laravel React `data.sroi`, `data.health`, `data.timeline`, and `data.config` with `period_months`, SROI values, tenant identity, and monthly rows. `PUT /api/v2/admin/impact-report/config` now accepts React `hourly_value` and `social_multiplier`, validates Laravel ranges, persists tenant config, and returns `data.message` plus saved values. Deeper Laravel `ImpactReportingService` calculation fidelity, social-value cross-report sync, and runtime frontend smoke coverage remain gaps. |
| Admin CMS pages | `AdminContentController::getPages/getPage/createPage/updatePage/deletePage`, Laravel React `adminApi.ts` `adminPages.*` | `AdminPagesController.cs`, `LaravelReactFrontendContractTests.AdminPagesV2_UsesLaravelReactCmsWorkflowShape` | `GET/POST/GET by id/PUT/DELETE /api/v2/admin/pages` now accept Laravel React CMS payloads including `status`, numeric `show_in_menu`, `content_format`, `design_json`, and `menu_order`, return Laravel-style `data` rows with `status`, menu fields, content fields on detail/create/update, tenant-scope reads and writes, and preserve legacy `/api/admin/pages` coverage. .NET stores Laravel-only page metadata in tenant config because the current `Page` entity lacks `content_format`, `design_json`, and `menu_order`; deeper builder rendering, menu-item side effects, and exact Laravel content schema remain gaps. |
| Ideation challenge status lifecycle | `PUT /api/v2/ideation-challenges/{id}/status`, `IdeationChallengesController::updateStatus`, `IdeationChallengeService::updateChallengeStatus`, Laravel React `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeStatus`, `LaravelReactFrontendContractTests.IdeationChallengesV2_StatusUpdatesLaravelLifecycleAndPersistsDetailStatus`, `IdeationChallengesV2_StatusRejectsInvalidLaravelLifecycleTransition`, `IdeationChallengesV2_StatusRequiresAdminLikeLaravel` | ASP.NET now exposes Laravel React's `/api/v2` status route, requires `AdminOnly`, accepts Laravel lifecycle statuses (`draft`, `open`, `voting`, `evaluating`, `closed`, `archived`), enforces Laravel transition rules, returns Laravel-style `errors[]` for required/invalid/conflict cases, persists status metadata for `GET /api/v2/ideation-challenges/{id}`, and returns the challenge projection on success. Status is stored in tenant config until the native .NET ideation schema has exact Laravel status-column parity; notification/audit side effects and runtime frontend smoke coverage remain gaps. |
| Ideation challenge favorites | `POST /api/v2/ideation-challenges/{id}/favorite`, `IdeationChallengesController::toggleFavorite`, `IdeationChallengeService::toggleFavorite`, Laravel React `IdeationPage.tsx`, `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeFavorite`, `ProjectIdeationChallengeAsync`, `LaravelReactFrontendContractTests.IdeationChallengesV2_FavoriteTogglesAndPersistsLaravelReactFlags` | ASP.NET now exposes Laravel React's `/api/v2` favorite toggle route, toggles repeated POSTs like Laravel, returns `success/data.favorited/favorites_count`, tenant-scopes missing challenge errors, and projects `is_favorited` plus `favorites_count` from `GET /api/v2/ideation-challenges/{id}` for the authenticated caller. .NET stores favorite state in tenant config until `challenge_favorites` and `ideation_challenges.favorites_count` schema parity exists; runtime frontend smoke coverage remains a gap. |
| Ideation challenge duplicate | `POST /api/v2/ideation-challenges/{id}/duplicate`, `IdeationChallengesController::duplicate`, `IdeationChallengeService::duplicateChallenge`, Laravel React `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.DuplicateIdeationChallenge`, `LaravelReactFrontendContractTests.IdeationChallengesV2_DuplicateCreatesLaravelReactDraftCopy` | ASP.NET now exposes Laravel React's `/api/v2` duplicate route, requires admin, tenant-scopes source lookup, creates a `[Copy]` draft challenge, copies React edit metadata, writes the compatibility feed author, returns HTTP 201 with `success/data`, and supports immediate detail/edit reads. .NET stores Laravel-only duplicate metadata in tenant config until exact ideation schema parity exists; notification/audit side effects and runtime frontend smoke coverage remain gaps. |
| Ideation challenge outcomes | `GET/PUT /api/v2/ideation-challenges/{id}/outcome`, `GET /api/v2/ideation-outcomes/dashboard`, `IdeationChallengesController::getOutcome/upsertOutcome/outcomesDashboard`, `ChallengeOutcomeService`, Laravel React `ChallengeDetailPage.tsx`, `OutcomesDashboardPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeOutcome/UpsertIdeationChallengeOutcome/IdeationOutcomesDashboard`, `LaravelReactFrontendContractTests.IdeationChallengesV2_OutcomePersistsLaravelReactPayload`, `IdeationOutcomesDashboardV2_ReturnsLaravelReactSummaryAndRows` | ASP.NET now exposes Laravel React's per-challenge outcome read/write routes and outcomes dashboard route, returns `success/data`, accepts `winning_idea_id`, `implementation_status`, and `impact_description`, requires admin for writes, persists outcome state, and returns React-facing `winning_idea_title`, `implementation_status`, `impact_description`, dashboard counters, and outcome rows with challenge titles. .NET stores outcome state in tenant config until `challenge_outcomes` schema parity exists; winning-idea challenge membership validation, deeper dashboard fidelity, and runtime frontend smoke coverage remain gaps. |
| Ideation campaigns | `GET/POST /api/v2/ideation-campaigns`, `GET/PUT/DELETE /api/v2/ideation-campaigns/{id}`, `POST /api/v2/ideation-campaigns/{id}/challenges`, `DELETE /api/v2/ideation-campaigns/{id}/challenges/{challengeId}`, `IdeationChallengesController::listCampaigns/showCampaign/createCampaign/updateCampaign/deleteCampaign/linkChallengeToCampaign/unlinkChallengeFromCampaign`, `CampaignService`, Laravel React `CampaignsPage.tsx`, `CampaignDetailPage.tsx`, `ChallengeDetailPage.tsx` campaign-link modal | `ReactFrontendCompatibilityController.IdeationCampaigns/CreateIdeationCampaign/IdeationCampaignDetail/LinkIdeationCampaignChallenge/UnlinkIdeationCampaignChallenge`, `LaravelReactFrontendContractTests.IdeationCampaignsV2_UseLaravelReactCrudAndChallengeLinkShape` | ASP.NET now exposes Laravel React's campaign list/create/detail/update/delete/link/unlink routes with `/api/v2` behavior, returns HTTP 201 for create/link, HTTP 204 for delete/unlink, `success/data` envelopes for reads/writes, `challenges_count` plus `challenge_count`, linked challenge rows, and admin-only write/link operations. Campaigns and link rows are stored in tenant config until native `campaigns` and `campaign_challenges` schema parity exists; exact Laravel cursor pagination, creator display names, audit/notification side effects, and runtime frontend smoke coverage remain gaps. |
| Ideation bootstrap taxonomies/templates | `GET /api/v2/ideation-categories`, `GET /api/v2/ideation-tags/popular`, `GET /api/v2/ideation-tags`, `GET /api/v2/ideation-templates`, `GET /api/v2/ideation-templates/{id}`, `GET /api/v2/ideation-templates/{id}/data`, `IdeationChallengesController::listCategories/popularTags/listTags/listTemplates/showTemplate/getTemplateData`, `ChallengeCategoryService`, `ChallengeTagService`, `ChallengeTemplateService`, Laravel React `IdeationPage.tsx`, `CreateChallengePage.tsx` | `CompatibilityController.GetIdeationCategories`, `ReactFrontendCompatibilityController.PopularIdeationTags/IdeationTemplates/IdeationTemplateData`, `MiscParityController.IdeationTags/IdeationTemplate`, `IdeationBootstrapCompatibility`, `LaravelReactFrontendContractTests.IdeationBootstrapV2_UsesLaravelReactCategoriesTagsAndTemplatesShape` | ASP.NET now returns Laravel React `success/data` envelopes and category/tag/template field names for the ideation create/list bootstrap calls, including popular tags as `{ tag, count }`, category `slug/icon/color/sort_order`, template `default_tags`, `default_category_id`, `category_name`, `evaluation_criteria`, `creator`, and template form data. Current data is a compatibility default set until native Laravel `challenge_categories`, `challenge_tags`, `challenge_templates`, and challenge-tag-link schema parity exists; admin CRUD persistence, tenant-custom templates, and deeper service side effects remain gaps. |
| Ideation ideas/comments/media | `GET/POST /api/v2/ideation-challenges/{id}/ideas`, `GET /api/v2/ideation-challenges/{id}/ideas/drafts`, `GET/PUT/DELETE /api/v2/ideation-ideas/{id}`, `PUT /api/v2/ideation-ideas/{id}/draft`, `PUT /api/v2/ideation-ideas/{id}/status`, `POST /api/v2/ideation-ideas/{id}/vote`, `POST /api/v2/ideation-ideas/{id}/convert-to-group`, `GET/POST /api/v2/ideation-ideas/{id}/comments`, `DELETE /api/v2/ideation-comments/{id}`, `GET/POST /api/v2/ideation-ideas/{id}/media`, `DELETE /api/v2/ideation-media/{id}`, Laravel React `ChallengeDetailPage.tsx`, `IdeaDetailPage.tsx` | `ReactFrontendCompatibilityController.SubmitIdeationChallengeIdea/IdeationChallengeIdeas/IdeationIdeaDetail/IdeationIdeaDraft/IdeationIdeaStatus/VoteIdeationIdea/IdeationIdeaConvertToGroup/AddIdeationIdeaComment/DeleteIdeationComment/AddIdeationIdeaMedia/DeleteIdeationIdeaMedia`, `LaravelReactFrontendContractTests.IdeationIdeasV2_UseLaravelReactSubmitMediaCommentStatusAndDeleteShape` | ASP.NET now has explicit `/api/v2` handlers for the Laravel React idea submit/detail/draft/status/delete, vote, convert-to-group, comment create/list/delete, and JSON link-media create/list/delete workflow, including `success/data` envelopes, `data.voted/votes_count`, `data.id` for group conversion navigation, HTTP 201 for create/convert operations, and HTTP 204 for deletes. Link media is stored in tenant config until Laravel's idea-media schema is ported; deeper validation/authorization, full cursor pagination, conversion side effects, and runtime frontend smoke coverage remain gaps. Focused runtime test execution is currently blocked locally by Windows Application Control on the copied `Nexus.Api.dll`; the test is present but not counted as run in this pass. |
| Ideation team tasks | `GET/POST /api/v2/groups/{id}/tasks`, `GET /api/v2/groups/{id}/task-stats`, `GET/PUT/DELETE /api/v2/team-tasks/{id}`, `IdeationChallengesController::listTasks/createTask/showTask/updateTask/deleteTask/taskStats`, `TeamTaskService`, Laravel React `TeamTasks.tsx` | `GroupsParityController.Tasks/TaskStats`, `CompatibilityAliasController.CreateGroupTask/ShowTeamTask/UpdateTeamTask/DeleteTeamTask`, `LaravelReactFrontendContractTests.IdeationTeamTasksV2_UseLaravelReactListCreateStatsUpdateAndDeleteShape` | ASP.NET now exposes the Laravel React team-task route set through the `/api/v2` alias convention, returns `success/data` create/detail/list/update envelopes, cursor-style list `meta.cursor/per_page/has_more`, Laravel statuses (`todo`, `in_progress`, `done`), priorities (`low`, `medium`, `high`, `urgent`), task stats (`total`, `todo`, `in_progress`, `done`, `overdue`), and HTTP 204 for `/api/v2` deletes while preserving legacy `/api` task aliases. Focused Debug runtime smoke coverage passes for the Laravel React task workflow. Tasks are still stored in tenant config until native `team_tasks` schema parity exists; exact DB schema, cursor semantics, assignment validation, and notification/audit side effects remain gaps. |
| Ideation team documents | `GET/POST /api/v2/groups/{id}/documents`, `DELETE /api/v2/team-documents/{id}`, `IdeationChallengesController::listDocuments/uploadDocument/deleteDocument`, `TeamDocumentService`, Laravel React `TeamDocuments.tsx` | `GroupsParityController.Documents`, `CompatibilityAliasController.UploadGroupDocument/DeleteTeamDocument`, `LaravelReactFrontendContractTests.IdeationTeamDocumentsV2_UseLaravelReactUploadListAndDeleteShape` | ASP.NET now returns Laravel React document collection envelopes with `success/data/meta`, `filename`, `original_name`, `mime_type`, `size`, `url`, and uploader data, persists uploads as `GroupFile` rows so upload-refresh works, returns HTTP 201 `success/data.id` for `/api/v2` uploads, and returns HTTP 204 for `/api/v2` deletes. Focused Debug runtime smoke coverage passes for upload/list/delete. Storage still maps Laravel `team_documents` onto .NET `group_files`; exact schema, MIME allow-list parity, filesystem cleanup, cursor semantics, and notification/audit side effects remain gaps. |
| Ideation team chatrooms | `GET/POST /api/v2/groups/{id}/chatrooms`, `DELETE /api/v2/group-chatrooms/{id}`, `GET/POST /api/v2/group-chatrooms/{id}/messages`, `DELETE /api/v2/group-chatroom-messages/{id}`, `POST/DELETE /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}`, `GET /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pinned`, `IdeationChallengesController::listChatrooms/createChatroom/deleteChatroom/chatroomMessages/postChatroomMessage/deleteChatroomMessage/pinChatroomMessage/unpinChatroomMessage/pinnedChatroomMessages`, `GroupChatroomService`, Laravel React `TeamChatrooms.tsx` | `GroupsParityController.Chatrooms/CreateChatroom/PostChatroomMessage/ChatroomMessages/DeleteChatroomMessage/DeleteStoredChatroom/PinMessage/UnpinMessage/PinnedMessages`, `LaravelReactFrontendContractTests.IdeationTeamChatroomsV2_UseLaravelReactChannelMessagePinAndDeleteShape` | ASP.NET now covers the Laravel React chatroom workflow with `success/data` channel list/create, HTTP 201 create/message/pin, message list `success/data/meta`, author rows, pinned message rows, and HTTP 204 unpin/message/channel deletes. Focused Debug runtime smoke coverage passes for create/list/message/pin/unpin/delete. Storage maps Laravel `group_chatrooms` and `group_chatroom_messages` onto tenant config and uses the existing `group_chatroom_pins` table; exact DB schema, private-channel permissions, cursor encoding parity, real-time broadcast events, and notification/audit side effects remain gaps. |
| Feed tracking | `POST /api/v2/feed/posts/{id}/impression`, `POST /api/v2/feed/posts/{id}/click`, `POST /api/v2/feed/impression`, `POST /api/v2/feed/click`, `SocialController::recordImpression/recordClick/recordImpressionV2/recordClickV2`, Laravel React `useFeedTracking.ts`, `useFeedImpression.ts` | `V15SocialCompatibilityController.TrackFeedEvent`, `LaravelReactFrontendContractTests.FeedTrackingV2_UsesLaravelReactRecordedEnvelopeAndValidation` | ASP.NET now returns Laravel v2 `data.recorded` plus `meta.base_url` for legacy post and polymorphic tracking calls, validates Laravel target types, accepts React `target_type`/`target_id` payloads, tenant-scopes target existence for feed-backed entities, and returns Laravel-style `errors[]` for invalid target type/target id/not found cases. Focused Debug runtime smoke coverage passes for post impression, polymorphic post impression, listing click, and invalid type. Deeper parity still needs native `feed_impressions`/`feed_clicks` storage, five-minute per-user debounce, CTR aggregation, and feed-ranking side effects. |
| Feed hide / not interested | `POST /api/v2/feed/posts/{id}/hide`, `POST /api/v2/feed/posts/{id}/not-interested`, `SocialController::hidePostV2/notInterested`, Laravel React feed/detail hide controls | `V15SocialCompatibilityController.HidePost/NotInterested`, `HiddenPost`, `TenantConfig` compatibility rows, `V15SocialCompatibilityControllerUnitTests.HideFeedItemV2_AcceptsLaravelReactPolymorphicHideAndNotInterestedPayloads` | ASP.NET now accepts Laravel React route id plus optional `type` payloads for post and non-post feed items, validates tenant-scoped target existence, writes native `HiddenPost` rows for posts, writes deterministic tenant-config hidden rows for non-post targets, and returns Laravel-style `success/data.hidden/post_id` or `success/data.success/post_id` envelopes. Focused controller-level runtime coverage passes for listing hide and not-interested. Remaining gaps include native Laravel `feed_hidden` table/schema parity, EdgeRank/feed-ranking side effects, and browser smoke coverage. |
| Feed post delete | `DELETE /api/v2/feed/posts/{id}`, `POST /api/v2/feed/posts/{id}/delete`, `SocialController::deletePostV2`, Laravel React feed/profile/group/detail delete controls | `V15SocialCompatibilityController.DeletePost`, `FeedPost`, `V15SocialCompatibilityControllerUnitTests.DeletePostV2_ReturnsLaravelReactDeletedEnvelopeAndForbiddenErrors` | ASP.NET now exposes both Laravel React delete method/path variants, tenant-scopes lookup, enforces owner-only deletion with Laravel-style 403 `errors[]`, returns Laravel-style 404 `RESOURCE_NOT_FOUND`, removes the post, and returns `success/data.deleted/id`. Focused controller-level runtime coverage passes for success and forbidden paths. Remaining gaps include canonical `feed_activity` row cleanup and historical backfill side effects, notification/audit side effects, and browser smoke coverage. |
| Feed user mute | `POST /api/v2/feed/users/{id}/mute`, `SocialController::muteUserV2`, Laravel React feed/profile/group/detail mute controls | `V15SocialCompatibilityController.MuteUserV2/MuteUser`, `MutedUser`, `V15SocialCompatibilityControllerUnitTests.MuteUserV2_ReturnsLaravelReactEnvelopeAndRejectsSelfMute` | ASP.NET now exposes the Laravel React mute route with tenant-scoped target-user validation, self-mute rejection, idempotent storage in `MutedUser`, and `success/data.muted/user_id` response shape while preserving the legacy `/api/feed/mute` body alias. Focused controller-level runtime coverage passes for success and self-mute validation. Remaining gaps include exact Laravel `feed_muted_users` schema naming, broader missing-user/browser smoke coverage, and feed-ranking side effects. |
| Feed reports | `POST /api/v2/feed/posts/{id}/report`, `POST /api/v2/feed/items/{type}/{id}/report`, `SocialController::reportPostV2/reportItemV2`, Laravel React feed/detail/group report modals | `V15SocialCompatibilityController.ReportPost/ReportFeedItem`, `ContentReport`, legacy `FeedReport` mirror for posts, `V15SocialCompatibilityControllerUnitTests.ReportFeedItemV2_PersistsLaravelReactPolymorphicReport` | ASP.NET now accepts Laravel React report payloads with route id, route/body target type, and `reason`, validates tenant-scoped feed target existence, persists non-post reports in `ContentReport`, mirrors post reports into legacy `FeedReport`, rejects duplicates with a Laravel-style conflict, and returns `success/data.reported/target_type/target_id`. Focused controller-level runtime coverage passes for listing reports. Remaining gaps include native Laravel `reports.target_type/target_id` schema fidelity, exact validation/localized error text, moderator notification fan-out, and browser smoke coverage. |
| Feed hashtags | `GET /api/v2/feed/hashtags/trending`, `GET /api/v2/feed/hashtags/search`, `GET /api/v2/feed/hashtags/{tag}`, `FeedSocialController::getTrendingHashtags/searchHashtags/getHashtagPosts`, Laravel React `TrendingHashtags.tsx`, `HashtagsDiscoveryPage.tsx`, `HashtagPage.tsx` | `V15SocialCompatibilityController.TrendingHashtags/SearchHashtags/HashtagPosts`, `Hashtag`, `HashtagUsage`, `V15SocialCompatibilityControllerUnitTests.TrendingHashtagsV2_HonorsLaravelReactLimitAndTenantScope/SearchHashtagsV2_HonorsLaravelReactQueryLimitAndTenantScope/HashtagPostsV2_ReturnsLaravelReactCollectionEnvelopeWithCursorAndVisibleTenantPosts` | ASP.NET trending, search, and tag-page hashtag routes now honor Laravel React `limit`/`per_page`, tenant-scope results, return `success/data[]`, project `tag`/`post_count` or feed-post rows, and apply Laravel-compatible recent-use, wildcard-stripping/empty-query, visible-post, and cursor metadata behavior. Focused controller-level runtime coverage passes for trending limit/tenant isolation, search query/limit/tenant isolation, and tag-page `meta.cursor/has_more/total_items`. Remaining gaps include exact Laravel hashtag/post_hashtags table counter semantics, HMAC cursor signing, richer FeedService item projection parity, and browser smoke coverage. |
| Feed like toggle | `POST /api/v2/feed/like`, `POST /api/social/like`, `SocialController::likeV2/like`, Laravel React `useSocialInteractions.ts`, feed/detail/profile/group/listing calls | `V15SocialCompatibilityController.ToggleLike`, `ContentLike`, legacy `PostLike` mirror, `V15SocialCompatibilityControllerUnitTests.ToggleLikeV2_AcceptsLaravelReactTargetPayloadForPostAndListing` | ASP.NET now accepts Laravel React `target_type`/`target_id` payloads, preserves legacy post id aliases, validates supported feed-backed target types, toggles post and non-post likes through a Laravel-compatible polymorphic `likes` table, mirrors post rows into `PostLike` for existing .NET callers, and returns `success/data.action/status/likes_count` plus legacy top-level `liked/likes_count`. Focused controller-level runtime coverage passes for post like/unlike with `target_type=post` `likes` rows and listing like. Remaining gaps include exact Laravel `likes` schema/index naming, notification/realtime/feed-ranking side effects, and browser smoke coverage. |
| Feed likers | `POST /api/social/likers`, `SocialController::likers`, Laravel React `useSocialInteractions.ts`, `LikersModal.tsx` | `V15SocialCompatibilityController.Likers`, `V15SocialCompatibilityControllerUnitTests.Likers_ReturnsLaravelReactLikersResultShape/Likers_ReturnsLaravelReactPolymorphicLikersForListing` | ASP.NET now accepts Laravel React `target_type`, `target_id`, `page`, and `limit`, returns `success/data.likers/total_count/page/has_more`, orders post and non-post polymorphic likers newest-first, includes `id`, `name`, `avatar_url`, `liked_at`, and `liked_at_formatted`, and applies Laravel's default avatar fallback. Focused controller-level runtime coverage passes for post and listing liker workflows. Remaining gaps include exact DB schema parity, notification/realtime side effects, and browser smoke coverage. |
| Feed shares | `POST /api/v2/shares`, `DELETE /api/v2/shares`, `GET /api/v2/feed/posts/{id}/sharers`, `FeedSocialController::share/unshare/getSharers`, `ShareService`, Laravel React `ShareButton.tsx`, `useSocialInteractions.ts` | `V15SocialCompatibilityController.Share/Unshare/Sharers`, `PostShare` polymorphic fields, `LaravelReactFrontendContractTests.FeedSharesV2_UsesLaravelReactPolymorphicToggleDeleteAndSharersShape` | ASP.NET now exposes the Laravel React polymorphic share contract for `post` and non-post feed items, returns Laravel `data.shared/count/share_id/type/id` plus `meta.base_url`, uses HTTP 201 for new shares and 200 for toggle-off/delete, supports idempotent delete, validates invalid share types with 422 `INVALID_INPUT`, prevents self-share, and returns Laravel sharer list shape with `share_count` and `has_shared`. Deeper parity still needs Laravel notification side effects, unified feed activity/repost rows, and runtime browser smoke coverage. |
| Legacy social comments | `POST /api/social/comments`, `SocialController::comments/fetchComments/submitComment`, `CommentService`, `MentionService`, `SocialNotificationService`, `HtmlSanitizer`, legacy social interaction callers | `V15SocialCompatibilityController.Comments`, `ThreadedComment`, `ContentMention`, `SocialCommentContactPolicy`, `LaravelHtmlSanitizer`, `20260714234546_SocialCommentMentionParity`, focused V15 tests, and PostgreSQL runtime proof | ASP.NET accepts Laravel's legacy action payloads, fetches generic threaded comments, and creates replies/comments with Laravel envelopes. Submission resolves canonical `@username` handles, evaluates target-owner/reply-author/mention recipients under the shared safeguarding policy, persists tenant-bound mention rows plus localized mention/reply/content-owner bells atomically, and performs non-critical push fan-out after commit. Comment and reply writes now sanitize HTML before persistence and mention resolution with Laravel's safe tags, attributes, protocols, executable-block removal, and forced anchor `rel` behavior. Remaining gaps include provider-backed delivery proof, broader target coverage, and browser smoke. |
| Legacy social comment reactions | `POST /api/social/reaction`, `SocialController::reaction`, `CommentService::toggleReaction`, legacy social interaction callers | `V15SocialCompatibilityController.ToggleReaction`, `CommentReaction`, `V15SocialCompatibilityControllerUnitTests.SocialReaction_TogglesLaravelCommentReactionPayload` | ASP.NET now accepts Laravel's legacy comment-reaction payloads (`comment_id` or `target_id`, `emoji` named reaction type), toggles one reaction per user/comment in `CommentReaction`, returns Laravel-style `data.action/reactions`, and preserves `/api/v2/posts/{id}/reactions` post-reaction behavior. Remaining gaps include exact Laravel polymorphic `reactions.target_type=comment` schema parity, notification/realtime side effects, and browser smoke coverage. |
| Feed comments and reactions | `GET/POST/PUT/DELETE /api/v2/comments`, `POST /api/v2/comments/{id}/reactions`, `CommentsController`, `CommentService`, `HtmlSanitizer`, Laravel React `useSocialInteractions.ts` | `CommentsV2Controller`, `ThreadedCommentService`, `LaravelHtmlSanitizer`, `CompatibilityAliasController.AddCommentReaction`, `CommentReaction`, `LaravelReactFrontendContractTests.FeedCommentsV2_UsesLaravelReactThreadedCrudAndReactionShape` | ASP.NET exposes the Laravel React generic comment workflow through `/api/v2/comments`: post-target create returns HTTP 201 with Laravel `data/meta`, list returns `data.comments` plus total `count`, replies are threaded, edit returns `data.content/edited`, delete hard-removes the comment subtree and returns `deleted_count`, invalid targets return Laravel `errors[]`, and comment reactions toggle through `data.action/reaction_type/reactions`. Shared-service create/edit sanitization now preserves Laravel-safe formatting while removing executable blocks, unsafe attributes, inline styles, and dangerous URL schemes. Disposable-PostgreSQL runtime proof passes for the full post comment lifecycle and sanitizer assertions. Remaining gaps include Laravel mention processing, notification fan-out, generic browser smoke coverage, and deeper non-post target workflow tests. |
| Feed item reactions | `POST /api/v2/reactions`, `GET /api/v2/reactions/{type}/{id}`, `GET /api/v2/reactions/{type}/{id}/users/{reactionType}`, `ReactionController`, `ReactionService`, Laravel React `FeedPage.tsx`, `ProfileFeed.tsx`, `PostDetailPage.tsx`, `HashtagPage.tsx`, `GroupDetailPage.tsx`, `ReactionDetailsModal.tsx` | `MiscParityController.CreateReaction/Reactions/ReactionUsers`, `ContentReaction`, `LaravelReactFrontendContractTests.FeedReactionsV2_UsesLaravelReactPolymorphicToggleShowAndReactorsShape` | ASP.NET now exposes the Laravel React polymorphic reaction workflow through the existing `/api/v2/reactions` alias, accepts Laravel target types and reaction types (`love`, `like`, `laugh`, `wow`, `sad`, `celebrate`, `clap`, `time_credit`), persists one reaction per user/content item in a Laravel-style `reactions` table, returns `data.action/reaction_type/reactions.counts/total/user_reaction/top_reactors`, supports toggle-off, validates invalid reaction types with Laravel `errors[]`, supports non-post feed targets such as listings, and returns paginated reactor rows with `meta.has_more`. Focused Debug runtime smoke coverage passes for post reaction toggle/show and listing reactor list. Remaining gaps include exact Laravel `reactions` column naming/index names, notification/realtime fan-out, feed-ranking side effects, and browser smoke coverage. |
| Mention search | `GET /api/v2/mentions/search?q=...`, `POST /api/social/mention-search`, `MentionController::search`, `SocialController::mentionSearch`, `MentionService::searchUsers`, `CommentService::searchUsersForMention`, Laravel React `MentionInput.tsx`, `useSocialInteractions.ts` | `MemberParityController.MentionSearch`, `V15SocialCompatibilityController.MentionSearch`, `ContentMention`, `20260714234546_SocialCommentMentionParity`, route alias convention, focused controller tests, and unchanged-client PostgreSQL proof | V2 and legacy mention search now expose Laravel's nullable, tenant-unique `users.username` rather than the email address; V2 retains one-character search, limit clamping, active tenant isolation, caller exclusion, and connection-first ordering. Comment submission consumes the same canonical handles and creates durable mention/notification side effects. Remaining gaps are blocked-user exclusion beyond active-account filtering, provider-backed push proof, and browser smoke. |
| Admin feed moderation and announcer role | `AdminFeedController::index/show/hide/destroy/stats/grantAnnouncer/revokeAnnouncer`, Laravel React `adminModeration.getFeedPosts/getFeedPost/hideFeedPost/deleteFeedPost/getFeedStats`, `UserEdit.tsx` announcer toggle | `AdminFeedController.cs`, `AdminExplicitParityController.cs`, `AdminController.cs`, focused `LaravelReactFrontendContractTests.AdminFeedModerationV2_*` coverage for `post`, `listing`, `event`, `poll`, `goal`, `job`, `challenge`, `volunteer`, `blog`, and `discussion`, `AdminFeedModerationV2_AllowsBrokerAndCoordinatorButKeepsAnnouncerAdminOnly`, `AdminFeedModerationV2_BrokerCannotHideOrDeleteOwnFeedPost`, `AdminFeedModerationV2_BrokerCannotHideOrDeleteOwnAuthoredNonPostFeedItems`, `AdminFeedModerationV2_UsesStoredChallengeAuthorAndBlocksBrokerSelfModeration`, `IdeationChallengesV2_CreatePersistsChallengeAndFeedAuthorForLaravelReact`, `IdeationChallengesV2_UpdatePersistsLaravelReactEditPayload`, `IdeationChallengesV2_DeleteUsesLaravelNoContentAndRemovesChallenge`, plus `LaravelReactFrontendContractTests.AdminFeedAnnouncerV2_GrantsAndRevokesMunicipalityAnnouncerRoleForUserEdit` | `GET /api/v2/admin/feed/posts`, `GET /posts/{id}`, `POST /posts/{id}/hide`, `DELETE /posts/{id}?type=...`, and `GET /stats` now expose Laravel React post-backed, listing-backed, event-backed, poll-backed, goal-backed, job-backed, challenge-backed, volunteer-backed, blog-backed, and discussion-backed moderation envelopes with `success/data/meta`, snake_case feed rows, `type`, `tenant_name`, `user_name`, hidden/flagged state, counts, detail rows, and success action bodies while preserving legacy `/api/admin/feed` shapes. The moderation routes now use a Laravel-aligned `BrokerOrAdmin` policy for `admin`, `super_admin`, `tenant_admin`, `god`, `broker`, and `coordinator` callers, while member callers remain forbidden and announcer grant/revoke stays admin-only in `AdminExplicitParityController`; post-backed, authored non-post, and compatibility-authored challenge hide/delete now reject broker/coordinator self-moderation with a Laravel-style 403 while admin-tier callers retain access. The canonical `FeedActivity` entity/configuration/service and migration definition for `feed_activity` now exist at source level, but non-post hide/delete state and challenge feed authors still use tenant config; those admin consumers and producers have not migrated to the canonical projection; Laravel React `POST /api/v2/ideation-challenges` now persists a real `Challenge`, returns HTTP 201 `success/data`, writes the challenge feed-author key, `GET/PUT /api/v2/ideation-challenges/{id}` now return/persist Laravel React edit-form metadata, and `DELETE /api/v2/ideation-challenges/{id}` now returns HTTP 204 while removing the challenge and feed compatibility state. `POST /api/v2/admin/feed/grant-announcer` and `DELETE /api/v2/admin/feed/revoke-announcer/{id}` now return Laravel React success envelopes and update `GET /api/v2/admin/users/{id}` `roles[]` so `UserEdit.tsx` sees `municipality_announcer`; current storage is tenant config because .NET lacks Laravel's `user_roles` join. Remaining gaps are migration of admin moderation and remaining producers to canonical `feed_activity`, cleanup/backfill fidelity, real role table assignment parity, notification/audit side effects, and runtime frontend smoke coverage. |
| Audit export | `AdminAuditLogController.php`, `GET /api/v2/admin/audit-log/export.csv` | `AuditController.ExportCsv`, `AuditLogService.ExportLogsAsync` | Activity CSV export now matched with tenant scoping and formula-cell protection; Laravel `org_audit_log`-specific admin export remains a schema/workflow audit item |
| Admin and public blog APIs | `BlogPublicController::index/categories/show`, `AdminBlogController::index/show/store/update/destroy/toggleStatus/bulkDelete/bulkPublish`, Laravel React `BlogPage.tsx`, `BlogPostPage.tsx`, `adminBlog.*`, `GET /api/v2/blog*`, `GET/POST/PUT/DELETE /api/v2/admin/blog*` | `BlogV2Controller`, `AdminBlogController`, `AdminExplicitParityController.BulkDeleteBlogPosts/BulkPublishBlogPosts`, `BlogControllerTests.PublicBlogV2_ReturnsLaravelReactAnonymousCursorContract`, `AdminBlogControllerTests.ListPosts_V2_ReturnsLaravelReactPaginatedRows`, `AdminBlogControllerTests.CrudActions_V2_ReturnLaravelReactBlogPostEnvelopes`, `AdminBlogControllerTests.BulkActions_V2_ReturnLaravelReactBulkResultsAndPersistTenantScopedChanges` | ASP.NET now exposes the anonymous Laravel React public blog read contract through explicit `/api/v2/blog`, `/api/v2/blog/categories`, and `/api/v2/blog/{slug}` routes while preserving legacy `/api/blog` auth behavior. Public list responses return `success/data/meta` with `per_page`, `has_more`, cursor support, category/search filters, `featured_image`, `views`, `reading_time`, author/category objects, category `post_count`, and SEO/detail fields for article pages. Admin blog list returns the Laravel React shape with default `limit=20`, ignored invalid status filters, title/content search, flattened `featured_image`, `author_id/author_name`, `category_id/category_name` rows, and `meta.current_page/per_page/total/total_pages/has_more`. Admin create/update accept Laravel React `slug`, `status`, `featured_image`, `meta_title`, `meta_description`, and `noindex` payload fields, return Laravel `success/data` envelopes, store Laravel-only `noindex` in tenant config, and bulk actions accept `post_ids`, tenant-scope eligible rows, and return `success/data.success/failed/skipped_ids` envelopes instead of generic `202 Accepted`. Exact Laravel `posts`/`seo_metadata` schema fidelity, Laravel activity/audit side effects, blog comments/reactions, resource workflows, and runtime frontend smoke coverage remain gaps. |
| AI module docs | `AiModuleDocsController.php`, `AiModuleDocsService.php`, `GET/POST/PUT/DELETE /api/v2/admin/ai-module-docs`, `POST /api/v2/admin/ai-module-docs/seed-defaults` | `AdminAiModuleDocsController.cs`, `AiModuleDocsService.cs`, tenant-scoped `TenantConfig` storage | Admin list/create/update/delete/seed-defaults routes now match Laravel route surface with `/api` and `/api/v2` aliases, admin policy, tenant scoping, immutable slug update behavior, validation/not-found envelopes, and focused regression tests. .NET stores docs in tenant config because no Laravel migration/model table for `ai_module_docs` was found in source. |
| Admin courses | `AdminCourseController.php`, `CourseCategoryService.php`, `CourseInstructorService.php`, Laravel React `src/admin/modules/courses/CoursesAdmin.tsx` | `AdminCoursesController.cs`, `AdminCoursesService.cs`, tenant-scoped `TenantConfig` storage, `AdminCoursesControllerUnitTests.ModerationWorkflow_SeesAndApprovesInstructorPublishedCourses` | Admin list/analytics/moderate, instructor list/grant/revoke, and category create/update/delete routes now match Laravel route surface with `/api` and `/api/v2` aliases, admin policy, tenant scoping, Laravel-style validation/not-found envelopes, and focused regression tests. Admin moderation now reads instructor-created course compatibility state, approves pending published courses, stamps `published_at`, and makes them visible to public course browse like Laravel's shared `courses` table. |
| Courses learner/instructor API | `CourseController.php`, `CourseEnrollmentController.php`, `CourseContentController.php`, `CourseQuizController.php`, `CourseCohortController.php`, `CourseGroupController.php`, `CourseDiscussionController.php`, Laravel React `src/lib/api/courses.ts` | `CoursesCompatibilityController.cs`, `CoursesCompatibilityService.cs`, tenant-scoped `TenantConfig` storage, `CoursesCompatibilityControllerUnitTests.ReactCourseCreate_KeepsLaravelDraftPendingLifecycleForInstructorDashboard`, `CoursesCompatibilityControllerUnitTests.ReactCoursePublish_RespectsLaravelTenantModerationSetting`, `CoursesCompatibilityControllerUnitTests.ReactCourseCreate_RespectsLaravelRestrictedAuthoringPolicy`, `CoursesCompatibilityControllerUnitTests.ReactCourseAuthored_RespectsLaravelRestrictedAuthoringPolicy`, `CoursesCompatibilityControllerUnitTests.ReactCourseOwnerMutations_RequireOwnerOrAdmin`, `CoursesCompatibilityControllerUnitTests.ReactCourseBuilderEndpoints_RequireOwnerOrAdmin`, `CoursesCompatibilityControllerUnitTests.ReactCourseEndpoints_RespectLaravelCoursesFeatureFlag`, `CoursesCompatibilityControllerUnitTests.ReactCourseGradeAttempt_RequiresCourseOwnerOrAdmin`, `CoursesCompatibilityControllerUnitTests.ReactCourseGroupLinks_RequireLaravelManageableGroup` | Browse/category/show/review/create/update/delete/publish/enroll/my-courses/progress/prerequisites/certificate/content/discussion/quiz/cohort/group/analytics/grading routes now match the Laravel route surface with `/api` and `/api/v2` aliases, tenant scoping, Laravel-style data/error envelopes, and focused route/workflow regression tests. Course endpoints now honor `features.courses=false` with Laravel-style `FEATURE_DISABLED` responses; create preserves Laravel's draft/pending lifecycle and server-side `members` visibility default; create/mine honor Laravel's `courses.allow_member_authoring=false` restricted-authoring policy by requiring an instructor grant or admin role; update/publish/unpublish/delete/analytics require the course owner or admin; content-builder/grading endpoints enforce the same course owner/admin guard; course group attach/detach now require a real tenant group that the caller can manage, returning Laravel-style `RESOURCE_NOT_FOUND` or `FORBIDDEN` errors otherwise; and grade-attempt now resolves the owning course before allowing owner/admin grading like Laravel. Course publish honors Laravel's `courses.moderation_enabled` tenant setting by keeping moderated publishes pending and unstamped until approval. Deeper persistence and browser smoke coverage remain gaps until the full Laravel course schema and workflows are ported idiomatically to .NET. |
| Podcasts learner/creator/admin API | `PodcastController.php`, `AdminPodcastController.php`, `AdminConfigController::getPodcastConfig/updatePodcastConfigBulk`, Laravel React `src/lib/api/podcasts.ts`, `src/admin/modules/podcasts/PodcastsAdmin.tsx`, `src/admin/api/adminApi.ts` podcast config calls | `PodcastsCompatibilityController.cs`, `PodcastsCompatibilityService.cs`, tenant-scoped `TenantConfig` storage | Public browse/show/episode/RSS/media/transcript/chapters, creator authored/create/update/publish/archive/delete show and episode flows, Laravel React multipart `audio` episode upload on `POST /api/v2/podcasts/{showId}/episodes`, string `chapters` JSON decoding, subscribe/listen/reaction/report, admin config, admin moderation, report resolution, feed validation, storage verification, and stats routes now match the Laravel React route surface with `/api` and `/api/v2` aliases, tenant scoping, Laravel-style data/meta/error envelopes, and focused route/workflow tests. Deeper schema, binary media serving, durable uploaded-audio storage, RSS fidelity, moderation side effects, malware/media-processing jobs, and podcast analytics remain compatibility-state based until the full Laravel podcast schema/workflows are ported. |
| Email deliverability | `AdminEmailDeliverabilityController.php`, Laravel React `src/admin/modules/advanced/EmailDeliverability.tsx`, `GET/DELETE /api/v2/admin/email-deliverability/*` | `AdminEmailDeliverabilityController.cs`, `AdminEmailDeliverabilityService.cs`, existing `EmailLog` plus tenant-scoped `TenantConfig` compatibility rows | Summary, push-summary, trigger-audit, logs, queues, suppressions, suppression delete, and user-history routes now match Laravel route surface with `/api` and `/api/v2` aliases, admin policy, tenant-scoped email-log reads, React-compatible data envelopes, and focused regression tests. Suppression and queue diagnostics use tenant config until Laravel-only `email_suppression`, `push_log`, and queue tables are represented in .NET schema. |
| AI trace metrics | `Api/Admin/AiTraceMetricsController.php`, `AiTurnTraceService::metricsFor` | `AiKnowledgeController.TraceMetrics` | Basic tenant-scoped metrics response now matched for turns, tokens, estimated cost, latency, feedback counts, top tools, and downvote notes; text-rich unanswered trace rows remain limited by current .NET audit schema |
| Tenant header logos | `AdminConfigController::uploadHeaderLogo*` / `removeHeaderLogo*`, `POST/DELETE /api/v2/admin/settings/header-logo*` | `AdminController.UploadHeaderLogo*`, `AdminController.RemoveHeaderLogo*` | Upload and clear endpoints now matched with tenant-scoped config updates, 2 MB logo validation, SVG allowance with script checks, and Laravel `{ data: { url } }` / `{ data: { url: null } }` shapes |
| Bookmarks and collections | `BookmarkController::collections/createCollection/deleteCollection/status/move`, `GET/POST/DELETE /api/v2/bookmark-collections*`, `GET /api/v2/bookmarks/status`, `POST /api/v2/bookmarks/{id}/move` | `BookmarksController.ListLaravelCollections`, `CreateLaravelCollection`, `DeleteLaravelCollection`, `LaravelBookmarkStatus`, `MoveLaravelBookmark` | Top-level collection list/create/delete plus status and move routes now matched with Laravel-style `data`/`errors` envelopes, owner scoping, bookmark counts, type-string mapping, and explicit unlink-before-delete behavior; `GET/POST /api/v2/bookmarks` remain matched by route and still need deeper request/response schema audit |
| Member availability | `MemberAvailabilityController.php`, Laravel React `AvailabilityGrid.tsx`, `GET/PUT /api/v2/users/me/availability`, `GET /api/v2/users/{id}/availability` | `UsersParityController.Availability`, `CompatibilityAliasController.UpdateAvailabilityAlias`, `ReactFrontendCompatibilityController.UserAvailability`, `AvailabilityControllerTests` | React availability-grid read/write calls now match the Laravel-style success/data envelope with `weekly` slots and `timezone`, persist bulk `slots` payloads into tenant-scoped `MemberAvailability`, and expose public user availability through `/api/v2/users/{id}/availability`. Day-specific updates, one-off date slots, compatible-time search, available-member search, and deeper validation parity remain gaps. |
| User theme/preferences/settings | `UsersController.php`, `UserInsuranceController.php`, Laravel React `ThemeContext.tsx`, `SettingsPage.tsx`, `PrivacyTab.tsx`, `GET /api/v2/users/me`, `PUT /api/v2/users/me/theme`, `PUT /api/v2/users/me/theme-preferences`, `GET/PUT /api/v2/users/me/preferences`, `GET/POST /api/v2/users/me/insurance` | `UsersController.GetMe`, `CompatibilityAliasController.UpdateThemeAlias`, `UsersParityController.ThemePreferences`, `InsuranceController.GetMyCertificatesV2/CreateV2`, `UsersControllerTests`, `LaravelReactFrontendContractTests`, `InsuranceControllerTests` | ThemeContext bootstrap and persistence calls match the Laravel React shape with `preferred_theme`, `theme_preferences`, and Laravel-style success/data update envelopes. Settings privacy/feed/translation preferences and notification settings have focused contract coverage. The member insurance PrivacyTab slice now accepts Laravel React multipart `certificate_file` plus `insurance_type`/provider/policy/coverage/date fields on `POST /api/v2/users/me/insurance`, stores the file through the .NET file service, returns HTTP 201 `success/data`, and lists Laravel `insurance_type`, `provider_name`, `coverage_amount`, `certificate_file_path`, and `submitted` status fields. Remaining gaps include exact Laravel insurance `notes` persistence, physical upload path fidelity, admin/user notification side effects, and broader runtime frontend smoke coverage. |
| Provisioning requests | `TenantProvisioningController.php`, `SuperAdmin\TenantProvisioningController.php`, Laravel React `PilotApplyPage`, `PilotApplyStatusPage`, `ProvisioningRequestsPage` | `PublicProvisioningController.LaravelSubmit/LaravelCheckSlug/LaravelStatus`, `AdminProvisioningController.LaravelList/LaravelGet/LaravelApprove/LaravelReject/LaravelRetry`, tenant middleware public `/api/v2/provisioning-requests` exclusion | Public slug availability, submit, status token, super-admin list/detail, approve, reject, and retry routes now match the Laravel method/path surface with `/api/v2` aliases, Laravel-style `data` envelopes, status-token projection, numeric compatibility ids, rejection validation, tenant-safe public handling, and focused integration tests. Deeper async tenant creation/job behavior remains a workflow parity item beyond the React contract smoke path. |
| Accessible frontend backing routes | `routes/govuk-alpha.php`, `routes/govuk-alpha-parity/*` | `apps/web-uk/` consuming .NET API | Needs route-by-route API support verification |

## Generated Artifacts

The repeatable static comparison script writes these ignored artifacts by
default:

```text
artifacts/parity/api/api-parity.json
artifacts/parity/api/api-parity.csv
artifacts/parity/api/api-parity.md
```

Generated artifacts stay out of git unless curated into maintained docs.
