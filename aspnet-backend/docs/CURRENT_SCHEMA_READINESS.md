# Current ASP.NET Schema Readiness

Status: **Canonical current - schema verdict source**

> **Pre-consolidation paths.** Written before the 2026-08-09 move into the
> platform monorepo. Where this document says `apps/web-uk`, `apps/admin`,
> `apps/react-frontend` or `C:\platforms\htdocs\asp.net-backend`, read
> `web-uk/` and `aspnet-backend/` in this repository (the first two `apps/`
> directories were deleted before the move). The paths are left unedited
> because this is a record of what was true at the time.

Last verified: 2026-08-18 (migration count and schema comparison regenerated from
live code; the migration-163 evidence package below is retained as history)

Previous verification: 2026-08-14 (migration-163 evidence package executed on
disposable databases — see the 2026-08-14 recommission evidence section; the
banked schema category remains 129/150 pending a scoring transaction)

Status: **Canonical current - schema pause and restart source; no standalone product score**

<!-- doc-consistency: SCHEMA_CURRENT_PRODUCT_SHA=c767050a3eabd064bdf647695b9699b98186342b -->
<!-- doc-consistency: SCHEMA_CURRENT_RUNTIME_MIGRATIONS=185 -->

Use this page for the one-page schema answer at the 2026-07-15 development
pause. Use [`SCHEMA_PARITY.md`](SCHEMA_PARITY.md) for detailed per-migration
evidence and
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) for the
only banked backend score.

## Verdict At The Pause

**The ASP.NET schema is working and partly proved, but it is not complete or
release-certified.** It is inaccurate to say that all schema work was lost or
that the chain is known not to work. It is equally inaccurate to call it ready
for production or for a backend switch.

The contract-correction work exposed a real fresh-chain hole: the EF model and
snapshot already contained `compatibility_audit_entries`, but the runtime
migration chain did not create it. Published product/schema commit
`c767050a3eabd064bdf647695b9699b98186342b` adds runtime migration
`20260715184200_AddCompatibilityAuditEntriesTable`. That repair is present in
source. Its original exact-SHA CI run reached the 75-minute limit without a
terminal test summary and concluded **cancelled**. The later bounded CI workflow
at `b3f946b3` and test/evidence SHA `dbafc5c3` retain the same schema
implementation and completed the required exact-SHA suite terminal green.

Therefore the honest state is:

- migration-chain repair: **implemented and published**;
- focused earlier schema slices: **strong disposable-database evidence**;
- required exact-SHA full suite and CI at `dbafc5c3`: **terminal green but not
  yet accepted by a fixed-rubric scoring transaction**;
- contract-identical Laravel schema/workflow coverage: **incomplete**;
- production migration or deployed-history proof: **not performed and not
  authorized**.

## Exact Pause Boundary

| Evidence | Pause value | Meaning |
| --- | --- | --- |
| Laravel comparison source | `903d03d3db78bbf87129ad35728be3b72819acaf` | Frozen read-only contract/schema source used by the current inventory. |
| Latest schema expansion branch | `97b8a4a004362aef8356e8d76333f1efc9d44b36` | Nine schema commits later merged into `main` by `df8c8b96`; no longer a separate workstream. |
### 🔴 Live schema comparison, regenerated 2026-08-18

`scripts/compare-laravel-schema-parity.ps1`, run against the current tree:

| Measure | Value |
| --- | ---: |
| Laravel source tables | 472 |
| ASP.NET tables | 460 |
| Matched | 257 |
| Laravel tables with no ASP.NET counterpart | **215** |
| ASP.NET tables with no Laravel counterpart | 203 |
| Laravel migrations | 410 |
| ASP.NET migration classes | 185 |

This is a **name comparison only** and proves nothing about column-level or
behavioural equivalence. It replaces the 2026-08-15 figures (219 missing / 199
extra) and the 2026-08-14 figures (229 / 197). The missing count has moved by only
a handful in a fortnight while Laravel's own table count grew, so the gap is
structural rather than a backlog being worked down.

| Schema implementation boundary | `c767050a3eabd064bdf647695b9699b98186342b` | Adds migration 163 and other contract corrections; published but unscored. |
| Required-CI workflow boundary | `b3f946b3fd3de51fa444008a7daee80d3de1bcd2` | Four deterministic whole-class shards, with coverage intentionally outside the required push gate. |
| Exact test/evidence boundary | `dbafc5c329c55a15b4329ff90804d725dbf8b089` | Required GitHub Actions run 29451087913 is terminal green; no schema implementation changed after `c767050a`. |
| EF migration classes | 185 | Source classes in the current tree, recounted 2026-08-21 (excludes Designer and snapshot files). Latest: `20260821164404_AddExchangeTwoPartyConfirmation` — the exchange two-party confirmation columns, added the same day for ledger row 1.21; the previous tail was `20260821064259_AddVolunteerOpportunityRemoteAndCoordinates`. 🔴 This read 183 with a 2026-08-17 tail until 2026-08-21; `check-doc-scores.mjs` now counts the tree and fails on any drift, so the number cannot go stale silently again. |
| Runtime-discovered migration IDs | 183 | Applicable chain from `InitialCreate` through `AddExchangeTwoPartyConfirmation`. **Measured 2026-08-21** with `dotnet ef migrations list` and a full `dotnet ef database update` against a disposable PostgreSQL 16.4 container on port 15433 (never the local Laravel database, which is a production-derived snapshot): 183 discovered, 183 rows in `__EFMigrationsHistory`, `max(MigrationId) = 20260821164404_AddExchangeTwoPartyConfirmation`, and `has-pending-model-changes` reported "No changes have been made to the model since the last migration." 🔴 This row read **184** until 2026-08-21 — the same number as the class count — which cannot be right when 2 classes are deliberately quarantined. The relationship is `classes − quarantined = runtime IDs` (185 − 2 = 183). The `SCHEMA_CURRENT_RUNTIME_MIGRATIONS` marker above is 185 because `check-doc-scores.mjs` counts FILES ON DISK despite its name; do not "reconcile" the two by editing either to match the other. 🔴 Was 163 on 2026-08-14; twenty-one migrations landed between 2026-08-14 and 2026-08-21 (partner venues, support actions, account relationships, supporter message-view audits, authority attestations, platform capability overrides, revoked tokens, volunteer donation/project fields, skill categories, volunteer opportunity remote/coordinates, exchange two-party confirmation). |
| Intentionally quarantined classes | 2 | `FederationCoreExpansion` is superseded by later DDL; `AddTenantUpdatedAt` would duplicate the initial column. |
| Laravel source table names | 458 | 🔴 **STALE (July).** Live 2026-08-18: **472**. Static source union, not a database dump or completion denominator. |
| ASP.NET represented table names | 440 | 🔴 **STALE (July).** Live 2026-08-18: **460**. Static source union. |
| Exact names | 242/458 (52.8%) | 🔴 **STALE (July).** Live 2026-08-18: **257/472**, with **215** Laravel tables absent. Regenerate with `scripts/compare-laravel-schema-parity.ps1` before quoting. Diagnostic exact-name coverage only. |
| Laravel-only exact names | 216 | 24 classified aliases, 20 compatibility-storage gaps, and 172 unclassified names. |
| ASP.NET-only exact names | 198 | Requires classification; not automatically wrong or useful. |
| Banked backend schema category | see canonical status | 🔴 **Do not quote a score from this file.** The rubric was replaced on 2026-08-21 (`ASPNET-CONTRACT-R5`) with a different denominator, so any figure here would be stale on arrival. The deduction reasons are unchanged: 215 Laravel tables with no ASP.NET counterpart (a gap only where a journey needs one, per ADR-0004), and no populated-history upgrade proof. Current figure: [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md). |

Exact-name coverage does not equal contract identity. A differently named
internal table can be acceptable only when the unchanged clients observe the
same contract and the adapter's constraints, upgrades, tenancy, persistence,
side effects, and failure behavior are proved. An unproved alias or
tenant-config compatibility store remains a gap under
[`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md).

## 2026-08-09 Boundary Refresh

`origin/main` advanced from `896aac94` (`pause/2026-07-15-final`) to
`e36415c02a71a83247168d14f652064a006df6af` through twelve commits dated
2026-08-09 under a bounded security, retirement, and infrastructure
authorization. **Nothing in that range touched the schema.** No file under
`src/`, `tests/`, `migrations/`, or `e2e/` changed:

```powershell
git diff --name-only pause/2026-07-15-final..HEAD -- src tests migrations e2e
```

The command returns nothing at `e36415c0`. Every value in the pause-boundary
table above therefore still holds without re-derivation: schema implementation
boundary `c767050a`, 165 EF migration classes, **163 runtime-discovered
migration IDs**, 2 quarantined classes, the 458/440/242/216/198 static name
inventory, and the banked schema category of **129/150**.

🔴 **That paragraph is the 2026-08-09 position and none of those figures is
current.** As of 2026-08-21 the tree has **185** EF migration classes, the static
name inventory is **472/460/257/215/203**, and the schema category banks
**118/150** under Fixed Rubric Baseline 2. See the live comparison table above.

The verdict is unchanged: the schema is working and partly proved, not complete
or release-certified. The six-item missing-evidence package below is untouched,
and the migration-163 blank and populated-upgrade proofs remain the first task
of any authorized schema session. The full retirement record is the
[2026-08-09 retirement and infrastructure record](PROJECT_PAUSE_HANDOFF_2026-07-15.md#authorized-retirement-and-infrastructure-record--2026-08-09).

One caveat for the recommission sequence: the required CI workflow lost its
frozen-React `Frontend` job when `apps/react-frontend/` was deleted, so a future
run will not have the same job set as run 29451087913. That does not invalidate
the recorded green aggregate for `dbafc5c3`, and it does not affect any schema
gate, but state the difference rather than presenting a new run as an identical
repeat.

## What Is Already Proved

The nine schema commits merged by `df8c8b96` added fifteen exact Laravel table
names. Their retained evidence includes:

- a final-branch blank PostgreSQL 16.4 replay through 162 runtime migrations;
- nine sequential populated upgrades from the 153-ID predecessor through each
  new migration to 162, with representative row-survival and constraint checks;
- 27/27 focused schema tests across the nine slices;
- per-slice Release builds, model-drift gates, tenant/isolation checks, and
  comparator regeneration; and
- disposable container cleanup with no production or Laravel database touched.

Those results remain valuable exact-branch evidence. They do not substitute for
dedicated migration-163 blank/populated-upgrade assertions because migration
163 is outside that earlier package. The later complete green CI aggregate is
recorded separately below.

For the original `c767050a` boundary, GitHub Actions run
[`29441392036`](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29441392036)
reported:

- `Build`: passed;
- frozen legacy React type-check/build: passed, but this is operational CI and
  does not reopen that frontend for development;
- `Test`: cancelled at the 75-minute job limit while the migrated PostgreSQL
  run was still executing; no terminal test summary was produced;
- coverage merge: failed after the cancelled test step; and
- Docker build/publish: skipped.

The test log exercised migration-installed constraints and triggers after
startup, which is evidence that the blank chain progressed beyond migration
application. Without a terminal summary it is not a full-suite pass.

The separately authorized required-CI remediation then published workflow
boundary `b3f946b3` and test/evidence boundary `dbafc5c3`, with no intervening
schema implementation change. GitHub Actions run
[`29451087913`](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29451087913)
finished terminal success:

- `Build`, frozen-React `Frontend`, all four `Test` shards, and `Docker Build &
  Push` succeeded;
- the allocator covered 3,361 logical tests exactly once as
  841 + 840 + 840 + 840;
- downloaded TRX artifacts contained 3,385 executed rows as
  841 + 840 + 840 + 864 because shard 4 expanded parameterized runtime rows;
- all 3,385 rows passed, with 0 failed, skipped, error, timeout, or aborted; and
- coverage remained intentionally outside the required push gate.

This satisfies the complete-suite exact-SHA CI subgate for the named candidate.
It does not prove the dedicated zero-to-163 replay assertions, a populated
162-to-163 upgrade, remaining storage classifications, release safety, or a
production upgrade. Docker image publication was not a production deployment;
no production container or Laravel database was touched.

## 2026-08-14 Recommission Evidence — Migration-163 Package Executed

The owner lifted the development pause on 2026-08-14. The first authorized
schema session then executed the migration-specific package below on two
disposable PostgreSQL 16.4 containers (`postgres:16.4-bookworm`, run-owned
databases `nexus_schema_fresh` and `nexus_schema_upgrade`, created and removed
in the same session; no production, shared, or Laravel database was touched).
Working tree: monorepo `main` immediately after `0d06bd119` (which changed no
entity, configuration, or migration source — `has-pending-model-changes`
confirms below).

1. **Focused source/runtime tests added** —
   `tests/Nexus.Api.Tests/CompatibilityAuditEntrySchemaTests.cs` pins the
   entity-to-table mapping, tenant query filter, PK, max lengths, jsonb column
   types, nullability, all three configured indexes, both FK delete behaviors
   (tenant Restrict, user SetNull), and that `20260715184200_...` is present
   and last in the runtime chain. Green alongside
   `MigrationDiscoveryParityTests` (3/3, Release).
2. **Discovery and model drift on the exact candidate** —
   `dotnet ef migrations list` discovered **163 runtime IDs** ending
   `20260715184200_AddCompatibilityAuditEntriesTable`;
   `has-pending-model-changes` reported **"No changes have been made to the
   model since the last migration."**
3. **Fresh zero-to-163 replay** — `dotnet ef database update` applied all 163
   migrations to the blank database. Assertions: 163 rows in
   `__EFMigrationsHistory` (max = the repair migration), **438 base tables**,
   and `compatibility_audit_entries` present with all ten columns (correct
   types and nullability), PK, indexes on `TenantId`, `(TenantId, Endpoint)`,
   `OccurredAt`, `UserId`, and FKs to `tenants` and `users`.
4. **Populated 162-to-163 upgrade** — the second database was migrated to
   exactly 162 (`compatibility_audit_entries` confirmed absent), seeded with a
   tenant row and a dependent `legal_documents` row, then upgraded through
   migration 163 alone. Assertions: both seeded rows survived byte-identical;
   a valid audit row referencing the surviving tenant was **accepted**; an
   audit row with an unknown tenant was **rejected** by
   `FK_compatibility_audit_entries_tenants_TenantId`; a row with a missing
   `Endpoint` was **rejected** by the NOT NULL constraint; the row count was
   unaffected by the rejected inserts.
5. **Comparator refresh** — the 2026-08-14 full re-audit (see
   `CURRENT_ASPNET_CONTRACT_STATUS.md`) reran the static comparator the same
   day at monorepo HEAD `5afb43ff7`: **229 Laravel-only and 197 ASP.NET-only
   table names** (up from 216/198 at the frozen baseline, reflecting 26 new
   Laravel migrations of post-freeze drift). **Classification of those names by
   contract significance remains open** and is the next schema task.
6. **Scoring** — no fixed-rubric transaction has been run; the schema category
   stays banked at **129/150**. Items 1–4 of the missing-evidence package below
   are now closed; item 5 is refreshed but unclassified; item 6 remains open by
   design until a scoring transaction is recorded.

## What Is Still Missing

Before the schema can be called current-lineage certified, the next schema
session must complete the remaining migration-specific package:

1. add focused source/runtime tests for
   `AddCompatibilityAuditEntriesTable` and its constraints/indexes;
2. rerun migration discovery and `has-pending-model-changes` on the exact
   candidate SHA;
3. migrate a fresh verified disposable PostgreSQL database from zero through
   all 163 IDs and assert the final model-critical objects;
4. migrate a second disposable populated database from migration 162 through
   163 and prove row survival, defaults, indexes, foreign keys, and rejection
   behavior;
5. rerun the static comparator at named Laravel and ASP.NET SHAs and classify
   the 216 missing exact names by contract/workflow significance;
6. perform a fixed-rubric scoring transaction only after the remaining
   migration-specific evidence closes a deduction. The general complete-suite
   exact-SHA CI subgate is already terminal green at `dbafc5c3` and must not be
   misreported as populated-upgrade proof.

Production remains a separate authorization and evidence gate. No pause audit
inspected or changed production schema, and no generic production migration
command is published here.

## Safe Recommission Sequence

Do not start this sequence merely because the repository was opened. First get
explicit user authorization to resume development and read the project pause
handoff. Use an isolated worktree from then-current `origin/main` with exclusive
ownership of schema files.

Establish the exact boundary:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git worktree list --porcelain
git -C C:\platforms\htdocs\staging rev-parse HEAD
```

Set `ConnectionStrings__DefaultConnection` only to a verified fresh,
run-owned PostgreSQL 16.4 database whose name begins `nexus_`. Then run:

```powershell
dotnet tool restore
dotnet build src/Nexus.Api/Nexus.Api.csproj --configuration Release
dotnet ef migrations list --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet ef migrations has-pending-model-changes --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet ef database update --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet test tests/Nexus.Api.Tests/Nexus.Api.Tests.csproj --configuration Release --filter "FullyQualifiedName~MigrationDiscoveryParityTests|FullyQualifiedName~SchemaParityTests"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/compare-laravel-schema-parity.ps1
```

Use a second disposable database for the populated 162-to-163 upgrade. Review
and seed representative rows before applying only the final migration. Record
the exact commands, SHAs, row/constraint assertions, and cleanup result in the
same coherent implementation/evidence transaction.

Never point these commands at a production, shared, Laravel, or
production-derived database. A matching database-name prefix is not proof of
disposability.

## First Schema Tasks In The Next Phase

1. Close and certify the migration-163 evidence package above.
2. Refresh the 216-name classification and prioritize consumer-visible or
   integrity-critical gaps rather than chasing table-count movement.
3. Replace compatibility-storage rows with native durable aggregates where the
   Laravel workflow requires append-only history, relational constraints,
   concurrency, or audit evidence.
4. Pair every schema slice with its API/workflow contract and both unchanged
   frontend consumers; a table alone cannot close contract identity.
5. Keep the bank at 129/150 until the canonical backend status accepts a scored
   exact-SHA transaction.
