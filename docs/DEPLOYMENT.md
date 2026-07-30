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

The accessible frontend is not a separate SPA container. It is rendered by Laravel, with source under `accessible-frontend/` and built assets under `httpdocs/build/accessible-frontend/`.

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

## Rules

- Do not build React locally and upload `dist/`; production builds inside the deployed container image.
- Do not use legacy maintenance-mode deploy paths as the normal production route.
- Do not deploy without an explicit deployment instruction.
- After a deploy, verify the active color, health endpoints, `X-Build` header, and that only the active color's queue and scheduler containers are running.
