# Prerender engine — operator runbook

Last reviewed: 2026-07-30

Self-service playbook for the 8 alerts in `prerender-alerts.yml`. Sections are named after the alert that pages you; follow the steps in order. The mapping is close to but not exactly 1:1 — `PrerenderHealthRed` and `PrerenderHealthYellow` share one section, and the last two sections are general operator guidance rather than alert responses.

The engine's own health endpoint at `GET /api/v2/admin/prerender/health` is the source of truth — most alerts here are reading its individual checks. When unsure, hit it first.

## PrerenderQueueJammed — "Oldest queued job > 10 min"

**Root cause 9 times out of 10:** the host cron isn't running. Check:

```bash
sudo cat /etc/cron.d/nexus-prerender-processor
sudo systemctl status cron       # or crond on RHEL-family
sudo tail -n 200 /opt/nexus-php/logs/prerender-job-processor.log
```

Recovery:

```bash
# Re-install the cron entry (idempotent):
sudo bash /opt/nexus-php/scripts/deploy/phases/install-prerender-cron.sh

# Drain by hand once:
sudo bash /opt/nexus-php/scripts/prerender-job-processor.sh
```

If the cron is fine but jobs still aren't claiming, the breaker might be tripped — see the next section.

## PrerenderCircuitBreakerTripped

The worker hit the consecutive-failure threshold (default 5 in 10 min). Walk back: open the **Jobs** tab in the admin, filter to `failed`, click the latest row, read `log_excerpt`. Common causes:

- Build output changed and prerender-tenants.sh doesn't know about a new path
- Playwright OOM on a big page (raise the container memory ceiling)
- A tenant's homepage has an infinite redirect loop
- Disk full on the host

When fixed, either wait 15 min for auto-resume or:

```bash
curl -X POST https://api.project-nexus.ie/api/v2/admin/prerender/reset-breaker \
  -H "Authorization: Bearer <admin-token>"
```

or click **"Close breaker now"** in the admin UI health banner.

## PrerenderCacheUnreachable

```bash
docker volume inspect nexus-php-prerendered
docker inspect $(docker ps -q -f name=nexus-.*-php-app) | grep -A2 Mounts
df -h /var/lib/docker
```

If the volume disappeared, recreate it and let the next deploy repopulate.

## PrerenderHealthRed / PrerenderHealthYellow

Always reproducible — hit the health endpoint and follow its `action` strings:

```bash
curl -s https://api.project-nexus.ie/api/v2/admin/prerender/health \
  -H "Authorization: Bearer <admin-token>" | jq .
```

Each failing check carries an actionable suggestion.

## PrerenderRecentFailures

Warning-severity, fires on `nexus_prerender_failures_recent > 0` for 10 minutes: one or more cache paths failed inside the backoff window. This is per-path, not engine-wide — the queue is still working.

List the failing paths and read why each one failed:

```bash
curl -s https://api.project-nexus.ie/api/v2/admin/prerender/failures \
  -H "Authorization: Bearer <admin-token>" | jq .
```

The **Failures** tab in `/admin/prerender` shows the same set. For a specific job, the Jobs tab row drawer carries the `log_excerpt`. Retry one job with `POST /api/v2/admin/prerender/jobs/{id}/retry`.

If every failure is on the same route pattern, the route itself is probably broken (a soft-error page or a render timeout) rather than the engine. If failures keep accumulating they will trip the circuit breaker — see `PrerenderCircuitBreakerTripped` above.

## PrerenderCoverageLow

The Coverage tab has a one-click **"Refresh all stale"** that targets only missing/stale/asset-broken routes. Safer than the broad force-refresh. If the gap is genuine (e.g. you toggled off a feature), use `POST /api/v2/admin/prerender/purge-unexpected` to clean up the no-longer-expected snapshots instead.

## PrerenderAssetInvalid

Snapshots reference build-hashed `/assets/*.js` URLs that no longer exist. Almost always a deploy-time issue (worker ran against the old build). Trigger an auto-recache:

```bash
curl -X POST https://api.project-nexus.ie/api/v2/admin/prerender/auto-recache \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" -d '{"apply":true}'
```

## Emergency: queue is wedged and nothing helps

The admin UI has an **Emergency reset** button (visible on the health banner when status ≠ green). Equivalent CLI:

```bash
curl -X POST https://api.project-nexus.ie/api/v2/admin/prerender/reset-queue \
  -H "Authorization: Bearer <admin-token>"
```

This requeues every claimed/running row older than 30 min AND clears the breaker. It's rate-limited (2 per 5 min per user). The action is audited.

## Where to look for forensics

| What you want | Where |
|---|---|
| Who did what when | `GET /api/v2/admin/prerender/audit` or the **History** tab |
| Why a specific job failed | Jobs tab → click row → `log_excerpt` field |
| Worker logs on the host | `/opt/nexus-php/logs/prerender-job-processor.log` |
| Per-detached-deploy logs | `/opt/nexus-php/logs/prerender-detached-*.log` |
| Bot crawl traffic | `/api/v2/admin/prerender/analytics` or the **Analytics** tab |
| Why a snapshot is stale | Inventory drawer → **Inspect** drawer for that path |
