# Laravel Accessible Route Matrix

Last reviewed: 2026-07-14

Status: **Maintained reference — route evidence ledger, not the current score or queue**

Current coordination, scoring, and next-job truth lives only in
`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`. Counts in dated narrative sections
below are historical checkpoints. The generated artifacts named in the current
static-count section are the exhaustive declaration inventory.

**Runtime safety:** every login or runtime-smoke command mentioned anywhere in
this document is stateful unless its requests have been inspected and proved to
be unauthenticated GET/HEAD operations with no server-side writes. Run a
stateful smoke only after `LARAVEL_BASE_URL` points to a separately provisioned,
verified disposable Laravel application/database/storage environment. Never
run it against the ordinary production-derived Laravel environment at
`127.0.0.1:8088`; authorization and cleanup do not make that environment
disposable.

Every historical stateful result below that used the ordinary Laravel
environment is invalid as certification, even where the retained checkpoint
wording says “passed”, “certified”, or “current”. It remains useful only for
regression discovery.

## Purpose

This matrix tracks how `apps/web-uk` lines up with the Laravel Blade accessible
frontend. It is structural inventory evidence only. The current method/path declaration
gaps are explicitly classified below, but this does not certify workflow
parity, backend compatibility, visual parity, or production readiness.
It does not certify route parity beyond static method/path declarations.

## Sources

Laravel source of truth:

- `C:\platforms\htdocs\staging\routes\govuk-alpha.php`
- `C:\platforms\htdocs\staging\routes\govuk-alpha-parity`
- `C:\platforms\htdocs\staging\accessible-frontend\views`

Web UK implementation target (its repository location does not make the
frontend ASP.NET-specific):

- `C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\server.js`
- `C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\routes`
- `C:\platforms\htdocs\asp.net-backend\apps\web-uk\src\views`

## Current Generated Inventory

Generated artifacts live in:

```text
docs/generated/accessible-route-matrix.md
docs/generated/accessible-route-matrix.json
```

Refresh them with:

```bash
npm run route:matrix
```

The generated Markdown summary is the sole live declaration-count inventory and
its JSON is the machine-readable source. It records generation time, exact
Laravel and Web UK commits, dirty-state provenance, matched/missing/extra rows,
and ignored infrastructure routes. This maintained ledger does not copy those
totals. They are structural declarations, not a parity score; workflow, auth,
tenant, localization, Laravel-runtime, and later ASP.NET switching certification
remain separate gates.

Historical runtime note, 2026-07-09 (invalidated as certification because it
used the ordinary Laravel environment): after that matrix was refreshed green, the full
default Laravel runtime-smoke scope was recertified against a dedicated
tenant-correct Web UK process at `http://127.0.0.1:6510` with `TENANT_ID=2`.
Module chunks `1/8` through `8/8` covered all `281` module checks, body chunks
`1/8` through `8/8` covered all `283` body-text checks, and split core buckets
covered unsigned redirects, content types, all `22` gated statuses, all `19`
signed redirects, cookie POSTs, logout, and base auth/health with no failed
checks. On 2026-07-10, the smoke defaults were corrected so the local
`hour-timebank` no-active-club fixture checks `/clubs` as a signed gated `404`
instead of a 2xx module/body-text page. The current default scope is therefore
`633` checks: `280` module checks, `282` body-text checks, and `23`
gated-status checks, with the other buckets unchanged. This record is retained
only as regression-discovery history. It is not current runtime certification
and does not prove visual/manual Blade parity or ASP.NET backend switching.

The Explore route has additional source-level parity coverage beyond static
method/path matching: its shared card list now consumes tenant bootstrap
modules/features using Laravel Blade candidate gates, keeps Search and Skills
visible like Blade, hides Exchanges unless listings plus broker exchange
workflow config are enabled, uses Laravel `TenantFeatureConfig` defaults for
omitted feature keys, and routes live listing/event links through `urlFor()`
for tenant mounts and custom-domain roots. Default-off tenant cards such as
Marketplace, Courses, Podcasts, Coupons, and Premium stay hidden on
tenant-mounted Explore unless Laravel explicitly enables them. A scoped Laravel
runtime smoke also passed signed `/explore=>Explore` against Web UK
`127.0.0.1:5180` and Laravel `127.0.0.1:8088`; a follow-up current-code smoke
passed signed `/acme/accessible/explore=>Explore` against Web UK
`127.0.0.1:6521` and Laravel `127.0.0.1:8088`. A follow-up default-off
feature-gate slice now also returns Laravel-style `403` responses for
tenant-mounted Marketplace, Courses, Podcasts, Coupons, and Premium paths when
Laravel tenant bootstrap omits their disabled-by-default flags. A targeted
Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6531` passed
all five signed tenant-mounted gated checks with `403`. A follow-up core route
gate slice now also blocks tenant-mounted disabled Dashboard, Feed, Listings,
Exchanges, Matches, Events, Volunteering, Organisations, Members, Connections,
Messages, Wallet, Notifications, Achievements, Leaderboard, NEXUS score, Blog,
AI chat, Federation, Goals, Groups, Group exchanges, Ideation, Jobs, Polls,
Resources, Reviews, and Search prefixes through the same Laravel-aligned
tenant bootstrap defaults. Focused Jest first failed on `/acme/accessible/dashboard`
returning `200`, then passed once `src/middleware/tenant-feature-gates.js`
handled `moduleKey` and the additional `featureKey` prefixes. A targeted live
smoke against temporary Web UK `http://127.0.0.1:6535`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `18/18` checks: enabled
`/hour-timebank/accessible/dashboard`, `/wallet`, and `/members` body markers
plus the five default-off `/acme/accessible/*` `403` checks. This is not yet
live runtime proof of a real Laravel tenant with disabled core modules, a
disabled broker workflow fixture, every route-specific workflow gate, or full
enabled-tenant depth behavior. A follow-up compound-gate slice now stacks all
matching route gates and blocks `/events/{id}/map` when `maps` is disabled,
`/organisations/{id}/jobs` when `job_vacancies` is disabled, and
`/messages/groups...` when `connections` is disabled while the broader route
families remain enabled. Focused Jest first failed on
`/acme/accessible/events/6/map` returning `200`, then passed once
`src/middleware/tenant-feature-gates.js` used route-specific patterns plus
all-matching gate evaluation. A scoped Laravel runtime smoke against temporary
Web UK `http://127.0.0.1:6601`, Laravel `http://127.0.0.1:8088`, and
`TENANT_ID=2` passed `13/13` checks, proving the enabled local Laravel fixture
still renders `/events/6/map`, `/organisations/636/jobs`, and
`/messages/groups/new` after the gate change. A follow-up active-club evidence
slice now matches Laravel's `/clubs` route gate: signed empty unfiltered club
responses return `404`, while an empty search result can still render the Clubs
page when a minimal unfiltered probe proves the tenant has active clubs.
Focused Jest first failed on signed `/clubs` returning `200`, then passed once
`src/routes/clubs.js` added the no-active-clubs 404 and searched-empty probe.
The Explore page now uses the same live active-club evidence for its Clubs
card: focused Jest first failed because signed Explore did not call
`getClubs({ per_page: 1 })`, then passed after `src/routes/explore.js`
rebuilt `alphaExploreLinks` from that Laravel-backed probe for both flat and
`/{tenantSlug}/accessible` Explore routes.

Tenant-routing parity details live in `docs/TENANT_ROUTING_PARITY.md`. Web UK
now has a first shared-mount slice for `/{tenantSlug}/accessible`, with legacy
`/{tenantSlug}/alpha` requests canonicalized to `/accessible`. Shared-mount
responses now also rewrite local redirects plus rendered HTML `href` and
`action` targets back under the active `/{tenantSlug}/accessible` prefix while
leaving asset/API/infrastructure URLs flat. Shared root `/` now renders the
Laravel-style tenant chooser from `/api/v2/tenants`, excludes the master tenant,
sorts communities by display name to match Laravel Blade's `orderBy('name')`,
and links active communities to the clean `/{tenantSlug}/accessible` mount. Web
UK now also resolves non-local Host and `X-Forwarded-Host` values through
Laravel `/api/v2/tenant/bootstrap` and renders the tenant home at slugless `/`
when the host matches Laravel's `accessible_domain` or `domain`. Master and
cluster roots use Laravel SEO h1/intro copy plus `tenant_switcher` communities.
Parent-domain child tenant routing and host-root runtime smoke have focused
Laravel-backed proof, and the parent-domain reserved child-segment guard now
has automated source parity coverage against Laravel
`TenantContext::getReservedPaths()`; current source audits now find no direct
root-relative `href`/`action` attributes in `src/views`, no object-style
`href: "/"` or `action: "/"` targets in Web UK source, and no raw
root-relative `res.redirect("/...")` calls in `src/middleware`, `src/lib`,
`src/routes`, or `src/server.js`. Helper-mediated redirects still pass local
paths into `urlFor()` and must remain covered by route-family tests. Keep those
audits green as source-level tenant-routing regression guards. Activity route-level
auth redirects now also use `res.locals.urlFor` for
the dashboard and insights auth handoffs, keeping signed-out activity requests
inside shared tenant mounts and custom-domain contexts. Group-exchange
route-level auth redirects now also use `res.locals.urlFor` for signed-out
list, create, and detail GET handoffs, keeping those requests inside shared
tenant mounts and custom-domain contexts before any Laravel group-exchange API
calls. Marketplace coupon,
order, and pickup-slot management source templates
now also use `urlFor()` for their local links/forms, so the marketplace
template family has source-level helper coverage for local marketplace
`href`/`action` targets. Marketplace action route redirects now also use
`res.locals.urlFor` for auth, validation, success, and API-failure outcomes,
and marketplace page GET auth/Laravel-401 handoffs now use the same helper
across listing, buyer, offer, order, onboarding, pickup-slot, and coupon POST
flows. Connections index and network source templates now
also use `urlFor()` for local tabs, member links, pagination, search, load-more,
and action targets. Notifications index source templates now also use
`urlFor()` for breadcrumbs, filters, read/delete actions, redirect hidden
values, pagination, and the unread empty-state CTA. Notification route-level
POST redirects now also use `res.locals.urlFor` for grouped-read, read-all,
delete-all, single-read, single-delete, API-error, and validated return
outcomes. Group-exchange list/create/detail source templates now also use
`urlFor()` for the create CTA,
status tabs, detail links, create form, participant add/remove/search forms,
confirmation form, and complete/cancel actions. Message index, direct
conversation, and group conversation source templates now also use `urlFor()`
for breadcrumbs, direct and group message links, listing/member/connection
links, older-message pagination, search forms, reply/edit/delete/voice/archive
forms, group create/search/member/reaction forms, and leave-group controls.
Wallet index and manage source templates now also use `urlFor()` for the
breadcrumb, manage CTA, back link, recipient search form, transfer forms, and
donation forms. Wallet transfer and donation status redirects now also use
`res.locals.urlFor`, with shared-mount coverage for invalid donation
validation.
Public/auth/support source templates now also use `urlFor()` for contact,
cookie settings, login, two-factor login, forgot-password, reset-password,
register, and report-a-problem local links/forms.
Public-info/legal/support/cookie source templates now also use `urlFor()` for
About, Guide, Features, email verification, Help, Trust and safety, legal
document/accessibility fallback links, the standalone privacy contact link, and
cookie-banner links/forms.
Newsletter-unsubscribe and error-page fallback home links now also use
`urlFor('/')`, matching Laravel's `route('govuk-alpha.home', ...)` pattern for
the unsubscribe back-home link and keeping fallback navigation tenant/custom-
domain aware.
The shared pagination partial default now also uses `urlFor('/members')`
instead of a raw `/members` sample/default base URL, keeping omitted pagination
fallbacks tenant-aware under shared mounts and custom-domain child paths.
Shared empty-state action links now render through `urlFor()`, and shared
breadcrumb examples use `urlFor('/groups')` style paths, keeping reused partial
links tenant-aware when pages are served from `/{tenantSlug}/accessible`.
AI chat route-level redirects now also use a route-local helper backed by
`res.locals.urlFor`, keeping auth-required, empty-message, and post-send chat
redirects inside the active shared accessible mount.
Matches route-level redirects now also use the same `res.locals.urlFor` helper,
keeping match dismiss and board dismiss redirects inside the active shared
accessible mount.
Auth route-level redirects now also use the same `res.locals.urlFor` helper,
keeping login, two-factor, register, logout, forgot-password, and reset-password
redirects inside the active shared accessible mount.
Core server-level redirects now also use `res.locals.urlFor` for deterministic
cookie, account, and organisation targets, keeping those redirects inside the
active shared accessible mount while preserving existing safe-return handling
for user-provided return paths.
Contact/support route-level redirects now also use `res.locals.urlFor` for
contact validation/result, signed-out report handoff, report validation,
report sent/failed, and unsigned report POST targets, keeping public support
workflow redirects inside the active shared accessible mount.
Explore route-level redirects now also use `res.locals.urlFor` for unsigned
and Laravel-401 auth-required redirects, keeping the Explore gateway inside
the active shared accessible mount.
Achievements route-level redirects now also use `res.locals.urlFor` for
unsigned, Laravel-401, daily-reward, challenge-claim, shop-purchase, and
showcase targets, keeping gamification auth and POST result redirects inside
the active shared accessible mount.
Connection route-level redirects now also use `res.locals.urlFor` for unsigned
network access and accept/decline/remove POST results, keeping connections
workflow redirects inside the active shared accessible mount.
Clubs source now also uses `urlFor('/clubs')` for the search form and
`res.locals.urlFor` for the unsigned auth-required redirect, keeping the clubs
directory inside the active shared accessible mount. The route now mirrors
Laravel's tenant-has-clubs gate by returning `404` when the Laravel-backed club
list proves the tenant has no active clubs; searched empty results remain
renderable when an unfiltered probe proves active clubs exist.
Skills source now also uses `urlFor()` for category/member/search links and the
search form, uses `res.locals.urlFor` for the unsigned auth-required redirect,
and routes shared `asyncRoute` 401/error redirects through the active URL
helper when present, keeping signed, unsigned, and expired-token skills
handoffs inside the active shared accessible mount.
The global no-JS language selector now preserves scalar non-`locale` query
parameters as hidden inputs, matching Laravel Blade's
`request()->except(['locale'])` behavior so status, filter, and return values
survive locale changes.
The shared service navigation and footer Platform column now consume Laravel
tenant bootstrap `modules`/`features` with the same IA gates used by
`AlphaController::alphaNavItems()` and `alphaFooterColumns()`: Dashboard,
Feed, Listings, Members, Events, Volunteering, and footer Blog visibility are
filtered before tenant/custom-domain prefixes are applied. Shared
`/{tenantSlug}/accessible` requests now resolve Laravel tenant bootstrap before
rendering, matching the custom-domain path's tenant-data availability and
preventing omitted default-off feature flags from leaking page cards. The first
route-level gate slice now also blocks tenant-context Marketplace, Courses,
Podcasts, Coupons, and Premium paths with `403` when their Laravel feature flags
are absent or false. The next route-level gate slice blocks disabled core
tenant prefixes for Laravel matrix-declared `module:` and `feature:` gates
across dashboard, feed, listings/exchanges/matches, events, volunteering/
organisations, members/connections, messages, wallet, notifications,
gamification, blog, AI chat, federation, goals, groups, group exchanges,
ideation, jobs, polls, resources, reviews, and search. Route declarations still
do not prove every route-specific workflow-disabled response. Maps,
organisation jobs, and group-message connection gates now have focused
middleware proof. Message translation policy now has focused shared-mount
render/action proof for disabled tenants, the Clubs route now has route-level
active-club 404 proof, Explore-card active-club sourcing now has
Laravel-backed route-level proof, and listing exchange-request GET/POST now
pre-check Laravel exchange config and redirect with `status=exchange-disabled`
when broker workflow is disabled. Live disabled-tenant Laravel fixture proof
for broker workflow remains unproven.
Organisation source templates now also use `urlFor()` for directory, browse,
detail, jobs, manage, register, volunteering-opportunity, and apply local
links/forms.
Blog source templates now also use `urlFor()` for index search, post links,
pagination, detail/discussion/liker links, member links, and blog
comment/reaction forms.
Blog route-level redirects now also use `res.locals.urlFor` for signed-out
discussion/liker/comment/reaction handoffs and blog POST result redirects,
keeping blog workflow redirects inside the active shared accessible mount.
Course source templates now also use `urlFor()` for course tabs, browse/search,
course/prerequisite/certificate/learning links, review/enrolment/quiz/progress
forms, instructor builder links/forms, publish/delete controls, and grading
forms. Course route-level auth, validation, success, and API-error redirects now
also resolve through `res.locals.urlFor`.
Listing index/form source templates now also use `urlFor()` for listing
breadcrumbs, browse filters, clear/create CTAs, row detail/edit/delete
controls, pagination, empty-state CTAs, create/edit form action, and cancel
link. The listing exchange-request template now also routes its back link and
Laravel canonical `POST /listings/{id}/exchange-request` form action through
`urlFor()`, with focused source and tenant-mounted render coverage proving the
page remains under `/acme/accessible/listings/...` when served from a shared
tenant mount. Listing analytics, comments, and report templates now also route
their back links and GET/POST form actions through `urlFor()`, with focused
source coverage guarding against raw `/listings` template targets returning.
A scoped Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6621` passed report/comments body markers and the expected
signed analytics `403` for this auxiliary slice.
Events index/create/edit source templates now also use `urlFor()` for the
event list create CTA, search form, event and group links, pagination,
empty-state actions, create/edit form actions, breadcrumbs, back links, and
cancel links.
Event route-level redirects now also use `res.locals.urlFor` for unsigned
handoffs, waitlist/check-in/poll/recurring/translation outcomes, create/edit
status redirects, cancel/delete results, and RSVP results, keeping event
workflow redirects inside shared tenant mounts and custom-domain child paths.
Resource source templates now also use `urlFor()` for simple browse, full
library, upload, delete confirmation, discussion, reaction, comment, reorder,
category, search, and pagination links/forms.
Search source templates now also use `urlFor()` for simple search, advanced
search, saved-search delete, result tabs, result links, empty-state CTAs,
pagination base URL, and saved-search forms.
Saved item, collection, and saved social source templates now also use
`urlFor()` for saved filters, item links, bookmark removal, collection
list/detail links, pagination, collection CRUD forms, public collection links,
and appreciation send/react controls.
Saved collection and saved social route-level redirects now also use
`res.locals.urlFor` for auth handoffs, saved item removal, collection
create/update/delete/item-remove outcomes, appreciation send outcomes, and
appreciation reaction anchors, keeping those Laravel named-route equivalents
inside shared tenant mounts and custom-domain contexts.
Jobs source templates now also use `urlFor()` for jobs tabs, browse filters,
saved/application/owner links, alerts, responses, detail actions, employer
pages, talent search/profile links, CSV/CV downloads, pagination, and job POST
forms. Jobs route-level redirects now also use `res.locals.urlFor` for
create/update/delete/renew/apply/save/unsave, application status/withdrawal,
alert create/pause/resume/delete, interview accept/decline, offer
accept/reject, and owner CSV failure outcomes, keeping Jobs workflows inside
shared tenant mounts and custom-domain contexts.
Member source templates now also use `urlFor()` for member directory search,
clear, profile, connection, response, and pagination controls; discovery and
nearby filter navigation, forms, profile links, and load-more links; and
member-insights profile back links. Focused Laravel runtime smoke for the
members source slice passed against Laravel `http://127.0.0.1:8088`, covering
signed `/members`, `/members/discover`, `/members/nearby`, and
`/members/77/insights` module renders and body markers.
Podcast source templates now also use `urlFor()` for podcast browse/studio
links, search form, show and episode links, subscribe form, create/edit form
actions, episode publish/delete/upload forms, show publish/delete forms, and
studio management links. Focused Laravel runtime smoke for the podcast source
slice passed against Laravel `http://127.0.0.1:8088`, covering signed
`/podcasts`, `/podcasts/studio`, and `/podcasts/studio/new`. Podcast action
redirects now also use `res.locals.urlFor` for subscribe, studio show, and
episode POST outcomes, so the Laravel named-route equivalents stay behind the
active shared tenant mount or custom-domain path. Podcast page auth redirects
now also use `res.locals.urlFor` for signed-out and Laravel-401 handoffs, with
shared-mount coverage proving `/acme/accessible/podcasts` redirects to
`/acme/accessible/login?status=auth-required` before any Laravel podcast API
call.
Feed source templates now also use `urlFor()` for feed compose/filter forms,
hashtag links, post and item permalink links, like/comment/not-interested
forms, author and group links, pagination, sign-in CTAs, `nextHref`, and
internal deep links. Feed index normalization now accepts Laravel `author`
post rows as well as the older local `user` row shape. Focused Laravel runtime
smoke for the feed source slice passed against Laravel
`http://127.0.0.1:8088`, covering signed `/feed`, `/feed/hashtags`,
`/feed/hashtag/timebank`, `/feed/posts/796`, and `/feed/item/listing/42`.
Feed action redirects now also use `res.locals.urlFor` for POST result
destinations, with shared-mount coverage proving validation redirects stay
under `/acme/accessible/feed`.
Knowledge-base source templates now also use `urlFor()` for the public `/kb`
search form, article links, cursor load-more link, article back link, and
related-article links, with source regression coverage and focused render
tests. This is source-level helper coverage only; it does not newly certify
tenant feature gates, localization, runtime persistence, or ASP.NET backend
compatibility.
The unmounted legacy `src/views/knowledge-base` compatibility templates now
also use `urlFor()` for local article, breadcrumb, back-link, and pagination
targets. This keeps stale source tenant-safe without changing the Laravel route
matrix, where the source-of-truth knowledge-base paths remain `/kb` and
`/kb/{param}`.
Dashboard source templates now also use `urlFor()` for onboarding,
exchange-attention, create-listing, upcoming-event, quick-link, recent-feed,
and recent-listing links, with source regression coverage, focused render
tests, and scoped Laravel runtime smoke for signed `/dashboard`. This does not
newly certify dashboard feature gates, localization, runtime persistence, or
ASP.NET backend compatibility.
Goals source templates now also use `urlFor()` for browse/detail links,
template filters and use forms, discover/buddying controls, edit/delete
forms, check-in/reminder/buddy-action forms, history/insights links, and
social like/comment/reply/delete controls, with source regression coverage and
focused render tests. Goals route-level redirects now also use
`res.locals.urlFor` for auth handoffs, create/template/delete/buddy/progress/
complete/check-in/reminder/buddy-action/like/comment outcomes, and Laravel-401
fallbacks, with focused shared-mount coverage proving goal POST redirects stay
inside `/{tenantSlug}/accessible`. This does not newly certify goals feature
gates, localization, runtime persistence, or ASP.NET backend compatibility.
Exchange source templates now also use `urlFor()` for list filter tabs,
exchange detail links, pagination, listing and message links, action forms,
and rating form controls, with source regression coverage and focused render
tests plus scoped Laravel runtime smoke for signed `/exchanges`. Exchange
action and rating POST result redirects now also use `res.locals.urlFor`, with
focused shared-mount coverage proving `/acme/accessible/exchanges/{id}` POSTs
redirect back under the active tenant mount. This does not newly certify
exchange feature/module gates, participant authorization edges, localization,
broader runtime persistence, or ASP.NET backend compatibility.
Public coupon source templates now also use `urlFor()` for list/detail coupon
links, and route-level coupon auth redirects now use `res.locals.urlFor` under
shared tenant mounts and custom-domain contexts. Focused coverage includes
source regression, shared-mount redirect tests, focused render tests, and scoped
Laravel runtime smoke proving the current local fixture's expected `403`
merchant-coupons feature gate. This does not newly certify rendered coupon body
parity in a merchant-coupons-enabled tenant, localization, QR redemption
workflows, runtime persistence, or ASP.NET backend compatibility.
AI chat and matches source templates now also use `urlFor()` for AI chat
back/conversation/new-conversation links, chat form actions, matches filters,
board links, listing/group/event links, dismiss forms, empty-state CTAs, and
back links, with source regression coverage, focused render tests, and scoped
Laravel runtime smoke for signed `/chat`, `/matches`, and `/matches/board`.
The old unmounted `src/views/chat/index.njk` template has also been removed,
so source audits now see only the mounted tenant-aware `src/views/ai-chat/index.njk`
view for Laravel's `/chat` rows.
This does not newly certify full visual Blade parity, localization,
recommendation persistence depth, or ASP.NET backend compatibility.
Federation hub source templates now also use `urlFor()` for the hub service
navigation, opt-in/opt-out CTAs, partner preview links, view-all partners link,
and quick links, with source regression coverage, focused render tests, and
scoped Laravel runtime smoke for signed `/federation`. This does not newly
certify cross-tenant discovery depth, tenant federation policy, localization,
runtime persistence, or ASP.NET backend compatibility.
Federation onboarding source templates now also use `urlFor()` for the wizard
back link, service navigation, step form actions, step-back links, and
do-this-later links, with source regression coverage, focused render tests, and
scoped Laravel runtime smoke for signed `/federation/onboarding`. This does not
newly certify exact Laravel session persistence, tenant federation policy,
localization, runtime persistence, or ASP.NET backend compatibility.
Federation route-level redirects now also use `res.locals.urlFor` for
signed-out GET handoffs, opt-in/settings shortcuts, and invalid/empty
conversation fallbacks, with focused shared-mount coverage proving
`/acme/accessible/federation` redirects to the tenant-mounted login path. This
does not newly certify federation policy gates, cross-tenant persistence,
localization, or ASP.NET backend compatibility.
Federation browse/messaging/settings/transfer templates now also use
`urlFor()` for connections, conversations, events, groups, listings, member
browse, messages, opt-in/out, partner list/detail, settings, and transfer
links/forms. Federation POST action redirects now use `res.locals.urlFor` for
connection, message, translation, transfer, onboarding, opt-in/out, and settings
outcomes. Focused source and render/action coverage protects those helper
conversions. A targeted Laravel runtime smoke on 2026-07-09 against Web UK
`127.0.0.1:5180` and Laravel `127.0.0.1:8088` passed `19/19` checks covering
auth/cookie/logout setup, signed federation pages, and body markers for
connections, messages, settings, and transfer; broader federation runtime
behavior, tenant policy, localization, and ASP.NET backend compatibility are
not certified.
Tenant-mounted roots now render the Laravel Blade-style tenant home rather than
the old generic Web UK welcome page. The shared `/{tenantSlug}/accessible` root
uses Laravel tenant bootstrap and tenant-scoped public platform stats for the
community caption, tenant tagline, stat grid, and module availability cards,
while dedicated custom-domain roots reuse the same page with slugless links.
Shared-host tenant stats are requested with `X-Tenant-Slug`; custom-domain
stats are requested with the resolved Host and Origin, matching Laravel's
path-resolved and host-resolved tenant contexts.
Parent-domain child tenant routing now has a focused Web UK Jest slice: a
non-local parent host plus `/{childSlug}/login` resolves `{childSlug}` through
Laravel tenant bootstrap, requires returned `parent_domain` to match the host,
serves the flat accessible login page below `/{childSlug}`, and rewrites local
form/link targets under that child path without exposing `/alpha` or
`/accessible`. The reserved child-segment set now matches Laravel
`TenantContext::getReservedPaths()` exactly, with automated source coverage in
`tests/tenant-routing-source.test.js`, so Laravel-reserved paths such as
`/classic` stay parent-host routes while Laravel-unreserved names such as
`/courses` can still resolve as child tenant slugs. Direct live Laravel
bootstrap and Web UK middleware harness proof
for `timebank.global` and `project-nexus.ie` is green. A follow-up full
temporary Web UK process smoke fixed the earlier chooser fallback by suppressing
the process default `X-Tenant-ID` on host-scoped Host/Origin API calls, then
passed `timebank.global|/=>Exchange Skills Across Borders`.
Custom-domain requests for the matched tenant's legacy
`/{tenantSlug}/alpha/...` prefix or Web UK's shared
`/{tenantSlug}/accessible/...` prefix now canonicalize to the slugless
custom-domain path, matching Laravel's accessible-domain response behavior
while keeping `/accessible` only as the shared-host public mount.

The legacy local two-factor POST alias has been removed: POST `/verify-2fa` is
no longer exposed. Laravel's accessible source uses GET/POST
`/login/two-factor`, and the local two-factor challenge form now submits to
that canonical route.

The legacy local review edit and target-specific route family has been removed:
GET/POST `/reviews/{id}/edit`, POST `/reviews/user/{id}`, and POST
`/reviews/listing/{id}` are no longer exposed. Laravel's accessible source uses
POST `/members/{id}/review` for profile reviews and POST `/reviews` for pending
exchange reviews; listing detail pages do not expose a listing-specific review
submission route. The reviews family now reports `7` matched routes, `0`
missing routes, and `0` extra local routes.

The legacy local generic reports route family has been removed: GET
`/reports/new`, POST `/reports/new`, and GET `/reports/my` are no longer
exposed. Laravel's accessible route set uses dedicated report surfaces such as
`/listings/{id}/report` plus the support-report `/report-a-problem` flow, so
generic report links now point to those Laravel-backed paths. The reports
family now reports `0` matched routes, `0` missing routes, and `0` extra local
routes.

The legacy local search suggestions helper route has been removed: GET
`/search/suggestions` is no longer exposed as an accessible frontend route.
Laravel exposes suggestions under the API surface, not in the `govuk-alpha`
route set. The search family now reports `6` matched routes, `0` missing
routes, and `0` extra local routes.

The legacy local member connection route has been removed: POST
`/members/{id}/connect` is no longer exposed. Laravel's accessible source uses
POST `/members/{id}/connection` with an action field for connection state
transitions, and local member index/profile controls now submit that canonical
route with `action=connect`. The members family now reports `11` matched
routes, `0` missing routes, and `0` extra local routes.

The legacy local listing delete confirmation route has been removed: GET
`/listings/{id}/delete` is no longer exposed. Listing index/detail owner
controls submit Laravel's canonical POST `/listings/{id}/delete` action
directly, and local listing dynamic routes now preserve Laravel numeric
constraints. The listings family now reports `19` matched routes, `0` missing
routes, and `0` extra local routes.

The legacy local group member-management route family has been removed:
GET `/groups/my`, GET `/groups/{id}/members`, POST `/groups/{id}/members/add`,
POST `/groups/{id}/members/{memberId}/remove`,
POST `/groups/{id}/members/{memberId}/role`, and
POST `/groups/{id}/transfer-ownership` are no longer exposed. Group list,
detail, and feed-sidebar links now use Laravel's accessible `/groups` and
`/groups/{id}/manage` surfaces, while canonical member actions remain on
POST `/groups/{id}/members/{memberId}`. The groups family now reports `36`
matched routes, `0` missing routes, and `0` extra local routes.

Group index, create, edit, and legacy my-groups source templates now also use
`urlFor()` for group list create CTA, search and clear controls, group card
links, pagination base URL, create/edit form actions, breadcrumbs, back links,
cancel links, and legacy my-groups source controls.
Group announcement and file source templates now also use `urlFor()` for
announcement edit/pin/delete/create controls, file download/delete/upload
controls, and group back links. Volunteering recommended-shifts source links
now use `urlFor()` for the volunteering back link and opportunity links. Group
discussion, invite, image, notification, and manage source templates now also
use `urlFor()` for their local group/member links and form actions, and group
route-level redirects now resolve through `res.locals.urlFor` for shared
tenant mounts and custom-domain child paths. A scoped Laravel runtime smoke
against temporary Web UK `http://127.0.0.1:6611`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `22/22` checks for base
auth/cookie/logout plus `/groups/484/invite`, `/groups/484/notifications`,
`/groups/484/image`, `/groups/484/manage`, `/groups/484/discussions`, and
`/groups/484/discussions/new` module/body markers.
The public volunteering landing/search and opportunity detail source templates
now also use `urlFor()` for volunteering filters, organisation links,
opportunity cards, load-more links, and apply CTAs; volunteering action
redirects now pass through `res.locals.urlFor` for auth, validation, success,
and API-failure destinations.

The legacy local event RSVP routes are retained only as explicit `404`
tombstones: GET `/events/my` and POST `/events/{id}/rsvp/remove` expose no
workflow. Event list pages no longer
link to the separate My events page, and event detail pages keep Laravel's
canonical POST `/events/{id}/rsvp` action for RSVP state changes. The event
family now reports `88` matched routes, `6` missing routes, and `2` deliberate
legacy tombstones.

The legacy local GET/POST `/messages/new` route without a member id has been
removed. Laravel's accessible direct-message entry points use
`/messages/new/{userId}` and `/messages/{userId}` with numeric route
constraints, and generated preparation pages now preserve Laravel
`whereNumber(...)` constraints.

The legacy local feed post route family has also been removed: GET/POST
`/feed/new`, GET `/feed/{id}`, GET/POST `/feed/{id}/edit`, and the old
`/feed/{id}/like|unlike|comments|delete` action shapes are no longer exposed.
The feed hub now uses Laravel's accessible `/feed/posts` compose action,
`/feed/posts/{id}` permalink, and typed `/feed/items/post/{id}/like` action
shape.

The legacy local GET-only `/wallet/transactions`, `/wallet/transactions/{id}`,
and `/wallet/transfer` routes have been removed. Laravel's accessible wallet
source keeps transaction history and transfer UI on `/wallet` plus
`/wallet/manage`, with POST `/wallet/transfer` remaining canonical for
submissions. Wallet index/manage local links and form actions now route through
the tenant-aware `urlFor()` helper with source regression coverage.

The legacy local GET/POST `/profile/edit` routes have been removed. Laravel's
accessible profile source uses `/profile/settings`, and local profile summary
change links now use that canonical page.

The legacy local `/progress`, `/progress/badges`, `/progress/leaderboard`, and
`/progress/xp-history` routes have been removed. Laravel's accessible
gamification source uses `/achievements`, `/leaderboard`, and `/nexus-score`
route families, and local profile links now use those canonical paths.

The legacy local `/settings`, `/settings/notifications`, `/settings/password`,
and `/settings/privacy` routes have been removed. Laravel's accessible settings
source uses `/profile/settings` as the profile/security/notification/privacy
hub, plus specific parity routes for appearance, data rights, availability,
linked accounts, and insurance.

The legacy local `/connections/pending` route has been removed. Pending
connection entry points now link to Laravel's accessible `/connections/network`
page with `tab=pending_received`.

The local `/components` demo route has been removed. The Laravel accessible
source keeps GOV.UK component inventory in docs/source assets rather than
publishing a component-demo route.

The legacy local top-level `/terms` and `/privacy` routes have been removed.
Legal documents now expose Laravel's accessible `/legal/terms` and
`/legal/privacy` route shapes only.

The legacy local top-level `/forgot-password` and `/reset-password` routes
have been removed for both GET and POST. The accessible auth flow now exposes
Laravel's `/login/forgot-password` and `/password/reset` paths, and the login
page links to `/login/forgot-password`.

The legacy local `GET /logout` route has been removed from `apps/web-uk`, so
the logout family now has one exact POST match and `0` extra local logout
routes, matching Laravel's CSRF-protected POST-only logout declaration.

The legacy local `/admin` route family has been removed from `apps/web-uk`:
GET `/admin`, admin category/config/moderation/role/user pages, and their local
POST actions are no longer exposed. Laravel's scanned GOV.UK accessible route
set does not expose an untenanted `/admin` family; admin-only workflows
remain on their canonical module routes, such as `/jobs/bias-audit`. The local
jobs bias-audit page no longer links back to the removed `/admin` surface.

The route-matrix generator now separates local infrastructure helpers from
true extra accessible route declarations. `GET /health`,
`GET /service-unavailable`, and `POST /session/touch` remain available for
health checks, error rendering, and session keep-alive behavior, but they are
classified as ignored infrastructure rather than route parity gaps.

The consolidated exchange-request aliases have been resolved for literal
Laravel route identity: local `GET /exchanges/request/{param}` and
`POST /exchanges/request/{param}` were removed, while Laravel's canonical
`GET/POST /listings/{param}/exchange-request` flow remains implemented and
tested.

## Runtime Smoke Evidence

The command below is stateful because it includes authentication. Run it only
against a separately provisioned and verified disposable Laravel environment;
never use the ordinary `127.0.0.1:8088` production-derived snapshot.

```bash
npm run smoke:laravel
```

This uses `scripts/laravel-runtime-smoke.js` to verify local Laravel API
reachability, web-uk health, unsigned protected redirects, login CSRF handling,
login POST redirect behavior, signed `/account` rendering, and the default
public Laravel-backed module pages `/volunteering`, `/organisations`,
`/organisations/browse`, `/kb`, and `/help`. After the login flow, it also
checks signed public auth aliases (`/login`, `/login/forgot-password`,
`/password/reset?token=reset-token`, `/register`) plus the broad signed module
set across explore, saved items, notifications, members, resources, goals,
marketplace, volunteering, and other Laravel accessible families. Before login,
it also checks 12 matched auth-required parameterised pages across federation,
ideation, organisations, podcasts, resources, public user collections,
marketplace slot edit, saved collections, saved-search delete, and volunteering
certificate download redirect to `/login?status=auth-required`. A Jest regression test
covers the harness with fake Laravel/web-uk servers:

```bash
npm test -- --runInBand tests/laravel-runtime-smoke.test.js
```

Current local evidence from 2026-07-08: chunked Laravel runtime smoke passed
against Laravel `http://127.0.0.1:8088` and a temporary Web UK process at
`WEB_UK_BASE_URL=http://127.0.0.1:6310`, started with
`ACCESSIBLE_BACKEND_TARGET=laravel` and `TENANT_ID=2`. The base smoke pass
covered Laravel API reachability, Web UK health, unsigned `/account`, no-JS
cookie consent/settings POST flows, login/logout, content-type checks, signed
gated statuses, and signed redirects. The module sweep passed across
`SMOKE_MODULE_PAGE_CHUNK=1/8` through `8/8`, covering 279 module-page checks.
The body-text sweep passed across `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8` through
`8/8`, covering 283 body-text checks. `SMOKE_TIMEOUT_MS=240000` was used for
slow live Laravel pages. During that recertification, signed
`/feed/item/listing/{id}` was fixed to refresh an expired access token via the
existing refresh cookie, and the root body marker was updated to the tenant
chooser text `Choose a community`.

Focused tenant-home evidence from 2026-07-08: a scoped live Laravel smoke
against temporary Web UK `http://127.0.0.1:6330`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed the base Laravel API, Web UK
health, cookie, login, account, and logout checks plus these body markers:
`/hour-timebank/accessible=>Accessible`,
`/hour-timebank/accessible=>Connecting Communities`, and
`/hour-timebank/accessible=>What you can do`. The same slice also passed full
Web UK Jest (`697/697`), lint, and route matrix (`608/608` matched, `0`
missing, `0` extra Web UK routes).

Focused group/course evidence from 2026-07-08: a targeted Laravel-backed smoke
against temporary Web UK `http://127.0.0.1:6350`, Laravel
`http://127.0.0.1:8091`, and `TENANT_ID=2` passed `16/16` checks. It covered
base Laravel API/Web UK health, cookie POSTs, login/account/logout, module page
renders for `/groups/484`, `/courses/1`, and `/courses/2`, and body markers
`/groups/484=>Group events`, `/courses/1=>Ratings and reviews`, and
`/courses/2=>Ratings and reviews`. This is focused runtime proof for the
current group/course Laravel fallback slice, not a substitute for the full
chunked recertification.

Earlier local evidence from 2026-07-07: the harness passes end-to-end when
web-uk is started with Laravel tenant context `TENANT_ID=2`, using the local E2E
fixture credentials (`e2e.user.a@project-nexus.local` /
`TestPassword123!` / `hour-timebank`) and `SMOKE_TIMEOUT_MS=60000`. Without
that tenant context, Laravel rejects the same valid credentials because the
login request is scoped to the wrong tenant.
The smoke confirms the default public module pages, signed public auth aliases,
broad signed module-page scope, expected signed gated statuses, and expected
signed redirect statuses through web-uk while it is pointed at Laravel; it does
not certify deeper POST workflows, tenant-domain aliases, localization, or
ASP.NET backend switching. The latest live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5308` passed `172/172`: 6 auth/health checks,
161 module/page checks, 3 gated-status checks, and 2 redirect-status checks.
The `/login/two-factor` expired-session redirect is now in scope too; a later
run against `WEB_UK_BASE_URL=http://127.0.0.1:5309` passed `173/173`: 6
auth/health checks, 161 module/page checks, 3 gated-status checks, and 3
redirect-status checks.
The default smoke scope now covers 12 matched unsigned auth-required
parameterised redirects. An earlier full default Laravel-backed run against a temporary
web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:5322`, started with
`TENANT_ID=2`, passed on 2026-07-07: `181/181` checks, `0` failures, `161`
module-page checks, 8 unsigned auth-required redirect checks, 3 gated-status
checks, and 3 signed redirect checks in 352.8 seconds.
For targeted CLI runs, `SMOKE_MODULE_PAGE_PATHS`,
`SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS`, `SMOKE_GATED_PAGE_PATHS`, and
`SMOKE_REDIRECT_PAGE_PATHS` accept comma/newline-separated lists, and the
portable sentinel `none` disables that group. A targeted live CLI run against
`WEB_UK_BASE_URL=http://127.0.0.1:5317` with those three variables set to
`none` passed `14/14`, including all eight auth-required parameterised
redirects. For slower shells, `SMOKE_MODULE_PAGE_CHUNK=N/M` shards the
module-page portion and `SMOKE_BODY_TEXT_PAGE_CHUNK=N/M` shards the body-text
portion of the default sweep using one-based deterministic chunks, for example
`SMOKE_MODULE_PAGE_CHUNK=1/4` or `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8`, while the
auth, unsigned auth-required, gated, and redirect checks continue to run unless
their own groups are set to `none`.
All 16 chunked live runs against `WEB_UK_BASE_URL=http://127.0.0.1:5321` with
`TENANT_ID=2` and `SMOKE_MODULE_PAGE_CHUNK=N/16` passed on 2026-07-07:
`481` total repeated checks, `0` failures, and `161` collective module-page
checks across the default sweep. Each shard also reran the auth/API setup,
unsigned auth-required redirects, gated status checks, and signed redirect
checks.
A targeted real-fixture parameterised live run against
`WEB_UK_BASE_URL=http://127.0.0.1:5325`, started with `TENANT_ID=2`, passed on
2026-07-07: `24/24` checks, `0` failures, with 6 auth/health checks and 18
module-page checks. The smoke covered event detail/depth (`/events/6`,
`/events/6/map`, `/events/6/polls`, `/events/6/translate`), volunteering
opportunity detail (`/volunteering/opportunities/307`), organisation
detail/jobs/apply (`/organisations/636`, `/organisations/636/jobs`,
`/organisations/opportunities/307/apply`), job detail (`/jobs/90764`), group
detail/depth (`/groups/484`, `/groups/484/invite`,
`/groups/484/notifications`, `/groups/484/image`,
`/groups/484/announcements`, `/groups/484/discussions`, `/groups/484/files`,
`/groups/484/manage`), and resource comments (`/resources/10/comments`). This
run also proves the current event and group detail handlers use Laravel v2
detail payloads from `/api/v2/events/{id}` and `/api/v2/groups/{id}` without
leaking the `{ data: ... }` wrapper into templates.
Those 18 stable fixture-backed pages are now part of the default smoke scope.
The default scope also covers `/groups/484/discussions/new`,
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
default Laravel-backed run against a temporary web-uk process at
`WEB_UK_BASE_URL=http://127.0.0.1:5336`, started with `TENANT_ID=2`, passed on
2026-07-07: `247/247` checks, `0` failures, `210` module-page checks, 8
unsigned auth-required redirect checks, 13 gated-status checks, and 10 signed
redirect checks; `npm run smoke:laravel`
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
A focused search source-helper smoke on 2026-07-09 against temporary
in-process Web UK `http://127.0.0.1:56338`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `13/13` checks: the base
API/health, cookie, login, account, and logout checks plus signed
`/search/advanced?q=garden` module rendering and body markers `Advanced search`
and `Save this search`.
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
A follow-up focused saved source-helper smoke on 2026-07-09 against temporary
in-process Web UK `http://127.0.0.1:50823`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed `16/16` checks: the base
API/health, cookie, login, account, and logout checks plus signed `/saved`,
`/me/collections`, and `/users/14/appreciations` module rendering and body
markers `Saved items`, `My collections`, and `Appreciation`.
The default scope now contains `633` checks:
`280`
module-page checks, 14 unsigned auth-required redirect checks, 3 unsigned login
redirect checks, 23 gated-status checks, and 19 signed redirect checks, plus 2
content-type contract checks, 282 body-text contract checks, 3 cookie-consent
POST workflow checks, 1 logout POST workflow check, and the 6 auth/health
checks.
Parameterised matched GET route shapes without default runtime smoke coverage
fell from 28 to 0.

## Header And Footer Contract

| Blade link | Laravel path | `apps/web-uk` path | Current Web UK status |
| --- | --- | --- | --- |
| Brand | `/` or `/{tenantSlug}/accessible` | `/` | Implemented local equivalent. `/alpha` is legacy redirect compatibility only. |
| My account | `/account` | `/account` | Partial Blade-style candidate: unsigned users redirect to `/login`; signed-in users see local wallet, messages, connections, notifications, profile, and settings cards plus CSRF sign-out. Account card links and the CSRF-protected logout form action now pass through the tenant-aware `urlFor()` helper, with a source-level regression guarding against literal root-relative account hub links/forms returning to the template. The default Laravel runtime smoke now verifies POST `/logout` redirects to `/login` and clears the signed account session; a targeted live run against `WEB_UK_BASE_URL=http://127.0.0.1:6243` with `TENANT_ID=2` passed this on 2026-07-08. Notification group-read/delete-all, wallet donate/manage/recipients/export, saved-item removal, saved-collection CRUD/item-remove, match-dismiss, appreciation send/react, onboarding step, settings, message group GET pages, and message POST aliases call Laravel-compatible endpoints. Saved item, collection, and saved social source templates now use `urlFor()` for tenant-aware links/forms, with focused render tests and Laravel runtime smoke. Laravel feature gating, full account-link coverage, backend data, tenant routing, realtime behavior, and ASP.NET backend compatibility are not complete. |
| Home | `/` | `/` | Implemented local equivalent. |
| Dashboard | `/dashboard` | `/dashboard` | Partial Laravel-backed candidate: signed GET redirects unsigned visitors to `/login`, calls Laravel-compatible profile, onboarding status, wallet balance, gamification profile, badges, listings, feed, member events, `/api/v2/exchanges/needs-attention-count`, and `/api/v2/members/{id}/endorsements` helpers, and renders Blade-style dashboard caption, welcome copy, onboarding banner, exchange-attention banner, create-listing CTA, time-bank stat grid, progress/badges, upcoming events, skill endorsements, quick links, and recent feed/listings. Dashboard local links for onboarding, exchanges, listing create/detail, events, profile, feed, messages, members, and volunteering now route through `urlFor()` with source regression, focused render coverage, and scoped Laravel runtime smoke for signed `/dashboard`. Tenant/module/feature gates, exact localization, broader runtime behavior against a live Laravel backend, and ASP.NET backend compatibility are not certified. |
| Feed | `/feed`, `/feed/posts/{id}`, `/feed/item/{type}/{id}`, `/feed/hashtags`, `/feed/hashtag/{tag}` | `/feed`, `/feed/posts/:id`, `/feed/item/:type/:id`, `/feed/hashtags`, `/feed/hashtag/:tag` | Implemented local route with Laravel-compatible POST aliases for post create/update/delete, multipart post image upload, typed engagement, poll votes, moderation/report/share/save, comment mutation/reactions, and mute; the signed feed page now exposes the Blade-style multipart compose controls for image and alt text and links/submits to Laravel-shaped `/feed/posts/{id}` and `/feed/items/post/{id}/like` routes rather than legacy `/feed/new` or `/feed/{id}` routes. Public GET `/feed/posts/{id}` calls Laravel-compatible `/api/v2/feed/posts/{id}` and renders the Blade-style permalink page. Public GET `/feed/item/{type}/{id}` calls Laravel-compatible `/api/v2/feed/items/{type}/{id}` and renders the Blade-style typed-item permalink with item-type tag, deep link where available, media, engagement counts, auth notice, and comments section. Public GET `/feed/hashtags` calls Laravel-compatible hashtag trending/search APIs, and public GET `/feed/hashtag/{tag}` calls `/api/v2/feed/hashtags/{tag}` for the Blade-style hashtag post list. Full Blade feed rendering, filters, exact offset pagination, signed reaction/share/save/comment UI depth, feature gates, tenant behavior, and runtime behavior are not certified. |
| Listings | `/listings` | `/listings` | Laravel v2-backed candidate. Core create/update/delete use exact `POST /api/v2/listings`, `PUT /api/v2/listings/{id}`, and `DELETE /api/v2/listings/{id}` contracts with the seven canonical core fields and no client-owned create status. List/detail/edit unwrap v2 envelopes and enforce owner edit access. Create/edit apply routed tenant `listing_config`, load tenant listing categories, map nested validation errors, and persist enabled tags plus multipart cover images through their separate v2 endpoints after core persistence. Auth/onboarding/result redirects remain tenant-aware. Existing aliases also cover save/unsave, renew, report, like, comments/replies, exchange requests, analytics, and AI description generation. Focused mock-backed helper/route/template coverage passed; no live mutation/delete was run. Exact Blade markup, live persistence/side effects, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Members | `/members`, `/members/discover`, `/members/nearby`, `/members/{id}/insights` | `/members`, `/members/discover`, `/members/nearby`, `/members/:id/insights` | Implemented local route with profile-action POST aliases for connection, endorsement, block/unblock, review, and transfer wired to Laravel v2 endpoints. Signed GET `/members/discover` calls Laravel-compatible `/api/v2/users?sort=communityrank` and renders the Blade-style recommended-members page with filter navigation, search, recommendation score, member cards, and load-more link. Signed GET `/members/nearby` reads the signed-in profile location, calls Laravel-compatible `/api/v2/members/nearby`, and renders the Blade-style radius search page with no-location guidance, distance cards, and load-more link. Signed GET `/members/{id}/insights` calls Laravel-compatible `/api/v2/users/{id}` and `/api/v2/users/{id}/verification-badges` plus the signed-in profile, then renders the Blade-style NEXUS score, activity stats, verification badges, and earned badges page. Member profile back links, message links, connection controls, hidden return URLs, and review form targets now use `urlFor()` with source regression coverage. Member action auth/status redirects now pass through `res.locals.urlFor` for tenant mounts. Blade profile rendering, base member directory parity, tenant guards, feature gates, and runtime behavior are not certified. |
| Events | `/events`, `/events/browse` | `/events`, `/events/browse` | Implemented local/protected route with a public Laravel-backed category browse page and Laravel-compatible POST aliases for waitlists, check-in, polls, recurring updates, translation requests, and create/edit cover image uploads through the Laravel v2 event image endpoint. Core create/update/cancel/delete now use the exact Laravel v2 contracts: `POST /api/v2/events`, `PUT /api/v2/events/{id}`, `POST /api/v2/events/{id}/cancel`, and `DELETE /api/v2/events/{id}`. Create/edit render and submit `start_time`/`end_time`, require description, unwrap Laravel's `data` event/ID envelope, replay field errors/values, and distinguish 400/403/404/409/422 plus onboarding/auth outcomes; cancel renders Blade's reason textarea and posts `{ reason }`. Event local links, forms, and redirects use tenant-aware `urlFor()` behavior. Focused mock-backed API/route/template coverage passes, including mounted onboarding/login redirects; no live destructive mutation was run. Full Blade list/detail rendering, live persistence and notification/XP effects, cover image removal, recurring series edit/display depth, tenant gates, localization, and broader runtime behavior are not certified. |
| Volunteering | `/volunteering`, `/volunteering/opportunities/{id}`, `/volunteering/opportunities/create`, `/volunteering/accessibility`, `/volunteering/certificates`, `/volunteering/certificates/{code}/download`, `/volunteering/credentials`, `/volunteering/hours`, `/volunteering/wellbeing`, `/volunteering/donations`, `/volunteering/expenses`, `/volunteering/emergency-alerts`, `/volunteering/group-signups`, `/volunteering/training`, `/volunteering/incidents`, `/volunteering/waitlist`, `/volunteering/swaps`, `/volunteering/my-organisations`, `/volunteering/recommended-shifts`, `/volunteering/organisations/{id}/dashboard`, `/volunteering/organisations/{id}/manage`, `/volunteering/organisations/{id}/settings`, `/volunteering/organisations/{id}/volunteers`, `/volunteering/organisations/{id}/wallet` | `/volunteering`, `/volunteering/opportunities/:id`, `/volunteering/opportunities/create`, `/volunteering/accessibility`, `/volunteering/certificates`, `/volunteering/certificates/:code/download`, `/volunteering/credentials`, `/volunteering/hours`, `/volunteering/wellbeing`, `/volunteering/donations`, `/volunteering/expenses`, `/volunteering/emergency-alerts`, `/volunteering/group-signups`, `/volunteering/training`, `/volunteering/incidents`, `/volunteering/waitlist`, `/volunteering/swaps`, `/volunteering/my-organisations`, `/volunteering/recommended-shifts`, `/volunteering/organisations/:id/dashboard`, `/volunteering/organisations/:id/manage`, `/volunteering/organisations/:id/settings`, `/volunteering/organisations/:id/volunteers`, `/volunteering/organisations/:id/wallet` | Partial Laravel-backed candidate: public landing/search GET renders Blade-style intro, organisation link, how-it-works inset, auth notice, filters, opportunity cards, and cursor load-more from `/api/v2/volunteering/opportunities`; detail GET renders `/api/v2/volunteering/opportunities/{id}` with public metadata, shifts, and safe apply link; signed opportunity-create GET reads `/api/v2/volunteering/my-organisations?per_page=50` and `/api/v2/categories?type=volunteering`, filters to approved/active owner-admin organisations, and renders the Blade-style create form and validation states; signed accessibility-needs GET reads `/api/v2/volunteering/accessibility-needs` and renders the Blade-style checkbox/detail/emergency-contact form; signed certificates GET reads `/api/v2/volunteering/certificates` and renders the Blade-style generate form, status banners, certificate cards, organisation hour breakdown, verification code, and download link; signed certificate download proves ownership via `/api/v2/volunteering/certificates` before streaming `/api/v2/volunteering/certificates/{code}/html`; signed credentials GET reads `/api/v2/volunteering/credentials` and renders the Blade-style upload form, status banners, type options, credential table, status tags, and delete forms; signed hours GET reads `/api/v2/volunteering/hours/summary`, `/api/v2/volunteering/hours`, `/api/v2/volunteering/applications`, and `/api/v2/volunteering/my-organisations` to render the Blade-style stats, log-hours form, and recent hour logs; signed wellbeing GET reads `/api/v2/volunteering/wellbeing` to render the Blade-style wellbeing score, burnout risk, stats, warnings, mood check-in, and recent check-ins; signed donations GET reads `/api/v2/volunteering/giving-days` and `/api/v2/volunteering/donations?per_page=20` to render the Blade-style fundraising stats, giving-day cards, donation history, and offline donation form; signed expenses GET reads `/api/v2/volunteering/expenses?per_page=50` and `/api/v2/volunteering/my-organisations?per_page=50` to render the Blade-style expense totals, submit-claim form, status banners, and claims table; signed emergency-alerts GET reads `/api/v2/volunteering/emergency-alerts` to render the Blade-style urgent request cards, priority/status tags, metadata summary lists, and response forms; signed group-signups GET reads `/api/v2/volunteering/group-reservations` to render Blade-style group reservation cards, member status table, leader add/remove member controls, cancel warning, and status banners; signed training/incidents GETs read `/api/v2/volunteering/training` and `/api/v2/volunteering/incidents` to render the Blade-style safeguarding tab navigation, training form/table, incident form/table, status tags, and confidentiality notice; signed waitlist/swaps GETs read `/api/v2/volunteering/my-waitlists`, `/api/v2/volunteering/swaps`, and `/api/v2/volunteering/shifts?limit=50` to render waitlist cards, leave forms, swap request form, sent/received swap cards, response controls, cancel controls, status tags, and banners; signed my-organisations/recommended-shifts GETs read `/api/v2/volunteering/my-organisations?per_page=20` and `/api/v2/volunteering/recommended-shifts?limit=15&min_score=20` to render the Blade-style role filter, organisation cards, dashboard links, pagination, recommended shift cards, match progress, applied tags, and opportunity links; signed organisation-owner GETs read `/api/v2/volunteering/organisations/{id}/stats`, `/applications`, `/hours/pending`, `/volunteers`, `/wallet`, `/wallet/transactions`, and `/organisations/{id}` to render dashboard stats, quick actions, management review cards, settings form, volunteers table, wallet forms, transactions, and status banners; POST aliases now cover member applications, hours, shifts, accessibility, certificates, waitlists, swaps, multipart credential upload/delete, wellbeing, donations, group reservations, expenses, safeguarding, opportunity create, and organisation owner actions through Laravel v2 volunteering APIs. Credential download, tenant/auth gates, feature gates, localization, and runtime behavior are not certified. |
| Explore | `/explore` | `/explore` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed-in visitors call Laravel `/api/v2/explore`, render the Blade Explore card list, and show listing/event live sections when returned. Explore auth-required redirects now route through `res.locals.urlFor`, so shared tenant mounts keep `/explore` auth handoffs under `/{tenantSlug}/accessible/login?status=auth-required`. The signed GET is covered by the default Laravel runtime smoke and default `Explore` body-marker contract check. Tenant feature gating, exact recent-listing source parity, clubs detection, localization, deeper runtime behavior, and ASP.NET backend compatibility are not certified. |
| Sign in and email auth | `/login`, `/login/forgot-password`, `/password/reset`, `/login/two-factor`, `/verify-email`, `/newsletter/unsubscribe` | `/login`, `/login/forgot-password`, `/password/reset`, `/login/two-factor`, `/verify-email`, `/newsletter/unsubscribe` | Partial Laravel-compatible candidate. Forgot-password, reset-password, two-factor, and resend-verification Laravel aliases route to local handlers. Signed-session `/login`, `/login/forgot-password`, `/password/reset?token=reset-token`, and `/register` render like Laravel; `/login/two-factor` redirects to `/login?status=two-factor-expired` when the pending 2FA session token is absent. POST `/login` now handles Laravel `requires_2fa` responses by storing `two_factor_token` in the web session and redirecting to `/login/two-factor`. `/verify-email` renders Blade-style missing, invalid, and success states and calls Laravel `/api/auth/verify-email` when a token is present. `/newsletter/unsubscribe` renders Blade-style missing, invalid, and success states and calls Laravel `/api/v2/newsletter/unsubscribe` when a token is present. Tenant-domain routing, localization, and runtime email-token behavior are not certified. |
| Register | `/register` | `/register` | Laravel-backed candidate. GET reads tenant registration policy and renders Blade-style open, closed, and invite-only states. POST sends the full validated registration payload to `POST /api/v2/auth/register` with mounted `X-Tenant-Slug` authority, maps Laravel error codes, retains only safe input, and redirects success to sign-in without automatic login. Focused mock and template-render coverage passed; a live POST is intentionally deferred because it creates a pending user and can send email. |
| Report a problem with this page | `/report-a-problem?return=...` | `/report-a-problem?return=...` | Partial Laravel-backed candidate. Signed-out visitors redirect to `/contact?problem_url=...`; signed-in visitors get a structured support report form that posts to Laravel `/api/v2/support/reports`. The shared report-link partial now routes listing-specific reports and generic report-problem return links through `urlFor()` with source regression coverage. |
| Cookies | `/cookies`, `/cookie-consent` POST | `/cookies`, `/cookie-consent` POST | Partial Blade-style candidate: banner renders before the skip link until `nexus_accessible_cookie_consent` is present, while legacy Laravel `nexus_alpha_cookie_consent` values are still accepted as a read-only dismissal fallback; settings page renders the analytics yes/no form; POST stores local `all` or `essential` values under the cleaner accessible cookie name. Cookie settings plus the banner `/cookies` links and `/cookie-consent` POST action now use `urlFor()` for tenant/custom-domain-aware no-JS controls. The default Laravel runtime smoke now verifies no-JS banner reject, banner accept, and settings-save analytics POSTs store the expected `nexus_accessible_cookie_consent` value and redirect to `/cookies` or `/cookies?status=saved`; a targeted live run against `WEB_UK_BASE_URL=http://127.0.0.1:6242` with `TENANT_ID=2` passed `9/9` checks on 2026-07-08. Laravel `cookie_consents` audit persistence, tenant scoping, localization, and ASP.NET backend compatibility are not certified. |

> **2026-07-12 credential-download correction:** this supersedes the older
> `credential download ... not certified` wording in both volunteering rows
> in this file. Web UK now exposes mounted GET
> `/volunteering/credentials/:id/download`, proxies Laravel GET
> `/api/v2/volunteering/credentials/{id}/download`, preserves safe binary
> headers, and passed a disposable upload/render/320px-axe/download-byte-match/
> delete/final-absence gate (`1/1`, `54.9s`). Tenant feature gates, manual AT,
> and ASP.NET compatibility remain open.

## Footer Column Contract

| Column | Blade links | `apps/web-uk` current status |
| --- | --- | --- |
| Platform | Listings, Members, Events, Volunteering, Blog | Listings/Members/Events implemented; Volunteering is a partial Laravel-backed landing/search/detail candidate with Laravel-backed POST aliases; Blog is a partial Laravel-backed listing/detail/discussion/likers candidate with Laravel-backed POST aliases. |
| Support | Help centre, Knowledge base, Trust and safety, Contact, About | Contact/About implemented. `/about` now renders Laravel's community intro, how-it-works list, values, contributor credits, open-source links, and CTA group. Help centre `/help` now calls Laravel `/api/v2/help/faqs` and renders Blade-style FAQ search, grouped accordions, empty/no-result states, and contact CTA. Help search, contact CTAs, and Trust and safety's community-guidelines link now route through `urlFor()`. Trust and safety `/trust-and-safety` now ports the Laravel Blade warning, section list, contact CTA, and community-guidelines link. Knowledge base `/kb` and `/kb/{id}` are Laravel-backed candidates through `/api/v2/kb`, `/api/v2/kb/search`, and `/api/v2/kb/{id}` with Blade-style search, article cards, cursor load-more, article body, and related links; the real `/kb` templates route local search, article, pagination, back, and related-article links through `urlFor()`. |
| Legal | Legal, Terms of service, Privacy policy, Community guidelines, Acceptable use, Cookie policy, Accessibility statement | `/legal`, `/accessibility`, and `/legal/{terms,privacy,cookies,community-guidelines,acceptable-use}` now render Blade-style pages. Legal documents call Laravel `/api/v2/legal/{type}` and fall back to the same GOV.UK-structured policy copy when no tenant document is published. Accessibility/legal-document fallback back and contact links now route through `urlFor()`. Legacy top-level `/terms` and `/privacy` no longer exist locally. |

## Explore Contract

| Blade Explore card | Laravel route | `apps/web-uk` path | Current Web UK status |
| --- | --- | --- | --- |
| Exchanges | `/exchanges`, `/exchanges/{id}` | `/exchanges`, `/exchanges/:id` | Partial Laravel-backed candidate: signed GET pages call Laravel `/api/v2/exchanges/config`, `/api/v2/exchanges`, `/api/v2/exchanges/{id}`, and `/api/v2/exchanges/{id}/ratings` for completed exchanges, then render Blade-style tabs, exchange cards, detail summary, member link, role-appropriate no-JS actions, review form, ratings, and timeline. Exchange list/detail source templates now route filter tabs, detail links, pagination, listing/message links, exchange action forms, and rating form controls through `urlFor()` with source regression, focused render coverage, and scoped Laravel runtime smoke for signed `/exchanges`; exchange action/rating POST redirects now route through `res.locals.urlFor` with focused shared-mount coverage. Feature/module gates, exact authorization edge cases, localization, workflow side effects, broader tenant behavior, and full runtime smoke tests are not certified. |
| AI assistant | `/chat` | `/chat` | Partial Laravel-backed candidate: signed GET renders the Blade-style AI assistant layout with conversation list, selected thread, warning text, empty/error states, and no-JS message form using Laravel `/api/ai/conversations`; POST `/chat` sends the no-JS form message to Laravel `/api/ai/chat` and redirects with Laravel `empty`, `sent`, or `auth-required` status keys. The signed GET is covered by targeted Laravel runtime smoke evidence against `WEB_UK_BASE_URL=http://127.0.0.1:5354` and the default `AI assistant` body-marker contract check against `WEB_UK_BASE_URL=http://127.0.0.1:5356`. AI feature gates, provider-enabled notice parity, POST workflow runtime behavior, localization, and ASP.NET backend compatibility are not certified. |
| Polls | `/polls`, `/polls/{pollId}`, `/polls/{pollId}/rank`, `/polls/{pollId}/export`, `/polls/parity/create`, `/polls/parity/manage` | `/polls`, `/polls/:id`, `/polls/:id/rank`, `/polls/:id/export`, `/polls/parity/create`, `/polls/parity/manage` | Partial Laravel-backed candidate: signed GET pages call Laravel-compatible poll, category, ranked-results, comment, like-summary, and CSV export APIs and render Blade-style list, detail/social, ranked result/vote, create, manage, and export flows. POST aliases cover poll creation, parity ranked creation, vote, ranked vote, delete, like, and comment through Laravel v2 poll/comment/feed-like APIs. Poll browse, create, manage, detail, and rank source templates now route local filters, links, forms, discussion actions, and export controls through `urlFor()`, and poll action redirects pass auth-required, create, vote, rank, delete, like, and comment outcomes through `res.locals.urlFor` so shared mounts and custom-domain child paths do not rely only on response rewriting. Feature gates, exact service-level open/closed list parity, owner authorization depth, tenant routing, localization, and runtime behavior are not certified. |
| Search | `/search`, `/search/advanced`, `/search/saved/{id}/delete` | `/search`, `/search/advanced`, `/search/saved/:id/delete` | Partial Laravel-backed candidate: `/search/advanced` redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/search` with advanced filters and `/api/v2/search/saved` for saved-search cards, then renders Blade-style filters, saved-search actions, result tabs, and listing/member/event/group cards. Saved-search delete confirmation reads the owner-scoped `/api/v2/search/saved` list and renders the Blade-style warning form. Saved-search POST aliases for `/search/saved`, `/search/saved/{id}/delete`, and `/search/saved/{id}/run` are wired to Laravel `/api/v2/search/saved`. Simple and advanced search source templates now route search forms, result tabs, result links, empty-state CTAs, pagination base URL, and saved-search forms through `urlFor()` with source regression coverage, focused render tests, and focused Laravel runtime smoke for signed `/search/advanced?q=garden`. Search auth and saved-search result redirects now route through `res.locals.urlFor` with source regression coverage. Feature gates, tenant behavior, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Groups | `/groups` plus depth GET and POST workflows | `/groups` plus matching depth aliases | Exact Laravel accessible group route declarations are now present locally. Signed `/groups/{id}/invite` reads Laravel-compatible group detail and invite listing data, then renders the Blade-style generated-link, email invite, pending invite, revoke, and status sections. Signed `/groups/{id}/notifications` reads Laravel-compatible group detail and notification preferences, then renders the Blade-style frequency, channel, save, and status sections. Signed `/groups/{id}/image` reads Laravel-compatible group detail and renders the Blade-style avatar/cover preview and upload sections. Signed `/groups/{id}/announcements` reads Laravel-compatible group detail and announcement listing data, then renders the Blade-style announcement cards, admin action controls, create form, and status states. Signed `/groups/{id}/announcements/{annId}/edit` reads Laravel-compatible group and announcement detail data, then renders the Blade-style edit form and validation states. Signed `/groups/{id}/discussions`, `/groups/{id}/discussions/new`, and `/groups/{id}/discussions/{discussionId}` read Laravel-compatible group/discussion data and render the Blade-style discussion list, create form, thread, replies, and reply form. Signed `/groups/{id}/files` reads Laravel-compatible group detail and file listing data, then renders the Blade-style file table and upload form. Signed `/groups/{id}/files/{fileId}/download` streams the Laravel-compatible binary download and preserves safe download headers. Signed `/groups/{id}/manage` reads Laravel-compatible group member and pending-request data, then renders the Blade-style management page and forms. Existing base GET pages remain local/protected group pages, and POST aliases cover invites, notification preferences, multipart image/file uploads, file delete, announcements, discussions, group feed posts, member actions, and join request decisions through Laravel v2 group/feed APIs. Group detail breadcrumbs, edit/manage/join/leave/delete controls, member/event links, and report return targets now use `urlFor()`, and group index/create/edit/my source templates now route list/create/search/pagination/back/cancel/form controls through `urlFor()` with source regression coverage. Group auth handoffs, file-download auth exits, and API-failure action redirects now pass through the central `res.locals.urlFor` helper, with shared-mount coverage proving notification preference failures stay under `/{tenantSlug}/accessible` without double prefixing. Tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Goals | `/goals`, `/goals/templates`, `/goals/discover`, `/goals/buddying`, `/goals/{id}/edit`, `/goals/{id}/checkin`, `/goals/{id}/reminder`, `/goals/{id}/buddy-actions`, `/goals/{id}/history`, `/goals/{id}/insights`, `/goals/{id}/social` | `/goals`, `/goals/templates`, `/goals/discover`, `/goals/buddying`, `/goals/:id/edit`, `/goals/:id/checkin`, `/goals/:id/reminder`, `/goals/:id/buddy-actions`, `/goals/:id/history`, `/goals/:id/insights`, `/goals/:id/social` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed `/goals` GET requests call Laravel `/api/v2/goals?per_page=30` and render the Blade-style status banners, goal navigation links, goal cards with active/completed and public/private tags, streak and progress display, empty state, and create-goal form. Signed `/goals/templates` GET requests call Laravel `/api/v2/goals/templates/categories` and `/api/v2/goals/templates`, then render the Blade-style template category filter, template cards, target hints, title override form, public checkbox, error status, and load-more link. Signed `/goals/discover` GET requests call Laravel `/api/v2/goals/discover?per_page=30`, then render the Blade-style public buddy-goal list, owner names, progress display, buddy status errors, empty state, and no-JS buddy form. Signed `/goals/buddying` GET requests call Laravel `/api/v2/goals/mentoring?per_page=30` and `/api/v2/goals/discover?per_page=30`, then render the Blade-style buddying and available-goals sections, nudge and become-buddy forms, progress display, status states, and empty states. Signed `/goals/{id}/edit` reads Laravel-compatible goal detail data, then renders the Blade-style owner edit form, prefilled date/check-in/public fields, error state, delete warning, and delete form. Signed `/goals/{id}/checkin` reads Laravel-compatible goal detail and check-in history data, then renders the Blade-style progress, mood, note, status, and recent history page. Signed `/goals/{id}/reminder` reads Laravel-compatible goal detail and reminder data, then renders the Blade-style active/no-reminder status, frequency choices, enabled checkbox, save form, and remove-warning form. Signed `/goals/{id}/buddy-actions` reads Laravel-compatible goal detail data, then renders the Blade-style buddy support type radios, hint text, optional message, status, and send form. Signed `/goals/{id}/history` reads Laravel-compatible goal detail and history data, then renders the Blade-style chronological progress timeline, event type tags, empty state, and cursor pagination link. Signed `/goals/{id}/insights` reads Laravel-compatible goal detail and insights data, then renders the Blade-style streak, cadence, check-in, milestone, buddy-support, and owner/buddy action sections. Signed `/goals/{id}/social` reads Laravel-compatible goal detail, social summary, and threaded comments data, then renders the Blade-style support toggle, like/comment counts, reply/delete controls, status banners, validation error, and add-comment form. Existing POST aliases cover create, template use, edit, delete, buddy, progress, complete, check-in, reminder, social, and buddy-action workflows through Laravel v2 goals/comment/like APIs. Goals source templates route local links/forms through `urlFor()`, and route-level auth/result redirects now use `res.locals.urlFor` so shared tenant mounts do not rely only on response rewriting. Detail page, tenant captions, feature gates, localization, and runtime behavior are not certified. |
| Skills | `/skills` | `/skills` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed GET requests call Laravel `/api/v2/skills/categories`, optional `/api/v2/skills/categories/{id}`, and optional `/api/v2/skills/members?skill=...&limit=40`, then render the Blade-style skill search form, member result list with proficiency/offers/wants tags, category skill count table, back-to-categories link, and nested category browser. Skills category/member/search links and the search form now route through `urlFor()`, and unsigned plus Laravel-401 redirects stay inside tenant mounts through `res.locals.urlFor`/shared `asyncRoute` redirect resolution. Exact tenant caption text, localization, category/member authorization edge cases, runtime smoke behavior, and ASP.NET backend compatibility are not certified. |
| Organisations | `/organisations`, `/organisations/browse`, `/organisations/register`, `/organisations/manage`, `/organisations/{id}`, `/organisations/{id}/jobs`, `/organisations/opportunities/{id}/apply` | `/organisations`, `/organisations/browse`, `/organisations/register`, `/organisations/manage`, `/organisations/:id`, `/organisations/:id/jobs`, `/organisations/opportunities/:id/apply` | Partial Laravel-backed candidate: directory/search and browse render `/api/v2/volunteering/organisations`; register and manage GET render Blade-style forms/pages; `/organisations` POST and `/organisations/register` POST validate required fields/terms, require signed auth, and submit to `/api/v2/volunteering/organisations`; manage calls `/api/v2/volunteering/my-organisations` when signed in; signed detail renders `/api/v2/volunteering/organisations/{id}?include=public_contract`, `/api/v2/volunteering/opportunities?organization_id={id}`, and `/api/v2/volunteering/reviews/organization/{id}`, while signed-out detail redirects to `/login?status=auth-required` before data lookup like Laravel; jobs reads `/api/v2/jobs?organization_id={id}&status=open` when signed in; apply GET reads `/api/v2/volunteering/opportunities/{id}`. Organisation directory, browse, detail, jobs, manage, register, and opportunity-apply local links/forms now route through `urlFor()` with source regression coverage. Tenant/feature/runtime gates not certified. |
| Blog | `/blog`, `/blog/{slug}`, `/blog/{slug}/comments`, `/blog/{slug}/likers/{reaction}`, `/blog/feed.xml` | `/blog`, `/blog/:slug`, `/blog/:slug/comments`, `/blog/:slug/likers/:reaction`, `/blog/feed.xml` | Partial Laravel-backed candidate: public listing/detail/feed GET pages call Laravel-compatible blog APIs; signed discussion and likers pages call Laravel-compatible comments and reactions APIs; POST aliases cover post comments, comment-thread replies, post likes/reactions, and comment update/delete/reactions through Laravel v2 blog/comment/reaction APIs. Blog index/detail/comments/likers source templates now use `urlFor()` for local blog/member links, pagination, and forms, with source regression coverage and focused render tests. Feature gates, exact tenant captions, localization, RSS metadata depth, comment authorization depth, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Resources | `/resources`, `/resources/library`, `/resources/upload`, `/resources/{id}/delete`, `/resources/{id}/download`, `/resources/{id}/comments` | `/resources`, `/resources/library`, `/resources/upload`, `/resources/:id/delete`, `/resources/:id/download`, `/resources/:id/comments` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed-in simple list calls Laravel-compatible `/api/v2/resources?search=...&per_page=30`; signed-in library calls `/api/v2/resources`, `/api/v2/resources/categories`, `/api/v2/resources/categories/tree`, and profile data for admin controls; signed-in upload calls `/api/v2/resources/categories` on GET and posts multipart files to `/api/v2/resources`; signed-in delete confirmation and comments call `/api/v2/resources`; signed-in download streams `/api/v2/resources/{id}/download`; comments also call `/api/v2/comments` and `/api/v2/reactions/resource/{id}`. These render Blade-style simple and library search, empty states, full-library/simple links, category sidebar, status banners, resource counts, rich metadata cards, upload form, delete confirmation, download/comment/reaction links, load-more links, discussion threads, reaction controls, owner delete buttons, add-comment form, admin-only reorder toggle links, and admin-only Move up/Move down forms. Resource source templates now route local browse, library, upload, delete, download, comment, reaction, reorder, category, search, and pagination controls through `urlFor()` with source regression coverage, focused render tests, and focused Laravel runtime smoke for `/resources`, `/resources/library`, `/resources/upload`, and `/resources/10/comments`. Resource route-level redirects now use `res.locals.urlFor` for auth, upload, reorder, delete, comment, and reaction handoffs; focused shared-mount coverage proves delete POST under `/acme/accessible` redirects to the mounted library status page. Feature gates, localization, upload POST runtime behavior, and ASP.NET backend compatibility are not certified. |
| Marketplace | `/marketplace` | `/marketplace` | Partial Laravel-backed candidate: browse, detail, create/edit listing, my listings, saved, free, category, advanced search, seller profile, offers, orders, sales, pickups, seller onboarding, pickup-slot management, seller coupons, buy, offer, and report GET pages require signed auth where Laravel does, call Laravel v2 marketplace listing/category/seller/offer/order/pickup/coupon/onboarding APIs, and render Blade-style filters, tabs, navigation, listing cards, item summaries, status banners, tables, and listing/buyer/report/action/management forms. POST aliases now cover listing create/update/delete/renew, save/unsave, buy, offer, report, offer decisions, order actions, seller onboarding, pickup slots, and seller coupons through Laravel v2 marketplace APIs. Marketplace offer tabs, listing links, offer decision forms, my-listings tabs, create/view/edit links, and renew/delete forms now use `urlFor()` with source regression coverage. Hosted no-JS checkout redirects, media/profile-image uploads, tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Jobs | `/jobs`, `/jobs/{id}` plus depth POST workflows | `/jobs`, `/jobs/:id` plus matching depth POST aliases | Partial Laravel-backed candidate: browse, detail, saved, my-applications, my-postings, create/edit, owner applicants, analytics, pipeline, qualification assessment, alerts, responses, talent search/profile, employer brand, employer onboarding, and bias audit GET pages require signed auth where Laravel does, call `/api/v2/jobs`, `/api/v2/jobs/{id}`, `/api/v2/jobs/saved`, `/api/v2/jobs/my-applications`, `/api/v2/jobs/my-postings`, `/api/v2/jobs/{id}/applications`, `/api/v2/jobs/{id}/analytics`, `/api/v2/jobs/{id}/predictions`, `/api/v2/jobs/{id}/qualified`, `/api/v2/jobs/alerts`, `/api/v2/jobs/my-interviews`, `/api/v2/jobs/my-offers`, `/api/v2/jobs/talent-search`, `/api/v2/jobs/talent-search/{id}`, `/api/v2/users/{id}`, `/api/v2/jobs?user_id=...`, `/api/v2/jobs/employer-reviews/{id}`, and `/api/v2/admin/jobs/bias-audit` with Laravel-compatible filters/cursors/shapes, and render Blade-style tabs, filters, result cards, save/unsave, application status, withdrawal, owner actions, create/edit/apply forms, applicant analytics/stage controls, pipeline columns, analytics summaries/predictions, qualification breakdowns, alert controls, interview/offer response actions, candidate search filters/cards, candidate profile details, employer profiles/reviews/open jobs, employer posting guidance, and hiring bias audit tables. POST aliases cover create/update/delete/renew, apply, save/unsave, application status/withdrawal, alerts, interview responses, and offer responses through Laravel v2 jobs APIs. Jobs status/auth/API-failure redirects now route through `res.locals.urlFor`, with shared-mount coverage proving mounted apply auth handoffs stay under `/{tenantSlug}/accessible`. Multipart CV upload proxying, tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Courses | `/courses` | `/courses` | Partial Laravel-backed candidate: browse, detail, certificate, lesson player, my learning, instructor dashboard, create/edit builder, analytics, and grading GET pages require signed auth like Laravel, call Laravel `/api/v2/courses`, `/api/v2/me/courses`, course prerequisite/review/progress/certificate/quiz/analytics/grading endpoints, and render Blade-style course nav, filters, cards, enrol/review forms, progress, quiz controls, instructor builder forms, analytics summaries, and grading forms. Course source templates now route local course tabs, browse/search, course/prerequisite/certificate/learning links, review/enrolment/quiz/progress forms, instructor builder links/forms, publish/delete controls, and grading forms through `urlFor()` with source regression coverage and focused render tests. POST aliases cover enrolment, review, lesson completion, quiz attempts, course create/update/publish/unpublish/delete, section/lesson builder actions, and grading through Laravel v2 course APIs. Course route-level auth, validation, success, and API-error redirects now pass through `res.locals.urlFor` for shared tenant mounts and custom-domain child paths. Tenant feature gates, localization, exact owner/instructor policy enforcement, runtime persistence, and ASP.NET backend compatibility are not certified. |
| Podcasts | `/podcasts` | `/podcasts` | GET list, detail, episode, studio, create, and manage pages now render Laravel-backed accessible pages through `/api/v2/podcasts` and `/api/v2/podcasts/mine`; POST aliases cover show subscribe, studio show create/update/publish/delete, and episode add/publish/delete including multipart audio upload proxying through Laravel v2 podcast APIs. Podcast browse/detail/episode/form/manage/studio source templates now route local links/forms through `urlFor()` with source regression coverage, focused render tests, and focused Laravel runtime smoke for signed `/podcasts`, `/podcasts/studio`, and `/podcasts/studio/new`. Podcast page auth redirects and podcast action redirects now route auth, validation, success, and API-failure outcomes through `res.locals.urlFor`, matching Laravel named-route redirect behavior for shared mounts and custom-domain contexts. |
| Coupons | `/coupons`, `/coupons/{id}` | `/coupons`, `/coupons/:id` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed GET requests call Laravel `/api/v2/coupons` and `/api/v2/coupons/{id}` and render Blade-style coupon cards, discount tags, coupon codes, valid-until metadata, empty state, detail back link, coupon-code panel, redemption guidance, and merchant summary metadata. Public coupon list/detail source templates now route coupon links and the detail back link through `urlFor()` with source regression and focused render coverage. Route-level coupon auth redirects now use `res.locals.urlFor`, with shared-mount coverage proving `/acme/accessible/coupons` and `/acme/accessible/coupons/{id}` redirect to the tenant-mounted login path. Scoped Laravel runtime smoke proves the current local fixture returns expected `403` merchant-coupons feature gates for `/coupons` and `/coupons/1`; rendered coupon body parity still needs runtime proof in a tenant with merchant coupons enabled. Exact tenant captions, QR redemption/validation POST workflows, localization, runtime persistence, and ASP.NET backend compatibility are not certified. |
| Premium | `/premium` | `/premium` | Partial Laravel-backed candidate: pricing, manage, and return GET pages require signed auth like Laravel, call `/api/v2/member-premium/tiers` and `/api/v2/member-premium/me`, and render Blade-style tier cards, current plan notices, billing/cancel forms, and checkout-return states. POST `/premium/subscribe`, `/premium/portal`, and `/premium/cancel` call Laravel `/api/v2/member-premium/*` endpoints and preserve Laravel success/failure redirects. Premium links/forms, auth/status redirects, checkout return URL payloads, and billing-portal return URL payloads now route through `urlFor()`/`res.locals.urlFor` with source regression and focused shared-mount payload coverage. Stripe runtime behavior, feature gates, localization, exact billing date/status wording, and ASP.NET backend compatibility are not certified. |
| Ideation | `/ideation`, `/ideation/new`, `/ideation/{id}`, `/ideation/{id}/edit`, `/ideation/{id}/manage`, `/ideation/{id}/outcome`, `/ideation/{id}/drafts`, `/ideation/{id}/ideas/{ideaId}`, `/ideation/tags`, `/ideation/campaigns`, `/ideation/campaigns/{id}`, `/ideation/outcomes` | `/ideation`, `/ideation/new`, `/ideation/:id`, `/ideation/:id/edit`, `/ideation/:id/manage`, `/ideation/:id/outcome`, `/ideation/:id/drafts`, `/ideation/:id/ideas/:ideaId`, `/ideation/tags`, `/ideation/campaigns`, `/ideation/campaigns/:id`, `/ideation/outcomes` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed GET requests call Laravel `/api/v2/ideation-challenges`, `/api/v2/ideation-categories`, `/api/v2/ideation-templates`, `/api/v2/ideation-challenges/{id}`, `/api/v2/ideation-challenges/{id}/ideas?limit=30&sort=votes`, `/api/v2/ideation-challenges/{id}/ideas?limit=100&sort=votes`, `/api/v2/ideation-challenges/{id}/ideas/drafts`, `/api/v2/ideation-challenges/{id}/outcome`, `/api/v2/ideation-ideas/{ideaId}`, `/api/v2/ideation-ideas/{ideaId}/comments?per_page=30`, `/api/v2/ideation-ideas/{ideaId}/media`, `/api/v2/ideation-tags/popular`, `/api/v2/ideation-campaigns`, `/api/v2/ideation-campaigns/{id}`, and `/api/v2/ideation-outcomes/dashboard`, then render Blade-style search/status filters, challenge cards, create/edit form fields, category/template choices, manage lifecycle/campaign/favourite/duplicate/delete controls, outcome edit form fields, draft edit/publish forms, idea detail/comment/media/admin/convert/delete controls, status tags, idea counts, success/error banners, challenge metadata, prize inset, idea cards, vote forms, submit-idea form, popular tags, selected-tag challenge matches, tag empty states, ideation tabs, campaign cards/detail metadata, campaign status tags, linked challenge cards, challenge counts, creator metadata, outcome stats, and outcome tables. Ideation source templates now route local tabs, filters, links, and form actions through `urlFor()`. POST aliases call Laravel v2 ideation APIs for challenge, idea, outcome, vote, media, conversion, and campaign actions, and their redirects now route through `res.locals.urlFor` so shared-mounted tenant paths stay under `/{tenantSlug}/accessible`. Admin authorization depth, tenant/feature gates, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Federation | `/federation` | `/federation` | Partial Laravel-backed candidate: the protected hub redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/federation/status`, `/api/v2/federation/partners`, and `/api/v2/federation/activity`, and renders Blade-style status banners, network stats, partner preview, recent activity, and quick links. The protected `/federation/partners` index, `/federation/partners/{id}` detail, `/federation/members` index, `/federation/members/{id}` detail, `/federation/members/{id}/transfer` confirm form, `/federation/settings` form, `/federation/opt-in` preferences form, `/federation/opt-out` confirmation form, `/federation/onboarding` wizard, `/federation/listings` browse page, `/federation/listings/{tenantId}/{id}` detail page, `/federation/groups` browse page, `/federation/events` browse page, `/federation/connections` tabbed list, `/federation/messages` conversation index, and `/federation/messages/conversation/{id}` conversation detail now call Laravel-compatible endpoints and render Blade-style federation depth pages. Tenant federation policy, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Clubs | `/clubs` | `/clubs` | Partial Laravel-backed candidate: unsigned visitors redirect to `/login?status=auth-required`; signed-in visitors call Laravel-compatible `/api/v2/clubs?search=...&per_page=50` and render Blade-style club search, empty state, logo, member count, schedule, contact, and external website cards. The route now returns Laravel-style `404` when an unfiltered club list proves no active clubs exist, and preserves searched empty results when a minimal unfiltered probe proves the tenant has active clubs. The Explore page now also probes `getClubs({ per_page: 1 })` and renders the Clubs card only from live active-club evidence, including tenant-mounted `/accessible` links. Exact tenant caption, localization, live Laravel runtime behavior for a tenant with active clubs, and ASP.NET backend compatibility are not certified. |
| Public info pages | `/about`, `/guide`, `/features`, `/faq` | `/about`, `/guide`, `/features`, `/faq` | Partial Blade-style candidate: `/about` renders Laravel's community intro, ordered four-step flow, values, contributor credits, open-source links, and signed-in/signed-out CTA group; `/guide` renders Laravel's timebanking explanation, equal-time principle, ordered three-step flow, getting-started copy, and signed-in/signed-out CTA group; `/features` renders Laravel's feature list and guide CTA; `/faq` renders Laravel's five-question GOV.UK accordion. About, Guide, Features, and email-verification CTAs/links now route through `urlFor()` so shared tenant mounts and custom-domain child paths do not rely only on rendered response rewriting. Tenant-domain routing, module-gated CTA visibility, localization, live platform stats, runtime behavior, and ASP.NET backend compatibility are not certified. |

## Remaining Certification Families

These Laravel route families still need detailed page-by-page workflow, visual,
auth, tenant, localization, and runtime certification before `apps/web-uk` can
be shared:

| Family | Exact route gaps | Examples | Current status |
| --- | ---: | --- | --- |
| Tenant routing | structural | shared-domain `/{tenantSlug}/alpha`, custom accessible/domain hosts | Shared-host slices implemented: `/{tenantSlug}/accessible` routes through the existing flat Express app, shell/home links are prefixed under the active mount, legacy `/{tenantSlug}/alpha` redirects to `/accessible`, local redirects plus rendered HTML links/actions stay under the active mount, tenant homes pass `X-Tenant-Slug` to Laravel platform stats, and shared root `/` renders the Laravel-style tenant chooser backed by `/api/v2/tenants` while excluding the master tenant and sorting communities by display name to match Laravel Blade. Custom-domain resolution through Laravel `accessible_domain` and `domain`, slugless custom-domain root home behavior, Host/Origin-scoped tenant stats without default `X-Tenant-ID` override, forwarded-host handling, master/cluster network landing copy, and parent-domain child tenant routing are implemented in focused slices. The parent-domain reserved child-segment set now matches Laravel `TenantContext::getReservedPaths()` exactly, including automated source coverage and proof that Laravel-unreserved names such as `courses` can resolve as child slugs. Focused live Laravel smoke covers parent-domain child login plus both master and cluster host-root rendering: `project-nexus.ie|/=>Build Thriving Communities with NEXUS` and `timebank.global|/=>Exchange Skills Across Borders`. Source audits now find no direct root-relative template links/forms or raw root-relative `res.redirect("/...")` exits; helper-mediated redirects still require route-family coverage. Remaining certification gaps are full tenant visual/manual parity and ASP.NET backend compatibility. |
| Cookie/report POST workflows | 0 | none exact | Cookie choice POST is a partial local candidate whose banner/settings form actions now route through `urlFor()`. Contact POST and report-problem POST are Laravel-backed candidates using `/api/v2/contact` and `/api/v2/support/reports`, with status-key redirects and mocked contract tests. Cookie audit persistence, tenant scoping, production Turnstile, localization, notification side effects, and ASP.NET backend compatibility are not certified. |
| Legal document sourcing | 0 exact route gaps | `/legal/*` tenant documents | `/legal` renders the Blade legal hub, `/accessibility` renders the Blade accessibility statement, and `/legal/*` pages call Laravel `/api/v2/legal/{type}` for tenant-managed documents with matching fallback policy sections when the API returns no published document. Fallback legal/accessibility back and contact links now route through `urlFor()`. Tenant-domain routing, localization, legal acceptance prompts, version history/compare links, live runtime behavior, and ASP.NET backend compatibility are not certified. |
| Listings | 0 | none exact | GET `/listings/{id}/report` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/listings/{id}`, blocks owner self-reports, and renders the Blade-style report form with listing caption, status error summary, six Laravel reason values, optional details textarea, warning submit button, and cancel link. GET `/listings/{id}/exchange-request` now redirects unsigned visitors with the Laravel status key, calls Laravel-compatible `/api/v2/listings/{id}` and `/api/v2/wallet/balance`, blocks owner self-requests, and renders the Blade-style exchange request summary, balance context, low-balance warning, proposed-hours/prep-time/message fields, and submit button. GET `/listings/{id}/analytics` now redirects unsigned visitors with the Laravel status key, calls Laravel-compatible `/api/v2/listings/{id}` and `/api/v2/listings/{id}/analytics`, preserves the Laravel day selector, and renders the Blade-style owner analytics metrics, trends, time-series, and contact-type breakdown. GET `/listings/{id}/comments` now redirects unsigned visitors with the Laravel status key, calls Laravel-compatible `/api/v2/listings/{id}` and `/api/v2/comments?target_type=listing&target_id={id}`, and renders the Blade-style comment thread, status banners, nested comments, and add-comment form. Listing index/form templates now route browse filters, listing row links, owner edit/delete controls, pagination, empty states, create/edit form action, and cancel links through `urlFor()` with source regression coverage, focused render tests, and a focused Laravel runtime smoke for signed `/listings` containing `Create listing`. Listing route-level redirects now also use `res.locals.urlFor` for auth handoffs, generate-description, like/comment/exchange/report actions, owner self-request/edit handoffs, create/update successes, and delete successes, with source regression and focused behavior coverage. POST aliases cover `/listings/{id}/save`, `/listings/{id}/unsave`, `/listings/{id}/renew`, `/listings/{id}/report`, `/listings/{id}/like`, `/listings/{id}/comments`, `/listings/{id}/exchange-request`, and `/listings/generate-description` through Laravel v2 listing, comment, feed-like, and exchange APIs. GET listing/detail pages remain local; generated description value repopulation, image and skill-tag form parity, owner/requester authorization depth, tenant gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Onboarding | 0 | none exact | `/onboarding` and `/onboarding/{step}` now render a Laravel-backed member onboarding wizard: signed-out requests redirect to `/login?status=auth-required`, signed-in entry requests redirect to the first active Laravel-configured step, completed members redirect to the dashboard, and step pages use `/api/v2/onboarding/status`, `/api/v2/onboarding/config`, `/api/v2/onboarding/categories`, `/api/v2/onboarding/safeguarding-options`, and `/api/users/me` to render the Blade-style welcome/profile/interests/skills/safeguarding/confirm pages. POST aliases cover `/onboarding/{step}` and `/onboarding/avatar`: profile saves bio through the profile API, avatar uploads proxy multipart data to `/api/v2/users/me/avatar`, category choices are held in Express session state, safeguarding preserves Laravel Blade `safeguarding[id]` fields and submits to `/api/v2/onboarding/safeguarding`, and confirm submits to `/api/v2/onboarding/complete`. Wizard form actions and confirm-page change links now route through `urlFor()` at source level so shared tenant mounts and custom-domain child paths do not rely only on response rewriting for no-JS onboarding controls. Exact tenant captions, avatar upload runtime smoke behavior, tenant feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Saved items and collections | 0 | none exact | GET `/saved` now renders the signed Blade-style saved item index through Laravel `/api/v2/bookmarks`, including type filtering, item links, type tags, empty state, and remove forms; the generated saved-family preparation fallback is cleared. GET `/me/collections`, `/me/collections/{id}`, `/users/{id}/collections`, and `/users/{id}/appreciations` render signed Laravel-backed owner/public collection and appreciation pages through `/api/v2/me/collections`, `/api/v2/me/collections/{id}/items`, `/api/v2/users/{id}/public-collections`, and `/api/v2/users/{id}/appreciations`, including Blade-style collection cards, item cards, appreciation cards, thank-you/reaction forms, pagination, create/edit/delete, and item-remove controls with unsigned auth redirects covered by tests. POST aliases cover collection create/update/delete, collection item removal, appreciation send, and appreciation reaction through Laravel v2 endpoints with Laravel status redirects. Flat saved removal matches Blade's exact `POST /api/v2/bookmarks` toggle contract with `{ type, id }`. Saved item, collection, and saved social templates now route saved filters, dynamic item links, bookmark removal, collection list/detail links, pagination, collection CRUD/item-remove forms, public collection links, and appreciation controls through `urlFor()` with source regression coverage, focused render tests, and focused Laravel runtime smoke for `/saved`, `/me/collections`, and `/users/14/appreciations`. Saved collection and saved social route-level redirects now use `res.locals.urlFor` for auth handoffs and POST outcomes, with focused shared-mount coverage proving collection and appreciation redirects stay under `/acme/accessible`. The opt-in collection mutation smoke passed `1/1` in `81.0` seconds, creating, updating, deleting, and proving final absence of a unique private collection without retaining the fixture. A separate flat-bookmark smoke passed `1/1` in `135.5` seconds by toggling an initially absent listing bookmark on, proving the Web UK no-JS removal, and verifying rendered plus backend absence. Collection-item removal, appreciation mutations, tenant feature gates, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Matches | 0 | none exact | GET `/matches` and `/matches/board` now redirect unsigned visitors through the protected matches router, call Laravel-compatible `/api/v2/matches/all` with the Blade source filters, and render the Blade-style match summary, source tabs, match cards, score tags/progress, reasons, empty states, and no-JS dismiss forms. `/matches/{id}/dismiss` and `/matches/board/{listingId}/dismiss` call Laravel `/api/v2/matches/{id}/dismiss` and preserve Laravel redirect status/source/fragment behavior. Remaining gaps: tenant module gates, exact service support for event-source API filtering, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Messages | 0 | none exact | Group GET pages now render the Blade-style group conversation list, create/search form, and group conversation detail through Laravel-compatible `/api/v2/conversations/groups`, `/api/v2/conversations/{id}/messages`, `/api/v2/conversations/{id}/participants`, and `/api/v2/users/search`. Direct GET `/messages/new/{userId}` now redirects unsigned users through auth middleware, calls Laravel-compatible `/api/v2/messages/{userId}`, `/api/v2/messages/restriction-status`, `/api/v2/messages/{userId}/read`, and optional `/api/v2/listings/{id}` context, then renders the Blade-style conversation title, listing inset, status/error banners, search form, older-message link, message list, reply form, voice upload, and archive action. POST aliases cover archive/restore, edit/delete/translate message actions, multipart regular attachments, multipart voice upload, group create/reply/member add/remove, and group message reactions through Laravel v2 message/conversation APIs while preserving Laravel status redirects and anchors. Direct and group message POST redirects now route through `res.locals.urlFor` for shared tenant mounts and custom-domain child paths, with focused source coverage guarding against raw `/login` or `/messages` redirect targets returning and a scoped Laravel runtime smoke passing `/messages/groups`, `/messages/groups/new`, `/messages/77`, and `/messages/new/77` body markers. Direct message translation now checks the tenant `message_translation` feature before calling Laravel APIs and redirects disabled tenants to `translate-unavailable` with the message anchor, with focused shared-mount Jest proof. Translated-text display, exact Laravel restriction gates, localization, attachment/voice upload runtime smoke behavior, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Exchanges | 0 | none exact | GET `/exchanges` and `/exchanges/{id}` now render Laravel-backed exchange list/detail pages through `/api/v2/exchanges/config`, `/api/v2/exchanges`, `/api/v2/exchanges/{id}`, and `/api/v2/exchanges/{id}/ratings`; POST `/exchanges/{id}` action and `/exchanges/{id}/rate` call Laravel `/api/v2/exchanges/{id}` action endpoints and `/api/v2/exchanges/{id}/rate`. Exchange list/detail templates now route tabs, links, pagination, action forms, and rating form controls through `urlFor()` with source regression, focused render coverage, and scoped Laravel runtime smoke for signed `/exchanges`; action/rating POST redirects now route through `res.locals.urlFor` with focused shared-mount coverage. Remaining gaps: feature/module gates, exact participant authorization edge cases, localization, workflow side effects, broader tenant behavior, full runtime smoke behavior, and ASP.NET backend compatibility. |
| AI chat | 0 | none exact | GET `/chat` now requires signed auth like Laravel, calls `/api/ai/conversations` and `/api/ai/conversations/{id}` for the Blade-style conversation list and selected thread, and renders the no-JS send form. POST `/chat` calls Laravel `/api/ai/chat`, trims messages to the Laravel 4,000-character limit, preserves valid conversation IDs, and redirects to `/chat?c={id}&status=sent` or `/chat?status=empty`. The signed GET returned `200` in targeted Laravel runtime smoke at `WEB_UK_BASE_URL=http://127.0.0.1:5354` and is now covered by the default `AI assistant` body-marker contract check against `WEB_UK_BASE_URL=http://127.0.0.1:5356`. AI feature gates, provider-enabled notice parity, fallback reply display, tool cards, POST workflow runtime behavior, localization, and ASP.NET backend compatibility are not certified. |
| Blog | 0 | none exact | GET aliases now cover `/blog`, `/blog/feed.xml`, `/blog/{slug}`, `/blog/{slug}/comments`, and `/blog/{slug}/likers/{reaction}` through Laravel-compatible blog/comment/reaction APIs and Blade-style Nunjucks pages. POST aliases cover `/blog/{slug}/comments`, `/blog/{slug}/comments/add`, `/blog/{slug}/like`, `/blog/{slug}/react`, and `/blog/comments/{id}/update|delete|react` through Laravel `/api/v2/blog/{slug}`, `/api/v2/comments`, and `/api/v2/reactions`. Blog source templates route local blog/member links, pagination, and forms through `urlFor()` with source regression coverage. Blog route-level redirects also route signed-out discussion/liker/action handoffs and POST results through `res.locals.urlFor`, with shared-mount regression coverage. Remaining gaps: feature gates, exact tenant captions, localization, RSS metadata depth, comment authorization depth, tenant routing, runtime behavior, and ASP.NET backend compatibility. |
| Polls | 0 | none exact | GET aliases now cover `/polls`, `/polls/parity/create`, `/polls/parity/manage`, `/polls/{id}`, `/polls/{id}/rank`, and `/polls/{id}/export` through Laravel-compatible `/api/v2/polls`, `/api/v2/polls/categories`, `/api/v2/polls/{id}`, `/api/v2/polls/{id}/ranked-results`, `/api/v2/polls/{id}/export`, and `/api/v2/comments` calls. POST aliases cover `/polls`, `/polls/parity/create`, `/polls/{id}/vote`, `/polls/{id}/rank`, `/polls/{id}/delete`, `/polls/{id}/like`, and `/polls/{id}/comment` through Laravel `/api/v2/polls`, `/api/v2/comments`, and `/api/v2/feed/like`. Poll source templates now route browse filters, create/manage links, inline create form, detail/rank back links, vote/rank/delete/like/comment forms, discussion links, and CSV export links through `urlFor()`. Poll action result redirects now route through `res.locals.urlFor` for auth-required, create, vote, rank, delete, like, and comment outcomes under shared tenant mounts and custom-domain child paths; the older `src/routes/polls.js` vote success/API-error redirects now do the same instead of emitting flat `/polls/{id}` locations. Remaining gaps: feature gates, exact service-level open/closed list parity, owner authorization depth, tenant routing, localization, runtime behavior, and ASP.NET backend compatibility. |
| Premium | 0 | none exact | Pricing, manage, and return GET pages now render Laravel-backed Premium flows with `/api/v2/member-premium/tiers` and `/api/v2/member-premium/me`; POST aliases cover subscribe, billing portal, and cancel through Laravel `/api/v2/member-premium/checkout`, `/api/v2/member-premium/billing-portal`, and `/api/v2/member-premium/cancel`. Premium source templates route local links/forms through `urlFor()`, and checkout plus billing-portal `return_url` payloads now use the active tenant URL helper with focused shared-mount coverage. Remaining gaps: Stripe checkout/portal runtime, feature gates, localization, exact billing date/status wording, and ASP.NET backend compatibility. |
| Reviews | 0 | none exact | GET aliases now cover `/reviews`, `/reviews/list`, and `/reviews/{id}/comments` through Laravel-compatible `/api/v2/reviews`, `/api/v2/comments`, and `/api/v2/reactions` calls, rendering the Blade-style review summary, received/given paginated list, pending-review forms, comment thread, reaction controls, and Laravel-matched reviews-index status outcomes. Success statuses such as `review-submitted` and `review-deleted` render GOV.UK notification banners with Laravel English copy, while invalid/duplicate/failed/delete-failed outcomes render the Laravel-style GOV.UK error summary headed `There is a problem`. POST aliases cover `/reviews`, `/reviews/{id}/comments`, `/reviews/{id}/react`, and `/reviews/{id}/delete` through Laravel `/api/v2/reviews`, `/api/v2/comments`, and `/api/v2/reactions` with Laravel status redirects. Review source templates now route summary/list/comment links, received/given tabs, load-more links, pending-review forms, comment forms, and reaction forms through `urlFor()`. Review action redirects now pass auth-required, create, comment, reaction, delete-review reviews-index status outcomes, and Laravel-401 outcomes through `res.locals.urlFor` so shared mounts and custom-domain child paths do not rely only on response rewriting. Delete-review ignores non-Laravel `return_url` payloads and returns to `/reviews?status=review-deleted` or `/reviews?status=review-delete-failed`, matching Laravel Blade's `AlphaController::deleteReview()` flow. Legacy local `/reviews/{id}/edit`, `/reviews/user/{id}`, and `/reviews/listing/{id}` route shapes are no longer exposed; member profile review forms use `/members/{id}/review`. Remaining gaps: exact moderation/deletion display, threaded reply depth, feature gates, tenant behavior, localization beyond the matched English strings, live runtime behavior, and ASP.NET backend compatibility are not certified. |
| Search | 0 | none exact | GET `/search/advanced` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/search` with the Blade advanced-search filters and `/api/v2/search/saved`, and renders Blade-style filters, saved-search actions, status banners, result tabs, and listing/member/event/group cards. GET `/search/saved/{id}/delete` now redirects unsigned visitors to `/login?status=auth-required`, reads the owner-scoped saved-search list from `/api/v2/search/saved`, and renders the Blade-style destructive confirmation page. Saved-search POST aliases cover `/search/saved`, `/search/saved/{id}/delete`, and `/search/saved/{id}/run` through Laravel `/api/v2/search/saved`; save/run query parameters are normalized to Laravel's allow-list and redirect back to `/search/advanced`. Search source templates now route simple search, advanced search, result tabs, result links, empty-state CTAs, pagination base URL, saved-search delete, and saved-search forms through `urlFor()` with source regression coverage. Search auth and saved-search save/delete/run redirects now route through `res.locals.urlFor` with source regression coverage. A focused Laravel runtime smoke passed signed `/search/advanced?q=garden` with `Advanced search` and `Save this search` body markers. Feature gates, tenant behavior, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Connections | 0 | none exact | GET `/connections/network` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/connections` for accepted, pending-received, and pending-sent sections, calls Laravel `/api/v2/connections/pending` for counts, and renders the Blade-style network status banners, search, tabs, card sections, connected-since text, empty states, load-more links, and action forms. POST aliases `/connections/{id}/accept`, `/connections/{id}/decline`, and `/connections/{id}/remove` now call Laravel v2 connection endpoints and redirect with Laravel status keys and `#connections-top`. Legacy `/connections` remains a local/protected page; `/connections/pending` has been removed in favor of `/connections/network?tab=pending_received`. Tenant feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Achievements | 0 | none exact | GET `/achievements` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible gamification profile, badge, progress, daily reward, and challenge APIs, and renders the Blade-style achievements page with the gamification tabs, level/XP summary, progress bar, daily reward state/form, active challenges, earned badges, and badge progress. GET `/achievements/shop` renders the Laravel-style XP shop through `/api/v2/gamification/shop`, including balance, status banners, warning, item cards, owned/unavailable tags, and no-JS purchase forms. GET `/achievements/collections` renders the Laravel-style badge collections page through `/api/v2/gamification/collections`, including collection cards, progress bars, reward XP, completed/bonus tags, and earned/locked badge links. GET `/achievements/engagement` renders the Laravel-style engagement history table through `/api/v2/gamification/engagement-history`, including active/inactive tags and pluralized activity counts. GET `/achievements/showcase` renders the Laravel-style earned-badge checkbox management page through `/api/v2/gamification/badges`, including status banners and no-JS save form. GET `/achievements/badges/{key}` renders the Laravel-style badge detail summary through `/api/v2/gamification/badges/{key}`, including earned status, metadata rows, showcased state, and view-all link. POST aliases cover daily reward, challenge claim, shop purchase, and showcase update through Laravel `/api/v2/gamification/*` endpoints with Laravel status redirects. Gamification tabs, back links, daily reward/challenge/purchase/showcase forms, badge collection links, badge detail links, auth-required redirects, and POST result redirects now use `urlFor()`/`res.locals.urlFor`, with source-level regressions guarding the tenant-aware helper conversion. Remaining gaps: feature gates, tenant behavior, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Leaderboard and NEXUS score | 0 | none exact | GET `/leaderboard` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel-compatible `/api/v2/gamification/leaderboard` and `/api/v2/gamification/community-dashboard`, and renders the Blade-style leaderboard tab strip, community impact stats, metric/period filter form, rank/member/score table, current-user tag, and empty state. GET `/leaderboard/competitive` now redirects unsigned visitors, calls Laravel-compatible `/api/v2/gamification/leaderboard` and `/api/v2/gamification/seasons/current`, and renders the Blade-style back link, active-season card, active leaderboard tabs, metric/period filter, rank banner, table, and load-more link. GET `/leaderboard/seasons` now redirects unsigned visitors, calls Laravel-compatible `/api/v2/gamification/seasons/current` and `/api/v2/gamification/seasons`, and renders the Blade-style current-season card, rewards, season leaders, and past-seasons table. GET `/leaderboard/journey` now redirects unsigned visitors, calls Laravel-compatible `/api/v2/gamification/personal-journey`, and renders the Blade-style summary list, milestones, monthly activity table, badge progression list, and empty states. GET `/leaderboard/spotlight` now redirects unsigned visitors, calls Laravel-compatible `/api/v2/gamification/member-spotlight`, and renders the Blade-style daily featured-member card list and empty state. GET `/nexus-score` and `/nexus-score/tiers` now redirect unsigned visitors, call Laravel-compatible `/api/v2/gamification/nexus-score`, and render the Blade-style overview, tier-ladder related link, score panel, breakdown progress table, insights list, nine-tier ladder, current tier, points-to-next inset, table statuses, and unavailable-score states. Leaderboard tabs, back links, filter form actions, load-more links, NEXUS tier links, and data-driven member profile links now use `urlFor()`, and route-level unsigned plus Laravel-401 auth handoffs now use `res.locals.urlFor` instead of raw flat `/login` redirects, with source-level regressions guarding both tenant-aware helper conversions. Exact metric formatting for every legacy service type, feature gates, tenant behavior, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Members | 0 | none exact | Signed GET `/members/discover` calls Laravel-compatible `/api/v2/users?sort=communityrank` and renders the Blade-style recommended-members page with auth-required redirect, filter navigation, search, recommendation scores, member cards, and load-more link. Signed GET `/members/nearby` reads the signed-in profile location, calls Laravel-compatible `/api/v2/members/nearby`, and renders the Blade-style nearby directory with auth-required redirect, no-location guidance, radius/search controls, distance cards, and load-more link. Signed GET `/members/{id}/insights` now calls Laravel-compatible `/api/v2/users/{id}` and `/api/v2/users/{id}/verification-badges` plus the signed-in profile, then renders the Blade-style reputation page with NEXUS score, percentile progress, activity stats, verification badges, earned badges, and profile back links. POST aliases cover member connection transitions, skill endorsement add/remove, block/unblock, profile review, and profile transfer through Laravel v2 APIs with Laravel status redirects. Existing base directory/profile GET pages remain local routes. Blade profile visual parity, live connection-state rendering, tenant guards, feature gates, block/privacy/onboarding gating, self-action checks, localization, and runtime behavior are not certified. |
| Resources | 0 | none exact | Simple `/resources`, full `/resources/library`, `/resources/upload`, `/resources/{id}/delete`, `/resources/{id}/download`, and `/resources/{id}/comments` GET now render or stream Laravel-backed resource pages through `/api/v2/resources`, `/api/v2/resources/categories`, `/api/v2/resources/categories/tree`, `/api/v2/resources/{id}/download`, `/api/v2/comments`, and `/api/v2/reactions`; POST aliases cover multipart resource upload, admin reorder, delete, reactions, comment add, and comment delete. Upload/delete/reorder/comments/reactions use Laravel v2 resource/comment/reaction APIs, and library reorder mode now exposes the Laravel-style admin-only move controls. Resource browse/library/upload/delete/comments source templates now use `urlFor()` for local resource links/forms, and resource route-level redirects now use `res.locals.urlFor` for auth, upload, reorder, delete, comment, and reaction handoffs, with source regression coverage, focused render tests, focused shared-mount delete redirect coverage, and focused Laravel runtime smoke for `/resources`, `/resources/library`, `/resources/upload`, and `/resources/10/comments`. Exact admin permissions against a live Laravel tenant, tenant gates, localization, and live upload POST behavior are not certified. |
| Wallet | 0 | none exact | GET `/wallet/manage` now redirects through the protected wallet router, calls Laravel `/api/v2/wallet/balance`, `/api/v2/wallet/community-fund`, and `/api/v2/wallet/user-search`, and renders the Blade-style manage-credits hub with balance, earned/spent/pending stats, recipient search, transfer forms, donation target controls, community-fund summary, and status states. GET `/wallet/recipients` returns Laravel user-search suggestions for the progressive autocomplete contract. GET `/wallet/export.csv` streams Laravel `/api/v2/wallet/statement` CSV with Laravel content-disposition/cache headers. Existing wallet transfer/donate POST aliases remain Laravel-compatible. Tenant module gates, exact live recipient privacy behavior, localization, runtime smoke tests, and ASP.NET backend compatibility are not certified. |
| Account and profile depth | varies by family | matches, group exchanges, gamification, linked accounts, saved items, reviews, jobs, appearance | Partial `/account` candidate plus Blade-style `/profile/settings`, `/profile/two-factor`, `/profile/blocked`, `/profile/delete-account`, `/activity`, and `/activity/insights` pages. The account hub now passes card links and logout form action through `urlFor()` so the source template participates in tenant-aware shared-mount/custom-domain routing instead of relying only on response rewriting. The member onboarding route now sends auth-required, step, avatar, validation, safeguarding, completion, and dashboard handoff redirects through `res.locals.urlFor` for the same tenant-aware redirect behavior. The activity dashboard and insights templates now pass detailed-insights and back-to-activity links through `urlFor()`, and route-level activity auth redirects now pass through `res.locals.urlFor` with shared-mount coverage for `/acme/accessible/activity` and `/acme/accessible/activity/insights`. Profile route-level settings, profile summary, email, password, language, notifications, passkey, personalisation, match-preference, skill, safeguarding, data-export, delete-account, blocked-member, and two-factor auth/status redirects now also pass through `res.locals.urlFor`, keeping no-JS profile outcomes inside shared tenant mounts and custom-domain contexts. The settings page redirects unsigned visitors to `/login?status=auth-required`, loads Laravel-compatible profile/account/notification/match/skill/passkey/session/safeguarding payloads where available, and renders the Blade-style profile form, skills, security, language, notifications, personalisation, safeguarding, and data/privacy sections. The two-step verification page renders Blade-style setup, enabled, disable, and status states from the Laravel-compatible profile 2FA payload. The blocked-members page renders the Blade-style success, empty, blocked-member, and unblock-form states. The delete page renders Laravel warning/error/form states and uses the existing Laravel-compatible delete POST alias. The activity pages redirect unsigned visitors, call the Laravel-compatible profile activity dashboard endpoint, and render Blade-style hours, connections, engagement, skills, monthly hours, timeline, dual-bar insights chart, quick stats, and typed activity badges. Remaining feature-gated account links, per-module data, route availability checks, tenant behavior, runtime profile/onboarding/avatar/2FA/blocked-member/activity certification, and ASP.NET backend compatibility are not certified. |
| Volunteering | 0 | none exact | GET `/volunteering/accessibility` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/accessibility-needs`, and renders the Blade-style need type, description, adjustment, emergency contact, status-banner, and no-JS save form. GET `/volunteering/certificates` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/certificates`, and renders the Blade-style generate form, certificate status banners, empty state, certificate cards, organisation hour breakdown, verification code, and download link. GET `/volunteering/certificates/{code}/download` now verifies the signed-in member owns the requested code through `/api/v2/volunteering/certificates`, then streams Laravel printable HTML from `/api/v2/volunteering/certificates/{code}/html`. GET `/volunteering/opportunities/create` now redirects unsigned visitors to `/login?status=auth-required`, reads `/api/v2/volunteering/my-organisations?per_page=50` and `/api/v2/categories?type=volunteering`, filters to approved/active owner-admin organisations, and renders the Blade-style opportunity create form and validation states. GET `/volunteering/credentials` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/credentials`, and renders the Blade-style credential upload form, status banners, type options, credential table, status tags, expiry/uploaded dates, and delete forms. GET `/volunteering/hours` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/hours/summary`, `/api/v2/volunteering/hours`, `/api/v2/volunteering/applications`, and `/api/v2/volunteering/my-organisations`, and renders the Blade-style summary stats, by-organisation/by-month tables, log-hours form, and recent hour-log cards. GET `/volunteering/wellbeing` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/wellbeing`, and renders the Blade-style wellbeing score, burnout risk tag, hours/streak stats, warnings, mood check-in form, status banners, and recent check-ins table. GET `/volunteering/donations` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/giving-days` and `/api/v2/volunteering/donations?per_page=20`, and renders the Blade-style money-donation explanation, fundraising stats, giving-day cards, donation history, status banners, and offline donation form. GET `/volunteering/expenses` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/expenses?per_page=50` and `/api/v2/volunteering/my-organisations?per_page=50`, and renders the Blade-style expense totals, submit-claim form, status banners, and claims table. GET `/volunteering/emergency-alerts` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/emergency-alerts`, and renders the Blade-style urgent request cards, priority/status tags, metadata summary lists, status banners, and response forms. GET `/volunteering/group-signups` now redirects unsigned visitors to `/login?status=auth-required`, calls Laravel `/api/v2/volunteering/group-reservations`, and renders the Blade-style group reservation cards, member status table, leader add/remove member controls, cancel warning, and status banners. GET `/volunteering/training` and `/volunteering/incidents` now redirect unsigned visitors to `/login?status=auth-required`, call Laravel `/api/v2/volunteering/training` and `/api/v2/volunteering/incidents`, and render the Blade-style safeguarding tab navigation, training form/table, incident form/table, status tags, validation banners, and confidentiality notice. GET `/volunteering/waitlist` and `/volunteering/swaps` now redirect unsigned visitors to `/login?status=auth-required`, call Laravel `/api/v2/volunteering/my-waitlists`, `/api/v2/volunteering/swaps`, and `/api/v2/volunteering/shifts?limit=50`, and render the Blade-style waitlist cards, leave-waitlist forms, swap request form, sent/received swap cards, response controls, cancel controls, status tags, and banners. GET `/volunteering/my-organisations` and `/volunteering/recommended-shifts` now redirect unsigned visitors to `/login?status=auth-required`, call Laravel `/api/v2/volunteering/my-organisations?per_page=20` and `/api/v2/volunteering/recommended-shifts?limit=15&min_score=20`, and render the Blade-style role filter, organisation cards, dashboard links, pagination, recommended shift cards, match progress, applied tags, and opportunity links. POST aliases now cover `/volunteering/opportunities/{id}/apply`, shift signup/cancel, application withdrawal, hours, accessibility, certificate generation, waitlist leave, swaps, emergency alert responses, multipart credential upload/delete, wellbeing check-ins, donations, group reservation member/cancel actions, expenses, training, incidents, opportunity create, and organisation owner application/hour/settings/wallet actions through Laravel v2 volunteering APIs. Blade visual depth, credential download, tenant-prefixed routes, auth/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Organisations | 0 exact route gaps | none exact | Exact Laravel accessible organisation route declarations are now present locally. Directory/search and browse use `/api/v2/volunteering/organisations`; register GET renders the Blade-style form and validation status anchors; `/organisations` POST and `/organisations/register` POST validate required fields/terms, require signed auth, submit to `/api/v2/volunteering/organisations`, and use Laravel status redirects; manage GET reads `/api/v2/volunteering/my-organisations` when signed in; signed detail uses `/api/v2/volunteering/organisations/{id}?include=public_contract`, `/api/v2/volunteering/opportunities?organization_id={id}`, and `/api/v2/volunteering/reviews/organization/{id}`, while signed-out detail redirects to `/login?status=auth-required` before data lookup like Laravel; organisation jobs reads `/api/v2/jobs?organization_id={id}&status=open` when signed in; apply GET reads `/api/v2/volunteering/opportunities/{id}`, all with mocked contract tests. The organisation source templates now use `urlFor()` for local organisation, volunteering, and job links/forms, with source regression coverage and a focused render test. Auth enforcement depth, volunteering/job feature gates, tenant-prefixed routes, runtime registration persistence, apply confirmation depth, localization, and runtime certification are not complete. |
| Groups | 0 exact route gaps | none exact | Signed GET `/groups/{id}/invite` now renders the Blade-style invite page through Laravel-compatible group detail and invite listing data. Signed GET `/groups/{id}/notifications` now renders the Blade-style notification preference page through Laravel-compatible group detail and preference data. Signed GET `/groups/{id}/image` now renders the Blade-style group image page through Laravel-compatible group detail image fields. Signed GET `/groups/{id}/announcements` and `/groups/{id}/announcements/{annId}/edit` now render the Blade-style announcement list/create and edit pages through Laravel-compatible group and announcement APIs. Signed GET `/groups/{id}/discussions`, `/groups/{id}/discussions/new`, and `/groups/{id}/discussions/{discussionId}` now render the Blade-style discussion list/create/detail pages through Laravel-compatible group and discussion APIs. Signed GET `/groups/{id}/files` now renders the Blade-style group files page through Laravel-compatible group detail and file listing data. Signed GET `/groups/{id}/files/{fileId}/download` now proxies the Laravel-compatible binary download and preserves content type, disposition, length, cache, etag, and last-modified headers. Signed GET `/groups/{id}/manage` now renders the Blade-style group management page through Laravel-compatible group detail, member list, and pending-request APIs. POST aliases cover invite link/email/revoke, notification preferences, multipart image/file uploads, file delete, announcement create/update/delete/pin, discussion create/reply, group feed posts, member promote/demote/remove, and join request approve/reject through Laravel v2 group/feed APIs while preserving Laravel status redirects and fragments. Group action helper redirects now use `res.locals.urlFor` for auth and API-failure outcomes, and a shared-mount test proves failed notification preference saves redirect to `/acme/accessible/groups/{id}/notifications?status=prefs-failed`. Remaining gaps: owner/admin authorization depth, current-user filtering parity, tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Group exchanges | 0 | none exact | GET `/group-exchanges`, `/group-exchanges/new`, and `/group-exchanges/{id}` now render signed Laravel-backed list/create/detail pages through `/api/v2/group-exchanges`, `/api/v2/group-exchanges/{id}`, profile data, and `/api/v2/users/search` for the organiser participant picker, with unsigned auth redirects covered by tests. Those GET auth handoffs now route through `res.locals.urlFor`, with shared-mount coverage proving `/acme/accessible/group-exchanges`, `/acme/accessible/group-exchanges/new`, and `/acme/accessible/group-exchanges/7` redirect to the tenant-mounted login path before Laravel APIs are called. POST aliases cover `/group-exchanges/new`, participant add/remove, confirm, complete, and cancel through Laravel `/api/v2/group-exchanges` endpoints while preserving Laravel status redirects and `#group-exchange-top` fragments. Group-exchange action redirects now route through `res.locals.urlFor`, with shared-mount coverage proving invalid create submissions stay inside `/{tenantSlug}/accessible`. Remaining gaps: full organiser/participant authorization depth, same-tenant member search parity, time-credit settlement behavior, feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Feed typed engagement, post permalink, item permalink, and hashtag pages | 0 | none exact | Public GET `/feed/posts/{id}` calls Laravel-compatible `/api/v2/feed/posts/{id}` and renders the Blade-style post permalink page; public GET `/feed/item/{type}/{id}` calls Laravel-compatible `/api/v2/feed/items/{type}/{id}` and renders the Blade-style polymorphic feed-item permalink; public GET `/feed/hashtags` calls Laravel-compatible `/api/v2/feed/hashtags/trending` or `/api/v2/feed/hashtags/search`; public GET `/feed/hashtag/{tag}` calls Laravel-compatible `/api/v2/feed/hashtags/{tag}` and renders the Blade-style hashtag post list. Signed GET `/feed` now normalizes both Laravel `author` post rows and older local `user` rows before rendering. POST aliases cover `/feed/posts` including multipart image upload, `/feed/polls/{id}/vote`, `/feed/items/{type}/{id}/like|comments|not-interested|react`, `/feed/posts/{id}/update|delete|hide|report|react|share|save`, `/feed/comments/{id}/update|delete|react`, and `/feed/users/{id}/mute` through Laravel v2 feed/comment/reaction/share/saved APIs. Feed source templates now route feed compose/filter forms, hashtag links, post and item permalink links, like/comment/not-interested forms, author and group links, pagination, sign-in CTAs, `nextHref`, and internal deep links through `urlFor()` with source regression, focused render, and focused Laravel runtime-smoke coverage. Remaining gaps: exact offset pagination, full signed reaction controls, rich comments/reaction counts, tenant gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Marketplace/commerce | 0 | none exact | Browse, detail, create/edit listing, my listings, saved listings, free items, category listings, advanced search, seller profile, offers, orders, sales, pickups, seller onboarding, seller pickup-slot management, seller coupons, buy, offer, and report GET pages now render Laravel-backed marketplace pages through Laravel v2 marketplace listing/category/seller/offer/order/pickup/coupon/onboarding APIs; GET auth-required and Laravel-401 handoffs plus POST aliases now route through the active `res.locals.urlFor` helper for shared tenant mounts and custom-domain child paths. POST aliases cover `/marketplace/create`, listing image upload from the Blade-style create/edit form, listing update/delete/renew/save/unsave/buy/offer/report, offer accept/decline/withdraw, order ship/confirm/cancel/pay/rate, seller onboarding, pickup slot create/update/delete/scan, and seller coupon create/update/delete through Laravel v2 marketplace APIs. Marketplace offers and my-listings management controls now use `urlFor()` for tenant-aware source routing. Hosted no-JS Stripe checkout is represented by v2 payment-intent creation rather than an external Checkout redirect; merchant profile image uploads, tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. Courses have now moved to their own partial Laravel-backed GET and POST candidate below. |
| Courses | 0 | none exact | Browse, detail, certificate, lesson player, my learning, instructor dashboard, create/edit builder, analytics, and grading GET pages now render Laravel-backed course pages with `/api/v2/courses`, `/api/v2/me/courses`, prerequisites, reviews, progress, certificate, quiz, analytics, and grading queue APIs. Course source templates now route local course tabs, browse/search, course/prerequisite/certificate/learning links, review/enrolment/quiz/progress forms, instructor builder links/forms, publish/delete controls, and grading forms through `urlFor()` with source regression coverage and focused render tests. POST aliases cover learner enrol/review/progress/quiz actions and instructor course, section, lesson, publish, delete, and grading actions. Course route-level auth, validation, success, and API-error redirects now pass through `res.locals.urlFor` for tenant-aware shared mounts and custom-domain child paths. Remaining gaps: tenant feature-gate proof, localization beyond English strings, exact member-authoring/instructor policy rendering, runtime persistence smoke tests against a live Laravel backend, certificate HTML styling parity, discussion/cohort/group-link depth, multipart/media handling, and ASP.NET backend compatibility. |
| Podcasts | 0 | none exact | GET aliases now cover `/podcasts`, `/podcasts/{id}`, `/podcasts/{showId}/episodes/{id}`, `/podcasts/studio`, `/podcasts/studio/new`, and `/podcasts/studio/{id}` with Laravel v2 podcast browse/detail and authored-show APIs. POST aliases cover `/podcasts/{id}/subscribe`, `/podcasts/studio/new`, show update/publish/delete, and episode add/publish/delete including multipart audio uploads through Laravel v2 podcast APIs. Podcast source templates now route browse/studio links, search form, show and episode links, subscribe form, create/edit form actions, episode publish/delete/upload forms, show publish/delete forms, and studio management links through `urlFor()` with source regression, focused render, and focused Laravel runtime-smoke coverage. Podcast page auth redirects and podcast action redirects now route auth-required, validation, success, and API-failure outcomes through `res.locals.urlFor`. Remaining gaps: public Laravel web detail routes are numeric-ID based while the public v2 detail API is slug-oriented, tenant podcast-author configuration gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Events | 0 | none exact | Generated event GET preparation fallbacks are cleared. GET `/events/browse` renders the Blade-style category chooser with Laravel categories from `/api/v2/categories?type=event`; GET `/events/{id}/map` renders the Blade-style event location page through Laravel `/api/v2/events/{id}`, including address, coordinates, OpenStreetMap embed/links, and online/no-coordinate states; signed GET `/events/{id}/polls` renders the Blade-style organiser poll attachment page from `/api/v2/events/{id}` plus `/api/v2/polls?mine=1&per_page=100`, including status banners, attached tags, empty state, and the Laravel `poll_ids[]` form; signed GET `/events/{id}/translate` renders the Blade-style translation chooser from `/api/v2/events/{id}`, including status states, 11 locale options, source text, and the no-JS translate form; and signed GET `/events/{id}/recurring-edit` renders the Blade-style repeating-event scope edit page from `/api/v2/events/{id}`, including single/all scope radios, datetime-local fields, warning text, and upcoming occurrence links. POST aliases now cover `/events/{id}/waitlist`, `/events/{id}/waitlist/leave`, `/events/{id}/attendees/{attendeeId}/check-in`, `/events/{id}/polls`, `/events/{id}/polls/{pollId}/vote`, `/events/{id}/recurring-edit`, and `/events/{id}/translate` through Laravel v2 event, poll, and UGC translation APIs, with auth, validation, success, and failure redirects routed through `res.locals.urlFor` so mounted tenant and custom-domain contexts do not leak flat `/login` or `/events` locations. Focused Laravel runtime smoke passed for `/events/browse`, `/events/6`, `/events/6/polls`, and `/events/6/translate` against Web UK `127.0.0.1:5180` and Laravel `127.0.0.1:8088`. Create and edit forms now render Laravel-style multipart `image` file controls, proxy cover uploads to `/api/v2/events/{id}/image` after event create/update, load Laravel event categories through `/api/v2/categories?type=event`, include `category_id`, `is_online`, `online_link`, `allow_remote_attendance`, and `video_url` fields in create/update payloads, and list/detail/edit pages show the current Laravel cover image when returned. Event detail local links/actions now use the tenant-aware `urlFor()` helper for event, group, and member paths instead of literal root-relative source strings. The create form now renders Laravel recurrence controls and submits recurring creates through `/api/v2/events/recurring`. Remaining gaps: cover image removal is still blocked by the absence of a Laravel v2 clear/delete event-image contract, and rendered translation results after POST, full Blade list/detail parity, owner/participant authorization depth, notification/XP/waitlist promotion side effects, tenant gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Federation | 0 | none exact | The `/federation` hub now renders a Laravel-backed protected page using `/api/v2/federation/status`, `/api/v2/federation/partners`, and optional `/api/v2/federation/activity`; a Laravel `403` from the optional activity feed renders an empty activity list instead of taking down the hub, and scoped Laravel runtime smokes have passed `module-page-federation-renders`, most recently on 2026-07-09 against `WEB_UK_BASE_URL=http://127.0.0.1:5180`. The hub source template now routes service navigation, opt-in/opt-out CTAs, partner preview links, the view-all partners link, and quick links through `urlFor()` with source regression and focused render coverage. Route-level federation GET redirects now use `res.locals.urlFor` for signed-out handoffs, opt-in/settings shortcuts, and invalid/empty conversation fallbacks; focused shared-mount coverage proves `/acme/accessible/federation` redirects to `/acme/accessible/login?status=auth-required`. `/federation/partners` renders a Laravel-backed partner index; `/federation/partners/{id}` renders a Laravel-backed partner detail; `/federation/members` renders a Laravel-backed member index from `/api/v2/federation/members` plus partner filter options from `/api/v2/federation/partners`; `/federation/members/{id}` renders a Laravel-backed member detail from `/api/v2/federation/members/{id}`, `/api/v2/federation/settings`, and federation reviews when available; `/federation/members/{id}/transfer` renders the Blade-style transfer confirmation form using the member detail, federation settings, and wallet balance APIs; `/federation/settings` renders the Blade-style settings form from `/api/v2/federation/settings`; `/federation/opt-in` renders the Blade-style opt-in preferences form from `/api/v2/federation/settings` and `/api/v2/federation/partners`; `/federation/opt-out` renders the Blade-style opt-out confirmation form; `/federation/onboarding` renders the Blade-style four-step onboarding wizard from `/api/v2/federation/settings` plus partner previews from `/api/v2/federation/partners`, and the onboarding source template now routes its wizard back link, service navigation, step form actions, step-back links, and do-this-later links through `urlFor()` with source regression, focused render, and scoped Laravel runtime-smoke coverage. `/federation/listings` renders the Blade-style listings browse page from `/api/v2/federation/listings` plus partner filters from `/api/v2/federation/partners`; `/federation/listings/{tenantId}/{id}` renders a Blade-style listing detail by resolving the authorized listing from `/api/v2/federation/listings?partner_id=...` and checking member/settings APIs for the contact action; `/federation/groups` renders the Blade-style groups browse page from `/api/v2/federation/groups` plus partner filters from `/api/v2/federation/partners`; `/federation/events` renders the Blade-style events browse page from `/api/v2/federation/events` plus partner filters from `/api/v2/federation/partners`; `/federation/connections` renders the Blade-style tabbed connection list from `/api/v2/federation/connections`; `/federation/messages` renders the Blade-style conversation index from `/api/v2/federation/messages` plus settings; and `/federation/messages/conversation/{id}` renders the Blade-style conversation detail from `/api/v2/federation/messages`, marking unread inbound rows through `/api/v2/federation/messages/mark-read-batch`. Federation browse/messaging/settings/transfer source templates now route local links and forms through `urlFor()` with focused source and render/action coverage. A targeted Laravel runtime smoke on 2026-07-09 passed `19/19` checks for auth/cookie/logout setup, signed `/federation`, `/federation/connections`, `/federation/messages`, `/federation/settings`, `/federation/members/353/transfer`, and body markers for the changed federation pages. POST aliases cover connection request/accept/reject/remove, cross-tenant messages and translation, member transfer, onboarding, opt-in/out, and settings through Laravel v2 federation APIs, and their redirects now resolve through `res.locals.urlFor` so shared tenant mounts and custom-domain child paths do not leak flat `/federation` targets. Cross-tenant discovery depth, remote member profiles, moderation, tenant federation policy, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |

| Jobs | 0 exact route gaps | none exact | Browse/detail/saved/applications/mine/create/edit/owner-applicants/analytics/pipeline/qualified/alerts/responses/talent-search/talent-profile/employer-brand/employer-onboarding/bias-audit GET pages now call Laravel-compatible jobs/admin/user APIs where data is needed and render Blade-style browse filters, result cards, saved-opportunity removal, my-application filters, withdrawal forms, owner posting actions, create/edit form fields, summary lists, skills, apply forms with optional CV uploads, applicant analytics/stage controls, analytics summaries/predictions, pipeline columns, qualification breakdowns, job alert controls, interview invitations, offer response forms, talent search filters/cards, candidate profile summaries, employer profile/review/open-job summaries, employer posting guidance, bias audit filter/report tables, owner CSV export, application CV download, and application history timelines with signed-out redirects covered by tests. Job source templates now route jobs tabs, browse filters, saved/application/owner links, alerts, responses, detail save/apply/renew forms, employer-brand links, talent search/profile links, CSV/CV downloads, pagination, and variable form targets through `urlFor()` with source regression coverage, focused render tests, and focused Laravel runtime smoke for the signed jobs account subpages. POST aliases cover `/jobs`, job update/delete/renew, apply including multipart CV upload proxying, save/unsave, application status and withdrawal, alert create/pause/resume/delete, interview accept/decline, and offer accept/reject through Laravel v2 jobs APIs with Laravel status redirects. Jobs route-level auth, status, and failure redirects now resolve through `res.locals.urlFor`, with focused shared-mount coverage proving `/acme/accessible/jobs/42/apply` redirects to `/acme/accessible/login` before any Laravel Jobs API call. Remaining gaps: tenant/feature gates, localization, broader runtime behavior, and ASP.NET backend compatibility are not certified. |
| Ideation | 0 | none exact | GET `/ideation`, `/ideation/new`, `/ideation/{id}`, `/ideation/{id}/edit`, `/ideation/{id}/manage`, `/ideation/{id}/outcome`, `/ideation/{id}/drafts`, `/ideation/{id}/ideas/{ideaId}`, `/ideation/tags`, `/ideation/campaigns`, `/ideation/campaigns/{id}`, and `/ideation/outcomes` now render Laravel-backed challenge list/create/edit/manage/outcome-edit/drafts/detail/idea-detail/tag/campaign/campaign-detail/outcome pages through `/api/v2/ideation-challenges`, `/api/v2/ideation-categories`, `/api/v2/ideation-templates`, `/api/v2/ideation-challenges/{id}`, `/api/v2/ideation-challenges/{id}/ideas?limit=30&sort=votes`, `/api/v2/ideation-challenges/{id}/ideas?limit=100&sort=votes`, `/api/v2/ideation-challenges/{id}/ideas/drafts`, `/api/v2/ideation-challenges/{id}/outcome`, `/api/v2/ideation-ideas/{ideaId}`, `/api/v2/ideation-ideas/{ideaId}/comments?per_page=30`, `/api/v2/ideation-ideas/{ideaId}/media`, `/api/v2/ideation-tags/popular`, `/api/v2/ideation-campaigns`, `/api/v2/ideation-campaigns/{id}`, and `/api/v2/ideation-outcomes/dashboard`, with unsigned auth redirects covered by tests and now routed through `res.locals.urlFor` for shared tenant mounts and custom-domain child paths; scoped Laravel runtime smoke passed all 12 flat ideation auth-required redirects and temp-process assertions proved selected `/{tenantSlug}/accessible/ideation...` redirects use the tenant-mounted login path. Ideation source templates now route their local tabs, filters, links, and form actions through `urlFor()`. POST aliases now cover challenge create/update/status/favorite/duplicate/delete/link campaign/outcome, idea submit/draft/comment/comment delete/vote/status/media/convert/delete, and campaign create/update/unlink/delete through Laravel v2 ideation APIs. Ideation action redirects now route through `res.locals.urlFor`, with shared-mount coverage proving create submissions stay inside `/{tenantSlug}/accessible`. Remaining gaps: admin authorization depth, media upload proxying, team conversion runtime behavior, tenant/feature gates, localization, runtime behavior, and ASP.NET backend compatibility are not certified. |
| Settings | 0 | none exact | `/settings/appearance` now renders the Blade-style theme page with unsigned auth redirect, status states, theme radios, current-theme fallback, and the existing Laravel-compatible appearance POST alias. `/settings/availability` renders the Blade-style weekly availability grid with unsigned auth redirect, status states, and the existing Laravel-compatible availability POST alias. `/settings/linked-accounts` renders the Blade-style incoming/managed account sections, empty states, link request form, relationship choices, permission checkboxes, status states, and existing Laravel-compatible linked-account POST aliases. `/settings/data-rights` renders the Blade-style data-rights request page with unsigned auth redirect, status banners, request-type radios, notes field, empty request-history state, and the existing Laravel-compatible GDPR request POST alias. `/settings/insurance` renders the Blade-style certificate list, empty state, status banners, upload form, and existing Laravel-compatible multipart insurance upload alias through `/api/v2/users/me/insurance`. Settings route-level auth, validation, success, and API-error redirects now pass through `res.locals.urlFor` for tenant-aware shared mounts and custom-domain child paths, with source regression plus focused action-alias coverage. Remaining GET settings pages, data-rights history loading, tenant feature gates, localization, insurance upload/list runtime smoke behavior, and ASP.NET backend compatibility are not certified. |

## Next Certification Work

Volunteering certificate/credential source update, 2026-07-10: the
certificate and credential templates now route their local back links, generate
form, certificate download links, credential upload form, and credential delete
forms through `urlFor()`, with focused source coverage in
`tests/template-source.test.js`. This is source-level tenant/custom-domain
helper proof only; visual parity, live feature-gate proof, localization, and
ASP.NET backend compatibility remain uncertified.

Volunteering owner-page update, 2026-07-07: the generated route matrix now maps
`/volunteering/organisations/{id}/dashboard`, `/manage`, `/settings`,
`/volunteers`, and `/wallet` to `src/routes/volunteering-actions.js` and the
`src/views/volunteering/org-*.njk` templates rather than the generated
preparation fallback. These pages use Laravel v2 volunteering owner contracts
for stats, applications, pending hours, volunteers, wallet summary,
transactions, and organisation details. Live tenant/feature-gate behavior,
runtime persistence, localization, and ASP.NET backend compatibility are still
uncertified.

For each family, create a module matrix with:

- Laravel route name and method/path.
- Blade view file.
- Web UK Express route and Nunjucks view.
- Backend API calls used by that page.
- Request, response, redirect, validation, CSRF, auth, tenant, feature-gate, and
  localization behavior.
- Laravel-first runtime evidence from the verified disposable environment.
- Separate later unchanged-Web-UK runtime switching result against ASP.NET,
  after the backend workstream declares its contract gate ready.

Use `docs/generated/accessible-route-matrix.md` or its JSON companion as the
working backlog seed. They include the Laravel handler, inferred Blade view,
auth classification, feature/module gates, API/service hints, and current
`apps/web-uk` implementation where a static method/path match exists.

Missing Laravel GET routes are also served by
`src/routes/laravel-prep-pages.js` after all real route modules only when the
generated matrix marks those rows as `missing`. Read the generated artifact for
the live missing-method mix and preparation-page total. Any future generated
prep page is a deliberate discoverability fallback
only; it prevents a 404 while preserving the gap, but it does not certify page
workflow parity.
