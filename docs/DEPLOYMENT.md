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
| `accessible.project-nexus.ie` | Accessibility-first frontend | PHP blue/green app container |
| `project-nexus.ie` | Commercial sales site | Separate sales-site deployment |
| `api.project-nexus.net` | Experimental ASP.NET backend | ⛔ **RETIRED 2026-08-10** — container stopped, returns 503. Domain retained. |
| `uk.project-nexus.net` | Experimental Web UK accessible client | ⛔ **RETIRED 2026-08-10** — container stopped, returns 503. Domain retained. |

The accessible frontend is not a separate SPA container. It is rendered by Laravel, with source under `accessible-frontend/` and built assets under `httpdocs/build/accessible-frontend/`.

> 🔴 **That is true today and is changing.** On 2026-08-11 the owner decided that
> `web-uk/` — a Node/Express application consuming the Laravel API — replaces the
> Blade accessible frontend, which retires. When that happens the accessible
> hostname will be served by its **own container**, not the PHP blue/green app
> container, and the table above will need updating. **It is not built or deployed
> yet**, so the current instructions stand unchanged. Both public URL shapes are
> preserved, so no member-facing address changes. See
> [ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md) for the phase
> and the open prerequisites — one of which is that `web-uk`'s own release runbook
> depends on a `.claude/production-containers.md` file that was never imported into
> this repository, so its deployment hold cannot be lifted as written and may need
> superseding by a section in this document.

Before deploying accessible frontend changes, run:

```bash
npm run build:accessible-frontend
npm run test:accessible-frontend:php
npm run test:accessible-frontend:a11y
```

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
