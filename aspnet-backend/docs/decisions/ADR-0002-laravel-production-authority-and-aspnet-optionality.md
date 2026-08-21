# ADR-0002: Laravel Production Authority And ASP.NET Optionality

Date accepted: 2026-08-15

Status: **Superseded in part by [ADR-0003](ADR-0003-aspnet-is-a-committed-deliverable.md)**

🔴 **Read ADR-0003 first.** This record's *scaling* reasoning is retained and
still binding: user, tenant, or traffic growth never automatically promotes
ASP.NET or retires Laravel, and scale constraints are addressed in queries,
indexes, caches, queues, media, and infrastructure rather than by changing
framework.

🔴 **This record's characterisation of ASP.NET as strategically optional is
superseded.** ASP.NET is a committed product deliverable with a commercial
driver: a segment of public-sector buyers require a .NET stack as a condition
of procurement. Wording below such as "optional future alternative", "not an
assumed successor", "Do not promise that ASP.NET will be deployed", and the
"Promotion Decision Gate" framing must not be quoted as current product
intent. ADR-0003 carries the current framing and the renamed certification
gate. The deployment prohibitions this record implies are unchanged and remain
in force.

## Context

Project NEXUS is growing while an externally contract-identical ASP.NET
implementation is being developed alongside the production Laravel platform.
That parallel work creates a risk of an incorrect architectural assumption:
that ASP.NET is the planned successor to Laravel, or that reaching an arbitrary
number of users should automatically trigger a backend rewrite.

User count is not a useful framework-selection threshold. At scale, the first
constraints are commonly database queries and indexes, cache effectiveness,
queue design, synchronous side effects, media delivery, connection capacity,
or deployment topology. Either Laravel or ASP.NET can be operated at substantial
scale, and changing frameworks does not by itself correct those constraints.

ASP.NET still provides valuable strategic optionality. Its runtime performance,
static C# type system, enterprise tooling, and fit with Microsoft-oriented
operators may become relevant to a future deployment. Those are reasons to
build and measure an alternative implementation, not evidence that production
should move to it.

## Decision

Laravel remains the **canonical production backend and behavior source of
truth** for Project NEXUS. There is no planned traffic-, tenant-, or user-count
threshold at which ASP.NET automatically replaces it.

ASP.NET is maintained as an **optional future alternative backend**, not as an
assumed successor, automatic scaling tier, hot standby, or production replica.
Its purposes are to:

- preserve the option of a configuration-switchable .NET edition;
- prove that the client contracts are portable rather than Laravel-internal;
- support future operators whose staffing or infrastructure favors .NET; and
- provide a real implementation on which performance, reliability, operating
  cost, and maintainability can be compared.

Production behavior is defined and delivered through Laravel first. ASP.NET
must follow the contract-identity standard in
[ADR-0001](ADR-0001-contract-identical-backends.md). Work on ASP.NET does not
authorize weakening Laravel, delaying necessary Laravel scaling work, changing
the unchanged clients to suit ASP.NET, or representing a future cutover as
decided.

## Promotion Decision Gate

ASP.NET may be proposed for a production role only after all of the following
are available:

1. full unchanged-client contract-identity evidence required by ADR-0001;
2. equivalent authorization, tenant isolation, data integrity, localization,
   background processing, and failure behavior;
3. representative load and endurance tests against real Project NEXUS
   workflows, compared with an optimized Laravel baseline;
4. an operational comparison covering observability, patching, backups,
   recovery, deployment safety, support ownership, staffing, and total cost;
5. a migration, verification, rollback, and data-reconciliation plan that does
   not rely on unsafe dual writes or a shared database; and
6. a separate, explicit owner decision authorizing the proposed production
   scope and deployment path.

Growth by itself, synthetic route counts, framework reputation, or a generic
benchmark cannot satisfy this gate. A proposal must identify a measured Project
NEXUS constraint or a concrete operator requirement and show that ASP.NET
improves it enough to justify migration risk and the cost of operating another
stack.

## Consequences

- Continue profiling and scaling Laravel using the least disruptive effective
  measures, including query and index work, caching, queues, media delivery,
  horizontal capacity, and infrastructure changes.
- Describe ASP.NET in maintained documentation as an optional alternative, not
  a replacement or inevitable destination.
- Keep ASP.NET development and certification isolated from Laravel production
  deployment.
- Do not promise that ASP.NET will be deployed, or that Laravel will be retired.
- Preserve the ability to choose ASP.NET later if evidence and operator needs
  justify it; this decision rejects an assumed migration, not future evaluation.

## Relationship To ADR-0001

ADR-0001 defines **what ASP.NET must reproduce**. This ADR defines **why the
second backend exists and what would be required before it could receive a
production role**. Neither decision supersedes the other.
