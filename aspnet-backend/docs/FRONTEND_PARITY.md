# Frontend Route Parity Map

Last reviewed: 2026-07-14

Status: **Maintained reference — current policy with historical route snapshots**

Evidence provenance: the current policy was reviewed on 2026-07-14 against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and repository commit
`9c5fb1a46c40e4986c8f973075164b1d74bd101d`. The legacy tables below did not
record both input SHAs and are therefore historical and provenance-incomplete;
they cannot support a current parity percentage. Use the generated Web UK
artifacts only when their own metadata names the exact source commits and dirty
state.

Laravel source of truth:

- `C:\platforms\htdocs\staging\react-frontend`
- `C:\platforms\htdocs\staging\accessible-frontend`
- `C:\platforms\htdocs\staging\routes\govuk-alpha.php`
- `C:\platforms\htdocs\staging\routes\govuk-alpha-parity`

Repository surfaces:

- `apps/react-frontend` was deleted on 2026-08-09. This repository contains no
  React frontend and must not have one reintroduced.
- `apps/web-uk` is the implementation target for the future shared accessible
  frontend. Its location in this repository does not make ASP.NET authoritative
  for its behaviour.
- `apps/admin` was retired and deleted on 2026-08-09; the admin panel lives in
  the canonical React frontend in the staging repository.

Canonical React frontend target:

- `C:\platforms\htdocs\staging\react-frontend`

The forward path is not to continue developing the ASP.NET React copy. The
forward path is to make the ASP.NET backend externally contract-identical for the
production Laravel React frontend. Do not modify frontend files unless the user
explicitly approves that specific frontend change.

## Two-Frontends-By-Two-Backends Target

| Frontend | Laravel backend | ASP.NET backend |
| --- | --- | --- |
| Canonical React | Production source-of-truth baseline | Same unchanged frontend, externally contract-identical and runtime-certified |
| Shared accessible Web UK | Laravel-first implementation and certification target | Same unchanged Web UK code, switched by configuration only after backend certification |

Route declaration equality alone proves none of these four runtime combinations.
Current workstream status lives in `CURRENT_ASPNET_CONTRACT_STATUS.md` and
`../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`.

## Historical Static Route Counts

Generated with `scripts/compare-laravel-frontend-parity.ps1` on 2026-07-04.
These historical accessible counts are superseded for current Web UK work by
`apps/web-uk/docs/generated/accessible-route-matrix.*`.

| Surface | Laravel source routes | .NET target routes | Matched | Missing from .NET | Extra in .NET |
| --- | ---: | ---: | ---: | ---: | ---: |
| React SPA/admin | 589 | 462 | 393 | 196 | 69 |
| Accessible HTML | 607 | 136 | 53 | 554 | 83 |

These counts are not a frontend parity score. The comparison is a static route
inventory using React Router `<Route path="...">`, Laravel GOV.UK route files,
and Express `app/router` declarations. It does not prove rendered UI parity,
feature-gate parity, API wiring, localization, accessibility quality, or workflow
completion.

The historical script compared Laravel React routes against the legacy
`apps/react-frontend` copy and accessible routes against `apps/web-uk`. Since
that copy was deleted on 2026-08-09, its side of the React comparison now
always resolves empty — the scripts are guarded and still run, but their React
route and localization deltas are meaningless and should be read as
"no .NET-side React frontend exists" rather than as a parity gap. The accessible
`apps/web-uk` comparison is unaffected.

Future compatibility reports should instead inventory API calls made by
`C:\platforms\htdocs\staging\react-frontend`, then verify that ASP.NET exposes
compatible routes, request shapes, response shapes, auth/tenant behavior,
uploads, realtime config, and status codes.

The `608/612` Web UK matrix recorded after merge commit `f7c80d32` on
2026-07-08 is also historical. For the current matrix and its exact source SHAs,
read `../../web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` and regenerate
`../../web-uk/docs/generated/accessible-route-matrix.*`. A current static matrix
still does not prove rendered UI, workflow, tenant/auth, localization, API side
effects, or Laravel/ASP.NET runtime behavior.

## Accessible Frontend Direction And Authority

Laravel Blade is the product/UI source of truth for browser routes, links,
layout, navigation, content hierarchy, forms, validation presentation,
redirects, tenant behaviour, and workflows:

```text
C:\platforms\htdocs\staging\accessible-frontend
C:\platforms\htdocs\staging\routes\govuk-alpha.php
C:\platforms\htdocs\staging\routes\govuk-alpha-parity
```

The Laravel backend/API is separately authoritative for HTTP methods and paths,
payloads, response envelopes, status codes, auth, roles, modules, uploads,
downloads, persistence, and side effects.

`apps/web-uk` keeps Express/Nunjucks/GOV.UK Frontend and is being completed as
the future shared accessible frontend. ASP.NET is an incomplete future second
backend, not a frontend source of truth. It must be made externally
contract-identical by
the separate backend workstream; Web UK must not acquire backend-specific page
or workflow branches. Current implementation does not itself prove production
readiness. The React utility-bar accessible link must continue
pointing at the production Laravel accessible frontend until `apps/web-uk` has
passed route, workflow, tenant-domain, auth, localization, accessibility, and
runtime smoke certification.

The Laravel repository, schema, and ordinary local database are read-only from
the Web UK workstream. Mutation, upload, download, and destructive certification
require a separately provisioned, verified disposable Laravel environment. The
ordinary production-derived local database is never a test fixture;
no cleanup plan creates an exception. Web UK work must not modify ASP.NET
backend source, tests, migrations, schema, fixtures, or runtime data.

## Generated Artifacts

The maintained canonical React backend-contract inventory is generated from the
unchanged frontend at `C:\platforms\htdocs\staging\react-frontend` and records
both Laravel and ASP.NET route/method evidence:

```text
docs/generated/canonical-react-contracts/README.md
docs/generated/canonical-react-contracts/canonical-react-api-contract-matrix.csv
docs/generated/canonical-react-contracts/canonical-react-api-contract-summary.json
```

Regenerate it at named source SHAs with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-canonical-react-contract-matrix.ps1
```

This inventory is static evidence only. Rows with inferred or unresolved methods
still require payload, envelope, status, auth, tenant, upload, side-effect, and
unchanged-client runtime verification before they can bank semantic or
certification points.

The older frontend route-only comparator writes these ignored artifacts by
default:

```text
artifacts/parity/frontend/frontend-parity.json
artifacts/parity/frontend/frontend-parity.csv
artifacts/parity/frontend/frontend-parity.md
```

Run the fixture test before relying on a regenerated report:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-frontend-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-frontend-parity.ps1
```

## High-Risk Missing React Families

This section is historical. It shows what the old ASP.NET React fork was missing
at the time of the route scan. That fork no longer exists — it was deleted on
2026-08-09 — so these gaps are not actionable and must not be "closed" by
recreating it. Implement the ASP.NET backend endpoints required by the canonical
Laravel React frontend instead.

| Route family | Missing routes | Parity implication |
| --- | ---: | --- |
| `admin/*` | 63 | Admin modules still have major route gaps, especially caring, marketplace, national KISS, and operations. |
| `super-admin/*` | 25 | Platform-level administration remains incomplete. |
| `caring-community/*` | 24 | Member-facing Caring Community route set is mostly absent in .NET React. |
| `broker/*` | 9 | Broker/admin route ownership needs reconciliation. |
| `courses/*` | 9 | Course frontend remains a module gap. |
| `podcasts/*` | 4 | Podcast frontend remains a module gap. |

## Historical High-Risk Missing Accessible Families

This table is retained only as the first static scan's history. It is not the
current Web UK queue; use the Laravel-first status document.

| Route family | Missing routes | Parity implication |
| --- | ---: | --- |
| `volunteering/*` | 52 | `apps/web-uk` lacks most Laravel accessible volunteering workflows. |
| `marketplace/*` | 48 | Accessible marketplace workflow coverage is mostly missing. |
| `jobs/*` | 38 | Accessible jobs workflow coverage is incomplete. |
| `ideation/*` | 34 | Accessible ideation workflow coverage is incomplete. |
| `federation/*` | 28 | Federation accessible/admin-adjacent routes need mapping. |
| `goals/*` | 27 | Goals accessible workflow coverage is incomplete. |
| `groups/*` | 27 | Group accessible workflow coverage is incomplete. |
| `courses/*` | 26 | Accessible course workflows are absent from .NET. |
| `feed/*` | 21 | Accessible feed workflows are substantially incomplete. |
| `profile/*` | 20 | Profile/account accessible routes need parity work. |

## Acceptance Criteria For Frontend Parity

- The production Laravel React frontend at
  `C:\platforms\htdocs\staging\react-frontend` can run against ASP.NET for the
  certified module without request/response contract failures.
- Every Laravel React API call used by the certified module has a matching
  ASP.NET method/path, including `/api/v2` aliases where expected.
- Request bodies, query parameters, response envelopes, pagination, validation
  errors, auth/tenant errors, upload behavior, realtime config, and status codes
  are compatible with Laravel.
- Every Laravel accessible route under `govuk-alpha*` has an equivalent
  `apps/web-uk` route, view, form method, validation behavior, and API support.
- Admin, super-admin, partner, broker, and accessible surfaces are tracked
  independently.
- Compatibility is proven with a route/API matrix, ASP.NET regression tests, and
  runtime smoke tests using the Laravel React frontend against the ASP.NET API.
- The same unchanged, Laravel-certified Web UK frontend passes equivalent
  runtime workflows against ASP.NET by changing backend configuration only.
