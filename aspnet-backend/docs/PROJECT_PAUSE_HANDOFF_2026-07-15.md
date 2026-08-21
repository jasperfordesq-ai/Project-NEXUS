# Project Pause And Cold-Start Handoff — 2026-07-15

> 🔴 **Historical checkpoint (labelled 2026-08-21).** Superseded and retained for audit only.
> Do not resume from this document, and do not treat any score, queue or status
> in it as current. Canonical current sources: [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md)
> (score and queue) and [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md)
> (the work list). Both ASP.NET and web-uk development pauses have been lifted
> (2026-08-14 and 2026-08-11); this file predates both.

> **Pre-consolidation paths.** Written before the 2026-08-09 move into the
> platform monorepo. Where this document says `apps/web-uk`, `apps/admin`,
> `apps/react-frontend` or `C:\platforms\htdocs\asp.net-backend`, read
> `web-uk/` and `aspnet-backend/` in this repository (the first two `apps/`
> directories were deleted before the move). The paths are left unedited
> because this is a record of what was true at the time.

Last verified: 2026-07-15 22:51 +01:00

Status: **Historical — the ASP.NET pause it records was LIFTED on 2026-08-14**

> 🔴 **Score figures in this document are the 2026-07-15 position and are not
> current.** Every "712/1000" below is Fixed Rubric Baseline 1. ASP.NET was
> rescored to **598/1000** on 2026-08-18 under Baseline 2
> (`ASPNET-CONTRACT-R2`); the schema category moved 129/150 → 118/150. Read
> [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) for the
> current score. This document remains useful for the cold-start sequence and the
> repository-freeze record.

<!-- doc-consistency: PROJECT_PAUSE_DATE=2026-07-15 -->
<!-- doc-consistency: PROJECT_PAUSE_STATE_ASPNET=LIFTED -->
<!-- doc-consistency: PROJECT_PAUSE_LIFTED_ASPNET_ON=2026-08-14 -->
<!-- doc-consistency: PROJECT_PAUSE_STATE_WEBUK=LIFTED -->
<!-- doc-consistency: PROJECT_PAUSE_LIFTED_WEBUK_ON=2026-08-11 -->
<!-- doc-consistency: PROJECT_PAUSE_FINAL_TAG=pause/2026-07-15-final -->
<!-- doc-consistency: PROJECT_PAUSE_CURRENT_TAG=pause/2026-08-09-final -->

> ## 🔴 The pause is now SPLIT. Read this before anything below.
>
> This document paused two workstreams with one marker. On **2026-08-11** the owner
> decided `web-uk` becomes the production accessible frontend and Blade retires, so
> the two states diverged and the single `PROJECT_PAUSE_STATE` marker was replaced
> by two.
>
> - **`web-uk`: LIFTED (2026-08-11).** Implementation, tests, documentation and
>   deployment *preparation* under `web-uk/**` no longer need a fresh instruction.
>   Current position:
>   [`../../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md).
>
> 🔴 **SUPERSEDED 2026-08-14 — the ASP.NET pause was LIFTED.** The owner
> explicitly resumed the ASP.NET contract-parity workstream on 2026-08-14. The
> marker above and this note are the current state; the line immediately below is
> the 2026-08-11 position and is kept only so a reader who remembers it can see it
> was superseded rather than deleted. The database-backup blocker it refers to is
> real and unchanged, and still gates PRODUCTION action — it never gated local
> implementation.
>
> - ~~**ASP.NET: STILL PAUSED.**~~ *(2026-08-11 position, superseded 2026-08-14.)*
>   Unchanged. Everything this document says about the
>   ASP.NET backend, its tests, its migrations and its containers stands.
>
> 🔴 **Why the marker was split rather than flipped.** Leaving it `PAUSED` was
> false, because `web-uk` work is authorised. Flipping it to `LIFTED` would have
> falsely un-paused ASP.NET — whose **live database has had no successful backup
> since 2026-03-08 while the application runs migrations on every start**, so
> restarting that service can irreversibly change live data with nothing to restore
> from. That warning is preserved verbatim throughout this document and is not
> lifted by anything.
>
> Two further things this lift does **not** cover, in either workstream:
> **no deployment without explicit authorisation**, and the **read-only Laravel
> database boundary**.
>
> Everything below is the original 2026-07-15 record, left unedited.

This is the first project-status document to read after the repository has been
left alone. It records what was true when development paused on 15 July 2026,
what is and is not proved, and how a future agent may safely re-establish a
current boundary. It does not authorize implementation or production work.

## One-Minute Handoff

- General product development remains **paused**. Opening or cloning the
  repository does not resume any autonomous loop. The separately authorized
  bounded CI remediation recorded near the end of this document is complete;
  the clean pause was re-established at `pause/2026-07-15-final`.
- `origin/main` has since advanced past that tag by twelve documentation,
  retirement, dependency-security, and infrastructure commits dated
  **2026-08-09**. Read
  [Authorized Retirement And Infrastructure Record — 2026-08-09](#authorized-retirement-and-infrastructure-record--2026-08-09)
  before using any repository-shape, freeze, or hosted fact on this page. No
  product score moved and the pause was not lifted.
- Do not implement, migrate, deploy, start production containers, or mutate the
  Laravel repository or its ordinary local database without a new, explicit
  user instruction.
- The corrected product objective is **external contract identity**, not broad
  similarity or route-count parity. The binding decision is
  [`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md).
- The end state is two unchanged frontends by two backends. Canonical React and
  shared accessible Web UK must each switch between Laravel and ASP.NET by
  configuration only. Backend-specific frontend branches are forbidden.
- Laravel remains the behavior and contract source of truth. The ASP.NET
  backend is experimental, incomplete, and not production-certified.
- The ASP.NET bank is **712/1000**. The schema category remains **129/150**.
  Later implementation and schema work is published but unscored.
- Web UK Baseline W1 is **663/1000**. Corrected Goal W2 deliberately has no
  percentage; its finish line is three finite gates listed below.
- The schema is **working and partly proved, not complete or release-certified**.
  The current source contains 163 runtime migration IDs. The frozen pause
  boundary's exact-SHA CI timed out; the separately authorized post-pause CI
  completion at `dbafc5c3` is recorded below and does not certify the remaining
  migration-specific or release gates.
- Historical `CURRENT_*_HANDOFF.md` files are evidence archives, not restart
  instructions. The current documents below override their scores and queues.

## Mandatory Read Order

A new agent must read these files in order before proposing work:

1. [`AGENTS.md`](../AGENTS.md) — urgent scope, frontend, database, and production
   guardrails.
2. [`CLAUDE.md`](../../CLAUDE.md) — authoritative project instructions and supported
   development methods.
3. this pause handoff — pause boundary, workstream map, and restart protocol.
4. [`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md) — binding
   contract-identity decision.
5. [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) —
   sole ASP.NET score, evidence boundary, and eight-package queue.
6. [`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md) — schema verdict,
   163-migration boundary, missing proof, and safe recommission sequence.
7. [`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
   — sole Web UK score, evidence boundary, and three-gate finish line.
8. [`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md) —
   fixed rubric and evidence method, but only after the user explicitly resumes
   a workstream.

For documentation authority, audience guides, and history labels, use
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md). If two maintained
documents disagree, its authority table decides which source wins.

## Binding Product Correction

The previous instruction to seek “parity” was too weak. It could be read as
roughly equivalent functionality, similar routes, or frontend adapters. That is
not the target.

ASP.NET must be externally contract-identical to Laravel at every boundary
consumed by either unchanged frontend:

| Observable boundary | Required identity |
| --- | --- |
| HTTP | Method, path, query, headers, multipart fields, redirects, status codes |
| Payloads | Request shapes, response envelopes, pagination, validation and error bodies |
| Identity and tenancy | Login, refresh, roles, permissions, tenant resolution, module gates |
| State and files | Persistence, concurrency, uploads, downloads, side effects, failure behavior |
| Workflows | Page-to-API sequence, provider effects, jobs, notifications, audit behavior |
| Operations seen by clients | Configuration bootstrap, realtime/provider settings, upgrade-visible behavior |

Internal languages, table names, and implementation patterns do not need to be
identical. Any internal difference must nevertheless preserve constraints,
tenant isolation, durable state, upgrade safety, and every consumer-visible
outcome. Static route matches alone are not contract identity.

## Paused Workstream Map

| Workstream | Canonical status | Honest pause verdict | First future package |
| --- | --- | --- | --- |
| ASP.NET contract identity | [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) | 712/1000 banked; 288 points remain; later commits are published but unscored | Re-establish exact SHAs and choose one of the eight ordered packages; do not estimate score movement |
| ASP.NET schema | [`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md) | 129/150 banked; working/partly proved; 163 runtime IDs; the pause-boundary full exact-SHA result was absent, while the post-pause required CI gate is now green | Certify migration 163 on blank and populated disposable PostgreSQL; do not treat the green general suite as upgrade certification |
| Web UK Laravel-first frontend | [`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md) | W1 663/1000; W2 unscored; source-owned work is near its finite finish line but not certified | Isolated manual accessibility evidence/fixes, then copy decision, then W2 audit |
| Dual-backend client switching | ASP.NET status plus [`BACKEND_SWITCHING_CONTRACT.md`](../../web-uk/docs/BACKEND_SWITCHING_CONTRACT.md) | Not certified for either unchanged client | Build exact consumer matrices and run unchanged-client workflows against ASP.NET |
| Production | production container guide (`.claude/production-containers.md`, not imported by the 2026-08-09 monorepo move) | No deployment was authorized by this pause audit | Remains a separate explicit-authority operation |

Never combine the ASP.NET and Web UK scores. Documentation health also has a
separate denominator and does not imply product readiness.

## Exact Product And Evidence Boundary

The product state frozen by this handoff is:

| Boundary | Value | Interpretation |
| --- | --- | --- |
| Laravel source | `903d03d3db78bbf87129ad35728be3b72819acaf` | Read-only contract/schema comparison source used by current evidence |
| ASP.NET product/schema implementation | `c767050a3eabd064bdf647695b9699b98186342b` | Latest product boundary before pause documentation; published but not rescored |
| Green CI/test evidence | `dbafc5c329c55a15b4329ff90804d725dbf8b089` | Required exact-SHA CI run 29451087913 succeeded; test/workflow evidence only, not a product or score boundary |
| Last banked ASP.NET implementation | `5fa15e0e79993464622b1c3ef053fcdd01679991` | Supports the 712/1000 bank |
| Schema merge | `df8c8b96c80804785e9c84f9f7c75337088d6024` | Nine schema slices merged; later migration 163 repairs a fresh-chain hole |
| Web UK banked product | `2e92f89ee03177af02f0f16b669591604d3e6403` | Product boundary for W1; scoring record `b5b2c0a7` |
| Latest named pre-audit Web UK product | `6864f7be` | Later published work remains unscored as a block |

Future documentation-only and repository-freeze commits do not earn product
points. A future agent must compare these values with then-current `origin/main`
and the Laravel source before treating any count or queue as current.

Generated Web UK route and API ledgers at `a3f18f06` record a dirty-provenance
caveat. They are useful structural planning evidence, not freeze certification.
Regenerate them at clean, named source SHAs before relying on them for a new
audit. The ordinary Laravel checkout also had a pre-existing lockfile change and
untracked `.codex/` state; never erase or claim ownership of those paths.

## Schema Blueprint

This section preserves what was known and missing at the frozen pause boundary.
The later bounded CI completion is recorded in the resumption section below; it
does not rewrite the pause tag or the remaining migration-specific gates.

The short answer is not “the schema is broken.” The contract-correction work
exposed a missing runtime migration for a table already present in the EF model
and snapshot. Commit `c767050a` adds
`20260715184200_AddCompatibilityAuditEntriesTable` and advances the applicable
chain to 163 IDs.

Evidence retained from the nine merged schema slices includes a 162-ID blank
PostgreSQL 16.4 replay, nine sequential populated upgrades, 27/27 focused tests,
model-drift checks, and constraint/isolation checks. Current static diagnostics
are 458 Laravel table names, 440 ASP.NET-represented names, 242 exact matches,
216 Laravel-only names, and 198 ASP.NET-only names. Those counts diagnose work;
they are not a completion percentage.

What remains before schema certification:

1. focused migration-163 source/runtime assertions;
2. exact-candidate migration discovery and model-drift proof;
3. fresh zero-to-163 disposable PostgreSQL replay and final-object assertions;
4. populated 162-to-163 upgrade with row, default, index, FK, and rejection
   assertions;
5. classification of all 216 Laravel-only names by workflow significance;
6. a separate fixed-rubric scoring transaction if the evidence closes points.

The former general same-SHA suite/CI item was satisfied after the first pause:
GitHub Actions run 29451087913 is terminal green at `dbafc5c3`. It must be rerun
after any future schema or product change and does not satisfy items 1-5.

Historical GitHub Actions run 29441392036 passed Build and frozen-React checks, but the
migrated Test job was cancelled at its 75-minute limit without a terminal
summary; coverage then failed and Docker was skipped. Record it as timed out,
not green or red. No production schema was inspected or modified.

## Web UK Blueprint

Web UK is Laravel-first and backend-neutral. Laravel Blade defines its browser
experience; Laravel API behavior defines its backend contract. ASP.NET must
later satisfy that established contract without Web UK forks.

Goal W2 has exactly three remaining gates:

1. isolated-fixture manual visual, keyboard, focus, no-JS, zoom/reflow,
   forced-colour, and screen-reader evidence plus fixes;
2. resolution of the accessibility-copy difference after evidence exists; and
3. a clean-checkout fixed-rubric W2 audit and certification transaction.

Optional live-Laravel mutation certification and future ASP.NET switching are
separate workstreams. Never run login, mutation, upload, download, destructive,
or cleanup tests against the ordinary production-derived Laravel database.

## Resume Protocol

When the user starts a new phase, do this before changing files:

1. obtain an explicit instruction naming the workstream;
2. fetch and inspect current refs without discarding local work;
3. run the read-only boundary commands below;
4. compare current product SHAs and generated evidence with this handoff;
5. update the canonical status document if drift invalidates this boundary;
6. claim an exclusive file/worktree scope for shared hotspots; and
7. implement one bounded slice, verify it, document it, commit it, and push it
   before selecting another slice.

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git log --oneline --decorate -n 20
git worktree list --porcelain
git branch --all --verbose --no-abbrev
git stash list
git -C C:\platforms\htdocs\staging status --short --branch
git -C C:\platforms\htdocs\staging rev-parse HEAD
```

Do not assume that a clean checkout, an old green focused test, or the presence
of a route proves current behavior. Do not resume by running migrations or
stateful browser tests.

## Copy-Ready Handoff Prompts

### Read-Only Reorientation

> Read `AGENTS.md`, `CLAUDE.md`,
> `docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md`, ADR-0001, and the three canonical
> status documents in their prescribed order. Perform a read-only refresh of
> both repository SHAs, worktrees, branches, stashes, generated evidence, and
> current CI. Do not edit, migrate, deploy, start production containers, or
> touch the Laravel database. Report drift from the pause boundary separately
> from the historical banked scores, and recommend one bounded next package.

### ASP.NET Contract-Identity Phase

> Resume only the ASP.NET contract-identity workstream. Treat Laravel at the
> refreshed named SHA as read-only behavior authority and ADR-0001 as binding.
> Preserve both unchanged frontends; do not create frontend adapters. Select
> one package from the canonical eight-package backend queue, trace the exact
> Laravel and consumer contract, implement the smallest coherent backend slice,
> run focused then broader proof, update exact-SHA status, commit the verified
> slice, and push. Keep banked, published-unscored, and dirty work separate.

### Schema Recommission Phase

> Resume only the schema workstream after reading
> `docs/CURRENT_SCHEMA_READINESS.md`. Use an isolated worktree and exclusively
> owned disposable PostgreSQL 16.4 databases. First certify migration 163 on
> blank zero-to-current and populated 162-to-163 paths, including model drift,
> constraints, row survival, and cleanup. Never point commands at production,
> shared, Laravel, or production-derived data. Commit and push each verified
> schema/evidence slice; do not bank points without the complete scoring
> transaction.

### Web UK Completion Phase

> Resume only `apps/web-uk/**`. Read its AGENTS/CLAUDE/current-status files and
> keep Laravel source/database read-only. Complete the three W2 gates in order:
> isolated manual accessibility evidence/fixes, accessibility-copy decision,
> then a complete clean-checkout W2 audit. Use Web UK-owned fixtures and mocks;
> do not inspect ASP.NET to invent frontend behavior and do not add
> backend-specific branches. Commit and push each coherent verified package.

## What A Future Agent Must Not Infer

- “712/1000” does not mean the schema or either client switch is 71.2% ready.
- “129/150 schema” does not certify migration 163, production upgrades, or all
  Laravel workflow storage.
- “0 static route gaps” does not prove payload, auth, side effects, or runtime.
- “Web UK 663/1000” is W1, not a percentage for corrected Goal W2.
- A historical handoff’s newer-looking section heading does not override a
  canonical current page.
- A deployed legacy React container does not make the frozen React copy the
  product source of truth.
- A generated artifact with dirty provenance is not exact-SHA certification.

## Repository Freeze Record

The first clean boundary is preserved by annotated tag `pause/2026-07-15` at
`84d7eefc7a79202aae55d4a47b899023d1747d2c`. After the explicitly authorized
CI loop, the current clean boundary is the commit identified by annotated tag
`pause/2026-07-15-final`. At the current boundary the automated pause-readiness
guard proves:

| State | Before freeze | Final pause state |
| --- | ---: | ---: |
| Registered worktrees | 5 | 1, at the repository root |
| Local branches | 9 | 1, `main` only |
| Stashes | 8 | 0 |
| Stale remote branches removed | 0 | 7 |
| Intentional open-PR remote heads | 4 candidates inspected | 3 retained |
| Pushed archive tags | 0 | 18 under `archive/pre-pause/*` |
| Known accidental ignored paths | 4 | 0 |

The archive tags preserve two re-audit snapshots, three unique Web UK
prototype tips, the merged schema and Web UK workstream tips, the legacy
`master` tip, eight former stash commits, the unfinished coverage-collecting CI
experiment, and its refined no-coverage CI candidate. They are historical
recovery refs, not active branches or restart queues.

The unfinished four-shard/coverage experiment parsed but its local isolated run
ended after about 15 minutes without TRX or coverage output. Its exact patch is
preserved at `archive/pre-pause/unfinished-ci-sharding`. A refined candidate at
`archive/pre-pause/ci-sharding-candidate` removed coverage and completed static
discovery, but no GitHub workflow run existed. A racing cherry-pick briefly
placed that candidate on `main`; the final pause history immediately reverts it,
so neither candidate changes the tagged tree. Both require a future explicitly
authorized retry with terminal evidence.

Removed remote heads were the two re-audit branches, schema workstream branch,
Web UK workstream branch, unproved CI-candidate branch, legacy `master`, and
superseded NuGet Dependabot branch (PR 69 closed). Buildx PR 11, frozen-React
`qs` PR 71, and standalone-admin `qs` PR 72 remain open and were retained
deliberately.

The removed ignored debris was two zero-byte `_nul` files, an accidental empty
`cmd.exe` directory, and a malformed empty `robocopy` directory tree. No
tracked, maintained, or external user file was removed.

Run the closing proof from a fetched checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-pause-readiness.ps1
```

Superseded on 2026-08-09: the current clean-pause boundary is now the annotated
tag `pause/2026-08-09-final`, and the guard asserts that newest dated tag at `HEAD`
while pinning `pause/2026-07-15` and `pause/2026-07-15-final` as immutable
history. The paragraph below describes the first pause boundary and is retained
for that boundary only.

It must pass at `pause/2026-07-15-final`; otherwise the repository is not in the
current documented clean-pause state. The script also proves that historical
tag `pause/2026-07-15` has not moved from `84d7eefc`.

## Authorized CI Resumption Record — 2026-07-15

The user subsequently gave an explicit instruction to commit and push all
active work, monitor CI, and keep fixing and republishing until the required CI
run is green. That instruction authorizes only this bounded publication and CI
remediation loop. It does not authorize production deployment, production
containers, Laravel writes, or general product implementation.

The no-coverage four-shard candidate was therefore reintroduced after the
historical pause transaction had reverted it. Its evidence boundary is:

- deterministic discovery allocates all 3,361 API tests exactly once across
  four whole-class shards: 841, 840, 840, and 840 tests;
- a focused disposable PostgreSQL integration shard completed locally in
  3m02s and finalized a passing TRX;
- the equivalent one-method coverage probe produced no TRX or coverage output
  within 15 minutes, matching GitHub evidence that coverage instrumentation was
  the throughput blocker, so coverage is not part of the required push gate;
- GitHub run `29448759052` was cancelled after 1m18s only because the final
  pause-documentation push superseded it; it is not pass/fail test evidence;
- at the time this record was first written, terminal exact-SHA CI evidence
  remained required before the resumed loop could be called green; the
  completion record follows.

The annotated `pause/2026-07-15` tag remains the immutable historical first
clean-pause boundary. The current final pause closure is separately tagged
`pause/2026-07-15-final`; the readiness script verifies both facts. Baseline D3
remains the original score and D3-R1 is its same-rubric revalidation after the
bounded CI work, without changing any product score.

### CI Remediation Completion Record - 2026-07-15

The bounded CI remediation completed without changing the frozen product score
or authorizing general development:

- `c767050a3eabd064bdf647695b9699b98186342b` remains the latest backend
  product/API/schema implementation boundary;
- `b3f946b3fd3de51fa444008a7daee80d3de1bcd2` is the four-shard required-CI
  workflow boundary;
- `dbafc5c329c55a15b4329ff90804d725dbf8b089` is the test/evidence SHA that
  gives every concurrent wallet transfer its own explicit idempotency key;
- GitHub Actions run
  [`29451087913`](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29451087913)
  finished terminal **success** for `dbafc5c3`: Build, frozen-React Frontend,
  Test shards 1-4, and Docker Build & Push all succeeded;
- deterministic allocation covered 3,361 logical tests exactly once as
  841 + 840 + 840 + 840. The downloaded TRX files contained 3,385 executed
  rows as 841 + 840 + 840 + 864 because shard 4 expanded parameterized runtime
  rows; all 3,385 passed, with 0 failed, skipped, error, timeout, or aborted;
- coverage remains intentionally outside the required push gate because the
  earlier instrumentation path prevented VSTest from completing and flushing
  terminal artifacts; and
- Docker image publication is not a production deployment. No production
  container was touched, and no Laravel repository or database action occurred.

This closes the required complete-suite exact-SHA CI push gate for the named
candidate only. It does not rescore the ASP.NET bank of **712/1000**, the
build/test/CI category of **45/100**, the schema bank of **129/150**, or
Documentation Health Baseline D3 of **1000/1000**. Dedicated migration-163
blank/populated-upgrade proof, storage classification, providers, both
unchanged-client runtime switches, release certification, and production proof
remain open.

### Hosted GitHub Snapshot - 2026-07-15

The hosted state was refreshed during final pause closure:

- open dependency PRs are [#11](https://github.com/jasperfordesq-ai/api.project-nexus.net/pull/11),
  [#71](https://github.com/jasperfordesq-ai/api.project-nexus.net/pull/71), and
  [#72](https://github.com/jasperfordesq-ai/api.project-nexus.net/pull/72); their
  three remote heads are intentional and are not stale workstream branches;
- GitHub Dependabot reported **35 open alerts**: 2 critical, 9 high, 16 medium,
  and 8 low; and
- those counts are a dated hosted snapshot, not a source audit or risk
  acceptance. A future agent must refresh Security/Dependabot before dependency,
  release, or production work and must not infer that the green CI run resolved
  the alerts.

No alert was dismissed and no live PR branch was deleted by the freeze audit.

## Authorized Retirement And Infrastructure Record — 2026-08-09

The user explicitly authorized a bounded security, retirement, and
infrastructure task during the pause. That instruction did not lift the pause,
resume product development, or authorize a scoring transaction. This record
appends the resulting boundary rather than rewriting the 15 July facts above.

### New Repository Boundary

| Boundary | 2026-07-15 pause value | 2026-08-09 value |
| --- | --- | --- |
| `HEAD` and `origin/main` | `896aac94` (`pause/2026-07-15-final`) | `e36415c02a71a83247168d14f652064a006df6af` |
| Commits beyond the final pause tag | 0 | 12, all dated 2026-08-09 |
| Aggregate diff | — | 1,270 files changed, 764 insertions, 331,667 deletions |
| Frontends in this repository | 3 (`react-frontend`, `admin`, `web-uk`) | 1 (`web-uk`) |
| ASP.NET product/API/schema implementation | `c767050a` | `c767050a`, unchanged |

The twelve commits are `87123653` through `e36415c0`. **No file under `src/`,
`tests/`, `migrations/`, or `e2e/` changed.** Verify before trusting this claim:

```powershell
git diff --name-only pause/2026-07-15-final..HEAD -- src tests migrations e2e
```

That command returns nothing at `e36415c0`. Every banked score therefore stands
unchanged and unrescored: ASP.NET **712/1000**, its schema category **129/150**,
and Web UK Baseline W1 **663/1000**. The schema boundary of 163 runtime
migration IDs at `c767050a` is likewise untouched.

### What Actually Changed

- **`apps/react-frontend/` deleted** (1,134 files). It was a dead, out-of-date
  fork. Its `nexus-react-frontend` container and image were removed from the
  Azure host, and `platform.project-nexus.net` now serves a static retirement
  notice. See [`REACT_FRONTEND_RETIREMENT.md`](REACT_FRONTEND_RETIREMENT.md).
- **`apps/admin/` deleted** (93 tracked files) and its containers, images, and
  `admin.project-nexus.net` proxy removed. The admin panel lives in the
  canonical React frontend in the staging repository. React and React Router are
  now absent from this repository entirely.
- **govie SPA retired**: container `nexus-web-govie`, its image, and the
  `ie.project-nexus.net` proxy were removed. This is not `project-nexus.ie`,
  which is a live V1 Laravel domain and was deliberately untouched.
- **Dependency security**: open Dependabot alerts went 81 to 3, and the
  remaining 3 died with `apps/admin`. `.claude/settings.local.json` was
  untracked; it had leaked deployment hosts, SSH key paths, and test
  credentials into a public repository. Rotation of any exposed value is an
  operator action this record does not claim was performed.
- **TLS**: a Cloudflare Full (strict) versus Let's Encrypt renewal deadlock was
  diagnosed, and the `project-nexus.net` and `timebank.global` zones were
  migrated to Cloudflare Origin CA certificates valid to 2041. Procedure:
  [`CLOUDFLARE_ORIGIN_CERT_RUNBOOK.md`](system/CLOUDFLARE_ORIGIN_CERT_RUNBOOK.md).
- **`apps/web-uk`** received dependency-advisory patches in `package.json` and
  `package-lock.json` plus documentation updates. Its own canonical status page
  was refreshed on the same day and remains the sole Web UK source.

Docker image publication and container removal are operations, not a product
deployment or a certification. No Laravel repository, Laravel database, or
production database was touched.

### Superseded Freeze-Record Facts

The [Repository Freeze Record](#repository-freeze-record) above remains accurate
for `pause/2026-07-15-final`. At `e36415c0` these entries have moved:

| State | Final pause state | 2026-08-09 state |
| --- | ---: | ---: |
| Registered worktrees | 1 | 1, at the repository root |
| Local branches | 1 | 1, `main` only |
| Stashes | 0 | 0 |
| `HEAD` equals `origin/main` | yes | yes |
| Intentional open-PR remote heads | 3 | 2 |
| Pushed archive tags | 18 | 18, all still present on `origin` |

The open pull requests are now [#11](https://github.com/jasperfordesq-ai/api.project-nexus.net/pull/11)
(`docker/setup-buildx-action` 3 to 4) and
[#73](https://github.com/jasperfordesq-ai/api.project-nexus.net/pull/73)
(`body-parser` in `apps/web-uk`). PRs #71 and #72 closed with the deletion of
the directories they targeted. `scripts/check-pause-readiness.ps1` was updated
in the same phase to expect this remote-head set.

### Pause-Readiness Guard At This Boundary

`scripts/check-pause-readiness.ps1` did not pass at `e36415c0`. Four causes were
diagnosed and all four are now resolved:

1. `pause/2026-07-15-final` no longer pointed to `HEAD`. That is the intended
   consequence of the authorized commits, not a defect. **Neither existing pause
   tag was moved.** Instead the guard was restructured: `pause/2026-07-15` and
   `pause/2026-07-15-final` are now both immutable historical boundaries, and a
   new dated annotated tag marks the current clean-pause boundary at `HEAD`.
   The guard holds every closed boundary in one pinned table and one
   `$currentPauseTagName`. Future pauses follow the same pattern: pin the
   outgoing tag into the table and set the new one. Never repoint a tag.

   | Tag | Role | Pinned at |
   | --- | --- | --- |
   | `pause/2026-07-15` | immutable history | `84d7eefc` |
   | `pause/2026-07-15-final` | immutable history | `896aac94` |
   | `pause/2026-08-09` | immutable history | `1c83801a` |
   | **`pause/2026-08-09-final`** | **current clean-pause boundary** | `HEAD` |
2. Sixteen `archive/pre-pause/*` tags were reported missing on a working clone
   that had fetched only two of them. All eighteen are present on `origin` —
   confirm with `git ls-remote --tags origin` before treating this as loss, and
   run `git fetch --tags` to clear the false positive.
3. `check-documentation-consistency.ps1` still required `CLAUDE.md` to document
   the frozen React port `127.0.0.1:5273`. Commit `b553377d` correctly removed
   that port from `CLAUDE.md` with the rest of the React retirement, but the
   matching assertion was not removed with the other React wiring. That stale
   assertion has been deleted.
4. The `## Baseline D3` heading assertion in
   [`DOCUMENTATION_HEALTH_REPORT.md`](DOCUMENTATION_HEALTH_REPORT.md) failed only
   on a Windows checkout with `core.autocrlf=true`: the committed blob is
   LF-only, the working tree is CRLF, and the assertion was anchored with a bare
   `$`. This was a checker portability defect, never a documentation error and
   never 2026-08-09 drift. The anchor is now `\r?$`; the heading itself was
   correct and must not be edited.

A fifth cause appeared once required CI ran at the refreshed boundary, and it
was not drift either. Two test classes carried fixtures that expired on
**1 August 2026**, so the suite turned red on that date with no code change:

| Class | Expired fixture | Consequence |
| --- | --- | --- |
| `CaringCommunityPilotScoreboardControllerUnitTests` | quarterly review seeded at a literal `2026-05-01`, due at `+3` months | asserted the review was not yet overdue |
| `MunicipalSurveyControllerUnitTests` | survey window `2026-07-01` to `2026-08-01` | asserted the survey was still inside its active window |

Both now seed relative to now, and the scoreboard class gained explicit overdue
coverage. **No production source changed**; the services were behaving
correctly and only the fixtures' assumptions about time were wrong.

This is why CI was red at `e36415c0` while the recorded green aggregate at
`dbafc5c3` predates the expiry. **The recorded `dbafc5c3` aggregate therefore
cannot be reproduced by re-running that SHA today.** It remains valid evidence
for its own date and candidate, and must not be re-run as a substitute for
current CI. When adding a fixture that must be "current", "open", "not yet due",
or "not yet expired", anchor it to `DateTime.UtcNow` rather than a literal date.

The guard therefore passes again at the boundary carried by
`pause/2026-08-09-final`.
A future agent that finds it failing should first check whether `origin/main`
has simply advanced past the newest dated pause tag, which is the ordinary
consequence of authorized work rather than evidence of damage.

### What A Future Agent Must Not Infer From This Record

- Deleting three frontends did not advance contract identity. The
  two-frontends-by-two-backends end state is unchanged, and the unchanged
  canonical React client still lives in the staging repository.
- Retiring a production surface is not a deployment authorization, and removing
  a container does not certify anything about the backend that remains.
- Clearing dependency alerts is not release readiness or a security review.
- A 2041 origin certificate removes a renewal cliff; it does not change product
  status, and `pairc-goodman.com` plus `timebanks.us` are deliberately excluded
  because they are not proxied through Cloudflare.
- This record is not an authorization to resume. The resume protocol and
  copy-ready prompts above still require an explicit instruction naming one
  workstream.

## Pause Integrity Rule

This handoff becomes stale if `origin/main` moves beyond
`pause/2026-07-15-final`, the Laravel source SHA, worktree or
branch state, schema migration count, generated evidence, canonical scores, or
open certification gates change. A future agent must append a new dated pause
or resumption record rather than silently rewriting the 15 July boundary.

That has happened once. The current repository boundary is `e36415c0`, recorded
in the [2026-08-09 retirement and infrastructure record](#authorized-retirement-and-infrastructure-record--2026-08-09).
The 15 July product, schema, and score boundaries remain in force because no
implementation source changed. Append the next record below that one.
