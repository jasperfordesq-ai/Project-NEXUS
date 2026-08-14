# CLAUDE.md - Project NEXUS Shared Accessible Frontend

> **🔴 PAUSE LIFTED for `web-uk` on 2026-08-11 — the ASP.NET fence STAYS.**
>
> This file previously carried a blanket development pause dated 15 July 2026 that
> required a new explicit instruction before any edit. That pause is **lifted for
> `web-uk` only**, by owner decision on 2026-08-11: `web-uk` becomes the production
> accessible frontend and Blade retires.
>
> **What the lift covers:** implementation, tests, documentation and deployment
> *preparation* inside `web-uk/**`.
>
> **What remains fenced, unchanged:**
> - **The ASP.NET backend stays paused**, and its **database boundary stays
>   closed.** Its live database has had no successful backup since 2026-03-08
>   while the application runs migrations on every start, so restarting that
>   service can irreversibly change live data with nothing to restore from.
> - **Nothing is deployed without explicit authorisation.** Building the
>   deployment path is not permission to use it.
> - The read-only Laravel data boundary below still applies.
>
> The original pause record is
> [`../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md`](../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md),
> kept for its cold-start detail. Read
> [`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md)
> first for the current position.

## Shared Accessible Frontend Direction

`web-uk` **is the accessible frontend Project NEXUS is moving to.** The Laravel
Blade accessible frontend retires at the end of the changeover.

🔴 **This paragraph used to say the opposite** — that `web-uk` was not
production-ready and *must not* replace Blade. That was correct while `web-uk` was
an uncertified candidate, and it is superseded. It is called out rather than
quietly deleted because an agent reading the old wording refuses this work.

Being the target does not mean being finished. Current readiness is scored in
`docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`, and the deployment path is **not built
yet**.

### 🔴 The two-phase source-of-truth rule

Which phase we are in is stated in **one** place:
[`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md).
Do not restate it here or anywhere else — that is how status claims go stale.

🔴 **SUPERSEDED 2026-08-13: BLADE IS HISTORIC.** The owner decided that Blade is
falling behind and is no longer the specification. The authority order is now:

1. **GOV.UK Design System + WCAG 2.2** — the presentation authority. How a page
   looks, announces itself, validates and is navigated. Where GDS and any internal
   precedent disagree, **GDS wins**.
2. **`react-frontend/`** — defines WHAT a member can do: features, workflows, states.
3. **The Laravel API** — the contract: methods, paths, payloads, status codes, auth,
   roles, module gates, side effects. Unchanged, and still absolute.
4. **Blade** — historic. Read it only to recover something not yet obtainable from
   React or the API.

🔴 Consequences you must apply:
- **A difference from Blade is NO LONGER automatically a defect.** Blade being
  different may just mean Blade is behind.
- **The route matrix is coverage evidence, not a drift alarm.** A route in Blade and
  absent from `web-uk` is a QUESTION — check React and the API before "closing" it.
- Blade is still **deployed and serving real members**; historic means "not the
  specification", not "switched off". Do not delete it or disable its tests.

The full decision, and what it changes, is recorded once in
[`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md).

The superseded rule is kept below because agents refuse work when they find only the
new wording and remember the old.

**~~Phase A — Blade is still deployed~~ (SUPERSEDED, kept for provenance).** Blade was
the observable-behaviour specification, and the route matrix was a live drift alarm
where a route in Blade and not in `web-uk` was a real gap.

**Phase B — Blade is decommissioned.** `web-uk` owns browser behaviour outright.

**In both phases:** the Laravel backend/API is the contract source of truth for
HTTP methods and paths, request/response shapes, status codes, auth, roles,
modules, uploads, downloads, persistence, and side effects. That never changes.

Authoritative Laravel locations:

```text
accessible-frontend/
routes/govuk-alpha.php
routes/govuk-alpha-parity/
```

These are relative to the monorepo root: Laravel now lives in this same
repository. Before the 2026-08-09 move it was a separate checkout at
`C:\platforms\htdocs\staging`.

This app keeps Express/Nunjucks/GOV.UK Frontend because that is the chosen Web
UK implementation stack, not because ASP.NET defines its behaviour. Every page
must reproduce the Laravel Blade observable behaviour and communicate through
Laravel-identical backend contracts. ASP.NET is a future second backend only;
it must conform to those contracts and must not cause frontend forks. See
`docs/ACCESSIBLE_SHARED_FRONTEND.md` and the root
`../../docs/ACCESSIBLE_SHARED_FRONTEND.md`.

## Non-Negotiable Repository And Data Boundary

- Work only in `web-uk/**` and approved documentation pointers.
- Do not modify ASP.NET controllers, services, entities, tests, or migrations.
- `apps/react-frontend` was deleted on 2026-08-09; do not recreate it.
- Treat `C:\platforms\htdocs\staging` and its ordinary local database as
  read-only. Do not edit Laravel source, run Laravel migrations, alter Laravel
  schema, query the database directly, or perform database cleanup.
- 🔴 **SUPERSEDED 2026-08-13 — a disposable Laravel environment now EXISTS, was
  built at the owner's explicit request, and is deployed-adjacent tooling you
  must not delete.** This bullet used to read: *"Do not provision, request, or
  use a disposable Laravel environment as part of this frontend goal. Do not run
  live login, mutation, upload, download, destructive, or cleanup tests against
  any Laravel environment."* The very next bullet always carried the exception —
  "unless the user explicitly requests it later" — and the owner did exactly
  that, asking for a disposable test environment as the top item of a written
  work list. The old wording is quoted rather than deleted because an agent that
  finds only the new text and remembers the old one refuses the work, or worse,
  "tidies away" `compose.webuk-e2e.yml` and `scripts/webuk-e2e-env.sh`.

  **What is now true:**
  - `bash scripts/webuk-e2e-env.sh up` provisions a SEPARATE Laravel (:8091) on a
    SEPARATE database (`nexus_webuk_e2e`) with its own uploads/storage volumes,
    seeded with synthetic accounts only, plus a `web-uk` on :5181 pointed at it.
  - Login, mutation, upload, download and destructive journeys are **allowed and
    expected there**, and nowhere else.
  - The scripts refuse to run unless every account in the target database is
    synthetic, and the seeding step reads the resolved database name back out of
    the booted framework before writing anything.
- 🔴 **The prohibition that has NOT changed, and is the real rule:** the
  ordinary/shared local Laravel database (`nexus`) is a confidential
  production-derived snapshot and must never be used as a test fixture, never
  written to, and never screenshotted. Treat `C:\platforms\htdocs\staging` and
  that database as read-only. Live Laravel runtime certification remains a
  separate workstream that is not a completion requirement unless asked for.
- Never touch production containers or production data.

Route and backend preparation docs live beside this app:

- `../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` (**read first**: the decision, which
  phase the changeover is in, both public URL shapes, and the open owner
  prerequisites)
- `docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` (**the only current score**; rubric
  `WEBUK-W2-PROD-R1`)
- `docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` (🔴 **RETIRED 2026-08-11.** The W1
  audit trail. Its `663/1000` is not current and must not be quoted as such; its
  next-job order is superseded)
- `docs/CURRENT_WEB_UK_HANDOFF.md` (historical chronological archive only; not
  a resume, queue, count, or scoring source)
- `docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- `docs/BLADE_COMPONENT_PORT_AUDIT.md` (detailed per-page evidence)
- `docs/TENANT_ROUTING_PARITY.md`
- `docs/BACKEND_SWITCHING_CONTRACT.md`
- `docs/MANUAL_ACCESSIBILITY_EVIDENCE.md` (an entry is evidence for exactly the
  page, browser, input method and viewport it names — never a conformance claim)
- `../aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md` (a **different**
  rubric for the paused ASP.NET backend; never a `web-uk` score source, and never
  added to one)
- `../aspnet-backend/docs/PROJECT_PAUSE_HANDOFF_2026-07-15.md` (the original pause
  record, kept for its cold-start detail; the `web-uk` half is lifted, the ASP.NET
  half is not)

Start with the takeover page, then the W2 score, then
`docs/BLADE_COMPONENT_PORT_AUDIT.md` for detailed evidence. Treat
`docs/CURRENT_WEB_UK_HANDOFF.md` as chronological implementation history rather
than a reliable current snapshot.

Generated route-matrix artifacts live under `docs/generated/` and are refreshed
with:

```bash
npm run route:matrix
```

Treat those generated counts as backlog evidence only. They do not certify
workflow parity, tenant routing, auth behavior, API contracts, localization, or
production readiness.

Tenant-routing parity evidence and the current `/accessible` shared-mount
contract live in `docs/TENANT_ROUTING_PARITY.md`. Laravel still names the
internal route set `govuk-alpha`, but its canonical public shared-host mount is
now `/{tenantSlug}/accessible`. Legacy `/{tenantSlug}/alpha` paths should
canonicalize to `/accessible` rather than becoming new public links.

Do not claim route parity, workflow parity, tenant-domain parity, localization
parity, API compatibility, production readiness, or shared-frontend readiness
from skeleton or styling work.

## Current Refresh And Verification Gate

Run the complete current-checkout gate before reporting status, scoring the
work, or publishing a coherent slice. Start at the repository root:

🔴 **This block used to begin `cd C:\platforms\htdocs\nexus-platform-consolidation`
— a git worktree that no longer exists.** It was created for the 2026-08-10
monorepo consolidation, orphaned when that branch merged, and deleted. Working
checkout is `C:\platforms\htdocs\staging`, and worktrees are forbidden here.

Run from the repository root:

```powershell
npm --prefix web-uk run brand:check
npm --prefix web-uk run lint
npm --prefix web-uk test -- --runInBand
npm --prefix web-uk run build:css
npm --prefix web-uk run route:matrix
npm --prefix web-uk run api:ledger
npm --prefix web-uk run locales:audit
npm --prefix web-uk run locales:audit-templates -- --summary
node scripts/check-doc-scores.mjs

git diff --check -- web-uk
```

🔴 **Run `route:matrix` and `api:ledger` back to back.** Regenerating one without
the other leaves the two artefacts naming different commits, so the two sets of
counts describe different code. `check-doc-scores.mjs` fails on exactly that.

The complete `test:accessibility` aggregate includes an authenticated login
journey. A failed login writes Laravel rate-limit/audit state, so that aggregate
is outside this goal and must not be run against Laravel. The same prohibition
applies to `smoke:laravel:local`, every `*:mutation:*` command, authenticated
settings journeys, upload/download checks, and `smoke:federation:local`.
Exercise manual accessibility against the isolated Web UK fixture server and
its mocked states instead. A browser comparison may use Laravel only when its
requests have first been inspected and proved to be unauthenticated GET/HEAD
operations with no server-side state changes; source inspection remains the
authoritative baseline and does not require a running Laravel environment.
`visual:blade` is an optional read-only marker comparison, not a required gate.
It may run only after its Laravel requests are confirmed to be unauthenticated
GET/HEAD operations. Do not start, provision, or modify Laravel merely to run
it. Record exact outcomes; a focused test, stale listener, generated route
count, or historical green run is not a substitute for the required source and
Web UK fixture gates.

## Project Purpose

This is the Laravel-defined shared accessible frontend implementation for
**Project NEXUS Community**. It currently consumes the Laravel backend. Laravel
Blade defines the browser experience and Laravel APIs define the backend
contract. ASP.NET remains a future, not-yet-certified second backend; it must
be externally contract-identical to Laravel rather than define this frontend's
behaviour.

## License and Attribution (MANDATORY)

This software is licensed under the **GNU Affero General Public License v3** (AGPL-3.0-or-later).

### Creator

- **Jasper Ford** - Creator and primary author

### Founders of the Originating Time Bank

- **Jasper Ford**
- **Mary Casey**

### Research Foundation

This software is informed by and builds upon a social impact study commissioned by the **West Cork Development Partnership**.

### Acknowledgements

- **West Cork Development Partnership**
- **Fergal Conlon**, SICAP Manager

### Source File Headers

All new source files MUST include this header:

```javascript
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

For Nunjucks templates:

```nunjucks
{# Copyright © 2024–2026 Jasper Ford #}
{# SPDX-License-Identifier: AGPL-3.0-or-later #}
{# Author: Jasper Ford #}
{# See NOTICE file for attribution and acknowledgements. #}
```

### Key Files

- `LICENSE` - Full AGPL v3 license text
- `NOTICE` - Attribution and credits (must be preserved in all distributions)
- `README.md` - Credits and Origins section
- `/about` - About page with license info (AGPL Section 13 compliance)

### AGPL Compliance Requirements

1. Source code must be made available to network users
2. NOTICE file attributions must be preserved in all copies
3. About page must display license info and source code link

## Development Environment

**Docker is the ONLY supported development environment.**

Do not use XAMPP, native Node.js, or any other local setup. The project directory may be located under `xampp/htdocs` for historical reasons - ignore this; XAMPP is not used.

```
Local Development (Docker) → Test → Local production-image verification

Future deployment is a separate, explicitly authorized operation governed by
the root production-container map; it is not a continuation of this local flow.
```

### Why Docker Only?

1. **Consistency** - Repeatable development and local verification environments
2. **No dependency conflicts** - Node.js, Sass, etc. are containerized
3. **Simple onboarding** - Just `docker compose up`
4. **Production-like image check** - validates the local image shape without
   claiming production topology or deployment certification

### Development Commands

```bash
# Start development environment
docker compose up -d

# View logs (live)
docker compose logs -f nexus-webuk

# Restart after code changes (hot reload usually handles this)
docker compose restart nexus-webuk

# Full rebuild (after package.json or Dockerfile changes)
docker compose down && docker compose up --build -d

# Stop
docker compose down
```

The app runs at **http://localhost:5180** (container port 3001 mapped to host 5180).

### Production Deployment

**`web-uk` is the accessible frontend that will be deployed. It is not deployed
yet, and this file does not authorize deploying it.** Do not copy files to a
server, run production Compose commands, or touch a production container from
this workstream. Building the deployment path is not permission to use it.

Open prerequisites and their current state are listed in
[`../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md`](../docs/ACCESSIBLE-FRONTEND-TAKEOVER.md).

🔴 **Two corrections to what this section used to say.**

- It made deployment conditional on reading a repository-root
  `.claude/production-containers.md`. **That file was never imported into this
  monorepo**, so the hold it describes cannot be lifted as written. It is a
  recorded open prerequisite: either import it, or supersede it with a section in
  `docs/DEPLOYMENT.md` at the repository root.
- It described a **root `compose.prod.yml`** overriding `web-uk`'s backend to the
  ASP.NET service. **There is no root `compose.prod.yml`** — the only file of that
  name is `aspnet-backend/compose.prod.yml`, which belongs to the paused ASP.NET
  workstream and is not a `web-uk` deployment path. The substantive warning still
  stands: nothing here is evidence that `web-uk` can run against ASP.NET.

## CRITICAL: NOT A GOVERNMENT SERVICE (NON-NEGOTIABLE)

**This project is NOT a UK government service and is NOT endorsed by the UK Government.**

We use the GOV.UK Design System (govuk-frontend) for its accessibility and usability patterns only. We are an independent community project.

### Branding Rules (LEGALLY REQUIRED - DO NOT VIOLATE)

1. **NO crown logo** - Never use the GOV.UK crown, crest, Royal Arms, or any government marks
2. **NO GOV.UK header** - Never use `govukHeader` macro; always use custom header in `base.njk`
3. **NO government branding** - No "GOV.UK" text in headers, footers, or anywhere implying government affiliation
4. **NO government copyright wording** - No "Crown copyright", no Open Government Licence text or logo, no OGL class
5. **Custom header/footer only** - See `src/views/layouts/base.njk` and `src/views/partials/footer.njk`
6. **NO GDS Transport font** - the Sass override to a system font stack stays

### The header non-affiliation disclosure was REMOVED (owner decision, 2026-08-11)

This section previously required "Not affiliated with GOV.UK" in the header and
called it mandatory. It is **no longer required and is no longer rendered**.

Why the removal was correct, so nobody reinstates it by reflex:

- **Laravel Blade never had it.** `accessible-frontend/` — the declared source of
  truth for the browser experience — carries no such disclosure anywhere, so
  keeping it made the two accessible frontends disagree on their own header.
- **The licence does not ask for it.** `govuk-frontend` declares `license: MIT`
  in `package.json`, and its README states the codebase and sample code are MIT
  while documentation prose is Crown copyright under OGL v3.0. MIT requires the
  licence notice be **retained**; neither licence requires a visible statement
  **disclaiming** affiliation. This project uses the code, not the prose.

What actually protects the position — and none of it was weakened:

- no crown, crest or Royal Arms; no GOV.UK logotype;
- no `govukHeader` / `govukFooter` macro, no footer identity;
- no GDS Transport font;
- no government copyright or licence wording;
- a custom `nexus-alpha-header` carrying the tenant's own brand.

`scripts/brand-check.js` still enforces all of the above and remains BLOCKING. It
no longer asserts the disclosure, and a test now asserts the string stays
**absent**, so re-adding it silently fails rather than passing quietly. Reinstate
it only on a new explicit decision, recorded here.

🔴 The residual risk was never the licence — it is passing off, i.e. *looking*
like an official government service. That is managed by the list above. Adding
the crown or the official header would create real exposure; removing a
disclaimer from a site that already avoids every government mark does not.

### What We CAN Use

- GOV.UK Design System typography, colours, spacing
- GOV.UK component patterns (buttons, inputs, tables, error summaries, etc.)
- GOV.UK layout grid system
- Accessibility patterns from the Design System

## Stack (DO NOT DEVIATE)

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express | 4.x | Web framework |
| Nunjucks | 3.x | Templating |
| govuk-frontend | 6.x | Design system (styles + components) |
| Dart Sass | 1.x | CSS compilation |
| Helmet | 7.x | Security headers |
| csrf-csrf | 3.x | CSRF protection |
| express-rate-limit | 7.x | Rate limiting |
| express-session | 1.x | Session management |
| express-flash | 0.x | Flash messages |
| Morgan | 1.x | Request logging |

**No React. No Next.js. No alternative CSS frameworks. SSR HTML only.**

## Laravel Blade Visual Rules And Historical Candidate Notes

The design rules below remain maintained. Detailed page/candidate descriptions
in this section are historical implementation notes, not a current gap count or
resume queue. The canonical current status and generated route/API inventories
override them. Refresh source and those artifacts before relying on an
individual candidate statement in a future authorized phase.

The Web UK accessible frontend must not invent a separate visual language.
Follow the Laravel Blade accessible frontend for:

- custom `nexus-alpha-header`;
- dark header and accent strip;
- lean GOV.UK service navigation;
- no-JS language selector, including preserving scalar non-`locale` query
  parameters as hidden inputs like the Blade layout;
- tenant bootstrap module/feature gates for shared service navigation and the
  footer Platform column, matching Laravel Blade's Dashboard, Feed, Listings,
  Members, Events, Volunteering, and Blog visibility rules;
- tenant bootstrap module/feature gates for Explore cards, matching Laravel
  Blade candidate semantics: Search and Skills remain card-visible, Exchanges
  require listings plus broker exchange workflow config, and Clubs require
  explicit active-club evidence before being shown;
- `nexus-alpha-card-list` and `nexus-alpha-card`;
- footer columns and AGPL/source metadata;
- Explore as the gateway to discovery modules.
- My account as a Blade-style protected hub. `/account` redirects unsigned
  users to `/login?status=auth-required`, then builds the full Blade-aligned
  link inventory from `src/lib/account-links.js`, applying Laravel tenant
  module/feature gates and the exact direct-messaging configuration. Live
  per-tenant gate coverage and ASP.NET contract-identity proof remain separate
  certification work.
- Cookie banner and settings as a Blade-style no-JS candidate. The shell renders
  the GOV.UK cookie banner before the skip link until the Laravel-compatible
  `nexus_accessible_cookie_consent` cookie is present, while legacy
  `nexus_alpha_cookie_consent` values are still accepted as a read-only
  fallback. `/cookies` renders the analytics yes/no settings form, and
  `POST /cookie-consent` stores `all` or `essential` locally under the cleaner
  accessible cookie name. Laravel `cookie_consents` audit persistence, tenant
  scoping, localization, and ASP.NET contract identity are not certified.
- Volunteering as a Blade-style public landing/search candidate. The GET route
  reads `/api/v2/volunteering/opportunities` with search, category, remote, and
  cursor parameters, and renders the Blade public structure: organisation link,
  how-it-works guidance, auth-required notice, filter form, opportunity cards,
  and load-more link. The opportunity detail GET reads
  `/api/v2/volunteering/opportunities/{id}` and renders the Blade-style public
  detail, summary fields, available shifts, and safe apply link. Applications,
  recommended shifts, hours, organisation owner tools, apply POST, shift signup,
  feature gates, tenant routing, and auth redirects still need certification.
- Organisations as a Blade-style directory/search/registration candidate. The
  directory and browse GETs now read the Laravel
  `/api/v2/volunteering/organisations` collection, register GET renders the
  Blade-style form, manage GET reads
  `/api/v2/volunteering/my-organisations` when signed in, and detail GET reads
  `/api/v2/volunteering/organisations/{id}?include=public_contract` plus
  `/api/v2/volunteering/opportunities?organization_id={id}` and
  `/api/v2/volunteering/reviews/organization/{id}` for depth sections. The
  organisation jobs GET reads `/api/v2/jobs?organization_id={id}&status=open`
  when signed in. The organisation opportunity apply GET reads
  `/api/v2/volunteering/opportunities/{id}` and renders the Blade-style
  confirmation page; register POST, apply POST, auth redirects, tenant,
  feature-gate, and depth behavior still need certification.

Reusable shell data lives in `src/lib/accessible-shell.js`. Keep shared nav,
footer, locale, and Explore link contracts there rather than hardcoding new
copies into individual templates.

Header and footer links must mirror the Laravel Blade accessible frontend labels
and information architecture. If a Laravel destination is not implemented yet,
record it as an incomplete route/workflow and implement the real page; do not
substitute a generic preparation page as parity evidence.

## Backend Switching Contract

Build one backend-neutral accessible frontend against Laravel's contract. Do
not add ASP.NET-specific Nunjucks, route, validation, redirect, or workflow
branches. When the separate ASP.NET contract-identity workstream is ready, change only the
backend configuration and rerun the same unchanged Web UK evidence suite. See
`docs/BACKEND_SWITCHING_CONTRACT.md`.

## Backend API

- Backend target config lives in `src/lib/backend-contract.js`.
- Default target: Laravel (`ACCESSIBLE_BACKEND_TARGET=laravel`).
- Default Laravel base URL: `http://127.0.0.1:8090`, matching the local Laravel
  staging `.env`.
- `ACCESSIBLE_BACKEND_TARGET=aspnet` is future work only and is marked
  `future-not-certified`.
- `API_BASE_URL` remains an explicit override and is labelled as
  `api-base-url` by the resolver; it does not certify ASP.NET contract identity or
  replace Laravel as the source of truth. Laravel-first work should prefer
  `LARAVEL_BASE_URL`.
- See the root `docs/API_PARITY.md` for API parity status and this file's endpoint table for routes used by this frontend.

### Current Laravel Contracts Used

`src/lib/api.js` inventories Web UK's current consumers; Laravel remains
authoritative for the contracts themselves. This table records core contracts
that are easy to regress, while module-specific helpers cover the rest. Most
authenticated calls send `Authorization: Bearer {token}`. Request-scoped tenant
authority adds `X-Tenant-Slug` when there is no bearer, explicit tenant header,
or Host/Origin tenant context. The fallback order is routed lowercase slug,
configured `ACCESSIBLE_TENANT_SLUG`, then legacy `TENANT_ID`.

| Area | Endpoint | Method | Current use |
|------|----------|--------|-------------|
| Auth | `/api/auth/login` | POST | Login with routed tenant context; returns tokens or a two-factor challenge |
| Auth | `/api/auth/validate-token` | GET | Validate a bearer token for role-protected routes |
| Registration | `/api/v2/auth/registration-info` | GET | Read tenant registration policy before rendering or submitting |
| Registration | `/api/v2/auth/register` | POST | Create a pending account using the Laravel v2 registration payload |
| Registration | `/api/v2/auth/validate-invite` | POST | Validate an invite code for the routed tenant |
| Auth | `/api/auth/refresh-token` | POST | Exchange `{ refresh_token }` for a new token envelope |
| Auth | `/api/auth/logout` | POST | Revoke the current bearer token server-side |
| Two-factor login | `/api/totp/verify` | POST | Verify `{ two_factor_token, code }` with routed tenant authority |
| Password recovery | `/api/auth/forgot-password` | POST | Request reset email; tenant authority is `X-Tenant-Slug` |
| Password recovery | `/api/auth/reset-password` | POST | Submit `{ token, password, password_confirmation }` |
| Profile | `/api/v2/users/me` | GET / PUT | Read or update the current profile |
| Profile | `/api/v2/users/me/avatar` | POST | Upload the current member's avatar as multipart data |
| Members | `/api/v2/users` | GET | Directory using `q`, `sort`, `order`, `limit`, and `offset` |
| Members | `/api/v2/users/{id}` | GET | Read a member profile |
| Listings | `/api/v2/listings` | GET / POST | Public list read and authenticated core create |
| Listings | `/api/v2/listings/{id}` | GET / PUT / DELETE | Public detail read and authenticated owner update/delete |
| Listings | `/api/v2/listings/{id}/tags` | PUT | Save enabled skill tags after core persistence |
| Listings | `/api/v2/listings/{id}/image` | POST | Upload a listing cover as multipart data |
| Events | `/api/v2/events` | GET / POST | Public list read and authenticated create |
| Events | `/api/v2/events/{id}` | GET / PUT / DELETE | Public detail read and authenticated organiser update/delete |
| Events | `/api/v2/events/{id}/cancel` | POST | Cancel an event with a reason payload |
| Wallet | `/api/v2/wallet/balance` | GET | Read the current balance |
| Wallet | `/api/v2/wallet/transactions` | GET | Cursor-paginated transaction history |
| Wallet | `/api/v2/wallet/transfer` | POST | Send `recipient`, `amount`, `description`, and `idempotency_key` |
| Messages | `/api/v2/messages` | GET / POST | Cursor-paginated conversations and direct-message send |
| Messages | `/api/v2/messages/{userId}` | GET | Read a direct conversation, including older-message cursors |
| Messages | `/api/v2/messages/{userId}/read` | PUT | Mark the direct conversation read |
| Messages | `/api/v2/messages/unread-count` | GET | Read the message badge count |
| Connections | `/api/v2/connections` | GET | Cursor-paginated accepted/pending network rows |
| Connections | `/api/v2/connections/pending` | GET | Pending connection counts/rows |
| Connections | `/api/v2/connections/request` | POST | Send `{ user_id }` connection request |
| Connections | `/api/v2/connections/status/{userId}` | GET | Read exact current connection state |
| Connections | `/api/v2/connections/{id}/accept` | POST | Accept a connection request |
| Connections | `/api/v2/connections/{id}/decline` | POST | Decline a connection request |
| Connections | `/api/v2/connections/{id}` | DELETE | Remove or cancel a connection |
| Notifications | `/api/v2/notifications/grouped` | GET | Normal grouped inbox with cursor pagination |
| Notifications | `/api/v2/notifications` | GET / DELETE | Ungrouped unread filtering, or delete all notifications |
| Notifications | `/api/v2/notifications/counts` | GET | Read unread/count badge data |
| Notifications | `/api/v2/notifications/{id}/read` | POST | Mark one notification read |
| Notifications | `/api/v2/notifications/read-all` | POST | Mark all notifications read |
| Notifications | `/api/v2/notifications/group/read` | POST | Mark a notification group read |
| Notifications | `/api/v2/notifications/{id}` | DELETE | Delete one notification |
| Resources | `/api/v2/resources` | GET / POST | Cursor-paginated list or multipart upload |
| Resources | `/api/v2/resources/{id}` | DELETE | Delete an authorized resource |
| Exchanges | `/api/v2/exchanges/config` | GET | Read workflow and messaging config; consumers fail closed |
| Exchanges | `/api/v2/exchanges` | GET / POST | Cursor-paginated list or listing exchange request |
| Exchanges | `/api/v2/exchanges/{id}/{action}` | POST | Accept, decline, start, complete, or confirm |
| Exchanges | `/api/v2/exchanges/{id}` | GET / DELETE | Read or cancel an exchange |
| Reviews | `/api/v2/reviews` | POST | Create a review |
| Reviews | `/api/v2/reviews/user/{userId}`, `/api/v2/reviews/given`, `/api/v2/reviews/pending` | GET | Received, given, and pending review collections |
| Reviews | `/api/v2/reviews/{id}` | GET / DELETE | Read or delete a review |
| Discussion | `/api/v2/comments` | GET / POST | Read or create target comments and replies |
| Discussion | `/api/v2/comments/{id}` | PUT / DELETE | Edit or delete an owned comment |
| Discussion | `/api/v2/reactions` | POST | Toggle a reaction |

### Authentication Flow

1. The route resolves the authoritative tenant, then submits login to
   `POST /api/auth/login` with `X-Tenant-Slug` and the Laravel login payload.
2. A normal success returns `access_token` and `refresh_token`. A
   `requires_2fa` response stores only the short-lived challenge token plus its
   tenant slug in the Express session and continues through
   `POST /api/totp/verify`.
3. Successful access and refresh tokens are stored in HTTP-only, signed,
   SameSite=Lax cookies named `token` and `refresh_token`; the selected tenant
   slug is stored in the signed `tenant_slug` cookie.
4. Authenticated API calls send `Authorization: Bearer {token}`.
5. When an access token is absent but a refresh cookie exists, or a wrapped API
   call returns 401, auth middleware calls `POST /api/auth/refresh-token` with
   `{ refresh_token }`.
6. A successful refresh replaces the cookies and a 401-wrapped handler retries
   once with the new bearer token. Refresh attempts are locked per refresh
   token to avoid concurrent cross-request races.
7. A missing or failed refresh clears `token`, `refresh_token`, and
   `tenant_slug`, then redirects through the tenant-aware URL helper to login.
8. Logout calls `POST /api/auth/logout` before clearing local auth state.

### Password Reset Flow

1. The user submits local `POST /login/forgot-password`; Web UK calls
   `POST /api/auth/forgot-password` with `{ email }` and the authoritative
   `X-Tenant-Slug` header.
2. The response remains enumeration-safe while Laravel sends any eligible
   reset email.
3. The email returns the user to local
   `GET /password/reset?token=...`.
4. Local `POST /password/reset` calls `POST /api/auth/reset-password` with
   `{ token, password, password_confirmation }`.
5. Success stores the neutral `password-reset` status and redirects to the
   tenant-aware login page.

## Key Files

| File | Purpose |
|------|---------|
| `src/server.js` | Express application with all middleware |
| `src/lib/api.js` | API client for backend calls |
| `src/lib/backend-contract.js` | Laravel-primary backend resolver; ASP.NET is future-not-certified |
| `src/lib/request-tenant-context.js` | Request-scoped tenant slug propagation for API calls |
| `src/middleware/request-tenant-context.js` | Seeds request tenant context after tenant routing |
| `src/lib/account-links.js` | Blade-aligned, tenant-gated account hub inventory |
| `src/middleware/auth.js` | Authentication middleware |
| `src/routes/auth.js` | Auth routes (login, register, logout, forgot/reset password) |
| `src/routes/listings.js` | Listings CRUD routes |
| `src/routes/connections.js` | Connections routes |
| `src/routes/members.js` | Members directory routes |
| `src/routes/notifications.js` | Notifications routes |
| `src/routes/profile.js` | Profile routes |
| `src/views/layouts/base.njk` | Base template with custom header (NO crown) |
| `src/views/partials/footer.njk` | Custom footer (NO crown) |
| `src/assets/scss/main.scss` | Sass entry point |
| `public/css/main.css` | Compiled CSS output (generated, do not edit) |

## Security Features

| Feature | Implementation |
|---------|----------------|
| CSRF Protection | Double-submit cookie via `csrf-csrf` |
| Security Headers | Helmet.js with CSP |
| Rate Limiting | 100 req/15min (general), 10 req/15min (auth) |
| Cookie Security | HTTP-only, signed, SameSite=Lax |
| Session Timeout | 30 minutes |
| Input Validation | Server-side with GOV.UK error patterns |

## Docker Commands Reference

```bash
# Start development environment
docker compose up -d

# View logs
docker compose logs -f nexus-webuk

# Restart container
docker compose restart nexus-webuk

# Full rebuild (after package.json or Dockerfile changes)
docker compose down && docker compose up --build -d

# Stop
docker compose down

# Check container health
docker compose ps
```

See the root [agent instructions](../CLAUDE.md) for the Docker-only project invariant and production-container warnings.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3001 | Server port |
| `ACCESSIBLE_BACKEND_TARGET` | No | laravel | Backend contract target. `aspnet` is future/not-certified only. |
| `LARAVEL_BASE_URL` | No | http://127.0.0.1:8090 | Laravel backend base URL used by default. |
| `ASPNET_BASE_URL` | No | http://localhost:5080 | Future ASP.NET backend base URL when explicitly selected. |
| `API_BASE_URL` | No | - | Explicit backend URL override. Labelled as `api-base-url`; does not certify ASP.NET contract identity. Prefer `LARAVEL_BASE_URL` for Laravel-first work. |
| `COOKIE_SECRET` | **Yes** | - | Secret for signed cookies |
| `SESSION_SECRET` | No | COOKIE_SECRET | Secret for sessions |
| `NODE_ENV` | No | development | Environment |
| `TURNSTILE_SITE_KEY` | No | - | Cloudflare Turnstile site key. Renders the challenge on the **contact** form only — `POST /api/v2/contact` is the one Laravel endpoint that enforces it. Unset ⇒ no widget. There is deliberately no secret key here: Laravel verifies. |

## Nunjucks Configuration

Per official GOV.UK Frontend docs, Nunjucks paths include:
1. `src/views` - Our templates
2. `node_modules/govuk-frontend/dist` - GOV.UK Frontend templates/macros

## Sass Configuration

Uses Dart Sass with `--load-path=node_modules/govuk-frontend/dist` and `--quiet-deps`.

Import in `main.scss`:
```scss
@use "govuk/index" as *;  // Modern Sass syntax (not deprecated @import)
```

## JavaScript Initialization

Per official GOV.UK Frontend docs, JS uses ES modules:
```html
<script type="module" src="/js/govuk-frontend.min.js"></script>
<script type="module">
  import { initAll } from '/js/govuk-frontend.min.js'
  initAll()
</script>
```

## Common Patterns

### Adding CSRF to Forms
```njk
<form method="post">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
  <!-- form fields -->
</form>
```

### Error Handling in Routes
```javascript
router.get('/example', asyncRoute(async (req, res) => {
  const result = await getExample(req.token);
  return res.render('example', { result });
}, {
  redirectOn401: '/login?status=auth-required',
  notFoundTitle: 'Example not found'
}));
```

`asyncRoute()` delegates to `handleApiError()`, which clears all auth cookies
and resolves redirects through the active tenant URL helper. Wrap a handler in
`withTokenRefresh()` when a 401 should first refresh through
`POST /api/auth/refresh-token` and retry once.

### Flash Messages
```javascript
// In route
req.flash('success', 'Listing created successfully');
res.redirect(res.locals.urlFor('/listings'));

// In template
{% if successMessage %}
  {{ govukNotificationBanner({ type: "success", html: successMessage }) }}
{% endif %}
```

### GOV.UK Error Summary
```njk
{% if errors and errors.length %}
  {{ govukErrorSummary({
    titleText: "There is a problem",
    errorList: errors
  }) }}
{% endif %}
```

## Backend Credentials And Safe Fixtures

Web UK has no canonical live-login credentials. Source-owned and manual
accessibility work must use Web UK-owned fixtures and mocks. The fictitious
ASP.NET Development seed identities documented by the root local-development
guide are relevant only to a separately authorized backend-switching phase;
they must not be used as a Laravel-first baseline or against any ordinary
Laravel environment. Never seek production credentials from this guide.
