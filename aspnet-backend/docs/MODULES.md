# ASP.NET module review coverage

## New-installation scope and implementation assessment — 25 October 2026

The current review coverage below now maps to52owned implementation/verification packages in [ROADMAP.md](ROADMAP.md). A package marked real/unknown has a verification-and-repair allowance, not a confirmed defect count. Roles, pilot workflow and financial-report defects were added; volunteering scope now includes qualifications, fundraising, wellbeing, roster, cases, training and remaining care interfaces. No required module is silently dropped for lack of runtime proof.

The owner clarified that **new installations must work on either backend with both web frontends unchanged**. Laravel remains supported. Existing-community data transfer, a shared live database and simultaneous cross-engine synchronization are not part of this stage. Fresh database, first tenant/admin, configuration, workers, media, install/recovery and all required current client workflows are included. Audit and planning are authorized; implementation remains paused.


Last reviewed: 2026-10-25 (two code-led audit passes).

**Development is paused. Audit, verification in isolation and documentation are authorized; implementation, CI reactivation, containers and deployment are not resumed.** Current evidence: [contract status](CURRENT_ASPNET_CONTRACT_STATUS.md).

| Module or boundary | Evidence reached | Current disposition |
| --- | --- | --- |
| Routing/session | MVC matching experiment plus caller/controller traces | Blocked: ambiguity, goal aliases, binding/cookie refresh |
| Listings/profile/search/comments | Current frontend/service/Laravel traces | Blocked: owner/visibility/cursor, search shape and thread completeness |
| Events/groups | RSVP and membership traces; group routing; delivery callers | RSVP capacity and group routes blocked; join-state and event-cursor code are positive controls, not certification |
| Wallet/group exchanges/refunds | Calculation probe, ledger/effect/dispatcher traces | Wrong workshop/team rules and missing/refund effects; concurrency/recovery untested |
| Volunteering/organisations | Grants, shift/applicant/expense wrappers and handlers | Blocked: grants, schema/fields, pagination, lifecycle and expense review |
| Matching | Both API meanings and Web UK normalization | Blocked: envelope/source-row shape and dismissal identity |
| Account erasure/preferences/push | Both client erasure paths, queue caller search, preference storage/delivery | Incomplete React erasure, explicit Web UK501, missing independent drain/opt-out |
| Admin/legal/newsletters/FAQ | Current React caller and controller/service traces | False-success writes; no admin-wide completion claim |
| Media/AI/export/realtime | Request bytes/shapes and return/delivery traces | Audio persistence, chat shapes, export completeness and message events blocked |
| Schema | EF discovery, snapshot diff and offline SQL generation |186 discoverable vs188source files; replay/upgrade/data semantics unproven |
| Localization, SSO/billing, external federation, other admin/module branches | Structural inventory and named source observations only | Not certified; remaining detailed review/runtime coverage must be planned explicitly |

No row means every line or branch was audited. Positive controls are documented to avoid treating real implementations as stubs. Mobile, hosted behavior, provider deliveries, backup/restore and independent acceptance remain outside the two-web-client evidence. Detailed findings and proposed acceptance cases are in the current status and local audit reports.
