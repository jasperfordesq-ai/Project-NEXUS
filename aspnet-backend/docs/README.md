# Project NEXUS .NET Documentation

Last reviewed: 2026-07-15

This directory contains the maintained documentation for the Project NEXUS .NET
Edition. The canonical Laravel source for parity is
`C:\platforms\htdocs\staging`, which must remain read-only from this repo.
The product target is two unchanged frontends by two backends: canonical React
and shared accessible Web UK must each run against Laravel and ASP.NET by
configuration only, with Laravel defining the contract ASP.NET must satisfy.

## Start Here

| Document | Purpose |
| --- | --- |
| [PROJECT_PAUSE_HANDOFF_2026-07-15.md](PROJECT_PAUSE_HANDOFF_2026-07-15.md) | **Read first while paused.** Canonical 15 July 2026 product/schema boundary, mandatory cold-start order, workstream blueprint, copy-ready prompts, and repository-freeze record. It does not authorize resumption. |
| [user/README.md](user/README.md) | Member/end-user guidance for sign-in, community features, account safety, accessibility, language, and support. |
| [admin/README.md](admin/README.md) | Tenant/community administrator responsibilities and safe workflow boundaries. |
| [api/README.md](api/README.md) | API consumer guide for auth, tenancy, exact endpoint shapes, retries, uploads, and side effects. |
| [system/README.md](system/README.md) | Developer/operator hub for local setup, configuration, testing, security, operations, and incident response. |
| [../SUPPORT.md](../../SUPPORT.md) | Product-support and software-defect reporting. |
| [../SECURITY.md](../../SECURITY.md) | Private vulnerability reporting and safe-testing policy. |
| [../CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) | Contributor participation, safety, conduct-reporting, and enforcement policy. |
| [../CHANGELOG.md](../../CHANGELOG.md) | Curated project-direction and pause-history index; never a competing score or queue. |
| [FULL_PARITY_REMEDIATION_RUNBOOK.md](FULL_PARITY_REMEDIATION_RUNBOOK.md) | Fixed cross-workstream rubric, two-frontends-by-two-backends completion gate, shared evidence rules, and autonomous execution loop. Each canonical status document owns its live queue. |
| [PRODUCTION_READINESS_REMEDIATION.md](PRODUCTION_READINESS_REMEDIATION.md) | 🔴 **The actionable backlog. Read this first when resuming backend work.** Every verified defect between this backend and running a real community, ordered P0–P3 with `file:line` evidence, what is already fixed, what was checked and cleared, and what only the owner can close. |
| [CONTRACT_PARITY_PLAN.md](CONTRACT_PARITY_PLAN.md) | 🔴 **The parity working plan, organised by aspect of the contract rather than by route.** Authorisation boundaries, envelopes, status codes, error shapes, the 229 do-nothing endpoints, tables, the never-measured second frontend, pagination, localization, uploads/realtime. Includes the order of work and what "done" means. |
| [DATABASE_BACKUP_DECISION.md](DATABASE_BACKUP_DECISION.md) | What the ASP.NET database backup position actually is, correcting the "no backup since 2026-03-08" claim. Out of scope while this backend is development-only, but read it before repeating that line. |
| [CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md) | Current ASP.NET fixed-rubric score, evidence boundary, published-but-unscored work, blockers, and next queue. Start here for backend status or resumption. |
| [CURRENT_SCHEMA_READINESS.md](CURRENT_SCHEMA_READINESS.md) | One-page schema verdict: 183-migration runtime boundary (2026-08-18; 163 at the pause), proved versus unproved migration evidence, green general exact-SHA CI, remaining migration/release gates, and safe recommission sequence. |
| [BACKEND_LOCALIZATION_CONTRACT.md](BACKEND_LOCALIZATION_CONTRACT.md) | Maintained ASP.NET backend localization contract: fixed Laravel/ASP.NET SHAs, request and recipient locale behavior, committed evidence, dirty-worktree boundary, and certification gaps. |
| [DOCUMENTATION_GOVERNANCE.md](DOCUMENTATION_GOVERNANCE.md) | Canonical document hierarchy, fixed scoring/reporting rules, history labels, safety requirements, and documentation-health gate. |
| [decisions/README.md](decisions/README.md) | Accepted architecture decisions. ADR-0001 defines contract identity; ADR-0002 keeps Laravel authoritative and defines ASP.NET's optional role and production decision gate. |
| [DOCUMENTATION_HEALTH_REPORT.md](DOCUMENTATION_HEALTH_REPORT.md) | Baseline D3 and current D3-R1 1000-point documentation/pause-readiness audit, iterative score record, Git-freeze evidence, and reproducible checks; explicitly separate from product completion. |
| [RESTART_INCIDENT_2026-07-15.md](RESTART_INCIDENT_2026-07-15.md) | Exact Irish-time Windows Update restart sequence, pre-restart task boundaries, recovery distinction, and zero-point interrupted-work rule. |
| [CURRENT_LARAVEL_PARITY_HANDOFF.md](CURRENT_LARAVEL_PARITY_HANDOFF.md) | Chronological backend implementation history and older commands. Its former scores and “latest” checkpoints are historical; do not use it for current status. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime boundaries, application surfaces, and invariants for the .NET edition. |
| [MODULES.md](MODULES.md) | Module-by-module Laravel source paths, .NET target paths, and parity status. |
| [LARAVEL_PARITY_MAP.md](LARAVEL_PARITY_MAP.md) | Canonical parity gap register and implementation backlog. |
| [PARITY_BACKLOG.md](PARITY_BACKLOG.md) | Generated backlog rollup, priority semantics, and implementation consumption rules. |
| [API_PARITY.md](API_PARITY.md) | API contract inventory and comparison policy. |
| [REACT_FRONTEND_RETIREMENT.md](REACT_FRONTEND_RETIREMENT.md) | Retirement policy for the old ASP.NET React fork and contract-identity rules for the Laravel React frontend. |
| [ACCESSIBLE_SHARED_FRONTEND.md](ACCESSIBLE_SHARED_FRONTEND.md) | Current architecture, two Laravel sources of truth, repository/data boundaries, GOV.UK upstream references, and guardrails for the shared Web UK implementation. |
| [../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md) | Current Laravel-first status, cross-session ownership boundaries, blockers, and ordered completion queue. Read this before older Web UK handoffs. |
| [../../web-uk/docs/CURRENT_WEB_UK_HANDOFF.md](../../web-uk/docs/CURRENT_WEB_UK_HANDOFF.md) | Chronological Web UK implementation history and detailed legacy commands. Its old counts and scores are superseded by the Laravel-first status document above. |
| [SCHEMA_PARITY.md](SCHEMA_PARITY.md) | Database table/entity/migration parity inventory and generated report policy. |
| [FRONTEND_PARITY.md](FRONTEND_PARITY.md) | React and accessible frontend route parity inventory and generated report policy. |
| [generated/canonical-react-contracts/README.md](generated/canonical-react-contracts/README.md) | Exact-SHA canonical React API call-site matrix against Laravel and ASP.NET route/method ownership; static evidence only, not a parity score. |
| [LOCALIZATION_PARITY.md](LOCALIZATION_PARITY.md) | Historical frozen-React catalog comparator. It is not the current backend localization ledger or a Web UK status source. |
| [database-migrations.md](database-migrations.md) | EF Core migration workflow and drift prevention. |
| [REGISTRATION_POLICY_ENGINE.md](REGISTRATION_POLICY_ENGINE.md) | Registration and identity-verification architecture. |

## Documentation Rules

- Do not claim 100% parity until the parity map shows no open gaps and
  verification passes.
- Keep the two workstream status documents as the only current score sources:
  `CURRENT_ASPNET_CONTRACT_STATUS.md` for ASP.NET and
  `web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for Web UK. Treat
  scores and counts in handoff histories as dated evidence only.
- Keep Laravel references source-backed and path-specific.
- Keep generated one-off reports out of committed docs unless curated into a
  maintained map.
- Preserve production warnings from `CLAUDE.md` and
  `.claude/production-containers.md`.
- `apps/react-frontend/` was deleted on 2026-08-09. Do not recreate it.
- Treat `C:\platforms\htdocs\staging\react-frontend` as the canonical React
  frontend contract target for ASP.NET contract identity.
- Do not modify frontend files unless the user explicitly approves that specific
  frontend change.
- Treat `web-uk/` as the shared accessible frontend implementation target;
  its repository location does not make ASP.NET authoritative.
- Treat Laravel Blade as the product/UI source of truth and the Laravel
  backend/API as the backend-contract source of truth for `web-uk/`.
- Do not modify ASP.NET backend code, migrations, schema, fixtures, or runtime
  data from the Web UK workstream.
- Treat the Laravel repository, schema, and ordinary local database as read-only
  from Web UK work. Mutation, upload, download, and destructive certification
  require a separately provisioned, verified disposable Laravel environment.
  The ordinary production-derived local database is never a test fixture; no
  cleanup plan creates an exception.
- Do not point production utility-bar traffic at `web-uk/` until accessible
  route/workflow/tenant/auth/accessibility certification passes.
