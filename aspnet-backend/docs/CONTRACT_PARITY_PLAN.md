# Contract parity: every aspect, what it needs, and how it is measured

**Goal (owner, 2026-08-16):** both frontends must talk to either backend and get
carbon-copy answers. Production deployment, backups and live payment keys are
explicitly **out of scope** — this backend runs locally and in development only.

This is the working plan. It is organised by *aspect of the contract*, because
that is what has been missing: everything so far has been organised by route,
and route existence is the one thing that was never the problem.

---

## 0. The instrument that was missing

Every previous parity tool compares **source trees** — routes, files, schema,
translations. The generated contract matrix reports `aspnet_gap_count = 0` while
229 endpoints answer with nothing, because a handler that does no work still
satisfies "the route exists".

`scripts/compare-live-responses.mjs` (added 2026-08-16) asks **both running
backends the same question and diffs the answers**. It compares shape, never
values: the two hold different data, so equal values would be a bug in the test.

```bash
node aspnet-backend/scripts/compare-live-responses.mjs
node aspnet-backend/scripts/compare-live-responses.mjs --paths list.txt --json out.json
```

**First run, 20 read-only endpoints: 5 identical.** That is the real baseline.

🔴 **Four traps when reading its output:**

1. **Local Laravel runs in debug mode**, so its error bodies carry
   `exception`, `file`, `line`, `trace`. ASP.NET must NOT reproduce those — a
   `SHAPE_DIFFERS` on a 404 error body is usually this, not a real gap.
2. **A `404` from Laravel may mean the path is wrong in the seed list**, not
   that ASP.NET is wrong. Source paths from the contract matrix, not from memory.
   Six entries in the React corpus were extractor damage, not endpoints —
   `/api/v2/public/events${qs`, `/api/v2/matches/all...`, `/api/v2/test1`. The
   extractor cut template literals at the interpolation. Repair or drop them;
   do not "fix" a backend to satisfy a path no client calls.
3. **An empty list on one side proves nothing** (added 2026-08-17). The two
   backends hold different data — a production-derived Laravel snapshot against
   a thin demo seed — so one side routinely has rows where the other has none.
   Collapsing `[]` to a comparable skeleton invented six field mismatches on
   `/api/v2/blog/categories` that were only ASP.NET having content. The harness
   now returns a separate verdict, `MATCH_BUT_LIST_EMPTY`, which is **not**
   counted as a match: the envelope agrees, the row contract is untested. Do not
   fold it into the pass number.
4. **Shape blindness is real: equal types can still be a defect.** Both backends
   returned a string for `registration_mode`, so the harness said MATCH — but
   Laravel sends `verified_identity` and ASP.NET was sending `VerifiedIdentity`,
   the raw .NET enum name. Any client that switches on the value takes the wrong
   branch. When an endpoint carries an enumerated value, **read the values**, not
   just the skeleton.

**Scores measured with this instrument (React corpus, 170 endpoints after
repairing the six damaged paths):**

| Date | Identical | Untested lists | Differing | Note |
| --- | --- | --- | --- | --- |
| 2026-08-16 | 136 | — | 38 | first full React run |
| 2026-08-17 | 145 | — | 29 | nine anonymous leaks closed |
| 2026-08-17 | 156 | — | 18 | `/api/v2` aliases stopped bypassing `[Authorize]` |
| 2026-08-17 | 163 | 4 | 3 | envelope, meta, status fixes |
| 2026-08-17 | **164** | **6** | **0** | skill_categories table, categories row, cursor meta |

The "untested" column is honest, not padding: those six agree on everything
visible, and have an empty list or a null field on one side, so the row contract
inside them was never exercised. They are deliberately NOT counted as passes.

🔴 **What 164/170 does and does not mean.** It means: for every one of those
endpoints, an anonymous GET to both backends returns the same status and the
same JSON shape. It does NOT mean the endpoints are equivalent behind
authentication, that writes behave the same, or that the 229 do-nothing handlers
have gained bodies. The corpus is the GET requests the React frontend makes;
most resolve to 401 on both sides, which proves the authorisation boundary
matches and nothing about the payload behind it. Authenticated comparison is the
next instrument, and it needs a disposable Laravel environment — the ordinary
local Laravel database is a production-derived snapshot and is never a fixture.

---

## 0a. Signed-in comparison — the disposable Laravel (2026-08-17)

🔴 **The signed-out number was never the real number, and this is the correction.**
Most of the React corpus answers 401 on both backends. That proves the door is
locked the same way and says NOTHING about the room behind it. Measured signed
in, the same 170 endpoints scored **17/170**, against 164/170 signed out.

That gap was invisible because the ordinary local Laravel database is a
confidential production-derived snapshot — read-only, unauthenticated GET/HEAD
only — so nobody could sign in to compare.

**The unblock:** `bash aspnet-backend/scripts/start-disposable-laravel.sh`. It
builds a second Laravel on `:8091` from the committed schema dump (740 tables)
plus `E2ETestDataSeeder`, so it holds **synthetic fixtures and no real member
data**. Safe to sign into, write to, and destroy (`--down`). It never touches
`nexus-php-db`, the snapshot, or `nexus_test`.

```bash
bash aspnet-backend/scripts/start-disposable-laravel.sh
node aspnet-backend/scripts/compare-live-responses.mjs   --laravel http://127.0.0.1:8091 --laravel-tenant 1   --laravel-auth "e2e.user.a@project-nexus.local:TestPassword123!"   --aspnet-auth "member@acme.test:NexusV2!Demo#2026:acme"   --paths .local-docs-archive/react-paths.txt --json out.json
```

The harness **refuses to send credentials** when `--laravel` points at
`127.0.0.1:8090`. That guard is not advisory — do not remove it.

### 🔴 Both fixtures must have the SAME features on, or the run is noise

Fifteen features default OFF in Laravel (`TenantFeatureConfig::FEATURE_DEFAULTS`):
marketplace, courses, member_premium, podcasts, local_advertising,
caring_community, public_events and the rest. A fresh fixture answers 403
FEATURE_DISABLED on ~27 endpoints and the harness never reaches the payload —
and the ASP.NET dev tenant has a DIFFERENT set on, so the mismatch runs both
ways. Enabling everything on both sides moved the score from 29 to 42 while
raising the visible difference count, which is the honest direction: more
surface compared, not a better backend.

- Laravel side: the start script does it (`all-features-on.mjs` → `tenants.features`).
- ASP.NET side: insert `features.<flag> = true` rows into `tenant_configs`.

Switching everything on is a COMPARISON choice. It says nothing about what
should default on, and verifying a gate correctly REFUSES is a separate check
against a fixture with the features off.

### Which endpoint serves a path

`scripts/map-paths-to-actions.mjs` turns a parity report into a list of METHODS
to edit, by making each request and reading the action the container logged.
Grep is unreliable here: `AdminV2RouteAliasConvention` synthesises `/api/v2`
routes that exist in no source file, and several paths are claimed by more than
one controller. It scopes the log read to a time window opened before the
request, so a request that executes no action reports none rather than
inheriting the previous one.

### Progress, signed in, on the 170 React GET paths

| Change | Identical | Envelope right, rows untestable | Differing |
| --- | --- | --- | --- |
| first signed-in run | 17 | 8 | 145 |
| + `meta` block added by shared filter | 31 | 21 | 118 |
| + both fixtures fully featured | 42 | 21 | 107 |
| + six authorisation/validation fixes | 47 | 21 | 102 |
| + stray `success` flag removed | **57** | **31** | **82** |

---

### 🔴 A rule that looked safe and was not — read this before writing another one

The shared filter is right for `meta.base_url` and for removing `success`, both
measured 89-vs-0 and 41-vs-0. So I extended it once more: "a list `data` means
Laravel used `respondWithCollection`, so add `per_page` and `has_more` too."

It was wrong, and the run said so in one step: **57/170 → 35/170**, breaking 22
endpoints that already matched.

Laravel uses `respondWithData` for plenty of LIST endpoints, and that helper
emits `base_url` alone. `/api/v2/ads/active`, `/api/v2/billing/plans` and
`/api/v2/skills/search` all answer `{"data":[…],"meta":{"base_url":…}}` with no
`per_page`. **Which helper a Laravel route used is not derivable from its
response** — the same lesson as `[OwnErrorContract]` and `[LaravelOmitsMeta]`,
learned a third time.

The rule of thumb that keeps holding: a shared rule is safe when the measurement
shows N-versus-**zero** across the corpus. `meta.base_url` and `success` did.
"List means collection" did not — it was inferred from a plausible story about
Laravel's internals instead of counted. **Count first; the harness answers in
one run.**

The ~11 endpoints that genuinely need `per_page`/`has_more`, and the 5 that
report pagination as `pagination` where Laravel uses `meta`, are per-endpoint
work. Use `map-paths-to-actions.mjs` to find the method, then read the live
Laravel response for that path before editing.

---

## 1. Authorisation boundaries — 🔴 START HERE

**Status: divergent, and it is the most serious class found.**

The first harness run found endpoints where **ASP.NET serves anonymously what
Laravel protects**:

| Endpoint | Laravel | ASP.NET |
| --- | --- | --- |
| `GET /api/v2/resources` | 401 | **200 with real content** |
| `GET /api/v2/marketplace/listings` | 401 | 200 (empty here; would leak with data) |
| `GET /api/v2/volunteering/organisations` | 401 | 200 (empty here; would leak with data) |
| `GET /api/v2/categories` | 200 | 401 — the reverse: a signed-out visitor loses a working page |

**What to do:** for every endpoint, compare the *anonymous* status first. It is
one request per endpoint, needs no credentials, and catches both a data leak and
a broken public page. Fix ASP.NET to match Laravel in both directions.

**Why it matters more than shape:** a field-name mismatch breaks a screen
visibly. An authorisation mismatch is silent, and in one direction it is a
disclosure.

### 1a. RESOLVED 2026-08-17 — anonymous divergences closed, and the root cause of most of them

All anonymous-access divergences on the React corpus are closed. The count went
9 -> 0, and the harness reports zero remaining.

Two mechanisms produced them, and both are worth knowing because neither is
visible in source review or in a route inventory.

**(a) `[AllowAnonymous]` always wins.** Adding `[Authorize]` beside an existing
`[AllowAnonymous]` changes nothing, whichever is more specific. Three marketplace
endpoints read as protected in source while staying open. The rule: **remove the
`AllowAnonymous`; never add an `Authorize` next to it.**

**(b) `/api/v2` alias routes silently lost their `[Authorize]`.** This is the
larger one. `AdminV2RouteAliasConvention` built controller-level alias routes as
a bare `new SelectorModel { AttributeRouteModel = ... }`. Under endpoint routing
a controller-level `[Authorize]` is not a filter — it is endpoint metadata
carried on the controller's selector — so a hand-made selector produced a route
with no `IAuthorizeData` at all and `AuthorizationMiddleware` never challenged.

Measured on the running API before the fix:

```
GET /api/caring-community/sub-regions      -> 401, no endpoint executed
GET /api/v2/caring-community/sub-regions   -> 403 FEATURE_DISABLED
    log: "Executing endpoint CaringCommunitySubRegionsController.Index"
```

The alias reached the controller body with **no user**. It returned 403 rather
than the tenant's data only because `caring_community` happened to be switched
off. Eleven endpoints were affected — ten caring-community routes plus
`users/me/match-preferences`, which 500ed instead of challenging.

It hid for so long because the **action**-level alias helpers in the same file
have always used the copy constructor `new SelectorModel(source)` and are
correct, so most aliases behaved; and because a route inventory counts the alias
as present either way. The fix routes every controller-level adder through
`AddControllerAlias`, which copies the source selector.

**Lesson for future work:** when a route exists twice, test BOTH spellings
anonymously. Equal route counts are not equal authorisation.

---

### 1b. Feature flags: the switch and the display read different rows (fixed 2026-08-17)

Not authorisation, but the same shape of defect — found while checking why
`/api/v2/public/events` differed.

Tenant feature flags live in `tenant_configs`, and this backend had grown **two
spellings for the same flag**:

| Spelling | Written by | Read by |
| --- | --- | --- |
| `features.{flag}` | seeders, admin paths | the gates that enforce access — `PublicEventsController`, `AuthController`, `OutOfScopeFeatureGuardMiddleware`, every Caring Community service |
| `feature.{flag}` | several tests | `/api/v2/tenant/bootstrap` — **all forty flags it publishes** — plus `MemberParityController` and the volunteering services |

Bootstrap is how the React frontend learns which features a community has, so
the switch and the display were reading different rows. Reproduced live:

```
INSERT features.public_events = true
GET /api/v2/public/events     -> 200    (the gate honoured it)
GET /api/v2/tenant/bootstrap  -> features.public_events = false
```

The backend was serving a feature the frontend had been told did not exist. The
reverse is worse: switching a default-on feature OFF left the frontend still
advertising it, sending members to a screen the backend refuses.

Fixed by `Nexus.Api.Support.TenantFeatureKeys`, which every reader now goes
through. It reads **both** spellings, canonical first. It deliberately does not
pick one: live rows exist under the canonical spelling and tests write the
legacy one, so collapsing to a single key would silently discard whichever half
it dropped — the same failure again in the other direction. Pinned by
`tests/Nexus.Api.Tests/TenantFeatureKeySpellingTests.cs`.

---

## 2. Response envelope and field names

**Status: partially divergent. Measured per endpoint by the harness.**

Concrete example from run 1 — `GET /api/v2/tenant/bootstrap`, which **every page
load calls**:

- Missing in ASP.NET: `data.currency`, `data.default_layout`,
  `data.branding.logo_shape`, and feature flags `caring_community`,
  `marketplace`, `merchant_coupons`, `message_translation`, `member_premium`
- Extra in ASP.NET: `data.branding.logo`, `favicon`, `favicon_url`,
  `primary_color` **and** `primaryColor`, `secondary_color` **and**
  `secondaryColor`, `og_image_url`

🔴 Note the snake_case/camelCase duplicates on the ASP.NET side. Emitting both
spellings is not "compatible" — it is two contracts, and a client that reads the
wrong one breaks when the duplicate is eventually removed.

**Progress 2026-08-16: 169 missing fields -> 0.** Every field Laravel sends,
ASP.NET now sends. Sequence was 169 -> 142 (feature flags + scalars) -> 29
(the four config blocks) -> 7 -> 0 (modules, authentication_config,
service_area, onboarding, landing_page_config, tenant_switcher).

🔴 **The config-block defaults were EXTRACTED, not typed.** 113 keys came
straight out of Laravel's own `DEFAULTS` constants by reflection
(`.local-docs-archive/dump_config_defaults.php`) and were code-generated into
C#. Hand-copying 113 booleans and numbers would have introduced silent
mistakes that no test would catch, because a wrong default still returns a
plausible value.

🔴 **They are FLAT keys containing dots** (`"listing.max_images"`), not
nested objects. Printed field paths look identical either way, so this is easy
to get wrong and impossible to see in a diff of path names.

🔴 **`landing_page_config` is `null`, not `{}`.** Laravel sends null when
none is configured and the client distinguishes the two.

**Still open on this endpoint: the EXTRA fields.** Laravel's `branding` has
four keys (`name`, `tagline`, `logo_url`, `logo_shape`); ASP.NET sends twelve,
including both `primary_color` and `primaryColor`. ASP.NET also repeats the
whole payload at the root as well as under `data`. Neither breaks a client
reading Laravel's keys, which is why this is second in priority — but a
comment in `AdminSettings.tsx` claims the bootstrap exposes `branding.logo`,
so **check what the client actually reads before deleting anything**. That is
its own piece of work, not a tidy-up to fold into a field-addition change.

**Superseded note (kept for the reasoning): 169 -> 142.** Fixed: all 20 absent
feature flags, plus `currency`, `default_layout`, `default_language`,
`supported_languages`, `branding.logo_shape` and `meta.base_url`.

🔴 The flags were the damaging part. The client treats an ABSENT flag as
"module off", so marketplace, courses, podcasts, identity verification,
two-factor and biometric login were all silently disabled on this backend with
nothing in any log to say so. Defaults come from Laravel's
`TenantFeatureConfig::FEATURE_DEFAULTS`, **not** from a live tenant -- hOUR
Timebank has `partner_venues` and `public_events` switched on while both
default off, so copying its response would have shipped one community's
overrides as everybody's defaults.

**The remaining 142, all per-tenant config blocks:**

| Block | Fields |
| --- | --- |
| `data.volunteering_config` | 36 |
| `data.job_config` | 35 |
| `data.listing_config` | 27 |
| `data.group_tabs` | 15 |
| `data.authentication_config` | 7 |
| `data.tenant_switcher` | 7 |
| `data.config.modules` + `data.modules` | 11 |
| `settings`, `contact.service_area`, `landing_page_config` | 4 |

These are mechanical -- read a tenant setting, emit it with Laravel's default --
but there are a lot of them, and each default must come from Laravel rather
than be invented. `tenant_switcher` is the exception: it needs the tenant
hierarchy, which now exists (R-26).

🔴 **The harness will keep reporting SHAPE_DIFFERS for bootstrap until the
last of the 142 lands**, because its verdict is per endpoint, not per field.
Partial progress on a big payload is invisible in the 8/20 headline -- measure
this one by field count.

**Also outstanding here:** ASP.NET emits the whole payload TWICE -- once under
`data.*` and again at the root -- plus both `primary_color` and `primaryColor`.
The root projection was for `apps/react-frontend`, which was deleted on
2026-08-09, so it is very likely dead. Removing it is a separate change from
adding fields, and needs a check that nothing reads it first.

---

## 3. Status codes

**Status: divergent on 7 of the first 20 sampled.**

Includes the authorisation cases above plus `404 vs 200` differences that mean
the endpoint simply is not implemented on one side.

**What to do:** the harness reports this directly. No separate tool needed.

---

## 4. Error shapes

**Status: the 401 envelope is now uniform. 44 -> 51/118 on the web-uk corpus.**

🔴 This backend had **three different 401 bodies** depending on how each endpoint
happened to be protected:

| Produced by | Body |
| --- | --- |
| A policy (`NexusAuthorizationResultHandler`) | `{"errors":[{code,message}],"success":false}` — correct |
| A bare `Unauthorized()` | RFC ProblemDetails: `{"type","title","status","traceId"}` |
| `Unauthorized(new { error = "..." })` | a third shape again |

Laravel sends the first for every authenticated endpoint checked, including
`group-exchanges`. Fixed centrally by `Filters/LaravelAuthEnvelopeFilter`, an
always-run result filter that rewrites any non-conforming 401 — chosen over
middleware because rewriting a response body after the fact is what made
`SurnamePrivacyMiddleware` quietly rename groups. It deliberately leaves a 401
that already has an `errors` array alone, so the policy handler's richer
messages survive.

A `JwtBearerEvents.OnChallenge` handler covers the other path — an endpoint with
`[Authorize]` and no policy — so a future bare `[Authorize]` cannot reintroduce
ProblemDetails.

🔴 **Two tests pinned envelopes Laravel does not send**, and both were named for
parity. `CanonicalRoutes_RequireAuthentication_AndReturnLaravelEnvelopes`
asserted `{success,error,code}` and explicitly required `errors` to be **absent**
— the opposite of what Laravel returns for that exact path. `MemberAuthGate`
asserted that the public skill taxonomy rejects anonymous callers. Both were
corrected against the running Laravel rather than against belief. That is now
**three** parity-named tests in one day asserting the opposite of the source of
truth.

**Still unmeasured:** 422 validation bodies, which need a POST and therefore a
disposable Laravel — the local one is a production-derived snapshot.

**Superseded note:**

Laravel has three distinct error envelopes and they are not interchangeable:
domain `{"errors":[{code,message,field?}]}`, auth `{success:false,error,code}`,
and framework 422 `{message, errors:{field:[msgs]}}`.

**What to do:** extend the harness with a deliberate-failure pass — request a
nonexistent id, omit a required field, send a bad type — and diff the error
bodies. Discount Laravel's debug-mode keys (trap 1 above).

---

## 5. The 229 do-nothing endpoints

**Status: known, itemised, unchanged.**

229 endpoints a client calls that perform no work; 63 more that nothing calls at
all and should be **deleted, not implemented**. Full triage in `R-29`.

**What to do:** work them in the order the harness gives, not the order the stub
detector gives. A stub that returns the right empty shape is less urgent than a
working endpoint that returns the wrong shape.

---

## 6. Database tables

**Status: ~205 absent (was 211; six added 2026-08-16). Zero phantom tables.**

Many of the 229 cannot be implemented without a table first. That is design
work, not plumbing.

**What to do:** per subsystem, and only for subsystems a client actually calls
(demand table in `R-29`). Before creating any table, grep for guarded raw SQL
against that name — see the table-exists-guard hazard.

---

## 7. The endpoint set the accessible frontend calls

**Status: 51/118 as of 2026-08-16.**

🔴 **Read this number correctly.** It is **an ASP.NET measurement**, not a web-uk
one: 118 URLs were extracted from `web-uk/src` and used as a *test corpus* for
comparing the two BACKENDS. web-uk itself was never started, never pointed at
ASP.NET, and not one line of it was modified. Nothing here certifies the
accessible frontend against this backend — that remains a separate gate and a
separate workstream, untouched.

Earlier revisions of this document and several commit messages called this
"web-uk: 51/118", which reads as though the accessible site were 43% working.
It does not mean that.

**Why this corpus is still the right one to use:** it exercises endpoints the
React app never calls. `/api/v2/users/search` — which returned member names and
email addresses to anonymous callers — is called by the accessible frontend and
not by React. A React-only corpus could not have found it.

The generated contract matrix is rooted at `react-frontend`. **`web-uk` appears
nowhere in any generated inventory**, and there is no record of it ever being
run against ASP.NET.

**First measured 2026-08-16 against this corpus: 43/118 contract-identical** (ASP.NET vs Laravel, on the paths web-uk calls).

118 parameter-free GET paths extracted from `web-uk/src` (Express/Nunjucks, so
the calls are in server-side code, not a bundle). Path list regenerates with:

```bash
grep -rhoE "['\"\`]/(api/)?v2/[a-zA-Z0-9/_.:{}$-]+" web-uk/src | tr -d "'\"\`"   | sed 's/\${[^}]*}/{id}/g' | sort -u
```

🔴 **It immediately found SIX more endpoints serving anonymously what Laravel
protects** — none of which the React-only measurement could ever have seen:

| Endpoint | Was |
| --- | --- |
| `/api/v2/users/search` | **member names AND email addresses to anyone** |
| `/api/v2/courses` | 200 anonymous |
| `/api/v2/podcasts` | 200 anonymous |
| `/api/v2/resources/categories` | 200 anonymous |
| `/api/v2/resources/categories/tree` | 200 anonymous |
| `/api/v2/jobs` | 200 anonymous |

All fixed. `users/search` is the most serious disclosure this work has found.

🔴 It also corrected something I had written into this document earlier the same
day: the note on the resources endpoint said its CATEGORIES stay anonymous
"because Laravel serves those publicly". That was an assumption, and it was
wrong — they sit in the same `auth:sanctum` group. **Measuring the second
frontend caught an error in the fix for the first.**

**Still open (14 status + 13 shape).** Three go the other way — `clubs`,
`listings/tags/popular`, `skills/categories` are public on Laravel and 401 here,
so signed-out visitors lose working pages. `public/events` is 200 vs 403, a
feature-gate difference.

**Fixed since (2026-08-16, same day): 43 -> 44/118 on that corpus.** The three reverse cases —
`clubs`, `listings/tags/popular`, `skills/categories` — are public on Laravel and
were 401 here, so signed-out visitors lost working pages. Two of the three carry
an explicit `->withoutMiddleware('auth:sanctum')` in `routes/api.php`, which is
about as clear an intent signal as that file offers. They now match on status;
two moved into SHAPE_DIFFERS, which is progress, not a win.

### 🔴 One unexplained anomaly, guarded but not diagnosed

`/api/jobs` returned 401 while its auto-generated `/api/v2/jobs` alias returned
**200 to an anonymous caller**, both routed to the same
`JobsController.List`, whose controller already carries `[Authorize]`.

Sibling aliases (`/api/v2/jobs/recommended`, `/api/v2/jobs/saved-profile`) were
correctly protected, so this is **not** a blanket failure of
`AdminV2RouteAliasConvention` — and that is exactly why it is worth recording.
An action-level `[Authorize]` closes it and is verified, but **the mechanism is
unexplained**.

**Do not remove that attribute on the grounds that the class already has one.**
If the cause is ever found, re-check every aliased route before concluding this
was the only one: I proved it is not systemic, not that it is unique.

**Next, and NOT started:** pointing web-uk's API base at ASP.NET and walking its
pages would test what a path list cannot — redirects, forms, session handling.
🔴 That is the accessible-frontend certification gate, a separate
workstream. Nothing in this document has done it, and the numbers above must
not be cited as evidence that it has been done.

---

## 8. Pagination, filtering, sorting

**Status: unmeasured.**

Already visible: ASP.NET returns `meta:{per_page,cursor,next_cursor,has_more,total}`
on marketplace and `meta:{base_url,cursor,per_page,has_more}` on volunteering —
two different meta shapes within one backend, before comparing to Laravel at all.

**What to do:** the harness's shape diff catches this once the endpoints return
data. Needs seeded data on both sides to be meaningful.

---

## 9. Localization

**Status: ~5,424 keys absent.**

Matters to the contract wherever the API returns a **message** the client
displays rather than a code it maps.

**What to do:** lower priority than 1–3. Prefer codes over prose in responses;
an endpoint that returns a stable `code` is contract-identical even when the
prose differs.

---

## 10. Uploads, realtime, side effects

**Status: unmeasured.**

Uploads (multipart field names, size limits, returned URL shape), realtime
(Pusher channel names and event payloads), and side effects (does an action send
the same notification?) are all part of the contract and none is compared.

**What to do:** after 1–7. Side effects need their own harness — comparing what
each backend *wrote*, not what it returned.

---

## Next measurable batch — the legacy duplicate-key envelopes

**Status: suspected divergence, NOT yet measured. Do not fix blind.**

Laravel's `respondWithData` emits exactly `{data, meta}`. This backend has two
habits Laravel does not have:

- **39** responses of the form `Ok(new { data = badges, badges })` — the payload
  repeated under a second, legacy key.
- Many more carrying `success = true` beside `data` (21 in `AdminFeedController`
  alone, 10 in `AdminExplicitParityController`).
- **`next_cursor` in pagination meta, which Laravel does not have.** Laravel's
  `respondWithCollection` emits `cursor` and **only when it is non-null** — it
  omits the key rather than sending null, so a client testing `'cursor' in meta`
  gets the wrong answer on every last page. Fixed on `/api/v2/public/events`
  where the harness could see it; `events/{id}/lifecycle-history` and the
  volunteer-hours list still emit `next_cursor` and are authenticated, so they
  are unverified. Two tests currently PIN `next_cursor`, so this needs the
  Laravel comparison before it is changed, not after.

Where these were measurable they were all divergences and all removed —
`help/faqs` had `faqs`, `platform/stats` had `stats`, `blog/categories` had
`success`. So the prior is strong.

🔴 **They are still not proven, and must not be stripped on that prior alone.**
Almost all sit behind authentication, so the anonymous harness never reaches
them, and this plan has already recorded three separate occasions where a
"consistent rule" applied without measurement broke something real. Two of the
duplicate keys may also be deliberate: a Laravel endpoint built with a raw
`response()->json()` instead of the base-controller helper follows no rule at all
(`/api/v2/categories` legitimately has no `meta`).

**What unblocks this:** an authenticated mode for the harness, which needs a
**disposable** Laravel environment. The ordinary local Laravel database is a
confidential production-derived snapshot and is never a fixture, so the
authenticated corpus cannot be run against it. Provision the disposable
environment first; then this batch is mechanical and verifiable in one pass.

---

## Order of work

1. **Authorisation boundaries** — cheap, catches a disclosure, one request each
2. **`tenant/bootstrap`** — every page load depends on it
3. **Error shapes** — extend the harness, then fix
4. **web-uk path extraction** — turn one measured frontend into two
5. **The 229**, ordered by harness verdict
6. **Tables**, per called subsystem
7. Pagination → localization → uploads/realtime/side effects

## Definition of done

Not "all routes exist". It is: **the harness reports MATCH for every endpoint
both frontends call, anonymous and authenticated, success and failure** — and
the authenticated half requires a disposable Laravel database, because the
ordinary local one is a production-derived snapshot that must not be mutated.
