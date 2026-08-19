# Current ASP.NET Contract Status

Last verified: 2026-08-18 (full evidence regeneration from live code; **rescored**
under a new named baseline — see "Fixed Rubric Baseline 2" below)

Status: **Canonical current - ASP.NET score and certification source**

<!-- doc-consistency: ASPNET_CURRENT_BANKED_SCORE=598/1000 -->
<!-- doc-consistency: ASPNET_CURRENT_RUBRIC=ASPNET-CONTRACT-R2 -->

🔴 **This score is unrelated to Web UK's.** Two 1000-point denominators exist in
this repository and they measure different things: this one measures whether
ASP.NET is externally contract-identical to Laravel; Web UK's `WEBUK-W2-PROD-R1`
measures whether the accessible frontend is safe to serve in production. Every
score marker carries a rubric id for exactly this reason — **never add the two
together, and never present one as progress on the other.**

This workstream was paused from 2026-07-15 to 2026-08-14. **The owner lifted the
pause on 2026-08-14** with an explicit instruction to drive ASP.NET to full
contract parity and production readiness.

Use this document for the current ASP.NET completion score. Use
[`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md) for
the fixed rubric, shared evidence gates, and execution loop. The finite ordered
backend queue lives in this document. Historical
scores elsewhere are checkpoints only and do not override this page.

For the current schema-chain verdict and cold-start sequence, read
[`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md). It does not create
a separate backend score.

The matching accessible-frontend source is
[`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md).
Do not combine its score with the ASP.NET score: the two workstreams have
different evidence gates.

---

## Fixed Rubric Baseline 2 — 598/1000 (rescored 2026-08-18)

<!-- Rubric id ASPNET-CONTRACT-R2. Baseline 1 (712/1000) is retained below as
     audit trail and is NOT rewritten, per the runbook's rule that Laravel drift
     creates a separately named baseline rather than a silent rescore. -->

**Evidence boundary:** monorepo `8f6d527bd87d9c07cc5c619bf397b2cad7592f41`
(branch `main`). `aspnet-backend/src` and `aspnet-backend/tests` are byte-identical
to `450535aab`, the most recent commit whose CI run actually executed the ASP.NET
jobs. Every number below was regenerated from live code on 2026-08-18, not read
from a previous document.

| Category | Banked | Maximum | Open |
| --- | ---: | ---: | ---: |
| Active Laravel API route representation | 96 | 100 | 4 |
| Semantic workflow and canonical-consumer contract parity | 185 | 350 | 165 |
| Schema, migrations, data integrity, and upgrade safety | 118 | 150 | 32 |
| Auth, tenant isolation, security, and localization | 74 | 100 | 26 |
| Full build/test/CI evidence | 85 | 100 | 15 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 10 | 125 | 115 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 30 | 75 | 45 |
| **Total** | **598** | **1000** | **402** |

### 🔴 Why the score FELL from 712 while the backend improved

This is the single most important thing to understand about this rescore, and it
must not be reported as a regression.

**The code got better.** Since the 2026-08-15 audit: the tenant hierarchy and
regional-super-admin subtree confinement now exist (F1/F9 closed); the three
webhook handlers that returned HTTP 200 while discarding the event now refuse with
501 and leave it in the sender's retry queue (F7 closed); no-op handlers fell from
349 to 319; scheduled jobs rose from 20 to 26, all registered; and the full test
suite is green in CI across every shard.

**The measurement got honest, and it is what moved the number.** The 307/350
banked for semantic parity under Baseline 1 was set when **no instrument existed
that could compare a response**. Parity was inferred from route inventories and
implemented workflow families. `scripts/compare-live-responses.mjs` (2026-08-16)
and a signed-in disposable Laravel (2026-08-17) can now ask both backends the same
question. Measured on the 170 GET paths the canonical React frontend actually
calls, signed in:

| | Count |
| --- | ---: |
| Same status AND same JSON shape | **64** |
| Envelope matches, row contract untested (one side has no rows) | 24 |
| Different | 82 |
| Status disagreements | 0 |

37.6% of the most-used read surface is contract-identical. Banking 87.7% against
that would be indefensible. The drop is 122 points of *discovered* divergence, not
122 points of new breakage.

Movement by category, Baseline 1 → Baseline 2:

| Category | R1 | R2 | Driver |
| --- | ---: | ---: | --- |
| Route representation | 100 | 96 | Laravel drift: 9 genuine method-level gaps |
| Semantic parity | 307 | **185** | First direct response measurement: 64/170 |
| Schema/upgrade | 129 | 118 | 215 Laravel tables absent; no populated-history upgrade proof |
| Auth/tenant/security/localization | 97 | **74** | F1/F9 closed (+), but 5,424 localization keys absent (−) |
| Build/test/CI | 45 | **85** | Fresh-checkout CI green on every ASP.NET job |
| Dual-backend frontend runtime proof | 10 | 10 | Unchanged — neither frontend has been run against ASP.NET |
| Providers/jobs/ops/docs | 24 | 30 | Webhooks refuse (+); Meilisearch/FCM still non-functional (−) |

### Evidence behind each category

All commands were run on 2026-08-18 from `aspnet-backend/`.

**1. Route representation — 96/100.**
`scripts/compare-laravel-api-parity.ps1` reports 2,667 source operations,
2,648 matched, **19 missing**. 🔴 That 19 is NOT the gap count: probing each one
against the running API with its own HTTP method shows **10 are served** and the
generator's route-shape matching simply misses them (for example
`GET /api/auth/oauth/enabled-providers` answers 200). The genuine method-level
gaps are **9** — 6 paths absent entirely and 3 present without the required
method:

| Gap | Kind |
| --- | --- |
| `GET /api/messages/{message}/voice` | absent (404) |
| `POST /api/csp-report` | absent |
| `POST /api/events/{id}/attendance/code` | absent |
| `POST /api/events/{id}/registration-product/guests/{guestId}/attendance/{action}` | absent |
| `GET /api/legal/status` | absent |
| `GET /api/volunteering/credentials/{id}/download` | absent |
| `GET /api/messages/{message}/attachments/{attachment}` | path exists, GET not served (405) |
| `POST /api/legal/accept` | path exists, POST not served (405) |
| `POST /api/legal/accept-all` | path exists, POST not served (405) |

So 2,658/2,667 at method level (99.66%). Deduction 4: the messages and event
attendance gaps are client-consumed, and the legal trio is a whole Laravel
controller family (`LegalController`) unserved at its non-v2 paths.

**2. Semantic parity — 185/350.** Deduction 165, itemised:
- **−60** 82 of 170 measured GET endpoints differ in shape.
- **−55** `scripts/check-noop-stubs.ps1` reports **319** action methods returning
  success-shaped payloads with no database access and no service call. Worst
  files: `MiscParityController` 87, `AdminCompatibility2Controller` 52,
  `AdminCompatibility3Controller` 33, `ReactFrontendCompatibilityController` 30.
  Matches the shrink-only baseline; down from 349 on 2026-08-15.
- **−50** writes, uploads, realtime and side effects are **entirely unmeasured**.
  The harness is GET/HEAD only. 208 write-response test assertions remain
  unverified against Laravel.
Credit retained for genuinely implemented and pinned workflow families: partner
venues (15 tests), support actions / carer sub-accounts (39), guardian consent and
authority attestations (13), the legal acceptance gate (14), impersonation (5),
and the two small-endpoint batches (12).

**3. Schema/migrations/upgrade — 118/150.**
`scripts/compare-laravel-schema-parity.ps1`: 472 Laravel source tables, 460
ASP.NET tables, 257 matched, **215 missing**, 203 extra. 410 Laravel migrations vs
**183** ASP.NET migration classes on disk (latest
`20260817121949_AddSkillCategories`). Deduction 32: −20 for the 215 absent tables,
−12 because no populated-history upgrade has been proven to complete without row
loss, and no deliberately invalid tenant/financial history has been shown to fail
preflight without partial schema change.

**4. Auth/tenant/security/localization — 74/100.** Deduction 26:
- **−18** localization depth. `scripts/compare-laravel-localization-parity.ps1`:
  20,240 Laravel keys, 3,431 matched, **5,424 missing**, 374 missing namespaces.
  26.8% of Laravel's keys have no ASP.NET counterpart. This alone made the 97/100
  banked under Baseline 1 impossible to defend.
- **−5** residual security items: FCM push targets a decommissioned endpoint, and
  `oauth/me/identities` advertises a provider (`apple`) Laravel does not.
- **−3** tenant isolation is unproven for the 215 absent tables, since a table
  that does not exist cannot have its scoping tested.
🔴 **Genuine improvements banked here:** `Support/Authorization/SuperPanelAccess.cs`
now models `master` and `regional` levels with a materialised-path subtree check,
and `Entities/Tenant.cs` carries `ParentId`, `Path`, `Depth`, `AllowsSubtenants`
and `MaxDepth`. F1 and F9 are **closed**. Tenant scoping is also enforced globally
rather than per call site: `NexusDbContext.OnModelCreating` applies a tenant query
filter to every `ITenantEntity` by reflection — verified empirically on 2026-08-17
by inserting a row for another tenant and confirming it was not returned.

**5. Build/test/CI — 85/100.**
- CI run at `450535aab` (2026-08-17 20:42): **ASP.NET build success, all six API
  test shards success, Messaging tests success, image builds success.** GitHub
  Actions checks out fresh, so this satisfies the "clean checkout" requirement.
- `aspnet-backend/src` and `tests` are **unchanged** between `450535aab` and HEAD,
  so that aggregate covers the current ASP.NET code.
- Local confirmation 2026-08-18, `dotnet test Nexus.sln -c Release`:
  `Nexus.Api.Tests` **3,644 passed / 0 failed / 0 skipped**, `Nexus.Messaging.Tests`
  **38 passed / 0 failed**.
- 🔴 Read the pass COUNT, never the exit code: this runner exits 0 with failures
  present, observed repeatedly.
- 🔴 And never trust a green tick alone. The most recent *overall* green run
  (`83df7d815`) had **every ASP.NET job SKIPPED** by the changed-paths filter. A
  workflow conclusion of "success" is not evidence that this backend was tested;
  the job-level conclusions are.
Deduction 15: −8 no coverage or test-quality gate evidence, −7 the static contract
inventory job was skipped in the covering run, so its assertions are unproven at
this SHA.

**6. Dual-backend unchanged-frontend runtime proof — 10/125.** Unchanged, and the
largest single block of open points. Neither the canonical React frontend nor Web
UK has been run against ASP.NET. 🔴 `compare-live-responses.mjs` is **not** this
proof: it compares two backends directly and starts no frontend. Web UK's own
switch (`ACCESSIBLE_BACKEND_TARGET=aspnet`) exists but has never been exercised.

**7. Providers/jobs/integrations/ops/docs — 30/75.** Deduction 45:
- **−20** scheduled coverage: **26** scheduled job classes, all 26 registered as
  hosted services, against **70** scheduled units in Laravel's `bootstrap/app.php`
  (~37%). Still absent by name: `retention:enforce`, `backup:verify`,
  `gdpr:check-overdue-requests`, `slo:check`, `queue:verify-liveness`,
  `email:health-alert`, `stripe:check-stuck-webhooks`.
- **−12** two integrations are implemented but non-functional: Meilisearch
  incremental indexing (`IndexDocumentAsync`, `IndexDocumentsAsync`,
  `DeleteDocumentAsync` have **zero callers** outside the service, so new content
  never reaches the index and deleted items stay findable), and FCM push
  (`PushNotificationService.cs:570` defaults to `fcm.googleapis.com/fcm/send`,
  the legacy endpoint Google has retired).
- **−13** no live-provider or operational proof: no Stripe live run, no identity
  provider exercised, no backup/restore drill recorded for this backend.
🔴 **Corrections banked here:** the three webhook handlers now return **501** and
log an error rather than `Ok(new { received = true })`, so a Stripe, identity or
SendGrid event is retried by the sender instead of being destroyed — F7 closed.
And `MarketplaceEscrowReleaseJob` does call `ProcessEligibleEscrowReleasesAsync`
with an `auto_timeout` trigger gated on `AutoCompleteAt`, so the earlier claim
that "sellers are never paid out" is **withdrawn** for escrow-backed orders.

---

## 2026-08-19 — WRITES are measured now: 6 -> 10 of 18, and the envelope rule extended on 11-of-11 evidence

Writes were the last completely unmeasured surface. They are measured now, and
the count moved from **6 of 18 to 10 of 18 contract-identical** on the same
corpus. The read side was re-measured immediately afterwards and is **unchanged
at 79 of 170**, so nothing was traded for this.

| | Before | After |
| --- | --- | --- |
| Same status AND same JSON shape | 6 | **10** |
| Different shape | 8 | **6** |
| Status disagreements | 3 | **1** |
| Non-JSON on both sides | 1 | **1** |

### Two endpoints INVENTED data rather than refusing

`POST /api/v2/listings` and `POST /api/v2/events` both accepted anything and
substituted values for whatever was missing — literally `?? "Untitled listing"`
and `?? DateTime.UtcNow.AddDays(7)`. So an event posted with no date was created
a week from whenever the request arrived, and an event posted with an
unrecognised date field was given that fabricated date instead of the one
supplied. Laravel refuses both.

The listing rules are **per community, not constants**: `ListingService::validateData`
reads `min_title_length`, `min_description_length`, `require_category`,
`allow_offers` and `allow_requests` from tenant config. This backend was already
publishing those in `/tenant/bootstrap`'s `listing_config` and never applying them.

🔴 **Laravel's validation envelopes are per-endpoint, not global.** Listings return
`{"code":"VALIDATION_ERROR","field":…}`; events return lowercase
`{"code":"validation_failed","details":{field:[messages]}}` plus `success:false`;
resources return `{"code":"VALIDATION_REQUIRED_FIELD","field":…}`. Three different
shapes on three creates. Each was read from the live response — unifying them
would have been wrong three ways.

### `POST /api/v2/resources` answered 500 where Laravel answers 400

A non-multipart request reached `ReadFormAsync`, which throws
`InvalidOperationException("Incorrect Content-Type: application/json")`, and the
error handler turned that into a 500 with a stack trace. All five of its refusals
now carry Laravel's exact codes and wording, measured individually: no title, no
file, an 11 MB upload (`FILE_TOO_LARGE` / "File exceeds 10MB limit"), an `.exe`
(`FILE_TYPE_NOT_ALLOWED` / "File type not allowed") and a `.pdf` with `MZ` content
("This file type is not allowed (HTML/SVG/PHP)").

### `LaravelDataEnvelopeFilter` covers writes for `meta` — and the `success` strip was REVERTED after 82 red tests

The filter was GET/HEAD-only, and its own docblock said why: no instrument had ever
compared a write. Now one has.

```
2xx Laravel writes carrying a `data` key      : 11
...of those, also carrying meta.base_url      : 11
...of those, carrying a top-level `success`   :  0
counter-examples in either direction          :  0
```

🔴 **Half of this shipped and half was reverted. The half that was reverted is the
more useful record.**

The change had two parts, and treating them as one claim was the mistake:

| | Direction | Evidence | Outcome |
| --- | --- | --- | --- |
| Add `meta.base_url` to writes | **additive** | writes 11-of-11, 0 counter-examples | **shipped** |
| Strip top-level `success` from writes | **subtractive** | 41-to-0, but taken across 170 **GET** endpoints | **reverted** |

The partial run showed six admin tests failing and the tempting read was "admin must
be different — narrow the filter". That was worth checking, and the check was
worthwhile: signing in to the disposable Laravel as its own admin
(`e2e.admin@project-nexus.local` / `AdminPassword123!`, from `E2ETestDataSeeder`)
showed `POST admin/registration/resume-signups`, `PUT admin/retention/policies/*`
and `PUT admin/settings/header-colors` all return `{data, meta}` with **no**
`success`. Laravel really is consistent.

🔴 **But the full run failed 82 tests, not six** — and 3,577 passed, which is how a
40-minute run still exits 0. Eleven samples cannot license removing a key from every
write in the backend; they establish only that those eleven Laravel writes omit it.
So the strip was scoped back to reads, where its own 41-to-0 count was taken.

🔴 **The decisive check: the strip bought NOTHING.** Re-measured with it reverted,
write parity is **10 of 18 — unchanged**. The whole 6 -> 10 movement came from the
`meta` addition and the per-endpoint fixes. It cost 82 red tests for zero measured
gain. Had the score dropped, this would have been a real trade-off to weigh; it did
not, so there was nothing to weigh.

The six test edits were reverted with it. They were changed on the blanket rule, and
once the rule is gone they would have been asserting something this backend does not
do.

🔴 **Still open, and now precisely stated:** Laravel omits `success` on those three
measured admin writes and this backend sends it. That is a real divergence. Closing
it means editing those handlers, per endpoint, against a live read — not widening a
filter. Any future attempt needs a per-endpoint `success` count on writes taken the
way the 41-to-0 read count was taken.

🔴 The `/api/v2` restriction stays even for writes. Seven of the eight member
samples are v2; exactly one is not (`POST /api/legal/accept-all`, which does carry
meta). One sample is not a rule, so that route emits its own meta in
`LegalShortRoutesController` instead of widening the filter.

### 🔴 A measurement defect: every field-level figure in this workstream was understated

`describeShapeDiff` capped its two lists at `.slice(0, 8)` with nothing marking the
truncation, so "8 missing fields" was the display cap being read as a count. Both
harnesses now print the true total beside the sample. Re-read honestly, the write
divergences are much larger than recorded: created group **77** fields short,
created listing 67, created poll 38, created goal 37, profile update 22.

Nothing about either backend changed here. What changed is that the numbers are no
longer quietly wrong, and reviewing the eight-name sample is no longer mistakable
for reviewing the difference.

### Harness changes

- `body(ctx)` now receives a **per-backend** context. A valid listing needs a real
  category id and the two backends mint different ids, so a single fixed body could
  only ever exercise the refusal. `ctx.categoryId` is resolved from each backend's
  own `/api/v2/categories` just before the run. That immediately exposed a
  divergence the refusal had hidden.
- Corpus widened 13 -> 18 (group, event, goal, resource, notification preferences)
  specifically to raise N before extending a shared filter.
- Every row now records `laravel_envelope` / `aspnet_envelope` observations, so the
  count that justifies an envelope change is evidence in a file rather than a claim
  in a commit message.

### 🔴 The invented-data sweep: three more, and a LARAVEL defect

The two creates that invented data were found by chance, so every `??` fallback on
a request field in `src/Nexus.Api/Controllers` was swept. Most are harmless — a
`?? "Unknown"` filling a name in a RESPONSE, or a defensive default when reading a
stored blob back. Three are the real fault, where a fabricated value is **saved**:

| Endpoint | ASP.NET | Laravel (measured) |
| --- | --- | --- |
| `POST /api/v2/groups/{id}/tasks` | 201, title saved as `"Untitled task"` | **422** `{"code":"VALIDATION_ERROR","message":"Title is required","field":"title"}` |
| `POST /api/v2/wallet/categories` | 201, name saved as `"General"` | **400** `{"success":false,"error":"Name is required"}` |
| `POST /api/ideation-challenges/{id}/ideas` | 201, title saved as `"Untitled"` | **404** — the route does not exist |

**All three are FIXED and verified live** (behaviour re-checked against the rebuilt
container, not inferred from the diff). The group-task refusals additionally match
Laravel on all three of its cases, each measured: `Title is required` /
`Invalid status` / `Invalid priority`, all 422, all `{errors:[…]}` with no `success`
key. This backend had been answering 400, with different wording, plus a `success`
key Laravel does not send — three differences at once on a single response.

🔴 **The first attempt at this fix silently did not apply, and the lesson is about
verification, not C#.** The new helper was appended before the file's last brace,
which closes the NAMESPACE rather than the class (block-scoped namespace), so it
landed inside an unrelated DTO class: 4 compile errors. The container still reported
healthy, because it was still running the PREVIOUS image. `docker compose build`
output had been sent to /dev/null, so nothing surfaced the failure.

What caught it was probing the endpoints and seeing `"Untitled task"` come back
again. A health check proves a container is answering; it proves nothing about WHICH
build is answering. Never verify a fix by rebuilding and checking health — verify it
by asking the endpoint what it now does.

🔴 The group-task one has a validation check that **can never fire**:

```csharp
var title = ReadStringProperty(request, "title", "name") ?? "Untitled task";
if (string.IsNullOrWhiteSpace(title))                      // dead: the line above
    return BadRequest(LaravelValidationError("title", …));  // guarantees a value
```

The placeholder is applied on the line above the guard, so the guard's condition is
unreachable. It reads like validated input and is not. One handler serves both the
v2 and non-v2 spellings (it branches on `IsV2Request()`), so both are affected.

🔴 **Two routes exist here that Laravel does not have.**
`POST /api/groups/{id}/tasks` and `POST /api/ideation-challenges/{id}/ideas` are
registered without the `/v2/` prefix; Laravel registers only `/v2/` forms
(`routes/api.php:1179, 3765`) and 404s the bare ones. React calls only the `/v2/`
spellings (`ChallengeDetailPage.tsx:493`, `TeamTasks.tsx:190`), so nothing depends
on the extras. Note the ASP.NET v2 ideas handler ALREADY validates correctly (400
`VALIDATION_REQUIRED_FIELD`) — it is the non-v2 twin that invents.

🔴 **A defect in LARAVEL, not this backend.** `POST /api/v2/ideation-challenges/{id}/ideas`
with no `title` makes **Laravel** answer **500**:
`Undefined array key "title"` at `app/Services/IdeationChallengeService.php:425`.
That is live production code reachable by any client that omits the field. It is
NOT a contract to reproduce — ASP.NET's 400 is the better answer and stays. Raised
for the owner separately; changing Laravel is not part of this workstream.

### What is left on writes

- `POST /api/v2/groups` is the worst remaining: **77** fields short, and it returns
  `{success, message, group}` — the payload under `group`, not `data`, with
  camelCase field names (`isPrivate`, `imageUrl`). It is the only write still
  sending a top-level `success`, because the filter requires a `data` key to act.
- Created poll (38), goal (37), listing (67) and profile update (22) are field-level
  tails, all of them Laravel returning a raw Eloquent model plus appended attributes.
- `POST /api/v2/search/saved` makes **Laravel itself** answer 500. Not a contract to
  copy; it needs its own diagnosis.
- `PUT /api/v2/users/me/notification-preferences` 404s on both. The path was my
  guess and is wrong on both backends — find the real one before counting it.
- Multipart writes are still uncompared: the harness posts JSON only, so the
  resource-create SUCCESS shape (Laravel returns a deliberate 8-field projection,
  not a raw row) has not been diffed.

## Baseline 1 (712/1000) and all dated sections below are AUDIT TRAIL

🔴 Everything from here down is history. Baseline 1's 712/1000 is retained
unrewritten, per the runbook's rule that Laravel drift creates a separately
named baseline. **It is not the current score.** Where a dated finding below
has since been closed or corrected, a note says so inline.

## 2026-08-17 — Live response parity on the React GET corpus: 136 -> 164 of 170

This section records **measured response behaviour**, not a rubric score. The
banked score at the time (`712/1000`, Baseline 1) was untouched by it; nothing in
this section had been through the rubric's
evidence gates. Read it as: what happens today when both running backends are
asked the same question.

Instrument: `scripts/compare-live-responses.mjs`, against the running Laravel
(`127.0.0.1:8090`, tenant 2) and the running dev ASP.NET (`127.0.0.1:5080`,
tenant 1). Corpus: the 170 GET paths the canonical React frontend calls. Method
and traps: [`CONTRACT_PARITY_PLAN.md`](CONTRACT_PARITY_PLAN.md).

| | Start of day | End of day |
| --- | --- | --- |
| Same status AND same JSON shape | 136 | **164** |
| Envelope matches, contents untestable (empty list / null field one side) | — | 6 |
| Different | 38 | **0** |
| Endpoints open to anonymous callers that Laravel protects | 9 | **0** |

Four defects behind that, each invisible to every source-tree instrument in this
repository:

1. **`/api/v2` alias routes executed without authentication.**
   `AdminV2RouteAliasConvention` built controller-level aliases as a bare
   `SelectorModel`, which under endpoint routing carries no `[Authorize]`
   metadata. Eleven endpoints ran their action body for anonymous callers; ten
   returned 403 only because the owning community had that section switched off.
   A route inventory counts the alias as present either way.
2. **`[AllowAnonymous]` beats `[Authorize]`** regardless of specificity, so three
   marketplace endpoints read as protected in source and were open in fact.
3. **Feature switches split across two key spellings.** The gates read
   `features.{flag}`; `/tenant/bootstrap` read `feature.{flag}` for all forty
   flags it publishes. A community's setting therefore reached the enforcement
   half or the display half, never both. Now centralised in
   `Support/TenantFeatureKeys.cs`, which reads both.
4. **`skills/categories` answered from the wrong table.** No `skill_categories`
   table existed here, so the endpoint returned listing categories: a 200 with
   plausible content describing a different taxonomy. Added as an entity plus
   migration `20260817121949_AddSkillCategories`; the full chain replays clean
   from empty on a disposable PostgreSQL, and
   `has-pending-model-changes` is green.

🔴 **That signed-out number was never the real number.** Most of the 170 resolve
to 401 on both sides, which proves the authorisation boundary agrees and says
nothing about the payload behind it. Later the same day a disposable Laravel
made the signed-in comparison possible, and it read **17/170**. See the section
below.

## 2026-08-17 (later) — SIGNED-IN parity: 17 -> 57 of 170

🔴 **Read this before quoting the signed-out score.** With a disposable Laravel
to sign in to, the same 170 React GET paths scored **17/170**, not 164/170. The
signed-out run was honest about what it measured and useless as a summary: the
401s were hiding every payload.

`bash aspnet-backend/scripts/start-disposable-laravel.sh` builds a second
Laravel on `:8091` from the committed schema plus `E2ETestDataSeeder` —
synthetic fixtures, **no real member data** — so it can be signed into, written
to and destroyed. The harness now refuses to send credentials to `:8090`.

| Change | Identical | Envelope right, rows untestable | Differing |
| --- | --- | --- | --- |
| first signed-in run | 17 | 8 | 145 |
| `meta` added by a shared filter | 31 | 21 | 118 |
| both fixtures given the same features | 42 | 21 | 107 |
| six authorisation/validation fixes | 47 | 21 | 102 |
| stray `success` flag removed | **57** | **31** | **82** |

Endpoints where the two disagree about whether to answer at all: **29 -> 2**.

**Six defects behind the login, four of them authorisation:**

1. `jobs/talent-search` listed every member who had made themselves visible TO
   EMPLOYERS, to any signed-in member. Laravel restricts it to admin tiers and
   to members who have posted a vacancy.
2. `federation/activity` and `federation/messages` served members who had never
   opted in. Federation publishes a member's profile beyond their own community;
   the opt-in is the consent, and it was not being read.
3. `marketplace/promotions/products` ignored the promotions setting, which is a
   SECOND switch on top of the marketplace feature and defaults off.
4. `me/push-campaigns` — paid notifications to a community's members — had no
   feature gate at all.
5. `exchanges/check` answered `can_exchange: true` for a request naming no
   listing. Laravel returns 400 VALIDATION_REQUIRED_FIELD.
6. `kb/search` returned every published article for an empty query; Laravel
   requires `q`.

**Two shared-envelope fixes**, both applied in one filter
(`Filters/LaravelDataEnvelopeFilter.cs`) because in Laravel they come from one
shared base controller, not from 89 separate decisions:
`meta.base_url` added, and the `success` flag removed, on `/api/v2` GETs
returning `data`. Measured 89-vs-0 and 41-vs-0 — never wrong in the other
direction on any measured endpoint.

🔴 **Still not covered:** writes, uploads, realtime, and the 229 do-nothing
handlers. And 31 endpoints have a correct envelope whose ROW contract is
untested because the fixture holds only three users and one listing — richer
fixtures are the next thing that raises real confidence, not the next code
change.

## 2026-08-17 (later still) — richer fixture rows: the untestable column 39 -> 17

The prediction in the paragraph above was right, and this is the measurement.
Two changes since: sixteen list endpoints were corrected to report `meta` rather
than `pagination` (57 -> 59), then the disposable Laravel was given realistic
content.

| | Before fixture | After fixture |
| --- | --- | --- |
| Same status AND same JSON shape | 59 | **61** |
| Envelope matches, rows untestable | 39 | **17** |
| Different | 72 | **92** |
| Status disagreements | 0 | **0** |

`E2ETestDataSeeder` leaves the fixture at **4 users, 1 listing, 8 categories and
nothing else**. Endpoint by endpoint, **Laravel was the empty side in 35 of the
39** — ASP.NET already had rows. `scripts/parity-fixture.sql` (applied by
`start-disposable-laravel.sh`) seeds one realistic row per entity the React
corpus reads.

🔴 **The 20 endpoints that moved into "different" are pre-existing row-level
defects the thin fixture was hiding, not new breakage.** Judge this change by the
untestable column. The identical count rising by 2 is incidental, and quoting it
as the win would misread what happened.

🔴 **Every filter was read off the running Laravel's query log rather than
guessed** — a row that fails the real `WHERE` clause seeds nothing, which looks
exactly like not having run the fixture. `categories` alone serves three
contracts keyed by `type`; the feed reads `feed_activity` and not `feed_posts`;
`/blog/categories` discards any post containing "lorem ipsum". Full list of traps
in [`CONTRACT_PARITY_PLAN.md`](CONTRACT_PARITY_PLAN.md).

🔴 **A harness hole was found and is NOT yet fixed.** `compareSkeleton` can never
return "different" once either side is an empty list, because its guard
(`b.startsWith('[')`) is tautological against the `'[?]'` marker. Six endpoints
are consequently reported as untestable when they are really envelope
divergences — Laravel `{data:{items:[…]}}` against ASP.NET `{data:[…]}` on
`/coupons`, `/jobs/my-applications`, `/me/verein-dues`,
`/volunteering/donations`, `/volunteering/training`, and
`{data:{profile:null}}` against `{data:null}` on `/jobs/saved-profile`. Fixing
the rule will move these into the differing column; that is its own measured
step.

No ASP.NET source changed in that step, so the banked score is untouched.

### 🔴 The richer fixture immediately found a credential disclosure

`GET /api/v2/connections/suggestions` was
`Ok(new { data = await _db.Users...ToListAsync() })` — **the whole `User` entity, to
any signed-in ordinary member**. Verified live before the fix: every suggested
member carried

- `passwordHash` — the bcrypt hash, crackable offline
- `totpSecretEncrypted` — the second factor
- `emailVerificationCode`, `email`, `authenticationInvalidatedAt`
- every admin flag (`isSuperAdmin`, `isGod`, …) and `suspensionReason`

Laravel sends seven fields and not one is sensitive. This is the same defect class
as the `users/search` leak: **returning an EF entity publishes whatever the entity
happens to hold, so the disclosure grows silently as columns are added.** It sat
behind the login, which is why the signed-out run never saw it, and behind an
empty Laravel list, which is why it read as "envelope matches" until the fixture
had rows.

Fixed by projecting the exact Laravel field set, read off the running Laravel and
`ConnectionSuggestionController.php` rather than inferred: `data` is an **object**
holding `suggestions` (not a bare list), `limit` defaults to 5 and clamps to
1..20, candidates exclude self/inactive/suspended, and `mutual_connections_count`
and `connection_status` are the constants Laravel hard-codes. `shared_skills` is
computed from the relational `UserSkills` because this backend has no
`users.skills` JSON column — same meaning and shape, a deliberate internal
difference.

Pinned by `tests/Nexus.Api.Tests/ConnectionSuggestionsDisclosureTests.cs` (4
tests, all passing). The disclosure test asserts against the **raw response text**
rather than named properties, so a future entity column cannot leak past it.
`AdminV2RouteAliasRuntimeTests` re-run green (234/234).

A corpus-wide sweep for the same defect class then ran against **both** backends
(all 170 paths, signed in, looking for `passwordHash`, `totpSecret`,
`emailVerificationCode`, `remember_token`, `api_key` and eleven more). Result:
**no other credential disclosure**. Two lesser findings —
`marketplace/seller/dashboard` exposed `suspensionReason` (fixed below), and
`/api/v2/categories` exposes a stray `reset_token` column on **both** backends,
which is schema cruft on the `categories` table rather than a user credential and
is contract-identical, so it is recorded and deliberately not "fixed".

### The five `data.items` envelopes — differing 87 → 82

Exposed by fixing the harness hole above. Laravel wraps these rows in an object
under `data`, this backend returned a bare list, so a client looping over `data`
gets nothing from the production backend:

| Endpoint | Laravel |
| --- | --- |
| `/api/v2/coupons` | `{items}` |
| `/api/v2/jobs/my-applications` | `{items, cursor, has_more}` |
| `/api/v2/me/verein-dues` | `{items, total}` |
| `/api/v2/volunteering/donations` | `{items, next_cursor}` |
| `/api/v2/volunteering/training` | `{items, cursor, has_more}` |

🔴 **Four different pagination shapes across five endpoints.** There is no rule to
generalise, and which wrapper a Laravel route emits is not derivable from its
response — each was read live. Applying one shape to all five would repeat the
`per_page`/`has_more` over-generalisation that cost 22 endpoints in a single run.

All five now report envelope-correct. Their rows stay uncompared because the
ASP.NET fixture holds none for these entities — the mirror image of the Laravel
fixture problem solved earlier, and the next fixture job.

### 🔴 `main` was red, from two earlier commits, and is green again

A full `dotnet test Nexus.sln -c Release` run read **3,636 passed / 8 failed** (read
the COUNT — this runner exits 0 with failures present). None of the eight came from
the work in this section; all were pre-existing, in files this session never
touched, from two earlier commits:

| Test | Cause |
| --- | --- |
| `RegistrationPolicyTests.GetPublicConfig_DefaultPolicy_ReturnsStandard` | `b60c8398d` |
| `RegistrationPolicyTests.GetPolicy_AsAdmin_ReturnsPolicy` | `b60c8398d` |
| `UsersControllerTests.GetMe_AsMember_ReturnsOk` | `b60c8398d` |
| `V15FeedActivityCompatibilityTests.FeedV2_Merges…` | `8582235b2` |
| `VolunteeringControllerTests.ListOpportunities_ReturnsPublishedByDefault` | `8582235b2` |

Two distinct mistakes, both worth recognising again:

🔴 **The verb-not-path mistake, for the fourth time.** Three tests asserted a v2 GET
carries no `success` on paths that are **not** `/api/v2` —
`/api/registration/config`, `/api/registration/admin/policy`, `/api/users/me`.
`LaravelDataEnvelopeFilter` is deliberately scoped to `/api/v2/`, so it never runs
on them and the v1 envelope `{success, data}` stands. Laravel has **no counterpart
route at all** for the registration pair, and only the v2 form of `users/me`
(routes/api.php:755) — so there was no Laravel contract these could have been
matching. The same correction had already been applied once in
`LaravelReactFrontendContractTests`, whose own comment says the sweep "classified
it by HTTP verb alone and missed that the PATH matters too". It was applied to that
one file and not to these three.

🔴 **A shape change landed without its tests.** `8582235b2` converted sixteen list
endpoints from `pagination:{page,limit,total,pages}` to `meta:{per_page,has_more}`,
which is right — but two tests still read `pagination.total` / `meta.total`, and
Laravel sends no `total` on either endpoint. Both now assert the keys Laravel
actually sends. The sibling `/applications` test still reads `pagination` and is
left alone, because that endpoint was not part of that change.

Verified: the four affected classes plus every area changed in this section run
**114 passed / 0 failed**.

🔴 **A second full run found three MORE of the same two mistakes**, which the first
run's log had truncated away (it was piped through `tail -40`, so only 4 of its 8
failures were ever visible — read the whole log, not its tail):

- `JobsControllerTests.ListJobs_AsAuthenticated_ReturnsOk` — still read
  `pagination.total` after `8582235b2`. `/api/v2/jobs` is one of the few endpoints
  that genuinely carries `total`, so it is still asserted, just under `meta`.
- `LaravelReactFrontendContractTests.AuthOAuthV2_…` and
  `LaravelReactUtilityCompatibilityTests.SsoAndOauthRoutes_…` — the "no `success`,
  always `meta`" rule applied to **three** OAuth/SSO endpoints that are genuinely
  `/api/v2` paths and still do not follow it. Verified against the running Laravel:
  `/api/v2/auth/oauth/enabled-providers`, `/api/v2/auth/sso/providers` and
  `/api/v2/auth/oauth/me/identities` all answer `{"success":true, …}` with **no
  meta and no data**, because those Laravel routes use a raw `response()->json()`
  instead of a base-controller helper. `LaravelDataEnvelopeFilter` encodes the same
  boundary from the other side — it only acts on a body that HAS a `data` key — so
  ASP.NET already matched and the tests were wrong.

That makes **eight** instances of this one over-generalisation, across five files.
The lesson is not "check the verb": it is that **an endpoint's envelope is a
property of the Laravel ROUTE, not of its method or its prefix**, and the only way
to know is to ask the running Laravel.

🔴 **Noted while verifying, NOT changed:** Laravel's
`/api/v2/auth/oauth/me/identities` reports `supported_providers`
`["google","facebook"]`; this backend also offers `"apple"`. A real divergence in
the provider list, separate from the envelope, needing its own decision.

Final verification for this batch: **176 passed / 0 failed** across every changed
area.

### The nine raw-record endpoints — 62 → 64 identical, differing 90 → 82

Worked deliberately as a cluster, because both of the day's real faults came from
one pattern: **an action returning an EF entity instead of a projection.** All nine
are now projected explicitly. Their nested `tenant` / `user` / `participants`
navigation properties were null at the time of the audit — no active leak — but
each was one `.Include` from publishing member records, which is exactly how the
`connections/suggestions` disclosure would have grown.

Four were not formatting problems at all:

1. 🔴 **`gamification/engagement-history` answered from the WRONG TABLE.** It
   returned raw `XpLog` rows — individual point awards — where Laravel returns one
   row per month from `monthly_engagement`. A 200 with plausible content describing
   something else entirely, the same class as `skills/categories` answering from
   listing categories.
2. **`wallet/categories` returned the raw entity and skipped Laravel's feature
   gate** — Laravel answers `{"balance":0,"enabled":false}` when the community has
   the wallet switched off, not an empty list or a 403.
   🔴 **CORRECTION, issued 2026-08-17 after the fix was already committed
   (`110effbe5`):** that commit and an earlier version of this entry claimed the
   query "had NO TENANT PREDICATE" and "returned every community's categories to
   any signed-in member". **That was wrong.** An explicit `Where(TenantId == …)` is
   not the only thing that scopes a query in this backend:
   `NexusDbContext.OnModelCreating` walks every entity type and applies
   `ApplyTenantQueryFilter` to anything implementing `ITenantEntity` (:741-750), and
   `TransactionCategory` implements it. Verified rather than argued — a row was
   inserted for another tenant and the endpoint did not return it. **No data was
   ever exposed.** The explicit `Where` was kept because it makes the scoping
   legible at the call site, but it changed no behaviour.
3. **`/api/v2/groups` had no visibility or status filter**, so private, secret,
   inactive and child groups would all be listed. Laravel filters to
   `status='active'`, top-level-or-featured, and public or where the caller is the
   owner/an active member. Stated precisely: this is a **missing filter in the code
   path**, not observed exposure — the demo tenant holds only public, active
   groups, so nothing was actually disclosed here either.
4. **`gamification/member-spotlight`** returned one member as an object where
   Laravel returns a list, and ranked purely by XP so the same person is spotlit
   for ever; Laravel picks at random, seeded by the day.

`gamification/challenges` and `gamification/personal-journey` now MATCH.
`groups/form-capabilities` moved to envelope-correct.

### 🔴 The envelope filter was itself renaming keys to PascalCase

`LaravelDataEnvelopeFilter.ToMutableMap` reflected over properties using
`property.Name`. Converting an object to a dictionary bypasses serialisation
entirely, so `[JsonPropertyName]` was never consulted — and a dictionary's keys are
written verbatim, because MVC's camelCase setting is a *property* naming policy,
not a dictionary-key one.

So **every endpoint whose body or meta is a typed record had its keys renamed the
moment the filter touched it.** Measured on `/api/v2/caring-community/markt`: the
meta record declares `total`, `page`, `per_page`, `has_more`,
`marketplace_available` and the live response carried `Total`, `Page`, `PerPage`,
`HasMore`, `MarketplaceAvailable`. The endpoint was correct; the filter broke it.
Now honours the attribute, then falls back to the same camelCase policy MVC would
have applied — a no-op for the anonymous objects that make up nearly every action.

### 🔴 The features fixture was switching three modules OFF

`all-features-on.mjs` derived its list from `FEATURE_DEFAULTS` only, and its output
**replaces** `tenants.features` wholesale. `wallet`, `listings` and `messages` are
MODULES (`MODULE_DEFAULTS`), so they were absent from the written value — and
`TenantContext::hasFeature()` merges over `FEATURE_DEFAULTS` only, so a key in
neither reads as OFF. `WalletFeaturesController::listCategories` checks
`hasFeature('wallet')`, so the fixture was serving Laravel's feature-disabled body
while ASP.NET served real data, and the harness reported a contract difference that
was pure fixture disagreement. Same trap as the CORS subdomain allowlist: a
replacement value silently drops what the defaults would have supplied.

### 🔴 A live React-against-Laravel defect, reported and deliberately NOT changed

Found while checking `realtime/config` consumers, and it is **not** an ASP.NET
problem:

- Laravel's `RealtimeController::config` (:21-36) sends exactly six keys —
  `driver, key, cluster, ws_host, ws_port, force_tls`. No `enabled`.
- `PusherContext.tsx:152` stores the config only when `response.data.enabled` is
  truthy, and `:168` refuses to construct the client without it.
- `api.ts` synthesises `success: true` and unwraps `data`, so `response.success` is
  not the blocker — `data.enabled` is simply `undefined`.
- `PusherContext.tsx:186` is the **only** place the frontend constructs a Pusher
  client; `NotificationsContext` has a test asserting it does not.

Therefore the React app's realtime connection cannot start against Laravel. This
needs a live production check and an owner decision — whether Laravel gains
`enabled` or the client stops requiring it — so nothing was changed. ASP.NET keeps
`enabled` and `authEndpoint` as a **documented divergence**, because removing them
to match Laravel exactly would break realtime on this backend too, and the parity
rule forbids fixing a difference by breaking the client.

### What is left on these nine

`/api/v2/groups` still lacks `slug`, `is_featured`, `template_id`,
`template_features`, `allow_federated_members`, `federated_visibility`,
`source_idea_id`, `source_challenge_id` — **no column exists for any of them** — and
Laravel additionally returns ~15 junk columns on that row (`ancestor`, `certa`,
`apply`, `distance`, `errors`, `pages`, …). Reproducing schema cruft is a decision,
not a projection fix. `GroupsPage.tsx` reads `is_featured`, `posts_count`,
`recent_members` and `tags`, so those are real client gaps, not cosmetic.

### `marketplace/seller/dashboard` — 62/170, and money that should not have been added up

🔴 **Laravel refuses to sum unlike currencies and this backend did it anyway.**
`MarketplaceSellerService.php:249-266` groups completed orders by currency and
then sets `total_revenue` and `revenue_currency` to **null** when there is more
than one, with a comment saying it will not "pretend unlike currencies are
equal". ASP.NET summed every order and hard-coded `"EUR"`, so a seller paid in two
currencies saw one meaningless number under the wrong symbol.

It also never sent `revenue_by_currency` — which `MyListingsPage.tsx:373`
**prefers over the single figure** — so the seller's revenue panel was silently
falling back. That is a client-facing gap, not a shape nit.

The response also carried `data.profile`, the raw `SellerProfile` **entity**:
camelCase keys, `stripeAccountId`, `suspensionReason`, and a nested `user`
navigation property that is null only because nothing eager-loads it — one
`.Include` from publishing a whole User record. Laravel sends counters only.
Removed after verifying no React call site and no test reads `profile`,
`listings` or `orders`.

Endpoint now MATCHes: **61 → 62 identical, 91 → 90 differing.**

🔴 **A pre-existing red test on `main` was found and fixed in passing.**
`MarketplaceControllerTests.PromotionProductsV2_MatchesLaravelReactSelectorContract`
asserted 200 and got 403: the `marketplace.promotions_enabled` gate landed
earlier the same day without the test being updated. The gate is correct — that
setting defaults off on both backends — so the test now switches it on rather
than asserting the un-gated behaviour back into existence. `MarketplaceControllerTests`
32/32 green.

---

Evidence: `dotnet test Nexus.sln --configuration Release`. 🔴 Read the pass
COUNT, never the exit code — this runner exits 0 with failures present, observed
again on 2026-08-17 (`Failed: 2 ... [exited with code 0]`).

---

## Required End State

The product goal is a **two-frontends-by-two-backends** contract-identity model in
which neither frontend changes behavior when its backend changes:

[`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md) is binding:
"compatibility" in this filename or rubric means externally contract-identical
behavior for every consumed boundary, not an approximately similar API.

| Unchanged client | Laravel backend | ASP.NET backend |
| --- | --- | --- |
| Canonical React at `C:\platforms\htdocs\staging\react-frontend` | Production source-of-truth behavior | Same methods, paths, payloads, responses, statuses, auth, tenancy, uploads, side effects, and workflows |
| Accessible Web UK at `apps/web-uk` | Laravel-first certification target | The same Web UK code and page flows, switched by configuration only |

Route presence alone is not contract correctness. ASP.NET must reproduce the
Laravel contracts consumed by both unchanged clients, including validation and
error envelopes, redirects, authorization boundaries, tenant behavior,
provider effects, persistence, and upgrade behavior. Frontend adapters or
ASP.NET-specific page branches do not satisfy the goal.

## Current Scored Position

The **current banked score is 712/1000 (71.2%)** under Fixed Rubric Baseline 1.
The denominator is fixed; newly discovered work is recorded as a deduction or
a separately named Laravel-drift baseline, never as a silent denominator
change.

The 2026-07-15 system-wide re-audit keeps this score unchanged. Eleven backend
implementation/test commits were published to `origin/main` after the restart
scorecard. A later user-authorized transaction committed two test expectation
corrections and merged nine verified schema slices. The separately authorized
post-pause CI remediation has now produced a complete green exact-SHA aggregate
at `dbafc5c3`, but none of these changes has received a fixed-rubric scoring
transaction. All are recorded below instead of being converted into an
estimated percentage.

| Category | Banked | Maximum | Open |
| --- | ---: | ---: | ---: |
| Active Laravel API route representation | 100 | 100 | 0 |
| Semantic workflow and canonical-consumer contract parity | 307 | 350 | 43 |
| Schema, migrations, data integrity, and upgrade safety | 129 | 150 | 21 |
| Auth, tenant isolation, security, and localization | 97 | 100 | 3 |
| Full build/test/CI evidence | 45 | 100 | 55 |
| Unchanged canonical React plus unchanged Web UK dual-backend runtime proof | 10 | 125 | 115 |
| Providers, jobs, integrations, operational proof, and reproducible docs | 24 | 75 | 51 |
| **Total** | **712** | **1000** | **288** |

🔴 **Superseded on 2026-08-14 for the current Laravel HEAD:** the regenerated
comparison now reports **2,600/2,667 matched with 67 missing** (see the
2026-08-14 re-audit section below). The paragraph that follows remains true only
for the frozen `903d03d3` baseline it was written against.

Active route representation is **2,601/2,601 matched with 0 missing**. Seven
retired OpenAPI-only operations are reported separately and return to the
active gate automatically if a live Laravel route reintroduces them. This
closes the representation inventory only; it is not runtime, semantic, or
production certification. The separately generated canonical React matrix has
2,328 static call-site rows and 2,016 unique method/path entries, with 0 ASP.NET
static gaps and 171 method-unresolved entries. The reconciled inventory does not
prove payload, status, auth, tenant, side-effect, or runtime correctness; those
rows remain semantic and unchanged-client work rather than route-score evidence.

> 🔴 **The actionable version of everything below lives in
> [`PRODUCTION_READINESS_REMEDIATION.md`](PRODUCTION_READINESS_REMEDIATION.md)** —
> ordered P0–P3, with what is already fixed, what was checked and cleared, and
> what only the owner can close. Read that first when resuming work; this section
> is the audit narrative and evidence behind it.

## 2026-08-15 Fresh Audit At HEAD `870c1e989` (Advisory, Partially Complete)

Regenerated from live code at monorepo HEAD `870c1e989`, after the 14-commit
implementation run that closed the 59 React-consumed route gaps. **Advisory: banks
zero points, performs no scoring transaction.**

🔴 **Coverage is incomplete and must not be read as a clean bill of health.** Nine
adversarial reviewers were commissioned to attack this week's work and the five
Laravel-rewritten areas; **eight were killed mid-run by account credit exhaustion**
and returned no findings. One completed (React super-panel client inventory).
Everything recorded below was verified directly on disk in the main session. The
unfinished attack surface is listed at the end and is still owed.

### Mechanical inventories (regenerated)

| Comparison | Result |
| --- | --- |
| API routes | 2,659 matched, **8 missing** (was 67 on 2026-08-14 — the 59 closures are independently confirmed by the repo's own comparison script) |
| Canonical React matrix | 2,078 unique contracts, **0 static ASP.NET gaps**, 179 method-unresolved |
| Schema | 472 Laravel source tables vs 452 ASP.NET; 253 matched; **219 missing**, 199 extra |
| Localization | 11/11 locales; **5,424 missing keys**, 374 missing namespaces |

Route existence ≠ contract identity. The matrix proves paths resolve statically;
it proves nothing about payloads, status codes, or side effects.

### Verified findings

**F1 — SECURITY — no subtree confinement for regional super admins.**
🔴 **CLOSED, verified 2026-08-18.** `Support/Authorization/SuperPanelAccess.cs`
now models `master` and `regional` with a materialised-path subtree check, and
`Entities/Tenant.cs` carries `ParentId`, `Path`, `Depth`, `AllowsSubtenants` and
`MaxDepth`. The text below describing the concept as absent is history.
 Laravel
confines a hub-tenant super admin (`level = regional`) to its own tenant subtree:
`app/Core/SuperPanelAccess.php:172` sets the level, `canAccessTenant()` at `:190`
enforces it, and it is called from `AdminSuperController.php` (35 sites),
`TenantVisibilityService.php` (10), `SuperAdminAuditService.php` (4),
`EnsureSuperPanelAccess.php` (3) and `UsersController.php` (2). In ASP.NET the
entire concept is absent — the only occurrence of the name anywhere in
`src/Nexus.Api/` is an explanatory comment in `AdminSuperImpersonationController.cs`.
A regional super admin who sees only their own communities on Laravel would, on
ASP.NET, see and act on **every tenant on the platform**, impersonation included.
Pre-existing, not introduced this week, and a hard production blocker on its own.

**F2 — BREAKS-CLIENT — message voice playback and attachment download absent.**
`routes/api.php:586-587` expose `GET /v2/messages/{message}/attachments/{attachment}`
and `GET /v2/messages/{message}/voice` (`MessageMediaController`). ASP.NET has no
counterpart; `MessageAttachmentsController.cs` is a different feature (list `:29`,
attach `:68`, remove `:105`). `web-uk` renders audio from this contract
(`src/routes/messages.js:391`, `views/messages/direct-conversation.njk:123`), so on
ASP.NET a voice message cannot be played and an attachment cannot be downloaded.

**F3 — VERIFY — event guest attendance action vocabulary.** React calls
`POST /api/events/{id}/registration-product/guests/{guestId}/attendance/{action}`
(`react-frontend/src/lib/event-registration-api.ts:477`). ASP.NET's
`EventRegistrationProductController.cs:160` constrains the action to
`^(check_in|check_out|no_show|undo)$`. The Laravel vocabulary has not been
compared; a wider Laravel set would break check-in.

**F4 — DIVERGENCE — expired support actions are silent.** ASP.NET does enforce
expiry at read/execute time (`SupportPendingActionService.cs:177,204,291`), so an
expired request is inert rather than exploitable. But Laravel additionally runs
`support-actions:expire` daily (`bootstrap/app.php:57`, `ExpireSupportActions.php`)
whose stated purpose is that "the supporter is notified so an expiry is never
silent". ASP.NET has no such job, so the supporter is never told. This is a gap in
the work delivered this week.

**F5 — OPERATIONAL — scheduled work is roughly one third covered.** Laravel
schedules **56** commands in `bootstrap/app.php`; ASP.NET registers **20** jobs
under `Services/Scheduled/` via `ScheduledHostedService`. Email sending does exist
(`Services/EmailNotificationService.cs`, `FallbackEmailService : IEmailService`), so
the platform is not mute — but retention enforcement, backup verification, queue
liveness, GDPR overdue checks, stuck-webhook checks, email health alerts and the
event notification outbox have no verified counterpart.

**F6 — SCHEMA — 188 Laravel tables have no trace in ASP.NET at all.** Of the 219
unmatched Laravel tables, 31 are at least referenced somewhere in ASP.NET source;
**188 appear nowhere in `src/Nexus.Api/**/*.cs`**. They are not concentrated in one
excluded module — advertising (4), AI/agent (9), partner API/OAuth (4), challenge
depth (5) and billing/community funds (4) account for only ~27 of the 188. This is
the largest unquantified risk in the project and needs table-by-table triage into
"same thing renamed", "Laravel-only, never needed" and "genuinely missing".

### Cleared — do not re-raise

- **Regional analytics without the `/v2` prefix.** React calls the non-`/v2` form
  (`lib/api.ts:32` `API_BASE='/api'`; `RegionalAnalyticsAdminPage.tsx:98`).
  `RegionalAnalyticsSuperAdminController.cs` registers **both** — class route
  `api/super-admin/regional-analytics` (`:23`) plus absolute `/api/v2/...` twins on
  every action (`:38-175`). Matches.
- **Super-admin provisioning requests.** `routes/api.php:3196-3200` vs
  `AdminProvisioningController.cs:118-173`. Matches.
- **Broker `archives`.** Present at `AdminCompatibility2Controller.cs:599`, not
  missing. Of the broker routes genuinely absent (`exchanges/{id}/resolve-dispute`,
  `exchanges/{id}/reverse`), **neither is called by `react-frontend/src/broker/`**,
  so they are not client-breaking.
- **Super-admin route existence.** Every endpoint in the completed React
  super-panel client inventory resolves to an ASP.NET route. Shapes and
  authorization semantics remain unverified (F1 is the authorization half).

### Client contract notes worth keeping

- `adminApi.ts:2665` `getFederationStatus` has no callers — dead client method.
- `FederationTenantFeatures.tsx:100` casts through `unknown` to read a nested
  `data.features.*` shape that contradicts its declared type at `adminApi.ts:2709`
  — a live mismatch against Laravel too.
- Super audit endpoints return a **bare array with no total**; `SuperAuditLog.tsx`
  and `FederationAuditLog.tsx` synthesise pagination from page length. ASP.NET must
  return the same bare-array shape or pagination breaks silently.
- Impersonation client contract confirmed: `UserShow.tsx:207` reads `res.data.token`
  and `:213` reads `res.data.tenant_slug` — both present in the implementation.

### Second pass, same day: what the completed reviewers found (all verified on disk)

Three of the eight owed reviews were re-run after the credit reset and completed.
Every finding below was re-verified in the main session against the named lines.

**F7 — CRITICAL — three webhook handlers return HTTP 200 while discarding the
event.**
🔴 **CLOSED, verified 2026-08-18.** All three now return **501 Not Implemented**
with `success:false` and log an error, so the event stays in the sender's retry
queue instead of being destroyed. History.
 `Controllers/MiscParityController.cs` (class route `api`, all
`[AllowAnonymous]`):

- `:1328` `POST /api/webhooks/stripe` → `Ok(new { received = true })`. No signature
  verification, no body read, no work. **Stripe treats 200 as success and never
  retries**, so a payment event is destroyed permanently.
- `:1319` `POST /api/webhooks/identity/{provider}` → same. A member completes an
  identity check with any of the four providers and the result is discarded.
- `:1324` `POST /api/webhooks/sendgrid/events` → same. Bounces and spam complaints
  are thrown away, so sender reputation degrades invisibly.

This is worse than a missing route: a 404 makes the sender retry or alarm, a 200
stub destroys the event *and* reports success. Note the real, hardened Stripe
handlers do exist elsewhere (`Phase72Controllers.cs:103` donations with HMAC +
replay window + fail-closed in Production; `MarketplaceController.cs:1741`), which
is exactly why a route-level audit sees "Stripe webhook: present".

**F8 — CRITICAL — 349 action methods return success-shaped payloads while doing no
work at all.**
🔴 **STILL OPEN but the count has moved: 349 → 319** as of 2026-08-18
(`scripts/check-noop-stubs.ps1`, shrink-only baseline). The class of defect and the
worst-offending files are unchanged.
 Measured with a body-level detector (an action whose entire body
contains no `_db`, no `await`, no service call, yet returns `Ok(new {...})` /
`Created`). Worst files: `MiscParityController.cs` (84),
`AdminCompatibility2Controller.cs` (56), `AdminCompatibility3Controller.cs` (42),
`ReactFrontendCompatibilityController.cs` (31), `FrontendApiParityController.cs`
(20), `MemberParityController.cs` (19). Includes destructive admin operations that
silently do nothing: `POST super/tenants` returns `success = true, id = 0` and
creates no tenant (`AdminCompatibility3Controller.cs:633`); `PUT super/tenants/{id}`
(`:641`), `DELETE super/tenants/{id}` (`:649`), `reactivate` (`:657`),
`toggle-hub` (`:665`), `move` (`:673`), `POST super/users` (`:697`),
`PUT super/users/{id}` (`:705`), group member promote/demote/remove
(`AdminCompatibility2Controller.cs:681-691`). Full list:
`.local-docs-archive/noop_stubs.json`.
🔴 **This is the explanation for "0 static route gaps".** The routes exist and
return plausible 200s, so every route-level comparison passes while the feature
does nothing. No route inventory can detect this class; only body inspection or
runtime proof can.

**F9 — ARCHITECTURAL — ASP.NET has no tenant hierarchy at all.**
🔴 **CLOSED, verified 2026-08-18** — the hierarchy columns listed as missing below
now exist on `Entities/Tenant.cs`. History.
 The `Tenant`
entity and the `tenants` table carry `Id, Slug, Name, Domain, Tagline, LogoUrl,
IsActive, CreatedAt, UpdatedAt` — **no parent, no path, no depth, no
allows_subtenants**. Laravel's whole hub/sub-tenant model and the subtree scoping
in F1 are built on `tenants.path`. Consequently `GET super/tenants/hierarchy`
returns a hardcoded empty array (`AdminCompatibility3Controller.cs:626`). F1 is
therefore not "add a permission check" — the data model it would check does not
exist.

**F10 — SECURITY — guardian consent tokens resolve across every tenant.**
`Services/EventSafetyService.cs:40` looks up
`SingleOrDefaultAsync(x => x.TokenHash == hash)` under `IgnoreQueryFilters()` with
**no `TenantId` predicate**, from an `[AllowAnonymous]` endpoint. Laravel binds the
token to the tenant twice over: the hash itself is HMAC-keyed with the app key over
`event-safety|{tenantId}|guardian-token|{token}`
(`app/Support/Events/EventSafetyFoundationSupport.php:180-187`) and the query adds
`where('tenant_id', $tenantId)` (`app/Services/EventGuardianConsentService.php:371,
382-385`).

**F11 — SECURITY — guardian email blind hash is unkeyed.**
`EventSafetyService.cs:39` stores `GuardianEmailBlindHash = Hash(email)` where
`Hash` is bare `SHA256` (`:55`). Laravel uses an app-key-keyed HMAC
(`EventGuardianConsentService.php:205-209`). Anyone with read access to
`event_guardian_consents` can dictionary-confirm which guardian email belongs to
which minor without touching the ciphertext column — defeating the point of
encrypting it.

**F12 — SAFEGUARDING — guardian consent expires 24 hours after request,
unconditionally.** `EventSafetyService.cs:39` sets
`ExpiresAt = DateTime.UtcNow.AddDays(1)`. Laravel reads
`events.safety.guardian_consent_ttl_days` (default 30) and **forces the expiry past
event start + 1 day**, throwing `event_guardian_consent_expiry_invalid` otherwise
(`EventGuardianConsentService.php:196-203`). For any event more than a day out the
consent expires before the event and the minor is blocked.

**F13 — SECURITY — the consent-mutation trigger is missing.** Laravel's
`trg_event_guardian_consent_update`
(`database/migrations/2026_07_11_000060_create_event_safety_foundation.php:728-733`)
guards the encrypted identity columns, `token_hash`, `minor_user_id`, `expires_at`
and the pending→active→withdrawn/expired state machine in the database. ASP.NET's
`20260713015034_EventSafetyWorkflowParity.cs:344-357` creates only
`..._history_no_update` and `..._consent_no_delete` — **no UPDATE trigger on
`event_guardian_consents`**, so a bad UPDATE can rewrite a guardian's encrypted
identity or resurrect a withdrawn consent. Laravel creates 21 triggers here,
ASP.NET 13.

**F14 — SECURITY — a minor can grant their own guardian consent.**
`GrantGuardianAsync` (`EventSafetyService.cs:40`) checks token hash, expiry, email
blind hash and `Status == "pending"` only. Laravel additionally re-checks the minor
is still active and refuses a self-grant with
`event_guardian_minor_self_grant_forbidden`
(`EventGuardianConsentService.php:389-400`).

**F15 — SCHEDULED WORK — 17 of 71 Laravel scheduled units have a genuine
counterpart (~24%).**
🔴 **PARTLY CLOSED, remeasured 2026-08-18: 26 scheduled job classes, all 26
registered as hosted services, against 70 Laravel scheduled units (~37%).**
Several named absences below are now implemented (`support-actions:expire`,
`safeguarding:clear-expired-monitoring`, `groups:prune-exports`,
`marketplace:process-unacknowledged-reports`, `safeguarding:vetting-renewals`).
🔴 **And one claim below is WITHDRAWN:** "`marketplace:complete-orders` absent
means sellers are never paid out" is wrong — `MarketplaceEscrowReleaseJob` calls
`ProcessEligibleEscrowReleasesAsync` with an `auto_timeout` trigger gated on
`AutoCompleteAt`, so escrow-backed orders do pay out.
 The earlier "56 vs 20" understated Laravel: `bootstrap/app.php`
also has 1 `->job()` and 14 `->call()` closures. Compliance/data-loss absences:
`retention:enforce`, `backup:verify`, `gdpr:check-overdue-requests`,
`safeguarding:purge-message-copies`, `safeguarding:review-flags`,
`safeguarding:vetting-renewals`, `safeguarding:clear-expired-monitoring`,
`support-actions:expire`, `groups:prune-exports`,
`marketplace:process-unacknowledged-reports` (DSA 24h). Member-visible: nothing
scheduled publishes (feed, groups, podcasts), nothing reminds (events, interviews,
renewals, dues), nothing expires (waitlist offers, pending orders, promotions),
`marketplace:complete-orders` absent means **sellers are never paid out**.
Operational blindness: `slo:check`, `monitoring:alarm-selftest`, `email:health-alert`,
`queue:verify-liveness`, `horizon:snapshot`, `stripe:check-stuck-webhooks`. Also
`safeguarding:sla-escalate` runs hourly in ASP.NET vs every 15 minutes in Laravel.

**F16 — Meilisearch incremental indexing is effectively absent.**
`Services/MeilisearchService.cs` `IndexDocumentAsync` (`:146`), `IndexDocumentsAsync`
(`:168`), `DeleteDocumentAsync` (`:190`) have **no callers** outside the service. The
only writer is `ReindexTenantAsync`, reachable solely from manual admin endpoints
(`AdminSearchController.cs:64,83`). New or edited content never reaches the index and
deleted items stay findable.

**F17 — FCM push targets a decommissioned endpoint.**
`Services/PushNotificationService.cs:558-570` uses the FCM **legacy** HTTP API
(`https://fcm.googleapis.com/fcm/send`), which Google has retired. Treat as
implemented-but-non-functional until moved to FCM HTTP v1. Pusher realtime is real
(`PusherEventPublisher.cs:23,57`) but logs unconfigured credentials and send
failures at **Debug** and returns silently (`:52,:79,:83`) — realtime can be entirely
dead with nothing visible.

**F18 — IMPERSONATION — the legacy route is not the same endpoint.** Laravel's
`/v2/admin/users/{id}/impersonate` mints the same single-use 5-minute **proof**
(`AdminUsersController.php:1479` → `TokenService.php:794-803`). ASP.NET's same path
returns `_tokenService.GenerateJwt(user)` — **an ordinary, immediately usable access
token** (`AdminCompatibilityController.cs:768`), bypassing the exchange's spend-time
re-checks entirely. It is also gated with `PlatformSuperAdminOnly` (`:743-747`) where
Laravel uses `tenant-super-admin` (`routes/api.php:3229-3231`) — reinstating exactly
the bug Laravel fixed on 2026-08-05, so a community super-admin gets 403 for every
target. Inactive targets: Laravel returns **200 with `gate_warning`/`gate_code`**
(`AdminUsersController.php:1508-1511`), ASP.NET returns **409** (`:764-766`).

**F19 — IMPERSONATION — the super mint route admits callers Laravel refuses.**
Laravel's `super-panel` gate admits `master` (platform super/god) or `regional`
(super-admin of a tenant **that has children**) —
`app/Http/Middleware/EnsureSuperPanelAccess.php:14-45,66-80`. ASP.NET admits any
`IsTenantSuperAdmin` unconditionally (`AdminSuperImpersonationController.cs:59-65`),
so a super-admin of a leaf tenant is denied by Laravel and granted by ASP.NET.
Smaller divergences in the same flow: the exchange compares the proof's tenant
against the raw `X-Tenant-ID` **header** and skips the check when it is absent
(`ImpersonationController.cs:84-88`) where Laravel compares the **resolved**
`TenantContext::getId()` (`AuthController.php:798-805`); and `user_name`/`admin_name`
fall back to the **email address** (`ImpersonationController.cs:135,138`) where
Laravel emits an empty string (`AuthController.php:865,868`) — a PII-shaped
difference in a response body.

The `/v2/auth/impersonate/exchange` + `/end` pair itself held up under attack:
paths, TTLs (300s/900s), the full key set, absence of a refresh token, and every
exchange rejection code/status matched.

### Correction to F2 (issued the same day)

F2 called the missing voice/attachment routes BREAKS-CLIENT. That over-claimed.
ASP.NET stores voice as a `FileUpload` + `MessageAttachment` and returns
`AudioUrl = /api/files/{id}/download` (`MemberParityController.cs` voice-send path),
`web-uk` renders whatever `audio_url` the payload carries
(`src/routes/messages.js:391`), and React has no hardcoded
`GET /messages/{id}/voice`. So the clients follow the server-provided URL and
playback plausibly works. The Laravel routes are still absent — a contract
divergence, and any consumer that hardcodes Laravel's path would break — but
"members cannot play voice messages" was not established. Downgraded to
CONTRACT-DIVERGENCE pending runtime proof.

### Correction to a stated residue

The status doc previously recorded "consent-token emails not delivered" as an
ASP.NET residue. At HEAD that is wrong, and inverted: ASP.NET **does** email the
guardian a link containing the **plaintext token**
(`EventSafetyService.cs:39`, falling back to `http://localhost:5173` when
`Frontend:BaseUrl` is unset), while Laravel deliberately never returns or emails the
plaintext token, keeping it inside an AES-GCM delivery envelope
(`EventGuardianConsentService.php:48-49,326,352`).

**F20 — CARER CLUSTER — nine divergences, four of them in this week's work.**
Verified on disk:

- **SECURITY, FIXED in this commit:** no throttle on the support-action answer
  paths. Laravel throttles `confirm`, `decline` and the unauthenticated emailed
  token confirm at `nexus-route-10-per-1m` (`routes/api.php:905,906,913`);
  `Controllers/SupportActionsController.cs` carried no limiter and
  `RateLimitingMiddleware.cs` had no entry, leaving a single-use token that
  authorises a credit transfer brute-forceable.
- **SECURITY (latent), FIXED in this commit:** `SupportTiers.AtLeast`
  (`Support/Safeguarding/SupportTiers.cs:110-115`) validated neither the
  capability nor the required tier, so an unrecognised `minimum` ranked 0 and
  every check passed — including for a `none` grant. Laravel refuses both inputs
  (`app/Support/Safeguarding/SupportTiers.php:216-226`). Every current caller
  passes a constant, so it was latent, but the safe default was inverted.
- **BREAKS-CLIENT, open:** `GET /v2/users/me/sub-accounts/{childId}/activity` is a
  stub — `Controllers/UsersParityController.cs:510` returns
  `Ok(new { data = Array.Empty<object>(), sub_account_id = subAccountId })` with no
  relationship lookup, no `activity ≥ assist` check, no 403 for a caller with no
  relationship, and an extra top-level key Laravel never sends.
- **Open:** the `onboarding-required` gate is missing from all four proxy write
  paths (`routes/api.php:882,883,898,903` carry it; ASP.NET's
  `OnboardingRequiredMiddleware` path table does not list them), so a carer who has
  not completed onboarding can create listings, transfer credits and prepare
  support actions.
- **Open:** `message_view_last_at` — Laravel's "when did my supporter last read my
  messages" accountability signal (`SubAccountController.php:50-55`) — does not
  exist anywhere in the ASP.NET source.
- **Open:** ASP.NET exposes an undeclared parallel `api/sub-accounts` subsystem
  (`Controllers/SubAccountsController.cs:19`, nine actions incl. `pool-transfer`)
  backed by a separate `SubAccount` entity, with **no Laravel counterpart** — it
  moves credits through a route the Laravel contract does not define.
- Confirmed matches under attack: the tier engine core (ordering, both caps,
  drop-not-clamp, `can_view_messages` hard-false), the pending-action shapes and
  rejection codes, and all 21 carer routes resolving at the same verb and path
  (via `Routing/AdminV2RouteAliasConvention.cs`).
- Not audited, flagged honestly: `acting_user_id` + `org_audit_log` side-effect
  parity in `SubAccountProxyService.cs`.

### Still owed (the five reviews not yet re-run)

Impersonation deep contract; carer/sub-accounts cluster; safeguarding/guardian
consent incl. append-only trigger comparison; the eight small endpoint groups
(challenges, badges, public events, super ops, performance-summary shape,
attendance rewards, capabilities, federation status); partner venues; the legal
gate's fail-open vs fail-closed behaviour; super-admin response shapes; the
login/auth area; broker response shapes; and the full providers/integrations
inventory (Stripe live, the four identity providers, OIDC/SSO, audience sync).

## 2026-08-14 Re-Audit Against Laravel HEAD (Advisory)

A full evidence re-audit ran on 2026-08-14 against monorepo HEAD
`5afb43ff73dae9acb9f3e76ff0670ed0c21e4139` (Laravel and ASP.NET inspected at the
same monorepo SHA). Every comparison below was regenerated from the live code on
that day, not read from documentation. **This section is advisory: it banks zero
points and performs no fixed-rubric scoring transaction.** The banked score
above remains 712/1000 against the frozen `903d03d3` baseline. The audit session
was interrupted after the evidence was gathered and before a drift-adjusted
scoring transaction could be recorded; per the rubric policy, drift is recorded
here as a separately named position, never as a silent rescore.

### Route representation against Laravel HEAD

- **2,600 of 2,667 Laravel operations matched; 67 missing.** At the frozen
  `903d03d3` baseline the same gate was 2,601/2,601 with 0 missing. Nothing
  regressed on the ASP.NET side: all 67 are Laravel endpoints shipped after the
  2026-07-15 freeze.
- The regenerated canonical React call-site matrix
  ([`generated/canonical-react-contracts/README.md`](generated/canonical-react-contracts/README.md))
  records 2,407 static call-site rows, 2,078 unique method/path contracts,
  1,899 method-evidenced, 179 method-unresolved, **59 ASP.NET static gaps**
  (0 at the freeze) and 16 Laravel static gaps.
- **Partner venues closed later on 2026-08-14 (unscored):** all fourteen
  partner-venue routes (five member, nine admin) are now implemented with the
  Laravel contract — feature gate `features.partner_venues` (default off,
  middleware-shaped 403 body), 64-hex member pass with in-place rotation, the
  full recordVisit rule ladder (invalid pass 404 / forbidden 403 /
  needs_venue / database-enforced one-visit-per-day / self-scan block /
  venue-visit XP and challenge completions), admin CRUD with Laravel
  validation and the bare thirteen-key 201 store shape, staff roster,
  lifetime-vs-window summary, and the sanitised CSV export. Storage is
  migration 164 (`20260814164515_AddPartnerVenueTables`, proven zero-to-164
  on a disposable PostgreSQL); the staff roster is a dedicated
  `partner_venue_staff` table rather than Laravel's shared `org_members`
  pivot, a deliberate internal divergence because the ASP.NET `org_members`
  mapping hard-pins `org_type='volunteer'` with an FK to `vol_organizations`
  — the externally observable roster contract is identical. Pinned by
  `tests/Nexus.Api.Tests/PartnerVenuesTests.cs` (15 tests).
- **Support actions / carer sub-accounts: foundation landed 2026-08-14
  (unscored), full workflow mapped and queued.** The `SupportTiers` permission
  engine is ported with its safety rules pinned by 9 unit tests (dead
  `can_view_messages` boolean, drop-not-clamp caps, staff cap), and migration
  165 (`20260814173908_AddProxyActingUserAttribution`, proven zero-to-165)
  adds the nullable acting-user attribution columns to `listings` and
  `transactions`. The complete contract map and five-step build order
  (relationship-model upgrade → `support_pending_actions` workflow → proxy
  execution → supervised message viewing → admin attestation) is banked in
  `.local-docs-archive/aspnet-support-actions-blueprint-2026-08-14.md` —
  start there, do not re-research. **Blueprint step 1 (relationship model)
  landed later on 2026-08-14 (unscored):** migration 166
  (`20260814175625_AddAccountRelationships`) creates `account_relationships`
  and the append-only `account_relationship_events` (UPDATE refused by a
  database trigger, proven by test), carries legacy `sub_accounts` rows across
  with tier-mapped permissions, and the relationship endpoints
  (`/users/me/sub-accounts*`, `/users/me/parent-accounts*` including the two
  previously missing member routes: PUT `parent-accounts/{id}/permissions`
  and POST `parent-accounts/{id}/message-access/withdraw`) now enforce the
  Laravel tier rules: supporter expansion refused with
  MEMBER_APPROVAL_REQUIRED, boolean true never escalates, dead
  `can_view_messages` never surfaces, withdraw always available. Pinned by
  `AccountRelationshipTests` (11 tests); two legacy tests updated to the
  current contract in the same commit. **Step 2 (pending-action workflow) also
  landed 2026-08-14 (unscored):** migration 167
  (`20260814190006_AddSupportPendingActions`) creates `support_pending_actions`
  with the hashed single-use token, 14-day expiry, and the nullable-unique
  one-open-message-ask-per-relationship key; all seven workflow routes are
  implemented (prepare / index / confirm / decline / cancel and the two
  anonymous token routes with the read-only-GET / mutating-POST split);
  confirmation executes for real — listings and wallet transfers land with the
  supported member as owner/sender and the supporter stamped as ActingUserId —
  authority is re-checked at use time (AUTHORITY_CHANGED auto-cancel), and
  message access rises ONLY through this workflow. Pinned by
  `SupportActionWorkflowTests` (10 tests). **Step 3 (represent-tier proxy
  execution) also landed 2026-08-14 (unscored):** the four direct endpoints
  (child listings, listing image, transfer, wallet) enforce the represent
  tier — co_decide never authorises acting alone — with fail-closed audit
  attribution (the listing commits with its audit row or not at all), the
  supported member always the owner/sender and always notified, the carer's
  own balance provably untouched, and the wallet summary gated on the credits
  tier by design. Pinned by `SubAccountProxyTests` (6 tests). **Step 4
  (supervised message viewing) also landed 2026-08-14 (unscored):** migration
  168 (`20260814193140_AddSupporterMessageViewAudits`) creates the append-only
  `supporter_message_view_audits` (UPDATE refused by trigger, proven by test);
  the two GET routes require a stated purpose (header first, blank refused,
  no audit row on refusal), write the audit row BEFORE fetching, read AS the
  member (their deletions invisible, unread counts stripped, nothing ever
  marked read), and there is deliberately no write route under the prefix.
  Pinned by `SupporterMessageViewTests` (7 tests). **Step 5 (staff
  attestation) also landed 2026-08-14 (unscored), completing the subsystem:**
  the broker-or-admin queue (`GET /v2/admin/safeguarding/support-actions`,
  both names loaded, never the raw payload) and the attest endpoint (channel
  required ∈ phone/in_person/paper, witness optional ≤160) confirm through
  the same shared path with `attested_offline` provenance, so authority
  lapses and safeguarding restrictions refuse attestation identically, and
  the supported member is always notified. Pinned by
  `SupportActionAttestationTests` (5 tests). **The support-actions / carer
  sub-accounts cluster is now implemented end to end (39 pinning tests
  total).** Residue: the `restriction-status` notice flags on the ordinary
  messages surface, and email delivery of the confirm-token link (currently
  bell-notification only).
- **Guardian consent & authority attestations closed later on 2026-08-14
  (unscored):** all nine routes implemented with the Laravel contract —
  the ward-only state machine (pending→consented/declined,
  consented→withdrawn/declined, declined/withdrawn→consented; idempotent
  repeats write nothing; ending consent resets every tier and cancels open
  prepared actions; declined/withdrawn keep status pending — revoked stays
  staff-only), the deliberately minimal my-wards read, ward-only tier grants
  with messages silently stripped and expansion re-checking the contact
  policy both ways, and authority attestations (migration 169:
  `support_authority_attestations` + append-only events with DB triggers;
  closed vocabularies; evidence fields refused on key presence; free text
  encrypted at rest, private notes never returned; attest failures 422 even
  for NOT_FOUND; revocation never touches tiers — a record, not
  authorisation). Error-shape quirks copied deliberately (422
  VALIDATION_ERROR with the "Resource not found" message on malformed ids;
  indistinguishable 404 for not-yours/not-live). Pinned by
  `GuardianArrangementTests` (13 tests). Storage note: Laravel's
  `safeguarding_assignments` is a read-only archive; these endpoints run on
  `account_relationships` with `proposed_by_user_id` set, exactly as Laravel.
- **Small-endpoint batch closed later on 2026-08-14 (unscored):** admin
  challenge CRUD (4 routes, Laravel wire shape incl. the four-type vocabulary,
  hand-rolled validation order, JSON-null-skipping partial updates; the
  ChallengeType enum gained the Laravel values, stored as strings, and
  badge_reward maps to a Badge slug), `GET /v2/admin/badge-counts` (all eight
  keys; the five sources with no ASP.NET tables are honestly 0), and the two
  anonymous public-events routes (double feature gate with public_events OFF
  by default; the sixteen-key allowlist projection plus description and
  accessibility on detail; first-name-only organiser; indistinguishable 404;
  cursor pagination not yet implemented — the React client never sends one).
  Pinned by `SmallParityEndpointsTests` (6 tests). **Second small batch closed
  2026-08-15 (unscored):** platform capabilities GET/PUT (migration 170:
  `platform_capability_overrides`; the six-capability allowlist is the
  security boundary; platform-super gate refusing tenant supers), federation
  external-status (every switch honestly OFF in the exact Laravel shape — no
  external federation exists here), performance summary (the pinned contract
  shape with `meta.recording_enabled=false` — no recorder exists here, and
  the dashboard renders its honest recording-off state), and the five
  attendance-reward routes (events.attendance_credit_amount column; the
  pre-existing claims ledger entity gained its admin surface: config
  round-trip with ceiling validation, ledger + reversal deliberately
  surviving the feature flag, kill-switch blocking retries, community-mint /
  member-reclaim transactions, one reversal per reward database-enforced).
  Pinned by `SuperOpsAndRewardsTests` (6 tests). **Impersonation closed
  2026-08-15 (unscored) — this completes all 59 React-consumed route gaps
  from the re-audit.** Migration 171 adds `revoked_tokens` (UNIQUE jti = the
  single-use guarantee). The mint (`/v2/admin/super/users/{id}/impersonate`)
  issues a 5-minute one-time PROOF that authenticates nothing as a bearer —
  the JWT pipeline now rejects `type=impersonation` and denylist-checks
  `impersonation_jti`, failing closed. The anonymous exchange
  (`/v2/auth/impersonate/exchange`, absolute v2 route so no v1 twin) consumes
  the proof single-use and mints a 15-minute session with NO refresh token,
  re-checking authority at spend time; end (`/v2/auth/impersonate/end`)
  revokes only that session's jti. `X-Tenant-Slug`/`X-Message-View-Purpose`
  added to the CORS allowlist. Pinned by `ImpersonationTests` (5 tests).
  **Scope divergence recorded honestly:** Laravel confines a hub/regional
  super admin to its own tenant subtree via SuperPanelAccess; this backend
  has no subtree authorization model (its platform-super policy is
  platform-wide), so cross-tenant impersonation scope is not narrowed beyond
  the super gate — that is a pre-existing gap, not introduced here.
  Residues across the batch: no performance recorder (summary reports
  recording off), attendance-claim creation on check-in not yet wired (the
  ledger and its admin operations are), and the legacy
  `/v2/admin/users/{id}/impersonate` still mints a live token (untouched to
  avoid breaking its pinning tests; the canonical proof flow is the new
  `/super/` route).
- The 59 React-consumed gaps cluster into post-freeze subsystems: partner
  venues (member and admin — closed above), support actions and carer sub-account operations
  (prepare/confirm/decline, child listings, messages, transfers, wallet),
  guardian consent and safeguarding member/admin endpoints (my-guardians,
  my-wards, authority attestations, support-action attestation), event
  attendance rewards and claims, gamification challenge administration, admin
  impersonation (`/admin/super/users/{id}/impersonate`,
  `/auth/impersonate/exchange`, `/auth/impersonate/end`), platform
  capabilities, federation external status, admin badge counts, the admin
  performance summary, and public events.

### Laravel drift since the 2026-07-15 freeze

- **547 commits in 32 days.** The API grew by 67 endpoints (none removed),
  4 changes were formally breaking, and 26 new database migrations shipped.
- The **legal-acceptance enforcement gate** (Laravel, 2026-08-11) blocks
  member write actions until terms are accepted. At audit time ASP.NET could
  record an acceptance but had no enforcement equivalent. **Closed later on
  2026-08-14 (unscored):** `LegalAcceptanceGateMiddleware` now enforces the
  fourteen gated routes with the exact Laravel contract (403 /
  `LEGAL_ACCEPTANCE_REQUIRED` / `success:false`; modes off/report/write/all
  with write as default and invalid-fallback; fail-open; admin and partner
  bypass; report-mode `X-Legal-Acceptance-Pending` header), the
  acceptance-status endpoint publishes `has_pending` / `enforcement_blocking`
  / `blocking_pending` in the Laravel shape, and accept-all genuinely records
  acceptances instead of returning a hardcoded success. Pinned by
  `tests/Nexus.Api.Tests/LegalAcceptanceGateTests.cs` (14 tests). Version-level
  acceptance staleness ("outdated") remains open until the legal schema gains
  version rows (queue package 5).
- Five heavily used areas were rewritten beneath routes ASP.NET does match —
  super-admin, sub-accounts, safeguarding, login/auth, and broker — so route
  presence in those areas no longer implies behavioral identity. They need
  fresh semantic evidence under queue package 2.
- Static schema-name drift: 229 Laravel tables now have no ASP.NET counterpart
  and 197 ASP.NET tables have no Laravel counterpart (name comparison only).
- Localization drift: 363 Laravel translation namespaces and 5,424 English keys
  are missing on the ASP.NET side.

### ASP.NET code state and test evidence

- The ASP.NET implementation is unchanged since the pause except two
  maintenance changes on 2026-08-10: the .NET 8 to .NET 10 upgrade, and making
  unimplemented admin endpoints return honest not-implemented responses instead
  of fabricated success. 165 migration classes were confirmed on disk; no
  hidden not-implemented stubs masking as working code were found.
- **Full local Release test run (2026-08-14, .NET 10): `Nexus.Api.Tests`
  3,386/3,386 passed in 32m 24s; `Nexus.Messaging.Tests` 38/38 passed in
  2m 7s; 0 failed, 0 skipped.** TRX evidence:
  `tests/Nexus.Api.Tests/TestResults/full-audit.trx` and
  `tests/Nexus.Messaging.Tests/TestResults/full-audit.trx`. This is a local
  run, not an exact-SHA CI aggregate; it banks nothing under the build/test/CI
  category on its own.
- The four retired ASP.NET production containers were confirmed by read-only
  inspection to be stopped, not removed.

### Web UK switch readiness (queue package 3)

The backend switch genuinely exists (`ACCESSIBLE_BACKEND_TARGET=aspnet`, no
ASP.NET-specific branches in the frontend), but only roughly 1–2% of the 696
API calls Web UK makes have ever been proven against ASP.NET, and the promised
Web UK-to-ASP.NET comparison matrix does not exist. Package 3 is fully open.

### Effect on the queue

The eight-package queue below stands. The drift concentrates additional work in
packages 2 (semantic evidence for the rewritten areas), 3 (Web UK matrix), 4–6
(the four new subsystems, the legal-acceptance gate, schema and localization
drift), and adds the 67-endpoint route gap as new representation work that must
be reconciled before the route category can be re-banked against any
newer-than-`903d03d3` Laravel baseline.

## Baseline And Banked Evidence

Fixed Rubric Baseline 1 froze:

- Laravel `903d03d3db78bbf87129ad35728be3b72819acaf`;
- ASP.NET `b751d22f38baf0ac8bdf90fe669550b568fcb489`;
- the evidence snapshot at 2026-07-14 10:51:18 +01;
- an initial banked score of **620/1000**.

Subsequent points were banked only after their implementation and evidence were
published:

| Published checkpoint | Evidence | Banked movement |
| --- | --- | ---: |
| Marketplace payment settlement | Implementation `768801f129747ebcb8ae2f52dd9d34f851f20df9` | +8 semantic, +4 schema = **632/1000** |
| Marketplace Connect onboarding | Implementation `25110d7fb98dfed4e2eabbea016924cee93f9b9d`; scoring record `bda4cb949d322b77197ec51c7c4152b272a42a4d` | +4 semantic, +1 schema, +1 providers/operations = **638/1000** |
| Marketplace paid notifications and durable order identity | Implementation `f562c49796b81ac2ea47a4699dc22f9f0e57f9c0` | +4 semantic, +2 schema, +1 providers/operations = **645/1000** |
| Marketplace escrow settlement and delayed Connect payout | Implementation `93417bd17e886e8d05e054ec2f679a4851c6ae26` | +8 semantic, +4 schema, +2 providers/operations = **659/1000** |
| Marketplace provider refunds and dispute settlement | Implementation `4f7b9f202322d792574f2003274fadfda9e7037d` | +5 semantic, +3 schema, +1 providers/operations = **668/1000** |
| Signed external marketplace refund reconciliation | Implementation `ef8a0cf8d9458abda8350f8bf2a5adca44f12724` | +3 semantic, +1 providers/operations = **672/1000** |
| Signed held-escrow charge-dispute reconciliation | Implementation `027f35e6189eee13eb05396050a2995706597cad` | +3 semantic, +1 providers/operations = **676/1000** |
| Paid-transfer charge-dispute recovery | Implementation `9875fb5dd33e3ab5c33ea77a83fcfb0b8c6c0b00` | +3 semantic, +1 providers/operations = **680/1000** |
| Marketplace refund notification evidence | Implementation `b37a3cc5ed903394b67813a3e34304213b9e150d` | +3 semantic, +1 providers/operations = **684/1000** |
| Secure SSO/OIDC authentication flow | Implementation `c20d064e6adb99d3a585efd299650d5e913180ff` | +8 semantic, +3 schema, +3 security = **698/1000** |
| Tenant-bootstrap precedence and fail-closed runtime proof | Implementation `5fbcf36dedf320c0ca81ac77f8b4771d891f7331`; stable disposable-PostgreSQL verification at ASP.NET `ccd109fc4dc67b0b117780b2130d519e6bb38eea` | +2 semantic, +1 security = **701/1000** |
| Social comment mentions, usernames, and recipient side effects | Implementation `1ff6447012c89744e94d6693463a8032361c5946` | +4 semantic, +2 schema, +1 security/localization = **708/1000** |
| Laravel-compatible social-comment HTML sanitization | Implementation `293796e0f17b91e446f49a28babd960de7681e27` | +1 semantic, +1 security/localization = **710/1000** |
| V2 generic-comment safe-format and sanitizer parity | Implementation `5fa15e0e79993464622b1c3ef053fcdd01679991` | +1 semantic, +1 security/localization = **712/1000** |
| Migrated-schema integration certification harness | Implementation/evidence `fefbb5ce03b83c95cd78fb338b7a5c41da9b6745` | **+0**; corrects the evidence boundary but does not substitute for a complete green suite or CI |

These named values form an audit trail. They are not competing current scores.

## Repository State At This Verification

The latest banked backend implementation inspected for this page is
`5fa15e0e79993464622b1c3ef053fcdd01679991`, with Laravel frozen at
`903d03d3db78bbf87129ad35728be3b72819acaf`. The latest published backend
product/API/schema implementation boundary remains
`c767050a3eabd064bdf647695b9699b98186342b`. It follows schema merge
`df8c8b96c80804785e9c84f9f7c75337088d6024` and adds the missing runtime
creation migration for `compatibility_audit_entries` plus contract and test
corrections. Required-CI workflow commit `b3f946b3fd3de51fa444008a7daee80d3de1bcd2`
and test/evidence commit `dbafc5c329c55a15b4329ff90804d725dbf8b089`
are later published, unscored evidence boundaries; neither changes the product
implementation or banked points.

### 2026-08-09 Repository Boundary Refresh

`origin/main` advanced from `896aac94` (`pause/2026-07-15-final`) to
`e36415c02a71a83247168d14f652064a006df6af` through twelve commits dated
2026-08-09, under a bounded user authorization for security, retirement, and
infrastructure work. The pause was not lifted.

**No backend implementation moved.** No file under `src/`, `tests/`,
`migrations/`, or `e2e/` changed across that range:

```powershell
git diff --name-only pause/2026-07-15-final..HEAD -- src tests migrations e2e
```

The command returns nothing at `e36415c0`. Consequently:

- the banked total remains **712/1000** and every category row above is
  unchanged;
- the latest banked implementation SHA remains `5fa15e0e`;
- the latest published product/API/schema boundary remains `c767050a`;
- the exact-SHA CI evidence boundary remains `dbafc5c3` with run 29451087913
  terminal green;
- Laravel remains frozen at `903d03d3db78bbf87129ad35728be3b72819acaf`; the
  Laravel comparison source was not re-inspected in that phase, so refresh it
  before generating any new matrix.

What changed is repository shape, not contract state. `apps/react-frontend/`
(1,134 files) and `apps/admin/` (93 tracked files) were deleted, leaving
`apps/web-uk` as the only frontend here; the corresponding production
containers, images, and Apache proxies were removed; Dependabot alerts were
patched down; and two Cloudflare zones moved to origin certificates valid to
2041. The full record is the
[2026-08-09 retirement and infrastructure record](PROJECT_PAUSE_HANDOFF_2026-07-15.md#authorized-retirement-and-infrastructure-record--2026-08-09).

Two consequences matter for this workstream:

1. **Queue package 8 is unaffected in substance but changed in location.**
   Certifying the unchanged canonical React client was always against
   `C:\platforms\htdocs\staging\react-frontend`; the deleted in-repo fork was
   never the certification target. Deleting it removes a decoy, not a gap.
2. **The frozen-React CI job is gone.** The green `dbafc5c3` aggregate included
   a frozen-React `Frontend` job that no longer exists in `.github/workflows/ci.yml`.
   The recorded run remains valid evidence for its own SHA, but the next
   required-CI run will have a different job set. Do not describe a future run
   as reproducing `29451087913` without noting that difference.
3. **The `dbafc5c3` aggregate is not reproducible by re-running that SHA.** Two
   test classes carried fixtures that expired on 2026-08-01, so the suite turned
   red on that date with no code change and CI failed at `e36415c0`:
   `CaringCommunityPilotScoreboardControllerUnitTests` seeded a quarterly review
   at a literal `2026-05-01` and asserted the three-month cadence was not yet
   due, and `MunicipalSurveyControllerUnitTests` seeded a survey window of
   `2026-07-01` to `2026-08-01` and asserted the survey was still active. Both
   now seed relative to now, with explicit overdue coverage added to the former.
   `PilotScoreboardService` and the municipal survey services are unchanged and
   no contract moved. Treat run 29451087913 as valid evidence for its own SHA
   and date only, and never re-run an old SHA as a substitute for current CI.

This refresh records a boundary, not a score movement. It banks **zero** points
and does not discharge any open certification gate.

### Published But Not Rescored

Published commit `fefbb5ce03b83c95cd78fb338b7a5c41da9b6745`
changes the shared integration fixture from `EnsureCreated` to the complete EF
migration chain, so PostgreSQL functions, triggers, preflights, and other raw
migration SQL are present in test databases. It also corrects stale ordinary-
admin expectations for the database-backed platform-super-admin bulk policy and
updates the obsolete volunteer-hours alias case to assert the current Laravel-
shaped validation order. At that earlier checkpoint, the Release test assembly
built with 0 warnings and 0 errors, the focused fresh-migrated PostgreSQL set
passed 14/14, and the five affected classes passed 57/57 in 303.8 seconds. It
added **zero banked points** because the then-3,331-test complete suite and
exact-SHA CI were still open. The later `dbafc5c3` aggregate closes that general
CI subgate without retroactively scoring this implementation slice.

Published commit `923db629dea331ee093018887c4533d2c4e7133e` added the
exact-SHA canonical React call-site generator. Published correction
`bab02a77c3075e182f039785ef097ac88a62f4b9` reconciles constant-root ASP.NET
routes, multiple verb attributes, parameterized route templates, and typed
dynamic frontend actions in the maintained matrix at
[`generated/canonical-react-contracts/README.md`](generated/canonical-react-contracts/README.md).
It records 2,328 call-site rows, 2,016 unique method/path entries, 1,845 with
method evidence, 171 with unresolved methods, and 0 ASP.NET static gaps against
Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and ASP.NET
`0c8885355154e5d188244e4820977c7f3a6f5e65`. It adds **zero banked points**:
inventory generation does not prove payload, envelope, auth, tenant, side-effect,
or runtime correctness.

The following backend commits after restart scorecard `ea352690` are published
but remain unscored:

| Commit | Published change | Why no points are banked |
| --- | --- | --- |
| `60715dfd` | Deterministic backend shard harness/test setup | Partial moving-SHA shard evidence is not a complete aggregate. |
| `e49c8ca9`, `0b79e2a6` | Regional-analytics and premium-cancel contract-test corrections | Test expectations/probes alone do not close a scored semantic gate. |
| `1fd7a6c0` | Real super-admin tenant move and event-archive contract behavior | Requires fixed-rubric review plus complete certification evidence. |
| `47458d51`, `06e6045e` | Group/campaign expectations and scheduled-job test setup | Evidence/setup corrections are not a complete suite or CI result. |
| `2a1acefe` | Real administrator listing-deletion parity and shard slicing | Requires semantic scoring and exact-SHA aggregate evidence. |
| `59296ac6`, `c370bcb9` | Marketplace/provisioning authorization-test corrections | Corrected expectations do not independently earn points. |
| `738f47e6` | Removal of a noncanonical guest-attendance alias | Needs route/consumer reconciliation and the normal score transaction. |
| `9ad163c9` | Administrator user-role expectation correction | Test-only correction; no scored implementation gate closed. |

All eleven contribute **zero banked points** at this snapshot.

### Published But Still Unscored

- `56dc3b3a` commits the two `/api/users/me` envelope-expectation corrections.
  Shard 17 slice 1 had passed 38/38 with those file contents before commit, but
  a later two-class focused rerun was inconclusive: Debug was file-locked and
  Release exceeded its 15-minute wrapper. It adds zero points.
- `df8c8b96` merges the nine schema commits through `97b8a4a0` into published
  `main`. The resulting exact-SHA static inventory is 458 Laravel tables, 440
  ASP.NET tables, 242 exact names, 216 Laravel-only names, and 198 ASP.NET-only
  names; that branch contained 164 migration source files and 162 runtime IDs.
  Per-slice builds, focused 3/3 tests, model-drift checks, blank replays,
  populated upgrades, and constraint/isolation checks are recorded in
  [`SCHEMA_PARITY.md`](SCHEMA_PARITY.md). The post-merge complete suite/CI
  aggregate was absent at that checkpoint. Later exact-SHA run 29451087913 is
  green at `dbafc5c3`, but no scoring transaction has accepted a category
  movement, so the merge still adds zero banked points.
- `c767050a` advances the current tree to 165 migration classes and 163 runtime
  IDs by adding `20260715184200_AddCompatibilityAuditEntriesTable`. The model
  and snapshot already represented that table; the migration repairs the fresh
  runtime chain. Exact-SHA CI run
  [29441392036](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29441392036)
  passed Build, but its migrated Test job was cancelled at the 75-minute limit
  without a terminal summary; coverage merge failed and Docker publish was
  skipped. It adds zero points. The precise schema verdict and recommission
  package are in [`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md).
- `b3f946b3` installs the required no-coverage, four-shard workflow after the
  user explicitly resumed a bounded commit/push/fix-until-green CI phase.
  Deterministic allocation covers 3,361 logical tests exactly once as
  841 + 840 + 840 + 840. This workflow evidence adds zero points without a
  fixed-rubric scoring transaction.
- `dbafc5c3` gives each wallet-concurrency request a distinct explicit
  idempotency key so the test exercises five independent transfer attempts
  rather than valid replay of one request. Exact-SHA GitHub Actions run
  [29451087913](https://github.com/jasperfordesq-ai/api.project-nexus.net/actions/runs/29451087913)
  finished terminal green: Build, frozen-React Frontend, all four test shards,
  and Docker Build & Push succeeded. Downloaded TRX artifacts contained 3,385
  runtime rows (841 + 840 + 840 + 864), all passed with 0 failed, skipped,
  error, timeout, or aborted. The 24-row difference from logical allocation is
  shard-4 parameterized-row expansion. Coverage intentionally remains outside
  this required gate. This complete exact-SHA aggregate is published but still
  adds zero banked points pending the required scoring transaction.

### Dirty And In Flight

At the 2026-07-15 documentation transaction, `HEAD` and `origin/main` matched at
`dbafc5c3` and the active worktree was clean. At the 2026-08-09 boundary refresh
above, `HEAD` and `origin/main` match at `e36415c0`, the worktree is clean, and
there is one registered worktree, one local branch, and no stashes. The published Web UK
public-copy/test changes and repository operational guardrails are separately
disclosed and remain unscored. The original shard harness remains committed at
`60715dfd`; `b3f946b3` is its required-CI workflow boundary. This documentation
transaction itself, and any dirty, isolated, or projected work, contributes
zero banked points.

### 2026-07-15 Windows Update Interruption

Windows Update initiated the first planned restart at **02:44:42 Irish time**;
two planned servicing restarts followed, and the final operating-system start
was 02:49:14. Codex task execution did not resume until about 05:20. The exact
event-log sequence, installed updates, and pre-restart boundaries are recorded
in [`RESTART_INCIDENT_2026-07-15.md`](RESTART_INCIDENT_2026-07-15.md). No
interrupted or recovered work was converted into score movement.

Re-run `git status --short`, compare the published checkpoint with `HEAD`, and
refresh this section before every status report. Do not infer points from file
count, elapsed effort, or an agent's estimate.

## Open Certification Gates

The remaining 288 points are not a single implementation queue. They include
independent proof gates that must remain visible in status reports:

- semantic completion for remaining marketplace, federation, jobs, providers,
  side effects, feature/module gates, and consumer-visible error behavior;
- schema, migration, upgrade, and data-integrity evidence for remaining
  workflows;
- residual security, tenant-isolation, authorization, and localization depth;
- fixed-rubric assessment of the now-green complete build, full-suite, and
  exact-SHA CI evidence; the required push gate is satisfied at `dbafc5c3`, but
  the category remains banked at 45/100 until a scoring transaction accepts a
  movement;
- unchanged canonical React browser/runtime proof against ASP.NET;
- unchanged, Laravel-certified Web UK switched to ASP.NET by configuration only
  and rerun through the same workflow/accessibility suite;
- live-provider and operational proof, including Stripe/Connect plus unresolved
  refund, dispute, provider-event reconciliation, job, and integration behavior.

Stateful Web UK certification against Laravel must use a separately
provisioned disposable Laravel environment. The ordinary local Laravel database
is a confidential production-derived snapshot and is never a test fixture.

Before the local schema merge, discovery was 3,333 tests across 2,778 methods
and 391 classes. The earlier 48-shard moving-SHA investigation remained partial
at `df8c8b96`; its counts and failure are historical and must not be used as the
current denominator.

The post-pause allocator at `dbafc5c3` discovered and allocated 3,361 logical
tests exactly once across four whole-class shards (841, 840, 840, and 840).
GitHub run 29451087913 completed the required exact-SHA aggregate. Its downloaded
TRX files reported 841, 840, 840, and 864 executed runtime rows respectively,
or 3,385 total; all passed with 0 failed, skipped, error, timeout, or aborted.
Build, frozen-React Frontend, and Docker Build & Push also passed. This replaces
the absent-aggregate certification fact, but it does not automatically move any
of the 55 open build/test/CI points without a fixed-rubric scoring transaction.

## Finite Ordered Backend Queue

Complete these eight bounded packages in order unless an external dependency is
recorded against a package. Do not turn a package into estimated score movement;
points bank only through the evidence transaction above.

1. **Certify marketplace financial lifecycle with live providers.** The localized
   paid, payout, refund, escrow, reversal, and dispute workflows are implemented;
   obtain live Stripe/Connect proof without weakening their banked durable ledgers.
2. **Complete canonical React semantic contract evidence.** Resolve the 171
   method-unresolved entries, classify the 18 Laravel-missing/mismatched entries,
   and add payload, response, status, auth, tenant, upload, side-effect, and
   runtime evidence to the affected rows. The reconciled static matrix has no
   ASP.NET route/method gaps, so no route-count work may substitute for these
   semantic gates.
3. **Generate the unchanged Web UK-to-ASP.NET contract matrix.** Consume the
   current Web UK frontend ledger without frontend forks, classify every call
   against ASP.NET, and close configuration/auth/tenant/shape/status gaps before
   runtime switching.
4. **Close high-risk semantic workflows and providers.** Finish remaining
   federation, jobs,
   provider, side-effect, and feature-gate gaps with focused contract evidence.
5. **Close schema and upgrade deductions.** Reconcile remaining Laravel
   tables/constraints, prove both blank and upgrade migration paths, run model-
   drift gates, and record data-integrity/rollback or forward-remediation proof.
6. **Close security and localization deductions.** Finish tenant/authorization
   depth and the request/error/recipient-locale gaps listed in
   [`BACKEND_LOCALIZATION_CONTRACT.md`](BACKEND_LOCALIZATION_CONTRACT.md).
7. **Assess and bank complete build/test/CI evidence.** Review the exact
   `dbafc5c3` green aggregate against the fixed rubric, combine it with any
   still-required migration-specific proof, and record an explicit category
   movement or no-movement decision. Rerun only when the candidate changes;
   never substitute focused evidence for the recorded complete aggregate.
8. **Certify both unchanged clients.** Run the canonical React workflows and,
   after Web UK's Laravel-first certification, the same unchanged Web UK code
   against ASP.NET by configuration only, including accessibility and provider
   evidence required by the rubric.

## Required Status-Report Format

Every ASP.NET status report must present these five blocks in this order:

1. **Named baseline and SHA** - rubric version, Laravel SHA, last banked ASP.NET
   implementation SHA, scoring-record SHA, and currently inspected HEAD.
2. **Banked score** - one fixed-denominator total plus the seven category rows.
3. **Published but unscored** - exact commits and why points are not banked yet;
   write `none` when there are none.
4. **Dirty/in-flight work** - scoped files or workstream, verification achieved,
   and explicit confirmation that it contributes zero banked points.
5. **Certification gaps** - exact remaining deductions and the evidence needed
   to bank them.

Never report a blended ASP.NET/Web UK percentage, silently rescore history,
convert route counts into a completion percentage, or describe uncommitted work
as complete. Follow
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md) when updating this
status.
