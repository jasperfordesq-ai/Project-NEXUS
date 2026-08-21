# Current ASP.NET Contract Status

Last verified: 2026-08-21 (rubric replaced; Baseline 4 banked at `869a2a030`)

Status: **Canonical current - ASP.NET score and certification source**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=270/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R5 -->
<!-- doc-consistency: ASPNET_RUBRIC_CATEGORY_COUNT=10 -->
<!-- doc-consistency: ASPNET_BANKED_FLOOR=270 -->

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

🔴 **How this file works.** It holds ONLY what is current. Dated narrative
lives in `HISTORY/STATUS_ARCHIVE_2026-0{7,8}.md`. The finite work list is
[`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md). The
standing session brief is [`HANDOFF_PROMPT.md`](HANDOFF_PROMPT.md). The
plain-English owner view is [`ROADMAP.md`](ROADMAP.md). Rubric rules:
[`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md).
Update-transaction rules:
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md).

## Banked score - Fixed Rubric Baseline 5, 270/1000 (`ASPNET-CONTRACT-R5`, banked 2026-08-21)

**Block 1 - Named baseline and SHA.** Rubric `ASPNET-CONTRACT-R5`, named
2026-08-21: **ten** fixed-weight categories, final frozen denominator, **not
comparable to R1-R4**. Evidence boundary: monorepo `1a2f2a30f` - pushed, with
**all eight workflows green** (Docs Lint, CI Pipeline, Docs Site, E2E, Platform
contracts, Security Scan, CodeQL, Uptime). Laravel contract source: the same
tree, exercised through the disposable Laravel on `:8091` with both parity
fixtures applied. Generated artifacts: `artifacts/parity/api/api-parity.*`
regenerated 2026-08-21T07:14; `artifacts/parity/{schema,localization}` at
2026-08-20. Denominator source:
[`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md) at 250 rows.
Scoring-record SHA: the commit carrying this section. **Nothing from today's
working tree is banked** - see Block 3.

**Block 2 - Banked score.**

| Category | Banked | Maximum |
| --- | ---: | ---: |
| Core member journeys certified - React | 50 | 170 |
| Community and extended module journeys certified - React | 5 | 130 |
| Member journeys certified - Web UK accessible | 21 | 120 |
| Staff journeys certified - admin, super-admin, broker | 1 | 150 |
| Mobile app journeys certified - Expo / React Native | 0 | 120 |
| Consumed-contract correctness and stub elimination | 68 | 110 |
| Data integrity, schema, and upgrade safety | 46 | 60 |
| Auth, tenant isolation, security, and localization | 46 | 60 |
| Background processing, providers, and integrations | 11 | 40 |
| Build/test/CI evidence and operational readiness | 22 | 40 |
| **Total** | **270** | **1000** |

**Derivation.** The five journey categories are computed mechanically from the
ledger's row statuses using its published weights (CERTIFIED 100%, PROVEN 60%,
RENDERS 25%, PARTIAL 30%, OPEN/BROKEN 0%); credit = weighted sum / tier rows.

| Category | Tier(s) | Rows | Credit | x weight | Banked |
| --- | --- | ---: | ---: | ---: | ---: |
| Core React | 1 | 42 | 0.2929 | 170 | 50 |
| Module React | 2 + 3 | 70 | 0.0407 | 130 | 5 |
| Web UK | 4 | 32 | 0.1750 | 120 | 21 |
| Staff | 5 | 72 | 0.0035 | 150 | 1 |
| Mobile | 6 | 34 | 0.0000 | 120 | 0 |

Community and extended modules deliberately share one category so that an owner
scope decision on the extended modules cannot change the denominator.

- **Journeys: 77 of 690 (-613).** 🔴 **Zero of 250 rows are CERTIFIED.** 21
  are PROVEN - they run against ASP.NET with an asserted effect - but ADR-0004
  condition 3 (the same run passing against a Laravel control) is unmet on every
  React row, because the React smoke had no control arm. Building one is queue
  item 1. Two rows are BROKEN with named causes: multi-photo posts have no table
  for the extra photos, and event attendance-by-code needs the signed `nqx2_`
  offline-checkin credential subsystem that ASP.NET lacks entirely.
- **Mobile 0 of 120.** New tier, 34 rows, nothing attempted. Most of its 331
  endpoints overlap member APIs certified in other tiers, so this tier is
  expected to be more verification than implementation - the Phase 9 measurement
  pass will quantify that rather than guess it.
- **Staff 1 of 150.** 72 rows, one RENDERS at unverified depth. 514 admin GET
  routes have never been compared, and **all 317 remaining do-nothing endpoints
  concentrate here** (`MiscParityController` 85, `AdminCompatibility2/3` 85,
  `ReactFrontendCompatibility` 30, and nine more shim controllers). Public-sector
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

**Block 3 - Published but unscored.** Today's working-tree changes are real and
verified locally but are **not banked**, because banking requires CI green at the
evidence SHA:

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
  each path) - which the audit noted has never been verified against the 317
  no-op methods. Estimating the conversion upward without those is exactly the
  practice that produced R4's wrong arithmetic. Queue item 1.
- Two further honesty notes recorded in the instrument itself: the exit-0 path is
  **inferred, not observed** (only exit 1 and exit 2 have been demonstrated), and
  the direct cross-origin transport check remains single-arm because the
  disposable Laravel's CORS allowlist does not carry the control port.

**Block 4 - Dirty/in-flight work.** 25 `web-uk/src/routes/*.js` files carry known
CRLF phantom modifications from a concurrent workstream, plus the nightly
`sentry-triage-ledger.json`. None is ASP.NET's and none contributes points.
Commit by explicit path.

**Block 5 - Certification gaps.** 730 open points, itemised below.

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
transaction and has never been driven end to end. Then the remaining Tier 1 opens
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
