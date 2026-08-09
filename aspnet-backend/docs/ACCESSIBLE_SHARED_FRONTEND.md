# Accessible Shared Frontend Direction

Last reviewed: 2026-07-14

Status: **Maintained reference — current shared-frontend direction, not readiness status**

## Decision

`apps/web-uk/` is the implementation target for Project NEXUS's future shared
accessible frontend. It keeps the chosen Web UK stack:

- Express
- Nunjucks
- GOV.UK Frontend
- server-rendered HTML
- progressive enhancement only

There are two Laravel sources of truth, separated by responsibility:

- Laravel Blade is the product/UI source for browser routes, links, layout,
  navigation, content hierarchy, forms, validation presentation, redirects,
  tenant behaviour, and workflows.
- The Laravel backend/API is the contract source for HTTP methods and paths,
  payloads, envelopes, status codes, auth, roles, modules, uploads, downloads,
  persistence, and side effects.

Together they define the observable product contract Web UK must reproduce.
ASP.NET is not authoritative for this frontend; its separate contract-identity
workstream must make it externally contract-identical to Laravel before
unchanged-frontend switching can be certified.

Laravel source of truth:

```text
C:\platforms\htdocs\staging\accessible-frontend
C:\platforms\htdocs\staging\routes\govuk-alpha.php
C:\platforms\htdocs\staging\routes\govuk-alpha-parity
```

Web UK implementation target:

```text
C:\platforms\htdocs\asp.net-backend\apps\web-uk
```

## Current Status

Implementation is advanced but certification is incomplete. Static route or
test counts do not certify production readiness, workflow parity,
tenant-domain parity, auth parity, localization parity, manual accessibility,
or complete API/side-effect compatibility.

Current local preparation docs in `apps/web-uk/docs/`:

- `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` (read first; only current score and queue)
- `LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- `BLADE_COMPONENT_PORT_AUDIT.md`
- `BACKEND_SWITCHING_CONTRACT.md`

The React utility-bar link must continue pointing at the production Laravel
accessible frontend until `apps/web-uk` has passed route, workflow, accessibility,
tenant, auth, and runtime smoke certification.

## Repository And Data Boundary

- Web UK work changes `apps/web-uk/**` and approved documentation pointers only.
- Do not modify ASP.NET controllers, services, entities, tests, migrations,
  schema, fixtures, or runtime data from this workstream.
- `apps/react-frontend` was deleted on 2026-08-09; do not recreate it.
- Treat `C:\platforms\htdocs\staging` and its ordinary local database as
  read-only: no source edits, migrations, schema repair, direct database
  queries, or cleanup.
- Mutation/upload/download/destructive certification requires a dedicated
  disposable Laravel environment provisioned separately from the ordinary
  local database. The ordinary database is a confidential production-derived
  snapshot; fixture cleanup is not permission to write to it.
- Never touch production containers or production data.

## Official GOV.UK Sources

Use the public GOV.UK sources as upstream references:

- `alphagov/govuk-frontend`: https://github.com/alphagov/govuk-frontend
- `alphagov/govuk-design-system`: https://github.com/alphagov/govuk-design-system
- GOV.UK Design System: https://design-system.service.gov.uk/
- GOV.UK Frontend technical docs: https://frontend.design-system.service.gov.uk/

`govuk-frontend` is the reusable package for service teams. The GOV.UK Design
System website points implementation reuse to `govuk-frontend`.

## Branding Rules

Project NEXUS is not a UK government service.

Do not use:

- GOV.UK crown, crest, Royal Arms, or logotype
- `govukHeader` macro
- `govukFooter` macro
- Open Government Licence block or Crown copyright wording
- public wording that says or implies this is a GOV.UK service

Do use:

- GOV.UK typography, spacing, grid, forms, tables, buttons, summaries, phase
  banner, service navigation, skip link, and accessibility patterns
- custom Project NEXUS header and footer
- AGPL/source attribution required by this project

## Product/UI Source Of Truth

The Web UK accessible frontend must visually and behaviourally follow the Laravel Blade
accessible frontend, especially:

- custom `nexus-alpha-header`
- dark header and accent strip
- tenant/service brand area
- no-JS language selector
- lean GOV.UK service navigation
- "My account" header link when signed in
- phase banner below navigation
- `nexus-alpha-card-list` and `nexus-alpha-card`
- footer columns and AGPL/source metadata
- Explore page as the gateway to discovery modules

Do not invent a separate visual language in `apps/web-uk`.

## Future Repository Plan

When route/workflow parity matures, `apps/web-uk` may move into its own
repository as the shared accessible frontend. Before that move, this folder must
have its own `AGENTS.md`, `CLAUDE.md`, README, docs, tests, and versioned
contract notes so agents can work safely after extraction.

## Acceptance Gates Before Shared Use

- Route matrix maps every Laravel `govuk-alpha*` route to an `apps/web-uk`
  route, intentional redirect, or documented replacement.
- Runtime smoke tests cover tenant resolution, auth redirects, CSRF forms,
  feature gates, and key workflows.
- Rendered pages pass accessibility smoke checks.
- API calls used by `apps/web-uk` match the canonical Laravel contracts.
- After separate ASP.NET contract identity is complete, the same unchanged Web UK suite
  passes against ASP.NET by changing backend configuration only.
- The React utility-bar link is changed only after the shared accessible frontend
  has a production deployment path and rollback plan.
