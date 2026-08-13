# Current Web UK Production Status (Goal W2)

Last reviewed: 2026-08-13

Status: **Canonical current — sole Web UK scoring source**

<!-- doc-consistency: WEBUK_W2_CURRENT_SCORE=730/1000 -->
<!-- doc-consistency: WEBUK_W2_RUBRIC=WEBUK-W2-PROD-R1 -->
<!-- doc-consistency: WEBUK_W2_ARTEFACT_TREE=dirty-disclosed -->

This is the current scoring document for `web-uk`. It replaced
[`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
on 2026-08-11, which is retired and kept as the W1 audit trail.

The question this rubric answers is **"is `web-uk` safe to serve as the
production accessible frontend, and can Blade be retired?"** — not W1's question,
which was "how closely does this candidate clone Blade?".

`scripts/check-doc-scores.mjs` enforces the structure of this page in CI. The
generated artefacts are the truth and this document follows them; if a count here
disagrees with `docs/generated/`, regenerate and correct **this page**, never the
artefact.

## 🔴 How this number moved, and which rows went DOWN

W1 banked `663/1000` (66.3%). W2 stands at `730/1000` (73.0%), rescored on 2026-08-13 (651 -> 710 -> 745 -> 730).

## 🔴 THE SCORING RULE, because it was broken once and inflated this figure by 57

**A row's Earned is its Maximum minus the deductions listed in its own cell. Nothing
else may raise it.**

Concretely: **fixing a defect that was never deducted restores ACCURACY — it does not
earn credit.** If a fault existed and no deduction recorded it, the row was previously
over-scored; repairing the fault brings the row to where it should always have been.
Only two things may legitimately raise a row: closing a deduction that is written down,
or completing scope that is written down.

This was violated on 2026-08-13. A GDS-conventions pass fixed four real defects — the
missing "Error: " title prefix, help links absent from non-tenant pages, the
session-timeout desync, and the total absence of graceful shutdown — and each was
rewarded with points *on top of* rows whose deductions had never mentioned them. Rows 2,
3, 6 and 7 were written as 243, 44, 135 and 79 while their own listed deductions gave
240, 42, 90 and 72. The total was stated as 787 against a true 730.

🔴 `check-doc-scores.mjs` did not catch it, and could not: it verifies the Earned COLUMN
sums to the total row, which it did, and has no way to know whether a row's prose
justifies its number. **Re-derive every changed row by hand from its own deduction list.**

**No implementation regressed.** 150 points that W1 never scored — production
deployment, cutover and rollback (100) plus Blade retirement (50) — enter the
denominator for the first time. Deployment moved 20 → 61 → 72 as the path was built
and then exercised on the real server.

🔴 **The 2026-08-13 rescore moved 651 → 710, and TWO ROWS WENT DOWN.** A page-by-page
audit of every reachable page was run: 145 pages crawled signed-in, rendered content
diffed against Blade, axe run on 24 real signed-in pages, forced-colours / 320 px /
dark-scheme exercised, empty-form validation posted on four forms, and security
headers and cookie flags inspected.

- **Live Laravel runtime certification 0 → 45.** The owner authorised real signed-in
  journeys, so this stopped being entirely theoretical. Read paths, auth, one real
  mutation and form validation are now exercised against a live Laravel.
- **Manual WCAG 2.2 AA 60 → 70.** Real-page axe evidence replaced fixture-only
  evidence, and forced-colours is now exercised rather than untouched.
- 🔴 **Localisation 45 → 42 and API contract 142 → 139 — both DOWN**, because the
  audit disproved this document's own evidence. Localisation claimed "0 hard-coded
  matches" while one whole page carried 23 hard-coded English strings. The API row
  claimed complete direct-assertion coverage while a page existed that could never
  work, because the ledger cannot see a missing `Authorization` header.
- **Observable Blade behaviour 235 → 240 — only +5 despite NINE real divergences
  being found and fixed.** That is the honest result: the old 235 was already
  crediting behavioural parity nobody had measured, so fixing nine bugs mostly
  bought back credit that had been given in advance.

Read the mapping table below before quoting either number; do not convert one into
the other, and do not describe either as "about finished".

## Rubric `WEBUK-W2-PROD-R1`

| Row | Earned | Maximum | Exact deduction |
|---|---:|---:|---|
| Route and URL-shape parity | 97 | 100 | -3: a live request on a real community domain is still unproven. 🔴 The MECHANISM is proven, and the risk recorded here was MIS-STATED: the question was never whether Node's `fetch` forwards a custom `Host` — it does not, and must not, because the upstream host is Laravel itself. web-uk forwards the community domain as **`Origin`**. Observed 2026-08-11 by putting an echo server between web-uk and Laravel: a browser request with `Host: hour-timebank.ie` produced `origin: https://hour-timebank.ie` upstream. `TenantBootstrapController` (lines 107-118) resolves `tenants.domain` from `HTTP_ORIGIN`, deliberately only when the Host resolved to the master tenant — which a container name does. What remains: no local community has a domain set, and the local database is production-derived and shared with a concurrent session, so it was not altered to fake one. Provable during the cutover soak. |
| Observable Blade behaviour | 240 | 250 | **Rescored 2026-08-13 after a 141-page rendered-content diff against Blade** (headings, inset notices, banners, error summaries, every form's action and field names). -8: Event moderation queue membership/order and `is_online` remain upstream Laravel contract boundaries. -2: `/exchanges` empty-state heading still differs from Blade's. **+3 on the GDS-conventions pass (2026-08-13):** three further deviations from Blade now IMPROVE on it under the owner's "GOV.UK guidance wins" decision — the "Error: " validation title prefix (absent from both), help links on non-tenant pages (Blade's chooser has none either), and a button rather than a link for "Hide cookie message". Each is a recorded intentional divergence with a test, not a parity gap. The former -7 for withheld accessibility-assurance copy is **removed, not fixed**: it is now confirmed CORRECT rather than a gap — Blade asserts full keyboard support and screen-reader testing that web-uk's evidence does not support, so publishing it would be an unsubstantiated conformance claim; three tests assert its absence and `accessibility.njk` carries the reason. 🔴 **NINE real divergences were found INSIDE routes the matrix already counted as matched, and all nine are fixed with tests**: `level_name` absent from the API so no HTTP consumer could render a level name; "Give feedback" pointing at a mailto instead of the community's contact form; `/organisations` and `/organisations/browse` permanently erroring because the directory was fetched unauthenticated; direct-message senders attributed to "Community member"; the coordinator/supporter message-visibility notice rendered NOWHERE; all ten venue-accessibility fields missing from the event CREATE form; `/profile` missing its Recent activity and Availability sections; `/chat` silent when no AI provider is configured; `nexus-alpha-filter-nav` unstyled, so filter rows on five pages rendered as bulleted vertical lists; and 🔴 **GDS Transport named 63 times in the compiled CSS** while Blade named it zero — web-uk never set `$govuk-font-family`, so govuk-frontend's default licensed-Crown-typeface stack flowed straight through. Nothing looked wrong because the font file is never served and text fell back to arial, which is exactly why it survived. Fixed with a `@use ... with (...)` override matching Blade, and `scripts/brand-check.js` now scans the COMPILED CSS for it (it only ever scanned `src/views`, so it could not see a font, and reported "passed" throughout); the new guard was proven able to fail by reintroducing the string. Only +5 net, because the previous 235 credited parity that had never been measured behaviourally. |
| Localisation | 42 | 50 | 🔴 **DOWN from 45 on 2026-08-13: this row's own evidence was wrong.** The "Template localisation — 0 conservative hard-coded matches" line below cannot see hard-coded English in route files, and `views/federation/index.njk` carried **23 hard-coded English strings**, two of which also used the WRONG key so the page said "Network stats" where Blade says "Your federation activity". -5: 1,443 of 90,700 values across the ten non-English locales are byte-identical to English (1.6%). -3: remaining hard-coded English — **17 of those 23 federation strings still have no key in any locale**, the event-form validation messages ("Enter an event title") have none either, and 22 `title:` literals remain (capped, shrink-only, by `tests/hardcoded-title-ratchet.test.js`). **What was fixed:** 8 core page titles that stayed English in Irish and German — Feed, Listings, Events, Groups, Ideas and the three create forms — proven by comparing every `<title>` against Blade in `ga` then `de`; the four generic error-page titles across **75 occurrences in 22 files**, so error pages are no longer English in every language (`/404` now renders "Níor aimsíodh an leathanach" under `?locale=ga`); 34 further page titles; and the `/federation` heading, which showed our internal word "Federation" instead of the translated "Partner communities". 🔴 Blocked, not forgotten: finishing the rest needs new keys in 11 locales, and Irish cannot be machine-translated — `translate-php-lang-gaps.mjs` skips `ga` without `OPENAI_API_KEY` (absent), while `check-php-lang-untranslated.mjs` sits exactly at its 249 ceiling, so any English-only addition fails the build. Owner decision. **+2 (2026-08-13):** the "Error: " title prefix reuses the already-translated `states.error_prefix`, so it is correct in all eleven locales from the start (verified `Earráid:` under `?locale=ga`), and the timeout sign-out message reuses `states.auth_required` rather than adding an English-only key. 🔴 The blocker has widened from tidy-up to REAL ACCESSIBILITY WORK: it now stops the character-count component (its own JS ships English `charactersUnderLimit` defaults and no translated equivalents exist), the GDS three-field date pattern (no translated "Day" or "Year" labels — only "Month"), and localising the timeout modal. Five blocked items. |
| API contract and static/mock verification | 139 | 150 | 🔴 **DOWN from 142 on 2026-08-13.** -8: exhaustive field-shape, publication, auth/role, status/error and side-effect assertions are still not complete for every significant contract. -3 (new): **the ledger's completeness claim is weaker than it reads.** It reported 0 rows without tests and 0 without direct helper assertions while `/organisations` could never work for any member — `getVolunteerOrganisations` was called with no token against an endpoint that 401s anonymously. The existing test asserted the URL and `Content-Type` but never that the request was authorised, so a page that was broken for every user scored as fully covered. A missing `Authorization` header is invisible to this artefact by construction; treat "0 without direct assertions" as ownership evidence, never as behavioural proof. Both that and a genuine Laravel-side defect (`/v2/gamification/profile` omitting `level_name`, which `GamificationService::getProfile()` returns) are fixed with value-asserting tests. Ledger now 696 contracts, 0 gaps. |
| Live Laravel runtime certification | 45 | 150 | 🔴 **0 → 45 on 2026-08-13. No longer entirely open**, because the owner authorised real signed-in journeys against a live Laravel. What is now exercised, as two real members (674/675) against the running local Laravel: sign-in and session handling on both frontends; **145 pages crawled while authenticated with 0 broken internal links**; a real mutation (a direct message sent as A and read by B, correctly attributed from both sides); the legal-acceptance gate accepted; empty-form POSTs on `/events/new`, `/listings/new`, `/groups/new` and `/contact`, all returning focusable GOV.UK error summaries with per-field anchors; and `GET /api/ai/providers` proving the chat page reports a missing AI provider. -60: no separately provisioned **disposable** application/database/storage environment; these journeys ran against the shared, production-derived local database, which the working rules discourage as a fixture and which caps how far this can be pushed. -25: **upload, download and destructive paths uncertified** — no avatar/image upload, resource upload, CSV/ICS download or delete/erasure journey has been run. -20: single tenant (`hour-timebank`) and a single member role; no broker, admin, sub-tenant or custom-domain journey. |
| Manual WCAG 2.2 AA certification | 90 | 150 | **60 → 70 on 2026-08-13.** New evidence, all on REAL signed-in pages rather than the mocked fixture: **axe (wcag2a/2aa/21a/21aa/22aa) clean on 24 of 24 pages**; a structural sweep of 145 pages found **0 duplicate IDs, 0 unlabelled form controls, 0 images without alt, 0 skipped heading levels, 0 links without an accessible name, 0 tables without a caption or `th scope`, 0 raw translation keys**; forced-colours, 320 px and dark scheme exercised across 12 real pages with **0 horizontal overflow, 0 invisible text and no content loss**. 🔴 **A real WCAG 2.2 AA failure was found and fixed**: criterion **2.5.8 Target Size (Minimum)** — the `nexus-alpha-filter-nav` filter links measured 18–56 px wide by **19 px tall** against the 24 px minimum, and too tightly packed, on `/wallet`, `/exchanges`, `/connections/network` and both `/matches` pages. Root cause: the class had NO styles in web-uk at all. Blade's flex/gap rules were ported and the links given a 24 px minimum target (now 34 px) — deliberately **beyond** Blade, which fails 2.5.8 too. -30: no screen-reader speech-output sign-off; needs a human on NVDA, JAWS or VoiceOver. -25: no representative screenshot comparison set. **Keyboard activation is now PROVEN** (the former -20 is closed): with real Playwright key events, `Enter` in a text field performs implicit submission and signs in; `Enter` on a focused submit button sends the POST; `Space` on a focused submit button activates it. The old deduction described a limitation of the PREVIOUS harness (`Enter` delivered with `keyCode: 0`), not a product defect. 🔴 An empty form appears not to respond to `Enter` — that is the browser's own required-field validation correctly refusing to submit (`form.checkValidity()` is false, 2 required fields), not a fault; the POST fires once the fields are filled. **A screenshot comparison set now exists** (former -25 reduced to -10): 32 full-page comparisons, web-uk vs Blade, same member and viewport, at 1280px and 375px, with an in-browser pixel diff — mean difference 6% desktop / 20% mobile. 🔴 The mobile figure is NOT a defect: computed layout metrics are identical between the two (same font size, padding, container width 345px), so a ~23px vertical offset near the top cascades down a narrow tall page. Treat the numbers as a regression baseline, not a quality score. 🔴 The PNGs are deliberately NOT committed: the local database is production-derived, so screenshots contain real member names and committing them to a public repository would leak personal data. -10: the set is local-only and no human has reviewed the images. **WCAG 2.2 §3.2.6 Consistent Help now MET** (2026-08-13): the footer Support column — Help centre, Knowledge base, Trust and safety, Contact, About — was deleted entirely on any render without a routed tenant, so the shared root and tenant chooser offered no route to help at all. It now renders tenant-free in the same footer position; all four un-prefixed targets were verified to resolve BEFORE the links were exposed. **§3.3.8 Accessible Authentication verified clean**: every `type="password"` field carries an autocomplete token (zero exceptions), sign-in uses `email` + `current-password`, register and reset use `new-password`, paste is not intercepted — password managers work. **Focus Not Obscured verified clean**: the compiled CSS contains no `position: fixed` or `sticky` rule at all, so no authored content can cover a focused element. -15 (new, and now the only large gap besides the screen reader): the GDS three-field date pattern is not implemented — 19 `datetime-local`, 22 `type="date"` and 2 `type="time"` inputs remain, against explicit GOV.UK guidance that native pickers fail users (inconsistent across browsers, mobile calendars cannot reach historic dates, fixed output format, no control over validation presentation). Shared with Blade, and BLOCKED on Irish translation for the field labels rather than on effort. -5: forced-colours is exercised programmatically, but no human has looked at it. |
| Production deployment, cutover and rollback | 72 | 100 | **Built 2026-08-11; EXERCISED on the real server 2026-08-12.** Deployed four times end to end: web-uk builds, boots, reports healthy and serves a real accessible page on both colours, with NO vhost installed so no member can reach it. The 30-minute post-deploy error watch recorded 0 errors against a normal background of 3/day. 🔴 The Apache `Define`/`<IfDefine>` interaction — recorded as the single assumption the whole cheap-rollback story rested on — is now VERIFIED against the production Apache 2.4.58 build, in both directions and including which arm is selected: with the `Define`, config is valid and the web-uk arm is read; without it (what a rollback to a pre-web-uk release produces) config is STILL valid and the API fallback arm is used, so a rollback cannot abort itself. Proven with a deliberate-error probe because `-DDUMP_CONFIG` yields nothing on this build; tested as a verbatim replica in an isolated config, since no vhost is installed yet. Three real faults were found only by deploying for real and are fixed with tests: `--with-webuk` discarded by the detach relaunch, the Migration Safety Gate refusing a nullable column because it read one line at a time, and the page smoke check failing a healthy service it queried at 9 seconds old. -18: no cutover and no rollback have been rehearsed — no hostname points at web-uk yet. -6: not routed to any member, so shared-session behaviour and failover under real traffic remain unobserved. -4: one owner prerequisite open (whether to publish per-tenant accessible domains). **+7 (2026-08-13): GRACEFUL SHUTDOWN, which this row had no line for and which the blue/green switch depends on.** The process had NO signal handler; the Dockerfile runs node as PID 1 with no init and no `STOPSIGNAL`, so `docker stop` delivered SIGTERM to a process whose default is to exit instantly — severing every in-flight response and dropping Redis without a quit, at exactly the moment a colour switch still has traffic arriving. It now drains connections, quits Redis, flushes Sentry and exits 0; idempotent, and bounded at 10s with an unref-ed timer so it can never outlast the orchestrator grace period and get SIGKILLed anyway. 🔴 Proven on the real container rather than asserted: SIGTERM logged "closing server to new connections" then "Shutdown complete". Body-parser limits are now explicit (256kb) instead of an invisible framework default, which matters because the urlencoded `verify` hook buffers the entire raw body. |
| Blade retirement without regression | 5 | 50 | **0 → 5 on 2026-08-13 for the freeze only.** The owner froze the Blade track that day: it is kept read-only as the reference for building web-uk, all build effort moves here, and the decision is recorded in `AGENTS.md`, `docs/ACCESSIBLE-FRONTEND-TAKEOVER.md` and a banner atop `accessible-frontend/CLAUDE.md`. That removes the drift risk of two frontends being built in parallel, which is a genuine precondition. -45: **retirement itself is not started.** Freezing is not retiring — Blade still serves the community accessible domains and every `/{tenantSlug}/accessible/...` path, and decommissioning must be a separate change with its own review after a soak. |
| **W2 current score** | **730** | **1000** | 73.0%. Implementation-only subtotal (rows 1–4) is 518/550 (94.2%); it must never be reported as production readiness. 🔴 This figure read `512/550 (93.1%)` from when it was written until 2026-08-11: correct only while the route row was 90, and never updated as that row went 90 → 94 → 97. `check-doc-scores.mjs` sums the Earned/Maximum COLUMNS and cannot see a number written in prose, so the one figure a reader is most likely to quote as "how close is the implementation" was wrong while CI stayed green. Recompute it by hand whenever any of rows 1–4 change. |

## Mandatory W1 → W2 mapping

Every W1 row is accounted for. Nothing was quietly dropped or renamed.

| W1 row (`WEBUK-W1-FIXED-R1`) | W1 result | Maps to W2 row (`WEBUK-W2-PROD-R1`) | W2 result | What changed |
|---|---:|---|---:|---|
| Route/inventory representation | 99/100 | Route and URL-shape parity | 97/100 | **Improved then rescoped.** W1's single deduction — no safe HTTP contract for the offline signed Event check-in-code POST — was closed on 2026-08-11 and parity is 707/707. W2 then adds URL-shape parity as new scope, which is where the remaining -3 sits. |
| Observable Blade/workflow implementation | 292/300 | Observable Blade behaviour | 235/250 | Rescaled denominator, same two open findings, same proportion (97.3% → 94.0% after the copy-parity deviation is scored explicitly rather than folded in). |
| — (no W1 row; localisation sat inside observable behaviour) | — | Localisation | 45/50 | **New row.** Split out so a localisation regression cannot hide inside a large behaviour row. |
| API contract/state coverage plus static/mock verification | 190/200 | API contract and static/mock verification | 142/150 | Rescaled denominator, same finding. Direct-assertion coverage stayed at zero outstanding through the 2026-08 work. |
| Disposable Laravel runtime certification | 0/200 | Live Laravel runtime certification | 0/150 | Denominator reduced; still entirely open. |
| Screenshot/manual accessibility/WCAG certification | 35/150 | Manual WCAG 2.2 AA certification | 60/150 | **Improved.** Real dispatched `Tab`/`Enter` evidence now exists — a 34-stop traversal with a visible focus indicator at every stop, keyboard skip-link relocation, keyboard error-summary recovery, and no horizontal overflow at 640 and 320 CSS pixels. Recorded in `MANUAL_ACCESSIBILITY_EVIDENCE.md` (2026-08-10). W2 also names WCAG **2.2** AA explicitly. |
| Production hardening and reproducible docs | 47/50 | Production deployment, cutover and rollback | 72/100 | **Deliberately harsher, then genuinely advanced.** W1 scored the *image*; W2 scores the *deployment path*. 47/50 on hardening was never evidence that anything could be deployed. The path was built on 2026-08-11, which is what moved this row from 20 to 61; what remains is rehearsal and one owner decision. |
| — (no W1 row) | — | Blade retirement without regression | 0/50 | **New row.** W1 could not score this: it treated Blade as the permanent source of truth. |

## Current evidence

All counts below come from `docs/generated/`, regenerated at commit
`0c05ce064a42ff6ecca962299c5196e8ca77ca0a`, which both artefacts name.

| Measure | Current result | What it does and does not prove |
|---|---|---|
| Route matrix | Laravel 707, `web-uk` 723, **matched 707, missing 0**, extra 13, ignored infrastructure 4 | Declaration coverage. Not workflow, auth, tenant or visual parity. Extras went 12 -> 13 on 2026-08-13: `POST /cookie-consent/hide`, which exists because GDS specifies a BUTTON for "Hide cookie message" and a button needs somewhere to submit to. Blade uses a link, so it has no equivalent route. |
| API consumer ledger | 696 contracts; 467 OpenAPI matches; 229 route-declared OpenAPI omissions; **0** without a Laravel route declaration; **0** dynamic unresolved; 381 state-changing; **0** without tests; **0** without direct helper assertions | Static and mocked ownership evidence. No live Laravel was contacted. The 696th contract is `GET /api/ai/providers`, newly consumed by the chat page on 2026-08-13 so it can tell a member when no AI assistant is configured, as Blade does. |
| Jest | 74 suites, 2,127 tests passing, `--runInBand` | Mocked contract and page behaviour. |
| Locale catalogs | 11 locales, 38 namespaces, 9,070 string keys, 0 missing, 0 extra | Structural shape only. |
| Static locale usage | 7,878 references, 5,984 unique keys, **0 unresolved** | Every key referenced in source exists. |
| Template localisation | 335 templates, **0** conservative hard-coded matches | 🔴 **Read this narrowly.** It scans TEMPLATES with a conservative matcher and is blind to hard-coded English in route files, and to a template string it does not recognise as user-facing. `views/federation/index.njk` held 23 hard-coded English strings while this line read 0. It is not evidence that the frontend is fully localised. |
| Automated accessibility | 24/24 on the isolated fixture, **and 24/24 on real signed-in pages** (axe wcag2a/2aa/21a/21aa/22aa, 2026-08-13) | Automated subset only. It is **not** manual sign-off and must never be reported as one. 🔴 The real-page run is the stronger evidence: it found a WCAG 2.2 target-size failure the fixture never could, on five pages. 🔴 It needed `bypassCSP` to inject axe — the site CSP blocked it on the first attempt, which is incidental proof the CSP works. |
| GDS conventions audit (2026-08-13) | 12 GOV.UK Design System / WCAG 2.2 conformance points checked against published guidance. **Implemented:** "Error: " validation title prefix; back links on the two question pages lacking one; cookie-banner hide as a BUTTON; Consistent Help on non-tenant pages; session-timeout duration sourced from the server; expired session no longer reported as a deliberate sign-out; graceful shutdown; explicit body limits. **Verified already clean:** autocomplete/§3.3.8 (zero untokened password fields), Focus Not Obscured (no fixed/sticky CSS at all), RTL baseline for Arabic, trust proxy, upstream fetch timeouts, error-page localisation. **Blocked on Irish translation:** character count, GDS date inputs, timeout-modal copy, 17 federation strings, event validation messages | Research-backed against the GOV.UK Design System, the WCAG 2.2 criteria and govuk-frontend release notes. 🔴 Does not include a screen-reader pass. |
| govuk-frontend version | **6.4.0** (upgraded from 6.3.0 on 2026-08-13, npm latest stable) | 🔴 Read this from `web-uk/package.json`, never from prose — `AGENTS.md` claimed 6.1.0 while the tree ran 6.3.0. The `$govuk-font-family` override must be re-checked on every upgrade; `brand:check` enforces it. |
| Brand check, lint, CSS build | Passing | Branding prohibitions and code style. 🔴 **Read narrowly.** Until 2026-08-13 this check scanned only `src/views`, so it could not see a typeface: the compiled CSS named GDS Transport 63 times while it reported "passed". It now also scans `public/css/main.css` and refuses to pass if that file is missing. A green brand check still does not prove every branding prohibition — it proves the ones encoded in it. |
| Page structure sweep (2026-08-13) | 145 pages crawled signed-in: **0** broken internal links, **0** duplicate IDs, **0** unlabelled form controls, **0** images without alt, **0** skipped heading levels, **0** links without an accessible name, **0** tables missing caption/`th scope`, **0** raw translation keys | Structural and semantic hygiene across the real authenticated surface. Does not prove workflow correctness. 🔴 Its own first run reported "no accessible name" on 143 pages — a FALSE POSITIVE from stripping `<img alt>`; the corrected count is 0. |
| Forced colours / narrow / dark (2026-08-13) | 12 real pages under Windows forced-colours, 320 px, and dark scheme: **0** horizontal overflow, **0** invisible text, **0** content loss | Programmatic only. No human has viewed forced-colours output. 🔴 The first run of this probe was INVALID — the login click hit the cookie banner (the login page has four submit buttons) so it measured the sign-in page twelve times. Any future run must assert it is signed in before reporting. |
| Security headers and cookies (2026-08-13) | CSP with `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`, `script-src-attr 'none'`; HSTS 180d includeSubDomains; `Referrer-Policy: no-referrer`; COOP/CORP same-origin; `X-Content-Type-Options: nosniff`. All four `res.cookie` sites plus the session and CSRF cookies set `secure` when `NODE_ENV=production`; the only non-HttpOnly cookie is the cookie-consent choice | Inspected on a live response. -: `style-src` still needs `'unsafe-inline'`; HSTS has no `preload`. |
| Upstream call volume (2026-08-13) | One `/dashboard` render fans out to ~18 Laravel calls, in parallel. `GET /api/v2/tenant/bootstrap` is fetched on **every request and never cached**, though `src/lib/cache.js` exists and is used for only two endpoints; `CACHE_TTL.PROFILE` is declared and **used nowhere** | Local page times (3–5 s) are dominated by local Laravel latency (~1.4 s per call on the 9p mount), not by web-uk, and Laravel does serve concurrently (6.2× parallel speedup measured). The uncached per-request bootstrap is still a real production cost: one avoidable round trip on every page view. **Not fixed** — a tenant-scoped cache key is required and getting it wrong would leak one community's configuration into another. |

🔴 **Artefact working-tree disclosure.** Both artefacts record
`workingTreeDirty: true`. They were regenerated on 2026-08-12 during the audit
that produced the changes landing alongside them — the home-page hang fix, the
licence headers and the drift gate below — so the tree held that uncommitted work
at generation time. The flag is disclosed rather than hidden, and
`check-doc-scores.mjs` requires this disclosure whenever an artefact records a
dirty tree.

🔴 **These counts had drifted, and nothing was watching.** Before this refresh the
artefacts were pinned to commit `704f0a1b5` and reported 721 `web-uk` routes; the
code had 722. Harmless in itself — the extra route was `/version` — but the
mechanism was not: CI never regenerated these files, so the route matrix could
only ever be as current as the last time a person ran it by hand. A Blade route
added and never built here would have sat unreported in exactly the same way. The
`web-uk` CI job now regenerates both artefacts and fails if they differ from what
is committed, so this cannot go stale silently again.

🔴 **`/version` moved from "extra" to "infrastructure" in the same pass**, which
is why extras read 12 rather than 13 against 722 routes. It is a machine-only
endpoint like `/health` — the deploy smoke test and the cutover check match on it
— so counting it as a page `web-uk` has and Blade does not was miscounting the
one figure this artefact exists to keep honest.

## Finish line

Four gates. Two are owner decisions, not implementation.

1. ~~**Deployment path built**~~ — **done 2026-08-11.** Compose overlay, deploy
   script support, vhost include, `/version`, watchdog `DEPLOY_PATHS`, allowlist
   guard and routing-drift check all exist. **Still to do before any cutover:**
   rehearse a switch and a rollback on a real server, and verify the Apache
   `Define`/`<IfDefine>` behaviour the rollback path depends on.
2. **Manual accessibility completed** — screen-reader speech sign-off (needs a
   human), representative screenshots, a real-`Enter` harness for submit-button
   activation, manual forced-colours.
3. **Accessibility-copy parity decision** — either evidence supports restoring
   Blade's public keyboard/screen-reader claims, or the Laravel accessible-content
   owner corrects the source copy. `web-uk` must not publish an unsupported
   assurance to close a parity gap.
4. **Blade retirement** — a separate change with its own review, after a soak
   period with both frontends live.

Live Laravel runtime certification remains a separate optional workstream and is
not a prerequisite for the gates above, though it caps the achievable score at 850.
