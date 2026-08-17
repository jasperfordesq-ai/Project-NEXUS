# Accessible Frontend Takeover

Last reviewed: 2026-08-14

## 🔴 CURRENT STATUS, AND THE ONLY STATUS CLAIM THAT COUNTS

**The takeover is COMPLETE. There is ONE accessible frontend: `web-uk`. The Laravel
Blade accessible frontend was DELETED on 2026-08-14.**

Measured on the live server that day, not inferred from any document:

| Address | Serving | Community resolved from |
|---|---|---|
| `accessible.project-nexus.ie` | `web-uk` | URL slug — `/{tenantSlug}/accessible/...` |
| `accessible-uk.timebank.global` | `web-uk` | hostname (slug-less) |
| `accessible-minehead-and-coast.timebank.global` | `web-uk` | hostname (slug-less) |
| all 11 communities via the platform host | `web-uk` | URL slug |

`/version` is the discriminator: `web-uk` answers it with `"service":"nexus-webuk"`.
Nothing else serves these addresses, so **a host that does not answer `/version` is
broken, not "still on the old frontend"** — that inference was valid before
2026-08-14 and is actively misleading now.

**What was deleted:** `accessible-frontend/`, `app/Http/Controllers/GovukAlpha/`,
`routes/govuk-alpha.php`, `routes/govuk-alpha-parity/`, the `AlphaSetLocale` and
`StripTenantSlugOnAccessibleDomain` middleware, `App\Support\AccessibleErrorPage`,
`App\Http\Middleware\EnsureAccessibleCustomDomain`, and the Blade half of the visual
comparison tooling.

**What deliberately survives, and must not be tidied away:**

- `lang/*/govuk_alpha*.php` — the source `web-uk`'s eleven translation catalogues are
  generated from, and read by `EventsController`, `MemberDataExportService` and
  `StaticPublicPageContentService`. Deleting it strips the live site's translations.
- `web-uk/scripts/blade-route-inventory.frozen.json` — the final Blade route
  inventory (707 routes, 707 matched, 0 missing). `npm run route:matrix` compares
  against this snapshot, so the check still catches a `web-uk` route regression even
  though the codebase it originally compared against is gone.

**Deploying:** `bash scripts/deploy.sh --with-webuk`. The flag is mandatory — see
[DEPLOYMENT.md](DEPLOYMENT.md). A guard on the server refuses a deploy that would
drop `web-uk`, because there is no working fallback any more.

**What the cutover cost:** the fast rollback is gone. Until 2026-08-14, removing one
`Define` line from the Apache routes file sent every accessible address back to a
working Blade site in seconds. Blade is no longer in the release, so the only
rollback is to revert the removal commit and deploy again — roughly 15–20 minutes.
The owner accepted that trade explicitly.

---

## History of the decision

Everything below is the record of how the takeover was decided and executed. It is
kept for provenance. **Where it disagrees with the status block above, the status
block above wins** — in particular, every statement below that Blade "is still
deployed and still serving real members" was true when written and is now false.

## The decision

On **2026-08-11** the owner decided that `web-uk` becomes the production
accessible frontend and the Laravel Blade accessible frontend retires.

Before that decision, `web-uk` was an uncertified candidate and Blade was the
deployed product. Documentation written in that period says so, and much of it
also *prohibits* replacing Blade. Those prohibitions were correct when written and
are now superseded by this page.

## 🔴🔴 BLADE IS NOW HISTORIC — React + Laravel are the sources of truth (owner decision, 2026-08-13, later the same day)

This SUPERSEDES the Phase A rule below, which made Blade the observable-behaviour
specification. The owner's words:

> "We can start forgetting about the blade version. I think it's falling behind, and you
> can document that it's now historic. We plan to retire it once we are 100% sure we have
> everything we need from it. I think the React frontend and the Laravel backend are now
> better sources of truth for what we need building."

**The new model, in priority order:**

1. **GOV.UK Design System and WCAG 2.2 are the presentation authority.** How a page
   looks, announces itself, validates, and is navigated follows GDS. Where GDS and any
   internal precedent disagree, GDS wins. Every page polished to that standard.
2. **`react-frontend/` defines WHAT a member can do** — the feature set, the workflow,
   the states. It is the live product with the most complete behaviour.
3. **The Laravel API defines the CONTRACT** — methods, paths, payloads, status codes,
   auth, roles, module gates, side effects. This never changed and does not change now.
4. **Blade is HISTORIC.** Read it only to recover something not yet obtainable from
   React or the API. It is no longer the arbiter of correct behaviour.

**What this changes in practice:**

- 🔴 **A difference from Blade is no longer automatically a defect.** Previously Blade
  was right unless the divergence was a recorded improvement; now the question is
  whether web-uk matches GDS, React and the API. Blade being different may simply mean
  Blade is behind.
- 🔴 **The generated route matrix stops being a drift alarm and becomes coverage
  evidence.** A route in Blade and absent from web-uk is now a QUESTION, not a gap —
  it may be something Blade has and the product no longer wants. Do not "close" such a
  gap without checking React and the API first.
- The rubric row "Observable Blade behaviour" is now misnamed for what it measures.
  It is left in place for continuity of the score, and its deductions still stand, but
  it should be re-scoped to "Observable product behaviour (React + API)" at the next
  rubric revision rather than silently reinterpreted.
- The web-uk ↔ Blade screenshot comparison set becomes a historical baseline, useful for
  spotting unintended change in web-uk, not a target to converge on.

> 🔴 **SUPERSEDED 2026-08-17 — everything from here to the end of "The two frontends"
> below describes the state BEFORE 2026-08-14, when Blade was still serving members.**
> Blade was deleted on 2026-08-14 and there is now exactly ONE accessible frontend,
> `web-uk`. The instructions in the next few sections — "it is not deleted and not
> switched off", "do not remove its routes", "open them freely", "both are serving live
> traffic right now" — cannot be followed, because the files they refer to do not exist.
> The measured table under "What each surface ACTUALLY serves" is the current state.
>
> These sections are kept, not deleted, because they record the owner's freeze decision
> and because an agent who half-remembers them otherwise goes hunting for
> `accessible-frontend/` and concludes the repository is damaged. Read them as history.

**Blade is still deployed and still serving real members** on the community accessible
domains and every `/{tenantSlug}/accessible/...` path. Historic means "no longer the
specification", not "switched off". Retirement remains a separate reviewed change, and
the owner's condition is explicit: **once we are 100% sure we have everything we need
from it.** Until then, do not delete it, do not remove its routes, and do not disable its
tests or build.

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

> 🔴 **END OF THE SUPERSEDED RUN (see the banner above).** The table and paragraph
> immediately above were true until 2026-08-14 and are false now: there is one accessible
> frontend, `web-uk`, and it serves all three accessible hostnames. `/version` is still
> the way to tell what answered — but a response that is NOT `nexus-webuk` now means
> something is wrong, not that Blade answered. The uptime monitor asserts exactly that.

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
and remain redirect-compatibility only.

🔴 **Qualified 2026-08-17 — that redirect no longer works everywhere.** It works on
every hostname proxied to `web-uk` (all three accessible hosts), because `web-uk`
handles it itself in `web-uk/src/middleware/tenant-routing.js`. It does **not** work on
the API host (`api.project-nexus.ie`) any more: the redirect there lived in
`routes/govuk-alpha.php`, which was deleted on 2026-08-14. The sentence above used to
claim the redirect applied without qualification. Nothing member-facing depends on the
API-host redirect — members reach the accessible site through
`accessible.project-nexus.ie` — but an old `/alpha` bookmark on the API host now 404s
instead of redirecting.

The internal Laravel translation files still say `govuk_alpha`; that is an internal
name, not a public one. (The `GovukAlpha` namespace and `govuk-alpha.*` route names are
gone — only `lang/*/govuk_alpha*.php` survives, and it must not be deleted.)

## 🔴 What each surface ACTUALLY serves — measured 2026-08-17

**Read this table before any claim about what serves an accessible address.** Every row
was probed live, not inferred, because several sentences in these documents were wrong on
exactly this point.

| Surface | Served by | Evidence |
|---|---|---|
| `accessible.project-nexus.ie` (+ `/{slug}/accessible/...` on it) | **web-uk** | `/version` returns `{"service":"nexus-webuk","release":"5afb43ff73da","color":"blue"}` |
| `accessible-uk.timebank.global` (root, slug-less) | **web-uk** | same `/version` response. Community `timebanking-org`. |
| `accessible-minehead-and-coast.timebank.global` (root, slug-less) | **web-uk** | same `/version` response. Community `minehead-and-coast-timebank`. |
| `api.project-nexus.ie/{slug}/accessible` | **nothing — Blade is gone** | the Blade routes that answered here were deleted on 2026-08-14. Not a member-facing path; the React utility bar never linked to it. |
| `/{slug}/accessible` on the MAIN app domains (`app.project-nexus.ie`, `timebanks.us`, `pairc-goodman.com`) | **the React SPA answers** | returns React's shell (`id="root"`), title "NEXUS — Community Timebanking Platform". There is no React route for `accessible`, so it lands on a client-side 404. |

Apache reaches `web-uk` through `Define NEXUS_WEBUK_PORT` in the production routes file —
**3500** when blue is active, **3600** when green is. The active colour on 2026-08-17 was
blue. The PHP app ports (8090 blue, 8190 green) must never be used for accessible traffic.

🔴 **What this table said before, and why it changed — do not restore the old rows.**
Until 2026-08-17 this table was headed "measured 2026-08-14" and recorded **Blade** as
serving `accessible-uk.timebank.global`, `accessible-minehead-and-coast.timebank.global`
and `api.project-nexus.ie/{slug}/accessible`. Those rows described the state **before**
the 2026-08-14 cutover, when Blade still held the two community domains and the API-host
paths. They are kept in this note as history because half-remembering them is how an
operator ends up proxying an accessible domain to the PHP app and taking the live site
down. The cutover moved all three hosts to `web-uk` on 2026-08-14 and deleted Blade.

🔴 **Two older claims in this document were also FALSE and remain corrected:**

1. It said Blade served "**all `/{tenantSlug}/accessible/...` paths**". It never did — on
   the main app domains that path is swallowed by the React SPA, and that is still true
   today with `web-uk` in place.
2. It said no community had an accessible domain. **Two do**, and both are live. That
   claim came from reading the LOCAL snapshot instead of production.

**Members do not reach the React 404**, because the utility-bar link on every tenant's
React frontend points at `accessible.project-nexus.ie/{slug}/accessible` (built by
`buildAccessibleFrontendUrl()`), which is `web-uk`. An old bookmark of `/{slug}/accessible`
on a main domain would land on the React 404 — recorded, low priority, not a member-facing
regression.

## 🔴 Which phase are we in — Phase B, the takeover is COMPLETE

**Phase B, since 2026-08-14: Blade is decommissioned and deleted.** `web-uk` owns every
accessible address. Therefore:

- `web-uk` owns browser behaviour. **GOV.UK Design System + WCAG 2.2** are the
  presentation authority, `react-frontend/` defines what a member can do, and the Laravel
  API defines the contract — see the 2026-08-13 section above.
- The route matrix under `web-uk/docs/generated/` is a **historical record**, not a live
  drift alarm. It compares against the frozen snapshot
  `web-uk/scripts/blade-route-inventory.frozen.json` (707 routes), so it still catches a
  `web-uk` route that disappears.
- The Laravel **API** is the contract source of truth for methods, paths, request and
  response shapes, status codes, auth, roles, modules and side effects. That never
  changed.

🔴 **This heading and section used to read "Which phase are we in — Phase A" and
"Phase A: Blade is still deployed", saying the cutover of 2026-08-12 did not end Phase A
and that Blade remained the observable-behaviour specification.** That was true when
written and is false now: Blade was deleted on 2026-08-14, which is exactly the
"Blade is decommissioned" event that ends Phase A. The old wording is recorded here
rather than deleted because an agent or operator who half-remembers it goes looking for
a Blade site that no longer exists.

Anything you read elsewhere that says "Blade is the source of truth" without
qualification is superseded — it means the old Phase A rule described above.

## Where the changeover stands

| Piece | State |
|---|---|
| Route and page coverage | **Complete.** 707 of 707 Laravel accessible routes matched, 0 missing. The last gap — recording event attendance from a signed check-in code — was closed on 2026-08-11. |
| Legal acceptance enforcement | **Built.** Server-side enforcement, a `web-uk` interstitial, and a mobile acceptance screen. |
| Bot protection on the contact form | **Built.** The challenge renders on the contact form, and the platform-side configuration fault that silently disabled it is fixed. |
| Cookie-consent record keeping | **Built.** Anonymous visitors' choices are now recorded, as Blade already did. |
| Deployment path | **Built, and locally rehearsed 2026-08-11.** Container service, deploy-script support, `/version`, Apache include, domain inventory with a drift probe, and guards all exist. The production image was run against the local platform and proved: it does not listen at all until Redis is reachable (so a broken deploy aborts); `/health` then returns `OK`; `/version` returns `{"service":"nexus-webuk",…}` — the exact string the deploy smoke test matches; and a real accessible page renders at 200 in 25 KB. **Deployed to the server and cut over on 2026-08-12**, with twelve post-cutover checks passing; the rollback path is documented and verified on the real server, and the guard that stops an ordinary deploy reverting the switch has been armed. From now on a deploy must pass `--with-webuk` or it refuses to run. |
| Manual accessibility sign-off | **Partly done.** Keyboard, focus and reflow evidence exists. Screen-reader sign-off needs a human. |
| Blade retirement | **Done, 2026-08-14.** Blade was deleted and the deletion is deployed. 🔴 This row read "**Not started**, and now the only remaining phase-ending step" until 2026-08-17; that is superseded. |

Current score: **873/1000** under rubric `WEBUK-W2-PROD-R1` (rescored 2026-08-13,
651 -> 710 -> 745 -> 730 -> 830 -> 836 -> 845 -> 851 -> 867 -> 873). See the scoring
table below before comparing that with any earlier number.

🔴 **This line read 787 for part of 2026-08-13, which was wrong and was never a real
score.** 787 was an inflated figure produced by awarding credit for fixing defects that
had never been deducted; the honest figure at that moment was 730. It was corrected in
the scoring document but NOT here, because `check-doc-scores.mjs` validates the marker
keys and the rubric column — it cannot see a number written in prose on this page. If
these two documents ever disagree again, the scoring document wins.

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
rehearsed on Apache 2.4, but not yet on the production Apache build.** The
accessible vhost include falls back to the PHP port when `NEXUS_WEBUK_PORT` is not
defined, so that a rollback to a release predating `web-uk` does not fail its own
configuration test and thereby abort the rollback.

- **Rehearsed 2026-08-17** by `scripts/test/rehearse-bluegreen-rollback.sh`, a
  disposable harness that drives the **real** `write_apache_routes()` function and
  the **real** accessible vhost template against a throwaway `httpd:2.4-alpine`
  container (no production, no Cloudflare, no `systemctl`). All 11 checks pass: the
  route swap is accepted by a real `apachectl configtest` + graceful reload; a
  colour switch moves live traffic; a rollback with `NEXUS_WEBUK_PORT` **absent**
  still passes configtest via the `<IfDefine !...>` arm and routes to the PHP port;
  and a bad config is rejected with the previous route file auto-restored. This
  confirms the *logic*.
- **Still outstanding:** the same `apachectl configtest`, in both states, on the
  **real** production Plesk Apache build. It is now an expected pass rather than a
  leap of faith, but it must still be run **before** any cutover — not discovered
  during a rollback.

## 🔴 RETIRING BLADE — the assessment (2026-08-14)

Scored 5/50. This is the largest single item left in the readiness score, and it is much
closer than the score suggests, because what Blade still serves turned out to be **two
hostnames**, not a whole URL space.

### What retirement actually requires

Blade serves exactly three things (see the table above). Two of them are community
hostnames; the third is the API host, which no member is pointed at.

**Step 1 — the code prerequisite is DONE but NOT DEPLOYED.** Both community domains are
`accessible_domain` values, and until 2026-08-13 web-uk **could not resolve them at all**:
`TenantBootstrapController` matched `tenants.domain` only, so a member arriving at either
address through web-uk would have reached the community chooser instead of their own
community. Fixed, with two regression tests proven to fail on the old query — but it is
sitting in unpushed commits. **Cutting either domain over before that fix deploys would
break it for a real community.**

**Step 2 — repoint two vhosts.** Each domain is configured on the SERVER, not in this
repository, at
`/var/www/vhosts/system/<domain>/conf/vhost_ssl.conf`, and currently proxies to
`http://127.0.0.1:${NEXUS_API_PORT}` (8090 — the Laravel/Blade app). The template to copy
is `accessible.project-nexus.ie`, which proxies to `${NEXUS_WEBUK_PORT}` (3500) inside an
`<IfDefine NEXUS_WEBUK_PORT>` arm with a Blade fallback — the arrangement that makes
rollback cheap, and which is already verified against the production Apache build.
🔴 These files are not in the repo, so a rebuild loses them; the same trap is already
recorded for `pairc-goodman.com`.

**Step 3 — soak, then remove.** Only after both domains have run on web-uk for a soak
period does deleting `accessible-frontend/`, `app/Http/Controllers/GovukAlpha/` and the
`govuk-alpha` routes become a separate, reviewable change.

### The evidence that makes this low-risk

**Blade's accessible frontend has essentially no human traffic.** Measured on the active
colour over 7 days to 2026-08-14: **1,070 requests to `/accessible` paths, of which 1,065
were a single crawler** (`jscrawler/0.1`), 2 were my own `curl` probes, 1 was
`scrape_central/1.0`, and 2 were generic browser agents with no session behind them.

🔴 State that honestly rather than as "nobody uses it": the Apache access log has **no
vhost field**, so this total cannot be split per hostname, and a handful of requests are
indistinguishable from a real person visiting once. What it does establish is the order of
magnitude — there is no measurable member population on Blade's accessible pages.

### What is NOT a blocker, and was previously listed as one

- **Route parity.** 707 of 707 Laravel accessible routes are matched by web-uk. Under the
  2026-08-13 decision the matrix is coverage evidence, not a drift alarm.
- **"Still needed from Blade as a reference."** The freeze made Blade a read-only reference
  for BUILDING web-uk. Whether anything more is needed from it is an owner judgement, and
  the honest answer today is that the remaining web-uk gaps are translation strings and
  human sign-off, neither of which Blade can supply.

### What genuinely blocks it

1. **The `accessible_domain` fix must be deployed.** Non-negotiable and first.
2. **Both community domains must be cut over and soaked.** Two real communities.
3. **An owner decision to retire**, which is not a technical step. Freezing is not
   retiring, and this document has said so since the freeze.
4. **The blue/green rollback has never been exercised on production** — 0 of 322 recorded
   deploys used the `rollback` subcommand. That matters more here than for an ordinary deploy,
   because the cheap-rollback arm in those vhosts is the safety net for a cutover.
   - **Partly retired 2026-08-17:** the rollback's route-switch logic is now rehearsed off
     production by `scripts/test/rehearse-bluegreen-rollback.sh` (11/11 pass — see the
     `Define`/`<IfDefine>` note above). What remains genuinely unexercised is a full
     end-to-end `rollback` on the real two-colour production stack (worker draining, health
     gating, public-host smoke, Cloudflare purge), which needs a live deploy window and
     explicit owner authorisation.

### Recommended order

Deploy the fix → repoint `accessible-minehead-and-coast` first (the smaller community) →
soak → repoint `accessible-uk` → soak → rehearse a rollback while there is still something
to roll back to → then, and only then, propose deleting the Blade tree.

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
| `web-uk` production readiness | `WEBUK-W2-PROD-R1` | 873/1000 | Is `web-uk` safe to serve, and can Blade retire? | **Current** — read it from `web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md`, never from here |
| `web-uk` Laravel-first parity | `WEBUK-W1-FIXED-R1` | 663/1000 | How closely does the candidate clone Blade? | Retired 2026-08-11 |
| ASP.NET contract identity | `ASPNET-CONTRACT-R1` | 712/1000 | Is ASP.NET externally contract-identical to Laravel? | Paused since 2026-07-15 |
| Documentation health | `DOCS-HEALTH-D3-R1` | 1000/1000 index | Documentation and handoff quality | Not a product score |

🔴 **The current 873 exceeds the retired 663, and the two are still not comparable.** The
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
