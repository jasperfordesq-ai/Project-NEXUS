# ASP.NET new-installation scope and resumption roadmap

## Where things stand — 25 October 2026 (independently verified)

**Goal:** two interchangeable backends. React and the accessible site (web-uk),
unchanged, run against either Laravel or ASP.NET by configuration alone.

**Today:** that goal is not met, and a new ASP.NET installation cannot even be
set up, because there is no way to create its first community or administrator.
A second reviewer re-checked the Codex audit against the source and found it
accurate. The same pass found further blockers in basic journeys: sign-in,
email verification, member approval, first exchange, group creation, posts with
images, and module switches. Details and evidence are in
[CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md).

**Why it slipped:** ASP.NET has been frozen since 2026-09-11 while Laravel and
both frontends kept changing (about 181 new Laravel route declarations and
over 600 frontend commits). Things certified in August, such as React login,
stopped working without anyone touching ASP.NET.

**What a restart needs, in order** (none of this is authorised until the owner
explicitly resumes development, see [ADR-0005](decisions/ADR-0005-aspnet-edition-halted.md)):

1. **Stop the drift first.** Put a check in place that compares, on every
   change, the calls React and web-uk make against what ASP.NET answers. Without
   it, any repair is overtaken by new Laravel features.
2. **Make a new install possible.** Add a first-community and first-admin
   bootstrap, outbound SMTP, and the recurring jobs a community relies on.
3. **Fix the shared plumbing once:** routing duplicates in the alias
   convention, the browser login/refresh cookie contract, email verification
   and approval, and push and notification delivery.
4. **Then go journey by journey**, proving each one by driving the unchanged
   frontend against both backends with the same test data and reading back
   what was saved.
5. **Re-estimate after the first measured slice.** The day counts below are
   allowances, not forecasts.

**Estimate clarification (25 October):** The roughly 950 engineer-day total is an uncalibrated sum of broad human-effort allowances, not a reliable delivery forecast and not a measured AI-assisted estimate. Do not convert it into a promised calendar duration. Retain the work inventory; establish an AI-assisted forecast only after representative implementation and runtime verification are measured following explicit resumption.

Last reviewed: 2026-10-25 (three audit passes; current source and scoped implementation assessment).

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

## How much work is involved

| Workstream | Packages | Low | Planning allowance | High |
| --- | ---: | ---: | ---: | ---: |
| Shared backend and installation | 9 | 89 | 174 | 303 |
| React/member/platform-admin domain | 25 | 225 | 468 | 883 |
| Shared volunteer/care/matching and Web UK acceptance | 15 | 126 | 233 | 398 |
| Shared verification and readiness | 4 | 38 | 76 | 128 |
| **Total engineer-days** | **53** | **478** | **951** | **1712** |

The reconciled assessment contains **53 work packages**. Budgetary scenarios are **478 / 951 / 1,712 engineer-days** (low / conservative planning allowance / high rework). Round these to about **480–1,710**, with an allowance around **950**. The exact sums do not imply exact forecasting: these include verification and repair of real but unproven modules, not just confirmed missing code. They are not a calibrated most-likely prediction, statistical interval or a promise of AI elapsed time. Local tests/review are included in each package; shared verification is counted once, with no extra blanket contingency.

An engineer-day is 7.5 effective engineering hours, including focused tests and review. 951 days is about 47.55 person-months at 20 effective days/month. Four experienced contributors at an assumed 75% effective capacity yield an arithmetic 63.4 weeks, roughly 15 months; three yield 84.5 weeks, roughly 20 months. These are illustrations, not delivery dates or linear-scaling guarantees. Staffing, decision delay and measured throughput remain unknown. No current percentage-complete score is justified.

## Start with a measured tranche

The first **15–25 engineer-days**, already included within P1/B6/B1 and selected owning domain packages, establish an isolated blank installation, actual migration discovery/replay, initial tenant/admin, deterministic paired fixtures and owned caller contracts. They also measure a few representative repairs before revising the remaining estimate. This is not a claim that the whole foundation completes in that time.

1. Freeze source/client hashes, installation profile, actor/feature/provider matrix and acceptance scope.
2. Recreate independent synthetic PostgreSQL and Laravel fixtures; verify migration replay and non-demo first-admin setup. No production-derived data.
3. Expand dynamic frontend callers and exercise real route matching, then browser/BFF session continuity.
4. Capture failing populated workflows and persisted/effect assertions; repair representative slices only after explicit resumption.
5. Re-estimate the next wave using measured effort and failures. Preserve uncertainty for untraced state machines.

## Delivery sequence and ownership

| Stage | Packages | Required result |
| --- | --- | --- |
| Foundation | P1, B1, B6, B2; B7 evolves alongside | Trustworthy fixtures, unique route ownership, fresh setup and both unchanged clients' session lifecycle |
| Shared domain infrastructure | B3–B5, B8–B9 | Conserved settlement, complete privacy lifecycle, reliable workers/Pusher/provider outcomes and current required interoperability |
| Product workflows | RA01–RA25, UK-V1–UK-V14 and UK-M1 | All assigned member/admin/organisation workflows and negative outcomes match, including later reads/effects |
| Cross-cutting and certification | P2–P4 plus B7 | Locale/error contracts, four-client/backend combinations, installation/restore and current operator/acceptance evidence |

Every package is a budget envelope with named vertical slices, evidence and acceptance. One migration owner coordinates schema changes. Parallel work is by owned domain, not by route aliases. UK owns shared volunteering/care/matching; React-specific volunteering scope is only the extra consumer work. RA21 owns shared municipal/national/regional calculations; RA14 owns financial statements. RA09 is dispatcher plumbing and pilot lifecycle, not all module CRUD. B5 owns worker/Pusher infrastructure; RA24 owns podcast bytes/playback; RA16 owns AI conversation execution using existing providers. RA25 owns the current consumed subscription, invoice, checkout and refund lifecycle; it reuses B8 provider transport and B3 ledger primitives. Focused domain tests and final integrated testing are not charged twice.

## Decisions and exclusions

- Insurance is an unresolved cross-contract conflict: Web UK requires a file that Laravel rejects. Choose compatible backend behavior or explicitly defer that workflow; no frontend change is silently permitted.
- Preserve default-off optional features while implementing actual supported configured behavior. Enabling an unmatched ASP.NET legacy federation saga is not automatically required.
- Select supported installation targets and provider sandbox owners. Actual customer deployment, existing-community ETL/cutover, shared live data/dual writes, mobile certification, external certification and waiting for credentials/approvals are excluded.
- New functionality absent from both current client contracts is excluded. Current product import/export tools are included; excluding community migration does not remove those features.

## Evidence and completion

Current source inventories and selected experiments establish defects, not full certification. The earlier 556 selected-unit pass coexists with 33 ambiguous route samples.186 EF-discovered migrations differ from 188 source files; SQL generation and zero model/snapshot diff do not prove a blank database. The new pure-comparator probe demonstrates why shape MATCH cannot certify values/effects. No paired DB/browser/provider run was performed in this assessment.

Done means the required corpus passes for React+Laravel, React+ASP.NET, Web UK+Laravel and Web UK+ASP.NET on reproducible independent new installations, using unchanged frontend source. Verify roles/tenants, pagination, files, meaningful values, stored state, idempotency and eventual effects. Source, local tests, CI, hosted operation and owner acceptance remain distinct states. No release follows automatically from audit or implementation completion.

Detailed source-backed scope, ownership, acceptance, dependency graph, scenario arithmetic and unstarted tasks are retained in `.local-docs-archive/aspnet-audit/2026-10-25/scope-pass/`. The package ledger is `IMPLEMENTATION-WORK-PACKAGES.json`/`.csv`; `tasks/start-stage.md` is the concrete first-stage checklist. These ignored artifacts are local and are not present in a fresh clone. This maintained document carries the public-safe scope and readiness summary.

Current findings: [status](CURRENT_ASPNET_CONTRACT_STATUS.md). Fresh-session brief: [handoff](HANDOFF_PROMPT.md). Review limits: [modules](MODULES.md). Database evidence: [schema readiness](CURRENT_SCHEMA_READINESS.md).
