# Architecture Decision Records

Last reviewed: 2026-07-15

Status: **Maintained index - accepted product and architecture decisions**

Architecture Decision Records (ADRs) preserve decisions that a future agent
must not rediscover or silently weaken. An accepted ADR remains authoritative
until a later numbered ADR explicitly supersedes it.

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-0001](ADR-0001-contract-identical-backends.md) | Accepted | Laravel and ASP.NET must be externally contract-identical for the unchanged canonical React and shared accessible Web UK frontends. |

Historical uses of "parity," "compatible," or "contract-correct" elsewhere in
the repository are interpreted through ADR-0001. They do not authorize an
approximately similar contract.
