# Project NEXUS .NET Edition - Agent Guide

> **Re-imported 2026-08-10.** The 2026-08-09 monorepo move did not bring this
> file across, and the repo-wide `CLAUDE.md` ignore rule would have excluded it
> anyway. Recovered from the archive repository with its paths corrected for the
> monorepo layout: Laravel now lives at this repository's root rather than a
> separate checkout, and `web-uk/` is a sibling of `aspnet-backend/`.

Last reviewed: 2026-08-21

> 🔴 **Two 2026-08-11 changes that affect what you read here.**
>
> 1. **`../web-uk/` is no longer a candidate — it REPLACES the Blade accessible
>    frontend.** Owner decision, 2026-08-11. Read
>    `../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` first. Lines below describing it as
>    an implementation target for a *future* frontend are superseded; they are
>    flagged rather than deleted because the old wording makes an agent refuse the
>    work. Its score now lives in `../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`
>    — `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is **RETIRED** and its `663/1000` is
>    not current.
> 2. **The pause is now split.** `web-uk` is lifted; **ASP.NET is not.** Everything
>    this file says about ASP.NET, its migrations, its containers and its database
>    boundary stands unchanged.
>
> 🔴 **BOTH CLAIMS IN ITEM 2 ARE NOW OUT OF DATE (corrected 2026-08-21).**
> (a) **The ASP.NET pause lifted on 2026-08-14** — see the banner immediately
> below; development is active. (b) The "no successful backup since 2026-03-08"
> line is true of the *scheduled off-server job* but incomplete: a
> **restore-tested off-server copy from 2026-08-10** exists (265/265 tables,
> 53/53 migrations, 49,958 rows) and the database container has been stopped
> since then, so the recovery point is current. Read
> [`docs/DATABASE_BACKUP_DECISION.md`](docs/DATABASE_BACKUP_DECISION.md) before
> repeating "there is no backup". The real remaining risks: no *scheduled*
> backup, a ~2.5-hour single-copy tail, migrate-on-start dormant-not-gone, and
> no deploy path. The container still must not be restarted.

> **DEVELOPMENT PAUSE LIFTED 2026-08-14.** Development was paused on 15 July
> 2026; on 14 August 2026 the owner explicitly instructed resumption of the
> ASP.NET contract-parity workstream toward full parity and production
> readiness. Local implementation, tests, and migrations are authorized again.
> Production deployment, production-container operations, and live-provider
> actions still require separate explicit owner authorization per deploy — the
> live ASP.NET database still has no successful backup since 2026-03-08, and
> that must be fixed before anything touches production. For history read
> [`docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md`](docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md);
> for the current queue and drift picture read
> [`docs/CURRENT_ASPNET_CONTRACT_STATUS.md`](docs/CURRENT_ASPNET_CONTRACT_STATUS.md)
> (2026-08-14 re-audit section).

> WARNING: Before deploying or touching any production container, read
> the production container guide (`.claude/production-containers.md`, not imported by the 2026-08-09 move; retained in the archive repository).
>
> The `nexus-react-frontend` container on port `5210` (image
> `nexus-react-frontend:prod`) may still be running on the Azure host. Its
> source, `apps/react-frontend/`, was deleted from this repository on
> 2026-08-09; the image is now an orphaned snapshot that cannot be rebuilt from
> this repo. Do not attempt to rebuild or redeploy it here. The React frontend
> now lives in the separate staging repository and is being made switchable
> between the Laravel and ASP.NET backends. Never touch the Laravel Edition
> blue/green PHP containers from this repo.

## What This Project Is

This directory is the **ASP.NET Core 10 / PostgreSQL edition** of Project NEXUS:
a clean .NET implementation of the canonical Laravel platform, not a PHP
migration dump.

🔴 **It is a committed product deliverable, not an experiment.** Corrected
2026-08-21. This guide called it "experimental" and "development-only" and told
you ASP.NET was "an optional future alternative, not Laravel's planned
successor". That framing was wrong about intent and it cost this workstream
weeks: an optional project does not get a scoped delivery plan, so the goal
stayed at its maximal reading and no agent was authorised to narrow it. The real
driver is commercial — **a segment of public-sector buyers require a .NET stack
as a condition of procurement**, and without this edition those contracts cannot
be bid. Read
[`docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md`](docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md).

🔴 **The deployment prohibitions are UNCHANGED.** Committed does not mean
deployable. Do not add this to the Laravel blue/green Compose file or production
deploy scripts, do not restart or redeploy the live ASP.NET containers, and do
not let ASP.NET CI gate a Laravel release. The live ASP.NET database has had no
successful backup since 2026-03-08 while the app migrates on every start.

The Laravel Edition, now at the root of this same monorepo, is the current
source of truth for externally observable contracts. Treat it as read-only reference
material. Do not edit it, run destructive commands in it, deploy it, or touch
its production containers from this workspace.

The objective is an externally contract-identical ASP.NET implementation of the
Laravel contracts: API contracts, workflows, frontend-consumed behavior, admin
and super-admin surfaces, accessible frontend behavior, background jobs,
integrations, tenant settings, localization, tests, and documentation. Earlier
"out of scope" exclusions are retired and are tracked as contract-identity gaps.

The binding decisions, in reading order:

| ADR | What it settles |
| --- | --- |
| [ADR-0001](docs/decisions/ADR-0001-contract-identical-backends.md) | The standard: externally contract-identical at every consumed boundary. |
| [ADR-0004](docs/decisions/ADR-0004-journey-equivalence-is-the-target.md) | 🔴 **How that is measured**, and what is deliberately OUT of scope. |
| [ADR-0003](docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md) | Why this is committed, and the go-live gate. |
| [ADR-0002](docs/decisions/ADR-0002-laravel-production-authority-and-aspnet-optionality.md) | Superseded in part. Its scaling reasoning is retained only. |

🔴 **Read ADR-0004 before doing any parity work.** "Contract-identical" was
implemented as a whole-response-body diff, which made Laravel's raw-Eloquent
internal columns count as required work — a listing carries ~76 fields including
`category.reset_token`. ADR-0004 fixes the measurement: a field is in scope only
if a client reads it, acts on it, or its difference changes an outcome.
Reproducing an internal column no screen reads is **not work**; Laravel
serialising it is a Laravel defect. Historical "parity," "compatible," and
"contract-correct" wording is shorthand for the ADR-0001 standard as measured by
ADR-0004, not route-count similarity or "close enough" behavior.

The end state is two unchanged frontends by two backends: canonical React and
shared accessible Web UK must each run against Laravel and ASP.NET by
configuration only. Laravel remains the behavior baseline; ASP.NET reproduces
the contracts and workflows those clients consume.

## React Frontend Retirement And Contract Policy

The separate React frontend in this repo, `apps/react-frontend/`, was deleted on
2026-08-09. It was a dead, out-of-date fork; keeping it only risked it being
mistaken for live code. This repository no longer contains a React frontend, and
one must not be reintroduced here. Its history remains reachable through git if
an old implementation detail is ever needed.

The canonical React frontend is:

```text
react-frontend/          (at the monorepo root, i.e. ../react-frontend from here)
```

That frontend is production software. The Laravel backend is production and is
the source of truth for the frontend API contract. The ASP.NET backend must
become equivalent at the boundary that frontend actually consumes.

ASP.NET is a **committed second edition**, scheduled and resourced, because
buyers will require it (ADR-0003). It is not an automatic response to traffic
growth: there is still no user, tenant or traffic threshold that promotes it or
retires Laravel. Laravel remains the production default **until the ASP.NET
edition is certified** — a sequencing statement, not a statement about which
edition matters. Any production role requires the go-live gate in ADR-0003,
including working backups and an explicit owner decision.

Default rule for agents: do not modify frontend files in this repo unless the
user explicitly approves that specific frontend change. Backend contract-identity work
should happen in ASP.NET controllers, services, DTOs, auth/tenant handling,
OpenAPI/contracts, tests, and docs.

For every API call made by the Laravel React frontend, ASP.NET must expose the
same externally observable contract:

- same HTTP method and path, including `/api/v2/...` aliases where the Laravel
  React frontend expects them;
- compatible request payloads, query parameters, multipart/upload fields, and
  headers;
- compatible response envelopes, pagination metadata, status codes, validation
  errors, auth errors, tenant errors, and not-found behavior;
- compatible auth refresh, tenant bootstrap, feature/module flags, upload URL,
  and realtime configuration behavior.

Do not "fix" compatibility by weakening the Laravel React frontend or by adding
ASP.NET-specific conditionals to production React pages. If a difference is
unavoidable, document it as a temporary adapter requirement and prefer fixing
the ASP.NET backend first.

Compatibility claims require proof:

- a route/API matrix comparing Laravel React API calls, Laravel routes/OpenAPI,
  and ASP.NET routes/OpenAPI;
- focused ASP.NET regression tests for matched endpoints;
- runtime smoke tests showing the Laravel React frontend can exercise the
  implemented ASP.NET endpoints without request/response shape failures.

See `docs/REACT_FRONTEND_RETIREMENT.md` for the maintained policy.

> 🔴 **RESUMING BACKEND WORK? READ
> [`docs/PRODUCTION_READINESS_REMEDIATION.md`](docs/PRODUCTION_READINESS_REMEDIATION.md)
> FIRST (opened 2026-08-15).** It is the single actionable list of every verified
> defect standing between this backend and running a real community.
>
> The one thing to know before you touch anything here: **route existence proves
> nothing.** 319 action methods (349 when this warning was written; remeasured
> 2026-08-18) return success-shaped JSON while performing no
> work at all — no database access, no service call. That is why the generated
> inventories report 2,648 of 2,667 routes matched and 5 static React contract
> gaps. Never
> accept "the route exists" or a green test run as evidence of behaviour; open the
> method body. `AdminV2RouteAliasRuntimeTests.cs:773-780` literally asserts only
> "not 404, not 405", which a stub satisfies.

## Current Status Sources

Do not copy fast-changing counts into this first-read guide. Read and refresh the
workstream-specific status source instead:

- `docs/JOURNEY_CERTIFICATION_LEDGER.md` is **the work list** — every enumerated
  journey with a status each, and the frozen denominator the score is derived
  from. Start here when picking up work.
- `docs/HANDOFF_PROMPT.md` is the standing session brief (roles, reading order,
  invariants, definition of done, forbidden actions, concurrency rules). Paste
  it into a fresh session before doing anything else.
- `docs/CURRENT_ASPNET_CONTRACT_STATUS.md` is the current ASP.NET fixed-rubric
  score, evidence boundary, published-but-unscored work, and next queue.
- `docs/ROADMAP.md` is the plain-English owner-facing summary and time frames.
- 🔴 `docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md` is **HISTORICAL**. This guide
  called it "the cold-start entry point while development remains paused" until
  2026-08-21; the ASP.NET pause was lifted on 2026-08-14 and the banner at the
  top of this file already said so. Do not resume there.
- `docs/CURRENT_SCHEMA_READINESS.md` is the current one-page schema verdict,
  migration-chain boundary, exact-SHA CI result, and recommission sequence. It
  does not publish a separate product score.
- `../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` is the current Web UK
  fixed-rubric score, route/API ledgers, certification boundary, and next queue.
- `docs/FULL_PARITY_REMEDIATION_RUNBOOK.md` defines the shared 1000-point rubric
  and the two-frontends-by-two-backends completion gate.

Generated route, schema, localization, and frontend inventories are evidence,
not completion scores. Regenerate them at the recorded Laravel and ASP.NET SHAs
before reporting them. Never combine a newly discovered denominator with an old
numerator or silently rescore an already named baseline.

## Parity Status Policy

Do not claim 100% parity, a 1,000/1,000 score, or production replacement status
until the parity maps in `docs/` show no open gaps and the relevant test suites
pass. Previous numeric parity scores in this repo are retired because they
excluded modules that are now in scope.

If an agent is resuming backend work, start with
`docs/CURRENT_ASPNET_CONTRACT_STATUS.md`. If resuming accessible frontend work,
start with `../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`. The older
`CURRENT_LARAVEL_PARITY_HANDOFF.md` and `CURRENT_WEB_UK_HANDOFF.md` files are
chronological histories: their old “latest” headings, counts, and scores are not
current status.

The canonical tracking documents are:

- `docs/FULL_PARITY_REMEDIATION_RUNBOOK.md` - fixed cross-workstream rubric,
  shared completion evidence gates, and autonomous execution loop; it links to
  the two canonical status documents for their live queues.
- `docs/CURRENT_ASPNET_CONTRACT_STATUS.md` - current backend score, evidence,
  blockers, and resume queue.
- `../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` - current accessible
  frontend score, evidence, blockers, and resume queue.
- `docs/CURRENT_LARAVEL_PARITY_HANDOFF.md` - historical backend implementation
  log; never use its old scores as current.
- `docs/LARAVEL_PARITY_MAP.md` - gap register and backlog.
- `docs/PARITY_BACKLOG.md` - generated backlog rollup and implementation queue rules.
- `docs/API_PARITY.md` - API contract comparison method and known gaps.
- `docs/SCHEMA_PARITY.md` - database/entity/table comparison method and known gaps.
- `docs/CURRENT_SCHEMA_READINESS.md` - current schema pause/restart verdict and evidence boundary.
- `docs/FRONTEND_PARITY.md` - React and accessible frontend route comparison method and known gaps.
- `docs/LOCALIZATION_PARITY.md` - locale, namespace, and translation-key comparison method and known gaps.
- `docs/MODULES.md` - module-by-module source and target map.
- `docs/ARCHITECTURE.md` - .NET runtime and boundary map.

## Former Exclusions Are Now Gaps

The following Laravel surfaces are explicitly in scope for full parity and must
be tracked until implemented or intentionally superseded by a documented .NET
equivalent:

- Caring Community, including municipal/KISS, care-provider, caregiver, warmth,
  civic digest, forecasting, and caring admin surfaces.
- Marketplace and commerce, including listings, seller profiles, orders,
  payments, escrow, pickup slots, coupons, local advertising, merchant
  onboarding, and marketplace AI/discovery.
- Verein / Clubs membership, dues, federation, and cross-invitation workflows.
- Regional Analytics and National KISS dashboard/reporting.
- Non-Stripe identity providers present in Laravel: Veriff, Onfido, Jumio, and
  Idenfy.
- Tenant SSO/OIDC login flow: provider administration plus the public
  redirect/callback and browser exchange are implemented with signed durable
  state, browser and server PKCE, nonce/JWKS validation, public-HTTPS endpoint
  checks, tenant-qualified identity linking, domain/provisioning policy gates,
  one-time callback grants, and refresh-token issuance. Live IdP/browser proof,
  fixed-rubric module acceptance, and unchanged-client runtime proof remain
  certification gaps. The general complete exact-SHA aggregate is green at
  `dbafc5c3`; it does not substitute for live-provider or browser evidence.
- Mailchimp-like audience/template/sync behavior where Laravel still exposes it.
- Partner API and partner portal surfaces.
- Super-admin and platform-level federation/tenant controls.
- The accessible HTML/GOV.UK-style frontend parity surface.

## Frontend Parity Targets

This directory contains no React frontend. The canonical React frontend is
`react-frontend/` at the monorepo root (`../react-frontend` from here), which is
being made switchable between the Laravel and ASP.NET backends.

- `apps/react-frontend/` was deleted on 2026-08-09. Do not recreate it. If an
  old .NET adapter detail is needed, read it from git history rather than
  restoring the directory.
- 🔴 **`../web-uk/` IS the accessible frontend, in production, serving three
  live hostnames.** It is not a "future" target. This bullet said Laravel Blade
  defined its routes, layout, forms and workflows — **the Blade accessible
  frontend was DELETED on 2026-08-14.** `accessible-frontend/`,
  `app/Http/Controllers/GovukAlpha/` and `routes/govuk-alpha.php` do not exist;
  do not go looking for them and do not treat their absence as damage. Behaviour
  is now defined by the GOV.UK Design System plus WCAG 2.2 for presentation,
  `react-frontend/` for what a member can do, and the Laravel API for the
  contract. The final Blade route inventory is frozen at
  `../web-uk/scripts/blade-route-inventory.frozen.json` (707 routes) and is what
  `npm run route:matrix` still compares against. Its location in this repository
  does not make ASP.NET authoritative.
- If resuming the accessible frontend work after an interrupted session, start
  with `../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`.
- 🔴 This bullet said "the Laravel Blade accessible frontend remains the
  current visual/workflow source of truth" and told you to port its patterns
  into `../web-uk`. **Blade was deleted on 2026-08-14; there is nothing to port
  from.** `../web-uk` keeps its Express/Nunjucks/GOV.UK Frontend stack and is
  itself the accessible frontend. `lang/*/govuk_alpha*.php` at the monorepo root
  is ALIVE and must not be deleted — it is the source its eleven translation
  catalogues are generated from.
- Web UK work must not modify ASP.NET backend source, tests, migrations, schema,
  fixtures or runtime data. It must not edit Laravel source, run Laravel
  migrations, alter/query/clean its ordinary local database, or touch
  production. The ordinary local Laravel database is a confidential,
  production-derived snapshot and is never a test fixture. Live mutation,
  upload, download, or destructive certification requires a separately
  provisioned disposable Laravel environment; cleanup against the ordinary
  local database is not an acceptable substitute.
- ASP.NET switching is a separate future gate: once that backend is ready, rerun
  the same unchanged Web UK suite by changing configuration only. Never add
  ASP.NET-specific page, template, validation, redirect or workflow branches.
- Do not point production utility-bar traffic at `../web-uk` until accessible
  route, workflow, tenant-domain, auth, localization, accessibility, and runtime
  smoke certification passes.
- `apps/admin/` was retired and deleted on 2026-08-09. The admin panel lives in
  the canonical React frontend in the staging repository. Do not recreate a
  standalone admin app here.
- Current backend work should make ASP.NET externally contract-identical to the Laravel React API
  contract, especially the routes and response shapes used by the production
  Laravel React frontend.

## Architecture Invariants

Preserve these invariants when implementing parity:

- ASP.NET Core 10 backend with EF Core and PostgreSQL. Upgraded from .NET 8 on
  2026-08-10, ahead of .NET 8 end of support on 2026-11-10.
- JWT authentication, refresh-token safety, and admin policies.
- Privileged authorization is database-backed. Rehydrate the current user role,
  tenant, activation state, and `is_admin`, `is_super_admin`,
  `is_tenant_super_admin`, and `is_god` flags before granting access; reject
  stale role or tenant claims. `GodOnly` requires the explicit `is_god` flag.
- Tenant isolation on every business query and write path.
- CORS origins aligned with deployed frontend domains.
- FIDO2/WebAuthn relying-party domain and origin rules.
- Authentication challenges must be opaque, time-bounded, single-use
  capabilities, never bearer tokens. The current 2FA and WebAuthn challenge
  stores are process-local; distributed challenge continuity remains an open
  production-readiness gap.
- Manual scheduled-job endpoints may report success only after a registered
  equivalent job executes and its successful outcome is persisted. Unmapped,
  busy, disabled, cancelled, and failed executions must fail explicitly.
- Keep one controller owner per HTTP verb and normalized `/api/admin` or
  `/api/v2/admin` route template. Preserve `AdminRouteOwnershipParityTests`
  when adding aliases or replacing compatibility handlers.
- No raw provider PII persisted beyond documented sanitized audit data.
- Migrations committed to git; no direct production database edits.
- AGPL-3.0-or-later license and NOTICE attribution preserved.

All new C# source files must include:

```csharp
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

## Local Development

Docker is required for the local application stack. Do not use `dotnet run` as
the normal development path.

```powershell
Copy-Item .env.example .env
# Replace JWT_SECRET in .env with a local-only random value.
docker compose up -d db rabbitmq api
docker compose logs -f api
docker compose build api && docker compose up -d api
docker compose down
```

Services:

| Service | URL | Notes |
| --- | --- | --- |
| API | `http://127.0.0.1:5080` | ASP.NET backend |
| Swagger | `http://127.0.0.1:5080/swagger` | Development-only runtime API documentation |
| Health | `http://127.0.0.1:5080/health` | Anonymous health endpoint |
| Web UK frontend | `http://127.0.0.1:5180` | Laravel-first shared accessible frontend; ASP.NET switching is a separate certification gate |
| Standalone admin | `http://127.0.0.1:5190` | Secondary admin app |

Test credentials:

- `admin@acme.test` / `NexusV2!Demo#2026` / tenant slug `acme`
- `member@acme.test` / `NexusV2!Demo#2026` / tenant slug `acme`
- `admin@globex.test` / `NexusV2!Demo#2026` / tenant slug `globex`

These identities exist only in the fictitious Development seed. See
[`docs/system/LOCAL_DEVELOPMENT.md`](docs/system/LOCAL_DEVELOPMENT.md) for the
supported startup path and database boundary.

## Verification Commands

Use the narrowest command that proves the change, then broaden when behavior or
shared contracts are touched.

```bash
dotnet test Nexus.sln --configuration Release
npm --prefix ../web-uk run lint
npm --prefix ../web-uk test -- --runInBand
```

There are no longer any `apps/react-frontend` or `apps/admin` checks to run;
both directories were deleted. `../web-uk` is the only remaining frontend in
this repository. For backend contract identity, require ASP.NET
regression tests plus route/API matrix and runtime smoke tests against the
canonical Laravel React frontend.

For docs-only changes, at minimum run link/path sanity checks with `rg` and
inspect `git diff`. For maintained documentation changes, also run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-markdown-links.ps1
git diff --check
```

## Database Migration Workflow

All schema changes flow through EF migrations committed to git. The runtime API
image does not contain the .NET SDK or the repository source, so the historical
`make migrate*` and `docker compose exec api dotnet ef` commands are not a
supported workflow.

Use the host .NET 10 SDK and an explicitly disposable PostgreSQL connection as
documented in [`docs/database-migrations.md`](docs/database-migrations.md).

Production migrations require explicit deployment instruction and the production
container guide. Never apply ad-hoc production schema edits.

## Documentation

Documentation that future agents should trust lives under `docs/` and is
indexed by `docs/README.md`. Keep local-only generated audits, scratch output,
and one-off prompts out of committed docs unless they have been curated into a
maintained map.

Audience entry points are [`docs/user/README.md`](docs/user/README.md),
[`docs/admin/README.md`](docs/admin/README.md),
[`docs/api/README.md`](docs/api/README.md), and
[`docs/system/README.md`](docs/system/README.md). Support and private security
reporting live in [`SUPPORT.md`](../SUPPORT.md) and
[`SECURITY.md`](../SECURITY.md), at the monorepo root.

When updating parity docs, cite local source paths instead of memory and keep
the Laravel repo read-only.
