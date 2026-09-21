# Deploying Project NEXUS to a new server — lessons learned

Last reviewed: 2026-09-21

What actually went wrong the first time the platform was stood up on a brand-new server,
why each failure was hard to see, and what to check so it does not happen again.

Written 21 September 2026 after building the isolated staging environment. Every item
below is something that cost real time, not a hypothetical. Two of them were genuine
platform bugs and are now fixed with regression tests; the rest are traps to know about.

If you are standing up a new environment, read [§1](#1-the-one-rule-that-matters-most)
and then work through the checklist in [§11](#11-checklist-for-a-new-environment).

---

## 1. The one rule that matters most

**A server-side check passing does not mean the application works.**

The worst failure of the whole exercise looked like this: DNS resolved, TLS was valid,
every container was healthy, the database had 758 tables, `curl` to the API returned
`{"status":"ok"}`, CORS preflight returned 204 with the correct headers, nine test
accounts could sign in over real HTTPS, cross-community isolation held, and the queue
delivered mail end to end.

The site was unusable. Every page showed "Unable to connect".

The cause was a Content Security Policy that forbade the browser from contacting the
API. CSP blocks a request *before* it is made, so there is no CORS error, no failed
request in the network panel, and nothing in any server log. Only opening the site in a
real browser reveals it.

**Load the site in a browser before declaring a deployment finished.** Not `curl`. A
browser, with the developer console open.

## 2. Hardcoded production values in deployment config

Four separate places hardcode production hostnames where a non-production deployment
needs its own. Three would have pointed staging at **live production**.

| Where | Value | Consequence if unchanged |
|---|---|---|
| `compose.bluegreen.yml` (frontend build arg) | `VITE_API_BASE: https://api.project-nexus.ie/api` | The staging React bundle calls the **production** API |
| `compose.bluegreen.yml` (app/queue/scheduler) | `- APP_URL=https://api.project-nexus.ie` | Laravel's own URL and `frontend_url` are production, so **password-reset and notification emails link to the live site** |
| `compose.bluegreen.yml` (app/queue/scheduler) | `- APP_ENV=production` | Seeders' production guards refuse to run; config caches as production |
| `compose.webuk.bluegreen.yml` | `WEBUK_PUBLIC_ASSET_BASE_URL` default | Accessible frontend fetches browser assets from production |

🔴 **A compose `environment:` entry silently beats `env_file`.** This is the trap that
made `APP_ENV` and `APP_URL` so confusing: the values were correct in the environment
file, and were being ignored. Laravel then cached the resulting config at container
start, so even fixing the environment later had no effect until the container was
recreated.

**Check:** after starting the stack, dump the resolved config and grep it for production
hostnames before you trust anything:

```bash
docker compose --env-file <env> -f compose.bluegreen.yml -f compose.staging-override.yml config \
  | grep -c "api[.]project-nexus[.]ie"   # must be 0 outside production
docker exec <app-container> printenv APP_ENV APP_URL
docker exec <app-container> php -r '$c=include "/var/www/html/bootstrap/cache/config.php";
  echo $c["app"]["env"], " ", $c["app"]["url"], PHP_EOL;'
```

The last one matters: check the **cached** config, not just the environment variable.

## 3. The PHP image has no MySQL client

`php artisan migrate` on an empty database triggers Laravel's `schema:load`, which
shells out to a `mysql` binary. The production PHP image does not ship one:

```
sh: 1: mysql: not found
```

**Load `database/schema/mysql-schema.sql` through the database container's own client
instead**, and as **root** — the application user could not execute the whole dump. The
dump carries the `laravel_migrations` rows, so `artisan migrate` afterwards has only
genuinely newer migrations left to run.

```bash
docker exec -i <db-container> mariadb --default-character-set=utf8mb4 \
  -uroot -p"$ROOT_PW" "$DB" < src/database/schema/mysql-schema.sql
docker exec <app-container> php artisan migrate --force
```

## 4. Seeders cannot be autoloaded in a production image

`composer.json` maps `Database\Seeders\` under **`autoload-dev`**, and the image is built
with `composer install --no-dev`. So `autoload_psr4.php` has no Seeders entry and
`autoload_classmap.php` has **zero** `database/seeders` entries: `artisan db:seed --class`
cannot find *any* seeder in a production image.

Do not regenerate the autoloader on a working container — dev packages are not installed.
Bootstrap the seeder explicitly instead:

```php
require '/var/www/html/vendor/autoload.php';
$app = require_once '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require '/var/www/html/database/seeders/YourSeeder.php';
$s = new Database\Seeders\YourSeeder();
$s->setContainer($app);
$s->run();
```

## 5. Two platform bugs — both now fixed

### 5.1 Queue workers silently did not run

`config/horizon.php` defined supervisors for `production` and `local` only. Horizon looks
up `environments[app()->environment()]`; finding nothing it started the master supervisor,
logged **"Horizon started successfully"**, and spawned **zero workers**. Queued jobs —
password-reset and notification mail included — never ran. The container healthcheck
(which requires both an `artisan horizon` and a `horizon:work` process) failed with
nothing useful in the logs.

Fixed by adding `staging` and `testing` supervisors. `HorizonEnvironmentCoverageTest`
now pins every deployed environment, requires each supervisor to allow at least one
process, and requires staging to mirror production's supervisor shape.

### 5.2 The Content Security Policy hardcoded the production API

Described in [§1](#1-the-one-rule-that-matters-most). The policy listed
`https://api.project-nexus.ie` literally, with no substitution — while
`${NEXUS_API_UPSTREAM}` a few lines below it *was* substituted.

Fixed with a `${NEXUS_CSP_EXTRA_ORIGINS}` placeholder that is empty by default, so
production is byte-identical. The fix is inert unless the whole chain holds, so
`SpaContentSecurityPolicyApiOriginTest` pins every link: the placeholder is present in
both SPA web-server configs, both configs are installed as web-server **templates**,
both images **declare** the variable (envsubst only replaces defined variables — an
undeclared one is emitted verbatim into the live header), and compose passes it through.

🔴 **Patch every directive that names the API, not just the one that broke first.**
The first attempt added the placeholder to `connect-src` alone. That let the app fetch
its data, so it looked fixed — and it was not. `img-src` and `frame-src` list the API
too, so images served from the API origin were still refused; the visible symptom was a
missing default avatar and a bare "Failed to fetch", with the page otherwise working.
`report-uri` is deliberately **excluded**: it takes a single URI, not a source list, and
appending a second origin to it produces an invalid directive. The regression test now
asserts the placeholder in all three source directives *and* its absence from
`report-uri`, so neither half of that can regress.

The wider lesson: a policy failure is per-directive. Fixing the directive whose symptom
you noticed tells you nothing about the others, and the remaining ones fail just as
quietly.

Set it per environment:

```yaml
NEXUS_CSP_EXTRA_ORIGINS=https://api.staging.example.com
```

> **Worth knowing:** building the React app with a **same-origin** `VITE_API_BASE=/api`
> avoids this entirely, because `'self'` is already permitted. That is what CI does. A
> separate API hostname is closer to production and keeps cross-origin behaviour
> testable, but it costs this configuration. Both are defensible — choose deliberately.

## 6. Caching that hides your fix

Three layers cached stale state during this build, each of which made a working fix look
broken.

**The web server caches proxy upstream addresses at configuration load.** The app container was
recreated *after* the frontend had started, so it got a new address and the frontend kept
proxying to the dead one — HTTP 502 on every `/api/...` call. `getent hosts` inside the
container resolved correctly the whole time, which made it look fine. **Restarting the
frontend fixed it.** Production is unaffected because blue/green recreates a whole colour
together — but if you recreate the app container by itself, restart the frontend too.

**Laravel caches config at container start.** Changing an environment variable has no
effect until the container is recreated (the startup `artisan optimize` rebuilds it).

**The service worker caches pages together with their response headers.** After the CSP
was corrected server-side, a browser that had loaded the site earlier kept enforcing the
**old** policy, because the HTML shell was cached with its original headers. A server-side
`curl` showed the fix; the browser did not. Clearing the service worker and its caches for
that origin fixed it immediately. This is self-limiting — a first-time visitor gets the
correct policy — but after any header change, **a browser that visited earlier needs its
service worker cleared**, per origin.

## 7. Things that do not survive a container recreate

Anything `docker cp`-ed into a running container is lost when it is recreated, including
by `up -d --force-recreate`. During this build that applied to:

- an untracked seeder, absent from both the clone and the image
- a patched config file applied before the corresponding image rebuild

Sequence matters: **recreate first, then copy, then run.** Better still, get the file into
the image or the source tree so a rebuild keeps it.

## 8. Plesk specifics

Plesk is a good fit — production runs it, so a Plesk staging host is a closer mirror than
a bare VM, and its front-end web server already terminates TLS with Let's Encrypt. Five traps:

1. **`location /` is already defined.** Plesk includes your `vhost_nginx.conf` *inside*
   the server block it generates, which already owns `location /`. Declaring it again is
   `[emerg] duplicate location "/"`, `httpdmng` refuses the whole config, and Plesk
   keeps serving its "Domain Default page" — which returns HTTP 200, so a status-code check
   reports success. Use a **regex** location instead:

   ```conf
   location ~ ^/ {
       proxy_pass http://127.0.0.1:<port>;
       # ... proxy headers
   }
   ```

   The web server ranks exact `=` above `^~` above regex above plain prefix, so the regex beats
   Plesk's `location /` without colliding with it.

2. **Plesk already owns the ACME location too.** `location ^~ /.well-known/acme-challenge/`
   is also a duplicate. Leave it out — Plesk's own block outranks your regex, so
   certificate renewal keeps working with no help from you.

3. **`plesk bin site --create` rejects `-ip`** ("Unrecognized option"): an additional
   domain inherits the webspace's address.

4. **Plesk creates its own `mail.` and `webmail.` DNS records** for a new subscription, and
   will then refuse to create a domain of that name. Switch its DNS zone off entirely when
   an external provider is authoritative (`plesk bin subscription --update <domain> -dns
   false`), and switch its mail service off if you are capturing mail elsewhere
   (`-mail_service false`). Both also remove services you do not want exposed.

5. **`plesk bin dns --del <domain> -a <host>` silently fails.** It needs the address too:
   `-a <host> -ip <address>`.

Also: Plesk's front-end web server binds the machine's interface address, **not** `127.0.0.1`. A local
`curl --resolve host:443:127.0.0.1` gets connection-refused and looks like an outage that
is not there.

## 9. Azure and DNS

**"No quota" is usually not a quota problem.** A VM size can be refused with
`NotAvailableForSubscription` while the vCPU quota is untouched. Read `restrictions`, not
just the limit:

```bash
az vm list-skus --location <region> --size <size> --all \
  --query "[].{name:name, restrictions:restrictions}" -o json
az vm list-usage --location <region> -o table    # quota — often shows plenty
```

Changing region cannot fix a `NotAvailableForSubscription` restriction unless the target
region permits that size. A brand-new subscription is commonly refused mainstream sizes in
the busiest regions while a quieter region allows them.

**Verify DNS against the authoritative nameserver, not a local lookup.** Two faults hit
this build: a name resolving to **both** the old and new servers (round-robin, so half of
all requests — including certificate validation — went to the wrong host), and a batch of
records created carrying the **old** address because the DNS provider pre-filled it.

```bash
NS=$(dig +short NS example.com | head -1)
dig +short @"$NS" host.example.com A      # one address, and the right one
```

**For a penetration test, keep records DNS-only (unproxied).** Behind a CDN's WAF the
tester probes the CDN, the findings describe the CDN, and their scanning gets rate-limited
— you pay for days spent fighting your own edge. Production sitting behind a CDN while
staging does not is a real difference; record it in the handover rather than hiding it.

## 10. Loading data, and proving a backup

### 10.1 An invalid enum value is accepted and silently emptied

A fixture inserted events with `status = 'published'`. That value is **not** in the
column's enum (`active`, `cancelled`, `completed`, `draft`). MariaDB did not reject the
insert — it stored an **empty string** instead, and reported only a warning. Every row
was written, every count was correct, and every one of those events was invisible to the
application, because nothing matches an empty status.

Nothing in the stack catches this. The insert succeeds, so there is no exception to
swallow and no failed query to find. Read the column definition before writing a status,
type or role value from a script:

```sql
SHOW COLUMNS FROM events LIKE 'status';
```

and after a bulk insert, count by the value you *intended*, not by the row total:

```sql
SELECT status, COUNT(*) FROM events GROUP BY status;
```

An empty bucket in that result is the failure. A row count is not.

### 10.2 A database view does not necessarily restore into a differently-named database

Restoring a dump into a verification database to prove the backup is sound is the right
check, and it found something real: `user_effective_permissions` is a **view**, and its
stored definition qualifies its source tables with the original **database name**. Restored
into `nexus_staging_restore_check`, it fails on first use with

```text
Unknown column 'nexus_staging.user_permissions.permission_id'
```

The data is intact; the view is not portable. This matters beyond a verification restore:
any recovery into a database with a different name — which is how most restores are
staged — gets a broken view. Recreate views after such a restore, or define them without
the database qualifier.

It also explains a discrepancy worth not mis-reading: a table count of 758 against 757 was
this one view, not a missing table. Compare object counts **by type** (`BASE TABLE` versus
`VIEW`) before concluding that data is absent.

### 10.3 A live table will not checksum equal, and that is correct

Comparing every table checksum between source and restore reported two mismatches:
`cron_logs` and `performance_request_hourly`. Both are written continuously by the
scheduler and the request recorder, so they had changed between the dump and the
comparison. Proving it took one step — checksum the source table twice, six seconds
apart, with no backup involved:

```text
cron_logs: checksum CHANGED with no backup involved (a -> b)
```

Exclude genuinely live tables from a restore comparison and say so explicitly, rather
than either reporting them as corruption or quietly dropping them from the count. The
honest result here was **752 stable base tables, 0 mismatches**, with the two live tables
named and the view finding recorded separately.

## 11. Checklist for a new environment

```
[ ] Resolved compose config contains ZERO production hostnames
[ ] APP_ENV / APP_URL correct in printenv AND in bootstrap/cache/config.php
[ ] Horizon has a supervisor block for this APP_ENV
[ ] NEXUS_CSP_EXTRA_ORIGINS set to this environment's API origin (or API is same-origin)
[ ] Schema loaded via the DB container's client as root; migrate --force clean afterwards
[ ] Every DNS name checked against the authoritative nameserver: one address, correct
[ ] Certificate issued and trusted from OUTSIDE (curl without -k returns a real status)
[ ] Queue: a real job dispatched and observed arriving
[ ] SITE OPENED IN A BROWSER, console clean, a page that needs the API actually renders
[ ] Sign-in walked by hand — member, and admin with two-factor
[ ] A file upload attempted
[ ] Frontend container restarted if the app container was recreated separately
[ ] Differences from production written down for whoever reads the results
```

## 12. Write checks that cannot pass falsely

Two of the mistakes above were mine, in the verification rather than the deployment.

A check ran `plesk sbin httpdmng --reconfigure-domain`, which **failed**, and then ran
a config-test command piped to `grep successful`, which **passed** — because the broken config had been
rejected and never applied. The script printed "config test: OK" about a change that
had not taken effect.

A second check grepped a whole file for a policy string and matched a different block,
reporting the two configs as differing when they were identical.

Both are the same error: **verifying a proxy for the thing you care about instead of the
thing itself.** Assert the outcome — "does this hostname serve the application, or Plesk's
placeholder?" — not "did a command somewhere exit zero?".
