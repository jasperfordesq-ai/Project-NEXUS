# Backend Switching Contract

Last reviewed: 2026-07-15

Status: **Maintained reference — current backend-switching contract, not a score**

`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is the sole current Web UK status and
scoring source. This document defines the switching contract; dated evidence
paragraphs are historical checkpoints and do not override the current status,
generated route matrix, generated frontend-consumer API ledger, or root backend
parity evidence.

## Decision

`apps/web-uk` is being completed as one shared accessible frontend. Laravel
Blade defines the browser experience and the Laravel backend defines the HTTP
and workflow contract. Laravel is the only current implementation and
certification backend. ASP.NET is incomplete, is not a source of truth, and is
owned by a separate backend workstream. It may become a second backend only by
reproducing the consumed Laravel contract identically for the same unchanged
Web UK frontend and evidence suite. Approximate compatibility is insufficient;
the binding definition is
[`../../../docs/decisions/ADR-0001-contract-identical-backends.md`](../../../docs/decisions/ADR-0001-contract-identical-backends.md).

The repository containing Web UK is not an architectural authority: locating
`apps/web-uk` inside `asp.net-backend` does not make ASP.NET the frontend's
backend source of truth.

Live route, API-ledger, test, score, and certification totals are intentionally
not copied here. Read `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` at reporting time;
generated inventories remain static evidence rather than switching
certification.

Backend target resolution lives in:

```text
src/lib/backend-contract.js
```

## Backend Modes

| Mode | Meaning | Current status |
| --- | --- | --- |
| Laravel | The frontend reproduces Laravel Blade workflows and calls Laravel-defined backend contracts. | Current default and certification target. |
| ASP.NET contract-identical target | The unchanged frontend talks to ASP.NET endpoints that reproduce the consumed Laravel contracts without observable divergence. | Future verification target only; incomplete and not certified. |

## Local Backend Defaults

| Variable | Default | Meaning |
| --- | --- | --- |
| `ACCESSIBLE_BACKEND_TARGET` | `laravel` | Laravel is the default backend contract target. |
| `LARAVEL_BASE_URL` | `http://127.0.0.1:8088` | Local Laravel staging backend URL, matching `C:\platforms\htdocs\staging\.env`. |
| `ASPNET_BASE_URL` | `http://localhost:5080` | Future ASP.NET target when explicitly selected. Not certified. |
| `API_BASE_URL` | unset | Explicit URL override for local testing. The resolver labels this as `api-base-url`; it does not certify ASP.NET compatibility or replace Laravel as the source of truth. Prefer `LARAVEL_BASE_URL` for Laravel-first work. |

`resolveBackendContract()` returns `baseUrlSource` alongside the resolved
`target`, `baseUrl`, and target `status`. Default Laravel resolution reports
`laravel-base-url`, explicit ASP.NET mode reports `aspnet-base-url`, and
`API_BASE_URL` reports `api-base-url` so override-driven runs cannot be mistaken
for certified backend readiness.

## Separate ASP.NET Readiness Evidence

This section records evidence produced by the separate backend parity
workstream. It is not a Web UK implementation queue and does not authorize this
frontend workstream to modify ASP.NET code, migrations, schema, fixtures, or
runtime data.

Run `npm run audit:aspnet:readiness` before attempting an unchanged Web UK
session against ASP.NET. The audit is intentionally strict: it requires a
healthy process plus Laravel-compatible public tenant bootstrap and platform
stats resolution using `X-Tenant-Slug`, because Web UK cannot know an internal
tenant ID before bootstrap.

The shared process on `http://127.0.0.1:5080` is still an older image and is not
readiness evidence. On 2026-07-13, current source was built in a clean detached
worktree and started on `http://127.0.0.1:5081` against a disposable PostgreSQL
database migrated from zero. That fresh start exposed two historical schema
holes: the absent `XpShopRedemptions` table and absent push-subscription key
columns. A forward-only, idempotent repair migration now supplies both without
rewriting migrations that may already be applied elsewhere.

The same clean runtime initially exposed two public response-shape gaps. Tenant
bootstrap now provides Laravel's canonical `data` envelope while retaining the
legacy root projection, and platform stats now includes `data.scope`. The
readiness audit then passed `3/3` for health, slug-first bootstrap, and
slug-first stats. A deliberately scoped unchanged-Web-UK smoke passed `10/10`:
API and Web UK health, unsigned account redirect, both cookie-consent choices,
cookie settings, login CSRF, real ASP.NET password login, signed account render,
and logout/session clearing.

This is scoped development compatibility evidence, not full ASP.NET
certification. It does not yet prove all Laravel fixture-dependent pages,
mutations, uploads, downloads, roles, modules, or destructive side effects. A
full Laravel-fixture smoke is not portable to the ASP.NET seed as-is and also
trips the development rate limiter; do not report that run as a product
regression or weaken the limiter to make the harness green.

The maintained backend comparator's latest committed checkpoint reports
`2,601/2,601` active Laravel source operations represented and `0` missing.
That static route result does not certify response shapes, auth, tenant
selection, roles, mutations, uploads, downloads, redirects, or unchanged-Web-UK
runtime behavior. The ASP.NET switching gate therefore remains open.

The repository-root `compose.prod.yml` currently overrides Web UK with
`API_BASE_URL=http://api:8080`, pointing it at the ASP.NET service. That is a
legacy, uncertified configuration, not an approved production deployment path
and not evidence that the switching gate has passed. Do not deploy it or use it
as a completion claim.

## Locale And Direction Contract

Localization is a shared frontend contract and must not branch by backend
target. The current request locale priority is:

1. a valid `locale` query value;
2. the persisted Web UK session locale;
3. an already available request user/profile preference;
4. the signed-token profile preference returned by the active backend;
5. weighted `Accept-Language` negotiation;
6. English fallback.

A valid query or profile preference seeds the session. The HTML response emits
the resolved `Content-Language`, `<html lang>`, and `<html dir>` values; Arabic
uses RTL. `AsyncLocalStorage` keeps locale state request-scoped, API and download
calls propagate `Accept-Language`, and signed profile reads share one
request-local promise so localization does not introduce duplicate profile API
calls. Date, number, currency, and list formatting must use the same request
locale instead of fixed `en-GB` or `en-IE` values.

The catalog boundary is also backend-neutral: Web UK imports the authoritative
Laravel locale files into 11 generated catalogs, each with 36 namespaces and
8,837 string keys. The imported boundary includes `govuk_alpha*.php`,
`event_*.php`, and `safeguarding.php`. Future ASP.NET mode must accept the same locale/profile and
`Accept-Language` contracts; it must not require ASP.NET-specific template
branches. Structural catalog parity is not translation completeness. The
read-only Laravel source still has 4,096-4,199 English-identical values in each
non-English locale and 13 wholly English-identical namespaces.
Contextual route titles, headings, validation/status copy, ARIA labels, and
residual template strings also remain under review. Therefore localization and
RTL are started but not certified for either Laravel-first completion or
backend switching.

Host-scoped tenant API calls must carry the same tenant context Laravel can
resolve from browser traffic. Web UK sends `Host` plus `Origin:
https://{host}` for host-scoped `/api/v2/tenant/bootstrap` and
`/api/v2/platform/stats` requests unless an explicit tenant slug is available.
This is required because Laravel's tenant bootstrap can fall back from the API
server host to the browser Origin when resolving configured `domain` or
`accessible_domain` values. Host-scoped public calls must not also send the
process default `X-Tenant-ID`, because Laravel prioritizes that header over
Host/Origin and would resolve the local E2E tenant instead of the browser
domain. Future ASP.NET mode must accept equivalent host/Origin tenant context
before it can be certified.
Parent custom-domain child routing must also preserve Laravel's reserved
first-segment behavior. Web UK mirrors Laravel `TenantContext::getReservedPaths()`
so reserved platform paths such as `/classic` remain host-scoped platform paths
and are not treated as child tenant slugs. The Web UK regression covers
`parent-domain.test/classic` so future backend modes must preserve the same
reserved-path outcome. The 2026-07-10 source refresh synchronized 21 newly
reserved Laravel segments and added behavior coverage for every one, while an
unreserved `/gardeners/login` control still proves parent-domain child routing.
Future backend modes must preserve both outcomes.
Dedicated custom-domain hosts must also remain slugless when a browser reaches
them with a matching tenant-prefixed accessible path. Web UK now asks Laravel
bootstrap to resolve the host before shared-mount handling; if the host-resolved
tenant's `accessible_domain` matches `/{tenantSlug}/alpha/...` or
`/{tenantSlug}/accessible/...`, the request redirects to the slugless path.
Ordinary tenant `domain` hosts are not enough for those slugless accessible
pages: Laravel returns 404 for reserved paths such as `/login` unless the host
is the dedicated accessible domain, while still allowing host-resolved root and
parent-domain child behavior. Future ASP.NET mode must preserve the same
domain-versus-accessible-domain split before it can be certified for
tenant-domain routing.
Route-level no-JS workflow redirects are part of the same contract. Local
success, validation, auth-required, and API-failure destinations should go
through the active `res.locals.urlFor` helper before calling `res.redirect`, so
shared `/{tenantSlug}/accessible`, parent-domain child paths, and slugless
custom-domain contexts do not rely only on last-mile response rewriting. The
helper is idempotent for already-mounted paths, including query strings and
fragments. Current source also routes all 54 audited controls in 17
volunteering templates, three generated volunteering cursor links, and the
legal-hub document links through `urlFor()`. The session-timeout UI reads its
mounted login URL from the rendered shell and submits the mounted logout route
through a CSRF-protected POST form; future backend modes must not replace that
with a GET logout URL. The
volunteering action routes now follow this rule for auth-required handoffs,
direct validation branches, and Laravel API success/failure outcomes. The
group routes now follow this rule for the shared group action helper and the
file-download auth handoff while preserving already-mounted failure targets
without double-prefixing. The
podcast page routes now follow this rule for signed-out and Laravel-401 auth
handoffs, and the podcast action routes follow it for subscribe, studio show,
and episode POST outcomes. The federation action routes now follow it for
connection, message, translation, transfer, onboarding, opt-in/out, and settings
POST outcomes. The settings routes now follow it for appearance, availability,
data-rights, linked-account, and insurance auth, validation, success, and
API-error outcomes. The course routes now follow it for auth handoffs,
certificate/learn errors, learner actions, instructor course, section, lesson,
publish/delete, and grading outcomes. The Jobs action routes now follow it for
create/update/delete/renew/apply/save/unsave, application status/withdrawal,
alert, interview, offer, and owner CSV failure outcomes. Marketplace page routes
now follow it for signed-out GET auth handoffs and Laravel-401 page handoffs;
future ASP.NET mode must preserve equivalent local redirect semantics.

## Retained Future Laravel Runtime Tooling

Every command in this section authenticates or may change server-side state and
is forbidden in the active frontend-cloning goal. The commands are retained for
a possible future live-runtime workstream only; do not provision or request an
environment for them unless the owner explicitly changes scope. They must never
target the ordinary `127.0.0.1:8088` production-derived snapshot.

The Laravel-backed runtime commands are:

```bash
npm run smoke:laravel
npm run smoke:laravel:local
npm run smoke:federation:local
```

`smoke:laravel` runs `scripts/laravel-runtime-smoke.js` against `WEB_UK_BASE_URL`
(`http://127.0.0.1:5180` by default) and `LARAVEL_BASE_URL`
(`http://127.0.0.1:8088` by default). `smoke:laravel:local` starts the Web UK
app on an ephemeral local port inside the smoke process, sets smoke-safe
defaults for `ACCESSIBLE_BACKEND_TARGET=laravel` and `TENANT_ID=2`, points the
same harness at that local server, then closes it. Prefer the local command
when no already-running tenant-correct Web UK process is available or when
PowerShell background process management produces false `fetch failed` smoke
results.

`smoke:federation:local` is retained future side-effect tooling for the
federation wizard. It starts the current checkout on an ephemeral port, signs
in with a configured smoke account, traverses privacy and communication with
non-default choices, finalizes with only `step=confirm`, reads every value back
from Laravel `/api/v2/federation/settings`, and restores plus verifies the
account's original opt-in state and settings before exiting. It refuses to
mutate when Laravel does not expose the complete restorable settings contract.

The harness checks Laravel API
reachability, web-uk health, unsigned `/account` redirect behavior, `/login`
CSRF rendering, login POST redirect to `/dashboard`, and signed `/account`
rendering. It also checks the default public Laravel-backed module pages
`/volunteering`, `/organisations`, `/organisations/browse`, `/kb`, and `/help`
return successful responses through web-uk while Laravel is the backend target.
After login, it checks the signed Laravel-backed base pages and deeper module
pages across the public auth aliases, about/legal/support, explore, saved items,
notifications, member discovery, resources, skills, goals, clubs, wallet,
messages, connections, matches, activity, achievements, leaderboard, NEXUS
score, profile, settings, federation, courses, marketplace, events, listings,
jobs, groups, ideation, polls, search, premium, podcasts, and volunteering.
Before the login flow, it also verifies 12 matched auth-required parameterised
pages across federation, ideation, organisations, podcasts, resources, public
user collections, marketplace slot edit, saved collections, saved-search delete,
and volunteering certificate download redirect to `/login?status=auth-required`
without requiring fixture records.
Override local auth with `SMOKE_EMAIL`, `SMOKE_PASSWORD`, and `SMOKE_TENANT`;
the defaults target the Laravel local E2E fixture:
`e2e.user.a@project-nexus.local`, `TestPassword123!`, tenant slug
`hour-timebank`.

Historical 2026-07-07 evidence used an E2E user under tenant id `2`, so that
temporary Web UK process was started with `TENANT_ID=2` and sent the fallback
`X-Tenant-ID` context. This is not a current universal configuration rule.
Current request authority prefers a routed tenant slug, then
`ACCESSIBLE_TENANT_SLUG`, and uses `TENANT_ID` only as a final legacy fallback;
the checked-in local Docker environment intentionally uses
`ACCESSIBLE_TENANT_SLUG=hour-timebank` with `TENANT_ID=1`. The dated result was:
`WEB_UK_BASE_URL=http://127.0.0.1:5181 SMOKE_TIMEOUT_MS=60000 npm run
smoke:laravel` passed against a temporary web-uk process started with
`TENANT_ID=2`. In that old process, omitting the matching fallback context made
Laravel return `401`; it does not override the current slug-first authority
contract. On 2026-07-10, the new `npm run smoke:laravel:local`
wrapper passed the core Laravel-backed flow with 10/10 checks and module chunks
`SMOKE_MODULE_PAGE_CHUNK=2/8` through `8/8` with 106/106 checks each against
Laravel `http://127.0.0.1:8088`; chunk 1/8 was also green at 106/106 against a
tenant-correct temporary Web UK process. The body-text chunks also passed:
1/8 and 2/8 at 107/107, and 3/8 through 8/8 at 106/106 with
`SMOKE_MODULE_PAGE_PATHS=none`. The harness now retries a signed gated check
once after an unexpected login redirect, which handles long-batch Laravel
session churn without making every gated route perform a full login first.
Together these prove the in-process ephemeral Web UK runner can replace fragile
ad hoc temporary process launchers for chunked certification.
Later 2026-07-07 smoke runs expanded the default signed
page list from the broader base module pages to deep profile, settings,
achievement, leaderboard, federation, course, marketplace, and volunteering
subpages. The latest run against
`WEB_UK_BASE_URL=http://127.0.0.1:5293` passed `93/93` checks. A follow-up live
probe against `WEB_UK_BASE_URL=http://127.0.0.1:5294` identified another stable
2xx batch, and the expanded harness passed `158/158` checks against
`WEB_UK_BASE_URL=http://127.0.0.1:5295`. `/feed` is now included in the default
signed smoke list and renders a Laravel-backed feed page with an empty/error
state when Laravel's feed collection API is unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5297` passed `159/159`. Plain `/connections`
is now included in the default signed smoke scope and renders with an
empty/error state when Laravel's legacy connections API is unavailable; a later
run against `WEB_UK_BASE_URL=http://127.0.0.1:5298` passed `160/160`. Plain
`/members` is now included in the default signed smoke scope and renders with an
empty/error state when Laravel's legacy members API is unavailable; a later run
against `WEB_UK_BASE_URL=http://127.0.0.1:5299` passed `161/161`. `/events/new`
and `/marketplace/onboarding` are now included in the default signed smoke scope
and render form pages with empty/error setup state when Laravel helper APIs are
unavailable; a later run against `WEB_UK_BASE_URL=http://127.0.0.1:5302` passed
`163/163`. The feature/role-gated pages `/jobs/bias-audit`,
`/jobs/talent-search`, and `/marketplace/coupons` are now covered as expected
signed-session `403` checks; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5306` passed `166/166`. `/onboarding` and
`/premium/manage` are now covered as expected signed-session redirect checks; a
later run against `WEB_UK_BASE_URL=http://127.0.0.1:5307` passed `168/168`.
Signed public auth aliases `/login`,
`/login/forgot-password`, `/password/reset?token=reset-token`, and `/register`
are now covered by the default 2xx smoke scope; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5308` passed `172/172`: 6 auth/health checks,
161 module/page checks, 3 gated-status checks, and 2 redirect-status checks.
`/login/two-factor` is now covered as a signed-session redirect when the
session-backed 2FA token is absent; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5309` passed `173/173`: 6 auth/health checks,
161 module/page checks, 3 gated-status checks, and 3 redirect-status checks.
The default smoke scope now includes 12 matched unsigned auth-required
parameterised redirect checks. An earlier full default Laravel-backed run against a
temporary web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:5322`, started
with `TENANT_ID=2`, passed on 2026-07-07: `181/181` checks, `0` failures,
`161` module-page checks, 8 unsigned auth-required redirect checks, 3
gated-status checks, and 3 signed redirect checks in 352.8 seconds.
For targeted CLI runs, `SMOKE_MODULE_PAGE_PATHS`,
`SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS`, `SMOKE_GATED_PAGE_PATHS`, and
`SMOKE_REDIRECT_PAGE_PATHS` accept comma/newline-separated lists, and the
portable sentinel `none` disables that group. A targeted live CLI run against
`WEB_UK_BASE_URL=http://127.0.0.1:5317` with those three variables set to
`none` passed `14/14`, including all eight auth-required parameterised
redirects. For slower shells, `SMOKE_MODULE_PAGE_CHUNK=N/M` splits the
module-page sweep and `SMOKE_BODY_TEXT_PAGE_CHUNK=N/M` splits the body-text
sweep into deterministic one-based chunks, for example
`SMOKE_MODULE_PAGE_CHUNK=1/4` or `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8`, so agents can
recertify the full default page list in repeatable smaller Laravel-backed runs
without disabling the auth, unsigned auth-required, gated, or redirect checks.
All 16 chunked live runs against `WEB_UK_BASE_URL=http://127.0.0.1:5321` with
`TENANT_ID=2` and `SMOKE_MODULE_PAGE_CHUNK=N/16` passed on 2026-07-07:
`481` total repeated checks, `0` failures, and `161` collective module-page
checks across the default sweep. Each shard also reran the auth/API setup,
unsigned auth-required redirects, gated status checks, and signed redirect
checks.
`SMOKE_TENANT_DOMAIN_PAGE_PATHS` accepts comma/newline-separated
`host|/path=>Expected text` entries. The smoke harness sends those requests to
`WEB_UK_BASE_URL` with a real HTTP `Host` header, verifies the expected body
text, and fails if the generated HTML leaks `/alpha` or `/accessible` links.
On 2026-07-08, the local Laravel `hour-timebank` fixture exposed
`parent_domain: timebank.global`; a live targeted run against
`WEB_UK_BASE_URL=http://127.0.0.1:6320` with
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/hour-timebank/login=>Sign in`
passed the `tenant-domain-page-timebank-global-hour-timebank-login-renders`
check plus the base auth/cookie checks.
A later host-domain slice proved Laravel bootstrap and the Web UK
tenant-routing middleware can resolve `timebank.global` and `project-nexus.ie`
from Host/Origin or `X-Forwarded-Host` context, and Jest covers the rendered
network landing behavior. The first full Web UK process host-root probe still
rendered the shared chooser because the process was started with `TENANT_ID=2`
for Laravel auth smoke and host-scoped bootstrap calls inherited that
`X-Tenant-ID`. Web UK now suppresses the default tenant id on Host/Origin
tenant-context calls. A focused live smoke on 2026-07-08 against
`WEB_UK_BASE_URL=http://127.0.0.1:6426` and Laravel
`http://127.0.0.1:8088` passed
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/=>Exchange Skills Across Borders`,
emitting `tenant-domain-page-timebank-global-home-renders`.
A follow-up focused live smoke on 2026-07-09 against a current-checkout
temporary Web UK process at `WEB_UK_BASE_URL=http://127.0.0.1:6521`, started
with `TENANT_ID=2`, passed
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=project-nexus.ie|/=>Build Thriving Communities with NEXUS,timebank.global|/=>Exchange Skills Across Borders`.
The emitted checks were `tenant-domain-page-project-nexus-ie-home-renders` and
`tenant-domain-page-timebank-global-home-renders`; both pages rendered without
`/alpha` or `/accessible` link leakage.
A targeted real-fixture parameterised run against
`WEB_UK_BASE_URL=http://127.0.0.1:5325`, started with `TENANT_ID=2`, passed on
2026-07-07: `24/24` checks, `0` failures, with 6 auth/health checks and 18
module-page checks across event detail/depth, volunteering opportunity detail,
organisation detail/jobs/apply, job detail, group detail/depth, and resource
comments. This specifically verifies Laravel v2 event/group detail payload
unwrapping for `/events/6` and `/groups/484`; it does not certify ASP.NET mode.
The same 18 stable real-fixture pages are now included in the default module
page sweep. The default scope also covers `/groups/484/discussions/new`,
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
The signed poll pages `/polls`, `/polls/parity/create`,
`/polls/parity/manage`, `/polls/20`, `/polls/20/rank`, `/polls/8`, and
`/polls/4` returned expected body markers against
`WEB_UK_BASE_URL=http://127.0.0.1:6231`. The targeted run passed with `13/13`
checks and `0` failures. The body-text-only default smoke scope passed against
the same port with `234/234` total checks, including 228 body-text contract
checks, and `0` failures. Poll action redirects for auth-required, create,
vote, rank, delete, like, and comment outcomes now use `res.locals.urlFor`; any
future ASP.NET backend mode must preserve those tenant-aware redirect targets
rather than returning flat root-relative poll/login paths.
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
A follow-up focused resource source-helper smoke on 2026-07-09 against
temporary in-process Web UK `http://127.0.0.1:54932`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `18/18` checks: the base
API/health, cookie, login, account, and logout checks plus module renders and
body markers for `/resources`, `/resources/library`, `/resources/upload`, and
`/resources/10/comments`.
A follow-up focused search source-helper smoke on 2026-07-09 against temporary
in-process Web UK `http://127.0.0.1:56338`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `13/13` checks: the base
API/health, cookie, login, account, and logout checks plus signed
`/search/advanced?q=garden` module rendering and body markers
`Advanced search` and `Save this search`.
A follow-up focused saved source-helper smoke on 2026-07-09 against temporary
in-process Web UK `http://127.0.0.1:50823`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `16/16` checks: the base
API/health, cookie, login, account, and logout checks plus signed `/saved`,
`/me/collections`, and `/users/14/appreciations` module rendering and body
markers `Saved items`, `My collections`, and `Appreciation`.
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
The remaining signed/detail body-marker routes `/connections/network`,
`/dashboard`, `/exchanges`, `/me/collections`, `/premium/return`, `/profile`,
`/reviews/list`, `/users/14/appreciations`, `/kb/90001`,
`/achievements/badges/vol_1h`, and `/reviews/18/comments` now carry
Laravel-backed body-text markers. The core module-page/body-text marker gap is
0; after the 2026-07-10 clubs no-active-club correction, the current default
smoke scope has `280` module-page checks and `282` body-text contract checks.
Review action redirects for auth-required, create,
comment, reaction, Laravel-401 outcomes, and delete-review review-index status
results now use `res.locals.urlFor`; any future ASP.NET backend mode must
preserve those tenant-aware redirect targets rather than returning flat
root-relative review/login paths or honoring non-Laravel delete `return_url`
payloads.
`/dashboard` now carries stable body-text checks for
`Welcome back`, `Your time bank`, `Quick links`, `Recent feed`, and `Recent
listings`.
The default scope now contains `633` checks:
`280`
module-page checks, 14 unsigned auth-required redirect checks, 3 unsigned login
redirect checks, 23 gated-status checks, and 19 signed redirect checks, plus 2
content-type contract checks, 282 body-text contract checks, 3 cookie-consent
POST workflow checks, 1 logout POST workflow check, and the 6 auth/health
checks.
On 2026-07-09, the same full default scope was recertified against a dedicated
local Web UK process at `WEB_UK_BASE_URL=http://127.0.0.1:6510`, started with
`TENANT_ID=2`, `ACCESSIBLE_BACKEND_TARGET=laravel`, and
`LARAVEL_BASE_URL=http://127.0.0.1:8088`. A 2026-07-10 follow-up corrected the
current default scope so the local `hour-timebank` no-active-club fixture checks
signed `/clubs` as gated `404` rather than as a 2xx module/body-text page.
Because the local all-in-one command
can mix slow Laravel page sweeps with stateful gated checks, the certification
is split by bucket: `SMOKE_MODULE_PAGE_CHUNK=1/8` through `8/8` covers all
`280` module-page checks, `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8` through `8/8`
covers all `282` body-text checks, and explicit core groups cover the 14
unsigned auth-required redirects, 3 unsigned login redirects, 2 content-type
checks, 23 signed gated-status checks, 19 signed redirects, 3 cookie-consent
POST workflows, logout, and the base Laravel/API/auth checks. The bucketed
runs exited `0` with no failed checks. This is Laravel-runtime evidence only;
it does not certify ASP.NET backend switching.
While recertifying the chunked scope on 2026-07-08, the Laravel E2E fixture
returned `403` for optional `/api/v2/federation/activity` while
`/api/v2/federation/status` and `/api/v2/federation/partners` returned `200`.
The web-uk `/federation` hub now renders from the available status/partner data
with an empty activity list in that permission-limited state. A targeted
Laravel runtime smoke against `WEB_UK_BASE_URL=http://127.0.0.1:6260`, started
with `TENANT_ID=2`, passed `11/11` checks including
`module-page-federation-renders`.
On 2026-07-09, the federation hub source-helper slice converted the hub
service navigation, opt-in/opt-out CTAs, partner preview links, view-all link,
and quick links through `urlFor()`. A scoped Laravel runtime smoke against
`WEB_UK_BASE_URL=http://127.0.0.1:5180`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `12/12` checks including
signed `/federation` and `/federation=>Federation`.
The federation onboarding source-helper slice now routes the wizard back link,
service navigation, step form actions, step-back links, and do-this-later links
through `urlFor()`. A scoped Laravel runtime smoke against the same Web UK and
Laravel bases with `TENANT_ID=2` passed `12/12` checks including signed
`/federation/onboarding` and
`/federation/onboarding=>Welcome to the community network`.
The 2026-07-10 workflow-parity slice points the opted-out hub CTA to
`/federation/onboarding` and retains privacy/communication choices in an
Express session bag keyed by the active tenant. The confirm request now needs
only `step=confirm`; failure retains the bag and success clears it after
Laravel `/api/v2/federation/setup` succeeds. Six focused session-flow tests
pass, including tenant isolation and mounted URLs. A current-checkout
ephemeral Web UK flow at `http://127.0.0.1:58710` completed the live wizard and
read every chosen value back from Laravel `/api/v2/federation/settings`, then
restored the disposable account's original settings.
The same 2026-07-08 temporary process then recertified the remaining chunked
page sweeps after earlier `1/8` and post-fix `2/8` mixed chunks passed:
`SMOKE_MODULE_PAGE_CHUNK=3/8` through `8/8` passed with `269/269` repeated
checks and `0` failures, including `209` module-page checks, and
`SMOKE_BODY_TEXT_PAGE_CHUNK=3/8` through `8/8` passed with `271/271` repeated
checks and `0` failures, including `211` body-text contract checks. The `3/8`
body slice is slow on this local Laravel/Web UK pair and needed a generous
wrapper timeout; a fetch-logged rerun completed green in about 253 seconds.
A targeted live dashboard marker smoke on 2026-07-08 against a temporary
web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:6240`, started with
`TENANT_ID=2`, passed `12/12` checks for auth/health, signed `/dashboard`, and
the dashboard body markers `Welcome back`, `Your time bank`, `Quick links`,
`Recent feed`, and `Recent listings`.
The dashboard source template now routes onboarding, exchange-attention,
create-listing, upcoming-event, quick-link, recent-feed, and recent-listing
links through `urlFor()` for shared-mount and custom-domain tenant contexts.
A scoped Laravel runtime smoke on 2026-07-09 against
`WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel
`http://127.0.0.1:8088` passed `12/12` checks for the core auth/cookie/logout
flow plus signed `/dashboard` rendering and the `Quick links` body marker, with
unrelated default page sweeps disabled.
This does not certify ASP.NET backend switching: ASP.NET must still match
Laravel's dashboard profile, onboarding, wallet, gamification, feed, listing,
event, exchange-attention, endorsement, tenant feature-gate, localization, and
status redirect contracts before dashboard can be called backend-neutral.
A targeted core Laravel runtime smoke on 2026-07-08 against a temporary
web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:6251`, started with
`TENANT_ID=2`, passed with `SMOKE_MODULE_PAGE_PATHS=none` and
`SMOKE_BODY_TEXT_PAGE_PATHS=none`. The pass covered Laravel API reachability,
web-uk health, unsigned auth redirects, login CSRF, login POST to `/dashboard`,
signed `/account`, logout POST clearing the session, no-JS cookie POST
workflows, content-type contracts, 22 signed gated `403` checks, and 21 signed
redirect checks. That historical scope is superseded by the current 633-check
scope after `/clubs` moved to signed gated `404`. The historical full default run exceeded the 15-minute command
wrapper after progressing through module pages and into body-text checks; use
`SMOKE_MODULE_PAGE_CHUNK=N/M`, `SMOKE_BODY_TEXT_PAGE_CHUNK=N/M`, or targeted
smoke scopes for full local recertification.
On the same date, a focused group/course smoke against temporary Web UK
`http://127.0.0.1:6350` and Laravel `http://127.0.0.1:8091`, started with
`TENANT_ID=2`, passed `16/16` checks for the base auth/cookie flow plus
`/groups/484`, `/courses/1`, and `/courses/2` module renders and body markers.
Parameterised matched GET route shapes without default runtime smoke coverage
fell from 28 to 0.

## Historical Page-Candidate Evidence (Superseded As A Queue)

The narrative below is retained as dated implementation evidence. It is not a
current page queue or switching checklist. Use
`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for Web UK and the root
`CURRENT_ASPNET_CONTRACT_STATUS.md` plus `CURRENT_SCHEMA_READINESS.md` for the
future ASP.NET switch.

`/account` GET is a local Blade-style protected account hub candidate. Unsigned
requests redirect to `/login`, and signed-in requests render local account cards
for wallet, messages, connections, notifications, profile, and settings. The
notifications module includes Laravel accessible aliases for
`/notifications/group/read` and `/notifications/delete-all`, backed by
`/api/v2/notifications/group/read` and `DELETE /api/v2/notifications`.
Notification POST redirects now resolve through the active tenant URL helper,
so future ASP.NET mode must preserve shared-mount and custom-domain redirect
targets instead of emitting flat root paths. The wallet module includes the
Laravel accessible `/wallet/donate` POST, backed by
`/api/v2/wallet/donate`. Saved-item removal and appreciation send/react aliases
are backed by `/api/v2/me/saved-items` and `/api/v2/appreciations`.
Saved-collection aliases are backed by `/api/v2/me/collections` plus
`/api/v2/me/saved-items/{id}` for item removal. Saved item, collection, and
saved social templates route their local links/forms through `urlFor()` with
focused source, render, and Laravel runtime-smoke coverage.
Jobs browse/detail/saved/applications/owner/employer/talent GET pages and
job POST aliases are backed by Laravel-compatible jobs/admin/user APIs, and
jobs templates route their local links/forms, pagination, CSV/CV downloads, and
variable form targets through `urlFor()` with focused source and render
coverage plus focused Laravel runtime smoke for the signed jobs account
subpages. This is still Laravel-mode evidence only, not ASP.NET switching
certification.
Podcast browse/detail/episode/studio/create/manage pages and POST aliases are
backed by Laravel-compatible podcast APIs, and podcast templates route their
local links/forms and multipart episode upload action through `urlFor()` with
focused source, render, and Laravel runtime-smoke coverage. This does not
certify ASP.NET backend switching: ASP.NET must still match Laravel's podcast
list/detail/authored-show APIs, subscribe/update/publish/delete contracts,
episode audio upload handling, tenant author gates, localization, status
redirects, and custom-domain tenant behavior before podcasts can be called
backend-neutral.
Feed browse/hashtag/post/item pages and POST aliases are backed by
Laravel-compatible feed APIs, and feed templates route local feed/member/group/
login links, pagination, engagement forms, `nextHref`, and internal deep links
through `urlFor()` with focused source, render, and Laravel runtime-smoke
coverage. Feed index normalization now accepts Laravel `author` post rows as
well as older local `user` rows. This does not certify ASP.NET backend
switching: ASP.NET must still match Laravel's feed collection, hashtag, post,
typed-item, comment, reaction, share, save, report, mute, upload, tenant,
feature-gate, localization, status redirect, and custom-domain contracts before
feed can be called backend-neutral.
Knowledge-base browse and article pages are backed by Laravel-compatible
knowledge-base APIs. The `/kb` source templates route their local search form,
article links, cursor load-more link, article back link, and related-article
links through `urlFor()` for shared-mount and custom-domain tenant contexts.
This does not certify ASP.NET backend switching: ASP.NET must still match
Laravel's knowledge-base list/search/detail contracts, tenant scoping,
localization, content sanitization, and custom-domain routing before these
pages can be called backend-neutral.
Match-dismiss aliases are backed by `/api/v2/matches/{id}/dismiss`.
Exchange action/rating aliases are backed by `/api/v2/exchanges/{id}` action
endpoints and `/api/v2/exchanges/{id}/rate`.
Listing exchange-request GET and POST routes now pre-check Laravel
`/api/v2/exchanges/config` and mirror Blade's broker workflow-disabled
redirect to `/listings/{id}?status=exchange-disabled` before rendering the
request form or calling `/api/v2/exchanges`. Future ASP.NET mode must expose an
equivalent `exchange_workflow_enabled` contract and preserve the same no-JS
disabled-workflow redirect before this workflow can be certified as
backend-neutral.
Onboarding step POSTs use `/api/users/me`, `/api/v2/users/me/avatar`,
`/api/v2/onboarding/safeguarding`, and `/api/v2/onboarding/complete`. It is not
a backend adapter and does not certify Laravel tenant feature gates, full
account-link coverage, route availability checks, per-module response contracts,
realtime notification behavior, onboarding visual parity, or ASP.NET backend
readiness.
The default Laravel runtime smoke now verifies the account sign-out POST by
reading the signed account CSRF token, posting `/logout`, and asserting the
subsequent unsigned `/account` redirect. A targeted live Laravel-backed run
against `WEB_UK_BASE_URL=http://127.0.0.1:6243`, started with `TENANT_ID=2`,
passed `10/10` checks including logout on 2026-07-08. ASP.NET backend logout
compatibility is still future/not-certified.

`/cookies` GET and `/cookie-consent` POST are local Blade-style no-JS cookie
candidates. They render the Laravel-style analytics settings form and set the
same first-party `nexus_accessible_cookie_consent` values (`all` or `essential`) used
by Laravel's accessible frontend. The Laravel runtime smoke now verifies the
no-JS reject, accept, and settings-save POSTs by fetching CSRF tokens, posting
to `/cookie-consent`, and asserting the expected `/cookies` redirects plus
`nexus_accessible_cookie_consent` values. Web UK still reads the legacy
`nexus_alpha_cookie_consent` cookie as a compatibility fallback so existing
Laravel Blade consent choices continue to dismiss the banner, but new Web UK
POSTs do not write the public-facing alpha name.
Cookie-banner return paths are validated as same-origin local paths and passed
through the idempotent tenant URL helper, so a missing, already-mounted, or
unmounted return value cannot escape the active shared tenant mount.
They do not certify Laravel `cookie_consents` audit persistence, tenant-scoped
consent behavior, localized copy, report-a-problem workflows, or ASP.NET backend
readiness.

`/volunteering` GET is a local Blade-style public landing/search candidate
based on the Laravel accessible volunteering page. It reads
`/api/v2/volunteering/opportunities` with `search`, `category_id`, `is_remote`,
`per_page`, and `cursor` query params, and keeps empty/error states for API
unavailability. `/volunteering/opportunities/{id}` GET reads
`/api/v2/volunteering/opportunities/{id}` and renders the public Blade-style
detail, metadata, shifts, and a safe apply link. It is not a backend adapter and
does not certify applications, recommended shifts, hours, organisation owner
tools, apply POST, shift signup/cancel, feature gates, tenant routing, auth
redirects, or POST workflows.

The signed volunteering workflow refresh on 2026-07-10 also aligned current
Laravel semantics that are independent of the future ASP.NET adapter. Donation
GET resolves the tenant bootstrap `settings.default_currency`, normalizes the
display code to uppercase, and uses EUR only as a defensive fallback. Donation
POST omits a client-supplied `currency` value and rejects amounts above
`1,000,000` before calling Laravel. Focused tests prove a GBP tenant render and
the currency-free POST contract. The two advisory panels announce `Warning`,
while genuine validation summaries retain `There is a problem`; safeguarding
field failures link to all five affected controls and the two generic failures
remain plain text. Read-only discovery found no non-EUR currency in the 15
locally available tenant bootstraps, so live non-EUR donation persistence is
not claimed and still needs a disposable non-EUR tenant fixture.

`/organisations`, `/organisations/browse`, `/organisations/register`,
`/organisations/manage`, `/organisations/{id}`, `/organisations/{id}/jobs`, and
`/organisations/opportunities/{id}/apply` GET are local Blade-style visual/data
candidates based on the Laravel accessible organisations pages. The directory GET reads
`/api/v2/volunteering/organisations` with `search` and `per_page` query params
and keeps a warning state for API unavailability. The browse GET uses the same
collection with `search`, `per_page`, and cursor-style load-more pagination. The
register GET renders the standalone Blade-style form and validation status
anchors. `/organisations` POST and `/organisations/register` POST validate the
same required fields/terms, require a signed token, submit to
`/api/v2/volunteering/organisations`, and redirect with Laravel status keys. The
manage GET reads `/api/v2/volunteering/my-organisations` when a signed token is
present and renders owner/admin and pending rows, but Laravel auth redirect
behavior is not certified. Its detail GET reads
`/api/v2/volunteering/organisations/{id}?include=public_contract` and renders
profile, contact, jobs-link, basic public stats, active opportunities from
`/api/v2/volunteering/opportunities?organization_id={id}`, and volunteer
reviews from `/api/v2/volunteering/reviews/organization/{id}`. The organisation
jobs GET reads `/api/v2/jobs?organization_id={id}&status=open` when signed in
and renders Blade-style job cards. The organisation opportunity apply GET reads
`/api/v2/volunteering/opportunities/{id}` and renders the Blade-style
confirmation page that posts to the existing volunteering apply route when
signed in. It is
not a backend adapter and must not be treated as proof that Laravel or ASP.NET
organisation workflows are ready in this app. The remaining work includes
tenant-prefixed routing, auth redirects, volunteering feature gates,
job-vacancy feature gates, registration runtime persistence, organisation apply
POST workflow, localization, and runtime smoke tests.

The member directory, discovery, nearby, and insights templates are
Laravel-backed candidates whose local links/forms now route through `urlFor()`
for shared-mount and custom-domain tenant contexts. Member action auth/status
redirects also resolve through the active tenant URL helper, so future ASP.NET
mode must preserve shared-mount and custom-domain redirect targets instead of
emitting flat `/login`, `/members`, or `/profile/blocked` paths. This
source-level helper conversion does not certify ASP.NET backend switching:
ASP.NET must still match
Laravel's user search, community ranking, nearby-member, visibility/privacy,
verification badge, connection, tenant, feature-gate, localization, and redirect
contracts before these pages can be called backend-neutral.

The event action redirect slice adds the same backend-neutral requirement for
event workflows. Future ASP.NET mode must preserve Laravel-compatible event
waitlist, check-in, poll attachment/vote, recurring edit, translation, create,
edit, cancel, delete, and RSVP status redirects through the active tenant URL
helper. It must not emit flat `/login` or `/events` locations when the request
is served from `/{tenantSlug}/accessible`, a custom accessible domain, or a
parent-domain child path.

The goals action redirect slice adds the same backend-neutral requirement for
goal workflows. Future ASP.NET mode must preserve Laravel-compatible goal
create, template use, edit, delete, buddy, progress, complete, check-in,
reminder, buddy-action, like, comment, and auth-required status redirects
through the active tenant URL helper. It must not emit flat `/login` or
`/goals` locations when the request is served from `/{tenantSlug}/accessible`,
a custom accessible domain, or a parent-domain child path.

The saved route-redirect slice adds the same backend-neutral requirement for
saved item, saved collection, and appreciation workflows. Future ASP.NET mode
must preserve Laravel-compatible saved item removal, collection create/update/
delete/item-remove, appreciation send, appreciation reaction, and auth-required
status redirects through the active tenant URL helper, including anchors such
as `#appreciation-{id}`. It must not emit flat `/saved`, `/me/collections`,
`/users/{id}/appreciations`, or `/login` locations when the request is served
from `/{tenantSlug}/accessible`, a custom accessible domain, or a parent-domain
child path.

The public coupon route-redirect slice adds the same backend-neutral
requirement for coupon auth handoffs. Future ASP.NET mode must preserve
Laravel-compatible `/coupons` and `/coupons/{id}` auth-required redirects
through the active tenant URL helper. It must not emit flat `/login` locations
when the request is served from `/{tenantSlug}/accessible`, a custom accessible
domain, or a parent-domain child path.

The activity route-redirect slice adds the same backend-neutral requirement
for activity dashboard and insights auth handoffs. Future ASP.NET mode must
preserve Laravel-compatible `/activity` and `/activity/insights` auth-required
redirects through the active tenant URL helper. It must not emit flat `/login`
locations when the request is served from `/{tenantSlug}/accessible`, a custom
accessible domain, or a parent-domain child path.

The group-exchange GET redirect slice adds the same backend-neutral
requirement for group-exchange list, create, and detail auth handoffs. Future
ASP.NET mode must preserve Laravel-compatible `/group-exchanges`,
`/group-exchanges/new`, and `/group-exchanges/{id}` auth-required redirects
through the active tenant URL helper. It must not emit flat `/login` locations
when the request is served from `/{tenantSlug}/accessible`, a custom accessible
domain, or a parent-domain child path.

## Required Compatibility Areas

Before switching backends, every certified route family needs proof for:

- Tenant resolution: shared slug paths and custom accessible domains.
- Auth/session: login, logout, refresh, 2FA, redirects, and signed-in state.
- CSRF/forms: token names, form POST behavior, validation failures, and replay
  handling.
- Feature and module gates: hidden links, disabled pages, 403/404 behavior, and
  tenant configuration.
- Request shape: query params, form fields, multipart names, and route params.
- Response shape: page data, lists, pagination, empty states, errors, and status
  codes.
- Uploads: avatar, listing images, event cover images, resources, and any media
  constraints. Event cover-image clearing/removal still needs an explicit
  Laravel-compatible API contract before this frontend can expose the Blade
  remove-current-image checkbox.
- Redirects: success/failure destinations and flash messages.
- Localization: locale selection, RTL, translated labels, and validation copy.
- Realtime or async status: messages, notifications, and unread-count behavior.

`npm run audit:aspnet:readiness` fails closed and now distinguishes a healthy
but stale runtime (`stale-tenant-middleware`, where public v2 calls still demand
`X-Tenant-ID`) from an unavailable process or a broader incomplete contract.
This diagnostic does not permit a Web UK fallback; rebuild the ASP.NET runtime
from compatible source and rerun the slug-first checks.

Use `docs/generated/accessible-route-matrix.md` (or its JSON companion) as the
route-by-route backlog seed before certifying any family. It is refreshed with `npm run route:matrix`
and records Laravel route names, handlers, inferred Blade views, feature/module
gates, auth classification, API/service hints, and current `apps/web-uk`
method/path matches.

Use `docs/generated/frontend-api-consumer-ledger.json` as the backend-contract
consumer inventory. Refresh it with `npm run api:ledger`; it records concrete
Web UK method/path consumers, tenant/auth boundaries, request and response
shapes, statuses/errors, redirects, side effects, cleanup requirements,
Laravel OpenAPI/controller matches, and test references. Dynamic or unmatched
rows remain explicit gaps. Neither an OpenAPI match nor a detected test-file
reference certifies behavior against Laravel or ASP.NET.

`src/routes/laravel-prep-pages.js` registers generated Laravel GET preparation
pages after all real route modules only for rows that the generated matrix marks
as `missing`. Consult the generated matrix for the live missing-route and
runtime-preparation-page totals; do not copy them into this switching contract.
Any future fallback page counts as route discoverability only. It is not a
backend adapter and must not be used as proof of Laravel or ASP.NET workflow
compatibility.

`src/routes/contact-support.js` is a Laravel-backed candidate for the accessible
contact/support routes. `/contact` POST submits to Laravel `/api/v2/contact`;
signed-in `/report-a-problem` POST submits to Laravel `/api/v2/support/reports`.
The routes mirror Laravel status keys and validation shape, but tenant-domain
routing, Turnstile production behavior, localization, notification side effects,
and ASP.NET backend compatibility still need runtime certification.

The auth router also exposes Laravel accessible aliases for
`/login/forgot-password`, `/password/reset`, `/login/two-factor`, and
`/login/resend-verification`. These map to the existing local forgot-password,
reset-password, 2FA, and verification-resend handlers, with the reset API helper
using Laravel's `password`/`password_confirmation` payload. Login responses with
`requires_2fa` use Laravel's `two_factor_token`, store it in the web session,
and redirect to `/login/two-factor`; missing challenge tokens redirect back to
`/login?status=two-factor-required`.

## Local Environment Shape

Keep three local surfaces distinct:

| Surface | Path | Role |
| --- | --- | --- |
| Laravel source | `C:\platforms\htdocs\staging` | Production source of truth; read-only from this repo. |
| ASP.NET backend | `C:\platforms\htdocs\asp.net-backend` | Separate incomplete backend implementation that must match Laravel contracts; not authoritative for Web UK. |
| Shared accessible frontend | `C:\platforms\htdocs\asp.net-backend\apps\web-uk` | Web UK implementation target; repository location does not make it ASP.NET-specific. |

Future extraction should move `apps/web-uk` into its own repository only after
it has independent `AGENTS.md`, `CLAUDE.md`, README, docs, tests, route matrix,
and backend contract notes.

## Non-Negotiable Guardrails

- Do not make ASP.NET route gaps disappear by weakening the accessible frontend.
- Do not modify ASP.NET source, tests, migrations, schema, fixtures, or runtime
  data from the Web UK workstream.
- Do not use current ASP.NET behaviour to resolve ambiguity in Web UK; trace the
  Laravel Blade workflow and Laravel backend contract instead.
- Do not point React utility-bar traffic at `apps/web-uk` until route/workflow
  certification and rollback planning are complete.
- Do not claim shared readiness from static route counts or incomplete pages.
- Make ASP.NET match Laravel accessible behaviour; never add backend-specific
  branches in Nunjucks views, browser routes, validation, or redirects.
