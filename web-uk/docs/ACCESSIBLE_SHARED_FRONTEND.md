# apps/web-uk Shared Accessible Frontend Notes

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

> **Pre-consolidation paths.** Written before the 2026-08-09 move into the
> platform monorepo. Where this document says `apps/web-uk`, `apps/admin`,
> `apps/react-frontend` or `C:\platforms\htdocs\asp.net-backend`, read
> `web-uk/` and `aspnet-backend/` in this repository (the first two `apps/`
> directories were deleted before the move). The paths are left unedited
> because this is a record of what was true at the time.

Last reviewed: 2026-07-15

Status: **Maintained reference — current Web UK direction, not readiness status**

`apps/web-uk` is the implementation target for the future shared accessible
frontend. Its location in the ASP.NET repository does not make ASP.NET a source
of truth. It is not production-ready and must not replace the Laravel Blade
accessible frontend until certification is complete.

## Source Of Truth

Product/UI source of truth:

```text
C:\platforms\htdocs\staging\accessible-frontend
C:\platforms\htdocs\staging\routes\govuk-alpha.php
C:\platforms\htdocs\staging\routes\govuk-alpha-parity
```

Local implementation:

```text
apps/web-uk
```

Backend contract source of truth:

```text
C:\platforms\htdocs\staging\routes
C:\platforms\htdocs\staging\app\Http\Controllers
C:\platforms\htdocs\staging\app\Services
C:\platforms\htdocs\staging\openapi.json
```

Laravel Blade defines browser routes, links, layout, navigation, content
hierarchy, forms, validation presentation, redirects, tenant behaviour, and
workflows. The Laravel backend/API defines methods, paths, payloads, envelopes,
status codes, auth, roles, modules, uploads, downloads, persistence, and side
effects. When the two need to be traced together, the observable Blade workflow
and the Laravel implementation behind it form one authoritative product
contract.

Backend target resolution lives in:

```text
apps/web-uk\src\lib\backend-contract.js
```

By default, `apps/web-uk` resolves API calls to the local Laravel staging base
URL `http://127.0.0.1:8088`. `ACCESSIBLE_BACKEND_TARGET=aspnet` remains future
work and must not be treated as certified compatibility. ASP.NET is not an
input to frontend design or workflow decisions; the separate backend parity
workstream must make it conform to the Laravel contract.

## Current Status Pointer

`CURRENT_WEBUK_PRODUCTION_STATUS.md` is the sole current coordination and
scoring source. This maintained architecture note deliberately does not mirror
its live score, route/API totals, test aggregate, blockers, or working-tree
boundary. Static and code gates are not runtime, manual-accessibility,
production, or ASP.NET-switching certification.

## Repository And Data Boundary

- Change only `apps/web-uk/**` and approved documentation pointers from this
  workstream.
- Do not change ASP.NET controllers, services, entities, tests, or migrations.
- `apps/react-frontend` was deleted on 2026-08-09; do not recreate it.
- Treat the Laravel repository and its ordinary local database as read-only.
  Never edit Laravel source, run Laravel migrations, alter its schema, query its
  database directly, or perform database cleanup.
- Live login, mutation, upload, download, destructive, cleanup, migration, and
  database operations are outside the active frontend-cloning goal and must not
  be run against any Laravel environment. Implement those browser workflows
  from read-only Laravel source and verify them with mocked contracts and safe
  Web UK-owned fixtures. A future live-runtime workstream requires a separate
  explicit owner request and does not block source implementation.
- Do not touch production containers or production data.

## Historical Evidence Boundary (2026-07-10)

This section preserves the 2026-07-10 checkpoint and is superseded by
`CURRENT_WEBUK_PRODUCTION_STATUS.md`. At that checkpoint the checkout had
passed `45/45` Jest suites (`1,411/1,411` tests),
ESLint, the brand-policy gate, CSS compilation, the `62/62` Chromium/axe gate
in `749.3` seconds (`12.3` minutes),
and the live `19/19` Blade marker comparison. The generated route matrix reports
`608` Laravel declarations, `610` Web UK declarations, `608` matches, `0`
missing, `0` extra parity routes, and `3` ignored infrastructure routes.

The browser matrix includes signed Arabic dashboard, account, structurally
rebuilt own-profile, contextually localized profile-settings, activity,
Reviews summary/list, notifications, messages, wallet overview/management, the
core member directory plus discovery/nearby/insights, achievements, leaderboard,
Knowledge Base index/detail, Help Centre/Trust and Safety, About/Guide/Features/FAQ, Legal/accessibility/Contact/report-problem/cookies/email-utilities,
and NEXUS-score pages at 320
CSS pixels, with RTL/reflow and serious/critical
axe assertions. Authenticated cases have a 90-second ceiling to accommodate the
observed local Laravel API latency; the accessibility assertions are unchanged.

Localization is structurally complete across `11` locales, `36` namespaces,
and `8,837` keys per locale. It is not linguistically complete: the non-English
catalogs each retain roughly `4,096-4,199` English-identical values and `13`
namespaces are wholly English in the authoritative read-only Laravel source.
The conservative audit reports `315` templates and `0` remaining safe exact
matches; that result does not cover contextual copy, pluralisation, dynamic
labels, validation language, or manual RTL review.

Browser inspection at 320 CSS pixels confirmed Arabic `lang`/`dir`, one
main/H1, unique IDs, a valid focusable skip-link target, no horizontal overflow,
and usable forced-colour rendering on the public login and signed dashboard.
The deterministic gate now additionally drives native Chromium Tab/Enter input
through the cookie/skip-link sequence, proves main and error-summary focus,
checks error-link field focus and Arabic error announcements, and runs axe in
forced-colour mode. Live current-source inspection confirmed the summary is the
active alert and the forced-colour select/footer pairs are white on black. The
authenticated Arabic dashboard case now proves Laravel-catalog headings,
welcome/CTA/stat/progress/quick-link/feed/listing copy, localized numbers, RTL
reflow, and axe at 320 CSS pixels without the former hard-coded English labels.
The signed Arabic account hub additionally proves catalog-backed account/card
copy and sign-out action with the same RTL/reflow/axe checks; mocked rendering
also covers the localized unread-message plural. Actual screen-reader,
assistive-technology, Firefox, and WebKit certification remain open.

At that historical checkpoint, the Laravel smoke was recorded green in
deterministic serial shards. Because it used the ordinary Laravel environment,
the result is now invalid as certification and is retained only as
regression-discovery history.
The base bucket passed `93/93`; six shards then covered all `276` default module
pages and all `270` default body markers. Shards 1, 2, 4, and 6 passed
`101/101`. Shards 3 and 5 each initially passed `100/101` because one request
exceeded 60 seconds (`/ideation/2/ideas/1` and `/jobs/employers/14`); each
isolated retry passed `11/11`. Thus all `639` distinct current default checks
passed with no repeatable route failure. The two latency aborts are retained as
an operational warning, and read/auth/gate/body coverage does not certify
uploads, downloads, deletes, or other side effects; those require disposable
fixtures.

The run also found and corrected federation precondition handling. Laravel's
fixture returns `403`/`FEDERATION_NOT_ENABLED` on nine federation-backed pages
for a signed member who has not opted in; Web UK now redirects those requests
to the tenant-safe `/federation/opt-in` page instead of rendering `503`. The
focused current-source federation slice passed `13/13`.

Laravel remains the authoritative backend and visual/workflow source and must
remain read-only from this repo. ASP.NET switching is future work and is not
certified. The principal source/API boundaries are public Blade feed permalinks
backed by protected v2 payload endpoints; incomplete resource detail/count and
cursor contracts; missing bearer GDPR-history, password-gated email-change, and
atomic member multi-write contracts; exchange `prep_time`, idempotency, and
rating/attention drift; review mutation/listing-review gaps; and missing matches
event coverage plus event/volunteering dismiss support.

The commands below authenticate and may write server-side limiter, audit,
session, preference, or workflow state. They are retained future tooling and
are forbidden in the active frontend-cloning goal. Do not provision or request
an environment for them; they must never target the ordinary
`127.0.0.1:8088` production-derived snapshot.

```bash
npm run smoke:laravel
npm run smoke:laravel:local
```

In a separately authorized future workstream, `smoke:laravel` uses an existing
Web UK process at `WEB_UK_BASE_URL`; `smoke:laravel:local` starts the Web UK app
on an ephemeral local port with smoke-safe secrets, defaults to
`ACCESSIBLE_BACKEND_TARGET=laravel` and `TENANT_ID=2`, runs the
same Laravel runtime harness, then closes the server. This avoids false
`fetch failed` results from ad hoc background process launch wrappers.

## Historical Laravel Smoke Log (Superseded As Current Evidence)

The following records explain what earlier slices proved. They do not supersede
the current evidence boundary above.

Historical broad live evidence: chunked Laravel runtime smoke was recertified
against Laravel `http://127.0.0.1:8088` and tenant-correct temporary Web UK
processes started with `ACCESSIBLE_BACKEND_TARGET=laravel` and `TENANT_ID=2`.
That historical default scope was `633` checks: `280` module-page checks, `282`
body-text contract checks, 23 gated-status checks, 14 unsigned auth-required
redirect checks, 3 unsigned login redirects, 19 signed redirects, 2 content-type
checks, 3 cookie-consent POST workflows, logout, and the 6 auth/health checks.
The 2026-07-10 clubs correction moved the local `hour-timebank` no-active-club
fixture from a 2xx module/body-text page to signed gated `/clubs` `404`,
matching Laravel's active-club gate.
On 2026-07-10, `smoke:laravel:local` passed the core Laravel-backed flow with
10/10 checks. The module-page bucket is also green by chunks: chunk 1/8 passed
106/106 against a tenant-correct temporary Web UK process, and chunks 2/8
through 8/8 passed 106/106 through `smoke:laravel:local`. The body-text bucket
is green by chunks too: chunk 1/8 passed 107/107, chunk 2/8 passed 107/107, and
chunks 3/8 through 8/8 passed 106/106 with `SMOKE_MODULE_PAGE_PATHS=none`. The
harness now refreshes and retries a signed gated check once when Laravel returns
a login redirect mid-batch, preserving route-authorization proof without
forcing a full login before every gated route. Some expected Laravel `403`
routes still log application errors while the harness records the intended
green gated-status checks.

The command checks Laravel API reachability, web-uk health, unsigned `/account`
redirects, `/login` CSRF handling, login POST redirect behavior, and a signed
`/account` render. It also verifies the default public Laravel-backed module
pages `/volunteering`, `/organisations`, `/organisations/browse`, `/kb`, and
`/help` return successful responses from the web-uk app while it is pointed at
Laravel, plus the signed public auth aliases `/login`,
`/login/forgot-password`, `/password/reset?token=reset-token`, `/register`, and
the signed module pages `/explore`, `/saved`, `/notifications`,
`/members`, `/members/discover`, `/resources`, `/skills`, `/goals`,
`/wallet`, `/messages`, `/connections`, `/connections/network`, `/matches`,
`/matches/board`, `/activity`, `/achievements`, `/leaderboard`,
`/nexus-score`, `/profile/settings`,
`/settings/appearance`, `/settings/data-rights`, `/federation`, `/courses`,
`/courses/mine`, `/marketplace`, `/marketplace/mine`, `/events`,
`/events/new`, `/listings`, `/search/advanced`, `/premium`, and `/podcasts`,
plus deeper signed subpages
across profile, settings, achievements, leaderboard, federation, courses,
marketplace, static/legal/support, goals, groups, ideation, jobs, message
groups, polls, resource-library, reviews, wallet management, and volunteering
after the same login flow. Before login, it also checks auth-required
parameterised pages (`/federation/listings/1/1`, `/federation/partners/1`,
`/ideation/1`, `/organisations/1`, `/podcasts/1`,
`/podcasts/1/episodes/1`, `/resources/1/download`, `/users/1/collections`,
`/marketplace/slots/1/edit`, `/me/collections/1`,
`/search/saved/1/delete`, and `/volunteering/certificates/ABC123/download`)
redirect to `/login?status=auth-required`, and signed gated `/clubs` returns
`404` for the local no-active-club fixture. The harness
defaults to Laravel's local E2E fixture
(`e2e.user.a@project-nexus.local`, `TestPassword123!`, tenant slug
`hour-timebank`).

On 2026-07-07 the command passed `93/93` checks end-to-end against a temporary
web-uk process started with `TENANT_ID=2` and
`WEB_UK_BASE_URL=http://127.0.0.1:5293`. A follow-up live probe against
`WEB_UK_BASE_URL=http://127.0.0.1:5294` expanded the default harness, which then
passed `158/158` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5295`.
`/feed` is now part of the default signed page set and renders the local
Blade-style feed page with an empty/error state when Laravel's feed collection
API is unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5297` passed `159/159` checks. The
plain `/connections` index is now also in scope and renders the signed page
with an empty/error state when Laravel's legacy connections API is unavailable,
and a later run against `WEB_UK_BASE_URL=http://127.0.0.1:5298` passed
`160/160` checks. Plain `/members` is now also in scope and renders the signed
member directory with an empty/error state when Laravel's legacy members API is
unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5299` passed `161/161` checks. `/events/new`
and `/marketplace/onboarding` are now also in the default signed scope and
render their Blade-style forms with empty/error setup state when Laravel helper
APIs are unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5302` passed `163/163` checks. The
feature/role-gated pages `/jobs/bias-audit`, `/jobs/talent-search`, and
`/marketplace/coupons` are now covered as expected signed-session `403` checks;
`/onboarding` and `/premium/manage` are now covered as expected signed-session
redirect checks; a later run against `WEB_UK_BASE_URL=http://127.0.0.1:5307`
passed `168/168` checks. Signed public auth aliases `/login`,
`/login/forgot-password`, `/password/reset?token=reset-token`, and `/register`
are now covered as signed-session 2xx checks; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5308` passed `172/172`: 6 auth/health checks,
161 module/page checks, 3 gated-status checks, and 2 redirect-status checks. The
harness default timeout is now `60000` ms because Laravel-backed
profile/settings and discovery pages can be slow in the local fixture. Keep the
tenant context visible: the same Laravel E2E credentials return `401` when
web-uk does not send Laravel's tenant id `2` as `X-Tenant-ID`.
`/login/two-factor` is now covered as a signed-session redirect check when the
session-backed 2FA token is absent; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5309` passed `173/173`: 6 auth/health checks,
161 module/page checks, 3 gated-status checks, and 3 redirect-status checks.
The default smoke scope now covers 12 matched unsigned auth-required
parameterised route redirects. An earlier full default Laravel-backed run against a
temporary web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:5322`, started
with `TENANT_ID=2`, passed on 2026-07-07: `181/181` checks, `0` failures,
`161` module-page checks, 8 unsigned auth-required redirect checks, 3
gated-status checks, and 3 signed redirect checks in 352.8 seconds.
For targeted CLI runs, `SMOKE_MODULE_PAGE_PATHS`,
`SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS`, `SMOKE_GATED_PAGE_PATHS`, and
`SMOKE_REDIRECT_PAGE_PATHS` accept comma/newline-separated lists, and the
portable sentinel `none` disables that group. A targeted live CLI run against
`WEB_UK_BASE_URL=http://127.0.0.1:5317` with those three variables set to
`none` passed `14/14`, including all eight auth-required parameterised redirect
checks. For repeatable live proof on slower shells without relaxing the default
scope, set `SMOKE_MODULE_PAGE_CHUNK=N/M` for the module-page sweep or
`SMOKE_BODY_TEXT_PAGE_CHUNK=N/M` for the body-text sweep to run deterministic
one-based slices, for example `SMOKE_MODULE_PAGE_CHUNK=1/4` or
`SMOKE_BODY_TEXT_PAGE_CHUNK=1/8`; the auth, unsigned auth-required, gated, and
redirect groups still run unless each is explicitly disabled with `none`.
All 16 chunked live runs against `WEB_UK_BASE_URL=http://127.0.0.1:5321` with
`TENANT_ID=2` and `SMOKE_MODULE_PAGE_CHUNK=N/16` passed on 2026-07-07:
`481` total repeated checks, `0` failures, and `161` collective module-page
checks across the default sweep. Each shard also reran the auth/API setup,
unsigned auth-required redirects, gated status checks, and signed redirect
checks.
A targeted live Laravel-backed run against
`WEB_UK_BASE_URL=http://127.0.0.1:5325`, started with `TENANT_ID=2`, passed on
2026-07-07: `24/24` checks, `0` failures, with 6 auth/health checks and 18
real-fixture parameterised module pages. The checked pages were `/events/6`,
`/events/6/map`, `/events/6/polls`, `/events/6/translate`,
`/volunteering/opportunities/307`, `/organisations/636`,
`/organisations/636/jobs`, `/organisations/opportunities/307/apply`,
`/jobs/90764`, `/groups/484`, `/groups/484/invite`,
`/groups/484/notifications`, `/groups/484/image`,
`/groups/484/announcements`, `/groups/484/discussions`, `/groups/484/files`,
`/groups/484/manage`, and `/resources/10/comments`.
Those 18 stable real-fixture pages are now included in the default module-page
sweep. The default scope also covers `/groups/484/discussions/new`,
`/jobs/90764/qualified`, `/members/77/insights`, `/listings/42/report`,
`/listings/42/exchange-request`, `/listings/42/comments`,
`/feed/hashtag/timebank`, `/feed/item/listing/42`, `/messages/77`,
`/messages/new/77`, `/volunteering/organisations/636/dashboard`,
`/volunteering/organisations/636/manage`,
`/volunteering/organisations/636/settings`,
`/volunteering/organisations/636/volunteers`, and
`/volunteering/organisations/636/wallet`, `/courses/1`, `/courses/2`,
`/courses/instructor/1/edit`, `/courses/instructor/2/edit`,
`/federation/partners/1`, `/federation/partners/5`,
`/federation/members/353`, `/federation/members/353/transfer`,
`/federation/members/351`, `/ideation/23`, `/ideation/22`, `/ideation/2`,
`/ideation/23/edit`, `/ideation/23/manage`, `/ideation/23/drafts`, and
`/ideation/23/outcome` as signed 2xx pages; owner-only
job/listing/message/group-exchange/resource/coupon checks for `/jobs/90764/edit`,
`/jobs/90764/analytics`, `/jobs/90764/pipeline`, `/jobs/90764/applications`,
`/listings/42/analytics`, `/group-exchanges/1`, `/messages/groups/33`,
`/resources/10/delete`, `/coupons/1`, and `/coupons/2` as
signed `403` responses; plus signed redirects from `/events/6/recurring-edit`
to `/events/6/edit`, `/groups/484/edit` to `/groups/484`,
`/courses/42/certificate` to `/courses/42?status=certificate-failed`, and
`/federation/messages/conversation/77` to `/federation/messages`,
`/courses/1/learn` to `/courses/1?status=enrol-required`,
and `/federation/messages/conversation/353` to `/federation/messages`.
Direct Laravel API checks on 2026-07-08 showed the E2E user has completed
course 2, so `/courses/2/learn` and `/courses/2/certificate` are now treated
as signed 2xx module-page fixtures rather than signed redirect fixtures. A
focused live smoke against `WEB_UK_BASE_URL=http://127.0.0.1:6351` and
`LARAVEL_BASE_URL=http://127.0.0.1:8092` passed `12/12` checks for the two
course 2 module pages, and the isolated current redirect sweep passed `29/29`
checks with `19` signed redirects. A targeted
live run against `WEB_UK_BASE_URL=http://127.0.0.1:5336`, started with
`TENANT_ID=2`, passed on 2026-07-07: `28/28` checks, `0` failures. A full
default Laravel-backed run against `WEB_UK_BASE_URL=http://127.0.0.1:5336`,
started with `TENANT_ID=2`, passed on 2026-07-07: `247/247` checks, `0`
failures, `210` module-page checks, 8 unsigned auth-required redirect checks,
13 gated-status checks, and 10 signed redirect checks; `npm run smoke:laravel`
exited `0`.
The default scope now also covers `/`, `/blog/feed.xml`, `/wallet/export.csv`,
`/wallet/recipients`, and `/marketplace/coupons/new` as signed 2xx routes;
`/coupons` and `/marketplace/coupons/5/edit` as signed `403` responses; and
`/password/reset` redirecting to `/login/forgot-password`. A targeted live run
against `WEB_UK_BASE_URL=http://127.0.0.1:5336`, started with `TENANT_ID=2`,
passed on 2026-07-07: `14/14` checks, `0` failures. The expanded default scope
now contains `255` checks: `215` module-page checks, 8 unsigned auth-required
redirect checks, 15 gated-status checks, and 11 signed redirect checks, plus the
6 auth/health checks. The single unchunked live command exceeded a 600-second
wrapper timeout, so the scope was recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4`
against the same temporary process: all four chunks passed on 2026-07-07 with
`375` repeated checks, `0` failures, and `215` collective module-page checks.
The default scope now additionally covers `/account`, `/polls/20`,
`/polls/20/rank`, `/listings/90967/comments`, `/listings/90967/report`, and
`/listings/90967/exchange-request` as signed 2xx routes;
`/listings/90967/analytics` and `/jobs/talent-search/77` as signed `403`
responses; and redirects from `/courses/1/certificate` to
`/courses/1?status=certificate-failed`,
`/jobs/90764/applications/export.csv` to
`/jobs/90764/applications?status=export-failed`, and `/onboarding/profile` to
`/dashboard`. A targeted live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5337`, started with `TENANT_ID=2`, passed on
2026-07-07: `17/17` checks, `0` failures. The expanded default scope now
contains `266` checks: `221` module-page checks, 8 unsigned auth-required
redirect checks, 17 gated-status checks, and 14 signed redirect checks, plus the
6 auth/health checks. The expanded default scope was recertified with
`SMOKE_MODULE_PAGE_CHUNK=N/4` against the same temporary process: all four
chunks passed on 2026-07-07 with `401` repeated checks, `0` failures, and `221`
collective module-page checks.
The default scope now additionally covers `/marketplace/267`,
`/marketplace/267/buy`, `/marketplace/267/offer`, `/marketplace/267/report`,
`/marketplace/267/edit`, and `/blog/90001/likers/1` as signed 2xx routes. A
targeted live run against `WEB_UK_BASE_URL=http://127.0.0.1:5338`, started with
`TENANT_ID=2`, passed on 2026-07-07: `12/12` checks, `0` failures. The expanded
default scope now contains `272` checks: `227` module-page checks, 8 unsigned
auth-required redirect checks, 17 gated-status checks, and 14 signed redirect
checks, plus the 6 auth/health checks. The expanded default scope was
recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4` against the same temporary
process: all four chunks passed on 2026-07-07 with `407` repeated checks, `0`
failures, and `227` collective module-page checks.
The default scope now additionally covers `/events/14`, `/events/14/map`,
`/events/14/polls`, `/events/14/translate`, `/groups/482`,
`/groups/482/announcements`, `/groups/482/discussions`,
`/groups/482/discussions/new`, `/groups/482/files`, `/groups/482/manage`,
`/groups/482/invite`, `/groups/482/notifications`, `/groups/482/image`,
`/marketplace/6`, `/marketplace/6/buy`, `/marketplace/6/offer`,
`/marketplace/6/report`, `/marketplace/6/edit`, `/polls/8`, `/polls/4`,
`/feed/item/listing/90967`, `/courses/2/learn`, `/courses/2/certificate`,
and `/blog/64/likers/1` as signed 2xx routes;
plus redirects from `/events/14/recurring-edit` to `/events/14/edit`,
`/groups/482/edit` to `/groups/482`, `/onboarding/interests` to
`/dashboard`, `/onboarding/safeguarding` to `/dashboard`, and
`/onboarding/confirm` to `/dashboard`. A targeted live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5339`, started with `TENANT_ID=2`, passed on
2026-07-07: `34/34` checks, `0` failures. The expanded default scope now
contains `300` checks: `249` module-page checks, 8 unsigned auth-required
redirect checks, 17 gated-status checks, and 20 signed redirect checks, plus the
6 auth/health checks. The expanded default scope was recertified with
`SMOKE_MODULE_PAGE_CHUNK=N/4` against the same temporary process: all four
chunks passed on 2026-07-07 with `453` repeated checks, `0` failures, and `249`
collective module-page checks.
The default scope now additionally covers `/marketplace/category/electronics`,
`/marketplace/category/home-garden`, `/marketplace/category/free-items`,
`/marketplace/category/services`, and `/marketplace/seller/1` as signed 2xx
routes. A targeted live run against `WEB_UK_BASE_URL=http://127.0.0.1:5340`,
started with `TENANT_ID=2`, passed on 2026-07-07: `11/11` checks, `0` failures.
The expanded default scope now contains `305` checks: `254` module-page checks,
8 unsigned auth-required redirect checks, 17 gated-status checks, and 20 signed
redirect checks, plus the 6 auth/health checks.
The expanded default scope was recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4`
against the same temporary process: all four chunks passed on 2026-07-07 with
`458` repeated checks, `0` failures, and `254` collective module-page checks.

The default Laravel runtime smoke scope now additionally covers
`/blog/test-sitemap-blog-post`, `/blog/test-sitemap-blog-post/comments`,
`/blog/timebank-ireland`, `/blog/timebank-ireland/comments`, and `/kb/90001`
as signed 2xx routes. A targeted live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5341`, started with `TENANT_ID=2`, passed on
2026-07-07: `11/11` checks, `0` failures. The expanded default scope now
contains `310` checks: `259` module-page checks, 8 unsigned auth-required
redirect checks, 17 gated-status checks, and 20 signed redirect checks, plus the
6 auth/health checks.
The expanded default scope was recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4`
against the same temporary process: all four chunks passed on 2026-07-07 with
`463` repeated checks, `0` failures, and `259` collective module-page checks.

The default Laravel runtime smoke scope now additionally covers
`/feed/item/listing/90966`, `/feed/item/listing/90965`,
`/feed/item/listing/90964`, `/feed/item/listing/90963`, and
`/feed/item/listing/90962` as signed 2xx typed feed item permalink routes. A
targeted live run against `WEB_UK_BASE_URL=http://127.0.0.1:5342`, started with
`TENANT_ID=2`, passed on 2026-07-07: `11/11` checks, `0` failures. The expanded
default scope now contains `315` checks: `264` module-page checks, 8 unsigned
auth-required redirect checks, 17 gated-status checks, and 20 signed redirect
checks, plus the 6 auth/health checks.
The expanded default scope was recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4`
against the same temporary process: all four chunks passed on 2026-07-07 with
`468` repeated checks, `0` failures, and `264` collective module-page checks.

The default Laravel runtime smoke scope now additionally covers
`/users/14/appreciations` and `/jobs/employers/14` as signed 2xx user
appreciation and employer-brand routes, plus `/groups/484/files/1/download` as
the signed missing-file redirect to `/groups/484/files?status=file-not-found`.
This also fixes those two public member/employer pages to read Laravel
`/api/v2/users/{id}` instead of the legacy `/api/users/{id}` helper. A targeted
live run against `WEB_UK_BASE_URL=http://127.0.0.1:5343`, started with
`TENANT_ID=2`, passed on 2026-07-07: `9/9` checks, `0` failures. The smoke
harness
refreshes the signed session before gated-status and signed-redirect groups so
long module-page batches do not turn expected authorization outcomes into stale
`/login?status=auth-required` redirects. That `318`-check expanded default
scope was then
recertified with `SMOKE_MODULE_PAGE_CHUNK=N/4` against the same temporary
process: all four chunks passed on 2026-07-07 with `474` repeated checks, `0`
failures, and `266` collective module-page checks. The next fixture expansion
adds `/ideation/2/ideas/1` as a signed 2xx ideation idea detail route; its
targeted live run passed on 2026-07-07 with `7/7` checks and `0` failures. The
course instructor analytics and grading routes now preserve Laravel's owner/admin
denial as a 403 page instead of the generic service-unavailable fallback; the
targeted live run for `/courses/instructor/1/analytics` and
`/courses/instructor/1/grading` passed on 2026-07-07 with `8/8` checks and `0`
failures. The event edit form now preserves Laravel's organiser-only denial as
a 403 page before optional group setup data can mask the result; `/events/6/edit`
and `/events/14/edit` are covered as signed `403` responses. A targeted live
run against `WEB_UK_BASE_URL=http://127.0.0.1:5343`, started with `TENANT_ID=2`,
passed on 2026-07-07 with `8/8` checks and `0` failures. The group announcement
edit route now checks the group admin gate before using Laravel's collection-only
announcements API, so `/groups/484/announcements/1/edit` is covered as a signed
`403` response. A targeted live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5344`, started with `TENANT_ID=2`, passed on
2026-07-07 with `7/7` checks and `0` failures. The achievement badge detail
route is now covered by the live tenant badge fixture
`/achievements/badges/vol_1h`, which returned `200` in a targeted Laravel-backed
smoke run against `WEB_UK_BASE_URL=http://127.0.0.1:5345`. The feed post detail
route is now covered by the live post fixture `/feed/posts/796`, which returned
`200` in a targeted Laravel-backed smoke run against
`WEB_UK_BASE_URL=http://127.0.0.1:5346`. The public goal fixture `/goals/162`
now covers the goal detail, edit, check-in, reminder, buddy actions, insights,
history, and social page shapes, and `/reviews/18/comments` covers the review
comments page; targeted Laravel-backed smoke probes against
`WEB_UK_BASE_URL=http://127.0.0.1:5347` returned `200` for each. Unsigned owner
route probes for `/marketplace/slots/1/edit`, `/me/collections/1`,
`/search/saved/1/delete`, and `/volunteering/certificates/ABC123/download`
returned `/login?status=auth-required` against
`WEB_UK_BASE_URL=http://127.0.0.1:5348`. Listing detail/edit now uses the
Laravel `/api/v2/listings/{id}` contract, and the E2E-owned fixture
`/listings/90992/edit` returned `200` against
`WEB_UK_BASE_URL=http://127.0.0.1:5349`. The poll export route
`/polls/1/export` returned `/login?status=auth-required` when unsigned against
`WEB_UK_BASE_URL=http://127.0.0.1:5350`; `/ideation/campaigns/1` returned the
same unsigned auth-required redirect against
`WEB_UK_BASE_URL=http://127.0.0.1:5351`. The plain-login unsigned routes
`/exchanges/1`, `/jobs/applications/1/cv`, and
`/jobs/applications/1/history` returned `/login` against
`WEB_UK_BASE_URL=http://127.0.0.1:5352`. The `/blog/feed.xml` and
`/wallet/export.csv` responses returned the expected `application/rss+xml` and
`text/csv` content types against `WEB_UK_BASE_URL=http://127.0.0.1:5355`.
The signed `/explore`, `/chat`, `/account`, `/wallet`, `/messages`,
`/connections`, `/resources`, `/skills`, `/goals`, `/clubs`, `/saved`, and
`/members` hub pages returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6200`. The public/support/legal pages `/`,
`/about`, `/guide`, `/features`, `/faq`, `/help`, `/kb`,
`/trust-and-safety`, `/legal`, `/accessibility`, `/legal/terms`,
`/legal/privacy`, `/legal/cookies`, `/legal/community-guidelines`, and
`/legal/acceptable-use` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6210`. The module landing pages
`/volunteering`, `/organisations`, `/organisations/browse`, `/events`,
`/events/new`, `/listings`, `/jobs`, `/courses`, `/courses/mine`,
`/marketplace`, `/marketplace/mine`, `/marketplace/onboarding`, `/blog`,
`/feed`, `/podcasts`, `/reviews`, `/search`, `/search/advanced`,
`/federation`, `/notifications`, `/activity`, `/achievements`, `/leaderboard`,
`/nexus-score`, and `/premium` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6211`; `/premium` now follows the Laravel
Blade title `Donate`. The signed profile/settings/gamification/federation
subpages `/profile/settings`, `/settings/appearance`, `/settings/data-rights`,
`/profile/delete-account`, `/profile/two-factor`, `/profile/blocked`,
`/settings/availability`, `/settings/linked-accounts`, `/settings/insurance`,
`/activity/insights`, `/achievements/shop`, `/achievements/collections`,
`/achievements/engagement`, `/achievements/showcase`,
`/leaderboard/competitive`, `/leaderboard/seasons`, `/leaderboard/journey`,
`/leaderboard/spotlight`, `/nexus-score/tiers`, `/federation/partners`,
`/federation/members`, and `/federation/settings` returned expected body
markers against `WEB_UK_BASE_URL=http://127.0.0.1:6212`; `/federation/members`
now follows the Laravel Blade title `Federated members`. The remaining signed
federation subpages `/federation/opt-in`, `/federation/opt-out`,
`/federation/onboarding`, `/federation/groups`, `/federation/listings`,
`/federation/events`, `/federation/connections`, and `/federation/messages`
returned expected body markers against `WEB_UK_BASE_URL=http://127.0.0.1:6213`.
The signed marketplace account subpages `/marketplace/saved`, `/marketplace/free`,
`/marketplace/offers`, `/marketplace/orders`, `/marketplace/sales`,
`/marketplace/pickups`, and `/marketplace/slots` returned expected body markers
against `WEB_UK_BASE_URL=http://127.0.0.1:6214`. The signed volunteering member
and owner subpages `/volunteering/accessibility`, `/volunteering/certificates`,
`/volunteering/opportunities/create`, `/volunteering/credentials`,
`/volunteering/hours`, `/volunteering/wellbeing`, `/volunteering/donations`,
`/volunteering/expenses`, `/volunteering/emergency-alerts`,
`/volunteering/group-signups`, `/volunteering/training`,
`/volunteering/incidents`, `/volunteering/waitlist`, `/volunteering/swaps`,
`/volunteering/my-organisations`, and `/volunteering/recommended-shifts`
returned expected body markers against `WEB_UK_BASE_URL=http://127.0.0.1:6215`;
`/volunteering/opportunities/create` now follows the Laravel Blade title
`Post a volunteer opportunity`. The signed jobs account subpages `/jobs/saved`,
`/jobs/applications`, `/jobs/mine`, `/jobs/create`, `/jobs/alerts`,
`/jobs/responses`, and `/jobs/employer-onboarding` returned expected body
markers against `WEB_UK_BASE_URL=http://127.0.0.1:6216` and now carry default
body-marker coverage for their Laravel Blade titles and stable action text. The
previous full default smoke scope passed against
`WEB_UK_BASE_URL=http://127.0.0.1:6218` with `459/459` checks and `0` failures.
The signed course subpages `/courses/instructor`, `/courses/instructor/new`,
`/courses/1`, `/courses/2`, `/courses/instructor/1/edit`, and
`/courses/instructor/2/edit` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6219` and now carry default body-marker
coverage for their Laravel Blade headings and detail-page review section. The
full default smoke scope then passed against
`WEB_UK_BASE_URL=http://127.0.0.1:6220` with `465/465` checks and `0` failures.
The signed member discovery pages `/members/discover`, `/members/nearby`, and
`/members/77/insights` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6221` and now carry default body-marker
coverage for their Laravel Blade headings. The body-text-only default smoke
scope passed against the same port with `127/127` checks and `0` failures. The
signed organisation pages `/organisations/manage`, `/organisations/register`,
`/organisations/636`, `/organisations/636/jobs`, and
`/organisations/opportunities/307/apply` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6222` and now carry default body-marker
coverage for their Laravel Blade headings and section text. The body-text-only
default smoke scope passed against the same port with `132/132` checks and `0`
failures. The signed volunteering opportunity and organisation-owner pages
`/volunteering/opportunities/307`,
`/volunteering/organisations/636/dashboard`,
`/volunteering/organisations/636/manage`,
`/volunteering/organisations/636/settings`,
`/volunteering/organisations/636/volunteers`, and
`/volunteering/organisations/636/wallet` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6223` and now carry default body-marker
coverage for their Laravel Blade headings and owner action text. The
body-text-only default smoke scope passed against the same port with `138/138`
checks and `0` failures. The signed group pages `/groups`, `/groups/new`,
`/groups/484`, `/groups/484/invite`, `/groups/484/notifications`,
`/groups/484/image`, `/groups/484/announcements`, `/groups/484/discussions`,
`/groups/484/discussions/new`, `/groups/484/files`, `/groups/484/manage`,
`/groups/482`, `/groups/482/announcements`, `/groups/482/discussions`,
`/groups/482/discussions/new`, `/groups/482/files`, `/groups/482/manage`,
`/groups/482/invite`, `/groups/482/notifications`, and `/groups/482/image`
returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6224`; group detail now follows the Laravel
Blade section heading `Group events`. The body-text-only default smoke scope
passed against the same port with `158/158` body-text checks and `0` failures.
The signed marketplace create/search/coupon/detail/action/category/seller pages
`/marketplace/create`, `/marketplace/search`, `/marketplace/coupons/new`,
`/marketplace/267`, `/marketplace/267/buy`, `/marketplace/267/offer`,
`/marketplace/267/report`, `/marketplace/267/edit`, `/marketplace/6`,
`/marketplace/6/buy`, `/marketplace/6/offer`, `/marketplace/6/report`,
`/marketplace/6/edit`, `/marketplace/category/electronics`,
`/marketplace/category/home-garden`, `/marketplace/category/free-items`,
`/marketplace/category/services`, and `/marketplace/seller/1` returned expected
body markers against `WEB_UK_BASE_URL=http://127.0.0.1:6225`; category search
now follows Laravel's `Search within this category` label, `Find an item by name
or keyword.` hint, and `Search` submit text. The targeted run passed with
`27/27` checks and `0` failures. The body-text-only default smoke scope passed
against the same port with `179/179` total checks, including 170 body-text
contract checks, and `0` failures.
The signed ideation pages `/ideation`, `/ideation/campaigns`, `/ideation/new`,
`/ideation/outcomes`, `/ideation/tags`, `/ideation/23`, `/ideation/22`,
`/ideation/2`, `/ideation/2/ideas/1`, `/ideation/23/edit`,
`/ideation/23/manage`, `/ideation/23/drafts`, and `/ideation/23/outcome`
returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6226`. The targeted run passed with `22/22`
checks and `0` failures. The body-text-only default smoke scope passed against
the same port with `192/192` total checks, including 183 body-text contract
checks, and `0` failures.
The signed goals pages `/goals/buddying`, `/goals/discover`,
`/goals/templates`, `/goals/162`, `/goals/162/edit`, `/goals/162/checkin`,
`/goals/162/reminder`, `/goals/162/buddy-actions`, `/goals/162/insights`,
`/goals/162/history`, and `/goals/162/social` returned expected body markers
against `WEB_UK_BASE_URL=http://127.0.0.1:6227`. The targeted run passed with
`20/20` checks and `0` failures. The body-text-only default smoke scope passed
against the same port with `203/203` total checks, including 194 body-text
contract checks, and `0` failures.
The signed feed pages `/feed/hashtags`, `/feed/hashtag/timebank`,
`/feed/item/listing/42`, `/feed/posts/796`, `/feed/item/listing/90967`,
`/feed/item/listing/90966`, `/feed/item/listing/90965`,
`/feed/item/listing/90964`, `/feed/item/listing/90963`, and
`/feed/item/listing/90962` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6228`. The targeted run passed with `16/16`
checks and `0` failures. The body-text-only default smoke scope passed against
the same port with `210/210` total checks, including 204 body-text contract
checks, and `0` failures.
The signed event pages `/events/browse`, `/events/6`, `/events/6/map`,
`/events/6/polls`, `/events/6/translate`, `/events/14`, `/events/14/map`,
`/events/14/polls`, and `/events/14/translate` returned expected body markers
against `WEB_UK_BASE_URL=http://127.0.0.1:6229`. The targeted run passed with
`15/15` checks and `0` failures. The body-text-only default smoke scope passed
against the same port with `219/219` total checks, including 213 body-text
contract checks, and `0` failures.
The signed listing pages `/listings/new`, `/listings/90992/edit`,
`/listings/42/report`, `/listings/42/exchange-request`,
`/listings/42/comments`, `/listings/90967/report`,
`/listings/90967/exchange-request`, and `/listings/90967/comments` returned
expected body markers against `WEB_UK_BASE_URL=http://127.0.0.1:6230`. The
targeted run passed with `14/14` checks and `0` failures. The body-text-only
default smoke scope passed against the same port with `227/227` total checks,
including 221 body-text contract checks, and `0` failures.

The later 2026-07-10 Listings mutation slice replaces the legacy
`/api/listings` write helpers with Laravel `POST /api/v2/listings`,
`PUT /api/v2/listings/{id}`, and `DELETE /api/v2/listings/{id}`. The accessible
create/edit form sends the seven Laravel core fields, leaves create status to
Laravel, uses tenant bootstrap `listing_config` plus tenant-scoped categories,
and saves enabled skill tags and an optional cover through the separate tags
and multipart image endpoints. V2 envelope unwrapping, owner-only edit access,
nested 422 field mapping, onboarding/auth handoffs, and tenant-prefixed result
redirects have focused mock-backed coverage. No live create/update/delete or
image/tag mutation was performed for that slice, so persistence and side
effects are not certified by the earlier read-only smoke evidence.
The signed poll pages `/polls`, `/polls/parity/create`,
`/polls/parity/manage`, `/polls/20`, `/polls/20/rank`, `/polls/8`, and
`/polls/4` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6231`. The targeted run passed with `13/13`
checks and `0` failures. The body-text-only default smoke scope passed against
the same port with `234/234` total checks, including 228 body-text contract
checks, and `0` failures.
The blog feed, detail, comments, and reaction pages `/blog/feed.xml`,
`/blog/test-sitemap-blog-post/likers/like`,
`/blog/timebank-ireland/likers/like`, `/blog/test-sitemap-blog-post`,
`/blog/test-sitemap-blog-post/comments`, `/blog/timebank-ireland`, and
`/blog/timebank-ireland/comments` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6232`. The targeted run passed with `13/13`
checks and `0` failures. The body-text-only default smoke scope was
recertified in 8 chunks against the same port, covering all 235 body-text
contract checks with `283/283` executed checks including repeated auth/health
setup checks and `0` failures.
The federation detail pages `/federation/partners/1`,
`/federation/partners/5`, `/federation/members/353`,
`/federation/members/353/transfer`, and `/federation/members/351` returned
expected body markers against `WEB_UK_BASE_URL=http://127.0.0.1:6233`. The
targeted run passed with `11/11` checks and `0` failures. The body-text-only
default smoke scope was recertified in 8 chunks against the same port, covering
all 240 body-text contract checks with `288/288` executed checks including
repeated auth/health setup checks and `0` failures.
The signed message pages `/messages/groups`, `/messages/groups/new`,
`/messages/77`, and `/messages/new/77` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6234`. The targeted run passed with `10/10`
checks and `0` failures. The body-text-only default smoke scope was recertified
in 8 chunks against the same port, covering all 244 body-text contract checks
with `292/292` executed checks including repeated auth/health setup checks and
`0` failures.
The signed resource pages `/resources/library`, `/resources/upload`, and
`/resources/10/comments` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6235`. The targeted run passed with `9/9`
checks and `0` failures. The body-text-only default smoke scope was recertified
in 8 chunks against the same port, covering all 247 body-text contract checks
with `295/295` executed checks including repeated auth/health setup checks and
`0` failures.
The signed wallet responses `/wallet/export.csv`, `/wallet/manage`, and
`/wallet/recipients` returned expected response markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6236`; the CSV export marker tracks the
Laravel-backed statement header `Date,Type,Description`, and the recipients
route marker tracks the JSON `results` key. The targeted run passed with `9/9`
checks and `0` failures. The body-text-only default smoke scope was recertified
in 8 chunks against the same port, covering all 250 body-text contract checks
with `298/298` executed checks including repeated auth/health setup checks and
`0` failures.
The signed jobs pages `/jobs/90764`, `/jobs/90764/qualified`, and
`/jobs/employers/14` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6237`; the detail marker tracks the
Laravel-backed apply section, the qualification route tracks `Am I qualified?`,
and the employer route tracks the employer profile description. The targeted run
passed with `9/9` checks and `0` failures. The body-text-only default smoke
scope was recertified in 8 chunks against the same port, covering all 253
body-text contract checks with `301/301` executed checks including repeated
auth/health setup checks and `0` failures.
The signed matches pages `/matches` and `/matches/board` returned expected body
markers against `WEB_UK_BASE_URL=http://127.0.0.1:6238`; the list marker tracks
the Laravel-backed `Open the matches board` link, and the board marker tracks
the `Suggested matches` caption. The targeted run passed with `8/8` checks and
`0` failures. The body-text-only default smoke scope was recertified in 8
chunks against the same port, covering all 255 body-text contract checks with
`303/303` executed checks including repeated auth/health setup checks and `0`
failures.
The signed group exchange pages `/group-exchanges` and `/group-exchanges/new`
returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6238`; the list marker tracks the
Laravel-backed `Start a group exchange` action, and the create marker tracks
the shared-hours fieldset text `How are the hours shared out?`. The targeted
run passed with `8/8` checks and `0` failures. The body-text-only default smoke
scope was recertified in 8 chunks against the same port, covering all 257
body-text contract checks with `305/305` executed checks including repeated
auth/health setup checks and `0` failures.
The signed podcast studio pages `/podcasts/studio` and `/podcasts/studio/new`
returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6238`; the studio marker tracks the
Laravel-backed `Podcast studio` heading, and the create marker tracks the
`Create a podcast` heading. The targeted run passed with `8/8` checks and `0`
failures. The body-text-only default smoke scope was recertified in 8 chunks
against the same port, covering all 259 body-text contract checks with
`307/307` executed checks including repeated auth/health setup checks and `0`
failures.
The public auth pages `/login`, `/login/forgot-password`,
`/password/reset?token=reset-token`, and `/register` now track the Laravel
headings `Sign in`, `Reset your password`, `Choose a new password`, and
`Register`. A direct runtime assertion pass against
`WEB_UK_BASE_URL=http://127.0.0.1:6238` checked `/health` plus those four page
headings with `5/5` assertions and `0` failures.
The public support pages `/contact`, `/cookies`, `/newsletter/unsubscribe`,
`/verify-email`, and `/report-a-problem` now carry Laravel-backed body-text
markers, with `/contact` and `/report-a-problem` copy realigned to the Laravel
Blade strings before certification.
The no-JS cookie consent POST flows are now part of the default Laravel runtime
smoke scope: it fetches CSRF tokens, posts banner reject, banner accept, and
settings-save analytics choices to `/cookie-consent`, and asserts the expected
redirects plus accessible `nexus_accessible_cookie_consent` values.
The protected account sign-out form is also runtime-smoked: the harness reads
the `/account` CSRF token, posts `/logout`, checks the `/login` redirect, and
then verifies `/account` redirects after the signed cookies are cleared.
The remaining signed/detail body-marker routes `/connections/network`,
`/dashboard`, `/exchanges`, `/me/collections`, `/premium/return`, `/profile`,
`/reviews/list`, `/users/14/appreciations`, `/kb/90001`,
`/achievements/badges/vol_1h`, and `/reviews/18/comments` now carry
Laravel-backed body-text markers. In that historical snapshot the core
module-page/body-text marker gap was 0; after the 2026-07-10 clubs
no-active-club correction, the default smoke scope had `280` module-page checks
and `282` body-text contract checks. That snapshot contained `633` checks:
`280`
module-page checks, 14 unsigned auth-required redirect checks, 3 unsigned login
redirect checks, 23 gated-status checks, and 19 signed redirect checks, plus 2
content-type contract checks, 282 body-text contract checks, 3 cookie-consent
POST workflow checks, 1 logout POST workflow check, and the 6 auth/health
checks.
Parameterised matched GET route shapes without default runtime smoke coverage
fell from 28 to 0.

## Stack

- Express
- Nunjucks
- GOV.UK Frontend
- Sass
- HTML-first server rendering
- progressive enhancement only

Do not add React, Vue, Next.js, client-side routing, or another CSS framework.

## GOV.UK Upstream References

- `alphagov/govuk-frontend`: https://github.com/alphagov/govuk-frontend
- `alphagov/govuk-design-system`: https://github.com/alphagov/govuk-design-system
- GOV.UK Design System: https://design-system.service.gov.uk/
- GOV.UK Frontend technical docs: https://frontend.design-system.service.gov.uk/

Use GOV.UK Frontend for reusable components and patterns. Do not copy
government identity.

## Chronological Implementation Detail

The descriptions below preserve implementation detail accumulated across
earlier slices. Any word such as "current" inside those descriptions is relative
to its checkpoint; the current-status document and generated artifacts govern
today's counts and queue.

The app now has a shared shell contract in:

```text
src/lib/accessible-shell.js
```

The shell feeds:

- custom Project NEXUS `nexus-alpha-header`
- GOV.UK service navigation
- no-JS language selector
- footer columns
- Explore card list and Laravel-backed live discovery sections

The `/explore` page is a protected Laravel-backed candidate. It redirects
unsigned visitors to `/login?status=auth-required`, calls Laravel
`/api/v2/explore`, renders the Blade Explore card list, and shows live listing
and event sections when the aggregate response includes them. Tenant feature
gating, exact recent-listing source parity, live disabled-tenant broker
workflow proof, localization, and deeper runtime behavior are not certified.
The signed `/explore` page is covered by the default Laravel runtime smoke and
default `Explore` body-marker contract check, and its Clubs card now uses
Laravel-backed active-club evidence rather than a static flag.

The public `/kb` and `/kb/{id}` pages are Laravel-backed knowledge-base
candidates. They read Laravel `/api/v2/kb`, `/api/v2/kb/search`, and
`/api/v2/kb/{id}` to render the Blade-style article search, cards, view-count
metadata, cursor load-more link, article back link, author/update metadata,
sanitized article body, and related-article links. Feedback, attachments, admin
editing, tenant routing, localization, article detail runtime smoke, and
ASP.NET backend compatibility are not certified; the `/kb` index is covered by
the default Laravel runtime smoke.

The public auth and email aliases include Laravel-style forgot-password,
reset-password, two-factor, email verification, and newsletter unsubscribe
pages. Login responses with `requires_2fa` now store Laravel's
`two_factor_token` in the Express session and redirect to `/login/two-factor`,
matching the Blade controller's session-backed challenge hand-off.
`/verify-email` renders the Blade missing, invalid, and confirmation states and
calls Laravel `/api/auth/verify-email` when a token is present.
`/newsletter/unsubscribe` renders the Blade missing, invalid, and confirmation
states; when a token is present it calls Laravel `/api/v2/newsletter/unsubscribe`
before rendering the confirmation or invalid state. Tenant-domain routing,
localization, and live email-token runtime behavior are not certified.

The `/account` page is now a local Blade-style protected account hub candidate.
Unsigned requests redirect to `/login`, matching the Laravel accessible account
route. Signed-in requests render the Blade-style account card list for wallet,
messages, connections, notifications, profile, and settings, plus a
CSRF-protected sign-out form. The default Laravel runtime smoke now verifies
the POST `/logout` redirect and post-logout `/account` redirect behavior. The
protected notifications module also exposes
the Laravel accessible `/notifications/group/read` and
`/notifications/delete-all` POST aliases against the Laravel v2 notification API.
The protected wallet module exposes a no-JS `/wallet/donate` form and POST route
against Laravel `/api/v2/wallet/donate` with the same donation status keys.
`/wallet/manage` now renders a Blade-style manage-credits hub backed by Laravel
`/api/v2/wallet/balance`, `/api/v2/wallet/community-fund`, and
`/api/v2/wallet/user-search`, including summary stats, recipient search,
transfer forms, donation target controls, and status states. Transfer forms now
carry a per-render UUID and POST the exact Laravel v2 `recipient`, `amount`,
`description`, and `idempotency_key` contract without a profile/balance
preflight; nested Laravel errors and the onboarding-required gate map to
tenant-aware accessible outcomes. `/wallet/recipients` returns Laravel wallet
user-search suggestions for progressive enhancement, and `/wallet/export.csv`
streams the Laravel `/api/v2/wallet/statement` CSV download. Tenant module
gates, exact live recipient privacy behavior, live transfer/replay persistence,
localization, and deeper wallet workflows are not certified; the signed
`/wallet`, `/saved`, and `/notifications` pages are covered by the default
Laravel runtime smoke.
`/saved` now redirects unsigned visitors to `/login?status=auth-required`, reads
Laravel `/api/v2/bookmarks` with the Blade type filter, and renders the
Blade-style saved item list, empty state, status banner, item links, type tags,
and remove forms. Saved-item removal and appreciation send/react POST aliases
are also wired to Laravel `/api/v2/me/saved-items` and `/api/v2/appreciations`.
Saved-collection GET list/detail pages now redirect unsigned visitors to
`/login?status=auth-required`, read Laravel `/api/v2/me/collections` and
`/api/v2/me/collections/{id}/items`, and render Blade-style collection cards,
item cards, pagination, create/edit/delete, and remove-item controls.
Saved-collection create/update/delete and item-remove POST aliases are wired to
Laravel `/api/v2/me/collections` and `/api/v2/me/saved-items/{id}` while keeping
Laravel status redirects such as `collection-created`, `collection-updated`,
`collection-deleted`, and `item-removed`. `/profile/delete-account` now redirects
unsigned visitors to `/login?status=auth-required` and renders the Blade-style
warning, password confirmation, optional reason, confirmation checkbox, and
status error states before its existing Laravel-compatible delete POST alias
runs. `/profile/settings` now redirects unsigned visitors to
`/login?status=auth-required`, loads Laravel-compatible profile, account,
notification, match, skill, passkey, session, and safeguarding payloads where
available, and renders the Blade-style settings links, profile photo, personal
details, public profile, privacy, newsletter, skills, security, language,
notifications, match, personalisation, safeguarding, and data/privacy sections.
`/profile/two-factor` now redirects unsigned visitors to
`/login?status=auth-required`, reads a Laravel-compatible two-step verification
setup/status payload, and renders the Blade-style authenticator app setup,
QR/setup key, verification form, enabled-state backup-code count, disable form,
success banners, and validation error summary.
`/profile/blocked` now redirects unsigned visitors to
`/login?status=auth-required`, reads the Laravel-compatible blocked-members
payload when available, and renders the Blade-style blocked member cards, empty
state, success banner, and unblock forms through the existing member unblock
POST alias.
Public collection and appreciation wall GET pages now redirect unsigned visitors
to `/login?status=auth-required`,
read Laravel `/api/v2/users/{id}/public-collections` and
`/api/v2/users/{id}/appreciations`, and render the Blade-style public collection
cards, thank-you form, appreciation cards, reaction forms, status messages, and
pagination. Tenant routing, localization, runtime smoke tests, and ASP.NET
backend compatibility are not certified.
Member discovery GET `/members/discover` now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel-compatible
`/api/v2/users?sort=communityrank`, and renders the Blade-style recommended
member page with filter navigation, search, recommendation score progress,
member cards, profile links, and load-more navigation. Member proximity GET
`/members/nearby` now redirects unsigned visitors to
`/login?status=auth-required`, reads the signed-in profile location, calls
Laravel-compatible `/api/v2/members/nearby`, and renders the Blade-style
radius/search page with no-location guidance, member distance cards, profile
links, and load-more navigation. Member reputation GET
`/members/{id}/insights` now redirects unsigned visitors to
`/login?status=auth-required`, reads the signed-in profile plus Laravel
`/api/v2/users/{id}` and `/api/v2/users/{id}/verification-badges`, and renders
the Blade-style NEXUS score, activity stats, verification badges, and earned
badges page. Base directory and profile visual parity, feature gates,
localization, deeper member workflow runtime smoke, and ASP.NET backend
compatibility are not certified; the signed `/members/discover` page is covered
by the default Laravel runtime smoke.
Matches GET pages now redirect unsigned visitors to `/login?status=auth-required`,
call Laravel-compatible `/api/v2/matches/all`, and render the Blade-style
`/matches` summary plus the `/matches/board` stats/filter board. Match-dismiss
POST aliases are wired to Laravel `/api/v2/matches/{id}/dismiss` for both
`/matches/{id}/dismiss` and `/matches/board/{listingId}/dismiss`, including the
board `source` redirect and `#matches-top` fragment. Tenant module gates,
event-source API filtering, localization, runtime smoke tests, and ASP.NET
backend compatibility are not certified.
Exchange action and rating POST aliases are wired to Laravel `/api/v2/exchanges`
for accept/decline/start/complete/confirm/cancel actions and
`/api/v2/exchanges/{id}/rate` for no-JS ratings.
Search advanced GET now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel `/api/v2/search` with the Blade
advanced-search filters, calls `/api/v2/search/saved` for saved-search cards,
and renders the Blade-style result tabs for listings, members, events, and
groups. Saved-search POST aliases are wired to Laravel `/api/v2/search/saved`:
`/search/saved` stores the Laravel-normalized query allow-list, delete calls
`DELETE /api/v2/search/saved/{id}`, and run calls
`POST /api/v2/search/saved/{id}/run` before redirecting to `/search/advanced`.
The saved-search delete confirmation GET reads the owner-scoped saved-search
list from `/api/v2/search/saved` and renders the Blade-style warning form.
Plain `/connections` now stays renderable with the existing Blade-style empty
state and error banner if Laravel's legacy `/api/connections` endpoint is not
available. `/connections/network` now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel `/api/v2/connections` for the
accepted, pending-received, and pending-sent sections plus
`/api/v2/connections/pending` for counts, and renders the Blade-style network
tabs, status banners, search form, member cards, connected-since metadata, and
connection action forms. The `/connections/{id}/accept`,
`/connections/{id}/decline`, and `/connections/{id}/remove` POST handlers now
call Laravel v2 connection helpers and preserve Laravel status redirects.
Tenant feature gates, localization, runtime behavior, and ASP.NET backend
compatibility are not certified.
`/achievements` now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel-compatible gamification profile,
badge, progress, daily reward, and challenge endpoints, and renders the
Blade-style achievements summary, daily reward, challenge, earned badge, and
badge-progress sections. `/achievements/shop` renders the Laravel-style XP shop
from `/api/v2/gamification/shop`, including balance, purchase warnings, item
cards, status banners, and no-JS purchase forms. `/achievements/collections`
renders Laravel badge collections from `/api/v2/gamification/collections`,
including progress, reward XP, completed/bonus states, and earned/locked badge
links. `/achievements/engagement` renders the Laravel-style 12-month engagement
history table from `/api/v2/gamification/engagement-history`, including active
status tags and pluralized activity counts. `/achievements/showcase` renders
the Laravel-style earned-badge checkbox management page from
`/api/v2/gamification/badges`, including success/error status states and the
existing no-JS save form. `/achievements/badges/{key}` renders the Laravel-style
badge detail summary from `/api/v2/gamification/badges/{key}`, including earned
status, metadata rows, showcased state, and the view-all link. Achievement POST
aliases are wired to Laravel `/api/v2/gamification`: daily reward, challenge
claim, shop purchase, and showcase update preserve the Laravel accessible status
redirects for `/achievements`, `/achievements/shop`, and
`/achievements/showcase`.
`/leaderboard` now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel-compatible gamification
leaderboard and community-dashboard endpoints, and renders the Blade-style
leaderboard tab strip, community impact stats, metric/period filter form, table,
current-user tag, and empty state.
`/leaderboard/competitive` now redirects unsigned visitors, calls the
Laravel-compatible competitive leaderboard and current-season endpoints, and
renders the Blade-style back link, active-season card, active leaderboard tabs,
metric/period filter, rank banner, table, and load-more link.
`/leaderboard/seasons` now redirects unsigned visitors, calls the
Laravel-compatible seasons/current and seasons endpoints, and renders the
Blade-style current-season card, rewards, season leaders, and past-seasons
table.
`/leaderboard/journey` now redirects unsigned visitors, calls the
Laravel-compatible personal-journey endpoint, and renders the Blade-style
summary list, milestones, monthly activity table, badge progression list, and
empty states.
`/leaderboard/spotlight` now redirects unsigned visitors, calls the
Laravel-compatible member-spotlight endpoint, and renders the Blade-style daily
featured-member card list and empty state.
`/nexus-score` and `/nexus-score/tiers` now redirect unsigned visitors, call the
Laravel-compatible gamification NEXUS score endpoint, and render the
Blade-style NEXUS score overview, tier-ladder related link, score panel,
breakdown progress table, insights list, nine-tier ladder with the current tier
highlighted, points-to-next inset, reached/current/locked status tags, and
unavailable-score empty states.
Member profile POST aliases are wired to Laravel v2 APIs for connection
transitions, skill endorsements, block/unblock, profile reviews, and direct
wallet transfers while preserving Laravel profile status redirects.
`/activity` and `/activity/insights` now redirect unsigned visitors to
`/login?status=auth-required`, call the Laravel-compatible profile activity
dashboard endpoint, and render the Blade-style contribution summary, engagement
stats, skills breakdown, monthly hours, detailed-insights navigation, timeline,
dual-bar insights chart, quick stats, and typed activity badges.
Message GET pages now render Laravel Blade direct and group conversations in
Nunjucks. Signed-in `/messages/new/{userId}` requests call Laravel-compatible
`/api/v2/messages/{userId}`, `/api/v2/messages/restriction-status`,
`/api/v2/messages/{userId}/read`, and optional listing context before rendering
the direct conversation title, listing inset, search, older-message link,
message list, reply, voice, and archive controls. Group requests call
Laravel-compatible `/api/v2/conversations/groups`,
`/api/v2/conversations/{id}/messages`, `/api/v2/conversations/{id}/participants`,
and `/api/v2/users/search` for the no-JS member picker. Message POST aliases
are wired to Laravel v2 message and group conversation APIs for archive/restore,
message edit/delete/translate, group create/reply, member add/remove, and group
reactions while preserving Laravel status redirects and anchors. Voice-message
upload proxies multipart audio to `/api/v2/messages/voice` with
Laravel-compatible status redirects.
The group invite GET page now renders the Blade-style signed group-admin invite
surface. `/groups/{id}/invite` reads Laravel-compatible group detail and invite
listing data, then renders the back link, generated invite-link inset, link
expiry form, email invitation form, pending invitation table, revoke forms, and
Laravel status banners. Group invite link/email/revoke POST aliases already call
Laravel-compatible group invite endpoints. `/groups/{id}/notifications` now
reads Laravel-compatible group detail and notification preference data, then
renders the Blade-style frequency radios, channel checkboxes, save form, and
status banners. `/groups/{id}/image` now reads Laravel-compatible group detail
and renders the Blade-style avatar and cover image management page, including
current image previews or empty insets, multipart upload forms, and image
status banners. `/groups/{id}/announcements` and
`/groups/{id}/announcements/{annId}/edit` now read Laravel-compatible group and
announcement data, then render the Blade-style announcement cards, admin
edit/pin/delete controls, create form, edit form, and announcement status
states. `/groups/{id}/discussions`, `/groups/{id}/discussions/new`, and
`/groups/{id}/discussions/{discussionId}` now read Laravel-compatible group and
discussion data, then render the Blade-style discussion cards, member-only start
button, create form, thread article, reply list, reply form, and discussion
status states. `/groups/{id}/files` now reads Laravel-compatible group detail
and file listing data, then renders the Blade-style file table, download/delete
actions, upload form, empty state, and file status banners.
`/groups/{id}/files/{fileId}/download` now proxies the Laravel-compatible
binary download response and preserves safe download headers. `/groups/{id}/manage`
now reads Laravel-compatible member and pending-request data, then renders the
Blade-style management page with request decisions and member role/removal
forms. Owner/admin authorization depth, tenant/feature gates, localization,
deeper resource runtime behavior, and ASP.NET backend compatibility are not
certified; the signed `/resources` page is covered by the default Laravel
runtime smoke.
Resource POST aliases are wired to Laravel v2 APIs for resource upload,
resource delete, admin reorder, resource comments, comment deletion, and
resource reactions while preserving Laravel library/comment status redirects.
Settings POST aliases are wired to Laravel v2 user settings and sub-account
APIs for appearance/theme, weekly availability, GDPR data-right requests,
linked-account request/approve/permission/revoke, and multipart insurance
uploads while preserving Laravel status redirects and anchors. `/settings/appearance`
now redirects unsigned visitors to `/login?status=auth-required`, reads the
current theme from the Laravel-compatible user settings payload when available,
and renders the Blade-style theme form and status states. `/settings/linked-accounts`
now renders the Blade-style incoming/managed linked-account sections, empty
states, request form, relationship choices, permission checkboxes, and status
states while loading Laravel-compatible sub-account payloads when available.
`/settings/data-rights`
renders the Blade-style request form, GDPR status banners, empty request-history
state, and submits through the existing Laravel-compatible POST alias.
`/settings/availability` renders the Blade-style weekly availability grid with
status states and submits through the existing Laravel-compatible POST alias.
`/settings/insurance` redirects unsigned visitors to `/login?status=auth-required`,
loads the Laravel-compatible certificate list when available, renders the
Blade-style certificate cards, empty state, status banners, and multipart
certificate upload form, and submits through the existing Laravel-compatible
POST alias.
Other settings GET pages remain generated preparation pages or local legacy
settings pages, and live linked-account runtime behavior, data-rights history loading,
tenant feature gates, localization, insurance upload/list runtime smoke tests, and
ASP.NET backend compatibility are not certified.
Blog POST aliases are wired to Laravel v2 blog/comment/reaction APIs for
post comments, comment-thread replies, post likes/reactions, and comment
update/delete/reactions while preserving Laravel post and comment-thread status
anchors.
Poll POST aliases are wired to Laravel v2 poll/comment/feed-like APIs for
standard and ranked poll creation, votes, ranked votes, poll deletion, comments,
and likes while preserving Laravel poll, poll detail, ranked-vote, and manage
status redirects.
Feed GET `/feed/posts/{id}` is wired to Laravel v2 post permalink data,
`/feed/item/{type}/{id}` is wired to Laravel v2 polymorphic feed-item data,
`/feed/hashtags` is wired to Laravel v2 hashtag trending/search APIs, and
`/feed/hashtag/{tag}` is wired to the Laravel v2 hashtag post collection API,
rendering Blade-style public post permalink, typed-item permalink, discovery,
and hashtag post-list pages. Feed POST aliases are wired to Laravel v2
feed/social APIs for post create/update/delete, multipart post image upload from
the Blade-style compose form, typed likes/comments/reactions, poll votes,
hide/not-interested, reports, shares, saves, comment update/delete/reactions,
and user mute while preserving Laravel feed status redirects and `#feed-item-*`
anchors.
The member onboarding POST aliases now cover `/onboarding/{step}` and
`/onboarding/avatar`: profile saves bio through the profile API, interests and
skills are held in the Express session, safeguarding uses Laravel's Blade-style
`safeguarding[id]` fields and `/api/v2/onboarding/safeguarding`, and confirm
uses `/api/v2/onboarding/complete`. Avatar upload proxies multipart image data
to `/api/v2/users/me/avatar`.
This remains partial: Laravel tenant feature gating, full account-link coverage,
per-module backend data, route availability checks, localization, realtime
behavior, runtime smoke tests, and ASP.NET backend compatibility are not
certified.

The cookie banner and `/cookies` page are now local Blade-style no-JS
candidates. The shell renders the GOV.UK cookie banner before the skip link
until the accessible `nexus_accessible_cookie_consent` cookie is present.
The legacy Laravel `nexus_alpha_cookie_consent` cookie is still accepted as a
read-only compatibility fallback.
Accept/reject/save posts use `/cookie-consent` and store `all` or `essential`
locally, matching Laravel's first-party choice cookie values. The default
Laravel runtime smoke now verifies no-JS reject, accept, and settings-save POST
redirects plus the expected `nexus_accessible_cookie_consent` cookie values against
a tenant-aware local web-uk process. This remains partial: Laravel
`cookie_consents` audit
persistence, tenant scoping, route-name generation, localization, and ASP.NET
backend compatibility are not certified.

The `/listings/{id}/report`, `/listings/{id}/exchange-request`,
`/listings/{id}/analytics`, and `/listings/{id}/comments` GET pages are now
partial Laravel-backed Blade candidates: they redirect unsigned visitors with
Laravel's `auth-required` status, load the listing from `/api/v2/listings/{id}`,
and render Blade-style report, exchange request, owner analytics, and comment
thread pages. The exchange request form also reads the Laravel wallet balance
endpoint for balance context; the analytics page reads
`/api/v2/listings/{id}/analytics` with Laravel's allowed period selector; the
comments page reads `/api/v2/comments?target_type=listing&target_id={id}`.
Other listing GET pages remain local/protected pages or
generated preparation pages, but the Laravel accessible POST aliases under
`/listings` are local route declarations backed by Laravel v2 listing, comment,
feed-like, and exchange APIs. The aliases cover save/unsave, renew, report,
like, comment/reply, exchange request creation, and AI description generation
redirects while preserving Laravel status keys and `#like` / `#add-comment`
fragments. This remains partial: Blade listing/detail rendering,
generated description value repopulation, image and skill-tag form parity,
owner/requester authorization depth, tenant/feature gates, localization, runtime
smoke tests, and ASP.NET backend compatibility are not certified.

The `/exchanges` and `/exchanges/{id}` pages are now partial Laravel-backed
candidates for the Blade exchange list and detail workflows. Signed-in GET
requests call Laravel `/api/v2/exchanges/config`, `/api/v2/exchanges`,
`/api/v2/exchanges/{id}`, and completed-exchange ratings from
`/api/v2/exchanges/{id}/ratings` to render the Blade-style tab filter, exchange
cards, detail summary, member action link, role-appropriate no-JS action forms,
review form, ratings, and timeline. POST `/exchanges/{id}` and
`/exchanges/{id}/rate` continue to use Laravel v2 exchange action/rating APIs
with Laravel status redirects. This remains partial: exact module/feature gates,
tenant behavior, authorization edge cases, localization, live workflow side
effects, and ASP.NET backend compatibility are not certified.

The `/chat` page is now a partial Laravel-backed candidate for the Blade AI
assistant. Signed-in GET requests call Laravel `/api/ai/conversations` and, when
`?c=` is present, `/api/ai/conversations/{id}` to render the conversation list,
selected thread, warning text, empty/error states, and no-JS message form. POST
`/chat` sends trimmed messages to Laravel `/api/ai/chat` and preserves Laravel
`empty`, `sent`, and `auth-required` redirect statuses. This remains partial:
Laravel tenant `ai_chat` feature-gate proof, provider-enabled notice parity,
fallback reply/tool-card display, localization, and ASP.NET backend
compatibility are not certified; the signed `/chat` page is covered by targeted
Laravel runtime smoke evidence from `WEB_UK_BASE_URL=http://127.0.0.1:5354`
and the default `AI assistant` body-marker contract check from
`WEB_UK_BASE_URL=http://127.0.0.1:5356`.

The `/skills` page is now a partial Laravel-backed candidate for the Blade
skills directory. Unsigned visitors redirect to `/login?status=auth-required`;
signed-in GET requests call Laravel `/api/v2/skills/categories`, optional
`/api/v2/skills/categories/{id}`, and optional
`/api/v2/skills/members?skill=...&limit=40`, then render the Blade-style skill
search form, member result list with proficiency/offers/wants tags, category
skill count table, back-to-categories link, and nested category browser. This
remains partial: exact tenant captions, localization, auth edge cases beyond the
page guard, deeper runtime smoke behavior, and ASP.NET backend compatibility are
not certified; the signed `/skills` page is covered by the default Laravel
runtime smoke.

The `/goals` page is now a partial Laravel-backed candidate for the Blade goals
index. Unsigned visitors redirect to `/login?status=auth-required`; signed-in
GET requests call Laravel `/api/v2/goals?per_page=30` and render Blade-style
status banners, goal navigation links, goal cards with active/completed and
public/private tags, streak and progress display, empty state, and the no-JS
create-goal form. `/goals/templates` now redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel `/api/v2/goals/templates/categories`
and `/api/v2/goals/templates`, and renders the Blade-style category filter,
template cards, target hints, title override form, public checkbox, status
error, and load-more link. `/goals/discover` redirects unsigned visitors to
`/login?status=auth-required`, calls Laravel `/api/v2/goals/discover`, and
renders the Blade-style public buddy-goal list, owner names, progress display,
buddy status errors, empty state, and no-JS buddy form. `/goals/buddying`
redirects unsigned visitors to `/login?status=auth-required`, calls Laravel
`/api/v2/goals/mentoring` and `/api/v2/goals/discover`, and renders the
Blade-style buddying/available-goals sections, owner names, progress display,
nudge and become-buddy forms, status success/error states, and empty states.
`/goals/{id}/edit` redirects unsigned visitors to `/login?status=auth-required`,
loads the goal from Laravel-compatible goal detail data, and renders the
Blade-style owner edit form, prefilled date/check-in/public fields, error state,
and delete warning/form. `/goals/{id}/checkin` redirects unsigned visitors to
`/login?status=auth-required`, loads Laravel-compatible goal detail and recent
check-in data, and renders the Blade-style progress, mood, note, status, and
recent check-in history page. `/goals/{id}/reminder` redirects unsigned visitors
to `/login?status=auth-required`, loads Laravel-compatible goal detail and
reminder data, and renders the Blade-style active/no-reminder status, frequency
radios, enabled checkbox, save form, and remove-warning form.
`/goals/{id}/buddy-actions` redirects unsigned visitors to
`/login?status=auth-required`, loads Laravel-compatible goal detail data, and
renders the Blade-style buddy support type radios, hint text, optional message,
status, and send form. `/goals/{id}/history` redirects unsigned visitors to
`/login?status=auth-required`, loads Laravel-compatible goal detail and progress
history data, and renders the Blade-style chronological timeline, event type
tags, empty state, and cursor pagination link. `/goals/{id}/insights` redirects
unsigned visitors to `/login?status=auth-required`, loads Laravel-compatible goal
detail and insights data, and renders the Blade-style streak, cadence,
check-in, milestone, buddy-support, and owner/buddy action sections.
`/goals/{id}/social` redirects unsigned visitors to
`/login?status=auth-required`, loads Laravel-compatible goal detail, social
summary, and threaded comments data, and renders the Blade-style support toggle,
like/comment counts, reply/delete controls, status banners, validation error,
and add-comment form. Existing goal POST aliases continue to call Laravel v2
goals, comment, and like APIs. This remains partial: the detail GET page, exact
tenant captions, goals feature-gate behavior, localization, runtime persistence,
and ASP.NET backend compatibility are not certified; the signed `/goals` page is
covered by the default Laravel runtime smoke.

The `/coupons` and `/coupons/{id}` pages are now partial Laravel-backed
candidates for the Blade public merchant-coupon browsing flow. Unsigned
visitors redirect to `/login?status=auth-required`; signed-in GET requests call
Laravel `/api/v2/coupons` and `/api/v2/coupons/{id}` and render Blade-style
coupon cards, discount tags, coupon codes, valid-until metadata, empty state,
detail back link, coupon-code panel, redemption guidance, and merchant summary
metadata. This remains partial: exact tenant captions, merchant-coupons feature
gate behavior, QR redemption/validation POST workflows, localization, runtime
persistence, and ASP.NET backend compatibility are not certified.

Marketplace GET pages remain preparation pages, but the Laravel accessible POST
aliases under `/marketplace` are now local route declarations backed by Laravel
v2 marketplace APIs. The aliases cover listing create/update/delete/renew,
listing image upload from the Blade-style create/edit form, save/unsave, buy,
offer, report, offer accept/decline/withdraw, order ship, confirm, cancel, pay
intent creation, rate, seller profile onboarding, pickup slot
create/update/delete/scan, and seller coupon create/update/delete. This remains
partial: marketplace Blade rendering, seller dashboard data, hosted no-JS
Stripe checkout redirects, address/onboarding depth, merchant profile image
uploads, tenant/feature gates, localization, runtime smoke tests, and ASP.NET
backend compatibility are not certified.

Podcast GET pages remain preparation pages, but the Laravel accessible POST
aliases under `/podcasts` are now local route declarations backed by Laravel v2
podcast APIs. The aliases cover show subscription, studio show
create/update/publish/delete, and episode add/publish/delete including
multipart audio uploads to `/api/v2/podcasts/{showId}/episodes`. This remains
partial: RSS/media rendering, author configuration gates, moderation state,
localization, runtime smoke tests, and ASP.NET backend compatibility are not
certified.

The `/ideation`, `/ideation/new`, `/ideation/{id}`, `/ideation/{id}/edit`,
`/ideation/{id}/manage`, `/ideation/{id}/outcome`,
`/ideation/{id}/drafts`,
`/ideation/{id}/ideas/{ideaId}`, `/ideation/tags`, `/ideation/campaigns`,
`/ideation/campaigns/{id}`, and `/ideation/outcomes` GET pages are now partial
Laravel-backed candidates for the Blade ideation challenge list, create/edit
challenge forms, manage hub, outcome editor, drafts, detail, idea detail, tag-browser,
campaigns, campaign detail, and outcomes dashboard flows. Unsigned visitors redirect to
`/login?status=auth-required`; signed GET requests call Laravel
`/api/v2/ideation-challenges`, `/api/v2/ideation-categories`,
`/api/v2/ideation-templates`, `/api/v2/ideation-challenges/{id}`,
`/api/v2/ideation-challenges/{id}/ideas?limit=30&sort=votes`, and
`/api/v2/ideation-challenges/{id}/ideas?limit=100&sort=votes`,
`/api/v2/ideation-challenges/{id}/ideas/drafts`,
`/api/v2/ideation-challenges/{id}/outcome`,
`/api/v2/ideation-ideas/{ideaId}`,
`/api/v2/ideation-ideas/{ideaId}/comments?per_page=30`,
`/api/v2/ideation-ideas/{ideaId}/media`, `/api/v2/ideation-tags/popular`,
plus `/api/v2/ideation-campaigns?per_page=50`,
`/api/v2/ideation-campaigns/{id}`, and `/api/v2/ideation-outcomes/dashboard`,
then render Blade-style search/status filters, challenge cards, status tags,
idea counts, success/error banners, the create/edit challenge form with
category and template options where Laravel provides them, challenge metadata,
prize inset, idea cards/detail, vote forms, the submit-idea form, draft edit/publish
forms, idea comments, attachments, admin controls, conversion and delete
controls, challenge lifecycle controls, campaign-link controls,
favourite/duplicate/delete management forms, popular tag links, selected-tag
challenge matches, tag empty states, campaign tabs, campaign status banners,
campaign cards, campaign detail metadata, linked challenge cards, challenge
counts, creator metadata, outcome edit forms, outcome stats, and outcome tables.
Existing POST aliases still call Laravel v2 ideation
APIs for challenge create/update/status/favorite, duplicate, delete, campaign
linking, outcome updates, idea submit/draft/comment/vote/status/media/
convert-to-group/delete actions, and campaign create/update/delete plus
challenge unlinking. This remains partial: admin authorization depth, multipart/media
upload proxying, team conversion runtime behavior, tenant/feature gates,
localization, runtime smoke tests, and ASP.NET backend compatibility are not
certified.

The `/group-exchanges`, `/group-exchanges/new`, and `/group-exchanges/{id}` GET
pages are now partial Laravel-backed candidates for the Blade group exchange
workflow. Unsigned visitors redirect to `/login?status=auth-required`; signed
list/detail requests call Laravel `/api/v2/group-exchanges` and
`/api/v2/group-exchanges/{id}`, detail pages also read `/api/v2/users/search`
for the organiser participant picker, and create/detail pages render the
Laravel-style forms that post to the existing aliases. POST aliases under
`/group-exchanges` still call Laravel `/api/v2/group-exchanges` for exchange
creation, participant add/remove, participant confirmation, organiser
completion, and organiser cancellation while preserving Laravel status redirects
and `#group-exchange-top` fragments. This remains partial: full
organiser/participant authorization depth, same-tenant member search parity,
time-credit settlement runtime behavior, feature gates, localization, runtime
smoke tests, and ASP.NET backend compatibility are not certified.

Generated event GET route fallbacks are now cleared from the route matrix.
`/events/browse` renders the Blade-style category chooser with
Laravel event categories from `/api/v2/categories?type=event`,
`/events/{id}/map` now renders a Laravel-backed Blade-style location page
through `/api/v2/events/{id}`, including the event back link, address,
coordinates, no-JS OpenStreetMap embed/links, and no-map states for online or
coordinate-less events, and `/events/{id}/polls` now renders the signed
Blade-style organiser poll attachment page from `/api/v2/events/{id}` plus
`/api/v2/polls?mine=1&per_page=100`. `/events/{id}/translate` now renders the
signed Blade-style translation chooser through `/api/v2/events/{id}`, including
status states, the 11 Laravel locale options, the original description, and the
existing no-JS translate POST target. `/events/{id}/recurring-edit` now renders
the signed Blade-style repeating-event scope edit page through `/api/v2/events/{id}`,
including single/all scope radios, datetime-local fields, the update warning,
and upcoming occurrence links. The Laravel accessible POST aliases under
`/events` are now local route declarations backed by Laravel v2 event, poll, and UGC
translation APIs. The
aliases cover waitlist join/leave, attendee check-in, poll attach/update, poll
vote, recurring event update, translation request redirects, and cover image
uploads from the Blade-style create/edit forms through
`/api/v2/events/{id}/image` while the list, detail, and edit pages show the
current Laravel cover image when the event payload includes one. The create and
edit forms now also load Laravel event categories from `/api/v2/categories` and
carry the category plus Laravel's online/remote attendance fields (`is_online`,
`online_link`, `allow_remote_attendance`, and `video_url`) into event
create/update payloads. The create form now renders Laravel recurrence controls
and sends recurring creates through `/api/v2/events/recurring`, following the
Laravel template response shape for redirects. Redirects preserve Laravel status
keys and `#poll-*` fragments. This remains partial: cover image removal is still
blocked by the absence of a Laravel v2 clear/delete event-image API contract,
and translated result display after POST, full Blade list/detail rendering,
owner/participant authorization depth, event notification/XP/waitlist promotion
side effects, tenant/feature gates, localization, runtime smoke tests, and
ASP.NET backend compatibility are not certified.

The `/volunteering` page is now a local Blade-style public landing candidate
for the Laravel accessible volunteering page. It renders the caption, lead,
organisation browse link, how-volunteering-works inset, sign-in notice, filter
form, opportunity cards, empty/error states, and cursor load-more link. Its
opportunity list is backed by Laravel `/api/v2/volunteering/opportunities`
using `search`, `category_id`, `is_remote`, `per_page`, and `cursor`
parameters. Its `/volunteering/opportunities/{id}` page is backed by
`/api/v2/volunteering/opportunities/{id}` and renders the Blade-style public
detail, organisation summary, opportunity metadata, available shifts, and safe
apply link. Its `/volunteering/accessibility` page redirects unsigned visitors
to `/login?status=auth-required`, reads saved need rows from Laravel
`/api/v2/volunteering/accessibility-needs`, and renders the Blade-style need
type checkboxes, description, adjustments, emergency contact, status banners,
and no-JS save form. Its `/volunteering/certificates` page redirects unsigned
visitors to `/login?status=auth-required`, reads the member's certificates from
Laravel `/api/v2/volunteering/certificates`, and renders the Blade-style
generate form, status banners, empty state, certificate cards, organisation
hour breakdown, verification code, and download link. Its
`/volunteering/certificates/{code}/download` route first proves the requested
verification code belongs to the signed-in member by reading
`/api/v2/volunteering/certificates`, then streams Laravel's printable certificate
HTML from `/api/v2/volunteering/certificates/{code}/html` with the Blade-style
inline filename. Its
`/volunteering/credentials` page redirects unsigned visitors to
`/login?status=auth-required`, reads the member's credentials from Laravel
`/api/v2/volunteering/credentials`, and renders the Blade-style upload form,
status banners, type options, credential table, status tags, expiry/uploaded
dates, and delete controls. Its `/volunteering/hours` page redirects unsigned
visitors to `/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/hours/summary`, `/api/v2/volunteering/hours`,
`/api/v2/volunteering/applications`, and
`/api/v2/volunteering/my-organisations`, and renders the Blade-style summary
stats, by-organisation/by-month tables, log-hours form, and recent hour-log
cards. Its `/volunteering/wellbeing` page redirects unsigned visitors to
`/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/wellbeing`, and renders the Blade-style wellbeing score,
burnout-risk tag, hours/streak stats, warnings, mood check-in form, status
banners, and recent check-ins table. Its `/volunteering/donations` page
redirects unsigned visitors to `/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/giving-days` and
`/api/v2/volunteering/donations?per_page=20`, and renders the Blade-style
money-donation explanation, fundraising stats, giving-day campaign cards,
donation history table, status banners, and offline bank transfer/PayPal form.
Its `/volunteering/expenses` page redirects unsigned visitors to
`/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/expenses?per_page=50` and
`/api/v2/volunteering/my-organisations?per_page=50`, and renders the
Blade-style expense totals, submit-claim form, status banners, and claims
table.
Its `/volunteering/emergency-alerts` page redirects unsigned visitors to
`/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/emergency-alerts`, and renders the Blade-style urgent
shift request cards, priority tags, metadata summary lists, status banners,
accepted/declined states, and no-JS response forms.
Its `/volunteering/group-signups` page redirects unsigned visitors to
`/login?status=auth-required`, reads Laravel
`/api/v2/volunteering/group-reservations`, and renders the Blade-style group
reservation cards, member status table, leader add/remove member controls,
cancel warning, and status banners.
Its `/volunteering/training` and `/volunteering/incidents` pages redirect
unsigned visitors to `/login?status=auth-required`, read Laravel
`/api/v2/volunteering/training` and `/api/v2/volunteering/incidents`, and
render the Blade-style safeguarding tab navigation, training-record form and
table, incident report form and table, status tags, validation banners, and
confidentiality notice.
Its `/volunteering/waitlist` and `/volunteering/swaps` pages redirect unsigned
visitors to `/login?status=auth-required`, read Laravel
`/api/v2/volunteering/my-waitlists`, `/api/v2/volunteering/swaps`, and
`/api/v2/volunteering/shifts?limit=50`, and render the Blade-style waitlist
cards, leave-waitlist forms, swap request form, sent/received swap cards,
accept/decline controls, cancel controls, status tags, and banners.
Its `/volunteering/my-organisations` and `/volunteering/recommended-shifts`
pages redirect unsigned visitors to `/login?status=auth-required`, read Laravel
`/api/v2/volunteering/my-organisations?per_page=20` and
`/api/v2/volunteering/recommended-shifts?limit=15&min_score=20`, and render the
Blade-style role filter, organisation status cards, dashboard links,
pagination, recommended-shift cards, match-score progress, applied tags, and
opportunity links.
Its `/volunteering/opportunities/create` page redirects unsigned visitors to
`/login?status=auth-required`, reads manageable organisations from
`/api/v2/volunteering/my-organisations?per_page=50`, reads volunteering
categories from `/api/v2/categories?type=volunteering`, filters the form to
approved/active owner-admin organisations, and renders the Blade-style
opportunity creation form and validation status states.
Its organisation-owner pages
(`/volunteering/organisations/{id}/dashboard`, `/manage`, `/settings`,
`/volunteers`, and `/wallet`) redirect unsigned visitors to
`/login?status=auth-required`, read Laravel owner-scoped volunteering APIs for
organisation stats, pending applications, pending hours, public organisation
details, volunteers, wallet summary, and wallet transactions, and render the
Blade-style dashboard stats, quick actions, management review cards, settings
form, volunteers table, wallet auto-pay/deposit forms, transaction table, and
status banners.
Laravel POST aliases now
cover applications, shift signup/cancel, application withdrawal, hours,
accessibility needs, certificate generation, waitlists, swaps, emergency alert
responses, credential delete plus safe upload/download proxying, wellbeing check-ins,
donations, group reservations, expenses, training, incidents, opportunity
creation, and organisation owner application/hour, settings, and wallet actions
through Laravel v2 volunteering APIs. This remains partial: feature gates,
tenant-prefixed routes, localization, deeper volunteering
workflow runtime smoke, and ASP.NET backend compatibility are not certified; the
public `/volunteering` landing/search page is covered by the default Laravel
runtime smoke.

The `/organisations` page is now a local Blade-style candidate for the Laravel
accessible organisations directory. It includes the caption, subnavigation,
search form, empty state, status banners, registration copy, registration form,
terms, and pending notice. Its directory list is backed by the Laravel
`/api/v2/volunteering/organisations` collection using `search` and `per_page`
parameters. Its `/organisations/browse` page is also backed by that collection,
using `search`, `per_page`, and cursor-style load-more pagination. Its
`/organisations/register` page renders the Blade-style standalone registration
form and Laravel validation status anchors. `/organisations` POST and
`/organisations/register` POST validate the same required fields/terms, require a
signed token, submit to Laravel `/api/v2/volunteering/organisations`, and redirect
with Laravel status keys. Its `/organisations/manage` page renders the Blade-style
manage entry and, when a signed token is present, reads
`/api/v2/volunteering/my-organisations` for owner/admin and pending rows. Its
detail page is backed by
`/api/v2/volunteering/organisations/{id}?include=public_contract` for profile,
contact, basic public stats, and Laravel-backed depth sections from
`/api/v2/volunteering/opportunities?organization_id={id}` and
`/api/v2/volunteering/reviews/organization/{id}`. Its
`/organisations/{id}/jobs` page renders the Blade-style organisation job
openings view and, when a signed token is present, reads
`/api/v2/jobs?organization_id={id}&status=open`. Its
`/organisations/opportunities/{id}/apply` page renders the Blade-style apply
confirmation page and reads `/api/v2/volunteering/opportunities/{id}`. This
remains partial: auth enforcement, volunteering/job feature gates,
tenant-prefixed routes, organisation registration runtime persistence, apply
confirmation depth, localization, deeper organisation workflow runtime smoke,
and ASP.NET backend compatibility are not certified; `/organisations` and
`/organisations/browse` are covered by the default Laravel runtime smoke.

The public support pages replace the static Help Centre and Trust and Safety
placeholders. `/help` is backed by Laravel `/api/v2/help/faqs`, preserving the
Blade FAQ search query, grouped GOV.UK accordion structure, empty/no-result
states, and contact CTA. `/trust-and-safety` ports the Laravel Blade safety
warning, exchange flow, platform responsibility, vetting, insurance, dispute,
member responsibility, rights, contact CTA, and community-guidelines link.
Both pages now use exact request-locale Laravel catalog copy, including all nine
safety-section arrays; a real Arabic two-page RTL/reflow/axe journey and the
57/57 aggregate browser gate passed. This remains partial: backend-authored FAQ
translation governance, tenant-domain/feature-gate depth, deeper FAQ runtime,
manual assistive-technology review, and ASP.NET backend compatibility are not
certified; `/help` is covered by the default Laravel runtime smoke.

The public legal footer destinations replace the static legal and accessibility
placeholders. `/legal` renders the Blade-style legal document card hub,
`/accessibility` renders the Blade accessibility statement, and
`/legal/terms`, `/legal/privacy`, `/legal/cookies`,
`/legal/community-guidelines`, and `/legal/acceptable-use` read tenant-managed
documents from Laravel `/api/v2/legal/{type}`. When Laravel has no published
document, the pages render the same GOV.UK-structured fallback copy as the
Laravel Blade views. Hub/fallback/accessibility shell copy and metadata labels
now use exact request-locale Laravel catalogs, keyed PHP section arrays survive
JSON generation, and managed-document dates use locale formatting. A real
Arabic hub/privacy/accessibility RTL/reflow/axe journey and the 59/59 aggregate
gate passed. This remains partial: legal acceptance prompts, version
history/compare links, broader live managed/fallback permutations, manual
assistive-technology review, and ASP.NET backend compatibility are not certified.

The signed reviews pages now replace the generated review GET preparation
fallbacks. `/reviews` reads Laravel-compatible received, given, pending, and
stats review endpoints and renders the Blade-style summary with pending-review
forms. `/reviews/list` renders the received/given cursor list, and
`/reviews/{id}/comments` renders the Blade-style discussion page from Laravel
review, comment, and reaction APIs. This remains partial: feature gates,
moderation/deletion display, threaded reply depth, localization, live runtime
behavior, and ASP.NET backend compatibility are not certified.

The signed member profile now renders Laravel-catalog profile identity,
verification/type tags, reputation navigation, joined/activity/badge summaries,
state-aware connection controls, review content and submission labels, blocking,
and wallet transfer controls. Connection transitions use Laravel's single
`/members/{id}/connection` action contract; messaging and wallet controls obey
their tenant feature/module gates, and wallet transfers carry UUID idempotency
keys. Own-profile pages suppress all member-to-member actions. The profile is
included in the signed Arabic member browser traversal.
The page now reads Laravel's public profile, user listings, skills, availability,
public activity dashboard, block status, endorsements, reviews, gamification,
badges, and connection endpoints, and renders the corresponding Blade sections.
Own-profile private fields come only from `/users/me` after the IDs match. This
remains partial for live mutation effects, disposable privacy/block/endorsement
fixtures, backend-generated activity-description localization, pixel/manual
assistive-technology review, and ASP.NET backend compatibility.

Legacy local review edit and target-specific submission routes are intentionally
not exposed. Laravel's accessible source uses POST `/members/{id}/review` for
member profile reviews, POST `/reviews` for pending exchange reviews, and POST
`/reviews/{id}/delete` for delete actions; the old GET/POST
`/reviews/{id}/edit`, POST `/reviews/user/{id}`, and POST
`/reviews/listing/{id}` paths are absent.

The public about and guide pages now replace the static About, Guide, Features,
and FAQ placeholders. `/about` renders the Blade-style community intro,
four-step how-it-works list, values, contributor credits, open-source links, and
signed-in or signed-out CTA group. `/guide` renders the Blade-style timebanking
explanation, equal-time principle, three-step ordered list, and signed-in or
signed-out CTA group. `/features` renders the Blade-style community feature list
and link back to `/guide`. `/faq` renders the Blade-style GOV.UK accordion with
the five translated timebanking questions and answers. This remains partial:
tenant-domain routing, module-gated CTA visibility, localization, runtime
behavior, live platform stats, and ASP.NET backend compatibility are not
certified.

Additional preparation docs:

- `LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md` maps Blade route families and shell links
  to current `apps/web-uk` equivalents.
- `BLADE_COMPONENT_PORT_AUDIT.md` tracks what visual/workflow patterns have and
  have not been ported from Blade.
- `BACKEND_SWITCHING_CONTRACT.md` documents future Laravel/ASP.NET backend
  switching requirements without implementing a real adapter yet.

Generated route-matrix artifacts live under `docs/generated/` and are refreshed
with `npm run route:matrix`. The current generated baseline is 689 Laravel
accessible route declarations, 695 `apps/web-uk` route declarations, 688 exact
method/path matches, 1 missing Laravel route, 5 deliberate extra local route
declarations, and 3 ignored local infrastructure/helper routes.
`src/routes/laravel-prep-pages.js` now registers generated preparation pages
only for matrix rows explicitly marked `missing`; the current matrix exports 0
runtime preparation pages. These counts are backlog evidence only; they do not
certify workflow parity.

Legacy local POST `/verify-2fa` is intentionally not exposed. The Laravel
accessible sign-in challenge uses GET/POST `/login/two-factor`, and the local
challenge form now submits to that canonical path.

Legacy local generic reports pages are intentionally not exposed. Laravel's
accessible route set uses dedicated report surfaces such as
`/listings/{id}/report` and the `/report-a-problem` support-report flow, so the
old GET/POST `/reports/new` and GET `/reports/my` paths are absent.

Legacy local search suggestions are intentionally not exposed as an accessible
frontend route. Laravel's accessible GOV.UK route set does not include GET
`/search/suggestions`; suggestions remain an API concern rather than a page or
HTML helper route.

Legacy local member connection aliases are intentionally not exposed. Laravel's
accessible member source uses POST `/members/{id}/connection` with an action
field for connection state transitions; member index/profile connection
controls now submit that route with `action=connect` instead of POST
`/members/{id}/connect`.

Legacy local listing delete confirmation pages are intentionally not exposed.
Laravel's accessible listing source uses POST `/listings/{id}/delete`; owner
controls now submit that action directly from the listing index/detail pages,
and local listing dynamic routes preserve Laravel numeric constraints.

Legacy local group member-management routes are intentionally not exposed as
separate pages or actions. Laravel's accessible group source uses `/groups`,
numeric `/groups/{id}` pages, `/groups/{id}/manage`, and
POST `/groups/{id}/members/{memberId}` for member actions. Local group list,
detail, and feed-sidebar links now point to `/groups` or `/groups/{id}/manage`
instead of `/groups/my` or `/groups/{id}/members`.

Legacy local event RSVP routes are intentionally not exposed as separate pages
or actions. Laravel's accessible event source uses `/events/{id}/rsvp` for RSVP
state changes; `/events/my` and `/events/{id}/rsvp/remove` are not part of the
Laravel accessible route set, and the event family now has 0 extra local
routes.

Legacy local feed post routes are intentionally not exposed as separate pages.
Laravel's accessible feed source uses `/feed/posts`, `/feed/posts/{id}`, typed
`/feed/items/{type}/{id}` actions, and comment/reaction aliases under
`/feed/posts/*` or `/feed/comments/*`; the feed hub now links and submits to
those shapes instead of `/feed/new` or `/feed/{id}` routes.

Bare `/messages/new` is intentionally not exposed as a separate local page.
Laravel's accessible direct-message source uses `/messages/new/{userId}` and
`/messages/{userId}` with numeric route constraints. The generated preparation
pages preserve those `whereNumber(...)` constraints so dynamic message routes do
not catch non-numeric legacy paths.

`/wallet/transactions`, `/wallet/transactions/{id}`, and GET
`/wallet/transfer` are intentionally not exposed as separate local pages.
Laravel's accessible wallet source keeps transaction history and transfer UI on
`/wallet` plus `/wallet/manage`, while POST `/wallet/transfer` remains the
canonical submission endpoint.

`/profile/edit` is intentionally not exposed as a separate local page. Laravel's
accessible profile editing surface uses `/profile/settings`, and the profile
summary change links now point there.

`/progress`, `/progress/badges`, `/progress/leaderboard`, and
`/progress/xp-history` are intentionally not exposed as separate local pages.
Laravel's accessible gamification source uses `/achievements`, the
`/achievements/*` subpages, `/leaderboard`, `/leaderboard/*`, and
`/nexus-score` instead.

`/settings`, `/settings/notifications`, `/settings/password`, and
`/settings/privacy` are intentionally not exposed as separate local pages.
Laravel's accessible settings source uses `/profile/settings` for the profile,
security, notification, privacy, and data/privacy hub, plus the specific
Laravel parity routes `/settings/appearance`, `/settings/data-rights`,
`/settings/availability`, `/settings/linked-accounts`, and
`/settings/insurance`.

`/connections/pending` is intentionally not exposed as a separate local page.
Laravel's accessible pending/accepted/sent connection experience lives on the
`/connections/network` tabbed page, and local links now point to
`/connections/network?tab=pending_received`.

`/components` is intentionally not exposed as a local demo route. Laravel's
accessible frontend keeps GOV.UK component inventory in docs/source assets, not
as a public route in the accessible surface.

`/terms` and `/privacy` are intentionally not exposed as top-level local
aliases: Laravel's accessible legal documents use `/legal/terms` and
`/legal/privacy`.

`/forgot-password` and `/reset-password` are intentionally not exposed as
top-level local aliases: Laravel's accessible auth flow uses
`/login/forgot-password` and `/password/reset`, and the login page links to the
Laravel forgot-password path.

`GET /logout` is intentionally not exposed locally: Laravel's accessible
logout route is POST-only, and the account hub keeps using the CSRF-protected
POST sign-out form.

The legacy local `/admin` route family is intentionally not exposed as an
untenanted local route surface. Laravel's scanned GOV.UK accessible route set
does not include GET `/admin` or the old local admin category/config/moderation,
role, and user pages/actions. Admin-only accessible workflows remain on their
canonical module routes, and the jobs bias-audit page no longer links back to
the removed `/admin` surface.

`GET /health`, `GET /service-unavailable`, and `POST /session/touch` are kept
as local infrastructure helpers and are intentionally ignored by the route
matrix's true-extra count. They are not Laravel accessible page declarations
and are not treated as page parity gaps.

## Before Extraction To Its Own Repo

- Keep this `docs/` folder.
- Keep `AGENTS.md` and `CLAUDE.md`.
- Keep package scripts for brand checks, tests, and Sass build.
- Keep generated CSS reproducible from Sass.
- Keep route/workflow certification docs close to this folder.
