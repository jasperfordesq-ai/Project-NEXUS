# Unchanged frontend compatibility

## New-installation scope and implementation assessment — 25 October 2026

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.

No frontend implementation budget is included. Incremental React/Web UK work means fixtures, test harnesses and backend response/behavior repairs for their actual consumers, not frontend changes. The insurance conflict requires an explicit backend-policy decision. Four-combination acceptance is still required even if a single client succeeds.


Last reviewed: 2026-10-25 (two code-led audit passes).

**Development is paused. Audit, verification in isolation and documentation are authorized; implementation, CI reactivation, containers and deployment are not resumed.** Current evidence: [contract status](CURRENT_ASPNET_CONTRACT_STATUS.md).

Both frontends must use the same behavior contract without backend-specific page branches. Laravel is the comparison source; conflicts between current clients and Laravel must be recorded explicitly (insurance is already such a conflict).

React blockers: login/refresh, listing cursor/owner/visibility, search flat results, complete comments, event capacity, goals, AI/media, legal/newsletter/admin persistence and complete export/erasure. Group API routes also reproduce ambiguity.

Web UK blockers: support forms, group workshop/preview, saved searches, certificate/device flows, opportunity management grants, shift fields/lifecycle, applicant items/cursor, expense JSON/multipart/ownership/currency, matching shape/dismissal and erasure501. Opportunity grants fail before later shift/applicant defects; fix and test each layer rather than treating the first repaired page as complete.

Generic push delivery/opt-out and realtime events require backend outcomes, not mocked frontend success. Five earlier Web UK suites passed77mocked tests; this is caller evidence only. The second pass did not run a browser or full BFF/backend replay. Source links, acceptance cases and exact coverage are in the current status and detailed audit reports.
