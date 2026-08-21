# ASP.NET Backend Instructions

The repository-wide [`../AGENTS.md`](../AGENTS.md) instructions apply.

- Laravel at the repository root is the production contract source of truth and
  the production default until the ASP.NET edition is certified.
- 🔴 **ASP.NET is a COMMITTED deliverable, not an optional alternative**
  (corrected 2026-08-21; this line said the opposite). Its driver is commercial:
  a segment of public-sector buyers require a .NET stack to procure at all. See
  [`docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md`](docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md).
  Traffic growth still never authorizes production use, and commitment is never
  authorization to deploy.
- 🔴 **The target is journey equivalence at consumed boundaries, not
  field-for-field response matching.** A field is in scope only if a client
  reads it, acts on it, or its difference changes an outcome. Read
  [`docs/decisions/ADR-0004-journey-equivalence-is-the-target.md`](docs/decisions/ADR-0004-journey-equivalence-is-the-target.md)
  first; pick work up from
  [`docs/JOURNEY_CERTIFICATION_LEDGER.md`](docs/JOURNEY_CERTIFICATION_LEDGER.md).
- Make ASP.NET equivalent at the boundary the clients consume; do not add
  backend-specific branches or workarounds to `react-frontend/` or `web-uk/`.
- Keep ASP.NET work inside `aspnet-backend/**` unless an explicitly approved
  shared contract or CI change is required.
- Do not deploy ASP.NET or touch Laravel production containers from this
  directory.
- Do not use the ordinary local Laravel database as a test fixture.
- Read `docs/CURRENT_ASPNET_CONTRACT_STATUS.md`,
  `docs/CURRENT_SCHEMA_READINESS.md`, and
  `docs/decisions/ADR-0001-contract-identical-backends.md` and
  `docs/decisions/ADR-0002-laravel-production-authority-and-aspnet-optionality.md`
  before resuming backend contract work.
