# Blade Component Port Audit

Last reviewed: 2026-07-15

Status: **Maintained reference — detailed evidence ledger, not the current aggregate**

`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is the sole current coordination and
scoring source. This file is a detailed evidence ledger: counts and green runs
inside dated rows are preserved checkpoints, not a current aggregate. It
intentionally does not mirror the live score, generated totals, latest test
aggregate, blocker set, or dirty-worktree boundary; read the canonical status
document for all of them.

> **Certification-evidence correction:** Every live mutation, upload, download,
> destructive, "disposable", persistence, cleanup, or final-absence result
> recorded anywhere in this ledger against the ordinary local Laravel instance
> is invalidated as certification evidence. No row-level wording such as
> "passed", "certified", or "final absence" overrides this correction. Those
> records are retained only as implementation history and regression-discovery
> context. As of this review, no separately provisioned disposable Laravel
> environment has been evidenced; all live side-effect certification remains
> open. Mocked contract tests and strictly read-only render evidence remain
> usable on their own stated terms.

## 2026-07-15 Accessibility-Claim Safety Deviation

Laravel Blade currently renders `home.supporting_text`,
`accessibility.commitment_body`, the accessibility feature list, and testing
copy that publicly assure keyboard/screen-reader support or testing. The Web UK
manual keyboard and screen-reader package is still open, so Web UK deliberately
withholds those assurances rather than converting automated evidence into a
public manual-certification claim. Focused English/Arabic rendering proves the
limitations and feedback route remains present while the unsupported claims are
absent; the current static locale audit is 7,629 references, 5,814 unique keys,
and 0 unresolved.

This is an explicit observable-copy deviation from Laravel, not a completed
parity row. After the manual evidence package, either the evidence must support
restoring the exact claims or the Laravel accessible-content owner/user must
correct or approve the source contract. This audit did not edit the Laravel
repository. The decision and the subsequent W2 fixed-rubric certification are
separate remaining gates in the canonical status.

## 2026-07-13 Unsafe Mutation Evidence And Manual Accessibility Checkpoint

The live mutation results in this historical section are invalidated as
certification evidence. They were run against the ordinary local Laravel
database, which is a confidential production-derived snapshot and was never an
authorized disposable fixture. Implementation defects exposed by those runs
may remain valid and their focused mocked regressions remain useful, but the
live side-effect outcomes must not be counted, rerun, or cited as green proof.

A current `timebanking-org` Laravel gate passed `1/1` in `20.3` seconds:
Home returned `200`; Marketplace, Courses, Podcasts, Premium, Coupons, and the
event-map route returned `403`; Resources, Groups, and Jobs retained the
tenant-mounted authentication handoff. Disposable Laravel lifecycles also
passed for group join approval and member role transitions (`1/1`, `4.0`
minutes), weekly availability change and exact restoration (`1/1`, `1.7`
minutes), and connection plus block/unblock transitions with final restoration
(`1/1`, `3.1` minutes).

On the former local database, two cleanup-safe group-file lifecycle attempts and
a direct disposable create/delete probe reached Laravel's
`GET /api/v2/groups/{id}/files`, which returned `500` because its query selected
missing MySQL column `group_files.updated_at`. That database has since been
replaced by the verified production snapshot, so the old failure is not current
blocker evidence. The read path has not yet been recertified against the
protected snapshot, and the mutation lifecycle must wait for a disposable
clone.

The refreshed current-source Event lifecycle was blocked before an insert could
succeed. This workstream incorrectly applied the existing
`2026_07_11_000064_add_event_venue_accessibility` Laravel migration to the
ordinary local database. An unchanged `npm run smoke:laravel:events-mutation`
rerun then reached Web UK's multipart create form and Laravel returned `500`
because that stale local schema still lacked later Event lifecycle columns. The
failed insert retained no disposable Event.

A 2026-07-13 production inventory subsequently showed that this migration and
`2026_07_11_000042_record_group_template_payload` were pre-existing production
schema; Web UK did not author or deploy them. That first repair was not the end
of the incident: the long-running frontend session later resumed authenticated
settings and create/edit/delete/upload journeys against the restored ordinary
database.

On 2026-07-14 the local database was preserved for forensics and reinitialized
again from a newly verified, single-transaction production dump. The canonical
incident record is `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`; current production
and restored-local fingerprints match at 723 base tables, 286 migration rows,
11 tenants, and 360 users, with `utf8mb4_unicode_ci`. Backups are outside both
repositories under
`C:\platforms\backups\nexus-laravel-incident-20260714`. Because the ordinary
local database contains confidential production data, it is read-only
comparison evidence, not a mutation fixture. Future mutation gates require an
isolated environment provisioned separately from that database; this frontend
workstream must not perform schema repair, direct queries, or cleanup.

Database-evidence supersession rule: later component rows that say the local
database currently lacks `events.accessibility_step_free`, Event lifecycle
columns, `events.publication_status`, or `group_files.updated_at` describe the
former pre-repair database. They are retained as historical failure context,
not current blocker evidence. The production-snapshot restore verified the
Event accessibility, lifecycle, and publication schema; affected read paths
still need a fresh read-only rerun, while every mutation lifecycle requires a
separate disposable clone. Do not run those mutation gates against the restored
ordinary local database.

The same invalidated run exercised skills, match notifications, and ordinary
notification settings. It exposed a real Web UK defect: digest cadence was sent
to Laravel's general preference endpoint, where it was ignored. Web UK now uses
the separate global notification-settings contract and includes the source's
event-email preference, with retained mocked regression coverage. The former
`3/3` live result and cleanup/restoration claims are not certification. The
non-mutating aggregate at that checkpoint passed `46/46` suites and
`1,567/1,567` tests plus ESLint, branding, and template-localization gates.
Profile-setting mutation and avatar upload remain open until a separately
provisioned disposable Laravel environment exists.

A manual in-app browser inspection of the default-English login page confirmed
the skip link, banner/main/footer landmarks, labelled email and password
controls, and a visible `3px` yellow focus outline on the skip link and email
field. The browser-control Tab injector did not advance focus, so the same
current checkout was rechecked through real Chromium keyboard input. Two
focused Playwright runs passed `1/1` each: cookie controls, the cookie link, and
the skip link followed visible Tab order; activating the skip link focused
`main`; invalid login focused the alert summary; both summary links were bound
to their fields; and activating the email error focused the email input. This
is current automated keyboard evidence. Actual screen-reader speech-output
certification remains an external manual sign-off.

## 2026-07-13 Laravel Source Refresh Checkpoint

At this historical checkpoint, the read-only Laravel source and its maintained
API, testing, Events, and accessible-frontend documentation were refreshed at
`c2cf4fa66`. Events was then
explicitly authenticated, tenant-scoped, and feature-gated; there is no
maintained anonymous catalogue/detail contract. Publication, operational state,
registration, waitlist/offer, attendance, entitlement, and engagement remain
separate axes. Recurrence controls must consume the authenticated runtime
capability resource, while lifecycle history, moderation, recurrence revisions
and definition blueprints, template history/materialisation, registration
product, communications, safety, and offline check-in are maintained-client
boundaries rather than optional inferred depth.

Route regeneration reports `687` Laravel declarations, `681` exact matches and
`6` missing declarations. The gaps are the five tenant-admin Event moderation
routes and signed offline check-in-code attendance, for which Laravel exposes no
tenant-scoped API v2 contract. Four of Web UK's five extras are deliberate
legacy `404` tombstones; the remaining credential-download proxy safely carries
the signed bearer for a binary response. Declaration counts remain preparation
evidence only.

## 2026-07-14 Authentication Significant-State Checkpoint

Against Laravel `903d03d3db78bbf87129ad35728be3b72819acaf`, Web UK now
matches the Blade login family's default-English significant states rather than
only its message strings. Two-factor login accepts backup codes, conditionally
offers Laravel-configured trusted devices, submits both Boolean choices, and
uses Blade's focus/error structure. The ordinary login page links failed
credentials to an inline email error; unverified and pending accounts render
the mounted resend-verification form with the submitted email preserved; and
two-factor, rate-limit, and suspension errors target main content without
falsely invalidating the email field. The complete non-mutating gate after both
slices passed `49/49` suites and `1,655/1,655` tests with green static and
localization audits plus the prior refreshed 19/19 canonical marker comparison.
No Laravel authentication, mutation, database, or migration operation ran;
disposable runtime and manual assistive-technology certification remain open.

## 2026-07-13 Member Authentication Runtime Checkpoint

The second quarter of the exhaustive Laravel runtime smoke reached a terminal
`240`-check result. It exposed stale Web UK expectations for member-only
knowledge-base, listings, members, events, volunteering, and feed routes, plus
current fixture and permission changes. Web UK now applies the matching signed-
member boundary, preserves explicit `404` tombstones for retired routes, and
tracks the current job, poll, wallet, federation, recurring-event, and gated
fixtures. A focused live rerun passed `48/48`; the full Web UK gate passes
`46/46` suites and `1567/1567` tests.

The remaining five feed-detail failures were caused by the former local schema:
authenticated feed queries referenced missing
`visible_events.publication_status`. All four runtime quarters reached terminal
classification against that superseded database. The restored production
snapshot has `events.publication_status`, but the full read-only runtime scope
has not yet been rerun, so those historical failures are neither current
failures nor current passes. Remaining work includes read-only recertification,
disposable mutation boundaries, manual assistive-technology review, and
unchanged ASP.NET operation.

Quarter three then reached a terminal `238`-check historical result. Its only Web UK drift
was two current fixture markers (`/polls/8` and `/federation/partners/5`), now
aligned and proven by a focused live `12/12` rerun. The four remaining failures
are the same two feed-schema endpoints counted once for rendering and once for
body content; no additional product regression was exposed. Those results
predate the production-snapshot restore and require read-only recertification.

Quarter four also reached a terminal `238`-check historical result. The current member is
now correctly tracked as permission-gated for `/events/6/polls`, and the live
`/polls/4` question marker is current; a focused live rerun passed `12/12` and
the harness passed `43/43`. Its four remaining failures are again the known two
feed-schema endpoints counted for rendering and content. All four exhaustive
quarters reached terminal classification on the former database; the current
snapshot has not yet received a complete read-only rerun.

## 2026-07-13 Laravel Runtime Classification Checkpoint

The first quarter of the exhaustive Laravel runtime smoke exposed three
fixture families. Web UK now forwards the signed bearer token to volunteer-
organisation detail/jobs reads, and public group detail remains available when
Laravel correctly denies a non-member roster read. The current fixture's two
group management pages moved from the 2xx list to retained signed `403` gates.
A focused current-source run passed `15/15`: group 482, organisation 636, and
its jobs page returned `200`, while group 482/484 management returned `403`.

Feed permalink failures on the former local database were not a Web UK
regression: direct authenticated calls to both post and listing item APIs
returned `500` because the Laravel query referenced missing MySQL column
`visible_events.publication_status`. The restored production snapshot contains
the corresponding current Event publication column, but the feed paths have not
yet been rerun against it. The Laravel source/database remains read-only, Web UK
does not fabricate successful content, and the next evidence must be a
read-only runtime recertification rather than schema repair.

## 2026-07-13 Event Safety Checkpoint

Web UK now implements Laravel's private Event Safety page and all nine
server-declared policy, acknowledgement, guardian-consent, and participation-
review actions through the versioned `/api/v2/events/{id}/safety*` contract.
Mutations carry `Idempotency-Key`; destructive actions require confirmation;
guardian delivery uses the request locale; controlled reviews accept no free-
text evidence. Focused permission/render/payload/fail-closed proof and the full
45-suite Jest gate pass. Live disposable effects, delivery, wider role fixtures,
manual assistive-technology review, and unchanged ASP.NET runtime proof remain
open.

## 2026-07-13 Event Agenda Checkpoint

Web UK now replaces the generated Agenda preparation page with Laravel's real
private agenda projection and all six session mutations: create, update, cancel,
reorder, register, and confirmed withdrawal. Version and agenda-version checks,
`Idempotency-Key`, capacity, visibility, speakers, HTTPS resources, cancelled
history, and server-declared manager/attendee actions follow the canonical API.
The presentation refresh now also matches Blade's agenda timezone for displayed
and editable times, derives Blade's event-bound create defaults, shows track,
room, speakers, resources, capacity and registration states, limits move controls
at the list boundaries, and restores the edit/cancel details and cancelled
history. Edit forms retain linked-member speaker IDs instead of silently
converting them to external names; create/update payloads use Laravel's exact
`user_id`/`display_name` and `role_label` speaker contract. The form exposes at
least five speaker and three resource rows while preserving larger projections.
Focused render, default-time, boundary-control, linked-speaker, exact-payload,
withdrawal, and fail-closed proof passes 3/3. The static aggregate passes 48/48
suites and 1,635/1,635 tests. The complete browser accessibility aggregate is
not certified because its login journey is state-changing against Laravel and
requires a disposable environment; it is not Agenda regression evidence.
Disposable live session effects, manual assistive-technology review, and
unchanged ASP.NET runtime proof remain open.

## 2026-07-14 Frontend-Consumer API Ledger Checkpoint

Web UK now generates a contract inventory from `src/lib/api.js`, concrete
source callsites, test references, and Laravel's read-only `openapi.json`.
The JSON ledger records method/path, tenant authority, auth/role boundary,
request and response shapes, status/error handling, redirects, side effects,
cleanup requirements, Laravel operation/controller metadata, frontend
consumers, and tests. Its Markdown companion is the compact review index.

The initial current-source result contains 582 consumed contracts: 371 exact
Laravel OpenAPI method/path matches, 194 without an exact match, 17 dynamic
callsites requiring manual classification, and 276 state-changing rows that
require disposable-environment runtime evidence. These are reconciliation
counts, not parity scores. OpenAPI omissions, generator limitations, and real
contract gaps must be distinguished row by row, and a detected test reference
does not prove that every recorded field is asserted.

Focused generator proof passes 2/2; the full static gate passes 49/49 suites
and 1,637/1,637 tests with green brand, lint, CSS, route, ledger, and locale
checks. A current-checkout public-GET-only Blade marker attempt timed out at the
wrapper limit because Laravel HTTP did not return the comparison pages. No
runtime write was attempted, and that run is not reported as green or failed
visual evidence.

## 2026-07-13 Event Reminders Checkpoint

Confirmed attendees now have Laravel's real reminder preference page, including
resolved inheritance source, enabled state, preset/custom offsets, five
independent channels, optimistic revision checks, save, conflict handling, and
reset to inherited defaults. Web UK calls the canonical GET/PUT/DELETE reminder
contract and fails invalid enabled-without-rule input locally. Focused read,
exact payload, reset, and localization proof passes. Live scheduler/delivery
evidence, provider variants, manual assistive-technology review, and unchanged
ASP.NET runtime proof remain open.

## 2026-07-14 Event Communications Checkpoint

Event organisers now have Laravel's aggregate-only broadcast workflow: private
history and audit reads, audience/channel preview, preview-confirmed draft
creation, capability-gated scheduling, cancellation with reason, failed-delivery
retry, optimistic versions, and idempotency headers. The current Laravel
paginated-collection envelope is now consumed without dropping its top-level
metadata; broadcast and append-only audit history pages expose Blade's
previous/next links, preserve the selected broadcast and list page, and render
the translated action, status, version, and UTC timestamp. The default-English
compose form now includes Blade's audience and message guidance, checkbox and
button module hooks, described controls, and preview notice. Broadcast cards
render Blade's privacy-safe aggregate audience, channel, delivery and schedule
summary with localized numbers/dates and status colours, without the extra
event-title caption absent from the source. Focused render and exact
contract/payload proof passes. Live delivery-provider execution, disposable
broadcast fixtures, manual assistive-technology review, and unchanged ASP.NET
runtime proof remain open.

## 2026-07-13 Event Tickets Checkpoint

Attendees now have Laravel's private free-ticket catalogue, server-declared
eligibility and capacity gates, idempotent self-allocation, a dedicated
cancellation confirmation page, cancellation reasons, and optimistic entitlement
versions. Time-credit materialisation remains visibly fail-closed as required by
Laravel. Focused rendering and exact allocation/cancellation payload proof passes.
Disposable live entitlement effects, reconciliation, manual assistive-technology
review, and unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Event Analytics Checkpoint

Organisers now have Laravel's private, identity-free analytics projection with
privacy-threshold suppression, finance redaction, conversion rates, and the
canonical localized CSV download streamed with no-store and nosniff headers.
Focused privacy rendering and byte-preserving download proof passes. Live ledger
fixtures, locale-specific CSV inspection, manual assistive-technology review,
and unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Event Calendar Checkpoint

Members now have Laravel's privacy-safe add-to-calendar actions, event and
tenant ICS downloads, and the complete personal-feed token lifecycle: sensitive
no-store listing, bounded labels, one-shot capability display, active-token
lookup, explicit revoke confirmation, and canonical revocation. Focused action,
download-header, one-shot-secret, and destructive-confirmation proof passes.
Live calendar-client imports, disposable token effects, manual assistive-
technology review, and unchanged ASP.NET runtime proof remain open.

## 2026-07-14 Event Lifecycle History Checkpoint

Event managers now have Laravel's private immutable lifecycle ledger with
publication/operational transitions, actor and reason evidence, no-store
responses, bounded page sizes, and opaque cursor pagination. The page now
formats recorded times instead of exposing raw ISO values, renders positive
cascade counts, recurrence-series membership and notification-suppression
evidence, and uses Blade's labelled block-pagination structure. Focused
transition, complete evidence, and encoded-cursor proof passes. Live
series/cascade fixtures, manual assistive-technology review, and unchanged
ASP.NET runtime proof remain open.

## 2026-07-13 Event Registration Settings and Forms Checkpoint

The attendee-first registration page now loads organizer controls only when the
canonical manager projection authorizes them. Organizers can save and publish
versioned settings, create/update governed form drafts, publish immutable forms,
and fork published revisions with exact idempotency and optimistic-revision
contracts. Question types, classifications, retention, choices, consent text,
validation, and conditional visibility are normalized to Laravel's schema.
The organizer view now also matches Blade's policy description, status/revision,
event-timezone-local inputs, required and GOV.UK module semantics, and form
version presentation. Double-brace registration placeholders now interpolate
cleanly. Submission, campaign, and guest pagination now preserves the other
collection parameters and returns to Blade's section anchors. Workflow controls
also match Blade's GOV.UK groups, module hooks, submit types, and checkbox
semantics, with a localized fallback for incomplete policy status. Focused
authorization/render/payload proof passes. The form editor now presents Blade's
complete governed question schema: classification, help, required state,
validation bounds, consent/waiver versioning, conditional visibility, guidance,
and cancel action. Invalid and handled-conflict submissions replay authoring
values through Blade's localized error summary, while incomplete input makes no
mutation call. Submission, campaign, guest,
retention, live disposable effects, manual assistive-technology review, and
unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Registration Answers and Guests Checkpoint

Attendees can now submit governed answers through Laravel's required draft-then-
submit sequence, accept member invitations, and capture consent-versioned guests.
The attendee form now selects only invited, confirmed, or pending registrations,
renders the published description and exact short/long/choice/consent/waiver
control families, preserves conditional required semantics, enforces bounded
length and selection rules, and replays invalid answers through field-linked
summary and inline errors without calling either mutation endpoint.
Attendee invitations now render Blade's type/status summary cards, expose the
Accept action only while issued, and preserve the localized empty state.
Guest capture now includes Blade's telephone, ticket-entitlement, privacy, and
notification controls, while the guest summary list localizes status and limits
the labelled reason, confirmation, and warning cancellation controls to captured
guests.
Organizers can review or export answers only with explicit purpose/correlation
evidence, cancel guests only after destructive confirmation, and apply versioned,
idempotent guest attendance transitions. Single-value multi-choice submissions
are normalized against the authoritative published form schema. Focused
questionnaire/no-mutation and exact-payload, privacy, export, consent, and
confirmation proof passes; the full non-mutating gate is 48/48 suites and
1,631/1,631 tests. Campaigns,
retention, live disposable effects, manual assistive-technology review, and
unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Registration Campaigns and Retention Checkpoint

Organizers can now preview member, email, group, audience, or CSV invitation
campaigns and then issue, schedule, or cancel the immutable audience snapshot
through Laravel's revisioned, idempotent contracts. The organizer page also
exposes the already-backed governed answer review/export and versioned guest
attendance workflows. Retention remains permission-gated and requires a dated
dry run plus explicit destructive confirmation before applying the recorded run.
Focused render, exact-payload, revision, and confirmation proof passes. Live
delivery and disposable retention effects, manual assistive-technology review,
and unchanged ASP.NET runtime proof remain open.

## 2026-07-14 Recurrence Definition Blueprints Checkpoint

Eligible series managers now have Laravel's private definition-only propagation
workflow: permission-scoped agenda, ticket, registration, safety, and staff
sections; bounded immutable history; signed preview; conflict-aware commit; and
explicit confirmation with an idempotency header. The effective occurrence ID
comes from Laravel's event projection and preview tokens remain opaque. Focused
render, permission, exact-payload, and confirmation proof passes. Immutable
history cards now match Blade's labelled summary structure for recorded time,
effective recurrence identity, allowlisted definition sections and positive
bounded counts, and the continuation link uses the labelled block-pagination
pattern. Unknown section/count keys fail closed. A secondary history-service
failure now leaves the authorized manager workflow available and renders
Blade's localized history error instead of taking down the page or showing a
false empty state; authorization and not-found failures still fail closed. Live
future-occurrence effects, wider role fixtures, manual assistive-technology
review, and unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Event Publication Transitions Checkpoint

The event detail now exposes Laravel's submit-for-review or direct-publish
transition only when that exact capability is present in the canonical event
projection and the event is not archived. Both POST routes call Laravel's
publication workflow and preserve its success/conflict outcomes. Focused
capability/render and exact-endpoint proof passes. Live review-policy variants,
moderator handoff, manual assistive-technology review, and unchanged ASP.NET
runtime proof remain open.

## 2026-07-14 Event Template Workflow Checkpoint

Event managers now have Laravel's private template library, immutable audit
history, source-event capture/revision preview, idempotent capture/revision, and
preview-first materialization into a fresh draft. Only allowlisted event
configuration and schedule overrides cross the API boundary; participant,
publication, notification, and federation state are not cloned. Focused list,
history, exact-payload, optimistic-version, and fresh-draft proof passes. The
default-English library, capture, materialization, and immutable-history pages
now mirror Blade's safety guidance, summaries, checklist, capability controls,
error/success states, and opaque cursor preservation; unknown audit field keys
fail closed instead of leaking raw localization keys. Immutable audit entries
now use Blade-style stable localized timestamps rather than relative dates and
insert deterministic eight-character break opportunities in integrity digests.
Live
disposable template/materialization effects, manual assistive-technology review,
and unchanged ASP.NET runtime proof remain open.

## 2026-07-13 Effective Recurrence Revision Checkpoint

The recurring-event editor now sends “this occurrence” changes through the
existing scoped update and sends “this and future” changes through Laravel's
signed preview plus idempotent commit contract. Only the editor's allowlisted
content and local-time fields are committed; the opaque preview token is
required and client-supplied patch JSON is revalidated before forwarding.
Focused preview/render/exact-commit proof passes. Live future-occurrence effects,
conflict variants, manual assistive-technology review, and unchanged ASP.NET
runtime proof remain open.

The five tenant-admin Event moderation routes are now wired to Laravel's real
admin Event APIs, but exact queue membership, submission ordering, and
`is_online` presentation remain API-boundary gaps. Signed offline check-in-code
attendance remains the only undeclared route and still depends on Laravel's
internal credential verification and attendance services. Web UK must not
duplicate those internals or call ASP.NET-specific behavior; Laravel must first
publish the missing tenant-scoped contract.

## Purpose

This audit lists reusable Laravel Blade accessible frontend patterns that should
be ported into `apps/web-uk` while preserving the Express/Nunjucks/GOV.UK
Frontend stack.

Laravel Blade is authoritative for the browser experience, and the Laravel
backend is authoritative for the API and side-effect contract. ASP.NET is not a
source for this audit. Any row that mentions ASP.NET compatibility is recording
a separate future unchanged-frontend switching gate; it is not permission to
inspect, change, or accommodate the incomplete ASP.NET backend during Web UK
implementation, and it is not a Laravel-first component-completion criterion.

The Laravel repository, schema, and ordinary local database are read-only from
this workstream. Runtime mutation evidence must come from a separately
provisioned and verified disposable Laravel application, database, and storage
environment. Authorization, fixture uniqueness, cleanup, or restoration code
never permits writes to the ordinary production-derived Laravel environment.

## Historical Reconciliation Checkpoint (2026-07-13)

The table contains `138` open implementation rows: `136` are **Partial**, `2`
are **Started**, and `0` are **Complete**. These statuses were retained after a
row-level evidence review, not inferred from the route count:

- **Started** means a cross-cutting primitive, redirect slice, or preparation
  mechanism exists, but the corresponding Blade pattern/workflow is not yet
  materially certified end to end.
- **Partial** means the real route or reusable pattern is materially implemented
  and has focused evidence, but at least one explicit source-contract, runtime,
  localization, visual/manual accessibility, mutation, or backend-switching gap
  remains in that row.
- **Complete** requires the scoped Blade pattern and its states/side effects to
  have current Laravel runtime proof with no open boundary. Route declaration
  equality alone never qualifies. No row currently meets that bar.

The two remaining **Started** rows are both generated preparation-fallback
guards for the six Event API-boundary gaps. They are intentionally not promoted
while Laravel exposes no tenant-scoped API v2 contract for those workflows.
The seven redirect/auth rows formerly marked Started have real mounted routes,
focused behavior evidence, and material Laravel integration, so this review
corrects them to Partial without claiming their explicitly listed gaps closed.

The current aggregate evidence includes `48/48` Jest suites and `1,631/1,631`
tests, green lint/brand/CSS gates, `683` of `689` Laravel routes matched (`690`
local declarations, `6` classified API-boundary gaps, `5` documented extras,
and `3` ignored infrastructure routes), structurally complete
`11`-locale/`36`-namespace/`8,837`-key catalogs, a `320`-template conservative
audit with `0` safe exact matches, a full `80/80` Chromium/axe run at checkpoint
`ea1ed6d4` in `1,610.1` seconds (`26.8` minutes) with no skipped, unexpected, or
flaky results, and a live `19/19` Blade marker comparison. All four exhaustive
Laravel runtime quarters reached terminal classification against the former
local database; their schema-related failures are historical after the
production-snapshot restore and the current read-only aggregate remains unrun.
Group conversation detail now also follows Blade's full-width main layout,
wrapping participant identity/tag/action rows, reaction fieldset legend, and
GOV.UK module initialization hooks; focused default-English proof passes `1/1`.
Direct conversation detail now follows the same Blade full-width card and
sender-avatar pattern, places the source search card after the thread, restores
image-preview versus file-download attachment semantics, and limits translation
controls to messages with a body; focused default-English proof passes `2/2`.
2026-07-14 message-media origin follow-up: direct-message sender avatars, voice
audio, image attachments, and file downloads, group-message sender avatars,
and the direct/group conversation-index avatars now resolve Laravel-relative
paths against the configured backend origin rather than Web UK's separate
origin. Focused detail/index rendering proof passes, and the complete non-
mutating gate is green at `52/52` suites and `1,681/1,681` tests with lint,
brand, CSS, and both localization audits passing.
The direct inbox now also uses Blade's full-width conversation cards, sender
labels, filter and pagination structure, disabled/restricted notices, conditional
empty-state action, and query-driven archive/restore success outcome; focused
default-English proof passes `6/6`.
The group index now follows Blade's full-width card list, 48-pixel group avatar
or initial placeholder, distinct disabled/restricted banners, initialized status
and create controls, and updated-time fallback for groups without a last message;
focused default-English/restriction proof passes `2/2`.
Advanced search listing thumbnails and member avatars now also resolve Laravel-
relative paths against the configured backend origin while preserving the
frozen Blade partials' image fields, alternatives, dimensions, and surrounding
card hierarchy. Focused advanced-search proof passes `1/1`; the complete non-
mutating gate remains green at `52/52` suites and `1,681/1,681` tests with lint,
brand, CSS, and both localization audits passing.
Profile settings and the onboarding profile/confirmation steps now resolve the
signed-in member's Laravel-relative avatar path against the configured backend
origin while retaining Blade's existing current-photo presentation. Focused
settings and onboarding proof passes `2/2`; the same complete non-mutating and
static gates remain green.
Volunteer opportunity detail now resolves the nested Laravel organisation-logo
path against the configured backend origin while retaining Blade's logo
alternative, dimensions, and organisation-name fallback. Focused opportunity
proof passes `1/1`; after correcting one misplaced test assertion, the complete
non-mutating gate passes `52/52` suites and `1,681/1,681` tests.
Feed comment author avatars now use the same backend-origin projection at every
nested reply depth while retaining Blade's recursive comment hierarchy and
32-pixel decorative-avatar semantics. Focused recursive-comment proof passes
`1/1`; the complete non-mutating and static gates remain green.
Organisation detail no longer promotes the API-only `excerpt` field into a
lead paragraph when Blade has no description, and review avatars now resolve
Laravel-relative paths against the configured backend origin. Focused
organisation proof passes `24/24`; the complete non-mutating gate passes
`52/52` suites and `1,682/1,682` tests, with lint, brand, CSS, locale, route,
API-ledger, and `19/19` Blade-marker gates green.
Organisation browse now applies the same Blade boundary to directory cards:
whitespace-only names use the source title fallback, API-only `excerpt` is not
promoted into description, whitespace-only websites are absent, and nested
authoritative zero statistics do not fall through to stale nonzero aliases.
The ordinary Organisations directory now applies the same trimmed-name
fallback. Focused directory/browse proof passes `5/5`; the complete non-
mutating gate passes `52/52` suites and `1,686/1,686` tests with the same
static and `19/19` Blade-marker gates green.
Organisation jobs now applies Blade's trimmed-name fallback and emits its
script-safe Organization JSON-LD with optional description, logo, URL, and
email fields. The empty jobs collection is intentional in current Laravel:
the accessible controller does not cross volunteer-organisation identifiers
into the separate job-vacancy organisation model. Focused proof passes `4/4`;
the complete non-mutating gate passes `52/52` suites and `1,687/1,687` tests.
The organisation-context opportunity apply page now trims title/name values
like Blade, applies the source title fallback, and uses only a positive numeric
`organization_id` for its organisation back link. Focused normal and boundary
proof passes `2/2`; the complete non-mutating gate passes `52/52` suites and
`1,688/1,688` tests.
Organisation registration now mirrors Laravel's multibyte length boundaries:
name and description minimums count Unicode characters, and the create payload
truncates names to 255 Unicode characters even for clients bypassing HTML
constraints. Focused validation/payload proof passes `3/3`; the complete non-
mutating gate passes `52/52` suites and `1,689/1,689` tests.
Organisation manage now skips empty-ID rows, trims names before Blade's title
fallback, and requires the authoritative `member_role` for management controls
instead of accepting an API-only role alias. Focused normal/boundary proof
passes `2/2`; the complete non-mutating gate passes `52/52` suites and
`1,690/1,690` tests.
Organisation detail now aligns Blade's trimmed name/description, email
precedence, case-sensitive website scheme, positive opportunity ID, trimmed
title/description limit, and whitespace-only review-comment boundaries.
Focused signed/normal/empty/boundary proof passes `4/4`; the complete non-
mutating gate passes `52/52` suites and `1,691/1,691` tests.
Saved Jobs cards now use Blade's integer ID/count casts, authoritative
organisation/creator and boolean fields, and en-dash salary ranges. Focused
populated/boundary/unsigned/failure proof passes `4/4`; after correcting one
stale hyphenated salary assertion, the complete non-mutating rerun passes
`52/52` suites and `1,692/1,692` tests.
The direct-message inbox now preserves Blade's blank-identity rows during an
active name filter while retaining the localized accessible display fallback;
named non-matches remain excluded. Focused archived/paginated, fallback, and
filtered-identity proof passes `3/3`; the complete non-mutating gate passes
`52/52` suites and `1,693/1,693` tests.
Group-conversation creation now enforces Laravel's `connections` feature gate
before authentication and API access on both its GET form and POST action.
Focused normal and disabled-feature proof passes `2/2`; the complete non-
mutating gate passes `52/52` suites and `1,694/1,694` tests.
Simple Search now mirrors Blade's selected-title trimming and positive numeric
ID boundary: whitespace-only titles do not create empty result cards, a null
title may use the source name fallback, and invalid IDs render text without an
invalid detail link. Focused Search proof passes `5/5`; the complete non-
mutating gate passes `52/52` suites and `1,683/1,683` tests with the same static
and `19/19` Blade-marker gates green.
Advanced Search now applies the corresponding frozen Blade partial boundaries
across listing, member, Event, and Group cards: trimmed presentation values,
null-coalesced alternate fields, positive-only links, and zero-preserving
member counts. Focused advanced-search proof passes `3/3`; the complete non-
mutating gate passes `52/52` suites and `1,684/1,684` tests with the same static
and `19/19` Blade-marker gates green.
This certifies broad historical read/auth/gate/body coverage, not every
mutation, upload, download, destructive side effect, or manual assistive-
technology state. Saved-collection create/update/delete and collection-
item add/remove are separately certified by a `2/2` real Laravel-backed
disposable-fixture smoke in `82.9` seconds; it verified the removed saved-item
row and deleted collection were both absent from Laravel before completion.
Listing create/image-upload/update/delete is separately certified by a `1/1`
real Laravel-backed disposable-fixture smoke in `80.6` seconds, including HTTP
200 retrieval of the uploaded image and final API absence. Its strengthened
320px run also passed detail/edit structure, unique-ID, reflow, and axe checks
in `83.4` seconds.
Marketplace listing create/PNG-upload/edit/delete and seller pickup-slot
create/edit/deactivate/delete are separately certified by a `2/2` real
Laravel-backed disposable-fixture smoke in `119.9` seconds. It verified image
and slot persistence, 320px structure/reflow/axe, destructive deletion, and
final API absence for both fixtures.
Event create/PNG-cover-upload/RSVP-transition/update/delete is separately
certified by a `1/1` real Laravel-backed disposable-fixture smoke in `86.3`
seconds. The run exposed and fixed backend-relative event covers resolving
against Web UK and proved a successful image fetch, rendered visibility,
`going`/`interested`/`not_going` persistence, and final event absence.
Volunteering credential PDF upload/delete is separately certified by a `1/1`
real Laravel-backed disposable-fixture smoke in `44.2` seconds. It exposed and
fixed 320px credentials-table overflow and proved pending-state rendering,
axe/structure/reflow, deletion, and final API absence.

Localization remains open because each non-English catalog has roughly
`4,096-4,199` English-identical keys and `13` wholly English namespaces in the
authoritative read-only Laravel source. ASP.NET switching also remains future
and uncertified. Remaining live upload/destructive rows require disposable fixtures.

## Ported Or Started

2026-07-13 group-message chronology follow-up: Laravel's group-message API
returns the `direction=older` page newest-first, while Blade reverses it before
rendering. Web UK now performs the same reversal before applying its no-JavaScript
search filter, visibly marks every case-insensitive match without trusting the
query as markup, and preserves multiline bodies with escaped line breaks.
Focused chronological/filter/escaping/render proof passes `1/1`.

2026-07-13 group-detail count follow-up: Web UK now preserves Laravel's explicit
`member_count: 0` exactly as Blade does instead of treating zero as absent and
falling back to the fetched roster length. Focused source/render proof passes.

2026-07-13 group-membership fallback follow-up: group routes now recognise
Blade's legacy flat `my_role` / `my_status` contract for active and pending
members, preventing an incorrect Join action and restoring member-only content.
Focused active/pending render proof passes `2/2`.

2026-07-13 group-notification copy follow-up: the preference page and its status
outcomes now use the exact `govuk_alpha_groups` catalog, including Blade's
default-English frequency punctuation, and the failure summary no longer links
to an unrelated radio control. Focused source/render proof passes.

2026-07-13 group-invite authorization follow-up: signed GET access now matches
Blade's owner/admin guard. Ordinary members receive `403` before the pending
invitation API is called, so they cannot render management forms from a swallowed
upstream authorization error. Focused admin/member proof passes.

2026-07-13 group-notification authorization follow-up: signed GET access now
matches Blade's active-member-or-admin guard. Non-members receive `403` before
the preferences API is called instead of seeing default controls after a denied
upstream request. Focused member/non-member proof passes.

2026-07-13 group member-surface authorization follow-up: announcement listing
now requires active membership or administration before loading content, and
the discussion-create form now rejects pending/non-members like Blade. Focused
allowed/denied proof passes without calling content APIs for denied users.

2026-07-13 announcement-edit owner follow-up: the edit GET now uses the signed
profile plus `owner_id` fallback as well as embedded membership, matching Blade's
`canModify` guard while retaining the pre-lookup `403` for other users. Focused
owner/denial/collection proof passes.

2026-07-14 announcement-edit presentation follow-up: the mounted edit page now
uses the exact Blade announcement catalog for its title, back links, labels,
hints, checkbox, expiry field, submit action, and hidden error prefixes. Its
error summary matches Blade's non-linked list while retaining Web UK's focus
target, and title/content failures preserve the field-level error and ARIA
relationships. Focused render/source proof and the complete `52/52`-suite,
`1,679/1,679`-test non-mutating gate pass; locale-key and template-copy audits
report zero unresolved keys and zero conservative matches.

2026-07-14 group-discussion validation follow-up: create and reply validation
now match Blade's one-request `withErrors()` and `withInput()` behavior through
bounded Express-session replay. Empty required fields render linked summaries,
inline errors, replayed values, and exact hint/error ARIA relationships; API
failures retain entered values without inventing field errors. Focused create,
reply, and one-use proof passes, as does the complete `52/52`-suite,
`1,681/1,681`-test non-mutating gate.

2026-07-14 group-discussion timestamp follow-up: discussion and reply dates now
match Blade's machine-readable `<time datetime>` semantics, with the decorative
middle dot hidden from assistive technology. Focused detail/source proof passes,
along with lint and both localization audits. Three complete aggregate attempts
timed out without a verdict under current machine load; the immediately prior
validation baseline remains the latest complete `52/52`, `1,681/1,681` pass.

2026-07-13 group-create layout and validation follow-up: the default-English
page now matches Blade's heading-before-errors hierarchy and full-width form,
including the two-thirds-width location input without an invented prominent
label. The frontend no longer rejects overlength locations with local copy that
Blade does not define; Laravel API validation remains visible and field-linked.
Focused render, create, replay, and API-delegation proof passes.

2026-07-13 group-edit layout and validation follow-up: the default-English edit
page now uses Blade's full-width content and normal location label with a
two-thirds-width input. Overlength location values reach Laravel API validation
instead of an invented frontend message, while the separately tested visible
no-JavaScript deletion confirmation remains intact. Focused update, replay, and
API-delegation proof passes.

2026-07-13 group-edit authorization follow-up: a signed ordinary member now
receives Laravel's `403` response when opening the edit page instead of being
redirected to group detail with invented flash copy. The denied response does
not render edit controls; focused member-denial proof passes.

2026-07-13 group-invite content follow-up: the page now uses Laravel's exact
`govuk_alpha_groups.invite` and status catalogs for its default-English
structure, controls, pending table, and outcomes. Error states match Blade's
non-linked summary body instead of pointing every failure at the email field;
safeguarding-specific copy, the visually hidden table caption, and em-dash
fallbacks are restored. Focused admin/member/status render proof passes.

2026-07-13 group-image content follow-up: fixed copy, upload hints, image alt
text, empty states, and outcomes now use Laravel's exact
`govuk_alpha_groups.image` and status catalogs. Error summaries match Blade's
non-linked body instead of falsely targeting the avatar field for every image
failure. Focused admin/success/failure render proof passes.

2026-07-13 group-announcements content follow-up: list headings, tags, admin
actions, bylines, form labels/hints, empty state, and outcomes now use Laravel's
exact `govuk_alpha_groups.announcements` and status catalogs. Error summaries
match Blade's non-linked list while required-field metadata still drives inline
field styling. Focused admin/member/status render proof passes.

2026-07-13 group-discussion family follow-up: index, create, and detail fixed
copy and outcomes now use Laravel's exact discussion catalogs and contextual
failure heading. Reply counts use Blade's catalog output, reply metadata includes the
source `j F Y, H:i` timestamp, and backend failure statuses no longer invent
field links or inline validation styling. Focused index/create/detail/status
proof passes.

2026-07-13 group-file content follow-up: the list, upload form, actions, and
status outcomes now use Laravel's exact `govuk_alpha_groups.files` catalog.
Error summaries retain Blade's non-linked list while upload failures still apply
the source inline file-field error treatment. Focused render/status proof passes;
the documented read-only Laravel `group_files.updated_at` blocker is unchanged.

2026-07-13 group-management safeguarding follow-up: join-request API failures
now preserve Laravel's policy-unavailable and interaction-restricted outcomes,
the page renders their exact safeguarding catalog copy, and the caption/error
hierarchy matches Blade. The shared locale generator now imports the complete
11-locale `safeguarding.php` namespace instead of allowing raw keys.

2026-07-15 Group index/detail status follow-up: the index now renders only
Blade's bounded `group-deleted` outcome with the exact `groups-status`
relationship. Detail keeps its separate create/update/join/leave and
safeguarding/error families, and now also renders the previously missing
`group-posted`, `group-post-empty`, `group-post-failed`, and
`group-post-forbidden` feed-compose outcomes with Blade's `grp-feed-status` or
error-summary structure. Neither page consumes arbitrary cross-route flash
values. Focused family and safeguarding proof passes `2/2`; the complete
non-mutating inventory is green across a 1,702-assertion host-memory aggregate
plus the separately verified canonical-path tenant-source assertion. Brand,
lint, CSS, and all localization audits pass; static localization resolves 7,625
references and 5,805 unique keys with zero unresolved, and 322 templates have
zero conservative matches. Laravel port 8088 remains unavailable while Web UK
returns 200, so the public marker gate is not rerun. No Laravel authentication,
mutation, database access, upload, download, cleanup, or container operation
was performed.

Component-audit classification: the Groups index/forms/detail row is
implementation-closed, with remaining tag-persistence contract, disposable
feed/lifecycle runtime, tenant-gate, manual assistive-technology, and backend-
switching proof assigned outside the Blade implementation queue.

2026-07-14 direct-message inbox follow-up: active inbox/archive styling,
filter and restore spacing, the 180-character last-message preview, and the
conversation-created timestamp fallback now match Blade's default-English
presentation. Focused inbox proof passes `5/5`; the aggregate remains
`48/48` suites and `1,632/1,632` tests with green lint and localization gates.

2026-07-15 direct-message inbox status follow-up: archived/restored outcomes
now use Blade's exact bounded query states, `messages-status-title` relationship,
success role, and catalog copy. The inbox no longer consumes or renders
arbitrary success flash values from unrelated routes. Focused populated and
unrelated-state proof passes `2/2`; the complete non-mutating inventory is green
across a 1,701-assertion host-memory aggregate plus the separately verified
canonical-path tenant-source assertion. Brand, lint, CSS, and all localization
audits pass; static localization resolves 7,618 references and 5,804 unique
keys with zero unresolved, and 322 templates have zero conservative matches.
The current public marker rerun was unavailable because the read-only Laravel
service at port 8088 was not listening while Web UK returned 200; the immediately
preceding product baseline passed 19/19. No Laravel authentication, mutation,
database access, upload, download, cleanup, or container operation was
performed.

Component-audit classification: the Message conversations row is
implementation-closed, with remaining upstream group-reaction projection,
disposable direct/group runtime, translated-text, manual assistive-technology,
and backend-switching proof assigned outside the Blade implementation queue.

2026-07-14 Marketplace listing-form follow-up: create/edit now uses Blade's
exact default-English commerce catalog and hierarchy, tenant bootstrap currency
default, safe no-JavaScript input replay, and three local validation states.
Edit omits Blade's deliberately create-only `status=active`, preventing sold or
expired listings from being silently reactivated. The extra multipart image
field/parser was removed because current Blade exposes no image control on this
form; earlier image-upload lifecycle evidence remains historical API proof, not
current accessible-form behavior. Focused proof and the full `48/48`,
`1,632/1,632` aggregate pass with green lint, brand, and localization gates.

2026-07-14 accessibility safety correction: the accessibility row below retains
historical successful evidence, but the complete runner includes a real login
and is not an ordinary read-only gate. A current attempt stopped at 28 passed,
one failed, and 58 not run after invalid-login limiter writes; the database was
restored wholesale. Future complete runs require a separately verified
disposable Laravel environment.

2026-07-14 Marketplace seller-profile follow-up: default-English back link,
caption, rating/sales summaries, month-year membership date, listings heading,
and empty state now use Blade's exact commerce catalog and presentation. Sales
remain hidden without ratings, and Laravel's email-verification field no longer
masquerades as Blade's identity-verification badge; the current seller API does
not expose that badge evidence, so the tag fails closed as an upstream contract
gap. Focused seller-state proof passes 2/2; the complete gate passes 49/49
suites and 1,641/1,641 tests with 7,239 locale references, 5,530 unique keys,
zero unresolved keys, and zero conservative matches across 322 templates.

2026-07-14 Marketplace seller-coupon follow-up: list, create, and edit now use
Blade's exact default-English commerce catalog, hierarchy, banners, table
caption, discount/status presentation, form IDs, actions, and destructive
warning. The route family fails closed before Laravel calls when
`merchant_coupons` is disabled. Title and positive non-BOGO discount validation,
zero minimum-order handling, and one-use create/edit replay now match Blade,
including Laravel `422` messages. Focused proof passes 6/6; the full gate passes
49/49 suites and 1,643/1,643 tests, with 7,280 static references, 5,565 unique
keys, zero unresolved or conservative template matches, and a current 19/19
Blade marker comparison. No live mutation or database access ran.

2026-07-14 Marketplace merchant-onboarding follow-up: Web UK now calls
Laravel's canonical `/api/v2/merchant-onboarding` family rather than the
incorrect marketplace-prefixed path. The action follows Blade's `step-1`,
optional `step-2`, and `complete` sequence, preserving business registration
and address data. Default-English hierarchy, copy, field IDs, banners,
validation order, and one-use bounded failure replay now match Blade. Focused
proof is green; the full gate passes 49/49 suites and 1,645/1,645 tests, with
7,304 static references, 5,586 unique keys, zero unresolved or conservative
template matches across 322 templates, and a current 19/19 Blade marker
comparison. The consumer ledger records 589 contracts: 371 OpenAPI matches,
201 unmatched, 17 dynamic, and 283 state-changing. Verification used mocks and
read-only public GET comparisons; no live mutation or database access ran.

2026-07-14 Marketplace listing-report follow-up: the report page now uses
Blade's exact default-English commerce catalog, hierarchy, reason labels and
IDs, warning action, cancel link, and field-linked error presentation. Required
reason and description failures remain distinct, bounded input replays once,
Laravel `422` text stays linked to the description, and unexpected failures
return to listing detail with Blade's `report-failed` outcome. Focused proof
passes 3/3; the full gate passes 49/49 suites and 1,646/1,646 tests, with 7,315
static references, 5,594 unique keys, zero unresolved or conservative template
matches, and a current 19/19 Blade marker comparison. The ledger records 590
contracts: 371 OpenAPI matches, 202 unmatched, 17 dynamic, and 284
state-changing. No live report or database access ran.

2026-07-14 Marketplace saved-items follow-up: Web UK now uses Blade's exact
default-English saved caption, title, description, empty state, remove action,
and notice-banner structure. Only Blade's `unsaved` outcome is rendered on this
page; unrelated marketplace status tokens are ignored. The authenticated
Laravel saved-list read and `redirect_to=saved` unsave contract are unchanged.
Focused populated/empty/status proof passes 2/2; the full gate passes 49/49
suites and 1,647/1,647 tests, with 7,328 static references, 5,607 unique keys,
zero unresolved or conservative template matches across 322 templates, and no
Laravel mutation or database access.

2026-07-14 Marketplace free-items follow-up: Web UK now uses Blade's exact
default-English free-items caption, title, description, and empty state. It
also mirrors Blade's `free` active key with no corresponding tab, rather than
incorrectly selecting Browse. The canonical authenticated Laravel free-list
read is unchanged. Focused populated/empty/navigation proof passes 2/2; the
full gate passes 49/49 suites and 1,648/1,648 tests, with 7,332 static
references, 5,611 unique keys, zero unresolved or conservative template
matches across 322 templates, and no Laravel mutation or database access.

2026-07-14 Marketplace category follow-up: category browse now resolves the
Laravel category and sends its numeric `category_id` plus optional search to
the marketplace index. The former unsupported `category={slug}` query could
return unfiltered results; unknown slugs now fail before listing collection
access. Back link, caption, plural count, search controls, and empty hierarchy
use Blade's exact default-English catalog. Focused filtered/fail-closed proof
passes 2/2; the full gate passes 49/49 suites and 1,649/1,649 tests, with 7,339
static references, 5,618 unique keys, zero unresolved or conservative template
matches across 322 templates, and no Laravel mutation or database access.

2026-07-14 Marketplace browse-card follow-up: index, advanced-search, and
shared collection cards now follow Blade's card-specific pricing rule. Hybrid
listings show only time credits with the blue tag on cards, while detail and
checkout retain the intentional cash-or-credit wording and purple tag. The
index category list uses Blade's exact class set, and the controller still
resolves query-status tokens without rendering the generic banner absent from
Blade. Card media now prefers `image.thumbnail_url` over the full image URL as
the Blade index and shared partial do, without changing the detail gallery.
Focused browse/hybrid plus status-localization proof passes 66/66, and broader
marketplace proof passes 43/43; the
full gate passes 49/49 suites and 1,649/1,649 tests, with 7,337 static
references, 5,618 unique keys, zero unresolved or conservative template
matches across 322 templates, unchanged 688/689 route coverage and 590-contract
ledger, and no Laravel request, mutation, database access, upload, or download.

2026-07-15 Listings index status follow-up: the index now renders only Blade's
bounded `listing-deleted` success banner, with the exact
`listing-deleted-title` label relationship and catalog-backed deletion copy.
Invented create/update success states, exchange/delete error states, and flash
fallbacks no longer leak onto the browse page; unrelated status tokens render
no banner. Focused proof passes, and the complete 1,699-assertion Jest inventory
is green across a 1,698-assertion host-memory aggregate plus the separately
verified canonical-path tenant-source assertion. Brand, lint, CSS, all three
localization audits, and the 19/19 Laravel/Web UK visual-marker gate pass. The
static localization audit resolves 7,606 references and 5,799 unique keys with
zero unresolved keys; 322 templates have zero conservative matches. No Laravel
mutation, database access, upload, download, or cleanup was performed.

2026-07-15 Listing detail status follow-up: created/updated/delete-failed,
saved/unsaved/renewed, save/unsave/renew failures, and exchange-disabled/own-
listing now use Blade's exact separate banner, error-summary, title-ID, role,
and catalog-copy boundaries. Hard-coded success flashes no longer override the
source wording or survive into a later request. Report outcome query tokens are
intentionally silent because current `listing-detail.blade.php` does not render
them, while secondary tag/image persistence failures remain honestly exposed
after a successful core save. Focused status and partial-failure proof passes;
the complete non-mutating inventory is green across a 1,699-assertion host-
memory aggregate plus the separately verified canonical-path tenant-source
assertion. Brand, lint, CSS, and all localization audits pass. Static
localization resolves 7,617 references and 5,804 unique keys with zero
unresolved; 322 templates have zero conservative matches. No Laravel request,
authentication, mutation, database access, upload, download, or cleanup was
performed.

Component-audit classification: the Listing index/detail/form row is
implementation-closed and certification-only. Its remaining named work is the
generic-listing side-effect matrix in disposable-runtime package 4, manual
assistive-technology evidence in package 11, and later unchanged-Web-UK
ASP.NET switching proof; none is an unresolved Blade implementation row.

| Blade pattern | Laravel source | Web UK implementation | Status |
| --- | --- | --- | --- |
| Event moderation queue and decisions | `views/event-moderation-queue.blade.php`, `views/event-moderation-decision.blade.php`, `EventModerationParity`, `Api\AdminEventsController` | `src/routes/events.js`, `src/views/events/moderation-queue.njk`, `src/views/events/moderation-decision.njk`, `src/lib/api.js` | Partial. Signed tenant administrators can open the default-English queue and separate approve/reject confirmation pages through Laravel's current admin Event list/detail contracts. Queue status, count, cards, pagination, decision summaries, warnings, field-linked validation, mounted redirects, and private/no-store headers follow Blade. Approval requires explicit confirmation; rejection requires confirmation plus a bounded reason and submits only that reason to Laravel's canonical reject action. Non-admin or missing-event API responses fail closed. Focused mocked queue/validation/action and direct API-client proof pass; the full non-mutating gate is 48/48 suites and 1,635/1,635 tests, and the generated route matrix is 688/689. This is not contract-identical certification: Laravel's admin list does not join the moderation queue, orders by Event creation rather than queue submission, and omits Blade's `is_online`. Live moderation side effects, manual assistive-technology review, and unchanged ASP.NET runtime proof remain uncertified. |
| Custom dark header | `accessible-frontend/views/layout.blade.php` | `src/views/layouts/base.njk`, `src/lib/accessible-shell.js` | Partial. Text brand, language selector, My account link, and tenant-only service navigation are present. The no-JS language selector mirrors Blade's `request()->except(['locale'])` behavior for scalar query params, preserving filters/status/return values while excluding `locale`. My account now exposes `aria-current` across Blade's complete account-family active-nav set, and active Sign in/Register items use the source strong fallback. Tenant bootstrap `logo_dark_url`/`logo_url` and validated wide/landscape/square shape metadata now render Laravel's aspect-ratio-aware image brand, while untrusted external origins are rejected and CSP permits only the configured backend origin. Focused source/render tests passed, and a real default-English `timebanking-org` browser check loaded the `392x105` logo at `179x48`, with exact tenant alt text and no horizontal overflow. Web UK's mandatory non-government header disclosure remains an intentional branding-policy divergence from Blade. Validated per-tenant header colours remain blocked because Laravel's public bootstrap response does not expose `header_bg_color` or `header_accent_color`; full manual visual/assistive-technology proof also remains open. |
| Localization runtime, catalogs, formatting, and RTL | Laravel `lang/{locale}/{govuk_alpha*,event_*,safeguarding}.php`, user preferred-language profile, and Blade document direction | `src/lib/localization`, `src/middleware/localization.js`, `src/lib/request-locale-context.js`, `src/lib/request-profile.js`, `src/lib/request-intl-locale.js`, `src/lib/api.js`, `src/views`, `src/assets/scss/main.scss` | Partial. The generated catalogs cover 11 locales, 36 namespaces, and 8,837 keys per locale with zero structural drift. Every Laravel `event_*.php` catalog and `safeguarding.php` are imported alongside `govuk_alpha*.php`, and namespace resolution follows the generated catalog rather than a fixed allowlist. Query/session/request-profile/signed-token-profile/weighted-header selection, request-scoped propagation, shared profile reads, locale-aware formatting, tenant-scoped profile choices, `Content-Language`, document `lang`/`dir`, and Arabic RTL are wired. The conservative audit reports zero remaining safe exact matches across 315 templates. A separate source-wide static-key gate resolves 6,854 complete `t()`/`tc()` references (5,230 unique keys) with zero unresolved. Progressive validation reads localized summary titles, screen-reader prefixes, field labels, and field-level overrides; Arabic login, Contact, report-problem, and Profile-settings account errors are browser-certified rather than emitting mixed English/Arabic errors. Profile type, privacy, language, digest, match-frequency, and auto-translation option labels on Profile settings now resolve from the request-locale Laravel catalog instead of English JavaScript constants. The tenant chooser, tenant Home, authenticated dashboard, account hub, own-profile summary, profile-settings form, activity pages, notifications and messages inboxes, connections pages, wallet overview/management, saved items/collections/appreciation, member directory/discovery/nearby/profile/insights family, matches index/board, complete poll listing/detail/rank/create/manage family, Goals index/detail/edit/check-in/reminder/buddy-support, group exchanges, Reviews summary/list, Knowledge Base index/detail, Help Centre/Trust and Safety, About/Guide/Features/FAQ, Legal/accessibility/Contact/report-problem/cookies/email-utilities, AI assistant, achievements family, leaderboard/NEXUS-score family, and Resources browse/library/upload/delete/discussion family use Laravel-catalog copy and plural/number/date formatting, with representative RTL proof. This is not complete translation coverage: each non-English authoritative Laravel catalog still has 4,096-4,199 English-identical values, 13 namespaces remain wholly English in the read-only source, and contextual titles, status messages, dynamic/ARIA labels, plural forms, backend-generated activity descriptions, residual templates, broader RTL states, and manual review remain open. Current aggregate unit/integration proof is 47/47 Jest suites and 1,603/1,603 tests with green brand/lint/CSS gates. The latest uninterrupted full browser pass is checkpoint ea1ed6d4 at 80/80 in 1,610.1 seconds with no skipped, unexpected, or flaky results. Profile-settings notification groups and all 16 labels now follow the five exact request-localized Laravel catalog groups rather than three invented English groups. |
| Document semantics and browser accessibility gate | `accessible-frontend/views/layout.blade.php`, representative public Blade pages | `src/views/layouts/base.njk`, `public/js/validation.js`, `src/assets/scss/main.scss`, `playwright.accessibility.config.js`, `scripts/accessibility-local-server.js`, `tests/accessibility/public-pages.spec.js` | Partial. The shared layout renders exactly one parent GOV.UK `main` landmark and one `main-content` ID. `npm run test:accessibility` starts the current checkout on an OS-assigned port and runs Chromium plus axe against shared-mount pages, asserting successful responses, one main/h1, unique IDs, horizontal reflow, and no serious/critical axe violations. The fresh 2026-07-12 current-checkout gate passed 87/87 in 1,344.8 seconds with no skipped or failed cases. It covers public/authenticated pages, representative Arabic RTL, the signed localized dashboard/account/own-profile/profile-settings/activity/reviews/notifications/messages/connections/wallet/saved-items-and-collections/member-directory-profile-and-insights/knowledge-base/help/trust-and-safety/about/guide/features/FAQ/legal/accessibility/contact/report-problem/cookies/email-utilities/achievements/leaderboard/NEXUS-score pages, the no-tenant chooser, native Tab/Enter order through cookie controls and the skip link, main/error-summary/error-link focus, localized error announcements, forced colours, and 320 CSS pixel reflow. A separate visible current-source browser inspection confirmed the default-English login form's focused email input has a solid 3px focus outline and its `login-failed` error-summary link moves focus to `#email`; the browser-control surface could not reliably drive native Tab traversal, so this is limited visual/focus evidence rather than a manual keyboard or assistive-technology certification. The first automated aggregate attempt reached 61 passes before the existing Arabic password-mismatch case exhausted its 120-second budget at context cleanup; raising only that authenticated case to the established 180-second latency ceiling produced a focused 1/1 pass in 33.6s and the subsequent uninterrupted 87/87 aggregate without relaxing any assertion. Profile settings uses Blade's settings-link list and fieldset/legend semantics; profile photo, account, language, personalisation, skill, passkey, location, and password controls use Laravel's exact IDs/names/hints/limits/autocomplete, while account errors link localized summaries to styled inline field errors with correct ARIA descriptions. Skills render offering/requesting tags and endorsement counts; passkeys render localized type, added, and last-used metadata plus rename, add guidance, and irreversible-removal details; sessions render localized device labels and source-shaped metadata fallbacks. The tenant chooser omits tenant-only service/footer navigation and report-problem utilities while retaining one main/H1, reflow, and axe integrity. The live Blade marker comparison also passed 19/19. Authenticated mutation/error breadth, uploads, destructive actions, Firefox, WebKit, full manual keyboard review, and actual screen-reader/assistive-technology evidence remain uncertified. |
| Header visual layer | `accessible-frontend/src/app.scss` | `src/assets/scss/main.scss` | Partial. Dark header, accent strip, language form, nav badge, card list, link-button patterns, and Blade's tenant-logo sizing rules are present. The shared visual layer now uses GOV.UK Frontend's direct `black tint-95` and primary teal replacements instead of deprecated `light-grey`/`turquoise`, and CSS compilation is warning-free. The live default-English branded-tenant browser check proved the wide logo at its 48px maximum height without overflow. Per-tenant colour variables and recorded manual visual/assistive-technology comparison remain open. |
| Service navigation | `AlphaController::alphaNavItems()` | `src/lib/accessible-shell.js` | Partial. Header labels mirror Blade IA. The shared shell gates Dashboard, Feed, Listings, Members, Events, and Volunteering against tenant bootstrap `modules`/`features`, matching Laravel's `TenantContext::hasModule()` and `hasFeature()` service-nav semantics. The landmark is now suppressed without a routed tenant and retained on tenant-mounted pages; active guest links use Blade's fallback markup. Focused rendered and live tenant Home/Profile-settings checks pass. Page-level disabled-state redirects/errors still need module-by-module certification. |
| Footer columns | `AlphaController::alphaFooterColumns()` | `src/lib/accessible-shell.js` and `partials/footer.njk` | Partial. Platform, Support, and Legal columns mirror Blade labels and local path equivalents. The Platform column filters Listings, Members, Events, Volunteering, and Blog by tenant bootstrap module/feature flags, and drops when no platform links are enabled. Like the source controller, shell locals now return no columns when no tenant slug is resolved; mounted pages retain localized columns. Focused 638/638 render proof and a real tenant-chooser axe/reflow case passed. Full manual visual/assistive-technology review and every feature combination remain open. |
| Footer meta | `layout.blade.php` | `partials/footer.njk` | Partial. Report problem, Cookies, POST sign-out, AGPL attribution, and source link are present. The visually-hidden meta heading uses Laravel Blade's `Supporting information and attribution` wording. Tenant-only utilities and sign-out now require a routed tenant exactly like Blade, while universal attribution remains on the chooser. Focused localized partial and live chooser proof passed. Full manual visual/assistive-technology review remains open. |
| Generated prep fallback guard | Laravel accessible route matrix | `src/routes/laravel-prep-pages.js` | Partial. The loader registers generated preparation pages only for matrix rows explicitly marked `missing`, limited to GET rows with a declared Laravel handler. The current matrix matches `688/689` Laravel routes and therefore leaves the runtime loader with zero generated GET preparation pages; every matched GET route is served by a real route module rather than a generic skeleton handler. The single missing declaration is the upstream Event offline check-in-code POST boundary, not a renderable preparation page. Web UK has five documented extras: four legacy `404` tombstones and the authenticated `/volunteering/credentials/{id}/download` binary proxy required to deliver Laravel-hosted credentials without exposing bearer tokens. Future prep pages remain route-discoverability evidence only and do not certify Blade visual/workflow parity. |
| Shared pagination | Laravel Blade paginators and GOV.UK pagination pattern | Route-specific pagination blocks | Implementation-closed; certification-only. The unused generic Nunjucks pagination partial had zero runtime callers and has been removed; a source guard prevents it being restored as uncertified dead code. Route-specific cursor blocks for Feed, Groups, Wallet history, exchanges, group-conversation history, volunteering my-organisations, and jobs browse/saved/applications/mine use their exact Blade catalog landmarks, tenant-aware links, and continuation labels. Feed renders the source `Feed pages` landmark, `Load more` title, `More feed items` continuation label, and next icon around its opaque cursor URL. Groups renders the source `Group pages` landmark, top margin, `Next` title, and icon while retaining the canonical v2 API's opaque continuation cursor. Wallet history uses Blade's non-block pagination layout, `Transaction history` landmark, `Next` title, anchor, and directional icon around the canonical v2 cursor; Exchanges also restores the source next icon. Blog and Knowledge Base now reproduce Blade's next-arrow pagination cue, with Blog also restoring the source `category · date · reading time` metadata sequence and removing the non-Blade author byline from index cards. Federation connections restores both previous and next cues; Events, direct-conversation history, Volunteering browse, and Volunteering applications restore their source directional cues. A frozen-source audit now covers all 34 active Blade/Web UK pagination pairs and finds identical counts for pagination landmarks, block variants, previous/next containers, directional icons, `rel` semantics, and explicit navigation roles. The Event Template library additionally preserves normalized numeric/opaque continuation cursors. Focused rendered proof is green; the current complete non-mutating gate passes 52/52 suites and 1,709/1,709 tests with green lint, brand, CSS, locale, template, documentation, and diff gates. No default-English implementation gap remains in this row. Screenshot comparison and manual assistive-technology certification belong to package 11; disposable runtime and backend-switching proof remain separately owned. |
| Shared empty states and back links | Laravel Blade empty-state and navigation patterns | Route-specific empty states/back links | Implementation-closed; certification-only. Events, Listings, Groups, and type-filtered Search render their exact default-English Blade empty-result content and action rules; the Search page renders one result inset instead of duplicate empty cards. Event and Group detail/edit, Listing create/edit/detail, and both Conversation implementations use Blade's single GOV.UK back link and exact catalog label instead of invented multi-item breadcrumbs. Listings, Messages, and Notifications indexes omit local breadcrumb navigation like Blade. The zero-caller generic breadcrumb/loading/empty-state partials, unmounted legacy knowledge-base router/templates, and unmounted `groups/my.njk` were removed; no active view imports `govukBreadcrumbs` or a generic empty-state partial. The final literal back-link regression on Blocked Members now uses Blade's request-locale `blocked_users.back` key; focused populated/status/Irish-empty proof is green. A complete active-view scan finds zero literal back-link labels and zero back-link destinations bypassing `urlFor`; the 322-template localization audit has zero conservative matches. Existing route-specific populated/empty regressions, tenant-prefixed members no-results coverage, full Web UK Jest, lint, route matrix, scoped Laravel route smokes, the legacy Group 404 gate, and the signed Search empty-state structure/reflow/axe gate passed. No default-English implementation gap remains in this row. Screenshot comparison and manual assistive-technology certification belong to package 11; disposable runtime and backend-switching proof remain separately owned. |
| AI chat redirects | Laravel accessible AI assistant routes | `src/routes/ai-chat.js` | Partial. Auth-required, empty-message, and post-send redirects now go through a `res.locals.urlFor` helper instead of raw root-relative redirect calls. The unmounted legacy `src/routes/chat.js` router was removed, so source audits only inspect the mounted Laravel-compatible chat route. Focused source regression, shared-mount empty-message POST redirect coverage, focused AI chat render/redirect tests, full Web UK Jest, lint, route matrix, and scoped live Laravel `/chat` smoke passed. Full AI assistant workflow persistence depth, provider-failure equivalence, visual/manual parity, and ASP.NET backend compatibility are not certified. |
| Matches redirects and visible page family | `views/matches.blade.php`, `views/connections-matches-board.blade.php`, Laravel accessible matches routes | `src/routes/matches.js`, `src/views/matches/*.njk` | Partial. Match and board redirects use `res.locals.urlFor`, with focused shared-mount coverage. Both signed pages render Laravel-backed source filters, statistics, cards, score semantics, reasons, module links, empty states, and listing-dismiss controls from the exact request-locale catalogs. The compact index no longer renders an extra description absent from Blade; the richer board applies Blade's 160-character description preview and locale-aware relative matched time; and non-auth API failures use localized service-unavailable copy instead of hard-coded English. Focused localization/index/board/failure proof passes under `--detectOpenHandles`. The exposed dismiss API cannot dismiss event or volunteering recommendations, so that action surface remains incomplete even though supported listing behavior is covered. Full recommendation persistence, broader runtime and role variants, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Auth redirects, rotating sessions, and registration | Laravel accessible auth routes, `views/register.blade.php`, `RegistrationService`, and `/api/v2/auth/*` | `src/routes/auth.js`, `src/middleware/auth.js`, `src/server.js`, `src/lib/api.js`, `src/views/register.njk` | Partial. Login, two-factor, register, logout, forgot-password, and reset-password redirects go through `res.locals.urlFor`. Login, two-factor completion, and refresh require Laravel's complete rotating access/refresh pair plus `expires_in` and `refresh_expires_in`; signed cookies use those server-declared lifetimes. Global pre-route handling rotates missing or near-expiry JWT access for optional-auth and protected pages, preserves mounted tenant authority, and hashes tenant-scoped in-process single-use refresh lock keys. Retry-on-401 handling now uses that same rotation primitive, so parallel route retries share one spend of Laravel's single-use refresh credential; focused concurrent proof passes `8/8`. Transient refresh failures preserve the browser refresh credential while suppressing expired access for the current request; authoritative failures clear the pair. Logout submits the refresh token even when access has expired so Laravel can revoke the family, clears the complete local cookie set, and redirects to Blade's mounted `signed-out` success state; focused mounted redirect/banner proof passes `69/69`. Registration reads tenant policy from `GET /api/v2/auth/registration-info`, fails closed, renders closed/invite-only states, and submits the full Blade-style payload to `POST /api/v2/auth/register` with mounted `X-Tenant-Slug` authority. Flat community codes are resolved through fail-closed tenant bootstrap, Turnstile and automatic login remain removed, success redirects to `/login?status=register-created`, safe inputs but never passwords survive error redirects, and current Laravel registration errors receive accessible status/field mapping. No live login, refresh, logout, or registration ran because those operations can write the protected production-derived Laravel snapshot. Disposable auth/email delivery, proxy-rate-limit identity, manual assistive-technology/visual review, and ASP.NET backend compatibility remain uncertified. |
| Member onboarding redirects | Laravel accessible member onboarding routes | `src/routes/onboarding-posts.js` | Partial. Auth-required, step, avatar, validation, safeguarding, completion, and dashboard handoff redirects now go through a `res.locals.urlFor` helper instead of raw root-relative redirect calls. Profile text updates now use `PUT /api/v2/users/me` and avatar uploads use Laravel's registered `POST /api/v2/users/me/avatar` method, with exact helper and no-JS multipart route tests. The six-step wizard now uses Blade's request-locale onboarding/help catalog for the community/progress caption, Profile, Skills, Safeguarding, select/help, and complete-summary copy, including localized selected counts and the 120-character bio preview; focused default-English six-step render proof passes `1/1`. Scoped Laravel completed-user redirect smoke also passed. Persistence edge cases, live upload certification, broader runtime/manual accessibility depth, and ASP.NET backend compatibility are not certified. |
| Server-level redirects | Laravel accessible shell/account/cookie/organisation routes | `src/server.js` | Partial. Deterministic cookie, account, and organisation redirects now go through a `res.locals.urlFor` helper instead of raw root-relative redirect calls. Focused source regression, shared-mount cookie and organisation redirect coverage, full Web UK Jest, lint, route matrix, and a scoped live Laravel cookie/organisation smoke passed. User-provided safe return URLs, every redirect family, full organisation workflow persistence, localization, visual parity, and ASP.NET backend compatibility are not certified. |
| Contact/support redirects | Laravel accessible contact and report-a-problem routes | `src/routes/contact-support.js` | Partial. Contact validation/result redirects, signed-out report-a-problem handoff to contact prefill, unsigned report POST redirects, and report validation/sent/failed redirects now go through a `res.locals.urlFor` helper instead of raw root-relative redirect calls. Focused source regression, shared-mount contact/report redirect coverage, and repeatable `npm run visual:blade` public contact/report-a-problem checks passed. Full support-report persistence, Laravel rate-limit/error variants, localization, full visual parity, and ASP.NET backend compatibility are not certified. |
| Notifications redirects | Laravel accessible notifications routes | `src/routes/notifications.js` | Partial. Grouped-read, read-all, delete-all, single-read, single-delete, API-error, and validated return redirects now go through a `res.locals.urlFor` helper instead of raw root-relative redirect calls. Single-read now calls `POST /api/v2/notifications/{id}/read` and single-delete calls `DELETE /api/v2/notifications/{id}`; exact API-helper tests and both no-JS POST-alias route tests pass. Focused source regression and existing notification alias behavior coverage passed. Realtime delivery, unread-count depth, localization, visual parity, live mutation certification, and ASP.NET backend compatibility are not certified. |
| Tenant home page | `views/home.blade.php`, `AlphaController::home()` | `src/server.js`, `src/views/home.njk`, `src/lib/api.js`, `src/assets/scss/main.scss` | Partial. Tenant-root contexts render the Blade-style `Accessible` home page with community caption, tenant tagline, guest/signed CTAs, beta/accessibility panel, tenant-scoped stat grid from Laravel `/api/v2/platform/stats`, module availability rows from tenant bootstrap modules/features, and service details. Shared mount `/{tenantSlug}/accessible` passes `X-Tenant-Slug`; dedicated custom-domain root `/` passes the resolved Host and Origin and preserves slugless links. Master and cluster custom-domain roots can render Laravel SEO h1/intro text plus `tenant_switcher` communities as a network landing, converting same-host community URLs to relative paths and preserving external domains. Except for the deliberately withheld `home.supporting_text` keyboard/screen-reader assurance recorded in the 2026-07-15 safety deviation above, standard tenant Home caption/default description, guest/profile actions, impact labels, module titles/descriptions, modules heading/intro, summary labels, and account state use exact request-locale Laravel keys; stats use request-locale, zero-decimal Laravel-equivalent formatting. Signed Messages requires `direct_messaging`, Exchanges requires listings plus `exchange_workflow`, and omitted listings defaults disabled like Blade. Tenant-uploaded header logos now follow bootstrap dark/regular variant and shape metadata; a live default-English branded tenant passed. Focused standard/Arabic/signed-disabled Home passed 3/3. A live default-English `timebanking-org` gate proves Home `200`; disabled Marketplace, Courses, Podcasts, Premium, Coupons, and event-map routes return `403`; and enabled Resources, Groups, and Jobs retain the tenant-mounted auth handoff. Remaining gaps: accessibility-copy source reconciliation, tenant colour depth, Web UK-only network-landing localization, full visual/manual Blade parity depth, a current aggregate browser pass under normal Laravel latency, and ASP.NET backend compatibility are not certified. |
| Cookie banner and settings | `partials/cookie-banner.blade.php`, `views/cookie-settings.blade.php`, `CookieSupportParity::storeCookieConsent()` | `partials/cookie-banner.njk`, `src/views/cookie-settings.njk`, `/cookie-consent` | Partial. The banner appears before the skip link until `nexus_accessible_cookie_consent` is set, while legacy Laravel `nexus_alpha_cookie_consent` values are accepted as a read-only fallback; `/cookies` renders the analytics form; POST stores local `all` or `essential` values. Banner/settings copy, including the formerly hard-coded caption, uses exact request-locale Laravel keys; actions/links are tenant-safe. Existing runtime smoke certifies no-JS reject/accept/settings redirects and cookie values, focused utility coverage passed, and a real Arabic cookie/email-utility RTL/reflow/axe journey passed in 11.7 seconds within the 62/62 matrix. Laravel `cookie_consents` audit persistence, tenant-scoped backend audit behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| About, guide, features, and FAQ pages | `views/about.blade.php`, `views/guide.blade.php`, `views/features.blade.php`, `views/faq.blade.php`, `AlphaController::about()`, `guide()`, `features()`, `faq()` | `src/routes/public-info.js`, `src/views/public-info/about.njk`, `guide.njk`, `features.njk`, `faq.njk` | Partial. `/about` renders the Blade-style intro, four steps, values, live impact statistics, contributor credits, open-source links, and CTA group; `/guide` renders equal-time principles, three steps, getting-started copy, and Laravel-gated CTAs; `/features` renders the six-item list and guide CTA; `/faq` renders the five-question GOV.UK accordion. Titles, captions, descriptions, steps, values, stat labels, features, FAQ pairs, and CTA labels use Laravel's exact request-locale catalog. About calls Laravel `/api/v2/platform/stats` with shared-mount tenant or custom-domain host authority, formats all four values for the request locale with Laravel-equivalent zero-decimal rounding, and hides the optional band on failure or an empty payload. Guide remains public; guests retain Create account, while Browse listings and signed Go to wallet independently follow the routed tenant's listings/wallet modules. Focused About coverage passed 3/3, focused Guide coverage proves guest, both-disabled, listings-only, and wallet-only variants, and focused custom-domain coverage proves host-resolved community copy, slugless local links, Guide actions, and About stats authority across all four pages. The real Laravel-backed Arabic four-page RTL/reflow/axe journey proves both the live stats band and enabled Browse listings action at 320 CSS pixels. The 1,414/1,414 Jest gate is green. The latest uninterrupted 62/62 browser pass is checkpoint `e155375c`; current-source aggregate retries are blocked by severe Laravel auth/dashboard latency and are not claimed green. A live disabled-module tenant fixture, a live custom-domain browser fixture, a current aggregate browser pass under normal latency, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Explore gateway | `views/explore.blade.php`, `Api\ExploreController::index()` | `src/routes/explore.js`, `src/views/explore.njk`, `src/lib/accessible-shell.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests render the Blade card list plus listing/event sections when present. The shared Explore card list follows the Blade candidate gates for AI assistant, Polls, Groups, Goals, Organisations through Volunteering, Blog, Resources, Marketplace, Jobs, Courses, Podcasts, Coupons, Premium, Ideation, and Federation; Search remains card-visible like Blade even when the search feature flag is false; Skills remains ungated; Exchanges require the listings module plus exchange workflow config; and Clubs use Laravel-backed active-club evidence from the clubs API probe rather than a static flag. Page title/caption/description, every card title/description, listing type, live-section headings, and view-all actions use the exact request-locale Laravel catalogs; event dates use the shared locale formatter. Listing/event links, view-all links, and auth-required redirects use tenant-safe URL helpers. Live content matches Laravel's accessible controller source boundaries: five recent listings from `/api/v2/listings` and five upcoming events from `/api/v2/events`, each skipped when its tenant module/feature is disabled and independently reduced to an empty section on non-auth API failure; a 401 still performs the mounted login handoff. Focused default-English localization, standard/Arabic render, candidate-gate, disabled-section, custom-domain, source, and scoped Laravel runtime-smoke coverage are green, and the current full Jest baseline is `45/45` suites and `1,501/1,501` tests. Live disabled-tenant broker-workflow proof, visual/manual parity, broader runtime behavior, and ASP.NET backend compatibility remain uncertified. |
| AI chat | AI assistant accessible route and chat workflow | `src/routes/ai-chat.js`, `src/views/ai-chat/index.njk`, `src/lib/api.js` | Partial. Signed `/chat` preserves conversation query state and follows Laravel's tenant `ai_chat` feature gate. The title/caption/description, AI warning, validation/API-failure states, conversation headings and empty state, speaker labels, field label/hint, action, fallback thread title, and document title now use the exact request-locale Laravel AI-chat catalog; the Web UK-only sent banner was removed because Blade does not render it. The chat back link, new-conversation link, conversation links, and chat form action route through `urlFor()`, so shared tenant mounts and custom-domain roots do not leak flat targets. Focused English/Arabic route tests passed 2/2, and a real authenticated Arabic Laravel-backed journey passed exact markers, RTL, 320px reflow, and axe in 34.7 seconds. Full Jest is 1,418/1,418 with green lint, template audit, and route matrix. Conversation persistence/provider-failure equivalence, exact visual/manual parity, a fresh full current-source browser aggregate, and ASP.NET backend compatibility remain uncertified. |
| Matches | Matches accessible routes and board workflow | `src/routes/matches.js`, `src/views/matches/index.njk`, `src/views/matches/board.njk`, `src/lib/api.js` | Partial. Signed `/matches` and `/matches/board` render Laravel-backed matches candidates with filters, listing/event/group targets, board navigation, dismiss forms, empty states, and back links. Standard matches now use Laravel's request-locale `matches` and `polish_listings` catalogs for title/caption/description, board link, summary/filter labels, source/module/type labels, member fallback, by/score/reason text, dismiss hint/action/screen-reader text, and status banner. The richer board uses `govuk_alpha_connections` for document/page title, caption/description, stats, counted source tabs, module/type/member metadata, score/progress ARIA, reasons overflow, dismiss warning/reasons/action/screen-reader text, empty states, back link, and outcomes. All local links/forms/redirects remain mount-safe through `urlFor()`/`res.locals.urlFor`. Focused English/Arabic render coverage passed 3/3; a real authenticated Arabic Laravel-backed index/board journey rendered live recommendations and passed exact catalog headings/descriptions, non-empty captions, RTL, 320px reflow, and axe on both pages in 57.8 seconds. Full Jest is 1,420/1,420 with green lint/template audit and a 608/608 route matrix. The authoritative `govuk_alpha_connections` namespace remains wholly English-identical outside English, so the Arabic board correctly exposes that Laravel source limitation rather than fabricated translations. Web UK-only location/paused/load-error guidance remains English because Laravel exposes no matching keys. The contract is still incomplete: Laravel's exposed matches API does not supply event recommendations and cannot dismiss event or volunteering recommendations. Recommendation/dismiss persistence depth, a live disabled-feature fixture, exact visual/manual parity, a fresh full current-source browser aggregate, and ASP.NET backend compatibility remain uncertified. |
| Dashboard | `views/dashboard.blade.php`, `AlphaController::dashboard()` | `src/routes/dashboard.js`, `src/views/dashboard/index.njk` | Partial. Signed `/dashboard` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible profile, onboarding status, wallet balance, gamification profile, badges, listings, feed, member events, exchange-attention count, and member endorsements helpers, and renders the Blade-style welcome, onboarding banner, exchange-attention banner, create-listing CTA, time-bank stats, progress/badges, upcoming events, skill endorsements, quick links, and recent feed/listings. Dashboard links route through `urlFor()`. Recent feed rows now follow Blade's destination rule: positive-ID posts link to `/feed/posts/{id}`, while non-post activity falls back to `/feed`; focused default-English rendering passes. Its Laravel-owned contextual copy, plurals, image alternatives, page title, and numeric formatting now use the request locale; a real signed Arabic 320px Chromium/axe case proves RTL/reflow and absence of the former English labels. Listings/events/exchange requests and listings/messages/connections/events/volunteering links now follow Laravel tenant module/feature gates, with focused disabled-tenant proof that unavailable APIs are not called. Full visual/manual and screen-reader depth, a live disabled-tenant fixture, broader runtime behavior, and ASP.NET backend compatibility remain uncertified. |
| Simple/advanced search and saved-search delete | `views/search.blade.php`, `views/search-advanced.blade.php`, `views/search-saved-delete.blade.php`, `SearchParity::searchAdvanced()`, `searchDeleteSavedConfirm()`, `Api\SearchController` | `src/routes/search.js`, `src/views/search/index.njk`, `src/views/search/advanced.njk`, `src/views/search/saved-delete.njk`, `src/lib/api.js` | Partial. Signed `/search` and `/search/advanced` redirect unsigned visitors to `/login?status=auth-required`; simple search calls Laravel `/api/v2/search`, while advanced search adds Blade filters and `/api/v2/search/saved`. Simple search now matches current Blade's Advanced search link, filter fieldset, singular public type values, flat source-ordered result cards and tags, no-query/empty states, and silent empty fallback on a service failure; the route maps singular UI values to Laravel v2's plural API contract. It no longer invents a two-character minimum: every non-empty Blade query is preserved and submitted to Laravel. Advanced Search now reads Laravel listing-category and popular-tag APIs, excludes selected tags, preserves active filters when adding a suggestion, applies Blade's honest date/location post-filters, recalculates visible totals, caps each result family at four on the All tab, and matches the Blade result tabs, empty/error states, thumbnails/avatars, event metadata, fallback labels, and card actions. Saved-search cards use Blade's exact no-query, last-result-count, and delete catalog copy and preserve an explicit zero-result last run; the delete confirmation uses the source warning prefix. Signed `/search/saved/{id}/delete` reads the saved-search list and renders Blade's destructive confirmation. All three surfaces use exact request-locale catalogs; links, forms, advanced pagination, auth, and mutation redirects remain mount-safe. Focused simple-search proof passes `4/4`; advanced populated/filter/card/tag coverage, saved-card localization/state coverage, and live read coverage are green. The aggregate baseline is `47/47` suites and `1,589/1,589` tests. A 2026-07-11 disposable create/delete attempt produced no row: both Web UK and direct authenticated `POST /api/v2/search/saved` returned `500`, and Laravel logged `SearchController::saveSearch()` calling nonexistent `getJsonInput()` at line 206. Live saved-search persistence is therefore blocked upstream until the read-only Laravel endpoint uses an available JSON request helper. Feature-gate depth, recorded manual parity, broader runtime behavior, and ASP.NET compatibility remain uncertified. |
| Knowledge base | `views/kb-index.blade.php`, `views/kb-article.blade.php`, `AlphaController::kb()`, `AlphaController::kbArticle()` | `src/routes/kb.js`, `src/views/kb/index.njk`, `src/views/kb/article.njk`, `src/lib/api.js` | Partial. Member-only `/kb` and `/kb/{id}` redirect unsigned visitors to `/login?status=auth-required`, forward the signed bearer token to Laravel's knowledge-base APIs, and render the Blade-style caption, search, cards, cursor continuation, article body, metadata, related links, and localized 404. Article metadata now preserves Blade's literal backend date substring before `T` instead of applying Web UK's locale formatter. Focused route proof passes 2/2 with green lint and template-localization checks; the immediately preceding complete gate passes 51/51 suites and 1,668/1,668 tests. Feedback mutations, attachments/downloads, admin editing, broader live behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Saved items, collections, and appreciation | `views/saved.blade.php`, saved collection/social Blade parity views, saved/appreciation controllers | `src/routes/saved-social.js`, `src/routes/saved-collections.js`, `src/views/saved/index.njk`, `src/views/saved-collections/*.njk`, `src/views/saved-social/*.njk`, `src/lib/api.js` | Partial. Signed `/saved`, `/me/collections`, `/me/collections/{id}`, `/users/{id}/collections`, and `/users/{id}/appreciations` render Laravel-backed saved item, collection, public collection, and appreciation pages through Laravel bookmark, collection, public collection, and appreciation APIs. Source templates route all local filters, item/card links, CRUD/removal/reaction forms, pagination, member links, auth handoffs, and POST outcomes through the active `urlFor()` helper. Flat Saved-page removal now matches Blade by toggling `POST /api/v2/bookmarks` with `{ type, id }` instead of deleting from the unrelated SOC10 saved-items store. The five core views use exact `saved`, `polish_discovery`, and `govuk_alpha_saved` captions, headings, descriptions, filters, types, counts, visibility, forms, validation/status states, empty states, saved dates, reaction labels/pressed state, and pagination; route-created English count/type/status presentation has been removed. The appreciation form matches Blade's 500-character contract and described public-choice fieldset. Focused source and route rendering passed; real signed 320px reflow/axe cases passed for saved items, my collections, public collections, and `/users/77/appreciations` without serious/critical findings. The expanded opt-in mutation gate passed `2/2` against Laravel in `82.9` seconds: it created and updated a unique private collection, saved an existing tenant listing into it through SOC10, proved and submitted Web UK's no-JS item-removal form, verified saved-item absence through Laravel, deleted the collection, and separately proved flat BookmarkService removal. Neither disposable row was retained and the source listing was unchanged. The upstream `govuk_alpha_saved` namespace remains English-identical outside English. Appreciation/reaction mutations, tenant feature gates, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Goals | `views/goals*.blade.php`, `AlphaController::goals*()`, goals parity routes | `src/routes/goals.js`, `src/views/goals/*.njk`, `src/lib/api.js` | Partial. Signed `/goals`, detail, templates, discover, buddying, edit, check-in, reminder, buddy-action, history, insights, and social pages render Laravel-backed Blade-style workflows through Laravel v2 goals, comments, and like APIs. Owner, buddy, public-action, progress, history, note, insight, edit, completion, and social states use tenant-aware URLs; public non-owners do not receive owner controls. A disposable default-English Laravel lifecycle passed `1/1` in `4.9` minutes: create/rename, 40% check-in with note, reminder add/remove, like toggle, comment/reply create and owner deletion, 320px structure/reflow/axe, goal delete, and final API absence. The mutation test now has an explicit 20-minute ceiling after a prior fully-cleaned run hit ten minutes under transient Laravel latency. Non-owner/buddy variants, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Connections network | `views/connections.blade.php`, `views/connections-network.blade.php`, `AlphaController::connections()`, `ConnectionsMatchesParity::connectionsNetwork()`, `Api\ConnectionsController` | `src/routes/connections.js`, `src/views/connections/index.njk`, `src/views/connections/network.njk`, `src/lib/api.js` | Partial. Signed `/connections` and `/connections/network` redirect unsigned visitors to the tenant-aware auth handoff. The primary page now matches Laravel's three-section inbox rather than the former single-filter table: accepted, pending-received, and pending-sent data plus canonical counts load together and render the Blade caption, description, search, summaries, cards, actions, status banners, and empty states. The network page renders Laravel's tabs, connected-since text, pagination, and member actions. Both pages use exact Laravel catalog keys, locale-aware counts/dates, normalized snake/camel rows, safe bio text, localized blank-name fallbacks, and `urlFor()` navigation/actions. Accepted-connection removal and sent-request cancellation now use Blade's closed no-JavaScript details disclosure, irreversible-action warning, localized warning prefix, and warning-styled final submit control on both views. Focused default-English confirmation proof passes 2/2; the complete non-mutating gate passes 52/52 suites and 1,672/1,672 tests with green lint and a zero-match 322-template localization audit. The local `/connections/{id}/accept|decline|remove` POST handlers call Laravel v2 endpoints and preserve Laravel status redirects. Live mutation effects, exact cursor depth beyond the 50-row inbox load, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Federation hub | `views/federation.blade.php`, `partials/federation-nav.blade.php`, `FederationV2Controller::status()`, `partners()`, `activity()` | `src/routes/federation.js`, `src/views/federation/index.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation status, partners, and optional activity endpoints and render Blade-style status banners, stats, partner preview, activity, and quick links. The hub service navigation, opt-in/opt-out CTAs, partner preview links, view-all link, and quick links now route through `urlFor()` with source regression, focused render, and scoped Laravel runtime-smoke coverage. The opted-out CTA now enters `/federation/onboarding`, matching current Laravel. Federation GET route-level redirects now use `res.locals.urlFor`, with focused shared-mount coverage proving `/acme/accessible/federation` redirects to `/acme/accessible/login?status=auth-required`. Laravel `403` from the optional activity feed now renders an empty activity list instead of a `503` page, matching the local E2E fixture's permission-limited activity state. Federation depth pages, tenant policy, localization, full runtime behavior, and ASP.NET backend compatibility are not certified. |
| Federation tenant URL helpers | Federation browse, messaging, settings, transfer, and POST action workflows | `src/views/federation/*.njk`, `src/routes/federation-actions.js` | Partial. Connections, conversations, events, groups, listings, member browse, messages, opt-in/out, partner list/detail, settings, and transfer templates now route local links/forms through `urlFor()`. Federation POST action redirects for connection, message, translation, transfer, onboarding, opt-in/out, and settings outcomes now resolve through `res.locals.urlFor`. Laravel `403`/`FEDERATION_NOT_ENABLED` responses now redirect signed non-opted-in members to the tenant-safe `/federation/opt-in` route rather than rendering `503`; the focused current-source runtime slice passed `13/13`, and the default smoke inventory records the nine affected pages as signed opt-in redirects. Full opted-in federation persistence, tenant policy, localization, visual parity, and ASP.NET backend compatibility are not certified. |
| Activity dashboard | `views/activity.blade.php`, `AlphaController::activity()`, `MemberActivityService::getDashboardData()` | `src/routes/activity.js`, `src/views/activity/index.njk` | Partial. GET `/activity` redirects unsigned visitors to `/login?status=auth-required`, calls the Laravel-compatible profile activity dashboard endpoint, and renders Blade-style summary stats, recent engagement, net balance, skills breakdown, monthly hours progress rows, detailed-insights link, and recent activity timeline. Titles, caption, stats, engagement labels, skill tags/endorsements, month labels, net balance, and timeline copy now resolve through Laravel catalogs with request-locale number/date formatting. Focused activity tests passed 5/5, and standard plus Arabic 320px runtime coverage is included in the 35/35 Chromium/axe matrix. The authoritative `govuk_alpha_activity` Arabic namespace remains English upstream. Exact service row shape, relative-time parity, manual assistive-technology evidence, and ASP.NET backend compatibility are not certified. |
| Activity insights | `views/activity-insights.blade.php`, `ActivityParity::activityInsights()`, `MemberActivityService::getDashboardData()` | `src/routes/activity.js`, `src/views/activity/insights.njk` | Partial. GET `/activity/insights` redirects unsigned visitors to `/login?status=auth-required`, calls the Laravel-compatible profile activity dashboard endpoint, and renders Blade-style headline stats, dual monthly chart, type-tagged timeline, quick stats card, net-balance tag, and skills card. Document/section titles, chart text and ARIA, timeline types/empty states, quick stats, net-balance labels/hidden meanings, skills, and navigation now resolve through exact `govuk_alpha_activity` keys. Standard and Arabic 320px pages are covered by the 35/35 Chromium/axe matrix. The authoritative Arabic namespace is still English, so no divergent Web UK translation was invented. Exact service row shape, relative-time parity, manual assistive-technology evidence, and ASP.NET backend compatibility are not certified. |
| Federation partners list | `views/federation-partners.blade.php`, `FederationV2Controller::partners()` | `src/routes/federation.js`, `src/views/federation/partners.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation partners and render Blade-style partner cards. The back link, caption, heading, description, empty state, fallback name, external/level tags, metadata labels, permission labels, and view action use the exact request-locale Laravel catalogs. Counts use locale formatting, partnership dates use Blade's localized month/year shape, taglines use its 200-character limit, and card headings/external tags match the source size and colour. Focused list/detail render proof passed `2/2`, with green lint and the 290-template zero-match audit. Tenant policy, populated live runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation partner detail | `views/federation-partner.blade.php`, `FederationV2Controller::partnerDetail()` | `src/routes/federation.js`, `src/views/federation/partner.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation partner detail and render the Blade partner heading, multiline about content, summary fields, permission tags, and browse links scoped by internal partner id. Back/caption/about, external/level tags, summary and permission labels, browse heading/actions, and fallback name use exact request-locale Laravel catalogs. Counts use locale formatting, the partnership date matches Blade's localized full-date shape, and unknown level/permission values retain source-style raw fallbacks. The back link targets the Federation hub and the browse heading remains present for empty permission sets like Blade. Focused list/detail render proof passed `2/2`, with green lint and the 290-template zero-match audit. Tenant policy, populated remote/external runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation members list | `views/federation-members.blade.php`, `FederationV2Controller::members()` | `src/routes/federation.js`, `src/views/federation/members.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation members and partners endpoints, preserve query filters, and render Blade search, community, skills, service-reach filters, member cards, and cursor load-more links. Back/caption/title/description, the complete filter form, result count, community/location/reach metadata, reach values, view/load actions, skill overflow, and all three empty states use exact request-locale Laravel catalogs. Member names use the shared unknown-member fallback, bios follow Blade's 160-character limit, and skills show the first five plus the localized remaining count. Focused populated/filter/cursor render proof passed `1/1`, with green lint and the 290-template zero-match audit. Operation gating, in-page API failure parity, messaging action policy, populated remote/external runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation member detail | `views/federation-member.blade.php`, `FederationV2Controller::member()`, `memberReviews()`, `getSettings()` | `src/routes/federation.js`, `src/views/federation/member.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation member detail, settings, and reviews endpoints and render status banners, profile header, reputation, summary fields, connection/message/transfer actions, and review cards. Identity, action forms, permission branches, and review presentation now use Blade's exact structure and request-locale catalog: field hints and limits, viewer-versus-member capability gating, transfer cancel path, `show_reviews` visibility, anonymous fallback, full translated dates, ratings, partner and verified tags. Reviews are fetched only when the member exposes them. Local navigation and action targets use `urlFor()`. Focused member-detail and permission-branch proof passes with green lint and the 290-template zero-match audit. Remote/external runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Federation transfer confirmation | `views/federation-transfer.blade.php`, `AlphaController::federationTransfer()`, `FederationV2Controller::member()`, `getSettings()` | `src/routes/federation.js`, `src/views/federation/transfer.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call member detail, federation settings, and wallet balance APIs and render the Blade recipient summary, balance, warning, whitelisted success/error states, CSRF form, amount and description fields, and cancel link using the exact request-locale catalog. Each rendered mutation receives a UUID idempotency key and forwards it to Laravel's transaction request. Focused render and mutation proof passes with green lint and the 290-template zero-match audit. Laravel direct DB recipient resolution, tenant operation gates, disposable live transfer behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation settings | `views/federation-settings.blade.php`, `AlphaController::federationSettings()`, `FederationV2Controller::getSettings()` | `src/routes/federation.js`, `src/views/federation/settings.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 federation settings and render the Blade status banner, active notice, visibility and notification checkboxes, messaging/transaction toggles, service reach, travel radius, save form, and opt-out warning link. Headings, descriptions, every label and hint, reach values, active/opted-out states, status results, and page title now use the exact request-locale Laravel catalogs; the PUT payload remains Laravel-shaped. Focused settings/opt-in/mutation proof passed `3/3`, with green lint and the 290-template zero-match audit. Tenant feature gates, disposable live mutation behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation opt-in | `views/federation-opt-in.blade.php`, `AlphaController::federationOptIn()`, `FederationV2Controller::getSettings()`, `partners()` | `src/routes/federation.js`, `src/views/federation/opt-in.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests redirect already opted-in members to settings, call Laravel v2 settings and partners, and render the Blade benefits cards, privacy/communication/reach preferences, status errors, partner preview, CSRF form, and do-this-later link. All visible copy now uses the exact request-locale Laravel catalogs, partner counts use locale formatting, failure summaries follow Blade's non-link structure, and POST retains the source defaults and Laravel `/setup` payload. Focused settings/opt-in/mutation proof passed `3/3`, with green lint and the 290-template zero-match audit. Tenant feature gates, disposable live opt-in/cleanup behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation opt-out | `views/federation-opt-out.blade.php`, `AlphaController::federationOptOut()` | `src/routes/federation.js`, `src/views/federation/opt-out.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests render Blade's warning text, CSRF opt-out form, warning button, and cancel link to settings. Page title, tenant caption, warning context, submit and cancel copy now use the exact request-locale Laravel catalogs, while POST calls Laravel `/opt-out`. Focused opt-out render coverage passes. Tenant feature gates, disposable live opt-out/restore behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation onboarding | `views/federation-onboarding.blade.php`, `FederationParity::federationOnboarding()`, `FederationV2Controller::getSettings()`, `partners()` | `src/routes/federation.js`, `src/views/federation/onboarding.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests redirect opted-in members to the federation hub, call Laravel v2 settings, render the Blade welcome/privacy/communication/confirm wizard, preserve default sharing choices, show status errors, preview internal partner communities on confirm, and post to the Laravel-compatible `/federation/onboarding` action alias. Page metadata, tenant caption, progress semantics, every step heading/description/control, summaries, reach values, partner metadata, warning, errors and actions now use Laravel's dedicated request-locale onboarding catalog; counts use locale formatting. Links route through `urlFor()`. Privacy/communication choices persist in a tenant-keyed Express session bag; confirm retains state on failure, clears it only after successful `/setup`, and remains isolated across tenant mounts. Focused render plus six multi-request tests pass, and a current-source live flow read every choice back from Laravel before restoring the E2E fixture. Tenant feature gates, broader runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation listings | `views/federation-listings.blade.php`, `AlphaController::federationListings()`, `FederationV2Controller::listings()`, `partners()` | `src/routes/federation.js`, `src/views/federation/listings.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 listings and partners, preserve search/type/community/cursor filters, restrict partner options to internal communities, and render Blade's filters, offer/request cards, category/location/hours/author/community metadata, empty/error states, and load-more link. Page metadata, every filter/action/metadata label, type and fallback values use exact request-locale catalogs; hours use locale numbers and dates use Blade's translated full-date shape. Focused list/detail proof passed `2/2`, with green lint and the 290-template zero-match audit. Tenant operation denial distinction, external partner depth, disposable live behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation listing detail | `views/federation-listing-show.blade.php`, `AlphaController::federationListingShow()`, `FederationV2Controller::listings()`, `members()`, `getSettings()` | `src/routes/federation.js`, `src/views/federation/listing-show.njk` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests derive the authorized listing from Laravel v2 results filtered to the partner community and render Blade's type/community tags, safe image, summary list, multiline description, profile link, and conditional contact action. All labels/actions use exact request-locale catalogs; estimated hours use locale formatting, dates use Blade's translated full-date shape, and author/title fallbacks come from Laravel catalogs. Contact is shown only when both the remote member and viewer settings permit federated messaging. Focused list/detail and enabled/disabled-contact proof passed `2/2`, with green lint and the 290-template zero-match audit. Exact SQL-level lookup, partnership messaging permission depth, external partner details, disposable live behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Listing index, detail, and form | `views/listings.blade.php`, `views/listing-detail.blade.php`, `views/listing-create.blade.php`, `views/listing-edit.blade.php`, `AlphaController::listings()`, `AlphaController::listing()`, `AlphaController::createListing()`, `AlphaController::editListing()`, `Api\ListingsController` | `src/routes/listings.js`, `src/views/listings/index.njk`, `src/views/listings/detail.njk`, `src/views/listings/form.njk`, `src/lib/api.js` | Partial. Browse and detail are public like Blade; create/edit/delete and interactive mutations retain route-level or handler-level authentication. The browse page now replaces its legacy English-hardcoded management table with Blade's catalog-backed caption, description, guest/create states, canonical `q`, type, category, sort, near-me, hours, service, and posted filters, guarded load-error state, total result count, `nexus-alpha-card` listing rows, trusted images, type/featured/service tags, author and listing metadata, self-describing detail links, and filter-preserving cursor pagination. Signed browse reads Laravel bookmarks with `type=listing` and renders Blade's Saved badge only for matching listing IDs; bookmark-read failure safely degrades to no badges. Filter values map to Laravel's category, hours range, service type, posted-within, featured-first, and stored-profile proximity contract; missing signed profile coordinates produce Blade's no-location hint. Owner management controls remain on detail rather than leaking into browse cards. Detail projects Laravel's gallery, deduplicated skill tags, expiry/renewal metadata, author identity, exact verification badges and statistics, authoritative saved/liked/count state, comments/report/share links, reciprocal member offers/requests, viewer save/like forms, and owner edit/analytics/expired-renew/delete controls; the irreversible delete remains inside Blade's disclosure. Relative gallery/avatar assets resolve against the trusted Laravel origin, member-profile navigation obeys the connections feature, and action outcomes use exact request-locale catalogs. Create/update/delete use exact `/api/v2/listings` methods and send the seven canonical core fields without a client-owned create status. The form follows Blade's always-visible offer/request and skill-tag controls, conditional category/service controls, catalog hints and validation copy, no-JS AI description helper, and edit-page delete warning/action. The AI helper preserves bounded values in one-use session state, writes Laravel's returned suggestion into the editable description, and returns to the mounted create/edit URL. Skill tags and multipart cover images use their separate Laravel v2 boundaries after core persistence, with honest partial-failure messaging; optional empty browser file parts are filtered before Formidable's non-empty validation. Focused mocked listing form/AI/edit proof and the full 48-suite, 1,633-test aggregate pass. Historical live lifecycle wording in this row is invalidated by the ledger correction above; no Laravel runtime request or database side effect was performed for the current slice. Feature-disabled runtime variants, side-effect certification on a separately provisioned disposable Laravel environment, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Listing analytics | `views/listings-analytics.blade.php`, `govuk_alpha_listings.analytics`, `Api\ListingsController` analytics projection | `src/routes/listings.js`, `src/views/listings/analytics.njk` | Partial. The signed owner page consumes Laravel's Listing analytics projection and matches Blade's exact request-locale title, navigation, no-JS period selector, metric labels, trend copy, empty states, table captions, date-specific progress labels, and contact-method labels. Focused owner-page proof passes 1/1; the complete non-mutating gate passes 52/52 suites and 1,676/1,676 tests with green lint, branding, CSS, and zero-unresolved locale/template audits. No Laravel request or mutation was performed. Owner authorization and populated/empty runtime behavior still require the separately verified disposable environment; manual assistive-technology evidence and ASP.NET compatibility remain uncertified. |
| Listing exchange request | `views/exchange-request.blade.php`, `AlphaController::storeExchangeRequest()`, `govuk_alpha.exchanges`, `govuk_alpha.listings` | `src/routes/listings.js`, `src/views/listings/exchange-request.njk` | Partial. The signed page consumes Laravel Listing, profile, wallet, and exchange-feature reads and matches Blade's exact request-locale heading, navigation, Listing summary, time-credit balance context, low-balance warning, failure states, and form labels. Signed-out, signed-in, compliance-failure, and mounted rendering proof passes 1/1. Frozen Blade source inspection confirms the POST does not use validator errors or `withInput()` replay: missing proposed hours default to `1`, present non-numeric hours cast to zero and clamp to `0.25`, valid hours clamp to `0.25..24`, and non-empty preparation time uses the source float cast without an invented 24-hour cap. Focused normal/adversarial payload proof passes `1/1`, and the complete non-mutating gate passes 52/52 suites and 1,694/1,694 tests. No Laravel request or mutation was performed. Live create/cleanup still requires a separately verified disposable environment; manual assistive-technology evidence and ASP.NET compatibility remain uncertified. |
| Listing report form | `views/listing-report.blade.php`, `AlphaController::listingReport()`, `Api\ListingsController::report()` | `src/routes/listings.js`, `src/views/listings/report.njk`, `src/lib/api.js` | Partial. Signed GET `/listings/{id}/report` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/listings/{id}`, renders Blade's exact request-locale back link, listing caption, error summary, reason radios, details textarea, warning submit, and cancel link, and sends owner self-reports to the shared localized 403 surface like Laravel's `abort(403)` without rendering controls. POST authenticates before validation, submits valid reports to Laravel `/api/v2/listings/{id}/report`, and returns invalid reasons with Blade's field-linked error plus bounded one-use reason/details replay without an API mutation. Listing report entry points in the shared report-link partial use `urlFor()`. Focused render/replay/denial proof passes 3/3 and the complete non-mutating gate passes 52/52 suites and 1,678/1,678 tests. Duplicate-report runtime depth, disposable mutation/cleanup, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Listing exchange request form | `views/exchange-request.blade.php`, `AlphaController::requestExchange()`, `AlphaController::storeExchangeRequest()` | `src/routes/listings.js`, `src/views/listings/exchange-request.njk`, `src/lib/api.js` | Partial. Signed GET `/listings/{id}/exchange-request` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible listing and wallet balance endpoints, blocks owner self-requests, and renders the Blade-style back link, status error summary, listing summary, balance inset, low-balance warning, proposed-hours/prep-time/message fields, and send button. POST `/listings/{id}/exchange-request` already creates exchanges through the Laravel-compatible exchange request API. Exchange workflow feature-disable detection, compliance details, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Listing owner analytics | `views/listings-analytics.blade.php`, `ListingsParity::listingsAnalytics()`, `Api\ListingsController::analytics()` | `src/routes/listings.js`, `src/views/listings/analytics.njk`, `src/lib/api.js` | Partial. Signed GET `/listings/{id}/analytics` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible listing and analytics endpoints, preserves Laravel's 7/14/30/60/90 day selector, and renders the Blade-style listing links, key metrics, trend, created/expires dates, views/contact series, and contact-type table. Tenant module gates, exact owner/admin authorization display depth, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Listing comments | `views/listings-comments.blade.php`, `partials/listings-comment.blade.php`, `ListingsParity::listingsComments()`, `ListingsParity::listingsStoreComment()` | `src/routes/listings.js`, `src/views/listings/comments.njk`, `src/views/listings/_comment.njk`, `src/lib/api.js` | Partial. Signed GET `/listings/{id}/comments` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible listing and comments endpoints, and renders the Blade back link, exact default-English catalog content, status/error states, recursive comments, middot-separated metadata, count, and add-comment form. POST uses Laravel-compatible `/api/v2/comments`. Focused rendering passed, and the disposable Laravel lifecycle passed `1/1`: unique comment persistence, 320px reflow/axe, listing cascade delete, and final absence. Non-owner, reply/moderation, tenant-module, manual assistive-technology, and ASP.NET compatibility evidence remain open. |
| Federation groups | `views/federation-groups.blade.php`, `AlphaController::federationGroups()`, `FederationV2Controller::groups()`, `partners()` | `src/routes/federation.js`, `src/views/federation/groups.njk` | Partial. Unsigned requests redirect to login; the Laravel opt-in error redirects to `/federation/opt-in`; generic operation denial renders the localized unavailable state; and recoverable API failures retain the localized filters with an inline retry error. Signed-in requests preserve search/community/cursor filters, exclude external partner options, and render the current Blade catalog, localized member counts, group-card metadata, empty state, and load-more link. External partner group behavior, exhaustive runtime accessibility, and ASP.NET backend compatibility remain uncertified. |
| Groups index, forms, and detail | `accessible-frontend::groups`, `accessible-frontend::group-create`, `accessible-frontend::group-edit`, `accessible-frontend::group-detail`, `AlphaController::groups()`, `AlphaController::createGroup()`, `AlphaController::editGroup()`, `AlphaController::group()` | `src/routes/groups.js`, `src/views/groups/index.njk`, `src/views/groups/new.njk`, `src/views/groups/edit.njk`, `src/views/groups/detail.njk`, `src/lib/api.js` | Partial. The Laravel-backed index matches Blade's default-English caption/description, create action, labelled search, four filters, visibility-tagged cards, localized member counts, empty state, and applicable pagination structure through one filtered v2 request. Its opaque-cursor continuation now uses Blade's `Group pages` landmark, top margin, `Next` title, and directional icon while preserving search and filter state. Create/edit match Blade's captions, field hierarchy, tags, optional cover upload, and single submit action. Failed create/edit submissions preserve text, visibility, and tags; name errors now reproduce Blade's exact localized copy, linked summary, inline error, error styling, hidden prefix, and `aria-describedby` relationship without calling Laravel for locally invalid input. Create renders Blade's `group-create-failed` summary, redirects success through `group-created`, and treats an optional cover-upload failure as silent best-effort after creation. Edit renders the source's `group-update-failed` and `group-delete-failed` summaries after the page heading and likewise keeps optional cover replacement best-effort. Detail matches Blade's caption, visibility heading/summary, member/location/created metadata including the full `j F Y` created date, member/pending/join states, member navigation, admin actions, roster links, and source-shaped event states; embedded event cards now reproduce Blade's media-row layout, trusted cover-image resolution, valid-row filtering, online fallback, and `j F Y, g:ia` start time. Invented creator/report/private-contact/card UI is removed. It also loads Laravel's existing announcement collection and renders only pinned rows with non-empty titles in Blade's exact position, tag, heading, and card hierarchy; announcement failure remains non-fatal like the source's guarded read. The visibility-filtered `sub_groups` detail payload now renders Blade's heading/intro, image, visibility tag, plural member count, 160-character description, and tenant-safe links, resolving relative media only against the configured backend origin. Active members now load the embedded feed through Laravel's exact `GET /api/v2/feed?group_id={id}&per_page=20` filter and render Blade's compose form, empty state, author/date/content/media cards, relative media resolution, fallback alt text, and four-image cap; non-members neither request nor expose feed content. The multipart compose route forwards the optional image and alt text to Laravel instead of silently dropping them. Focused detail/feed proof passes `7/7`, including mocked multipart forwarding without a live database mutation. The disposable gate passed `1/1` in `152.6` seconds with a persisted PNG cover, joined-index proof, detail controls, edit/delete, 320 CSS pixel structural/reflow/axe assertions, and final absence. Join and leave actions preserve Blade's success/failure redirects, including policy-unavailable and interaction-restricted safeguarding outcomes, and detail renders those failures in the source's paragraph-style GOV.UK error summary. Focused create/edit/detail proof is green; the aggregate baseline is `47/47` suites and `1,598/1,598` tests with lint, brand, CSS, localization, and route-matrix gates green. Laravel's accessible edit controller submits tags, but `GroupService::update()` discards them and v2 detail omits them, so edit-tag persistence remains upstream. Live group-feed persistence/cleanup, tenant feature gates, manual assistive-technology review, and ASP.NET compatibility remain uncertified. |
| Federation events | `views/federation-events.blade.php`, `AlphaController::federationEvents()`, `FederationV2Controller::events()`, `partners()` | `src/routes/federation.js`, `src/views/federation/events.njk` | Partial. Unsigned requests redirect to login; the Laravel opt-in error redirects to `/federation/opt-in`; generic operation denial renders the localized unavailable state; and recoverable API failures retain the localized filters with an inline retry error. Signed-in requests preserve search/community/upcoming/cursor filters, exclude external partner options, and render the current Blade catalog, full localized date-time, event-card metadata, empty states, and load-more link. External partner event behavior, exhaustive runtime accessibility, and ASP.NET backend compatibility remain uncertified. |
| Event category browse | `views/events-browse.blade.php`, `EventsParity::eventsBrowse()` | `src/routes/events.js`, `src/views/events/browse.njk`, `src/lib/api.js` | Partial. GET `/events/browse` calls the Laravel-compatible category API and renders the exact request-locale Blade catalog, back link, caption, category radio chooser, all-events option, selected category state, and view-all action. Its empty-category inset and populated form are both covered, and every local link/form is mount-safe. Focused populated, mounted, selected, and empty proof passed `1/1`; scoped Laravel runtime smoke retains the Blade heading check. Tenant feature gates, broader runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Event poll attachment | `views/events-polls.blade.php`, `EventsParity::eventsPolls()` | `src/routes/events.js`, `src/views/events/polls.njk`, `src/lib/api.js` | Partial. Signed GET `/events/{id}/polls` redirects unsigned visitors to login, requires proved organiser ownership or the API's explicit edit capability, and fails closed with `403` before exposing controls to another member. Authorized views call Laravel-compatible event detail, profile, and `mine` poll APIs and render the exact request-locale Blade catalog, status states, organiser poll checkboxes, attached tags, empty state, and mount-safe `poll_ids[]` form. Focused organiser and non-organiser proof passed `2/2`. POST uses Laravel's owner-scoped event update contract. A fresh disposable attach/detach lifecycle is blocked by the drifted local Laravel database: current `EventService` writes `events.accessibility_step_free` and newer lifecycle fields, while the local table lacks them; the existing event `6` is owned by another user and is not valid mutation evidence. Tenant feature gates, restored disposable runtime proof after schema catch-up, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Event translation chooser | `views/events-translate.blade.php`, `EventsParity::eventsTranslate()` | `src/routes/events.js`, `src/views/events/translate.njk`, `src/lib/api.js` | Partial. Signed GET `/events/{id}/translate` redirects unsigned visitors to login, calls the Laravel-compatible event detail API, and renders the exact request-locale Blade catalog, status insets/errors, 11-language selector, source description, and mount-safe no-JavaScript form. Successful POST now retains Laravel's returned translated text and target language in a one-use session value, renders the translated heading/text/machine note after redirect, then clears it; empty, unchanged, unavailable, failed, auth, and mounted redirects remain distinct. Focused page and success/one-use/failure proof passed `2/2`. Tenant feature gates, live provider behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Event recurring edit scope | `views/events-recurring-edit.blade.php`, `EventsParity::eventsRecurringEdit()`, `EventsParity::eventsUpdateRecurring()` | `src/routes/events.js`, `src/views/events/recurring-edit.njk`, `src/lib/api.js` | Partial. Signed GET `/events/{id}/recurring-edit` redirects unsigned visitors to login, requires proved organiser ownership or the API's explicit edit capability, and fails closed with `403` before exposing controls to another member. Owned non-series events redirect to the normal edit page. The form mirrors Blade's category, local date/time with timezone and all-day guards, online/hybrid place controls, six tri-state venue-accessibility fields, four accessibility-detail fields, capacity, mount-safe occurrence links, and capability-gated scope chooser. Single-occurrence API validation failures now return to the form with one-use input replay, linked error summary, field-level title/description/start/end errors, localized hidden prefixes, and Blade-equivalent ARIA relationships. Scope-all status failures render the authoritative catalog message instead of silently discarding it. Scope-all preview builds the Laravel-authorized dirty-patch field set, requires a concrete occurrence plus `supports_effective_revisions`, and commit accepts that same explicit allowlist; focused render, validation-replay, capability, preview, and commit proof is green. Disposable-Laravel mutation certification, tenant feature gates, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Federation connections | `views/federation-connections.blade.php`, `AlphaController::federationConnections()`, `FederationV2Controller::connections()` | `src/routes/federation.js`, `src/views/federation/connections.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests map Laravel tab filters to `/api/v2/federation/connections` and render Blade's full-page tabs, whitelisted status banners, empty states, connection cards, incoming notes, and accept/reject/remove forms using exact request-locale catalogs and full translated dates. API `403` renders Blade's operation-unavailable inset; transient API failures render its retry summary. Page queries fetch 51 rows at the correct offset, expose 50, and render previous/next navigation without the former flat 100-row cap. Focused populated, permission/error, and pagination proof passed `3/3`, with green lint and the 290-template zero-match audit. Disposable live mutations, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation messages index | `views/federation-messages.blade.php`, `AlphaController::federationMessages()`, `FederationV2Controller::messages()`, `getSettings()` | `src/routes/federation.js`, `src/views/federation/messages.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests call Laravel v2 settings and messages, group viewer-owned rows into conversation cards, preserve query filtering, and render Blade's whitelisted statuses, search, compose guidance, unread labels, previews, full translated dates, and conversation links using exact request-locale catalogs. Messaging-operation `403` renders either the opt-in CTA or feature-disabled inset from viewer settings, while opt-in-required `403` still redirects and transient load failures render Blade's error state without losing the page shell. Focused populated and permission/load-error proof passed `2/2`, with green lint and the 290-template zero-match audit. Disposable live message mutation, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Federation conversation detail | `views/federation-conversation.blade.php`, `AlphaController::federationConversation()`, `FederationV2Controller::messages()`, `markMessagesReadBatch()` | `src/routes/federation.js`, `src/views/federation/conversation.njk`, `src/routes/federation-actions.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in requests filter Laravel v2 messages into the selected partner conversation, sort chronologically, mark unread inbound IDs read, and render Blade's status banners, direction/read tags, multiline bodies, full translated datetimes, translate controls, and reply form using exact request-locale catalogs. Translation POST now retains Laravel's returned text in a one-use session flash, displays it inline with the translated tag and Show original link after the no-JavaScript redirect, then clears it. Focused conversation, translation flash, and action-alias proof passed `3/3`, with green lint and the 290-template zero-match audit. Exact DB read semantics, tenant messaging-operation denial, disposable live reply/translation behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Message conversations | `views/conversation.blade.php`, `views/messages-groups.blade.php`, `views/messages-group-create.blade.php`, `views/messages-group-conversation.blade.php`, `AlphaController::conversation()`, `MessagesParity`, `GroupConversationController`, `Api\MessagesController`, `Api\GroupConversationController` | `src/routes/messages.js`, `src/views/messages/index.njk`, `direct-conversation.njk`, `groups.njk`, `group-create.njk`, `group-conversation.njk`, `src/lib/api.js` | Partial. The signed direct inbox renders Blade's direct/groups and inbox/archive navigation, conversation summaries, unread states, no-JavaScript member search, directory fallback, and restriction-aware start controls. Direct detail renders listing context, older-message navigation, message/attachment/voice/translation states, edit/delete controls, reply/upload forms, and archive action. Its fixed copy, fallbacks, and complete whitelisted edit/delete, attachment, voice, translation, and safeguarding outcomes use Laravel's exact catalogs; failures render error summaries rather than success banners. Direct and group detail now consume Laravel's conversation-level safeguarding projection, show its pre-contact notice, and suppress send/reaction/add-member controls before a restricted member types. Direct and group write failures preserve Laravel's policy-unavailable, vetting-required, and contact-restricted outcomes through tenant-safe redirects. Message deletion defaults to the safer Blade `self` scope in both the checked radio and missing-input fallback, while group participant removal requires Blade's irreversible-action disclosure. Group list/create/detail otherwise render Laravel-backed participants, filtering, reactions, reply/member/leave controls, exact default-English catalogs, and restriction-aware mutation controls. Group create matches Blade's full-width layout, common disabled-detail state, GOV.UK button initialization, and no-JavaScript selected-member removal while preserving the group name, remaining IDs, and tenant mount. Selected names are independently resolved through Laravel's tenant-scoped user contract when no current search result supplies them, with the source unknown-member fallback retained on lookup failure; focused create/identity/restriction proof passes `3/3`. Rejected group creation now also preserves the safe name and selected IDs on the mounted form redirect and retains Laravel's disabled, vetting-required, contact-restricted, and policy-unavailable outcomes instead of collapsing them into a generic failure; focused mounted replay proof passes `1/1`. The group index and create form distinguish Blade's community-disabled notice from its member-restricted notice, suppress the create action in either state, and use Blade's localized general error copy when the collection cannot be loaded; focused state proof passes `2/2`. Group detail now matches Blade's sender identity row with a 48-pixel decorative avatar or uppercase initial placeholder before the localized sender name; focused avatar/placeholder proof passes `1/1`. Local links/forms remain mount-safe through `urlFor()`. Direct and group inbox/detail timestamps use a dedicated request-locale filter matching Blade's `j F Y, g:ia` shape instead of the generic relative/abbreviated date filter; focused safeguarding, render, and action-contract proof passes `8/8`. The no-JavaScript voice upload now converts Web UK's 10 MB multipart-parser rejection into Blade's localized `voice-failed` conversation state instead of falling through to a generic server error; focused oversized and valid multipart proof passes `2/2` without calling Laravel. Group detail now reads Laravel's public `GET /api/v2/messages/reactions/batch` contract on a best-effort basis and renders its aggregate counts plus viewer-selected remove state with exact accessible labels; focused proof passes `1/1`, and read failures preserve the page. This is not complete runtime certification: the endpoint authorizes rows through direct-message `sender_id`/`receiver_id` columns rather than Blade's internal group-participant projection, so the returned group reaction set can be incomplete. Laravel's group API also has no deletion endpoint: self-leave retains conversation/message residue and may promote another member, so no disposable group mutation gate is claimed. Translated-text runtime depth, safe direct-message mutation fixtures, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Group invite members | `views/groups-invite.blade.php`, `GroupsParity::groupsInvite()`, `GroupInviteService` | `src/routes/groups.js`, `src/views/groups/invite.njk`, `src/lib/api.js` | Partial. Signed GET `/groups/{id}/invite` reads Laravel-compatible group detail and invite listing data, then renders the exact request-locale Blade catalog, back link, caption, generated invite-link inset, expiry form, email invite form, pending invitations table, revoke forms, and status banners. The pending table is contained in a labelled, keyboard-focusable horizontal scroll region after live 320px proof exposed page overflow. A disposable owner lifecycle passed `1/1` in `193.5` seconds: generate a seven-day invite link, prove its pending row and real ID, revoke it, prove final absence, pass structural/reflow/axe checks, then delete the parent group with no retained fixture. Email delivery, non-owner role behavior, tenant feature gates, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group notification preferences | `views/groups-notifications.blade.php`, `GroupsParity::groupsNotificationPrefs()`, `GroupNotificationPreferenceService` | `src/routes/groups.js`, `src/views/groups/notifications.njk`, `src/lib/api.js` | Partial. Signed GET `/groups/{id}/notifications` reads Laravel-compatible group detail and notification preference data, then renders the exact request-locale Blade catalog, back link, caption, success/error states, frequency radios, channel checkboxes, and save form; the failure summary is non-linked like Blade. A disposable active-owner lifecycle passed `1/1` in `178.2` seconds: select digest frequency, disable email, retain push, submit the Laravel-compatible PUT through Web UK, prove all three values from the redirected read, pass 320 CSS pixel structural/reflow/axe checks, then delete the parent group with no retained fixture. Non-owner active-member authorization, tenant feature gates, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group image management | `views/groups-image.blade.php`, `GroupsParity::groupsImage()`, `GroupsParity::groupsUpdateImage()` | `src/routes/groups.js`, `src/views/groups/image.njk`, `src/lib/api.js` | Partial. Signed GET/POST `/groups/{id}/image` require proved owner, group-admin, or platform-admin authority before rendering or proxying either multipart upload; unknown authority fails closed. The page uses the exact request-locale Blade catalog, and Laravel-relative current avatar/cover paths resolve against the configured backend origin rather than Web UK's separate origin. Avatar and cover uploads enforce Laravel's exact field names, 8 MB limit, MIME allowlist, single-file cardinality, and temporary-file cleanup. A disposable owner lifecycle passed `1/1` in `230.1` seconds: create a group with a persisted PNG cover, upload a separate PNG avatar through the dedicated image page, prove the rendered current-avatar image and Laravel detail field, pass 320 CSS pixel structural/reflow/axe checks, then delete the group with no retained fixture. The local non-admin fixture also returns 403 for groups 482 and 484. Group-admin/platform-admin live uploads, tenant feature gates, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group announcements | `views/group-announcements.blade.php`, `views/group-announcements-edit.blade.php`, `GroupsParity::groupsAnnouncements()`, `GroupsParity::groupsEditAnnouncement()`, `GroupAnnouncementService` | `src/routes/groups.js`, `src/views/groups/announcements.njk`, `src/views/groups/announcement-edit.njk`, `src/lib/api.js` | Partial. Signed GET `/groups/{id}/announcements` reads Laravel-compatible group detail and announcement listing data, then renders the Blade-style back link, caption, success/error states, announcement summary cards, pinned/expired tags, owner/admin edit/pin/delete controls, empty state, and create form. Signed GET `/groups/{id}/announcements/{annId}/edit` renders the exact request-locale Blade catalog, non-linked error summary, field-level validation treatment, populated values, pin state, expiry date, and mount-safe actions. A disposable owner lifecycle passed `1/1` in `159.8` seconds: create an announcement, prove persisted content, load and submit the populated edit form, prove updated content, pin it, prove the pinned state, delete it, prove final absence, pass 320 CSS pixel structural/reflow/axe checks, and then delete the parent group with no fixture retained. Active-member/non-admin runtime authorization, validation input replay beyond the source controller's current redirect behavior, tenant feature gates, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group discussions | `views/group-discussions.blade.php`, `views/group-discussion-create.blade.php`, `views/group-discussion-detail.blade.php`, `AlphaController::groupDiscussions()`, `AlphaController::createGroupDiscussion()`, `AlphaController::groupDiscussion()`, `GroupService` | `src/routes/groups.js`, `src/views/groups/discussions.njk`, `src/views/groups/discussion-create.njk`, `src/views/groups/discussion-detail.njk`, `src/lib/api.js` | Partial. Signed index, create, and detail pages render the Blade-style hierarchy, member-only start action, discussion cards, reply list/counts, status states, and reply form. Create and reply validation preserve bounded input for one request and render Blade's linked summaries, inline field errors, hidden prefixes, and hint/error ARIA relationships; API failures retain input without invented field errors. The live gate exposed that Web UK read nonexistent `GET /discussions/{id}/messages` and mocked `items`; detail now matches Laravel's declared `GET /discussions/{id}` path and `data.messages` envelope, while reply POST correctly retains `/messages`. A disposable active-owner lifecycle passed `1/1` in `249.6` seconds: create a discussion, prove the source's initial-message semantics, post and prove a reply, prove the updated index count, pass 320 CSS pixel structural/reflow/axe checks, then delete the parent group and retain no fixture. Non-owner active-member runtime behavior, tenant feature gates, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group files | `views/group-files.blade.php`, `GroupsParity::groupsFiles()`, `GroupsParity::groupsDownloadFile()`, `GroupFileService` | `src/routes/groups.js`, `src/views/groups/files.njk`, `src/lib/api.js` | Partial. Signed list, upload, download, and delete routes require proved active membership or administrator authority before any file lookup; unknown membership fails closed. A non-member receives the same 403 for existing and arbitrary file IDs before the file API is touched. List, form, action, and outcome copy uses Laravel's exact request-locale `govuk_alpha_groups.files` catalog; error summaries reproduce Blade's non-linked list and upload failures retain its inline field treatment. The Blade-style table renders delete controls only for the uploader or an administrator and is contained in a labelled, keyboard-focusable horizontal scroll region at narrow widths. Uploads enforce Laravel's exact multipart fields, 25 MB limit, MIME allowlist, folder/description lengths, and temporary-file cleanup; authorized downloads preserve Laravel binary metadata. Historical disposable evidence is superseded by the current database state: two cleanup-safe lifecycle attempts and a direct disposable create/delete probe now reach Laravel `GET /api/v2/groups/{id}/files`, which returns `500` because the query selects missing MySQL column `group_files.updated_at`. Web UK does not mask this read-only Laravel blocker. Tenant feature gates, role variants, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Group management | `views/group-manage.blade.php`, `AlphaController::manageGroup()`, `GroupService` | `src/routes/groups.js`, `src/views/groups/manage.njk`, `src/lib/api.js` | Partial. Signed GET `/groups/{id}/manage` requires proved owner, group-admin, or platform-admin authority before loading member/request data; ordinary members fail closed with `403`. Authorized views read Laravel-compatible group detail, members, and requests, exclude the current user, and render the current Blade catalog, whitelisted status states, pending join-request controls, localized member roles, and promote/demote/remove controls. Join-request failures preserve Laravel's policy-unavailable and interaction-restricted codes through mounted redirects and render the exact `safeguarding.php` copy; the caption and non-linked error hierarchy also match Blade. Focused owner, safeguarding, and ordinary-member denial proof passes. A current scoped disposable Laravel lifecycle passed `1/1` in `4.0` minutes: a second seeded member requested access to a unique private group, the owner approved, promoted, demoted, and removed that member through Web UK, each persisted role/membership state was API-verified, 320px reflow and axe checks passed, and the parent group was deleted. Tenant feature gates, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Events index and forms | `views/events.blade.php`, `views/event-form.blade.php`, `views/event-people.blade.php`, `AlphaController::events()`, `AlphaController::createEvent()`, `AlphaController::editEvent()`, `AlphaController::cancelEvent()`, `EventsParity::eventsPeople()`, `EventsParity::eventsUpdatePeople()`, `Api\EventsController`, `Api\EventRegistrationController` | `src/routes/events.js`, `src/views/events/index.njk`, `src/views/events/new.njk`, `src/views/events/edit.njk`, `src/views/events/detail.njk`, `src/views/events/people.njk`, `src/lib/api.js` | Partial. Core create/update/cancel/delete use Laravel's exact v2 methods, paths, `data` envelopes, `start_time`/`end_time` fields, required description, cancellation `reason`, and 400/403/404/409/422 plus onboarding/auth handling. The default-English index matches Blade's caption/description, browse and creation guidance, search/time/category/stored-location-radius filters, result count, card-list metadata/copy, and block pagination; invented status tags, group filtering, and card chrome were removed. Create/edit forms match Blade's captions, descriptions, section hierarchy/order, catalog field copy, image treatment, recurrence labels, and submit actions; invented group selectors and cancel links were removed. Detail matches Blade's caption, full/places-left state, Description and Event information hierarchy, separate date rows, HTTP/HTTPS-only auto-escaped online/video links, organiser/category, pluralized RSVP counts, cancellation reason, and cover alt copy. Signed organizer GET/POST `/events/{id}/people` now uses Laravel's canonical People API for the 25-row roster, metrics, exact filter/state catalogs, queue positions, pagination, attendance navigation, and approve/reject/cancel bulk operations with expected registration versions, confirmation, required reasons, a 100-operation cap, and idempotency keys; Laravel authorization denial fails closed without roster controls. Focused roster/action/validation/denial proof is green. The strengthened 320px disposable journey passed `1/1` in `86.3` seconds with create, real PNG cover upload and successful backend fetch, rendered cover visibility, `going`/`interested`/`not_going` RSVP transitions, edit, landmark/H1/ID/reflow/axe integrity, delete, and final API absence. It exposed and fixed backend-relative Laravel cover URLs being requested from Web UK's origin; event list/detail/edit now use the existing configured-backend same-origin asset resolver. Signed `/events` renders live, and the refreshed Laravel source confirms the authenticated Events feature boundary: Web UK mounts `/events` behind `requireAuth`, and a live unsigned mounted request returned `302` to login. Remaining gaps include waitlist/series/check-in depth, remaining organizer policy branches, cover image removal (Laravel v2 has upload but no removal endpoint), live People mutation proof, manual assistive-technology review, broader runtime behavior, and ASP.NET backend compatibility. |
| Event people and check-in operations | `views/event-people.blade.php`, `views/event-check-in.blade.php`, `views/event-checkin-credential.blade.php`, `EventsParity::eventsPeople()`, `eventsUpdatePeople()`, `eventsCheckIn()`, `eventsUpdateAttendance()`, `EventOfflineCheckinParity`, `Api\EventRegistrationController`, `Api\EventOfflineCheckinController` | `src/routes/events.js`, `src/views/events/people.njk`, `src/views/events/check-in.njk`, `src/views/events/check-in-credential.njk`, `src/lib/api.js` | Partial. Signed organizer People and Check-in GETs use Laravel's canonical 25-row projection for metrics, exact request-locale filters/states, queue positions, server-declared attendance actions, and mount-safe pagination. People POST performs approve/reject/cancel bulk operations with expected registration versions, confirmation, required reasons, a 100-operation cap, and idempotency. Check-in POST performs check-in/check-out/no-show/undo transitions with the expected attendance version, confirmation, required undo reason, idempotency, and explicit 409 conflict handling. Confirmed attendees can now open the Laravel-catalog check-in credential page and issue, rotate, or revoke a signed `nqx2_` code through the canonical `/api/v2/events/{id}/offline-checkin/credentials*` contract. One-shot secrets render only on the mutation response with `private, no-store`, versioned destructive operations require confirmation and a bounded reason, and all event links remain tenant-mount safe. Focused Event rendering, validation, conflict, authorization, and credential lifecycle contract proof passes; denied projections expose no management controls. Live disposable registration/attendance or credential mutation, the organizer signed-code fallback (whose private API scan contract additionally requires a registered device secret), manual assistive-technology review, and unchanged ASP.NET runtime proof remain uncertified. |
| Event operations navigation and least-privilege roster controls | `views/event-detail.blade.php`, `views/event-people.blade.php`, `EventPolicy`, `EventContractMapper::permissions()` | `src/views/events/detail.njk`, `src/views/events/people.njk`, `src/routes/events.js` | Partial. Event detail now follows Blade's complete operation navigation: Registration, People, Check-in, Communications, recurrence definitions, Analytics, Templates, and lifecycle history are independently gated from Laravel's relationship and permission projections. Its default-English hierarchy also restores Blade's calendar, agenda, safety, and ticket links before the back link; full-width result/cancelled/archived state banners precede the two-thirds content grid; and owner publication/edit/series/poll/template/cancel/archive controls precede the cover, description, summary, and RSVP workflow. Authenticated detail also restores Blade's zero-JavaScript email-share and Event-translation actions through tenant-mount-safe links. The current v2 detail projection now reads nested `organizer`, `location`, `schedule`, `metrics`, `online_access`, `primary_image`, lifecycle, and permission fields without relying on legacy flat aliases; it renders safe organizer/location text, inclusive all-day dates, map links only behind the tenant feature, the complete venue-accessibility summary, backend-authorized online links, and cancelled/archived state. Recurrence definitions additionally require an eligible v2 recurrence shape and Laravel's live `recurrence-capabilities` response to prove schema readiness, blueprint support, and the rolling-v2 rollout; missing or degraded capability evidence fails closed. Current `organizer` ownership is normalized alongside legacy owner shapes so Analytics and Templates no longer disappear for the canonical payload. The same canonical ownership check gates Blade's full owner action set: edit, series edit, manage polls, capture as template, cancel, and archive are suppressed for non-owner staff even when a broad `can_edit` flag is present. The People projection separately uses `meta.capabilities.manage_registration` to suppress selection and approve/reject/cancel controls from attendance-only staff while retaining their roster and Check-in navigation; Laravel authorization remains authoritative for every request. Owner detail also follows Laravel's archive-first lifecycle: it requires a reason, carries an idempotency key into the canonical DELETE header/body contract, uses preserved-history copy, shows the archived notice, and suppresses archived mutation controls. Focused nested-only canonical-mounted rendering, full-navigation, source-order, broad-edit non-owner denial, degraded-capability/non-owner denial, manager, attendance-only, archive render/submission, local validation, and API contract proof passes. The live lifecycle gate stopped before creating a fixture because the read-only Laravel runtime schema lacks the source-required `events.accessibility_step_free` column; no disposable event was retained. Live archive persistence/role variants, destination workflow depth, manual assistive-technology review, and ASP.NET backend compatibility are uncertified. |
| Event waitlist offer acceptance | `views/event-detail.blade.php`, `EventsParity::eventsAcceptWaitlistOffer()`, `Api\EventRegistrationController::acceptOffer()` | `src/routes/events.js`, `src/views/events/detail.njk`, `src/lib/api.js` | Partial. Signed POST `/events/{id}/waitlist/accept` calls Laravel's canonical `/api/v2/events/{id}/registration/waitlist/accept` endpoint with a bounded caller-supplied or generated idempotency key, redirects through the active tenant mount, and renders exact request-locale success/failure states on detail. Active offers omit the token; token-bearing offers trim and forward the opaque token up to Laravel's exact 512-character limit, while overlong input fails locally before the API. Focused active/token/invalid action-contract proof passes. Disposable live promotion effects and ASP.NET backend compatibility remain uncertified. |
| Event participant relationship controls | `views/event-detail.blade.php`, `AlphaController::event()`, `EventPeopleService::relationship()`, `Api\EventRegistrationController::show()` | `src/routes/events.js`, `src/views/events/detail.njk`, `src/lib/api.js` | Partial. Signed event detail loads Laravel's canonical `/api/v2/events/{id}/relationship` projection and uses its registration/waitlist actions plus the embedded engagement capability to expose only permitted confirm, withdraw, interest, join, leave, active-offer accept, and offer-decline controls; missing capability evidence fails closed. Confirm, withdraw, waitlist join, and waitlist leave now call the canonical `/registration/*` mutations with server-generated idempotency headers, while interest alone retains Laravel's compatibility RSVP endpoint because no separate canonical engagement mutation exists. Active participants must open an explicit warning details block before submitting withdrawal. Waiting members see their canonical queue position; active offers suppress the ordinary RSVP form. Focused confirm/interest/withdraw, active-withdrawal confirmation, canonical join/leave plus tenant-mounted redirects, offered/waiting/joinable, and current-v2 owner hierarchy proof passes, and the full 47/47-suite, 1,570/1,570-test gate is green. Token-bearing offer acceptance, disposable live capacity/promotion effects, and ASP.NET backend compatibility remain uncertified. |
| Event detail attendee reading order | `views/event-detail.blade.php`, `AlphaController::event()`, `EventContractMapper::roster()` | `src/views/events/detail.njk`, `src/routes/events.js`, `src/lib/api.js` | Partial. The attendee roster remains in Blade's two-thirds main reading column after the event workflow and now consumes Laravel's canonical member, registration, and engagement projection. One flat ordinary GOV.UK list renders the localized display-name fallback, backend-relative avatar or initial placeholder, and Blade's going/interested/not-going tag mapping without invented profile links or grouped subheadings. The read uses `status=all`, Blade's 50-row limit, and the opaque `attendees_cursor`; its `rel="next"` link preserves other query parameters. API failures render a distinct focusable GOV.UK error summary, while a genuinely empty roster remains absent. Mocked populated, empty, failure, cursor, query-preservation, asset-resolution, and request-contract proof passes, and the full non-mutating gate is 47/47 suites and 1,607/1,607 tests. Manual reading-order review, live privacy-role variants, and ASP.NET backend compatibility remain uncertified. |
| Event location map | `views/events-map.blade.php`, `EventsParity::eventsMap()` | `src/routes/events.js`, `src/views/events/map.njk`, `src/lib/api.js` | Partial. GET `/events/{id}/map` calls Laravel `/api/v2/events/{id}` through the event API helper and renders Blade's exact request-locale back link, caption fallback, title, introduction, location labels, iframe accessible name, outbound actions, new-tab text, and online/no-coordinate guidance. Focused proof passes physical coordinates, online-only, valid zero coordinates, a written address without coordinates, and tenant-mounted rendering; local links use `urlFor()` while external OpenStreetMap URLs remain unchanged. Web UK matches Laravel's ordered `events` and route-specific `maps` feature gates: either disabled flag returns `403` before the event API is touched. The existing scoped Laravel smoke covers `/events/6/map`. Broader live variants, manual assistive-technology behavior, and ASP.NET backend compatibility remain uncertified. |
| Blog GET pages | `views/blog-index.blade.php`, `views/blog-post.blade.php`, `views/blogreviews-post-comments.blade.php`, `views/blogreviews-likers.blade.php`, `AlphaController::blog()`, `blogFeed()`, `blogPost()`, `BlogReviewsParity::blogReviewsPostComments()`, `blogReviewsPostLikers()` | `src/routes/blog-posts.js`, `src/views/blog/index.njk`, `src/views/blog/detail.njk`, `src/views/blog/comments.njk`, `src/views/blog/likers.njk`, `src/lib/api.js` | Partial. `/blog`, `/blog/{slug}`, signed discussion/liker pages, and `/blog/feed.xml` call Laravel-compatible blog, comment, and reaction APIs and use the exact `blog` and `govuk_alpha_blogreviews` catalogs. Links/forms and auth/result redirects are mount-safe. Index and detail metadata now match Blade's visible `category · date · reading time` sequences without the former non-source author byline. Detail pages also consume Laravel's meta title/description, canonical URL, Open Graph image/article fields, publication/modified timestamps, and emit script-safe Article JSON-LD with the tenant as author/publisher; canonical URLs are restricted to HTTP(S). RSS now matches Blade's tenant-named channel, absolute mount-aware links, permalink GUIDs, optional RFC-822 publication date, request language, and XML escaping. The rich discussion matches Blade's ownership-gated edit/delete controls, edited state, reply-depth cap, warning-protected cascade delete, six emoji reaction controls/counts/pressed state, and exact status/form copy. Focused hostile-character RSS proof passes 1/1, and the current complete non-mutating gate passes 52/52 suites and 1,675/1,675 tests. A reversible default-English Laravel gate passed `1/1` in `204.4` seconds: create, comment reaction, edit, nested reply, post reaction add/remove restoration, warning delete with reply cascade, 320px structure/reflow/axe, final API absence, and independent zero-residue/baseline inspection. Feature-gate depth, exact rich-text policy, non-owner runtime variants, live RSS consumer variants, manual assistive-technology parity, and ASP.NET backend compatibility remain open. |
| Poll GET pages | `views/polls.blade.php`, `views/gamification-poll-detail.blade.php`, `views/gamification-poll-rank.blade.php`, `views/gamification-poll-create.blade.php`, `views/gamification-poll-manage.blade.php`, `AlphaController::polls()`, `GamificationParity::gamificationPollDetail()`, `gamificationRankedVote()`, `gamificationCreatePoll()`, `gamificationManagePolls()`, `gamificationExportPoll()` | `src/routes/poll-actions.js`, `src/routes/polls.js`, `src/views/polls/index.njk`, `detail.njk`, `rank.njk`, `create.njk`, `manage.njk`, `src/lib/api.js` | Partial. Signed list/detail/rank/create/manage/export pages call Laravel-compatible poll, ranked-results, category, comment, like, and export APIs and render the Blade-style family. Default-English create retains required question/two options, tomorrow-minimum close date, categories, standard/ranked types, and source state banners; manage renders owner cards, counts, export and warning-protected delete. The live journey exposed that Laravel's Poll detail omits likes even though `/feed/like` mutates them; Web UK now non-fatally enriches detail from Laravel's feed-item `likes_count`/`is_liked` fields. The expanded disposable default-English owner lifecycle passed `1/1` in `366.6` seconds: create a standard poll, vote and prove the choice, like and prove pressed state, comment and prove content, delete and prove API absence, then create a ranked poll, submit a ranking, prove the persisted success/results state, delete it, and again prove API absence. The gate retains 320 CSS pixel structural/reflow/axe checks and independent final cleanup. Existing representative RTL proof remains without Arabic-specific expansion. Broader owner authorization, feature gates, visual/manual assistive-technology parity, and ASP.NET backend compatibility remain uncertified. |
| Goals visible page family | `views/goals.blade.php`, `views/goal-templates.blade.php`, `views/goal-buddying.blade.php`, `views/goals-discover.blade.php`, `views/goal-detail.blade.php`, `views/goal-edit.blade.php`, `views/goals-checkin.blade.php`, `views/goals-reminder.blade.php`, `views/goals-buddy-actions.blade.php`, `views/goals-insights.blade.php`, `views/goals-history.blade.php`, `views/goals-social.blade.php`, `AlphaController::goals()`, `Api\GoalsController::index()` | `src/routes/goals.js`, `src/views/goals/index.njk`, `src/views/goals/templates.njk`, `src/views/goals/buddying.njk`, `src/views/goals/discover.njk`, `src/views/goals/detail.njk`, `src/views/goals/edit.njk`, `src/views/goals/checkin.njk`, `src/views/goals/reminder.njk`, `src/views/goals/buddy-actions.njk`, `src/views/goals/insights.njk`, `src/views/goals/history.njk`, `src/views/goals/social.njk`, `src/lib/api.js` | Partial. Signed Goals index/templates/buddying/discover/detail/edit/check-in/reminder/buddy-actions/insights/history/social routes redirect unsigned users to `/login?status=auth-required`, call Laravel-compatible goals APIs, and render their Blade workflows. All twelve visible surfaces now use exact request-locale catalogs and localized route fallbacks, including template filters/targets/public controls, tenant captions, owner/progress labels, buddy outcomes, plural streak/check-in/like/comment counts, reminder cadence, milestone/history labels, recursive comment author fallbacks, social status/validation states, and buddy support copy. Buddy completion controls now use the normalized boolean rather than comparing a localized status label to English, and every optional-translator normalizer is invoked explicitly so `Array.map` indexes cannot be mistaken for translators. Focused Arabic templates/discovery/buddying coverage passed 3/3. The live Arabic twelve-page workflow passed HTTP 200, exact title markers, non-empty captions, no `undefined`, RTL, 320px reflow, and axe with no serious/critical violations in 5.2 minutes wall time. Full verification passed 1,424/1,424 with warning-free lint, a 290-template zero-match audit, and 608/608 route parity. Goals feature gates, live mutation persistence, manual parity, a fresh full current-source browser aggregate, and ASP.NET backend compatibility remain uncertified. |
| Clubs GET page | `views/clubs.blade.php`, `AlphaController::clubs()`, `Api\ClubsApiController::index()` | `src/routes/clubs.js`, `src/views/clubs/index.njk`, `src/lib/api.js` | Partial. Signed `/clubs` redirects unsigned users to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/clubs` with the search query, and renders Blade-style club search, empty state, logo, member count, schedule, contact, and external website link cards. The enabled directory now uses Laravel's exact request-locale `clubs`, `actions`, and shared accessibility keys for route/fallback title, tenant caption, description, search label/hint/action, plural member count, schedule/contact labels, website action, and new-tab text. The search form and auth redirect remain mount-safe. The route mirrors Laravel's active-club gate by returning `404` when an unfiltered response proves the tenant has no active club evidence, while searched empty results can render when a minimal unfiltered probe proves active clubs exist. Focused Arabic enabled-directory coverage passed 1/1; full verification passed 1,424/1,424, warning-free lint, the 290-template zero-match audit, and 608/608 route parity. The current live `hour-timebank` fixture remains correctly gated at 404, so enabled-tenant body runtime proof, broader runtime behavior, manual parity, and ASP.NET backend compatibility remain uncertified. |
| Skills GET page | `views/skills.blade.php`, `AlphaController::skills()`, `Api\SkillTaxonomyController` | `src/routes/skills.js`, `src/views/skills/index.njk`, `src/lib/api.js` | Partial. Signed `/skills` redirects unsigned users to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/skills/categories`, `/api/v2/skills/categories/{id}`, and `/api/v2/skills/members`, and renders Blade-style skill search, member results with proficiency/offers/wants tags, category skill counts, and nested category browsing. The entire visible page now uses Laravel's exact request-locale `skills` catalog for route title, tenant caption, description, search controls, member-result heading/empty state, proficiency/offers/wants tags, category heading/back link/table headings/empty state, and category browser; the Web UK-only API failure inset uses Laravel's shared localized 503 title/body. Links, forms, and auth redirects remain mount-safe. Focused Arabic category/member coverage passed 1/1, and the live Arabic enabled directory passed HTTP 200, exact markers, RTL, 320px reflow, and axe with no serious/critical violations. Full verification passed 1,424/1,424, warning-free lint, the 290-template zero-match audit, and 608/608 route parity. Category/member authorization edge cases, mutation-free deeper runtime fixtures, recorded manual parity, and ASP.NET backend compatibility remain uncertified. |
| Ideation challenge list/create/edit/manage/outcome-edit/drafts/detail/idea-detail/tags/campaigns/outcomes | `views/ideation.blade.php`, `views/ideation-challenge-form.blade.php`, `views/ideation-manage.blade.php`, `views/ideation-outcome-form.blade.php`, `views/ideation-drafts.blade.php`, `views/ideation-detail.blade.php`, `views/ideation-idea.blade.php`, `views/ideation-tags.blade.php`, `views/ideation-campaigns.blade.php`, `views/ideation-campaign-detail.blade.php`, `views/ideation-outcomes.blade.php`, `partials/ideation-nav.blade.php`, `AlphaController::ideation()`, `IdeationParity::ideationCreateChallenge()`, `IdeationParity::ideationEditChallenge()`, `IdeationParity::ideationManageChallenge()`, `IdeationParity::ideationOutcomeEdit()`, `IdeationParity::ideationDrafts()`, `IdeationParity::ideationIdeaDetail()`, `AlphaController::ideationChallenge()`, `IdeationParity::ideationPopularTags()`, `IdeationParity::ideationCampaigns()`, `IdeationParity::ideationCampaignDetail()`, `IdeationParity::ideationOutcomes()`, `IdeationChallengeService`, `ChallengeCategoryService`, `ChallengeTemplateService`, `CampaignService`, `ChallengeOutcomeService`, `IdeaMediaService` | `src/routes/ideation.js`, `src/routes/ideation-actions.js`, `src/views/ideation/*.njk`, `src/lib/api.js` | Partial. Signed `/ideation`, `/ideation/new`, `/ideation/{id}`, `/ideation/{id}/edit`, `/ideation/{id}/manage`, `/ideation/{id}/outcome`, `/ideation/{id}/drafts`, `/ideation/{id}/ideas/{ideaId}`, `/ideation/tags`, `/ideation/campaigns`, `/ideation/campaigns/{id}`, and `/ideation/outcomes` redirect unsigned users to `/login?status=auth-required`, call Laravel-compatible v2 Ideation APIs, and render the Blade challenge, campaign, outcome, draft, idea, tag, voting, comment, media, favourite, duplicate, conversion, and destructive-control families. Every visible success/failure helper now reads the request-locale Laravel state catalog, and POST redirects use Laravel's canonical tokens (`challenge-updated`, `challenge-status-updated`, `favorited`/`unfavorited`, `draft-failed`, `idea-failed`, `comment-failed`, `media-failed`, and `converted`) instead of local aliases that produced missing banners. The favourite redirect derives the persisted boolean returned by Laravel. The current focused Ideation family passes 30/30 under `--detectOpenHandles`. Campaign list/detail use the exact Blade catalog and admin create/edit/unlink/delete controls, submit the complete campaign payload, validate required titles locally, and reject non-admin mutations before the API. `npm run smoke:laravel:ideation-campaign-mutation` passed `1/1`: it created, API-verified, edited, re-verified, deleted, and confirmed absence of a disposable Laravel campaign, with 320px reflow and no serious/critical axe violations. Tenant feature gates, non-campaign live mutation depth, broader manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Resources simple GET page | `views/resources.blade.php`, `AlphaController::resources()`, `Api\ResourcePublicController::index()` | `src/routes/resources.js`, `src/views/resources/index.njk`, `src/lib/api.js` | Partial. Signed `/resources` redirects unsigned users to the mounted `/login?status=auth-required`, calls Laravel-compatible `/api/v2/resources` with Blade's search query, and renders the exact request-locale caption, title, description, library action, search controls, empty state, uppercase file type, 200-character description limit, title fallback, safe relative/HTTP(S) download path, and accessible download name. Focused signed/unsigned source-shaped rendering passes, and the disposable Resources lifecycle separately proves the current Laravel collection, exact-byte download, and final cleanup. The exposed v2 collection still does not supply every richer library detail/count field and its cursor/category/sort contract cannot reproduce all service-level semantics. Feature-gate depth, broader runtime variants, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Resources library GET page | `views/resources-library.blade.php`, `partials/resources-category-tree.blade.php`, `ResourcesParity::resourcesLibrary()`, `Api\ResourcePublicController::index()`, `Api\ResourcePublicController::categories()`, `Api\ResourceCategoryController::tree()` | `src/routes/resources.js`, `src/views/resources/library.njk`, `src/lib/api.js` | Partial. Signed `/resources/library` redirects unsigned users to `/login?status=auth-required`, calls Laravel-compatible resource/category/tree/profile endpoints, and renders search, category navigation, statuses, cards, metadata, downloads/comments/reactions, cursor navigation, and administrator reorder controls. The v2 response still lacks several Blade detail/count fields and has category, sorting, and opaque-cursor limitations, so displayed counts and navigation cannot be certified as exact service parity. Role/ownership display, tenant captions, feature gates, localization, current broad runtime behavior, and ASP.NET backend compatibility are not certified. |
| Resources comments GET page | `views/resources-comments.blade.php`, `ResourcesParity::resourcesComments()`, `CommentService`, `ReactionService` | `src/routes/resources.js`, `src/views/resources/comments.njk`, `src/lib/api.js` | Partial. Signed `/resources/{id}/comments` redirects unsigned users to `/login?status=auth-required`, loads the Laravel resource, comment thread, and reaction summary contracts, and renders Blade's status states, threaded comments, owner delete controls, add-comment form, and exact six emoji-bearing resource reaction buttons. Focused rendering passed `1/1`. A disposable default-English Laravel lifecycle passed `1/1` in `5.0` minutes: unique text-file upload, exact byte download, resource reaction add/remove restoration, comment create/delete, 320px structure/reflow/axe, resource delete, and final resource absence. Non-owner/admin variants, broader file/error cases, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Resources upload GET/POST page | `views/resources-upload.blade.php`, `ResourcesParity::resourcesUploadForm()`, `ResourcesParity::resourcesUpload()`, `ResourcesParity::resourcesFlatCategories()` | `src/routes/resources.js`, `src/views/resources/upload.njk`, `src/lib/api.js`, `src/middleware/multipart.js` | Partial. Signed `/resources/upload` now redirects unsigned users to `/login?status=auth-required`, loads category options through Laravel-compatible `/api/v2/resources/categories`, renders Blade-style back link, caption, upload guidance, failure error summary, multipart form, title, description, category, file controls, allowed file-type hint, submit, and cancel link, and proxies multipart submissions to Laravel `/api/v2/resources` before redirecting to `/resources/library?status=resource-uploaded`. A disposable live Laravel smoke uploaded a unique 59-byte text file through this form, found its exact rendered library card, and removed it during the same run. Tenant feature gates, category fallback exactness, validation error replay, localization, broader MIME/size cases, and ASP.NET backend compatibility are not certified. |
| Resources delete GET page | `views/resources-delete.blade.php`, `ResourcesParity::resourcesDeleteConfirm()` | `src/routes/resources.js`, `src/views/resources/delete.njk`, `src/lib/api.js` | Partial. Signed `/resources/{id}/delete` now redirects unsigned users to `/login?status=auth-required`, locates the resource through Laravel-compatible `/api/v2/resources`, checks collection owner/admin metadata plus profile ownership where available, and renders Blade-style back link, caption, irreversible warning, confirmation question, CSRF delete form, warning button, and cancel link. The disposable upload/download/delete smoke submitted the rendered warning action, received `302`, and proved final Laravel listing absence without retaining the row or file. Full admin authorization parity, tenant feature gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Resources download GET route | `ResourcesParity::resourcesDownload()`, `Api\ResourcePublicController::download()` | `src/routes/resources.js`, `src/lib/api.js` | Partial. Signed `/resources/{id}/download` now redirects unsigned users to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/resources/{id}/download`, proxies the binary body, and preserves content type, disposition, length, cache, etag, and last-modified headers. The disposable live smoke received `200` plus an attachment disposition and proved the downloaded bytes exactly matched the uploaded fixture. Tenant feature gates, ASP.NET backend compatibility, and broader Laravel filesystem/error behavior are not certified. |
| Account hub | `views/account.blade.php` | `src/views/account.njk` | Partial. Unsigned requests redirect to `/login`; signed-in users see the Blade-style card list for wallet, messages, connections, notifications, profile, settings, and a CSRF-protected sign-out form. Account card links and the logout form action use `urlFor()`. Card titles/descriptions, the caption, sign-out action, and unread-message choice string now use Laravel catalog keys; mocked Arabic rendering proves the two-message plural, and a signed 320px Arabic Chromium/axe case proves RTL/reflow and the localized action without high-impact violations. The default Laravel runtime smoke verifies POST `/logout` redirects to `/login` and clears the signed account session. Notification group-read/delete-all, wallet donate, saved-item removal, saved-collection CRUD/item-remove, match-dismiss, and appreciation send/react POST aliases are backed by Laravel v2 endpoints. Full account-link localization is limited by authoritative source namespaces that remain English; per-module data, realtime behavior, route availability checks, and ASP.NET backend compatibility are not certified. |
| Own profile summary | `views/profile.blade.php`, `AlphaController::myProfile()`, `AlphaController::memberProfile()` | `src/routes/profile.js`, `src/views/profile/index.njk`, `src/lib/api.js` | Partial. Signed `/profile` now renders a Laravel-style identity hero, verification/type state, localized activity statistics, About, skills, recent listings, reviews, account summary, badges, and profile/gamification actions instead of the former three-field summary. It conditionally reads existing Laravel listing/review/gamification/badge APIs, degrades non-authentication supplemental failures by section, enforces the connections feature before authentication/profile reads, and suppresses disabled subfeature calls and sections. Focused route tests passed 4/4; the full Jest suite passed 1,394/1,394; and standard plus Arabic 320px profile cases passed within the 30/30 Chromium/axe matrix. Availability/activity-timeline depth, exact supplemental service data, live disabled-tenant proof, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Notifications inbox | `views/notifications.blade.php`, `AlphaController::notifications()`, `markAllNotificationsRead()`, `markNotificationRead()`, `deleteNotification()`, `deleteAllNotifications()`, `markGroupNotificationsRead()` | `src/routes/notifications.js`, `src/views/notifications/index.njk`, `src/lib/api.js` | Partial. Signed `/notifications` redirects unsigned visitors to `/login?status=auth-required`, reads Laravel-compatible grouped or unread-only payloads, and renders Blade's full-width heading, filters, button group, destructive disclosure, category/group/new tag order, compact cards, actor summaries, secondary read/delete controls, pagination, and empty state without the previous narrow grid, heading badge, decorative icons, link-button styling, or bold message treatment. Server-declared `is_grouped` remains authoritative even for a one-item group; grouped `all_read` and single `is_read` drive action and new-tag display, with `read_at` retained as a legacy fallback. Category mapping now matches Blade exactly, including treating `transfer_*` as the fallback category rather than inventing a Credits classification. Bundled translation-key messages resolve before rendering. Document title, caption, description, category labels, success messages, actions, and the empty state use Laravel catalog keys; the invented English-only unread-empty card was removed. Notification timestamps match Blade's `created_at` `diffForHumans()` semantics through the request-locale relative-time formatter instead of preferring grouped `latest_at` and rendering an absolute date. The shared tenant gate rejects disabled `notifications` modules with `403` before route APIs, matching Laravel's explicit controller guard; account/navigation links follow the same module flag. Focused notification proof passes `9/9`, disabled-core-route coverage includes the tenant-mounted inbox, full Jest passes `48/48` suites and `1,632/1,632` tests, and lint plus both localization audits are green. Stored `svc_notifications_*` message keys remain unresolved when Laravel has not exported that service namespace into the generated Web UK catalogs; live mutation effects, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Profile delete account | `views/profile-delete.blade.php`, `AlphaController::confirmDeleteAccount()`, `Api\GdprController::requestDeletion()` | `src/routes/profile.js`, `src/views/profile/delete.njk`, `src/lib/api.js` | Partial. GET `/profile/delete-account` redirects unsigned visitors to `/login?status=auth-required` and renders the Blade-style back link, localized warning/effects copy, password field, optional reason, confirmation checkbox, warning button, cancel link, and status error summary. POST calls the pending-erasure `POST /api/gdpr/delete-account` contract instead of the immediate `DELETE /api/v2/users/me` purge. It sends only password/reason, maps Laravel 400/403/401/429/500 outcomes, and now requires Laravel's explicit `logout_required: true` evidence before invalidating user cache, destroying the Express session, clearing token/refresh/tenant cookies, and redirecting through `urlFor()` to the deletion-requested login state. Missing or false revocation evidence fails closed to `delete-failed` while preserving the signed-in session. Focused account-erasure contract proof passes `12/12`. A successful live POST, notification/audit side effects, duplicate-pending behavior, and ASP.NET backend compatibility remain uncertified until a disposable isolated GDPR fixture exists. |
| Profile settings | `views/profile-settings.blade.php`, `AlphaController::profileSettings()`, passkey and safeguarding actions | `src/routes/profile.js`, `src/views/profile/settings.njk` | Partial. GET `/profile/settings` redirects unsigned visitors to `/login?status=auth-required`, loads Laravel-compatible profile/account/notification/match/skill/passkey/session/safeguarding/vetting payloads, and renders the Blade-style settings sections. Passkey rename/removal require Blade's current-password field, exchange it for Laravel's short-lived `/api/webauthn/security-confirm` token, and submit that token to the high-risk operation. Missing/incorrect passwords, missing credentials, and `LAST_SIGN_IN_METHOD` remain distinct localized errors. Successful removal requires `sessions_revoked` evidence, invalidates the Web UK session, expires the complete access/refresh cookie pair, and renders Blade's `passkey-removed` sign-in confirmation. Password change and TOTP-disable success likewise clear Web UK's session/cookies because Laravel atomically revokes all backend sessions; their exact Blade success copy now renders on the signed-out login destination instead of being lost behind an immediate protected-route auth redirect. Password errors read the standard `errors[0].code` envelope so incorrect, reused, weak, and generic failures remain distinct. Safeguarding retains policy-review banners, private community vetting status, controlled status tags, policy-specific explanation, the no-document warning, exact empty-body review/confirmation forms, and dedicated API contracts. Focused status and confirmation proof passes `25/25` plus `2/2`. No live password, TOTP, passkey, or safeguarding mutation was submitted against the protected production-derived Laravel snapshot. Email change still fails closed because Laravel exposes no password-gated bearer equivalent, and its multi-write profile update is not atomic through the API. Avatar persistence, tenant feature-gate depth, disposable mutation fixtures, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Profile two-step verification | `views/two-factor-setup.blade.php`, `AlphaController::twoFactorSetup()`, `Api\TwoFactorController` | `src/routes/profile.js`, `src/views/profile/two-factor.njk` | Partial. GET `/profile/two-factor` redirects unsigned visitors to `/login?status=auth-required`, reads `GET /api/v2/auth/2fa/status`, calls `POST /api/v2/auth/2fa/setup` only while disabled, normalizes `qr_code_url`, and renders the Blade-style QR/manual-key instructions, verification form, enabled-state backup-code count, disable form, success banner, and status error summary. Successful verify renders the returned one-time backup codes directly and refresh cannot redisplay them. Invalid codes redirect to the form, 401 stays tenant-aware, and 429/5xx retain their real status. The document title, pluralized backup count, back link, warning, disable heading, QR alt, finish link, and verify/disable actions use exact Laravel keys and `urlFor()`. Focused contract/status plus rendered-shell selection passed 31 assertions, all six scoped keys resolve in all 11 catalogs, and the complete current Web UK gate passed 38/38 suites and 1,177/1,177 tests. Live setup/verify/disable persistence, security notification/email side effects, and ASP.NET backend compatibility are not certified because no disposable 2FA fixture is available. |
| Profile blocked members | `views/blocked-users.blade.php`, `AlphaController::blockedUsers()` | `src/routes/profile.js`, `src/views/profile/blocked.njk` | Partial. GET `/profile/blocked` redirects unsigned visitors to `/login?status=auth-required`, reads Laravel `/users/blocked`, and renders the Blade-style back link, success banner, blocked member cards, avatar fallback, reason, empty state, and tenant-safe unblock forms. Exact `BlockUserService` `user_id`/`name`/`avatar_url`/`reason` rows have populated render coverage; blank names use Laravel's localized `Community member` fallback instead of invented copy. A current `npm run smoke:laravel:member-block-mutation` passed `1/1` in `3.1` minutes against a visible member selected only after no-block/no-connection preflight: Web UK persisted and API-verified connection request/cancel followed by block/unblock, passed repeated 320px reflow and serious/critical axe checks, and restored the exact initial state. The expanded gate exposed and fixed prohibited `aria-label` use on roleless member/listing star graphics by giving both labelled groups `role="img"`; the earlier reachable post-block redirect protection remains. Laravel-relative blocked-member avatars now use the trusted configured backend origin instead of Web UK's origin. The live fixture's stored avatar path still returns `404` from Laravel itself, so upstream file integrity remains open. Tenant-domain routing, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Settings appearance | `views/settings-appearance.blade.php`, `SettingsAuthParity::settingsAppearance()` | `src/routes/settings.js`, `src/views/settings/appearance.njk` | Partial. GET `/settings/appearance` redirects unsigned visitors to `/login?status=auth-required`, reads `preferred_theme`/`theme` from Laravel `/api/v2/users/me`, and renders the Blade-style back link, caption, success/error states, theme radios, hints, and save button; POST uses Laravel `/api/v2/users/me/theme`. Page, theme, hint, action, and status copy now resolves from the exact Laravel appearance/common/state catalog rather than hardcoded or borrowed generic keys. A guarded live lifecycle passed `1/1` within the `256.2`-second aggregate: capture the current theme, choose a different theme through Web UK, prove the success state and persisted redirected read, pass 320 CSS pixel structural/reflow/axe checks, restore the original through Web UK, and retain an API-level `finally` restoration fallback. The shared E2E user finished unchanged. Tenant-domain routing, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Settings availability | `views/settings-availability.blade.php`, `SettingsAuthParity::settingsAvailability()` | `src/routes/settings.js`, `src/views/settings/availability.njk` | Partial. GET `/settings/availability` redirects unsigned visitors to `/login?status=auth-required`, loads Laravel `/api/v2/users/me/availability`, and renders the Blade-style account back link, caption, success/error states, seven-day grid, three time slots per day, time inputs, and save button. Page, day, slot, action, and status copy now resolves from the exact Laravel availability catalog rather than hardcoded or borrowed Event keys. Back link, save form action, auth handoff, validation redirect, success redirect, and API-failure redirect use `urlFor()`/`res.locals.urlFor`. A current guarded default-English Laravel lifecycle passed `1/1` in `1.7` minutes: capture the original weekly schedule, save a distinct slot through Web UK, prove redirected render and API persistence, pass 320px structure/reflow/axe, restore through Web UK, and independently verify exact API equality with a `finally` restoration fallback. Tenant-domain routing, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Settings linked accounts | `views/settings-linked-accounts.blade.php`, `SettingsAuthParity::settingsLinkedAccounts()` | `src/routes/settings.js`, `src/views/settings/linked-accounts.njk` | Partial. GET `/settings/linked-accounts` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/users/me/sub-accounts` and `/api/v2/users/me/parent-accounts`, and renders the Blade-style back link, caption, success/error states, incoming managers, managed accounts, empty states, link request form, relationship choices, permission checkboxes, and action forms. Page, relationship, permission, action, fallback, and ordinary status copy resolves from the exact Laravel linked/common/state catalog; focused SubAccountService-style child/parent envelope normalization covers IDs, names, relationship types, JSON permissions, statuses, and the unknown-member fallback. Back link plus approve, permissions, revoke, request form actions, auth handoffs, validation redirects, success redirects, and API-failure redirects use `urlFor()`/`res.locals.urlFor`. Request failures preserve Laravel's distinct policy-unavailable, vetting-required, and coordinator-contact safeguards with field-linked error summaries; focused code-to-status-to-copy proof passes without notifying another member. Tenant-domain routing, safe disposable runtime effects, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Settings data rights | `views/settings-data-rights.blade.php`, `SettingsAuthParity::settingsDataRights()` | `src/routes/settings.js`, `src/views/settings/data-rights.njk` | Partial. GET `/settings/data-rights` redirects unsigned visitors to `/login?status=auth-required` and renders the Blade-style GDPR request form, success/information/error states, and an honest empty-history state. Page copy, request choices/descriptions, notes controls, table labels, and status messages now resolve from the exact `govuk_alpha_settings.gdpr` and state keys rather than hardcoded or borrowed Ideation copy. The POST alias submits to Laravel `/api/v2/users/me/gdpr-request`, and local links/redirects remain tenant-aware. Laravel exposes no bearer-authenticated GDPR request-history endpoint equivalent to the Blade controller's server-side history read, so Web UK cannot populate or certify that section. Tenant-domain routing, irreversible live submission, manual assistive-technology depth, and ASP.NET backend compatibility remain uncertified. |
| Settings insurance | `views/settings-insurance.blade.php`, `SettingsAuthParity::settingsInsurance()` | `src/routes/settings.js`, `src/views/settings/insurance.njk` | Partial. GET `/settings/insurance` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/users/me/insurance` when enabled, and renders the Blade-style back link, caption, success/error states, certificate cards, empty state, status tags, and multipart upload form. Page, certificate type/status/fallback, field, hint, action, and state copy resolves from the exact Laravel insurance/common/state catalog. Focused nested `insurance_certificates` envelope proof covers known and unknown types/statuses, missing provider/expiry values, and tag classes. Back link, upload form action, auth handoff, validation redirects, upload success redirect, and API-failure redirect use `urlFor()`/`res.locals.urlFor`. The route and Profile-settings link fail closed on Laravel bootstrap `compliance.insurance_enabled`; disabled and missing states return 404 for GET and CSRF-valid POST without list/upload API calls. The ASP.NET readiness audit rejects a 200 bootstrap that omits this Boolean contract. Live upload/list behavior remains uncertified because the member API exposes no residue-free delete, while manual assistive-technology depth and full ASP.NET runtime compatibility remain open. |
| Matches index and board | `views/matches.blade.php`, `views/connections-matches-board.blade.php`, `AlphaController::matches()`, `ConnectionsMatchesParity::connectionsMatchesBoard()`, `AlphaController::dismissMatch()`, `ConnectionsMatchesParity::connectionsDismissMatch()` | `src/routes/matches.js`, `src/views/matches/index.njk`, `src/views/matches/board.njk`, `src/lib/api.js` | Partial. Signed `/matches` and `/matches/board` call Laravel `/api/v2/matches/all`, retain listing, group, volunteering, and event recommendations, and render Blade's metrics, source filters, cards, match reasons, empty states, and listing-only no-JS dismiss forms. Titles, descriptions, captions, statistics, source/module/type labels, actions, status outcomes, fallbacks, and locale-aware board timestamps use the exact Laravel catalogs. The two inferred location/preferences warnings absent from both Blade views were removed, and compact index cards no longer invent descriptions. Focused render/action proof passed `15/15`; full Jest passed `45/45` suites and `1,501/1,501` tests, with green lint and the 290-template zero-match audit. Laravel's dismiss endpoint still cannot cover event or volunteering recommendations. Tenant/module gates, safe live dismiss persistence, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Exchange list/detail/actions | `views/exchanges.blade.php`, `views/exchange-detail.blade.php`, `AlphaController::exchanges()`, `exchange()`, `storeExchangeAction()`, `storeExchangeRating()` | `src/routes/exchanges.js`, `src/views/exchanges/*.njk` | Partial. Signed `/exchanges` and `/exchanges/{id}` call Laravel-compatible config/list/detail/rating endpoints and render the Blade-style tabs, cards, role-aware actions, review form, ratings, and timeline. Default-English descriptions, filters, counts, empty/disabled/error states, role/status/risk labels, detail summaries, actions, review content, ratings, and timeline content now use the exact Laravel catalog; the stale invented load failure is replaced by the shared localized service-unavailable contract. The rating select starts with Blade's disabled `Choose a rating` choice so no score is submitted without an explicit selection. Accept/decline/start/complete/confirm/cancel and rating POSTs use the exposed v2 endpoints, with tenant-aware links and redirects. Focused exchange/template proof passed `139/139`, the current rendered rating-choice proof passed `1/1`, full Jest passed `52/52` suites and `1,672/1,672` tests, and lint plus the 322-template zero-match audit are green. The API ignores Blade's `prep_time`, exposes no dependable idempotency/uniqueness boundary for repeat no-JS submissions, and differs from the Blade service's rating/attention semantics. Participant authorization, tenant/module gates, safe live mutation proof, current broad runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Group exchange list/create/detail | `views/group-exchanges.blade.php`, `views/group-exchange-create.blade.php`, `views/group-exchange-detail.blade.php`, `AlphaController::groupExchanges()`, `createGroupExchange()`, `groupExchange()` | `src/routes/group-exchanges.js`, `src/views/group-exchanges/*.njk`, `src/lib/api.js` | Partial. Signed `/group-exchanges`, `/group-exchanges/new`, and `/group-exchanges/{id}` redirect unsigned users to `/login?status=auth-required`, follow the tenant `group_exchanges` feature gate, call Laravel-compatible group-exchange and user-search APIs, and render Blade-style status tabs, create form, detail metadata, participant table, confirmation controls, organiser add-person search, complete, and cancel forms. All Laravel-owned list/create/detail titles, captions, descriptions, filter/status labels, table/summary labels, participant roles/states/actions, form fields/hints, warnings, and success/error outcomes now use the request-locale `group_exchanges` catalog; known statuses are translated while Laravel's headline fallback is preserved for extended statuses absent from that catalog. The caption now uses the shared request `tenantName`, fixing a live `undefined` leak exposed by browser proof. All local links/forms/redirects stay mount-safe through `urlFor()`/`res.locals.urlFor`. Focused English/Arabic family tests passed 2/2, a real authenticated Arabic Laravel-backed list/create journey passed exact catalog markers, non-empty captions, RTL, 320px reflow, and axe on both pages in 37.2 seconds, and full Jest is 1,419/1,419 with green lint/template audit. Laravel's Arabic `filter_label` remains English-identical in the read-only source and is intentionally not invented here. Full organiser/participant authorization and mutation depth, same-tenant member-search parity, a live detail fixture, exact visual/manual parity, a fresh full current-source browser aggregate, and ASP.NET backend compatibility remain uncertified. |
| Wallet overview/manage, transfers, donations, and exports | `views/wallet.blade.php`, `views/wallet-manage.blade.php`, `AlphaController::wallet()`, `AlphaController::transferCredits()`, `AlphaController::exportTransactions()`, `AlphaController::walletRecipients()`, `WalletParity::walletManage()` | `src/routes/wallet.js`, `src/views/wallet/index.njk`, `src/views/wallet/manage.njk`, `src/lib/api.js` | Partial. Signed `/wallet` now loads and renders Laravel's time-wallet balance/earned/spent/pending summary, community fund, member search and transfer forms, community-fund-only donation form, not-money/final warnings, CSV export, all four transaction filters, and contextual four-column history. The raw member-ID donation UI and local credits presentation were removed. Its v2 cursor continuation now matches Blade's applicable non-block pagination structure, `Transaction history` landmark, `Next` title, anchor, and directional icon while preserving the selected filter. `/wallet/manage` renders the enhanced balance, recipient transfer, and fund/member donation hub. Both pages use exact `wallet`, `wallet_t1`, and `govuk_alpha_wallet` keys, request-locale hours/dates, normalized transaction directions, and localized member fallbacks. The signed Arabic traversal of both passed RTL/reflow/axe, and the fresh aggregate matrix passed 53/53. Each transfer form carries a UUID and Blade's required irreversible-transfer confirmation checkbox, and POST `/wallet/transfer` sends Laravel's exact payload; current focused rendered/source confirmation proof passes `2/2`. Nested errors and onboarding redirects remain tenant-aware, `/wallet/recipients` returns suggestions, and `/wallet/export.csv` streams the statement. Live recipient privacy, transfer/replay/donation persistence, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Saved items and collections | `views/saved.blade.php`, `SavedCollectionsParity`, `views/saved-collections.blade.php`, `views/saved-collection-detail.blade.php`, `views/saved-public-collections.blade.php`, `views/saved-appreciations.blade.php` | `src/routes/saved-social.js`, `src/routes/saved-collections.js`, `src/views/saved/index.njk`, `src/views/saved-collections/*.njk`, `src/views/saved-social/*.njk`, `src/lib/api.js` | Partial. Signed saved-family GETs redirect unsigned users to `/login?status=auth-required` and call Laravel-compatible bookmark, collection/items, public-collection, and appreciation endpoints. Saved list, collection index/detail, public collections, and appreciation now use the exact source catalog for visible and assistive copy, locale plurals/types, validation/status states, empty states, forms, pagination, 500-character appreciation contract, and reaction pressed/action semantics. Public collection cards use Blade's exact body typography and `#6366f1` fallback swatch while preserving valid six-digit colours. Titleless bookmarks render only Blade's translated type tag and removal control rather than an invented duplicate type-as-title or empty link. Collection-detail navigation now follows Blade's exact supported item map: listing, event, job, group, and plain Feed for posts; unsupported article, resource, and marketplace types remain readable unlinked text. The invented saved-removal banner and JavaScript English count/type/status labels were removed. POST aliases for collection CRUD/item removal, appreciation send, and reaction call Laravel v2 endpoints with matching tenant-aware status redirects. Appreciation sends preserve Laravel v2's `SAFEGUARDING_CONTACT_RESTRICTED` and `SAFEGUARDING_POLICY_UNAVAILABLE` codes as Blade's distinct restricted/unavailable statuses and accessible policy messages instead of collapsing them to a generic failure. Flat saved removal now uses Blade's exact BookmarkController toggle contract rather than the SOC10 saved-item DELETE boundary. The current disposable Laravel gate passed `2/2` in `1.7` minutes: it created/updated/deleted a unique collection, added a real listing item and removed it through the visible Web UK form with API absence proof, then added and removed a flat bookmark while preserving its initial state. Collection pages passed 320px structure/reflow and serious/critical axe checks, and no fixture remained. The source namespace itself remains wholly English outside English. Appreciation mutations, tenant feature gates, manual assistive-technology evidence, and ASP.NET backend compatibility are not certified. |
| Help centre and trust safety pages | `views/help.blade.php`, `views/trust-safety.blade.php`, `AlphaController::help()`, `AlphaController::trustSafety()`, `Api\HelpController`, `App\Helpers\HtmlSanitizer` | `src/routes/support.js`, `src/views/support/*.njk`, `src/lib/api.js`, `src/lib/html-sanitizer.js` | Partial. Public `/help` calls Laravel-compatible `/api/v2/help/faqs` with the search query and renders Blade-style localized caption, search, grouped GOV.UK accordions, empty/no-result states, and contact CTA. Backend-authored FAQ answers now pass through a Laravel-aligned CMS HTML allowlist before Nunjucks renders them, preserving supported formatting while stripping scripts, event handlers, unsafe URL schemes, and unsupported attributes; `_blank` links receive `noopener noreferrer`. `/trust-and-safety` renders the Blade warning, exchange/safety/vetting/insurance/dispute/responsibility/rights sections, contact CTA, and guidelines link. Both pages resolve exact request-locale catalog copy, including all nine safety-section arrays. Focused sanitizer rendering and the complete 52-suite, 1,674-test non-mutating gate pass. Backend-authored FAQ translation governance, tenant-domain/feature-gate depth, broader FAQ admin/runtime states, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Legal hub, documents, and accessibility statement | `views/legal-hub.blade.php`, `views/legal-document.blade.php`, `views/accessibility.blade.php`, `AlphaController::legalHub()`, `legalDocument()`, `accessibility()`, `Api\LegalController` | `src/routes/legal.js`, `src/views/legal/*.njk`, `src/lib/api.js` | Partial. Public `/legal` renders the Blade card list, `/accessibility` renders the Blade statement with its limitations and feedback route, and five legal document routes call Laravel-compatible `/api/v2/legal/{type}` before rendering managed title/content/version metadata or fallback policies. Hub cards, fallback indexed/keyed collections, notices, metadata labels, retained accessibility copy, and shell titles use request-locale Laravel catalog data. The feature/testing sections and `accessibility.commitment_body` are deliberately withheld under the 2026-07-15 safety deviation above because their keyboard/screen-reader assurances exceed the current manual evidence; this is open source-copy parity, not a completed exact-content row. Managed legal HTML/title remains backend-authored and dates use locale formatting. Focused managed/fallback/Arabic coverage passed after the suppression; older real Laravel-backed Arabic RTL/reflow/axe and aggregate Jest/browser results remain dated checkpoints, not current-local aggregate proof. Acceptance prompts, version history/compare links, accessibility-copy source reconciliation, broader live managed/fallback permutations, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Knowledge base index/detail | `views/kb-index.blade.php`, `views/kb-article.blade.php`, `AlphaController::kb()`, `AlphaController::kbArticle()`, `Api\KnowledgeBaseController` | `src/routes/kb.js`, `src/views/kb/*.njk`, `src/lib/api.js` | Partial. Signed `/kb` and `/kb/{id}` use Laravel-compatible `/api/v2/kb`, `/api/v2/kb/search`, and `/api/v2/kb/{id}` with the member's bearer token; unsigned requests use the mounted auth-required redirect. Default structure and catalog copy cover search, cards, metadata, sanitized body, related links, plural view labels, Blade's literal backend date substring, and the localized missing-article response. Current focused route proof is 2/2; the immediately preceding complete gate passes 51/51 suites and 1,668/1,668 tests. Feedback mutations, attachments/downloads, admin editing, broader live behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Onboarding wizard | `views/onboarding.blade.php`, `AlphaController::onboarding()`, `onboardingStep()`, `onboardingStepPost()`, `onboardingAvatar()`, `OnboardingController` | `src/routes/onboarding-posts.js`, `src/views/onboarding/index.njk`, `src/lib/api.js` | Partial. Unsigned requests redirect to `/login?status=auth-required`; signed-in `/onboarding` redirects to the first Laravel-configured active step, completed members redirect to the dashboard, and `/onboarding/{step}` renders the Blade-style welcome/profile/interests/skills/safeguarding/confirm wizard from Laravel v2 onboarding status/config/categories/safeguarding APIs plus the profile API. POST aliases store category choices in the Express session, save bio through Laravel `PUT /api/v2/users/me`, preserve Laravel Blade `safeguarding[id]` fields before Express body parsing compacts them, proxy multipart avatar uploads through Laravel `POST /api/v2/users/me/avatar`, and submit confirm to Laravel `/api/v2/onboarding/complete`. Exact helper tests lock both methods and paths, while route tests prove the trimmed bio and multipart file payloads reach those helpers. Onboarding wizard step form actions and confirm-page change links now route through `urlFor()` with source regression coverage for tenant-aware shared mounts and custom-domain child paths. Exact tenant captions, server-side tenant category validation on GET, live upload runtime behavior, localization beyond English strings, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Volunteering landing | `views/volunteering.blade.php`, `AlphaController::volunteering()` | `src/server.js`, `src/middleware/tenant-feature-gates.js`, `src/views/volunteering.njk`, `src/lib/api.js` | Partial. Caption, lead, organisation browse link, five-step how-it-works inset, guest organisation door/auth notice, filters, opportunity cards, empty/error states, and cursor continuation use Laravel's default-English catalog. The filter uses Blade's named category select and cards expose only View details. Signed requests load Applications, hours summary, member organisations, categories, recommended shifts, and public community projects. The gateway renders three one-decimal hour metrics, eight tool links, role/status-aware organisation doors, Blade's inline section navigation, and source-equivalent long recommended-shift dates and times. Populated recommended/project fixtures have focused render coverage. A real signed three-section Laravel traversal passed `1/1` in `53.5` seconds with 320px structure/reflow/axe. When the tenant disables Volunteering, exact `/volunteering` now retains the fail-closed 403 while rendering Blade's localized disabled banner without calling any module API; deeper Volunteering/Organisation routes remain behind the generic tenant gate. Live owner/pending organisation fixtures, non-empty application/recommendation/project data, manual assistive-technology review, and ASP.NET compatibility remain open. |
| Volunteering opportunity detail | `views/volunteer-opportunity.blade.php`, `AlphaController::volunteerOpportunity()` | `src/server.js`, `src/routes/volunteering-actions.js`, `src/views/volunteer-opportunity.njk` | Partial. Public detail reads Laravel `/api/v2/volunteering/opportunities/{id}` and renders the Blade back link, result/safeguarding states, caption, title, remote tag, multiline description, organisation panel, exact summary fields, shifts, capacity, auth-required sign-in/register actions, already-applied state, inline signed apply form, and approved-applicant signup/cancel/full controls. Apply and shift POST aliases use Laravel methods/paths and now preserve policy-unavailable, interaction-restricted, and vetting failures instead of collapsing them to generic errors. Focused unsigned, signed, approved-applicant, status-render, API-action, and safeguarding-redirect proof passes. Live apply remains intentionally uncertified because it sends an organiser notification that withdrawal does not remove; a residue-free opportunity/organiser fixture is required. Populated live detail/shift state, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Volunteering accessibility needs | `views/volunteering-accessibility.blade.php`, `AlphaController::volunteerAccessibility()`, `VolunteerCommunityController::updateAccessibilityNeeds()` | `src/routes/volunteering-actions.js`, `src/views/volunteering/accessibility.njk`, `src/lib/api.js` | Partial. Signed GET redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/volunteering/accessibility-needs`, and renders the Blade-style back link, success/error status states, need type checkboxes, description, adjustments, emergency contact fields, and no-JS save form. POST now filters to Laravel's allowed need types and sends the API's required `needs[]` row envelope; the previous flat payload was accepted but silently cleared all needs. A current guarded Laravel lifecycle passed `1/1` in `54.4` seconds: capture the exact existing rows, save two distinct needs through Web UK, prove redirected render and API persistence, pass 320px structure/reflow/axe, and restore the exact original rows through the API in `finally`. The login helper now avoids coupling its action timeout to a slow dashboard navigation while retaining separate POST and load-state assertions. Tenant feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Volunteering certificates | `views/volunteering-certificates.blade.php`, `AlphaController::volunteeringCertificates()`, `AlphaController::downloadVolunteerCertificate()`, `VolunteerCertificateController::certificateHtml()` | `src/routes/volunteering-actions.js`, `src/views/volunteering/certificates.njk`, `src/lib/api.js` | Partial. Signed GET redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/volunteering/certificates`, and renders the Blade-style back link, success/no-hours status states, generate form, catalog-backed load-error summary, empty state, certificate cards, period/generated/code metadata, organisation hour breakdown, and local download links. All visible certificate copy and composed hours/organisation labels use the exact Laravel `govuk_alpha.vol_depth` keys. Back, generate, and download controls route through `urlFor()`. Download first checks the requested code against the signed-in member's certificate list, then streams Laravel printable HTML from `/api/v2/volunteering/certificates/{code}/html` with the Blade-style inline filename; focused render, ownership, headers, and body proof passes. Live generation remains uncertified because its persistence semantics and residue-removal path are not established. Tenant feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Volunteering opportunity create | `views/volunteering-create-opportunity.blade.php`, `VolunteeringParity::volunteeringCreateOpportunity()`, `volunteeringStoreOpportunity()` | `src/routes/volunteering-actions.js`, `src/views/volunteering/create-opportunity.njk`, `src/lib/api.js` | Partial. Signed GET redirects unsigned visitors to `/login?status=auth-required`, reads `/api/v2/volunteering/my-organisations?per_page=50`, merges and de-duplicates Laravel's current `volunteering` plus legacy `volunteer` category types, filters to approved/active owner-admin organisations, and renders the exact Blade back link, validation/status summary, no-org inset, fields, visibility controls, and submit action. POST trims and validates required fields, submits Laravel's full shape, and now maps the federation checkbox to the service's accepted `listed`/`none` values instead of silently discarded `network`/`local`. API `FORBIDDEN`, `NOT_FOUND`, and `VALIDATION_ERROR` codes retain the exact Blade result states. Focused category merge/deduplication, manager filtering, render, payload, and error-code proof passes. Live creation remains uncertified because it creates a durable opportunity and dispatches notifications without a proven residue-free fixture. Tenant feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Volunteering credentials | `views/volunteering-credentials.blade.php`, `VolunteeringParity::volunteeringCredentials()`, `VolunteerCertificateController::myCredentials()` | `src/routes/volunteering-actions.js`, `src/views/volunteering/credentials.njk`, `src/lib/api.js` | Partial. Signed GET redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/volunteering/credentials`, and renders the Blade-style upload form, result states, credential table, safe download links, and delete forms. The default-English contract uses Laravel's catalog; retired vetting evidence stays hidden/removal-only and unsupported historical types stay manual-review-only. A disposable Laravel gate passed `1/1` in `54.9` seconds by uploading a uniquely named PDF, verifying its pending render and 320px structure/reflow/axe, downloading it through Web UK with byte equality, deleting it, and proving final absence. Focused security/render/download proof and full Jest (`45/45`, `1,458/1,458`) pass with green lint and the 285-template zero-match audit. Tenant feature gates, manual assistive-technology review, and ASP.NET compatibility remain open. |
| Volunteering hours | `views/volunteering-hours.blade.php`, `AlphaController::volunteeringHours()`, `storeVolunteeringHours()`, `VolunteerController::myHours()`, `hoursSummary()`, `myApplications()`, `myOrganisations()` | `src/routes/volunteering-actions.js`, `src/views/volunteering/hours.njk`, `src/lib/api.js` | Partial. Signed GET redirects unsigned visitors to `/login?status=auth-required` and calls Laravel-compatible hours summary, hours list, approved applications, and my-organisations endpoints. The complete default-English surface now uses the exact `govuk_alpha` catalog for navigation, statuses, title, auto-credit guidance, three statistics, interpolated goal progress, organisation/month tables, log-hours form/hints/selectors, recent logs, status trail, and approved/pending notes. POST sends Laravel's organisation, optional opportunity, date, decimal hours, and description shape to `/api/v2/volunteering/hours`; focused render and payload proof passes. Live persistence remains uncertified because an hours log has no member cleanup endpoint and may trigger organisation review/credit side effects. Tenant feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Volunteering organisation owner pages | `views/volunteering-org-dashboard.blade.php`, `views/volunteer-org-manage.blade.php`, `views/volunteering-org-settings.blade.php`, `views/volunteering-org-volunteers.blade.php`, `views/volunteering-org-wallet.blade.php`, `VolunteeringParity`, `AlphaController::manageVolunteerOrg()`, `VolunteerController` owner endpoints | `src/routes/volunteering-actions.js`, `src/views/volunteering/org-dashboard.njk`, `org-manage.njk`, `org-settings.njk`, `org-volunteers.njk`, `org-wallet.njk`, `src/lib/api.js` | Partial. Signed GETs redirect unsigned visitors to `/login?status=auth-required`, call Laravel owner-scoped stats, applications, pending-hours, volunteers, wallet summary, wallet transactions, and organisation detail endpoints, and render Blade-style dashboard stats, quick links, management review cards/forms, settings form, volunteers table, wallet auto-pay/deposit forms, transaction table, pagination, and status banners. The default-English volunteer roster now matches Blade's catalog-backed back link, XL organisation caption, description, empty hints, exact Name/Email/Total hours/Roles/Joined headers, two-decimal hours, semantic joined `<time>`, unknown-member fallback, and load-more copy. Focused owner-page proof passed, full Jest remained `45/45` and `1,456/1,456` with green lint/template audit, and a signed Laravel-backed roster passed a focused `1/1` 320px structure/reflow/axe gate in `26.5` seconds. This is not represented as a newer full aggregate. Live owner authorization variations, tenant feature gates, remaining owner-page localization and persistence, manual assistive-technology review, and ASP.NET backend compatibility are not certified. |
| Organisations directory | `views/organisations.blade.php`, `AlphaController::organisations()`, `storeOrganisation()` | `src/server.js`, `src/views/organisations.njk`, `src/lib/api.js` | Partial. GET `/organisations` follows Blade's protected-route intent, redirects unsigned visitors to `/login?status=auth-required`, and reads Laravel `/api/v2/volunteering/organisations`. The complete default-English page now uses exact `govuk_alpha.organisations` and `govuk_alpha_organisations` catalog copy and structure for caption, navigation, status states, search, cards, empty/failure state, embedded registration guidance, fields, terms, and pending notice; descriptions use Blade's 160-character limit. The embedded POST validates the required identity/terms contract, submits to Laravel, preserves submitted values across its coarse invalid/failure redirect, and keeps all navigation/results tenant-safe. Focused render, unavailable-data, validation replay, auth, and payload proof passes. Live registration remains uncertified because it creates a durable pending organisation without a residue-free delete path. Feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Organisations browse | `views/organisations-browse.blade.php`, `OrganisationsParity::organisationsBrowse()` | `src/server.js`, `src/views/organisations-browse.njk` | Partial. GET `/organisations/browse` redirects unsigned visitors to `/login?status=auth-required` and reads Laravel's directory plus signed-in `my-organisations` contracts. Default-English caption/title/description, error summary, plain action links, search form, empty states, count, small card headings, truncated descriptions, inline semantic stats, rating progress, website marker, view action, and block cursor pagination now use the exact Blade structure and `govuk_alpha_organisations` catalog. The Manage link appears only for active/approved owner/admin rows and a failure of that secondary API does not suppress the directory. Focused success/empty/partial-failure proof passed `2/2`; full Jest passed `45/45` suites and `1,455/1,455` tests with green lint and zero conservative template-localization matches. A current-source signed Laravel page check returned `200` with `Browse organisations`; the harness remained globally red only because its independent anonymous Laravel API preflight receives the known `401`. Feature-gate and populated live-fixture depth, manual visual/assistive-technology review, the two newly added Laravel safeguarding routes, and ASP.NET backend compatibility are not certified. |
| Organisations register | `views/organisations-register.blade.php`, `OrganisationsParity::organisationsRegisterForm()`, `organisationsRegister()` | `src/server.js`, `src/views/organisations-register.njk`, `src/lib/api.js` | Partial. GET `/organisations/register` redirects unsigned visitors to `/login?status=auth-required`; the form now uses the exact default-English organisations catalog for its title, caption, fields, hints, terms, validation summary, controls, and pending notice. POST trims and validates Laravel's status-key contract, submits to `/api/v2/volunteering/organisations`, uses tenant-aware result redirects, and replays all submitted values after field or API failure like Blade's `withInput()`. Focused render, validation replay, payload, and auth proof passes. Live persistence remains uncertified because registration creates a durable pending organisation with no residue-free delete path. Feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Organisations manage | `views/organisations-manage.blade.php`, `OrganisationsParity::organisationsManage()` | `src/server.js`, `src/views/organisations-manage.njk`, `src/lib/api.js` | Partial. GET `/organisations/manage` redirects unsigned visitors to `/login?status=auth-required`, loads `/api/v2/volunteering/my-organisations`, and now uses the exact default-English organisations catalog for the caption, description, load error, empty state, role labels, active owner/admin actions, and pending cards. Focused role/filter/render/auth proof passes. Broader live owner/admin/member tenant variants, feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Organisation detail | `views/organisation-detail.blade.php`, `AlphaController::organisation()` | `src/server.js`, `src/views/organisation-detail.njk`, `src/lib/api.js` | Partial. GET `/organisations/{id}` redirects unsigned visitors to `/login?status=auth-required` and combines Laravel's tenant-scoped organisation, opportunities, and reviews contracts. The signed page now matches Blade's exact default-English catalog for navigation, caption, contact metadata, external-link notice, feature-gated jobs action, statistics, localized number/rating presentation, opportunity cards/actions, review author fallback, and review ratings. The jobs action is hidden when `job_vacancies` is disabled. Focused populated, auth, and disabled-feature proof passes. Populated live-fixture breadth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Organisation jobs | `views/organisations-jobs.blade.php`, `OrganisationsParity::organisationsJobs()` | `src/server.js`, `src/views/organisations-jobs.njk` | Partial. GET `/organisations/{id}/jobs` redirects unsigned visitors to `/login?status=auth-required`, proves the tenant-scoped volunteering organisation exists, and renders Blade's exact catalog-backed empty jobs placeholder. Web UK no longer passes the volunteering-organisation ID into `/api/v2/jobs?organization_id=...`: current Laravel documents that job vacancies use a separate organisations table and deliberately does not cross those identifier domains. Focused regression proof asserts the jobs API is not called. Enabled `volunteering` plus `job_vacancies` feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Organisation opportunity apply | `views/organisations-apply.blade.php`, `views/volunteering.blade.php`, `OrganisationsParity::organisationsApplyForm()`, `AlphaController::volunteering()`, `AlphaController::applyVolunteerOpportunity()` | `src/server.js`, `src/views/organisations-apply.njk`, `src/views/volunteering.njk`, `src/routes/volunteering-actions.js`, `src/lib/api.js` | Partial. GET `/organisations/opportunities/{id}/apply` redirects unsigned visitors to `/login?status=auth-required`, loads the signed viewer-aware opportunity, and now uses the exact default-English organisations catalog for the caption, summary, already-applied state, message form, notice, and controls. The signed gateway reads Laravel `/api/v2/volunteering/applications` and renders the source's default-English Applications tab, status filter, source-shaped cards, absolute applied date, pagination, empty state, and pending withdraw forms; existing POST aliases use Laravel's apply and withdraw contracts. Focused render proof passed, and the real authenticated three-section gateway journey passed `1/1` in `53.5` seconds with 320px structure/reflow/axe. Live apply/withdraw was not run because applying to another user's shared fixture emits an organiser notification that withdrawal does not remove; a residue-free organisation/opportunity fixture is still required. Feature-gate depth, non-empty live application states, manual assistive-technology review, and ASP.NET compatibility remain open. |
| Contact and problem reporting | `views/contact.blade.php`, `views/report-problem.blade.php` | `src/views/contact.njk`, `src/views/report-problem.njk`, `src/routes/contact-support.js` | Partial. Contact GET/POST and report-problem GET/POST use Blade-style forms, Laravel status keys, no-JS validation redirects, signed-out report-to-contact prefill, and Laravel `/api/v2/contact` plus `/api/v2/support/reports` submissions. Contact and signed report-problem titles/captions/fields/options/prefill/validation/status/success copy use exact request-locale Laravel keys. Focused Contact and report coverage passed 12 tests total; live Arabic invalid-submission round trips passed for public Contact (16.3 seconds) and authenticated Report-a-Problem (14.1 seconds), including RTL/reflow/axe without calling either mutation API; and the 1,410/1,410 Jest plus 61/61 browser gates are green. Links and redirects remain tenant-safe through `urlFor()`. Safe live successful submissions, production Turnstile/rate-limit outcomes, report reference/notification side effects, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Feed hashtag pages and item permalinks | `views/feed.blade.php`, `views/feed-hashtags.blade.php`, `views/feed-hashtag.blade.php`, `views/feed-post.blade.php`, `views/feed-item.blade.php`, `partials/feed-comments.blade.php`, `AlphaController::feed()`, `feedHashtagsDiscovery()`, `feedHashtag()`, `feedPost()`, `feedItemDetail()`, feed social APIs | `src/routes/feed.js`, `src/views/feed/*.njk`, `src/lib/api.js` | Partial. GET `/feed` matches Blade's public shell: unsigned requests render the filter/auth/empty-state page without calling the protected collection API, while signed requests can render normalized Laravel feed rows. Signed rows now use Blade's `nexus-alpha-card-list`/`nexus-alpha-card` presentation, type-coloured tags, title and avatar/date metadata, self-describing typed-module action buttons, plain engagement totals, and GOV.UK secondary like controls with preserved filters; the former legacy `app-post` card layer is gone. Hashtag discovery/detail remain public and use the exposed v2 hashtag APIs. Their caption, headings, search controls, result/empty states, counts, card metadata, status banners, paging action, and image fallbacks use the exact request-locale Laravel keys and Blade hierarchy; signed hashtag cards restore Blade's like/love/celebrate reaction controls and active reaction/count state. Signed post rows and permalinks preserve viewer reaction, share, bookmark, share-count, and owner identity state and expose Blade-aligned like/love/celebrate, share/unshare, save/unsave, owner edit/delete, and own-comment reaction/edit/delete controls. Main-feed post reactions now announce the aggregate count, expose selected state through `aria-pressed`, and preserve active filters/cursor; share/save controls likewise expose pressed state, carry a hidden post label, and preserve the same round-trip state. Signed non-owner feed cards also expose Blade's existing moderation details for hide, author mute, and required-reason report, preserving the typed target and tenant mount; owner cards suppress those controls. Poll rows now consume Laravel's embedded `poll_data`: active unvoted polls render the Blade radio/submit workflow with preserved feed filters, while voted or closed polls render localized vote counts, rounded percentages, accessible progress labels, selected-choice state, and the exact terminal status. Commentable feed cards now use Laravel's per-target comment reads and the shared recursive renderer for populated and empty states, nested replies, reactions, owner controls, and add-comment forms; read failures degrade to empty like Blade's guarded source. Main-feed media links now match Blade's secured new-tab behavior, hidden announcement, image class, and overflow marker, and owner deletion uses the GOV.UK warning component with its accessible warning prefix. Both permalink types use the exact request-locale Laravel keys for their captions, headings, status/auth copy, author/date metadata, item type and engagement labels, new-tab text, comment heading/empty state/form, and unknown-author fallback. A shared recursive comment renderer now matches Blade's nested list, four-level reply ceiling, avatar/date metadata, reaction counts and active viewer state, reply forms, and owner-only edit/delete controls on both post and polymorphic item permalinks. The polymorphic item page also restores Blade's reaction forms and exact not-interested guidance. Feed `post-empty` and `post-failed` states now use Blade's field-linked error summary, inline error, textarea styling, and ARIA relationship; other action failures use the localized Blade title instead of `Important`. Focused three-state proof passes `1/1`, and the current complete non-mutating gate passes 52/52 suites and 1,695/1,695 tests. Blade declares `/feed/posts/{id}` and `/feed/item/{type}/{id}` public, but Laravel's v2 permalink payload endpoints require a bearer token, so Web UK preserves a public 200 document with an honest sign-in/unavailable state on API 401 instead of fabricating content. Live lifecycle certification is currently blocked by the read-only Laravel runtime/schema: both `/api/v2/feed` and `/api/v2/feed/posts/{id}` return 500 because `events.publication_status` is absent, while disposable create/delete probes and comment reads remain healthy; all probe posts were deleted and read-only residue checks report zero matching posts/activities. Tenant module gates, broad runtime behavior, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Auth aliases | `views/forgot-password.blade.php`, `views/reset-password.blade.php`, `views/two-factor.blade.php`, `views/email-verify.blade.php`, `views/newsletter-unsubscribe.blade.php` | `src/views/forgot-password.njk`, `src/views/reset-password.njk`, `src/views/login.njk`, `src/views/public-info/email-verify.njk`, `src/views/public-info/newsletter-unsubscribe.njk`, `src/routes/auth.js`, `src/routes/public-info.js` | Partial. Laravel accessible aliases `/login/forgot-password`, `/password/reset`, `/login/two-factor`, and `/login/resend-verification` route to local handlers with matching form actions/status redirects. The forgot-password success state matches Blade's standalone one-H1 confirmation page with large detail copy, mounted resend/sign-in links, and no retained request form or notification banner; its ordinary state restores the source back link and large lead paragraph. Empty or malformed addresses retain Blade's linked email error without calling Laravel, while rate limiting remains a page-level summary and does not falsely mark the email field invalid. Tokenless GET `/password/reset` remains renderable like Blade; reset submissions use Laravel's exact password payload. The two-factor login state accepts alphanumeric backup codes, renders Blade's backup-code choice, conditionally renders Laravel's trusted-device choice and configured duration, submits both Boolean flags to the exact verification contract, and refuses posted trust when the login response disables it. Its top back link, lead copy, code-linked error summary, inline error, and ARIA descriptions now follow Blade. `/verify-email` and `/newsletter/unsubscribe` render missing, invalid, and success states and call Laravel endpoints for tokens. Their titles, missing/invalid copy, and back action use exact request-locale keys with safe middleware-less English fallbacks. Focused two-factor proof passed `4/4` suites and `1,014/1,014` tests; the complete non-mutating gate passed `49/49` suites and `1,654/1,654` tests with green static/localization checks and a refreshed 19/19 canonical Blade marker comparison. Safe live token and authentication effects, tenant-domain depth, manual assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Marketplace commerce | `views/marketplace*.blade.php`, `AlphaController::marketplace*()`, marketplace parity concerns/controllers | `src/routes/marketplace*.js`, `src/views/marketplace/*.njk`, `src/lib/api.js` | Partial. Browse, detail, create/edit listing, my listings, saved/free/category/search, seller profile, offers, orders, sales, pickups, onboarding, pickup slots, coupons, buy, offer, and report pages render Laravel-backed Blade-style candidates through Laravel v2 marketplace APIs, with POST aliases for listing, offer, order, slot, coupon, and onboarding actions. Accepted-offer and direct checkout both use session-bound idempotency keys and authoritative shipping/pickup reads. Direct checkout now matches Laravel's hybrid cash/time-credit selection, free-shipping filtering, delivery and pickup validation, exact order payload, field-linked errors, old-input replay, option prices, localized slot capacity, and no-delivery suppression; forged keys are rejected before an API order call. Hybrid listings show both prices and detail exposes Buy only for source-supported active fixed, free, or time-credit listings. Buyer collections and seller pickup-slot index/edit now use Blade's exact default-English commerce catalogs, caption hierarchy, buyer statuses, formatted window, QR guidance, table caption, form sections, controls, warnings, and actions instead of the older invented copy. Advanced search now uses Blade's complete catalog, `condition[]` field contract, filter/empty/result hierarchy, and minimal result cards rather than the richer browse card. Listing detail now follows Blade's caption, gallery alternatives/new-tab announcement, multiline description, location label, offer/save controls, seller-message action, and report action; the Web UK-only query-status banner is removed. The offer form and dashboard now use Blade's exact catalog and notification semantics, positive monetary-only asking-price rule, source `is_own` owner guard, localized status/counterparty labels, and one-use bounded input replay for invalid or rejected submissions. Buyer and seller order dashboards now use Blade's exact catalog and notice banners, restrict cancellation to `pending_payment`, restore cancellation warnings, and preserve safeguarding-specific rating failures. Seller coupon list/create/edit now use Blade's exact catalog, hierarchy, banners, table caption, formatting, form IDs, title and positive-discount validation, zero minimum-order handling, one-use local/API-error replay, and pre-API `merchant_coupons` gate. Merchant onboarding uses Laravel's canonical endpoint family and preserves the complete Blade step sequence; listing reports use Blade's field-linked errors and failure destinations. My listings now supplies Laravel's authenticated `user_id` filter, fails closed before collection access when the profile ID is absent, and uses the exact Blade catalog/status/tab/action hierarchy rather than hard-coded and Jobs copy. Focused My listings ownership/render proof passes 2/2; the final full Jest gate passes 49/49 suites and 1,646/1,646 tests, with 7,322 static references, 5,602 unique keys, and zero unresolved or conservative template matches across 322 templates. No live marketplace mutation or database access ran for these refreshes. All historical live side-effect evidence against the ordinary database is invalidated by this ledger's opening correction and must not be rerun there. Hosted checkout lacks a bearer-authenticated API. Merchant profile-image uploads, live order/coupon mutation depth in a separately disposable environment, remaining contextual copy, manual/visual accessibility, and ASP.NET backend compatibility are not certified. |
| Premium billing | `views/premium.blade.php`, `views/premium-return.blade.php`, `views/commerce-premium-manage.blade.php`, `AlphaController::premium*()`, `CommerceParity::premium*()` | `src/routes/premium.js`, `src/views/premium/*.njk`, `src/lib/api.js` | Partial. Signed pricing, manage, and return pages render Laravel-backed member-premium candidates through `/api/v2/member-premium/tiers` and `/api/v2/member-premium/me`; subscribe, portal, and cancel POST aliases call Laravel member-premium endpoints. All three GET surfaces use Laravel's exact request-locale `premium`, `polish_commerce`, and `govuk_alpha_commerce.premium_manage` catalogs for pricing/current-plan/status copy, interval labels, management summary/actions/warnings, and return outcomes. Tiers offering both monthly and yearly prices render Blade's no-JavaScript radio choice instead of silently posting monthly. Prices now match Blade's tenant-currency contract: EUR, USD, and GBP use their source symbols, other valid ISO codes use a code prefix, the fallback is EUR, and dual prices use the same-line middle-dot separator. Links/forms, auth/status redirects, checkout `return_url`, and portal `return_url` remain mount-safe. Focused premium workflow proof passes 6/6, including configured GBP and EUR fallback rendering; the complete non-mutating gate passes 52/52 suites and 1,675/1,675 tests. External Stripe checkout/portal behavior, enabled-tenant persistence, recorded manual parity, and ASP.NET backend compatibility remain uncertified. |
| Courses | `views/courses*.blade.php`, `AlphaController::courses*()`, course parity controllers, `App\Helpers\HtmlSanitizer` | `src/routes/courses.js`, `src/views/courses/*.njk`, `src/lib/api.js`, `src/lib/html-sanitizer.js` | Partial. Browse, detail, certificate, lesson player, my learning, instructor dashboard, create/edit builder, analytics, and grading pages render Laravel-backed Blade-style candidates through Laravel v2 course APIs, with POST aliases for enrolment, reviews, lesson completion, quizzes, instructor course, section, lesson, publish, delete, and grading actions. Course detail strips markup from summaries like Blade, while text lessons preserve only the shared Laravel-aligned CMS HTML allowlist; focused proof covers safe formatting plus removal of scripts and inline handlers. Course tabs, links, forms, actions, auth/error/result redirects, and grading controls are tenant-safe through `urlFor()` and `res.locals.urlFor`. The instructor form and builder use Laravel's exact default-English commerce catalog. A disposable Laravel-backed gate passed `1/1` in `180.6` seconds: course create/read/update, section create/rename/delete, text lesson create/delete, 320px structure/reflow/axe, course delete, final API absence, and independent zero-residue inspection. The current complete non-mutating gate passes 52/52 suites and 1,674/1,674 tests. Publish/moderation, learner enrolment/completion/review effects, instructor-role and tenant-feature variants, residual course-family catalog review, manual assistive-technology depth, and ASP.NET backend compatibility remain open. |
| Podcasts | `views/podcasts*.blade.php`, `PodcastParity` routes/controllers | `src/routes/podcasts.js`, `src/views/podcasts/*.njk`, `src/lib/api.js` | Partial. Browse, detail, episode, studio, create, and manage pages render Laravel-backed candidates through Laravel v2 podcast APIs, with POST aliases for subscribe, show create/update/publish/delete, and episode add/publish/delete including multipart audio upload proxying. Browse consumes current Laravel category/pagination metadata, rejects unknown tenant categories, preserves search/sort/category filters across numeric tenant-safe page links, bounds plain-text card summaries, and applies `no-referrer` to browse/detail artwork. Studio access and show creation controls consume `/mine` capabilities instead of rendering unconditionally, including an explicit denied direct-create state. Create/manage expose Blade's RSS metadata, artwork, visibility, and full episode metadata/cover fields through the current JSON and multipart boundaries. Root-relative artwork, RSS, hosted-audio, and episode-cover URLs now resolve against the configured Laravel origin instead of the separate Web UK host; valid absolute HTTP(S) media remains unchanged. The complete browse/playback and owner surfaces use Laravel's catalogs for default-English page copy, search/sort controls, owner and episode counts, subscription states, accessible audio/download labels, statuses, visibility choices, episode controls, and destructive warnings. Episode visibility selects now mirror Blade's exact catalog mapping: `inherit` uses its episode-specific label while public/member/private use the show visibility labels, preventing nonexistent dynamic keys from leaking into visible option text. Focused default-English render proof passes 1/1, the full Jest gate passes 49/49 suites and 1,637/1,637 tests, and lint/localization/template/CSS/brand gates are green. The historical live owner lifecycle is invalidated by the ledger correction above and must not be rerun against the ordinary database. Publish/moderation, live subscription and media side-effect certification on a separately provisioned disposable Laravel environment, manual assistive-technology depth, and ASP.NET compatibility remain uncertified. |
| Achievements | `views/achievements.blade.php`, `views/gamification-shop.blade.php`, `views/gamification-collections.blade.php`, `views/gamification-engagement.blade.php`, `views/gamification-showcase.blade.php`, `views/gamification-badge.blade.php`, `views/partials/gamification-nav.blade.php`, `AlphaController::achievements()`, `GamificationParity::gamificationShop()`, `GamificationParity::gamificationCollections()`, `GamificationParity::gamificationEngagement()`, `GamificationParity::gamificationShowcase()`, `GamificationParity::gamificationBadgeDetail()` | `src/routes/achievements.js`, `src/views/achievements/index.njk`, `src/views/achievements/shop.njk`, `src/views/achievements/collections.njk`, `src/views/achievements/engagement.njk`, `src/views/achievements/showcase.njk`, `src/views/achievements/badge.njk`, `src/lib/api.js` | Partial. The six-page family reads Laravel-compatible gamification profile, badge progress, reward, challenge, shop, collection, engagement, showcase, and badge-detail contracts; renders the Blade-style navigation, state panels, cards, tables, progress, metadata, and mutation forms; and keeps tenant-aware `urlFor()` navigation and redirect behavior. Contextual titles, navigation, labels, statuses, plural activity counts, XP amounts, warnings, buttons, and empty states now use exact Laravel catalog keys across the overview, shop, collections, engagement, showcase, and badge-detail templates. Focused gamification regressions pass 9/9. Five stable live pages plus a signed Arabic five-page RTL/reflow/axe traversal are included in the green 41/41 Chromium gate. Badge detail remains mock-render certified because the live Laravel fixture exposes no stable earned-badge key; a fabricated `community-builder` key correctly returned 404 and was removed rather than treated as evidence. Exact tenant feature gates, live mutation effects, a disposable real badge-detail fixture, upstream English-identical translations, broader assistive-technology coverage, and ASP.NET backend compatibility remain uncertified. |
| Leaderboard and NEXUS score | `views/leaderboard.blade.php`, `views/gamification-competitive.blade.php`, `views/gamification-seasons.blade.php`, `views/gamification-journey.blade.php`, `views/gamification-spotlight.blade.php`, `views/nexus-score.blade.php`, `views/gamification-tiers.blade.php`, `views/partials/gamification-nav.blade.php`, `AlphaController::leaderboard()`, `AlphaController::nexusScore()`, `GamificationParity::gamificationCompetitive()`, `GamificationParity::gamificationSeasons()`, `GamificationParity::gamificationPersonalJourney()`, `GamificationParity::gamificationSpotlight()`, `GamificationParity::gamificationTierLadder()` | `src/routes/leaderboard.js`, `src/routes/nexus-score.js`, `src/views/leaderboard/index.njk`, `src/views/leaderboard/competitive.njk`, `src/views/leaderboard/seasons.njk`, `src/views/leaderboard/journey.njk`, `src/views/leaderboard/spotlight.njk`, `src/views/nexus-score/index.njk`, `src/views/nexus-score/tiers.njk`, `src/lib/api.js` | Partial. The seven-page family reads Laravel-compatible leaderboard, community-dashboard, season, journey, spotlight, and NEXUS-score contracts and renders the Blade-style navigation, impact grid, filters, rank tables, season cards, journey sections, spotlight cards, score breakdown, insights, and tier ladder. Document titles, navigation, captions, descriptions, filters, metrics, periods, rank/score labels, season states, journey headings, spotlight metadata, breakdown categories, tier names, progress, and statuses now use exact Laravel `govuk_alpha` and `govuk_alpha_gamification` catalog keys. The live gate exposed two valid profile links with empty names; the normalizer now supplies the localized `Community member` fallback and a focused regression fixture guards it. Focused render/source coverage passed 8/8, all seven stable live pages passed, a signed Arabic seven-page traversal passed, and the complete browser matrix passed 49/49. Exact metric formatting for every legacy service type, tenant feature gates, upstream English-identical translations, mutation-free runtime depth, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Reviews | `views/reviews.blade.php`, `views/blogreviews-reviews-list.blade.php`, `views/blogreviews-review-comments.blade.php`, `AlphaController::reviews()`, `BlogReviewsParity::blogReviewsList()`, `blogReviewsReviewComments()` | `src/routes/reviews.js`, `src/views/reviews/index.njk`, `src/views/reviews/list.njk`, `src/views/reviews/comments.njk`, `src/lib/api.js` | Partial. Signed summary/list/discussion pages read Laravel review, comment, and reaction APIs and use the exact `reviews_page` and `govuk_alpha_blogreviews` catalogs. Discussion ownership/reply-depth/warning controls match Blade; review and comment reactions include the exact six emoji choices; validation now renders a field-linked error summary. A reversible default-English Laravel gate passed `1/1` in `225.4` seconds: owner comment create/react/edit/reply, review reaction add/remove restoration, warning delete with reply cascade, 320px structure/reflow/axe, final API absence, and independent zero-comment/null-reaction inspection. Full verification passed 45/45 suites and 1,465/1,465 tests with green lint and the 285-template zero-match audit. Non-owner runtime variants, review creation/deletion and moderation policy depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Core members directory | `views/members.blade.php`, `AlphaController::members()`, `Api\UsersController::index()` | `src/routes/members.js`, `src/views/members/index.njk`, `src/lib/api.js` | Partial. Public `/members` renders the privacy-preserving auth shell without loading protected data. Signed rendering now matches Blade's quick filters, search/sort/order fieldset, plural count, error/empty states, member cards, verification/level/connection and earned-badge tags, localized metrics and profile actions, and offset-based load-more navigation. The former email-bearing table, locally invented empty states, and directory-level connection mutation controls were removed. Focused auth/directory/shared-mount coverage, live signed Arabic four-page member RTL/reflow/axe proof, the 45/45 and 1,401/1,401 Jest gate, and exact-current 54/54 browser matrix passed. Live privacy/visibility variations, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Member profile | `views/profile.blade.php`, `AlphaController::memberProfile()`, `AlphaController::profileForViewer()` | `src/routes/members.js`, `src/views/members/profile.njk`, `src/lib/api.js` | Partial. Signed GET `/members/{id}` consumes Laravel's public profile, user listings, skills, availability, public activity dashboard, block status, endorsements, reviews, gamification, badges, and connection contracts, and renders the Blade identity, activity stats, about, skills/endorsement controls, listings, reviews, recent activity, profile summary, availability, block/unblock, and wallet-transfer structure. Connection transitions use Laravel's single POST `/members/{id}/connection` action contract. Direct messaging, listings, reviews, and wallet controls obey tenant feature/module gates; transfers carry UUID idempotency keys. Own-profile views merge private `/users/me` fields only after the IDs match and suppress every member-to-member action. Exact API-path tests, composed public/own/blocked profile regressions, localized no-JS result-state coverage, a real Laravel-backed Arabic five-page RTL/reflow/axe traversal, and the browser matrix passed. The reversible live gate now certifies persisted connection request/cancel and block/unblock effects with final no-connection/no-block restoration. Remaining gaps are disposable privacy and endorsement variants, localization of backend-generated activity descriptions, pixel/manual assistive-technology review, and ASP.NET backend compatibility. |
| Members discovery | `views/members-discover.blade.php`, `AlphaController::membersDiscover()`, `Api\UsersController::index()` | `src/routes/members.js`, `src/views/members/discover.njk`, `src/lib/api.js` | Partial. Signed GET `/members/discover` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/users?sort=communityrank`, and renders the Blade-style recommended-members page with back link, community caption, filter navigation, search form, localized plural result count, member cards, CommunityRank progress, profile links, and load-more link. Visible copy, dynamic member metrics and fallbacks, connection/verification/level tags, progress and pagination ARIA, errors, and empty states use exact Laravel catalog keys. Blank identities receive Laravel's localized unknown-member fallback, and connection states match Laravel's blue/yellow/purple semantics. Focused English/Arabic render coverage, live signed Arabic RTL/reflow/axe proof, the 45/45 and 1,401/1,401 Jest gate, and the full 54/54 browser matrix passed. Laravel's server-side ranking-enabled state is not exposed by the bearer member-list contract, so its disabled-recommendations inset remains an explicit source-contract gap. Live ranking configuration changes, tenant feature gates, manual assistive-technology proof, insights linkage, and ASP.NET backend compatibility are not certified. |
| Members nearby | `views/members-nearby.blade.php`, `AlphaController::membersNearby()`, `Api\UsersController::nearby()` | `src/routes/members.js`, `src/views/members/nearby.njk`, `src/lib/api.js` | Partial. Signed GET `/members/nearby` redirects unsigned visitors to `/login?status=auth-required`, reads the signed-in profile location, calls Laravel-compatible `/api/v2/members/nearby`, and renders the Blade-style nearby-members page with back link, community caption, filter navigation, no-location inset, radius/search form, distance cards, profile links, and load-more link. The document, filters, controls, states, cards, dynamic member fields, ARIA, and pagination use Laravel's exact catalog keys; radius options and locale-formatted one-decimal distances match Blade, and connection-state colours share the corrected discovery semantics. Focused render and live signed Arabic two-directory RTL/reflow/axe coverage passed, along with the 45/45, 1,401/1,401 Jest gate and exact-current 54/54 browser matrix. The live fixture proves the no-location state; populated distance cards remain mock-certified to avoid changing shared user data. Tenant feature gates, live privacy/visibility depth, disposable location fixtures, manual assistive-technology proof, and ASP.NET backend compatibility are not certified. |
| Members insights | `views/members-insights.blade.php`, `AlphaController::membersInsights()`, `Api\UsersController::show()`, `Api\MemberVerificationBadgeController::getUserBadges()` | `src/routes/members.js`, `src/views/members/insights.njk`, `src/lib/api.js` | Partial. Signed GET `/members/{id}/insights` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible profile, `/api/v2/users/{id}`, and `/api/v2/users/{id}/verification-badges` endpoints, and renders the Blade-style reputation page with NEXUS score, tier, percentile progress, activity stats, verification badges, earned badges, and profile back links. Title, navigation, own/other intro, score/tier/percentile and ARIA, all stats, verification types/dates, badge states, and empty states now use exact Laravel insights keys with safe unknown-value fallbacks and request-locale number/date formatting. Focused route/lint evidence, live signed Arabic three-page member RTL/reflow/axe proof, the 45/45 and 1,401/1,401 Jest gate, and the exact-current 54/54 browser matrix passed. Member action auth/status redirects use `res.locals.urlFor` for shared mounts and custom-domain contexts. Exact tenant feature gates, block/privacy/onboarding variations, manual assistive-technology evidence, and ASP.NET backend compatibility remain uncertified. |
| Generated Laravel GET preparation fallback | Laravel route matrix | `src/routes/laravel-prep-pages.js` and `src/views/static-page.njk` | Started. The fallback router reads `docs/generated/accessible-route-matrix.json` and registers future unmatched Laravel GET paths after real routes. The current matrix has no unmatched GET preparation rows; Event moderation now has real route handlers. Keeping the fallback preserves discoverability if future Laravel routes are added, but it does not certify Blade visual parity, backend data, forms, redirects, tenant routing, auth, feature gates, localization, or POST workflows. |

2026-07-13 public Feed mount correction: GET `/feed` now reaches Laravel's
public signed-out shell without calling the protected collection API, while the
POST-only action router still applies authentication and CSRF to every
mutation. The signed-in page restores Blade's Listings guidance and removes the
invented header action. Focused public/signed rendering proof passes `2/2`.

Feed action redirect note: `src/routes/feed-actions.js` now sends feed post,
item, comment, poll, moderation, share, save, and mute POST result redirects
through `res.locals.urlFor`, with focused shared-mount validation redirect
coverage for `/acme/accessible/feed/posts`.

2026-07-15 Feed index status-boundary follow-up: Feed now accepts only the
bounded success, compose-error, and action-error query tokens rendered by
`feed.blade.php`. The index no longer consumes or renders arbitrary session
flash values from unrelated routes. Focused success/unrelated-token proof
passes, and the complete non-mutating inventory is green across a 1,700-
assertion host-memory aggregate plus the separately verified canonical-path
tenant-source assertion. Brand, lint, CSS, all localization audits, and the
19/19 canonical public marker gate pass; routes and API consumers are
unchanged. No Laravel request requiring authentication, mutation, database
access, upload, download, or cleanup was performed.

Component-audit classification: the Feed hashtag/permalink row is
implementation-closed and certification-only. Its remaining runtime/schema,
tenant-gate, manual assistive-technology, and backend-switching proof belongs
to the disposable-runtime, accessibility, and separate ASP.NET packages; none
is an unresolved Blade implementation row.

Group-exchange action redirect note: `src/routes/group-exchange-actions.js`
now sends auth, validation, success, failure, and API-auth-error POST redirects
through `res.locals.urlFor`, with focused shared-mount validation redirect
coverage for `/acme/accessible/group-exchanges/new`.

Group-exchange GET redirect note: `src/routes/group-exchanges.js` now sends
signed-out list, create, and detail auth handoffs through `res.locals.urlFor`,
with focused shared-mount coverage for `/acme/accessible/group-exchanges`,
`/acme/accessible/group-exchanges/new`, and
`/acme/accessible/group-exchanges/7`.

Group route redirect note: `src/routes/groups.js` now sends central group
action auth and API-failure redirects plus file-download auth handoffs through a
route-local helper backed by `res.locals.urlFor`, with focused source coverage
and shared-mount notification failure coverage guarding against flat or
double-prefixed redirects.

Ideation action redirect note: `src/routes/ideation-actions.js` now sends
challenge, idea, outcome, media, conversion, and campaign POST redirects
through `res.locals.urlFor`, with focused shared-mount create redirect coverage
for `/acme/accessible/ideation/new`.

Ideation source-template note: `src/views/ideation/*.njk` now routes local
tabs, links, filters, and form actions through `urlFor()`, so the source no
longer embeds flat `/ideation` links before shared-mount/custom-domain
rewriting.

## Still To Port

| Blade pattern | Why it matters | Suggested ASP.NET implementation |
| --- | --- | --- |
| Localization completion and RTL certification | Structural catalogs and a language selector do not prove translated, context-correct pages or bidirectional accessibility. | Keep `npm run locales:audit`, `npm run locales:audit-keys`, and `npm run locales:audit-templates -- --summary` green, preserve the representative RTL browser gate, then review contextual route titles, headings, status copy, dynamic/ARIA labels, plural forms, and residual templates family by family. Localized progressive-validation announcements are covered on Arabic login, but this does not certify every form. The read-only Laravel owner must supply authoritative translations for the 13 wholly English namespaces and roughly 4,096-4,199 English-identical values per non-English locale rather than Web UK inventing divergent copy. Add Arabic-specific browser coverage only for concrete regressions and complete actual screen-reader/assistive-technology review before marking this row complete. |
| Per-tenant header colours | Blade safely validates `#rrggbb` values and picks readable foreground colours. | Add validated colour locals only after tenant setting parity exists. |
| Cookie consent depth | Blade records choices through `CookieConsentService` and tenant-scoped consent audit storage. | Certify tenant scoping, backend audit persistence, localization, route-name generation, and runtime behavior before shared use. |
| Account hub feature combinations | Blade conditionally includes wallet, messaging, connections, notifications, reviews, activity, saved items, jobs, matches, group exchanges, three gamification destinations, profile/settings, linked accounts, and appearance. | Web UK's current link builder mirrors that complete destination set, uses Laravel catalog copy, fails messaging closed against the broker control, and applies the matching tenant module/feature gates. Focused complete-enabled and explicit-disabled link-set tests pass. Live combinations, manual assistive-technology review, and unchanged ASP.NET compatibility remain open. |
| Module and feature gating | Blade only shows modules enabled for the tenant. | The shared service navigation, footer Platform column, and Explore card list consume tenant bootstrap `modules`/`features` with Laravel-style fallback semantics. A current focused `timebanking-org` gate passed `1/1` in `20.3` seconds: Home returned `200`; Marketplace, Courses, Podcasts, Premium, Coupons, and the event-map route returned `403`; enabled Resources, Groups, and Jobs retained the tenant-mounted authentication handoff. Continue certifying account hub cards, broker workflow data, and remaining module route families; clubs active-club routing and Explore-card sourcing have focused proof. |
| Live Explore content | Blade independently loads up to five active listings and five upcoming events, suppressing either service failure. | The signed `/explore` route now calls Laravel's listing collection with `per_page=5` and event collection with `per_page=5&when=upcoming`, instead of substituting the broader Explore API's popular-listings aggregate. Disabled tenant sources are not called; non-auth source failures yield an empty optional section; API 401 preserves the tenant-mounted login handoff. Listing/event links and view-all actions remain tenant-safe. Six focused Explore tests pass, and a live Arabic Explore journey passed HTTP 200, exact catalog heading/card output, RTL, 320px reflow, and axe. Live disabled-tenant broker-workflow proof, feature-disabled page behavior, recorded manual parity, and ASP.NET backend compatibility remain open. |
| Volunteering workflows | Blade protects the page with auth, volunteering feature checks, applications, recommendations, hours, owner tools, opportunity details, shifts, credentials, certificates, accessibility needs, wellbeing, donations, expenses, emergency alerts, group sign-ups, safeguarding training/incidents, waitlists, swaps, and POST workflows. | The public `/volunteering` landing/search and opportunity detail read Laravel-compatible data; the signed gateway now also renders Laravel's Applications collection/filter/withdraw workflow. Signed volunteering tools read Laravel-compatible data and render Blade-style forms/cards/tables/dashboard states. Recommended-shift, certificate, and credential links/forms are tenant-safe. POST aliases cover applications, shifts, hours, accessibility, certificates, swaps, emergency alerts, credential upload/delete, wellbeing, donations, group reservations, expenses, training, incidents, opportunity creation, and owner actions. The current Laravel semantic refresh preserves tenant donation-currency semantics and safeguarding field errors. Focused source/render/action proof includes a GBP tenant; the signed Applications live read passed `1/1`. Credential upload, authenticated byte-equal download, delete, and final absence are already certified by the disposable credential lifecycle. Live non-EUR donation persistence remains unavailable because no local tenant exposes non-EUR currency; residue-free application mutation, broader tenant/role routing, auth redirect breadth, and feature gates remain open. |
| Emergency alert detail | Blade renders one non-paginated page with catalog-backed copy, priority and response states, and safeguarding-specific response failures. | Web UK now matches those default-English semantics and removes its extra cursor control. Focused render/action/error proof passed, including policy-unavailable mapping; full Jest passed `45/45` suites and `1,456/1,456` tests. No live response was sent because it mutates shared alert state and may notify a coordinator. Disposable-fixture mutation proof, manual assistive-technology review, and ASP.NET compatibility remain open. |
| Volunteering organisation dashboard | Blade renders catalog-backed owner summary copy, pending-approval warning, six one-decimal activity figures, a wallet reconciliation note, and five management links. | Web UK now matches that default-English contract and removes its dashboard-only auto-pay badge. The signed-manager owner-page test passes across dashboard, manage, settings, roster, and wallet; full Jest remains `45/45` suites and `1,456/1,456` tests. Live owner-role variations, manual assistive-technology review, and ASP.NET compatibility remain open. |
| Volunteering organisation settings | Blade renders catalog-backed owner form copy, field-linked name/email errors, and saves through the organisation update contract. | Web UK now matches the default-English form and status copy. Empty names and malformed non-empty contact emails fail before Laravel; valid values are trimmed and forwarded to `PUT /api/v2/volunteering/organisations/{id}`. Focused render/mutation proof and full Jest (`45/45`, `1,456/1,456`) pass. Live persistence remains open because Laravel exposes no organisation-delete API for residue-free fixture cleanup; shared managed records were not mutated. |
| Volunteering organisation wallet (current; supersedes the older owner-row auto-pay wording) | Current Blade renders catalog-backed wallet figures, automatic-credit explanation, deposit warning/form, and recent transactions. It does not expose an auto-pay toggle; its legacy POST only rechecks owner access and reports that crediting is always on. | Web UK now matches that default-English page and removes the ASP.NET-specific auto-pay toggle. The compatibility POST performs only the safe owner-scoped stats read before the informational redirect; it no longer mutates `/wallet/auto-pay`. Focused owner render/action proof and full Jest (`45/45`, `1,456/1,456`) pass. A live deposit remains open because it irreversibly moves real wallet value and no residue-free fixture exists. |
| Volunteering organisation review queue | Blade renders catalog-backed application/hour decisions with explanatory empty states, action hints, applicant context in accessible button names, automatic-credit warning, and safeguarding-specific application failures. | Web UK now matches that default-English contract. `SAFEGUARDING_POLICY_UNAVAILABLE`, `SAFEGUARDING_CONTACT_RESTRICTED`, and `VETTING_REQUIRED` map to the corresponding safe failure states instead of the generic application error. Focused owner render/action/error proof and full Jest (`45/45`, `1,456/1,456`) pass. Live approval/decline remains open because no disposable pending application/hour fixture exists. |
| Volunteering owner accessibility sample | Blade-backed owner dashboard, review queue, settings, wallet, and roster at organisation `636`. | A fresh current-checkout, authenticated default-English browser run passed `5/5` in `2.3` minutes: every page returned `200` and had one main landmark/H1, no duplicate IDs, no 320px document overflow, and no serious/critical axe findings. This is focused automated evidence, not manual screen-reader certification. |
| Volunteer opportunity approval gate | Blade only renders the create form when the signed-in user manages an approved organisation; otherwise it renders catalog-backed guidance and no mutation controls. | Web UK now matches the complete default-English form/status catalog and the no-approved-organisation state. The local account has no approved owner/admin organisation across available tenants, so no privileged state was fabricated and no mutation was attempted. Focused render proof, full Jest (`45/45`, `1,456/1,456`), and a Laravel-backed authenticated 320px structure/reflow/axe gate (`1/1`) pass. Disposable create/delete proof remains open until a legitimately approved fixture exists. |
| Volunteer shift waitlist | Blade renders catalog-backed waitlist status, empty guidance, position/notification cards, organisation/location/shift/joined labels, and context-specific leave buttons. | Web UK now matches that default-English contract, including translated failure/load states, opportunity-title fallback, position interpolation, and the full shift title in the accessible leave-button name. Focused waitlist/swaps proof and full Jest (`45/45`, `1,456/1,456`) pass. Live leave remains open because the available entries are shared signups rather than disposable fixtures. |
| Volunteer shift swaps | Blade renders catalog-backed swap copy, direction/status labels, member context, shift labels, and accept/reject/cancel actions. | Web UK now matches that default-English contract, including em-dash shift labels, safe unknown-status fallback, translated success/error states, and safeguarding-specific policy/restriction failures. Focused action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live swap mutation was submitted because the available shifts belong to shared records rather than disposable fixtures. |
| Volunteer group sign-ups | Blade renders catalog-backed reservation/member states, counts, leader controls, and safeguarding-specific add-member failures. | Web UK now matches that default-English contract, including translated summary/table labels, warnings, accessible remove/cancel context, safe unknown-state fallbacks, and policy-unavailable/restricted add-member states. Focused render/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. Live add/remove/cancel remains open because no residue-free group-reservation fixture is available; shared reservations were not mutated. |
| Volunteer wellbeing | Blade renders a private score/risk summary, recognized warnings, mood check-in form, and recent check-ins from the volunteering catalog. | Web UK now matches that default-English contract, including em-dash mood labels, exact preserved-timezone `j F Y, g:ia` timestamps, catalog statuses, and omission of unknown warning payloads. Focused render/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live check-in was submitted because Laravel exposes no residue-free deletion path for the personal record. |
| Volunteer donations | Blade renders fundraising totals, giving-day progress, donation history, and the pending bank-transfer/PayPal form from the donations catalog. | Web UK now uses the same default-English catalog for page/form copy, plural donor counts, progress accessibility text, campaign and donation statuses, methods, and validation/success states. Tenant currency remains uppercase with EUR fallback, donation POST still omits currency, and amounts above `1,000,000` remain rejected. Focused render/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live donation was recorded because the signed-in tenant has no residue-free donation deletion path. |
| Recommended volunteer shifts | Blade renders catalog-backed recommendation copy, match score, application state, organisation/location/shift/spots metadata, and opportunity actions. | Web UK now matches that default-English contract, including the exact title fallback, interpolated match label/accessible progress name, and preserved-timezone `j F Y, g:ia` shift time. Focused Laravel-contract render proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. This surface is read-only; tenant/skill recommendation-depth and ASP.NET compatibility remain open. |
| Volunteer expenses | Blade renders catalog-backed totals, claim form/error links, expense types/statuses, reviewer notes, and claim history. | Web UK now matches that default-English contract, including field-linked error states, optional currency guidance, safe unknown-status fallback, catalog type labels, and em-dash missing-date fallback. Focused render/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live claim was submitted because Laravel exposes no residue-free claim deletion path; existing records were not mutated. |
| Volunteer safeguarding training and incidents | Blade renders catalog-backed training/incident tabs, forms, field-linked validation, type/severity/status labels, confidentiality notice, and record tables. | Web UK now matches that default-English contract, including catalog navigation names, safe pending/low/open fallbacks for unknown states, exact optional labels, and em-dash missing-date fallbacks. Focused render/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live training or incident record was created because Laravel exposes no residue-free deletion path for either personal record. |
| Volunteer accessibility needs | Blade renders catalog-backed need types, details, adjustments, emergency contact fields, and save/failure states. | Web UK matches the default-English catalog, form, need types, status states, and persistence contract. A current guarded Laravel lifecycle passed `1/1` in `54.4` seconds: it captured the original weekly accessibility rows, saved distinct hearing/mobility needs through the visible form, proved redirected rendering and API persistence, passed 320px structure/reflow/axe checks, restored the exact original rows through the API in `finally`, and independently verified exact API equality. Manual assistive-technology review and ASP.NET compatibility remain open. |
| Volunteer certificates | Blade renders catalog-backed generation states, certificate totals/period/code/organisation details, and download action. | Web UK now matches that default-English contract, including the caption, verification/organisation labels, page title/statuses, and independent-volunteering fallback. The download route retains ownership proof before returning Laravel certificate HTML. Focused render/download proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live certificate was generated because generation creates a persistent account record without a residue-free deletion path. |
| Volunteer my organisations | Blade renders catalog-backed role filtering, organisation status/role cards, safe website links, approval guidance, manager dashboard actions, and cursor pagination. | Web UK now matches that default-English contract, including request-locale known role/status labels, headline fallback for unknown values, exact empty/filter/card copy, and organisation-specific accessible dashboard action names. Focused owner-filter/render proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. This surface is read-only; broader live owner/admin/member tenant variants and ASP.NET compatibility remain open. |
| Volunteer hours | Blade renders catalog-backed auto-credit explanation, totals/progress, organisation/month breakdowns, log form, empty guidance, and review/approval trail. | Web UK now matches that default-English contract, including request-locale success/failure and log-status labels, exact form hints, pending/approved credit notes, declined mapping, and translated-or-headline unknown-status fallback. Focused summary/form/log/action proof and full Jest (`45/45`, `1,456/1,456`) pass with green lint and the 285-template zero-match audit. No live log was submitted because Laravel exposes no residue-free deletion path for an hours record. |
| Organisations workflows | Blade protects the page with auth, volunteering, and job-vacancy feature checks, lists real organisations, shows detail depth data, posts registrations through `VolunteerService`, deliberately leaves organisation jobs empty because volunteer and job-vacancy organisations use separate identifiers, and posts opportunity applications to the existing volunteering apply route. | Directory, browse, register, manage, detail, jobs, and opportunity-apply GETs share the tenant-aware `/login?status=auth-required` unsigned handoff and use Laravel-compatible contracts when signed in. Organisation jobs applies Blade's name fallback and script-safe Organization JSON-LD while retaining the intentional empty list without an invented cross-model API call. Organisation detail aligns Blade's name/description/contact, website-scheme, opportunity identity/title/summary, and review-comment boundaries. The opportunity-apply page matches Blade's trimmed title/name fallbacks, authoritative organisation-ID link boundary, and already-applied form suppression. Registration POSTs are mock-covered with Laravel-equivalent Unicode length checks and 255-character name truncation. Manage rows skip empty IDs, trim names before fallback, and require authoritative `member_role` values for controls; local controls use `urlFor()`. Feature gates, apply persistence, disposable-fixture mutation proof, current broad runtime certification, and ASP.NET backend compatibility remain open. |
| Blog workflows | Blade feature-gates blog availability, renders public listing/detail pages, requires auth for discussion and likers pages, and wires comments/reactions through Laravel services. | Current evidence is maintained in the Blog GET pages row above. Listing/detail/discussion/liker surfaces and mutation aliases use Laravel-compatible APIs and tenant-safe controls. The reversible live discussion gate now certifies owner create/edit/reply/react/delete, post reaction restoration, accessibility, and cleanup. Feature gates, non-owner runtime variants, exact rich-text/RSS depth, manual assistive-technology review, and ASP.NET backend compatibility remain open. |
| Poll workflows | Blade feature-gates polls, requires auth, splits open and closed polls, supports category/my-polls filters, ranked choice, result export, likes, and comments. | Current evidence is maintained in the Poll GET pages row above. Owner delete actions on open, ranked, and closed list cards now use Blade's closed GOV.UK details disclosure, irreversible warning, and explicit final delete button; focused rendering proves all three states. The disposable default-English owner lifecycle certifies standard create/vote/like/comment/delete and ranked create/rank/results/delete with final API absence, 320px reflow/axe, and independent cleanup. Feature gates, exact service-level open/closed parity, broader owner authorization, residual catalog review, manual assistive-technology depth, and ASP.NET backend compatibility remain open. |
| Jobs workflows | Blade feature-gates jobs, renders browse/saved/applications/owner/employer/talent pages, and wires applications, alerts, interviews, offers, CV downloads, and owner controls through Laravel jobs services. | Jobs browse/detail/saved/applications/mine/create/edit/owner-applicants/analytics/pipeline/qualified/alerts/responses/talent-search/talent-profile/employer-brand/employer-onboarding/bias-audit GET pages and POST aliases call Laravel-compatible jobs/admin/user APIs. Local controls route through `urlFor()`, and contextual catalog alignment covers browse, saved, application, owner, form, alert, response, pipeline, applicant, detail, history, talent, bias, and qualification surfaces. The owner form and alerts page use Blade's exact catalog captions, navigation, headings, labels, hints, status tags, and destructive confirmation. The Responses page now matches current Blade rather than its former hard-coded approximation: every fixed label uses the request-locale `govuk_alpha_jobs.responses` catalog; proposed, accepted, declined, withdrawn, and expired states use Blade's yellow/green/grey tags; interviews expose the source Google Calendar action and separate accept/decline notes; offer messages use the source inset; and expired pending offers render Expired without response actions. Focused populated/expired rendering, `46/46` Jobs localization tests, lint, and the static/template localization gates pass with 6,487 references, 4,915 unique keys, and zero unresolved or conservative template matches. The disposable default-English gate passes `5/5` in `7.5` minutes. It certifies invalid create/edit replay, persisted owner create/update/delete and final absence; alert create/pause/resume/delete and final absence; non-owner invalid-CV replay with no application mutation; and two-user application, interview, and offer lifecycles at the canonical `/hour-timebank/accessible` mount. The application case creates an open disposable opportunity, submits a cover letter through Web UK, verifies Laravel's persisted `pending` application, the exact success state, 320px structure/reflow/axe, and the Applications card, then withdraws through Web UK, verifies persisted `withdrawn`, deletes the parent job, and proves final application absence. The response case creates a second disposable opportunity, application, interview, and offer; renders both response cards and the Google Calendar action; accepts the interview with a note and rejects the offer through Web UK; verifies Laravel's persisted `accepted` and `rejected` states; passes 320px structure/reflow/axe; deletes the parent job; and proves final interview, offer, and application absence. The route also enforces the declared 5 MB limit inside a narrowly capped 6 MB parser envelope so accessible `cv-too-large` replay is reachable while larger requests still fail closed. CV upload/byte-download certification remains open because the read-only Laravel parent-job deletion path bulk-deletes application rows without proving uploaded-file removal, so a disposable upload would not yet have residue-free cleanup. Interview decline, offer acceptance, owner cancellation/withdrawal variants, remaining template surfaces, tenant feature-gate depth, manual assistive-technology review, and ASP.NET backend compatibility also remain uncertified. |
| Podcast workflows | Blade renders podcast browse, show, episode, studio, create, and manage pages, with author-only studio actions and multipart show artwork and episode audio upload support through Laravel services/APIs. | Podcast GET pages and POST aliases call Laravel-compatible APIs and route local controls through `urlFor()`. Browse consumes Laravel categories/pagination and studio capability metadata. Show create/manage expose Blade's complete metadata and artwork fields. Episode create/edit expose Blade's slug, summary/description, episode/season/duration, hosted/external audio metadata, type, visibility, explicit, schedule, configuration-gated transcript/chapters, and cover fields. Edit uses Blade's existing show-update action plus hidden `episode_id`, then calls Laravel's JSON or method-spoofed multipart episode contract; cover upload uses the dedicated `/{showId}/episodes/{episodeId}/cover` API with field `image`. Tenant audio limits, the 250 MB Laravel default ceiling, 8 MB cover limit, temporary cleanup, and post-create cover-failure recovery are mock-covered. Subscription toggles omit `notify_new_episodes` like Blade, preserving Laravel's default-enabled notification preference; subscribe, unsubscribe, failure, and the exact payload boundary are mock-covered. The full non-mutating gate passes 47/47 suites and 1,605/1,605 tests. The earlier disposable owner lifecycle certifies create, edit, hosted WAV upload and byte retrieval, episode delete, show delete, 320px structure/reflow/axe, and final absence; it predates the new artwork/cover/metadata slice and is not claimed as live proof for those additions. Publish/moderation, broader tenant author gates, disposable live artwork/cover/subscription certification, manual accessibility depth, and ASP.NET compatibility remain open. |
| Goals workflow depth | Blade feature-gates goals, requires auth, renders index/detail/edit/templates/buddy/discover/depth pages, and wires check-ins, reminders, buddy actions, history, and social interactions. | `/goals` now renders the signed Laravel-backed index, `/goals/templates` renders the signed Blade-style template picker through Laravel-compatible template/category APIs, `/goals/discover` renders the signed Blade-style public buddy-goal discovery page through Laravel-compatible discover APIs, `/goals/buddying` renders the signed Blade-style goals-you-buddy and public-goals-looking-for-a-buddy sections through Laravel-compatible mentoring/discover APIs, `/goals/{id}` renders the signed Blade-style detail with owner/buddy/public states plus optional history and insights, `/goals/{id}/edit` renders the signed Blade-style owner edit form from Laravel-compatible goal detail data, `/goals/{id}/checkin` renders the signed Blade-style progress/mood/note check-in form and recent history from Laravel-compatible goal and check-in APIs, `/goals/{id}/reminder` renders the signed Blade-style reminder status and settings form from Laravel-compatible goal and reminder APIs, `/goals/{id}/buddy-actions` renders the signed Blade-style buddy support form from Laravel-compatible goal detail data, `/goals/{id}/history` renders the signed Blade-style chronological progress timeline from Laravel-compatible goal detail and history APIs, `/goals/{id}/insights` renders the signed Blade-style streak/cadence/milestone/buddy-support summary from Laravel-compatible goal detail and insights APIs, `/goals/{id}/social` renders the signed Blade-style support toggle, like/comment counts, threaded comments, reply/delete controls, status banners, validation error, and add-comment form from Laravel-compatible goal/social/comment APIs, and existing POST aliases call Laravel-compatible goals/template/comment/like APIs. Goal templates route local links/forms through `urlFor()`, route-generated auth/status redirects pass through `res.locals.urlFor`, focused detail localization/authorization tests are green, and `/goals/162` passed current-source Laravel smoke. A disposable default-English owner lifecycle passed `1/1` in `200.5` seconds: create and API-read, edit and API-read, persist a 40% check-in with mood/note, set and remove a weekly reminder, persist a like through Laravel's liker-ID fallback, create an own comment and nested reply, warning-delete the reply then parent, pass 320 CSS pixel structural/reflow/axe checks, delete the goal, and prove API absence with independent final cleanup. Buddy effects, tenant feature-gate depth, residual localization, visual/manual depth, and ASP.NET backend compatibility remain uncertified. |
| Public coupon browsing | Blade feature-gates merchant coupons, requires auth, renders the public `/coupons` list and `/coupons/{id}` detail pages from `MerchantCouponService`, and exposes coupon code/redemption guidance. | `/coupons` and `/coupons/{id}` render signed Laravel-backed public coupon pages through `/api/v2/coupons` and `/api/v2/coupons/{id}`. Both pages now use Laravel's exact request-locale `coupons` and `polish_commerce` catalogs for route/fallback title, tenant caption, description/empty state, percentage/amount discount labels, code/date metadata, back link, code panel, redemption guidance, merchant label, and validity label; request-localized date formatting is preserved. List/detail links, auth redirects, and shared mounts remain safe. Focused Arabic list/detail coverage passed 1/1; full verification passed 1,424/1,424, warning-free lint, the 290-template zero-match audit, and 608/608 route parity. Scoped Laravel smoke still proves the current local fixture returns expected 403 merchant-coupons feature gates, so enabled-tenant body runtime proof, QR redemption/validation workflows, runtime persistence, recorded manual parity, and ASP.NET backend compatibility remain uncertified. |
| Clubs workflow depth | Blade exposes `/clubs` only for tenants that have active club organisations and renders a Laravel DB-backed directory. | `/clubs` renders a signed Laravel-backed club directory through `/api/v2/clubs`; the no-active-club tenant gate returns `404`, while searched empty results remain renderable when an unfiltered probe proves active-club evidence. The tenant caption, description, search labels/hint/action, empty state, member count, meeting/contact metadata, website action, new-tab text, and fallback title all use the exact request-locale Laravel catalog; local navigation and the search form remain tenant-mount safe. Focused unsigned, localized populated, mounted redirect/form, no-club 404, and searched-empty proof passes `5/5`, and the static-key gate remains zero-unresolved. The default Laravel runtime smoke records the signed local fixture at the canonical `/hour-timebank/accessible/clubs` URL as the expected gated `404`; `/hour-timebank/alpha` is only legacy redirect compatibility and is not an evidence source. A disposable active-club lifecycle, manual visual/assistive-technology review, and ASP.NET backend compatibility remain uncertified. |
| Skills workflow depth | Blade renders the signed-in taxonomy directory from `SkillTaxonomyService`, with category drill-in and skill member search. | `/skills` renders a signed Laravel-backed taxonomy directory through `/api/v2/skills/*`, with tenant-safe links/forms and auth redirects. The visible directory, category drill-in, member search, proficiency labels, tenant caption, and API failure inset use Laravel's exact request-locale catalogs; the failure inset was corrected to the real `error_pages.503_*` namespace. Focused Arabic render coverage and a live Arabic 320px RTL/reflow/axe journey passed. Category/member authorization edge cases, deeper runtime fixtures, recorded manual parity, and ASP.NET backend compatibility remain uncertified. |
| Resource action depth | Blade has a simple `/resources` list plus a richer `/resources/library`, upload, delete confirmation, download, comments, reactions, and admin reorder views. | The corresponding GETs and POST aliases use the exposed resource APIs, multipart proxying, administrator reorder controls, tenant-aware links, and redirects. All five rendered pages now use the exact `govuk_alpha.resources` and `govuk_alpha_resources` request-locale catalogs for document/page titles, tenant captions, navigation, search/category controls, result/empty/status states, file metadata and type labels, counts, upload/delete controls, warnings, reaction/comment controls, recursive author fallbacks, dates, and ARIA labels. Focused resource coverage passes 21/21, including one safe-input validation replay and the existing five-page locale integration render. The opt-in default-English Laravel gate now passes `1/1` in `2.2` minutes, proving field-linked required-title/file errors, description replay without an invalid API mutation, upload persistence, library rendering, exact download bytes, celebrate-reaction add/remove persistence, own-comment create/delete persistence, 320 CSS pixel structure/reflow/axe integrity, resource deletion, and final absence with one disposable fixture. It also proves the signed non-admin sees no reorder forms, a CSRF-valid reorder attempt returns `403`, and the resource order remains unchanged. The collection/detail contract still has cursor/category/sort limitations. Admin reorder persistence remains open because this environment has no legitimate admin credential; feature-gate depth, exact relative-date semantics, recorded manual parity, and ASP.NET backend compatibility also remain open. |
| Page-specific subnavs | Commerce, federation, gamification, jobs, messages, and ideation have Blade partial navs. | Jobs, Messages, Marketplace, Courses, Federation, both Gamification tab groups, and Ideation now use source-exact shared components/catalogs/current-page semantics. Ideation resolves Laravel's exact tenant-admin role set from `/api/v2/users/me`, exposes Create only to those roles, and fails the create GET closed before loading form data for other signed members. The Federation component replaced 17 duplicated invented-English blocks and Gamification replaced 10 duplicated strips. |
| Error and validation summaries | Blade uses consistent GOV.UK error summary behavior and a deliberately standalone `AccessibleErrorPage` using the shared `error_pages` locale catalog. | Shared 403/404/419/429/500/503 templates use a standalone Laravel-shaped document with exact `error_pages.*` title/body/home copy, skip link, one main landmark, minimal attribution footer, `noindex`, CSS only, and no tenant/session navigation, cookie banner, phase banner, application JavaScript, exception details, or raw exception-message leakage. CSRF token mismatches return Laravel-compatible 419 instead of 403, and the final middleware maps 419 and 429 to their dedicated templates instead of the generic 500 body. Integration coverage proves exact Arabic output and status semantics for all six statuses; real-browser Arabic 404 and invalid-CSRF 419 journeys pass exact catalog markers, RTL, 320px reflow, and axe. Per-form summary/action/error mapping, mutation failures, and manual assistive-technology certification remain open. |

### Member and review choice follow-up

- Member-profile credit transfers now include Blade's required irreversible-
  transfer confirmation checkbox while retaining the existing UUID idempotency
  key. Pending Review forms require an explicit rating instead of preselecting
  five stars, expose localized `n out of 5` labels, and use the same catalog for
  the Reviews average. Focused default-English rendering passes `2/2`; live
  transfer/review mutation certification remains governed by the disposable-
  environment queue.
- Group Exchange detail now renders Blade's `Back to exchanges` link before the
  caption and heading through `urlFor()`. The focused list/create/detail render
  passes `1/1`; mutation and manual accessibility certification remain open.
- Account deletion now places its validation error summary before the H1, as
  required by Blade's GOV.UK focus-on-load order. Focused signed/unsigned
  rendering passes `1/1`; manual focus and screen-reader certification remain
  open.
- Member-profile reviews now use Blade's GOV.UK card list, localized reviewer
  heading, blue `n out of 5` tag, assistive rating copy, and comment body. The
  legacy star/date header is removed; focused default-English rendering passes
  `1/1`, while broader runtime and manual certification remain open.
- The cookie confirmation banner's hide control now keeps native link semantics
  like Blade instead of overriding its role to button. Focused shell-partial
  proof passes `15/15`; manual assistive-technology certification remains open.
- Knowledge Base articles, Blog posts, and managed legal documents now pass
  through the shared Laravel-aligned CMS HTML sanitizer at the Web UK route
  boundary. Legal content additionally rejects images like Laravel's legal
  document policy. Focused safe-formatting and hostile-markup proof passes
  `3/3`; broader live CMS permutations and manual certification remain open.
- Course detail now uses Blade's enrolment confirmation panel and removes the
  invented `Continue learning` link from the enrolled inset. Focused populated
  course-family proof passes `1/1`; learner-side-effect and manual certification
  remain open.
- Course rating summaries and reviews now use Blade's Unicode star visuals,
  one-decimal average, middle-dot separator, and request-localized full-month
  date. Focused course-family proof passes `1/1`; broader learner-side-effect
  and manual certification remain open.
- Podcast show/episode summaries and Group discussion opener/reply content now
  strip source markup before preserving line breaks, matching Blade's
  plain-text boundary instead of showing escaped tags. Focused populated-state
  proof passes `3/3`; broader runtime and manual certification remain open.
- Blog RSS now matches Blade's tenant-named channel, absolute mount-aware
  links, permalink GUIDs, optional RFC-822 publication date, request language,
  and XML escaping. Focused hostile-character feed proof passes `1/1`; live
  feed variants and manual consumer review remain open.
- Volunteering's server-switched section links and Wallet's transaction-filter
  links now apply Blade's no-visited-state class only to the active
  `aria-current="page"` item. Focused active/inactive rendered proof passes
  `2/2`, preventing browser history from visually overriding the current
  section while retaining ordinary visited styling on inactive links.
- Signed Event detail now renders attached polls from Laravel's event-scoped
  list plus full-detail contracts. Focused proof covers open voting without
  leaked totals, closed rounded results, open already-voted secrecy, leading
  and own-choice tags, no-options copy, and exact success/failure outcomes.
  Anonymous poll depth remains an upstream bearer-API constraint; the current
  full aggregate is also not green because an unrelated group-upload case hit
  host `ENOBUFS`/timeout after the new Event assertion passed.
- The post-slice complete non-mutating checkpoint passes `52/52` suites and
  `1,675/1,675` tests after replacing the stale member star-display guard with
  a current rating-tag/assistive-copy guard. Route, API-ledger, locale,
  template, and `19/19` canonical Blade marker gates are also green.

### Jobs member-page evidence

- `views/jobs-employer-brand.blade.php` now maps to the mounted employer page
  with Blade's catalog navigation/headings/counts, member metadata, opportunity
  cards, inset empty states, and review hierarchy. The invented intro/load
  warning is removed; average, dimension, and per-review progress indicators
  use source ARIA labels. Focused rendering passes `1/1`; the complete non-
  mutating gate passes `52/52` suites and `1,679/1,679` tests, with 7,556
  references, 5,780 unique keys, and zero unresolved/template matches.
- `views/jobs-talent-search.blade.php` now maps to the mounted talent-search
  page with Blade's exact request-locale navigation, heading, description,
  filters, actions, prompt/empty/result states, last-active metadata, middot
  separator, and continuation link. Focused rendering passes `1/1`; the
  complete non-mutating gate passes `52/52` suites and `1,679/1,679` tests,
  with 7,543 references, 5,769 unique keys, and zero unresolved/template
  matches.
- `views/jobs-applicants.blade.php` now maps to an owner Applicants page with
  Blade's request-locale headings, analytics labels, applicant/stage fallbacks,
  applied-date and multiline cover-letter presentation, and update action. A
  failed applicant collection renders the source management-denial `403`
  rather than an invented partial page, while optional analytics remain non-
  fatal. Focused populated/auth/denial proof passes `3/3`; the complete non-
  mutating gate passes `52/52` suites and `1,679/1,679` tests, with 7,529
  references, 5,757 unique keys, and zero unresolved/template matches.
- `views/jobs-pipeline.blade.php` now maps to a mounted owner pipeline with the
  source applicants back destination, request-locale catalog, full-list link,
  labelled stage sections, plural counts, empty states, localized stage
  controls, candidate-card nesting, and CV presentation. Focused rendering
  passes `1/1`; the complete non-mutating gate passes `52/52` suites and
  `1,678/1,678` tests, with 7,524 static references, 5,753 unique keys, zero
  unresolved keys, and zero conservative matches across 322 templates.
- `views/jobs-analytics.blade.php` now maps to the mounted owner analytics page
  with Blade's request-locale catalog, link-list hierarchy, conditional metric
  and referral rows, table/progress semantics, localized stages/percentages,
  and complete prediction metadata/comparison tags. Focused rendering passes
  `1/1`; the complete non-mutating gate passes `52/52` suites and
  `1,678/1,678` tests, with 7,513 static references, 5,742 unique keys, zero
  unresolved keys, and zero conservative matches across 322 templates.
- Earlier member-page checkpoint: full Jest passed `48/48` suites and
  `1,626/1,626` tests; the analytics entry above supersedes its aggregate
  counts without invalidating the earlier member-page evidence.
- `views/jobs.blade.php` and `partials/job-card.blade.php` now map to the browse route/template with Blade's tenant caption, catalog-backed filters/results/cards, single empty fallback on non-auth load failure, and next-page icon/semantics. Focused default-English populated, signed-out, and failure rendering is green.
- `views/job-detail.blade.php` now resolves owner identity from Laravel `/api/v2/users/me`, shows owner management rather than save/apply controls, and renders the optional Laravel `/api/v2/jobs/{id}/match` result with Blade's catalog and progress semantics. Type, commitment, remote, and caption fallbacks are catalog/tenant backed. Similar-opportunity rendering and a public CV-upload configuration contract remain open because Laravel exposes no equivalent member-facing API data for them.
- `views/jobs-saved.blade.php`, `partials/job-card.blade.php`, and `AlphaController::savedJobs()` now map to `src/routes/jobs.js` and `src/views/jobs/saved.njk` with Blade's tenant caption, catalog-backed card labels and plural counts, single empty fallback on non-auth load failure, unsave control, and next-page icon/semantics. Focused default-English rendering is green; broader gaps remain tracked in the Jobs workflows row.
- The saved-jobs status boundary now renders only Blade's bounded `unsaved`
  success state, with the exact `saved-status` labelling relationship and one
  catalog-backed message. Other recognised Jobs status tokens no longer leak a
  generic banner onto this page. Focused populated/empty/status proof passes,
  and the uninterrupted non-mutating aggregate passes `52/52` suites and
  `1,698/1,698` tests.
- The template-localization audit no longer depends on unsupported
  `Object.groupBy`; its Map-based grouping runs on the project's Node 18+
  contract. Focused proof and the complete aggregate pass, and the current
  audit reports 322 templates with zero conservative matches.
- `views/jobs-applications.blade.php` now maps to the Web UK applications route/template with Blade's tenant caption, exact filter set, catalog-backed status/card/action copy, single empty fallback on non-auth load failure, and next-page icon/semantics. Focused default-English populated, signed-out, and failure rendering is green.
- `views/jobs-postings.blade.php` now maps to My postings with Blade's tenant caption, catalog-backed status/count/action copy, single empty fallback on non-auth load failure, next-page icon/semantics, and a warning/details confirmation before the destructive delete form. Focused default-English populated, signed-out, and failure rendering is green.
- `views/jobs-form.blade.php` now maps Laravel v2 structured create/update validation failures into a replayed GOV.UK error summary, preserving submitted values and linking allowlisted API fields to the corresponding form control. Focused create/edit and field-error replay passes `7/7`; disposable mutation and manual assistive-technology certification remain governed by the Jobs workflows row.

## Do Not Port

### 2026-07-15 Event index follow-up

The current Event index supersedes the older row's authenticated-only and
filter-depth wording. Like Blade, the index is publicly renderable when Events
are enabled, exposes the calendar-feed and subscription links, requests 12
rows, and carries search, time, category, stored-location radius, and step-free
venue filters through cursor pagination. When Events are disabled, Web UK
renders Blade's Event-specific `403` content and does not call the Event
collection, category, or moderation APIs. Focused route/render/API proof passes
`5/5`; the complete non-mutating gate passes `52/52` suites and `1,695/1,695`
tests, and the fresh-current-container marker comparison passes `19/19` at
`/hour-timebank/accessible`. Runtime side effects and manual assistive-
technology certification remain open.

The adjacent canonical-card follow-up now accepts Laravel's nested `schedule`,
`location`, `metrics`, `relationship`, and `primary_image` projection as well
as its legacy flat compatibility projection. All-day ranges use Blade's
exclusive-end conversion, configured timezone, All day marker, zero-preserving
metrics, backend-origin image resolution, and relationship/contract data
attributes. Focused legacy/canonical/filter proof passes `3/3`; the complete
non-mutating gate passes `52/52` suites and `1,696/1,696` tests. Manual and
disposable-runtime certification remain open.

The Event archive-status follow-up now renders Blade's exact archived/deleted
success banner and archive-failure error summary on the index. Bounded query
states suppress stale generic flash content, so success copy appears once and
retains the source `event-archived-title` relationship. Focused proof passes
`1/1`; the complete non-mutating gate passes `52/52` suites and `1,697/1,697`
tests. Live destructive and manual accessibility certification remain open.

The Event detail status-family follow-up now accepts only Blade's create, RSVP,
organiser, check-in, waitlist, poll, safeguarding, and publication tokens. It
uses the source message keys and exact `event-created-title`,
`rsvp-success-title`, `event-organiser-success-title`, `checkin-success-title`,
and `event-depth-success-title` relationships without arbitrary session flash.
Create, update, cancel, archive, and RSVP producers now redirect through the
same bounded outcomes as Blade; recurring creation and archive failure return
to the Event index, and Laravel safeguarding error codes retain their distinct
RSVP policy/vetting outcomes. Focused status/action proof passes `4/4`; the
complete non-mutating gate passes `52/52` suites and `1,706/1,706` assertions,
with green lint, brand, CSS, and zero-unresolved locale/template audits. This
default-English status-family subrow is implementation-closed. Disposable
side-effect/runtime variants, the named Event API boundaries, manual
assistive-technology review, and ASP.NET switching remain assigned to their
separate owners and certification packages.

### 2026-07-15 Saved-search run failure follow-up

Saved-search runs now mirror Blade's failure boundary. A successful run uses
Laravel's returned normalized query parameters without an extra collection
read. If only the `last_run_at` update fails, Web UK recovers the owner-visible
saved row and redirects to its normalized query and filters without inventing
the unsupported `search-run-failed` status or dropping the user's search. Auth
failures still redirect to sign-in, and missing rows remain a fail-closed 404.

Focused success, update-failure, missing-row, and unrelated-status proof passes
`5/5`. The complete non-mutating gate passes `52/52` suites and
`1,709/1,709` tests. Brand, lint, CSS, locale shape/static-key/template, and
scoped diff gates are green; static localization resolves 7,634 references and
5,819 unique keys with zero unresolved, and 322 templates have zero
conservative matches. No Laravel request, authentication, database, migration,
mutation, upload, download, cleanup, container, or production operation was
performed.

Component-audit classification: the Simple/advanced search and saved-search
delete row is implementation-closed for default-English significant states.
Disposable saved-search persistence remains upstream-blocked by Laravel's
documented `getJsonInput()` failure; runtime certification, manual assistive-
technology review, and backend switching remain assigned to their separate
packages. This published slice is unscored; the canonical bank remains
`660/1,000` until another complete fixed-rubric audit.

### 2026-07-15 Event Template controls and cursor follow-up

The Event Template library's use, refresh, audit, and load-more anchors now
carry Blade's `data-module="govuk-button"` initialization contract. The route
also normalizes Laravel's `meta.next_cursor` before rendering, so numeric and
opaque cursor values survive into the load-more URL; audit-history cursor
normalization follows the same boundary.

Focused library/history rendering passes `1/1`. The complete non-mutating gate
passes `52/52` suites and `1,709/1,709` tests; lint, template-localization, and
scoped diff checks are green, with 322 templates and zero conservative
matches. No Laravel or ASP.NET source, database, migration, runtime mutation,
container, or production operation was performed. This narrows the shared
pagination/control audit work but does not reclassify the whole row. The slice
is unscored and the canonical bank remains `660/1,000` pending another complete
fixed-rubric audit.

### 2026-07-15 Public saved-social API assertion follow-up

The public-collections and public-appreciations reads now have direct API-client
contract proof in addition to their existing routed presentation tests. The
focused assertions pin Laravel's exact versioned paths, bearer authority,
GET-only behavior, appreciation pagination query, collection and pagination
response-envelope preservation, and structured `403` `ApiError` propagation.
This narrows finite package 9's field/auth/status/error assertion gap for two
direct Laravel route declarations omitted from OpenAPI; it does not convert the
remaining publication/assertion package or any runtime package to complete.

The focused API-client suite passes `216/216`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Group-file download API assertion follow-up

The signed group-file download now has direct API-client contract proof in
addition to its routed proxy tests. The assertions pin Laravel's exact
versioned binary path, normalized leading-slash handling, bearer authority,
explicit GET, byte preservation, all forwarded cache/file metadata headers,
the absence of an invented JSON content type or tenant-ID header, and Laravel's
structured membership `403` error propagation. This narrows finite package 9
for one further direct Laravel route declaration omitted from OpenAPI; live
download authorization and storage cleanup still require the isolated
disposable environment.

The focused API-client suite passes `217/217`. No Laravel or ASP.NET source,
database, migration, runtime request, download, container, or production
operation was performed. This slice is unscored; the canonical bank remains
`663/1,000` until another complete fixed-rubric audit.

### 2026-07-15 Onboarding-read API assertion follow-up

The onboarding configuration and safeguarding-option reads now have direct
API-client contract proof alongside their routed workflow tests. The assertions
pin both exact Laravel v2 paths, bearer authority, GET-only behavior, complete
configuration/step and option response-envelope preservation, absence of an
invented tenant-ID header, and structured `401` `ApiError` propagation. This
narrows finite package 9 for two further Laravel route declarations omitted
from OpenAPI; onboarding persistence and role/tenant runtime variants remain in
the isolated-disposable-runtime packages.

The focused API-client suite passes `218/218`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Member-directory API assertion follow-up

The member search and skill-member reads now have direct API-client contract
proof alongside their routed directory tests. The assertions pin the exact
Laravel v2 paths, bearer authority, GET-only behavior, UTF-8 and reserved-query
encoding, limit parameters, full data/meta envelope preservation, absence of an
invented tenant-ID header, and structured feature-disabled `403` propagation.
This narrows finite package 9 for two further Laravel route declarations omitted
from OpenAPI; role, feature, tenant and populated-fixture runtime certification
remains assigned to the disposable environment.

The focused API-client suite passes `219/219`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Club and coupon API assertion follow-up

The club collection and signed coupon collection/detail reads now have direct
API-client contract proof alongside their routed page tests. The assertions pin
Laravel's exact v2 paths, public-versus-bearer authority, explicit coupon GETs,
club search and pagination encoding, complete data/meta envelope preservation,
and structured feature-disabled `403` propagation. This narrows finite package
9 for three further Laravel route declarations omitted from OpenAPI; enabled and
disabled tenant runtime variants remain assigned to the disposable environment.

The focused API-client suite passes `221/221`, and the complete non-mutating
gate passes `52/52` suites and `1,716/1,716` tests. No Laravel or ASP.NET
source, database, migration, runtime request, container, or production
operation was performed. This slice is unscored; the canonical bank remains
`663/1,000` until another complete fixed-rubric audit.

### 2026-07-15 Gamification dispatcher API assertion follow-up

The shared gamification dispatcher now has direct API-client proof for all six
Laravel route declarations that are consumed by Web UK but omitted from
OpenAPI. The assertions pin the legacy `/api/achievements/progress` exception,
the five `/api/v2/gamification/*` paths, bearer authority, explicit GETs, query
preservation, unmodified data/meta projections, and structured feature-disabled
`403` propagation. This closes direct API-client coverage for the largest
remaining unique helper in finite package 9; live feature/role/fixture variants
remain assigned to the disposable environment.

The focused API-client suite passes `222/222`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 OpenAPI-omission direct-assertion closure

The final nine unique helpers behind Laravel route declarations omitted from
OpenAPI now have direct API-client assertions. The closing slice pins bookmark
and saved-collection queries, public and signed reaction reads, newsletter
token and given-review reads, job CV and resource binary downloads, identifier
encoding, data/meta envelopes, bearer boundaries, bytes/file/cache metadata,
and structured binary `404` propagation. Together with the preceding focused
slices, all `85` unique helpers behind the `217` omitted contracts now have a
direct `tests/api.test.js` assertion reference. This helper-level result does
not claim that every path dispatched through a shared helper is asserted.

Ledger schema 2 makes this boundary durable and reports
`routeDeclaredOpenApiOmissionHelpersWithoutDirectApiAssertions: 0`; focused
API-client and generator proof passes `231/231`, and the complete non-mutating
gate passes `52/52` suites and `1,721/1,721` tests. This closes only the direct-
helper assertion subqueue. Exhaustive significant request/response fields,
role/status variants, side effects, and runtime certification remain open in
finite package 9 and the disposable-environment packages.

No Laravel or ASP.NET source, database, migration, runtime request, download,
container, or production operation was performed. This slice is unscored; the
canonical bank remains `663/1,000` until another complete fixed-rubric audit.

### 2026-07-15 Course dispatcher path-assertion follow-up

The shared course dispatcher now has direct API-client proof for the remaining
OpenAPI-omitted authoring, enrolment, lesson, publication, review, section,
grading, and quiz-attempt paths. Twelve method/path/payload cases pin bearer
authority, body omission on DELETE, exact nested identifiers, unmodified
success envelopes, and structured publication-conflict `409` propagation.
Together with the pre-existing completion/delete/list assertions, this closes
the currently generated OpenAPI-omitted course path set at the API-client
boundary. Routed significant states and mocked payload tests remain in place;
live effects and cleanup remain assigned to the disposable environment.

The focused API-client suite passes `227/227`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Jobs response path-assertion follow-up

The shared Jobs dispatcher now has direct API-client proof for all four
OpenAPI-omitted interview and offer response paths. Accept/decline/reject cases
pin Laravel's exact nested paths, `PUT` verbs, bearer authority, notes payloads,
unmodified response states, and structured no-longer-pending `409` propagation.
This closes the currently generated Jobs response-decision path set at the
API-client boundary; routed role/significant-state tests remain in place, while
live two-user effects and cleanup remain assigned to the disposable environment.

The focused API-client suite passes `228/228`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Conversation mutation path-assertion follow-up

The shared conversation dispatcher now has direct API-client proof for group
creation and participant add/remove paths in addition to the existing message-
creation assertion. The cases pin Laravel's exact nested paths, POST/DELETE
verbs, bearer authority, participant arrays, body omission on DELETE,
unmodified success envelopes, and structured management-denial `403`
propagation. This closes the currently generated OpenAPI-omitted conversation
mutation path set at the API-client boundary; routed membership/role tests
remain in place, while live effects and cleanup require the disposable runtime.

The focused API-client suite passes `229/229`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 WebAuthn security path-assertion follow-up

The legacy WebAuthn dispatcher now has direct API-client proof for security
confirmation and credential removal in addition to passkey rename. The cases
pin Laravel's exact `/api/webauthn/*` paths, POST verbs, bearer authority,
password/credential/proof payloads, unmodified success envelopes, and
structured security-confirmation-required `401` propagation. This closes the
currently generated OpenAPI-omitted WebAuthn path set at the API-client
boundary; browser ceremonies, session revocation and live credential effects
remain assigned to the disposable runtime and manual certification packages.

The focused API-client suite passes `230/230`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Federation mutation path-assertion follow-up

The shared federation dispatcher now has direct API-client proof for connection
request/accept/reject, message translation, batch read, and credit-transfer
paths in addition to existing message and connection-removal assertions. The
cases pin Laravel's exact paths, POST verbs, bearer authority, payload omission
for empty actions, cross-tenant recipient fields, translation/read identifiers,
idempotency data, unmodified success envelopes, and structured transfer `422`
validation propagation. This closes the currently generated OpenAPI-omitted
federation mutation path set at the API-client boundary; live cross-tenant
effects, role policy, balances and cleanup require the disposable runtime.

The focused API-client suite passes `231/231`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Marketplace mutation path-assertion follow-up

The shared marketplace dispatcher now has direct API-client proof for the
remaining OpenAPI-omitted listing offer/renew/report/save paths, offer decisions
and withdrawal, order cancellation/delivery/rating/shipping, seller coupon
create/update/delete, and pickup scan/slot create/update/delete. Nineteen cases
pin Laravel's exact nested paths and verbs, bearer authority, body omission for
empty actions and deletes, offer/order/coupon/slot payloads, unmodified success
envelopes, and structured offer `422` validation propagation. Together with the
existing listing create/update/delete proof, this closes the currently generated
OpenAPI-omitted marketplace mutation paths at the API-client boundary. Live
payments, two-party state, uploads, fulfilment and cleanup require the isolated
disposable runtime.

The focused API-client suite passes `233/233`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Group invitation path-assertion follow-up

The shared Group dispatcher now has direct API-client proof for invitation-link
creation, invitation-email delivery, and invitation revocation in addition to
the existing file deletion and notification-preference assertions. The cases
pin Laravel's exact nested paths and verbs, bearer authority, bounded expiry,
email/message arrays, body omission on DELETE, unmodified success envelopes,
and structured management-denial `403` propagation. Together with the existing
multipart upload proof, this closes the currently generated OpenAPI-omitted
Group file/invitation/preference mutation paths at the API-client boundary.
Live delivery, membership policy, storage effects and cleanup require the
isolated disposable runtime.

The focused API-client suite passes `234/234`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Volunteering mutation path-assertion follow-up

The shared volunteering dispatcher now has direct API-client proof for the
OpenAPI-omitted accessibility-needs, donation, expense, incident, organisation
settings, organisation-wallet deposit, and training paths. Seven cases pin
Laravel's exact paths and verbs, bearer authority, accessibility/emergency,
financial/currency, safety, organisation and training payload fields,
unmodified success envelopes, and structured vetting-required `403`
propagation. Together with the existing organisation, credential, hour and
workflow assertions, this closes the currently generated omitted path set for
this volunteering subfamily at the API-client boundary. Live safeguarding,
ledger, upload and cleanup effects require the isolated disposable runtime.

The focused API-client suite passes `235/235`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Profile policy path-assertion follow-up

The shared profile dispatcher now has direct API-client proof for global digest
settings, vetting-review requests, and policy-review confirmation in addition
to safeguarding revocation. The cases pin Laravel's exact v2 paths, POST verbs,
bearer authority, the global context/frequency payload, body omission for the
controlled no-evidence review actions, unmodified success envelopes, and
structured already-open `409` propagation. Existing direct proof continues to
cover member block/unblock and connection decline. Live policy state, session
effects and role variants require the isolated disposable runtime.

The focused API-client suite passes `236/236`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Merchant onboarding path-assertion follow-up

The merchant-onboarding dispatcher now has direct API-client proof for identity
step 1 and bodyless completion in addition to business-address step 2. The
cases pin Laravel's unprefixed `/api/v2/merchant-onboarding/*` paths, POST verbs,
bearer authority, seller/business identity payload, deliberate body omission on
completion, unmodified step/completion envelopes, and structured identity
`422` validation propagation. This closes the currently generated omitted
merchant-onboarding path set at the API-client boundary; live eligibility,
provider-account state and persistence require the isolated disposable runtime.

The focused API-client suite passes `237/237`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

### 2026-07-15 Message translation and goal nudge path-assertion follow-up

The distinct message and goal dispatchers now have direct API-client proof for
message translation and buddy encouragement. The cases pin Laravel's exact
`/api/v2/messages/{id}/translate` and `/api/v2/goals/{id}/buddy/nudge` paths,
POST verbs, bearer authority, target-language and typed encouragement payloads,
unmodified success envelopes, and structured translation `422` validation
propagation. Existing feed, marketplace and appreciation assertions already
cover the other reviewed social-action paths. Live translation-provider,
buddy-policy and persisted notification effects require the isolated
disposable runtime.

The focused API-client suite passes `239/239`. No Laravel or ASP.NET source,
database, migration, runtime request, container, or production operation was
performed. This slice is unscored; the canonical bank remains `663/1,000`
until another complete fixed-rubric audit.

At published Web UK product SHA `c961187c`, the complete Jest aggregate passes
`52/52` suites and `1,734/1,734` tests.

### 2026-07-15 Isolated public accessibility runner

Published Web UK product SHA `10f01c7c` adds a reproducible loopback-only
accessibility backend for browser checks that do not require Laravel state. It
supplies bounded GET fixtures for the tenant chooser, tenant bootstrap,
platform statistics, and registration policy; clears inherited API overrides;
rejects every backend method except GET/HEAD; and fails the runner if a backend
mutation is attempted. The current-checkout Playwright server still binds to a
random loopback port and writes only ignored local artifacts.

On the canonical `/hour-timebank/accessible` mount, the isolated runner passes
`14/14` representative public structure/serious-critical axe cases and `4/4`
keyboard order, skip-link, client error-summary focus/field association, 320px
reflow, forced-colour, and serious-critical axe cases. Override-resistance was
also exercised with hostile inherited `API_BASE_URL` and `LARAVEL_BASE_URL`
values; the runner used its own random loopback fixture. No Laravel or ASP.NET
source, database, authentication, mutation, upload, download, container, or
production operation was performed. This is partial package-11 browser
evidence, not screenshot comparison, screen-reader, full WCAG, Laravel runtime,
or release certification. The canonical bank remains `663/1,000` until another
complete fixed-rubric audit.

Published product SHA `7e158d29` adds default-English resilience proof without
expanding Arabic route coverage. Home, registration, Legal, and Listings pass
at a 320 CSS-pixel viewport with no horizontal overflow and no serious or
critical axe violations. Login, registration, and Contact also retain one main
heading, bounded server-rendered POST actions, CSRF fields, and no horizontal
overflow with JavaScript disabled. The focused isolated subset passes `5/5`.
This does not simulate actual 200%/400% browser zoom and does not change the
remaining manual or runtime certification boundary.

Published product SHA `9249ad60` extends that subset to `6/6` with an invalid
no-JavaScript registration round trip. The response preserves submitted input,
links the summary and inline error to the missing field, keeps the error summary
programmatically focusable, and has no horizontal overflow at 320 CSS pixels.
The loopback fixture rejects unsafe backend methods, so the case performs no
Laravel registration mutation. The concrete regression exposed by this case
was systemic: all 24 active `govukErrorSummary` macro invocations now provide
`tabindex="-1"`, and the source guard covers both macro-rendered and handwritten
summaries. Focused Jest proof passes `25/25`; the complete non-mutating gate
passes `52/52` suites and `1,734/1,734` tests, with green lint and the 322-template
zero-match audit. No Laravel or ASP.NET source, database, migration, runtime
request, container, or production operation was performed. Actual browser
zoom, screenshots, screen-reader output, the disposable-Laravel aggregate, and
human assistive-technology review remain open. This slice is unscored; the
canonical bank remains `663/1,000` until another complete fixed-rubric audit.

Published product SHA `b6166484` adds a reproducible
`manual:accessibility:isolated` command for directed browser review of the
current checkout. It keeps the existing random-loopback Web UK listener and
bounded mock alive until interrupted, clears inherited backend overrides, and
retains the mock's GET/HEAD-only enforcement. A canonical signed-out login GET
returned `200` with one main landmark, one H1, and the mounted form action; the
complete non-mutating gate passes `52/52` suites and `1,734/1,734` tests, with
green syntax, lint, documentation-consistency, and diff checks. The available
in-app browser connector failed before tab creation with `Cannot redefine
property: process`, so no directed keyboard or assistive-technology pass is
claimed from this run. No Laravel or ASP.NET source, database, migration,
authentication, mutation, container, or production operation was used. The
canonical bank remains `663/1,000` until another complete fixed-rubric audit.

Published product SHA `cbed0c9e` adds a deterministic paired screenshot
capture command for six representative default-English public pages at
`1280 x 800` and `320 x 800`. It requires explicit disposable-Laravel
confirmation, refuses `/alpha` and credential-bearing base URLs, blocks every
browser request method except GET/HEAD, checks one H1 and one main landmark,
and checks narrow horizontal overflow. It writes 24 ignored PNGs and a
machine-readable manifest keyed by the supplied Laravel/Web UK source IDs;
human pair review remains deliberately separate. Focused contract proof passes
`7/7`, and the complete non-mutating gate passes `53/53` suites and
`1,741/1,741` tests, with green direct lint, syntax, documentation-consistency,
and diff checks. No screenshots were captured in this slice because no
verified disposable Laravel listener exists. No Laravel or ASP.NET source,
database, migration, browser, container, or production operation was used.
This support slice is unscored; the canonical bank remains `663/1,000` until
another complete fixed-rubric audit.

Published product SHA `0197b0a3` turns each screenshot manifest into a strict
12-pair review packet: responsive side-by-side `review.html` plus editable
`review.md`. Pair construction rejects missing, duplicate, or unknown surfaces;
the HTML escapes source metadata; and both worksheets require one outcome,
reviewer, date, and resolved notes per route/viewport pair. Focused proof passes
`9/9`; the complete non-mutating gate passes `53/53` suites and
`1,743/1,743` tests, with green direct lint, syntax, documentation-consistency,
and diff checks. No screenshots or review outcomes were produced because the
verified disposable Laravel listener remains absent. No Laravel source,
database, migration, browser, container, or production operation was used.
This support slice is unscored; the canonical bank remains `663/1,000` until
another complete fixed-rubric audit.

### 2026-07-15 finite source-contract assertion manifest

The API consumer ledger now emits a deterministic direct-assertion manifest
instead of leaving the remaining static/mock deduction as open-ended prose.
Across 668 consumed contracts, 30 read-only rows spanning 23 helpers still lack
a test that directly names and exercises the helper. All 370 state-changing
rows now have direct helper assertions: focused API tests close the remaining
Event Template read/mutation wrapper paths, including the idempotency header and
JSON payload, and the Resource multipart upload path, fields, bearer authority,
file body, and browser-owned content boundary.

Generated ledger side-effect and cleanup text now matches the active frontend
goal: state-changing workflows require source-derived mocked assertions, while
live Laravel runtime work is optional and separate. The manifest explicitly
forbids using live Laravel fixtures for its closure. Focused generator/API proof
passes 2/2 suites and 246/246 tests. No Laravel request, login, database,
migration, mutation, upload, download, container, or ASP.NET operation was
performed.

The immediate follow-up closes the full 30-row manifest. Four grouped mocked
API tests exercise every remaining read-only helper/path family, including
query ordering, identifier encoding, optional versus required bearer authority,
JSON responses, and Event/Poll binary downloads. Regeneration now reports zero
rows, zero unique helpers, and zero state-changing rows without direct helper
assertions across all 668 contracts. Focused generator/API proof passes 2/2
suites and 250/250 tests. This closes the source-contract assertion package
without changing the frozen historical score or claiming live runtime
certification.

### 2026-07-15 enforced isolated accessibility selection

The isolated accessibility command previously selected the complete 93-case
Playwright aggregate by default. Its read-only mock correctly rejected an
authenticated `POST /api/auth/login`, stopping the run at 33 passed, 2 failed,
and 58 unrun; no Laravel environment was addressed. The runner now strips
caller-supplied grep and grep-invert arguments and enforces exactly the three
documented safe groups: representative public pages, keyboard/focus/error/
forced-colour behavior, and default-English resilience.

Selection-unit proof passes 3/3. The repaired isolated command passes 24/24 in
82.2 seconds against random-loopback Web UK and GET/HEAD-only mock listeners,
including public axe/structure, no-JS validation recovery, focus ordering,
linked error summaries, 320 CSS-pixel reflow, and forced-colour checks. Directed
manual and screen-reader review remains unclaimed: the in-app browser connector
failed twice before tab creation with `Cannot redefine property: process`.
No Laravel request, login, database, migration, mutation, container, or ASP.NET
operation was performed.

### 2026-07-15 source-owned production hardening closure

The production container now installs the committed dependency graph with
non-interactive `npm ci --no-audit --no-fund` in every stage and accepts one
shared `NODE_IMAGE` build argument so a release operator can supply an approved
digest. The production stage now includes the canonical `contributors.json`;
an image smoke exposed and closed that omitted-runtime-asset regression.
Source-contract tests pin the non-root user, readiness health check, locked
installs, digest support, required contributor data, and production command.
The fail-closed release runbook now uses the real locale scripts, makes the
24-case isolated accessibility gate source-owned, and separates any future
authorized live integration from this frontend goal.

Focused production configuration, Redis session, API timeout, route, and
container proof passes 4/4 suites and 79/79 tests. Docker's build-definition
check reports no warnings, all three locale audits are green, and the production
dependency audit reports zero vulnerabilities. The uninterrupted repository
gate passes 55/55 suites and 1,755/1,755 tests, branding, lint, CSS, documentation
consistency, Markdown links, and diff checks. The complete production image
target builds successfully; image inspection confirms `appuser`, the health
command, and the Node entry point, while a local no-backend startup check fails
closed on missing production secrets and Redis before listening. Deployment,
Redis failover, and release authorization remain operations evidence; the
source-owned hardening package is complete without changing the frozen
historical score. No Laravel request, login, database, migration, mutation, or
ASP.NET operation was performed.

- GOV.UK crown, logotype, official header identity, OGL block, or Crown
  copyright wording.
- Laravel/PHP implementation details.
- Production traffic routing before certification.
- ASP.NET-specific visual inventions that diverge from the Blade source.
