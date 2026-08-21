# Architecture Decision Records

Last reviewed: 2026-08-21

Status: **Maintained index - accepted product and architecture decisions**

Architecture Decision Records (ADRs) preserve decisions that a future agent
must not rediscover or silently weaken. An accepted ADR remains authoritative
until a later numbered ADR explicitly supersedes it.

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-0001](ADR-0001-contract-identical-backends.md) | Accepted | Laravel and ASP.NET must be externally contract-identical for the unchanged canonical React and shared accessible Web UK frontends. |
| [ADR-0002](ADR-0002-laravel-production-authority-and-aspnet-optionality.md) | **Superseded in part by ADR-0003** | Scaling reasoning retained: growth never automatically promotes ASP.NET. Its "optional alternative" framing is superseded. |
| [ADR-0003](ADR-0003-aspnet-is-a-committed-deliverable.md) | Accepted | ASP.NET is a committed product deliverable with a commercial driver — public-sector buyers who require a .NET stack. Laravel is the production default until ASP.NET is certified. |
| [ADR-0004](ADR-0004-journey-equivalence-is-the-target.md) | Accepted | The target is journey equivalence at consumed boundaries. Fields no client reads are out of scope; the finite journey catalogue is the denominator. |

Historical uses of "parity," "compatible," or "contract-correct" elsewhere in
the repository are interpreted through ADR-0001. They do not authorize an
approximately similar contract.

Historical uses of "byte-for-byte", whole-response-body diffs, or field-count
matching are interpreted through ADR-0004. Reproducing a Laravel internal
database column that no client reads is not required work.

References to ASP.NET as "optional", "experimental", or "development-only" as a
*product description* are superseded by ADR-0003. ASP.NET is a committed
deliverable. Those words remain accurate only where they name a specific current
limitation, and must then say which one. The deployment prohibitions are
unchanged: commitment to the deliverable is not authorisation to deploy it, and
growth alone still never triggers a cutover.
