# Web UK Tenant Routing Parity

Last reviewed: 2026-07-14

Status: **Maintained reference — tenant-routing evidence, not the current aggregate**

This note records the Laravel tenant-routing contract that `apps/web-uk` must
clone before it can be called tenant-domain parity complete.

`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` is the sole current coordination and
scoring source. Counts and smoke outcomes in the chronological body below are
dated implementation checkpoints, not the current aggregate. This routing note
intentionally does not mirror the live route inventory, score, blocker set, or
test aggregate; read the canonical status and generated route artifact at
reporting time.

**Runtime safety:** every `smoke:laravel` command in this document includes or
may include authentication and state writes. It may run only after
`LARAVEL_BASE_URL` is explicitly pointed at a separately provisioned, verified
disposable Laravel application/database/storage environment. Never run it
against the ordinary `127.0.0.1:8088` production-derived Laravel snapshot;
authorization, unique fixtures, cleanup, or restoration logic do not make that
environment disposable.

Any historical authenticated or stateful result below that used the ordinary
Laravel environment is invalid as certification regardless of older “passed”
or “current” wording. Retain it only as regression-discovery history.

## Laravel Source Of Truth

Read these Laravel files before changing Web UK tenant routing:

- `C:\platforms\htdocs\staging\routes\govuk-alpha.php`
- `C:\platforms\htdocs\staging\app\Core\TenantContext.php`
- `C:\platforms\htdocs\staging\app\Http\Middleware\EnsureAccessibleCustomDomain.php`
- `C:\platforms\htdocs\staging\app\Http\Middleware\InjectHostTenantSlug.php`
- `C:\platforms\htdocs\staging\app\Http\Middleware\StripTenantSlugOnAccessibleDomain.php`
- `C:\platforms\htdocs\staging\app\Http\Controllers\GovukAlpha\AlphaController.php`
- `C:\platforms\htdocs\staging\app\Http\Controllers\Api\TenantBootstrapController.php`

Laravel registers the same accessible route set twice:

1. Shared platform hosts use the canonical `/{tenantSlug}/accessible/...`;
   the path identifies the tenant. `/{tenantSlug}/alpha/...` is legacy redirect
   compatibility only (301 for GET/HEAD and method-preserving 308 otherwise).
2. Dedicated accessible custom domains use slugless paths; the host identifies
   the tenant through `tenants.accessible_domain`, Laravel injects the route
   tenant slug for controller compatibility, and the public route stays at the
   bare host root.

Laravel root behavior is also tenant-aware:

- Shared root `/` renders the tenant chooser.
- A dedicated accessible custom-domain root `/` renders that tenant's accessible
  home. Laravel bootstrap may expose either `accessible_domain` or the broader
  tenant `domain`, depending on fixture/source path.
- The master tenant is seeded as ID `1` and is excluded from the chooser. When
  Laravel bootstrap exposes a configured master domain, such as
  `project-nexus.ie` locally, that host should render the master network landing
  instead of the shared chooser.
- Parent custom-domain routing can resolve direct child tenants from the first
  non-reserved path segment, for example `parent-domain.test/child-slug`.
- `/api/v2/tenant/bootstrap?slug={slug}` is the public Laravel data source for
  tenant metadata. Its payload includes `domain`, `accessible_domain`, and
  `parent_domain` when those are configured.

## Web UK Canonical Public Slug

Laravel and Web UK both use `/accessible` as the canonical shared-host mount.
Neither comparator evidence nor new public links may treat `/alpha` as the
source route; it is retained only to verify permanent legacy redirects.

Current implemented slice:

- `GET /{tenantSlug}/accessible` and nested paths are stripped to the existing
  flat Express route set for local route matching.
- `GET /{tenantSlug}/alpha...` redirects permanently to the same
  `/{tenantSlug}/accessible...` path.
- The shared shell locals now expose `urlFor()` and prefix header, service-nav,
  footer, cookie, report-problem, and home-page CTA links under the active
  shared mount.
- Shared-mount local redirects are rewritten back under
  `/{tenantSlug}/accessible`, so auth redirects such as `/dashboard` to
  `/login` stay inside the tenant-visible accessible path.
- Rendered HTML responses under the shared mount rewrite local root-relative
  `href` and `action` attributes to the active `/{tenantSlug}/accessible`
  prefix while leaving assets, API paths, health checks, service-worker paths,
  uploads, and other infrastructure URLs unprefixed.
- Shared root `/` renders the Laravel-style tenant chooser backed by
  `/api/v2/tenants` without `include_master`, excludes the master tenant, and
  links communities to the cleaner `/{tenantSlug}/accessible` mount. The
  normalized chooser list is sorted by display name to mirror Laravel Blade's
  `AlphaController::tenantChooser()` query, which orders active non-master
  tenants by `name`.
- Tenant-mounted roots render the Laravel Blade-style tenant home instead of
  the old generic Web UK home. Shared mount `/{tenantSlug}/accessible` loads
  tenant bootstrap and tenant-scoped public platform stats, renders the
  `Accessible` page, and rewrites links under the active shared mount. Web UK
  forwards the active tenant slug to Laravel `/api/v2/platform/stats` with
  `X-Tenant-Slug`, matching Laravel's path-resolved `TenantContext`.
- Non-local Host values are resolved through Laravel
  `/api/v2/tenant/bootstrap`; when Laravel returns a tenant whose
  `accessible_domain` matches the request host, Web UK treats non-root
  requests as slugless accessible custom-domain routes. Ordinary tenant
  `domain` hosts keep Laravel's root/network and parent-domain child behavior,
  but reserved slugless accessible pages such as `/login` remain 404 unless the
  host is the tenant's `accessible_domain`. `X-Forwarded-Host` is accepted
  before the socket host for reverse-proxy custom-domain routing.
- Dedicated custom-domain root `/` renders the resolved tenant home for both
  Laravel host-resolved `domain` and `accessible_domain` contexts and keeps
  generated local links flat, matching Laravel's custom-domain behavior without
  exposing either `/alpha` or `/{tenantSlug}/accessible`. For this mode, Web UK
  forwards the resolved Host and Origin to Laravel `/api/v2/platform/stats` and
  `/api/v2/tenant/bootstrap` so host-resolved tenant stats use the same lookup
  path as Laravel's accessible runtime.
- On a dedicated accessible custom-domain host, requests that arrive with the
  matching tenant's legacy `/{tenantSlug}/alpha/...` prefix or Web UK's shared
  `/{tenantSlug}/accessible/...` prefix now canonicalize to the slugless
  custom-domain path. Ordinary `domain` hosts do not perform this
  canonicalization for reserved accessible pages. This mirrors Laravel's
  `StripTenantSlugOnAccessibleDomain` response behavior while keeping Web UK's
  public shared-host slug clean.
- Master and parent/cluster custom-domain roots render Laravel SEO h1/intro
  copy plus `tenant_switcher` communities. Same-host switcher URLs are converted
  to relative paths, while external community domains remain absolute.
- Parent-domain child tenant paths now resolve the first non-reserved path
  segment through Laravel `/api/v2/tenant/bootstrap?slug={slug}`. When Laravel
  returns `parent_domain` matching the request host, Web UK serves the flat
  accessible app below `/{childSlug}` and rewrites local links and redirects to
  remain under that child path. This mirrors Laravel's parent custom-domain
  child resolution without exposing either `/alpha` or `/accessible`.
- The parent-domain child guard now mirrors Laravel
  `TenantContext::getReservedPaths()` for platform, auth, public-info, admin,
  system, and legacy reserved first segments. Reserved paths such as `/classic`
  stay host-scoped platform paths and no longer trigger a child-tenant
  `/api/v2/tenant/bootstrap?slug=classic` probe. The reserved list is now exact
  rather than broader than Laravel's list, so Laravel-unreserved route-looking
  names such as `gardeners` can still resolve as child tenant slugs when Laravel
  returns a matching `parent_domain`.

Current gaps:

- A 2026-07-10 source audit and remediation found no tenant-local direct
  root-relative `href`/`action` attributes in `src/views`, no object-style
  `href: "/"` or `action: "/"` targets in Web UK source, and no raw
  root-relative `res.redirect("/...")` calls in `src/middleware`, `src/lib`,
  `src/routes`, or `src/server.js`. The only direct root paths allowed by the
  app-wide Nunjucks regression are the intentional `/assets/` and `/css/`
  public resources.
  Helper-mediated redirects still pass local paths into `urlFor()` and must
  remain covered by route-family tests. Keep these audits green as regression
  guards when adding or replacing Blade-clone templates. Earlier focused
  source conversion covers `src/views/events/detail.njk`, including
  breadcrumbs, group/member links, RSVP/admin forms, attendee links, and the
  report return path. The next focused source conversion covers
  `src/views/account.njk`, including account card links and the CSRF-protected
  logout form action. The following focused source conversion covers the
  activity dashboard and insights templates, including the detailed-insights
  link and back-to-activity links. The latest focused source conversion covers
  the achievements/gamification templates, including tabs, back links, daily
  reward/challenge/purchase/showcase forms, badge collection links, and badge
  detail links. The newest focused source conversion covers the leaderboard
  and NEXUS score templates, including tabs, back links, filter forms,
  load-more links, tier links, and member profile links. The latest
  leaderboard/NEXUS score route-redirect cleanup sends unsigned and Laravel-401
  auth handoffs through `res.locals.urlFor`, keeping those GET exits inside
  shared tenant mounts and custom-domain child paths. The latest focused
  source conversion covers the profile and settings templates, including
  profile summary links, settings card links, profile/security/privacy forms,
  two-step verification actions, blocked member unblock forms, delete-account
  controls, and settings appearance, availability, data-rights,
  linked-account, and insurance form actions. The latest focused settings
  route-redirect cleanup sends appearance, availability, data-rights,
  linked-account, and insurance auth, validation, success, and API-error
  redirects through `res.locals.urlFor`, keeping no-JS settings outcomes inside
  shared tenant mounts and custom-domain child paths. The latest focused
  profile route-redirect cleanup sends settings, profile summary, email,
  password, language, notifications, passkey, personalisation, match-preference,
  skill, safeguarding, data-export, delete-account, blocked-member, and
  two-factor auth/status redirects through `res.locals.urlFor`, keeping no-JS
  profile outcomes inside shared tenant mounts and custom-domain child paths.
  The latest member-onboarding source conversion covers the wizard step forms
  and confirm-page change links, keeping welcome, avatar, profile, interests,
  skills, safeguarding, and confirm controls behind `urlFor()` for shared
  mounts and custom-domain child paths.
  The latest public-info/legal/support/cookie source conversion covers About,
  Guide, Features, email verification, Help, Trust and safety, legal
  document/accessibility fallback links, the standalone privacy contact link,
  and cookie-banner links/forms through `urlFor()`.
  The latest focused source
  conversion covers group detail, listing detail, member profile, and the
  shared report-link partial, including breadcrumbs, action controls, report
  return targets, listing report links, member connection controls, and member
  review actions. The latest focused source conversion covers marketplace
  offers and my-listings management templates, including offer tabs, dynamic
  listing links, offer decision forms, my-listings tabs, create/view/edit
  links, and renew/delete forms. The latest focused source conversion also
  covers marketplace browse, detail, buyer-action, search, seller profile, and
  onboarding templates, including browse tabs, listing/card/category links,
  search and category filter forms, listing detail buy/offer/save/report
  controls, buyer buy/offer/report forms, listing create/edit form actions,
  seller profile links, and seller onboarding controls. The latest focused
  source conversion also covers marketplace coupon, order, and pickup-slot
  management templates, including coupon links/forms, order tabs and actions,
  and pickup-slot scan/edit/delete forms. The marketplace source-template
  family now has source-level `urlFor()` coverage for local marketplace links
  and forms. The latest marketplace page redirect cleanup sends signed-out GET
  auth handoffs and Laravel-401 marketplace page handoffs through
  `res.locals.urlFor`, keeping marketplace page exits inside shared tenant
  mounts and custom-domain child paths. The latest focused source conversion covers the federation hub
  template, including service navigation, opt-in/opt-out CTAs, partner preview
  links, the view-all partners link, and quick links. The latest focused source
  conversion covers the federation onboarding wizard, including the back link,
  service navigation, step form actions, step-back links, and do-this-later
  links. The opted-out hub CTA now enters that mounted wizard, and focused
  multi-request coverage proves its tenant-keyed session choices remain
  isolated across `/acme/accessible` and `/beta/accessible` before a
  confirm-only POST. The federation member detail template conversion covers the back link, federation service navigation,
  opt-in CTA, connection/message forms, and transfer CTA. The latest focused
  federation route-redirect cleanup sends signed-out GET handoffs,
  opt-in/settings shortcuts, and invalid/empty conversation fallbacks through
  `res.locals.urlFor`, with shared-mount coverage proving
  `/acme/accessible/federation` redirects to the tenant-mounted login path.
  The latest focused federation browse/messaging/settings/transfer source
  conversion covers connections, conversations, events, groups, listings,
  member browse, messages, opt-in/out, partner list/detail, settings, and
  transfer templates. Federation POST action redirects now send connection,
  message, translation, transfer, onboarding, opt-in/out, and settings outcomes
  through `res.locals.urlFor`.
  The latest focused group source conversion covers group announcement edit,
  discussion, invite, image, notification, manage, member, and file local
  links/forms through `urlFor()`, and group route-level redirects now resolve
  through `res.locals.urlFor` so auth handoffs, API-failure POST outcomes, and
  file-download auth exits stay inside shared tenant mounts and custom-domain
  child paths. Focused source coverage plus a shared-mount group notification
  API-failure test guard the central helper against flat or double-prefixed
  redirects. The latest focused group/volunteering
  source conversion also covers volunteering recommended shifts, including
  recommended opportunity links.
  The latest public volunteering source conversion covers the public
  volunteering landing/search template and opportunity detail template,
  including filters, organisation links, opportunity links, load-more links,
  and apply CTAs. The latest volunteering route-redirect cleanup sends
  volunteering auth-required, validation, success, and failure redirects
  through `res.locals.urlFor`, including the central action helper and direct
  validation branches. The latest volunteering certificate/credential source
  conversion routes certificate back, generate, and download controls plus
  credential back, upload, and delete controls through `urlFor()`.
  The latest focused
  source conversion covers the connections index and network templates,
  including tabs, pending-request links, member links, action forms,
  empty-state member CTAs, pagination, search form, load-more links, and
  route-provided card links/actions. The latest focused source conversion
  covers the notifications index template, including breadcrumbs, filters,
  read/delete form actions, redirect hidden values, pagination, and the unread
  empty-state CTA. The latest focused source conversion covers the group
  exchange list/create/detail templates, including the create CTA, status tabs,
  detail links, create form, participant add/remove/search forms, confirmation
  form, and complete/cancel actions. The latest focused source conversion
  covers saved item, saved collection, and saved social templates, including
  saved-item filters, bookmark removal, item links, collection list/detail
  links, pagination, create/update/delete forms, collection item removal,
  public collection profile links, appreciation send/reaction forms, and
  appreciation pagination. The latest focused source conversion covers jobs
  templates, including tabs, browse filters, saved/application/owner links,
  alerts, responses, detail actions, employer pages, talent search/profile
  links, CSV/CV downloads, pagination, and job POST forms. The latest focused
  Jobs route-redirect cleanup sends create/update/delete/renew/apply/save/
  unsave, application status/withdrawal, alert, interview, offer, and owner CSV
  failure redirects through `res.locals.urlFor`, with shared-mount coverage
  proving `/acme/accessible/jobs/42/apply` redirects to the tenant-mounted
  login path before any Laravel Jobs API call. The latest
  fallback-link conversion covers newsletter-unsubscribe and error-page home
  links, replacing raw `href="/"` with `urlFor('/')`; broad raw-link source
  scans are still useful backlog discovery because some route families continue
  to contain root-relative local targets. The latest focused source conversion
  covers AI chat and matches templates, including AI chat back/conversation/new-conversation
  links, chat form actions, matches filters, board links, listing/group/event
  links, dismiss forms, empty-state CTAs, and back links. A shared pagination
  partial cleanup now changes the documented/default members pagination base
  URL from raw `/members` to `urlFor('/members')`, so omitted `baseUrl`
  fallbacks stay tenant-aware. A shared empty-state/breadcrumb partial cleanup
  now routes empty-state primary/secondary action hrefs through `urlFor()` and
  updates breadcrumb examples to use tenant-aware local paths. A focused AI
  chat route-redirect cleanup now sends auth-required, empty-message, and
  post-send redirects through `res.locals.urlFor`. A focused matches
  route-redirect cleanup now sends match dismiss and board dismiss redirects
  through `res.locals.urlFor`.
- Custom-domain routing is covered by Jest for host-resolved root requests,
  including Laravel `domain`, `accessible_domain`, master-domain, cluster-domain,
  forwarded-host, and host-scoped platform-stats lookup behavior. Direct live
  Laravel bootstrap calls and a direct Web UK middleware harness resolve
  `timebank.global` and `project-nexus.ie` correctly. Full temporary Web UK
  process smokes now also cover
  `project-nexus.ie|/=>Build Thriving Communities with NEXUS` and
  `timebank.global|/=>Exchange Skills Across Borders` with `TENANT_ID=2`;
  host-scoped bootstrap/stats calls suppress that default `X-Tenant-ID` so
  Laravel resolves from Host/Origin instead.
- Parent-domain child-tenant paths are covered by Jest for a parent-host child
  login page and by live Laravel runtime smoke against the local
  `hour-timebank` fixture, whose public bootstrap payload includes
  `parent_domain: timebank.global`.
- Laravel-reserved parent-domain path handling is covered by Jest for the full
  current set. The 2026-07-10 refresh added behavior cases for the 21 new
  Laravel segments and proved none triggers a child-slug bootstrap probe.
  Unreserved handling is covered by `parent-domain.test/gardeners/login`,
  which still resolves through `getTenantBootstrap({ slug: "gardeners" })`.
  `tests/tenant-routing-source.test.js` now compares Web UK's exported
  reserved child-segment set with Laravel `TenantContext::getReservedPaths()`,
  and currently reports no Web UK-only or Laravel-only reserved child
  segments.
- Shared tenant-root home rendering is covered by Jest and a scoped live
  Laravel smoke against `/hour-timebank/accessible`, checking `Accessible`,
  `Connecting Communities`, and `What you can do` in the rendered page body.
- Tenant-scoped home stats are covered by focused Jest for shared-mount slug
  routing and custom accessible-domain host routing. A live local Laravel check
  on 2026-07-08 for `/hour-timebank/accessible` rendered the tenant-scoped
  stats from `X-Tenant-Slug=hour-timebank`: `946` members, `1,988` hours
  exchanged, `129` listings, and `1` community.

## First Verified Slice

The first shared-mount runtime test is in:

```text
apps/web-uk/tests/routes.test.js
```

It verifies that `/acme/accessible` renders the existing home page with prefixed
shell links and that `/acme/alpha/login?status=auth-required` redirects to
`/acme/accessible/login?status=auth-required`.

The second shared-mount runtime slice verifies that protected-route redirects
and rendered login-page form/link targets remain under
`/acme/accessible/...` instead of escaping to flat root paths.

The third shared-root slice verifies that `/` renders Laravel's tenant chooser,
excludes the master tenant, and links active communities to
`/{tenantSlug}/accessible` instead of Laravel's legacy alpha mount.

The fourth tenant-domain slice verifies that a non-local Host resolved by
Laravel tenant bootstrap as `accessible_domain` renders the tenant home at
slugless `/`, does not render the tenant chooser, and does not leak
`/{tenantSlug}/accessible` or `/{tenantSlug}/alpha` into root-page links.

The fifth parent-domain child slice verifies that
`parent-domain.test/{childSlug}/login` resolves `{childSlug}` through Laravel
tenant bootstrap, renders the child tenant's login page, keeps form and
registration links under `/{childSlug}`, and does not leak either `/alpha` or
`/accessible`.

The sixth runtime-smoke slice adds `SMOKE_TENANT_DOMAIN_PAGE_PATHS` to
`scripts/laravel-runtime-smoke.js`. Each entry uses
`host|/path=>Expected text`, sends the request to `WEB_UK_BASE_URL` with a real
HTTP `Host` header, asserts the expected body text, and rejects generated
`/alpha` or `/accessible` links. On 2026-07-08, a live run against Laravel
`http://127.0.0.1:8088` and a temporary Web UK process at
`http://127.0.0.1:6320` passed with
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/hour-timebank/login=>Sign in`.
The emitted check was
`tenant-domain-page-timebank-global-hour-timebank-login-renders`.

The seventh tenant-home slice verifies that `/{tenantSlug}/accessible` renders
Laravel's Blade-style tenant home, including tenant name, tagline, module
availability, sign-in status, and platform stats. A scoped live smoke on
2026-07-08 against Laravel `http://127.0.0.1:8088` and temporary Web UK
`http://127.0.0.1:6330` passed body-text checks for
`/hour-timebank/accessible=>Accessible`,
`/hour-timebank/accessible=>Connecting Communities`, and
`/hour-timebank/accessible=>What you can do`.

The eighth tenant-home stats slice verifies that Web UK does not fetch
platform-wide stats for tenant home pages. Shared-mount requests now call
Laravel `/api/v2/platform/stats` with the active `X-Tenant-Slug`, while
custom accessible-domain requests call the same endpoint with the resolved
request `Host`. Focused Jest covers both request shapes, and a live local
Laravel proof on 2026-07-08 rendered `/hour-timebank/accessible` with the
tenant-scoped stat values `946`, `1,988`, `129`, and `1`.

The ninth host-domain network landing slice verifies that Laravel `domain`
hosts are treated as custom root hosts, not only `accessible_domain` hosts.
Tests cover `timebank.global` rendering the Timebank Global cluster landing,
`project-nexus.ie` rendering the master network landing, and `X-Forwarded-Host:
timebank.global` resolving ahead of a local socket host. The page uses Laravel
SEO h1/intro text and `tenant_switcher` communities, converts same-host
community links to relative paths, preserves external domains, and never emits
the legacy `/alpha` slug. API tests also prove host-scoped bootstrap/stats
calls send `Origin: https://{host}` with the normalized Host.

The tenth host-root runtime slice fixes the live-process gap that Jest did not
cover: local Laravel runtime smokes start Web UK with `TENANT_ID=2` for auth,
but that default tenant id was being added to host-scoped public bootstrap and
platform stats calls. Laravel prioritizes `X-Tenant-ID`, so the full process
received `hour-timebank` bootstrap data and fell back to the shared chooser for
`Host: timebank.global`. Web UK now omits `X-Tenant-ID` whenever Host/Origin
tenant context is present. A focused smoke on 2026-07-08 against temporary Web
UK `http://127.0.0.1:6426` and Laravel `http://127.0.0.1:8088` passed
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/=>Exchange Skills Across
Borders`, emitting `tenant-domain-page-timebank-global-home-renders`. A
follow-up focused smoke on 2026-07-09 against temporary Web UK
`http://127.0.0.1:6521` and Laravel `http://127.0.0.1:8088` passed both
`project-nexus.ie|/=>Build Thriving Communities with NEXUS` and
`timebank.global|/=>Exchange Skills Across Borders`, emitting
`tenant-domain-page-project-nexus-ie-home-renders` and
`tenant-domain-page-timebank-global-home-renders` with no `/alpha` or
`/accessible` link leakage.

The visual-domain guard adds `npm run visual:blade` as a repeatable
tenant/home spot-check. The command compares canonical Laravel Blade
`/hour-timebank/accessible` with Web UK `/hour-timebank/accessible` for the tenant
home markers, then checks Web UK `project-nexus.ie` and `timebank.global`
custom-domain roots with real Host headers. The master and cluster expected
headings are sourced from Laravel `/api/v2/tenant/bootstrap` using matching
Host/Origin headers because the local Laravel Blade host-route proof is covered
by Laravel's synthetic accessible-domain test fixture rather than by direct
production-host HTML. A live run on 2026-07-10 against temporary Web UK
`http://127.0.0.1:6661`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed all three checks with no `/alpha` or `/accessible` leakage on host-root
responses. This is visual/domain guard evidence only; it is not full
route-family visual parity or ASP.NET backend certification.

The same guard now also covers shared-mount public/auth/support/legal pages:
`/login`, `/register`, `/login/forgot-password`,
`/password/reset?token=reset-token`, `/contact`, `/cookies`, `/about`,
`/guide`, `/features`, `/faq`, `/help`, `/trust-and-safety`,
`/accessibility`, `/legal`, `/legal/privacy`, and `/report-a-problem`. Each
check compares canonical Laravel `/{tenantSlug}/accessible/...` with Web UK
`/{tenantSlug}/accessible/...` using Laravel-rendered page markers and asserts
that Web UK HTML does not contain `/{tenantSlug}/alpha`. A live run on
2026-07-10 against temporary Web UK `http://127.0.0.1:6662`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed all 19 default
`visual:blade` checks. This is shared-mount visual/slug evidence for those
public pages only; signed module pages and POST side effects still need their
own visual/workflow proof.

The account template-helper source slice extends the direct `urlFor()`
conversion from event detail into the account hub. `src/views/account.njk` now
passes `accountLinks` card targets and the `/logout` form action through
`urlFor()`, with a source-level regression in
`tests/template-source.test.js` plus a focused account render test proving the
flat `/account` output remains unchanged.

The activity template-helper source slice extends the same direct `urlFor()`
conversion into activity pages. `src/views/activity/index.njk` now passes the
detailed-insights link through `urlFor('/activity/insights')`, and
`src/views/activity/insights.njk` passes both back-to-activity links through
`urlFor('/activity')`. A source-level regression plus focused activity render
tests prove the flat `/activity` and `/activity/insights` output remains
unchanged.

The seventy-seventh route-redirect slice extends route-level tenant awareness
into the activity family. `src/routes/activity.js` now routes unsigned
activity dashboard and insights auth handoffs through `res.locals.urlFor`,
matching Laravel's named login route behavior for shared tenant mounts and
custom-domain contexts. The focused source regression first failed because the
route still emitted direct `res.redirect(loginRedirect())`, then passed after
conversion. Shared-mount behavior coverage proves unsigned
`/acme/accessible/activity` and `/acme/accessible/activity/insights` requests
redirect to `/acme/accessible/login?status=auth-required`.

The thirteenth template-helper source slice extends the same direct `urlFor()`
conversion into the achievements and gamification pages. The achievements
index, XP shop, collections, engagement history, showcase, and badge detail
templates now pass their tabs, back links, daily reward form, challenge claim
forms, shop purchase form, showcase save form, collection badge links, and
view-all links through `urlFor()`. A source-level regression plus focused
achievements/gamification render tests prove the flat `/achievements` family
output remains unchanged.

The fourteenth template-helper source slice extends the same direct `urlFor()`
conversion into leaderboard and NEXUS score pages. The leaderboard index,
competitive, seasons, journey, spotlight, NEXUS score overview, and NEXUS tier
ladder templates now pass tabs, back links, filter form actions, load-more
links, tier links, and data-driven member profile links through `urlFor()`. A
source-level regression plus focused leaderboard/NEXUS score render tests prove
the flat `/leaderboard` and `/nexus-score` family output remains unchanged.
The follow-up route-redirect slice moves the same family's unsigned and
Laravel-401 auth handoffs through `res.locals.urlFor`, with source regression
coverage guarding against raw `res.redirect(loginRedirect())` calls returning.

The fifteenth template-helper source slice extends the same direct `urlFor()`
conversion into the profile and settings pages. The profile summary, profile
settings, two-step verification, blocked-members, delete-account, appearance,
availability, data-rights, linked-accounts, and insurance templates now pass
their local links and form actions through `urlFor()`, including settings hub
card links and dynamic member unblock forms. A source-level regression plus
focused profile/settings render tests prove the flat `/profile` and
`/settings/*` output remains unchanged.

The sixteenth template-helper source slice extends the same direct `urlFor()`
conversion into group detail, listing detail, member profile, and the shared
report-link partial. Those templates now pass detail breadcrumbs, edit/delete/
join/leave/member/review actions, report return targets, listing report links,
member connection controls, and member review form targets through `urlFor()`.
A source-level regression plus focused group/listing/member/report render tests
prove the flat `/groups`, `/listings`, `/members`, and `/report-a-problem`
output remains unchanged.

The seventeenth template-helper source slice extends the same direct `urlFor()`
conversion into the marketplace offer and my-listings management pages.
`src/views/marketplace/offers.njk` now passes offer tabs, dynamic listing
links, and accept/decline/withdraw forms through `urlFor()`;
`src/views/marketplace/manage.njk` now passes my-listings tabs, create/view/edit
links, and renew/delete forms through `urlFor()`. A source-level regression
plus focused marketplace render tests prove the flat `/marketplace/offers` and
`/marketplace/mine` output remains unchanged.

The eighteenth template-helper source slice extends direct `urlFor()`
conversion into the marketplace browse, detail, buyer-action, search, seller
profile, and onboarding templates. `src/views/marketplace/_nav.njk`,
`_listing-card.njk`, `index.njk`, `listing-list.njk`, `detail.njk`,
`buy.njk`, `offer.njk`, `report.njk`, `form.njk`, `search.njk`, `seller.njk`,
and `onboarding.njk` now route browse tabs, listing/card/category links, search
and category filter forms, listing detail buy/offer/save/report controls,
buyer buy/offer/report forms, listing create/edit form actions, seller profile
links, and seller onboarding controls through `urlFor()`. A source-level
regression plus focused marketplace render tests prove the flat marketplace
output remains unchanged. At that point the remaining marketplace
source-template conversion work was narrowed to coupon, order, and pickup-slot
management templates.

The nineteenth template-helper source slice closes that remaining marketplace
source-template gap. `src/views/marketplace/coupons.njk`, `coupon-form.njk`,
`orders.njk`, `slots.njk`, `slot-form.njk`, and `_slot-form.njk` now route
coupon links and forms, order tab links, order ship/confirm/pay/cancel/rate
forms, pickup-slot scan/edit/delete forms, and shared slot form actions through
`urlFor()`. The source-level regression now covers all marketplace templates
that previously had literal marketplace-local links/forms, and a source scan
for raw marketplace `href`/`action` strings returns no matches.

The latest marketplace route-redirect slice extends that helper coverage into
`src/routes/marketplace-actions.js`. Auth-required, validation, success, and
API-failure redirects for listing create/update/delete/renew/save/unsave,
buy/offer/report, offer/order actions, seller onboarding, pickup slots, pickup
scan, and seller coupons now resolve through `res.locals.urlFor`, with source
regression and shared-mount validation coverage.

The twentieth template-helper source slice extends direct `urlFor()` conversion
into the notifications inbox. `src/views/notifications/index.njk` now routes
the Home breadcrumb, all/unread filter links, read-all action, per-notification
read/delete actions, redirect hidden values, pagination base URL, and unread
empty-state CTA through `urlFor()`. The source-level regression first failed on
the raw `/notifications` links/actions, then passed after conversion; a source
scan for notification-local raw `href`/`action` strings and the old
`notificationLink` hidden value returns no matches.

The twenty-first template-helper source slice extends direct `urlFor()`
conversion into group exchanges. `src/views/group-exchanges/index.njk`,
`create.njk`, and `detail.njk` now route the create CTA, status filter tabs,
detail links, create form, participant search/add/remove forms, participant
confirmation form, and complete/cancel forms through `urlFor()`. The
source-level regression first failed on the raw `/group-exchanges` links and
actions, then passed after conversion; a source scan for group-exchange-local
raw `href`/`action` strings returns no matches.

The twenty-second template-helper source slice extends direct `urlFor()`
conversion into messages. `src/views/messages/index.njk`, `conversation.njk`,
`direct-conversation.njk`, `groups.njk`, `group-create.njk`, and
`group-conversation.njk` now route direct-message breadcrumbs, conversation
links, listing/member/connection links, empty-state CTAs, older-message
pagination, direct reply/edit/delete/voice/archive forms, group-message tabs,
group create/search/member/reaction forms, and leave-group controls through
`urlFor()`. The source-level regression first failed on raw `/messages`,
`/members`, and `/connections` targets, then passed after conversion; a source
scan for message-local raw `href`/`action` strings returns no matches.
Message route-level redirects now also use a route-local helper backed by
`res.locals.urlFor` for direct archive/restore/edit/delete/translate/voice/send
outcomes and group create/reply/member/reaction outcomes. A focused source
regression guards against raw `/login` and `/messages` `res.redirect(...)`
targets returning to `src/routes/messages.js`. A scoped Laravel runtime smoke
against temporary Web UK `http://127.0.0.1:6623`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed base auth/cookie/logout
checks plus signed message list/create/detail body markers.

The twenty-third template-helper source slice extends direct `urlFor()`
conversion into wallet pages. `src/views/wallet/index.njk` and
`manage.njk` now route the wallet breadcrumb, manage CTA, back link, recipient
search form, transfer forms, and donation forms through `urlFor()`. The
source-level regression first failed on raw `/wallet` links and actions, then
passed after conversion; a source scan for wallet-local raw `href`/`action`
strings returns no matches.

The twenty-fourth template-helper source slice extends direct `urlFor()`
conversion into public auth and support pages. `contact.njk`,
`cookie-settings.njk`, `login.njk`, `forgot-password.njk`,
`reset-password.njk`, `register.njk`, and `report-problem.njk` now route their
local contact, cookie, login, two-factor, forgot-password, reset-password,
register, legal-cookie-policy, and report-a-problem links/forms through
`urlFor()`. The source-level regression first failed on raw `/contact` and
`/login` controls, then passed after conversion; a targeted source scan for
public/auth/support raw `href`/`action` strings returns no matches.

The latest public-info/legal/support/cookie template-helper source slice
extends direct `urlFor()` conversion into `public-info/about.njk`,
`public-info/guide.njk`, `public-info/features.njk`,
`public-info/email-verify.njk`, `support/help.njk`,
`support/trust-safety.njk`, `legal/accessibility.njk`,
`legal/document.njk`, `privacy.njk`, and `partials/cookie-banner.njk`.
About, Guide, Features, email verification, Help, Trust and safety, legal
document/accessibility fallback links, the standalone privacy contact link, and
cookie-banner `/cookies` links plus `/cookie-consent` form actions now route
through `urlFor()`. The source-level regression first failed on raw
`/dashboard`, `/register`, and related public links, then passed after the
conversion.

The twenty-fifth template-helper source slice extends direct `urlFor()`
conversion into organisation directory and application pages.
`organisation-detail.njk`, `organisations.njk`, `organisations-apply.njk`,
`organisations-browse.njk`, `organisations-jobs.njk`,
`organisations-manage.njk`, and `organisations-register.njk` now route local
organisation, volunteering opportunity, job, manage, register, load-more, and
apply links/forms through `urlFor()`. The source-level regression first failed
on raw `/organisations` and `/volunteering` links/actions, then passed after
conversion; a source scan for organisation-local raw `href`/`action` strings
returns no matches.

The twenty-sixth template-helper source slice extends direct `urlFor()`
conversion into blog pages. `src/views/blog/index.njk`, `detail.njk`,
`comments.njk`, and `likers.njk` now route blog search, post links, pagination,
back links, author/member links, like/reaction/comment forms, discussion links,
liker links, and show-more links through `urlFor()`. The source-level
regression first failed on raw `/blog` links/actions, then passed after
conversion; a source scan for blog-local raw `href`/`action` strings returns no
matches.

The twenty-seventh template-helper source slice extends direct `urlFor()`
conversion into course pages. `src/views/courses/_nav.njk`, `index.njk`,
`detail.njk`, `learn.njk`, `my-learning.njk`, `instructor.njk`, `form.njk`,
`analytics.njk`, and `grading.njk` now route course tabs, browse/search, course
and prerequisite links, certificate and learning links, review/enrolment/quiz/
progress forms, instructor create/edit analytics links, builder section/lesson
forms, publish/unpublish/delete actions, and grading forms through `urlFor()`.
The source-level regression first failed on raw `/courses` links/actions, then
passed after conversion; a source scan for course-local raw `href`/`action`
strings and the raw `formAction` template action returns no matches.
The latest course route-redirect cleanup now sends signed-out auth handoffs,
certificate and learner error redirects, learner enrol/review/progress/quiz
results, instructor create/update/publish/unpublish/delete results,
section/lesson builder outcomes, and grading redirects through
`res.locals.urlFor`, so those Laravel named-route equivalents stay inside
shared tenant mounts and custom-domain child paths.

The twenty-eighth template-helper source slice extends direct `urlFor()`
conversion into listing index and create/edit form pages.
`src/views/listings/index.njk` and `src/views/listings/form.njk` now route
listing breadcrumbs, browse filters, clear/create CTAs, row detail/edit/delete
controls, pagination, empty-state CTAs, create/edit form action, and cancel
link through `urlFor()`. The source-level regression first failed on raw
`/listings` links/actions, then passed after conversion; a source scan for
listing index/form raw `href`/`action` strings returns no matches. A focused
Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6463` and
Laravel `http://127.0.0.1:8088` passed the base API/health, cookie, login,
account, and logout checks plus signed `/listings` containing `Create listing`.
The latest listing route-redirect cleanup now sends listing auth handoffs,
generate-description outcomes, like/comment/exchange/report actions, owner
self-request/edit redirects, create/update successes, and delete successes
through `res.locals.urlFor`, so those Laravel named-route equivalents stay
inside shared tenant mounts and custom-domain child paths without relying only
on response rewriting.
The latest listing exchange-request source cleanup now routes the request form
back link and no-JS POST action through `urlFor('/listings/' + id ...)`.
Focused source coverage first failed on raw `/listings` `href`/`action`
targets in `src/views/listings/exchange-request.njk`, then passed after the
conversion. Focused render coverage now also asserts the same page served at
`/acme/accessible/listings/42/exchange-request` emits tenant-mounted
`/acme/accessible/listings/42` back/action targets instead of depending only on
response rewriting.
The latest listing auxiliary source cleanup now routes
`src/views/listings/analytics.njk`, `src/views/listings/comments.njk`, and
`src/views/listings/report.njk` back links plus GET/POST form actions through
`urlFor()`. Focused source coverage guards against raw `/listings` template
targets returning, and focused render coverage keeps the Laravel-backed
analytics, comments, and report pages green.

The twenty-ninth template-helper source slice extends direct `urlFor()`
conversion into event index and create/edit form pages.
`src/views/events/index.njk`, `src/views/events/new.njk`, and
`src/views/events/edit.njk` now route the event list create CTA, search form,
event and group links, pagination, empty-state actions, create/edit form
actions, breadcrumbs, back links, and cancel links through `urlFor()`. The
source-level regression first failed on raw `/events` and `/groups`
links/actions, then passed after conversion; a source scan for event
index/form raw local `href`/`action` strings returns no matches. A focused
exported Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6464` and Laravel `http://127.0.0.1:8088` passed the base
API/health, cookie, login, account, and logout checks plus `/events`
containing `Events` and `/events/new` containing `Create an event`.

The latest event depth template-helper source slice extends direct `urlFor()`
conversion into `src/views/events/browse.njk`, `map.njk`, `polls.njk`,
`recurring-edit.njk`, and `translate.njk`. These templates now route the
event browse back/view-all links and filter form, event map back link, poll
back link and save form, recurring edit back link/form/occurrence links, and
translation back link/form through `urlFor()` instead of raw `/events` source
targets. The source regression first failed on raw `/events` `href`/`action`
strings, then passed after conversion. Focused mounted render coverage proves
the same controls render under `/acme/accessible/events...`; the map case uses
an explicit mocked tenant bootstrap with `maps` enabled so the existing
disabled-map feature-gate proof remains intact. A scoped Laravel runtime smoke
against temporary Web UK `http://127.0.0.1:6610`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed base auth/cookie/logout
checks plus `/events/browse`, `/events/6/map`, `/events/6/polls`, and
`/events/6/translate` module/body-text markers. This is source, mocked render,
and scoped Laravel runtime evidence only; full visual/manual Blade parity,
full default Laravel runtime smoke, and ASP.NET backend compatibility are still
not certified by this slice.

The thirtieth template-helper source slice extends direct `urlFor()`
conversion into group index, create/edit form, and legacy my-groups source
pages. `src/views/groups/index.njk`, `src/views/groups/new.njk`,
`src/views/groups/edit.njk`, and `src/views/groups/my.njk` now route the group
list create CTA, search form, clear links, group card links, pagination base
URL, create/edit form actions, breadcrumbs, back links, cancel links, and
legacy my-groups source controls through `urlFor()`. The source-level
regression first failed on raw `/groups` links/actions/base URL, then passed
after conversion; a source scan for group index/form raw local `href`,
`action`, JavaScript `href`, and pagination `baseUrl` strings returns no
matches. A focused exported Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6465` and Laravel `http://127.0.0.1:8088` passed the base
API/health, cookie, login, account, and logout checks plus `/groups`
containing `Groups` and `/groups/new` containing `Create a group`.

The thirty-first tenant-routing slice aligns the Web UK parent-domain child
guard with Laravel `TenantContext::getReservedPaths()`. Parent custom-domain
paths whose first segment is reserved by Laravel, such as `/classic`, now stay
on the host-scoped platform/custom-domain route path instead of being probed as
child tenant slugs. The source-level regression first failed on an unexpected
`getTenantBootstrap({ slug: "classic" })` call, then passed after the reserved
segment set was expanded.

The forty-sixth tenant-routing slice tightened that same guard from a
Laravel-plus-local reserved list to the Laravel reserved list at that source
revision. Names that looked like accessible pages locally but were not then
reserved by Laravel, such as `courses`, became eligible to resolve as
parent-domain child tenant slugs.
The focused regression first failed because `/courses/login` on
`parent-domain.test` stayed on the parent route path, then passed after Web UK
called `getTenantBootstrap({ slug: "courses" })` and served the child login page
under `/courses`. `tests/tenant-routing-source.test.js` now automates the
source comparison between Laravel `TenantContext::getReservedPaths()` and Web
UK `RESERVED_CHILD_SEGMENTS`, and currently reports no differences.

The 2026-07-10 source refresh supersedes the old `/courses` fixture because
Laravel now reserves it. Web UK added all 21 current Laravel-only entries,
focused route coverage proves each remains host-scoped, and the unreserved
control now uses `/gardeners/login`. The source-parity test and full Jest suite
pass with no Laravel-only or Web-UK-only reserved segments.

A scoped Laravel runtime smoke against temporary in-process Web UK
`http://127.0.0.1:59115` and Laravel `http://127.0.0.1:8088` passed the base
API/health, cookie, login, account, and logout checks plus
`timebank.global|/hour-timebank/login` containing `Sign in` with no legacy
`/alpha` or `/accessible` links.

The thirty-second template-helper source slice extends direct `urlFor()`
conversion into resource pages. `src/views/resources/index.njk`,
`library.njk`, `upload.njk`, `delete.njk`, and `comments.njk` now route simple
browse, full library, upload, delete confirmation, download, discussion,
reaction, comment, reorder, category, search, and pagination controls through
`urlFor()`. The source-level regression first failed on raw `/resources`
links/actions, then passed after conversion; a source scan for resource-local
raw `href`, `action`, JavaScript `href`, and pagination `baseUrl` strings
returns no matches. A focused exported Laravel runtime smoke against temporary
in-process Web UK `http://127.0.0.1:54932` and Laravel
`http://127.0.0.1:8088`, started with `TENANT_ID=2`, passed the base
API/health, cookie, login, account, and logout checks plus `/resources`,
`/resources/library`, `/resources/upload`, and `/resources/10/comments` module
renders and body markers.

A follow-up resources route-redirect cleanup sends auth-required handoffs,
upload/reorder/delete outcomes, and comment/reaction result redirects through
`res.locals.urlFor`; focused shared-mount coverage proves
`/acme/accessible/resources/42/delete` redirects back under
`/acme/accessible/resources/library?status=resource-deleted`.

The thirty-third template-helper source slice extends direct `urlFor()`
conversion into search pages. `src/views/search/index.njk`,
`advanced.njk`, and `saved-delete.njk` now route simple search, advanced
search, saved-search delete, result tabs, result links, empty-state CTAs,
pagination base URL, saved-search run/delete forms, and saved-search delete
confirmation controls through `urlFor()`. The source-level regression first
failed on raw `/search`, `/listings`, `/members`, `/events`, and `/groups`
links/actions, then passed after conversion; a source scan for search-local raw
`href`, `action`, and pagination `baseUrl` strings returns no matches. A
focused exported Laravel runtime smoke against temporary in-process Web UK
`http://127.0.0.1:56338` and Laravel `http://127.0.0.1:8088`, started with
`TENANT_ID=2`, passed the base API/health, cookie, login, account, and logout
checks plus `/search/advanced?q=garden` module rendering and body markers
`Advanced search` and `Save this search`.

The thirty-fourth template-helper source slice extends direct `urlFor()`
conversion into saved item and collection pages. `src/views/saved/index.njk`,
`src/views/saved-collections/index.njk`,
`src/views/saved-collections/detail.njk`,
`src/views/saved-social/appreciations.njk`, and
`src/views/saved-social/public-collections.njk` now route saved filters,
clear links, dynamic item links, bookmark removal, collection list/detail
links, collection create/update/delete/item-remove forms, public collection
links, appreciation send/reaction forms, member profile links, and pagination
through `urlFor()`. The source-level regression first failed on raw `/saved`,
`/me/collections`, `/members`, `/users`, and `/appreciations` links/actions,
then passed after conversion; a source scan for saved-family raw local
`href`/`action` strings returns no matches. A focused exported Laravel runtime
smoke against temporary in-process Web UK `http://127.0.0.1:50823`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed the base API/health,
cookie, login, account, and logout checks plus `/saved`, `/me/collections`,
and `/users/14/appreciations` module rendering and body markers.

The seventy-fifth route-redirect slice extends route-level tenant awareness
into saved collection and saved social workflows. `src/routes/saved-collections.js`
and `src/routes/saved-social.js` now route signed-out saved handoffs, saved item
removal, collection create/update/delete/item-remove outcomes, appreciation send
outcomes, and appreciation reaction anchors through `res.locals.urlFor`. The
focused source regression first failed because those routes still emitted
direct flat `res.redirect(...)` targets, then passed after conversion.
Shared-mount behavior coverage proves signed POST outcomes under
`/acme/accessible/me/collections`, `/acme/accessible/users/{id}/appreciations`,
and `/acme/accessible/appreciations/{id}/react` stay under `/acme/accessible`.

The thirty-fifth template-helper source slice extends direct `urlFor()`
conversion into jobs pages. `src/views/jobs/alerts.njk`,
`analytics.njk`, `applicants.njk`, `application-history.njk`,
`applications.njk`, `bias-audit.njk`, `detail.njk`, `employer-brand.njk`,
`form.njk`, `index.njk`, `mine.njk`, `onboarding.njk`, `pipeline.njk`,
`qualification.njk`, `responses.njk`, `saved.njk`, `talent-profile.njk`, and
`talent-search.njk` now route jobs tabs, browse filters, saved/application/
owner links, alerts, responses, detail save/apply/renew forms, employer-brand
links, talent search/profile links, CSV/CV downloads, pagination, and variable
form targets through `urlFor()`. The source-level regression first failed on
raw `/jobs` links/actions, then passed after conversion; a source scan for
job-local raw `href`/`action`, pagination, and form-action strings returns no
matches. Focused jobs render/API tests pass for 28 selected tests.
Focused Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:60268`, Laravel `http://127.0.0.1:8088`, and
`TENANT_ID=2` passed 24 checks across auth/cookie/logout plus signed
`/jobs/saved`, `/jobs/applications`, `/jobs/mine`, `/jobs/create`,
`/jobs/alerts`, `/jobs/responses`, and `/jobs/employer-onboarding` body
markers.

The thirty-sixth template-helper source slice extends direct `urlFor()`
conversion into member directory pages. `src/views/members/index.njk`,
`discover.njk`, `nearby.njk`, and `insights.njk` now route the member directory
search form, clear links, empty-state action, profile links, connection form,
pending-response link, pagination base URL, discovery and nearby filter nav,
search forms, load-more links, profile/settings link, and insights back links
through `urlFor()`. The source-level regression first failed on raw `/members`
links/actions, then passed after conversion; a source scan for member-local raw
`href`, `action`, pagination, and `nextHref` strings returns no matches.
Focused members render tests pass for 42 selected tests. Focused Laravel
runtime smoke against temporary in-process Web UK
`http://127.0.0.1:64511`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed 18 checks across auth/cookie/logout plus signed `/members`,
`/members/discover`, `/members/nearby`, and `/members/77/insights` body
markers.

The member action redirect slice extends route-level tenant awareness into
`src/routes/members.js`. Auth-required handoffs, connection/endorsement/
block/unblock/review/transfer status redirects, blocked-list unblock returns,
discover/nearby/insights auth handoffs, and Laravel `401` redirects now pass
through `res.locals.urlFor` instead of raw `/login`, `/members`, or
`/profile/blocked` targets. The source-level regression first failed on those
raw redirects, then passed after conversion; shared-mount coverage proves
signed-out `/acme/accessible/members/77/connection` redirects to
`/acme/accessible/login?status=auth-required`, and signed unblock-from-list
redirects to `/acme/accessible/profile/blocked?status=member-unblocked`.

The thirty-seventh template-helper source slice extends direct `urlFor()`
conversion into podcast browse, detail, episode, form, manage, and studio
pages. `src/views/podcasts/index.njk`, `detail.njk`, `episode.njk`,
`form.njk`, `manage.njk`, and `studio.njk` now route podcast list/search,
studio navigation, show and episode links, subscribe form, create/edit form
actions, episode add/publish/delete forms, show publish/delete forms, and
studio management links through `urlFor()`. The source-level regression first
failed on raw `/podcasts` links/actions, then passed after conversion; a source
scan for podcast-local raw `href`, `action`, pagination, and variable form
target strings returns no matches. Focused podcast render tests pass for 10
selected tests. Focused Laravel runtime smoke against temporary in-process Web
UK `http://127.0.0.1:64493`, Laravel `http://127.0.0.1:8088`, and
`TENANT_ID=2` passed 16 checks across auth/cookie/logout plus signed
`/podcasts`, `/podcasts/studio`, and `/podcasts/studio/new` body markers.

The latest podcast route-redirect slice moves the podcast POST workflow
destinations into the active tenant URL helper. `src/routes/podcast-actions.js`
now sends auth-required, validation, success, and API-failure redirects for
subscribe, studio show create/update/publish/delete, and episode
add/publish/delete through `res.locals.urlFor`. The source-level regression
first failed on raw `res.redirect(loginRedirect())` and raw `/podcasts` status
redirects, then passed after conversion; the existing podcast action alias
behavior test still passes for the flat routes.

The latest podcast GET route-redirect slice moves page-level auth handoffs into
the same active tenant URL helper. `src/routes/podcasts.js` now sends
signed-out and Laravel-401 redirects through `redirectTo(res,
loginRedirect())`, backed by `res.locals.urlFor`, instead of raw flat
`/login` redirects. The source-level regression first failed on direct
`res.redirect(loginRedirect())`; the mounted behavior test now covers
`/acme/accessible/podcasts` redirecting to
`/acme/accessible/login?status=auth-required` before Laravel podcast APIs are
called.

The thirty-eighth template-helper source slice extends direct `urlFor()`
conversion into feed browse, hashtag, post permalink, and typed-item permalink
pages. `src/views/feed/index.njk`, `hashtags.njk`, `hashtag.njk`, `post.njk`,
and `item.njk` now route feed compose/filter forms, hashtag links, post and
item permalink links, like/comment/not-interested forms, author and group
links, pagination, sign-in CTAs, `nextHref`, and internal deep links through
`urlFor()`. The source-level regression first failed on raw `/feed`
links/actions, then passed after conversion; a source scan for feed-local raw
`href`, `action`, pagination, and variable internal link targets returns no
matches. A second focused regression first failed on a live Laravel `author`
post shape that lacks `user`, then passed after feed index normalization was
expanded. Focused feed render tests pass for 19 selected tests. Focused Laravel
runtime smoke against temporary in-process Web UK
`http://127.0.0.1:58285`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed 20 checks across auth/cookie/logout plus signed `/feed`,
`/feed/hashtags`, `/feed/hashtag/timebank`, `/feed/posts/796`, and
`/feed/item/listing/42` body markers.

The thirty-ninth tenant-routing source slice aligns shared-root tenant chooser
ordering with Laravel Blade. Laravel's `AlphaController::tenantChooser()`
orders active non-master tenants by `name`; Web UK now sorts normalized
`/api/v2/tenants` communities by display name before rendering the chooser.
The focused regression first failed when `Zebra Timebank` rendered before
`Acme Timebank`, then passed after the normalization sort was added. Focused
tenant-routing route tests pass for 13 selected shared-root/shared-mount/
custom-domain cases.

The fortieth template-helper source slice extends direct `urlFor()`
conversion into the real Laravel `/kb` knowledge-base templates.
`src/views/kb/index.njk` and `article.njk` now route the search form, article
links, cursor load-more link, article back link, and related-article links
through `urlFor()`. The source-level regression first failed on raw `/kb`
links/actions and `href="{{ nextHref }}"`, then passed after conversion; a
source scan for raw knowledge-base local `href`, `action`, and `nextHref`
strings returns no matches. Focused knowledge-base render tests pass for the
public index/search and article pages.

A follow-up source cleanup keeps the legacy, currently unmounted
`src/views/knowledge-base/*.njk` compatibility templates tenant-safe too.
Those templates now route article, breadcrumb, back-link, and pagination
targets through `urlFor()`. The focused regression first failed on raw
`/knowledge-base` links and passed after conversion. This does not add a
Laravel route family; the Laravel Blade source-of-truth knowledge-base pages
remain `/kb` and `/kb/{id}`.

The forty-first template-helper source slice extends direct `urlFor()`
conversion into the signed Laravel `/dashboard` template.
`src/views/dashboard/index.njk` now routes onboarding, exchange-attention,
create-listing,
upcoming-event, quick-link, recent-feed, and recent-listing links through
`urlFor()`. The source-level regression first failed on raw dashboard local
links, then passed after conversion; focused dashboard render coverage still
proves the flat signed `/dashboard` output. A scoped Laravel runtime smoke
against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel
`http://127.0.0.1:8088` passed the core auth/cookie/logout flow plus signed
`/dashboard` rendering and the `Quick links` body marker.

The forty-second tenant-routing slice aligns prefixed accessible paths on
custom domains with Laravel's slugless accessible-domain behavior. The focused
regression first failed because `Host: acme-accessible.test` with
`/acme/alpha/login?status=auth-required` redirected to
`/acme/accessible/login?status=auth-required`; it now redirects to the
slugless `/login?status=auth-required`, and `/acme/accessible/register` now
redirects to `/register` when Laravel bootstrap resolves the host to the same
tenant. Focused tenant-routing route tests pass for 14 selected
shared-root/shared-mount/custom-domain cases.

The forty-third template-helper source slice extends direct `urlFor()`
conversion into the signed Laravel-backed `/goals` family.
`src/views/goals/*.njk` now routes browse/detail links, template filter/use
forms, discover/buddying links and buddy forms, edit/delete forms, check-in,
reminder, buddy-action, history, insights, social like/comment/reply/delete
forms, and cursor links through `urlFor()`. The source-level regression first
failed on raw `/goals` links/actions, then passed after conversion; a source
scan for raw goals local `href`, `action`, and `nextHref` strings returns no
matches. Focused render coverage passes for 13 selected goals tests.

The forty-fourth template-helper source slice extends direct `urlFor()`
conversion into the signed Laravel-backed `/exchanges` family.
`src/views/exchanges/index.njk` and `src/views/exchanges/detail.njk` now route
filter tabs, exchange detail links, pagination, listing and message links,
exchange action forms, and the completed-exchange rating form through
`urlFor()`. The source-level regression first failed on raw `/exchanges`
links/actions, then passed after conversion; a source scan for raw exchange,
listing, and message local targets returns no matches. Focused render coverage
passes for 9 selected exchange/group-exchange/listing-request tests, and a
scoped Laravel runtime smoke passes the core auth/cookie/logout flow plus
signed `/exchanges` rendering and the `Exchanges` body marker.

The forty-fifth template-helper source slice extends direct `urlFor()`
conversion into the signed Laravel-backed public `/coupons` family.
`src/views/coupons/index.njk` and `src/views/coupons/detail.njk` now route the
public coupon detail links and back link through `urlFor()`. The source-level
regression first failed on a raw `/coupons/{{ coupon.id }}` link, then passed
after conversion; a source scan for raw coupon local targets returns no
matches. Focused render coverage passes for 4 selected public-coupon and
marketplace-coupon tests. A scoped Laravel runtime smoke passes the core
auth/cookie/logout flow plus the current local Laravel fixture's expected
`403` feature gate for `/coupons` and `/coupons/1`; that gate smoke does not
certify rendered coupon body parity for a merchant-coupons-enabled tenant.

The seventy-sixth route-redirect slice extends route-level tenant awareness
into the public coupon family. `src/routes/coupons.js` now routes unsigned
`/coupons` and `/coupons/{id}` auth handoffs through `res.locals.urlFor`,
matching Laravel's named login route behavior for shared tenant mounts and
custom-domain contexts. The focused source regression first failed because
the route still emitted direct `res.redirect(loginRedirect())`, then passed
after conversion. A later tenant feature-gate slice updates the effective
shared-mount behavior for tenants where `merchant_coupons` is absent or false:
`/acme/accessible/coupons` and `/acme/accessible/coupons/{id}` return
Laravel-style `403` before the auth handoff, matching Laravel's feature gate
order. The redirect behavior still applies once the tenant feature is enabled.

The seventy-seventh tenant feature-gate slice adds route-level default-off
feature gates for shared tenant and custom-domain tenant contexts. Web UK now
uses the Laravel-aligned feature defaults from `src/lib/accessible-shell.js` to
return `403` for tenant-context Marketplace, Courses, Podcasts, Coupons, and
Premium paths when `marketplace`, `courses`, `podcasts`, `merchant_coupons`, or
`member_premium` are absent or false in Laravel tenant bootstrap. The focused
regression first failed because `/acme/accessible/marketplace` rendered `200`,
then passed after `src/middleware/tenant-feature-gates.js` was mounted before
the route modules. A targeted Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6531` and Laravel `http://127.0.0.1:8088` passed all five
signed gated checks for `/acme/accessible/marketplace`, `/courses`, `/podcasts`,
`/coupons`, and `/premium` returning `403`.

The seventy-eighth tenant feature-gate slice extends the same route-level
middleware to core Laravel matrix gates. Tenant-mounted disabled Dashboard,
Feed, Listings, Exchanges, Matches, Events, Volunteering, Organisations,
Members, Connections, Messages, Wallet, Notifications, Achievements,
Leaderboard, NEXUS score, Blog, AI chat, Federation, Goals, Groups, Group
exchanges, Ideation, Jobs, Polls, Resources, Reviews, and Search paths now
return `403` when the corresponding Laravel bootstrap `module:` or `feature:`
gate is false. Focused Jest proves those disabled core gates. A live Laravel
smoke against temporary Web UK `http://127.0.0.1:6535` proves the enabled
`hour-timebank` fixture still renders tenant-mounted Dashboard, Wallet, and
Members pages, and the existing default-off `/acme/accessible/*` `403` checks
stay green. A real Laravel tenant fixture with disabled core modules/features
is still needed for live disabled core-gate certification.

The forty-seventh template-helper source slice extends direct `urlFor()`
conversion into AI chat and matches pages. `src/views/ai-chat/index.njk`,
`src/views/matches/index.njk`, and `src/views/matches/board.njk` now route AI
chat back/conversation/new-conversation links, chat form actions, matches
filters, board links, listing/group/event links, dismiss forms, empty-state
CTAs, and back links through `urlFor()`. The source-level regression first
failed on raw `/chat` links/forms, then passed after conversion; a focused scan
for raw chat/matches/listing/group/event local `href` and chat/matches
`action` strings returns no matches. Focused AI chat and matches render
coverage passes for 7 selected tests. A scoped Laravel runtime smoke against
Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed
13 checks including signed `/chat`, `/matches`, and `/matches/board` body
markers. This does not newly certify full visual Blade parity, localization,
recommendation persistence depth, or ASP.NET backend compatibility.

The forty-eighth template-helper source slice cleans up the shared pagination
partial default. `src/views/partials/pagination.njk` no longer documents a raw
`baseUrl: "/members"` fallback and instead uses `urlFor('/members')` when
`paginationConfig.baseUrl` is omitted. The source-level regression first
failed on the raw default, then passed after conversion. Focused verification
also passed the signed Laravel members-index render test, lint, the route
matrix with 608/608 Laravel accessible routes matched and 0 missing, the full
Web UK Jest suite with 757/757 tests passing across 11 suites, and a
scoped live Laravel runtime smoke for `/members` containing `Community members`.
This does not newly certify visual pagination parity, every pagination caller,
localization, or ASP.NET backend compatibility.

The forty-ninth template-helper source slice cleans up shared empty-state and
breadcrumb partial link handling. `src/views/partials/empty-state.njk` now
routes primary and secondary action hrefs through `urlFor()`, while
`src/views/partials/breadcrumbs.njk` documents `urlFor('/groups')` and
`urlFor('/groups/123')` examples instead of flat local paths. The source-level
regression first failed on the raw examples and direct empty-state href
rendering, then passed after conversion. A focused tenant-prefixed render test
also passed for `/acme/accessible/members?search=zzz`, proving the empty-state
action link renders as `/acme/accessible/members` rather than `/members`.
Focused source tests, lint, route matrix, the full Web UK Jest suite with
759/759 tests passing across 11 suites, and a scoped live Laravel `/members`
runtime smoke also passed. This does not newly certify visual empty-state
parity, every empty-state caller, localization, or ASP.NET backend
compatibility.

The fiftieth source slice starts route-level redirect cleanup with AI chat.
`src/routes/ai-chat.js` now sends auth-required, empty-message, and post-send
redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `/login` and `/chat` redirect calls, then passed
after conversion. A focused runtime test also passed for a signed empty POST to
`/acme/accessible/chat`, proving the redirect target stays inside the shared
tenant mount as `/acme/accessible/chat?status=empty`. Focused source tests,
focused AI chat render/redirect tests, lint, route matrix, the full Web UK
Jest suite with 761/761 tests passing across 11 suites, and a scoped live
Laravel `/chat` runtime smoke also passed. This does not newly certify every
redirect family, AI assistant persistence, visual Blade parity, localization,
or ASP.NET backend compatibility.

A follow-up cleanup deletes the unmounted legacy `src/routes/chat.js` router
and orphaned `src/views/chat/index.njk` template. `src/server.js` mounts
`src/routes/ai-chat.js` for `/chat`, renders `src/views/ai-chat/index.njk`,
and the generated route matrix maps both Laravel AI chat rows to that
tenant-aware implementation. Removing the stale router and view prevents
source audits from chasing unreachable raw `/chat` links or redirects that are
not part of the active Laravel-compatible accessible frontend.

The fifty-first source slice extends route-level redirect cleanup into matches.
`src/routes/matches.js` now sends match dismiss and board dismiss redirects
through `redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when
shell locals are available. The focused source regression first failed on raw
`/matches` and `/matches/board` redirect calls, then passed after conversion. A
focused runtime test also passed for a signed POST to
`/acme/accessible/matches/77/dismiss`, proving the redirect target stays inside
the shared tenant mount as
`/acme/accessible/matches?status=match-dismissed`. Focused source tests,
focused matches render/redirect tests, lint, route matrix, the full Web UK
Jest suite with 763/763 tests passing across 11 suites, and a scoped live
Laravel `/matches` and `/matches/board` runtime smoke also passed. This does
not newly certify every redirect family, recommendation persistence, visual
Blade parity, localization, or ASP.NET backend compatibility.

The fifty-second source slice extends route-level redirect cleanup into auth.
`src/routes/auth.js` now sends login, two-factor, register, logout,
forgot-password, and reset-password redirects through `redirectTo(res, ...)`,
which delegates to `res.locals.urlFor` when shell locals are available. The
focused source regression first failed on raw `/login`, `/dashboard`, and
`/password` redirect calls, then passed after conversion. A focused runtime test
also passed for a successful POST to `/acme/accessible/login`, proving the
redirect target stays inside the shared tenant mount as
`/acme/accessible/dashboard`. Full source tests, focused shared-mount tests,
lint, route matrix, the full Web UK Jest suite with 765/765 tests passing across
11 suites, and a scoped live Laravel auth smoke with 13/13 checks also passed.
This is route-redirect evidence only; it does not newly certify full Laravel
credential viability beyond the smoke fixture, two-factor persistence,
registration delivery, password reset email delivery, visual Blade parity,
localization, every route redirect family, or ASP.NET backend compatibility.

The fifty-third source slice extends route-level redirect cleanup into core
server handlers. `src/server.js` now sends deterministic cookie settings,
account login, organisation registration status, and organisation-detail auth
redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. User-provided safe return
URLs still use the existing safe-local redirect path to avoid double-prefixing
already-mounted return targets. The focused source regression first failed on
raw `/cookies`, `/login`, `/organisations`, `invalidRedirect`, and
`failedRedirect` redirects, then passed after conversion. Focused shared-mount
tests prove `/acme/accessible/cookie-consent` redirects to
`/acme/accessible/cookies?status=saved` and
`/acme/accessible/organisations/42` redirects to
`/acme/accessible/login?status=auth-required`. Full source tests, focused
shared-mount tests, lint, route matrix, the full Web UK Jest suite with 768/768
tests passing across 11 suites, and a scoped live Laravel cookie/organisation
smoke with 12/12 checks also passed. This is server-level route-redirect
evidence only; it does not newly certify every route redirect family,
user-return URL prefixing, full organisation workflow persistence, visual Blade
parity, localization, or ASP.NET backend compatibility.

The fifty-fourth source slice extends route-level redirect cleanup into
contact and report-a-problem support routes. `src/routes/contact-support.js`
now sends contact validation, contact API failure/success, signed-out
report-a-problem handoff to contact prefill, unsigned report POST,
report-validation, report-sent, and report-failed redirects through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell
locals are available. The focused source regression first failed on raw
`/contact`, `/login`, and `/report-a-problem` redirects plus literal
`buildQuery('/contact')` and `buildQuery('/report-a-problem')` usage, then
passed after conversion. Focused shared-mount runtime tests also prove
`/acme/accessible/contact` validation redirects to
`/acme/accessible/contact?status=contact-validation` and unsigned
`/acme/accessible/report-a-problem?return=/explore` redirects to
`/acme/accessible/contact?problem_url=%2Fexplore`. This is support-route
redirect evidence only; it does not newly certify support-report persistence,
Laravel rate-limit/error variants, full visual Blade parity, localization, or
ASP.NET backend compatibility.

The fifty-fifth source slice extends route-level redirect cleanup into the
Explore gateway. `src/routes/explore.js` now sends unsigned and Laravel-401
auth-required redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `/login?status=auth-required` redirects in
`src/routes/explore.js`, then passed after conversion. A focused shared-mount
runtime test also proves unsigned `/acme/accessible/explore` redirects to
`/acme/accessible/login?status=auth-required`. This is Explore route-redirect
evidence only; it does not newly certify Explore feature-disabled behavior,
recent-listing source parity, live broker workflow data, visual Blade parity,
localization, or ASP.NET backend compatibility.

The fifty-sixth source slice extends route-level redirect cleanup into
achievements/gamification. `src/routes/achievements.js` now sends unsigned,
Laravel-401, daily-reward, challenge-claim, shop-purchase, and showcase
redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `/login` and `/achievements` redirects in
`src/routes/achievements.js`, then passed after conversion. A focused
shared-mount runtime test also proves signed
`/acme/accessible/achievements/daily-reward` redirects to
`/acme/accessible/achievements?status=daily-reward-claimed`. This is
achievements route-redirect evidence only; it does not newly certify
gamification feature gates, Laravel reward persistence depth, visual Blade
parity, localization, or ASP.NET backend compatibility.

The fifty-seventh source slice extends route-level redirect cleanup into
connections. `src/routes/connections.js` now sends unsigned network redirects
plus accept, decline, remove, and non-401 failure redirects through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell
locals are available. The focused source regression first failed on raw
`/login?status=auth-required` and `connectionActionUrl(...)` redirects in
`src/routes/connections.js`, then passed after conversion. A focused
shared-mount runtime test also proves signed
`/acme/accessible/connections/31/accept` redirects to
`/acme/accessible/connections?status=connection-accepted#connections-top`.
This is connections route-redirect evidence only; it does not newly certify
connection permission edge cases, Laravel persistence depth, visual Blade
parity, localization, or ASP.NET backend compatibility.

The fifty-eighth source slice extends tenant-aware helper cleanup into clubs.
`src/views/clubs/index.njk` now sends the search form action through
`urlFor('/clubs')`, and `src/routes/clubs.js` now sends the unsigned
auth-required redirect through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `action="/clubs"` in the clubs template, then
passed after conversion. A focused shared-mount runtime test also proves
unsigned `/acme/accessible/clubs` redirects to
`/acme/accessible/login?status=auth-required` and signed
`/acme/accessible/clubs?q=velo` renders a search form action at
`/acme/accessible/clubs`. This is clubs helper/redirect evidence only; it does
not newly certify Laravel's tenant-has-clubs 404 gate, visual Blade parity,
localization, runtime persistence, or ASP.NET backend compatibility.

The fifty-ninth source slice extends tenant-aware helper cleanup into skills.
`src/views/skills/index.njk` now sends category links, member profile links,
the back-to-categories link, skill-search links, and the search form action
through `urlFor()`, and `src/routes/skills.js` now sends the unsigned
auth-required redirect through `redirectTo(res, ...)`. The shared
`src/lib/routeHelpers.js` async error path also resolves 401/error redirect
targets through `res.locals.urlFor` when shell locals are available, so
Laravel-expired-token redirects stay inside shared tenant mounts instead of
falling back to flat `/login`. The focused source regression first failed on
raw `/skills` and `/members` href/action targets in the skills template, then
passed after conversion. A focused shared-mount runtime test also proves
unsigned and expired-token `/acme/accessible/skills` requests redirect to
`/acme/accessible/login?status=auth-required`, while signed
`/acme/accessible/skills?category=7&skill=gardening` renders the search form,
category link, member link, and skill link under `/acme/accessible`. This is
skills helper/redirect evidence only; it does not newly certify category
authorization, visual Blade parity, localization, runtime persistence, or
ASP.NET backend compatibility.

The sixtieth source slice extends route-level redirect cleanup into blog.
`src/routes/blog-posts.js` now sends signed-out discussion, liker, comment,
like, and reaction redirects plus comment/reaction POST result redirects
through `redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when
shell locals are available. The focused source regression first failed on raw
`res.redirect('/login...')` targets in the blog route module, then passed after
conversion. A focused shared-mount runtime test also proves unsigned
`/acme/accessible/blog/community-news/comments` redirects to
`/acme/accessible/login?status=auth-required`, and signed
`/acme/accessible/blog/community-news/comments` POSTs redirect back to
`/acme/accessible/blog/community-news?status=comment-added#comments`. This is
blog redirect evidence only; it does not newly certify feature gates, visual
Blade parity, localization, RSS metadata depth, runtime persistence, or
ASP.NET backend compatibility.

The sixty-first source slice extends route-level redirect cleanup into
exchanges. `src/routes/exchanges.js` now sends exchange action and rating POST
result redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `/exchanges` redirect targets, then passed after
conversion. A focused shared-mount runtime assertion proves signed
`/acme/accessible/exchanges/88` POSTs redirect back to
`/acme/accessible/exchanges/88?status=exchange-updated`. This is exchange
redirect evidence only; it does not newly certify feature/module gates,
participant authorization edges, visual Blade parity, localization, workflow
side effects, broader runtime persistence, or ASP.NET backend compatibility.

The sixty-second source slice extends route-level redirect cleanup into member
onboarding. `src/routes/onboarding-posts.js` now sends auth-required,
already-complete dashboard, invalid-step, avatar, profile-validation,
safeguarding, completion-success, completion-failure, and next-step redirects
through `redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when
shell locals are available. The focused source regression first failed on raw
`/login`, `/onboarding`, and `/dashboard` redirect targets, then passed after
conversion. A scoped Laravel runtime smoke also proves the current completed
fixture redirects signed `/onboarding/profile` to `/dashboard`. This is
member-onboarding redirect evidence only; it does not newly certify onboarding
form visual parity, profile/avatar persistence edge cases, localization,
broader runtime behavior, or ASP.NET backend compatibility.

The sixty-third source slice extends route-level redirect cleanup into wallet
actions. `src/routes/wallet.js` now sends transfer validation/success/failure
redirects and donation validation/success/failure redirects through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell
locals are available. The focused source regression first failed on missing
wallet route helper coverage and raw `/wallet` redirect targets, then passed
after conversion. Focused shared-mount coverage proves a signed invalid POST to
`/acme/accessible/wallet/donate` redirects to
`/acme/accessible/wallet?status=donate-failed&donate_error=decimals#donate`.
This is wallet action redirect evidence only; it does not newly certify live
wallet transfer/donation persistence, recipient privacy behavior, visual Blade
parity, localization, broader runtime behavior, or ASP.NET backend
compatibility.

The sixty-fourth source slice extends route-level redirect cleanup into search.
`src/routes/search.js` now sends unsigned advanced-search and saved-search
delete handoffs, Laravel-401 auth handoffs, saved-search validation/results,
delete results, and run results through `redirectTo(res, ...)`, which delegates
to `res.locals.urlFor` when shell locals are available. The focused source
regression first failed on missing route helper coverage and raw `/login` plus
`searchAdvancedUrl(...)` redirect targets, then passed after conversion. This
is search redirect evidence only; it does not newly certify live saved-search
persistence, tenant feature gates, visual Blade parity, localization, broader
runtime behavior, or ASP.NET backend compatibility.

The sixty-fifth source slice extends tenant-aware return handling into premium
billing. `src/views/premium/*.njk` now routes pricing, management, and return
page links/forms through `urlFor()`, and `src/routes/premium.js` now uses
`localUrl(res, ...)`/`redirectTo(res, ...)` for premium auth/status redirects
and Laravel member-premium checkout plus billing-portal `return_url` payloads.
The focused source regression first failed on raw premium links/forms and flat
`/premium` return URLs, then passed after conversion. Focused shared-mount
coverage proves signed POSTs to `/acme/accessible/premium/subscribe` and
`/acme/accessible/premium/portal` send Laravel payload return URLs under
`/acme/accessible`. This is premium URL-routing evidence only; it does not
newly certify external Stripe checkout/portal runtime behavior, tenant premium
feature gates, localization, exact billing status wording, or ASP.NET backend
compatibility.

The sixty-sixth source slice extends route-level redirect cleanup into feed
actions. `src/routes/feed-actions.js` now sends feed post, item, comment, poll,
moderation, share, save, and mute POST result redirects through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell
locals are available. The focused source regression first failed on raw
`res.redirect('/feed')` and raw `/feed` helper returns, then passed after
conversion. Focused shared-mount coverage proves an empty signed
`/acme/accessible/feed/posts` submission redirects to
`/acme/accessible/feed?status=post-empty`. This is feed action redirect
evidence only; it does not newly certify full feed visual parity, feed
persistence depth, localization, broader Laravel runtime behavior, or ASP.NET
backend compatibility.

The sixty-seventh source slice extends route-level redirect cleanup into group
exchange actions. `src/routes/group-exchange-actions.js` now sends signed-out
auth handoffs, create validation failures, create success/failure redirects,
participant add/remove results, confirm/complete/cancel results, and API auth
failures through `redirectTo(res, ...)`, which delegates to `res.locals.urlFor`
when shell locals are available. The focused source regression first failed on
raw `/login` and `/group-exchanges` redirects plus raw helper return strings,
then passed after conversion. Focused shared-mount coverage proves an invalid
signed `/acme/accessible/group-exchanges/new` submission redirects to
`/acme/accessible/group-exchanges/new?status=create-invalid`. This is group
exchange action redirect evidence only; it does not newly certify full
organiser/participant authorization depth, same-tenant member search parity,
settlement side effects, feature gates, localization, broader Laravel runtime
behavior, or ASP.NET backend compatibility.

The sixty-eighth source slice extends route-level redirect cleanup into
ideation actions. `src/routes/ideation-actions.js` now sends signed-out auth
handoffs, challenge create/update/status/favorite/duplicate/delete/link/outcome
results, idea submit/draft/comment/vote/status/media/convert/delete results,
and campaign create/update/unlink/delete results through `redirectTo(res, ...)`,
which delegates to `res.locals.urlFor` when shell locals are available. The
focused source regression first failed on raw `/ideation` helper returns and
flat ideation redirect strings, then passed after conversion. Focused
shared-mount coverage proves a signed `/acme/accessible/ideation/new`
submission redirects to `/acme/accessible/ideation/42?status=challenge-created`.
This is ideation action redirect evidence only; it does not newly certify admin
authorization depth, media upload proxying, team conversion runtime behavior,
feature gates, localization, broader Laravel runtime behavior, or ASP.NET
backend compatibility.

The sixty-ninth source slice extends template-helper cleanup into the ideation
template family. The ideation tabs, campaign links, challenge list filter form,
clear link, challenge detail links, create/edit/manage/outcome/draft form
targets, idea detail controls, tag browser links, campaign detail links, and
outcome challenge links now call `urlFor()` rather than embedding flat
`/ideation` paths. The focused source regression first failed on the raw
`/ideation` tab links, then passed after conversion, and focused ideation
render/action coverage passed for the Laravel-backed flat routes. This is
source-template tenant-helper evidence only; it does not newly certify full
visual Blade parity, ideation authorization depth, media upload proxying,
feature gates, localization, broader Laravel runtime behavior, or ASP.NET
backend compatibility.

The seventieth source slice extends route-level redirect cleanup into
notifications. `src/routes/notifications.js` now sends grouped-read, read-all,
delete-all, single-read, single-delete, API-error, and validated safe-return
redirects through `redirectTo(res, ...)`, which delegates to
`res.locals.urlFor` when shell locals are available. The focused source
regression first failed on raw `/notifications` redirect targets, then passed
after conversion, and existing notification alias behavior still passes for the
flat Laravel-compatible routes. This is notification redirect evidence only; it
does not newly certify realtime unread-count depth, persistence side effects,
localization, broader Laravel runtime behavior, visual Blade parity, or ASP.NET
backend compatibility.

The seventy-first source slice extends route-level redirect cleanup into poll
actions. `src/routes/poll-actions.js` now sends auth-required, create, vote,
rank, delete, like, and comment result redirects through `redirectTo(res, ...)`,
which delegates to `res.locals.urlFor` when shell locals are available. The
focused source regression first failed on raw `/login` and `/polls` redirect
targets plus raw poll helper return strings, then passed after conversion.
Focused shared-mount coverage proves unsigned
`/acme/accessible/polls/42/vote` redirects to
`/acme/accessible/login?status=auth-required`. This is poll redirect evidence
only; it does not newly certify feature gates, exact open/closed list parity,
owner authorization, localization, runtime persistence, visual Blade parity, or
ASP.NET backend compatibility.

A follow-up legacy poll vote redirect cleanup covers the older
`src/routes/polls.js` vote handler. Its success and non-401 API-error redirects
now use a route-local `redirectTo(res, ...)` helper backed by
`res.locals.urlFor`, and the source regression first failed on raw
``res.redirect(`/polls/${id}`)`` calls before passing after conversion. Focused
poll behavior tests still pass for the Laravel poll suite, including the
shared-mount signed-out vote redirect.

A follow-up poll source slice converts the rendered poll templates themselves.
`src/views/polls/index.njk`, `create.njk`, `detail.njk`, `manage.njk`, and
`rank.njk` now route poll browse filters, create/manage links, inline create
form, detail/rank back links, vote/rank/delete/like/comment forms, discussion
links, and CSV export links through `urlFor()`. The focused source regression
first failed on literal `href="/polls...` and `action="/polls...` template
targets, then passed after conversion. This is source/template routing evidence
only; it does not newly certify poll feature gates, exact list parity, owner
authorization, localization, runtime persistence, visual Blade parity, or
ASP.NET backend compatibility.

The seventy-second source slice extends route-level redirect cleanup into
reviews. `src/routes/reviews.js` now sends auth-required review creation,
comment validation/result, reaction result, and Laravel-401 handoffs through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell locals
are available. Review helper URLs for comments and paginated review lists now
build from a shared `/reviews` constant instead of raw root-relative returns.
The focused source regression first failed on raw `/login` and `/reviews`
redirect targets plus raw review helper return strings, then passed after
conversion. Focused shared-mount coverage proves unsigned
`/acme/accessible/reviews` redirects to
`/acme/accessible/login?status=auth-required`. This is review redirect evidence
only; it does not newly certify exact moderation/deletion display, threaded
reply depth, feature gates, localization, runtime persistence, visual Blade
parity, or ASP.NET backend compatibility.

A follow-up review source slice converts the rendered review templates
themselves. `src/views/reviews/index.njk`, `list.njk`, and `comments.njk` now
route review summary/list/comment links, received/given tabs, load-more links,
pending-review forms, comment forms, and reaction forms through `urlFor()`.
The focused source regression first failed on literal `href="/reviews...` and
`action="/reviews...` template targets plus the raw `loadMoreHref`, then
passed after conversion. This is source/template routing evidence only; it does
not newly certify moderation/deletion display, threaded reply depth, feature
gates, localization, runtime persistence, visual Blade parity, or ASP.NET
backend compatibility.

A follow-up review redirect slice now mirrors Laravel
`AlphaController::deleteReview()` by sending review deletion success and
non-auth API-error outcomes to the reviews index status route through the same
`redirectTo(res, ...)` helper. Focused shared-mount coverage proves signed
`/acme/accessible/reviews/91/delete` ignores a submitted `return_url=/dashboard`
and redirects to `/acme/accessible/reviews?status=review-deleted`, while
non-auth API failures redirect to
`/acme/accessible/reviews?status=review-delete-failed`. The source regression
first failed on `validateReturnUrl`/`return_url`, and the behavior regression
first failed on the old dashboard return, then passed after Web UK matched
Laravel's reviews-index status redirect.

The seventy-third source slice extends route-level redirect cleanup into event
actions. `src/routes/events.js` now sends unsigned event handoffs, recurring
non-series handoffs, waitlist/check-in/poll/recurring/translation POST
outcomes, create/edit status redirects, cancel/delete results, and RSVP results
through `redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when
shell locals are available. Event helper URLs now build from a shared
`/events` constant instead of raw root-relative return strings. The focused
source regression first failed on raw `/login` and `/events` redirect targets,
then passed after conversion. Focused shared-mount coverage proves signed
`/acme/accessible/events/7/waitlist` and
`/acme/accessible/events/7/translate` POSTs redirect back under the active
tenant mount. This is event redirect evidence only; it does not newly certify
full event visual Blade parity, owner/participant authorization depth,
notification/XP/waitlist side effects, feature gates, localization, broader
Laravel runtime behavior, or ASP.NET backend compatibility.

The seventy-fourth source slice extends route-level redirect cleanup into goal
actions. `src/routes/goals.js` now sends goals auth-required handoffs,
create/template/delete/buddy/progress/complete/check-in/reminder/buddy-action/
like/comment outcomes, and Laravel-401 fallbacks through
`redirectTo(res, ...)`, which delegates to `res.locals.urlFor` when shell
locals are available. Goal helper URLs now build from a shared `/goals`
constant instead of raw root-relative status strings. The focused source
regression first failed on raw `res.redirect(loginRedirect())` and raw
`/goals` redirect targets, then passed after conversion. Focused shared-mount
coverage proves signed create, buddy-nudge, and comment POSTs plus an unsigned
progress POST redirect under `/acme/accessible`. A scoped Laravel runtime smoke
for the goals page family first exposed a stale check-in body marker, then
passed all 30 focused checks with Laravel's Blade string `Log a check-in`.
This is goals redirect evidence only; it does not newly certify full goals
visual Blade parity, owner/buddy authorization depth, feature gates,
localization, broader Laravel runtime persistence, or ASP.NET backend
compatibility.

Verification command:

```powershell
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "notification route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "notification"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "ideation template links"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "ideation"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "ideation action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "ideation action"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "ideation GET auth redirects"
npm --prefix apps/web-uk run smoke:laravel # scoped with SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS for ideation GET auth routes
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group exchange action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "group exchange"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "feed action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "feed action validation redirects"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "poll action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "poll action redirects inside|Laravel poll"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "review action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "review action redirects inside|Laravel review"
npm --prefix apps/web-uk test -- --runTestsByPath tests/tenant-routing-source.test.js --runInBand
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "premium links"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "premium"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "search route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "search"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "wallet action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "wallet"
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/wallet=>Wallet,/wallet/manage=>Manage credits'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "exchange route redirects"
npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "submits the Laravel exchange action" --runInBand --silent
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "member onboarding route redirects"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "blog route redirects"
npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "blog redirects inside" --runInBand --silent
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "skills links, form"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "skills redirects and links"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "clubs form and route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "clubs redirects and search form"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "connection route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "connection action redirects inside"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "achievements route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "achievement POST redirects inside"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "Explore route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Explore hub"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "contact and report route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "contact validation redirects inside|report-problem redirects inside"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "server-level redirects"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "server-level"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = '/organisations/42'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/cookies=>Cookies'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "auth route redirects"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "auth POST redirects inside"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/login=>Sign in,/login/forgot-password=>Reset your password,/password/reset?token=reset-token=>Choose a new password'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "matches route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "match dismiss redirects inside"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "matches"
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/matches=>Your matches,/matches/board=>Your matches'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "AI chat route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "empty Laravel AI chat redirects inside"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "AI chat"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/chat=>AI assistant'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "shared empty-state"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "prefixes shared empty-state"
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/members=>Community members'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "shared pagination"
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "signed Laravel members index"
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'; $env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/members=>Community members'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "AI chat and matches"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "matches|AI chat"
$env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/chat=>AI assistant,/matches=>Your matches,/matches/board=>Your matches'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public coupon"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "coupon"
$env:SMOKE_GATED_PAGE_PATHS = '/coupons,/coupons/1'; $env:SMOKE_MODULE_PAGE_PATHS = 'none'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "exchange list"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "exchange"
$env:SMOKE_MODULE_PAGE_PATHS = '/exchanges'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/exchanges=>Exchanges'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; $env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "goals browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "goal"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "member dashboard"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "member dashboard"
$env:SMOKE_MODULE_PAGE_PATHS = '/dashboard'; $env:SMOKE_BODY_TEXT_PAGE_PATHS = '/dashboard=>Quick links'; $env:SMOKE_GATED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'; $env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_REDIRECT_PAGE_PATHS = 'none'; $env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'; npm --prefix apps/web-uk run smoke:laravel
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "knowledge-base"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "knowledge base"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "orders shared-root tenant chooser"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "tenant chooser|shared tenant accessible mount|custom accessible domains"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "jobs browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "jobs|job"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "saved-item"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "saved"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "search forms"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "search"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "resource browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "resource"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "Laravel-reserved parent-domain"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "Laravel-unreserved accessible route names"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "course browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "course"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "listing index"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "signed listing index|owner listing delete"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "event index"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "event"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group index"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "renders group navigation without legacy member-management links"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "organisation directory"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "organisations"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "blog index"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "blog"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public auth and support"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "login|register|password|cookie|contact|report"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "wallet links"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "wallet"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group exchange tabs"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "group exchange"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "notifications filters|notification route redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "notifications"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "podcast"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast action redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "podcast action aliases"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast page redirects"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "redirects signed-out visitors away from podcasts"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "feed browse"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "author-shaped posts"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "feed"
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk test -- --runInBand
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk test -- laravel-runtime-smoke.test.js --runInBand
$env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'timebank.global|/hour-timebank/login=>Sign in'
npm --prefix apps/web-uk run smoke:laravel
$env:SMOKE_BODY_TEXT_PAGE_PATHS = '/hour-timebank/accessible=>Accessible;/hour-timebank/accessible=>Connecting Communities;/hour-timebank/accessible=>What you can do'
npm --prefix apps/web-uk run smoke:laravel
```
