# NEXUS ASP.NET Backend

Status: **experimental and not production-certified**.

This directory is a clean source snapshot of the former standalone ASP.NET
repository. Laravel at the repository root remains the production behavior and
API-contract source of truth. The unchanged `react-frontend/` and `web-uk/`
clients must be able to select either backend through configuration alone.

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
pwsh -File aspnet-backend/scripts/audit-platform-parity.ps1
```

The comparison scripts resolve Laravel from the repository root by default.
They still accept explicit `-SourceRoot` and `-TargetRoot` overrides.

Nothing under this directory is included in the Laravel blue/green deployment.
