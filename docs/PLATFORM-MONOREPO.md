# Platform Monorepo Boundaries

Last reviewed: 2026-08-09

## Purpose

This repository contains the production Laravel platform and its canonical
React client alongside two experimental development applications. Co-location
allows one commit and one CI run to compare both backend implementations and
both frontend consumers against the same contract evidence.

## Ownership and authority

| Path | Role | Production deployment |
| --- | --- | --- |
| repository root (`app/`, `routes/`, `database/`) | Laravel production backend and contract source of truth | Laravel blue/green |
| `react-frontend/` | Canonical React client | Laravel blue/green |
| `accessible-frontend/` | Current Laravel-rendered accessible frontend | Laravel blue/green |
| `aspnet-backend/` | Experimental second backend | None |
| `web-uk/` | Experimental shared accessible client | None |

ASP.NET must reproduce Laravel's externally observable methods, paths,
payloads, response and error shapes, authentication, tenancy, uploads,
side-effects, and failure behavior. Neither frontend may contain an
ASP.NET-specific workflow branch.

## Snapshot provenance

`aspnet-backend/` and `web-uk/` were imported as tracked source snapshots from
`https://github.com/jasperfordesq-ai/api.project-nexus.net` at commit
`f757ca96168cd294d0599a0b50cd45ac6b7fb799`. The old Git history and changelog
were not imported. Keep the former repository archived as the historical
record.

## Safe development commands

```powershell
dotnet build aspnet-backend/Nexus.sln --configuration Release
dotnet test aspnet-backend/Nexus.sln --configuration Release --no-build
npm.cmd --prefix web-uk ci
npm.cmd --prefix web-uk run lint
npm.cmd --prefix web-uk test -- --runInBand
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-platform-contracts.ps1
```

The comparison scripts default to the Laravel repository root and the
`aspnet-backend/` target. Explicit path overrides remain available for
diagnostics.

## Deployment isolation

- Do not add ASP.NET or Web UK services to `compose.bluegreen.yml`.
- The root `.dockerignore` excludes both experimental directories from Laravel
  image build contexts.
- ASP.NET and Web UK checks belong in their own non-deploying workflow.
- A successful experimental check does not authorize or certify deployment.
- Production deployment always requires its existing explicit authorization
  and verification process.
