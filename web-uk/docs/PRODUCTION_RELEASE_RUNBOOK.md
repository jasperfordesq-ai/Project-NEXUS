# Web UK Production Release Runbook

Last reviewed: 2026-07-15

Status: **Maintained reference - deployment hold, no standing authorization**

This is the release-control contract for `apps/web-uk`. It is deliberately
fail-closed: Web UK is experimental and is not currently approved to replace
Laravel Blade or to run against ASP.NET in production.

## Current deployment hold

- The root `compose.prod.yml` points Web UK at ASP.NET. That path is not
  approved until unchanged-Web-UK ASP.NET certification is complete.
- Laravel remains the product, Blade, and API-contract authority. The Laravel
  repository, database, Redis, storage, and blue/green containers must not be
  changed from this repository.
- A release operator needs an explicit production instruction. This runbook is
  not standing authorization to deploy, restart, repoint, or remove a
  container.
- Before any production action, reread
  [`../../../.claude/production-containers.md`](../../../.claude/production-containers.md)
  and confirm that its Web UK deployment hold has been explicitly lifted.

## 1. Freeze the release evidence

Record all of the following in the release ticket before building:

```text
Laravel source SHA:
Web UK repository SHA:
UTC timestamp:
Backend target and base URL:
Production image tag:
Production image digest:
Node base image digest:
Redis image/service identifier:
Operator:
Rollback image digest:
```

The Web UK worktree must be clean and the recorded SHA must equal the published
remote SHA:

```powershell
git status --short -- apps/web-uk
git rev-parse HEAD
git rev-parse origin/main
git -C C:\platforms\htdocs\staging rev-parse HEAD
```

Reading the Laravel SHA is allowed. Do not run Laravel migrations, seeders,
mutation tests, cleanup, uploads, downloads, or direct SQL against the ordinary
production-derived environment.

## 2. Source-owned candidate gates

Do not build a release candidate unless all applicable gates are green at the
frozen Web UK SHA:

```powershell
npm --prefix apps/web-uk ci
npm --prefix apps/web-uk audit --omit=dev
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run brand:check
npm --prefix apps/web-uk run build:css
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run api:ledger
npm --prefix apps/web-uk run locales:audit
npm --prefix apps/web-uk run locales:audit-keys
npm --prefix apps/web-uk run locales:audit-templates -- --summary
npm --prefix apps/web-uk run test:accessibility:isolated
./scripts/check-documentation-consistency.ps1
./scripts/check-markdown-links.ps1
```

These gates prove only the source-owned release candidate. The accessibility
command is deliberately limited to random-loopback Web UK plus a GET/HEAD-only
fixture backend; caller arguments cannot widen it to login or state-changing
coverage. None of these commands authorizes Laravel login, mutation, upload,
download, cleanup, migration, container, or database access.

The active frontend-cloning goal additionally requires manual keyboard, no-JS,
zoom/reflow, forced-colour, focus/error, and screen-reader sign-off against safe
Web UK-owned or mocked states. Automated route, Jest, or axe counts do not
replace that review.

Paired live Laravel Blade/Web UK screenshots and any stateful integration
evidence are a separate, optional future workstream. They are not source-owned
frontend gates and must not be attempted unless the owner explicitly requests
and supplies that workstream. The retained capture tool must never use
`/hour-timebank/alpha`; its canonical comparison mount is
`/hour-timebank/accessible`.

Complete the generated `review.md` or print/save `review.html`, then archive or
reference the ignored artifact directory outside Git. Record the reviewer,
date, browser version, source SHAs, outcome, and resolved notes for every image
pair. The generated structural manifest does not itself approve visual parity.

## 3. Build an immutable candidate

Use the checked-in multi-stage Dockerfile and the frozen repository SHA:

```powershell
$sha = git rev-parse HEAD
$nodeImage = 'node:20-alpine@sha256:<operator-approved-digest>'
docker build --pull --target production `
  --build-arg "NODE_IMAGE=$nodeImage" `
  --label "org.opencontainers.image.revision=$sha" `
  --tag "nexus-web-uk:$sha" `
  apps/web-uk
docker image inspect "nexus-web-uk:$sha" --format '{{json .RepoDigests}}'
```

The published release record must identify the immutable application and Node
base-image digests, not only mutable tags. Pin every external base/service image
by the operator-approved digest before production certification. The
Dockerfile's unpinned default exists for local development and is not a release
input.

## 4. Production configuration contract

Supply secrets through the approved secret manager, never Git, image layers,
shell history, or the release ticket:

| Variable | Release requirement |
|---|---|
| `NODE_ENV` | Exactly `production` |
| `ACCESSIBLE_BACKEND_TARGET` | `laravel` until the separate ASP.NET switching gate is approved |
| `LARAVEL_BASE_URL` | Approved Laravel API origin for this deployment |
| `COOKIE_SECRET` | Random, at least 32 characters, not a placeholder |
| `SESSION_SECRET` | Random, at least 32 characters, distinct from `COOKIE_SECRET` |
| `SESSION_REDIS_URL` | Approved persistent `redis://` or TLS `rediss://` endpoint |
| `SESSION_REDIS_PREFIX` | Deployment-specific prefix; do not share a prefix across incompatible environments |

The process must fail before listening when production configuration is unsafe
or Redis cannot connect. `/health` must return `200 OK` only while the session
client is ready, and `503 NOT READY` when it is unavailable.

## 5. Future separately authorized runtime certification

This section is not part of the active frontend-cloning goal and is not standing
authorization to start or provision Laravel. If the owner later authorizes a
live production-integration workstream, run the immutable image in an isolated
network against dedicated test Redis and only the backend environment expressly
identified for that work. The ordinary production-derived Laravel environment
remains forbidden. Prove and retain evidence for:

1. startup refuses missing, placeholder, short, or identical secrets;
2. startup refuses a missing or non-Redis session URL;
3. startup waits for Redis before the HTTP listener becomes ready;
4. two image replicas can read the same authenticated session;
5. a replica restart preserves that session;
6. Redis interruption makes `/health` return `503`, and recovery restores
   `200` without losing valid sessions;
7. request timeouts abort stalled backend work and render the expected
   service-unavailable path;
8. the separately authorized runtime, side-effect, cleanup, and integration
   gates pass at the frozen SHAs without changing a backend contract.

Mocked source-contract proof is sufficient for the active frontend goal but
does not claim this future live-runtime certification. Never substitute the
ordinary Laravel database for a future integration environment.

## 6. Change approval, rollout, and rollback

The release ticket must contain:

- explicit authorization and confirmation that the Web UK deployment hold is
  lifted;
- the exact domain, port, container/network names, backend target, and reverse
  proxy change;
- immutable candidate and rollback digests;
- database statement: Web UK has no migration step and no permission to alter
  either backend schema;
- a session-prefix compatibility decision;
- health, login, tenant, role, module, upload/download, destructive cleanup,
  and manual accessibility verification owners;
- rollback triggers and a maximum observation window.

Roll out without deleting the known-good image. A failed startup, Redis
readiness loss, backend-target mismatch, authentication/session regression,
tenant leak, failed critical workflow, or accessibility blocker triggers
rollback to the recorded digest and restoration of the previous proxy target.
Do not repair a failed release by changing Laravel or ASP.NET contracts from
the Web UK deployment procedure.

## 7. Post-release evidence

Record the deployed digest, configuration identifiers (never secret values),
health/readiness results, representative workflow results, manual review,
observed error rate, and rollback decision. Update the fixed-rubric status only
from this exact-SHA evidence. Keep Laravel-first certification and later ASP.NET
switchability as separate scores.
