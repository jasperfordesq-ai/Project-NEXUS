# Project NEXUS System Documentation

## New-installation scope and implementation assessment — 25 October 2026

Operator readiness includes non-demo bootstrap, workers/provider outcomes, asset storage, upgrades from the first ASP.NET release and restore into an isolated target. Existing scripts are reusable inputs, not fresh proof. Refer to the costed ROADMAP before restarting anything.


## Audit reconciliation — 25 October 2026 (two passes)

Use the current contract audit before acting on these operator references. Build/source evidence is separate from live runtime, backup, restore and deployment proof.

Current readiness: [code-led contract audit](../CURRENT_ASPNET_CONTRACT_STATUS.md). Development remains paused; this audit/doc update does not authorize implementation, CI reactivation, container restart or deployment.

## Historical baseline — not revalidated by this audit

Earlier scores, certifications, test totals and readiness statements below retain their original dates. They are not current compatibility evidence; the audit above takes precedence.


Last reviewed: 2026-07-15

Status: **Maintained system reference - product status remains separate**

This hub is the entry point for developers, integrators, testers, and operators
working on the experimental Project NEXUS .NET edition. It indexes current
instructions instead of duplicating fast-changing scores or generated counts.

## System Shape

The required end state is two unchanged clients by two backends:

| Client | Laravel | ASP.NET |
| --- | --- | --- |
| Canonical React in the Laravel repository | Production contract source | Experimental contract-correct twin target |
| Shared accessible Web UK in this repository | Laravel-first source and verification target | Future configuration-only switching target |

Laravel defines behavior. Route presence, a generated matrix, a build, or a
focused test is not semantic or production certification.

## System Guides

| Guide | Scope |
| --- | --- |
| [Local development](LOCAL_DEVELOPMENT.md) | Supported local API stack, ports, startup effects, and troubleshooting boundaries. |
| [Configuration](CONFIGURATION.md) | Configuration precedence, core keys, secret handling, and edition-specific settings. |
| [Testing and evidence](TESTING.md) | Test layers, disposable databases, Web UK safety, sharding, CI, and certification meaning. |
| [Security and tenancy](SECURITY_AND_TENANCY.md) | Authentication, tenant isolation, authorization, CORS/WebAuthn, rate limiting, and known gaps. |
| [Operations](OPERATIONS.md) | Production authority, deployed surfaces, known unsafe/legacy automation, migrations, backup, and rollback boundaries. |
| [Incident response](INCIDENT_RESPONSE.md) | Read-only alert triage, authorization boundary, restart/migration warning, and closure evidence. |
| [Cloudflare origin certificates](CLOUDFLARE_ORIGIN_CERT_RUNBOOK.md) | Migrating Plesk hostnames from 90-day Let's Encrypt to long-lived Cloudflare Origin CA certificates, and escaping the Full-strict 526 renewal deadlock. |
| [API consumer guide](../api/README.md) | Versioning, authentication, tenancy, envelopes, errors, pagination, uploads, and contract authority. |

## Architecture And Data

- [Canonical architecture](../ARCHITECTURE.md)
- [Module map](../MODULES.md)
- [Migration workflow](../database-migrations.md)
- [Current schema readiness](../CURRENT_SCHEMA_READINESS.md)
- [Schema parity](../SCHEMA_PARITY.md)
- [Registration policy engine](../REGISTRATION_POLICY_ENGINE.md)
- [Backend localization contract](../BACKEND_LOCALIZATION_CONTRACT.md)

## Current Status And Evidence

- [ASP.NET contract status](../CURRENT_ASPNET_CONTRACT_STATUS.md) is the only
  current backend score authority.
- [Web UK status](../../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
  is the only accessible-frontend certification score authority.
- [Parity remediation runbook](../FULL_PARITY_REMEDIATION_RUNBOOK.md) owns the
  fixed rubric and cross-workstream end state.
- [Documentation health](../DOCUMENTATION_HEALTH_REPORT.md) scores documentation
  only and must never be quoted as product completion.

## Mandatory Boundaries

- Read `AGENTS.md` and `CLAUDE.md` before changing the repository.
- Treat `C:\platforms\htdocs\staging` and its ordinary production-derived
  database as read-only.
- `apps/react-frontend` was deleted on 2026-08-09 and must not be recreated.
- Before any production action, obtain explicit authorization and read
  `.claude/production-containers.md` immediately beforehand.
- Preserve unrelated dirty work and use separate worktrees for shared schema
  hotspots.
