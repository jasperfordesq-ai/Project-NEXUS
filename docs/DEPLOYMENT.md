# Project NEXUS Deployment

Last reviewed: 2026-07-30

This is the maintained production deployment guide for Project NEXUS.

Deployment requires explicit owner approval. Do not deploy merely because a code or documentation task is complete.

## Production Model

Production runs on Apache with Docker blue/green app stacks. The live color keeps serving traffic while the inactive color is built, migrated, smoke-tested, and switched into service by the Apache route file.

Queue and scheduler containers are color-scoped alongside the app. During cutover the deploy engine starts the new color's workers, disables the old containers' restart policies, asks Horizon to terminate from the container's process-owning user, and waits for an orderly stop. If Horizon cannot signal its master process, deployment falls back to Docker's graceful stop timeout rather than leaving both colors consuming the same queues. The scheduler receives `schedule:interrupt` before its container stops.

The canonical deploy engine is:

```bash
sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach
```

Use `--detach` for production deploys so long Docker builds do not depend on an open SSH session.

## Public Hosts

| Hostname | Service | Deployment target |
| --- | --- | --- |
| `app.project-nexus.ie` | Primary React frontend | React blue/green frontend container |
| `api.project-nexus.ie` | Laravel API and server-rendered PHP surfaces | PHP blue/green app container |
| `accessible.project-nexus.ie` | Accessibility-first frontend (`web-uk`) | `web-uk` blue/green container — `nexus-blue-webuk` port **3500** / `nexus-green-webuk` port **3600** |
| `accessible-uk.timebank.global` | Community accessibility-first frontend (`web-uk`) | Same `web-uk` container and ports as above |
| `accessible-minehead-and-coast.timebank.global` | Community accessibility-first frontend (`web-uk`) | Same `web-uk` container and ports as above |
| `project-nexus.ie` | Commercial sales site | Separate sales-site deployment |
| `api.project-nexus.net` | Experimental ASP.NET backend | ⛔ **RETIRED 2026-08-10** — container stopped, returns 503. Domain retained. |
| `uk.project-nexus.net` | Experimental Web UK accessible client | ⛔ **RETIRED 2026-08-10** — container stopped, returns 503. Domain retained. |

The accessible frontend **is** its own container. Its source is `web-uk/` — a Node/Express
application that reads the Laravel API — and it runs as `nexus-blue-webuk` /
`nexus-green-webuk`. Apache reaches it through the `Define NEXUS_WEBUK_PORT` line in the
production routes file: **3500** when blue is the active colour, **3600** when green is.

🔴 **Never point an accessible hostname at the PHP app ports (8090 blue, 8190 green).**
Since the Blade accessible frontend was deleted on 2026-08-14 the PHP application has
nothing to serve there, so an Apache vhost rebuilt that way takes the live accessible
site offline.

> 🔴 **Corrected 2026-08-17 — the two paragraphs that used to sit here were wrong.**
> The first read: "The accessible frontend is not a separate SPA container. It is
> rendered by Laravel, with source under `accessible-frontend/` and built assets under
> `httpdocs/build/accessible-frontend/`." Both halves are now false — `accessible-frontend/`
> was deleted on 2026-08-14 and does not exist.
> The second said the `web-uk` takeover decided on 2026-08-11 was "**not built or
> deployed yet**", so "the current instructions stand unchanged". That was already
> contradicted by the two dated corrections further down this page. The takeover was
> **deployed and completed on 2026-08-14**: all three accessible hostnames listed in the
> table above are served by the `web-uk` container, and each answers `/version` with
> `{"service":"nexus-webuk",...}`. Both public URL shapes are preserved, so no
> member-facing address changed. See
> [ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md) for the record.
> One point from the old text still holds: `web-uk`'s own release runbook referred to a
> `.claude/production-containers.md` file that was never imported into this repository,
> so use the deploy steps in this document rather than that runbook.

Before deploying accessible frontend changes, run:

```bash
npm --prefix web-uk run brand:check
npm --prefix web-uk run lint
npm --prefix web-uk test
npm --prefix web-uk run build:css
```

🔴 **Two corrections, both dated 2026-08-14.**

1. The three `*:accessible-frontend*` commands previously listed here **no longer
   exist**. They built and tested the Laravel Blade accessible frontend, which was
   deleted. Following the old text failed at the first line.
2. **The accessible frontend deploy flag is mandatory:**

   ```bash
   bash scripts/deploy.sh --with-webuk
   ```

   Without web-uk in the deploy, the Apache routes file is written without
   `Define NEXUS_WEBUK_PORT`, and since Blade was deleted there is nothing behind the
   fallback arm — every accessible address goes down. A server-side guard
   (`/opt/nexus-php/.webuk-live`) refuses such a deploy, so this fails loudly rather
   than silently. Do not remove that guard.

   🔴 **Update 2026-08-17: `scripts/deploy.sh` now includes web-uk by DEFAULT.** Running
   `bash scripts/deploy.sh` with no flag is the same as `--with-webuk`, so the command
   above is still correct — it is just no longer possible to forget it by accident. The
   flag to be careful with is now `--without-webuk`: giving it deliberately takes every
   accessible hostname offline, because there is nothing to fall back to.

## Gated Deploy From The Dev Machine

The preferred local entry point is:

```bash
bash scripts/deploy.sh
```

That script runs the local static-analysis gate, pushes `main`, and starts the blue/green deploy. It reads production connection details from ignored local secrets, not from committed files.

## Direct Production Commands

When operating directly on the production server:

```bash
sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach
sudo bash scripts/deploy/bluegreen-deploy.sh status
sudo bash scripts/deploy/bluegreen-deploy.sh logs
sudo bash scripts/deploy/bluegreen-deploy.sh logs -f
sudo bash scripts/deploy/bluegreen-deploy.sh monitor
sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach
```

From a development machine, load the private deployment environment first:

```bash
source .secrets.local/deploy.env

ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \
  "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh status"
```

`.secrets.local/deploy.env` defines only `PROD_SSH_HOST` and `PROD_SSH_KEY`. `PROD_SSH_HOST` is already a full `user@host` string, so do not prefix it with a separate user variable — there is no `PROD_SSH_USER`. `-o RequestTTY=force` is required because the remote sudoers uses `use_pty`.

The `.secrets.local/` directory is intentionally not committed.

## Maintenance Mode

Blue/green deploys normally do not need maintenance mode.

Use maintenance mode only when explicitly approved or when a destructive operation requires it:

```bash
sudo bash scripts/maintenance.sh on
sudo bash scripts/maintenance.sh status
sudo bash scripts/maintenance.sh off
```

The maintenance script toggles both enforcement layers: the pre-framework `.maintenance` file and the database maintenance flag. Never toggle only one layer.

## 🔴 The two experimental hosts have NO deploy path from this repository

`api.project-nexus.net` and `uk.project-nexus.net` are live and serving, but
they were deployed from the former `api.project-nexus.net` repository, which
was archived on 2026-08-10. **This repository cannot update either of them.**
That is deliberate, not an oversight: `aspnet-backend/` and `web-uk/` are
secondary, development-only tracks and must never ride along with a Laravel
deploy.

The isolation is enforced in three independent places, all re-verified
2026-08-10:

- `REQUIRED_JOBS` in `scripts/predeploy-ci-verify.mjs` lists no ASP.NET or
  web-uk job, so a red sibling check cannot block a Laravel release
- `Dockerfile.bluegreen` copies an explicit allowlist and `.dockerignore`
  excludes both directories, so neither can enter the production image
  (guarded by `scripts/check-production-image-allowlist.mjs`)
- no deploy script references either directory

🔴 Before any deploy path is built for the ASP.NET backend, note that its
deployed database is **112 migrations behind** this repository (53 applied vs
165 files). Deploying would apply all 112 at once. Since 2026-08-10 the app
refuses to start with pending migrations rather than applying them silently,
so this must be a deliberate, planned operation. See
[PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md).

## Monitoring and backups

| What | Where it runs | Schedule | Alerts via |
| --- | --- | --- | --- |
| Uptime check (4 production hosts) | GitHub Actions (`uptime-check.yml`) | every 15 min | Telegram, on state **change** only |
| Deploy drift watchdog | GitHub Actions | every 30 min | Telegram |
| ASP.NET database backup | Production host cron | ⛔ disabled 2026-08-10 with the retirement | — |
| ASP.NET backup freshness | Production host cron | ⛔ disabled 2026-08-10 with the retirement | — |

🔴 **Telegram credentials live in two different places, and only one is
populated.** `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` exist as **GitHub repo
secrets**, which is why the Actions-based alerts work. The **production host
has no Telegram credentials at all**, so the cron-based backup alerts currently
reach `/var/log/nexus-aspnet-db-backup.log` only. To complete them, create
`/opt/nexus-backend/.backup-alerts.env` on the host containing those two
variables. The backup script reports loudly when they are absent rather than
degrading into silent success.

Scheduled GitHub workflows only run from the **default branch**, so
`uptime-check.yml` does not fire on a timer until it is merged to `main`. It
can be run by hand from the Actions tab meanwhile.

## Rules

- Do not build React locally and upload `dist/`; production builds inside the deployed container image.
- Do not use legacy maintenance-mode deploy paths as the normal production route.
- Do not deploy without an explicit deployment instruction.
- After a deploy, verify the active color, health endpoints, `X-Build` header, and that only the active color's queue and scheduler containers are running.
- 🔴 Observed 2026-08-10: **green** was the active colour (running the queue and scheduler, serving real traffic); blue was standby with its queue and scheduler stopped. Confirm with `bluegreen-deploy.sh status` rather than assuming — this repository's notes have been stale on this before.
