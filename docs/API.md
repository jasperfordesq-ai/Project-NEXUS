# API Reference

Last reviewed: 2026-07-30

Project NEXUS exposes a large Laravel JSON API for the React frontend, mobile clients, integrations, federation, and admin surfaces. The hand-written docs do not duplicate every endpoint. **The OpenAPI contract is the source of truth.**

This page is a getting-started guide: base URLs, the auth model, and one worked request. For the full endpoint catalogue, see [Browse the full API](#browse-the-full-api).

## Source Of Truth

| Contract | Status | Notes |
| --- | --- | --- |
| `openapi.json` (repo root) | Main API contract | OpenAPI 3.0.3, `Project NEXUS v2 API`, version `2.0.0`. Render it (see below) rather than reading the large raw file. |
| `resources/openapi.json` | Smaller resource contract | OpenAPI 3.1.0, a focused subset. |
| `resources/openapi.yaml` | YAML companion | Keep aligned with `resources/openapi.json` when that smaller contract changes. |
| `routes/api.php` | Runtime route source | Laravel API route registration for v2, admin, partner, federation, support, and regional analytics routes. |

When the docs and the running code disagree, `routes/api.php` and the controllers under `app/Http/Controllers/Api/` are authoritative for behaviour; `openapi.json` is authoritative for the published contract.

## Getting Started

### Base URLs

All routes are registered under an `/api` prefix (see `app/Providers/RouteServiceProvider.php`). The main member/admin API surface lives under the `/api/v2/...` namespace, but the `v2` segment is written per route rather than applied by a group prefix, so a handful of routes sit directly under `/api/...` — most notably login (`POST /api/auth/login`, `routes/api.php:3040`).

Two further non-`v2` route families are current registrations, not history:

- `/api/v1/federation/...` — 15 routes, the native legacy v1 federation read/write API (`routes/api.php:3562`, gated by `federation.external:legacy_v1`).
- `/api/partner/v1/...` — 10 routes, the Partner API including `POST /api/partner/v1/wallet/credit` (`routes/api.php:3907`), all inside the kill-switched group opened at `routes/api.php:3883` and gated by `App\Http\Middleware\EnsurePartnerApiEnabled` (registered as `partner.api.enabled` in `bootstrap/app.php`).

Both families are built and tested but switched **off by default** and off in production, and each sits behind its own deliberately independent kill switch with its own error code:

- Legacy v1 federation answers `503` + `Retry-After: 3600` with a **top-level** `code` of `FEDERATION_EXTERNAL_DISABLED` (`App\Support\Federation\ExternalFederationResponse::ERROR_CODE`), in the body `{"error": true, "code": ..., "message": ..., "timestamp": ...}`. This is the shape for every non-ingest external federation path; only `/api/v2/federation/ingest/*` wraps the same code in the canonical `errors[0].code` envelope (`ExternalFederationResponse::blocked()` branches on the path, and everything else falls through to `blockedLegacy()`). Both are governed by the `external_protocol_legacy_v1_enabled` and `external_federation_enabled` (master) columns of `federation_system_control`.
- The Partner API answers `503` + `Retry-After: 3600` with `errors[0].code = partner_api_disabled` (`EnsurePartnerApiEnabled`, backed by `App\Services\PartnerApi\PartnerApiKillSwitch`). It never returns `FEDERATION_EXTERNAL_DISABLED`.

Do not treat either family as retired, and do not treat them as live traffic. Internal cross-tenant federation is a separate mechanism and is live and ungated by design.

| Environment | Base URL |
| --- | --- |
| Production | `https://api.project-nexus.ie` |
| Local Docker PHP | `http://127.0.0.1:8090` |

So a v2 endpoint is reached at, for example, `https://api.project-nexus.ie/api/v2/health`.

### Tenant context (required)

Project NEXUS is multi-tenant. Every request resolves a tenant before routing. The tenant is resolved from, in order of preference:

- an `X-Tenant-ID` request header, or
- an `X-Tenant-Slug` request header, or
- the request host (e.g. a tenant subdomain).

Requests that cannot resolve a tenant receive a `400` with an error code of `tenant_resolution_failed` or `tenant_required` (see `app/Http/Middleware/ResolveTenant.php`). When calling the API directly (not from a tenant subdomain), send an explicit tenant header.

### Authentication

The API uses **short-lived JWT bearer authentication** (`Authorization: Bearer <token>`). User-login Sanctum personal-access tokens and pre-rotation legacy JWTs are not accepted. Access tokens last 15 minutes; clients continue a session through the rotating, single-use refresh token returned by login, and access tokens minted by refresh are bound to that refresh family so family logout also invalidates a delayed access response (see `app/Http/Middleware/Authenticate.php` and `app/Services/TokenService.php`). OpenAPI declares `bearerAuth` for member/admin requests and a separate `federationBearerAuth` scheme for tenant-bound partner ingest keys. Secret calendar-feed URLs explicitly opt out of both schemes and rely on their high-entropy, redacted token path.

**Obtain a token** by calling the login endpoint with a tenant header:

```bash
curl -X POST "https://api.project-nexus.ie/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: 1" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

A successful response includes a `token` field (plus `access_token`, `refresh_token`, and `token_type: "Bearer"`) and the authenticated `user` object. The login route is rate limited to 30 requests/minute per IP and is additionally protected by a database-backed brute-force limiter on failed attempts.

**Send the token** on subsequent requests:

```bash
curl "https://api.project-nexus.ie/api/v2/<some-endpoint>" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-ID: 1"
```

> Do not embed real credentials in scripts, issues, or documentation. Fresh local installs seed the master tenant as `tenant_id=1`; use a throwaway account for examples.

### CSRF for cookie/session calls

The bearer-token flow above does not require a CSRF token. If you authenticate via the browser session cookie instead of an `Authorization` header, fetch a CSRF token first and send it back with state-changing (`POST`/`PUT`/`DELETE`) requests:

```bash
curl "https://api.project-nexus.ie/api/v2/csrf-token" -H "X-Tenant-ID: 1"
# → { "success": true, "data": { "csrf_token": "<token>" } }
```

Prefer the `Authorization: Bearer` header for programmatic/server-to-server integrations; it is simpler and is the model the published contract documents.

## A Worked Example

`GET /api/v2/health` is a public, unauthenticated readiness probe — ideal for confirming connectivity and your tenant header without any credentials.

**Request:**

```bash
curl "https://api.project-nexus.ie/api/v2/health" \
  -H "X-Tenant-ID: 1"
```

**Response (`200 OK`):**

```json
{ "status": "ok" }
```

There is also a framework-level probe at `GET /api/laravel/health` that deliberately returns only `{ "status": "ok" }` and never exposes the framework version or tenant id.

`GET /api/v2/listings` is **not** public: it sits inside the `auth:sanctum` group (`routes/api.php:184`) behind the tenant `listings` module gate, so an anonymous request receives `401` with `auth_required` (see `app/Http/Middleware/Authenticate.php`). The only genuinely unauthenticated listings endpoints are `GET /api/v2/listings/tags/popular` and `GET /api/v2/listings/tags/autocomplete`, which opt out explicitly with `->withoutMiddleware('auth:sanctum')` (`routes/api.php:530-531`). Events follow the same model: maintained member, organiser and admin Events endpoints, including `GET /api/v2/events`, require authentication and the tenant `events` feature. The narrow exceptions are explicit capability-token operations such as a secret personal calendar feed and one-use guardian-consent grant; neither exposes an event catalogue or roster, and invalid guardian inputs are deliberately non-enumerable. A future public event catalogue would need a separate, identity-free contract. Confirm the exact query parameters, middleware and response shapes in `routes/api.php` and `openapi.json` rather than assuming them here.

Effective-dated recurring-series edits use the explicit preview/commit pair under `/api/v2/events/{id}/recurrence-revisions` (`routes/api.php:294,296`; the contract declares `{id}`). The `{id}` must resolve to a concrete occurrence — otherwise the controller refuses with the reason code `event_recurrence_revision_concrete_occurrence_required`. Preview is non-mutating and returns a short-lived confidential token plus participant-redacted impact/conflict counts. Commit requires the exact patch, that token and an `Idempotency-Key` of at most 191 characters; it returns `201` for a new immutable revision or `200` for a matching replay. Stale/expired/conflicting previews return `409`, and a boundary above the configured occurrence cap returns `413`. These endpoints remain unavailable while the V2 recurrence rollout flag is off.

Maintained clients must fetch `GET /api/v2/events/recurrence-capabilities` before presenting recurrence controls. The authenticated, Events-feature-gated response is an allowlisted runtime contract covering the active `legacy` or `v2` engine, structured input, supported frequencies and end types, the bounded occurrence cap, and explicit rolling-never, effective-revision and definition-blueprint support. `schema_ready` and `rollout_state` let clients degrade safely; advanced flags remain false and `never` is omitted whenever required flags, configuration or schema are unavailable. The endpoint never exposes tenant identifiers, raw configuration, schema names or probe errors and must not be cached across authenticated users or tenants.

## Rate Limiting

Routes apply Laravel throttle middleware, with per-route limits chosen for the endpoint's sensitivity. Common patterns seen in `routes/api.php`:

| Route class | Typical limit (requests/minute per IP) |
| --- | --- |
| Auth (login, register) | 30 |
| Config / federation reads | 60 |
| File uploads | 20 |
| Public feeds (jobs RSS/JSON) | 30 |
| Sensitive flows (e.g. sales order submit) | 5 |

Treat the table as indicative — the authoritative limit for any given route is the `throttle:` middleware on that route in `routes/api.php`.

## Browse the Full API

`openapi.json` at the repo root is the canonical, machine-readable contract. Do not hand-maintain a competing endpoint table here — generate reference, SDKs, and validation from the contract instead.

Render it locally with either tool:

```bash
# Redoc (interactive, single-file docs)
npx @redocly/cli preview-docs openapi.json

# or Swagger UI via any OpenAPI viewer
npx swagger-ui-watcher openapi.json
```

You can also import `openapi.json` into Postman, Insomnia, or an SDK generator (e.g. `openapi-generator`).

The MkDocs site publishes a hosted Redoc rendering through `docs/api-reference.md`. The committed `openapi.json` remains the source of truth; the hosted page is a convenience view of that same file.

## How To Use The API Docs

- Use `openapi.json` for generated reference, SDK generation, validation, and partner review.
- Use `routes/api.php` and `app/Http/Controllers/Api/` when checking runtime behaviour.
- Use [docs/FEDERATION_API_MANUAL.md](FEDERATION_API_MANUAL.md) for federation-specific semantics and operational notes.
- Use [docs/MODULES.md](MODULES.md) to find the service, model, and frontend code for a module before editing endpoint behaviour.

## Documentation Standard

API documentation should follow the Stripe-style pattern:

- a short "just getting started" path for the common integration;
- authentication and tenant-context guidance before endpoint details;
- sandbox or test-tenant guidance that does not expose live credentials;
- versioning notes and deprecation policy;
- clear examples that avoid real personal data;
- generated endpoint reference from OpenAPI rather than hand-maintained endpoint tables.

## Validation

Before publishing API documentation changes:

```bash
npm run check:docs
npx @redocly/cli lint openapi.json
```

Before changing version labels or public collateral:

```bash
npm run check:version
```

The documentation CI runs Redocly against `openapi.json`. Existing route-ambiguity and generated-operation warnings are tracked separately; schema-invalid output is release-blocking.
