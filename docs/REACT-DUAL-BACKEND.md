# React Dual-Backend Portability

Last reviewed: 2026-08-21

This document defines the guardrails for making the React frontend able to run
against either the Laravel API or the ASP.NET API while keeping Laravel as the
protected default.

## Current Decision

🔴 **Corrected 2026-08-21.** This section described the work as "a portability
strategy, not a planned migration", called ASP.NET "an optional alternative",
and said Laravel would be canonical "for the indefinite future". That was wrong
about product intent and it demoted the workstream in every agent's first read.
Project NEXUS ships **two editions of one product**, and the ASP.NET edition is
a committed deliverable because **a segment of public-sector buyers require a
.NET stack as a condition of procurement**. See
[`ADR-0003`](../aspnet-backend/docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md).

The Laravel backend remains the **production default and the behaviour source of
truth until the ASP.NET edition is certified**. That is sequencing, not
priority. The React frontend must keep working against Laravel by default, and
ASP.NET is selected by configuration.

Growth in users, tenants, or traffic is still not by itself a reason to switch
backends — that reasoning from ADR-0002 is retained. Address the actual
constraint in queries, indexes, caches, queues, media, connections, or
infrastructure, in whichever edition is serving.

🔴 **The target is journey equivalence at consumed boundaries.** For everything
a real user does, both editions must produce the same outcome, data, errors,
permissions and side effects. A response field that no client reads is
explicitly **out of scope** — reproducing Laravel's raw-Eloquent internal
columns is not required work. See
[`ADR-0004`](../aspnet-backend/docs/decisions/ADR-0004-journey-equivalence-is-the-target.md),
and the finite work list at
[`JOURNEY_CERTIFICATION_LEDGER.md`](../aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md).

An ASP.NET production role still requires the go-live gate in ADR-0003:
journey evidence at the scope proposed, load evidence, a **repaired scheduled
backup**, a deploy and rollback path, observability, a migration and
reconciliation plan, and an explicit owner decision. On backups: the *scheduled*
off-server job has been failing since 2026-03-08, but a restore-tested copy from
2026-08-10 exists and the database has been stopped since, so the recovery point
is current — read
[`DATABASE_BACKUP_DECISION.md`](../aspnet-backend/docs/DATABASE_BACKUP_DECISION.md)
before repeating "there is no backup".

Current status:

| Surface | Status | Rule |
| --- | --- | --- |
| Laravel backend | Production | Canonical API contract; production default until ASP.NET is certified. |
| Laravel React frontend | Production | Must remain Laravel-compatible by default. |
| ASP.NET backend | Committed edition, not yet certified | Must reproduce the journeys the unchanged clients perform. Not deployable until the ADR-0003 gate is met. |

The target architecture is:

```text
React frontend
  -> Laravel API by default
  -> ASP.NET API only when explicitly selected by environment/config
```

The frontend should not become two separate applications. It should remain one
codebase with small, well-tested adapters for unavoidable backend differences.

The medium-term repository plan is to move the React frontend into its own
folder/repository once backend contract work is mature enough. Until then,
`react-frontend/` remains in this Laravel repo, and Laravel production safety is
the priority over ASP.NET convenience.

## Non-Negotiable Guardrails

- Laravel mode is the default mode.
- There is no user-count, tenant-count, or traffic threshold that automatically
  promotes ASP.NET or retires Laravel.
- Existing Laravel API paths, payloads, response handling, auth behaviour, tenant
  handling, uploads, and realtime behaviour must not be changed to suit ASP.NET.
- ASP.NET should conform to the Laravel API contract wherever possible.
- Backend-specific branches must be isolated behind adapter modules, not spread
  through pages and components.
- Do not add ASP.NET-only assumptions to shared React components.
- Do not remove Pusher, Laravel upload handling, Laravel auth refresh, or
  Laravel tenant bootstrap unless an equivalent Laravel regression test is
  already passing.
- Any ASP.NET compatibility change must include a Laravel-mode verification
  command before it is considered safe.

## Terminology

| Term | Meaning |
| --- | --- |
| Route parity | The same HTTP method and path exist in both backends. |
| API contract parity | Requests, responses, status codes, validation errors, auth, tenant rules, and side effects match. |
| Frontend portability | The same React screen works against either backend by changing environment/config only. |
| Adapter | A small frontend boundary that hides unavoidable backend differences, such as realtime transport. |

Route parity is not enough on its own. A route only proves that the same door
exists. Contract parity proves that the door accepts the same key and gives back
the same result.

## Desired Folder Shape

The current Laravel React frontend remains under:

```text
react-frontend/
```

Future portability work should prefer this shape:

```text
react-frontend/
  package.json
  src/
    config/
      backendTarget.ts
    lib/
      api.ts
    realtime/
      index.ts
      pusherRealtime.ts
      signalrRealtime.ts
    uploads/
      uploadAdapter.ts
    auth/
      authContract.ts
```

The exact file names can change if the existing codebase has a better local
pattern, but the boundary should stay the same: pages call shared application
services, and backend-specific differences stay inside adapters.

Environment-specific local files remain ignored by git. Prefer committed npm
scripts and public docs over committed `.env.*` mode files, because this repo
intentionally ignores environment files.

Future standalone repository shape:

```text
nexus-react-frontend/
  package.json
  src/
  docs/
    backend-contract.md
  contracts/
    laravel-openapi.json
    aspnet-openapi.json
```

The standalone repo should still treat Laravel as the default contract until
ASP.NET has passed module-by-module certification.

## Environment Strategy

Laravel mode should remain the implicit default:

```text
VITE_BACKEND_TARGET=laravel
VITE_API_BASE=/api
VITE_API_URL=http://localhost:8090
```

ASP.NET mode should be explicit:

```text
VITE_BACKEND_TARGET=dotnet
VITE_API_BASE=/api
VITE_API_URL=http://localhost:5080
```

Current explicit local scripts:

```text
npm --prefix react-frontend run dev:laravel
npm --prefix react-frontend run dev:dotnet
npm --prefix react-frontend run build:laravel
npm --prefix react-frontend run build:dotnet
```

These scripts should select environment/config only. They must not rewrite
source code or generated files.

The existing scripts remain the Laravel-safe production path:

```text
npm --prefix react-frontend run dev
npm --prefix react-frontend run build
```

## Adapter Boundaries

### API Client

The API client should continue to express Laravel's contract. If ASP.NET returns
a different envelope, pagination shape, validation format, or status code, the
preferred fix is in ASP.NET. Use frontend normalization only when the difference
is temporary, documented, and covered by tests in both modes.

### Auth And Tenant Context

Auth is high risk. The React frontend currently depends on access tokens,
refresh handling, tenant identity, CSRF handling, and session expiry events.

Safe rule:

```text
Laravel auth behaviour must remain equivalent for every value a page component actually reads (see
[`ADR-0004`](../aspnet-backend/docs/decisions/ADR-0004-journey-equivalence-is-the-target.md)
— "byte-for-byte" was never the standard and is retired wording) from the page
components' point of view.
```

ASP.NET should expose matching login, logout, refresh, tenant bootstrap, CSRF,
and current-user behaviour.

### Realtime

Laravel uses Pusher. ASP.NET may use SignalR. This is a valid adapter boundary.

Pages and contexts should depend on a generic realtime interface, not directly
on Pusher or SignalR from feature code.

### Uploads And Assets

Uploads are contract-sensitive because email images, tenant assets, public
images, and user files all depend on URL shape and storage behaviour.

ASP.NET should match Laravel's upload endpoints and response fields wherever
possible. A frontend adapter may only handle transport differences, not change
the URL contract expected by existing Laravel screens.

## Compatibility Roadmap

### Phase 0: Baseline And Inventory

- Capture a Laravel-mode baseline build.
- Capture key Laravel-mode smoke screens: login, tenant bootstrap, dashboard,
  feed, wallet, messages, notifications, uploads, and one admin page.
- Extract all React API calls into a machine-readable matrix.
- Compare the matrix against Laravel OpenAPI/routes and ASP.NET routes.

Current inventory command:

```text
npm --prefix react-frontend run inventory:api-calls
```

The command scans the production Laravel React source and writes generated
artifacts under:

```text
.local-docs-archive/react-api-inventory/latest/
```

Generated inventory artifacts are local working material. Do not commit them to
public docs. They are input for ASP.NET backend contract work, not proof that
ASP.NET is ready.

The inventory matrix includes:

- module grouping inferred from the React source path;
- priority labels:
  - `P0` for auth, tenant bootstrap, and session-critical calls;
  - `P1` for member workflows, uploads/downloads, raw fetch calls, and other
    higher-risk contracts;
  - `P2` for admin or lower-risk follow-up contracts;
- auth/tenant hints from API client options such as `skipAuth` and `skipTenant`;
- upload/download markers, upload field names, response type hints, dynamic path
  markers, and raw-fetch markers;
- Laravel OpenAPI matching from the repo-root `openapi.json` when present;
- Laravel route-file matching from `routes/*.php` when OpenAPI does not cover a
  call yet;
- ASP.NET status fields that default to `not_checked` and must stay that way
  until the development ASP.NET backend has been audited separately;
- first source locations so backend agents can inspect the calling screen before
  implementing an ASP.NET endpoint.

The latest local inventory should be read as a work queue seed. Each row still
needs Laravel route/OpenAPI matching and, later, ASP.NET route/runtime smoke
verification before it can be marked compatible. A Laravel route-file match only
means the production Laravel backend appears to expose the called method/path; it
does not say the ASP.NET backend is ready.

Current local prep check:

```text
npm --prefix react-frontend run check:dual-backend-prep
```

This command verifies the guardrails, runs the inventory and worksheet fixture
tests, regenerates the local API-call matrix, and regenerates local module
certification worksheets, and writes the Laravel-mode smoke manifest. It does
not run ASP.NET and does not certify ASP.NET compatibility.

Current guardrail-only check:

```text
npm --prefix react-frontend run check:backend-guardrails
```

This fails if ordinary `dev`/`build` scripts stop being Laravel-safe, if
`backendTarget` stops defaulting invalid or missing values back to Laravel, or
if backend-specific conditionals appear in production page/component files.

Current certification worksheet command:

```text
npm --prefix react-frontend run certification:worksheets
```

The command reads:

```text
.local-docs-archive/react-api-inventory/latest/api-calls.json
```

and writes module worksheets under:

```text
.local-docs-archive/react-api-certification/latest/
```

These worksheets are local handoff material for ASP.NET backend agents. They
organize P0/P1/P2 rows by module, show Laravel OpenAPI match status, preserve
ASP.NET status as `not_checked`, and list the proof required before any future
row can be marked compatible. Do not commit generated worksheets to public docs.

Current Laravel-mode smoke manifest command:

```text
npm --prefix react-frontend run smoke:laravel-manifest
```

The command writes a manual smoke checklist under:

```text
.local-docs-archive/react-laravel-smoke/latest/
```

The manifest is deliberately Laravel-only. It records the workflows that must
remain green in Laravel mode before any future portability claim, keeps every
workflow at `manual_not_run` until a human or runtime smoke suite supplies
evidence, and explicitly states that it does not run or certify ASP.NET.

Exit gate:

```text
Laravel mode is green before any ASP.NET portability change starts.
```

### Phase 1: Environment-Only Backend Target

- Add backend target environment examples.
- Add scripts for `dev:laravel` and `dev:dotnet`.
- Add a small config helper that exposes the active backend target.
- Keep Laravel as the fallback when the variable is missing or invalid.

Exit gate:

```text
Laravel build and Laravel smoke tests still pass with no source changes needed
by developers.
```

### Phase 2: Contract Tests Before Adapters

- Add contract tests for API envelopes, pagination, validation errors, auth
  refresh, tenant headers, uploads, and realtime bootstrap.
- Treat Laravel results as the expected contract.
- Mark ASP.NET failures as backend parity work unless the difference is truly a
  frontend transport concern.

Exit gate:

```text
Every failing ASP.NET call is classified as missing route, wrong route prefix,
wrong response shape, auth/tenant mismatch, upload mismatch, realtime mismatch,
or true backend logic gap.
```

### Phase 3: Minimal Adapter Layer

- Add a realtime adapter if SignalR remains the ASP.NET transport.
- Add upload/auth adapters only if ASP.NET cannot fully mirror Laravel yet.
- Keep adapter selection at startup/config boundaries.
- Do not add backend checks inside feature pages.

Exit gate:

```text
The same React screen code runs in Laravel mode and ASP.NET mode.
```

### Phase 4: Module-By-Module Certification

Certify modules in this order:

1. Auth, tenant bootstrap, current user.
2. Dashboard and shell navigation.
3. Feed, notifications, messages, realtime.
4. Wallet and exchanges.
5. Listings, groups, events.
6. Caring Community.
7. Marketplace, jobs, volunteering.
8. Courses and podcasts.
9. Admin modules.
10. Super admin and provisioning.

Each module should be labelled:

```text
GREEN  route exists, contract matches, screen passes both backends
YELLOW route exists, deeper behaviour not proven
BLUE   route exists under the wrong URL and needs ASP.NET aliasing
RED    missing or incompatible endpoint
PURPLE frontend adapter required
```

### Phase 5: Ongoing Guardrails

- Add CI or local checks that fail when Laravel-mode portability regressions are
  introduced.
- Keep the API-call matrix current.
- Keep this document current when adapter boundaries change.

## What Not To Do

- Do not copy the ASP.NET React fork back over the Laravel React frontend.
- Do not make ASP.NET the default backend target.
- Do not describe ASP.NET as Laravel's planned replacement or as an automatic
  answer to growth without Project NEXUS workload evidence.
- Do not fix ASP.NET by weakening Laravel frontend validation.
- Do not fork pages per backend.
- Do not hide contract mismatches with broad `try/catch` fallbacks.
- Do not change Laravel backend routes for ASP.NET convenience.

## Agent Instructions

When an agent works on this portability effort, give it this instruction:

```text
Laravel is the source of truth and the default frontend backend.
Protect Laravel mode first. Do not change Laravel API assumptions to suit
ASP.NET. Make ASP.NET conform to the Laravel React API contract wherever
possible. If a frontend adapter is necessary, isolate it behind a small module,
add tests for Laravel mode, and document the temporary ASP.NET difference.
```

Every implementation task should report:

- which Laravel-mode verification command was run;
- which ASP.NET-mode verification command was run, if available;
- which endpoints were proven compatible;
- which endpoints remain blocked by ASP.NET backend parity work.

When the ASP.NET backend is still under active parity development, report the
ASP.NET verification line as "not ready / not run" rather than implying support
exists.
