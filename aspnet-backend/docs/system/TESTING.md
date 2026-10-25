# Testing And Evidence

## New-installation scope and implementation assessment — 25 October 2026

The pure-comparator probe confirms structure alone misses changed permission, money, state and later-row content. P1 builds deterministic outcome fixtures; P3 orchestrates integrated 4-combination evidence without duplicating package-local test effort. No DB/browser/provider verification was added in this scope pass.


## Audit reconciliation — 25 October 2026

The monorepo includes both react-frontend/ and web-uk/. October verification: isolated .NET Release build (0 errors, 29 warnings), 49 selected API tests, 5 messaging tests, and 77 mocked Web UK tests passed. This is not the full suite or a two-backend runtime replay. Stateful tests still require disposable databases.

Current readiness: [code-led contract audit](../CURRENT_ASPNET_CONTRACT_STATUS.md). Development remains paused; this audit/doc update does not authorize implementation, CI reactivation, container restart or deployment.

## Deeper-pass evidence

The isolated `FullyQualifiedName~UnitTests` selection passed 556, failed 0, skipped 0. It overlaps the earlier 49 API tests; do not sum them. The separate routing harness exercised5803synthetic samples and reproduced33ambiguous matches with no controller execution. The schema harness compared186discovered migrations and model/snapshot metadata and generated SQL without connecting. Neither harness proves authenticated HTTP behavior or migration replay. Current restart acceptance cases are in [ROADMAP](../ROADMAP.md).

## Historical baseline — not revalidated by this audit

Earlier scores, certifications, test totals and readiness statements below retain their original dates. They are not current compatibility evidence; the audit above takes precedence.


Last reviewed: 2026-07-15

Status: **Maintained system reference - test results are SHA-specific**

## Evidence Levels

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Static route/matrix comparison | A method/path can be represented in source. | Payload, authorization, tenant behavior, persistence, side effects, or runtime. |
| Unit/focused test | The named behavior passed under its fixture. | The complete system, another SHA, providers, or production readiness. |
| Build | Source compiles for that configuration. | Workflow correctness or migration safety. |
| Disposable migration replay | The named blank/upgrade path and assertions passed. | Every production history or rollback safety. |
| Full suite | The complete discovered test set passed at one SHA/environment. | Browser/provider/production behavior not included in the suite. |
| Exact-SHA CI and runtime smoke | Published automation and selected runtime paths passed. | Unexercised workflows or future commits. |

Never convert partial or moving-SHA evidence into a complete-suite result.

## Backend Commands

```powershell
dotnet build Nexus.sln --configuration Release
dotnet test Nexus.sln --configuration Release
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-backend-shard.ps1 -ShardIndex 1 -ShardCount 48
```

Read each script's parameters before use. The shard harness is committed, but
separate shards and slices must finish at the same exact SHA before they can be
reported as one aggregate. `scripts/test-backend-full.ps1` is a long-running
complete-suite harness, not a substitute for exact-SHA CI.

The integration fixture creates PostgreSQL 16.4 with Testcontainers by default
and applies the EF migration chain. `NEXUS_TEST_POSTGRES` may point only to an
explicitly disposable database owned by the test run. Its name-prefix guard is
not sufficient proof of disposability; never use a production, shared, Laravel,
or production-derived database even if its name happens to start with `nexus_`.

## Web UK Commands

Safe source-owned gates include:

```powershell
npm --prefix web-uk test -- --runInBand
npm --prefix web-uk run lint
npm --prefix web-uk run brand:check
npm --prefix web-uk run route:matrix
npm --prefix web-uk run api:ledger
npm --prefix web-uk run test:accessibility:isolated
```

The isolated accessibility command uses random loopback listeners and a
GET/HEAD-only mock. The historical `test:accessibility` aggregate and stateful
Laravel smoke scripts are outside the active source-owned goal and must never be
run against the ordinary Laravel environment. Manual accessibility findings
must be recorded separately from automated axe/structure results.

There are no `apps/react-frontend` or `apps/admin` tests to run: both were
deleted on 2026-08-09, and the `scripts/verify-base.ps1` checks that invoked
them were removed at the same time. `web-uk` (jest) is the only remaining
frontend suite in this repository.

## Documentation Gates

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-markdown-links.ps1
git diff --check
```

`check-documentation-consistency.ps1` was deleted on 2026-08-10 — it asserted
the pre-consolidation directory layout and could not pass. The link check above
runs in CI for both siblings.

These protect structure, links, and selected contradictions. They do not prove
that SHAs, route inventories, credentials, commands, or product prose are
factually current; the review must still compare them with source.

## Current Certification Boundary

Use [the canonical ASP.NET status](../CURRENT_ASPNET_CONTRACT_STATUS.md) and
[the canonical Web UK status](../../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
for the latest banked and published-but-unscored boundaries. Do not quote a test
count from this guide.
