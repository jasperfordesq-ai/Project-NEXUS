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

**Progress 2026-08-16: 169 missing fields -> 142.** Fixed: all 20 absent
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

**Status: unmeasured beyond 404s.**

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

## 7. The second frontend — 🔴 NEVER MEASURED

**Status: completely unmeasured. This is the biggest blind spot.**

The generated contract matrix is rooted at `react-frontend`. **`web-uk` appears
nowhere in any generated inventory**, and there is no record of it ever being
run against ASP.NET.

**What to do:**
1. Extract web-uk's API call sites (it is Express/Nunjucks, so calls are in
   server-side code, not a bundle) and feed them to the harness as a path list.
2. Then point web-uk's API base at ASP.NET and walk its pages.

Until that happens, "two frontends by two backends" is proven for one frontend.

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
