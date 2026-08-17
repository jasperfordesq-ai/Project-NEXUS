# Web UK Production Release Runbook

> 🔴 **Status header added 2026-08-11.** On that date the owner decided `web-uk`
> becomes the production accessible frontend and the Laravel Blade accessible
> frontend retires. Read `docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` at the repository
> root first: it is the only place the current phase of the changeover is stated.
> **The body below is left as written.** Where it calls `web-uk` a candidate, or
> says it must not replace Blade, that was true when written and is superseded —
> those lines are dated evidence, not current status, and rewriting them would
> destroy the audit trail. The current score lives in
> `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`; the `663/1000` in
> `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is **retired**.
>
> 🔴 **This runbook's deployment hold cannot be lifted as written.** It is
> conditional on a repository-root `.claude/production-containers.md` that was
> never imported into this monorepo. Either import it or supersede it with a
> section in `docs/DEPLOYMENT.md`. Recorded as an open owner prerequisite.

> **Pre-consolidation paths.** Written before the 2026-08-09 move into the
> platform monorepo. Where this document says `apps/web-uk`, `apps/admin`,
> `apps/react-frontend` or `C:\platforms\htdocs\asp.net-backend`, read
> `web-uk/` and `aspnet-backend/` in this repository (the first two `apps/`
> directories were deleted before the move). The paths are left unedited
> because this is a record of what was true at the time.

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
- Before any production action, reread the production container guide
  (`.claude/production-containers.md`) and confirm that its Web UK deployment
  hold has been explicitly lifted. That file was not imported by the 2026-08-09
  move into the platform monorepo — it remains in the history of the former
  `api.project-nexus.net` repository — so it is named here without a link.

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
npm --prefix web-uk run route:matrix
npm --prefix web-uk run api:ledger
npm --prefix web-uk run locales:audit
npm --prefix web-uk run locales:audit-keys
npm --prefix web-uk run locales:audit-templates -- --summary
npm --prefix web-uk run test:accessibility:isolated
./aspnet-backend/scripts/check-markdown-links.ps1 -RepositoryRoot ./web-uk
```

Run these from the monorepo root. `check-documentation-consistency.ps1` was
deleted on 2026-08-10 (it asserted the pre-consolidation layout); the link
check above is the surviving gate and runs in CI for both siblings.

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
$nodeImage = 'node:22-alpine@sha256:<operator-approved-digest>'
docker build --pull --target production `
  --build-arg "NODE_IMAGE=$nodeImage" `
  --label "org.opencontainers.image.revision=$sha" `
  --tag "nexus-web-uk:$sha" `
  web-uk
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

### 6a. Rollback confidence: the route-switch is rehearsed off-production

The blue/green rollback flips the accessible host back by rewriting one Apache
route file and reloading — the `write_apache_routes()` step in
`scripts/deploy/bluegreen-deploy.sh`. That switch logic is rehearsed by
`scripts/test/rehearse-bluegreen-rollback.sh`, a disposable harness (throwaway
`httpd:2.4-alpine`, no production, no Cloudflare, no `systemctl`). It drives the
**real** `write_apache_routes()` and the **real** accessible vhost template, and
all 11 checks pass:

- the route swap is accepted by a real `apachectl configtest` + graceful reload;
- a colour switch moves live traffic to the other colour;
- a rollback to a release **predating** `web-uk` (no `NEXUS_WEBUK_PORT` Define)
  still passes configtest via the `<IfDefine !NEXUS_WEBUK_PORT>` arm, so the
  rollback does not abort itself — the specific risk the vhost template records;
- a bad config is rejected and the previous route file is auto-restored, so there
  is no half-applied switch.

Re-run it before a release if the deploy script or the vhost template changed:

```bash
bash scripts/test/rehearse-bluegreen-rollback.sh   # expect: 11 passed, 0 failed
```

🔴 **What the rehearsal does NOT cover, and still must be confirmed on the real
server:**

1. The same `apachectl configtest` (both states) on the production **Plesk**
   Apache build — the rehearsal proves the logic on stock Apache 2.4, not that
   exact build. Now an expected pass, but run it before cutover, not during a
   rollback. **See the scheduled gate in §6b.**
2. A full end-to-end `rollback` on the live two-colour stack — worker draining,
   health gating, the public-host smoke, and the Cloudflare purge in
   `cmd_rollback` are not exercised by the harness. This needs a live deploy
   window and explicit owner authorization.

### 6b. 🔴 SCHEDULED GATE — on-prod configtest, next deploy window

**Owner-scheduled 2026-08-17.** Before the first cutover or rollback that relies
on the blue/green switch, confirm the `Define`/`<IfDefine>` behaviour on the
**real** production Apache. This is a required step of the next deploy window; do
not rely on rollback until it has passed and the result is recorded here.

Run it on the production server, with sudo, while **no** deploy is in progress:

```bash
sudo bash scripts/deploy/verify-prod-apache-rollback-configtest.sh
# expect: ON-PROD ROLLBACK CONFIGTEST: 3 passed, 0 failed
```

The helper is safe: it only runs `apachectl configtest` (it never reloads,
restarts, or switches traffic), edits the routes file transiently for the second
test, and restores it on exit via a trap. It confirms, in order: the live config
tests clean; the config still tests clean with `Define NEXUS_WEBUK_PORT` removed
(the pre-web-uk rollback state, via the `<IfDefine !...>` arm); and the routes
file is restored and tests clean again.

| Field | Value |
|-------|-------|
| Scheduled | Next deploy window (owner decision, 2026-08-17) |
| Run by | Deploy operator, on the production host, with owner authorization |
| Expected | `3 passed, 0 failed` |
| Result | _record here after the window: PASS/FAIL, date, operator_ |
| If it FAILS | Fix the accessible vhost include (`<IfDefine>` arms) **before** relying on any rollback — do not discover it during a rollback. |

## 7. Post-release evidence

Record the deployed digest, configuration identifiers (never secret values),
health/readiness results, representative workflow results, manual review,
observed error rate, and rollback decision. Update the fixed-rubric status only
from this exact-SHA evidence. Keep Laravel-first certification and later ASP.NET
switchability as separate scores.
