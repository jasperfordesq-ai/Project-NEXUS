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
| `aspnet-backend/` | Experimental second backend | None from this repository — see below |
| `web-uk/` | **Incoming** accessible frontend — replaces `accessible-frontend/` (decided 2026-08-11) | None yet; deployment path not built — see below |

### ✅ RETIRED 2026-08-10 — both tracks are now STOPPED

On the owner's explicit instruction, the four containers behind these two
services were **stopped** (not removed):

```text
nexus-uk-frontend-dev   nexus-backend-api   nexus-backend-rabbitmq   nexus-backend-db
```

`api.project-nexus.net` and `uk.project-nexus.net` now return **503 by
design**. The domains are retained.

Why: neither had any traffic (zero requests in the API logs — only its own
scheduled jobs), the data was 13 seed users, and **nothing in this repository
could patch them** because they were deployed from the archived repository.
.NET 8 also leaves support on 2026-11-10. Docker was additionally publishing
the API and **RabbitMQ's management console** on all interfaces; only a
firewall rule stood between that and the internet.

🔴 A dependency found during the pre-flight, worth remembering: Web UK ran
with `API_BASE_URL=http://api:8080`, i.e. it consumed the **ASP.NET** API, not
Laravel. Stopping the backend alone would have broken `uk.project-nexus.net`.

**Nothing was deleted.** Volumes survive (`nexus-backend-db-data` 99 MB,
`nexus-backend-uploads` 6.8 MB, `nexus-backend-rabbitmq-data` 1.1 MB,
`nexus-backend-llama-models` 1.9 GB), as do three verified database dumps and
the images. A final verified backup was taken immediately before stopping.

Reversal is one command:

```bash
sudo docker start nexus-backend-db nexus-backend-rabbitmq nexus-backend-api nexus-uk-frontend-dev
```

The restart policy is `unless-stopped`, so an explicit stop keeps them down
across a host reboot — intended.

The nightly backup cron was disabled at the same time (it would otherwise
alert nightly about a container that is deliberately off). Re-enable with
`sudo mv /etc/cron.d/nexus-aspnet-db-backup.disabled-2026-08-10 /etc/cron.d/nexus-aspnet-db-backup`.

Both hosts were also removed from `scripts/uptime-targets.json`.

The historical record of how they came to be live, below, is retained because
it explains the constraints that still apply if they are ever restarted.

### 🔴 Both tracks ARE live in production, deployed from a repository that is now dead

This table said "None" without qualification until 2026-08-10, which was simply
wrong and led decisions astray. Verified by direct probe on 2026-08-10:

- `https://api.project-nexus.net/health` → `200 {"status":"healthy"}`
- `https://uk.project-nexus.net/health` → `200 OK`

Both are served from the **former `api.project-nexus.net` repository**, deployed
to `/opt/nexus-backend/` on the production host, behind Cloudflare and Apache.
This repository cannot update either of them — not for a feature, not for a bug,
**not for a security fix**.

**Owner decision, 2026-08-10: the old repository and everything it deployed are
declared DEAD.** The domain names are retained. This repository becomes the
control panel and the map for both tracks. Nothing here deploys to those
hostnames yet; designing that is open work, and it must not reuse the dead
repository's deploy machinery (its deploy script was removed from here on
2026-08-10 for mirroring the wrong directory, and its deploy workflow is
hard-disabled upstream).

🔴 Two hazards inherited from the dead deployment, recorded so they are not
rediscovered the hard way:

1. **The live ASP.NET database has no working backup.** The scheduled backup in
   the old repository has failed **156 times out of 156 since 2026-03-08** — 155
   days, zero successes. Root cause is trivial and total: the job runs
   `ssh-keyscan -H` with an **empty** host variable and dies before reaching the
   backup command. There may or may not be a separate backup on the server
   itself; that is unverified.
2. **The ASP.NET app migrates the database on every start.** `Program.cs` calls
   `Database.MigrateAsync()` in every non-Testing environment. Combined with (1),
   an ordinary `docker restart` of that container can irreversibly alter live
   data with no recovery point — a container rollback cannot undo a forward-only
   schema change. Do not restart or replace it before a verified backup exists.

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

### Monitoring moved with the archive

🔴 Archiving a GitHub repository disables its scheduled workflows. The former
repository ran the only automated availability check for the two services it
deployed, so on 2026-08-10 `api.project-nexus.net` and `uk.project-nexus.net`
lost that check while staying live on their public domains.

`.github/workflows/uptime-check.yml` replaces it, and covers the Laravel/React
production hosts as well, which previously had no scheduled availability check
in this repository either. Endpoints live in `scripts/uptime-targets.json`;
adding one means adding an unauthenticated, non-mutating, already-public GET —
this repository is public.

Alerts go to Telegram, matching `deploy-drift-watchdog.yml`, and are sent only
when the state changes rather than on every scheduled run.

## .NET 10 — upgraded in source 2026-08-10, NOT yet deployed

.NET 8 support ends **2026-11-10**, and `api.project-nexus.net` is a live,
internet-facing service, so all five ASP.NET projects were moved to **.NET 10**
(LTS, supported to November 2028). .NET 9 was never a candidate — it was a
standard-term release and went out of support in May 2026.

What changed:

| What | From | To |
|------|------|----|
| `TargetFramework` × 5 projects | `net8.0` | `net10.0` |
| ASP.NET Core / EF Core packages | `8.0.11` | `10.0.10` |
| `Npgsql.EntityFrameworkCore.PostgreSQL` | `8.0.11` | `10.0.3` |
| `System.IdentityModel.Tokens.Jwt` | `8.16.0` | `8.22.0` |
| `Microsoft.Extensions.*` | `10.0.2` | `10.0.10` |
| Docker base images | `sdk:8.0.404` / `aspnet:8.0` | `sdk:10.0` / `aspnet:10.0` |
| CI `setup-dotnet` × 3 jobs | `8.0.x` | `10.0.x` |

Deliberately **not** changed, because they version independently of .NET and
bundling them would hide unrelated risk inside a framework upgrade: Serilog,
Sentry, Swashbuckle, Asp.Versioning, OpenTelemetry, xunit, Testcontainers,
Microsoft.NET.Test.Sdk, coverlet, and **FluentAssertions** — note that
FluentAssertions 8 moved to a paid commercial licence, so that bump is an
owner decision, not a mechanical one.

The 165 EF migration files were **not** regenerated and did not need to be.

Two side effects of the move worth knowing:

- The .NET 10 SDK runs NuGet audit by default, which surfaced a moderate
  advisory (GHSA-pgww-w46g-26qg) in `AngleSharp 0.17.1`, pulled in transitively
  by `HtmlSanitizer 9.0.892`. Bumped to `9.2.995`; the warning is gone.
- `System.Threading.RateLimiting` and `Microsoft.AspNetCore.SignalR.Common` are
  part of the ASP.NET Core 10 shared framework, so their explicit
  `PackageReference` entries were removed (NU1510).

🔴 **Still outstanding: 26 `CS0618` obsolete-API warnings** from EF Core 10 —
`IReadOnlyEntityType.GetQueryFilter()` (mostly in schema tests) and one
`HasCheckConstraint` overload in `NexusDbContext.cs:891`. They compile and run
today but are slated for removal in a future EF major. Fixing them is a
separate change.

🔴 **Ordering constraint for deployment.** Deploying this restarts the ASP.NET
container, which runs `Database.MigrateAsync()` against the live database on
start. A verified backup now exists (taken and restore-tested 2026-08-10,
`/opt/nexus-backend/backups/aspnet-nexus_dev-20260810-140401.*`, with an
off-server copy). There is still **no scheduled backup** for that database —
the nightly cron on that host belongs to a different system.

### 🔴 The deployed ASP.NET stack is STALE. This repository is the source of truth.

Confirmed by the owner 2026-08-10 and measured the same day. Do **not** treat
the deployed ASP.NET backend, its database, or its schema as a reference for
anything:

| | Repository (authoritative) | Deployed instance |
|---|---|---|
| EF migrations | **165** files | **53** applied |
| Newest migration | `20260715184200_AddCompatibilityAuditEntriesTable` | `20260512030000_AddScheduledJobRuns` |
| Date of newest | 2026-07-15 | 2026-05-12 |

The live database is missing **112 migrations** and is roughly two months
behind even the point at which local ASP.NET work paused. It is a stale
artefact of a deployment that has not run in a long time.

Consequences to hold on to:

- The 2026-08-10 database dump is a **safety net for an accidental restart**,
  nothing more. It is not a schema reference, not a data reference, and must
  never be used to "correct" the repository.
- Any future deployment of this backend applies 112 migrations in one go
  against that database. That is a substantial, one-way operation and needs
  planning of its own — not a side effect of shipping a framework upgrade.
- 🔴 This applies to the **ASP.NET** track only. **Laravel production is fully
  up to date and deploys frequently**; the two must not be reasoned about
  together.
- Deciding whether to update or retire the deployed ASP.NET instance is open
  and belongs to the owner.

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

## Known coverage gaps in the imported tracks

Recorded 2026-08-10 after a full audit of what the move carried across. These
are deliberate, not oversights — each says why, and what would change it.

### C# static security analysis — needs a repository setting, not a commit

The former ASP.NET repository ran CodeQL over its C# with its own workflow and
a tuned configuration. Neither came across, and this repository uses CodeQL's
**default setup**, whose language list is `actions`, `javascript-typescript` and
`python`. Web UK's JavaScript is therefore covered; **`aspnet-backend/src` gets
no static security analysis at all**.

This cannot be fixed by adding a file: GitHub does not allow default setup and
an advanced CodeQL workflow to coexist, and importing the upstream workflow
would also move the JS/TS and Python analysis into a workflow this repository
would then have to maintain. The upstream configuration's tuned exclusions
mattered when CodeQL was a blocking gate; under default setup it is
non-blocking alerting, where a noisy alert is dismissed rather than failing a
build.

🔴 **It cannot be enabled until this branch merges.** Default setup only offers
languages GitHub detects on the **default branch**, and `aspnet-backend/` is not
on `main` yet — PR #169 is still a draft. `GET /repos/.../languages` returns PHP,
TypeScript, Blade, JavaScript, Shell, CSS, SCSS, Dockerfile, Python, HTML and
Makefile, with **no C#**, and `PATCH /code-scanning/default-setup` with `csharp`
is rejected: *"One or more languages you selected are not present in the
repository"* (HTTP 422, verified 2026-08-10). The tick box is genuinely absent
from the settings UI for the same reason. This is therefore a **post-merge**
action, not something anyone missed.

**Action once merged:** repository *Settings → Advanced Security → Code scanning
→ CodeQL → Edit configuration*, tick **C#**, keep the existing languages
(`actions`, `javascript-typescript`, `python` — confirm against the live list
first; the API replaces rather than appends). Default setup analyses C# with
build-mode `none`, so no build configuration is needed. Equivalent CLI:

```bash
gh api -X PATCH repos/jasperfordesq-ai/Project-NEXUS/code-scanning/default-setup \
  -f state=configured -f 'languages[]=actions' -f 'languages[]=javascript-typescript' \
  -f 'languages[]=python' -f 'languages[]=csharp'
```

Severity: medium while ASP.NET has no production path; high the moment it gains
one.

### `aspnet-backend/e2e` runs nowhere

The imported Playwright suite (`tests/api/*`, `tests/admin-ui/*`, its own
`playwright.config.ts` and `package.json`) is executed by no workflow.
`.github/workflows/e2e-tests.yml` covers the root `e2e/` tree only. Dependabot
does track its packages, so it is being updated but never run.

Deferred deliberately: wiring it needs a live ASP.NET API plus a PostgreSQL
service container, which is a substantial job for a development-only track that
has been **paused since 2026-07-15**. Revisit when ASP.NET development actually
resumes — that is the trigger, not a date.

### Sibling Markdown is link-checked but not structure-linted

`aspnet-backend/**/*.md` and `web-uk/**/*.md` are outside
`.markdownlint-cli2.jsonc`'s globs. Their links ARE verified, by
`check-markdown-links.ps1` in the `Static contract inventory` job. Only
formatting rules are unenforced, across ~74 largely historical documents.

## Outstanding work register

Maintained list, newest review 2026-08-10. Ordered by what would hurt most if
forgotten. **Read the priority note directly below it first.**

### 🔴 Priority context — this repository is Laravel-first

Confirmed by the owner 2026-08-10. What is in production and what carries the
bulk of ongoing work is, in order:

1. **Laravel** backend/API
2. **Blade accessible frontend** (`accessible-frontend/`)
3. **React frontend** (`react-frontend/`)

`aspnet-backend/` is **secondary and development-only**. It lives here for
contract comparison; it must never slow, gate, or complicate the three tracks
above. The isolation that guarantees this is verified below.

🔴 **`web-uk/` is no longer merely a comparison target, and it is no longer
undeployed.** On 2026-08-11 the owner decided it **replaces** the Blade accessible
frontend, which retires. On **2026-08-12** it was deployed and cut over: it now
serves `accessible.project-nexus.ie`, while Blade continues to serve the community
accessible domains and all `/{tenantSlug}/accessible/...` paths. It is a
**production track**, deployed from this repository, and every deploy from the
cutover onward must pass `--with-webuk` or it refuses to run. The deployment
isolation described below therefore no longer applies to `web-uk/` — it applies to
`aspnet-backend/`, which remains undeployed and unauthorised for deployment.
See [ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md).

### ✅ RESOLVED — the "failing test on main" was a stale local database

Recorded here because the wrong conclusion was reached first, and the way it
was reached is worth not repeating.

`SettingsAuthParityTest::test_message_access_request_creates_a_pending_ask_not_a_grant`
failed locally against clean `main`. **The code was fine.** The local
`nexus_test` database was two migrations behind:

```text
2026_08_08_000001_enforce_one_pending_message_access_request ..... Pending
2026_08_08_000002_reconcile_safeguarding_assignment_conflicts .... Pending
```

The first adds `support_pending_actions.pending_message_relationship_id`.
Without it the insert threw `SQLSTATE[42S22] Unknown column`. After
`php artisan migrate` on `nexus_test`: **45/45 pass**.

🔴 **Why it looked like a code bug, and why that was hard to see.** Three
separate causes collapse into one user-visible outcome in
`app/Http/Controllers/GovukAlpha/Concerns/SettingsAuthParity.php:245`:

```php
$status = 'link-failed';
try {
    $ok = app(SubAccountService::class)->updatePermissions(...);
    $status = $ok ? 'message-access-requested' : 'link-failed';
} catch (Throwable $e) { report($e); }
```

A missing column, a not-found relationship, and a safeguarding refusal are
indistinguishable from the status alone. Worse, `report($e)` wrote **nothing**
to `storage/logs` under the test environment, so the natural first check —
"did it throw?" — returned a misleading "no". The only way through was a
throwaway probe calling the service directly and printing its error bag.

This is the `catch (Throwable)` hazard from AGENTS.md, and it cost real time.
When a GovukAlpha settings action returns `link-failed`, **check
`php artisan migrate:status` on `nexus_test` before reading any code.**

🔴 Genuine follow-up, separate from the above: **`database/schema/mysql-schema.sql`
does not contain `pending_message_relationship_id`**, so the committed schema
dump is behind those two 2026-08-08 migrations. Documented setup
(`php artisan migrate`) loads the dump then applies newer migrations, so this
self-heals — but the dump should be refreshed per the rule in AGENTS.md.
Note `refresh-schema-dump.sh` churns ~400 unrelated lines, so it wants a
deliberate hand-edited commit rather than a bulk regeneration.

### Blocking nothing, but time-bound

| Item | Detail | Trigger |
|---|---|---|
| Deployed ASP.NET is **112 migrations behind** | Repo has 165, live has 53 applied (newest live 2026-05-12). Decide: update it, or retire it. | Owner decision |
| **No scheduled backup** for the ASP.NET database | The 2026-08-10 capture was manual. The nightly cron on that host belongs to `nexus-crm`, a different system, which is why five months of absence went unnoticed. | Before that container is ever restarted routinely |
| **FluentAssertions 8** licence | v8 moved to a paid commercial licence. Left on 6.12.1 deliberately. | Owner decision |
| **CodeQL C#** not enabled | The ASP.NET code gets no automated security analysis. Owner-only settings action. | Medium now; high if ASP.NET gains a production path |

### Known-and-accepted debt

| Item | Detail |
|---|---|
| 26 `CS0618` warnings | EF Core 10 deprecations — `GetQueryFilter()` (mostly schema tests) and one `HasCheckConstraint` overload at `NexusDbContext.cs:891`. Compile and run today; removed in a future EF major. |
| Unrelated package majors held back | Serilog, Sentry, Swashbuckle, Asp.Versioning, OpenTelemetry, xunit runner, Testcontainers, Microsoft.NET.Test.Sdk, coverlet. Deliberately excluded from the .NET 10 move so a framework upgrade did not smuggle in unrelated risk. |
| `aspnet-backend/e2e` runs nowhere | See the section above. Deferred until ASP.NET work resumes. |
| Sibling Markdown not structure-linted | Links are checked; formatting is not. ~74 largely historical files. |

### Verified isolation — why the secondary tracks cannot get in the way

Re-checked 2026-08-10. If any of these stops being true, the monorepo has
started costing the primary tracks something:

- **They cannot block a production deploy.** `REQUIRED_JOBS` in
  `scripts/predeploy-ci-verify.mjs` contains no ASP.NET or web-uk job. A red
  sibling job cannot stop a Laravel release.
- **They cannot enter the production image.** `Dockerfile.bluegreen` uses an
  explicit COPY allowlist (17 instructions, none whole-context), and
  `.dockerignore` excludes both `aspnet-backend/` and `web-uk/`. Guarded by
  `npm run check:production-image-allowlist`.
- **No deploy script references them.**
- **They are cheap.** Measured on a real run: static contract inventory <1 min,
  web-uk checks <1 min, ASP.NET build 3 min. The 20–30 minute values in
  `platform-contracts.yml` are timeout ceilings, not durations.

🔴 One residual cost, accepted knowingly: a change to `app/`, `routes/`,
`config/` or `database/` still wakes `static-contract-inventory`, and a change
to `accessible-frontend/` still wakes the web-uk jobs. That is intentional —
it is how contract drift gets caught — and at under a minute each it is not
worth removing. Revisit only if those jobs grow.
