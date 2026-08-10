# ASP.NET Backend Instructions

The repository-wide [`../AGENTS.md`](../AGENTS.md) instructions apply.

- Laravel at the repository root is the production contract source of truth.
- Make ASP.NET externally contract-identical; do not add backend-specific
  branches or workarounds to `react-frontend/` or `web-uk/`.
- Keep ASP.NET work inside `aspnet-backend/**` unless an explicitly approved
  shared contract or CI change is required.
- Do not deploy ASP.NET or touch Laravel production containers from this
  directory.
- Do not use the ordinary local Laravel database as a test fixture.
- Read `docs/CURRENT_ASPNET_CONTRACT_STATUS.md`,
  `docs/CURRENT_SCHEMA_READINESS.md`, and
  `docs/decisions/ADR-0001-contract-identical-backends.md` before resuming
  backend contract work.
