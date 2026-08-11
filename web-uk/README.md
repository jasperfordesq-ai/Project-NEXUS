# Project NEXUS Community - Shared Accessible Frontend

> 🔴 **Status header added 2026-08-11.** On that date the owner decided `web-uk`
> becomes the production accessible frontend and the Laravel Blade accessible
> frontend retires. Read `docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` at the repository
> root first: it is the only place the current phase of the changeover is stated.
> **The body below is left as written.** Where it calls `web-uk` a candidate, or
> says it must not replace Blade, that was true when written and is superseded —
> those lines are dated evidence, not current status, and rewriting them would
> destroy the audit trail. The current score lives in
> `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`; the `663/1000` in
> `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is **retired**.

Last reviewed: 2026-07-15

Status: **Experimental Laravel-first implementation - not production-ready**

Development paused on **15 July 2026**. Start with the root
[pause and cold-start handoff](../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md);
opening this app does not authorize resumption.

This Express/Nunjucks frontend uses GOV.UK Frontend and GOV.UK Design System
patterns for Project NEXUS. **It is not a UK Government service and is not
affiliated with or endorsed by GOV.UK.**

## Authority And Current Status

Laravel supplies two read-only sources of truth:

- Laravel Blade defines browser routes, links, layout, navigation, forms,
  validation presentation, redirects, tenant behavior, and workflows.
- The Laravel API defines methods, paths, payloads, envelopes, status codes,
  authentication, roles, modules, uploads, persistence, and side effects.

ASP.NET is incomplete and is not a source of truth for Web UK. The unchanged
frontend may target ASP.NET only after the backend-owned switching contract is
complete and externally contract-identical behavior is independently certified.

Start with:

- [project pause and cold-start handoff](../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md) -
  first-read boundary and restart protocol while development is paused;
- [current Laravel-first status](docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md) -
  sole Web UK score, evidence boundary, ownership, and queue;
- [current ASP.NET contract status](../aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md) -
  separate backend bank and future switching evidence boundary;
- [Blade component audit](docs/BLADE_COMPONENT_PORT_AUDIT.md) - detailed
  implementation evidence;
- [backend switching contract](docs/BACKEND_SWITCHING_CONTRACT.md); and
- [accessibility verification](docs/ACCESSIBILITY_CERTIFICATION.md).

`docs/CURRENT_WEB_UK_HANDOFF.md` is historical and must not supply a current
score, count, or resume queue.

## Repository And Data Boundaries

Authoritative Laravel source paths are:

```text
accessible-frontend/
routes/govuk-alpha.php
routes/govuk-alpha-parity/
./
```

Laravel source, schema, ordinary database, storage, Redis, and production
containers are read-only from this workstream. Do not run Laravel migrations,
login, mutation, upload, download, cleanup, or destructive tests. The ordinary
local Laravel database is a confidential production-derived snapshot and is
never a test fixture.

The canonical browser mount is `/{tenantSlug}/accessible`. `/alpha` is legacy
redirect compatibility only.

## Supported Development Path

Docker is the supported Web UK development environment.

```powershell
docker compose up -d
docker compose logs -f nexus-uk-frontend
```

The local service is normally available at `http://127.0.0.1:5180`. Starting it
does not authorize requests that write to Laravel. For source-owned automated or
manual accessibility work, use the isolated fixture commands below instead of
an ordinary Laravel listener.

```powershell
docker compose down
docker compose up --build -d
```

See [DOCKER_CONTRACT.md](DOCKER_CONTRACT.md) for the local container contract.
The production profile is a local image/runtime check only and is not a
production release procedure.

## Environment Contract

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Express listener inside the container. |
| `ACCESSIBLE_BACKEND_TARGET` | `laravel` | Contract target. `aspnet` is future/uncertified only. |
| `LARAVEL_BASE_URL` | `http://127.0.0.1:8088` | Laravel target outside Docker; Docker uses `host.docker.internal`. |
| `ASPNET_BASE_URL` | `http://localhost:5080` | Future ASP.NET target when explicitly selected. |
| `API_BASE_URL` | unset | Explicit override; it does not certify the selected backend. |
| `COOKIE_SECRET` | unset | Required signing secret. |
| `SESSION_SECRET` | unset | Production requires an explicit distinct 32+ character value. |
| `SESSION_REDIS_URL` | unset | Persistent session store; required in Production. |
| `SESSION_REDIS_PREFIX` | `nexus:web-uk:sess:` | Session key prefix. |
| `NODE_ENV` | `development` | Runtime environment. |

Do not commit real secrets. Production configuration and approval remain
governed by [the fail-closed release runbook](docs/PRODUCTION_RELEASE_RUNBOOK.md).

## Routes And API Consumers

Do not maintain a narrative route table in this README. It previously drifted
into documenting removed, redirect-only, or deliberately rejected methods.
Generate the current inventories instead:

```powershell
npm run route:matrix
npm run api:ledger
```

- `docs/generated/accessible-route-matrix.*` is the exhaustive browser-route
  declaration inventory.
- `docs/generated/frontend-api-consumer-ledger.*` is the static API-consumer
  inventory.
- `docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md` and
  `docs/BLADE_COMPONENT_PORT_AUDIT.md` interpret the remaining gaps.

Generated matches are structural evidence, not runtime, authorization,
side-effect, accessibility, or production certification.

## Verification Commands

From `web-uk`:

```powershell
npm ci
npm test -- --runInBand
npm run lint
npm run brand:check
npm run build:css
npm run route:matrix
npm run api:ledger
npm run locales:audit
npm run locales:audit-keys
npm run locales:audit-templates -- --summary
npm run test:accessibility:isolated
```

`test:accessibility:isolated` binds random loopback listeners and uses a
GET/HEAD-only fixture backend. Its finite selection cannot be widened to
state-changing cases. For directed review over the same safe fixture:

```powershell
npm run manual:accessibility:isolated
```

Manual keyboard, focus, no-JavaScript, zoom/reflow, forced-colour, visual, and
screen-reader findings must be recorded in
[MANUAL_ACCESSIBILITY_EVIDENCE.md](docs/MANUAL_ACCESSIBILITY_EVIDENCE.md).
Automated checks are not a WCAG certificate.

Stateful Laravel smoke commands and the historical full accessibility aggregate
are retained for a separately authorized future runtime workstream. They must
not be run against the ordinary Laravel environment.

## Stack

- Node.js 18.19 or newer
- Express 4 and Nunjucks 3
- GOV.UK Frontend 6
- Sass, Jest 30, Playwright/axe, ESLint 9
- signed cookies plus Redis-backed sessions in Production

## Branding

The frontend uses GOV.UK patterns without Crown, Royal Arms, GOV.UK header or
footer, Open Government Licence branding, or any implication of government
affiliation. `npm run brand:check` enforces the source restrictions. The custom
header/footer must retain the non-affiliation statement.

## User And Administrator Documentation

Backend-neutral user guidance begins at
[../../docs/user/README.md](../aspnet-backend/docs/user/README.md). Tenant administrator
guidance begins at [../../docs/admin/README.md](../aspnet-backend/docs/admin/README.md).
Neither guide changes the current Web UK certification boundary.

## License And Credits

AGPL-3.0-or-later. See the repository `LICENSE` and `NOTICE`. Project NEXUS was
created by Jasper Ford; the originating hOUR Timebank initiative was co-founded
by Jasper Ford and Mary Casey, with community/product contributions recorded in
the repository contributor files.
