# Local Development

Last reviewed: 2026-07-15

Status: **Maintained system reference - local development only**

## Prerequisites

- Docker Desktop with Docker Compose
- Git and PowerShell on the documented Windows workstation
- .NET 8 SDK for host builds, tests, and EF tooling
- Node.js only for the explicitly selected frontend/admin workspace

The root Compose stack is local development infrastructure. It is not a
production deployment specification.

## Start The ASP.NET API Safely

From the repository root:

```powershell
Copy-Item .env.example .env
# Replace JWT_SECRET in .env with a local-only random value.
docker compose up -d db rabbitmq api
docker compose ps
Invoke-RestMethod http://127.0.0.1:5080/health
```

Use `http://127.0.0.1:5080/swagger` for Development-only Swagger UI. Swagger is
not enabled by `Program.cs` in Production.

The API applies the complete EF migration chain on every non-Testing startup.
Development also seeds fictitious local data. Use only the isolated
`nexus-aspnet-dev-db-data` volume; never point the API or tests at Laravel's
ordinary production-derived database.

Local demo identities are created only by the development seed:

| Email | Password | Tenant slug |
| --- | --- | --- |
| `admin@acme.test` | `NexusV2!Demo#2026` | `acme` |
| `member@acme.test` | `NexusV2!Demo#2026` | `acme` |
| `admin@globex.test` | `NexusV2!Demo#2026` | `globex` |

These are fictitious local credentials. They are not production accounts and
must not be reused outside a disposable development environment.

## Local Ports

| Service | Root Compose URL | Notes |
| --- | --- | --- |
| API | `http://127.0.0.1:5080` | ASP.NET API |
| Swagger | `http://127.0.0.1:5080/swagger` | Development only |
| Health | `http://127.0.0.1:5080/health` | JSON health report |
| RabbitMQ management | `http://127.0.0.1:15672` | Local broker UI |
| Frozen React copy | `http://127.0.0.1:5273` | Do not develop without explicit approval |
| Web UK | `http://127.0.0.1:5180` | Laravel-first, separately governed |
| Standalone admin | `http://127.0.0.1:5190` | Secondary surface |

Start optional surfaces by name rather than starting the full stack
accidentally:

```powershell
docker compose up -d admin
docker compose up -d web-uk
```

Starting Web UK does not authorize live Laravel login, mutation, upload,
download, cleanup, migration, or database access. Follow its own `AGENTS.md` and
current status first.

## Stop Or Reset

```powershell
docker compose down
```

`docker compose down` preserves named local volumes. `docker compose down -v`
deletes the local PostgreSQL, RabbitMQ, and upload volumes and must be used only
when that destructive reset is intended. It does not authorize touching any
Laravel or production volume.

## Host Build And Tests

```powershell
dotnet restore Nexus.sln
dotnet build Nexus.sln --configuration Release
dotnet test Nexus.sln --configuration Release
```

Integration tests create a disposable PostgreSQL Testcontainer by default or
use an explicitly supplied disposable `NEXUS_TEST_POSTGRES` connection. See
[Testing and evidence](TESTING.md) before overriding it.

## Common Problems

- If `localhost` behaves differently from `127.0.0.1`, test IPv4 and IPv6
  separately before changing application code.
- If API startup fails, inspect `docker compose logs api`; an empty/placeholder
  JWT secret, connection problem, migration error, or unhealthy dependency is a
  startup failure rather than a frontend defect.
- `compose.fullstack.yml` is a quarantined duplicate with stale ports; use root
  `compose.yml` by service name.
- Root Compose does not expose PostgreSQL to the host by default. Do not assume
  host EF commands can reach `db:5432` without an explicit disposable mapping.
