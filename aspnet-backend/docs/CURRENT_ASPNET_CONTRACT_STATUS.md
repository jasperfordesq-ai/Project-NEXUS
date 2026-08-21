# Current ASP.NET Contract Status

Last verified: 2026-08-21 (rubric replaced; Baseline 4 banked at `869a2a030`)

Status: **Canonical current - ASP.NET score and certification source**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=355/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R4 -->

🔴 **The rubric changed on 2026-08-21. The number went from 653 to 355 and
nothing regressed.** R1–R3 measured how much of Laravel's API surface had an
ASP.NET counterpart that looked right. R4 measures how much of the product is
**proved to work** on ASP.NET. The second number is lower because proving
journeys is the part that has barely started — and it is the only number that
can tell you when the edition is finished. **Never subtract, average, or
describe one as a rise or fall from the other.** Reasons:
[ADR-0004](decisions/ADR-0004-journey-equivalence-is-the-target.md). Baseline 3's
full derivation is preserved verbatim in
[`HISTORY/STATUS_ARCHIVE_2026-08.md`](HISTORY/STATUS_ARCHIVE_2026-08.md).

🔴 **This score is unrelated to Web UK's.** Two 1000-point denominators exist in
this repository and they measure different things: this one measures whether the
ASP.NET edition runs the product; Web UK's `WEBUK-W2-PROD-R1` measures whether
the accessible frontend is safe to serve in production
(`../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`). Never blend them.

🔴 **How this file works.** It holds ONLY what is current: the banked score, the
evidence pointers, the open gates, the next queue, and the reporting rules.
Dated narrative lives in `HISTORY/STATUS_ARCHIVE_2026-0{7,8}.md`. The finite work
list is [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md). The
plain-English owner view is [`ROADMAP.md`](ROADMAP.md). Rubric and baseline rules:
[`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md).
Update-transaction and state-label rules:
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md).

## Banked score — Fixed Rubric Baseline 4, 355/1000 (`ASPNET-CONTRACT-R4`, banked 2026-08-21)

**Block 1 — Named baseline and SHA.** Rubric `ASPNET-CONTRACT-R4`, newly named
2026-08-21; eight fixed-weight categories, new denominator, **not comparable to
R1–R3**. Evidence boundary: monorepo `869a2a030` (pushed; `aspnet-backend/src`
and `tests` at that commit). Laravel contract source: the same monorepo tree,
exercised through the disposable Laravel on `:8091` with both parity fixtures
applied. CI evidence: `platform-contracts` green at `869a2a030`. Generated
artifact evidence: `artifacts/parity/api/api-parity.*` regenerated
2026-08-21T07:14; `artifacts/parity/{schema,localization}` at 2026-08-20;
`.local-docs-archive/baseline3/` for the suite and smoke logs, plus the five
2026-08-21 implementation commits below. Scoring-record SHA: the commit carrying
this section.

**Block 2 — Banked score.**

| Category | Banked | Maximum |
| --- | ---: | ---: |
| Core member journeys certified — React | 72 | 200 |
| Community and extended module member journeys certified — React | 11 | 150 |
| Member journeys certified — Web UK accessible | 28 | 150 |
| Staff journeys certified — admin, super-admin, broker | 1 | 100 |
| Consumed-contract correctness and stub elimination | 90 | 150 |
| Data integrity, schema, and upgrade safety | 58 | 75 |
| Auth, tenant isolation, security, and localization | 58 | 75 |
| Background processing, providers, and integrations | 10 | 50 |
| Build/test/CI evidence and operational readiness | 27 | 50 |
| **Total** | **355** | **1000** |

Derivation. The four journey categories are computed mechanically from
[`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md) using its
published credit weights (CERTIFIED 100%, PROVEN 60%, RENDERS 25%, PARTIAL 30%,
OPEN/BROKEN 0%), so the score moves when and only when a ledger row moves.

- **Core React journeys 72/200 (−128).** 35 rows: 0 CERTIFIED, 20 PROVEN, 2
  PARTIAL, 13 OPEN or BROKEN. Credit (20×0.6 + 2×0.3) ÷ 35 = 0.36. 🔴 **Nothing
  in this tier is CERTIFIED, and the reason is one missing test arm**: the React
  smoke drives 37 steps against ASP.NET with effect assertions, but does not run
  the same steps against Laravel in the same execution, so ADR-0004 condition 3
  is unmet on every row. Two rows are BROKEN with named causes (multi-photo
  posts have no table for extra photos; event attendance-by-code needs the signed
  `nqx2_` offline-checkin credential subsystem ASP.NET lacks entirely).
- **Module React journeys 11/150 (−139).** 40 rows: 1 PROVEN (volunteering
  browse, three faults fixed 2026-08-21), 9 RENDERS, 30 OPEN. Credit
  (1×0.6 + 9×0.25) ÷ 40 = 0.071. Rendering a module page is not a journey; no
  community or extended module action has ever been driven.
- **Web UK journeys 28/150 (−122).** 30 rows: sign-in PROVEN, 20 RENDERS against
  a **Laravel control in the same run** — the stronger instrument — 9 OPEN.
  Credit (1×0.6 + 20×0.25) ÷ 30 = 0.187. The instrument compares page pairs and
  submits no forms, so no Web UK *journey* exists beyond sign-in.
- **Staff journeys 1/100 (−99).** 25 rows, 1 RENDERS at unverified depth, credit
  0.010. Route representation for this tier is scored under consumed-contract
  correctness, not here — nothing in this tier has journey evidence. The
  243 admin GET endpoints have never been compared. This is the largest
  untouched surface and where the do-nothing endpoints concentrate.
- **Consumed-contract correctness 90/150 (−60).** Sub-weighted: routes 39/40
  (2,655 of 2,667 matched, 12 missing of which 4 are client-consumed — regenerated
  2026-08-21); reads 24/40 (115 of 195 identical on the generated corpus); writes
  17/30 (10 of 18 identical on the measured corpus); stub elimination 10/40 (319
  verified live, down from 349, and **concentrated in the admin tier** — none sits
  on a currently PROVEN path, which is why the smoke passes). 🔴 The 80 differing
  reads are an **upper bound, not a defect count**: the harness diffs whole
  response bodies and has no consumed-field mode, so it counts fields no client
  reads. Building that mode is queue item 2.
- **Schema 58/75 (−17).** 257 tables matched, 215 absent, 184 EF migrations.
  Under ADR-0004 an absent table is a gap only where a journey needs it, so the
  bulk of the 215 is deferred rather than deducted; the standing deduction is the
  missing populated-history upgrade proof and preflight-failure proof, which
  procurement will ask for.
- **Auth/tenant/security/localization 58/75 (−17).** Residual security items
  unchanged: R-4 subtree confinement, R-18 legal gate, R-20 passkey rp_id, R-8
  carer cluster. Localization is the larger part: no request-locale negotiation
  at all, no recipient-locale resolution, 7 of 11 locales seeded
  (`BACKEND_LOCALIZATION_CONTRACT.md`). A Welsh- or Irish-language public-sector
  buyer would fail this today.
- **Background processing, providers, integrations 10/50 (−40).** Jobs 26 of 69
  live-counted; Meilisearch indexing with zero callers; FCM on the retired
  endpoint; no processing at Laravel's `/api/v2/webhooks/stripe`.
- **Build/test/CI and operational readiness 27/50 (−23).** CI is genuinely
  strong — 3,774 local tests, ~3,191 test methods, every ASP.NET job green at
  this SHA — and scores 25 of its 30 sub-weight. **Operational readiness scores 2
  of 20**: no working backup, no deployment or rollback path, no observability,
  no load comparison. This is the category the go-live gate actually turns on.

**Block 3 — Published but unscored:** none. The five 2026-08-21 commits
(`b4138bb34`, `ffe68df8a`, `c57952890`, `12c29f1c5`, `4306f1827`) are included in
the ledger rows above and therefore in this baseline.

**Block 4 — Dirty/in-flight work:** 25 `web-uk/src/routes/*.js` files carry known
CRLF phantom modifications from a concurrent workstream, plus the nightly
`sentry-triage-ledger.json`. None is ASP.NET's and none contributes points. Zero
dirty `aspnet-backend` source files at scoring time. Commit by explicit path.

**Block 5 — Certification gaps:** the 645 open points are the OPEN, BROKEN,
PARTIAL and RENDERS rows of the ledger plus the five non-journey deductions
above. See "Open Certification Gates".

**History:** Baseline 3 (653, `ASPNET-CONTRACT-R3`, 2026-08-20) and Baseline 2
(598, `ASPNET-CONTRACT-R2`, 2026-08-18):
[`HISTORY/STATUS_ARCHIVE_2026-08.md`](HISTORY/STATUS_ARCHIVE_2026-08.md).
Baseline 1 (712 under the pre-drift denominator, 2026-07-14):
[`HISTORY/STATUS_ARCHIVE_2026-07.md`](HISTORY/STATUS_ARCHIVE_2026-07.md).

## Required End State

Project NEXUS ships as **two editions of one product**: a Laravel edition and an
ASP.NET edition, each running both unchanged frontends, switched by
configuration only. The ASP.NET edition exists because a segment of public-sector
buyers require a .NET stack as a condition of procurement
([`ADR-0003`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)).

| Unchanged client | Laravel edition | ASP.NET edition |
| --- | --- | --- |
| Canonical React at `react-frontend/` | Production behaviour source of truth | Same journeys, same outcomes, same data, same errors, same permissions |
| Accessible Web UK at `web-uk/` | Production, three live hostnames | The same Web UK code and page flows, switched by configuration only |

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
| ~355 (now) | An honest internal demo of the core member experience. |
| ~600 | **Procurement demo grade**: core and community member journeys certified on React, Web UK core journeys certified, admin core journeys certified. Enough to show a buyer the product running on .NET. |
| ~800 | **First-customer grade**: one .NET-required customer tenant could be operated, given the go-live gate — which includes working backups. |
| ~950 | Full platform equivalence, both editions interchangeable for every tenant. |

## Open Certification Gates

645 open points, as independent proof gates rather than one queue:

- **Journeys (488 open across four categories)** — the 76 OPEN/BROKEN, 2 PARTIAL
  and 30 RENDERS rows in
  [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md), plus the
  PROVEN→CERTIFIED conversion of 22 rows that a Laravel control arm unlocks.
- **Consumed-contract correctness (60 open)** — 4 client-consumed route gaps, the
  read-differ tail once a consumed-field mode exists, 8 differing writes, and
  319 stubs (63 of them uncalled and candidates for deletion — owner sees the
  list first).
- **Schema/upgrade (17 open)** — populated-history upgrade proof,
  preflight-failure proof, and the absent tables that specific journeys need.
- **Security/localization (17 open)** — R-4, R-18, R-20, R-8; request-locale and
  recipient-locale negotiation; 4 unseeded locales.
- **Background/providers (40 open)** — jobs 26→69 (compliance jobs first),
  Meilisearch round-trip, FCM HTTP v1, Stripe webhook processing.
- **CI and operations (23 open)** — coverage/test-quality gate, static contract
  evidence, and the operational readiness block: **backups, deploy/rollback
  path, observability, load comparison**.

Stateful certification uses the disposable Laravel (`:8091`) only. The ordinary
local Laravel database is a confidential production-derived snapshot and is never
a test fixture.

🔴 **The named production hard stop is unchanged and is not a code problem.** The
live ASP.NET database has had no successful backup since 2026-03-08 (156
consecutive failures) while the application runs `MigrateAsync()` on every start.
No score substitutes for fixing it. It is owner infrastructure work and it gates
every production role.

## Finite Ordered Queue

Phases A and B (documentation restructure, Baseline 3) completed 2026-08-20.
Phase C onward is re-ordered here against R4, highest score-movement-per-effort
first.

1. **Laravel control arm on the React smoke.** Test-harness only, no product
   risk. Converts up to 21 rows PROVEN→CERTIFIED (+~50 points) and every
   subsequent journey inherits it. **Do this first.**
2. **Consumed-field mode on the response differ.** Filters to fields with a known
   client reader before reporting a difference. Turns the read-differ upper bound
   into a real defect list, and stops agents implementing junk columns.
3. **Core member journeys, remaining 13 rows.** Exchange request→accept→complete
   (row 1.21) is the product's core transaction and the single most valuable
   open row. Then event create/manage, connections, messages-new, listing
   edit/delete, password reset, sign-out, onboarding, search results.
4. **Admin measurement pass.** Generate the admin GET corpus and run it against
   both backends *before* implementing anything in the staff tier. 243 endpoints
   is one measurement task, not 243 tasks.
5. **Web UK journey tier.** Extend the instrument to submit forms; the backend
   fixes largely land from phases 3–4 and are re-verified through a second
   client.
6. **Community module journeys**, then a scope decision on the extended modules.
7. **Staff journeys**, implementing against the phase-4 measurements; stubs die
   as the journeys that call them are certified.
8. **Background jobs 26→69, providers, localization negotiation, schema tail.**
9. **Operational readiness**: backups (owner), deploy/rollback path,
   observability, load comparison.

Banking cadence: a scoring transaction at every phase completion — never
estimated, never silent.

## Required Status-Report Format

Every ASP.NET status report must present these five blocks in this order:

1. **Named baseline and SHA** — rubric version, Laravel source, ASP.NET evidence
   SHA, scoring-record SHA, and inspected HEAD.
2. **Banked score** — one fixed-denominator total plus the eight category rows.
3. **Published but unscored** — exact commits and why not banked; `none` when
   there are none.
4. **Dirty/in-flight work** — scoped files, verification achieved, and explicit
   confirmation of zero banked points.
5. **Certification gaps** — exact remaining deductions and the evidence needed.

Never report a blended ASP.NET/Web UK percentage, compare an R4 total with an
R1–R3 total, silently rescore history, convert route counts into a completion
percentage, or describe uncommitted work as complete. Follow
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md) when updating this
status.
