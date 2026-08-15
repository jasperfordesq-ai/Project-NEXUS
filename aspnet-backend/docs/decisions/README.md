# Architecture Decision Records

Last reviewed: 2026-08-15

Status: **Maintained index - accepted product and architecture decisions**

Architecture Decision Records (ADRs) preserve decisions that a future agent
must not rediscover or silently weaken. An accepted ADR remains authoritative
until a later numbered ADR explicitly supersedes it.

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-0001](ADR-0001-contract-identical-backends.md) | Accepted | Laravel and ASP.NET must be externally contract-identical for the unchanged canonical React and shared accessible Web UK frontends. |
| [ADR-0002](ADR-0002-laravel-production-authority-and-aspnet-optionality.md) | Accepted | Laravel remains the canonical production backend; ASP.NET is an optional future alternative whose production use requires evidence and a separate decision. |

Historical uses of "parity," "compatible," or "contract-correct" elsewhere in
the repository are interpreted through ADR-0001. They do not authorize an
approximately similar contract.

References to ASP.NET as a second or alternative backend are interpreted through
ADR-0002. They do not describe a planned Laravel replacement or an automatic
cutover when traffic grows.
