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
| `web-uk/` | Experimental shared accessible client | None from this repository — see below |

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
gh api -X PATCH repos/jasperfordesq-ai/nexus-v1/code-scanning/default-setup \
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
