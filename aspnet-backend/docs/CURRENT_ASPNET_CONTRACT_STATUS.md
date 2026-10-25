# Current ASP.NET contract status

## Independent verification — 25 October 2026 (second reviewer)

The owner asked for an independent check of the Codex audit recorded below.
Every Codex finding was re-traced from source (frontend caller → selected
ASP.NET action, including `AdminV2RouteAliasConvention` aliases and the
`LaravelDataEnvelopeFilter` → Laravel handler), and journeys Codex did not cover
were audited fresh. The Release solution was rebuilt at `206aff531`: zero errors,
33 warnings. Nothing was executed against a database, server or browser; every
verdict below is from source, and the "Not verified" list at the end is part of
the result.

**Verdict: ASP.NET is not interchangeable with Laravel for either unchanged web
frontend, and a new ASP.NET installation cannot be set up.** The Codex findings
are accurate. None was refuted; a few are overstated, several understated, and
the fresh pass found blockers Codex missed, including some in the most basic
journeys.

### Why the gap is larger than in August

The August journey certifications (historical record below) were real at the
time, but the target has moved while ASP.NET stood still. Between the pause on
2026-09-11 and `206aff531`, `aspnet-backend/src` received 2 commits; React
`src/` received 492, `web-uk/src` 120, `app/` 808, and `routes/api.php` gained
about 181 route declarations. Example: React's browser login now requires the
`session_binding` / HttpOnly refresh-cookie contract (`a9df1e55d`, 2026-09-24),
which ASP.NET never implemented, so the August-certified login and refresh rows
(1.6, 1.7) no longer hold against today's client. The gap will keep widening for as
long as Laravel and the frontends change and ASP.NET does not. Any restart plan
needs a mechanism that detects drift on every Laravel/frontend change, not a
one-off audit.

### Codex findings — verification result

| Codex ID | Result | Correction or addition |
| --- | --- | --- |
| R-01, R-02 | Confirmed | Also breaks the 2FA login path (`TotpController.cs:169` issues no binding). |
| R-03, R-04, R-06, R-08 | Confirmed | — |
| R-05 | Confirmed | P2 is the fairer severity; polling still refreshes messages. |
| R-07 | Confirmed | A real `LegalDocumentService` and admin controller exist at `api/admin/legal/documents` (`LegalDocumentsController.cs`), and the member acceptance gate uses real documents. The React admin calls the fabricated `/v2/admin/legal-documents` handlers instead, so admins see "no documents" while members must still accept real ones. The repair is mostly rewiring, not building. |
| W-01, W-02, W-04 to W-07 | Confirmed | W-03 and W-07 also affect React (`ReportProblemButton.tsx` sends multipart; `AuthContext.tsx` sends `trust_device`). |
| W-08 | Confirmed, **and it is a live Laravel defect** | Laravel refuses any `certificate_file` (`UserInsuranceController.php:38`, since `70047c526`, 2026-07-14), but web-uk requires one (`routes/settings.js`) and always sends it (`lib/api.js` `uploadInsuranceCertificate`). The accessible-site insurance form cannot succeed against production today. Fix it in normal bug triage, independently of ASP.NET. |
| B-01 to B-04, B-06 | Confirmed | B-03 also covers `groups/bulk-unarchive` (`AdminExplicitParityController.cs:587`). |
| B-05 | Confirmed | Arguably P1: payment recipients are never told they were paid. |
| Goal routes and writes | Confirmed | Also fake: goal `from-template` (returns `id=0`) and add-buddy (`CompatibilityAliasController.cs:988-1014`). `GET /v2/goals/{id}/buddy-requests` and accept/decline have no ASP.NET route. A bodyless legacy DELETE likely fails binding (non-nullable `[FromBody] JsonElement`). |
| D-P01 (33 ambiguous routes) | Mechanism confirmed; impact partly overstated | Root cause: the alias convention de-duplicates only on identical template text, so `{groupId:int}` versus `{id:int}` slips through. Controller-level aliases never consult action routes. Group scheduled posts and `notification-prefs` are consumed by both clients. The `skills/my` examples are not consumed (React uses `/v2/users/me/skills`). The third `users/me/listings` "collision" is only a listed candidate, not a tie. Missed by Codex: web-uk `DELETE /api/ai/conversations/{id}` is one of the 33. Fixing the 33 one by one will not stop new collisions; the convention itself needs a method-and-pattern-aware duplicate check. |
| DR-01 to DR-05, D-W01 to D-W06, D-B01 to D-B03 | Confirmed | DR-03: the ASP.NET `Listing` entity has no moderation-status column at all, so part of the fix is schema. DR-02: the correct owner-filtered handler exists (`CompatibilityController.GetUserListings`) but is outranked by the constrained route. D-W03 is arguably P1 (managers see no applicants). D-W04: JSON is certainly rejected (415), not "possibly". D-W06: a repeat dismissal returns 400 where Laravel is idempotent. |
| DR-06 | Confirmed and understated | React's "join waitlist" (`POST /v2/events/{id}/waitlist`) is routed to the same `V2Rsvp` action, which defaults to `going`, so joining a waitlist confirms a place. `GET .../waitlist` returns an empty stub. |
| D-B04 | Partly | Codex's claim that "a complete file search has no `push_enabled` reference" is wrong: `EventNotificationPreferenceResolver.cs:53` honours it for event invitations. The gap holds for every generic `SendPushAsync` producer. |
| Durability candidates | Confirmed as source windows only | Not fault-injected. |

### New findings (not in the Codex audit)

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| V-01 | P1 | **A new installation cannot create its first community or administrator.** Seeding runs only in Development (fictitious `acme`/`globex` with published passwords) or as the opt-in demo showcase. No migration inserts a tenant, and tenant creation through the API needs an existing platform super admin. A fresh production database answers "No active tenant found". Laravel's `TenantSeeder` creates the master tenant and a super admin from `NEXUS_BOOTSTRAP_ADMIN_PASSWORD`. | `Program.cs:466-486`, `Data/SeedData.cs`, `AdminCompatibility3Controller.cs` (`PlatformSuperAdminOnly`); Laravel `database/seeders/TenantSeeder.php` |
| V-02 | P1 (security, not deployed) | **Any signed-in member can set any member's attendance on any event.** `V2Rsvp` takes `user_id` from the request body (`GetInt(body, "user_id") ?? CurrentUserId()`) behind a plain `[Authorize]`. It serves `/attendance`, `/attendance/bulk`, `/attendees/{attendeeId}/check-in` (ignoring `attendeeId` and always answering `checked_in = true`) and `/waitlist`. ASP.NET is not deployed, so no one is exposed. It must be fixed before any ASP.NET release. Recorded here rather than in the security register because ASP.NET is outside every security engagement's scope (ADR-0005). | `V15MemberParityController.cs:610-636` |
| V-03 | P1 | **Admin "approve member" does not let the member sign in.** The endpoint sets only `IsActive`. Login still refuses `PendingAdminReview`, and the member drops off the pending list, so the account looks approved. The correct transition (`RegistrationOrchestrator.AdminApproveAsync`) is reachable only on a route no frontend calls. | `AdminCompatibilityController.cs:453-475`, `AuthController.cs:337-341`, `RegistrationPolicyController.cs:520` |
| V-04 | P1 | **Email verification cannot complete from either frontend.** Both clients post an anonymous `{token}` from an emailed link. ASP.NET requires sign-in, reads a 6-digit `code`, and emails a code, not a link. web-uk's resend endpoint is a stub that reports "sent". Separately, ASP.NET's Standard registration mode activates accounts without any email verification, where Laravel always requires it (a policy difference). | `AuthController.cs:1374-1376`, `:1007-1020`, `:1636-1640`; `CompatibilityAliasController.cs:2921-2925`; `RegistrationOrchestrator.cs:118-125` |
| V-05 | P1 | **Registration in approval-mode communities leaves React falsely "signed in".** ASP.NET returns 201 with no tokens and no `requires_approval`/`requires_verification` flags, so React takes its "no gates" path. | `AuthController.cs:1046-1107`; React `AuthContext.tsx:808-858`; Laravel `RegistrationService.php:640-673` |
| V-06 | P1 | **New members have no starting balance, so the first exchange fails.** Laravel grants the configured starting balance (default 5 h) on activation and on admin creation. ASP.NET grants none automatically, and settlement refuses with InsufficientBalance. | `ExchangeService.cs:491-503`; Laravel `StartingBalanceService.php`, `RegistrationService.php:744` |
| V-07 | P1 | **Exchanges send no notifications at any step.** `ExchangeService` has no notification dependency, and `SendExchangeNotificationAsync` has no callers. Laravel notifies on request, accept, decline, approve, reject and pending-broker. | `ExchangeService.cs:75-91`, `EmailNotificationService.cs:193`; Laravel `ExchangeWorkflowService.php:167-344` |
| V-08 | P1 | **Creating a group from React fails (415).** React always sends multipart; ASP.NET binds JSON only. web-uk sends JSON, so it works there. | `GroupsController.cs:423-425`; React `groupForm.ts`, `CreateGroupPage.tsx` |
| V-09 | P1 | **Feed posts with an image fail from both clients (415).** Text posts work, but `visibility`, `publish_status` and `scheduled_at` are ignored, so scheduled posts publish immediately. | `V15SocialCompatibilityController.cs:346-349`; React `PostTab.tsx`; web-uk `api.js` |
| V-10 | P1 | **The admin module switches do nothing, and every module shows as on.** Writes go to `modules.{x}`, bootstrap reads `module.{x}`, and `GET /v2/admin/config` returns a shape React does not read. Feature toggles (`features.`) do work. | `AdminCompatibilityController.cs:1304-1320`, `CompatibilityController.cs:2068-2084`, `AdminController.cs:1182-1203`; React `ModuleConfiguration.tsx` |
| V-11 | P1 | **Listing image upload, delete, reorder, renew, report and analytics are success-shaped stubs.** | `V15MemberParityController.cs:1157-1165`; React `ListingForm.tsx` |
| V-12 | P2 | **Wallet history shows at most 20 rows with a blank counterparty.** It ignores `per_page`/`cursor`/`type`, returns no cursor, and omits `other_user`. | `V15MemberParityController.cs:1315-1340`; React `WalletPage.tsx` |
| V-13 | P2 | **The default avatar image is missing**, so members without a photo show a broken image. | React `helpers.ts:137`; ASP.NET `wwwroot` has no `assets/img/defaults` |
| V-14 | P1 | **Most recurring member-facing jobs have no ASP.NET equivalent.** Missing: notification email queue and daily/monthly digests, newsletters, event reminders, event broadcast and message-delivery outboxes, match digests, listing-expiry reminders, listings round-up, gamification daily/streaks, scheduled feed/group posts, member invitations, retention enforcement, overdue-GDPR checks, sitemap, session cleanup. About 29 hosted services do exist. | `Extensions/ServiceExtensions.cs:206-431`; Laravel `bootstrap/app.php`, `CronJobRunner` |
| V-15 | P2 | **Outbound email supports only SendGrid and the Gmail API outside Development.** An installation with an ordinary SMTP server cannot send mail. Welcome and verification emails are fire-and-forget (`Task.Run`), with failures only logged. | `ServiceExtensions.cs:71-88`, `AuthController.cs:984-1030` |
| V-16 | P2 | **Features shipped since the pause have no ASP.NET route**, for example the offers-and-requests round-up (`/v2/users/me/listings-digest`, released 2026-10-25). This is the drift described above, not an isolated case. | React `ListingsDigestSetting.tsx:42,61` |

Areas that looked correct in this pass (route and handler present, no defect
found; response shapes not diffed field by field): tenant bootstrap feature
defaults, standard password reset (though web-uk's `experience: 'accessible'`
is ignored, so accessible-site users land on the React reset page), direct
messages and notifications at route level, group join and leave, event
create/list/detail, avatar upload and serving, and personal wallet locking.

### Not verified

No database, HTTP server, browser, provider or worker was run. The 33 ambiguous
routes are taken from Codex's in-process harness, with the mechanism confirmed
by reading the convention and routes. They were not re-executed. Response shapes
for messages, notifications and events were not diffed field by field. Admin and
super-admin branches beyond those named, localization, federation, SSO, billing,
the mobile app and every module state machine remain unaudited. No completion
percentage is justified.

### What this means for the estimate below

Codex's 53-package work list is a reasonable inventory, and nothing found here
contradicts its shape. Its day counts (478 / 951 / 1,712 engineer-days) are
judgement allowances for human engineers, not measurements. Treat them as an
order of magnitude only. The new findings fall mostly inside existing packages:
B6 bootstrap, B2 identity, B3 settlement, B5 workers, RA04, RA02, RA22 and RA01.
They do not need new packages, but they show that even the core packages are
larger than "verify and repair". The only defensible forecast is the one Codex
also recommends: do one measured vertical slice first, then re-estimate.

---

**Estimate clarification (25 October):** The roughly 950 engineer-day total is an uncalibrated sum of broad human-effort allowances, not a reliable delivery forecast and not a measured AI-assisted estimate. Do not convert it into a promised calendar duration. Retain the work inventory; establish an AI-assisted forecast only after representative implementation and runtime verification are measured following explicit resumption.

## New-installation scope and implementation assessment — 25 October 2026

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

The reconciled assessment contains **53 work packages**. Budgetary scenarios are **478 / 951 / 1,712 engineer-days** (low / conservative planning allowance / high rework). Round these to about **480–1,710**, with an allowance around **950**. The exact sums do not imply exact forecasting: these include verification and repair of real but unproven modules, not just confirmed missing code. They are not a calibrated most-likely prediction, statistical interval or a promise of AI elapsed time. Local tests/review are included in each package; shared verification is counted once, with no extra blanket contingency.

New source findings include fabricated enterprise-role CRUD, audit-only pilot updates, empty financial statements, absent current qualifications/fundraising workflows and wellbeing sharing mismatch. The migration-drift script masks command failure. The actual shape comparator returned MATCH for synthetic changed permissions, amounts and states; it cannot establish outcome parity. Earlier runtime/test evidence below keeps its original boundary.

Read [ROADMAP.md](ROADMAP.md) for the costed sequence and [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md) for the next session. Detailed source-backed scope, ownership, acceptance, dependency graph, scenario arithmetic and unstarted tasks are retained in `.local-docs-archive/aspnet-audit/2026-10-25/scope-pass/`. The package ledger is `IMPLEMENTATION-WORK-PACKAGES.json`/`.csv`; `tasks/start-stage.md` is the concrete first-stage checklist. These ignored artifacts are local and are not present in a fresh clone. This maintained document carries the public-safe scope and readiness summary.


**Not currently interchangeable. Development remains paused; this is a two-pass audit and restart-preparation record, not implementation or release approval.**

## Deeper code-led audit — 25 October 2026

| ID | Priority | Finding and consequence (source-traced unless reproduced) | Required future acceptance |
| --- | --- | --- | --- |
| D-P01 | P1 | 33 synthetic requests throw ambiguous-match errors, including group preferences/scheduled posts and skill actions | Real consumer corpus selects one intended action; HTTP and browser outcomes then pass |
| D-P02 | P2 | 188 migration source files but 186 EF-discovered migrations; filename checker calls the former runtime count | Explain orphan classes; compare discovered IDs; replay blank and upgrade databases |
| DR-01 | P1 | Listing continuation returns null cursor while has_more is true; React repeats page one | More than two pages, no duplicates, valid next cursor and terminal page |
| DR-02 | P1 | Numeric profile listing query ignores route owner | Two distinct owners and empty/restricted profiles return the correct records |
| DR-03 | P1 | Ordinary listing browse omits Laravel's status/moderation visibility predicates | Active, pending, rejected, closed and deleted fixture outcomes match |
| DR-04 | P1 | Unified search returns grouped object while React iterates a flat list | Real client renders all supported types, empty states and filters |
| DR-05 | P2 | Comment read truncates to 20 roots and one reply depth | Complete tree/count/order after create, reply and delete |
| DR-06 | P1 | RSVP writes going without the capacity/waitlist registration workflow | Capacity-one concurrent requests, waitlist/refusal and persisted counters match |
| D-W01 | P1 | Opportunity detail omits Web UK's consumed management grants | Owner/co-admin can manage; applicant/stranger cannot |
| D-W02 | P1 | Shift request/response names differ; edit/delete/roster handlers absent | Create, reload, edit, roster and cancel work with actual client payloads |
| D-W03 | P2 | Application list array/page contract differs from items/cursor | 25 applications render and paginate once each; decisions survive reload |
| D-W04 | P1 | Expense JSON binding, organisation ownership and tenant currency differ; organisation review paths absent | JSON and file claims retain organisation/currency, receipt bytes and idempotency |
| D-W05 | P1 | Web UK rejects the matches envelope; underlying row shape also differs | Empty/populated matches render correct module IDs, links and reasons |
| D-W06 | P1 | Dismissal treats listing ID as match-row ID | Deliberately different IDs affect only the selected listing, preserving reason |
| D-B01 | P1 | React deletion completes with profile/listing/subscription remnants | Full caller-visible anonymization/lifecycle and retained-ledger assertions |
| D-B02 | P1 | Web UK erasure request deliberately returns 501 | Persist request and invalidate sessions with the expected request/logout contract |
| D-B03 | P1 | Generic push queue drains only from invitation processing | Group/volunteer notification reaches fake provider with no invitation present |
| D-B04 | P1/P2 | Saved global push opt-out is not checked by shared delivery | Two-device opt-out and already-pending notifications cause zero provider calls |

### Deeper source anchors

- [Listing/profile and RSVP compatibility handlers](../src/Nexus.Api/Controllers/V15MemberParityController.cs), [search handler](../src/Nexus.Api/Controllers/SearchController.cs), [threaded comments](../src/Nexus.Api/Services/ThreadedCommentService.cs).
- [Volunteer grants/applications/shifts](../src/Nexus.Api/Controllers/VolunteeringController.cs), [expense submission](../src/Nexus.Api/Controllers/VolunteerExpenseSubmissionController.cs), [Web UK volunteer routes](../../web-uk/src/routes/volunteering-actions.js).
- [Matching boundary](../src/Nexus.Api/Controllers/CompatibilityController.cs), [matching service](../src/Nexus.Api/Services/MatchingService.cs), [Web UK match consumer](../../web-uk/src/routes/matches.js).
- [Erasure implementation](../src/Nexus.Api/Services/GdprService.cs), [generic push queue/delivery](../src/Nexus.Api/Services/PushNotificationService.cs), [actual alias convention](../src/Nexus.Api/Routing/AdminV2RouteAliasConvention.cs).

### New verification and corrections

- The isolated API unit selection passed **556**, failed 0, skipped 0. Earlier 49 API tests overlap; do not add them to 556. Earlier 5 messaging and 77 mocked Web UK passes were not repeated in this pass.
- **5,803 synthetic routing requests; 33 AmbiguousMatchException results.** The harness uses actual MVC aliases and API-versioning registration and stops before controller/auth/database execution. Default response status 200 in that harness is unused; selected endpoint/exception is the evidence. Goal GET/checkins, GET/reminder and DELETE select a 405 endpoint; PUT goal and GET podcasts select controllers.
- Npgsql metadata inspection: **186 EF-discovered migrations**, zero model/snapshot differences; offline idempotent SQL generation succeeded (1,254,215 characters). **188 is the migration source-file count**, not EF discovery. Two orphan classes lack discovery metadata; a discovered later migration also creates the federation tables, so absence of those classes is not proof of missing tables.
- Rechecked 7,781 previously captured source hashes: one unrelated listings-digest admin file changed (`react-frontend/src/admin/modules/newsletters/ListingsDigestAdmin.tsx`); ASP.NET source hashes were unchanged. Source baseline remains the recorded HEAD; hashes identify inspected inputs, not exhaustive manual coverage.
- No database connection, migration execution, real HTTP/browser journey, provider call, crash injection or hosted replay. The full integration suite was not run. This remains preparation, not compatibility certification.

Separate candidates requiring fault injection: settlement commits before notification intent is durable; push sends have no independent atomic claim in the examined dispatcher; erasure Processing may remain stranded after a crash. These are source-supported failure windows, not reproduced production incidents. Localization, external federation, SSO/billing, all remaining admin branches and every module state transition are not certified by this review.

The practical restart sequence is in [ROADMAP.md](ROADMAP.md); the fresh-session brief is [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md). Full evidence is in the ignored local audit archive under `deep-pass/`.

## First-pass findings still open — 25 October 2026

**ASP.NET is not currently interchangeable with Laravel for the two unchanged web frontends. Development remains paused.** The owner authorized this audit and documentation correction, not implementation, CI reactivation, runtime restart or deployment. Configuration-only switching remains the required outcome.

| Finding | Consequence | Evidence appendix |
| --- | --- | --- |
| React login/session binding and cookie refresh differ | Current client cannot adopt/renew the expected browser session; CORS also omits the binding header | React R01–R02 |
| Group workshop/team split rules differ | A two-hour workshop with three two-hour receivers debits 2 instead of 6; no 4-hour community-fund leg | Web UK W01 |
| Newsletter segments/templates and legal-document administration contain fabricated success | Changes do not survive a subsequent read; publication/compliance responses are not evidence of stored state | React R06–R07 |
| Refund, bulk group archive and FAQ writes fall through to audit-only dispatch | Success/accepted responses record intent without the requested provider or domain mutation | Backend B02–B03 |
| Goal aliases and persistence are incomplete | Missing v2 DELETE/check-in/reminder reads; check-in/reminder writes do not persist the requested data | Routing follow-up |
| Podcast upload does not store the audio | Ready/clean metadata and a self-referential playback URL cannot provide uploaded playback | React R04 |
| AI chat request and response shapes differ | Client sends message and expects nested message content; handler requires prompt and returns a different shape | React R03 |
| Support multipart and conditional impact validation differ | Screenshot submissions and valid non-bug submissions fail the expected contract | Web UK W03–W04 |
| Saved-search execution returns an empty success | No saved query parameters are returned, including for a nonexistent ID | Web UK W05 |
| Event broadcast scheduling has no identified delivery consumer | Queued state is not evidence of delivery | Backend B01 |
| Member export omits the Laravel export sections | A downloadable archive is not a complete equivalent export | Backend B04 |
| Pusher message events differ from SignalR delivery | Existing client subscriptions do not establish compatible message/read updates | React R05 |
| MFA recovery/device contracts differ | Missing recovery/device routes and ignored remembered-device input | React R08 / Web UK W07 |
| Group preview and public certificate-check contracts are absent | Existing Web UK/both-client journeys cannot call their expected operations | Web UK W02/W06 |
| Insurance upload is a three-way contract disagreement | Laravel refuses certificate files, Web UK requires one, ASP.NET stores one; changing ASP.NET alone cannot reconcile this | Web UK W08 |
| Wallet completion effects differ | Core ledger writes exist, but the expected notification/review follow-up chain is absent | Backend B05 |

### Source anchors for the principal findings

These implementation links make the current summary reviewable without the local evidence archive. Detailed line numbers and Laravel/client counterparts are in the audit package.

- Session continuity: [ASP.NET auth](../src/Nexus.Api/Controllers/AuthController.cs), [React transport](../../react-frontend/src/lib/api.ts), [Laravel browser cookies](../../app/Http/Middleware/BrowserRefreshCookie.php).
- Settlement: [ASP.NET group exchange service](../src/Nexus.Api/Services/GroupExchangeService.cs), [Laravel calculator](../../app/Services/GroupExchangeSplitCalculator.php).
- False-success admin operations: [newsletter handlers](../src/Nexus.Api/Controllers/AdminCompatibility2Controller.cs), [legal handlers](../src/Nexus.Api/Controllers/AdminCompatibility3Controller.cs), [audit-only dispatcher](../src/Nexus.Api/Controllers/AdminExplicitParityController.cs).
- Goals: [alias convention](../src/Nexus.Api/Routing/AdminV2RouteAliasConvention.cs), [write handlers](../src/Nexus.Api/Controllers/CompatibilityAliasController.cs).
- Uploads and exports: [podcast service](../src/Nexus.Api/Services/PodcastsCompatibilityService.cs), [member export](../src/Nexus.Api/Controllers/MemberParityController.cs), [Laravel export](../../app/Services/MemberDataExportService.php).
- Event delivery: [ASP.NET scheduling](../src/Nexus.Api/Services/EventBroadcastService.cs), [Laravel delivery consumer](../../app/Services/EventBroadcastDeliveryConsumer.php).

Test-quality finding: some route tests accept any result except 404/405, an admin test explicitly passes audit-only execution, and the wallet concurrency test permits all requests to fail with 500. These tests need outcome assertions before they can support readiness; this does not imply that all tests are weak.

### Evidence and limits

The audit read implementation and callers, not documentation as product evidence. Repository-wide inventories were followed by manual controller/service/Laravel/frontend traces and focused probes. Scope: ASP.NET source, Laravel API/services, canonical React and Web UK. Mobile, hosted environments and production data were not audited.

Source capture: initial HEAD `7d49f3251c3f8a98cc14b30d6213d2d55b5837ca`; later observed HEAD `67e030fbac1a470b0ef8f2fb7bff4d908c0a547d`. The shared tree advanced during review; there was no ASP.NET change between those commits. The evidence manifest hashes 7,781 source files; it is provenance, not a claim that every line was manually reviewed.

- Isolated offline restore and Release build: all five .NET projects, zero errors, 29 warnings.
- Selected backend tests: 49 API and 5 messaging tests passed, none failed/skipped. These are a selected subset, not the full regression suite.
- Five Web UK suites: 77 tests passed with mocked contracts, not two-backend runtime proof.
- Direct controller probes: segment creation returns HTTP-result 201/id 0 followed by an empty list; nonexistent saved-search execution returns an empty success. No middleware/HTTP/database was exercised by these probes.
- Direct invocation of the C# split calculator confirmed receiver allocations 0.67/0.67/0.66 for the workshop above. Laravel's 2/2/2 plus fund 4 comparison was traced in source, not executed in PHP.
- MVC metadata: 5,835 declarations / 5,796 normalized method/path shapes. Source scraper: 5,936 ASP.NET and 2,760 Laravel routes. Different extraction boundaries mean these are inventories, not compatible-operation counts.
- No-op heuristic: 546 flagged route-methods across 313 methods, with known false positives. These are review candidates, not 546 confirmed defects.
- Schema source inventory: 489 Laravel migration files / 188 ASP.NET migration source files (186 discovered by EF in the deeper pass); 518/460 source table names, 258 names matched. Different schemas and extraction rules prevent interpreting 260 unmatched names as 260 missing features.

Not performed: full regression suite; disposable database migration replay; fresh Laravel/ASP.NET HTTP comparison; unchanged-client browser journeys; real workers/providers, refund, email, upload playback, backup/restore or hosted replay. The deeper pass above supersedes candidate-only routing status with 33 reproduced synthetic ambiguous matches. No current completion percentage or recertification is justified.

### Preparation for a future restart

1. Preserve the development pause. Agree the contract baseline and evidence-driven backlog before resumption.
2. When implementation is explicitly reopened, restore browser login/refresh and method-aware routing, then verify both unchanged frontends.
3. Correct settlement/refunds and false-success persistence paths; assert persisted state, ledger conservation and external outcomes, not only HTTP status.
4. Complete uploads/playback, exports, broadcasts, realtime events and remaining module contracts.
5. Reconcile the insurance policy/consumer disagreement rather than copying an obsolete client upload into the backend.
6. Replay blank and upgrade migrations on disposable databases, run the full regression suites, and certify each workflow against both backends with the same fixtures and clients. Count untested/unavailable outcomes explicitly.

Detailed file/line references, reproduction notes and machine-readable evidence are retained in the local audit package at `.local-docs-archive/aspnet-audit/2026-10-25/` (ignored, not available in a fresh clone). This curated summary is the shared readiness record.

## Historical scoring record — not current certification

The record below is preserved for provenance and score-tool continuity. It does not override the October audit. Its 383 candidate, 324 floor and journey claims are dated evidence, not a current completion score.


Historical verification date: 2026-08-25 (41 journeys certified locally; 383 candidate at implementation `f25935184`; banked floor 324 at pushed, green `32bd2f94d` pending the next batched push and green CI)

Status: **Historical August score record; not current certification**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=383/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R5 -->
<!-- doc-consistency: ASPNET_RUBRIC_CATEGORY_COUNT=10 -->
<!-- doc-consistency: ASPNET_BANKED_FLOOR=324 -->

🔴 **READ THIS BEFORE THE NUMBER. The denominator is now FROZEN and the score is
RATCHETED - it can never be published lower again.** Today the owner decided the
scope is *everything*, including the mobile app (331 endpoints, 138K lines,
previously in no plan at all). That decision added 120 points of new denominator
at zero and expanded the staff tier from 100 points to 150. The consequence is
one final re-denomination: **rubric `ASPNET-CONTRACT-R5`, banked at 270/1000**,
replacing R4's 353. Nothing regressed; the work list grew from 130 journeys to
250 because a real client and a real admin surface were added to it.

**This is the last time.** Three mechanisms enforce that, and each is checkable
rather than promised:

1. **Reserve rows.** Every tier carries named `RESERVE` rows, counted in the
   denominator from today at zero credit. A journey discovered next month FILLS
   a reserve instead of growing the denominator. Reserves exhausted in a tier is
   an owner escalation, never a silent re-cut.
2. **A score floor.** `ASPNET_BANKED_FLOOR` is asserted in CI. A demotion (a
   PROVEN row proven broken) is recorded in the ledger immediately, but the
   headline publishes at the next net-non-negative banking transaction. The
   ledger is honest in real time; the headline only rises.
3. **Mechanical derivation.** The five journey categories are computed from the
   ledger's own row statuses, and CI recomputes them. A category score that
   disagrees with the rows fails the build.

🔴 **R5 is not comparable to R1-R4** (712 / 598 / 653 / 353). Comparing them is
a documented defect. R1-R3 asked how much of Laravel's API surface had a
counterpart that looked right; R4 and R5 ask how much of the product is proved
to work, and R5 asks it of a larger, complete scope. Earlier derivations are
preserved in
[`HISTORY/STATUS_ARCHIVE_2026-08.md`](HISTORY/STATUS_ARCHIVE_2026-08.md).

🔴 **R4's 353 - and the 355 first published - were also arithmetically wrong,
and that is fixed here.** An audit on 2026-08-21 found Tier 1's summary claimed
20 PROVEN / 2 PARTIAL where its rows actually held 19 / 3, and one row carried a
status (`PARTIAL-to-OPEN`) that was not in the vocabulary at all. The published
formula matched no reading of the table. The ledger's counts and its summary now
agree exactly, and CI asserts that they do.

🔴 **This score is unrelated to Web UK's.** Two 1000-point denominators exist
here and measure different things: this one measures whether the ASP.NET edition
runs the product; `WEBUK-W2-PROD-R1` measures whether the accessible frontend is
safe to serve (`../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`). Never
blend them.

🔴 **How this file works.** This preserved section describes the August baseline only. Dated narrative
lives in `HISTORY/STATUS_ARCHIVE_2026-0{7,8}.md`. The finite work list is
[`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md). The
standing session brief is [`HANDOFF_PROMPT.md`](HANDOFF_PROMPT.md). The
plain-English owner view is [`ROADMAP.md`](ROADMAP.md). Rubric rules:
[`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md).
Update-transaction rules:
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md).

## Banked score calculation - Fixed Rubric Baseline 5, 383/1000 (`ASPNET-CONTRACT-R5`; candidate pending CI, floor 324)

**Block 1 - Named baseline and SHA.** Rubric `ASPNET-CONTRACT-R5`, named
2026-08-21: **ten** fixed-weight categories, final frozen denominator, **not
comparable to R1-R4**. Evidence boundary: monorepo `d0c34906a` - pushed, with
the required workflows green (CI Pipeline, Platform contracts, E2E Tests, Docs
Lint, Security Scan and CodeQL; operational Uptime and Deploy Drift Watchdog
also green). The ASP.NET path-filtered jobs did not rerun on that Web UK-only
tip; they all ran and passed at descendant `2a74ed555` of the ASP.NET change
(build, image, messaging, static inventory, React guardrails and all six API
shards). That workflow's overall failure was confined to Web UK, then fixed;
there are zero ASP.NET file changes from `8d264b472` through `d0c34906a`.
Laravel contract source: the same
tree, exercised through the disposable Laravel on `:8091` with both parity
fixtures applied. Generated artifacts: `artifacts/parity/api/api-parity.*`
regenerated 2026-08-21T07:14; `artifacts/parity/{schema,localization}` at
2026-08-20. Denominator source:
[`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md) at 250 rows.
Controlled runtime evidence: `artifacts/smoke/react-smoke-2026-08-25T07-34-46-275Z.json`,
produced after rebuilding both backends from implementation `a100ca1ea`. Its 7/7
MATCH steps include the combined sign-out/session-invalidation journey and the
complete first-time onboarding journey on both ASP.NET and Laravel, with no
failure or skip. The static condition-5 gate is clean across every consumed auth
and onboarding path, and the no-op inventory is 550 routes across 315 methods.
The full regression boundary is 3,903/3,903 API tests and 38/38 messaging tests,
all with no failure or skip. Scoring-record SHA: the commit carrying this section.
This local evidence publishes the mechanically derived 383 candidate, but it does
not move `ASPNET_BANKED_FLOOR=324` before a batched push and green CI.

**Block 2 - Banked score.**

| Category | Banked | Maximum |
| --- | ---: | ---: |
| Core member journeys certified - React | 128 | 170 |
| Community and extended module journeys certified - React | 5 | 130 |
| Member journeys certified - Web UK accessible | 56 | 120 |
| Staff journeys certified - admin, super-admin, broker | 1 | 150 |
| Mobile app journeys certified - Expo / React Native | 0 | 120 |
| Consumed-contract correctness and stub elimination | 68 | 110 |
| Data integrity, schema, and upgrade safety | 46 | 60 |
| Auth, tenant isolation, security, and localization | 46 | 60 |
| Background processing, providers, and integrations | 11 | 40 |
| Build/test/CI evidence and operational readiness | 22 | 40 |
| **Total** | **383** | **1000** |

**Derivation.** The five journey categories are computed mechanically from the
ledger's row statuses using its published weights (CERTIFIED 100%, PROVEN 60%,
RENDERS 25%, PARTIAL 30%, OPEN/BROKEN 0%); credit = weighted sum / tier rows.

| Category | Tier(s) | Rows | Credit | x weight | Banked |
| --- | --- | ---: | ---: | ---: | ---: |
| Core React | 1 | 42 | 0.7524 | 170 | 128 |
| Module React | 2 + 3 | 70 | 0.0407 | 130 | 5 |
| Web UK | 4 | 32 | 0.4688 | 120 | 56 |
| Staff | 5 | 72 | 0.0035 | 150 | 1 |
| Mobile | 6 | 34 | 0.0000 | 120 | 0 |

Community and extended modules deliberately share one category so that an owner
scope decision on the extended modules cannot change the denominator.

🔴 **Web UK moved 37 → 56 on 2026-08-22 (+19), Tier 4 only, and this tier now
holds the first ten CERTIFIED rows on the board.** Two things happened together.
The owner decided that POSTing web-uk's own rendered form satisfies ADR-0004
condition 1 — web-uk is HTML-first with progressive enhancement and is built to
work without JavaScript, so a form POST *is* its primary path — which promoted
rows 4.1 and 4.22–4.26 and 4.30. And the two rows that were BROKEN were fixed and
re-measured: 4.28 (the group-detail response put membership BESIDE the group
instead of inside it, and joining a private group was refused outright) and 4.29
(review-create was a do-nothing stub, and pending reviews omitted the
`receiver_id` the form is built from). Two Laravel-side FIXTURE gaps that had
made 4.27 and 4.28 uncertifiable were closed in the same batch. All nine write
journeys then passed on BOTH arms in one run, twice, with the instrument's
known-defect and known-fixture-gap lists EMPTY — nothing excused.

🔴 **The floor is 324, raised on evidence rather than on the publication.** It
went to 290 first — the number CI had proved at that moment — and to 309 only
after `3b676457c` came back green with every ASP.NET job actually RUN, not
skipped: the build, the messaging tests and all six API shards (Web UK and React
jobs skipped correctly, since neither was touched). That two-step is the rule,
not ceremony: promoting a row FORCES the category arithmetic, so the published
number moves the moment the ledger does, and the floor must never follow it until
something has actually been proved. Publish the computed number, hold the floor,
raise it after CI. The 2026-08-23 transaction adds one point only: row 1.29
wallet transfer moved PROVEN → CERTIFIED after exact-SHA controlled evidence and
green CI at `d0c34906a`.

🔴 **The 2026-08-24 transaction moves Core React 55 → 69 (+14), total 310 →
324, and the floor stays at 310.** Four Tier 1 rows moved on the evidence already
recorded against them in the ledger: 1.18 listings filter and search (OPEN →
CERTIFIED), 1.19 listing create (PROVEN → CERTIFIED), 1.20 listing edit and
delete (OPEN → CERTIFIED) and 1.24 event create / edit / manage (OPEN →
CERTIFIED). Weighted credit rose 13.7 → 17.1 of 42 rows (0.3262 → 0.4071); no row
was demoted and no denominator moved. Those four commits landed the ledger rows
without rebanking the category, and each row said banking awaited the next
batched push — so this republication is that step, not new evidence. Published
implementation SHA: `3d5928730`.

🔴 **Floor raised 310 → 324 later the same day, on the second step, not on the
publication.** The 324 was published first with the floor held, because the
workflows on `3d5928730` were still running; that push then came back with the
score check itself RED, which is exactly what holding the floor protects against.
The corrected tip `32bd2f94d` is green with the ASP.NET jobs actually RUN, not
skipped: build, image builds, messaging tests and all six API shards, plus CI
Pipeline, E2E, Security Scan and the Docs Lint step that recomputes this very
table. The Web UK and React jobs skipped correctly, nothing in either having
changed; they had already run and passed every other check at `3d5928730`. Floor
evidence SHA: `32bd2f94d`.

🔴 **The 2026-08-24 core-backlog transaction moves Core React 69 → 97
(+28), total 324 → 352, while the banked floor stays 324.** Seventeen Tier 1
rows moved PROVEN → CERTIFIED: 1.1–1.4, 1.9–1.10, 1.12–1.14, 1.17,
1.22–1.23, 1.26, 1.30–1.31, 1.33 and 1.35. Weighted credit rose 17.1 →
23.9 of 42 rows (0.4071 → 0.5690); no row was demoted and no denominator
moved. The unchanged React client completed a comprehensive 22/22 MATCH run
against ASP.NET and its same-run Laravel control, with persisted effects and no
failure or skip. Full local regression: 3,900/3,900 API, 38/38 messaging and
2/2 final focused maps/recurrence tests. Implementation SHA: `54f807e8f`. The candidate becomes the
floor only after the batch is pushed and the required CI workflows are green;
there is no requirement to push between individual journey jobs.

🔴 **The 2026-08-25 sign-out/onboarding transaction moves Core React 97 → 109
(+12), total 352 → 364, while the banked floor stays 324.** Rows 1.5, 1.8 and
1.36 moved OPEN → CERTIFIED. Weighted Tier 1 credit rose 23.9 → 26.9 of 42
rows (0.5690 → 0.6405); no row was demoted and no denominator moved. The
unchanged React client completed a focused 7/7 MATCH run against ASP.NET and
the same-run Laravel control. Onboarding persisted after reload; sign-out
cleared client state, rejected copied access and refresh credentials, and
prevented protected-page re-entry. The certification gate also removed two
success-shaped onboarding reads, shrinking the no-op inventory to 550 routes
across 315 methods. Implementation SHA: `a100ca1ea`. This candidate
becomes the floor only after the batch is pushed and required CI is green.

🔴 **The 2026-08-25 relationship/settings transaction moves Core React 109 →
121 (+12), total 364 → 376, while the banked floor stays 324.** Rows 1.27,
1.32 and 1.34 moved OPEN → CERTIFIED. Weighted Tier 1 credit rose 26.9 →
29.9 of 42 rows (0.6405 → 0.7119); no row was demoted and no denominator
moved. The unchanged React client drives a genuinely new direct conversation,
connection request/accept with both fresh lists, and a settings-field save,
fresh read and restoration against ASP.NET and the same-run disposable Laravel
control. Focused integration coverage proves recipient-side direct-message
visibility, the consumed connection shape and both tenant boundaries. The
550-route/315-method no-op inventory is unchanged. Same-run controlled artifact
`aspnet-backend/artifacts/smoke/react-smoke-2026-08-25T12-50-10-080Z.json`
records 8/8 MATCH, no failures or skips, across both configuration-only arms.
Full local verification is green at 3,907/3,907 API tests and 38/38 messaging
tests. Implementation SHA: `f4c75e169`. This candidate becomes the floor only
after the batch is pushed and required CI is green.

🔴 **The 2026-08-25 recovery/continuity transaction moves Core React 121 →
128 (+7), total 376 → 383, while the banked floor stays 324.** Row 1.6 moved
OPEN → CERTIFIED and row 1.7 moved PARTIAL → CERTIFIED. Weighted Tier 1 credit
rose 29.9 → 31.6 of 42 rows (0.7119 → 0.7524); no row was demoted and no
denominator moved. The unchanged React client completed both journeys against
ASP.NET and the same-run disposable Laravel control: the actual captured reset
email drove a tenant-bound, single-use password change and invalidated earlier
sessions; a genuinely expired access token produced a protected 401, one
single-flight refresh, a successful retry, both-credential rotation, a usable
successor and device-scoped logout. Same-run artifact
`aspnet-backend/artifacts/smoke/react-smoke-2026-08-25T21-02-49-889Z.json`
records 7/7 MATCH, no failures or skips, exit 0. Focused ASP.NET auth journey
coverage is 8/8; relevant Laravel coverage is 76 tests / 246 assertions. Full
local ASP.NET verification is green at 3,915/3,915 API tests and 38/38
messaging tests. The no-op ratchet resolves 550 routes across 315 methods (548
distinct routes after scanner deduplication). Implementation SHA: `f25935184`.
This candidate becomes the floor only after the batch is pushed and required CI
is green.

🔴 **What these ten CERTIFIED rows do NOT mean.** Two of the three faults fixed
today were invisible to every automated comparison in this workstream. Row 4.28's
was a *shape*: every field was individually correct and both backends answered
200, so no status check and no field-by-field diff of the group object could see
it. Row 4.29's was an *absence*: a field that was not there cannot appear in a
diff of the fields two responses share. Both were found only by filling in the
page's own form and reading the effect. Read that as a warning about the other
five tiers, which have not been walked this way.

- **Journeys: 190 of 690 (-500).** 🔴 **Forty-one of 250 rows are
  CERTIFIED.** Ten are in Tier 4 (Web UK), and Tier 1 holds the other 31. The
  comprehensive 2026-08-24 core run promoted the final 17 Tier 1 PROVEN rows;
  only one PROVEN row now remains across the full ledger, in Tier 2.

- **Active non-mobile client parity: 190/570 = 33.33%.** This is the earned
  journey-category score for React, Web UK and staff journeys only; it excludes
  the 120-point native-mobile category rather than treating unassessed mobile
  work as a failure of the active clients. **Non-mobile overall readiness:
  383/880 = 43.52%.** The historical fixed-baseline headline remains 383/1000
  for continuity, and the banked floor remains 324 until push plus green CI.
  🔴 **CORRECTED 2026-08-22, same day it was written: this bullet said "the React
  smoke still has no control arm" and called building one queue item 1. That is
  FALSE and the ledger already said so** — the arm was built on 2026-08-21 and the
  correction is recorded at the Status Vocabulary section. The stale sentence was
  carried forward from the pre-correction text without being checked, which is the
  precise failure this workstream keeps repeating: prose was trusted over the
  artefact sitting next to it.
  What the arm actually produces (`aspnet-backend/artifacts/smoke/`, run
  2026-08-21T19:16Z): **36 MATCH, 2 NOT_COMPARABLE, 0 ASPNET_ONLY_FAIL** across 38
  step pairs, and it drives a REAL BROWSER (Playwright chromium — `page.click`,
  `page.fill`), so unlike web-uk it needed no owner decision on condition 1.
  So condition 3 is NOT what blocks these rows. What blocks them is that nobody
  has mapped the arm's per-step verdicts onto the ledger rows and checked each
  one against all five conditions. That mapping — not new instrument work — is the
  largest unblocked lever on the score.
  🔴 Two rows remain BROKEN with named causes, both in Tier 1: multi-photo posts
  have no table for the extra photos, and event attendance-by-code needs the
  signed `nqx2_` offline-checkin credential subsystem that ASP.NET lacks
  entirely. The two Web UK BROKEN rows (4.28, 4.29) were fixed on 2026-08-22.
  🔴 This bullet read "77 of 690" and "21 are PROVEN" before 2026-08-21. The 77
  was already inconsistent with its own table (54+5+21+1+0 = 81) when found; it
  is recomputed from the category table rather than carried forward.
- **Mobile 0 of 120.** New tier, 34 rows, nothing attempted. Most of its 331
  endpoints overlap member APIs certified in other tiers, so this tier is
  expected to be more verification than implementation - the Phase 9 measurement
  pass will quantify that rather than guess it.
- **Staff 1 of 150.** 72 rows, one RENDERS at unverified depth. 514 admin GET
  routes have never been compared, and most of the **550 remaining do-nothing
  routes across 317 methods** concentrate here (`AdminExplicitParityController`
  177, `MiscParityController` 82, `AdminCompatibility2/3` 86, and other shim
  controllers). Public-sector
  buyers evaluate the admin panel, which is why this tier carries 150 points.
- **Consumed-contract 68 of 110 (-42).** Sub-weighted: routes 28/28 (2,655 of
  2,667 matched); reads 18/30 (115 of 195 identical on the generated corpus);
  writes 12/22 (10 of 18 identical); stub elimination 10/30.
  🔴 **CORRECTION 2026-08-21: consumed-field mode now EXISTS, and it
  largely REFUTES the "upper bound inflated by unread fields" reasoning this row
  carried.** Measured: 80 differing endpoints falls to **64**, not to something
  far smaller. And all 16 cleared endpoints cleared because ASP.NET returns a
  **superset** (allowed under ADR-0004), not because Laravel leaked an unread
  column - between them they carry zero unread missing fields. The 49 genuinely
  unread fields all sit on endpoints that ALSO differ on a field a client reads,
  so they reduce the endpoint count by nothing. **64 of 80 are real work.** Field
  paths split 590 in scope / 116 unknown (treated as in scope) / 49 out of scope.
  Reads would therefore move from 115/195 to ~131/195 acceptable at the next
  banking transaction - an improvement, recorded in Block 3 rather than taken
  here.
  🔴 **CORRECTION 2026-08-21: the "5 client-consumed route gaps (OAuth)"
  claim was wrong in BOTH directions.** The routes are NOT missing - all five are
  declared in `AuthParityController.cs:220-268` with explicit `~/api/v2/...`
  override attributes, which is why `api-parity`'s path matching did not see
  them. But they are hollow, and one is worse than hollow: `OAuthRedirect`
  (`:229`) mints a random `state` with `RandomNumberGenerator` and **never stores
  it**, returning a plausible `redirect_url` carrying a value nothing can later
  validate - a fabricated security-critical token rather than an honest refusal.
  `OAuthIdentities` (`:256`) returns `identities = Array.Empty<object>()`
  unconditionally, so a member's linked accounts always read as none.
  `EnabledProviders` (`:223`) answers from a hardcoded list. Route presence hid
  all of it - the ADR-0004 lesson restated: open the method body.
- **Schema 46 of 60 (-14).** 257 tables matched, 215 absent, 184 EF migrations.
  Under ADR-0004 an absent table is a gap only where a journey needs it, so the
  bulk is deferred rather than deducted; the standing deduction is the missing
  populated-history upgrade proof and preflight-failure proof, which procurement
  will ask for.
- **Auth/tenant/security/localization 46 of 60 (-14).** Residual security items
  R-4, R-18, R-20, R-8. Localization is the larger part: no request-locale
  negotiation at framework level (0 `.resx`, 0 `IStringLocalizer`; one
  hand-rolled `Accept-Language` cascade serves 2 of 3,225 actions), no
  recipient-locale resolution, and **7 of 11 locales seeded - ar, it, ja and nl
  missing, so there is no RTL locale at all.** A Welsh- or Irish-language buyer
  fails us here today.
- **Background processing 11 of 40 (-29).** 🔴 **Jobs are 26 of ~117, not
  26 of 69.** Laravel's `bootstrap/app.php` has 69 named schedule entries, but one
  of them (`nexus:run-all`) fans out through `CronJobRunner::runAll()` to 49
  further sub-tasks; the honest ratio is 22%, and the previously published 38%
  flattered ASP.NET. FCM is worse than documented - it uses **both** the legacy
  `fcm/send` endpoint and legacy server-key auth, both decommissioned by Google in
  July 2024, so native push cannot function at all. Two claims were *overstated*
  and are corrected in ASP.NET's favour: Meilisearch has a working admin
  full-reindex (only the incremental write path has zero callers, so the index is
  stale until an admin reindexes), and Stripe webhooks **are** processed on two
  paths with correct HMAC verification and a fail-closed production guard - only
  the bare alias is unhandled, and it honestly returns 501.
- **Build/test/CI and operational readiness 22 of 40 (-18).** CI is genuinely
  strong: 3,774 tests, ~3,191 methods, 6-shard matrix, every ASP.NET job green at
  this SHA, real-Postgres concurrency tests that fire five simultaneous transfers
  and assert no overdraft. Operational readiness scores 2 of 16: no scheduled
  backup, no deploy or rollback path, no observability, no load comparison.

🔴 **THE +4 IN BLOCK 2 IS MECHANICALLY DERIVED AND NOT YET CI-VERIFIED (2026-08-21,
later).** Ledger row **1.21** (the exchange transaction) moved BROKEN → CERTIFIED on
measured evidence: one control run, both arms, credits moved on each
(`artifacts/smoke/react-smoke-2026-08-21T19-16-28-440Z.json` - 36 MATCH, 2
NOT_COMPARABLE, 0 ASPNET_ONLY_FAIL). Because the five journey categories are computed
from the ledger's rows, Tier 1 credit rose 0.293 → 0.317 and this table had to follow
or `scripts/check-doc-scores.mjs` fails.

🔴 **BANKING TRANSACTION COMPLETED 2026-08-21.** This paragraph previously
said 274 was provisional and that `ASPNET_BANKED_FLOOR` was deliberately held at
270 so the ratchet could not advance on evidence CI had not seen. That condition
is now met: the measuring tree was committed in `205d83e4b`, and `main` is green
at `87b9ba69c` — the two failures on `205d83e4b` were a PHP test that inherited a
tenant it never created and a newly published `tar` advisory, both unrelated to
this row and both fixed. **The floor is raised to 274.** That also completes
ADR-0004 condition 4 for row 1.21, which requires the guarding smoke step to be
COMMITTED and was previously met in substance only while the instrument fix sat
in the working tree. 274 is banked, not provisional.

The score can no longer be published below 274. A future demotion of this row is
recorded in the ledger immediately and republished at the next net-non-negative
transaction; the headline does not fall.

**Block 3 - Published but unscored.** None at the `d0c34906a` evidence boundary.
The wallet-transfer promotion, category movement and floor rise are banked
together in this scoring transaction.

**Historical pre-bank evidence (superseded by the transaction above).** The
following notes explain how earlier working-tree batches reached the current
instruments and were deliberately held out of their then-current scores:

- 🔴 **The no-op stub count was too small, and is now 562 routes / 326 methods
  (was 316 methods).** `check-noop-stubs.ps1` counted one of three kinds of
  do-nothing endpoint and counted methods rather than the routes a client calls.
  It now reports four categories, each with its own shrink-only baseline:
  `noop_method` 377 routes / 315 methods, `echo_store` 177 / 5,
  `hardcoded_payload` 10 / 6, and `defensible` 4 / 4 (deliberate, reported, not a
  defect). `echo_store` is the important one: 177 routes fall through an
  `AdminExplicitParityController` catch-all to a generic echo store that records
  the request body and answers `side_effect = "recorded_only"`, so it touches the
  database and passed the old heuristic while moderating, sending and deleting
  nothing. The route-per-method undercount is fixed too - a method carrying six
  `[Http*]` attributes now reports six - and the work-detection tokens are
  anchored, which revealed three do-nothing methods excused by their own response
  field names (`_repo` was matching `auto_hide_report_threshold`).
  🔴 **This is an instrument change, not a regression: no endpoint got worse.**
  It affects a sub-score and the score has NOT been moved here - that is a
  deliberate banking transaction, not a side effect. Every detection was proved
  able to go red and proved not to fire on a working endpoint; the proofs are in
  the commit message. Prose elsewhere in this document still quotes 317/319 as a
  historical figure; those two numbers are not comparable to 562.

- Two GDPR endpoints that faked success now return honest 501s
  (`MiscParityController.cs:800,804`) - a member's statutory erasure and
  data-subject requests were being silently discarded. 4 focused tests pass;
  `dotnet build` clean. The stub baseline shrank **319 to 317**. Worth recording:
  web-uk was *already* rejecting the fake 200 because it requires
  `logout_required === true`, so this makes the backend honest about a failure the
  client already saw. A third stub of the same class (`GdprConsent`) is recorded
  in the ledger and not yet changed.
- The React smoke instrument can now **fail**: `step()` records verdicts, a JSON
  artifact is written, and the process exits 1 on any failure and 2 on a skip.
  **Proved red** - pointed at an unreachable base it reported 36 of 37 steps
  failed and exited 1, where previously every run exited 0 regardless. A Laravel
  control arm with four comparison verdicts is added. Neither smoke is CI-wired,
  so this cannot affect the build.
🔴 **SECOND control run, after the fixture fix: 34 MATCH / 1 LARAVEL_ONLY_FAIL
  / 2 NOT_COMPARABLE / 0 ASPNET_ONLY_FAIL** (was 31/2/4/0). The disposable
  Laravel's fixture gained two non-master tenants, three members, a conversation
  and 24 timeline posts (`scripts/parity-fixture.sql`, +170 lines, disposable
  path only). Three rows converted: `select-community`, `journey-message-send`,
  `journey-feed-infinite-scroll`.
  🔴 **My own diagnosis of the blocker was half wrong, and the fix needed
  two tenants rather than one.** I attributed the empty login select to
  `TenantBootstrapController`'s master-tenant exclusion. The login page asks
  *with* `include_master=1` (`LoginPage.tsx:254`), so master WAS returned; the
  real cause is that with exactly one community the page renders a card instead
  of a `<select>` (`LoginPage.tsx:441`). Proof the exclusion was never the login
  blocker: `login-submit` PASSED on Laravel in the same run where
  `select-community` failed. The register page is the surface that exclusion
  actually empties.
  Remaining non-matches: `journey-sign-up` is an INSTRUMENT gap - the smoke
  registers at `@example.test` and Laravel deliberately refuses reserved TLDs
  (`MxRecordValidator.php:91`); a resolvable domain is a one-line fix for the
  smoke owner. Behind it sits a real ASP.NET gap - **none of Laravel's three
  registration guards exist** (no disposable-domain blocklist, no deliverability
  check, no breached-password check; `EMAIL_DOMAIN_INVALID`, `EMAIL_DISPOSABLE`
  and `PASSWORD_PWNED` return nothing across `src/`).
  `action-transfer-credits` exposed a real contract difference:
  `/api/v2/wallet/user-search` returns `last_name: ""` on ASP.NET where Laravel
  returns the surname, making the recipient card unidentifiable.
  `journey-feed-reaction` is blocked on `role="article"` not reaching the DOM
  through `GlassCard` - unproven, cheap to check.
  Two ASP.NET-only 404s the tally hid, from the arm's own failed-request list:
  `GET /api/v2/events/{id}/calendar-actions` and
  `GET /api/v2/stories/highlights/{id}`. `offline-checkin/credentials/me` 404s on
  BOTH arms, so it is not an ASP.NET-only gap.
- **The first control run, for the record: ZERO ASP.NET-only failures.** Both arms ran the
  same 37 steps in one execution. ASP.NET: 35 ok / 0 failed / 2 skipped. Laravel
  control: 31 ok / 2 failed / 4 skipped. Tally: **31 MATCH, 0 ASPNET_ONLY_FAIL, 2
  LARAVEL_ONLY_FAIL, 4 NOT_COMPARABLE**; exit 2 (unclean, not failed).
  🔴 Both Laravel-only failures are a **fixture** gap, not a product fault:
  the disposable Laravel holds only the master tenant, so `GET /api/v2/tenants`
  returns nothing, the login select is empty, and sign-up cannot complete. The 4
  NOT_COMPARABLE rows are selector/fixture skips on one side (transfer,
  message-send, infinite-scroll, feed-reaction). **This is precisely what a
  control arm is for** - without it the empty tenant list would have been read as
  an ASP.NET defect.
  🔴 **Not banked, deliberately.** Converting the 21 PROVEN rows to
  CERTIFIED requires three things this run does not yet supply: the fixture fixed
  so the control arm passes rather than fails; a row-by-row mapping from smoke
  step to ledger row; and ADR-0004 condition 5 checked (no do-nothing endpoint on
  each path) - which the audit noted has never been verified against the (then)
  317 no-op methods, and which is now checkable per path: see the widened stub
  count in Block 3 and `build-stub-route-inventory.mjs --check`. Estimating the conversion upward without those is exactly the
  practice that produced R4's wrong arithmetic. Queue item 1.
- Two further honesty notes recorded in the instrument itself: the exit-0 path is
  **inferred, not observed** (only exit 1 and exit 2 have been demonstrated), and
  the direct cross-origin transport check remains single-arm because the
  disposable Laravel's CORS allowlist does not carry the control port.

**Block 4 - Dirty/in-flight work.** The checkout contains concurrent Web UK
route, view, style, library and test changes. None is ASP.NET work and none
contributes points. This banking commit must stage only the five explicit score,
ledger, roadmap and changelog paths.

**Block 5 - Certification gaps.** 690 open points, itemised below.

**History:** R4 (353, 2026-08-21), R3 (653, 2026-08-20), R2 (598, 2026-08-18):
[`HISTORY/STATUS_ARCHIVE_2026-08.md`](HISTORY/STATUS_ARCHIVE_2026-08.md). R1 (712,
2026-07-14): [`HISTORY/STATUS_ARCHIVE_2026-07.md`](HISTORY/STATUS_ARCHIVE_2026-07.md).

## Required End State

Project NEXUS ships as **two editions of one product**: a Laravel edition and an
ASP.NET edition, each running both unchanged frontends, switched by
configuration only. The ASP.NET edition exists because a segment of public-sector
buyers require a .NET stack as a condition of procurement
([`ADR-0003`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)).

Three client applications, four consumer surfaces (the React app carries both the
member UI and the admin panel in one build, but they consume different halves of
the API and are scored separately):

| Unchanged surface | Laravel edition | ASP.NET edition |
| --- | --- | --- |
| Canonical React member app at `react-frontend/` | Production behaviour source of truth | Same journeys, same outcomes, same data, same errors, same permissions |
| React admin at `react-frontend/src/admin/` | Production | The same admin surface - and the tier where every remaining do-nothing endpoint lives |
| Accessible Web UK at `web-uk/` | Production, three live hostnames | The same Web UK code and page flows, switched by configuration only |
| Mobile app at `mobile/` (Expo / React Native) | Production, Android released | In scope by owner decision 2026-08-21; 331 endpoints, previously in no plan |

[`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md) sets the standard;
[`ADR-0004`](decisions/ADR-0004-journey-equivalence-is-the-target.md) sets how it
is measured. Route presence is not correctness. A frontend adapter or an
ASP.NET-specific page branch never satisfies the goal. Equally, a response field
that no client reads is **not** part of the goal — reproducing Laravel's internal
database columns is explicitly out of scope.

### What each score level means commercially

Milestones, not promises. Each requires its own banking transaction.

| Level | What it supports |
| ---: | --- |
| 270 (now) | An honest internal demo of the core member experience on the React app. |
| ~550 | **Procurement demo grade**: core and community member journeys certified on React, Web UK core journeys certified, admin core journeys certified. Enough to put the product in front of a buyer running on .NET and answer coverage questions with evidence. |
| ~780 | **First-customer grade**: one .NET-required customer tenant could be operated - given the go-live gate, which includes a repaired scheduled backup and a deploy path. |
| ~950 | Full platform equivalence: every module, every client (including mobile), both editions interchangeable for every tenant. |

Levels are lower than the R4-era equivalents because the denominator grew: 550
under R5 covers more certified product than 600 did under R4.

## Open Certification Gates

730 open points, as independent proof gates rather than one queue:

- **Journeys (613 open across five categories)** - the 196 OPEN/BROKEN, 3 PARTIAL
  and 30 RENDERS rows in
  [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md), plus the
  PROVEN-to-CERTIFIED conversion of 21 rows, which is blocked on a Laravel
  control arm **and** on the disposable Laravel's login fixture offering no
  communities.
  Largest single blocks: staff 149, mobile 120, module React 125, core React 120.
- **Consumed-contract correctness (42 open)** - the OAuth social-login feature
  (read by `OAuthButtons.tsx:52,80` and `ConnectedAccountsTab.tsx:61,82,103`):
  its five operations EXIST but are hollow, and `OAuthRedirect` fabricates an
  unstorable `state`, so this is a **behaviour** item, not a routing one. Then:
  the read-differ tail once a consumed-field mode exists; 8 differing writes; and
  317 stubs - **201 on member-reachable paths, 116 on admin paths**
  (`artifacts/parity/stubs/stub-routes.json`) - of which 63 are uncalled and are
  candidates for deletion in both editions (owner sees the list first).
  🔴 ~10 of the 317 are DEFENSIBLE false positives where `[Authorize]`
  does the work in the filter pipeline and an empty body is correct
  (`AuthParityController` `check-session`, `refresh-session`, `validate-token`).
  Triage before implementing.
- **Schema/upgrade (14 open)** - populated-history upgrade proof,
  preflight-failure proof, and the absent tables that specific journeys need.
- **Security/localization (14 open)** - R-4, R-18, R-20, R-8; request-locale and
  recipient-locale negotiation from zero; the 4 unseeded locales (ar, it, ja, nl
  - no RTL locale exists today).
- **Background/providers (29 open)** - jobs 26 to ~117 (compliance jobs first),
  Meilisearch incremental indexing, FCM HTTP v1 rebuild (legacy endpoint AND
  legacy auth are both decommissioned), the bare Stripe webhook alias.
- **CI and operations (18 open)** - coverage/test-quality gate, static contract
  evidence, and the operational readiness block: repaired scheduled backup,
  deploy/rollback path, observability, load comparison. 🔴 **Neither smoke
  instrument is CI-wired**, so journey evidence is manual-run today; wiring them
  needs a live ASP.NET plus a Postgres service container in CI.

Stateful certification uses the disposable Laravel (`:8091`) only. The ordinary
local Laravel database is a confidential production-derived snapshot and is never
a test fixture.

🔴 **The backup position, stated accurately (corrected 2026-08-21).** Documents
in this repository — including this one until today — repeated "no successful
backup since 2026-03-08 (156 consecutive failures) with nothing to restore
from". That is true of the **scheduled off-server backup job** and materially
incomplete about the data.
[`DATABASE_BACKUP_DECISION.md`](DATABASE_BACKUP_DECISION.md) established on
2026-08-16, by read-only inspection of the production host, that a
**restore-tested off-server copy exists** — restored into a throwaway
`postgres:16.4-bookworm` on 2026-08-10 giving 265/265 tables, 53/53 EF
migrations and 49,958 rows — and that the database container has been
`Exited (0)` since 2026-08-10 16:36:10Z, so that recovery point is **current**.
The genuine remaining gaps are narrower: the scheduled job is still broken so
nothing new is taken; the final 16:35 dump has only one copy and is
checksum-verified but not restore-tested, leaving a ~2.5-hour single-copy tail;
and migrate-on-start is dormant rather than gone, so the container still must
not be restarted. Fixing the scheduled backup and copying that final dump are
owner infrastructure items and remain part of the go-live gate — but "there is
no backup" is not the accurate statement, and must not be repeated.

This gates every production role and is not a code problem.

## Finite Ordered Queue

Phases A-B (documentation restructure, Baseline 3) completed 2026-08-20; the R5
re-denomination and instrument-integrity work is Phase 0, 2026-08-21. Ordered by
score-movement-per-effort, and re-derived at the checkpoint below rather than
guessed further out.

**Phase 0 - instrument integrity and R5 (in progress).** R5 banked. React smoke
made able to fail (proved red) with a Laravel control arm added. GDPR stubs to
honest 501s. Stale framing purged from the guides that were telling agents this
work was paused and optional. Remaining: the disposable Laravel login fixture
(no communities in the select) that blocks the control arm.

**Phase 1 - certification conversion and consumed-field differ (2-4 days).** Fix
the login fixture, run the control arm over the 21 PROVEN rows; each converts to
CERTIFIED or surfaces a defect (measured rate 1-3 per journey, so expect 20-60).
In parallel: consumed-field mode on the response differ, building the manifest by
static analysis of `react-frontend/`, `web-uk/` **and `mobile/`** - ADR-0004
already names mobile a reader, so this front-loads the Tier 6 measurement free.

**Phase 2 - core member tier and missing controllers (5-8 days).** Row 1.21
(exchange request-accept-complete-credits) first: it is the product's core
transaction and has never been driven end to end.

🔴 **Row 1.21 was attempted on 2026-08-21 and is now BROKEN with a named cause,
not OPEN.** Read the ledger row before picking it up; the summary is that everything
up to settlement was fixed and settlement itself is blocked on schema. Fixed: the
config endpoint (a stub that hid the whole feature behind the app's own
"workflow not enabled" state), the client's POST verbs landing on an AdminOnly
empty-array stub instead of the real controller, three guard-free status mutators
(one measured reopening a settled exchange), and a routing collision that returned
HTTP 500 on rate. **What remains is one migration and the settlement on top of it:**
`exchanges` needs `requester_confirmed_at/hours`, `provider_confirmed_at/hours` and
`final_hours`, after which two-party settlement should reuse
`PersonalWalletLedgerService` exactly as `GroupExchangeService.CompleteAsync`
already does. That migration serialises through the Schema agent, so schedule it as
a Schema-agent item followed by an Implementer item - not as one task.

Then the remaining Tier 1 opens
in parallel (disjoint controllers), the two BROKEN packages (multi-photo table;
the `nqx2_` signed offline-checkin subsystem), the missing controllers - `/explore`
has **no ASP.NET counterpart at all** against a 2,257-line Laravel service - and
the WebAuthn/2FA rows.

**Phase 3 - admin measurement pass, BEFORE any admin implementation (1-2 days,
overlaps Phase 2).** Generate the corpus for all 514 admin GETs, run against both
backends, classify each {identical | consumed-differ | noise | absent | stub}.
Outputs: the admin defect-density number the whole back half of the schedule turns
on, final Tier 5 row names, and the uncalled-stub deletion list for the owner.
514 endpoints is one measurement task, not 514 tasks.

**Phase 4 - Web UK journey tier (2-4 days).** Teach its instrument to submit the
9 form rows; most backend fixes land in Phase 2 and are re-verified through a
second client, which is cheap and cross-confirms the same contracts.

**CHECKPOINT - re-estimate (after Phase 4 banking).** Cannot pass without six
measured inputs: admin defect density; member defect-rate actuals; green
batches/day achieved; migration-lane throughput; control-arm yield (of 21 PROVEN,
how many certified clean vs demoted-then-fixed); certified rows/day. Re-derive as
`remaining_days(tier) = open_rows x (defects/row x batches/defect + 1) / batches/day`,
bands from p25/p75 velocity. Escalation rule: if admin defect density exceeds 2x
member density, or velocity is under 0.5 rows/day, present owner scope options
**before** Phase 6 rather than discovering the overrun inside it.

**Phase 5 - community modules (5-8 days).** Groups, volunteering (including
hours-to-credits), polls, goals, skills, reviews, matches, collections. Parallel
per family; wallet paths reuse the Phase 2 certification.

**Phase 6 - staff tier (10-16 days, widest band).** Implement against the Phase 3
map, family by family. Real GDPR erasure and DSAR replace the honest 501s first.
The twelve shim controllers empty out as the journeys calling them certify.
Uncalled-stub deletions only after the owner has seen the list.

**Phase 7 - extended modules (8-12 days).** Marketplace (escrow, refunds,
disputes - the ~30,000 lines the old range rows were hiding), jobs, courses,
podcasts, ideation, clubs, venues, donations, coupons, premium, caring community,
federation.

**Phase 8 - platform substrate (4-7 days).** Parallel lanes: FCM HTTP v1 rebuild
(endpoint plus OAuth service-account auth - the legacy path is dead, so native
push cannot work at all today); Meilisearch incremental indexing wired to entity
change events; jobs 26 to ~117, compliance first, honouring the rule that a
manual trigger reports success only after a persisted execution; request- and
recipient-locale negotiation plus the 4 unseeded locales; the bare Stripe webhook
alias. Serial lane: the schema tail, only the absent tables journeys actually
named, through the Schema agent.

**Phase 9 - mobile tier (10-15 days).** Manifest from Phase 1 plus a corpus pass
over the 331 mobile endpoints. Most overlap already-certified member APIs, so the
pass first establishes how much of this tier is verification rather than
implementation. Instrument choice from what `mobile/` already has.

**Phase 10 - live providers (owner-gated).** Stripe live mode, FCM against real
devices, the four identity providers, WebAuthn rp_id on a real domain, SSO. One
owner-present session per provider.

**Phase 11 - operations (owner-gated).** Repair the scheduled backup and copy the
final dump; deploy and rollback path; observability; load comparison. These are
the ADR-0003 go-live gate items.

Banking cadence: a scoring transaction at every phase completion - never
estimated, never silent, and the floor rises each time.

## Required Status-Report Format

Every ASP.NET status report must present these five blocks in this order:

1. **Named baseline and SHA** - rubric version, Laravel source, ASP.NET evidence
   SHA, scoring-record SHA, and inspected HEAD.
2. **Banked score** - one fixed-denominator total plus every category row (ten
   under R5).
3. **Published but unscored** - exact commits and why not banked; `none` when
   there are none.
4. **Dirty/in-flight work** - scoped files, verification achieved, and explicit
   confirmation of zero banked points.
5. **Certification gaps** - exact remaining deductions and the evidence needed.

To the owner, additionally use the three-line format defined in
[`ROADMAP.md`](ROADMAP.md): score, journeys certified X of 250, movement since
last report.

Never report a blended ASP.NET/Web UK percentage, compare an R5 total with an
R1-R4 total, publish a total below `ASPNET_BANKED_FLOOR`, silently rescore
history, convert route counts into a completion percentage, or describe
uncommitted work as complete. Follow
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md) when updating this
status.
