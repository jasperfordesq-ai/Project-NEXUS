# ADR-0001: Contract-Identical Laravel And ASP.NET Backends

Date accepted: 2026-07-15

Status: **Maintained reference - accepted and not superseded**

## Context

Earlier instructions described the ASP.NET objective as "Laravel parity,"
"contract-compatible," or "contract-correct." Those phrases allowed a weaker
reading: a broadly similar backend, possibly supported by frontend adapters.
That was not the intended product architecture. The user explicitly corrected
the instruction on 2026-07-15 and asked that the correction be preserved for
future agents.

Project NEXUS has two frontend consumers:

- the canonical React frontend at
  `C:\platforms\htdocs\staging\react-frontend`; and
- the shared accessible Web UK frontend at `apps/web-uk`.

Laravel remains the production behavior and contract source of truth. Web UK
is being completed and certified Laravel-first. ASP.NET is the experimental
second backend.

## Decision

ASP.NET must become an **externally contract-identical implementation** of the
Laravel contracts consumed by both unchanged frontends. Either frontend must be
able to switch between Laravel and ASP.NET by configuration only, without a
page, component, template, validation, redirect, or workflow fork.

At every consumed boundary, contract identity includes:

- HTTP methods, normalized paths, aliases, query parameters, headers, request
  bodies, and multipart field names;
- response envelopes, field names and types, pagination, status codes,
  validation/auth/tenant/not-found/feature-disabled errors, and redirects;
- authentication, refresh, authorization, role, tenant, feature/module,
  locale, upload/download, and realtime configuration behavior;
- persistence, ordering, idempotency, concurrency, audit, notification, job,
  provider, and other externally observable side effects; and
- failure behavior, including fail-closed cases and the absence of invented
  success responses.

"Parity," "compatible," and "contract-correct" may remain in historical file
names or dated evidence. In maintained current prose they are shorthand for the
contract-identical standard above. "Close enough," route-count equality, a
matching DTO name, or a frontend workaround does not satisfy this decision.

Internal implementation identity is not required. ASP.NET may use C#, EF Core,
PostgreSQL, different private services, or a documented storage adapter where
Laravel uses PHP, Eloquent, MariaDB, or a differently named table. An internal
difference is acceptable only when it is not observable through either
frontend contract and its data integrity, upgrade behavior, tenant isolation,
and external workflow are proved. Compatibility storage and unproved aliases
remain gaps, not completed identity.

## Required Evidence

A contract-identity claim requires all applicable evidence:

1. an exact-SHA consumer/route/API matrix;
2. focused request, response, authorization, tenant, persistence, side-effect,
   and failure regression tests;
3. blank and populated-upgrade migration proof for affected persistence;
4. complete relevant suite and exact-SHA CI evidence; and
5. unchanged canonical React and unchanged Web UK runtime proof against ASP.NET
   by configuration change only.

Static representation contributes inventory evidence only.

## Consequences

- Fix a contract mismatch in ASP.NET, not in the canonical React frontend.
- Do not add ASP.NET-specific Web UK behavior.
- Preserve Laravel source and the ordinary production-derived Laravel database
  as read-only.
- Keep Web UK Laravel-first completion separate from later ASP.NET switching
  certification.
- Keep schema-chain health, schema representation, semantic workflow identity,
  full-suite evidence, and production readiness as separate claims.
- Any future decision to permit an observable divergence requires a new ADR
  that names the exact exception, consumer impact, migration plan, and owner.

## Superseded Instruction Record

The earlier direction to pursue "parity" without the explicit identity standard
was a mistaken instruction and is superseded. This ADR is the durable record of
the corrected goal.
