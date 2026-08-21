# Admin (Staff Tier) Endpoint Corpus (generated)

Generated: 2026-08-21 (repository SHA `95cd4913bfdf7a13f4ded7636822e6632d622c8e`)

> 🔴 **Regenerated later the same day, 2026-08-21, after the stub scanner was
> rewritten.** This document's central finding — that there are three ways an
> endpoint does no work and the ratchet saw one — was acted on:
> `check-noop-stubs.ps1` now counts all three, counts ROUTES rather than methods,
> and carries a per-category shrink-only baseline (`noop-stubs-baseline.json`,
> now **562 routes / 326 methods**, was `316` methods).
>
> Three things moved here as a result, all corrections in the same direction:
>
> - The inventory this document consumes now holds **564 do-nothing routes across
>   326 methods** rather than 375 routes attributed to 316 methods. The extra
>   routes come from bare `[HttpGet]` attributes (no template), `~/absolute`
>   templates that the old path-joiner mangled into `/api/auth/~/api/v2/...`, and
>   `[Route("[controller]")]`, all of which previously resolved to paths no client
>   could call — so a condition-5 check against them always answered "clean".
> - The scanner's work-detection tokens were unanchored, so `_repo` matched the
>   response literal `auto_hide_report_threshold` and `_token` matched
>   `csrf_token`. **Three genuinely do-nothing methods were being excused by
>   their own response field names.** One of them is an admin endpoint and is
>   reclassified below.
> - **One row changed class: `GET /api/v2/admin/moderation/settings`,
>   `identical-candidate` → `stub`.** `ReactFrontendCompatibilityController.AdminModerationSettings`
>   returns three hardcoded moderation settings and reads no tenant configuration.
>   It had been attributed to `AdminExplicitParityController.Get`, which does have
>   an explicit branch for the `/api/v2` spelling — this is limitation 3 below
>   (the `/api/v2` → `/api` collapse) producing a real misclassification, not a
>   hypothetical one.
>
> Everything else is unchanged: 1,119 endpoints, 1,008 client-called, the 138
> dispatcher fall-throughs, and every family total except V.

- Generator: `aspnet-backend/scripts/build-admin-corpus.mjs`
- Scope authority: [ADR-0004](../../decisions/ADR-0004-journey-equivalence-is-the-target.md)
- Work list this feeds: [`JOURNEY_CERTIFICATION_LEDGER.md`](../../JOURNEY_CERTIFICATION_LEDGER.md) Tier 5
- Method: **static**. No backend was contacted, no browser driven, no live
  response differ run. See "What this cannot see" before quoting any number.

This is the corpus behind ledger Tier 5 — 70 staff journeys that were written
provisionally, before anything about the admin surface had been measured. It
exists so that tier can be scheduled from evidence.

## Sources scanned

| Source | Path | Result |
| --- | --- | ---: |
| Laravel routes | `routes/api.php` | 2,689 unique method+path routes |
| — of which admin | path contains `admin` | **1,119** |
| React admin client | `react-frontend/src/admin` | 721 files, 260 declared route paths |
| Broker client | `react-frontend/src/broker` | 77 files, **0** own API calls — it imports `@/admin/api/adminApi`, so it is already inside the React admin corpus |
| Web UK | `web-uk/src` | **6** admin endpoints with a live caller |
| Mobile | `mobile/` | **0** admin-path calls |
| Published contract | `openapi.json` | 335 admin paths / 430 admin operations |
| ASP.NET route/operation matrix | `aspnet-backend/artifacts/parity/api/api-parity.json` | 4,638 ASP.NET operations |
| ASP.NET no-op inventory | `aspnet-backend/artifacts/parity/stubs/stub-routes.json` | 564 do-nothing routes across 326 methods, four categories |

Earlier prose said **514 admin GET routes** and **260 admin route paths**. Both
were re-derived rather than inherited: the admin route declarations are exactly
**260**, and the admin GET count is now **516** (two added since that figure was
written). Nothing in the earlier claim was materially wrong.

## The admin corpus by method

| Method | Count |
| --- | ---: |
| GET | 516 |
| POST | 366 |
| PUT | 148 |
| DELETE | 86 |
| PATCH | 3 |
| **Total** | **1,119** |

A middleware-based definition of "staff surface" (routes inside an `admin` /
`super-admin` / `broker-or-admin` middleware group) is deliberately **not**
used here: the brace-depth tracking needed to attribute nested middleware
groups in a 4,320-line route file proved unreliable, and publishing a number
built on it would be worse than publishing none. The path-based definition
misses 29 staff-flavoured routes whose path omits the word `admin` (11 under
`/v2/safeguarding`, 4 under `/v2/newsletter`, the rest scattered). That is a
2.6% undercount, named rather than hidden.

## Four-way classification

| Class | Count | Meaning |
| --- | ---: | --- |
| `identical-candidate` | 750 | A counterpart exists and appears to do real work. **Not certified.** |
| `stub` | 253 | A counterpart exists and performs none of the endpoint's work. |
| `uncalled` | 111 | No client reads it and no published contract names it — a **deletion candidate in both engines**, not work (ADR-0004). |
| `absent` | 5 | A client calls it and ASP.NET has no counterpart. |

### The number the schedule turns on

**Of the 1,008 admin endpoints a client actually calls, 258 (25.6%) are stub or
absent.**

That is a **static upper bound on health** and a **static lower bound on work**.
It counts only endpoints this pass could prove do nothing. A live run finds
shape mismatches static analysis cannot see — on the member read corpus, 64 of
80 differing endpoints turned out to be real work, so the live number will be
higher, not lower.

### Three ways an endpoint does no work — all three now on the ratchet

Until the 2026-08-21 rewrite only the first kind was counted, which is what
made 316 look like the whole of the problem.

| Sub-kind | Count | Visible to `check-noop-stubs.ps1`? |
| --- | ---: | --- |
| no-op method (no database, no service call) | 109 | yes |
| dispatcher fall-through to a generic echo store | 138 | **now yes** |
| hardcoded payload behind real auth work | 6 | **now yes (hand-read list)** |

**1. no-op method.** `build-stub-route-inventory.mjs` used to resolve 316
do-nothing methods while recording **one route per method**, and a method can
carry many: `ReactFrontendCompatibilityController.AdminEmptyData` carries six
`[Http*]` attributes and the inventory listed one. That false negative is
documented in the source at that method — it once reported two exchange
endpoints clean. **Fixed 2026-08-21**: the scanner emits one finding per route,
so the inventory now holds 564 routes across 326 methods, and this generator
reads them as given rather than re-expanding them (re-expanding an
already-expanded artifact would multiply every route by its method's attribute
count).

**2. dispatcher fall-through — the largest single finding, and new.**
`AdminExplicitParityController` holds five catch-all actions that switch on
`Request.Path`:

| Dispatcher | Routes declared | Explicit switch branch | Falls through |
| --- | ---: | ---: | ---: |
| `Delete()` | 18 | 6 | 12 |
| `Get()` | 151 | 87 | 64 |
| `Patch()` | 3 | 1 | 2 |
| `Post()` | 101 | 30 | 71 |
| `Put()` | 48 | 20 | 28 |
| **Total** | **321** | **144** | **177** |

The default arm is `PersistCompatibilityWrite` / `GetPersistedCompatibilityRead`
(`AdminExplicitParityController.cs:5840` and `:5904`) — a **generic echo store**.
A write records the request body in `CompatibilityAuditEntries` and answers
`202` with `side_effect = "recorded_only"`; the matching read replays whatever
was recorded for that path. It touches the database, which is why the old
"does this body do work?" heuristic passed it, and it returns a plausible
success shape — but nothing is moderated, sent, applied, or deleted.

🔴 **The scanner now detects this directly** (`check-noop-stubs.ps1`, category
`echo_store`, 177 routes with its own shrink-only baseline). Its implementation
is a faithful port of `dispatcherFallThrough()` below and the two were verified
to produce the identical route set — 321 declared, 144 with an explicit branch,
177 falling through. They are kept as independent replicates on purpose: if they
ever disagree, one of them is wrong and the disagreement is the finding.

All 177 fall-through routes are in this admin corpus. **138 are called by a
client** and are classified `stub` here; the remaining 39 sit on endpoints no
client calls, so they classify as `uncalled` (a deletion candidate takes
precedence over a defect). One is also caught by the no-op scanner.

**3. hardcoded payload.** Real authorisation work, then a fabricated response.
Found only by opening method bodies; there is no reliable static rule, so this
list is a **floor**. Each was read by hand on 2026-08-21:

| Method | What it actually returns |
| --- | --- |
| `AdminPerformanceSummaryController.Summary` | `slowest_requests`, `slowest_queries`, `memory_spikes` are `Array.Empty`, `request_volume` an empty dictionary — always. The performance dashboard can never show data. |
| `AdminPrerenderCompatibilityController.Coverage` | reads tenants, then reports `rendered = 0` and every expected route missing, always |
| `AdminPrerenderCompatibilityController.TenantSafety` | `snapshots = 0`, `stale = 0`, `missing = all`, always |
| `AdminPrerenderCompatibilityController.Purge` | validates, writes an audit row, returns `deleted_count = 0`. Nothing is purged. |
| `AdminPrerenderCompatibilityController.PurgeUnexpected` | `deleted_total = 0`, unconditionally |
| `AdminCompatibility2Controller.SelectAbWinner` | unconditional `409` "No persisted A/B test variants exist", `supported = false` |

A heuristic scan for this pattern produced 8 candidates; 2 were opened and
**rejected as real work** (`AdminCompatibility3Controller.ListAdminComments` and
`.GetSuperAuditLog` both take an empty early return only under a query filter).
That is why the list is hand-read and not generated.

🔴 **Prerender needs a live check regardless of this count.** Only 2 of the 28
admin prerender endpoints touch the database at all; `Metrics()` returns
hardcoded zeros and `Health()` a hardcoded `"green"`. Four are confirmed above;
the rest are unproven either way and this pass cannot settle them.

## By family

Family names are the ledger's own Tier 5 families (rows 5.1–5.70).
`called` = a client reads it. `ok` = `identical-candidate`.

| Family | Ledger rows | Endpoints | Called | ok | stub | absent | uncalled | Endpoints per row |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A — Admin access and shell | 2 | 6 | 4 | 4 | 0 | 0 | 2 | 3.0 |
| B — Members admin | 5 | 39 | 34 | 28 | 6 | 0 | 5 | 7.8 |
| C — Listings moderation | 2 | 11 | 10 | 9 | 1 | 0 | 1 | 5.5 |
| D — Events admin | 2 | 16 | 16 | 16 | 0 | 0 | 0 | 8.0 |
| E — Groups admin | 3 | 44 | 36 | 14 | 22 | 0 | 8 | 14.7 |
| F — Safeguarding | 2 | 32 | 25 | 25 | 0 | 0 | 7 | 16.0 |
| G — Credits and wallet administration | 2 | 9 | 8 | 5 | 3 | 0 | 1 | 4.5 |
| H — Tenant settings, gates and branding | 3 | 64 | 61 | 54 | 7 | 0 | 3 | 21.3 |
| I — Performance and monitoring | 2 | 12 | 12 | 10 | 2 | 0 | 0 | 6.0 |
| J — Super-admin | 3 | 66 | 60 | 46 | 9 | 5 | 6 | 22.0 |
| K — Broker | 3 | 22 | 20 | 18 | 2 | 0 | 2 | 7.3 |
| L — Newsletters and deliverability | 5 | 70 | 63 | 36 | 27 | 0 | 7 | 14.0 |
| M — GDPR and enterprise compliance | 5 | 57 | 48 | 19 | 29 | 0 | 9 | 11.4 |
| N — Caring Community administration | 4 | 159 | 136 | 136 | 0 | 0 | 23 | 39.8 |
| O — AI and matching administration | 4 | 41 | 41 | 21 | 20 | 0 | 0 | 10.3 |
| P — Analytics and reporting dashboards | 4 | 14 | 9 | 9 | 0 | 0 | 5 | 3.5 |
| Q — Billing and premium | 2 | 62 | 59 | 57 | 2 | 0 | 3 | 31.0 |
| R — Content management | 5 | 90 | 82 | 58 | 24 | 0 | 8 | 18.0 |
| S — Gamification administration | 3 | 17 | 17 | 14 | 3 | 0 | 0 | 5.7 |
| T — Platform provisioning and identity | 3 | 99 | 90 | 60 | 30 | 0 | 9 | 33.0 |
| U — Taxonomy | 2 | 8 | 8 | 8 | 0 | 0 | 0 | 4.0 |
| V — Operations | 4 | 181 | 169 | 103 | 66 | 0 | 12 | 45.3 |

### Worst subtrees, by share of client-called endpoints that do nothing

| Subtree | Endpoints | Called | stub or absent | Rate |
| --- | ---: | ---: | ---: | ---: |
| `/admin/volunteering/*` | 57 | 52 | 34 | **65%** |
| `/admin/groups/*` | 32 | 25 | 15 | **60%** |
| `/admin/enterprise/*` | 48 | 41 | 24 | **59%** |
| `/admin/newsletters/*` | 48 | 43 | 24 | **56%** |
| `/admin/reports/*` | 20 | 19 | 9 | 47% |
| `/admin/jobs/*` | 19 | 16 | 7 | 44% |
| `/admin/federation/*` | 62 | 60 | 24 | 40% |
| `/admin/super/*` | 54 | 51 | 9 | 18% |
| `/admin/config/*` | 52 | 49 | 7 | 14% |
| `/admin/users/*` | 31 | 26 | 1 | 4% |
| `/admin/caring-community/*` | 155 | 133 | 0 | **0%** |
| `/admin/marketplace/*` | 20 | 17 | 0 | 0% |
| `/admin/crm/*` | 19 | 19 | 0 | 0% |
| `/admin/safeguarding/*` | 22 | 16 | 0 | 0% |

🔴 **A 0% here is the least trustworthy figure in this document.** Caring
Community is the widest .NET coverage of any family — 155 endpoints, none of
them a stub this pass can see — and the ledger already warns that this is
precisely the family where "the route exists" is least likely to mean the work
is done. It is the first place a live run should go, not the last.

## Method-body sample

Route existence proves nothing, and neither does a classification built on route
existence. **52 ASP.NET method bodies were opened and read**: a deterministic
stratified sample of 46 `identical-candidate` rows (two per family) plus 6
targeted follow-ups.

- 46 sampled `identical-candidate` rows → **43 do real work, 3 do not**
  (`performance/summary`, `prerender/coverage`, `newsletters/{id}/ab-winner`).
  All three are now reclassified as `stub`.
- 2 of the 46 could not be resolved to a C# method by the first version of this
  generator's static index. Both were resolved by hand and both were **real**
  (`CaringCommunitySuccessStoriesController.RefreshLive`,
  `AdminCaringCommunityProjectUpdatesController.Publish`). The cause was the
  generator taking the first `[Route]` prefix in a file that holds three
  controller classes; that is fixed, and the fix is commented in the source.
- 6 targeted follow-ups on the hardcoded-payload pattern: 4 confirmed, 2
  rejected as real work.

**So roughly 1 in 15 endpoints still classed `identical-candidate` here is
expected to be doing nothing.** Applied to 750, that is on the order of 50 more
defects this pass has not individually identified — which is why 25.6% is a
lower bound on work.

## What this cannot see

Every one of these is a way this document can be too optimistic.

1. **No request was issued.** Everything here is source reading. The `starts_at`
   / `start_date` class of fault — every call returns 200 and the page renders an
   error — is invisible to it. Only rendering the page finds that.
2. **`identical-candidate` is not certified.** It means a counterpart exists and
   appears to do work. Field shape, pagination metadata, status codes, error
   envelopes, tenancy and side effects are all unverified.
3. **`/api/v2` is collapsed onto `/api`.** Keys mirror
   `compare-laravel-api-parity.ps1`'s normaliser so its verdicts join. So
   "exists" can be true because the unversioned twin exists.
   `AdminV2RouteAliasConvention` synthesises most `/api/v2` aliases at startup
   and appears in no source file; a static pass cannot prove the versioned twin
   the React client actually calls is there.
4. **The hardcoded-payload list is a hand-read floor**, not a total.
5. **Client-call extraction has both error directions.** Fully computed URLs and
   dynamic property access are invisible (undercount → an endpoint wrongly
   called `uncalled`). Indirect path literals are recorded with method
   UNRESOLVED and can attach a reader to the wrong verb (overcount).
6. **111 `uncalled` endpoints are a deletion *proposal*, not a decision.**
   ADR-0004 requires the owner to see the list before anything is deleted. The
   full list is in `admin-corpus.csv`, filter `classification=uncalled`.

## Feedback on ledger Tier 5's row names

The plan permits this pass to **rename** Tier 5 rows, never to add or remove
them; a genuinely new journey fills `5.RESERVE-A`/`5.RESERVE-B`, and both being
insufficient is an owner escalation. This section is the input for that
decision. **No ledger edit was made here.**

### Rows carrying far more surface than one row implies

| Family | Rows | Endpoints | Per row |
| --- | ---: | ---: | ---: |
| V — Operations | 4 | 181 | 45.3 |
| N — Caring Community | 4 | 159 | 39.8 |
| T — Platform provisioning and identity | 3 | 99 | 33.0 |
| Q — Billing and premium | 2 | 62 | 31.0 |
| J — Super-admin | 3 | 66 | 22.0 |
| H — Tenant settings, gates and branding | 3 | 64 | 21.3 |

### Rows carrying much less than the tier average (1,119 / 70 = 16.0 per row)

A — Admin access and shell (3.0), P — Analytics dashboards (3.5), U — Taxonomy
(4.0), G — Credits and wallet administration (4.5), S — Gamification (5.7).
G in particular is 2 rows for 9 endpoints, and both rows are credit-moving, so
under-abstraction there is defensible; A, P, U and S look genuinely generous.

### Subtrees with ≥8 endpoints that no Tier 5 row names

Substring test against the Tier 5 section, so it is generous — a subtree counts
as named if the word appears anywhere in the tier.

| Subtree | Endpoints | Client-called | stub or absent |
| --- | ---: | ---: | ---: |
| `/admin/federation/*` | 62 | 60 | **24** |
| `/admin/marketplace/*` | 20 | 17 | 0 |
| `/admin/crm/*` | 19 | 19 | 0 |
| `/admin/tools/*` | 14 | 14 | 3 |
| `/admin/<leaf>` (no subtree) | 14 | 9 | 5 |
| `/admin/courses/*` | 10 | 6 | 0 |
| `/admin/ki-agents/*` | 10 | 10 | **10 — every one** |
| `/admin/insurance/*` | 9 | 9 | 0 |
| `/admin/partner-venues/*` | 9 | 9 | 0 |
| `/admin/fadp/*` | 9 | 7 | 5 |
| `/admin/api-partners/*` | 8 | 6 | 0 |

Two more are *nominally* named but not really:

- **`/admin/volunteering/*` — 57 endpoints, 34 of 52 client-called ones do
  nothing (65%).** The only Tier 5 mention is `admin/volunteering/safeguarding`
  inside row 5.15. There is no row for volunteering administration itself
  (organisations, applications, expenses, giving days, training, custom fields,
  reminders, webhooks, community projects). On surface size and defect rate this
  is the single largest unnamed staff area.
- **`/admin/jobs/*` — 19 endpoints, 7 of 16 broken.** "jobs" appears in Tier 5
  only as *cron* jobs (5.67) and *background* jobs. Job-vacancy administration —
  moderation queue, offers, templates, interviews, bias audit, spam stats — has
  no row, and web-uk calls two of these endpoints.

### One row that hides a near-total absence

Row **5.57** (legal documents) covers `/admin/legal-documents/*`: **16
endpoints, 15 of the 16 client-called ones do nothing.** The row reads as one
ordinary journey; the surface behind it is essentially unimplemented.

### Suggested reading of the constraint

Eleven unnamed subtrees plus two nominally-named ones is more than two reserve
rows can absorb. On the plan's own rule that is an **owner escalation**, not a
silent re-cut, and not something this pass should resolve by renaming. The
Banking agent should decide; the concrete candidates for renaming rather than
escalation are the five thin families (A, P, U, S and possibly G), whose rows
could be re-pointed at unnamed surface without changing the row count.

## Two side findings worth acting on separately

- **Web UK has 19 dead admin helper functions.** `web-uk/src/lib/api.js:3656-3803`
  defines `adminGetDashboard`, `adminGetUsers`, `adminSuspendUser`,
  `adminGetCategories`, `adminGetConfig`, `adminGetRoles` and 13 more. **None
  has a caller anywhere in `web-uk`**, and every one targets an unversioned
  `/api/admin/*` path that Laravel does not declare (Laravel has 1,109 admin
  routes under `/api/v2/admin` and only 10 outside it, none of them these). They
  are excluded from the reader set here. They are dead code in the production
  accessible frontend, and a maintainer reading that file would reasonably
  believe web-uk has an admin surface. It does not — it calls six admin
  endpoints, all events and jobs moderation.
- **`ReactFrontendCompatibilityController.DeleteAdminFederationNeighborhood`
  does not scope by tenant.** It resolves the row with `FindAsync(id)` and
  deletes it. Noted in passing while sampling; not verified against ASP.NET's
  global query filters, so it is a lead rather than a finding.

## Tracked or ignored?

**Tracked.** `aspnet-backend/docs/generated/` is under version control (its
sibling `canonical-react-contracts/` and `consumed-fields/` are both committed).
`aspnet-backend/artifacts/` — where `api-parity.json` and `stub-routes.json`
live — is gitignored by `aspnet-backend/.gitignore:49`, so the inputs are
machine-local and the outputs are not.

## Files

- `admin-corpus.json` — full per-endpoint classification plus the summary block
- `admin-corpus.csv` — the same rows, one line each, for filtering

## Regenerate

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File aspnet-backend/scripts/compare-laravel-api-parity.ps1
MSYS_NO_PATHCONV=1 node aspnet-backend/scripts/build-stub-route-inventory.mjs
node aspnet-backend/scripts/build-admin-corpus.mjs
```
