# Current schema readiness

## New-installation scope and implementation assessment — 25 October 2026

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

The first stage must prove blank PostgreSQL replay, reference/default configuration and non-demo first tenant/admin setup. An upgrade path from the first released ASP.NET baseline is included; MySQL-to-PostgreSQL community ETL is excluded. The migration-drift shell script currently labels command failure as model agreement; its output cannot substitute for actual EF discovery/replay.


Last reviewed: 2026-10-25 (two code-led audit passes).

**Development is paused. Audit, verification in isolation and documentation are authorized; implementation, CI reactivation, containers and deployment are not resumed.** Current evidence: [contract status](CURRENT_ASPNET_CONTRACT_STATUS.md).

**No current blank-database or upgrade certification.** Source count, discovered migrations, snapshot consistency, SQL generation and applied-schema behavior are distinct evidence.

| Check | Result | Meaning |
| --- | --- | --- |
| Migration source files excluding designer/snapshot |188| Files counted by existing scripts |
| EF IMigrationsAssembly discovery |186| Actual registered migration IDs in the compiled model |
| Current model versus snapshot |0 operations; pending=false| Snapshot agreement only |
| Idempotent SQL generation |Succeeded offline| No SQL was executed |
| Blank/upgrade replay |Not run| Required before claiming schema readiness |

Undiscovered classes:20260305120000_AddTenantUpdatedAt and20260307181700_FederationCoreExpansion lack the required complete discovery metadata/designer companions. A discovered Phase38to40 migration also creates the federation tables. Do not activate these old classes blindly: replay could duplicate existing operations. Resolve their intended status against a real disposable replay first.

Laravel source comparison reports489migration files,518 table names; ASP.NET extraction reports460table names,258name matches. These are extraction results, not semantic coverage or missing-feature counts.

## Legacy marker semantics

The unchanged score checker counts files on disk despite the runtime wording below.188is retained solely as that file-count contract; it is not the runtime-discovery result. Correcting the checker belongs to resumed implementation/tooling work. The product-SHA marker is historical, not the October test revision.

<!-- doc-consistency: SCHEMA_CURRENT_PRODUCT_SHA=c767050a3eabd064bdf647695b9699b98186342b -->
<!-- doc-consistency: SCHEMA_CURRENT_RUNTIME_MIGRATIONS=188 -->

Earlier dated schema replay records remain in version history and the local pre-reconciliation archive. They were not refreshed by the metadata experiment. Future acceptance includes blank and supported upgrade paths, irreversible steps, model/schema agreement, realistic records, transaction behavior, backup/restore and deliberate startup migration policy. Program.cs currently defaults automatic migration to Development; other non-Testing environments require opt-in or refuse startup when migrations are pending. This is source behavior, not proof of any hosted configuration.
