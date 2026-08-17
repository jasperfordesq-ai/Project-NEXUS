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

🔴 **Two traps when reading its output:**

1. **Local Laravel runs in debug mode**, so its error bodies carry
   `exception`, `file`, `line`, `trace`. ASP.NET must NOT reproduce those — a
   `SHAPE_DIFFERS` on a 404 error body is usually this, not a real gap.
2. **A `404` from Laravel may mean the path is wrong in the seed list**, not
   that ASP.NET is wrong. Source paths from the contract matrix, not from memory.

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
