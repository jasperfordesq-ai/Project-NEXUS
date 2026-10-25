# ASP.NET next-session brief

**Estimate clarification (25 October):** The roughly 950 engineer-day total is an uncalibrated sum of broad human-effort allowances, not a reliable delivery forecast and not a measured AI-assisted estimate. Do not convert it into a promised calendar duration. Retain the work inventory; establish an AI-assisted forecast only after representative implementation and runtime verification are measured following explicit resumption.

Last reviewed:2026-10-25. The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

Read [current findings](CURRENT_ASPNET_CONTRACT_STATUS.md), [costed roadmap](ROADMAP.md), [schema readiness](CURRENT_SCHEMA_READINESS.md) and [pause decision](decisions/ADR-0005-aspnet-edition-halted.md). The historical journey score is not current certification.

## Brief for the next session

Confirm actual monorepo path, HEAD and dirty files. Preserve other work. If the owner has not explicitly resumed implementation, continue audit/readiness only. The goal is two independent backend editions for new installations, both supporting the same unchanged React and Web UK applications through configuration only. Do not invent a frontend workaround, shared database, community-data migration or mobile workstream.

Load the 53-package ledger and tasks from the ignored scope-pass archive. Use tasks/start-stage.md for the first 15–25 engineer-day calibration tranche, already within the existing estimate. Record source, fixture, role, feature and provider settings before interpreting a test. A generated route inventory or shape MATCH is not a working outcome.

After explicit resumption, choose a named vertical slice, capture its paired failure, repair its owning backend/service and prove meaningful values, independent stored reads and eventual effects using disposable synthetic data. The same actor/feature fixtures and unchanged consumers must work against both backends. Do not count a queued notification as delivery, a recorded request as a refund, a blank list as useful coverage or all500s as concurrency success.

The 950-day rounded planning allowance is deliberately not a calibrated delivery forecast. Re-estimate after initial runtime and measured repair evidence. Resolve the insurance conflict without silently changing frontend source; decide optional-feature/provider acceptance explicitly. Update the current docs/package ledger together and preserve original dates on historical evidence. No automatic CI reactivation, container operation or deployment follows from this planning brief.

Detailed source-backed scope, ownership, acceptance, dependency graph, scenario arithmetic and unstarted tasks are retained in `.local-docs-archive/aspnet-audit/2026-10-25/scope-pass/`. The package ledger is `IMPLEMENTATION-WORK-PACKAGES.json`/`.csv`; `tasks/start-stage.md` is the concrete first-stage checklist. These ignored artifacts are local and are not present in a fresh clone. This maintained document carries the public-safe scope and readiness summary.
