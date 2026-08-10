# Agent Instructions For web-uk

The repository-wide instructions in [`../AGENTS.md`](../AGENTS.md) apply here.

Development paused on **15 July 2026**. Read the root
[`PROJECT_PAUSE_HANDOFF_2026-07-15.md`](../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md)
before this file and obtain a new explicit user instruction before resuming
Web UK work. The historical execution loop is not standing authorization.

Urgent first-read rules:

- `web-uk` is the implementation target for the future shared accessible
  frontend. It is not yet the production accessible frontend.
- The Laravel Blade accessible frontend is the product/UI source of truth for
  browser routes, links, layout, navigation, content hierarchy, forms,
  validation presentation, redirects, tenant behaviour, and workflows:
  `accessible-frontend/` at the repository root.
- The Laravel backend/API is the contract source of truth for methods, paths,
  payloads, envelopes, status codes, auth, roles, modules, uploads, downloads,
  and side effects.
- The ASP.NET backend is not a source of truth for this frontend and is not
  owned by this workstream. Another workstream must make it externally
  contract-identical
  with Laravel before it can be used as a second backend.
- Implement one backend-neutral Express/Nunjucks frontend. Do not add
  ASP.NET-specific page, template, route, validation, or workflow branches.
- The Laravel source at the repository root and its ordinary local database are read-only
  from this workstream. Never edit Laravel source, run Laravel migrations,
  alter its schema, query its database directly, or perform database cleanup.
  The database is a confidential production-derived snapshot, not a fixture.
  Never run live login, mutation, upload, download, destructive, or cleanup
  tests against any Laravel environment as part of the Web UK completion goal.
  Implement those browser workflows from the read-only Laravel source contract
  and verify them with mocks, static analysis, and Web UK-owned fixtures. Live
  Laravel runtime certification is a separate optional workstream that requires
  fresh explicit user authorization; it is not a Web UK blocker or completion
  requirement.
- Work only under `web-uk/**` and approved documentation pointers. Do not
  modify `aspnet-backend/src/Nexus.Api/**`,
  `aspnet-backend/tests/Nexus.Api.Tests/**`, ASP.NET migrations, or the
  canonical `react-frontend/` as part of Web UK-only work.
- Do not claim production readiness or shared-frontend readiness from skeleton
  work.
- Use GOV.UK Frontend and GOV.UK Design System patterns, but do not use GOV.UK
  crown, logotype, `govukHeader`, `govukFooter`, Open Government Licence blocks,
  Crown copyright wording, or any copy implying this is a government service.
- Keep the app HTML-first and progressively enhanced. No React, Vue, Next.js, or
  client-side routing.
- Run brand checks and focused tests after shell/layout changes.

Maintained docs that future agents must keep current:

- `../../docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md` (cold-start entry point while paused)
- `docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` (read first)
- `../../docs/CURRENT_ASPNET_CONTRACT_STATUS.md` (separate backend-owned score
  and later switching gate; not an input to Laravel-first frontend design)
- `docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- `docs/BLADE_COMPONENT_PORT_AUDIT.md`
- `docs/TENANT_ROUTING_PARITY.md`
- `docs/BACKEND_SWITCHING_CONTRACT.md`

Generated route-matrix artifacts live under `docs/generated/` and are refreshed
with `npm run route:matrix`. Treat generated counts as backlog evidence only,
not as workflow/API/tenant/auth certification. Keep source-derived Web UK
implementation, safe-fixture manual accessibility, optional live Laravel
runtime certification, and future ASP.NET switchability as four separate
evidence tracks.
