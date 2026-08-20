# Project NEXUS .NET Documentation

Last reviewed: 2026-08-20

Status: **Maintained reference - documentation index**

This directory contains the maintained documentation for the Project NEXUS .NET
Edition. The canonical Laravel source for parity is
`C:\platforms\htdocs\staging`, which must remain read-only from this repo.
The product target is two unchanged frontends by two backends: canonical React
and shared accessible Web UK must each run against Laravel and ASP.NET by
configuration only, with Laravel defining the contract ASP.NET must satisfy.

## Read first

| Document | Purpose |
| --- | --- |
| [CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md) | **The one "start here".** Canonical current: banked score, published-but-unscored movement, evidence pointers, open gates, the live queue, and the reporting rules. |
| [ROADMAP.md](ROADMAP.md) | Canonical current, owner-facing: what works, what doesn't, what's next — in plain English, no points. |

## Maintained references

| Document | Purpose |
| --- | --- |
| [FULL_PARITY_REMEDIATION_RUNBOOK.md](FULL_PARITY_REMEDIATION_RUNBOOK.md) | Fixed cross-workstream rubric, baseline rules, shared evidence gates. It owns the rubric; the status doc owns the score and queue. |
| [PRODUCTION_READINESS_REMEDIATION.md](PRODUCTION_READINESS_REMEDIATION.md) | The verified-defect backlog between this backend and running a real community, ordered P0–P3 with `file:line` evidence. |
| [CONTRACT_PARITY_PLAN.md](CONTRACT_PARITY_PLAN.md) | The parity working plan organised by aspect of the contract (envelopes, status codes, error shapes, the do-nothing endpoints — 319 live, see the status doc — tables, pagination, localization, uploads/realtime). |
| [DATABASE_BACKUP_DECISION.md](DATABASE_BACKUP_DECISION.md) | The ASP.NET database backup position — read before repeating the "no backup since 2026-03-08" line. |
| [CURRENT_SCHEMA_READINESS.md](CURRENT_SCHEMA_READINESS.md) | One-page schema verdict: 183-migration runtime boundary, proved vs unproved migration evidence, remaining gates. |
| [BACKEND_LOCALIZATION_CONTRACT.md](BACKEND_LOCALIZATION_CONTRACT.md) | The real backend localization ledger: request/recipient locale behavior, committed evidence, certification gaps. |
| [DOCUMENTATION_GOVERNANCE.md](DOCUMENTATION_GOVERNANCE.md) | Canonical document hierarchy, scoring/reporting rules, history labels, the update transaction. |
| [decisions/README.md](decisions/README.md) | Accepted ADRs. ADR-0001 defines contract identity; ADR-0002 keeps Laravel authoritative and gates any ASP.NET production role. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime boundaries, application surfaces, invariants. |
| [MODULES.md](MODULES.md) | Module-by-module Laravel source paths and .NET targets. |
| [LARAVEL_PARITY_MAP.md](LARAVEL_PARITY_MAP.md) | Parity gap register and backlog. |
| [API_PARITY.md](API_PARITY.md) | API contract inventory and comparison policy. |
| [SCHEMA_PARITY.md](SCHEMA_PARITY.md) | Database table/entity/migration parity inventory and generated-report policy. |
| [FRONTEND_PARITY.md](FRONTEND_PARITY.md) | Frontend route parity inventory and generated-report policy. |
| [REACT_FRONTEND_RETIREMENT.md](REACT_FRONTEND_RETIREMENT.md) | Retirement policy for the old ASP.NET React fork; contract-identity rules for the canonical React frontend. |
| [ACCESSIBLE_SHARED_FRONTEND.md](ACCESSIBLE_SHARED_FRONTEND.md) | Architecture and guardrails for the shared Web UK implementation. |
| [../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md](../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md) | **The current Web UK score and queue** (`WEBUK-W2-PROD-R1`). The older Laravel-first status doc is retired; see Historical below. |
| [database-migrations.md](database-migrations.md) | EF Core migration workflow and drift prevention. |
| [REGISTRATION_POLICY_ENGINE.md](REGISTRATION_POLICY_ENGINE.md) | Registration and identity-verification architecture. |
| [generated/canonical-react-contracts/README.md](generated/canonical-react-contracts/README.md) | Exact-SHA React call-site matrix; static evidence only, never a parity score. |
| [DOCUMENTATION_HEALTH_REPORT.md](DOCUMENTATION_HEALTH_REPORT.md) | The documentation-health audit record; separate from product completion. |

## Audience guides

| Document | Purpose |
| --- | --- |
| [user/README.md](user/README.md) | Member/end-user guidance. |
| [admin/README.md](admin/README.md) | Tenant administrator guidance. |
| [api/README.md](api/README.md) | API consumer guide. |
| [system/README.md](system/README.md) | Developer/operator hub (local setup, testing, security, operations, incidents). |
| [../../SUPPORT.md](../../SUPPORT.md) | Product-support and defect reporting. |
| [../../SECURITY.md](../../SECURITY.md) | Private vulnerability reporting. |
| [../../CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) | Contributor conduct policy. |
| [../../CHANGELOG.md](../../CHANGELOG.md) | Project changelog; never a competing score or queue. |

## Historical checkpoints (do not use for current status)

| Document | What it was |
| --- | --- |
| [HISTORY/STATUS_ARCHIVE_2026-07.md](HISTORY/STATUS_ARCHIVE_2026-07.md) | Baseline 1 era: the 712/1000 scored position, banked-evidence log, repository state. |
| [HISTORY/STATUS_ARCHIVE_2026-08.md](HISTORY/STATUS_ARCHIVE_2026-08.md) | Baseline 2 (598/1000) with full evidence, the August audits, and the dated 08-19/08-20 work entries. |
| [PROJECT_PAUSE_HANDOFF_2026-07-15.md](PROJECT_PAUSE_HANDOFF_2026-07-15.md) | The 15 July pause boundary and cold-start order. The pause was **lifted 2026-08-14**. |
| [RESTART_INCIDENT_2026-07-15.md](RESTART_INCIDENT_2026-07-15.md) | The Windows Update restart incident record. |
| [CURRENT_LARAVEL_PARITY_HANDOFF.md](CURRENT_LARAVEL_PARITY_HANDOFF.md) | Chronological backend implementation history; its "latest" checkpoints are dated evidence only. |
| [PARITY_BACKLOG.md](PARITY_BACKLOG.md) | A generated backlog rollup frozen at 2026-07-13; regenerate before use. |
| [LOCALIZATION_PARITY.md](LOCALIZATION_PARITY.md) | The frozen-React catalog comparator; superseded by BACKEND_LOCALIZATION_CONTRACT.md. |
| [../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md) | **Retired** Web UK status (its 663/1000 is not current); replaced by CURRENT_WEBUK_PRODUCTION_STATUS.md. |
| [../../web-uk/docs/CURRENT_WEB_UK_HANDOFF.md](../../web-uk/docs/CURRENT_WEB_UK_HANDOFF.md) | Chronological Web UK history; superseded. |

## Documentation Rules

- Do not claim 100% parity until the parity map shows no open gaps and
  verification passes.
- Keep the two workstream status documents as the only current score sources:
  `CURRENT_ASPNET_CONTRACT_STATUS.md` for ASP.NET and
  `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` for Web UK. Treat scores
  and counts in handoff histories as dated evidence only.
- Do not copy generated counts (stubs, routes, tables) into this index or any
  second document — link to the one canonical source instead.
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
- Treat `web-uk/` (repo root) as the shared accessible frontend implementation
  target; its repository location does not make ASP.NET authoritative.
- Do not modify ASP.NET backend code, migrations, schema, fixtures, or runtime
  data from the Web UK workstream.
- Treat the Laravel repository, schema, and ordinary local database as read-only
  from Web UK work. Mutation, upload, download, and destructive certification
  require a separately provisioned, verified disposable Laravel environment.
  The ordinary production-derived local database is never a test fixture; no
  cleanup plan creates an exception.
- Do not point production utility-bar traffic at `web-uk/` until accessible
  route/workflow/tenant/auth/accessibility certification passes.
