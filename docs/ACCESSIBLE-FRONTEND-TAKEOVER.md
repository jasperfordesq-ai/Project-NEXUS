# Accessible Frontend Takeover

Last reviewed: 2026-08-13

Project NEXUS has two accessible frontends. This page records the decision that
one replaces the other, which phase that changeover is in, and which document
answers which question. **It is stated once, here.** Every other document points
at this page rather than repeating a status claim that can go stale.

## The decision

On **2026-08-11** the owner decided that `web-uk` becomes the production
accessible frontend and the Laravel Blade accessible frontend retires.

Before that decision, `web-uk` was an uncertified candidate and Blade was the
deployed product. Documentation written in that period says so, and much of it
also *prohibits* replacing Blade. Those prohibitions were correct when written and
are now superseded by this page.

## 🔴 The Blade track is FROZEN — read-only reference (owner decision, 2026-08-13)

The 2026-08-11 decision said Blade *would* retire. **On 2026-08-13 the owner
stopped work on it**, two days before retirement itself:

> Blade is kept **read-only, as reference for building `web-uk`**. It retires
> when `web-uk` is judged finished. No further build effort goes into Blade —
> all build effort goes into the new frontend.

What that means in practice:

- **No new build work in Blade.** No new pages, features, routes, fields, or
  parity work in `accessible-frontend/` or `app/Http/Controllers/GovukAlpha/`.
- **Reading it is the point.** It stays the observable-behaviour specification
  `web-uk` is built against (see Phase A below), so its templates, controllers
  and tests are the reference material — open them freely.
- **Narrow exceptions still allowed**, because it is still serving real members:
  a security fix, a fault making a live page unusable, or a mechanical
  repo-wide sweep it cannot be excluded from (SPDX, lint, translation parity, a
  dependency bump). Anything wider needs the owner.
- **It is not deleted and not switched off.** It still serves the community
  accessible domains and every `/{tenantSlug}/accessible/...` path. Its routes,
  tests and build stay in place until retirement is done as its own reviewed
  change.

🔴 **This reverses the direction of the eight commits in the week to 2026-08-13**
that added parity features *to* Blade (safeguarding tiers, linked-account
activity views, the message-access consent loop). That work is done and stays;
work of that shape must not be started in Blade again.

**Retirement itself is still a separate, unstarted change** — see the table
below. Freezing the track is not retiring it.

## The two frontends

| | Laravel Blade accessible frontend | `web-uk` |
|---|---|---|
| Location | `accessible-frontend/` plus `app/Http/Controllers/GovukAlpha/` | `web-uk/` |
| Stack | Laravel Blade, rendered by the PHP application | Node/Express + Nunjucks + GOV.UK Frontend, consuming the Laravel HTTP API |
| Served by | The Laravel/PHP application container | Its own container, deployed |
| Status | **Still deployed**, serving the community accessible domains and every `/{tenantSlug}/accessible/...` path. Retires at the end of the changeover. | **Deployed and live.** Took over `accessible.project-nexus.ie` on **2026-08-12**. |

🔴 **Both are serving live traffic right now.** The cutover moved one host, not the
whole track. `/version` is the only way to tell which one answered a request:
`web-uk` returns `{"service":"nexus-webuk",…}` and Blade does not.

Both are separate from `react-frontend/`, which is the main product UI and is not
affected by this changeover.

## Public URL shapes — both are preserved exactly

No public address changes. Two shapes exist and both keep working:

- `/{tenantSlug}/accessible/...` on the shared host
- slug-less paths on a community's own domain, resolved from the `Host` header

🔴 **How the community domain actually reaches the platform**, because this was
mis-recorded as a risk and cost an unnecessary worry. There are two hops. The
browser sends `Host: <community domain>` to `web-uk`. `web-uk` then calls the
platform with the upstream host — a container name — and forwards the community
domain as **`Origin`**. `TenantBootstrapController` resolves `tenants.domain` from
`HTTP_ORIGIN`, deliberately only when the Host resolved to the master tenant, which
a container name does. Verified 2026-08-11 by placing an echo server between the two
and reading what was actually sent. So the question "does Node's `fetch` forward a
custom `Host`?" was the wrong one: it does not, and must not.

Legacy `/{tenantSlug}/alpha/...` paths permanently redirect to `/accessible/...`
and remain redirect-compatibility only. The internal Laravel route names,
namespaces and translation files still say `govuk_alpha`; that is an internal
name, not a public one.

## 🔴 Which phase are we in — Phase A

**Phase A: Blade is still deployed** — on the community accessible domains and all
`/{tenantSlug}/accessible/...` paths, even though `web-uk` now owns
`accessible.project-nexus.ie`. The phase turns on Blade being decommissioned, not
on the first host being cut over, so the cutover of 2026-08-12 did **not** end
Phase A. Therefore:

- Blade remains the **observable-behaviour specification**. Where `web-uk`
  disagrees with Blade about what a page does, Blade is right unless the
  difference is a recorded deliberate improvement.
- The route matrix under `web-uk/docs/generated/` is a **live drift alarm**: a
  route appearing in Blade and not in `web-uk` is a real gap.
- The Laravel **API** is the contract source of truth for methods, paths,
  request and response shapes, status codes, auth, roles, modules and side
  effects. That does not change in either phase.

**Phase B begins when Blade is decommissioned.** At that point `web-uk` owns
browser behaviour, the route matrix becomes a historical record rather than an
alarm, and the Laravel API remains the contract source of truth.

Anything you read elsewhere that says "Blade is the source of truth" without
qualification means the Phase A rule above.

## Where the changeover stands

| Piece | State |
|---|---|
| Route and page coverage | **Complete.** 707 of 707 Laravel accessible routes matched, 0 missing. The last gap — recording event attendance from a signed check-in code — was closed on 2026-08-11. |
| Legal acceptance enforcement | **Built.** Server-side enforcement, a `web-uk` interstitial, and a mobile acceptance screen. |
| Bot protection on the contact form | **Built.** The challenge renders on the contact form, and the platform-side configuration fault that silently disabled it is fixed. |
| Cookie-consent record keeping | **Built.** Anonymous visitors' choices are now recorded, as Blade already did. |
| Deployment path | **Built, and locally rehearsed 2026-08-11.** Container service, deploy-script support, `/version`, Apache include, domain inventory with a drift probe, and guards all exist. The production image was run against the local platform and proved: it does not listen at all until Redis is reachable (so a broken deploy aborts); `/health` then returns `OK`; `/version` returns `{"service":"nexus-webuk",…}` — the exact string the deploy smoke test matches; and a real accessible page renders at 200 in 25 KB. **Deployed to the server and cut over on 2026-08-12**, with twelve post-cutover checks passing; the rollback path is documented and verified on the real server, and the guard that stops an ordinary deploy reverting the switch has been armed. From now on a deploy must pass `--with-webuk` or it refuses to run. |
| Manual accessibility sign-off | **Partly done.** Keyboard, focus and reflow evidence exists. Screen-reader sign-off needs a human. |
| Blade retirement | **Not started**, and now the only remaining phase-ending step. The Blade track was **frozen as read-only reference on 2026-08-13** (see above), but decommissioning is still a separate change with its own review, after a soak period. |

Current score: **787/1000** under rubric `WEBUK-W2-PROD-R1` (rescored 2026-08-13,
up from 651 via 710 and 745). See the scoring
table below before comparing that with any earlier number.

🔴 **Do not restate that number here from memory.** This page carried **640** and
**592** simultaneously for the same rubric until 2026-08-13, while the canonical
document said 651. `scripts/check-doc-scores.mjs` could not catch it: the gate
cross-checks values carried in machine-readable doc-consistency comment markers,
and both numbers here were bare prose with no marker. Read the score from
`web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`, which is the only scoring
source, and quote it in one place only. Adding a marker to *this* page is the
wrong fix — the gate will demand it be registered, and a second registered home
for one score is how the disagreement started.

## Prerequisites — six resolved, one still needs an owner answer

### ✅ Resolved

1. **Spare memory on the production VM — MEASURED 2026-08-11, and there is room.**
   The VM has 16 GB. Idle it uses 6.6 GB with 9.3 GB available. A deploy peaks at
   roughly 12.3 GB, because the React image build is given a 4 GB allowance and
   builds at the same time as the PHP image, while both colours stay running — so
   about 3 GB is spare at the worst moment.
   `web-uk` was then measured directly rather than estimated: **66.5 MB idle,
   71.3 MB peak** across ~260 requests over ten distinct templates, with the server
   process at 123 MB. Its limit is set to **384 MB** per colour, not the 512 MB
   originally planned — the measurement did not justify it.
   🔴 One separate finding worth knowing: the only out-of-memory kill on that
   machine (6 August) was the page-prerendering worker **hitting its own 3 GB
   container limit**, not the host running out. It sits at 99.99% of that limit
   permanently. More host memory would not have prevented it, and it has nothing to
   do with `web-uk`.
2. **Two free host ports** — **3500** (blue) and **3600** (green). Checked against
   the API ports (8090/8190), frontend ports (3000/3400/3100) and `web-uk`'s dev
   port (5180); a test asserts they stay distinct.
3. **A Redis database index that is not 0** — **index 4**. The Laravel cache store
   issues a flush, so sessions on index 0 would be destroyed by
   `php artisan cache:clear`, signing out every accessible-frontend user. The
   service refuses to start without this variable set.
4. **The list of community accessible domains** — no longer an owner task.
   `scripts/list-accessible-domains.sh` produces it read-only from the database,
   and `--check` probes each hostname's `/version` to report which frontend is
   actually serving it.

5. **The production container map — RECOVERED 2026-08-11, and the hold it
   describes is already satisfied.** Several documents make production work
   conditional on `.claude/production-containers.md`, which the 2026-08-09 monorepo
   move did not bring across. It was not lost: it was still in the previous ASP.NET
   checkout on the development machine and has been restored to `.claude/`, which
   is gitignored — so it stays machine-local rather than entering the public
   repository, exactly as it was before.
   It contains no credentials and no IP addresses: it is a map of which container
   is which, per-stack deploy rules, the recorded blue/green pair (dated
   2026-05-12, marked "verify live before use"), datastores, and things not to
   recreate.
   🔴 The important part: its "Web UK deployment hold" is narrower than the phrase
   suggests. It forbids deploying `web-uk` **from the ASP.NET production Compose
   path, pointed at the ASP.NET backend**, because that backend is uncertified for
   an unchanged accessible frontend. The deployment path built on 2026-08-11 does
   neither — it deploys from the Laravel blue/green stack with
   `LARAVEL_BASE_URL` pointed at the **same-colour Laravel** container. The hold's
   condition is met by design.
   Because the map is machine-local, a **fresh clone still will not have it**. If
   that matters, supersede it with a section in [DEPLOYMENT.md](DEPLOYMENT.md) —
   an owner decision, since it would make the container topology public.

6. **Error reporting — DONE 2026-08-11.** Sentry project `nexus-webuk` created in
   the existing organisation, matching the `nexus-php` / `nexus-react` naming.
   🔴 The project was only half the job: `web-uk` had **no Sentry integration at
   all**, so the `SENTRY_DSN` the compose overlay passed was read by nothing. The
   SDK is now wired in, privacy-matched to `config/sentry.php` (no PII, query
   strings and cookie headers scrubbed), with health and version endpoints ignored
   so machine traffic does not flood the quota. Verified end to end by sending a
   real event and confirming it arrived as `NEXUS-WEBUK-1`, then resolving it.
   The release tag is `nexus-webuk@<commit>`, matching the other two — without
   that exact shape the service would have been invisible to the 30-minute
   post-deploy error watch, which now counts it as an optional third project.
   The DSN is recorded in `.secrets.local/sentry.env` and **was added to
   `/opt/nexus-php/.env` on the server on 2026-08-11** — appended only, after a
   backup (`.env.bak-pre-webuk-sentry-20260811-163656`), verified as present
   exactly once with a value hash matching local, and with the rest of the file
   proven byte-identical to the backup. It is inert until `web-uk` is deployed.

   **The three session variables were installed on 2026-08-11.** Without them the
   overlay refuses to load and a deploy aborts, because
   `compose.webuk.bluegreen.yml` declares them with Compose's `${VAR:?}` form so a
   deployment cannot boot with a guessable session secret.

   | Variable | Installed as |
   |---|---|
   | `WEBUK_COOKIE_SECRET` | 64 hex characters, generated on the server |
   | `WEBUK_SESSION_SECRET` | 64 hex characters, **verified different** from the cookie secret — the image refuses to start if they match |
   | `WEBUK_SESSION_REDIS_URL` | `redis://nexus-php-redis:6379/4` |

   🔴 **Why index 4 and never 0**, now confirmed with numbers rather than
   reasoning: production Redis has 16 databases, **db0 holds 521 keys** — the
   Laravel cache — and `php artisan cache:clear` issues `FLUSHDB`. Sessions on
   index 0 would be destroyed by an ordinary cache clear, signing out every
   accessible-frontend user. db4 was verified empty.

   Both secrets were **generated on the server** with `openssl rand -hex 32`, so
   they never crossed the network and exist in only one place. Hex is deliberate: a
   `$` or `#` inside a value would be reinterpreted by Compose interpolation or env
   parsing. Appended after a backup
   (`.env.bak-pre-webuk-secrets-20260811-164701`), verified as one occurrence each
   with the correct length and the two proven distinct, and `diff` confirmed a pure
   append. There is **no local copy** — nothing on the development machine needs
   them, and the fewer places they exist the better.

### Still needed from the owner

7. **Whether to publish per-tenant accessible domains** in the public uptime
   target list.

### 🔴 Also outstanding, and not an owner decision

**The Apache `Define` / `<IfDefine>` behaviour that makes rollback cheap is
unverified against the production Apache build.** The accessible vhost include
falls back to the PHP port when `NEXUS_WEBUK_PORT` is not defined, so that a
rollback to a release predating `web-uk` does not fail its own configuration test
and thereby abort the rollback. That must be confirmed with `apachectl configtest`
on the real server, in both states, **before** any cutover — not discovered during
a rollback.

## Documents that carry a status claim

Read this page first; then the specific document for its own subject. Paths under
`web-uk` are given as text rather than links because the published documentation
site builds only `docs/`.

| Document | What it is authoritative for | Watch out for |
|---|---|---|
| This page | The decision, the phase, the URL shapes, the prerequisites | — |
| `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` | The current score and its rubric | The only current scoring source |
| `web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` | The retired W1 audit trail | **Retired.** Its 663/1000 is not current and must not be quoted as such |
| `web-uk/docs/generated/accessible-route-matrix.*` | Route coverage | Generated. Regenerate rather than editing |
| `web-uk/docs/generated/frontend-api-consumer-ledger.*` | Which platform endpoints `web-uk` calls, and whether tests prove each request | Generated |
| `web-uk/docs/MANUAL_ACCESSIBILITY_EVIDENCE.md` | Directed manual and assistive-technology checks | An entry is evidence for exactly the page, browser, input method and viewport listed — not a conformance claim |
| `web-uk/docs/PRODUCTION_RELEASE_RUNBOOK.md` | The release procedure | Its hold references the missing file in prerequisite 5 |
| `web-uk/CLAUDE.md` and `web-uk/AGENTS.md` | Working rules inside `web-uk` | Written during the candidate period; the takeover supersedes their replacement prohibition |
| [PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md) | Repository boundaries and deployment isolation | Its ASP.NET warnings remain in force |
| [DEPLOYMENT.md](DEPLOYMENT.md) | How the platform deploys | Describes the Laravel/React path. The `web-uk` path **is** built and was used on 2026-08-12; every deploy must now pass `--with-webuk` |
| `aspnet-backend/docs/CURRENT_ASPNET_CONTRACT_STATUS.md` | The ASP.NET backend score | A **different** rubric. Never add it to the `web-uk` score |

🔴 **On the ~185 lines elsewhere that still call `web-uk` a candidate.** They were
left as written, deliberately. They are dated evidence records carrying commit
SHAs: rewriting them would destroy the audit trail, "certified" is a property of a
rubric row rather than of a page, and a find-and-replace would also corrupt the
legitimate uses where "candidate" describes *Blade's* behaviour. Each affected
document instead carries one short status header pointing here, and the retired W1
document redirects readers from its own first screen — so a pointer to it lands on
a redirect rather than on a stale number.

## Scoring surface

Four separate scores exist in this repository. Each names its own rubric, and a
CI check refuses a score marker that does not.

| Score | Rubric | Value | Measures | Status |
|---|---|---|---|---|
| `web-uk` production readiness | `WEBUK-W2-PROD-R1` | 787/1000 | Is `web-uk` safe to serve, and can Blade retire? | **Current** — read it from `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`, never from here |
| `web-uk` Laravel-first parity | `WEBUK-W1-FIXED-R1` | 663/1000 | How closely does the candidate clone Blade? | Retired 2026-08-11 |
| ASP.NET contract identity | `ASPNET-CONTRACT-R1` | 712/1000 | Is ASP.NET externally contract-identical to Laravel? | Paused since 2026-07-15 |
| Documentation health | `DOCS-HEALTH-D3-R1` | 1000/1000 index | Documentation and handoff quality | Not a product score |

🔴 **The current 787 exceeds the retired 663, and the two are still not comparable.** The
W1 rubric scored no deployment path, no cutover, no rollback and no Blade
retirement. Those 200 points enter the new denominator for the first time and
start near zero, while three previously-measured areas improved. The mandatory
mapping table in the W2 document accounts for every W1 row. Do not convert one
number into the other, and do not describe either as "nearly finished".

## What is still fenced off

The takeover lifts the pause on `web-uk` work. It lifts nothing else.

- **The ASP.NET backend stays paused**, and its database boundary stays closed.
  Its live database has had no successful backup since 2026-03-08 while the
  application runs migrations on every start, so restarting that service can
  irreversibly change live data with nothing to restore from. See
  [PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md).
- **Nothing is deployed without explicit authorisation.** Building the deployment
  path is not permission to use it.
