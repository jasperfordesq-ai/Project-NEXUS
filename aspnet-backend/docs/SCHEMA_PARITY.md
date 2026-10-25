# Schema comparison boundaries

## New-installation scope and implementation assessment — 25 October 2026

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

New-install domain schema changes remain in their feature packages even though existing-community data conversion is excluded. B6 owns migration chain/bootstrap; P1 owns deterministic shared logical fixtures.


Last reviewed: 2026-10-25 (two code-led audit passes).

**Development is paused. Audit, verification in isolation and documentation are authorized; implementation, CI reactivation, containers and deployment are not resumed.** Current evidence: [contract status](CURRENT_ASPNET_CONTRACT_STATUS.md).

Use [current schema readiness](CURRENT_SCHEMA_READINESS.md) for measured discovery and replay status. The current model matches its snapshot and can generate SQL, but no database migration was executed. Source names and model snapshots cannot establish Laravel data/behavior equivalence.

The 188 source-file versus 186 EF-discovery discrepancy is now explicit. Expense ownership/currency and account-erasure lifecycle findings also require data-semantic tests beyond table existence. Future verification must exercise current entities and supported upgrade history with both-backend synthetic fixtures; do not infer completeness from matching 258 table names.
