# ASP.NET Status Archive — July 2026 (Baseline 1 era)

Status: **Historical checkpoint — do NOT use these scores or queues as current.**
Canonical replacement: [../CURRENT_ASPNET_CONTRACT_STATUS.md](../CURRENT_ASPNET_CONTRACT_STATUS.md).

Everything below is preserved verbatim from the status document as it stood
when these sections were current (dates, SHAs and commands intact, per the
safe-historical-preservation rules in DOCUMENTATION_GOVERNANCE.md). The one
edit is the first heading: it used to read "Current Scored Position", which
was false the moment Baseline 2 was named — the 712/1000 in it is Baseline 1,
banked 2026-07-14 under the pre-drift denominator.

---
## Baseline 1 Scored Position (historical — banked 712/1000 under the pre-drift denominator; superseded by Baseline 2 then Baseline 3)

The **current banked score is 712/1000 (71.2%)** under Fixed Rubric Baseline 1.
The denominator is fixed; newly discovered work is recorded as a deduction or
a separately named Laravel-drift baseline, never as a silent denominator
change.

The 2026-07-15 system-wide re-audit keeps this score unchanged. Eleven backend
implementation/test commits were published to `origin/main` after the restart
scorecard. A later user-authorized transaction committed two test expectation
corrections and merged nine verified schema slices. The separately authorized
post-pause CI remediation has now produced a complete green exact-SHA aggregate
at `dbafc5c3`, but none of these changes has received a fixed-rubric scoring
transaction. All are recorded below instead of being converted into an
estimated percentage.

| Category | Banked | Maximum | Open |
| --- | ---: | ---: | ---: |
| Active Laravel API route representation | 100 | 100 | 0 |
| Semantic workflow and canonical-consumer contract parity | 307 | 350 | 43 |
| Schema, migrations, data integrity, and upgrade safety | 129 | 150 | 21 |
| Auth, tenant isolation, security, and localization | 97 | 100 | 3 |
| Full build/test/CI evidence | 45 | 100 | 55 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 10 | 125 | 115 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 24 | 75 | 51 |
| **Total** | **712** | **1000** | **288** |

🔴 **Superseded on 2026-08-14 for the current Laravel HEAD:** the regenerated
comparison now reports **2,600/2,667 matched with 67 missing** (see the
2026-08-14 re-audit section below). The paragraph that follows remains true only
for the frozen `903d03d3` baseline it was written against.

Active route representation is **2,601/2,601 matched with 0 missing**. Seven
retired OpenAPI-only operations are reported separately and return to the
active gate automatically if a live Laravel route reintroduces them. This
closes the representation inventory only; it is not runtime, semantic, or
production certification. The separately generated canonical React matrix has
2,328 static call-site rows and 2,016 unique method/path entries, with 0 ASP.NET
static gaps and 171 method-unresolved entries. The reconciled inventory does not
prove payload, status, auth, tenant, side-effect, or runtime correctness; those
rows remain semantic and unchanged-client work rather than route-score evidence.

> 🔴 **The actionable version of everything below lives in
> [`PRODUCTION_READINESS_REMEDIATION.md`](../PRODUCTION_READINESS_REMEDIATION.md)** —
> ordered P0–P3, with what is already fixed, what was checked and cleared, and
> what only the owner can close. Read that first when resuming work; this section
> is the audit narrative and evidence behind it.


## Baseline And Banked Evidence

Fixed Rubric Baseline 1 froze:

- Laravel `903d03d3db78bbf87129ad35728be3b72819acaf`;
- ASP.NET `b751d22f38baf0ac8bdf90fe669550b568fcb489`;
- the evidence snapshot at 2026-07-14 10:51:18 +01;
- an initial banked score of **620/1000**.

Subsequent points were banked only after their implementation and evidence were
published:

| Published checkpoint | Evidence | Banked movement |
| --- | --- | ---: |
| Marketplace payment settlement | Implementation `768801f129747ebcb8ae2f52dd9d34f851f20df9` | +8 semantic, +4 schema = **632/1000** |
| Marketplace Connect onboarding | Implementation `25110d7fb98dfed4e2eabbea016924cee93f9b9d`; scoring record `bda4cb949d322b77197ec51c7c4152b272a42a4d` | +4 semantic, +1 schema, +1 providers/operations = **638/1000** |
| Marketplace paid notifications and durable order identity | Implementation `f562c49796b81ac2ea47a4699dc22f9f0e57f9c0` | +4 semantic, +2 schema, +1 providers/operations = **645/1000** |
| Marketplace escrow settlement and delayed Connect payout | Implementation `93417bd17e886e8d05e054ec2f679a4851c6ae26` | +8 semantic, +4 schema, +2 providers/operations = **659/1000** |
| Marketplace provider refunds and dispute settlement | Implementation `4f7b9f202322d792574f2003274fadfda9e7037d` | +5 semantic, +3 schema, +1 providers/operations = **668/1000** |
| Signed external marketplace refund reconciliation | Implementation `ef8a0cf8d9458abda8350f8bf2a5adca44f12724` | +3 semantic, +1 providers/operations = **672/1000** |
| Signed held-escrow charge-dispute reconciliation | Implementation `027f35e6189eee13eb05396050a2995706597cad` | +3 semantic, +1 providers/operations = **676/1000** |
| Paid-transfer charge-dispute recovery | Implementation `9875fb5dd33e3ab5c33ea77a83fcfb0b8c6c0b00` | +3 semantic, +1 providers/operations = **680/1000** |
| Marketplace refund notification evidence | Implementation `b37a3cc5ed903394b67813a3e34304213b9e150d` | +3 semantic, +1 providers/operations = **684/1000** |
| Secure SSO/OIDC authentication flow | Implementation `c20d064e6adb99d3a585efd299650d5e913180ff` | +8 semantic, +3 schema, +3 security = **698/1000** |
| Tenant-bootstrap precedence and fail-closed runtime proof | Implementation `5fbcf36dedf320c0ca81ac77f8b4771d891f7331`; stable disposable-PostgreSQL verification at ASP.NET `ccd109fc4dc67b0b117780b2130d519e6bb38eea` | +2 semantic, +1 security = **701/1000** |
| Social comment mentions, usernames, and recipient side effects | Implementation `1ff6447012c89744e94d6693463a8032361c5946` | +4 semantic, +2 schema, +1 security/localization = **708/1000** |
| Laravel-compatible social-comment HTML sanitization | Implementation `293796e0f17b91e446f49a28babd960de7681e27` | +1 semantic, +1 security/localization = **710/1000** |
| V2 generic-comment safe-format and sanitizer parity | Implementation `5fa15e0e79993464622b1c3ef053fcdd01679991` | +1 semantic, +1 security/localization = **712/1000** |
| Migrated-schema integration certification harness | Implementation/evidence `fefbb5ce03b83c95cd78fb338b7a5c41da9b6745` | **+0**; corrects the evidence boundary but does not substitute for a complete green suite or CI |

These named values form an audit trail. They are not competing current scores.


## Repository State At This Verification

The latest banked backend implementation inspected for this page is
`5fa15e0e79993464622b1c3ef053fcdd01679991`, with Laravel frozen at
`903d03d3db78bbf87129ad35728be3b72819acaf`. The latest published backend
product/API/schema implementation boundary remains
`c767050a3eabd064bdf647695b9699b98186342b`. It follows schema merge
`df8c8b96c80804785e9c84f9f7c75337088d6024` and adds the missing runtime
creation migration for `compatibility_audit_entries` plus contract and test
corrections. Required-CI workflow commit `b3f946b3fd3de51fa444008a7daee80d3de1bcd2`
and test/evidence commit `dbafc5c329c55a15b4329ff90804d725dbf8b089`
are later published, unscored evidence boundaries; neither changes the product
implementation or banked points.

### 2026-08-09 Repository Boundary Refresh

`origin/main` advanced from `896aac94` (`pause/2026-07-15-final`) to
`e36415c02a71a83247168d14f652064a006df6af` through twelve commits dated
2026-08-09, under a bounded user authorization for security, retirement, and
infrastructure work. The pause was not lifted.

**No backend implementation moved.** No file under `src/`, `tests/`,
`migrations/`, or `e2e/` changed across that range:

```powershell
git diff --name-only pause/2026-07-15-final..HEAD -- src tests migrations e2e
```

The command returns nothing at `e36415c0`. Consequently:

- the banked total remains **712/1000** and every category row above is
  unchanged;
- the latest banked implementation SHA remains `5fa15e0e`;
- the latest published product/API/schema boundary remains `c767050a`;
- the exact-SHA CI evidence boundary remains `dbafc5c3` with run 29451087913
  terminal green;
- Laravel remains frozen at `903d03d3db78bbf87129ad35728be3b72819acaf`; the
  Laravel comparison source was not re-inspected in that phase, so refresh it
  before generating any new matrix.

What changed is repository shape, not contract state. `apps/react-frontend/`
(1,134 files) and `apps/admin/` (93 tracked files) were deleted, leaving
`apps/web-uk` as the only frontend here; the corresponding production
containers, images, and Apache proxies were removed; Dependabot alerts were
patched down; and two Cloudflare zones moved to origin certificates valid to
2041. The full record is the
[2026-08-09 retirement and infrastructure record](../PROJECT_PAUSE_HANDOFF_2026-07-15.md#authorized-retirement-and-infrastructure-record--2026-08-09).

Two consequences matter for this workstream:

1. **Queue package 8 is unaffected in substance but changed in location.**
   Certifying the unchanged canonical React client was always against
   `C:\platforms\htdocs\staging\react-frontend`; the deleted in-repo fork was
   never the certification target. Deleting it removes a decoy, not a gap.
2. **The frozen-React CI job is gone.** The green `dbafc5c3` aggregate included
   a frozen-React `Frontend` job that no longer exists in `.github/workflows/ci.yml`.
   The recorded run remains valid evidence for its own SHA, but the next
   required-CI run will have a different job set. Do not describe a future run
   as reproducing `29451087913` without noting that difference.
3. **The `dbafc5c3` aggregate is not reproducible by re-running that SHA.** Two
   test classes carried fixtures that expired on 2026-08-01, so the suite turned
   red on that date with no code change and CI failed at `e36415c0`:
   `CaringCommunityPilotScoreboardControllerUnitTests` seeded a quarterly review
   at a literal `2026-05-01` and asserted the three-month cadence was not yet
   due, and `MunicipalSurveyControllerUnitTests` seeded a survey window of
   `2026-07-01` to `2026-08-01` and asserted the survey was still active. Both
   now seed relative to now, with explicit overdue coverage added to the former.
   `PilotScoreboardService` and the municipal survey services are unchanged and
   no contract moved. Treat run 29451087913 as valid evidence for its own SHA
   and date only, and never re-run an old SHA as a substitute for current CI.

This refresh records a boundary, not a score movement. It banks **zero** points
and does not discharge any open certification gate.

### Published But Not Rescored

Published commit `fefbb5ce03b83c95cd78fb338b7a5c41da9b6745`
changes the shared integration fixture from `EnsureCreated` to the complete EF
migration chain, so PostgreSQL functions, triggers, preflights, and other raw
migration SQL are present in test databases. It also corrects stale ordinary-
admin expectations for the database-backed platform-super-admin bulk policy and
updates the obsolete volunteer-hours alias case to assert the current Laravel-
shaped validation order. At that earlier checkpoint, the Release test assembly
built with 0 warnings and 0 errors, the focused fresh-migrated PostgreSQL set
passed 14/14, and the five affected classes passed 57/57 in 303.8 seconds. It
added **zero banked points** because the then-3,331-test complete suite and
exact-SHA CI were still open. The later `dbafc5c3` aggregate closes that general
CI subgate without retroactively scoring this implementation slice.

Published commit `923db629dea331ee093018887c4533d2c4e7133e` added the
exact-SHA canonical React call-site generator. Published correction
`bab02a77c3075e182f039785ef097ac88a62f4b9` reconciles constant-root ASP.NET
routes, multiple verb attributes, parameterized route templates, and typed
dynamic frontend actions in the maintained matrix at
[`generated/canonical-react-contracts/README.md`](../generated/canonical-react-contracts/README.md).
It records 2,328 call-site rows, 2,016 unique method/path entries, 1,845 with
method evidence, 171 with unresolved methods, and 0 ASP.NET static gaps against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and ASP.NET
`0c8885355154e5d188244e4820977c7f3a6f5e65`. It adds **zero banked points**:
inventory generation does not prove payload, envelope, auth, tenant, side-effect,
or runtime correctness.

The following backend commits after restart scorecard `ea352690` are published
but remain unscored:

| Commit | Published change | Why no points are banked |
| --- | --- | --- |
| `60715dfd` | Deterministic backend shard harness/test setup | Partial moving-SHA shard evidence is not a complete aggregate. |
| `e49c8ca9`, `0b79e2a6` | Regional-analytics and premium-cancel contract-test corrections | Test expectations/probes alone do not close a scored semantic gate. |
| `1fd7a6c0` | Real super-admin tenant move and event-archive contract behavior | Requires fixed-rubric review plus complete certification evidence. |
| `47458d51`, `06e6045e` | Group/campaign expectations and scheduled-job test setup | Evidence/setup corrections are not a complete suite or CI result. |
| `2a1acefe` | Real administrator listing-deletion parity and shard slicing | Requires semantic scoring and exact-SHA aggregate evidence. |
| `59296ac6`, `c370bcb9` | Marketplace/provisioning authorization-test corrections | Corrected expectations do not independently earn points. |
| `738f47e6` | Removal of a noncanonical guest-attendance alias | Needs route/consumer reconciliation and the normal score transaction. |
| `9ad163c9` | Administrator user-role expectation correction | Test-only correction; no scored implementation gate closed. |

All eleven contribute **zero banked points** at this snapshot.

### Published But Still Unscored

- `56dc3b3a` commits the two `/api/users/me` envelope-expectation corrections.
  Shard 17 slice 1 had passed 38/38 with those file contents before commit, but
  a later two-class focused rerun was inconclusive: Debug was file-locked and
  Release exceeded its 15-minute wrapper. It adds zero points.
- `df8c8b96` merges the nine schema commits through `97b8a4a0` into published
  `main`. The resulting exact-SHA static inventory is 458 Laravel tables, 440
  ASP.NET tables, 242 exact names, 216 Laravel-only names, and 198 ASP.NET-only
  names; that branch contained 164 migration source files and 162 runtime IDs.
  Per-slice builds, focused 3/3 tests, model-drift checks, blank replays,
  populated upgrades, and constraint/isolation checks are recorded in
  [`SCHEMA_PARITY.md`](../SCHEMA_PARITY.md). The post-merge complete suite/CI
  aggregate was absent at that checkpoint. Later exact-SHA run 29451087913 is
  green at `dbafc5c3`, but no scoring transaction has accepted a category
  movement, so the merge still adds zero banked points.
- `c767050a` advances the current tree to 165 migration classes and 163 runtime
  IDs by adding `20260715184200_AddCompatibilityAuditEntriesTable`. The model
  and snapshot already represented that table; the migration repairs the fresh
  runtime chain. Exact-SHA CI run
  [29441392036](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29441392036)
  passed Build, but its migrated Test job was cancelled at the 75-minute limit
  without a terminal summary; coverage merge failed and Docker publish was
  skipped. It adds zero points. The precise schema verdict and recommission
  package are in [`CURRENT_SCHEMA_READINESS.md`](../CURRENT_SCHEMA_READINESS.md).
- `b3f946b3` installs the required no-coverage, four-shard workflow after the
  user explicitly resumed a bounded commit/push/fix-until-green CI phase.
  Deterministic allocation covers 3,361 logical tests exactly once as
  841 + 840 + 840 + 840. This workflow evidence adds zero points without a
  fixed-rubric scoring transaction.
- `dbafc5c3` gives each wallet-concurrency request a distinct explicit
  idempotency key so the test exercises five independent transfer attempts
  rather than valid replay of one request. Exact-SHA GitHub Actions run
  [29451087913](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29451087913)
  finished terminal green: Build, frozen-React Frontend, all four test shards,
  and Docker Build & Push succeeded. Downloaded TRX artifacts contained 3,385
  runtime rows (841 + 840 + 840 + 864), all passed with 0 failed, skipped,
  error, timeout, or aborted. The 24-row difference from logical allocation is
  shard-4 parameterized-row expansion. Coverage intentionally remains outside
  this required gate. This complete exact-SHA aggregate is published but still
  adds zero banked points pending the required scoring transaction.

### Dirty And In Flight

At the 2026-07-15 documentation transaction, `HEAD` and `origin/main` matched at
`dbafc5c3` and the active worktree was clean. At the 2026-08-09 boundary refresh
above, `HEAD` and `origin/main` match at `e36415c0`, the worktree is clean, and
there is one registered worktree, one local branch, and no stashes. The published Web UK
public-copy/test changes and repository operational guardrails are separately
disclosed and remain unscored. The original shard harness remains committed at
`60715dfd`; `b3f946b3` is its required-CI workflow boundary. This documentation
transaction itself, and any dirty, isolated, or projected work, contributes
zero banked points.

### 2026-07-15 Windows Update Interruption

Windows Update initiated the first planned restart at **02:44:42 Irish time**;
two planned servicing restarts followed, and the final operating-system start
was 02:49:14. Codex task execution did not resume until about 05:20. The exact
event-log sequence, installed updates, and pre-restart boundaries are recorded
in [`RESTART_INCIDENT_2026-07-15.md`](../RESTART_INCIDENT_2026-07-15.md). No
interrupted or recovered work was converted into score movement.

Re-run `git status --short`, compare the published checkpoint with `HEAD`, and
refresh this section before every status report. Do not infer points from file
count, elapsed effort, or an agent's estimate.

