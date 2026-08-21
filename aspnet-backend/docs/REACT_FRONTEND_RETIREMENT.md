# React Frontend Retirement Policy

> **Pre-consolidation paths.** Written before the 2026-08-09 move into the
> platform monorepo. Where this document says `apps/web-uk`, `apps/admin`,
> `apps/react-frontend` or `C:\platforms\htdocs\asp.net-backend`, read
> `web-uk/` and `aspnet-backend/` in this repository (the first two `apps/`
> directories were deleted before the move). The paths are left unedited
> because this is a record of what was true at the time.

Last reviewed: 2026-08-09

Status: **Maintained reference — retirement complete**

## Decision

The separate React frontend in this ASP.NET repository is retired. As of
2026-08-09 it has been **deleted** from the repository — retirement is no longer
a policy to observe but a completed fact.

It was a dead, out-of-date fork that was no longer in use. Leaving it in place
risked it being mistaken for live code and kept generating dependency
advisories against software nobody shipped. Its history remains reachable
through git if an old implementation detail is ever needed.

The deleted copy formerly lived at:

```text
C:\platforms\htdocs\asp.net-backend\apps\react-frontend
```

Canonical production frontend:

```text
C:\platforms\htdocs\staging\react-frontend
```

The Laravel backend and Laravel React frontend are production systems. The
ASP.NET backend is a committed second edition that is not yet certified
(corrected 2026-08-21; this said "development-only"). ASP.NET must become
equivalent at the boundary the Laravel React frontend consumes; the production
Laravel React frontend must not be weakened to accommodate ASP.NET gaps, and no
ASP.NET-specific branch may be added to it.

## Working Rule

Do not recreate `apps/react-frontend/`. Its container and image were removed
from the Azure host on 2026-08-09 and it must not be reintroduced here; the
replacement lives in the staging repository. `apps/admin/`, the standalone
Refine/Ant Design admin panel, was retired the same day for the same reason —
the admin panel lives in the canonical React frontend. `apps/web-uk/` is now the
only frontend in this repository; it is the separately approved
accessible-frontend implementation target and follows its own `AGENTS.md` and
current Laravel-first status.

Backend contract-identity work should happen in ASP.NET backend code,
contracts, tests, and documentation. If a frontend file is touched during that
work, the change must explain why backend conformance was not enough.

## Contract Target

For every API call made by the canonical Laravel React frontend and every
backend contract consumed by the unchanged shared Web UK frontend, ASP.NET must
expose externally contract-identical behavior. Web UK itself remains Laravel-first and is not
certified until its canonical status records the missing runtime and
accessibility evidence.

Contract identity means:

- same HTTP method;
- same path, including `/api/v2/...` aliases where Laravel React expects them;
- identical consumed query parameters and request bodies;
- identical consumed multipart/upload field names and URL response fields;
- identical consumed response envelopes and pagination metadata;
- identical consumed validation error, auth error, tenant error, not-found, and feature
  disabled response shapes;
- identical consumed status codes;
- identical consumed auth refresh and tenant bootstrap behavior;
- identical consumed feature/module flag behavior;
- externally identical realtime configuration behavior, even if the ASP.NET transport is
  SignalR rather than Laravel/Pusher.

If ASP.NET currently exposes a similar route under a different path, add a
compatibility alias rather than changing the Laravel React frontend.

## Proving Contract Identity

Do not claim that an ASP.NET module is externally contract-identical for the
Laravel React frontend until the proof exists.

Required proof:

1. Route/API matrix:
   - Laravel React API call site.
   - Laravel route or OpenAPI operation.
   - ASP.NET route or OpenAPI operation.
   - Method/path match status.
   - Request shape match status.
   - Response/error/status-code match status.
2. Focused ASP.NET regression tests for the matched contract.
3. Runtime smoke tests using the Laravel React frontend against the ASP.NET API
   for the implemented workflow.

Failures must be classified as:

- missing endpoint;
- wrong method or path;
- missing `/api/v2` alias;
- request-shape mismatch;
- response-shape mismatch;
- auth/tenant mismatch;
- upload/realtime/config mismatch;
- unimplemented backend workflow.

## What Not To Do

- Do not continue feature development in `apps/react-frontend/`.
- Do not copy the ASP.NET React fork over the Laravel React frontend.
- Do not make ASP.NET the default frontend target.
- Do not fix backend gaps by loosening production frontend validation.
- Do not hide contract mismatches with broad fallback logic.
- Do not claim frontend parity from static route counts alone.

## Future Repository Shape

The intended direction is one shared React frontend that can target either
backend once ASP.NET passes the Laravel React contract. That frontend should live
outside this ASP.NET backend repo in the future.

Until that migration happens, the Laravel repo copy remains canonical, and this
repo focuses on making ASP.NET match the Laravel React API contract.
