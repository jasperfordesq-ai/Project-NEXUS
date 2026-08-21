# NEXUS ASP.NET Backend

Status: **committed product edition - not yet certified for production**.

This directory is a clean source snapshot of the former standalone ASP.NET
repository. Laravel at the repository root remains the production behavior and
API-contract source of truth. The unchanged `react-frontend/` and `web-uk/`
clients must be able to select either backend through configuration alone.

🔴 **Corrected 2026-08-21.** This read "an optional future alternative". The
ASP.NET edition is a **committed product deliverable** with a commercial driver:
a segment of public-sector buyers require a .NET application stack as a
condition of procurement. It is still not an automatic scaling tier or a
user-count-triggered migration, and commitment is not authorization to deploy: a
production role requires journey evidence, load evidence, **working backups**, a
deploy and rollback path, observability, and an explicit owner decision. See
[`ADR-0003`](docs/decisions/ADR-0003-aspnet-is-a-committed-deliverable.md) for
the commitment and the go-live gate,
[`ADR-0004`](docs/decisions/ADR-0004-journey-equivalence-is-the-target.md) for
what equivalence does and does not mean, and
[`docs/JOURNEY_CERTIFICATION_LEDGER.md`](docs/JOURNEY_CERTIFICATION_LEDGER.md)
for the finite work list.

## Provenance

- Source repository: `https://github.com/jasperfordesq-ai/api.project-nexus.net`
- Source commit: `f757ca96168cd294d0599a0b50cd45ac6b7fb799`
- Imported as a new addition without Git history or the former changelog.
- The former repository should remain archived for historical evidence.

## Local verification

From the platform repository root:

```powershell
dotnet build aspnet-backend/Nexus.sln --configuration Release
dotnet test aspnet-backend/Nexus.sln --configuration Release --no-build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-platform-contracts.ps1
```

The comparison scripts resolve Laravel from the repository root by default.
They still accept explicit `-SourceRoot` and `-TargetRoot` overrides.

Nothing under this directory is included in the Laravel blue/green deployment.
