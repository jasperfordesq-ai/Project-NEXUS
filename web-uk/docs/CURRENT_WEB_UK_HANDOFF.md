# Historical Web UK Accessible Frontend Handoff Archive

Last reviewed as an archive: 2026-07-14

Status: **Historical checkpoint — not a current status or resume source**

> **Archive notice:** This is not a current handoff despite its retained
> filename. Do not start or resume work, report a score, select the next job, or
> copy execution commands from this file. Read
> `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for the only current Web UK
> architecture, ownership boundary, safety rule, counts, score, and queue, then
> use `../../../docs/FULL_PARITY_REMEDIATION_RUNBOOK.md` for the broader
> cross-workstream gate.
> This archive intentionally does not repeat the live score, route inventory,
> API-ledger totals, test aggregate, blocker set, or working-tree boundary.
> Those values change independently and must be read from the canonical status
> document at reporting time.
>
> Historical references in this file to a "candidate", "skeleton", ASP.NET
> compatibility work, or direct mutation of the ordinary Laravel development
> database are not current instructions. Web UK is the implementation target;
> Laravel Blade defines the browser experience, the Laravel backend defines the
> API contract, and ASP.NET is a separate future backend that must conform to
> Laravel. The Laravel repository, schema, and ordinary local database are
> read-only from this workstream.
>
> Any historical claim in this file that a live mutation, upload, download,
> destructive action, disposable lifecycle, cleanup, or final absence was
> certified against the ordinary local Laravel instance is invalidated. Those
> runs may explain retained frontend regressions, but they are not current
> certification evidence. No separately provisioned disposable Laravel
> environment is currently evidenced.
>
> **Execution fence:** Every login, authenticated journey, runtime smoke,
> mutation, upload, download, cleanup, migration, or destructive command in
> this archive is historical text, not an instruction. It may be rerun only
> after `LARAVEL_BASE_URL` is explicitly pointed at a separately provisioned
> and verified disposable Laravel application/database/storage environment.
> The ordinary `127.0.0.1:8088` Laravel environment is always read-only;
> authorization, unique fixtures, `finally` cleanup, or restoration logic never
> make it disposable.

This archive records how earlier implementation slices evolved. The previous
parallel `main` and `codex/web-uk-laravel-parity` work streams were consolidated
back onto `main` on 2026-07-08. Every count, queue, completion statement, and
runtime outcome below is a dated historical snapshot and is superseded by the
current-status document.

## Objective

Complete `apps/web-uk` as the future shared accessible frontend for Project
NEXUS. It must use:

- the Laravel accessible frontend as the product/UI source of truth for browser
  routes, links, layout, navigation, content hierarchy, forms, validation
  presentation, redirects, tenant behaviour, and workflows;
- the Laravel backend as the contract source of truth for methods, paths,
  payloads, envelopes, statuses, auth, roles, modules, uploads, downloads,
  persistence, and side effects;
- Express, Nunjucks, GOV.UK Frontend, server-rendered HTML, and progressive
  enhancement as the chosen Web UK implementation stack, with no React.

The result must serve Laravel first. When the separate backend parity workstream
is complete, it must also be able to serve ASP.NET by changing configuration
only and running the same unchanged frontend. ASP.NET must bend toward
Laravel's contracts; it must not define or fork Web UK behaviour.

## Source Of Truth

| Surface | Source |
| --- | --- |
| Laravel accessible app | `C:\platforms\htdocs\staging\accessible-frontend` |
| Laravel accessible routes | `C:\platforms\htdocs\staging\routes\govuk-alpha.php` |
| Laravel parity route files | `C:\platforms\htdocs\staging\routes\govuk-alpha-parity` |
| Laravel Blade views/controllers | `C:\platforms\htdocs\staging\accessible-frontend\views`, `C:\platforms\htdocs\staging\app\Http\Controllers\GovukAlpha` |
| Web UK target | `C:\platforms\htdocs\asp.net-backend\apps\web-uk` |
| Previous parity worktree | `C:\Users\jaspe\.config\superpowers\worktrees\asp.net-backend\codex-web-uk-laravel-parity` |

The Laravel repository, schema, and ordinary local database are read-only from
this workstream. The ordinary database is a confidential production-derived
snapshot and must never receive test writes. Mutation certification must use an
isolated disposable Laravel environment provisioned separately from it.
ASP.NET backend files and migrations belong to the separate backend workstream.

## 2026-07-13 Laravel Source and Independent-Audit Refresh

At this historical checkpoint, the read-only Laravel source was
`c2cf4fa66`. Recent commits and the
maintained `docs/API.md`, `docs/TESTING.md`, `docs/modules/events.md`,
`accessible-frontend/CLAUDE.md`, `accessible-frontend/README.md`, and
`accessible-frontend/COMPONENTS.md` were rescanned before continuing Web UK
work. The source now defines Events as an authenticated, tenant-scoped,
feature-gated module rather than an anonymous catalogue. Publication and
operational lifecycle are separate; registration, waitlist, attendance,
entitlement, and engagement are independent axes; recurrence controls must use
the authenticated runtime capability contract; and advanced recurrence,
moderation, lifecycle-history, template-history/materialisation, registration-
product, communications, safety, and offline check-in workflows are explicit
maintained-client boundaries.

The regenerated declaration inventory now reports `687` Laravel routes, `688`
Web UK routes, `681` matches, `6` missing Laravel declarations, `5` extra Web UK
declarations, and `3` ignored infrastructure routes. The six gaps are five
tenant-admin Event moderation routes and signed offline check-in-code
attendance; Laravel exposes no tenant-scoped API v2 contract for Web UK to call,
so they remain honest API-boundary gaps. Four of the five extras are deliberate
legacy `404` tombstones and the fifth is the bearer-safe volunteering credential
download proxy. These declaration counts do not certify workflows.

The refreshed source invalidates the older audit assumption that unsigned
`/events` should render a public event shell. Current Laravel documentation and
routes require authentication and the Events feature boundary. Current Web UK
already mounts `/events` behind `requireAuth`; a live unsigned request to
`/hour-timebank/accessible/events` returned `302` to the mounted login. Do not
weaken that boundary or invent a public catalogue contract.

A current-source disposable Event rerun now supersedes the historical Event
mutation pass as the certification boundary. Web UK reached its authenticated
multipart create submission, but Laravel returned `500`; the Laravel log records
`SQLSTATE[42S22]` because `EventService` inserts
`events.accessibility_step_free` while the read-only local table lacks that
column. The insert failed atomically and retained no disposable Event. Keep the
runtime test unchanged and rerun it after the Laravel schema is caught up; do
not mask this upstream schema state in Web UK.

Profile-settings skills, match notifications, and ordinary notification
settings now have fresh reversible evidence:
`npm run smoke:laravel:profile-skills-mutation` passed `3/3` in `7.5` minutes.
It created and removed a uniquely named offering/requesting skill, changed and
restored the exact match-preference tuple, and changed and restored the exact
ordinary notification and digest settings. The run exposed and fixed Web UK
sending digest cadence to the general preference endpoint, where Laravel
silently ignored it; Web UK now uses Laravel's separate global notification-
settings contract and includes the source's event-email preference. All three
cases passed 320px structure/reflow/axe checks and independent API absence or
restoration checks. The full gate passed `46/46` suites and `1,567/1,567`
tests, ESLint, the branding guard, and the `315`-template localization audit.
Avatar upload remains uncertified because the current Laravel bearer API can
null the profile field but cannot prove deletion of the stored file.

## Historical Verified Checkpoint (2026-07-12)

This is retained implementation history. The 2026-07-13 source refresh above
and `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` are the current evidence boundary;
the suite sizes, route counts, smoke totals, and scores below must not be reused
as current results.

- Jest: `45/45` suites and `1,465/1,465` tests passed.
- Static/build gates: ESLint, brand policy, and CSS compilation passed.
- Route matrix: `608` Laravel declarations, `610` Web UK declarations, `608`
  matched, `0` missing, `0` extra parity routes, and `3` ignored infrastructure
  routes. This proves declarations only.
- Localization structure: all `11` locales, `24` namespaces, and `7,364` keys
  per locale are present with zero structural drift. It is not translation
  completion: each non-English catalog still has roughly `3,903-3,951` values
  identical to English and `16` namespaces are wholly English in the
  authoritative read-only Laravel source.
- Conservative template audit: `285` templates and `0` safe exact-value
  substitutions remaining. This is deliberately narrower than contextual
  translation review.
- Latest uninterrupted full automated browser accessibility pass: Chromium/axe
  passed `80/80` cases in `1,610.1` seconds (`26.8` minutes), with `0` skipped,
  `0` unexpected, and `0` flaky results, at checkpoint `ea1ed6d4` on 2026-07-11.
  The outer command wall time, including CSS compilation and runner
  startup, was `1,632.4` seconds (`27.2` minutes).
- Live Blade marker comparison: `19/19` checks passed.
- Opt-in saved-collection mutation smoke: `1/1` passed in `81.0` seconds
  against Laravel. It created a unique private collection, updated its name and
  description, deleted it, and verified it was absent from the final listing.
  All three POSTs returned `302`; the fixture was disposable and no collection
  was retained.
- Opt-in flat-bookmark removal smoke: `1/1` passed in `135.5` seconds. It
  selected a real listing that was not already bookmarked, toggled it on only
  for setup, proved the rendered no-JS remove form, submitted it through Web UK,
  and verified absence in both the final Saved page and Laravel BookmarkService.
  This exposed and fixed the prior wrong SOC10 delete boundary: the route now
  matches Blade's `POST /api/v2/bookmarks` `{ type, id }` toggle contract.
- Opt-in Resources side-effect smoke: `1/1` passed in `95.2` seconds. It
  uploaded a unique 59-byte text file through the Web UK multipart form,
  found the exact Laravel-backed library card, downloaded an attachment with
  byte-for-byte equality, persisted then removed a celebrate reaction, created
  then deleted an own comment, passed 320-pixel structure/reflow/axe checks,
  deleted the file through the rendered warning action, and proved final
  Laravel listing absence. No disposable row, reaction, comment, or file was
  retained.
- Live tenant module-gate smoke: `1/1` passed in `22.4` seconds against the
  default-English `timebanking-org` bootstrap. Home returned `200`; disabled
  Marketplace, Courses, Podcasts, and Premium links were absent and each route
  returned `403`; enabled Resources returned the tenant-mounted auth-required
  `302`. No tenant state was changed.
- Default-English Events empty results now match Blade's catalog inset exactly:
  `No results found`, `No events match your filters`, and a Clear filters link
  only when search, group, or non-default time filters are active. The invented
  no-events/create-or-sign-in CTA was removed; focused coverage passes `2/2`.
- Default-English Listings and Groups empty results now follow Blade rather
  than the generic card component: Listings uses the catalog inset and only
  offers Clear filters for active search/type filters; Groups uses its single
  catalog inset for all empty results. Invented duplicate create/sign-in and
  search-specific empty actions were removed; focused coverage passes `3/3`.
- Type-filtered Search zero results now render Blade's one catalog inset rather
  than two generic empty cards. Invented view-all and browse-listings empty
  actions were removed; focused Search coverage passes `2/2`.
- ASP.NET unchanged-frontend readiness audit is now repeatable with
  `npm run audit:aspnet:readiness`. The live process on port `5080` is healthy,
  but slug-first tenant bootstrap and platform stats both return `400` because
  ASP.NET requires `X-Tenant-ID` before bootstrap. This is a backend blocker;
  Web UK did not add an ASP.NET-specific tenant branch. The on-disk backend fix
  adds public v2 middleware exclusions and an explicit v2 bootstrap route; the
  focused ASP.NET integration class passes `8/8`. The running port-5080 process
  still needs an owner-controlled rebuild/restart before the live audit can be
  rerun. The static comparator reports `2,436/2,449` Laravel operations matched,
  and none of its 13 missing routes is consumed by Web UK, but runtime switching
  is not certified.
- Default-English branded header proof: the real `timebanking-org` bootstrap
  logo loaded at `392x105` intrinsic and `179x48` rendered size, with the exact
  tenant name as alt text and no horizontal overflow. Web UK now follows
  Blade's dark-logo preference and wide/landscape/square sizing. Web UK's
  branding guard still requires the explicit non-government header disclosure,
  an intentional local divergence from Blade. Per-tenant header colours remain
  blocked by the public bootstrap contract.
- Current browser evidence proves `lang="ar"`, `dir="rtl"`, one `main`/H1,
  unique IDs, and no horizontal overflow at 320 CSS pixels on the Arabic login
  and signed dashboard. The expanded gate now drives native Chromium Tab/Enter
  input through cookie controls and the skip link, proves focus moves to
  `#main-content`, verifies client-error summary focus and error-link field
  focus, checks localized Arabic error announcements, and runs axe under forced
  colours. Live current-source inspection independently confirmed the summary
  is the active `role="alert"` element and the forced-colour select/footer pairs
  resolve to white on black without overflow. The new authenticated Arabic
  dashboard/account/profile/profile-settings/activity/notifications/messages/connections/wallet/member-directory/member-profile/knowledge-base/help/trust-and-safety/about/guide/features/faq/legal/accessibility/contact/report-problem/cookies/email-utilities/achievements/leaderboard/NEXUS-score cases prove their Laravel-owned headings, actions,
  labels, plural/number formatting, and structural sections. The dashboard's
  welcome, CTA, statistics,
  progress, quick links, feed/listing labels, image alternatives, and numeric
  formatting no longer fall back to the previous hard-coded English strings.
  This is still not a completed screen-reader or assistive-technology record.

The current-source Laravel runtime smoke is now certified in deterministic
serial shards. The base bucket passed `93/93`; all `276` default module pages
and all `270` default body markers were then covered across six shards. Shards
1, 2, 4, and 6 passed `101/101`. Shards 3 and 5 each initially passed
`100/101` because one request exceeded the harness's 60-second limit
(`/ideation/2/ideas/1` and `/jobs/employers/14` respectively); each isolated
retry passed `11/11`. In aggregate, all `639` distinct default checks passed
with no repeatable route failure. This is current read/auth/gate/body evidence,
not broad mutation, upload, download, or destructive-side-effect certification.
Saved-collection create/update/delete is separately certified by the opt-in
disposable-fixture smoke above. The two latency aborts mean the broad read smoke
is not represented as one uninterrupted clean run.

That smoke exposed a current fixture contract on federation-protected pages:
Laravel returns `403` with `FEDERATION_NOT_ENABLED` until the member opts in.
Web UK now maps that exact API code to the tenant-safe `/federation/opt-in`
route, matching Blade, rather than rendering `503`. The focused current-source
federation runtime slice passed `13/13`; the default inventory now treats the
nine affected federation-backed pages as expected signed opt-in redirects.

## 2026-07-10 About Live Statistics Slice

Public `/about` now matches Laravel's optional live-impact band. It calls the
existing `/api/v2/platform/stats` contract with `X-Tenant-Slug` on shared
tenant mounts and Host authority on custom-domain mounts, renders members,
hours exchanged, active listings, and communities in Laravel's Blade order,
and uses exact request-locale labels plus locale-aware zero-decimal number
formatting. As in `AlphaController::platformStats()`, any API failure or empty
payload leaves the About page usable and hides the entire band.

Focused populated, Arabic, mounted-tenant, empty, and unavailable coverage
passed `3/3`. The real Laravel-backed Arabic About/Guide/Features/FAQ journey
proved the live stats heading at 320 CSS pixels with RTL reflow and no
serious/critical axe findings. ESLint, catalog structure, and the conservative
template audit passed; the aggregate Jest gate passed `45/45` suites and
`1,412/1,412` tests in `73.0` seconds, and the full Chromium/axe gate passed
`62/62` in `13.1` minutes. The browser count is unchanged because this
strengthens an existing journey. Live Guide module-gate variations,
tenant-domain depth, manual assistive-technology review, and ASP.NET backend
compatibility remain uncertified.

## 2026-07-10 Guide Module CTA Slice

Public `/guide` remains available regardless of module configuration, matching
Laravel, but its action group now follows Blade's exact module gates. Guests
always retain Create account; Browse listings appears only when the routed
tenant enables the listings module; signed members see Browse listings and Go
to wallet independently when their corresponding modules are enabled. All
local actions remain tenant-prefixed through `urlFor()`.

Focused shared-mount coverage proves guest, both-disabled, listings-only, and
wallet-only variants. The aggregate Jest gate passed `45/45` suites and
`1,413/1,413` tests, ESLint and the `290/0` conservative template audit passed,
and the real Laravel-backed Arabic four-page journey required the enabled
tenant's localized Browse listings CTA while remaining RTL/reflow/axe clean at
320 CSS pixels.

Three current-source full-browser attempts did not produce a green aggregate
result under severe local Laravel latency. The first reached the fully rendered
Arabic dashboard but exceeded that case's 30-second ceiling during the final
axe/cleanup phase. An isolated retry showed login at `7.4` seconds and setup
dashboard at `19.1` seconds before the Arabic request itself exceeded 30
seconds. The case now has the same explicit 90-second ceiling used for measured
slow authenticated cases and passed unchanged assertions in isolation. The
second full run then exceeded the authenticated setup's internal 60-second
dashboard URL wait; setup now coherently permits 180 seconds with a 120-second
URL wait. The third full run remained active without a returned Playwright
failure until the outer command was killed at 20 minutes. No runner/browser
process remained afterward. Therefore the current full matrix is **not**
claimed green; the latest uninterrupted 62/62 pass remains the immediately
preceding `e155375c` checkpoint.

A live Laravel tenant fixture with listings and/or wallet disabled is still
unavailable, so that disabled-state runtime proof remains open alongside a
current aggregate browser rerun under normal fixture latency, tenant-domain
browser proof, manual assistive-technology review, and ASP.NET backend
compatibility.

## 2026-07-10 Public Information Custom-Domain Slice

Focused custom-domain traversal now covers About, Guide, Features, and FAQ
through the real host-resolution middleware. All four pages resolve the tenant
name from host authority and keep local actions slugless; About sends Host
authority to `/api/v2/platform/stats`; Guide preserves its module-aware guest
actions; and Features links to the slugless Guide route. The focused traversal
passed `1/1`, and the aggregate Jest gate passed `45/45` suites and
`1,414/1,414` tests in `135.7` seconds. No production code changed in this
certification slice. A live custom-domain browser fixture, the latency-blocked
current aggregate browser rerun, manual assistive-technology review, and
ASP.NET backend compatibility remain open.

## 2026-07-10 Tenant Home Localization Slice

The standard tenant Home now resolves Laravel's exact request-locale catalog
for its caption/default description, guest and profile actions, four impact
labels, module titles/descriptions, modules heading/intro, community/account
summary labels, and signed-in/signed-out state. Platform statistics now use the
request locale and Laravel-equivalent zero-decimal formatting instead of fixed
`en-GB` formatting with a retained decimal. Tenant SEO heading/intro and the
Web UK-only master/cluster network landing copy remain backend-owned or local
enhancements and were not replaced with invented Laravel keys.

Focused English/Arabic Home coverage passed `2/2`; the complete route suite
passed `67/67`; and the real Laravel-backed Arabic Home/About/Guide/Features/FAQ
journey passed in `29.2` seconds with localized Home module/stat markers, RTL,
320-pixel reflow, and no serious/critical axe findings. ESLint and the `290/0`
template audit passed. The normal aggregate Jest rerun passed `45/45` suites
and `1,415/1,415` tests in `160.5` seconds.

During verification, an inspection command accidentally left an unquoted
PowerShell redirection operator and overwrote
`tests/shared-accessible-shell.test.js` with UTF-16 search output. Two
aggregate runs exposed the resulting NUL/Babel parse failure. The file was
restored exactly from committed `HEAD` (which already contained all intended
changes), its diff returned empty, and the subsequent normal aggregate passed.
No user or concurrent backend change was overwritten.

## 2026-07-10 Tenant Home Workflow-Gate Slice

Signed tenant Home module cards now match Blade's conjunctive workflow gates:
Messages requires the routed tenant's `direct_messaging` feature, and Exchanges
requires both the listings module and `exchange_workflow`. Listings also uses
Blade's disabled fallback when bootstrap omits that module, while the other
documented Home fallbacks remain unchanged. Disabled signed cards render as
unlinked/unavailable rather than offering a route that Laravel would gate.

Focused standard, Arabic, and signed-disabled Home coverage passed `3/3`; the
aggregate Jest gate passed `45/45` suites and `1,416/1,416` tests in `127.1`
seconds, and ESLint passed. A real disabled-module Laravel tenant fixture is
still unavailable, so live disabled-state proof remains open.

## 2026-07-10 Tenant Chooser Localization Slice

The shared-root tenant chooser now uses Laravel's exact request-locale catalog
for each community slug label and the empty-state heading. The existing
Web UK-only API load-error sentence remains local because Laravel has no
corresponding key. Focused populated/empty Arabic coverage passed within the
`3/3` chooser slice. A real shared-root Arabic chooser plus tenant Help/Trust
journey passed in `38.6` seconds with RTL, 320-pixel reflow, and no
serious/critical axe findings. The aggregate Jest gate passed `45/45` suites
and `1,417/1,417` tests in `185.8` seconds; ESLint and the `290/0` conservative
template audit passed.

## 2026-07-10 Cookie And Email Utility Localization Slice

Public `/cookies`, `/newsletter/unsubscribe`, and `/verify-email` now resolve the
cookie-settings caption plus missing/invalid email-token states, back action,
and document titles through Laravel's exact request-locale catalog. Success and
token-present behavior remains API-backed as before; live proof uses only
missing-token GETs and therefore changes no consent, subscription, or account
state. Middleware-less isolated route mounts retain explicit English title
fallbacks.

Focused English/Arabic utility coverage passed `4/4`; the complete Jest gate
passed `45/45` suites and `1,411/1,411` tests. A real Laravel-backed Arabic
three-page journey passed RTL, 320-pixel reflow, and axe in `11.7` seconds, and
the expanded Chromium/axe matrix passed `62/62` in `749.3` seconds (`12.3`
minutes). The first aggregate Jest attempt timed out after the isolated auth-
authority mount called a missing translator; diagnostic proof identified it,
an English fallback fixed it, focused authority/utility coverage passed `5/5`,
and the normal aggregate rerun then closed green in `87.2` seconds. Remaining
gaps are backend consent-audit persistence, safe live token success/invalid API
effects, manual assistive-technology review, and ASP.NET backend compatibility.

## 2026-07-10 Report-A-Problem Contextual Localization Slice

Signed GET/POST `/report-a-problem` now resolves its title/caption, page label,
impact choices, submit/success/failure states, and server-validation errors
through Laravel's exact request-locale catalog. The no-JS invalid round trip
preserves locale and return-page context through the tenant-safe redirect. Both
focused and live browser evidence deliberately stop before the support API call,
so no report or downstream notification is created.

Focused signed/report-routing coverage passed `7/7`; the complete Jest gate
passed `45/45` suites and `1,410/1,410` tests. A real Laravel-authenticated
Arabic invalid-submission journey passed localized errors, RTL, 320-pixel
reflow, and axe in `14.1` seconds, and the expanded Chromium/axe matrix passed
`61/61` in `565.9` seconds (`9.3` minutes). Remaining gaps are safe successful
report persistence, reference/notification side effects, production failure
states, manual assistive-technology review, and ASP.NET backend compatibility.

## 2026-07-10 Contact Contextual Localization And Validation Slice

Public GET/POST `/contact` now resolves its title, caption, subtitle, field and
subject labels, report-page prefill, validation errors, failure/rate-limit/
Turnstile statuses, and banner semantics through Laravel's exact request-locale
catalog. The no-JS validation round trip stores localized field errors and
preserves the chosen locale through the tenant-safe redirect. The focused live
browser path deliberately stops at validation, so it creates no contact record.

Focused Contact form/submission/validation coverage passed `5/5`; the complete
Jest gate passed `45/45` suites and `1,409/1,409` tests. A real Laravel-backed
Arabic invalid-submission journey passed localized error rendering, RTL,
320-pixel reflow, and axe in `16.3` seconds, and the expanded Chromium/axe
matrix passed `60/60` in `727.6` seconds (`12.0` minutes). Remaining gaps are a
safe live successful submission, production Turnstile/rate-limit outcomes,
notification side effects, manual assistive-technology review, and ASP.NET
backend compatibility.

## 2026-07-10 Legal And Accessibility Contextual Localization Slice

Public `/legal`, all five `/legal/{document}` routes, and `/accessibility` now
resolve hub cards, captions, fallback policy intros/points/keyed sections,
notices, contact prompts, metadata labels, accessibility goals, limitations,
testing copy, and document titles through Laravel's exact request-locale
catalog. Managed legal HTML and its authored title remain Laravel-owned content;
its effective date now uses the shared request-locale formatter rather than raw
ISO output. The catalog adapter preserves both indexed and associative PHP
arrays after JSON generation.

Focused managed/fallback/Arabic Legal coverage passed `3/3`; the complete Jest
gate passed `45/45` suites and `1,408/1,408` tests. A real Laravel-backed Arabic
hub/privacy/accessibility journey passed RTL, 320-pixel reflow, and axe in
`12.7` seconds, and the expanded Chromium/axe matrix passed `59/59` in `734.5`
seconds (`12.1` minutes). Remaining gaps are acceptance prompts, version-
history/compare behavior, broader live managed/fallback permutations, manual
assistive-technology review, and ASP.NET backend compatibility.

## 2026-07-10 Public Information Contextual Localization Slice

Public `/about`, `/guide`, `/features`, and `/faq` now resolve their document
titles, captions, descriptions, About steps/values/CTA labels, all three Guide
steps, all six Features items, and all five FAQ question/answer pairs through
Laravel's exact request-locale catalog. The duplicate English route constants
were removed. Contributor names/roles remain repository-authored attribution
data rather than being translated by Web UK.

Focused English/Arabic public-information coverage passed `4/4`; the complete
Jest gate passed `45/45` suites and `1,407/1,407` tests. A real Laravel-backed
Arabic four-page journey passed RTL, 320-pixel reflow, and axe in `23.0`
seconds, and the expanded Chromium/axe matrix passed `58/58` in `569.9` seconds
(`9.3` minutes). Remaining gaps are About live-stat parity, live Guide module-
gate variations, tenant-domain depth, manual assistive-technology review, and
ASP.NET backend compatibility.

## 2026-07-10 Help Centre And Trust And Safety Localization Slice

Public `/help` and `/trust-and-safety` now resolve their document titles,
captions, subtitles, search controls and result states, safeguarding warning,
all nine safety-section headings/intros/item arrays, and contact actions through
Laravel's exact request-locale catalog. The former duplicate English Trust and
Safety corpus was removed from the route. FAQ category fallback copy is also
localized, while FAQ questions, categories, and rich answers remain the
admin-authored Laravel API content rather than being rewritten by Web UK.

Focused English/Arabic support coverage passed `2/2`; the complete Jest gate
passed `45/45` suites and `1,406/1,406` tests. A real Laravel-backed Arabic
Help/Trust journey passed RTL, 320-pixel reflow, and axe in `15.1` seconds, and
the expanded Chromium/axe matrix passed `57/57` in `524` seconds (`8.5`
minutes). Remaining gaps are translation governance for backend-authored FAQ
content, tenant-domain/feature-gate depth, broader FAQ administration/runtime
states, manual assistive-technology review, and ASP.NET backend compatibility.

## 2026-07-10 Knowledge Base Contextual Localization Slice

Public `/kb` and `/kb/{id}` now use Laravel's exact Knowledge Base catalog for
the page caption, subtitle, search controls and hint, result count, empty and
no-result states, article/related headings, author/update labels, and back
navigation. Article summaries use Laravel's plural view-count choice, and
article update dates now pass through the shared request-locale formatter rather
than exposing raw ISO timestamps. Missing articles opt into a localized
Knowledge Base 404 title and body without changing the generic shared 404
contract used by other routes.

Focused Knowledge Base Jest coverage passed `3/3`; the complete Jest gate passed
`45/45` suites and `1,405/1,405` tests. A real Laravel-backed Arabic index/detail
journey passed RTL, 320-pixel reflow, and axe in `43.5` seconds, and the expanded
Chromium/axe matrix passed `56/56` in `584.2` seconds (`9.5` minutes). Remaining
gaps are feedback mutations, attachments/downloads, admin editing, exact tenant
feature gates, broader live behavior, manual assistive-technology review, and
ASP.NET backend compatibility.

## 2026-07-10 Reviews Contextual Localization Slice

The signed `/reviews`, `/reviews/list`, and `/reviews/{id}/comments` family now
uses Laravel's exact `reviews_page` and `govuk_alpha_blogreviews` catalogs for
document titles, captions, descriptions, score labels, received/given/pending
sections, member and anonymous fallbacks, rating text, empty states, delete
controls, tabs, pagination, discussion headings, reactions, comment counts and
forms, and all no-JS review/comment/reaction result messages. The pending form
now mirrors Blade's five-to-one radio group and localized hint instead of the
invented English select menu.

The existing six focused Reviews regressions pass with Laravel's exact casing
and labels. The complete Jest gate remains `45/45` suites and `1,404/1,404`
tests. A new real Laravel-backed Arabic summary/list traversal passed RTL,
320-pixel reflow, and axe in `94.6` seconds, and the expanded exact-current
Chromium/axe matrix passed `55/55` in `548.9` seconds. Remaining Reviews gaps
are the API-limited edit/listing-review workflows, safe live mutation effects,
deletion/moderation and deeper threaded fixtures, manual assistive-technology
review, and ASP.NET backend compatibility.

## 2026-07-10 Member Profile Payload Depth Slice

The signed `/members/{id}` route now consumes Laravel's real bearer contracts
for the public profile, up to six user listings, user skills, weekly/specific-
date availability, public activity dashboard, block status, endorsements,
reviews, gamification, badges, and connection state. The page renders the Blade
about/skills/listings/recent-activity/profile-summary/availability structure,
locale-formatted activity statistics, endorsement counts and add/remove state,
and block versus unblock controls. The listings API call obeys the tenant module
gate. Auxiliary endpoint failures remain section-local instead of taking down
the whole profile.

Own-profile rendering merges Laravel's private `/users/me` payload only after
the current user ID matches, exposing private email/phone and the edit action
without leaking them to another member's public view. No-JS result feedback now
covers connection, endorsement, block, review, and wallet-transfer statuses
through Laravel's catalogs. Five API-client endpoint assertions and composed
profile tests cover the exact paths, request parameters, feature gates, payload
envelopes, self-action suppression, and blocked/unblocked states.

The complete Jest gate passed `45/45` suites and `1,404/1,404` tests. The real
Laravel-backed Arabic five-page member traversal passed RTL/reflow/axe in `85.1`
seconds with the expanded endpoint fan-out, and the exact-current Chromium/axe
matrix passed `54/54` in `559.6` seconds. Remaining profile gaps are live
mutation-effect certification, disposable privacy/block/endorsement fixtures,
localization of backend-generated activity descriptions, pixel/manual
assistive-technology review, and ASP.NET backend compatibility.

## 2026-07-10 Member Profile Hero, Actions, And Reviews Slice

The signed `/members/{id}` page now uses Laravel's profile caption, display-name
fallback, identity-verification and profile-type tags, tagline, reputation link,
joined label, activity statistics, badges heading, review labels and empty state,
and request-aware connection controls. Connection transitions submit Laravel's
single POST `/members/{id}/connection` contract with `connect`, `cancel`,
`accept`, `decline`, or `remove` actions. Direct-message visibility follows the
tenant `direct_messaging` feature, wallet transfer visibility follows the wallet
module, and transfer submissions carry a real UUID idempotency key. The block,
review, and wallet forms remain tenant-mounted and CSRF protected. Own-profile
views suppress message, connection, block, review, and transfer-to-self actions.

The focused profile composition regressions passed after removing two obsolete
inline `Level N - N XP` expectations from the former layout. The full Jest gate
passed `45/45` suites and `1,402/1,402` tests. The signed Arabic member traversal
now covers directory, discovery, nearby, profile, and insights at 320 CSS pixels;
the post-guard targeted traversal passed in `68.3` seconds and the full Chromium/
axe matrix passed `54/54` in `706.4` seconds.

The payload-depth gap recorded at this checkpoint is superseded by the profile
depth slice above, which wires Laravel's exposed bearer contracts rather than
fabricating missing sections. Manual assistive-technology evidence and ASP.NET
backend compatibility remain open.

## 2026-07-10 Core Member Directory Structural And Localization Slice

The signed `/members` page now matches Laravel's card-based accessible
directory instead of the previous email-bearing table with inline connection
mutations. It renders the exact quick-filter navigation, search/sort/order
fieldset, plural result count, error and filtered-empty states, member cards,
verification/level/connection badges, up to five earned badges, tagline,
location and contribution metrics, profile actions, and offset-based load-more
pagination. Blank identities, dynamic hours/ratings/levels, connection states,
ARIA text, and all visible controls use Laravel's catalogs. The public shell
remains data-private and does not call the protected directory API.

Four focused directory/auth/shared-mount tests passed after stale table-era
expectations were updated to Laravel's card contract. ESLint and the
290-template/zero-match audit passed. The live authenticated Arabic member
case now traverses the core directory, discovery, nearby, and insights at 320
CSS pixels; its first run completed all page checks but hit the old 30-second
test wrapper during teardown, and the unchanged assertions passed under the
same explicit latency allowance used by other authenticated multi-page cases
in `57.3` seconds. The complete Jest gate passed `45/45` suites and
`1,401/1,401` tests, and the exact-current full Chromium/axe matrix passed
`54/54` in `772.2` seconds. Directory connection mutations remain on their
dedicated profile/network surfaces as in Blade. Manual assistive-technology
evidence, deeper privacy variants, and ASP.NET switching remain open.

## 2026-07-10 Member Insights Localization And Semantics Slice

The signed `/members/{id}/insights` route and template now resolve their
document title, profile navigation, own/other introduction, NEXUS score and
tier, percentile text and progress ARIA, all ten activity statistics,
verification types and dates, earned-badge states, and empty states through the
exact `govuk_alpha_members.insights` catalog. Unknown members use the
insights-specific Laravel fallback; known tiers and verification types use
their source keys with safe payload-label fallbacks for future unknown values.
Scores, hours, ratings, levels, XP, and counts use request-locale formatting,
including English grouping such as `1,470` XP.

The focused insight route test and ESLint passed, and the conservative
localization audit remained 290 templates with zero matches. The live
authenticated Arabic members case now traverses discovery, nearby, and member
insights at 320 CSS pixels and passed RTL/reflow/axe in `55.4` seconds. The
complete Jest gate passed `45/45` suites and `1,401/1,401` tests, and the
exact-current full Chromium/axe matrix passed `54/54` in `544.8` seconds.
Laravel's insights namespace remains English-identical in Arabic, so Web UK
preserves that authoritative source while the shell and number formatting
remain Arabic-aware. Live privacy/onboarding variations, manual
assistive-technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Nearby Members Localization And Semantics Slice

The signed `/members/nearby` route and template now mirror the Laravel Blade
catalog contract for the document title, directory filters, no-location state,
search and radius controls, result/error/empty states, member identity and
metrics, profile actions, connection-state colours, and pagination semantics.
Distance values use the request locale's one-decimal formatting before being
inserted into Laravel's exact nearby-distance key, and the shared discovery
normalizer supplies localized hour/rating/level/connection and unknown-member
labels. Radius choices use Laravel's `near_me.options` keys rather than locally
assembled English labels.

The focused nearby render test, member-family `3/3` rerun, ESLint, and the
290-template/zero-match audit passed. The authenticated Arabic browser case
now traverses both discovery and nearby at 320 CSS pixels and passed RTL,
reflow, and serious/critical axe checks in `49.1` seconds. The complete Jest
gate passed `45/45` suites and `1,401/1,401` tests, and the exact-current full
Chromium/axe matrix passed `54/54` in `606.2` seconds. The live nearby fixture
currently renders Laravel's valid no-location state, so populated live distance
cards retain mocked contract evidence rather than fabricated shared-data
changes. Live privacy/visibility depth, disposable location fixtures, manual
assistive-technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Member Discovery Localization And Semantics Slice

The signed `/members/discover` route and template now use Laravel's exact
`govuk_alpha_members`, `members`, `polish_members`, and shared action/state
catalog keys for the title, directory navigation, explanation, search, result
count, empty/error states, avatar text, verification and connection states,
level, CommunityRank score and progress ARIA, member metrics, profile action,
and pagination. Member normalization now supplies the localized unknown-member
fallback for blank identities, preserves localized plural counts, and matches
Laravel's blue/yellow/purple connection-state tags. The shared nearby mapper
also receives the request translator; the first full-suite attempt caught that
missing call-site and the corrected member-family rerun passed `3/3`.

Focused English and Arabic render tests passed, including RTL, localized
fallbacks and pagination semantics. ESLint passed, and the conservative audit
remained `290` templates with `0` matches. A live authenticated Arabic browser
traversal passed at 320 CSS pixels with RTL/reflow and no serious/critical axe
violations. The complete Jest gate passed `45/45` suites and `1,401/1,401`
tests; the expanded full Chromium/axe matrix passed `54/54` in `779.1`
seconds. Laravel's `govuk_alpha_members` namespace is English-identical in
Arabic, while its shared `members` namespace supplies Arabic member semantics;
Web UK preserves both authoritative sources. Laravel's server-side
`MemberRankingService::isEnabled()` disabled state is not exposed by the
bearer member-list contract, so the exact disabled-recommendations inset
remains an explicit source-contract gap rather than being guessed from result
shape. Live ranking configuration changes, manual assistive-technology proof,
and ASP.NET switching remain open.

## 2026-07-10 Keyboard, Error Announcement, And Forced-Colour Slice

The shared progressive-validation script no longer moves focus away from its
new error summary to the first invalid input. The `role="alert"`,
`tabindex="-1"` summary retains focus so its heading and linked errors are
announced; activating an error link then focuses the corresponding field. Field
errors preserve existing `aria-describedby` values and use the request-locale
screen-reader prefix. Login supplies localized required/email/password copy,
and all five enhanced forms supply localized summary title/prefix attributes.

Forced-colour CSS now uses the active system `ButtonText`/`ButtonFace` and
`CanvasText`/`Canvas` pairs for the locale selector and footer attribution.
This fixed the two serious contrast failures the new forced-colour axe pass
first exposed. Focused browser coverage passed `4/4`; the complete current-
source Chromium/axe suite passed `26/26`. The full Jest suite passed `45/45`
and `1,388/1,388`; lint, brand, CSS, route, locale, template, and diff gates
also passed. The first full accessibility rerun reached authenticated setup but
timed out its 30-second login hook under concurrent Jest load; the isolated
rerun passed after giving only that real Laravel login setup a 90-second budget.

Laravel remains the authoritative backend and accessible visual/workflow source
and is read-only from this workspace. `ACCESSIBLE_BACKEND_TARGET=aspnet` remains
future work and is not certified. Known contract boundaries still holding the
completion gate open are:

- public Blade feed permalinks depend on v2 payload endpoints that require a
  bearer token, so Web UK can render an honest public unavailable/auth shell but
  cannot obtain anonymous permalink content;
- resource APIs do not expose all Blade detail/count semantics and retain
  cursor/category/sort limitations;
- member APIs lack bearer-authenticated GDPR request history, a password-gated
  email-change equivalent, and an atomic multi-write profile contract;
- exchange APIs ignore `prep_time`, lack a safe idempotency/uniqueness boundary,
  and drift from Blade rating/attention semantics;
- review comment mutations inherit the blog gate, and no equivalent review-edit
  or listing-review API completes the Blade workflow;
- matches APIs do not cover event recommendations or dismissing event and
  volunteering recommendations; and
- live destructive/upload proof requires isolated disposable fixtures. It must
  not be manufactured against shared local data.

## 2026-07-10 Wallet Family Structural And Localization Slice

The signed `/wallet` overview now matches Laravel's time-wallet structure
instead of the former simplified credits page. It loads the balance summary,
community fund, safe member search/transfer forms, community-fund-only donation
form, final/not-money warnings, CSV export, all/earned/spent/pending filters,
and four-column transaction history. The raw member-ID donation control was
removed. Transaction dates, amounts, directions, member fallbacks, and empty
values are normalized and locale-aware. `/wallet/manage` now resolves its
document title, back link, caption, description, balance, pending badge,
summary, recipient search, transfer fields, donation choices, warnings,
actions, success states, and errors through the exact `govuk_alpha_wallet`
catalog. Both pages use Laravel's hours contract and request-locale two-decimal
formatting instead of local `credits` labels.

Focused wallet/source coverage passed after three stale legacy expectations
were corrected; the combined complete Jest gate passed `45/45` suites and
`1,400/1,400` tests. A signed Arabic traversal of both pages passed RTL, 320px
reflow, authoritative donation warnings, and serious/critical axe checks. The
fresh aggregate Chromium/axe matrix passed `53/53` in 8.5 minutes. The
authoritative `govuk_alpha_wallet` namespace is English-identical in Arabic,
while the overview's `wallet` and `wallet_t1` keys provide Arabic source copy;
Web UK preserves both sources exactly. Existing transfer/donation contract
tests remain green, but live mutation effects, exact recipient privacy, manual
assistive-technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Connections Structural And Localization Slice

The signed `/connections` page now matches Laravel's three-section inbox rather
than the former single-filter table: requests to respond to, accepted
connections, and sent requests load together with the canonical counts, search,
member cards, actions, status banners, empty states, and full-network link. The
signed `/connections/network` page now resolves its document title, caption,
description, summary, search, tabs, statuses, dates, actions, load-more labels,
and empty states through the exact `govuk_alpha_connections` catalog. Both
pages normalize snake/camel payload variants, strip unsafe bio markup, and use
Laravel's localized unknown-member fallback for blank names.

Focused connection/source coverage passed `16/16`; the initial full run exposed
three stale direct-render assumptions, and the corrected failure-only rerun
passed `3/3`. The complete Jest gate then passed `45/45` suites and
`1,400/1,400` tests. A signed Arabic live traversal of both pages passed RTL,
320px reflow, and serious/critical axe checks, and the expanded aggregate
Chromium/axe matrix passed `52/52` in 8.6 minutes. The authoritative
`govuk_alpha_connections` network namespace remains English-identical in
Arabic, so Web UK preserves it rather than inventing divergent translations.
Live accept/decline/remove mutations, exact cursor depth beyond Laravel's
50-row inbox load, manual assistive-technology evidence, and ASP.NET switching
remain open.

## 2026-07-10 Messages Inbox Structural And Localization Slice

The signed direct-messages inbox now uses Laravel's document title, caption,
description, unread-count choice string, direct/groups subnavigation, filter
clear action, and empty-state copy. Conversation rows are normalized before
filtering and rendering so snake/camel payload variants share one contract and
whitespace-only member names become Laravel's localized `Community member`
fallback instead of an empty link. Missing previews use the catalog-backed
`No messages yet` value. The former invented emoji empty card and secondary
connections CTA were removed because Blade exposes the member-directory action
only.

Focused route/render coverage passed `4/4`, including Arabic output and the
blank-name regression. Standard and signed Arabic live inboxes passed `2/2`
targeted cases. The complete Jest gate passed `45/45` suites and
`1,399/1,399` tests; the expanded current-checkout Chromium/axe matrix passed
`51/51` in 10.5 minutes. Laravel's start-new search block, full feature and
restriction states, current-user sender attribution, exact relative dates,
direct/group conversation localization, live mutations, manual
assistive-technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Notifications Inbox Semantics And Localization Slice

The signed notifications inbox now matches Laravel's read-state contract instead
of treating every item without `read_at` as unread. Grouped rows use `all_read`;
single rows use `is_read` with `read_at` as the legacy fallback. Laravel-style
localized category tags and colours are derived from notification type, and the
page now includes the catalog-backed caption, description, document title,
success messages, and empty state. The invented English-only unread-empty card
has been removed in favour of Laravel's authoritative empty copy.

Focused notification/source coverage passed `11/11`, including explicit read
group/single fixtures and Arabic rendering. Standard and signed Arabic live
pages passed structure, RTL, 320px reflow, and serious/critical axe checks. The
complete Jest gate passed `45/45` suites and `1,397/1,397` tests; the expanded
current-checkout Chromium/axe matrix passed `50/50` in 7.4 minutes. Stored
notification messages can still reference non-`govuk_alpha` service namespaces
that are outside the current 24-namespace generated catalog; relative-time
parity, module gates, live mutation effects, manual assistive-technology
evidence, and ASP.NET switching remain open.

## 2026-07-10 Leaderboard And NEXUS-Score Contextual Localization Slice

The leaderboard, competitive leaderboard, seasons, personal journey, member
spotlight, NEXUS-score overview, and tier-ladder pages now resolve document
titles, navigation, captions, descriptions, filters, metrics, periods, rank and
score labels, season states, journey sections, spotlight metadata, score
breakdown categories, tier names, progress, and statuses through Laravel's
`govuk_alpha` and `govuk_alpha_gamification` catalogs. Dynamic member, season,
reward, activity, insight, and score data remains Laravel-supplied content.

The first live run exposed two real leaderboard rows with valid profile URLs but
empty member names, producing serious axe `link-name` failures. The normalizer
now applies Laravel's `Community member` fallback to empty strings as well as
missing values, with a focused regression fixture. The second standard live run
passed all seven pages, and the isolated Arabic traversal passed all seven pages.
The complete Jest gate passed `45/45` suites and `1,395/1,395` tests; the expanded
current-checkout Chromium/axe matrix passed `49/49` in 7.5 minutes. An earlier
retry hit the 60-second login-navigation ceiling during a transient Laravel
dashboard stall; the unchanged retry and complete matrix passed, so no timeout
or assertion was relaxed. Exact metric formatting for every legacy service,
feature gates, upstream English-identical translations, manual assistive-
technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Achievements-Family Contextual Localization Slice

The achievements overview, XP shop, collections, showcase, engagement history,
and badge-detail template now resolve document titles, navigation, captions,
headings, stats, progress/reward copy, shop states, collection states, showcase
validation, engagement table labels, badge metadata, and empty states through
Laravel's `govuk_alpha` and `govuk_alpha_gamification` catalogs. Dynamic badge,
collection, challenge, and shop-item content remains Laravel-supplied data.

Focused achievements/gamification coverage passed `9/9`; the complete Jest gate
passed `45/45` and `1,395/1,395`; lint, brand, template, and diff gates passed;
and the expanded current-checkout Chromium/axe matrix passed `41/41`. Five live
achievements pages plus a signed Arabic traversal of all five passed structure,
unique IDs, RTL, 320px reflow, and serious/critical axe checks. Badge detail is
mock-render certified only: the real account has no stable badge key, and an
invented `community-builder` URL correctly returned 404, so it was removed from
the live matrix rather than misrepresented as a product failure. Live mutation
effects, a disposable earned-badge fixture, authoritative translation gaps,
manual assistive-technology evidence, feature gates, and ASP.NET switching remain
open.

## 2026-07-10 Activity And Insights Contextual Localization Slice

`/activity` and `/activity/insights` now resolve their document titles, captions,
stats, engagement labels, skill tags/endorsement counts, monthly-chart text and
ARIA, timeline headings/type tags, net-balance text and hidden meanings, quick
stats, summaries, empty states, and navigation through Laravel's `govuk_alpha`
and `govuk_alpha_activity` catalogs. Dynamic member activity, skill names, month
labels, and timeline content remain user/service data rather than translated copy.

Focused activity coverage passed `5/5`, including signed Arabic request semantics
and locale-aware numeric output. The complete Jest gate passed `45/45` suites and
`1,395/1,395` tests; lint, template, and diff gates passed; and the expanded live
Chromium/axe matrix passed `35/35`. Standard activity/insights pages and a signed
Arabic case covering both pages passed structure, unique IDs, RTL, 320px reflow,
and serious/critical axe checks. The authoritative Laravel
`govuk_alpha_activity` Arabic namespace still contains English values; Web UK
deliberately preserves those values rather than inventing divergent translations.
Laravel-owned translation completion, relative-time parity, exact service-row
depth, manual assistive-technology evidence, and ASP.NET switching remain open.

## 2026-07-10 Profile-Settings Contextual Localization Slice

The real Laravel edit destination is `/profile/settings`; Laravel intentionally
has no `/profile/edit` route, and Web UK preserves that route boundary. The
existing settings page now uses exact Laravel catalog keys for the profile photo,
personal/public/privacy fields, contact preference and hint, save action, skills
description/hint/type legend/removal and endorsement plural, sign-in/security,
email/password labels and hints, passkey/session states, language description,
notification digest, match alerts, and personalisation/translation controls.
The Web UK-only current-language sentence was removed because Blade does not
render it. Existing safe/fail-closed write boundaries were not broadened.

English and Arabic focused rendering passed, including absence of the displaced
hard-coded strings. The complete Jest suite passed `45/45` and `1,394/1,394`;
brand, localization-template, lint, and diff gates passed; and the expanded live
Chromium/axe matrix passed `32/32`. Standard and signed Arabic profile-settings
pages both passed structure, unique-ID, 320px reflow, RTL, contextual copy, and
serious/critical axe checks. Exact atomic multi-write persistence, avatar upload,
email-change API parity, disposable mutation proof, manual assistive-technology
evidence, and ASP.NET switching remain open.

## 2026-07-10 Own-Profile Structural Parity And Localization Slice

The signed `/profile` page is no longer the legacy three-field name/email/phone
summary. It now follows Laravel's own-profile composition with an identity hero,
verification/member-type state, localized activity statistics, About, skills,
recent listings, reviews, account summary, badges, and links to edit profile,
achievements, and the leaderboard. Existing Laravel APIs provide the supplemental
listing, review, gamification, and badge data; their non-authentication failures
degrade individual sections without taking down the profile.

Laravel-style tenant boundaries are enforced before data access. A tenant with
connections disabled receives 403 before authentication/profile reads, and
listings, reviews, or gamification disabled states suppress both their API calls
and sections. Catalog copy, locale-aware numbers/dates, and Arabic RTL semantics
replace the former hard-coded summary. Focused route coverage passed `4/4`; the
complete Jest suite passed `45/45` and `1,394/1,394`; lint, brand, template, and
diff gates passed; and the full current-checkout Chromium/axe matrix passed
`30/30`, including standard and Arabic profile pages at 320 CSS pixels. The
authenticated cases now use a measured 90-second ceiling because local Laravel
responses can exceed the former 30-second per-test limit; assertions were not
relaxed. Availability/activity-timeline depth, exact supplemental service data,
live feature-disabled tenant proof, manual screen-reader evidence, and ASP.NET
backend switching remain open.

## 2026-07-10 Account-Hub Localization Slice

The signed account hub now uses Laravel's `account.caption` and
`account.sign_out` catalog keys and `messages.unread_count` choice string
instead of hard-coded English caption handling, sign-out text, and singular/
plural unread badges. Its existing card builder already translates each
Laravel-owned title/description and applies the tenant and broker messaging
gates, so the page now keeps its own remaining shell copy in the same request
locale as those cards.

Focused Jest proves Arabic document semantics, translated account/card copy,
the two-message plural, and the absence of the former English sign-out/badge
strings. The first focused browser assertion correctly found both main and
footer sign-out controls translated and failed only because the selector was
not scoped to `main`; the narrowed rerun passed. The complete suite passed
`45/45` and `1,391/1,391`, lint/brand/template/diff gates passed, and the full
real-Laravel Chromium/axe gate passed `28/28`, including signed Arabic account
and dashboard pages at 320 CSS pixels with RTL semantics, no overflow, and no
serious or critical violations. No mutation or shared fixture was changed.

## 2026-07-10 Dashboard Localization And Tenant-Gate Slice

The signed member dashboard now renders its page title, caption, welcome,
onboarding success copy, create-listing CTA, time-bank labels, level/XP/progress
copy, badges/events headings, endorsement plurals, quick links, feed type/author
and image labels, listing type/image labels, and numeric values through the
authoritative Laravel catalogs and request locale. Arabic output therefore uses
the imported Laravel text, RTL document semantics, and locale-aware numbers
instead of mixing in local English strings. The route also accepts the same
profile-stat field variants used by Laravel (`total_hours_*` and
`given_count`/`received_count`) instead of silently reporting zero.

Laravel's dashboard tenant gates are now enforced before supplementary API
calls and before links render. Disabled listings suppress the listing request,
CTA, and quick link; disabled events suppress the event request and link;
messages, connections, and volunteering links follow their module/feature
flags; and exchange-attention is fetched/rendered only when listings and the
exchange workflow are enabled. Focused Jest proved the English baseline, the
fully rendered Arabic contract, and the disabled-feature behavior (`3/3`). The
complete suite passed `45/45` and `1,390/1,390`; lint, brand, CSS, route, locale,
template, and diff gates passed; Chromium/axe passed `27/27`, including a real
Laravel-authenticated Arabic dashboard at 320 CSS pixels with no serious or
critical violations or horizontal overflow; and the live Blade marker check
remained `19/19`. No mutation or shared fixture was changed.

## 2026-07-10 Listings Mutation Contract Slice

The no-JavaScript Listings owner flow now uses Laravel's exact v2 core
boundaries: `POST /api/v2/listings`, `PUT /api/v2/listings/{id}`, and
`DELETE /api/v2/listings/{id}`. Create and update send only the canonical core
fields (`title`, `description`, `type`, `category_id`, `hours_estimate`,
`service_type`, and `location`); create status is owned by Laravel moderation
and is no longer accepted from the browser. The stale `inactive` option was
removed in favour of Laravel's `paused` terminology where the local status
filter is shown.

The create/edit form now consumes tenant bootstrap `listing_config` when a
routed tenant supplies it, loads tenant-scoped listing categories from
`GET /api/v2/categories?type=listing`, enforces the effective title,
description, category, location, hours, image, type, and service-delivery
rules, and renders the corresponding category, hours, service type, location,
image, and skill-tag controls. Core persistence is completed first. Enabled
skill tags then use `PUT /api/v2/listings/{id}/tags`, and an uploaded cover uses
multipart `POST /api/v2/listings/{id}/image`; either secondary failure is
reported without falsely discarding the already-created or updated listing.

Laravel v2 `data` envelopes are unwrapped for list ownership, detail, edit,
and created IDs. Owner checks now recognise the Laravel user/provider shapes,
non-owners receive a 403 page, nested Laravel `errors[]` 422 responses map to
the GOV.UK summary and field controls, `ONBOARDING_REQUIRED` redirects to the
active tenant's onboarding route, and create/update/delete results remain
inside the active shared mount. Tests are mock-backed: no live create, update,
image/tag write, or destructive delete was run, so live persistence and side
effects remain uncertified.

Verification for this slice: the full API-client file passed `174/174`; the
focused mutation route/render group passed `6/6`; the broader listing-filtered
shared route suite passed `22/22`; the full template-source file passed
`109/109`; full `npm run lint` passed; the route matrix remained `608/608`
matched with zero missing/extra routes; and the scoped `git diff --check`
passed with only Git's LF-to-CRLF working-copy notices. The shared route suite
still emits Node's pre-existing `DEP0044 util.isArray` deprecation warning.

## 2026-07-10 Events Mutation Contract Slice

The core no-JavaScript Events create, update, cancel, and delete actions now
use Laravel's exact v2 mutation methods and paths: `POST /api/v2/events`,
`PUT /api/v2/events/{id}`, `POST /api/v2/events/{id}/cancel`, and
`DELETE /api/v2/events/{id}`. Create/update forms send and render
`start_time`/`end_time`, require the Laravel-required description, unwrap the
v2 `data` event/ID envelope, and retain submitted values against Laravel 400,
409, and 422 responses. The cancellation disclosure now mirrors Blade's
reason field and sends `{ reason }` to the POST endpoint. Laravel 401, generic
403, onboarding-required 403, 404, 409, and 422 outcomes have focused route
coverage, including tenant-prefixed onboarding/login redirects.

Focused mock-backed API/route/template tests prove those contracts without
performing a live create, update, cancel, or delete. No destructive Laravel
runtime mutation was run, so persistence, notifications, XP, cancellation
notifications, attendee effects, and production behavior remain uncertified.

Verification for this slice: event-filtered API tests passed `7/7`,
event-filtered shared route/render tests passed `31/31`, event-filtered template
source tests passed `5/5`, full `npm run lint` passed, and scoped
`git diff --check -- apps/web-uk` passed (with only Git's existing LF-to-CRLF
working-copy warnings). The shared route suite still emits the pre-existing
Node `DEP0044 util.isArray` deprecation warning.

## 2026-07-10 Groups Read And Delete Contract Slice

The Groups list, current-user memberships, and member list now use Laravel's
tenant- and visibility-aware v2 reads: `GET /api/v2/groups`,
`GET /api/v2/groups?member=me`, and
`GET /api/v2/groups/{id}/members`. Web UK sends Laravel's `q`, `per_page`, and
cursor filters, consumes `{data, meta}` envelopes, renders cursor navigation,
and no longer calls the legacy unfiltered `/api/groups` collection. Group
index/detail/manage and event create/edit selectors now receive the real v2
membership/member rows; a 401 from those reads is propagated to the auth
handoff instead of being converted into a misleading empty collection.

The owner delete action now mirrors Laravel Blade on the edit page: a visible
GOV.UK warning, an explicit required `confirm=yes` checkbox, and a separate
CSRF-protected form that works without JavaScript. The server independently
rejects an omitted confirmation with a field-linked 400 error. Update and
delete retain Laravel 404, 429, and 5xx HTTP outcomes, while successful
redirects use `group-updated` and `group-deleted` status tokens. Event edit now
also renders and submits its previously-loaded group selector.

Verification is mock-backed and non-destructive: the focused v2 group API
request, envelope, detail, and mutation set passed `3/3`; the focused
group/event membership route-render
set passed `11/11`; the full template-source suite passed `110/110`; and
scoped ESLint passed. No live Laravel group update or delete was performed.

## 2026-07-10 Localization And RTL Progress

The current localization work is a substantial runtime and template-wiring
slice, but it is **not** localization completion or Laravel-first `1000/1000`
certification.

- `scripts/sync-laravel-locales.php` now imports the authoritative Laravel
  `lang/{locale}/govuk_alpha*.php` catalogs into deterministic generated JSON.
  The current export covers all 11 offered locales, 24 namespaces, and 7,337
  string keys per locale, with zero missing or extra keys relative to English.
- Locale resolution now follows query `locale`, session locale, an already
  available request user/profile preference, a signed-token profile API
  preference, weighted `Accept-Language`, then English fallback. A valid query
  or profile preference seeds the session, and responses declare
  `Content-Language`.
- The active locale is request-scoped through `AsyncLocalStorage`. API and
  download requests propagate `Accept-Language` without mutable process-global
  state, signed profile reads share one request-local promise, and the route
  formatting helpers use the request locale rather than fixed `en-GB` or
  `en-IE` display formats.
- Profile language and automatic-translation choices now intersect the global
  catalog allowlist with the routed tenant's `supported_languages` when that
  bootstrap setting is present. Mounted login, registration, and password
  recovery also use the authoritative routed tenant slug rather than trusting
  a tamperable hidden form value; flat parent-domain forms retain their posted
  community chooser behavior.
- The base document now emits request-correct `lang` and `dir` values, including
  RTL for Arabic, while preserving the GOV.UK shell hooks, CSP nonce, container,
  and single-main-landmark contract. Shared auth, cookie, footer, and error-page
  surfaces use Laravel catalog keys where semantically equivalent keys exist.
- A conservative exact-value audit replaced 1,595 safe static template values
  across 257 templates. It deliberately excludes ambiguous values, runtime
  context, placeholders, plural forms, URLs, scripts/styles, and copy without a
  semantically safe Laravel key. `npm run locales:audit-templates -- --summary`
  now reports 290 templates and zero remaining conservative matches. That zero
  is an audit boundary, not proof that every rendered word is translated.
- Current verification passed the full Jest suite (`27` suites, `986` tests),
  `npm run lint`, `npm run build:css`, and the expanded Playwright Chromium/axe
  accessibility gate (`12/12`). The browser run covers nine representative
  public shared-mount pages plus three Arabic RTL pages at a 320px viewport,
  including document language/direction, one main/h1, unique IDs, horizontal
  reflow, and serious/critical axe checks. The first expanded run exposed the
  registration honeypot's physical off-screen overflow; after it moved to a
  clipped technique, the focused Arabic registration regression and the full
  rerun passed.

The remaining localization gaps are material:

- The read-only Laravel source catalogs themselves contain 3,903 to 3,951
  English-identical values in every non-English locale, or 53.2% to 53.9% of
  the 7,337 strings. Sixteen entire namespaces are English-identical:
  `activity`, `blogreviews`, `connections`, `events`, `federation`, `feed`,
  `gamification`, `ideation`, `listings`, `members`, `organisations`, `saved`,
  `search`, `settings`, `volunteering`, and `wallet`. Web UK must not invent
  translations that diverge from the authoritative read-only source; the
  Laravel catalog owner must supply those translations before all offered
  locales can be certified.
- Contextual route titles, dynamic headings, validation/status copy, ARIA
  labels, and residual template strings that cannot be mapped safely by exact
  value still need route-family review and focused tests.
- Authenticated, error, upload, destructive, and additional RTL browser states
  plus recorded manual keyboard, screen-reader, reflow, focus, contrast, and
  RTL review remain uncertified.

### 2026-07-10 Contextual Localization Follow-up

The next focused slice moved beyond exact static substitutions without using
runtime reverse-English lookup:

- The base layout now accepts an explicit `titleKey` plus replacements and
  retains the existing English `title` fallback. Tenant home, About, Guide,
  FAQ, Contact, Legal, and Accessibility now render localized document titles
  and primary headings; the existing Sign in and Register title blocks complete
  all nine public browser-gate identities. Custom tenant SEO headings remain
  tenant content and are not translated.
- Login, registration, two-factor, forgotten-password, and reset-password
  routes translate exact validation, status, and known API error codes at
  render time. Redirects persist neutral status tokens rather than translated
  strings. Combined messages with no exact Laravel key remain English.
- Dynamic and visually hidden labels in advanced search, saved-collection
  detail, connection network, and course learning views now delegate to exact
  Laravel keys with escaped interpolation. Several of those feature-namespace
  keys remain English-identical upstream, so wiring is complete for the scoped
  labels but native output still depends on Laravel catalog translation.
- Final verification passed `29/29` Jest suites and `999/999` tests, source and
  changed-test lint, the zero-safe-match template audit, CSS compilation, and
  the full `12/12` Playwright Chromium/axe public and Arabic RTL gate.

The following Explore/profile slice is also complete and published-ready:

- Explore now uses explicit authoritative keys for its page identity, all 19
  feature-gated cards, live listing/event headings and links, and listing type
  tags. The card filtering and tenant-aware URLs are unchanged. Laravel's
  non-English `premium.*` values are stale and still describe paid Premium
  features while current English describes donations; that source discrepancy
  must be fixed upstream rather than rewritten locally.
- Profile/settings now translates 45 exact status/error keys at render time,
  including data export, email, password, language, notifications, passkeys,
  personalisation, matches, skills, safeguarding, delete-account, and two-factor
  states. `avatar-invalid`, `language-failed`, and `passkey-failed` retain their
  English fallbacks because no exact Laravel key exists.
- The combined gate now passes `31/31` Jest suites and `1,021/1,021` tests,
  source/touched-test lint, and the zero-safe-match template audit. The earlier
  full `12/12` browser gate remains the current public/RTL evidence because this
  slice changes authenticated Explore/profile surfaces outside that matrix.

An immutable `92357a95` residual audit measured 381 effective hard-coded title
sites, 153 static H1s, 3,178 pure static template nodes, 21 templates without a
translator call, 53 dynamic hard-coded accessible labels, and about 715 raw
route-message literal candidates. After the Explore/profile slice the expected
headline counts are approximately 379 titles, 152 H1s, and 3,173 static nodes;
45 profile statuses are effectively localized even though their English
fallback maps remain in source. The Jobs family now has a focused contextual
localization slice in the current worktree, with Marketplace next. Federation
and Volunteering are deferred behind it because their authoritative feature
namespaces are wholly English upstream.

### 2026-07-10 Jobs Contextual Localization Follow-up

- Sixteen fixed Jobs document-title sites now pass exact authoritative keys to
  the shared layout while dynamic opportunity, employer, and candidate titles
  remain user-authored content.
- Browse, saved, application, owner, form, alert, response, pipeline,
  applicant, and detail status/error messages translate at render time from
  neutral redirect tokens. Unknown tokens stay silent, and isolated route tests
  retain the authoritative English fallback when request localization is not
  installed.
- Non-empty application history, talent profile, the visible bias-audit report,
  qualification progress/table semantics, and the detail page's errors and
  high-impact chrome now follow Blade and use exact Laravel keys.
  Candidate-authored fields remain escaped.
- Every literal key introduced by the slice resolves through all 11 imported
  locale catalogs. The focused Jobs plus shared source/render gate passed 58
  tests, source and touched-test lint passed, the conservative template audit
  remained at zero matches across 290 templates, and `git diff --check` passed.
- A fresh ephemeral current-checkout Laravel smoke passed 41/41 checks across
  the signed Jobs page/body family, expected owner/admin 403 states, unsigned
  CV/history redirects, and base auth/cookie behavior. A second 13/13 run
  proved live Irish `/jobs` and `/jobs/alerts` output plus Arabic Jobs-detail
  output. These GET/render checks do not replace destructive/upload persistence
  certification, and English-identical upstream values remain external catalog
  work.
- Remaining Jobs workflow work is explicit: create/edit API validation still
  needs Laravel-style one-request input/error replay, and live mutation proof is
  still required for applications, alerts, interview/offer responses, CV
  upload/download, owner updates, renewals, and deletion.

### 2026-07-10 Marketplace Contextual Localization Follow-up

- Twenty fixed Marketplace document-title sites now pass their exact Laravel
  keys to the shared layout; category, seller, and listing titles remain
  user-authored dynamic content.
- Twenty-four success tokens and 32 error tokens now translate at render time
  through the Laravel catalogs. Unknown and neutral redirect tokens remain
  non-user-facing, and the three messages without an unambiguous source key
  retain their exact English fallback.
- The landing page now reuses the shared Marketplace tab strip instead of a
  shortened duplicate. Its tab order, seller-onboarding destination, active
  state, accessible name, and tenant `merchant_coupons` visibility follow the
  Blade partial. The browse filter, category controls, status headings, and
  high-impact navigation chrome use exact Laravel keys.
- All 97 keys exercised by this slice resolve in every one of the 11 imported
  catalogs (1,067 checks). Focused localization passed 101 tests; the existing
  Marketplace route/template selection passed another 36 assertions; source
  and touched-test lint, the conservative 290-template audit, and
  `git diff --check` passed.
- A fresh current-checkout Laravel smoke passed 33/33 checks: base
  auth/cookie/session behavior, 19 signed Marketplace pages, the two expected
  merchant-coupon 403 gates, and live Irish plus Arabic Marketplace filter
  output.
- This is not full Marketplace certification. Listing/order/offer/slot/coupon
  mutations, hosted checkout, uploads, destructive actions, remaining
  contextual template copy, manual/visual accessibility, and ASP.NET backend
  compatibility still require evidence.

### 2026-07-10 Marketplace Hosted-checkout Boundary Follow-up

- Laravel's accessible source creates a hosted Stripe Checkout Session and
  returns a `303` external redirect. The Laravel API route inventory currently
  exposes only `POST /api/v2/marketplace/payments/create-intent`, `POST
  /api/v2/marketplace/payments/confirm`, and `GET
  /api/v2/marketplace/payments/{id}/status`; create-intent returns a
  `client_secret` and `payment_intent_id`, not a hosted `checkout_url`.
- Web UK's no-JS pay action previously called create-intent, discarded that
  secret, and redirected to a non-user-facing `payment-started` token. It now
  makes no payment API call and claims no success. Signed buyers are redirected
  through `res.locals.urlFor` to Laravel's localized generic
  `/marketplace/orders?status=pay-failed` state; unsigned buyers retain the
  tenant-mounted `/login?status=auth-required` handoff. The seller-specific
  `pay-unavailable` copy is deliberately not used because the missing hosted
  API is a Web UK/backend boundary, not evidence that the seller is unready.
- This is an honest safe failure, not payment completion. The external blocker
  is a Laravel bearer-authenticated hosted-checkout endpoint, preferably `POST
  /api/v2/marketplace/payments/checkout`, which validates buyer/order state and
  a tenant-aware accessible return path, derives the `payment-submitted` and
  `payment-cancelled` callback URLs, and returns a v2 `data.checkout_url`.
  Web UK must then accept only a parsed HTTPS URL on `checkout.stripe.com` or an
  explicitly configured exact Stripe custom-checkout host and issue a `303` so
  the original form POST becomes a GET. The existing Laravel web route cannot
  substitute for this API boundary because it is a session/CSRF web route.
- Focused proof is green: the dedicated payment-boundary suite passed `4/4`,
  the existing integrated Marketplace order-action case passed, the four
  Marketplace-focused suites passed `105/105`, and `npm run lint` plus
  `git diff --check` passed. The subsequent combined current-source gate passed
  all `42/42` suites and `1,222/1,222` tests after the Goal mock was made
  order-independent.

### 2026-07-10 Two-factor Enrolment Contract Follow-up

- The profile enrolment page now reads `GET /api/v2/auth/2fa/status`, calls
  `POST /api/v2/auth/2fa/setup` only while disabled, and normalizes Laravel's
  `qr_code_url` response. It no longer attempts a non-existent GET setup
  contract.
- Successful verification renders Laravel's one-time backup codes directly on
  the POST response. A subsequent GET reads status only and cannot redisplay
  those codes.
- Empty and invalid codes retain the Laravel redirects. API 401 responses use
  the tenant-aware login path; 429 and 5xx responses retain their real HTTP
  status instead of being mislabeled as an invalid authenticator code.
- The document title, back link, backup-code pluralization, warning label,
  disable heading, and QR alternative text now use exact request-locale Laravel
  keys. The six scoped keys resolve in all 11 catalogs (66 checks).
- Focused contract/status tests and shared rendered-shell selection passed 31
  assertions; source/touched-test lint, the 290-template conservative audit,
  and `git diff --check` passed. The complete current Web UK gate then passed
  38/38 suites and 1,177/1,177 tests plus full source lint.
- A live successful setup/verification was deliberately not run: it mutates
  account security state and no dedicated disposable 2FA fixture is available.
  Disable persistence, security notifications/email, throttling behavior, and
  ASP.NET backend compatibility remain uncertified until that fixture exists.

### 2026-07-10 Pending Account-erasure Contract Follow-up

- Web UK no longer calls `DELETE /api/v2/users/me`, Laravel's immediate
  purge/anonymisation endpoint. The accessible password-gated form now submits
  only `password` and the optional trimmed `reason` to
  `POST /api/gdpr/delete-account`, which creates Laravel's pending tenant-scoped
  erasure request.
- Local password/confirmation validation remains no-JS and tenant-aware. API
  400 maps to password required, 403 to incorrect password, 401 to the mounted
  login path, and 429/500 to the generic request failure. Failure paths do not
  clear the signed-in session.
- After a successful request, Web UK invalidates its user cache, destroys the
  Express session, clears `token`, `refresh_token`, and `tenant_slug`, then
  redirects through the active tenant mount to the localized deletion-requested
  login state.
- The document/H1 and warning now use exact Laravel keys, including the
  community replacement. All three scoped keys resolve across all 11 catalogs
  (33 checks).
- Focused API/route/shared-shell proof passed 11 assertions; changed source and
  tests linted, the 290-template conservative audit and `git diff --check`
  passed. A safe current-source Laravel GET/render run passed 13/13 base,
  signed-page, Irish, and Arabic checks. The complete current Web UK gate then
  passed 39/39 suites and 1,187/1,187 tests plus full source lint.
- A successful live POST was deliberately not run because it creates a legally
  significant pending GDPR request, audit/metric records, and notifications.
  It requires a disposable isolated user plus cleanup. Laravel's duplicate-
  pending API path also currently returns a generic 500 while Blade treats it
  as success; that upstream inconsistency remains explicit.

### 2026-07-10 Profile Email Re-authentication Boundary Follow-up

- Web UK's email-change form previously sent `email` and `current_password` to
  generic `PUT /api/v2/users/me` and treated a successful response as proof of
  re-authentication. Laravel's generic user update does not inspect or verify
  `current_password`; only the authoritative accessible controller performs a
  tenant-scoped password-hash check before changing the recovery email.
- The Web UK POST now fails closed after auth and email-format validation. It
  makes no generic profile write, claims no success, preserves the signed-in
  session, and redirects through the active tenant mount to an explicit
  `email-reauthentication-unavailable` error anchored to the password field.
  This prevents a stolen bearer session from replacing the recovery email.
- Completion is externally blocked on a Laravel bearer-authenticated,
  password-gated email-change endpoint with stable invalid-password, unchanged,
  duplicate-email, validation, throttling, and success outcomes. The Laravel
  accessible web route cannot be proxied as that API boundary because it uses
  Laravel's own session and CSRF context.
- Focused security and status-localization proof passed `21/21`; the integrated
  profile-action route case also passed, proving no email write was added to
  the two expected preceding profile settings calls. Full Web UK verification
  is rerun at the end of the combined slice.

Tenant-routing source notes now live in `docs/TENANT_ROUTING_PARITY.md`. The
first shared-mount slice is implemented in Web UK: `/{tenantSlug}/accessible`
routes through the flat Express app, shell/home links use the active shared
mount, and legacy `/{tenantSlug}/alpha` requests redirect to the cleaner
`/{tenantSlug}/accessible` path. A follow-up shared-mount slice keeps local
redirects plus rendered HTML `href` and `action` targets inside the active
`/{tenantSlug}/accessible` mount, so individual templates no longer escape to
flat root paths during shared-host tenant browsing. A shared-root slice now
renders the Laravel-style tenant chooser at `/`, backed by Laravel
`/api/v2/tenants` with the master tenant excluded and community links using the
cleaner `/{tenantSlug}/accessible` mount. A follow-up tenant-chooser slice now
sorts those communities by display name to match Laravel
`AlphaController::tenantChooser()`, which orders active non-master tenants by
name. Custom/root domain slices now ask
Laravel `/api/v2/tenant/bootstrap` to resolve non-local Host values, including
Laravel `domain` and `accessible_domain`, and render the resolved tenant home at
slugless `/` when Laravel returns a matching tenant. This covers the master
tenant's configured `project-nexus.ie` domain and the `timebank.global` cluster
front page in tests, using Laravel SEO h1/intro copy and `tenant_switcher`
items. A custom-domain canonicalization slice now sends matching
`/{tenantSlug}/alpha/...` and `/{tenantSlug}/accessible/...` requests on a
dedicated tenant host to the slugless path, mirroring Laravel's
`StripTenantSlugOnAccessibleDomain` behavior while keeping Web UK's public
shared-host slug as `/accessible`. A parent-domain child slice now resolves the first non-reserved path
segment through Laravel bootstrap and serves the flat accessible app below
`/{childSlug}` when Laravel returns a matching `parent_domain`. A live
runtime-smoke slice certifies that same parent-domain child path against the
local Laravel `hour-timebank` fixture. Follow-up host-root smoke slices now
certify both the master and cluster domain front pages against full temporary
Web UK processes started with `TENANT_ID=2`:
`project-nexus.ie|/=>Build Thriving Communities with NEXUS` and
`timebank.global|/=>Exchange Skills Across Borders`. The API client suppresses
the default `X-Tenant-ID` whenever Host/Origin tenant context is present so
Laravel can resolve the browser domain. This is not full tenant-domain parity
yet: visual/manual tenant checks and ASP.NET backend switching certification
still need work. Focused template-helper
conversion slices now cover the event detail page's breadcrumbs, group/member
links, RSVP/admin forms, attendee links, and report return path plus the
account hub's card links and CSRF logout form, the activity dashboard/insights
navigation links, and the achievements/gamification tabs, back links, forms,
and badge links, plus the leaderboard/NEXUS score tabs, back links, forms,
load-more links, tier link, and profile links with `urlFor()`. A follow-up
leaderboard/NEXUS score route-redirect slice now sends unsigned and Laravel-401
auth handoffs through `res.locals.urlFor`, so those GET pages stay inside shared
tenant mounts and custom-domain child paths instead of relying on flat
`/login` redirects. A 2026-07-10 source audit now finds no direct
root-relative `href`/`action` attributes in `src/views`, no object-style
`href: "/"` or `action: "/"` Web UK source targets, and no raw root-relative
`res.redirect("/...")` calls in `src/middleware`, `src/lib`, `src/routes`, or
`src/server.js`. Helper-mediated redirects still pass local paths into
`urlFor()` and must remain covered by route-family tests. Keep those audits
green as regression guards for new Blade-clone work. A follow-up
activity route-redirect slice now sends unsigned activity dashboard and
insights auth handoffs through `res.locals.urlFor`, with shared-mount coverage
proving `/acme/accessible/activity` and `/acme/accessible/activity/insights`
redirect to the tenant-mounted login path. A follow-up
profile/settings slice now routes the profile summary links, settings hub
cards, profile/security/privacy forms, two-step verification actions, blocked
member unblock forms, delete-account controls, and settings appearance,
availability, data-rights, linked-account, and insurance forms through
`urlFor()`. A follow-up settings route-redirect slice now sends appearance,
availability, data-rights, linked-account, and insurance auth, validation,
success, and API-error redirects through `res.locals.urlFor`, so those no-JS
POST outcomes stay inside shared tenant mounts and custom-domain contexts
instead of relying on flat `/settings` targets. A follow-up profile route-redirect
slice now sends profile settings, profile summary, email, password, language,
notifications, passkey, personalisation, match-preference, skill, safeguarding,
data-export, delete-account, blocked-member, and two-factor auth/status
redirects through `res.locals.urlFor`, so those no-JS profile outcomes stay
inside shared tenant mounts and custom-domain contexts instead of relying on
flat `/profile` and `/login` targets. A follow-up detail/report slice now routes group detail,
listing detail, member profile, and report-link partial breadcrumbs, action
controls, report returns, listing report links, member connection controls, and
review form actions through `urlFor()`. A follow-up marketplace slice now
routes marketplace offer tabs, listing links, offer decision forms, my-listings
tabs, create/view/edit links, and renew/delete forms through `urlFor()`. A
follow-up marketplace browse/action slice now routes marketplace browse nav,
listing cards, category links, search and category filter forms, listing detail
buy/offer/save/report controls, buyer buy/offer/report forms, listing
create/edit form actions, seller profile back links, and seller onboarding
links/forms through `urlFor()`. A follow-up marketplace page redirect slice now
sends signed-out GET auth handoffs and Laravel-401 marketplace page handoffs
through `res.locals.urlFor`, so marketplace page exits no longer rely on flat
`/login` redirects before shared-mount or custom-domain rewriting. A tenant-home parity slice now replaces the old
generic Web UK home inside tenant contexts with the Laravel Blade-style
`Accessible` home page, including community caption, tenant tagline, platform
stats, sign-in/register CTAs, module availability rows, and service details. A
follow-up tenant-stats slice now scopes those platform stats through Laravel's
tenant resolution: shared-mount tenant homes send `X-Tenant-Slug`, while custom
domain homes send the resolved Host and Origin. The latest federation hub
source slice now routes the hub service navigation, opt-in/opt-out CTAs,
partner preview links, view-all link, and quick links through `urlFor()`.
The latest federation onboarding source slice now routes the wizard back link,
service navigation, step forms, step-back links, and do-this-later links through
`urlFor()`. A 2026-07-10 parity slice also points the opted-out hub CTA at that
wizard and stores privacy and communication choices in a tenant-keyed Express
session bag. Confirm now submits only the step name, persists the stored
choices to Laravel `/api/v2/federation/setup`, preserves the bag on failure,
and clears it only after success.
The latest wallet route-redirect slice now sends transfer and donation status
redirects through `res.locals.urlFor`, with shared-mount coverage proving
`/acme/accessible/wallet/donate` validation redirects stay under the active
tenant mount.
The federation member source slice routes the federation member back link,
federation service navigation, opt-in CTA, connection/message forms, and
transfer CTA through `urlFor()`. The latest federation redirect slice now
routes signed-out federation GET handoffs, opt-in/settings shortcuts, and
conversation fallback redirects through `res.locals.urlFor`, with shared-mount
coverage proving `/acme/accessible/federation` redirects to the tenant-mounted
login path. The latest federation browse/messaging/settings/transfer source
slice routes connections, conversations, events, groups, listings, member
browse, messages, opt-in/out, partner list/detail, settings, and transfer
template links and forms through `urlFor()`. Federation POST action redirects
now route connection, message, translation, transfer, onboarding, opt-in/out,
and settings outcomes through `res.locals.urlFor`. A targeted Laravel runtime
smoke on 2026-07-09 against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and
`LARAVEL_BASE_URL=http://127.0.0.1:8088` passed `19/19` checks for auth,
cookie/logout setup, signed `/federation`, `/federation/connections`,
`/federation/messages`, `/federation/settings`, and
`/federation/members/353/transfer`, plus body markers for the changed
federation pages. The latest connections source slice now routes the connections
index tabs, pending-request link, member links, accept/decline/remove forms,
empty-state member CTAs, pagination base URL, network search form, network
tabs, load-more links, card actions, and back link through `urlFor()`. The
latest notifications source slice now routes the notifications breadcrumb,
filter links, read/delete form actions, redirect hidden values, pagination base
URL, and unread empty-state CTA through `urlFor()`. The latest notifications
redirect slice now sends grouped-read, read-all, delete-all, single-read,
single-delete, API-error, and validated return redirects through
`res.locals.urlFor`, so notification POST outcomes stay inside shared tenant
mounts and custom-domain child paths. The latest group-exchanges source slice
now routes group-exchange create CTA, status tabs, detail links,
create form, participant add/remove/search forms, confirmation form, and
complete/cancel actions through `urlFor()`. The latest messages source slice
now routes direct-message breadcrumbs, conversation links, listing links,
empty-state CTAs, older-message pagination, direct reply/edit/delete/voice/
archive forms, group-message tabs, group create/search forms, participant
remove/add forms, reaction forms, member-directory links, and leave-group forms
through `urlFor()`. The latest wallet source slice now routes the wallet
breadcrumb, manage CTA, back link, recipient search form, transfer forms, and
donation forms through `urlFor()`. The latest public/auth/support source slice
now routes contact, cookie settings, login, two-factor login, forgot-password,
reset-password, register, and report-a-problem links/forms through `urlFor()`.
The latest public-info/legal/support/cookie source slice now also routes About,
Guide, Features, email verification, Help, Trust and safety, legal
document/accessibility fallback links, the standalone privacy contact link, and
cookie-banner links/forms through `urlFor()`, so those public no-JS surfaces no
longer depend on response rewriting for tenant mounts or custom-domain child
paths.
The latest member-onboarding redirect slice now routes onboarding
auth-required, step, avatar, validation, safeguarding, complete, and dashboard
handoff redirects through `res.locals.urlFor`, matching Laravel's named-route
redirect behavior for shared mounts and custom-domain contexts. A scoped
Laravel runtime smoke proves the current completed fixture redirects signed
`/onboarding/profile` to `/dashboard`.
The latest member-onboarding source slice now also routes the wizard step form
actions plus confirm-page change links through `urlFor()`, so the no-JS
onboarding controls stay inside the active `/{tenantSlug}/accessible` mount or
custom-domain child path at source level rather than relying only on rendered
HTML response rewriting.
The latest organisations source slice now routes organisation directory,
browse, detail, jobs, manage, register, and opportunity-apply links/forms
through `urlFor()`. The latest blog source slice now routes blog index, post
detail, discussion, liker, reaction, comment, pagination, and member-profile
links/forms through `urlFor()`. The latest blog redirect slice now routes
signed-out discussion/liker/comment/reaction handoffs and blog POST result
redirects through `res.locals.urlFor`, so blog workflow redirects stay inside
the active tenant mount without relying only on the shared-mount response
rewriter. The latest courses source slice now routes
course browse, learner, instructor, builder, analytics, grading, certificate,
review, enrolment, quiz, progress, and section/lesson controls through
`urlFor()`. The latest courses redirect slice now routes course auth handoffs,
certificate/learn errors, learner actions, instructor course, section, lesson,
publish/delete, and grading outcomes through `res.locals.urlFor`. The latest listing index/form source slice now routes listing
breadcrumbs, browse filters, clear/create CTAs, row detail/edit/delete
controls, pagination, empty-state CTAs, create/edit form action, and cancel
link through `urlFor()`. A follow-up listing exchange-request source slice now
routes the exchange-request back link and POST action through `urlFor()`, so
Laravel's canonical `/listings/{id}/exchange-request` flow stays source-auditable
under shared tenant mounts and custom-domain contexts. A follow-up listing
auxiliary source slice now routes listing analytics, comments, and report
back links plus GET/POST form actions through `urlFor()`, with focused source
and render coverage for those Laravel-backed pages. The latest listing
route-redirect slice now sends
legacy listing auth handoffs, generate-description outcomes, like/comment/
exchange/report actions, owner self-request/edit redirects, create/update
successes, and delete successes through `res.locals.urlFor`, so listing route
exits no longer rely on flat `/listings` redirects before shared-mount or
custom-domain rewriting. The latest events index/form source slice now routes
event list create CTA, search form, event and group links, pagination,
empty-state actions, create/edit form actions, breadcrumbs, back links, and
cancel links through `urlFor()`. A follow-up events depth source slice now
routes the event browse back/view-all links and filter form, event map back
link, event poll back link and save form, recurring-edit back link/form/
occurrence links, and translation back link/form through `urlFor()`, with
focused source and shared-mount render coverage for `/acme/accessible/events`
depth pages. A scoped Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6610`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed base auth/cookie/logout checks plus `/events/browse`, `/events/6/map`,
`/events/6/polls`, and `/events/6/translate` module and body-text markers.
The latest groups index/form source slice now
routes group list create CTA, search form, clear links, group card links,
pagination base URL, create/edit form actions, breadcrumbs, back links, cancel
links, and legacy my-groups source controls through `urlFor()`. The latest
group depth source slice now routes group announcement edit, discussion,
invite, image, notification, manage, member, and file local links/forms through
`urlFor()`, and group route redirects now resolve through `res.locals.urlFor`
so group auth handoffs, API-failure POST outcomes, and file-download auth exits
stay under shared tenant mounts and custom-domain child paths. Focused source
coverage plus a shared-mount group notification API-failure test now guard that
central helper. A scoped Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6611`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed `22/22` checks for base auth/cookie/logout plus `/groups/484/invite`,
`/groups/484/notifications`, `/groups/484/image`, `/groups/484/manage`,
`/groups/484/discussions`, and `/groups/484/discussions/new` module/body
markers. The latest group/volunteering source slice also routes volunteering
recommended-shift back/opportunity links through `urlFor()`. The latest public
volunteering source slice now routes the
volunteering landing/search form, organisation CTA, opportunity cards,
load-more link, opportunity detail back/organisation/apply links, and clear
filter links through `urlFor()`. Volunteering action redirects now route auth,
validation, success, and API-failure destinations through `res.locals.urlFor`
from the central action helper and direct validation branches. The latest
volunteering certificate/credential source slice now routes certificate back,
generate, and download controls plus credential back, upload, and delete
controls through `urlFor()`. The latest
resources source slice now routes resource browse, library, upload, delete,
download, comment, reaction, reorder, category, search, and pagination
controls through `urlFor()`. The latest resources redirect slice now routes
resource auth-required handoffs, upload/reorder/delete outcomes, and
comment/reaction result redirects through `res.locals.urlFor`; focused
shared-mount coverage proves `/acme/accessible/resources/42/delete` POSTs
redirect to `/acme/accessible/resources/library?status=resource-deleted`.
The latest search source slice now routes simple
search, advanced search, saved-search delete, result tabs, result links,
empty-state CTAs, pagination base URL, and saved-search forms through
`urlFor()`. The latest search route-redirect slice now sends unsigned
auth-required handoffs and saved-search save/delete/run result redirects
through `res.locals.urlFor`, matching Laravel's named-route redirect behavior
under shared mounts and custom-domain contexts. The latest saved source slice now routes saved-item filters,
bookmark links/removal, collection list/detail pagination and CRUD controls,
public collection links, and appreciation send/react/pagination controls
through `urlFor()`. The latest saved route-redirect slice now routes saved
collection auth handoffs, collection create/update/delete/item-remove results,
saved-item removal results, appreciation send results, and appreciation
reaction anchors through `res.locals.urlFor`, so saved-family POST outcomes
stay inside the active shared tenant mount or custom-domain context instead of
falling back to flat `/saved`, `/me/collections`, or `/users/...` paths. The latest jobs source slice now routes jobs tabs,
browse filters, saved/application/owner links, alerts, responses, detail
actions, employer pages, talent search/profile links, CSV/CV downloads,
pagination, and job POST forms through `urlFor()`. The latest jobs
route-redirect slice now routes create/update/delete/renew/apply/save/unsave,
application status/withdrawal, alert, interview, offer, and owner CSV failure
redirects through `res.locals.urlFor`, with shared-mount coverage proving
`/acme/accessible/jobs/42/apply` redirects to `/acme/accessible/login` before
any Laravel Jobs API call. The latest podcast source slice now routes podcast
browse/studio links, search form, show and episode
links, subscribe form, create/edit form actions, episode publish/delete/upload
forms, show publish/delete forms, and studio management links through
`urlFor()`. The latest podcast action redirect slice now routes subscribe,
studio create/update/publish/delete, and episode add/publish/delete POST
outcomes through `res.locals.urlFor`, so podcast workflow redirects no longer
depend on flat `/login` or `/podcasts` paths before shared-mount/custom-domain
rewriting.
The latest podcast GET redirect slice now routes signed-out and Laravel-401
podcast page auth handoffs through `res.locals.urlFor`, with shared-mount
coverage proving `/acme/accessible/podcasts` redirects to the tenant-mounted
login path before any Laravel podcast API call.
The latest feed source slice now routes feed compose/filter forms, hashtag
links, post and item permalink links, like/comment/not-interested forms,
author and group links, pagination, and sign-in CTAs through `urlFor()`.
The latest feed action redirect slice now sends feed post, item, comment,
poll, moderation, share, save, and mute POST result redirects through
`res.locals.urlFor`, with shared-mount coverage proving an empty
`/acme/accessible/feed/posts` submission redirects to
`/acme/accessible/feed?status=post-empty`.
The latest poll action redirect slice now routes auth-required, create, vote,
rank, delete, like, and comment POST outcomes through `res.locals.urlFor`, with
shared-mount coverage proving `/acme/accessible/polls/42/vote` stays under the
active tenant mount when redirecting to auth-required login.
The latest legacy poll vote redirect cleanup now also routes the older
`src/routes/polls.js` vote success and non-401 API-error redirects through
`res.locals.urlFor`, so that compatibility path no longer emits flat
`/polls/{id}` locations under shared tenant mounts or custom-domain child
paths.
The latest poll source slice now routes poll browse filters, create/manage
links, inline create form, detail/rank back links, vote/rank/delete/like/comment
forms, discussion links, and CSV export links through `urlFor()`, with source
regression coverage guarding against raw `/polls` template targets returning.
The latest review action redirect slice now routes auth-required, comment,
reaction, Laravel-401 review workflow redirects, and Laravel-verbatim
delete-review status redirects through `res.locals.urlFor`, with shared-mount
coverage proving `/acme/accessible/reviews` stays under the active tenant mount
when redirecting to auth-required login and `/acme/accessible/reviews/91/delete`
ignores a submitted `return_url=/dashboard` while redirecting to
`/acme/accessible/reviews?status=review-deleted` or
`/acme/accessible/reviews?status=review-delete-failed`.
The latest review source slice now routes review summary/list/comment links,
received/given tabs, load-more links, pending-review forms, comment forms, and
reaction forms through `urlFor()`, with source regression coverage guarding
against raw `/reviews` template targets returning.
The latest review status-banner slice now matches Laravel Blade presentation
for the reviews index status outcomes: `review-submitted` and `review-deleted`
render success notification banners, while failed/invalid statuses render the
GOV.UK error summary with Laravel English copy. Focused Jest first failed on
the old submitted/delete-failed copy and notification-banner presentation, then
passed after the Nunjucks status branch and route copy were aligned.
The latest group-exchange action redirect slice now sends auth-required,
validation, success, and API-failure POST redirects through `res.locals.urlFor`.
Focused shared-mount coverage proves an invalid signed
`/acme/accessible/group-exchanges/new` submission redirects to
`/acme/accessible/group-exchanges/new?status=create-invalid`. A follow-up
group-exchange GET redirect slice now sends unsigned list, create, and detail
auth handoffs through `res.locals.urlFor`, with shared-mount coverage proving
`/acme/accessible/group-exchanges`, `/acme/accessible/group-exchanges/new`,
and `/acme/accessible/group-exchanges/7` redirect to the tenant-mounted login
path.
The latest ideation action redirect slice now sends challenge, idea, outcome,
media, conversion, and campaign POST redirects through `res.locals.urlFor`.
Focused shared-mount coverage proves a signed
`/acme/accessible/ideation/new` submission redirects to
`/acme/accessible/ideation/{id}?status=challenge-created`.
The latest ideation source-template slice now routes the ideation tabs,
challenge list filters, challenge/card links, create/edit/manage/outcome/draft
forms, idea detail controls, tag links, campaign links, and outcome links
through `urlFor()`, so rendered ideation pages no longer rely on flat
`/ideation` source targets before tenant/custom-domain rewriting.
The latest ideation GET redirect slice now sends unsigned challenge list,
create/edit/manage/outcome/draft/detail, idea detail, tag, campaign, and
outcome auth handoffs through `res.locals.urlFor`, so signed-out ideation
requests also stay inside shared tenant mounts and custom-domain child paths.
A scoped Laravel runtime smoke against temporary Web UK
`http://127.0.0.1:6626`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2`
passed `23/23` checks, including all 12 flat ideation auth-required redirects.
Additional temp-process runtime assertions against `http://127.0.0.1:6625`
proved `/hour-timebank/accessible/ideation`,
`/hour-timebank/accessible/ideation/23/edit`, and
`/hour-timebank/accessible/ideation/2/ideas/1` redirect to the tenant-mounted
login path.
The latest members source slice now routes
the member directory search/clear/profile/connection controls, discovery and
nearby filter navigation/forms/member links/load-more links, and insights
profile back links through `urlFor()`.
The latest member action redirect slice now routes member connection,
endorsement, block/unblock, review, transfer, discover, nearby, insights, and
Laravel-401 auth redirects through `res.locals.urlFor`, with shared-mount
coverage proving `/acme/accessible/members/{id}/connection` and blocked-list
unblock results stay inside the active tenant mount.
The latest knowledge-base source slice now routes the public `/kb` search form,
article links, load-more link, article back link, and related-article links
through `urlFor()`. A follow-up cleanup also routes the unmounted legacy
`knowledge-base` compatibility templates through `urlFor()` so stale source
does not escape tenant/custom-domain mounts; Laravel's real accessible
knowledge-base route family remains `/kb`.
The latest dashboard source slice now routes onboarding, exchange-attention,
create-listing, upcoming-event, quick-link, recent-feed, and recent-listing
dashboard links through `urlFor()`.
The latest goals source slice now routes goals browse/detail, template,
discover, buddying, edit, check-in, reminder, buddy-action, history, insights,
and social links/forms through `urlFor()`. The latest goals route-redirect
slice now routes goals auth handoffs, create/template/delete/buddy/progress/
complete/check-in/reminder/buddy-action/like/comment outcomes, and Laravel-401
fallbacks through `res.locals.urlFor`, with shared-mount coverage proving goal
POST redirects stay inside the active tenant mount.
The latest exchanges source slice now routes exchange list tabs, detail links,
pagination, listing/message links, action forms, and rating form through
`urlFor()`. The latest exchange redirect slice now routes exchange action and
rating POST result redirects through `res.locals.urlFor`, with focused
shared-mount coverage proving `/acme/accessible/exchanges/{id}` POSTs redirect
back inside the active tenant mount.
The latest public coupon source slice now routes public coupon list/detail
links through `urlFor()`. The latest public coupon route-redirect slice now
routes unsigned `/coupons` and `/coupons/{id}` auth handoffs through
`res.locals.urlFor`, matching Laravel's named login route behavior for shared
tenant mounts and custom-domain contexts. The latest parent-domain reserved-segment slice now
aligns Web UK's child-slug guard exactly with Laravel
`TenantContext::getReservedPaths()`, so Laravel-unreserved names such as
`courses` can still resolve as child tenants on a parent custom domain. The
latest public fallback-link slice now routes newsletter-unsubscribe and error
page home links through `urlFor('/')`, matching Laravel's
`govuk-alpha.home` route usage and keeping fallback links tenant/custom-domain
aware.
The latest premium source/return-url slice now routes pricing, management, and
return-page premium links/forms through `urlFor()`, sends premium auth/status
redirects through `res.locals.urlFor`, and builds checkout plus billing-portal
`return_url` payloads from the active tenant URL helper. This matches Laravel's
named-route callback behavior for shared mounts and custom-domain contexts
without rewriting external Stripe or billing-portal destinations.
The latest AI chat and matches source slice now routes AI chat back links,
conversation links, new-conversation links, chat form actions, matches filters,
board links, listing/group/event links, dismiss forms, empty-state CTAs, and
back links through `urlFor()`.
The latest AI chat redirect slice now routes the AI chat auth-required,
empty-message, and post-send redirects through a route-local helper that uses
`res.locals.urlFor`, so redirects generated by `src/routes/ai-chat.js` stay
inside the active `/{tenantSlug}/accessible` mount without relying only on the
shared-mount response rewriter.
A follow-up cleanup removes the unmounted legacy `src/routes/chat.js` router
and the orphaned `src/views/chat/index.njk` template, so the only route/view
source for Laravel's `/chat` matrix rows is the mounted tenant-aware
`src/routes/ai-chat.js` plus `src/views/ai-chat/index.njk` implementation.
The latest matches redirect slice now routes match dismiss and board dismiss
redirects through `res.locals.urlFor`, so redirects generated by
`src/routes/matches.js` stay inside the active tenant mount.
The latest auth redirect slice now routes login, two-factor, register, logout,
forgot-password, and reset-password redirects through `res.locals.urlFor`, so
redirects generated by `src/routes/auth.js` stay inside the active tenant mount.
The latest server-level redirect slice now routes core cookie, account, and
organisation redirects generated by `src/server.js` through `res.locals.urlFor`
where the target is deterministic, while leaving user-provided safe return URLs
to the existing safe-local redirect handling.
The latest contact/support redirect slice now routes contact validation,
contact result, signed-out report-a-problem, report validation, report sent,
report failed, and unsigned report POST redirects generated by
`src/routes/contact-support.js` through `res.locals.urlFor`, so support
workflow redirects stay inside the active tenant mount without relying only on
the shared-mount response rewriter.
The latest Explore redirect slice now routes unsigned and Laravel-401
`/explore` redirects generated by `src/routes/explore.js` through
`res.locals.urlFor`, so the Explore gateway's auth-required redirects stay
inside the active tenant mount without relying only on the shared-mount
response rewriter.
The latest achievements redirect slice now routes unsigned, Laravel-401,
daily-reward, challenge-claim, shop-purchase, and showcase redirects generated
by `src/routes/achievements.js` through `res.locals.urlFor`, so gamification
POST results and auth-required redirects stay inside the active tenant mount
without relying only on the shared-mount response rewriter.
The latest connection redirect slice now routes unsigned network redirects and
accept/decline/remove POST result redirects generated by
`src/routes/connections.js` through `res.locals.urlFor`, so connection workflow
redirects stay inside the active tenant mount without relying only on the
shared-mount response rewriter.
The latest clubs source slice now routes the clubs search form through
`urlFor('/clubs')` and the unsigned clubs redirect through `res.locals.urlFor`,
so the clubs directory stays inside the active tenant mount without relying
only on the shared-mount response rewriter. The latest active-club evidence
slice now also mirrors Laravel's Clubs route gate: signed empty unfiltered club
responses return `404`, while searched empty results can still render the Clubs
page when a minimal unfiltered probe proves the tenant has active clubs.
The latest skills source slice now routes the skills category/member/search
links and search form through `urlFor()`, routes the unsigned skills redirect
through `res.locals.urlFor`, and makes shared `asyncRoute` 401/error redirects
tenant-aware when `res.locals.urlFor` is present. Focused shared-mount coverage
now proves `/acme/accessible/skills` unsigned and expired-token redirects stay
under `/acme/accessible/login?status=auth-required`.
The latest shared pagination partial slice now changes the documented/default
members pagination base URL from raw `/members` to `urlFor('/members')`, so a
caller that omits `paginationConfig.baseUrl` does not leak a flat root path
under shared tenant mounts or custom-domain child paths.
The latest shared empty-state/breadcrumb partial slice now routes empty-state
primary and secondary action links through `urlFor()` and updates breadcrumb
examples to use `urlFor(...)`, so shared partial usage does not leak flat local
paths when rendered under `/{tenantSlug}/accessible`.
The latest shell tenant-gating slice now mirrors Laravel
`AlphaController::alphaNavItems()` and `alphaFooterColumns()` for shared shell
links: Dashboard, Feed, Listings, Members, Events, Volunteering, and footer
Blog are filtered from tenant bootstrap `modules`/`features`, and the footer
Platform column is removed when no platform links are enabled. This is shell
visibility parity only; page-level disabled-state behavior still needs
module-by-module certification.
The latest generated-prep cleanup slice now narrows
`src/routes/laravel-prep-pages.js` to rows explicitly marked `missing` in the
generated route matrix. With the current 608/608 matrix, the runtime prep-page
loader exports `0` preparation pages, so matched Laravel GET routes are no
longer backed by generic skeleton handlers after the real route modules.

## Non-Negotiable Rules

- Keep the stack as Express, Nunjucks, GOV.UK Frontend, SSR HTML.
- Do not add React, Next.js, Vue, client-side routing, or a new CSS framework.
- Do not use GOV.UK branding in a way that implies this is a UK government
  service.
- Do not make route matrix gaps disappear by weakening the Laravel source target.
- Do not treat generated preparation pages as workflow parity.
- Do not build backend-specific page adapters. Prefer Laravel-compatible API
  contracts and make ASP.NET match those contracts later.
- Do not overwrite dirty files created by active agents. Check status and diffs
  before editing.

## Current Snapshot

Snapshot refreshed after consolidating the parallel Web UK streams on
2026-07-08. Regenerate before trusting it.

| Item | Last observed state |
| --- | --- |
| Branch | `main` |
| Head commit | Rerun `git rev-parse --short HEAD` before editing because `main` is actively moving through focused Web UK parity commits. |
| Dirty files seen | None expected after the consolidation commit; rerun `git status --short --branch` and treat that as authoritative. |
| Working estimate | about `998.8/1000` implementation/certification parity |
| Green confidence estimate | about `992/1000`, mainly gated by visual/manual Laravel Blade parity, live disabled-tenant fixture proof for broker workflow behavior, and ASP.NET backend switching certification |
| Documentation readiness after this handoff | Current for the consolidated branch state, route declarations, clean lint evidence, local Jest evidence, backend base-URL provenance, Laravel auth-smoke tenant-context evidence, full default Laravel runtime-smoke coverage via chunked/bucketed runs, tenant-domain Host-header smoke evidence, and remaining visual/tenant certification gaps, assuming agents rerun the refresh protocol |

The latest generated route matrix at this handoff reported:

| Metric | Last observed result |
| --- | --- |
| Laravel accessible routes | `608` |
| Web UK routes | `610` |
| Matched routes | `608` |
| Missing Laravel routes | `0` |
| Extra Web UK routes | `0` |
| Ignored Web UK infrastructure routes | `3` |
| Generated prep-page matches | `0` rows matched through `src/routes/laravel-prep-pages.js` |
| Runtime generated prep pages | `0` exported by `src/routes/laravel-prep-pages.js` |

Latest focused verification on 2026-07-09 for the generated prep-page cleanup
slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/laravel-prep-pages.test.js --runInBand` first failed because the loader still registered a matched `/matched` GET row as a preparation page, then passed after filtering to `status: "missing"`.
- `node -e "const r=require('./apps/web-uk/src/routes/laravel-prep-pages'); console.log(r.prepPages.length)"` reported `0` current runtime preparation pages.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes after the loader cleanup.
- A scoped live `npm --prefix apps/web-uk run smoke:laravel` against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`, with module/page sweeps disabled, passed 10/10 checks for Laravel API reachability, Web UK health, cookie-consent POST workflows, login CSRF, login POST, signed `/account`, and logout. This is core runtime proof only, not the required full default smoke.

Latest full default Laravel runtime-smoke recertification on 2026-07-09:

- Started a dedicated local Web UK process at `http://127.0.0.1:6510` with
  `TENANT_ID=2`, `ACCESSIBLE_BACKEND_TARGET=laravel`, and
  `LARAVEL_BASE_URL=http://127.0.0.1:8088` so public fixture routes resolve the
  same tenant as the Laravel E2E account.
- `npm --prefix apps/web-uk run route:matrix` passed immediately before the
  smoke work with 608/608 Laravel accessible routes matched, 0 missing, 0 extra
  Web UK routes, and 3 ignored infrastructure routes.
- The module-page default sweep passed in eight deterministic chunks with body,
  gated, redirect, content-type, and tenant-domain buckets disabled:
  `SMOKE_MODULE_PAGE_CHUNK=1/8` through `8/8` covered all `281` module-page
  checks with `0` failures.
- The body-text default sweep passed in eight deterministic chunks with module,
  gated, redirect, content-type, and tenant-domain buckets disabled:
  `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8` through `8/8` covered all `283` body-text
  checks with `0` failures.
- The core non-page buckets passed as explicit smaller groups: unsigned
  auth-required redirects, unsigned login redirects, content-type checks,
  all `22` signed gated-status checks, and all `19` signed redirect checks.
- A single all-in-one core run on this local stack still produced a transient
  mixed-sequence failure for `/listings/42/analytics`, but the same signed Web
  session sequence and the focused/split gated smoke returned the Laravel-truth
  `403`. Use the chunked/bucketed shape above for current full-scope local
  certification rather than treating an unchunked wrapper run as authoritative.
- 2026-07-10 smoke-scope correction: `/clubs` now follows the documented local
  `hour-timebank` no-active-club fixture and is checked as a signed gated `404`
  rather than as a 2xx module/body-text page. The current default scope is
  `633` checks: `280` module-page checks, `282` body-text contract checks, and
  `23` gated-status checks, with the other buckets unchanged.

Latest focused visual/manual Blade spot-check on 2026-07-09 for the tenant
home shell and footer meta:

> Canonical-route correction (2026-07-13): Laravel comparisons use
> `/{tenantSlug}/accessible`. `/alpha` is legacy redirect compatibility only;
> it is not a valid visual/source comparison URL.

- Browser-style DOM comparison checked Laravel
  `http://127.0.0.1:8088/hour-timebank/accessible` against a tenant-correct Web UK
  process at `http://127.0.0.1:6511/hour-timebank/accessible`, started with
  `TENANT_ID=2`, `ACCESSIBLE_BACKEND_TARGET=laravel`, and
  `LARAVEL_BASE_URL=http://127.0.0.1:8088`.
- The tenant home matched the key Blade markers for `Hour Timebank`,
  `Accessible`, `Connecting Communities`, `Members 946`, `Hours exchanged
  1,988`, `Active listings 129`, `Communities 1`, service-nav labels, guest
  `Sign in`/`Register` CTAs, and dashboard auth-required link behavior while
  keeping Web UK's public links on `/accessible` instead of Laravel's
  `/alpha`.
- The comparison found a concrete footer meta copy gap: Laravel's visually
  hidden meta heading is `Supporting information and attribution`, while Web UK
  still said `Support and licence information`. The focused shell test first
  failed on that missing string, then passed after `partials/footer.njk` was
  aligned.
- This is the first focused visual/manual tenant-home shell slice only. It does
  not certify every route family, feature-disabled page behavior, tenant
  logo/colour depth, localization, or ASP.NET backend switching.

Latest repeatable Blade visual spot-check command on 2026-07-10:

- `npm run visual:blade` is a scoped visual checkpoint. It compares Laravel
  `http://127.0.0.1:8088/hour-timebank/accessible` with Web UK
  `/hour-timebank/accessible` for the tenant home markers `Hour Timebank`,
  `Accessible`, `Connecting Communities`, and `What you can do`.
- The same command checks Web UK custom-domain roots with real Host headers for
  `project-nexus.ie` and `timebank.global`. Expected master/cluster headings
  are loaded from Laravel `/api/v2/tenant/bootstrap` using matching Host/Origin
  headers, then verified against Web UK root HTML while asserting no `/alpha`
  or `/accessible` public-slug leakage.
- A follow-up 2026-07-10 expansion adds public/auth/support/legal Blade-vs-Web
  checks for `/login`, `/register`, `/login/forgot-password`,
  `/password/reset?token=reset-token`, `/contact`, `/cookies`, `/about`,
  `/guide`, `/features`, `/faq`, `/help`, `/trust-and-safety`,
  `/accessibility`, `/legal`, `/legal/privacy`, and `/report-a-problem`. Each
  page is compared as Laravel `/{tenantSlug}/accessible/...` versus Web UK
  `/{tenantSlug}/accessible/...` and asserts no `/{tenantSlug}/alpha` leakage
  in Web UK HTML.
- Focused Jest first failed while the script still treated Laravel host-root
  HTML as the source, then passed after host-root expectations were moved to
  Laravel bootstrap. A live run against temporary Web UK
  `http://127.0.0.1:6661`, started with `TENANT_ID=2`,
  `ACCESSIBLE_BACKEND_TARGET=laravel`, and
  `LARAVEL_BASE_URL=http://127.0.0.1:8088`, passed all 3 checks.
- The expanded public/auth/support test first failed on the missing default
  check list, then the live command caught marker strings that were not actually
  present in Laravel Blade. After the markers were grounded in rendered Laravel
  text, a live run against temporary Web UK `http://127.0.0.1:6662` passed
  all 19 checks.
- This is a repeatable tenant/home plus public/auth/support/legal visual guard.
  It does not certify signed module pages, every tab, POST side effects, upload
  flows, localization variants, disabled-tenant fixtures, or ASP.NET backend
  switching.

Latest focused verification on 2026-07-09 for the events index/form
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "event index"` first failed on raw `/events` and `/groups` links, then passed after conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 22 tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "event"` passed: 23 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- Source scan of `src/views/events/index.njk`, `new.njk`, and `edit.njk` for raw event/group local `href` and event form `action` strings returned no matches.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites, 727 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary Web UK `http://127.0.0.1:6464` and Laravel `http://127.0.0.1:8088` passed 12 checks, including `/events=>Events` and `/events/new=>Create an event`; the broader CLI invocation timed out after walking default smoke page lists and is not counted as a full-smoke pass.

Latest focused verification on 2026-07-09 for the search template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "search forms"` first failed on raw `/search`, `/listings`, `/members`, `/events`, and `/groups` links/actions, then passed after conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "search route redirects"` first failed on missing route-helper coverage and raw `/login` plus `searchAdvancedUrl(...)` redirects, then passed after those redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `Get-ChildItem apps\web-uk\src\views\search -Filter *.njk | Select-String -Pattern 'href="/search','action="/search','href="/listings','href="/members','href="/events','href="/groups','href: "/search','href: "/listings','baseUrl: "/search'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "search"` passed: 16 selected tests.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary in-process Web UK `http://127.0.0.1:56338` and Laravel `http://127.0.0.1:8088`, started with `TENANT_ID=2`, passed 13 checks: base API/health, cookie, login, account, logout, signed `/search/advanced?q=garden`, and body markers `Advanced search` and `Save this search`.

Latest focused verification on 2026-07-09 for the saved template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "saved-item"` first failed on raw `/saved`, `/me/collections`, `/members`, `/users`, and `/appreciations` links/actions, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\saved\*.njk,apps\web-uk\src\views\saved-collections\*.njk,apps\web-uk\src\views\saved-social\*.njk -Pattern 'href="/saved','action="/saved','href="/me','action="/me','href="/members','href="/users','action="/users','action="/appreciations','href="{{ item.href }}' -SimpleMatch` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "saved"` passed: 20 selected tests.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary in-process Web UK `http://127.0.0.1:50823` and Laravel `http://127.0.0.1:8088`, started with `TENANT_ID=2`, passed 16 checks: base API/health, cookie, login, account, logout, signed `/saved`, `/me/collections`, and `/users/14/appreciations`, plus body markers `Saved items`, `My collections`, and `Appreciation`.

Latest focused verification on 2026-07-09 for the saved route-redirect
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "saved collection and appreciation route redirects|saved collection redirects inside|saved appreciation redirects inside"` first failed because the saved route files still emitted direct `res.redirect(...)` targets, then passed after routing saved collection, saved item, and appreciation redirects through `res.locals.urlFor`.
- Shared-mount behavior coverage proves signed POST outcomes under `/acme/accessible/me/collections`, `/acme/accessible/users/{id}/appreciations`, and `/acme/accessible/appreciations/{id}/react` redirect back under `/acme/accessible`.
- A scoped Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed 16 checks for base API/health, cookie, login/account/logout, signed `/saved`, `/me/collections`, and `/users/14/appreciations`, plus body markers `Saved items`, `My collections`, and `Appreciation`.

Latest focused verification on 2026-07-09 for the jobs template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "jobs browse"` first failed on raw `/jobs` links/actions, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\jobs\*.njk -Pattern 'href="/jobs','action="/jobs','href: "/jobs','baseUrl: "/jobs','href="{{ nextHref }}','href="{{ meta.nextHref }}','action="{{ formAction }}' -SimpleMatch` returned no matches.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 27 tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "jobs|job"` passed: 28 selected tests.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary in-process Web UK `http://127.0.0.1:60268`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 24 checks: base API/health, cookie, login, account, logout, signed `/jobs/saved`, `/jobs/applications`, `/jobs/mine`, `/jobs/create`, `/jobs/alerts`, `/jobs/responses`, and `/jobs/employer-onboarding`, plus body markers `Saved opportunities`, `My applications`, `My postings`, `Post an opportunity`, `Job alerts`, `Interview invitations`, and `Welcome to posting opportunities`.

Latest focused verification on 2026-07-09 for the jobs route-redirect
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "jobs route redirects"` first failed on raw `res.redirect('/login')`/`res.redirect('/jobs...')` outcomes, then passed after conversion through `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Laravel jobs action aliases"` passed, including mounted unsigned `/acme/accessible/jobs/42/apply` redirecting to `/acme/accessible/login` without calling the Laravel Jobs API.
- A scoped Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6514`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 17 checks for base API/health, cookie, login/account/logout, signed `/jobs`, `/jobs/90764`, `/jobs/90764/qualified`, and `/jobs/employers/14`, plus body markers `Apply for this opportunity`, `Am I qualified?`, and `Open opportunities and reviews for this employer`.

Latest focused verification on 2026-07-09 for the members template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "member directory"` first failed on raw `/members` links/actions, then passed after conversion.
- `Get-ChildItem -Path apps\web-uk\src\views\members -Filter *.njk | Select-String -SimpleMatch -Pattern 'href="/members','action="/members','href="/connections','href="/profile','href: "/members','baseUrl: "/members','href="{{ nextHref }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "members"` passed: 42 selected tests.
- A focused exported Laravel runtime smoke against temporary in-process Web UK `http://127.0.0.1:64511`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 18 checks: base API/health, cookie, login, account, logout, signed `/members`, `/members/discover`, `/members/nearby`, and `/members/77/insights`, plus body markers `Community members`, `Recommended members`, `Members near me`, and `Reputation and recognition`.

Latest focused verification on 2026-07-09 for the podcast template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast browse"` first failed on raw `/podcasts` links/actions, then passed after conversion.
- `Get-ChildItem -Path apps\web-uk\src\views\podcasts -Filter *.njk | Select-String -SimpleMatch -Pattern 'href="/podcasts','action="/podcasts','href: "/podcasts','baseUrl: "/podcasts','action="{{ action }}','action="{{ episodeStoreAction }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "podcast"` passed: 10 selected tests.
- A focused exported Laravel runtime smoke against temporary in-process Web UK `http://127.0.0.1:64493`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 16 checks: base API/health, cookie, login, account, logout, signed `/podcasts`, `/podcasts/studio`, and `/podcasts/studio/new`, plus body markers `Podcasts`, `Podcast studio`, and `Create a podcast`.

Latest focused verification on 2026-07-09 for the podcast action redirect
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast action redirects"` first failed on raw `res.redirect(loginRedirect())` and raw podcast status redirects in `src/routes/podcast-actions.js`, then passed after those redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "podcast action aliases"` passed: 1 selected test, preserving the existing Laravel podcast POST alias behavior and flat redirect destinations.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` against temporary Web UK `http://127.0.0.1:6511`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 13/13 checks: base API/health, cookie, login, account, logout, and signed `/podcasts`, `/podcasts/studio`, and `/podcasts/studio/new`.

Latest focused verification on 2026-07-09 for the podcast GET redirect slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "podcast page redirects"` first failed on raw `res.redirect(loginRedirect())` calls in `src/routes/podcasts.js`, then passed after signed-out and Laravel-401 auth handoffs moved through `redirectTo(res, loginRedirect())` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "redirects signed-out visitors away from podcasts"` passed: 1 selected test, covering both flat `/podcasts` and mounted `/acme/accessible/podcasts` auth-required redirects without calling Laravel.

Latest focused verification on 2026-07-09 for the feed template-helper and
Laravel live-shape slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "feed browse"` first failed on raw `/feed` links/actions, then passed after conversion.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "author-shaped posts"` first failed with a 500 when Laravel returned `author` instead of `user`, then passed after feed post normalization was expanded.
- `Get-ChildItem -Path apps\web-uk\src\views\feed -Filter *.njk | Select-String -SimpleMatch -Pattern 'href="/feed','action="/feed','href="/members','href="/groups','href="/login','href: "/feed','href="{{ nextHref }}','href="{{ item.deepLink.href }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "feed"` passed: 19 selected tests.
- A focused exported Laravel runtime smoke against temporary in-process Web UK `http://127.0.0.1:58285`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 20 checks: base API/health, cookie, login, account, logout, signed `/feed`, `/feed/hashtags`, `/feed/hashtag/timebank`, `/feed/posts/796`, and `/feed/item/listing/42`, plus body markers `Feed`, `Hashtags`, `#timebank`, `Post`, and `View listing`.

Latest focused verification on 2026-07-09 for the groups index/form
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group index"` first failed on raw `/groups` links, actions, and pagination base URL, then passed after conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 23 tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "renders group navigation without legacy member-management links"` passed.
- Source scan of `src/views/groups/index.njk`, `new.njk`, `edit.njk`, and `my.njk` for raw group local `href`, form `action`, JavaScript `href`, and pagination `baseUrl` strings returned no matches.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites and 728 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary Web UK `http://127.0.0.1:6465` and Laravel `http://127.0.0.1:8088` passed 12 checks, including `/groups=>Groups` and `/groups/new=>Create a group`.

Latest focused verification on 2026-07-09 for the resources
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "resource browse"` first failed on raw `/resources` links/actions, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\resources\*.njk -Pattern 'href="/resources','action="/resources','href: "/resources','baseUrl: "/resources'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "resource"` passed: 14 selected tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 24 tests.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites and 730 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A focused exported `runLaravelRuntimeSmoke()` invocation against temporary in-process Web UK `http://127.0.0.1:54932` and Laravel `http://127.0.0.1:8088`, started with `TENANT_ID=2`, passed 18 checks: base API/health, cookie, login, account, logout, module renders for `/resources`, `/resources/library`, `/resources/upload`, and `/resources/10/comments`, plus body markers `Resources`, `Resource library`, `Upload a resource`, and `Discussion`.

Latest focused verification on 2026-07-10 for current Laravel parent-domain
reserved-path drift:

- Laravel `TenantContext::getReservedPaths()` added 21 first segments:
  `advertise`, `auth`, `clubs`, `coupons`, `courses`, `developers`,
  `donations`, `join`, `me`, `municipality-calendar`, `partner-analytics`,
  `pilot-apply`, `pilot-inquiry`, `podcasts`, `premium`, `pricing`,
  `regional-analytics`, `saved`, `trust-and-safety`, `users`, and
  `verify-identity-optional`.
- `npm test -- --runTestsByPath tests/tenant-routing-source.test.js --runInBand`
  first failed with those 21 Laravel-only entries, then passed after
  `RESERVED_CHILD_SEGMENTS` was synchronized.
- Focused route coverage now exercises all 21 new segments and proves none is
  probed as a child tenant slug, while `/gardeners/login` remains a real
  unreserved parent-domain child case. The focused run passed 22/22 selected
  tests.
- `npm test -- --runInBand` passed all 13 suites and 891/891 tests; `npm run
  lint` passed; and `npm run route:matrix` remained 608/608 matched, 0 missing,
  0 extra application routes, and 3 ignored infrastructure routes.

Latest focused verification on 2026-07-10 for the complete tenant-URL and
shared-layout boundary:

- All 54 audited literal root-relative links/forms across 17 volunteering
  templates now use `urlFor()`, as do the three generated cursor consumers and
  legal-hub document links. The app-wide Nunjucks source regression reports no
  tenant-local root-relative `href`/`action` attributes; only `/assets/` and
  `/css/` public resources are intentionally allowed.
- `urlFor()` is idempotent for already-mounted paths, cookie-banner return
  redirects cannot escape the active tenant mount, and the session-timeout UI
  signs out through the mounted CSRF-protected POST form rather than GET
  `/logout`. Mounted render/POST coverage proves query strings, fragments,
  login fallback, cookie returns, and logout redirects stay below
  `/acme/accessible`.
- The shared layout now relies on the GOV.UK parent template's main landmark;
  rendered coverage proves exactly one `<main>` and one `main-content` ID.
- The combined full Jest run passed 15 suites and 903/903 tests. `npm run lint`,
  `npm run brand:check`, and `npm run route:matrix` passed; the route matrix
  remains 608/608 matched, 0 missing, 0 extra application routes, and 3 ignored
  infrastructure routes. `npm run build:css` passed with only the existing
  GOV.UK palette deprecation warnings.
- Current-checkout ephemeral Laravel smoke at Web UK
  `http://127.0.0.1:54979` passed 11/11 core and parent-domain checks, including
  `timebank.global|/hour-timebank/login=>Sign in`, cookie POSTs, login, signed
  account, and logout POST. A separate current-checkout ephemeral Blade visual
  spot-check at `http://127.0.0.1:57377` passed all 19 tenant-home,
  master/cluster-domain, public/auth/support/legal comparisons against Laravel
  `http://127.0.0.1:8088`.

Latest browser accessibility-gate verification on 2026-07-10:

- `npm run test:accessibility` builds CSS, requires the current checkout, and
  binds an OS-assigned loopback port; it never trusts the process on 5180.
- Playwright Chromium plus `@axe-core/playwright` passed 9/9 shared-mount pages
  at `http://127.0.0.1:56223`: tenant home, About, Guide, FAQ, sign in,
  registration, contact, legal hub, and accessibility statement.
- Every page returned below 400, rendered one main landmark, one
  `main-content` ID, one h1, no duplicate IDs, and no serious or critical axe
  violations. JSON/HTML reports, axe attachments, traces, and failure
  screenshots live under ignored `artifacts/accessibility/` output.
- This is an automated foundation, not full WCAG 2.2 AA certification.
  Authenticated/error/upload/destructive/RTL states and recorded manual
  keyboard, zoom/reflow, contrast, and screen-reader checks remain required.
- A recursive Nunjucks regression now inspects all 135 GOV.UK error summaries
  for `tabindex="-1"`. It first identified six omissions across organisation
  browse/jobs/status, feed hashtags, and wallet failure states; all six are
  fixed and the current source violation count is zero.

Latest focused verification on 2026-07-10 for current Laravel volunteering
semantic drift:

- Donation GET resolves and uppercases
  `req.accessibleRouting.tenant.settings.default_currency`, with EUR only as a
  defensive fallback. The form exposes the currency code to assistive
  technology, donation and expense hints are currency-neutral, donation POST
  omits `currency`, and values above `1,000,000` fail before any API call.
- Only the emergency-acceptance and group-cancellation advisories now announce
  `Warning`; real validation summaries still use `There is a problem`.
  Safeguarding summaries link `training_type`, `training_name`, `completed_at`,
  `title`, and `description` failures to existing controls, while
  `training-failed` and `incident-failed` remain plain text.
- Template-source coverage passed 108/108, focused semantic/render/action
  coverage passed 17/17, the full volunteering selection passed 34/34, and
  ESLint plus the scoped diff check passed.
- Read-only discovery checked all 15 tenants returned by the local Laravel
  tenant API; none currently exposes a non-EUR bootstrap currency. The GBP
  render and client-currency-omission contracts are therefore proved with
  focused current-source tests, while live non-EUR donation persistence remains
  blocked on a disposable non-EUR tenant fixture. No persistent donation was
  created merely to manufacture evidence.

Historical focused verification on 2026-07-09 for the earlier tenant
parent-domain reserved-path slice:

- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "Laravel-reserved parent-domain"` first failed because `/classic` on `parent-domain.test` called `getTenantBootstrap({ slug: "classic" })`, then passed after Web UK's reserved child-segment set was aligned with Laravel `TenantContext::getReservedPaths()`.
- At that Laravel source revision, `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "Laravel-unreserved accessible route names"` first failed because `/courses/login` on `parent-domain.test` stayed on the parent route path instead of probing `getTenantBootstrap({ slug: "courses" })`, then passed after Web UK's reserved child-segment set was made exact rather than over-broad. Laravel now reserves `courses`; the 2026-07-10 verification above supersedes this fixture with `/gardeners/login`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/tenant-routing-source.test.js --runInBand` first failed because Web UK did not export the copied reserved set for automated parity checks, then passed after the middleware exposed it. The test compares Laravel `TenantContext::getReservedPaths()` with Web UK `RESERVED_CHILD_SEGMENTS` and currently reports no differences.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath` passed: 40 tests.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites and 748 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` against temporary in-process Web UK `http://127.0.0.1:59115` and Laravel `http://127.0.0.1:8088` passed 11 checks, including `timebank.global|/hour-timebank/login=>Sign in` with no legacy `/alpha` or `/accessible` links.

Latest focused verification on 2026-07-09 for the public fallback home-link
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public fallback home links"` first failed on raw `href="/"` links in `public-info/newsletter-unsubscribe.njk`, then passed after newsletter-unsubscribe and error-page home links were routed through `urlFor('/')`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "newsletter unsubscribe"` passed: the missing, success, and invalid-token states still render.
- `rg -n 'href="/|action="/|href:\s*"/|action:\s*"/|baseUrl:\s*"/' apps/web-uk/src/views -g '*.njk'` returned no matches after the slice.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 39 tests.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites and 749 tests, with the existing Node `DEP0044 util.isArray` deprecation warning. An earlier concurrent full-suite attempt hit a transient `ENOBUFS` while stale 2026-07-08 Web UK Jest processes were still running; after stopping those stale test runners, the sequential rerun passed.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` against temporary in-process Web UK `http://127.0.0.1:63409` and Laravel `http://127.0.0.1:8088` passed 12 checks, including `/newsletter/unsubscribe=>Unsubscribe from emails`.

Latest focused verification on 2026-07-09 for the no-JS language selector
query-preservation slice:

- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "no-JS language selector"` first failed because the Web UK language form did not render Blade-style hidden query inputs for `status` and `return`, then passed after `buildShellLocals()` exposed scalar non-`locale` query params and `layouts/base.njk` rendered them as hidden inputs.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath` passed: 443 tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites and 750 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with only `/login?status=auth-required&return=%2Fexplore&locale=ga=>Sign in` as the body-text page passed 11/11 checks against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.
- This mirrors Laravel Blade's `request()->except(['locale'])` scalar query behavior for the global language selector. It does not newly certify localization depth, tenant feature gates, runtime locale persistence, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the shell tenant module/feature
gating slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/accessible-shell.test.js` passed: 3 tests.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand` passed: 443 tests.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/routes.test.js --runInBand` passed: 40 tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 11 suites and 753 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- The focused test pins Laravel Blade shell semantics for tenant bootstrap
  `modules`/`features`: signed-out service navigation hides disabled Dashboard,
  Feed, Members, and Events while preserving enabled Listings and Volunteering;
  signed-in service navigation hides anonymous Home and disabled Dashboard; and
  footer Platform links are filtered and prefixed through the active tenant
  mount.
- This does not certify page-level feature-disabled redirects/errors, account
  hub feature cards, Explore card gating, runtime Laravel tenant fixtures, or
  ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for shared-mount tenant bootstrap
and Laravel default feature gates:

- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "uses Laravel tenant feature defaults"` first failed because `/acme/accessible/explore` did not call Laravel tenant bootstrap and therefore treated omitted tenant feature flags as enabled.
- Web UK shared `/{tenantSlug}/accessible` requests now resolve tenant bootstrap through Laravel before rendering, so shell and Explore locals can use the same tenant data as custom-domain requests.
- `src/lib/accessible-shell.js` now mirrors Laravel `TenantFeatureConfig` defaults for shell/Explore visibility, keeping default-off cards such as Marketplace, Courses, Podcasts, Coupons, and Premium hidden unless Laravel explicitly enables them for the tenant.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"` passed: 9 selected tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Explore|shared tenant mount|accessible mount"` passed: 24 selected tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 12 suites and 829 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A targeted live Laravel smoke against a temporary current-code Web UK process at `http://127.0.0.1:6521` with `TENANT_ID=2` passed 11/11 checks, including signed `/acme/accessible/explore=>Explore`.
- This improves page-level feature visibility proof for shared tenant mounts. It does not certify every feature-disabled route response, visual/manual Blade parity, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for tenant-mounted default-off
feature page gates:

- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "tenant-mounted default-off feature pages"` first failed because `/acme/accessible/marketplace` rendered `200` when Laravel's `TenantContext::hasFeature('marketplace')` gate would abort with `403`.
- `src/middleware/tenant-feature-gates.js` now gates tenant-context route prefixes for Marketplace, Courses, Podcasts, Coupons, and Premium using the Laravel-aligned defaults exported from `src/lib/accessible-shell.js`: `marketplace`, `courses`, `podcasts`, `merchant_coupons`, and `member_premium` default to disabled until Laravel tenant bootstrap explicitly enables them.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "tenant-mounted default-off feature pages"` passed after the middleware was mounted after shell locals and before the route modules.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "tenant-mounted default-off feature pages|uses Laravel tenant feature defaults"` passed 2 selected tests.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"` passed 9 selected tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath` passed 467/467 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 12 suites and 830 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A targeted Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6531`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 15/15 checks. The narrowed `SMOKE_GATED_PAGE_PATHS` asserted signed `403` responses for `/acme/accessible/marketplace`, `/acme/accessible/courses`, `/acme/accessible/podcasts`, `/acme/accessible/coupons`, and `/acme/accessible/premium`; broad module/body/redirect/content-type/tenant-domain buckets were disabled for this focused run.
- This covers the first default-off page-level feature-gate slice for tenant contexts. It does not certify every Laravel `TenantContext::hasFeature()` or `hasModule()` route gate, visual/manual Blade parity, enabled-tenant depth behavior, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for tenant-mounted core module and
feature route gates:

- Laravel source evidence came from `TenantContext::hasFeature()`,
  `TenantContext::hasModule()`, and the generated route matrix `gates` column,
  which lists `module:` and `feature:` gates for the affected route families.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "disabled core route gates"` first failed because `/acme/accessible/dashboard` returned `200` while the mocked Laravel bootstrap set `modules.dashboard=false`.
- `src/middleware/tenant-feature-gates.js` now handles both `moduleKey` and
  `featureKey` prefixes. It blocks tenant-context disabled routes for
  Dashboard, Feed, Listings, Exchanges, Matches, Events, Volunteering,
  Organisations, Members, Connections, Messages, Wallet, Notifications,
  Achievements, Leaderboard, NEXUS score, Blog, AI chat, Federation, Goals,
  Groups, Group exchanges, Ideation, Jobs, Polls, Resources, Reviews, and
  Search, while preserving the existing default-off Marketplace, Courses,
  Podcasts, Coupons, and Premium gates.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "disabled core route gates|default-off feature pages"` passed 2 selected tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath` passed 468/468 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 12 suites and 831 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A targeted live smoke against temporary Web UK `http://127.0.0.1:6535`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed 18/18 checks. The live run proved the enabled local Laravel tenant still renders `/hour-timebank/accessible/dashboard=>Quick links`, `/hour-timebank/accessible/wallet=>Wallet`, and `/hour-timebank/accessible/members=>Community members`, and that the five default-off `/acme/accessible/*` feature pages still return `403`.
- This improves page-level disabled gate proof for shared tenant mounts. It does not live-smoke a real Laravel fixture with core modules disabled, every route-specific compound gate such as maps or organisation jobs, visual/manual Blade parity, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for route-specific compound tenant
feature gates:

- Laravel source evidence came from
  `app\Http\Controllers\GovukAlpha\Concerns\EventsParity.php`, where
  `/events/{id}/map` aborts unless both `events` and `maps` are enabled;
  `OrganisationsParity.php`, where `/organisations/{id}/jobs` aborts unless
  both `volunteering` and `job_vacancies` are enabled; and
  `MessagesParity.php`, where `/messages/groups/new` and group conversation
  create flows abort unless both `messages` and `connections` are enabled.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "compound gates"` first failed because `/acme/accessible/events/6/map` returned `200` while the mocked Laravel bootstrap set `features.maps=false`.
- `src/middleware/tenant-feature-gates.js` now returns every matching route
  gate instead of the first matching prefix, so broad family gates and
  route-specific pattern gates stack like Laravel Blade controller guards.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "compound gates"` passed the new compound gate test, asserting signed `403` responses for `/acme/accessible/events/6/map`, `/acme/accessible/organisations/42/jobs`, and `/acme/accessible/messages/groups/new` with disabled secondary flags.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath` passed 469/469 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 12 suites and 832 tests, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A scoped Laravel runtime smoke against temporary Web UK
  `http://127.0.0.1:6601`, Laravel `http://127.0.0.1:8088`, and
  `TENANT_ID=2` passed 13/13 checks. The live run proved auth/cookie/logout
  basics and that the enabled Laravel fixture still renders `/events/6/map`,
  `/organisations/636/jobs`, and `/messages/groups/new`.
- This closes the proven maps, organisation-jobs, and group-message compound
  gate slice. It does not prove visual/manual Blade parity or ASP.NET backend
  compatibility; route-level active-club proof and broker workflow listing
  request proof are documented in later focused slices.

Latest focused verification on 2026-07-09 for the active-club evidence route
gate slice:

- Laravel source checked: `AlphaController::clubs()` aborts with `404` after
  auth when the tenant has no active `vol_organizations` row with
  `org_type = 'club'` and `status = 'active'`; `explore.blade.php` uses the
  same existence check before showing the Clubs card.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "clubs"` first failed because signed `/clubs` returned `200` for an empty unfiltered club list and the searched-empty case did not perform an unfiltered proof call.
- `src/routes/clubs.js` now returns the shared 404 page when the unfiltered
  Laravel-backed club list is empty. When a search query returns no rows, it
  performs a minimal unfiltered `getClubs({ per_page: 1 })` probe and renders
  the empty search page only if that probe proves active clubs exist.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "clubs"` passed 4 selected tests.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand` passed 473/473 tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed 12/12 suites and 837/837 tests.
- A current-code temporary Web UK process on `http://127.0.0.1:6613` with
  `TENANT_ID=2`, Laravel `http://127.0.0.1:8088`, and
  `SMOKE_GATED_PAGE_PATHS=/clubs:404` passed the focused Laravel runtime smoke.
  The local `hour-timebank` fixture has no active clubs, so the expected live
  result is `404`. A stale `/clubs=>Clubs` body-text smoke was intentionally
  replaced for this fixture.
- This certifies the route-level no-active-club behavior. Explore-card
  active-club sourcing is certified in the following slice; visual/manual Blade
  parity plus ASP.NET backend switching remain open.

Latest focused verification on 2026-07-09 for the Explore active-club card
evidence slice:

- Laravel source checked: `accessible-frontend/views/explore.blade.php` shows
  the Clubs card only when `Route::has('govuk-alpha.clubs.index')` and a
  tenant-scoped active `vol_organizations` club exists; it catches failures and
  hides the card.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "Explore"` first failed because Web UK did not call `getClubs({ per_page: 1 })` and did not render Clubs from live evidence.
- `src/routes/explore.js` now probes Laravel clubs with
  `getClubs({ per_page: 1 })` after the signed Explore payload loads, then
  rebuilds only the page `alphaExploreLinks` locals with `has_clubs` set from
  that live result. Probe failures hide Clubs, matching the Blade guarded DB
  lookup.
- The focused Explore test now proves both flat `/explore` and
  `/acme/accessible/explore` render the Clubs card only from live club
  evidence, with the mounted link staying under
  `/acme/accessible/clubs`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "Explore"` passed 3 selected tests after the implementation.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand` passed 474/474 tests.
- `npm --prefix apps/web-uk run lint` passed with no warnings.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, 0 extra Web UK routes, and 3 ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed 12/12 suites and 838/838 tests. The existing Node `DEP0044 util.isArray` deprecation warning was emitted after completion.
- A scoped Laravel runtime smoke against a temporary current-checkout Web UK
  process on `http://127.0.0.1:6625`, Laravel `http://127.0.0.1:8088`, and
  `TENANT_ID=2` passed 12/12 checks, including signed `/explore` and
  `/explore=>Explore`.

Latest focused verification on 2026-07-09 for the message translation policy
slice:

- Laravel source checked:
  `MessagesParity::messagesTranslateMessage()` and
  `AlphaController::translateFederationMessage()` both gate translation on
  `TenantContext::hasFeature('message_translation')`, and the federation
  conversation renderer passes `translateEnabled` from the same tenant feature.
- Web UK direct message translation now checks
  `req.accessibleRouting.tenant.features.message_translation` before calling
  Laravel message APIs and redirects disabled tenants to
  `/messages/{userId}?status=translate-unavailable#m-{messageId}`.
- Web UK federation conversation rendering hides per-message translate forms
  when tenant `message_translation` is disabled, and federation translate POSTs
  redirect disabled tenants to the Laravel-style
  `/federation/messages/conversation/{partnerId}?tenant_id={tenantId}&status=translate-unavailable#message-{id}`.
- TDD proof: the focused tests first failed because Web UK rendered the
  federation translate form and redirected direct translation as
  `translate-done`; after the route changes the same selected tests passed.
- Verification passed:
  `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "message translation is disabled|hides federation message translation"`,
  the enabled-path alias/conversation selection, full
  `shared-accessible-shell.test.js`, `npm --prefix apps/web-uk run lint`,
  `npm --prefix apps/web-uk run route:matrix`, and full
  `npm --prefix apps/web-uk test -- --runInBand`.
- Targeted Laravel runtime smoke passed for signed `/federation/messages` at
  `WEB_UK_BASE_URL=http://127.0.0.1:6622` and signed `/messages/77` at
  `WEB_UK_BASE_URL=http://127.0.0.1:6623`, both against
  `LARAVEL_BASE_URL=http://127.0.0.1:8088` with `TENANT_ID=2`.

Latest focused verification on 2026-07-09 for the AI chat and matches
template-helper slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "AI chat and matches"` first failed on raw `/chat` links/forms, then passed after converting AI chat and matches templates to `urlFor()`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "matches|AI chat"` passed 7 selected signed render/redirect tests.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed 13/13 checks, including signed `/chat=>AI assistant`, `/matches=>Your matches`, and `/matches/board=>Your matches`.
- `rg -n --glob '*.njk' 'href="/(chat|explore|matches|listings|groups|events)|action="/(chat|matches)' apps/web-uk/src/views/ai-chat apps/web-uk/src/views/matches` returned no matches.
- This is focused source-level and runtime render evidence for the AI chat/matches slice only. It does not certify full visual Blade parity, localization, recommendation persistence depth, or ASP.NET backend switching.

Latest focused verification on 2026-07-09 for the shared pagination partial
template-helper slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "shared pagination"` first failed on the raw `baseUrl: "/members"` default in `src/views/partials/pagination.njk`, then passed after the default moved to `urlFor('/members')`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 42/42 source tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "signed Laravel members index"` passed the focused members render smoke, including a `GET /members` 200 response.
- `npm --prefix apps/web-uk test -- --runInBand` passed 757/757 tests across 11 suites.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed for `/members` body text containing `Community members`, with all other smoke buckets disabled.
- This is shared partial source and focused members runtime evidence only. It does not newly certify visual pagination parity, every pagination caller, localization, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the shared empty-state and
breadcrumb partial template-helper slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "shared empty-state"` first failed on raw empty-state/breadcrumb example links and direct `emptyState.action.href` rendering, then passed after the shared partials moved to `urlFor(...)`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "prefixes shared empty-state"` passed, proving `/acme/accessible/members?search=zzz` renders the empty-state action link as `href="/acme/accessible/members"` and not `href="/members"`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 43/43 source tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- `npm --prefix apps/web-uk test -- --runInBand` passed 759/759 tests across 11 suites.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed for `/members` body text containing `Community members`, with all other smoke buckets disabled.
- This is shared partial source, focused tenant-prefixed render, and scoped `/members` runtime evidence only. It does not newly certify visual empty-state parity, every empty-state caller, localization, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the AI chat route-redirect helper
slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "AI chat route redirects"` first failed on raw `res.redirect('/login?...')` and `res.redirect('/chat?...')` calls in `src/routes/ai-chat.js`, then passed after those redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "empty Laravel AI chat redirects inside"` passed, proving an empty signed POST to `/acme/accessible/chat` redirects to `/acme/accessible/chat?status=empty`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 44/44 source tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "AI chat"` passed 5/5 focused AI chat render/redirect/submission tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- `npm --prefix apps/web-uk test -- --runInBand` passed 761/761 tests across 11 suites.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed for `/chat` body text containing `AI assistant`, with all other smoke buckets disabled.
- This is focused route-redirect evidence for AI chat only. It does not newly certify full AI assistant persistence, visual Blade parity, localization, every redirect family, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the matches route-redirect
slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "matches route redirects"` first failed on raw `res.redirect('/matches?...')` and board-dismiss `/matches/board?...` calls in `src/routes/matches.js`, then passed after both redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "match dismiss redirects inside"` passed, proving a signed POST to `/acme/accessible/matches/77/dismiss` redirects to `/acme/accessible/matches?status=match-dismissed`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 45/45 source tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "matches"` passed 3/3 focused matches render/submission tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- `npm --prefix apps/web-uk test -- --runInBand` passed 763/763 tests across 11 suites.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed 12/12 checks, including signed `/matches` and `/matches/board` body text containing `Your matches`.
- This is focused route-redirect evidence for the matches dismiss family only. It does not newly certify full recommendation persistence, visual Blade parity, localization, every route redirect family, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the auth route-redirect
slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "auth route redirects"` first failed on raw auth `res.redirect('/login...')`, `/dashboard`, and password redirects in `src/routes/auth.js`, then passed after those redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "auth POST redirects inside"` passed, proving a successful POST to `/acme/accessible/login` redirects to `/acme/accessible/dashboard`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 46/46 source tests.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"` passed 6/6 selected shared-mount tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- `npm --prefix apps/web-uk test -- --runInBand` passed 765/765 tests across 11 suites, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed 13/13 checks, including login POST redirecting to `/dashboard`, logout redirecting to `/login`, and `/login`, `/login/forgot-password`, and `/password/reset?token=reset-token` body markers.
- This is focused auth route-redirect evidence only. It does not newly certify full Laravel login credential viability, two-factor persistence, registration delivery, password reset emails, visual Blade parity, localization, every route redirect family, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the server-level route-redirect
slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "server-level redirects"` first failed on raw `src/server.js` redirects for `/cookies`, `/login`, `/organisations`, `invalidRedirect`, and `failedRedirect`, then passed after deterministic targets moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "server-level"` passed 2/2 selected shared-mount tests, proving `/acme/accessible/cookie-consent` redirects to `/acme/accessible/cookies?status=saved` and `/acme/accessible/organisations/42` redirects to `/acme/accessible/login?status=auth-required`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js` passed 47/47 source tests.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"` passed 8/8 selected shared-mount tests.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel accessible routes matched, 0 missing, and no unexpected extras.
- `npm --prefix apps/web-uk test -- --runInBand` passed 768/768 tests across 11 suites, with the existing Node `DEP0044 util.isArray` deprecation warning.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed 12/12 checks, including `/organisations/42` redirecting to `/login?status=auth-required`, cookie consent/settings redirects, and `/cookies=>Cookies`.
- This is focused server-level redirect evidence only. It does not newly certify every route redirect family, user-return URL prefixing, visual Blade parity, localization, full organisation workflow persistence, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-09 for the Explore tenant-gated card and
live-content link slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/accessible-shell.test.js -t "Explore card feature gates"` first failed because Web UK removed the Search card when `features.search` was false, while Laravel Blade keeps the Explore Search card visible. It passed after removing that card-level feature gate.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/accessible-shell.test.js` passed: 4 tests.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "Explore live-content|search forms|event index"` passed: 3 selected tests.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "Explore hub"` passed: 1 selected test.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with only `/explore=>Explore` in `SMOKE_BODY_TEXT_PAGE_PATHS` and large route lists disabled passed 11/11 checks against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.
- The slice pins Blade Explore card gates from tenant bootstrap: Exchanges require `listings` plus broker `exchange_workflow`, AI assistant/Polls/Groups/Goals/Organisations/Blog/Resources/Marketplace/Jobs/Courses/Podcasts/Coupons/Premium/Ideation/Federation use their Blade feature keys, Search and Skills remain card-visible, and Clubs were initially held behind an explicit tenant `has_clubs` flag before the later Explore active-club evidence slice added the Laravel-backed probe.
- This also routes Explore listing/event live-content links and view-all links through `urlFor()` for shared mounts and custom-domain roots. It does not certify live disabled-tenant broker workflow data, visual/manual Blade parity, localization, or ASP.NET backend compatibility.

Latest focused verification on 2026-07-10 for the broker exchange workflow
listing-request gate:

- Laravel source check: `AlphaController::requestExchange()` and
  `storeExchangeRequest()` call `BrokerControlConfigService::isExchangeWorkflowEnabled()`
  before rendering the request form or creating an exchange, redirecting to the
  listing detail with `status=exchange-disabled` when disabled.
- Web UK now calls Laravel `/api/v2/exchanges/config` before signed
  `/listings/{id}/exchange-request` GET rendering or POST create. If Laravel
  explicitly returns `exchange_workflow_enabled: false`, Web UK redirects to
  `/listings/{id}?status=exchange-disabled` and avoids the listing lookup,
  wallet lookup, and exchange-create call.
- Focused Jest first failed because GET rendered `200` and POST redirected to
  `/exchanges/88?status=exchange-created`; after the route change the focused
  run passed 4/4 matching tests:
  `npm test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "broker exchange workflow is disabled|listing exchange request|listing action aliases" --runInBand`.
- This is focused route/source proof. A live Laravel fixture with broker
  exchange workflow disabled and ASP.NET backend switching certification remain
  unproven.

Latest focused verification on 2026-07-10 for listing exchange-request
tenant-aware source links:

- Laravel source check: `routes/govuk-alpha.php` registers the exchange-request
  flow as `GET/POST /listings/{listingId}/exchange-request` inside the
  accessible route set.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "listing exchange request controls"` first failed on raw `/listings` `href` and `action` source targets in `src/views/listings/exchange-request.njk`, then passed after the back link and form action moved through `urlFor()`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "renders the Laravel-backed listing exchange request form"` passed and now asserts the tenant-mounted render keeps the back link and no-JS form action under `/acme/accessible/listings/42...`.
- This is source/render tenant-routing proof only. It does not newly certify a
  live Laravel tenant with broker exchange workflow disabled, visual/manual
  Blade parity, localization, or ASP.NET backend switching.

Latest focused verification on 2026-07-10 for listing analytics/comments/report
tenant-aware source links:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "listing analytics, comments, and report" --runInBand` passed after first failing on raw `/listings` `href` and `action` source targets.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Laravel-backed listing report|owner listing analytics|listing comments|submits Laravel listing comment|submits Laravel listing save|listing report"` passed the focused report, analytics, and comments render cases.
- A scoped Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6621`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed `13/13` checks: base Laravel/API, health, cookie/login/account/logout checks, body markers for `/listings/42/report` and `/listings/42/comments`, and the expected signed `403` for `/listings/42/analytics`.
- This is source/render/runtime proof for this auxiliary slice only. Visual/manual
  Blade parity, broader listing workflow persistence, localization, and ASP.NET
  backend switching remain unproven.

Latest focused verification on 2026-07-09 for the shared-root tenant chooser
ordering slice:

- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "orders shared-root tenant chooser"` first failed because Web UK preserved Laravel API response order (`Zebra Timebank` before `Acme Timebank`) while Laravel Blade orders chooser tenants by `name`, then passed after `normalizeTenantChooserCommunities()` sorted by display name.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "tenant chooser|shared tenant accessible mount|custom accessible domains"` passed: 13 selected tests.

Latest focused verification on 2026-07-09 for the knowledge-base
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "knowledge-base"` first failed on raw `/kb` links/actions and the raw `nextHref` link, then passed after the real `src/views/kb` templates were converted through `urlFor()`.
- `Select-String -Path apps\web-uk\src\views\kb\*.njk -SimpleMatch -Pattern 'href="/kb','action="/kb','href="{{ nextHref }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed: 31 tests.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "knowledge base"` passed: 2 selected tests.

Latest focused verification on 2026-07-09 for the dashboard template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "member dashboard"` first failed on raw dashboard `/onboarding`, `/exchanges`, `/listings`, `/events`, `/profile`, `/feed`, `/messages`, `/members`, and `/volunteering` links, then passed after `src/views/dashboard/index.njk` converted those local links through `urlFor()`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "member dashboard"` passed: 1 selected test.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with `SMOKE_MODULE_PAGE_PATHS=/dashboard`, `SMOKE_BODY_TEXT_PAGE_PATHS=/dashboard=>Quick links`, and unrelated default sweep env vars set to `none` passed `12/12` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.

Latest focused verification on 2026-07-09 for the goals template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "goals browse"` first failed on raw `/goals` links/actions, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\goals\*.njk -SimpleMatch -Pattern 'href="/goals','action="/goals','href: "/goals','action: "/goals','href="{{ nextHref }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "goal"` passed: 13 selected tests across goals browse, templates, discover, buddying, edit, check-in, reminder, buddy-action, history, insights, social, and POST action coverage.

Latest focused verification on 2026-07-09 for the goals route-redirect slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "goals route redirects|goal action redirects inside"` first failed on raw `res.redirect(loginRedirect())` and raw `/goals` redirect targets in `src/routes/goals.js`, then passed after those redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- The same focused shared-mount test proves create, buddy-nudge, comment, and unsigned progress POST redirects remain under `/acme/accessible`.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` for goals pages first exposed a stale `/goals/162/checkin=>Check in` marker; Laravel's Blade string is `Log a check-in`, and the rerun with `/goals/162/checkin=>Log a check-in` passed all 30 focused checks against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.

Latest focused verification on 2026-07-09 for the exchanges template-helper
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "exchange list"` first failed on raw `/exchanges` links/actions, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\exchanges\*.njk -SimpleMatch -Pattern 'href="/exchanges','action="/exchanges','href="/listings','href="/messages'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "exchange"` passed: 9 selected exchange/group-exchange/listing-request tests.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with `SMOKE_MODULE_PAGE_PATHS=/exchanges`, `SMOKE_BODY_TEXT_PAGE_PATHS=/exchanges=>Exchanges`, `TENANT_ID=2`, and unrelated default sweep env vars set to `none` passed `12/12` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.

Latest focused verification on 2026-07-09 for the public coupons
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public coupon"` first failed on a raw `/coupons/{{ coupon.id }}` link, then passed after conversion.
- `Select-String -Path apps\web-uk\src\views\coupons\*.njk -SimpleMatch -Pattern 'href="/coupons','action="/coupons','href: "/coupons'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "coupon"` passed: 4 selected public-coupon and marketplace-coupon tests.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with `SMOKE_GATED_PAGE_PATHS=/coupons,/coupons/1`, `TENANT_ID=2`, and unrelated default sweep env vars set to `none` passed `12/12` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`, proving the current local Laravel fixture returns the expected `403` feature gate for public coupon pages. This does not certify rendered coupon body parity in a tenant with merchant coupons enabled.

Latest focused verification on 2026-07-09 for the public coupons
route-redirect slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "public coupon route redirects|signed-out visitors away from the Laravel coupons"` first failed because `src/routes/coupons.js` still emitted direct `res.redirect(loginRedirect())`, then passed after routing coupon auth handoffs through `res.locals.urlFor`.
- Shared-mount behavior coverage proves unsigned `/acme/accessible/coupons` and `/acme/accessible/coupons/{id}` requests redirect to `/acme/accessible/login?status=auth-required`.

Latest focused verification on 2026-07-09 for the activity route-redirect
slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "activity route redirects|Laravel-style activity"` first failed because `src/routes/activity.js` still emitted direct `res.redirect(loginRedirect())`, then passed after routing activity auth handoffs through `res.locals.urlFor`.
- Shared-mount behavior coverage proves unsigned `/acme/accessible/activity` and `/acme/accessible/activity/insights` requests redirect to `/acme/accessible/login?status=auth-required`.

Latest focused verification on 2026-07-09 for the group-exchange GET
route-redirect slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group exchange GET redirects"` first failed because `src/routes/group-exchanges.js` had no `redirectTo(res, pathname)` helper and still emitted direct `res.redirect(loginRedirect())`, then passed after routing unsigned GET auth handoffs through `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "signed-out visitors away from Laravel group exchange GET pages"` passed, proving flat signed-out redirects still target `/login?status=auth-required` while mounted `/acme/accessible/group-exchanges`, `/acme/accessible/group-exchanges/new`, and `/acme/accessible/group-exchanges/7` redirect to `/acme/accessible/login?status=auth-required` before Laravel APIs are called.

Latest focused verification on 2026-07-09 for the federation hub
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "federation hub"` first failed on raw `/federation` links in `src/views/federation/index.njk`, then passed after the hub navigation, opt-in/opt-out CTAs, partner preview links, view-all link, and quick links were routed through `urlFor()`.
- `Select-String -Path apps\web-uk\src\views\federation\index.njk -SimpleMatch -Pattern 'href="/federation','action="/federation','href="{{ partner.href }}'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Federation hub"` passed: 2 selected tests.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with `SMOKE_MODULE_PAGE_PATHS=/federation`, `SMOKE_BODY_TEXT_PAGE_PATHS=/federation=>Federation`, `TENANT_ID=2`, and unrelated default sweep env vars set to `none` passed `12/12` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.

Latest focused verification on 2026-07-09 for the federation onboarding
template-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "federation onboarding"` first failed on raw `/federation` links/actions in `src/views/federation/onboarding.njk`, then passed after the wizard back link, service navigation, POST actions, step-back links, and do-this-later links were routed through `urlFor()`.
- `Select-String -Path apps\web-uk\src\views\federation\onboarding.njk -SimpleMatch -Pattern 'href="/federation','action="/federation'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "Federation onboarding"` passed: 1 selected test.
- A scoped `npm --prefix apps/web-uk run smoke:laravel` with `SMOKE_MODULE_PAGE_PATHS=/federation/onboarding`, `SMOKE_BODY_TEXT_PAGE_PATHS=/federation/onboarding=>Welcome to the community network`, `TENANT_ID=2`, and unrelated default sweep env vars set to `none` passed `12/12` checks against `WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088`.

Latest focused verification on 2026-07-10 for federation onboarding state
parity:

- `tests/federation-onboarding-session.test.js` passes 6/6 focused tests for
  mounted CTA traversal, non-default privacy and communication choices, back
  navigation, confirm-only finalization, failure retention/retry, success-only
  clearing, unknown-step clamping, opted-in redirects, and tenant isolation.
- The pre-existing legacy direct-confirm compatibility test still passes, and
  the combined Jest run passed 15 suites and 903/903 tests; `npm run lint` and
  the assigned-file diff check also passed.
- A current-checkout ephemeral Web UK process at
  `http://127.0.0.1:58710` traversed the live local Laravel-backed hub,
  privacy, communication, and confirm forms, posted only `step=confirm`, then
  read `/api/v2/federation/settings` back from Laravel
  `http://127.0.0.1:8088` and verified every selected and unselected value.
  The disposable E2E account's original federation settings were restored in
  the smoke script's `finally` block.
- That proof is now repeatable as `npm run smoke:federation:local`. A clean
  rerun at `http://127.0.0.1:62351` passed the CTA, privacy retention,
  communication retention, confirm-only submit, Laravel settings read-back,
  and verified fixture-restoration checks.

Latest focused verification on 2026-07-09 for the custom-domain
canonicalization tenant-routing slice:

- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "canonicalizes tenant-prefixed accessible paths"` first failed because `Host: acme-accessible.test` with `/acme/alpha/login?status=auth-required` redirected to `/acme/accessible/login?status=auth-required`; it passed after host-resolved matching tenant prefixes were canonicalized to slugless custom-domain paths.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "tenant chooser|shared tenant accessible mount|custom accessible domains"` passed: 14 selected tests.

Latest focused verification on 2026-07-10 for the Laravel
`domain` versus `accessible_domain` routing split:

- Laravel source check: `EnsureAccessibleCustomDomain` gates slugless accessible
  host routes with `TenantContext::isAccessibleDomain()`, and local Laravel
  returned `404` for `Host: project-nexus.ie` plus `/login` while
  `/api/v2/tenant/bootstrap` still resolved the master tenant by `domain`.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "does not serve slugless accessible pages on ordinary tenant domains"` first failed because Web UK served `Host: project-nexus.ie` plus `/login` as `200`; it passed after non-root ordinary `domain` hosts were routed into the normal 404 pipeline unless the host matches `accessible_domain`.
- `npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand` passed
  all 45 route tests, preserving root network pages, true accessible-domain
  slugless routing, accessible-domain canonicalisation, and parent-domain child
  routes.

Latest consolidation verification on 2026-07-08:

- `npm --prefix apps/web-uk run lint` passed with no warnings.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites, 713 tests.
- `npm --prefix apps/web-uk run route:matrix` passed with 608/608 Laravel
  accessible routes matched and 0 missing.
- Chunked `npm --prefix apps/web-uk run smoke:laravel` passed against local
  Laravel `http://127.0.0.1:8088` and a temporary Web UK process at
  `WEB_UK_BASE_URL=http://127.0.0.1:6310`, started with
  `ACCESSIBLE_BACKEND_TARGET=laravel`, `TENANT_ID=2`, and
  `SMOKE_TIMEOUT_MS=240000`. Evidence covered the base auth/cookie/gated/
  redirect/content checks, 279 module-page checks across
  `SMOKE_MODULE_PAGE_CHUNK=1/8` through `8/8`, and 283 body-text checks across
  `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8` through `8/8`. The unchunked full command is
  still too slow for a single shell run.

Latest local verification after the public/auth/support source-helper slice:

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "group exchange tabs"` first failed on raw `/group-exchanges` links/actions, then passed after the template conversion.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "group exchange"` passed `3/3` selected tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "direct and group message"` first failed on raw `/messages`, `/members`, and `/connections` links/actions, then passed after the template conversion.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "message"` passed `5/5` selected message tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "wallet links"` first failed on raw `/wallet` links/actions, then passed after the template conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "wallet action redirects"` first failed on raw wallet route redirects, then passed after transfer and donation status redirects moved through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `Select-String -Path apps\web-uk\src\views\wallet\*.njk -Pattern 'href="/wallet','action="/wallet','href: "/wallet'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "wallet"` passed `9/9` selected wallet tests, including shared-mount donation validation redirect coverage for `/acme/accessible/wallet/donate`.
- A scoped live Laravel runtime smoke against Web UK `http://127.0.0.1:5180` and Laravel `http://127.0.0.1:8088` passed `12/12` checks, including `/wallet=>Wallet` and `/wallet/manage=>Manage credits`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "legacy poll vote redirects" --runInBand` first failed on raw ``res.redirect(`/polls/${id}`)``, then passed after `src/routes/polls.js` moved legacy vote success and non-401 API-error redirects through `redirectTo(res, ...)` and `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "poll" --runInBand` passed `13/13` selected poll tests.
- `npm --prefix apps/web-uk run lint`, `npm --prefix apps/web-uk run route:matrix`, and `npm --prefix apps/web-uk test -- --runInBand` passed after the legacy poll redirect cleanup; the full Jest suite passed `862/862` tests across `12` suites with the existing Node `DEP0044 util.isArray` warning.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public auth and support"` first failed on raw `/contact` and `/login` controls, then passed after the template conversion.
- `Select-String` over `contact.njk`, `cookie-settings.njk`, `forgot-password.njk`, `login.njk`, `register.njk`, `report-problem.njk`, and `reset-password.njk` for raw local public/auth/support `href` and `action` targets returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "login|register|password|cookie|contact|report"` passed `25/25` selected tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed `17/17`.
- `npm --prefix apps/web-uk run route:matrix` passed with `608/608` Laravel accessible routes matched, `0` missing, `0` extra, and `3` ignored infrastructure routes.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 10 suites, `722/722` tests. The existing Node `DEP0044 util.isArray` deprecation warning was emitted after the suite completed.

Latest local verification after the public-info/legal/support/cookie
source-helper slice:

- `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "public info, legal, support" --runInBand` passed `1/1` selected test after the earlier red run caught raw `/dashboard`, `/register`, and related public links.
- `Select-String` over `public-info/about.njk`, `public-info/email-verify.njk`, `public-info/features.njk`, `public-info/guide.njk`, `support/help.njk`, `support/trust-safety.njk`, `legal/accessibility.njk`, `legal/document.njk`, `partials/cookie-banner.njk`, and `privacy.njk` for raw local public/legal/support/cookie `href` and `action` targets returned no matches.
- `npm --prefix apps/web-uk test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "login|register|password|cookie|contact|report|legal|guide|features|about|email|help|trust" --runInBand` passed `90/90` selected tests. The existing Node `DEP0044 util.isArray` deprecation warning was emitted after the suite completed.
- `npm --prefix apps/web-uk run lint` passed.
- `npm --prefix apps/web-uk run route:matrix` passed with `608/608` Laravel accessible routes matched, `0` missing, `0` extra, and `3` ignored infrastructure routes.
- `npm --prefix apps/web-uk test -- --runInBand` passed: 12 suites, `861/861` tests. The existing Node `DEP0044 util.isArray` deprecation warning was emitted after the suite completed.
- A scoped live Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6657`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed `21/21` checks covering base auth/cookie/logout plus `/about`, `/guide`, `/features`, `/help`, `/trust-and-safety`, `/legal`, `/accessibility`, `/legal/terms`, `/legal/privacy`, `/cookies`, and `/verify-email` body markers.

- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "organisation directory"` first failed on raw `/organisations` and `/volunteering` links/actions, then passed after the template conversion.
- `Select-String` over `organisation-detail.njk`, `organisations.njk`, `organisations-apply.njk`, `organisations-browse.njk`, `organisations-jobs.njk`, `organisations-manage.njk`, and `organisations-register.njk` for raw local organisation/volunteering/job `href` and `action` targets returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "organisations"` passed `6/6` selected tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "public volunteering"` first failed on raw `/volunteering` and `/organisations` links/actions in `volunteering.njk` and `volunteer-opportunity.njk`, then passed after conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "volunteering action redirects"` first failed on flat `res.redirect('/volunteering...')` and `res.redirect(loginRedirect())` calls, then passed after `src/routes/volunteering-actions.js` routed action and validation exits through `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "volunteering"` passed `26/26` selected tests after the public volunteering source and route-redirect conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "blog index"` first failed on raw `/blog` links/actions, then passed after the template conversion.
- `Select-String -Path apps\web-uk\src\views\blog\*.njk -Pattern 'href="/(blog|members)','action="/blog'` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "blog"` passed `9/9` selected blog tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "course browse"` first failed on raw `/courses` links/actions, then passed after the template conversion.
- `rg -n 'href="/courses|action="/courses|action="\{\{ formAction \}\}' apps/web-uk/src/views/courses` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "course"` passed `4/4` selected course tests.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "listing index"` first failed on raw `/listings` links/actions, then passed after the listing index/form conversion.
- `rg -n 'href="/listings|action="/listings|href: "/listings' apps/web-uk/src/views/listings/index.njk apps/web-uk/src/views/listings/form.njk` returned no matches.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "signed listing index|owner listing delete"` passed `2/2` selected listing tests.
- A focused Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6463`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed base API/health, cookie-consent, login/account/logout checks plus `body-text-page-listings-contains-create-listing` for signed `/listings`.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "listing route redirects"` first failed on raw `res.redirect('/listings...')` calls in `src/routes/listings.js`, then passed after those route exits moved through `res.locals.urlFor`.
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "listing"` passed `14/14` selected listing and marketplace-listing tests after the listing route redirect conversion.
- `npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath` passed `86/86` source-helper tests after the listing route redirect conversion.
- A targeted Laravel runtime smoke against temporary Web UK `http://127.0.0.1:6611`, Laravel `http://127.0.0.1:8088`, and `TENANT_ID=2` passed `11/11` checks: Laravel API reachability, Web UK health, account auth redirect, cookie-consent POSTs, login/account/logout, and signed `/listings` containing `Listings`.

Latest focused host-domain network landing slice: Web UK now treats Laravel
`domain` matches as custom domain roots alongside `accessible_domain`. Root `/`
on `timebank.global` renders the Timebank Global cluster landing with Laravel
SEO heading `Exchange Skills Across Borders`, intro copy, and
`tenant_switcher` communities. Same-host child entries such as Hour Timebank
become relative links like `/hour-timebank`, while external entries such as
`timebanks.us` remain absolute. Root `/` on the master tenant's configured
`project-nexus.ie` domain renders the master network landing instead of the
shared chooser. `X-Forwarded-Host` is accepted before the socket host for proxy
custom-domain routing, and host-scoped Laravel API calls send `Origin` as well
as `Host` so Laravel's bootstrap fallback can resolve configured custom
domains. Verification for this slice: focused route and API tests passed, full
Web UK Jest passed `706/706`, lint passed, and the generated route matrix still
reported `608/608` Laravel accessible routes matched, `0` missing, `0` extra
Web UK routes, and `3` ignored infrastructure routes. Direct live Laravel
bootstrap calls and a direct Web UK tenant-routing middleware harness resolved
`timebank.global` and `project-nexus.ie` correctly. The first full Web UK
process probe rendered the shared chooser because host-scoped Laravel API calls
were still carrying the process default `X-Tenant-ID=2`, which made Laravel
return `hour-timebank` instead of `timebank-global`. The API client now omits
`X-Tenant-ID` when Host/Origin tenant context is present, and the focused
Laravel smoke harness passed against temporary Web UK
`WEB_UK_BASE_URL=http://127.0.0.1:6426`, Laravel
`http://127.0.0.1:8088`, `TENANT_ID=2`, and
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/=>Exchange Skills Across Borders`.
The emitted check was `tenant-domain-page-timebank-global-home-renders`, with
status `200` and no legacy accessible slug links.

Latest focused template-helper conversion slices: `src/views/events/detail.njk`
now uses `urlFor()` for local event, group, and member links/actions instead of
literal root-relative `href`/`action` strings. This covers the event detail
breadcrumbs, summary-list group/organiser links, report return URL, RSVP forms,
admin edit/cancel/delete controls, and attendee links so shared-mount source is
less dependent on response-time rewriting. `src/views/account.njk` now also
uses `urlFor()` for account card links supplied by `accountLinks` and for the
CSRF-protected `/logout` form action. `src/views/activity/index.njk` and
`src/views/activity/insights.njk` now route the detailed-insights link and
back-to-activity links through `urlFor()`. `src/views/achievements/index.njk`,
`shop.njk`, `collections.njk`, `engagement.njk`, `showcase.njk`, and
`badge.njk` now route gamification tabs, back links, daily reward/challenge/
purchase/showcase forms, badge collection links, and view-all links through
`urlFor()`. `src/views/leaderboard/*.njk` and
`src/views/nexus-score/*.njk` now route leaderboard tabs, back links, filter
forms, load-more links, NEXUS tier links, and member profile links through
`urlFor()`. `src/views/profile/{index,settings,two-factor,blocked,delete}.njk`
and `src/views/settings/{appearance,availability,data-rights,insurance,linked-accounts}.njk`
now route profile summary links, settings card links, profile/security/privacy
forms, two-step verification actions, blocked member unblock forms,
delete-account controls, and settings form actions through `urlFor()`.
`src/views/groups/detail.njk`, `src/views/listings/detail.njk`,
`src/views/members/profile.njk`, and `src/views/partials/report-link.njk` now
route group/listing/member detail breadcrumbs and actions, report return
targets, listing report links, member connection controls, and member review
actions through `urlFor()`.
`src/views/organisation-detail.njk`, `organisations.njk`,
`organisations-apply.njk`, `organisations-browse.njk`,
`organisations-jobs.njk`, `organisations-manage.njk`, and
`organisations-register.njk` now route organisation directory, browse, detail,
jobs, manage, register, volunteer opportunity, and apply controls through
`urlFor()`.
`src/views/blog/index.njk`, `detail.njk`, `comments.njk`, and `likers.njk`
now route blog search, post links, pagination, back links, author/member links,
like/reaction/comment forms, discussion links, liker links, and show-more links
through `urlFor()`.
`src/views/courses/_nav.njk`, `index.njk`, `detail.njk`, `learn.njk`,
`my-learning.njk`, `instructor.njk`, `form.njk`, `analytics.njk`, and
`grading.njk` now route course tabs, browse/search, course and prerequisite
links, certificate and learning links, review/enrolment/quiz/progress forms,
instructor create/edit analytics links, builder section/lesson forms, publish/
unpublish/delete actions, and grading forms through `urlFor()`.
`src/views/marketplace/offers.njk` and `src/views/marketplace/manage.njk` now
route offer tabs, dynamic listing links, accept/decline/withdraw forms,
my-listings tabs, create/view/edit links, and renew/delete forms through
`urlFor()`.
`src/views/marketplace/_nav.njk`, `_listing-card.njk`, `index.njk`,
`listing-list.njk`, `detail.njk`, `buy.njk`, `offer.njk`, `report.njk`,
`form.njk`, `search.njk`, `seller.njk`, and `onboarding.njk` now route browse
tabs, listing/card/category links, search and category filter forms, listing
detail actions, buyer buy/offer/report forms, listing create/edit form actions,
seller profile links, and seller onboarding controls through `urlFor()`.
`src/views/marketplace/coupons.njk`, `coupon-form.njk`, `orders.njk`,
`slots.njk`, `slot-form.njk`, and `_slot-form.njk` now route coupon links and
forms, order tab links, order ship/confirm/pay/cancel/rate forms, pickup-slot
scan/edit/delete forms, and shared slot form actions through `urlFor()`.
`src/routes/marketplace-actions.js` now routes auth-required, validation,
success, and API-failure exits through a `res.locals.urlFor` helper so listing,
offer, report, order, onboarding, pickup-slot, and coupon POST outcomes stay
inside shared tenant mounts and custom-domain child paths without relying only
on the response rewriter.
`src/views/jobs/*.njk` now route jobs tabs, browse filters, saved and
application links, owner-management controls, alerts, responses, detail save/
apply/renew forms, employer-brand links, talent search/profile links, CSV/CV
downloads, and variable pagination/form targets through `urlFor()`.
`src/views/federation/member.njk` now routes the federation member back link,
service-navigation links, opt-in CTA, connection/message forms, and transfer
CTA through `urlFor()`.
`src/views/connections/index.njk` and `network.njk` now route the connections
tabs, pending-request link, member links, action forms, empty-state member CTAs,
pagination, network search form, tab links, load-more links, route-provided card
links/actions, and back link through `urlFor()`.
Source-level regressions in `tests/template-source.test.js` guard these pages
from drifting back to literal root-relative local links/forms.
Verification for the account, activity, achievements, leaderboard/NEXUS,
detail/report, marketplace, federation member, and connections slices included
deliberate failing source-test runs before the template fixes,
then:
`npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath`
passed `9/9`,
`npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "account hub"`
passed `2/2` selected account tests, and
`npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "activity"`
passed `4/4` selected activity tests. The focused achievements/gamification
render check passed `15/15` selected tests. The focused leaderboard/NEXUS score
render check passed `7/7` selected tests. The focused profile/settings render
check passed `11/11` selected tests. The focused detail/report render check
passed `10/10` selected tests. The focused marketplace offers/action render
check passed `2/2` selected tests, and the focused marketplace my-listings
render check passed `1/1` selected test. The focused marketplace browse/detail/
buyer/search/seller/onboarding and coupon/order/pickup-slot render checks passed
`26/26` selected marketplace tests. The focused federation member render check
passed `2/2` selected tests. The focused connections render check passed `5/5`
selected tests. The latest source guard passed `12/12`, and
a source scan for literal `href="/marketplace`, `action="/marketplace`,
`action="{{ action }}"`, and `href="{{ tabItem.href }}"` in
`src/views/marketplace/*.njk` returned no matches. Broad verification after
the latest connections template-helper slice also passed: full
`npm --prefix apps/web-uk test -- --runInBand` reported `717/717`,
`npm --prefix apps/web-uk run lint` passed, and
`npm --prefix apps/web-uk run route:matrix` reported `608/608` matched,
`0` missing, `0` extra Web UK routes, and `3` ignored infrastructure routes.
The earlier event-focused render
check also passed:
`npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "event"`
passed `23/23` selected tests.

Latest focused tenant home Blade-parity slice: tenant-mounted root pages now
render the Laravel Blade accessible home instead of the old generic Web UK
welcome page. Shared mount `/{tenantSlug}/accessible` fetches Laravel tenant
bootstrap data and tenant-scoped public platform stats, uses tenant
name/tagline in the layout and page content, renders the `Accessible`
heading/copy, guest or signed CTAs, the beta/accessibility panel, stat grid,
module availability cards, and service details. Dedicated accessible-domain
root `/` reuses the same tenant home while keeping links slugless. Verification
for this slice:
`npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath`
passed `33/33`, `npm --prefix apps/web-uk test -- tests/api.test.js --runInBand --runTestsByPath`
passed `157/157`, `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath`
passed `441/441`, full `npm --prefix apps/web-uk test -- --runInBand` passed
`697/697`, `npm --prefix apps/web-uk run lint` passed, and
`npm --prefix apps/web-uk run route:matrix` reported `608/608` matched, `0`
missing, `0` extra Web UK routes, and `3` ignored infrastructure routes.
Scoped live Laravel smoke against temporary Web UK
`http://127.0.0.1:6330` and Laravel `http://127.0.0.1:8088` passed with
`SMOKE_BODY_TEXT_PAGE_PATHS=/hour-timebank/accessible=>Accessible;/hour-timebank/accessible=>Connecting Communities;/hour-timebank/accessible=>What you can do`.
The smoke also reran the base Laravel API, Web UK health, cookie, login,
account, and logout checks green.

Latest focused tenant-stats slice: Web UK tenant homes now call Laravel
`/api/v2/platform/stats` with the active tenant context instead of using the
platform-wide default response. Shared-host tenant mounts pass
`X-Tenant-Slug={tenantSlug}`; dedicated accessible-domain requests pass the
normalized Host so Laravel can resolve `accessible_domain` the same way Blade
does. Focused TDD covered `getPlatformStats({ slug })`,
`getPlatformStats({ host })`, shared-mount tenant home calls, and custom-domain
tenant home calls. Full Web UK Jest passed `700/700`, lint passed, and a live
local Laravel proof against `/hour-timebank/accessible` rendered the scoped
tenant stats: `946` members, `1,988` hours exchanged, `129` listings, and `1`
community. Direct custom `accessible_domain` live smoke remains pending because
the local Laravel fixture set does not expose an `accessible_domain`; unknown
accessible hosts resolve to the master tenant.

Latest focused group/course runtime-smoke slice: a clean targeted Laravel-backed
run on 2026-07-08 against temporary Web UK `http://127.0.0.1:6350` and Laravel
`http://127.0.0.1:8091`, started with `ACCESSIBLE_BACKEND_TARGET=laravel` and
`TENANT_ID=2`, passed `16/16` checks. The run disabled unrelated page sweeps and
verified Laravel API reachability, Web UK health, unsigned `/account`, no-JS
cookie consent/settings POST flows, login/logout, module renders for
`/groups/484`, `/courses/1`, and `/courses/2`, plus body markers
`/groups/484=>Group events`, `/courses/1=>Ratings and reviews`, and
`/courses/2=>Ratings and reviews`. This certifies the current group/course
fallback slice; it does not replace the still-needed full chunked smoke refresh.

Latest focused runtime-smoke refresh slice: the chunked body-text smoke exposed
an expired-access-token redirect on signed `/feed/item/listing/{id}` after a
long live Laravel run. `feed.js` now uses the existing `withTokenRefresh`
middleware for that permalink and prefers `req.token` after refresh, so a
stale access token plus valid refresh cookie retries with the fresh token
instead of redirecting to `/login`. The runtime smoke root body marker was also
updated from the old generic welcome text to the current tenant chooser
`Choose a community`, matching the shared-root tenant chooser behavior.

Latest focused shared-root tenant chooser slice: the bare shared root `/` now
renders the Laravel accessible tenant chooser instead of the tenant home page.
It calls Laravel `/api/v2/tenants` without `include_master`, excludes the
master tenant locally as a guard, shows the Laravel copy and empty state, and
links communities to `/{tenantSlug}/accessible` so the public Web UK mount does
not expose Laravel's legacy alpha slug. Tenant-mounted
`/{tenantSlug}/accessible` roots still render the tenant home page. Verification
for this slice: `npm --prefix apps/web-uk test -- --runInBand` passed with
`683/683` tests, `npm --prefix apps/web-uk run lint` passed, and
`npm --prefix apps/web-uk run route:matrix` still reports `608/608` Laravel
accessible routes matched, `0` missing, `0` extra Web UK routes, and `3`
ignored infrastructure routes.

Latest focused custom accessible-domain root slice: Web UK now resolves
non-local Host values through Laravel `/api/v2/tenant/bootstrap`. When Laravel
returns a tenant whose `accessible_domain` matches the request host, slugless
root `/` renders the tenant home rather than the tenant chooser, keeps links
flat for the dedicated domain, and does not expose either Laravel's legacy
`/alpha` mount or Web UK's shared `/{tenantSlug}/accessible` mount. Verification
for this slice: focused `routes.test.js` passed `31/31`, focused
`api.test.js` passed `154/154`, full Web UK Jest passed `686/686`,
`npm --prefix apps/web-uk run lint` passed, and
`npm --prefix apps/web-uk run route:matrix` still reports `608/608` Laravel
accessible routes matched, `0` missing, `0` extra Web UK routes, and `3`
ignored infrastructure routes.

Latest focused parent-domain child tenant slice: Web UK now mirrors Laravel's
parent custom-domain child resolution for accessible pages. On a non-local host,
the first non-reserved path segment is resolved through
`/api/v2/tenant/bootstrap?slug={slug}`; when Laravel returns `parent_domain`
matching the request host, Web UK serves the existing flat route set below
`/{childSlug}` and rewrites rendered local links/forms and redirects to stay
inside that child path. The public Web UK route does not expose Laravel's
legacy `/alpha` mount or add `/accessible` on that parent-domain child path.
Verification for this slice: the new focused test first failed with `404`, then
passed after the middleware change; full `routes.test.js` passed `32/32`.

Latest focused tenant-domain runtime-smoke slice: the Laravel runtime smoke
harness now accepts `SMOKE_TENANT_DOMAIN_PAGE_PATHS` entries in the form
`host|/path=>Expected text`. It sends those requests to `WEB_UK_BASE_URL` with a
real HTTP `Host` header, checks the expected body text, and fails if generated
HTML leaks `/alpha` or `/accessible` links. Local Laravel bootstrap for
`hour-timebank` returns `parent_domain: timebank.global`, so a targeted live run
against temporary Web UK `http://127.0.0.1:6320` and Laravel
`http://127.0.0.1:8088` passed with
`SMOKE_TENANT_DOMAIN_PAGE_PATHS=timebank.global|/hour-timebank/login=>Sign in`.
The run emitted `tenant-domain-page-timebank-global-hour-timebank-login-renders`
with status `200`, plus green Laravel API, web health, auth, cookie, account,
and logout checks. Direct `accessible_domain` live smoke remains pending until a
Laravel fixture exposes that field locally.

Latest focused exchange route-identity slice: the previous extra local
`GET /exchanges/request/{param}` and `POST /exchanges/request/{param}` aliases
were removed. Laravel's accessible source exposes the exchange-request workflow
at `GET/POST /listings/{param}/exchange-request`, and that canonical route
remains implemented and tested in Web UK. The generated route matrix now reports
`608/608` Laravel accessible routes matched, `0` missing, `0` extra Web UK
routes, and `3` ignored infrastructure routes.

Latest focused login two-factor route slice: legacy local POST `/verify-2fa`
was removed. The 2FA challenge form now submits Laravel's canonical POST
`/login/two-factor` route, while GET `/login/two-factor` keeps the
Laravel-style expired-session redirect when no pending challenge token exists.

Latest focused reviews route slice: legacy local GET/POST
`/reviews/{id}/edit`, POST `/reviews/user/{id}`, and POST
`/reviews/listing/{id}` were removed. Member profile review forms now submit
Laravel's canonical POST `/members/{id}/review` route, and listing detail pages
no longer expose the unsupported listing-specific review form. The reviews
family now reports `7` matched routes, `0` missing routes, and `0` extra local
routes. Review route-level auth, comment, reaction, and Laravel-401 redirects
now generate tenant-aware targets through `res.locals.urlFor`.

Latest focused reports route slice: legacy local GET `/reports/new`, POST
`/reports/new`, and GET `/reports/my` were removed. Generic report links now
use Laravel-backed surfaces: listing reports point to `/listings/{id}/report`,
and other page/content reporting points to `/report-a-problem`.

Latest focused search route slice: legacy local GET `/search/suggestions` was
removed. Laravel exposes search suggestions as an API route, not as a GOV.UK
accessible frontend page/helper route; the search family now reports `0` extra
local routes.

Latest focused member route slice: legacy local POST `/members/{id}/connect`
was removed. Member index/profile connection controls now submit Laravel's
canonical POST `/members/{id}/connection` route with `action=connect`, and the
members family now reports `0` extra local routes.

Latest focused listing route slice: legacy local GET
`/listings/{id}/delete` was removed. Listing index/detail owner controls now
submit Laravel's canonical POST `/listings/{id}/delete` action directly, and
local listing dynamic routes now preserve Laravel numeric constraints.

Latest focused group route slice: legacy local GET `/groups/my`,
GET `/groups/{id}/members`, POST `/groups/{id}/members/add`,
POST `/groups/{id}/members/{memberId}/remove`,
POST `/groups/{id}/members/{memberId}/role`, and
POST `/groups/{id}/transfer-ownership` were removed. Group pages now link to
Laravel's accessible `/groups` list and `/groups/{id}/manage` member-management
surface, while canonical member actions remain on
POST `/groups/{id}/members/{memberId}`.

Latest focused event route slice: legacy local GET `/events/my` and POST
`/events/{id}/rsvp/remove` were removed. The event list no longer links to a
separate My events page, event detail pages use Laravel's canonical
`/events/{id}/rsvp` action for RSVP changes, and the generated matrix now
reports `0` extra local event routes.

Latest focused event redirect slice: event route-level auth, status, and
POST-result redirects now use `res.locals.urlFor` through a route-local helper.
Waitlist, poll, recurring-edit, translation, create, edit, cancel, delete, and
RSVP outcomes stay inside the active `/{tenantSlug}/accessible` mount or
custom-domain child path instead of emitting flat `/login` or `/events`
locations. Focused Laravel runtime smoke passed for `/events/browse`,
`/events/6`, `/events/6/polls`, and `/events/6/translate` against
`WEB_UK_BASE_URL=http://127.0.0.1:5180` and Laravel
`http://127.0.0.1:8088`.

Latest focused feed route slice: legacy local GET/POST `/feed/new`,
`/feed/{id}`, `/feed/{id}/edit`, `/feed/{id}/like`, `/feed/{id}/unlike`,
`/feed/{id}/comments`, and delete/edit/comment variants were removed. The feed
hub now points users at Laravel's accessible `/feed/posts/{id}` permalink and
typed `/feed/items/post/{id}/like` action while preserving the Laravel
`/feed/posts` multipart compose form.

Latest focused messages route slice: legacy local GET/POST `/messages/new`
without a member id was removed. Direct message entry points now use Laravel's
accessible `/messages/new/{userId}` route, and generated prep pages preserve
Laravel `whereNumber(...)` constraints so `/messages/{userId}` no longer
overmatches `/messages/new`.

Latest focused messages redirect slice: direct and group message POST outcomes
now route through the active `res.locals.urlFor` helper. This covers archive,
restore, direct edit/delete/translate/voice/send outcomes, group create/reply,
member add/remove, self-leave, and reaction redirects so shared tenant mounts
and custom-domain child paths do not rely only on response rewriting for
Laravel-style `/messages...` status locations. A scoped Laravel runtime smoke
against temporary Web UK `http://127.0.0.1:6623`, Laravel
`http://127.0.0.1:8088`, and `TENANT_ID=2` passed base auth/cookie/logout
checks plus `/messages/groups`, `/messages/groups/new`, `/messages/77`, and
`/messages/new/77` body markers.

Latest focused wallet route slice: legacy local GET-only `/wallet/transactions`,
`/wallet/transactions/{id}`, and `/wallet/transfer` pages were removed. Wallet
navigation now points to Laravel's accessible `/wallet/manage` flow while
keeping canonical POST `/wallet/transfer` and wallet export/recipient helpers.

Latest focused profile route slice: legacy local GET/POST `/profile/edit` was
removed. Profile summary change links now point to Laravel's accessible
`/profile/settings` page.

Latest focused progress route slice: legacy local `/progress`,
`/progress/badges`, `/progress/leaderboard`, and `/progress/xp-history` were
removed. Profile links now point to Laravel's accessible `/achievements` and
`/leaderboard` surfaces instead of the old progress aliases.

Latest focused settings route slice: legacy local `/settings`,
`/settings/notifications`, `/settings/password`, and `/settings/privacy` were
removed. The account/settings entry point now uses Laravel's accessible
`/profile/settings` hub, while Laravel parity subpages under `/settings/*`
remain only for the routes present in Laravel's `govuk-alpha-parity/settings.php`.

Latest focused connections route slice: legacy local `/connections/pending`
was removed. Links from the connections index, member directory, and
notifications now use Laravel's accessible `/connections/network` page with the
`pending_received` tab selected.

Latest focused component-demo slice: the local `/components` route, home-page
demo link, and unused `components.njk` template were removed. The Laravel
accessible source keeps GOV.UK component inventory in docs/source assets rather
than publishing a component-demo route.

Latest focused legal-route slice: legacy local top-level `/terms` and
`/privacy` routes were removed. Legal documents now expose Laravel's accessible
`/legal/terms` and `/legal/privacy` routes only.

Latest focused auth-alias route slice: legacy local top-level password-reset
aliases `/forgot-password` and `/reset-password` were removed for both GET and
POST so the login and reset flows now expose only Laravel's accessible
`/login/forgot-password` and `/password/reset` paths. The login page now links
directly to `/login/forgot-password`.

Latest focused logout route slice: legacy local `GET /logout` was removed so
the `logout` route family now matches Laravel's POST-only accessible logout
declaration with `0` extra local logout routes. The account hub still renders a
CSRF-protected POST sign-out form.

Latest focused admin route slice: legacy local `/admin` pages and POST actions
were removed from `apps/web-uk`. Laravel's scanned GOV.UK accessible route set
does not expose an untenanted `/admin` route family; admin-only accessible
workflows remain in their canonical module pages such as `/jobs/bias-audit`.
The jobs bias-audit back link no longer points at the removed local `/admin`
surface.

Latest consolidated route-matrix evidence slice: static route parity now
reports `608` matched Laravel routes, `0` missing Laravel routes, and `0` true
extra `apps/web-uk` routes. The local-only `GET /health`,
`GET /service-unavailable`, and `POST /session/touch` helpers remain available
but are classified as ignored infrastructure instead of accessible route parity
gaps.

Latest focused tenant-routing response-rewrite slice: shared-host tenant pages
under `/{tenantSlug}/accessible` now keep local redirects plus rendered HTML
`href` and `action` attributes inside the active shared mount. The middleware
skips asset, API, upload, service-worker, health, and other infrastructure URLs
so static resources stay on their flat public paths. Focused route tests passed
with `30/30` tests, full Web UK Jest passed with `8` suites and `681` tests,
lint passed, and the route matrix stayed at `608/608` Laravel accessible routes
matched with `0` missing, `0` true extra Web UK routes, and `3` ignored
infrastructure helper routes.

Latest focused backend-contract provenance slice: `resolveBackendContract()`
now returns `baseUrlSource` so Laravel defaults, future ASP.NET mode, and
explicit `API_BASE_URL` overrides are distinguishable in tests and docs.
`API_BASE_URL` remains an override only; it does not certify ASP.NET
compatibility or replace Laravel as the source of truth.

Latest focused local gate slice: lint warnings were cleaned from
`src/middleware/auth.js` and `src/server.js`. `npm run lint` now exits cleanly
with no warnings in the controlled web-uk worktree, moving the local readiness
gate from "0 errors, known warnings" to fully clean lint.

Latest focused Laravel smoke slice: after Laravel `http://127.0.0.1:8088`
became reachable again, a controlled temporary web-uk process on
`WEB_UK_BASE_URL=http://127.0.0.1:6251` was started with `TENANT_ID=2`.
`npm run smoke:laravel` passed with `SMOKE_MODULE_PAGE_PATHS=none` and
`SMOKE_BODY_TEXT_PAGE_PATHS=none`, covering Laravel API reachability, web-uk
health, unsigned auth redirects, login CSRF, login POST to `/dashboard`, signed
`/account`, logout POST clearing the session, no-JS cookie POST workflows,
content-type contracts, 22 signed gated `403` checks, and the then-current
signed redirect checks. After the 2026-07-08 course 2 fixture refresh, the same
core scope has
19 signed redirect checks because `/courses/2/learn` and
`/courses/2/certificate` are signed module-page fixtures. A full default
634-check run on port `6250` exceeded the 15-minute
wrapper timeout after progressing through the module-page sweep and into the
body-text checks. The smoke harness now supports both
`SMOKE_MODULE_PAGE_CHUNK=N/M` and `SMOKE_BODY_TEXT_PAGE_CHUNK=N/M`, so future
agents can recertify the full default scope in repeatable chunks instead of
manually splitting body-text page lists.

Latest focused federation live-smoke slice: while recertifying chunked smoke
against a temporary web-uk process at `WEB_UK_BASE_URL=http://127.0.0.1:6260`,
Laravel returned `403` for the optional `/api/v2/federation/activity` feed even
though `/api/v2/federation/status` and `/api/v2/federation/partners` returned
`200`. The `/federation` hub now treats that activity-feed `403` as an empty
activity list instead of rendering `503`. A targeted Laravel runtime smoke on
2026-07-08 passed `11/11` checks, including `module-page-federation-renders`
with status `200`.

Latest chunked live-smoke recertification on 2026-07-08 against the same
temporary `WEB_UK_BASE_URL=http://127.0.0.1:6260` process: after earlier
`1/8` and post-fix `2/8` mixed chunks passed, the remaining page sweeps were
recertified as split module/body slices. `SMOKE_MODULE_PAGE_CHUNK=3/8` through
`8/8` passed with `269/269` repeated checks and `0` failures, including `209`
module-page checks. `SMOKE_BODY_TEXT_PAGE_CHUNK=3/8` through `8/8` passed with
`271/271` repeated checks and `0` failures, including `211` body-text contract
checks. The `3/8` body slice can run close to five minutes on this local
Laravel/Web UK pair; a fetch-logged rerun completed green in about 253 seconds,
so use generous command timeouts when recertifying the full chunk set.

Latest focused dashboard slice: signed `/dashboard` now has a targeted shared
shell test for the Laravel Blade dashboard contract. The route calls
Laravel-compatible profile, onboarding status, wallet balance, gamification
profile, badges, listings, feed, member events, exchange-attention count, and
member endorsements helpers, and the Nunjucks view renders the Blade-style
welcome, onboarding banner, exchange-attention banner, create-listing CTA,
time-bank stat grid, progress/badges, upcoming events, skill endorsements,
quick links, and recent feed/listings. Remaining dashboard gaps are
tenant/module/feature gates, exact localization, broader live Laravel workflow
certification, and ASP.NET backend compatibility. A targeted live dashboard
marker smoke on 2026-07-08 against a temporary web-uk process at
`WEB_UK_BASE_URL=http://127.0.0.1:6240`, started with `TENANT_ID=2`, passed
`12/12` checks for auth/health, signed `/dashboard`, and body markers
`Welcome back`, `Your time bank`, `Quick links`, `Recent feed`, and
`Recent listings`.

Focused runtime-smoke harness test: `npm test --
tests/laravel-runtime-smoke.test.js --runInBand` passed with `17/17` tests
after red steps for the missing harness, stale Acme defaults, missing public
module-page checks, missing signed module-page checks, too-short default
timeout for slower Laravel-backed signed pages, chunked fallback support, and
the missing default real-fixture parameterised detail, secondary outcome,
listing/member/feed/course, message/volunteering-owner, and
course/federation/ideation/resource/coupon, home/blog/wallet/coupon-management
outcome scopes.

Live local smoke result on 2026-07-07: direct Laravel login succeeds for the
E2E fixture account when `X-Tenant-ID: 2` or `X-Tenant-Slug: hour-timebank` is
sent. `npm run smoke:laravel` passed end-to-end against a temporary web-uk
process started with `TENANT_ID=2`, `WEB_UK_BASE_URL=http://127.0.0.1:5181`,
and `SMOKE_TIMEOUT_MS=60000`: Laravel API `200`, web-uk health `200`, unsigned
`/account` -> `/login`, `/login` CSRF rendered, login POST -> `/dashboard`, and
signed `/account` rendered `200`. The current smoke scope also checks
`/volunteering`, `/organisations`, `/organisations/browse`, `/kb`, and `/help`
return 2xx through web-uk while Laravel is the backend target. After the login
flow, it checks the broad signed page set covering `/explore`, `/saved`,
`/notifications`, `/members`, `/members/discover`, `/resources`, `/skills`,
`/goals`, `/clubs`, `/wallet`, `/messages`, `/connections`, `/connections/network`,
`/matches`, `/matches/board`, `/activity`, `/achievements`, `/leaderboard`,
`/nexus-score`,
`/profile/settings`, `/settings/appearance`, `/settings/data-rights`,
`/federation`, `/courses`, `/courses/mine`, `/marketplace`,
`/marketplace/mine`, `/events`, `/events/new`, `/listings`,
`/search/advanced`, `/premium`, and `/podcasts`, plus deeper signed subpages
across profile, settings,
achievements, leaderboard, federation, courses, marketplace, and volunteering.
A later 2026-07-07 smoke run against
`WEB_UK_BASE_URL=http://127.0.0.1:5293` passed `93/93` checks with that expanded
scope. A follow-up 2026-07-07 probe against
`WEB_UK_BASE_URL=http://127.0.0.1:5294` found another stable 2xx batch. The
expanded harness passed `158/158` checks against
`WEB_UK_BASE_URL=http://127.0.0.1:5295`: 6 auth/health checks and 152 module
page checks. `/feed` is now part of the default signed page scope and renders
the local Laravel-backed feed page with an empty/error state when Laravel's feed
collection API is unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5297` passed `159/159`: 6 auth/health checks
and 153 module page checks. Plain `/connections` is now in the default signed
scope and renders with an empty/error state when Laravel's legacy connections
API is unavailable; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5298` passed `160/160`: 6 auth/health checks
and 154 module page checks. Plain `/members` is now in the default signed scope
and renders with an empty/error state when Laravel's legacy members API is
unavailable; a later run against `WEB_UK_BASE_URL=http://127.0.0.1:5299` passed
`161/161`: 6 auth/health checks and 155 module page checks. `/events/new` and
`/marketplace/onboarding` are now in the default signed scope and render form
pages with empty/error setup state when Laravel helper APIs are unavailable; a
later run against `WEB_UK_BASE_URL=http://127.0.0.1:5302` passed `163/163`: 6
auth/health checks and 157 module page checks. The feature/role-gated pages
`/jobs/bias-audit`, `/jobs/talent-search`, and `/marketplace/coupons` are now
covered as expected signed-session `403` checks; a later run against
`WEB_UK_BASE_URL=http://127.0.0.1:5306` passed `166/166`: 6 auth/health checks,
157 module page checks, and 3 gated-status checks. `/onboarding` and
`/premium/manage` are now covered as expected signed-session redirect checks; a
later run against `WEB_UK_BASE_URL=http://127.0.0.1:5307` passed `168/168`: 6
auth/health checks, 157 module page checks, 3 gated-status checks, and 2
redirect-status checks. `/listings` needed a Nunjucks
owner-id guard because Laravel can return nested `user.id` without a flat
`user_id`; the default smoke timeout is now `60000` ms for slower Laravel
fixture pages. Signed-session public auth aliases `/login`,
`/login/forgot-password`, `/password/reset?token=reset-token`, and `/register`
now remain renderable like Laravel and are part of the default 2xx smoke scope;
the latest live run against `WEB_UK_BASE_URL=http://127.0.0.1:5308` passed
`172/172`: 6 auth/health checks, 161 module/page checks, 3 gated-status checks,
and 2 redirect-status checks.
`/login/two-factor` now redirects to `/login?status=two-factor-expired` when the
session-backed 2FA token is absent and is covered by the default redirect-status
scope; a later live run against `WEB_UK_BASE_URL=http://127.0.0.1:5309` passed
`173/173`: 6 auth/health checks, 161 module/page checks, 3 gated-status checks,
and 3 redirect-status checks. POST `/login` now also follows the Laravel 2FA
challenge hand-off by storing `two_factor_token` in the session and redirecting
to `/login/two-factor` when the API returns `requires_2fa`. The default smoke
scope now checks 12 matched unsigned auth-required parameterised routes across
federation, ideation, organisations, podcasts, resources, public user
collections, marketplace slot edit, saved collections, saved-search delete, and
volunteering certificate download. A full default Laravel-backed run against a temporary web-uk
process at `WEB_UK_BASE_URL=http://127.0.0.1:5322`, started with `TENANT_ID=2`,
passed on 2026-07-07: `181/181` checks, `0` failures, `161` module-page
checks, 8 unsigned auth-required redirect checks, 3 gated-status checks, and 3
signed redirect checks in 352.8 seconds. For targeted CLI runs,
`SMOKE_MODULE_PAGE_PATHS`,
`SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS`, `SMOKE_GATED_PAGE_PATHS`, and
`SMOKE_REDIRECT_PAGE_PATHS` accept comma/newline-separated lists, and the
portable sentinel `none` disables that
group. A targeted live CLI run against
`WEB_UK_BASE_URL=http://127.0.0.1:5317` with those three variables set to
`none` passed `14/14`, including all eight auth-required parameterised
redirects. For slower shells, `SMOKE_MODULE_PAGE_CHUNK=N/M` now splits the
module-page sweep and `SMOKE_BODY_TEXT_PAGE_CHUNK=N/M` splits the body-text
sweep into deterministic one-based chunks, for example
`SMOKE_MODULE_PAGE_CHUNK=1/4` or `SMOKE_BODY_TEXT_PAGE_CHUNK=1/8`, so agents can
recertify the default page set through repeatable smaller Laravel-backed runs
while leaving auth, unsigned auth-required, gated, and redirect checks enabled.
All 16 chunked live runs
against `WEB_UK_BASE_URL=http://127.0.0.1:5321` with `TENANT_ID=2` and
`SMOKE_MODULE_PAGE_CHUNK=N/16` passed on 2026-07-07: `481` total repeated
checks, `0` failures, and `161` collective module-page checks across the
default sweep. Each shard also reran the auth/API setup, unsigned
auth-required redirects, gated status checks, and signed redirect checks.
Event and group detail helpers now use Laravel v2 detail endpoints
(`/api/v2/events/{id}` and `/api/v2/groups/{id}`) and unwrap Laravel
`{ data: ... }` payloads before rendering Nunjucks templates. A targeted live
Laravel-backed run against `WEB_UK_BASE_URL=http://127.0.0.1:5325`, started
with `TENANT_ID=2`, passed on 2026-07-07: `24/24` checks, `0` failures, with 6
auth/health checks and 18 real-fixture parameterised module pages:
`/events/6`, `/events/6/map`, `/events/6/polls`, `/events/6/translate`,
`/volunteering/opportunities/307`, `/organisations/636`,
`/organisations/636/jobs`, `/organisations/opportunities/307/apply`,
`/jobs/90764`, `/groups/484`, `/groups/484/invite`,
`/groups/484/notifications`, `/groups/484/image`,
`/groups/484/announcements`, `/groups/484/discussions`, `/groups/484/files`,
`/groups/484/manage`, and `/resources/10/comments`.
Those 18 real-fixture parameterised pages are now part of the default module
page sweep rather than targeted-only evidence. The default scope also covers
`/groups/484/discussions/new`, `/jobs/90764/qualified`,
`/members/77/insights`, `/listings/42/report`,
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
`/jobs/90764/analytics`, `/jobs/90764/pipeline`,
`/jobs/90764/applications`, `/listings/42/analytics`,
`/group-exchanges/1`, `/messages/groups/33`, `/resources/10/delete`,
`/coupons/1`, and `/coupons/2` as signed `403` responses;
plus signed redirects from `/events/6/recurring-edit` to `/events/6/edit`,
`/groups/484/edit` to `/groups/484`, `/courses/42/certificate` to
`/courses/42?status=certificate-failed`, and
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
redirect checks; `npm run smoke:laravel` exited `0`.
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
appreciation and employer-brand routes. At the time of this 2026-07-07 run it
also treated `/groups/484/files/1/download` as the signed missing-file redirect
to `/groups/484/files?status=file-not-found`; the 2026-07-10 group authorization
follow-up below supersedes that fixture assumption with the live Laravel 403.
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
smoke scope: the harness fetches CSRF tokens, posts banner reject, banner accept,
and settings-save analytics choices to `/cookie-consent`, and asserts the
accessible `nexus_accessible_cookie_consent=essential` or `all` cookie plus
the expected `/cookies` redirects. A targeted live run on 2026-07-08 against
`WEB_UK_BASE_URL=http://127.0.0.1:6242`, started with `TENANT_ID=2`, passed
`9/9` checks including all three cookie POST workflows, auth, and signed
`/account`.
The CSRF-protected sign-out form on `/account` is now part of the default
Laravel runtime smoke scope too: it logs in a separate session, reads the
account-page CSRF token, posts `/logout`, and asserts both the `/login` redirect
and that `/account` redirects after local auth cookies are cleared. A targeted
live run on 2026-07-08 against `WEB_UK_BASE_URL=http://127.0.0.1:6243`,
started with `TENANT_ID=2`, passed `10/10` checks including logout.
The remaining signed/detail body-marker routes `/connections/network`,
`/dashboard`, `/exchanges`, `/me/collections`, `/premium/return`, `/profile`,
`/reviews/list`, `/users/14/appreciations`, `/kb/90001`,
`/achievements/badges/vol_1h`, and `/reviews/18/comments` now carry
Laravel-backed body-text markers. The core module-page/body-text marker gap is
0; after the 2026-07-10 clubs no-active-club and group authorization
corrections, the current default smoke scope has `276` module-page checks and
`278` body-text contract checks.
`/dashboard` now carries stable body-text checks for
`Welcome back`, `Your time bank`, `Quick links`, `Recent feed`, and `Recent
listings`.
The default scope now contains `630` checks:
`276`
module-page checks, 14 unsigned auth-required redirect checks, 3 unsigned login
redirect checks, 29 gated-status checks, and 18 signed redirect checks, plus 2
content-type contract checks, 278 body-text contract checks, 3 cookie-consent
POST workflow checks, 1 logout POST workflow check, and the 6 auth/health
checks.
Parameterised matched GET route shapes without default runtime smoke coverage
fell from 28 to 0. The signed `/chat` AI assistant page returned `200` against
`WEB_UK_BASE_URL=http://127.0.0.1:5354`, confirming the default
`module-page-chat-renders` smoke outcome against Laravel.

`/organisations/{id}` now
matches Laravel's signed-out behavior by redirecting to
`/login?status=auth-required` before data lookup. Without
`TENANT_ID=2`, the same Laravel E2E credentials fail because web-uk does not
send the tenant context Laravel uses to scope login.

### 2026-07-10 focused auth, onboarding, and notification endpoint correction

The Web UK API client now matches five exact Laravel contracts that were still
using legacy paths or methods:

- token renewal uses `POST /api/auth/refresh-token` with
  `{ refresh_token }`;
- onboarding bio/profile writes use `PUT /api/v2/users/me`;
- onboarding avatar multipart uploads use
  `POST /api/v2/users/me/avatar` with the `avatar` field;
- single-notification reads use
  `POST /api/v2/notifications/{id}/read`;
- single-notification deletes use
  `DELETE /api/v2/notifications/{id}`.

This was a Web UK-only contract correction; Laravel was not modified. Focused
verification passed:

- `npm --prefix apps/web-uk test -- tests/api.test.js --runInBand --runTestsByPath -t "refreshToken|Laravel onboarding helpers|Laravel notification helpers"`
  passed `10/10` selected tests;
- `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "refreshes an expired signed token|submits the Laravel onboarding profile step|submits the Laravel onboarding avatar route|submits a single notification"`
  passed `5/5` selected tests, covering the 401 refresh retry, trimmed onboarding
  bio, multipart avatar proxy, and both single-notification POST aliases;
- `npm --prefix apps/web-uk run lint` passed with no ESLint errors or warnings.

Live refresh-token rotation, profile/avatar persistence, and notification
mutation persistence still require isolated Laravel fixtures; the focused
tests prove the Web UK request contracts and route handoffs, not those external
side effects.

### 2026-07-10 Goal Detail, Group Media, And Combined Contract Follow-up

- `/goals/{id}` now authenticates before lookup, unwraps Laravel's v2 detail
  envelope, then reads optional history and insights without allowing either
  supplementary request to hide a valid goal. It renders the Blade owner,
  buddy, public-action, progress, history, notes, insight, social, edit, and
  completion states through tenant-aware URLs. A missing goal stops before the
  supplementary calls. The scoped localization keys resolve through all 11
  catalogs, and the current public fixture `/goals/162` passed its signed body,
  unsigned auth-handoff, and depth-page Laravel smoke checks.
- Group image management is now owner/group-admin/platform-admin only. Group
  file list, upload, download, and delete are active-member/admin only and fail
  closed when membership cannot be proved. Both existing and arbitrary file IDs
  return the same 403 to a non-member before the file API is touched, removing a
  file-existence oracle. Uploads enforce Laravel's 8 MB image and 25 MB file
  limits, MIME allowlists, folder/description limits, exact multipart fields,
  and temporary-file cleanup; file delete controls render only for the uploader
  or an administrator.
- The local Laravel E2E smoke account is not a member or administrator of group
  fixtures 482 or 484. A fresh live run therefore correctly returned 403 for
  each fixture's image page, files page, and direct file download while the goal
  detail remained 200; all `19/19` scoped checks passed. The default smoke
  contract now records those six group routes as gated 403 outcomes instead of
  false rendered-page or missing-file expectations, and its dedicated harness
  passed `43/43` tests.
- The final combined Web UK gate passed `42/42` Jest suites and
  `1,222/1,222` tests, full ESLint, CSS compilation, the 290-template
  conservative localization audit with zero safe matches, the 11-locale
  catalog audit with zero missing/extra keys, the generated route matrix with
  all 608 Laravel routes matched and zero missing, and the Chromium/axe
  accessibility gate `12/12`. The latter covers public and Arabic RTL 320px
  reflow; authenticated Arabic account-deletion rendering was additionally
  inspected at 320px with one main/H1, unique IDs, labelled controls, correct
  RTL direction, and no horizontal overflow. Destructive POSTs were not run.
- The safe hosted-checkout and secure email-change failures described above are
  intentional external boundaries, not completed workflows. Completion still
  needs Laravel bearer APIs for hosted checkout and password-gated email change,
  plus isolated fixtures for mutation/upload/destructive side-effect proof.

### 2026-07-10 Wallet Transfer V2 Contract Correction

The Web UK wallet transfer form and POST handler now use Laravel's canonical
`POST /api/v2/wallet/transfer` contract. Each rendered recipient form carries a
UUID `idempotency_key`; the handler submits numeric `recipient` and `amount`, a
trimmed 255-character `description`, and that same idempotency key through the
existing bearer-authenticated v2 API helper. The obsolete
`POST /api/wallet/transfer`/`receiver_id` helper was removed.

The POST handler no longer reads the profile or wallet balance before the
mutation. Laravel's locked wallet transaction remains authoritative for
self-transfer, recipient, tenant, and balance checks. Web UK performs only
shape/range/precision validation, understands Laravel's nested v2 error codes,
maps insufficient/not-found/self/inactive/duplicate outcomes to the accessible
wallet status UI, sends `ONBOARDING_REQUIRED` responses to the tenant-aware
onboarding route, and preserves active shared-mount prefixes on every redirect.
The wallet page now renders the Blade transfer confirmation/error states and
links failures back to the manage-credit transfer form.

Focused verification passed without a live credit mutation:

- the shared-shell wallet transfer selection passed `13/13`, covering the
  rendered UUID, exact v2 payload, absence of handler profile/balance
  preflights, four local validation failures, five Laravel error envelopes,
  mounted onboarding/auth redirects, and rendered success/error states;
- the API-client wallet selection passed `2/2`, covering the exact v2 request
  and removal of the legacy helper.

This correction is locally complete against the Laravel source contract. A
real transfer/replay smoke remains intentionally deferred until a disposable
wallet fixture and balance/ledger rollback plan are available.

### 2026-07-10 Registration V2 And Tenant-Policy Correction

Web UK registration now uses Laravel's public `POST /api/v2/auth/register`
contract with an explicit `X-Tenant-Slug` header. The mounted tenant remains
authoritative over a crafted posted slug. Before rendering or submitting a
tenant-scoped form, Web UK reads `GET /api/v2/auth/registration-info`; policy
lookup fails closed, closed tenants render the Blade notification without a
form, and invite-only tenants receive the conditional invite field.
Flat community-code submissions first resolve the explicit slug through the
fail-closed tenant bootstrap, so an unknown slug cannot fall through to the
master tenant.

The no-JS form now matches the current Blade/backend payload: profile type and
conditional organisation name, invite code, names, international phone,
location plus optional coordinates, email, 12-character password and
`password_confirmation`, mandatory terms, optional newsletter consent, the
single clipped honeypot, and `form_started_at`. Cloudflare Turnstile was removed
from this flow because Laravel removed it. Safe failed input survives the
redirect through flash state, while passwords never do.

The POST handler performs the Laravel-compatible shape/range checks, maps every
current registration service error code to the exact accessible status, keeps
the first safe backend validation `field` as an inline target, keeps API
controller rate limiting as a truthful 429, and redirects a successful 201
to tenant-aware `/login?status=register-created`. It never attempts automatic
login or sets authentication cookies because Laravel creates a pending account
that requires the email-verification next step.

Focused mock verification passed `4/4` suites and `210/210` tests across the
API client, registration contract, auth localization, and mounted-tenant
authority. A selected real-template render pass also passed `4/4`, including
the public registration page. No live registration POST was run because it
would create a pending user and can send external email. Runtime certification
still needs an isolated disposable tenant/user plus cleanup and email-delivery
evidence; the server-to-server path must also confirm Laravel sees per-client
IP identity rather than one shared Web UK proxy address for its registration
rate limiter.

### 2026-07-10 TOTP Login And Public Auth Tenant Contract Correction

Two-factor login completion now uses Laravel's public `POST /api/totp/verify`
contract with `{ two_factor_token, code }` and an explicit
`X-Tenant-Slug`. The pending challenge token and the authoritative tenant slug
are stored together in the Web UK session. A successful response is accepted
only when Laravel returns its top-level `success`, `access_token`, and
`refresh_token` envelope; Web UK never promotes the short-lived challenge token
to an access token. Success and terminal expiry clear both pending values,
while an invalid code leaves the challenge available for a retry.

Forgot-password, resend-verification-by-email, and email verification now send
the routed or explicitly selected tenant as `X-Tenant-Slug`. The obsolete
forgot-password JSON `tenant_slug` field is no longer treated as tenant
authority. Mounted tenant routing remains authoritative over crafted form
values, and the email-verification link forwards its route context to Laravel's
strictly tenant-scoped token lookup.

Focused mock verification covers the exact fetch endpoint, method, body,
header, top-level token envelope, mounted-tenant authority, retryable and
expired 2FA errors, session cleanup, malformed-envelope rejection, and email
verification/resend route handoffs. No live TOTP challenge was consumed and no
password-reset or verification email was sent; those side effects still need
disposable Laravel fixtures and mailbox evidence.

### Members and connections v2 contract correction (2026-07-10)

The Web UK member directory and profile now use Laravel's canonical
`GET /api/v2/users` and `GET /api/v2/users/{id}` contracts. The directory sends
Laravel's `q`, `sort`, `order`, `limit`, and `offset` query fields, unwraps the
top-level `{data, meta}` envelope, derives pagination from `meta.total_items`,
`meta.per_page`, and `meta.offset`, and loads each rendered member's exact
connection state through `/api/v2/connections/status/{userId}`. Profile reads
also unwrap `{data: profile}` while retaining the existing connection,
gamification, reviews, and current-viewer composition. Laravel `401` and `404`
outcomes retain tenant-aware login and not-found handling.

The canonical `getConnections()` helper now calls `GET /api/v2/connections`
with Laravel's `status`, `per_page`, and opaque `cursor` query contract. Both
connections views consume the returned `{data, meta}` envelope, understand the
Laravel `partner`/`user` projection, distinguish accepted, received-pending,
and sent-pending states, preserve tenant-aware profile/action/next-page links,
and show a visible warning instead of silently converting an upstream failure
into a healthy-looking empty network. Focused API and route/render tests cover
the exact fetch URLs, real envelopes, cursor/meta pagination, connection-state
controls, tenant mounts, expired authentication, and null-data 404 handling.
This was a Web UK-only correction; the Laravel source was read but not changed.
No live Laravel mutation or browser certification is claimed by this slice.

### Gamification profile and badges v2 correction (2026-07-10)

Web UK gamification reads now follow `GamificationV2Controller` and the
canonical React profile/achievements consumers exactly: own-profile requests
use `GET /api/v2/gamification/profile` and `/badges`, while member-profile
requests add `?user_id={id}` to both endpoints. Consumers unwrap Laravel's
`{data: profile}` and `{data: badges, meta: {total, available_types}}`
envelopes. The dashboard conditionally renders progress only when a real
profile was returned instead of manufacturing Level 1, 0 XP, and zero badges.
Member profiles use the v2 XP/level fields and earned badges, with only actual
`/api/v2/users/{id}` XP/level/badge fields as a fallback when the optional
gamification calls fail. Focused fetch, dashboard, and member-profile tests,
template-source tests, lint, and diff checks cover this Web UK-only correction;
Laravel was read-only and no live side effect was performed.

## Refresh Protocol

Run this before continuing work or reporting a score:

```powershell
git status --short --branch
git log --oneline --decorate -n 20
git diff --stat -- apps/web-uk

cd apps\web-uk
npm run route:matrix
npm run visual:blade
npm run lint
npm test -- --runInBand
npm run smoke:laravel
```

After `npm run route:matrix`, inspect:

```powershell
Get-Content docs\generated\accessible-route-matrix.md -TotalCount 120
Select-String -Path docs\generated\accessible-route-matrix.json -Pattern 'laravel-prep-pages.js'
```

The route matrix only proves method/path declarations. It does not certify
Blade visual parity, auth redirects, tenant gates, feature gates, POST side
effects, localization, runtime Laravel behavior, or ASP.NET backend switching.
For local Laravel auth smoke, ensure the web-uk process was started with
`TENANT_ID=2`. The harness default timeout is `60000` ms; keep
`SMOKE_TIMEOUT_MS` available for exceptionally slow local runs. For
tenant-domain checks, add `SMOKE_TENANT_DOMAIN_PAGE_PATHS` entries as
`host|/path=>Expected text`; the harness will send a real HTTP `Host` header to
the local Web UK process. For the scoped tenant/home visual checkpoint, start a
tenant-correct Web UK process the same way and run `npm run visual:blade` with
`WEB_UK_BASE_URL` pointing at that process.

2026-07-10 smoke-runner update: prefer `npm run smoke:laravel:local` when a
tenant-correct Web UK process is not already running. It starts the real Web UK
app on an ephemeral local port inside the Node smoke process with smoke-safe
secrets, `ACCESSIBLE_BACKEND_TARGET=laravel`, and `TENANT_ID=2`, then runs the
same Laravel runtime harness and closes the server. This avoids false
`fetch failed` results from ad hoc PowerShell background process launchers.
Verified during this handoff: focused Jest coverage for the local app runner
passed, the core local Laravel smoke passed 10/10 checks, and the module-page
bucket is green by chunks. Chunk 1/8 passed 106/106 against a tenant-correct
temporary Web UK process; chunks 2/8 through 8/8 passed 106/106 with
`SMOKE_BODY_TEXT_PAGE_PATHS=none npm run smoke:laravel:local` against Laravel
`http://127.0.0.1:8088`. The body-text bucket is green by chunks too:
`SMOKE_MODULE_PAGE_PATHS=none` with chunk 1/8 at 107/107, chunk 2/8 at 107/107,
and chunks 3/8 through 8/8 at 106/106. The harness now refreshes and retries a
signed gated check once after an unexpected login redirect, which fixed a
long-batch `/jobs/talent-search/77` false negative without forcing a full login
before every gated route. Expected Laravel `403` gated routes may still emit
application error logs while the JSON smoke result remains green.

Latest focused AI-assistant localization slice: signed `/chat` now renders the
Laravel `govuk_alpha_aichat` catalog for the document/page title, caption,
description, AI warning, empty/error states, conversation navigation, speaker
labels, field label/hint, send action, and safe fallback conversation title.
The Web UK-only sent banner was removed because the Blade page does not render
one, while API/provider failures retain a localized accessible banner. The
existing tenant `ai_chat` gate and every `urlFor()` mount-safe link/form remain
in place. Focused English/Arabic Jest passed `2/2`; the real authenticated
Arabic Laravel-backed `/hour-timebank/accessible/chat?locale=ar&status=empty`
journey passed exact catalog markers, RTL, 320px reflow, and axe with no
serious/critical violations (`1/1`, 34.7 seconds). Full verification passed
45/45 Jest suites and 1,418/1,418 tests, ESLint, 11-locale/24-namespace catalog
structure, the 290-template conservative audit (`0` matches), and the route
matrix at 608/608 matched with 0 missing, 0 extra, and 3 ignored infrastructure
routes. The first browser invocation found no tests because the PowerShell grep
argument was split; the corrected `--grep=Arabic.*AI.*assistant` run exercised
the route. Its first assertion run exposed only an overly exact locator whose
strong element also contained Laravel's visually hidden Warning prefix; the
semantic `toContainText` assertion passed without a product-code change. The
latest uninterrupted full browser aggregate remains 62/62 at `e155375c`; this
new current-source authenticated journey is focused-green, but a fresh full
aggregate is still not claimed under the recorded Laravel fixture latency.

Latest focused group-exchange localization slice: signed
`/group-exchanges`, `/group-exchanges/new`, and `/group-exchanges/{id}` now
use Laravel's request-locale `group_exchanges` catalog for list/create/detail
titles, captions, descriptions, filters, known statuses, table/summary labels,
participant roles/states/actions, form fields/hints, warnings, and every mapped
success/error outcome. Extended statuses absent from that namespace retain
Laravel's headline fallback. The caption now uses the shared request
`tenantName`; focused browser assertions exposed that both the original
template expression and an initial home-only `communityName` correction still
rendered `undefined`, before the routed-page shell local fixed it. The
authoritative Arabic `filter_label` is still English-identical (`Filter by
status`) in Laravel, so Web UK preserves it instead of inventing a translation.
Focused English/Arabic family Jest passed `2/2`; the non-mutating authenticated
Arabic Laravel-backed list/create journey passed exact markers, non-empty
captions, RTL, 320px reflow, and axe on both pages (`1/1`, 37.2 seconds). Full
verification passed 45/45 Jest suites and 1,419/1,419 tests, ESLint, and the
290-template conservative audit with zero matches; the refreshed route matrix
remains 608/608 matched with 0 missing, 0 extra, and 3 ignored infrastructure
routes. The latest uninterrupted
full browser aggregate remains 62/62 at `e155375c`; the new current-source
group-exchange journey is focused-green, while detail-page live proof awaits a
safe existing exchange fixture and a fresh full aggregate remains unclaimed
under the recorded Laravel latency.

Latest focused matches localization slice: `/matches` now uses Laravel's
request-locale `matches` plus `polish_listings` catalogs, while the richer
`/matches/board` uses `govuk_alpha_connections` for its title/caption,
description, four stats, counted source filters, module/type/member metadata,
score and progress ARIA, reason overflow, dismiss warning/reasons/action,
empty states, back link, and outcome banners. Dynamic recommendation content
remains backend-authored, and Web UK-only location/paused/load-error guidance
remains English because Laravel exposes no matching keys. The authoritative
connections namespace is one of the 16 still wholly English-identical outside
English, so Arabic mode intentionally renders those exact Laravel English
values rather than invented translations. Focused English/Arabic render tests
passed `3/3`; the non-mutating authenticated Arabic Laravel-backed index/board
journey rendered live recommendations and passed exact headings/descriptions,
non-empty captions, RTL, 320px reflow, and axe on both pages (`1/1`, 57.8
seconds). Full verification passed 45/45 Jest suites and 1,420/1,420 tests,
ESLint, the 290-template conservative audit with zero matches, and the refreshed
route matrix at 608/608 matched with 0 missing, 0 extra, and 3 ignored
infrastructure routes. The latest uninterrupted full browser aggregate remains
62/62 at `e155375c`; the current-source matches journey is focused-green, while
the documented event/dismiss API gaps, broader persistence proof, manual parity,
and full aggregate remain open.

Latest focused poll-list localization slice: signed `/polls` now uses Laravel's
request-locale `polls`, `polish_discovery`, and gamification navigation catalogs
for the document/page title, tenant caption, description, status banners,
how-it-works text, category/mine filters, actions, inline-create labels,
open/closed/ranked tags, creator/date/vote metadata, choice/vote/result labels,
rank/detail links, and closed result rows. Shared poll normalization now uses
the localized unknown-member fallback; existing vote/create/delete banner
callers now receive Laravel's exact status strings. The authoritative Arabic
`polls.my_polls_label` remains English-identical, so Web UK preserves it.
Focused English/Arabic list coverage passed `2/2`; the authenticated Arabic
Laravel-backed listing passed exact markers, a non-empty caption, RTL, 320px
reflow, and axe (`1/1`, 30.7 seconds). Full verification passed 45/45 Jest
suites and 1,421/1,421 tests, ESLint, the 290-template conservative audit with
zero matches, and the refreshed route matrix at 608/608 matched with 0 missing,
0 extra, and 3 ignored infrastructure routes. The slice is intentionally
list-only: detail, rank, dedicated create, and manage still contain catalog
gaps and remain explicitly open. The latest uninterrupted full browser
aggregate remains 62/62 at `e155375c`; this current-source route is
focused-green, not a replacement full aggregate.

Latest focused poll-detail localization slice: signed `/polls/{id}` now uses
Laravel's exact `govuk_alpha_gamification.poll_detail` catalog for the
document/page title, tenant caption, status tags, metadata and plural counts,
ranked link, no-options/vote/results states, choice markers, likes/comments
social section, comment timestamps, form labels, hints, and actions. Like and
comment redirects now resolve the exact Laravel outcome-state keys. The
authoritative Arabic `govuk_alpha_gamification` namespace is wholly
English-identical, so Web UK deliberately exposes those read-only source values
instead of inventing translations. Focused English/Arabic list/detail coverage
passed `2/2`; the authenticated Arabic Laravel-backed list-to-detail journey
passed HTTP 200, exact catalog markers, non-empty captions, RTL, 320px reflow,
and axe (`1/1`, 39.6 seconds). Full verification passed 45/45 Jest suites and
1,422/1,422 tests, ESLint, the 290-template conservative audit with zero
matches, and the refreshed route matrix at 608/608 matched with 0 missing,
0 extra, and 3 ignored infrastructure routes. Rank, dedicated create, and
manage catalog conversion remain open. The latest uninterrupted full browser
aggregate remains 62/62 at `e155375c`; this current-source list/detail journey
is focused-green, not a replacement full aggregate. The browser process handle
was lost once during task compaction and the journey was rerun from scratch;
the completed rerun above is the evidence used.

Latest focused ranked-poll localization slice: signed `/polls/{id}/rank` now
uses Laravel's exact `govuk_alpha_gamification.ranked` catalog for its fallback
document/page title, community caption, badge, outcome states, empty and
already-ranked states, results heading, plural voter and first-choice counts,
ranking explanation, legend, position labels, and submit action. Empty API
result labels use Laravel's unknown-member fallback. The result semantics also
now match Blade: every tied nonzero maximum receives the winner tag, rather
than Web UK marking the first API row unconditionally. Focused Arabic form and
tied-result coverage passed `2/2`; the authenticated Arabic Laravel-backed
list-to-detail-to-rank journey passed HTTP 200, exact catalog markers, non-empty
captions, RTL, 320px reflow, and axe (`1/1`, 55.5 seconds). Full verification
passed 45/45 Jest suites and 1,423/1,423 tests, ESLint, the 290-template
conservative audit with zero matches, and the refreshed route matrix at 608/608
matched with 0 missing, 0 extra, and 3 ignored infrastructure routes. Dedicated
create and manage catalog conversion remain open. The latest uninterrupted full
browser aggregate remains 62/62 at `e155375c`; the three-page current-source
journey is focused-green, not a replacement full aggregate.

Latest focused poll create/manage localization slice: signed
`/polls/parity/create` and `/polls/parity/manage` now use Laravel's exact
`poll_create` and `poll_manage` catalogs for document/page titles, community
captions, descriptions, fields and hints, poll types, tags and plural counts,
empty states, export/delete actions and warnings, and context-specific outcome
states. Create also restores Blade's required question and first two options,
tomorrow-minimum closing date, and verbatim category display. Focused Arabic
create/manage catalog and form-contract coverage passed `1/1`; the authenticated
Arabic Laravel-backed list/detail/rank/create/manage journey passed HTTP 200,
exact catalog markers, non-empty captions, RTL, 320px reflow, and axe (`1/1`,
87.9 seconds). The first browser command used a space-containing grep value that
the wrapper split and found no tests; the no-space regex rerun produced the live
evidence. The first full Jest run then exposed two stale English assertions for
the old create/delete outcome strings; both were changed to read the exact
Laravel catalog and the focused test plus full suite reran green. Final
verification passed 45/45 Jest suites and 1,424/1,424 tests, ESLint, the
290-template conservative audit with zero matches, and the refreshed route
matrix at 608/608 matched with 0 missing, 0 extra, and 3 ignored infrastructure
routes. The visible poll-family catalog conversion is complete; authorization
depth, live mutation/destructive-side-effect proof, manual parity, and a fresh
full current-source browser aggregate remain open.

Latest focused Goals-index localization slice: signed `/goals` now uses
Laravel's exact request-locale `goals`, `groups`, `polish_gamify`, `actions`,
and shared state keys for its document/page title, tenant caption, description,
navigation, outcomes, status and visibility tags, overdue/streak/progress copy,
empty/load-more states, and every create-form label, hint, and action. Progress
ARIA names now include the goal title like Blade. The focused Arabic test first
failed because it guessed a fixture tenant name; it was corrected to assert the
actual contract, a non-empty caption with no `undefined`, and passed `1/1`.
The authenticated Arabic Laravel-backed index passed HTTP 200, exact catalog
markers, RTL, 320px reflow, and axe (`1/1`, 1.1 minutes wall time; 7.0 seconds
inside the page test). Full verification passed 45/45 Jest suites and
1,424/1,424 tests, ESLint, the 290-template conservative audit with zero
matches, and the refreshed route matrix at 608/608 matched with 0 missing,
0 extra, and 3 ignored infrastructure routes. Goals detail and subpages remain
open; the latest uninterrupted full browser aggregate remains 62/62 at
`e155375c`, so this current-source route is focused-green only.

Latest focused Goals-detail localization slice: signed `/goals/{id}` already
used the visible Laravel catalogs; its route-level empty goal-title and
buddy-name fallbacks now also use the request locale. The owner-detail unit
coverage now asserts exact Arabic keys across outcomes, navigation, progress
controls, buddy state/notes, and history types and passed `1/1`. The live Arabic
journey now continues from `/goals` to the known public fixture `/goals/162` and
passed HTTP 200, exact back/social/history labels, non-empty captions/titles,
no `undefined`, RTL, 320px reflow, and axe (`1/1`, 42.9 seconds). Full
verification passed 45/45 Jest suites and 1,424/1,424 tests, ESLint, the
290-template zero-match audit, and 608/608 route parity. Goals edit, check-in,
reminder, buddy-actions, insights, history, and social subpages remain open; the
latest uninterrupted full browser aggregate remains 62/62 at `e155375c`.

Latest focused Goals-edit localization slice: signed `/goals/{id}/edit` now
uses Laravel's exact request-locale keys for its document title, validation
outcome, back link, caption/title, every field label and hint, all five reminder
frequency options, public checkbox, save action, and delete warning/action.
Route-level editable-goal fallbacks now receive the request translator. Focused
Arabic owner-edit coverage passed `1/1`. The live Arabic index/detail/edit
journey first returned 200 on every page but selected the cookie-banner submit
button in its save-action assertion; after scoping the locator to the main edit
form, the rerun passed exact markers, no `undefined`, RTL, 320px reflow, and axe
(`1/1`, 3.1 minutes wall time, including a 69.9-second Laravel dashboard; 1.1
minutes inside the test). Full verification passed 45/45 Jest suites and
1,424/1,424 tests, ESLint, the 290-template zero-match audit, and 608/608 route
parity. Check-in, reminder, buddy-actions, insights, history, and social remain
open; the latest uninterrupted full browser aggregate is still 62/62 at
`e155375c`.

Latest focused Goals-check-in localization slice: signed
`/goals/{id}/checkin` now uses Laravel's exact `govuk_alpha_goals` keys for its
document title, outcome states, goal fallback/caption, intro, progress guidance,
mood choices, note form, submit action, recent-history empty state, and
API-normalized progress/mood history strings. The obsolete English mood-label
map was removed after the first full lint pass identified it as unused; the
warning-free lint rerun passed. Focused Arabic check-in coverage passed `1/1`.
The live Arabic index/detail/edit/check-in journey passed HTTP 200, exact
markers, no `undefined`, RTL, 320px reflow, and axe (`1/1`, 1.9 minutes wall
time; 1.0 minute inside the test). Full verification passed 45/45 Jest suites
and 1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit,
and 608/608 route parity. Reminder, buddy-actions, insights, history, and social
remain open; the latest uninterrupted full browser aggregate is still 62/62 at
`e155375c`.

Latest focused Goals-reminder localization slice: signed
`/goals/{id}/reminder` now uses Laravel's exact `govuk_alpha_goals` keys for its
document title, outcome states, goal fallback/caption, intro, active/none
details, localized cadence and next-reminder copy, frequency choices,
enabled/save controls, and removal warning/action. Focused Arabic reminder
coverage passed `1/1`. The live Arabic index/detail/edit/check-in/reminder
journey passed HTTP 200, exact markers, no `undefined`, RTL, 320px reflow, and
axe (`1/1`, 92.5 seconds). Full verification passed 45/45 Jest suites and
1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit, and
608/608 route parity. Buddy-actions, insights, history, and social remain open;
the latest uninterrupted full browser aggregate is still 62/62 at `e155375c`.

Latest focused Goals-buddy-support localization slice: signed
`/goals/{id}/buddy-actions` now uses Laravel's exact `govuk_alpha_goals` keys
for its document title, outcome states, goal fallback/caption, intro,
support-type labels and hints, message guidance, and submit action. The obsolete
English support-hint map was removed after the first full lint pass identified
it as unused; warning-free lint then passed. Focused Arabic buddy-support
coverage passed `1/1`. The live Arabic six-page Goals workflow passed HTTP 200,
exact markers, no `undefined`, RTL, 320px reflow, and axe (`1/1`, 3.9 minutes
wall time under host contention). Full verification passed 45/45 Jest suites
and 1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit,
and 608/608 route parity. Insights, history, and social remain open; the latest
uninterrupted full browser aggregate is still 62/62 at `e155375c`.

Latest focused Goals-insights/history/social localization slice: signed
`/goals/{id}/insights`, `/goals/{id}/history`, and `/goals/{id}/social` now use
Laravel's exact request-locale `govuk_alpha_goals` catalogs for document titles,
captions, introductions, empty/load-more states, streak/check-in/milestone
summaries, cadence helpers, chronological event labels, recursive comment author
fallbacks, likes/comments plural counts, social controls, status banners, and
comment validation. This completes exact visible-catalog wiring across the nine
currently rendered Goals pages. Focused Arabic history/insights/social coverage
passed `3/3`. The live Arabic nine-page workflow passed HTTP 200, exact title
markers, non-empty captions, no `undefined`, RTL, 320px reflow, and axe with no
serious/critical violations (`1/1`, 3.2 minutes wall time).

The first complete Jest run correctly failed one detail-history fixture: direct
`Array.map(normalizeHistoryEvent)` invocation supplied the second item's array
index as the optional translator. The detail route now calls the normalizer
explicitly without a translator to preserve its existing `goals.history_type_*`
catalog, while the dedicated History page supplies `res.locals.t` explicitly.
The affected detail/history/insights/social route set then passed `4/4`, and the
complete rerun passed 45/45 suites and 1,424/1,424 tests, warning-free ESLint,
the 290-template zero-match audit, and the route matrix at 608 Laravel routes,
608 matched, 0 missing, 0 extra, and 3 ignored infrastructure routes. Goals
feature gates, live mutation persistence, recorded manual parity, a fresh full
current-source browser aggregate, and ASP.NET backend compatibility remain
open; the latest uninterrupted full browser aggregate remains 62/62 at
`e155375c`.

Latest focused Goals-auxiliary localization slice: signed `/goals/templates`,
`/goals/buddying`, and `/goals/discover` now use Laravel's exact request-locale
catalogs for document titles, captions, template filters/targets/public
controls, tenant caption, owner/progress labels, buddy status outcomes, and
load-more actions. Template and goal-title fallbacks plus the anonymous-owner
fallback are request-localized. Buddy nudge visibility now checks the normalized
`goal.done` boolean instead of comparing a localized status label with English,
and all optional-translator normalizers use explicit callbacks so `Array.map`
indexes cannot be misinterpreted as translators.

The first focused run timed out at the command's 120-second host budget without
an assertion result. The five-minute rerun then exposed one test-fixture-only
mistake: the expected tenant caption used `Test Community`, while the shared
fixture's rendered tenant is `Project NEXUS Accessible`. After correcting that
expectation, focused Arabic templates/discovery/buddying coverage passed `3/3`.
The expanded live Arabic twelve-page Goals workflow passed HTTP 200, exact
title markers, non-empty captions, no `undefined`, RTL, 320px reflow, and axe
with no serious/critical violations (`1/1`, 5.2 minutes wall time; 2.1 minutes
inside the Playwright test). Complete verification passed 45/45 Jest suites and
1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit, and
the route matrix at 608 Laravel routes, 608 matched, 0 missing, 0 extra, and 3
ignored infrastructure routes. Exact visible-catalog wiring is now complete
for all twelve currently rendered Goals pages. Goals feature gates, live
mutation persistence, recorded manual parity, a fresh full current-source
browser aggregate, and ASP.NET backend compatibility remain open; the latest
uninterrupted full browser aggregate remains 62/62 at `e155375c`.

Latest focused Clubs localization slice: signed `/clubs` now uses Laravel's
exact request-locale `clubs`, `actions`, and shared accessibility catalogs for
the route and fallback title, tenant caption, description, search label/hint/
action, plural member count, schedule/contact labels, website action, and
new-tab text. Focused Arabic enabled-directory coverage passed `1/1`, including
dynamic member count and the shared tenant caption. Complete verification
passed 45/45 Jest suites and 1,424/1,424 tests, warning-free ESLint, the
290-template zero-match audit, and the route matrix at 608 Laravel routes, 608
matched, 0 missing, 0 extra, and 3 ignored infrastructure routes. The current
live `hour-timebank` tenant intentionally returns the existing Laravel-aligned
404 active-club gate, so an enabled live club-directory body was not invented
or claimed. Enabled-tenant runtime body proof, broader runtime behavior,
recorded manual parity, and ASP.NET backend compatibility remain open.

Latest focused Skills localization slice: signed `/skills` now uses Laravel's
exact request-locale `skills` catalog for document title, tenant caption,
description, search controls, member-result heading/empty state, proficiency/
offers/wants tags, category heading/back link/table headings/empty state, and
the nested category browser. Proficiency labels are localized in the route
normalizer, and the Web UK-only API failure inset now uses Laravel's shared
localized 503 title/body instead of hard-coded English. Focused Arabic category
drill-down/member-search coverage passed `1/1`. The first browser invocation
used a space-containing wrapper grep and returned “No tests found” before any
test ran; rerunning with `Arabic.*skills.*directory` passed the real Laravel-
backed Arabic page at HTTP 200 with exact title/search markers, RTL, 320px
reflow, and no serious/critical axe violations (`1/1`, 1.3 minutes wall time;
11.5 seconds inside the test). Complete verification passed 45/45 Jest suites
and 1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit,
and the route matrix at 608 Laravel routes, 608 matched, 0 missing, 0 extra,
and 3 ignored infrastructure routes. Category/member authorization edge cases,
deeper runtime fixtures, recorded manual parity, and ASP.NET backend
compatibility remain open.

Latest focused public-Coupons localization slice: signed `/coupons` and
`/coupons/{id}` now use Laravel's exact request-locale `coupons` and
`polish_commerce` catalogs for route/fallback title, tenant caption,
description/empty state, percentage/amount discount labels, code/date
metadata, detail back link, code panel, redemption guidance, merchant label,
and validity label. Request-localized date formatting remains intact. A test
date-helper patch initially matched the adjacent Skills test and was moved to
the intended coupon test before any test was run. Focused Arabic list/detail
coverage then passed `1/1`. Complete verification passed 45/45 Jest suites and
1,424/1,424 tests, warning-free ESLint, the 290-template zero-match audit, and
the route matrix at 608 Laravel routes, 608 matched, 0 missing, 0 extra, and 3
ignored infrastructure routes. The current live tenant remains merchant-
coupons-disabled and returns the existing Laravel-aligned 403 gate, so enabled-
tenant body runtime proof, QR redemption/validation, runtime persistence,
recorded manual parity, and ASP.NET backend compatibility remain open.

Latest focused Premium localization and interval-parity slice: signed
`/premium`, `/premium/manage`, and `/premium/return` now use Laravel's exact
request-locale `premium`, `polish_commerce`, and
`govuk_alpha_commerce.premium_manage` catalogs for pricing/current-plan/status
copy, monthly/yearly labels, management summary/actions/warnings, and return
outcomes. Tiers with both monthly and yearly prices now render Blade's radio
choice in each form, so the selected interval works without JavaScript instead
of silently defaulting to monthly. Focused Arabic pricing/manage/return coverage
passed `1/1`, including both radio inputs and the success/status states.
Complete verification passed 45/45 Jest suites and 1,424/1,424 tests,
warning-free ESLint, the 290-template zero-match audit, and the route matrix at
608 Laravel routes, 608 matched, 0 missing, 0 extra, and 3 ignored
infrastructure routes. Currency-symbol parity, external Stripe checkout/portal
behavior, enabled-tenant persistence, feature-gate depth, recorded manual
parity, and ASP.NET backend compatibility remain open.

Latest focused Blog localization slice: `/blog`, `/blog/{slug}`, signed
`/blog/{slug}/comments`, and signed `/blog/{slug}/likers/{reaction}` now use
Laravel's exact request-locale `blog` and `govuk_alpha_blogreviews` catalogs for
route titles, tenant captions, filters/results, post metadata/image labels,
likes/comments/reactions plurals, recursive comment controls/statuses, reaction
labels, and liker states/fallbacks. The RSS channel title/description also uses
the request catalog. Laravel's Arabic BlogReviews catalog remains English-
identical; those source values are intentionally preserved rather than
inventing divergent translations. The first focused run exposed one missed
legacy `feed_t1` reaction-heading key; replacing it with the exact BlogReviews
key made the Arabic index/detail/discussion/likers route test pass `1/1`.
The live Arabic Blog index passed HTTP 200, exact title/search markers, RTL,
320px reflow, and axe with no serious/critical violations (`1/1`, 47.6 seconds
wall time; 11.3 seconds inside the test). Complete verification passed 45/45
Jest suites and 1,424/1,424 tests, warning-free ESLint, the 290-template
zero-match audit, and the route matrix at 608 Laravel routes, 608 matched, 0
missing, 0 extra, and 3 ignored infrastructure routes. Feature-gate depth,
exact rich-text policy, live discussion/reaction mutations, RSS metadata depth,
recorded manual parity, and ASP.NET backend compatibility remain open.

Latest focused Search localization slice: signed `/search`,
`/search/advanced`, and `/search/saved/{id}/delete` now use Laravel's exact
request-locale `search` and `govuk_alpha_search` catalogs for route titles,
tenant captions, simple query/results/tabs/cards/plurals/empty states, advanced
filters/results/saved states, and destructive confirmation. Result, saved, and
member count helpers now use the request plural translator. Focused Arabic
simple/advanced/delete coverage passed; the grep also selected the existing
marketplace advanced-search test, so the run reported `4/4` while the intended
Search set was `3/3`. The live Arabic simple and advanced pages both passed
HTTP 200, exact title/label markers, RTL, 320px reflow, and axe with no serious/
critical violations (`1/1`, 1.0 minute wall time; 18.8 seconds inside the test).
Complete verification passed 45/45 Jest suites and 1,424/1,424 tests,
warning-free ESLint, the 290-template zero-match audit, and the route matrix at
608 Laravel routes, 608 matched, 0 missing, 0 extra, and 3 ignored
infrastructure routes. Feature-gate depth, live saved-search mutations,
recorded manual parity, broader runtime behavior, and ASP.NET backend
compatibility remain open.

Latest shared error-page and generated-locale refresh slice: Laravel's current
`lang/{locale}/govuk_alpha*.php` source had advanced beyond Web UK's generated
snapshots. `npm run locales:sync` refreshed all 11 generated locale files to 24
namespaces and 7,364 string keys per locale with zero missing or extra keys.
The newly imported exact `error_pages.*` catalog now drives the shared
403/404/429/500/503 title, body, and home-link copy; safe route-supplied 403 and
404 messages remain supported. The Skills API failure inset was also corrected
from the nonexistent `errors.503_*` path to `error_pages.503_*`.

The first focused integration run exposed a real middleware defect: an
`ApiError` carrying HTTP 429 retained status 429 but rendered the generic 500
page. The final error handler now selects `errors/429`. The first complete Jest
run then exposed four stale assertions that still required `nav.home` and fixed
English 500 copy; those tests now verify every shared status page against the
exact Laravel error catalog while retaining the generic dynamic error-page
contract. Focused verification passed 8/8 selected tests. Complete verification
passed 45/45 Jest suites and 1,425/1,425 tests, warning-free ESLint, the
290-template zero-match audit, and the route matrix at 608 Laravel routes, 608
matched, 0 missing, 0 extra, and 3 ignored infrastructure routes. A fresh
ephemeral Chromium run passed the Arabic mounted 404 at HTTP 404 with exact
title/body/home markers, `Content-Language: ar`, RTL, 320px reflow, and no
serious/critical axe violations (`1/1`, 14.5 seconds inside Playwright). Two
initial wrapper invocations reported no tests because a space-containing grep
was split into an extra file filter; `--grep=Arabic.404` selected and ran the
intended test. The latest uninterrupted full browser aggregate remains 62/62
at `e155375c`; this focused current-source result does not relabel that older
aggregate.

Latest CSRF-expiry 419 parity slice: Laravel's `AccessibleErrorPage` explicitly
maps `TokenMismatchException` to HTTP 419 and `error_pages.419_*`, while Web UK
still returned a localized 403 for invalid or expired CSRF tokens. Web UK now
has a shared `errors/419.njk` template, maps final-handler status 419 to it, and
returns 419 from the CSRF middleware with Laravel's exact request-locale title,
body, and home action. The focused integration path posts an invalid token to
the real Contact boundary and proves Arabic HTTP 419 output alongside the other
five shared error statuses. Focused error coverage passed 7/7 selected tests.
Complete verification passed 45/45 Jest suites and 1,425/1,425 tests,
warning-free ESLint, the 291-template zero-match audit, and 608/608 route parity
with 0 missing, 0 extra, and 3 ignored infrastructure routes. A fresh ephemeral
Chromium form round trip first
found the language selector and Contact form shared the same action; tightening
the locator to the POST form made the intended test pass HTTP 419, exact Arabic
markers, `Content-Language: ar`, RTL, 320px reflow, and axe (`1/1`, 9.2 seconds
inside Playwright). The recurring Sass output remains the pre-existing GOV.UK
palette deprecation warning set.

Latest standalone error-document parity slice: direct comparison with Laravel
`accessible-frontend/views/error.blade.php` found Web UK's six status templates
still extended the full app shell. That could make exception rendering depend
on tenant navigation, session state, cookie controls, the phase banner, and
application JavaScript, while also exposing route- or backend-supplied English
exception messages and development stack details. Laravel intentionally avoids
all of those dependencies and always renders standardized catalog copy.

Web UK now has `layouts/error.njk`, a standalone CSS-only document with exact
request-locale title/body/home copy, skip link, one main landmark, `noindex`,
and the minimal AGPL attribution footer. All 403/404/419/429/500/503 templates
use it. Raw 403 exception messages, specialized 404 overrides, and development
500 details are no longer emitted. The focused six-status integration test
asserts the missing header, cookie banner, phase banner, and `/js/` assets as
well as exact status/copy semantics.

The first complete Jest run exposed 12 stale tests whose only 403 assertion was
the old literal exception/feature-disabled message. After switching those to
Laravel's authoritative `error_pages.403_title`, the next complete run exposed
two specialized 404 expectations (Knowledge Base and Goals) that Laravel's
standalone exception renderer also standardizes. Updating those assertions
produced a clean 45/45-suite, 1,425/1,425-test run. Warning-free ESLint, the
292-template zero-match audit, and 608/608 route parity also pass. Fresh
ephemeral Chromium runs pass both the standalone Arabic 404 and invalid-CSRF
419 journeys with exact markers, RTL, 320px reflow, and no serious/critical axe
violations. The runs retain only the pre-existing GOV.UK Sass palette warnings.

Latest focused Resources localization slice: signed `/resources`,
`/resources/library`, `/resources/upload`, `/resources/{id}/delete`, and
`/resources/{id}/comments` now use Laravel's exact request-locale
`govuk_alpha.resources` and `govuk_alpha_resources` catalogs. The slice covers
document/page titles, tenant captions, simple/full-library navigation, search
and category controls, plural result/download/reaction/comment counts, empty
and status states, file metadata/type labels, upload fields and limits, delete
warnings/confirmation, reaction controls, recursive comment author fallbacks,
dates, actions, and dynamic ARIA labels. The previous unrelated Blog, Jobs,
Events, Federation, and Discovery fallback keys were removed from these pages.

The first focused run correctly failed two English assertions that encoded the
old Web UK-only upload description and generic delete warning. They now assert
Laravel's exact Resources keys. Focused Resource coverage passes 20/20,
including a five-page Arabic integration render for browse/library/upload/
discussion/delete with exact status, warning, dynamic-title, fallback, and
reaction markers. A fresh ephemeral Laravel-backed Chromium journey passed
Arabic browse, full library, and upload at HTTP 200 with exact markers,
`Content-Language: ar`, RTL, 320px reflow, and no serious/critical axe
violations (`1/1`, 32.3 seconds inside Playwright; 1.2 minutes including login
and setup). Complete verification passed 45/45 Jest suites and 1,426/1,426
tests, warning-free ESLint, branding guard, the 292-template zero-match audit,
and 608/608 route parity with 0 missing, 0 extra, and 3 ignored infrastructure
routes. Live upload/delete/reorder/comment/reaction persistence was not run
because it requires disposable mutation fixtures; this slice does not claim
those effects.

Latest Explore live-content source-parity slice: direct comparison with
`AlphaController::explore()` showed Laravel's accessible page independently
loads up to five active listings and five upcoming events through its Listing
and Event services. Web UK instead consumed `popular_listings` and
`upcoming_events` from the broad `/api/v2/explore` aggregate, so its listing
selection and all-or-nothing failure behavior were not authoritative.

Signed `/explore` now calls Laravel's exposed `/api/v2/listings?per_page=5` and
`/api/v2/events?per_page=5&when=upcoming` boundaries. It skips a source when
the routed tenant disables listings/events, suppresses each non-auth source
failure independently to an empty optional section like Blade, and retains the
tenant-mounted login handoff when either API reports 401. Existing card gates,
active-club evidence, localized headings/tags/dates, and tenant-safe links are
unchanged. Six focused Explore tests pass, covering live sections, mounted
cards/defaults, dual 503 suppression, disabled-source non-calls, and 401. A
fresh ephemeral Laravel-backed Arabic Explore journey passed HTTP 200 with
exact catalog heading/cards, `Content-Language: ar`, RTL, 320px reflow, and no
serious/critical axe violations (`1/1`, 11.2 seconds inside Playwright; 45.0
seconds including login/setup). Complete verification passed 45/45 Jest suites
and 1,429/1,429 tests, warning-free ESLint, branding guard, and 608/608 route
parity with 0 missing, 0 extra, and 3 ignored infrastructure routes. The
current live evidence recorded card/listing/event link counts without claiming
mutations.

## 2026-07-11 Full Accessibility Aggregate Recovery

The first expanded 74-case current-source aggregate exposed two real problems.
The forced-colour Arabic login case exhausted the suite's generic 30-second
ceiling while running its final axe scan, and signed Profile settings expanded
the 320px viewport to 389px. Element- and section-level browser diagnostics
localized the reflow defect to an extra `privacy_contact` checkbox. That
control and its request fields do not exist in Laravel's Blade form or
`AlphaController::updateProfileSettings()`, and its label/hint keys do not
exist in the authoritative Laravel catalogs, so Web UK rendered the raw
unbreakable key `profile_settings.privacy_contact_hint`.

Web UK now omits that non-source control and preference field, matching
Laravel's `privacy_profile` plus `privacy_search` contract. Checkbox hints also
use border-box sizing so GOV.UK's `width: 100%` plus inline padding cannot
create a reflow scrollbar on valid localized hints. The expensive
forced-colour/axe case has the same explicit 90-second budget as other measured
browser gates. When a future authenticated route does overflow, the assertion
now records the offending controls and which section removal collapses the
document width; the diagnostic path is skipped entirely on passing pages.

Focused recovery passed `631/631` contract tests and both failed browser cases.
Complete verification then passed `45/45` Jest suites and `1,429/1,429` tests,
warning-free ESLint, branding guard, CSS compilation, the 11-locale/24-
namespace/7,364-key structural audit, the 292-template zero-match audit, and
608/608 route parity with 0 missing, 0 extra parity routes, and 3 ignored
infrastructure routes. The uninterrupted live Laravel-backed Chromium/axe
aggregate passed all `74/74` cases in `1,120.8` seconds with `0` skipped, `0`
unexpected, and `0` flaky results; outer wall time was `1,138.1` seconds.
Only the pre-existing GOV.UK Sass palette deprecation warnings remain.

## 2026-07-11 Profile Settings Control And Error Parity

Direct Blade-to-Nunjucks control inventory found accessibility-critical drift
after the reflow recovery. Profile photo and language controls used Web UK-only
IDs, the personalisation checkbox posted `prefers_chronological_feed` instead
of Blade's `prefers_chronological`, account status summaries targeted Web UK-
only email/password IDs, and the account forms had no Laravel-style inline
errors. Skill/passkey limits, photo hints, location autocomplete, password
spellcheck, and biography row count also differed from the source template.

The rendered form now uses Laravel's exact control IDs, names, hint
relationships, limits, autocomplete, and password attributes for that audited
surface. Account status anchors map to `new_email`, `email_current_password`,
`current_password`, `new_password`, or `new_password_confirmation` exactly as
Blade does. Matching fields receive `govuk-form-group--error`,
`govuk-input--error`, a localized visually hidden error prefix, and the exact
error ID in `aria-describedby`. Web UK's non-source wrapper IDs were removed
so the source control IDs remain document-unique.

Focused render/localization verification passed `641/641`; the live
authenticated Arabic password-mismatch journey passed exact summary/inline
message linkage, error class and ARIA assertions, RTL, 320px reflow, and axe in
`53.7` seconds including login/setup. The first expanded aggregate correctly
caught duplicate `avatar` and `language` IDs plus an unrelated aborted Home
request. Removing the non-Laravel wrapper IDs fixed the real regression, and a
focused Home/Profile rerun passed `2/2`. The final uninterrupted current-source
Chromium/axe aggregate passed `75/75` cases in `1,187.5` seconds with `0`
skipped, `0` unexpected, and `0` flaky results; outer wall time was `1,199.0`
seconds. Complete Jest remains `45/45` suites and `1,429/1,429` tests, with
green lint, brand, catalog/template, CSS, and 608/608 route gates.

## 2026-07-11 Profile Settings Layout And Dynamic Localization

The remaining top-form structure now follows `profile-settings.blade.php`
rather than the earlier Web UK presentation. The five settings shortcuts are a
simple GOV.UK list with no invented descriptions. Photo, personal details,
public profile, privacy, and marketing are fieldsets with Blade-shaped legends,
the name controls use the source two-column grid, privacy/marketing hints and
checkbox groups use the same semantic nesting, and the status block follows
the heading/settings navigation in source order.

Profile type, privacy, language, auto-translation language, digest, and match-
frequency options now resolve the exact request-locale Laravel keys instead of
English JavaScript constants. This also corrected the English source label
from the old fallback `Irish` to Laravel's `Gaeilge`; Arabic integration
coverage asserts real localized values from all five option families. The
extra selected-value paragraphs that Blade does not render were removed.

Focused layout/browser verification passed `622/622` plus both normal and
Arabic-error Profile-settings journeys. Focused dynamic-localization coverage
passed `644/644`; complete verification passed `45/45` Jest suites and
`1,429/1,429` tests, warning-free lint, branding guard, CSS compilation, the
11-locale/24-namespace/7,364-key audit, the 292-template zero-match audit, and
608/608 route parity. The final uninterrupted exact-current Chromium/axe run
passed `75/75` in `1,148.5` seconds with `0` skipped, `0` unexpected, and `0`
flaky results; outer wall time was `1,163.7` seconds. Only the pre-existing
GOV.UK Sass palette deprecation warnings remain.

## 2026-07-11 Profile Settings Repeated Content Parity

The remaining repeated Profile-settings content now follows Blade's source
structure. Skills use the source offering/requesting tag colours and localized
endorsement counts, preserve the compact checkbox layout, and render the source
empty-state inset. Passkey cards expose localized type, added, and last-used
metadata, exact rename controls, add-new-passkey guidance, and removal inside a
warning details panel that identifies the irreversible action. Session rows map
Laravel's web, mobile, PWA, and unknown device types through the request locale,
and use source-shaped em-dash fallbacks for missing IP and activity metadata.

Focused shared rendering passed `622/622`, and the normal plus Arabic-error
Profile-settings browser journeys passed `2/2`. Complete verification passed
`45/45` Jest suites and `1,429/1,429` tests, warning-free lint, branding guard,
CSS compilation, the 11-locale/24-namespace/7,364-key audit, the 292-template
zero-match audit, and 608/608 route parity.

The first aggregate reached the end of the Arabic Goals workflow but exceeded
its old 240-second ceiling during trace/context teardown at 245.7 seconds. The
assertions were unchanged and the ceiling was raised to 300 seconds for measured
live Laravel latency. Its focused rerun passed in 2.8 minutes (4.4 minutes outer
wall time). The final uninterrupted exact-current Chromium/axe aggregate then
passed `75/75` in `1,538.9` seconds (`25.6` minutes), with `0` skipped, `0`
unexpected, and `0` flaky results; outer wall time was `1,557.7` seconds (`26.0`
minutes). Only the pre-existing GOV.UK Sass palette deprecation warnings remain.

## 2026-07-11 Profile Settings Remaining Section Structure

The language, notification, match, personalisation, safeguarding, and data/
privacy sections now finish the direct structural comparison with
`profile-settings.blade.php`. The language form uses the source profile label;
notification groups use heading-bearing legends, small checkboxes, exact
`notif_*` IDs, and a described digest select; match controls use the source
compact checkbox treatment. Safeguarding preferences now use the source card,
metadata, and warning-button structure. Data/privacy uses the source section and
heading IDs, extra-large divider, export anchor, and localized delete heading.

Focused rendering passed `622/622`; warning-free lint and the 292-template
zero-match audit passed. The current Laravel-backed normal and Arabic
Profile-settings journeys passed `2/2` in 2.0 minutes, including RTL, 320px
reflow, and axe. Complete Jest passed `45/45` suites and `1,429/1,429` tests;
branding, 11-locale/24-namespace/7,364-key structure, CSS compilation, and
608/608 route parity remain green. The latest uninterrupted full browser
aggregate remains the immediately preceding `c6c20df6` checkpoint at `75/75`;
this slice does not claim a newer full aggregate.

## 2026-07-11 Profile Notification Group Parity

The Profile-settings notification model now matches Blade's five exact groups:
messages, activity, achievements, organisation, and push. Their headings and
all 16 option labels resolve from the request-locale Laravel catalog instead of
three invented English-only Web UK groups. The settings shortcuts are now the
same plain list Blade renders, without the extra navigation landmark, and the
skill-name-required summary links to Blade's `#skills` section target.

Focused shared rendering passed `622/622`. The strengthened live Arabic journey
asserts the localized messages-group heading and direct-message option, rejects
the former invented English group names, and passed RTL, 320px reflow, and axe
in `1.0` minute. The normal plus Arabic Profile-settings pair also passed `2/2`
in `2.0` minutes.

Complete verification passed `45/45` Jest suites and `1,429/1,429` tests,
warning-free lint, branding guard, CSS compilation, the 11-locale/24-namespace/
7,364-key audit, the 292-template zero-match audit, and 608/608 route parity.
The final uninterrupted exact-current Chromium/axe aggregate passed `75/75` in
`1,423.4` seconds (`23.7` minutes), with `0` skipped, `0` unexpected, and `0`
flaky results; outer wall time was `1,441.2` seconds (`24.0` minutes). Only the
pre-existing GOV.UK Sass palette deprecation warnings remain.

## 2026-07-11 Shared Header Navigation Semantics

The shared header now follows Blade's tenant and current-page semantics. The
service-navigation landmark is omitted on the no-tenant community chooser but
retained on tenant-mounted pages. Active Sign in and Register items use Blade's
strong active fallback. The My account header link is current for the complete
Blade account family: account, profile, messages, connections, wallet, matches,
group exchanges, achievements, leaderboard, and NEXUS score routes. Both the
path-derived state and route-supplied `activeNav` values are covered.

Focused shared-shell rendering passed `623/623`. The strengthened live gate
passed tenant Home `1/1` in 16.8 seconds and normal plus Arabic Profile settings
`2/2` in 1.7 minutes; it asserts tenant service navigation and the current My
account link in addition to structure, RTL/reflow, and axe. Complete Jest passed
`45/45` suites and `1,430/1,430` tests with warning-free lint, branding guard,
the 292-template zero-match audit, and 608/608 route parity. The latest full
browser aggregate remains checkpoint `d86d5e5a` at `75/75`; this focused shell
slice does not claim a newer full aggregate.

## 2026-07-11 Tenant-Scoped Footer Locals

Shell-local navigation and footer construction now follows the controller's
early return when no tenant slug is resolved. The community chooser no longer
inherits default-enabled Platform, Support, or Legal columns, report-problem/
cookie utilities, or a sign-out form. Tenant-mounted pages retain all localized
columns and utilities. The underlying locals are empty as well as the rendered
landmarks being absent, so downstream templates cannot accidentally expose the
tenant-only links.

This correction exposed four tests whose broad text assertions were passing on
unrelated footer words. They now assert the actual page control or category
option; the localized footer partial harness now supplies the tenant context its
fixture represents. Focused shell/partial verification passed `638/638`.

A new real-browser tenant-chooser case passed `1/1` in 17.3 seconds, proving one
main/H1, no tenant-only service/footer navigation or report-problem link, no
horizontal overflow, and no serious/critical axe findings. Complete Jest passed
`45/45` suites and `1,430/1,430` tests with warning-free lint, branding, locale/
template audits, CSS, and 608/608 route parity. The uninterrupted exact-current
full Chromium/axe aggregate passed all `76/76` cases in `1,547.0` seconds
(`25.8` minutes), with `0` skipped, `0` unexpected, and `0` flaky results;
outer wall time was `1,569.5` seconds (`26.2` minutes).

## 2026-07-11 Saved Family Source-Parity Slice

The saved-appreciation wall now follows the authoritative Blade page rather
than its earlier English approximation. Caption, heading, description, send
form, status/error states, empty state, dates, reaction counts/actions, and
pagination all resolve through the exact `govuk_alpha_saved` keys. The form
now enforces Blade's 500-character client limit instead of 1,000, exposes the
public-choice hint through a fieldset and `aria-describedby`, and links the
message error summary to the styled inline error. Reaction controls now have a
source legend, localized action labels, and `aria-pressed` state; the selected
reaction uses Blade's primary-button treatment. Saved collection previous/next
pagination labels use the same source keys.

Focused source/localization coverage passed `3/3`; the Laravel-backed saved
social route test and full `623/623` shared rendering passed. The real signed
`/users/77/appreciations` journey passed `1/1` in 39.4 seconds at 320 CSS
pixels with one main/H1, no horizontal overflow, and no serious/critical axe
violations. Full verification passed `45/45` Jest suites and `1,430/1,430`
tests, warning-free lint and brand checks, 11-locale/24-namespace/7,364-key
structural parity, the 292-template zero-match audit, and 608/608 route parity.
At that appreciation-only checkpoint, the next complete browser aggregate
contained 77 cases; the later saved-family expansion below supersedes that
inventory. The latest completed full aggregate remains the exact-current
`cdc8674d` 76/76 checkpoint recorded above.

The follow-up completed the visible saved-items, collection index/detail, and
public-collection source reconciliation. Those pages now use the exact
`saved`, `polish_discovery`, and `govuk_alpha_saved` keys for captions, filters,
types, removal actions, collection counts/visibility, create/edit/delete
controls, validation/status states, saved dates, empty states, and pagination.
Request-localized plurals replace English counts created in route code, and
translated type labels replace JavaScript label tables. The non-Blade saved
removal banner was removed rather than preserved as invented presentation.
Blank member, collection, and appreciation-sender names now fall back in the
template through Laravel's source keys. Collection pagination also restores
Blade's previous/next icons.

Real signed 320px browser proof passed saved items `1/1` in 46.9 seconds and
the new my/public collection cases `2/2` within a three-case 1.7-minute run
(the grep also selected the already-certified badge-collections case). Every
new case retained one main/H1, reflowed without horizontal overflow, and had no
serious/critical axe findings. Full verification remains `45/45` Jest suites
and `1,430/1,430` tests with green lint, brand, locale/template audits, CSS,
and 608/608 route parity. The first expanded aggregate exposed two latent
30-second ceilings on Arabic register and the two-page connections journey;
the second exposed a 90-second ceiling on Arabic Profile settings after live
Laravel latency consumed the budget. Each failing case passed focused with
unchanged assertions after route-appropriate ceilings were committed. The
third uninterrupted aggregate then passed all `80/80` cases in `1,610.1`
seconds (`26.8` minutes), with `0` skipped, `0` unexpected, and `0` flaky;
outer wall time was `1,632.4` seconds (`27.2` minutes).

## 2026-07-11 Cursor Pagination Source Labels

Exchanges, group-conversation history, volunteering my-organisations, and the
four jobs browse/saved/applications/mine cursor blocks now use their exact
Blade-owned landmark and continuation labels. Exchanges also restores Blade's
next-arrow icon. Focused source proof passed `1/1`, seven Laravel-backed route
renders passed, lint and the 292-template audit stayed green, and the full Jest
gate passed `45/45` suites and `1,431/1,431` tests. No new locale-specific
browser case was added; the exact-current browser baseline remains 80/80.

## 2026-07-11 Default-English Empty-State Certification

Events, Listings, Groups, and type-filtered Search empty results now follow
their default-English Laravel Blade content and action rules instead of Web
UK-only create/sign-in actions or duplicate result cards. The focused signed
Search empty-state browser gate passed `1/1` in `33.1` seconds, proving one
main/H1, unique IDs, 320px reflow, and no serious/critical axe violations.
This is a focused 81st case; the latest uninterrupted full aggregate remains
checkpoint `ea1ed6d4` at `80/80`, and no newer aggregate is claimed.

## 2026-07-11 Event And Group Back-Link Parity

Event and Group detail/edit pages now match Blade's single GOV.UK back-link
pattern and exact request-localized labels. The former multi-item breadcrumbs
and generic Edit crumb were Web UK inventions. Focused source and Laravel-
shaped renders passed `3/3`; full Jest passed `45/45` suites and `1,441/1,441`
tests, with green lint, branding guard, and a `291`-template localization audit
with zero conservative matches.

The follow-up removed the same invented breadcrumb treatment from Listings,
Messages, and Notifications. Blade renders no local navigation above their
index pages; Listing create/edit/detail and direct Conversation now use the
single source back link with the exact request-localized label and destination.
Focused source proof passed `1/1`; full Jest passed `45/45` suites and
`1,442/1,442` tests, with green lint, branding guard, and the unchanged
`291`-template zero-match localization audit.

The final breadcrumb inventory found one duplicate trail above the direct-
conversation page and no valid active caller for the generic breadcrumb
partial. The active Laravel-backed KB is `/kb` via `src/routes/kb.js`; the
unmounted `knowledge-base.js` router and its two stale templates referenced
nonexistent helper names and legacy `/knowledge-base` paths. Those three dead
files and the now-zero-caller breadcrumb partial were removed, with source
guards preventing their restoration. Focused proof passed `3/3`; full Jest
passed `45/45` suites and `1,443/1,443` tests, with green lint, branding, and a
`288`-template localization audit with zero conservative matches.

The next zero-caller audit removed `partials/loading.njk` and the generic
`partials/empty-state.njk`; the latter was referenced only by the deliberately
unmounted `groups/my.njk`, which was removed with it. The existing route gate
still proves `/groups/my` and its legacy member-management family return 404.
The first full run exposed one stale test inventory entry for `groups/my.njk`;
that concrete regression was corrected and the rerun passed `45/45` suites and
`1,444/1,444` tests. Lint and branding remain green, and the localization audit
now covers `285` active templates with zero conservative matches.

## 2026-07-11 Disposable Listing Mutation Certification

`npm run smoke:laravel:listings-mutation` now creates a uniquely named Listing
through the Web UK multipart form, uploads a disposable PNG, verifies the
Laravel API row and image URL, edits the title without selecting a replacement
image, verifies the uploaded file returns HTTP 200 from Laravel's origin,
deletes through the rendered warning form, and proves final API absence. A
`finally` path deletes either title directly through Laravel if any assertion
fails. The terminal run passed `1/1` in `80.6` seconds and retained no fixture.

The first attempts exposed harness selectors before creation, then one real
application regression: browsers submit an unnamed empty file part on the
multipart edit form, and the shared parser rejected it before the route could
preserve the existing image. Multipart parsing now filters only unnamed file
placeholders while retaining real-file size/MIME validation. The live trace
also exposed backend-relative `/uploads/...` image URLs resolving against Web
UK and returning 404; Listing edit now resolves same-origin Laravel assets
through the existing safe backend URL helper. Full verification passed `45/45`
Jest suites and `1,445/1,445` tests with green lint.

The default-English create/edit form follow-up replaces Web UK-authored form
chrome with Blade's exact request-localized captions, headings, descriptions,
intent labels, field labels/hints, delivery-mode values, image treatment,
skill copy, and publish/save labels. Default tenant copy is exact; only tenants
that override minimum lengths or upload size receive an appended configured
constraint so client guidance remains truthful. Focused source/render proof
passed `3/3`; full Jest passed `45/45` suites and `1,446/1,446` tests with green
lint.

The default-English detail follow-up now matches Blade's caption/title/type,
featured and delivery badges, safely resolved hero image, separate description
section, and source-shaped listing-information summary. Internal ID/title/
description/updated rows, raw type/status values, generic Edit copy, and the
duplicate bottom back link were removed. Focused source/render proof passed
`3/3`; full Jest passed `45/45` suites and `1,447/1,447` tests. The exact-current
disposable create/upload/edit/detail/delete journey also passed `1/1` in `85.2`
seconds and retained no fixture.

The disposable journey now runs at 320 CSS pixels and additionally proves one
main/H1, unique IDs, no horizontal overflow, and no serious/critical axe
violations on both the created Listing detail and populated edit form. The
strengthened exact-current run passed `1/1` in `83.4` seconds and retained no
fixture. This is automated browser evidence, not a claim of manual screen-
reader or assistive-technology certification.

## 2026-07-11 Disposable Event Mutation Certification

`npm run smoke:laravel:events-mutation` creates a uniquely named future Event
through Web UK, verifies it in Laravel, edits it, proves the owner-only manage
controls are rendered from the signed profile or Laravel capability flag,
deletes it through the no-JavaScript disclosure, and proves final API absence.
The terminal run passed `1/1` in `54.4` seconds and retained no fixture; direct
Laravel cleanup remains the failure fallback. Full Jest passed `45/45` suites
and `1,448/1,448` tests, with green lint.

The default-English create/edit follow-up now matches Blade's community and
event captions, page descriptions, section legends and ordering, catalog field
copy, image treatment, recurrence labels, and single submit action. Invented
group selectors and cancel links were removed from both forms. Focused Event
render/source proof passed `46/46`; the exact-current create/edit/delete journey
passed `1/1` in `1.3` minutes and retained no fixture; full Jest remained
`45/45` suites and `1,448/1,448` tests with green lint. Blade's current-cover
removal checkbox remains withheld because Laravel v2 exposes Event image upload
but no equivalent image-removal endpoint; rendering a non-functional control
would overstate workflow parity.

The default-English detail follow-up replaces Web UK-authored Upcoming/Past,
combined date, Group, Capacity, and "About this event" presentation with
Blade's Event details caption, full/places-left state, Description section, and
Event information rows for Starts, Ends, Location, safe online/attendee-only
video links, organiser, category, Going, and Interested. Cancellation reasons
and cover alt text now use the source catalog; external event links are limited
to HTTP/HTTPS and rendered through auto-escaped markup. Focused render/source
proof passed `10/10`; the strengthened Laravel lifecycle passed `1/1` in `1.1`
minutes and proved the created detail structure before edit/delete. Full Jest
passed `45/45` suites and `1,449/1,449` tests with green lint.

The same disposable Event journey now runs at 320 CSS pixels and proves one
main/H1, unique IDs, no horizontal overflow, and no serious/critical axe
violations on the created detail and populated edit form. The strengthened run
passed `1/1` in `2.4` minutes and retained no fixture. This is automated browser
evidence, not a claim of manual screen-reader or assistive-technology review.

The default-English index now matches Blade's community caption/description,
browse link, signed/signed-out creation guidance, filter fieldset, category and
stored-location radius filters, result count, card-list metadata/copy, and
block pagination. Invented status tags, group filtering, and card chrome were
removed. Focused Event/API/source proof passed `43/43`; full Jest passed `45/45`
suites and `1,451/1,451` tests with green lint. A current-source signed Laravel
smoke rendered `/events` with `200`; the current unsigned tenant-mounted page
also renders `200` with the full Blade shell and accessible load-error state.
Laravel's live `/api/v2/events` still returns `401` without a token even though
the Blade controller declares Event browse public, so anonymous Event rows
remain an upstream Laravel contract blocker rather than a Web UK claim.

## 2026-07-11 Disposable Group Mutation Certification

`npm run smoke:laravel:groups-mutation` creates a uniquely named private Group
through Web UK, verifies it in Laravel, edits it, and deletes it through the
visible no-JavaScript confirmation before proving final API absence. The live
contract reports the creator as an active `admin` membership plus `owner_id`;
Web UK now derives ownership from either Laravel signal, so ordinary group
admins can edit but only the owner sees and replays the destructive flow. The
terminal 320 CSS pixel run passed `1/1` in `69.5` seconds with one main/H1,
unique IDs, no horizontal overflow, and no serious/critical axe violations on
detail and edit; no fixture remained. Full Jest passed `45/45` suites and
`1,452/1,452` tests, with green lint. Manual assistive-technology review and
ASP.NET switching proof remain open.

The default-English create/edit follow-up now matches Blade's community/group
captions, page descriptions, name hint, five-row description, location and
visibility controls, comma-separated tag field, optional cover upload, and
single submit action; the invented cancel links were removed. Multipart parsing
runs before CSRF protection, and cover upload is a best-effort secondary action
after the group exists, so an image failure cannot falsely replay creation.
The strengthened disposable lifecycle passed `1/1` in `111.2` seconds with a
real PNG cover persisted through Laravel, create-time tag text, edit/delete,
320 CSS pixel structural/reflow/axe checks, and final absence. Focused proof
passed `752/752`; full Jest passed `45/45` suites and `1,452/1,452` tests with
green lint. Laravel's accessible edit controller submits `tags`, but the
current read-only `GroupService::update()` allowlist discards that field and
the v2 detail contract omits tags; edit-tag persistence is therefore an
upstream Laravel limitation, not certified Web UK behavior.

The default-English index follow-up replaces the invented flex header,
placeholder-only search, clickable card grid, Joined tag, and English-authored
pagination with Blade's community caption, description, create action, labelled
search/hint, `all|joined|public|private` filter, visibility-tagged card list,
localized member count, 160-character description treatment, and source
pagination labels. The route sends those exact filters to Laravel's v2 group
index and no longer makes a redundant second my-groups request. The disposable
lifecycle now proves the created group through the real `filter=joined` index
at 320 CSS pixels before edit/delete; it passed `1/1` in `135.7` seconds with
no retained fixture. Focused proof passed `752/752`; full Jest passed `45/45`
suites and `1,452/1,452` tests, with green lint.

The default-English detail follow-up now matches Blade's community caption,
public/private heading tag, no-border visibility/member/location/created
summary, member/pending/join states, discussions/notification/files links, and
edit/manage/invite/image admin actions. Invented creator/report content,
private-group contact guidance, avatar-role roster, and generic event copy were
removed; private non-members now receive Laravel's real join-request action.
The Group event heading/description/access/empty/card states use the source
catalog and hierarchy. A new focused pending/private role regression brings
the focused gate to `753/753` and full Jest to `1,453/1,453` across `45/45`
suites. The disposable lifecycle passed `1/1` in `152.6` seconds with the new
detail controls and 320 CSS pixel checks, and retained no fixture; lint is
green. Pinned announcements, subgroups, and the embedded group-feed composer/
timeline remain separate detail-depth gaps.

## 2026-07-11 Saved Search Mutation Blocker

A disposable Web UK saved-search create/delete gate was attempted and removed
before publication because Laravel rejected the create boundary before any row
was inserted. Both the browser POST and a direct authenticated
`POST /api/v2/search/saved` returned `500`; the current Laravel log identifies
`SearchController::saveSearch()` calling nonexistent method `getJsonInput()` at
line 206. No fixture or side effect remained. Web UK's request shape matches the
declared v2 contract, so live saved-search mutation certification is blocked
until the read-only Laravel endpoint parses JSON through an available request
helper; do not misreport the current mock coverage as persistence proof.

## 2026-07-12 Group File Lifecycle Certification

The disposable Laravel-backed Group lifecycle now uploads a uniquely named
text file through Web UK, proves the listing, downloads it with exact byte
equality, deletes it through Web UK, and proves the row absent before editing
and deleting the parent group. The `1/1` run passed in `185.8` seconds and left
no fixture. Its first attempt exposed page-level overflow at 320 CSS pixels;
the five-column Blade-style file table is now contained in a labelled,
keyboard-focusable horizontal scroll region, with source regression coverage.
This certifies one real member/uploader path, not every role, tenant gate,
manual assistive-technology behavior, or ASP.NET compatibility.

## 2026-07-12 Group Announcement Lifecycle Certification

The same disposable owner-group gate now creates an announcement, proves its
persisted content, loads and submits the populated edit form, proves the
updated content, pins it, proves the pinned state, deletes it, and proves final
absence before deleting the parent group. The expanded `1/1` Laravel-backed
run passed in `159.8` seconds at 320 CSS pixels with structural, reflow, and
serious/critical axe assertions and retained no fixture. This certifies the
owner path only; active-member/non-admin behavior, tenant gates, manual
assistive-technology depth, and ASP.NET compatibility remain open.

## 2026-07-12 Group Discussion Contract And Lifecycle

The real Laravel-backed discussion journey exposed a mock-hidden contract bug:
Web UK requested nonexistent `GET /api/v2/groups/{group}/discussions/{id}/messages`
and expected `items`, while Laravel declares `GET .../discussions/{id}` and
returns `data.discussion` plus `data.messages`. Web UK now matches that read
contract; reply POST correctly remains on `.../{id}/messages`. The expanded
disposable gate passed `1/1` in `249.6` seconds after creating a discussion,
proving Laravel's initial-message count, posting and proving a reply, checking
the updated index count, passing 320 CSS pixel structural/reflow/axe checks,
and deleting the parent group with no retained fixture. Non-owner active-member
behavior, tenant gates, manual assistive-technology depth, and ASP.NET
compatibility remain open.

## 2026-07-12 Group Notification Preference Lifecycle

The disposable active-owner group gate now selects digest frequency, disables
email, retains push, submits the real Laravel preference update through Web
UK, and proves all three values from the redirected Laravel-backed read. The
expanded `1/1` run passed in `178.2` seconds at 320 CSS pixels with structural,
reflow, and serious/critical axe assertions; parent-group deletion retained no
fixture. This certifies the active-owner path only. Non-owner active-member
authorization, tenant gates, manual assistive-technology depth, and ASP.NET
compatibility remain open.

## 2026-07-12 Group Invite-Link Lifecycle

The disposable owner gate now generates a seven-day invite link, proves its
pending row and real ID, revokes it, and proves final absence before deleting
the parent group. The first live run exposed the four-column pending table
expanding a 320 CSS pixel page to 345 pixels; it is now contained in a labelled,
keyboard-focusable horizontal scroll region with source regression coverage.
The corrected `1/1` run passed in `193.5` seconds with structural, reflow, and
serious/critical axe assertions and retained no fixture. Email delivery,
non-owner role behavior, tenant gates, manual assistive-technology depth, and
ASP.NET compatibility remain open.

## 2026-07-12 Group Avatar Upload Lifecycle

The disposable owner-group gate already created a persisted PNG cover and now
also uploads a separate PNG avatar through the dedicated Group images page,
proves the rendered current-avatar image, and confirms Laravel's persisted
group-detail field. The expanded `1/1` run passed in `230.1` seconds at 320 CSS
pixels with structural, reflow, and serious/critical axe assertions, then
deleted the group with no retained fixture. Group-admin/platform-admin live
uploads, tenant gates, manual assistive-technology depth, and ASP.NET
compatibility remain open.

## 2026-07-12 Appearance Persistence And Restoration

The live gate now captures the E2E user's current theme, selects a different
theme through Web UK, proves the success state and Laravel-backed redirected
read, then restores the original theme through Web UK. An API-level restoration
fallback runs in `finally` before the independent group-fixture cleanup. The
aggregate `1/1` run passed in `256.2` seconds at 320 CSS pixels with structural,
reflow, and serious/critical axe assertions; the shared user finished unchanged.
Tenant-domain routing, localization, manual assistive-technology depth, and
ASP.NET compatibility remain open.

## 2026-07-12 Disposable Poll Lifecycle

The guarded live gate creates a uniquely named standard poll, proves it through
Laravel's mine collection, votes and proves the selected option, likes and
proves pressed state, comments and proves the rendered content, then deletes it
through the warning action and proves API absence. It then creates a ranked
poll, submits a ranking, proves the persisted success and results state, and
deletes it with a second API-absence check. The run exposed that
Laravel's Poll detail omits likes even though `/feed/like` mutates them; Web UK
now non-fatally enriches detail from Laravel's feed-item `likes_count` and
`is_liked` fields. The expanded `1/1` run passed in `366.6` seconds at 320 CSS
pixels with structural, reflow, and serious/critical axe assertions. Theme
restoration completed and no poll or group fixture remained. Broader owner
authorization, feature gates, manual assistive-technology depth, and ASP.NET
compatibility remain open.

## 2026-07-12 Disposable Podcast Draft Lifecycle

The guarded gate creates and updates a uniquely named private draft show,
uploads a tiny valid WAV episode, proves its manage row and real ID, fetches
Laravel's returned audio URL with bearer auth, and proves exact byte equality.
It then deletes the episode and proves row absence, deletes the show, and proves
final `/mine` absence. Direct show DELETE is nested in `finally` independently
of Poll and Group cleanup. The expanded `1/1` run passed in `324.2` seconds at
320 CSS pixels with structural, reflow, and serious/critical axe assertions;
no Podcast, Poll, or Group fixture remained and the shared theme was restored.
Publish/moderation, subscribe behavior, author-role depth, manual
assistive-technology review, and ASP.NET compatibility remain open.

## Historical Document Order (Superseded)

At this checkpoint, readers used the following order. It is not the current
resume order; the archive notice at the top of this file governs.

1. `apps/web-uk/AGENTS.md`
2. `apps/web-uk/CLAUDE.md`
3. `apps/web-uk/README.md`
4. `apps/web-uk/docs/ACCESSIBLE_SHARED_FRONTEND.md`
5. `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
6. `apps/web-uk/docs/generated/accessible-route-matrix.md`
7. `apps/web-uk/docs/generated/accessible-route-matrix.json`
8. `apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md`
9. `apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md`

Treat `FRONTEND_BUILD_LOG.md` and `FRONTEND_AUDIT_REPORT.md` as historical
context unless a current handoff explicitly says otherwise.

## Historical Certification Table (Superseded)

This was the checkpoint's table shape. Do not use it for current scoring; use
the fixed rubric and queue in `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

| Family | Route declared | Blade layout ported | Laravel API-backed | Mock-tested | Laravel runtime-smoked | ASP.NET-smoked |
| --- | --- | --- | --- | --- | --- | --- |
| Example | yes/no | yes/no/partial | yes/no/partial | yes/no | yes/no | yes/no |

Do not mark a family complete unless the answer is "yes" through Laravel
runtime smoke. Do not mark shared-backend readiness unless ASP.NET smoke is also
yes.

## Historical Completion Checklist (Superseded)

A route family is not complete until all of these are true:

- Every Laravel accessible method/path declaration exists locally.
- Remaining `laravel-prep-pages.js` matches for that family are replaced with
  real route modules and Nunjucks views.
- The Nunjucks page follows the Laravel Blade layout, page intent, form flow,
  content hierarchy, status banners, empty states, and error states.
- Unsigned, signed, unauthorized, not-found, and feature-disabled states match
  Laravel behavior.
- API calls use Laravel-compatible endpoints and payloads.
- POST, upload, delete, and redirect side effects are covered.
- Mocked Jest coverage proves the no-JS route behavior.
- Runtime smoke tests prove the page works against the local Laravel backend.
- ASP.NET switching gaps are documented in `BACKEND_SWITCHING_CONTRACT.md`.
- The generated route matrix and port audit are refreshed.

## 2026-07-12 Disposable Goal Lifecycle

The dedicated default-English Laravel gate creates a unique private goal,
proves it through the API-backed index, edits its title and check-in cadence,
records and renders a 40% check-in with mood and note, sets and removes a weekly
reminder, persists a like, creates an own comment and nested reply, warning-
deletes the reply then parent, then deletes the goal and proves API absence.
The run exposed that Laravel creates
goals without feed-activity rows, so the single feed-item read is 404; Web UK
now falls back to Laravel's authenticated liker IDs/count instead of a
nonexistent Goal social API. Independent `finally` cleanup protects failed
runs. The expanded `1/1` run passed in `200.5` seconds at 320 CSS pixels with
structural, reflow, and serious/critical axe assertions. Buddy effects,
tenant feature-gate depth, manual assistive-technology review, and ASP.NET
compatibility remain open.

## 2026-07-12 Disposable Saved-Collection Item Lifecycle

The existing saved-collections gate now adds an existing tenant listing to its
unique private SOC10 collection, proves the rendered no-JavaScript remove form,
submits removal through Web UK, verifies the saved-item row is absent from
Laravel, then deletes the collection and proves final absence. The listing and
all pre-existing saves are untouched; independent `finally` cleanup remains in
place. Together with flat BookmarkService removal, the expanded gate passed
`2/2` in `82.9` seconds. Appreciation/reaction effects, tenant feature-gate
depth, manual assistive-technology review, and ASP.NET compatibility remain
open.

## 2026-07-12 Disposable Marketplace Listing Lifecycle

The dedicated default-English Laravel gate creates a uniquely named free
marketplace listing with a real PNG, verifies Laravel's image row and rendered
image, edits and deletes it, then creates a unique seller pickup slot, edits
its time, capacity, recurrence and active state, and deletes it. Both flows
check 320 CSS pixel structure, reflow, and serious/critical axe findings and
prove final Laravel absence with independent API cleanup. The slot run exposed
and fixed unchecked `is_active` edits being forced back to true while
preserving create's default-active behavior. The expanded `2/2` run passed in
`119.9` seconds and retained no fixture. The local tenant explicitly disables
merchant coupons, so that mutation remains fixture-blocked. Hosted checkout,
offer/order/coupon depth, merchant profile-image uploads, manual assistive-
technology review, and ASP.NET compatibility remain open.

## 2026-07-12 Disposable Event Cover And RSVP Lifecycle

The default-English event gate now uploads a real PNG while creating its
unique event, verifies Laravel's persisted cover, fetches the image
successfully, proves rendered visibility, then continues through edit,
`going`, `interested`, and `not_going` RSVP transitions, 320-pixel
structure/reflow/axe, delete, and final absence. Event detail independently
confirms every persisted status; Laravel's attendee collection intentionally
contains only `going` and `interested` rows, while `not_going` remains visible
as the current user's detail state. The first run exposed
backend-relative `/uploads/...` covers being requested from Web UK's origin;
event list/detail/edit now resolve them only against the configured backend
origin. The expanded `1/1` run passed in `86.3` seconds and retained no
fixture. Cover removal remains blocked because Laravel exposes upload but no
removal endpoint; polls/waitlist/series/broader attendee/check-in depth, manual review,
tenant gates, and ASP.NET compatibility remain open.

## 2026-07-12 Disposable Volunteering Credential Lifecycle

The dedicated Laravel gate now proves a complete disposable lifecycle: upload a
uniquely named PDF, verify its pending row, pass 320 CSS pixel structure/reflow
and serious/critical axe checks, download it through Web UK with byte equality,
delete it, and prove final Laravel absence. The download extension exposed wide
table overflow propagation; the reusable scroll region now has layout/paint
containment while retaining keyboard-focusable horizontal scrolling. The final
`1/1` run passed in `54.9` seconds and retained no credential. Tenant gate depth,
manual assistive-technology review, and ASP.NET compatibility remain open.

## Known Remaining Work

Prioritize visual/manual Blade parity, page-level feature-disabled behavior, and
ASP.NET switching proof over adding more skeleton pages.

1. Rerun the refresh protocol and confirm whether the current web-uk process has
   Laravel tenant context (`TENANT_ID=2` for the local E2E fixture).
   If `http://127.0.0.1:8088` times out, start or repair local Laravel before
   treating live smoke status as current evidence.
2. Keep the full default Laravel smoke scope green with chunked/bucketed runs
   when local Laravel is too slow or stateful for one all-in-one command.
3. Convert "partial Laravel-backed candidate" route families into certified
   families using the certification table above.
4. Add remaining route-specific workflow gate proof beyond the broad
   route-level module/feature gates. Maps, organisation jobs, group-message
   connection gates, and message translation policy now have focused Jest
   proof, the Clubs route now has active-club 404 proof, and Explore-card
   active-club sourcing now uses live Laravel-backed club evidence. Broker
   workflow-disabled listing exchange requests now have focused Jest/source
   proof; a live disabled-tenant Laravel fixture is still not certified.
5. Finish localization beyond the conservative static-value pass: reconcile
   contextual route titles, headings, validation/status copy, ARIA labels, and
   residual strings; keep catalog structural parity green; obtain authoritative
   translations for the 16 fully English-identical Laravel namespaces; and
   keep the expanded automated gate green while completing the recorded manual
   RTL/accessibility pass.
6. Keep `BACKEND_SWITCHING_CONTRACT.md` honest: ASP.NET target remains
   future/not-certified until proven.
7. Refresh generated route matrix files after route changes.
8. Mark stale historical docs as historical rather than relying on them for
   current status.

## Scoring Guide

Use scores only as working estimates. They are not a substitute for acceptance
criteria.

| Range | Meaning |
| --- | --- |
| `0-300` | Shell or route inventory only |
| `300-600` | Many declarations and skeletons exist, limited Laravel-backed behavior |
| `600-800` | Most routes declared, many pages Laravel-backed, runtime certification incomplete |
| `800-950` | Few prep pages remain, route families mostly runtime-smoked against Laravel |
| `950-1000` | All families certified against Laravel, ASP.NET switching proof complete, docs and tests green |

The former `998.9/1000` implementation and `992.4/1000` green-confidence
estimates are superseded by `../../../docs/FULL_PARITY_REMEDIATION_RUNBOOK.md`.
No new score is issued for the localization slice in isolation. Catalog
structure, locale plumbing, and broad safe template wiring improved, but the
authoritative untranslated catalog values, contextual copy review,
authenticated/error/upload/destructive browser coverage, manual
accessibility/RTL review, and ASP.NET switching proof keep the completion gate
open.

## 2026-07-12 Default-English Organisations Browse Parity

Organisations browse now follows the Laravel Blade source instead of its older
Web UK presentation: catalog-backed default-English copy, plain action links,
the source search spacing, small card headings, semantic inline statistics,
rating progress, exact empty/error states, and block cursor pagination. The
Manage link is derived from active/approved owner/admin rows returned by
Laravel's signed `my-organisations` contract; failure of that secondary read
does not hide otherwise available directory results.

Focused success, empty-search, directory-failure, and partial-manage-failure
proof passed `2/2`. Full Jest passed `45/45` suites and `1,455/1,455` tests;
lint and the 285-template zero-match localization audit passed. A scoped signed
Laravel page check rendered `/organisations/browse` with `200` and the expected
heading. The overall smoke result was not green because its separate anonymous
Laravel API reachability preflight still receives the known `401`. The latest
route regeneration found `608` matches and two newly added, unrelated Profile
safeguarding POST routes still missing from Web UK; no 610/610 claim is made.

## 2026-07-12 Safeguarding Profile Route Reconciliation

Laravel added two Profile safeguarding POST routes after the preceding slice.
Web UK now renders the matching policy-review and private vetting-status controls
and forwards only empty requests to Laravel's dedicated v2 confirmation and
broker-review endpoints. Unexpected fields and multipart evidence are rejected
before Laravel; policy-unavailable `409` responses map to the exact settings
state. No live POST was made because review requests notify decision-makers and
policy confirmation changes active preference state.

Focused render/action/error/evidence proof passed `3/3`. The route matrix is
again `610/610` with zero missing or extra parity routes and zero generated prep
pages. Full Jest passed `45/45` suites and `1,456/1,456` tests; lint, catalog
structure (`11` locales, `24` namespaces, `7,402` keys), and the 285-template
zero-match audit passed. A signed read-only Laravel page check rendered
`/profile/settings` with `200` and the new vetting heading. The smoke remained
globally red only because its independent anonymous Laravel API preflight still
receives the known `401`.

## 2026-07-12 Default-English Organisation Volunteer Roster

The owner roster now matches Blade's catalog-backed back link, XL organisation
caption, description and empty guidance, exact Name/Email/Total hours/Roles/
Joined columns, two-decimal hour formatting, semantic joined date, localized
unknown-member fallback, and load-more copy. The existing Laravel API paths and
read-only owner workflow are unchanged.

Focused owner-page proof passed; full Jest remained `45/45` suites and
`1,456/1,456` tests with green lint and zero template-localization matches. A
signed Laravel-backed roster passed a focused default-English 320-pixel browser
gate (`1/1` in `26.5` seconds) with valid structure, no document overflow, and
no serious/critical axe findings. It is a focused case, not a new full-browser
aggregate claim. Live owner-role variations, the remaining owner pages, manual
assistive-technology review, and ASP.NET compatibility remain open.

## 2026-07-12 Default-English Emergency Alert Parity

Emergency alerts now match Blade's catalog-backed default-English title,
description, labels, priorities, warning, actions, response states, empty state,
and safeguarding error outcomes. The Web UK-only cursor control was removed
because the Blade page does not expose pagination. Focused render/action/error
proof passed, including policy-unavailable mapping. No live response was sent
because it changes shared alert state and may notify a coordinator.

The full aggregate passed `45/45` suites and `1,456/1,456` tests; lint and the
285-template zero-match localization audit also passed. Safe disposable live
fixtures, manual assistive-technology review, and ASP.NET compatibility remain
open.

## 2026-07-12 Default-English Organisation Dashboard Parity

The volunteering organisation dashboard now matches Blade's catalog-backed
summary copy, pending-approval warning, six activity figures, wallet
reconciliation note, and management-link labels. The older Web UK-only
auto-pay badge was removed from this page. The existing signed-manager test
passes across dashboard, manage, settings, roster, and wallet.

Full Jest remains `45/45` suites and `1,456/1,456` tests; lint and the
285-template zero-match localization audit passed. Live owner-role variations,
manual assistive-technology review, and ASP.NET compatibility remain open.

## 2026-07-12 Default-English Organisation Settings Parity

Organisation settings now matches Blade's catalog-backed form, hint, action,
success, failure, and field-error copy. Empty names and malformed non-empty
contact emails fail before Laravel; valid values are trimmed and forwarded to
the existing organisation update API. Focused owner-page and mutation proof
passed, and full Jest remains `45/45` suites and `1,456/1,456` tests with green
lint and the 285-template zero-match localization audit.

Live persistence is still open: Laravel exposes no organisation-delete API, so
a newly created test organisation cannot currently be cleaned up through the
product contract. No shared managed organisation was mutated merely to claim
runtime proof.

## 2026-07-12 Default-English Organisation Wallet Parity

The organisation wallet now matches Blade's catalog-backed balance,
automatic-credit explanation, deposit warning/form, and recent-transaction
presentation. The ASP.NET-specific auto-pay toggle has been removed. Its
legacy compatibility POST now performs only an owner-scoped stats read and
returns Laravel's informational “crediting is always on” status; it no longer
calls a mutable auto-pay API.

Focused owner-page/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. A
live deposit remains open because it irreversibly moves real wallet value and
there is no residue-free wallet fixture.

## 2026-07-12 Default-English Organisation Review Queue

The organisation manage page now matches Blade's catalog-backed application
and hour decisions, empty guidance, action hints, applicant context in button
names, and automatic-credit warning. Safeguarding-policy unavailable,
contact-restricted, and vetting-required API failures now map to their specific
safe error states instead of the generic application failure.

Focused owner render/action/error proof passed. Full Jest remains `45/45`
suites and `1,456/1,456` tests with green lint and the 285-template zero-match
audit. No live approval or decline was submitted because there is no disposable
pending application/hour fixture.

## 2026-07-12 Authenticated Owner Accessibility Sample

The default-English authenticated browser gate now includes organisation
dashboard, review queue, settings, wallet, and roster. A fresh current-checkout
Laravel-backed run passed `5/5` in `2.3` minutes: all pages returned `200` and
had valid landmarks/headings, no duplicate IDs, no 320px document overflow,
and no serious/critical axe findings. This is focused automated evidence, not
manual screen-reader certification.

The route matrix remains `610/610`. ASP.NET port `5080` is a stale July 6
WSL/container runtime and fails public slug discovery despite the July 11 source
fix; two scoped integration attempts timed out silently, so current ASP.NET
runtime switching remains uncertified.

## 2026-07-12 Volunteer Opportunity Approval Gate

The opportunity-create page now matches Blade's complete catalog-backed
default-English form, validation, and no-approved-organisation copy. The local
test account has no approved owner/admin organisation on any available tenant,
so Web UK correctly renders no form and explains the approval requirement. No
privileged state was fabricated and no mutation was attempted.

Focused render proof, full Jest (`45/45`, `1,456/1,456`), lint, localization,
and a Laravel-backed authenticated 320px structure/reflow/axe gate (`1/1`)
pass. Disposable create/delete proof remains open until a legitimately approved
fixture exists; the first attempted harness failed safely before mutation and
was removed rather than committed as a red gate.

## 2026-07-12 Default-English Shift Waitlist Parity

The shift waitlist now matches Blade's catalog-backed status, empty guidance,
position/notification cards, organisation/location/shift/joined labels, and
context-specific leave buttons. Load and leave failures, fallback opportunity
titles, and position interpolation also use the current Laravel catalog.

Focused waitlist/swaps proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live leave was submitted because the available entries are shared signups, not
disposable fixtures.

## 2026-07-12 Default-English Shift Swaps Parity

Shift swaps now use Laravel's catalog-backed title, copy, direction/status
labels, member context, action labels, and success/error states. Shift option
labels use the Blade em dash, unknown statuses fall back safely to pending, and
safeguarding policy/restriction failures no longer collapse into generic swap
errors.

Focused action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live swap mutation was submitted because the available shifts are shared
records rather than disposable fixtures.

## 2026-07-12 Default-English Group Sign-ups Parity

Group sign-ups now use Laravel's catalog for reservation/member states, counts,
summary and table labels, leader controls, warning text, and accessible action
context. Add-member policy failures now preserve Laravel's distinct
safeguarding unavailable/restricted states.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live add/remove/cancel was submitted because there is no residue-free group
reservation fixture; shared reservations were not mutated.

## 2026-07-12 Default-English Wellbeing Parity

Wellbeing now uses Laravel's catalog for the score/risk summary, warnings, mood
form, status states, and recent-check-in table. Mood labels use the source em
dash, timestamps preserve the API timezone and match Blade's `j F Y, g:ia`
format, and unknown warning payloads are omitted like Blade.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live check-in was submitted because Laravel exposes no residue-free deletion
path for that personal record.

## 2026-07-12 Default-English Recommended Shifts Parity

Recommended shifts now use Laravel's catalog for the page, empty state, match
score, application state, metadata labels, accessible progress name, and
opportunity action. Shift times preserve the API timezone and match Blade's
`j F Y, g:ia` format; the source opportunity-title fallback is retained.

Focused Laravel-contract render proof passed. Full Jest remains `45/45` suites
and `1,456/1,456` tests with green lint and the 285-template zero-match audit.
This surface is read-only; tenant/skill recommendation depth remains open.

## 2026-07-12 Default-English Volunteer Expenses Parity

Expenses now use Laravel's catalog for totals, form fields and hints, linked
validation states, expense types/statuses, reviewer notes, and claim history.
Unknown statuses fail safely to pending and missing dates use the Blade em dash.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live claim was submitted because Laravel exposes no residue-free claim deletion
path; existing records were not mutated.

## 2026-07-12 Default-English Safeguarding Records Parity

Safeguarding training and incidents now use Laravel's catalog across both tabs,
forms, linked validation states, types, severities, statuses, confidentiality
notice, and record tables. Unknown states fail to Blade's pending/low/open
defaults and missing dates use the source em dash.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live training or incident record was created because Laravel exposes no
residue-free deletion path for either personal record.

## 2026-07-12 Default-English Accessibility Needs Parity

Accessibility needs now uses Laravel's catalog for the page title/caption,
request-locale need-type labels, and save/failure states; the existing detail,
adjustment, emergency-contact, and form contracts remain aligned.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live save was submitted because it would mutate the signed-in account's
persistent personal profile without an independent disposable fixture.

## 2026-07-12 Default-English Volunteer Certificates Parity

Certificates now use Laravel's catalog for the caption, page/status copy,
verification and organisation labels, and independent-volunteering fallback.
The existing download route still proves ownership before returning Laravel's
certificate HTML.

Focused render/download proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live certificate was generated because that creates a persistent account record
without a residue-free deletion path.

## 2026-07-12 Default-English My Organisations Parity

My organisations now uses Laravel's catalog for role filters, known role/status
labels, empty guidance, card metadata, approval states, and organisation-specific
dashboard action names. Unknown role/status values retain Blade's headline
fallback and website links remain HTTP/HTTPS-only.

Focused owner-filter/render proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. This
surface is read-only; broader live owner/admin/member tenant variants remain open.

## 2026-07-12 Default-English Volunteer Hours Parity

Volunteer hours now uses Laravel's catalogs for the auto-credit explanation,
form hints, empty guidance, and pending/approved/declined status trail. Known
states are request-locale aware; unknown values retain Blade's translated-or-
headline fallback.

Focused summary/form/log/action proof passed. Full Jest remains `45/45` suites
and `1,456/1,456` tests with green lint and the 285-template zero-match audit.
No live log was submitted because Laravel exposes no residue-free hours-record
deletion path.

## 2026-07-12 Credential Allowlist and Vetting Safety Parity

Credentials now matches Blade's current catalog and allowed types: retired
police/DBS options are absent, while manual handling, food hygiene, and
professional registration are available. Legacy vetting evidence is hidden and
removal-only; unsupported historical types remain manual-review-only. The prior
disposable PDF upload/render/delete gate remains valid (`1/1`, `44.2` seconds).

Focused security/render proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit.

## 2026-07-12 Default-English Volunteer Donations Parity

Donations now uses Laravel's catalog for the page and form, donor plurals,
progress accessibility text, statuses, methods, and result states. Tenant
currency and the existing currency-free POST contract remain unchanged, and
the `1,000,000` amount ceiling is still enforced.

Focused render/action proof passed. Full Jest remains `45/45` suites and
`1,456/1,456` tests with green lint and the 285-template zero-match audit. No
live donation was created because Laravel exposes no residue-free deletion path.

## 2026-07-12 Podcast Studio and Disposable Audio Lifecycle

Podcast studio, create, and manage now use Laravel's `govuk_alpha_commerce`
catalog for default-English copy, statuses, plurals, visibility choices,
episode controls, and destructive warnings. A real Laravel owner lifecycle
created and edited a uniquely named show, uploaded a valid WAV episode, proved
the returned authenticated media bytes exactly, passed 320px structure/reflow
and serious/critical axe checks, deleted the episode and show, and proved final
API absence (`1/1`, `271.7` seconds). Failed/interrupted attempts were cleaned,
including one explicit residue audit and deletion.

Full Jest remains `45/45` suites and `1,458/1,458` tests with green lint and the
285-template zero-match audit. Publish/moderation, live subscribe behavior,
tenant author gates, browse/playback catalog alignment, manual
assistive-technology depth, and ASP.NET compatibility remain open.

## 2026-07-12 Default-English Podcast Browse and Playback Parity

Podcast browse, detail, and episode playback now use Laravel's catalogs for
default-English page copy, search and sort controls, owner and episode counts,
subscription states, accessible audio/download labels, transcript states, and
back links. This completes the fixed-copy catalog alignment across the browse,
playback, studio, create, and manage surfaces without expanding Arabic-specific
coverage.

Focused render/source proof passed. Full Jest remains `45/45` suites and
`1,458/1,458` tests with green lint and the 285-template zero-match audit.
Publish/moderation, live subscribe behavior, tenant author gates, manual
assistive-technology depth, and ASP.NET compatibility remain open.

## 2026-07-12 Default-English Group Message Parity

The group list, no-JavaScript create/search form, and conversation/manage
surface now use Laravel's `govuk_alpha_messages` catalog for fixed copy,
plurals, member and sender fallbacks, accessible reaction labels, and
destructive warnings. Group failures now render Blade-style error summaries
instead of being announced as successful outcomes.

Focused render/source coverage passed 5/5. Full Jest passed `45/45` suites and
`1,460/1,460` tests with green lint and the 285-template zero-match audit.
Restriction/feature-gate depth, live group mutation effects, exact relative
dates, direct-conversation contextual localization, manual assistive-technology
review, and ASP.NET compatibility remain open.

## 2026-07-12 Default-English Direct Message Parity

Direct conversation titles, controls, warnings, member/sender fallbacks, and
whitelisted success/error outcomes now use Laravel's exact catalogs. This adds
the source attachment, voice, translation, edit/delete, and safeguarding
states that the former hard-coded map omitted; attachment-limit failures are
regression-tested as error summaries rather than success banners.

Focused coverage passed 10/10. Full Jest passed `45/45` suites and
`1,460/1,460` tests with green lint and the 285-template zero-match audit. A
safe live group lifecycle was not added because Laravel exposes no group-delete
endpoint: self-leave retains the conversation/messages and can promote another
participant. Restriction/feature-gate depth, exact relative dates, safe live
mutation depth, manual assistive-technology review, and ASP.NET compatibility
remain open.

## 2026-07-12 ASP.NET Readiness and Route-Matrix Refresh

The generated matrix matches all `610/610` Laravel routes with zero missing and
zero preparation pages. Web UK has one intentional extra route: the
authenticated volunteering-credential download proxy needed for bearer-safe
binary delivery.

`npm run audit:aspnet:readiness` remains red against the live service on port
`5080`: health is `200`, while slug-authoritative tenant bootstrap and platform
stats both return `400` requiring `X-Tenant-ID`. This is runtime evidence only;
the concurrent ASP.NET source work was not changed or committed in this slice.

## 2026-07-12 Group Message Restriction Gates

Group list, create, and conversation GET surfaces now consume Laravel's existing
message restriction contract. Restricted members no longer see the create CTA;
the create action is disabled with Blade warning copy; and conversation reply,
reaction, and member-management controls follow the same `canSend` state rather
than being unconditionally exposed.

Focused group coverage passed 6/6. Full Jest passed `45/45` suites and
`1,461/1,461` tests with green lint and the 285-template zero-match audit.
Action-level authorization remains enforced by Laravel and still needs safe
runtime depth where residue-free fixtures exist.

## 2026-07-12 Direct Message Member Search

The inbox now includes Blade's no-JavaScript member search card, backed by
Laravel user search, with exact catalog heading, label, hint, empty state,
member links, and directory fallback. It is suppressed whenever direct
messaging, connections, or the member's restriction state prevents starting a
conversation.

Focused inbox coverage passed 4/4. Full Jest passed `45/45` suites and
`1,462/1,462` tests with green lint and the 285-template zero-match audit.

## 2026-07-12 Disposable Jobs Owner Lifecycle

The Jobs create/edit form now matches Blade's catalog-backed caption, headings,
descriptions, field labels and hints, salary/status legends, and submit actions.
`npm run smoke:laravel:jobs-mutation` passed `1/1` in `81.7` seconds: it created
a unique draft time-credit opportunity, proved Laravel persistence and 320px
structure/reflow/axe, edited title/commitment/location, proved the updated API
contract, deleted through the visible owner form, and proved final absence. The
independent cleanup path retained no fixture.

Full Jest passed `45/45` suites and `1,463/1,463` tests with green lint and the
285-template zero-match audit. Application, CV, interview, and offer mutation
depth remain open.

The Jobs alert surface now also uses Blade's catalog caption/navigation,
labels, status tags, remote-only copy, and warning-confirmed delete control.
The expanded mutation gate passed `2/2` in `102.1` seconds: the alert case
created a unique multi-criteria alert, proved active state, paused and resumed
it through Laravel, deleted it through the visible confirmation, and proved
final absence. Both Jobs cases retained no fixture.

## 2026-07-12 Disposable Course Authoring Lifecycle

The course create/edit and builder surface now uses Laravel's exact commerce
catalog for its default-English caption, headings, field labels and hints,
choices, builder controls, warnings, and actions. No Arabic-specific coverage
was added.

`npm run smoke:laravel:courses-mutation` passed `1/1` in `180.6` seconds. It
created and updated a uniquely named course, proved the persisted level,
visibility, enrolment type, and credit cost, created and renamed a section,
created and deleted a text lesson, deleted the section and course through the
visible Web UK controls, passed 320px structure/reflow and serious/critical axe
checks, and proved final Laravel API absence. Independent cleanup inspection
found no disposable course residue.

Full Jest passed `45/45` suites and `1,464/1,464` tests; lint and the
285-template zero-match audit are green. Publish/moderation, learner enrolment/
completion/review effects, instructor-role variants, manual assistive-
technology depth, and ASP.NET compatibility remain open.

## 2026-07-12 Reversible Blog Discussion Lifecycle

The rich Blog discussion now matches Blade's ownership-gated edit/delete
controls, edited marker, reply-depth rule, warning-protected cascade deletion,
six emoji reaction controls with counts and pressed state, and exact discussion
catalog copy.

`npm run smoke:laravel:blog-mutation` passed `1/1` in `204.4` seconds against
the stable empty discussion for post 42. It created an owned comment, reacted,
edited, added a reply, toggled the shared post reaction on and back off,
warning-deleted the parent and cascade reply, passed 320px structure/reflow and
serious/critical axe checks, and proved final API absence. Independent
inspection found no disposable comment and the post reaction at its original
null state.

Full Jest remains `45/45` suites and `1,464/1,464` tests; lint and the
285-template zero-match audit are green. Feature-gate depth, non-owner live
variants, exact rich-text/RSS depth, manual assistive-technology review, and
ASP.NET compatibility remain open.

## 2026-07-12 Reversible Review Discussion Lifecycle

Review discussions now match Blade's emoji-bearing review/comment reaction
controls and render mutation failures as a field-linked GOV.UK error summary
rather than an “Important” notification. Focused validation coverage guards
the summary and `#body` field error.

`npm run smoke:laravel:reviews-mutation` passed `1/1` in `225.4` seconds
against clean review 18. It created an owned comment, reacted, edited, added a
reply, toggled the review reaction on and back off, warning-deleted the parent
and cascade reply, passed 320px structure/reflow and serious/critical axe
checks, and proved final API absence. Independent inspection found zero
comments and the review reaction restored to null.

Full Jest passed `45/45` suites and `1,465/1,465` tests; lint and the
285-template zero-match audit are green. Non-owner live variants, review
creation/deletion policy depth, manual assistive-technology review, and ASP.NET
compatibility remain open.

## 2026-07-13 Clean ASP.NET Development Compatibility

Current source now builds and starts against a disposable PostgreSQL database
migrated from zero. A forward-only idempotent migration repairs two historical
fresh-install gaps without changing applied migration history: it creates the
missing `XpShopRedemptions` table and adds the missing `P256dh` and `Auth`
columns to `push_subscriptions` when needed.

The clean runtime also preserves legacy bootstrap root fields while adding the
Laravel `data` envelope, and identifies platform stats as tenant-scoped.
`npm run audit:aspnet:readiness` passed `3/3` against the disposable runtime.
An unchanged Web UK core-session smoke then passed `10/10`, covering health,
unsigned redirect behavior, cookie choices/settings, CSRF login, real ASP.NET
authentication, signed account rendering, and logout. This is a scoped
development checkpoint, not certification of every Laravel fixture-dependent
route or side effect. The owner-controlled listener on port `5080` remains a
stale image and was not replaced.

The focused .NET run built successfully and its two non-container migration
checks passed. Its eight integration cases could not initialize because
Testcontainers cancelled the resource-reaper startup; the same response
contracts were therefore verified through the clean disposable runtime rather
than reported as passing integration-test assertions.

## Final Handoff Checklist

Before leaving this job for another agent, write a short note containing:

- branch and head commit;
- dirty files and whether each is yours or pre-existing;
- generated route matrix counts;
- remaining `laravel-prep-pages.js` matches;
- latest lint and Jest results;
- current implementation score out of 1000;
- next 5 concrete tasks;
- any runtime-smoke blockers;
- files changed in the handoff.
