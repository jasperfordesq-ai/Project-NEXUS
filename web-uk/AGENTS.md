# Agent Instructions For web-uk

The repository-wide instructions in [`../AGENTS.md`](../AGENTS.md) apply here.

> ## 🔴 READ THIS FIRST — corrected 2026-08-17: `web-uk` IS THE ONLY ACCESSIBLE FRONTEND, AND IT IS LIVE
>
> The sibling file [`CLAUDE.md`](CLAUDE.md) got this correction on 2026-08-14 and
> this file was missed, so parts of the text below were left describing a world
> that no longer exists. Three claims are now FALSE, and they are the ones an
> agent acts on first:
>
> 1. **"It is not deployed yet, and the deployment path is not built."** Both
>    halves are wrong. `web-uk` has served `accessible.project-nexus.ie` since
>    2026-08-12 and both community accessible domains since 2026-08-14. All three
>    accessible addresses answer with `{"service":"nexus-webuk"}` at `/version`.
>    The standing rule that **no agent starts a deployment unless the owner
>    explicitly says so** is unchanged and still absolute — that is a permission
>    rule, not a claim that the path is missing.
> 2. **"Phase A — Blade is still deployed" / "`accessible-frontend/` is the
>    observable-behaviour specification."** The Laravel Blade accessible frontend
>    was DELETED on 2026-08-14. `accessible-frontend/`,
>    `app/Http/Controllers/GovukAlpha/`, `routes/govuk-alpha.php` and
>    `routes/govuk-alpha-parity/` do not exist. Do not go looking for them, and do
>    not treat their absence as damage. There are no longer two phases to be in.
> 3. **"The generated route matrix is a live drift alarm."** It compares against a
>    deliberately frozen snapshot (`scripts/blade-route-inventory.frozen.json`,
>    707 routes), so it is coverage and regression evidence for `web-uk` — not an
>    alarm about a Blade app that is gone. Keep that snapshot; it is the only
>    remaining record of the routes Blade served.
>
> **`lang/*/govuk_alpha*.php` is ALIVE and must be kept.** It is the source
> `web-uk`'s eleven translation catalogues are generated from. Deleting it strips
> the live accessible frontend's translations in every language.
>
> **The authority order is now:** GOV.UK Design System + WCAG 2.2 for
> presentation; `react-frontend/` for what a member can do; the Laravel API for
> the contract. Blade is historic and gone, and is not the specification.
>
> 🔴 **Corrected 2026-08-21: ASP.NET is NOT paused** — development resumed
> 2026-08-14 and the edition is a committed deliverable driven by public-sector
> procurement; Web UK owns 30 journey rows of its certification. Read
> `../aspnet-backend/docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md`,
> `ADR-0004-journey-equivalence-is-the-target.md` and
> `../aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md` before declining ASP.NET
> work here. What still applies: the live ASP.NET database container must not be
> restarted (scheduled backups have failed since 2026-03-08; a restore-tested
> 2026-08-10 off-server copy does exist), nothing deploys without explicit
> authorisation, and stateful certification uses the disposable Laravel on `:8091`.
>
> The superseded sentence read: "the ASP.NET backend stays paused with its database
> boundary closed; the shared local `nexus` database is production-derived and
> must never be written to; the GOV.UK branding prohibitions are binding.

🔴 **PAUSE LIFTED for `web-uk` on 2026-08-11; the ASP.NET fence STAYS.** This file
used to require a fresh explicit instruction before any `web-uk` edit. The owner
decided on 2026-08-11 that `web-uk` becomes the production accessible frontend and
Blade retires, so that requirement is lifted **for `web-uk/**` only**. Still
fenced: the ASP.NET backend and its **database boundary** (no successful backup
since 2026-03-08 while it migrates on every start), the read-only Laravel data
boundary below, and **any deployment without explicit authorisation**.

Read [`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md)
first. It is the **only** place the state of the changeover is stated; do not
restate it here. 🔴 That instruction used to sit two lines above a bullet that
restated it wrongly ("Phase A (now, Blade still deployed)"). The phase bullet is
corrected below; the single-source rule stands.

Urgent first-read rules:

- `web-uk` **is the platform's accessible frontend, and it is live** on
  `accessible.project-nexus.ie` (since 2026-08-12) and both community accessible
  domains (since 2026-08-14). 🔴 This bullet said "It is not deployed yet, and the
  deployment path is not built" until 2026-08-17, and before that said `web-uk`
  was "not yet the production accessible frontend" and must not replace Blade.
  Both are superseded, and flagged rather than deleted because an agent reading
  the old wording refuses authorised work or goes hunting for a missing
  deployment path. Deploying still needs the owner's explicit instruction.
- **There are no longer two phases: `web-uk` owns browser behaviour outright.**
  🔴 This bullet used to read *"Phase A (now, Blade still deployed): the Laravel
  Blade accessible frontend remains the observable-behaviour specification …
  `accessible-frontend/` at the repository root … and the generated route matrix
  is a live drift alarm. Phase B (Blade decommissioned): `web-uk` owns browser
  behaviour."* Blade was deleted on 2026-08-14, so `accessible-frontend/` does
  not exist and cannot specify anything. What decides behaviour now:
  **GOV.UK Design System + WCAG 2.2** for presentation (where GDS and internal
  precedent disagree, GDS wins), **`react-frontend/`** for what a member can do,
  and **the Laravel API** for the contract. The route matrix is coverage and
  regression evidence measured against a frozen snapshot, not a drift alarm.
- **Always**, the Laravel backend/API is the contract source of truth for
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
  rubric for the ASP.NET edition; never added to a `web-uk` score)
- `../aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md` (the ASP.NET work list)
- 🔴 HISTORICAL, both halves lifted:
  `../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md` (original pause
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
