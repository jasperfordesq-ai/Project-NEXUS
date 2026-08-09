# Testing And Evidence

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
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run brand:check
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run api:ledger
npm --prefix apps/web-uk run test:accessibility:isolated
```

The isolated accessibility command uses random loopback listeners and a
GET/HEAD-only mock. The historical `test:accessibility` aggregate and stateful
Laravel smoke scripts are outside the active source-owned goal and must never be
run against the ordinary Laravel environment. Manual accessibility findings
must be recorded separately from automated axe/structure results.

There are no `apps/react-frontend` or `apps/admin` tests to run: both were
deleted on 2026-08-09, and the `scripts/verify-base.ps1` checks that invoked
them were removed at the same time. `apps/web-uk` (jest) is the only remaining
frontend suite in this repository.

## Documentation Gates

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-documentation-consistency.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-markdown-links.ps1
git diff --check
```

These protect structure, links, and selected contradictions. They do not prove
that SHAs, route inventories, credentials, commands, or product prose are
factually current; the review must still compare them with source.

## Current Certification Boundary

Use [the canonical ASP.NET status](../CURRENT_ASPNET_CONTRACT_STATUS.md) and
[the canonical Web UK status](../../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
for the latest banked and published-but-unscored boundaries. Do not quote a test
count from this guide.
