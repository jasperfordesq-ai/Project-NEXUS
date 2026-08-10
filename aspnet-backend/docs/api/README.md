# ASP.NET API Consumer Guide

Last reviewed: 2026-07-15

Status: **Maintained integration reference - experimental and not contract-certified**

The ASP.NET API must become externally contract-identical to the Laravel
contracts consumed by both unchanged frontends. Laravel
routes, controllers, OpenAPI, and the unchanged canonical React/Web UK consumers
remain authoritative when this guide and an endpoint disagree.

## Base URL And Discovery

Local root Compose exposes the API at `http://127.0.0.1:5080`. Development
Swagger UI is at `/swagger`; `Program.cs` does not enable Swagger in Production.
The compatibility documentation endpoints are not a complete OpenAPI contract.

Use [API parity](../API_PARITY.md) and the generated consumer matrices for
inventory, but remember that a static match does not prove payloads, errors,
authorization, tenant isolation, uploads, side effects, or runtime behavior.

## Versioning And Paths

The API contains unversioned compatibility routes plus `/api/v1` and `/api/v2`
routes. Do not prepend `/v2` mechanically or substitute a similar route. Use the
exact method/path consumed by the canonical client or declared by Laravel.

## Authentication

The primary member flow uses tenant-aware JWT authentication. A local login
request is shaped as:

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "member@acme.test",
  "password": "NexusV2!Demo#2026",
  "tenant_slug": "acme"
}
```

The successful response includes `access_token`, `refresh_token`, token type,
expiry, and the tenant-scoped user. A user with two-factor authentication
receives a separate challenge response and must complete the advertised method
before using ordinary protected routes.

Send the access token as:

```http
Authorization: Bearer <access-token>
```

Never log, commit, or include tokens in screenshots. Partner/federation client
credentials use dedicated boundaries and are not interchangeable with member
tokens.

## Tenancy And Authorization

Supply the tenant identifier only where the Laravel contract requires it. The
authenticated tenant claim and server-side tenant context are authoritative;
changing a path, query, or header must never grant cross-tenant access. Roles
are endpoint-specific. An ordinary tenant administrator is not a platform
super-administrator.

## Responses And Errors

There is no safe assumption that every historical endpoint uses one envelope.
Many Laravel-compatible v2 endpoints use shapes such as:

```json
{ "success": true, "data": {} }
```

or error arrays such as:

```json
{
  "success": false,
  "errors": [
    { "code": "VALIDATION_ERROR", "message": "...", "field": "..." }
  ]
}
```

Other compatibility endpoints intentionally reproduce different Laravel
shapes. Implement and test the exact endpoint contract, including status code,
error code, optional field, language, and ordering. Do not normalize responses
in a client merely to hide a backend mismatch.

## Pagination, Idempotency, Uploads, And Side Effects

- Preserve the endpoint's cursor/page names and response metadata exactly.
- Send an `Idempotency-Key` only where the Laravel contract supports it; retain
  the same key when safely retrying the same request body.
- Use the exact multipart field names, media limits, ownership rules, and
  download semantics for upload endpoints.
- A 2xx response can create notifications, email, ledger, provider, audit, or
  background-job effects. Test intended final state and duplicate safety.
- Respect `429` and `Retry-After`; do not bypass rate limits with parallel
  retries.

## Correlation And Support

The API propagates request/correlation identifiers into responses and logs.
Record the request ID, method, path template, status, tenant (without personal
data), timestamp, and published source SHA when reporting an integration defect.

## Certification Boundary

Read [CURRENT_ASPNET_CONTRACT_STATUS.md](../CURRENT_ASPNET_CONTRACT_STATUS.md)
before treating an endpoint as switchable. The current route inventory is
complete at a static level, but semantic, full-suite, provider, migration, and
unchanged-client runtime gates remain open.
