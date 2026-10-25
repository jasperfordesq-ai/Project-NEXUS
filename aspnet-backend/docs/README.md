# ASP.NET documentation index

## New-installation scope and implementation assessment — 25 October 2026

The owner clarified new installations with both clients unchanged. Start with [ROADMAP.md](ROADMAP.md) for the reconciled 53-package effort and [HANDOFF_PROMPT.md](HANDOFF_PROMPT.md) for the first-stage brief; current findings remain [CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md). Existing-community data transfer is excluded from this stage.


Last reviewed: 2026-10-25 (two code-led audit passes).

**Development is paused. Audit, verification in isolation and documentation are authorized; implementation, CI reactivation, containers and deployment are not resumed.** Current evidence: [contract status](CURRENT_ASPNET_CONTRACT_STATUS.md).

## Read first

1. [Current source-derived findings and evidence](CURRENT_ASPNET_CONTRACT_STATUS.md).
2. [Proposed restart sequence and acceptance gates](ROADMAP.md).
3. [Next-session brief](HANDOFF_PROMPT.md).
4. [Schema discovery versus migration execution](CURRENT_SCHEMA_READINESS.md).
5. [Pause decision and audit-only exception](decisions/ADR-0005-aspnet-edition-halted.md).

## Maintained references

- [Module review coverage](MODULES.md), [API comparison method](API_PARITY.md), [frontend contracts](FRONTEND_PARITY.md), [contract working method](CONTRACT_PARITY_PLAN.md).
- [Architecture](ARCHITECTURE.md), [schema comparison](SCHEMA_PARITY.md), [localization contract](BACKEND_LOCALIZATION_CONTRACT.md).
- [Testing](system/TESTING.md), [local development](system/LOCAL_DEVELOPMENT.md), [configuration](system/CONFIGURATION.md), [operator hub](system/README.md).
- [Documentation governance](DOCUMENTATION_GOVERNANCE.md), [decision index](decisions/README.md), [user guidance](user/README.md), [admin guidance](admin/README.md), [API guidance](api/README.md).

## Detail removed on 25 October, and where it is

The Codex documentation pass (`7bad16055`) cut about 4,800 lines from the maintained
references. `API_PARITY.md`, `SCHEMA_PARITY.md`, `CONTRACT_PARITY_PLAN.md`,
`FRONTEND_PARITY.md`, `CURRENT_SCHEMA_READINESS.md`, `ARCHITECTURE.md` and `MODULES.md`
each shrank to a short summary. Much of what was removed was dated evidence. But
`CONTRACT_PARITY_PLAN.md` also held the working method a restart will need: the
disposable Laravel on `:8091`, the parity fixtures (`scripts/parity-fixture.sql`,
`scripts/parity-fixture-aspnet.sql`), the signed-in comparison, the consumed-field
differ (`scripts/build-parity-corpus.mjs`, `scripts/rank-read-differences.mjs`) and
the React smoke control arm. The previous text is in git. Read any of these with:

```bash
git show 7bad16055^:aspnet-backend/docs/CONTRACT_PARITY_PLAN.md
```

Treat its numbers as August history, not current status.

## Historical evidence

[Journey ledger](JOURNEY_CERTIFICATION_LEDGER.md), prior score sections and dated handoffs retain their original dates. They are not current passes. Build/unit results, generated inventories and frontend production scores cannot certify backend interchangeability. The first-pass and deeper audit reports and raw evidence are in the ignored local archive; a fresh clone carries the curated current findings above, not that machine-local bundle.
