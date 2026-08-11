# Agent Instructions For web-uk

The repository-wide instructions in [`../AGENTS.md`](../AGENTS.md) apply here.

🔴 **PAUSE LIFTED for `web-uk` on 2026-08-11; the ASP.NET fence STAYS.** This file
used to require a fresh explicit instruction before any `web-uk` edit. The owner
decided on 2026-08-11 that `web-uk` becomes the production accessible frontend and
Blade retires, so that requirement is lifted **for `web-uk/**` only**. Still
fenced: the ASP.NET backend and its **database boundary** (no successful backup
since 2026-03-08 while it migrates on every start), the read-only Laravel data
boundary below, and **any deployment without explicit authorisation**.

Read [`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md)
first. It is the **only** place the current phase of the changeover is stated;
do not restate it here.

Urgent first-read rules:

- `web-uk` **is the accessible frontend the platform is moving to.** It is not
  deployed yet, and the deployment path is not built. 🔴 This line previously said
  it was "not yet the production accessible frontend" and must not replace Blade —
  superseded, and flagged rather than deleted because an agent reading the old
  wording refuses the work.
- **Phase A (now, Blade still deployed):** the Laravel Blade accessible frontend
  remains the **observable-behaviour specification** for browser routes, links,
  layout, navigation, content hierarchy, forms, validation presentation,
  redirects, tenant behaviour and workflows — `accessible-frontend/` at the
  repository root — and the generated route matrix is a live drift alarm.
  **Phase B (Blade decommissioned):** `web-uk` owns browser behaviour.
- **In both phases**, the Laravel backend/API is the contract source of truth for
  methods, paths, payloads, envelopes, status codes, auth, roles, modules,
  uploads, downloads, and side effects.
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

- `../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` (**read first**: decision, phase, URL
  shapes, open owner prerequisites)
- `docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` (**the only current score**, rubric
  `WEBUK-W2-PROD-R1`)
- `docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` (🔴 **RETIRED 2026-08-11** — the W1
  audit trail; its `663/1000` is not current)
- `../aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md` (a **different**
  rubric for the paused ASP.NET backend; never added to a `web-uk` score)
- `../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md` (original pause
  record; the `web-uk` half is lifted, the ASP.NET half is not)
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
