# ASP.NET documentation governance

Last reviewed:2026-10-25. The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

| Subject | Current authority |
| --- | --- |
| Owner scope, effort and sequencing | [ROADMAP.md](ROADMAP.md) plus the local 53-package ledger |
| Current findings and evidence limits | [CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md) |
| Pause and explicit audit exception | [ADR0005](decisions/ADR-0005-aspnet-edition-halted.md) |
| Independent editions / unchanged clients | [ARCHITECTURE.md](ARCHITECTURE.md), [FRONTEND_PARITY.md](FRONTEND_PARITY.md) |
| Next session | [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md) and local tasks/start-stage.md |
| Migration discovery versus replay | [CURRENT_SCHEMA_READINESS.md](CURRENT_SCHEMA_READINESS.md) |
| Review coverage | [MODULES.md](MODULES.md) |
| Historical certification | [JOURNEY_CERTIFICATION_LEDGER.md](JOURNEY_CERTIFICATION_LEDGER.md), explicitly dated historical score sections |

Source and actual caller behavior are evidence; these documents index findings and decisions. Never turn a source observation into a claimed browser/database/provider pass, or a local test into CI/deployed/accepted status. Existing marker tools check historical arithmetic and migration filenames; their success is not current compatibility or runtime-migration proof.

The owner-requested work breakdown is a separate planning artifact, not a new journey-completion denominator. It contains52budget packages, not52passed journeys. Its low/planning/high values are capacity allowances and must not be labelled a calibrated likely forecast. Update scope, ownership, scenarios, task dependencies and affected public summaries atomically when new evidence changes the estimate. Preserve the old baseline in local/version history rather than laundering its date.

Keep detailed source dumps, generated inventories, effort worksheets and task plans in the ignored audit archive. Maintain small public-safe summaries and working links here. Existing user/admin/operator guidance may describe the target product; current ASP.NET readiness must always defer to the status record. Do not promise success-shaped stubs to users.

Detailed source-backed scope, ownership, acceptance, dependency graph, scenario arithmetic and unstarted tasks are retained in `.local-docs-archive/aspnet-audit/2026-10-25/scope-pass/`. The package ledger is `IMPLEMENTATION-WORK-PACKAGES.json`/`.csv`; `tasks/start-stage.md` is the concrete first-stage checklist. These ignored artifacts are local and are not present in a fresh clone. This maintained document carries the public-safe scope and readiness summary.
