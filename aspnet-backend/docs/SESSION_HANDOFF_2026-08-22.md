# Session Handoff — ASP.NET Conversion, 2026-08-22

Status: **Historical checkpoint once superseded** — this is a dated handoff, not a
canonical source. The canonical sources it points at are always right when they
disagree with it.

Written at the end of the 2026-08-21 session. Read this, then read the standing
brief, then start.

---

## 0. WHAT THE 2026-08-22 SESSION ACTUALLY DID — read this before section 2

Section 2's numbers below are the state at the START of 2026-08-22 and are now
history. They are kept because sections 4–7 are still current and section 5 in
particular is the most useful page here. What changed:

```
score         309/1000 published, ASPNET_BANKED_FLOOR = 290
certified     11 rows  (1.21 the exchange, plus Tier 4 rows 4.1 and 4.22–4.30)
Tier 4        37/120 -> 56/120  (+19)
stub count    561 routes / 325 methods  (was 562/326 — POST /api/reviews)
migrations    186 classes / 184 runtime IDs, tail AddReviewTransactionLink
```

**Both blocking owner decisions from section 3 step 2 were taken.**

1. **POSTing the client's own rendered form DOES satisfy ADR-0004 condition 1
   for web-uk.** Reasoning on record: web-uk is HTML-first with progressive
   enhancement and built to work without JavaScript, so a form POST *is* its
   primary path, and the instrument submits the page's own form with its own
   hidden fields and CSRF token. Rows 4.1 and 4.22–4.26 and 4.30 promoted.
   🔴 This is scoped to web-uk. It is NOT a general ruling that an HTTP POST
   counts as driving a UI — do not carry it to the React or mobile tiers without
   asking.
2. **The Tier 5 escalation: cut three areas, re-point five thin rows.**
   Federation admin, CRM admin and courses admin become explicit **Laravel-only
   exclusions**, and the five rows covering 3–6 endpoints each (admin shell,
   analytics, taxonomy, gamification, credits — against a tier average of 16)
   are to be re-aimed at the remaining areas. 🔴 **NOT YET IMPLEMENTED IN THE
   LEDGER.** The decision is made; the row surgery is the next session's first
   Tier 5 job. Denominator unchanged — this is a re-point, not a re-cut.

**Section 3 steps 1, 3 and 4 are done.** Both diagnosed Web UK defects fixed,
both fixture gaps closed, and all nine write journeys now pass on BOTH arms in
one run with `KNOWN_JOURNEY_DEFECTS` and `KNOWN_FIXTURE_GAPS` **both empty** —
nothing excused. Evidence: `docs/generated/webuk-journey-smoke.json`.

**Three lessons this session earned, none of which section 5 already had:**

- 🔴 **The stub gate is NOT unavailable on this machine.** Section 2 warns that
  `check-noop-stubs.ps1` needs `pwsh` 7 while only Windows PowerShell 5.1 exists
  here. It runs fine under 5.1 (`powershell -NoProfile -ExecutionPolicy Bypass
  -File …`) and passes. Do not report it as UNAVAILABLE without trying.
- 🔴 **A concurrent `dotnet build` blocks a running `dotnet test --no-build` for
  as long as the build takes.** A full-suite run launched in the background sat
  producing nothing for ~45 minutes while short build/test cycles ran beside it,
  which reads exactly like a wedged run. Check `testhost` CPU before concluding
  anything: it was working. Do not start the long suite until the fixing is done.
- 🔴 **`String.replace` in a one-shot patch script replaces the FIRST match
  only.** A perturbation meant to prove `ReviewsController.CreateReview` could
  fail actually gutted `CreateUserReview` several hundred lines earlier, the
  tests passed, and the "guard proved" conclusion would have been false. The
  perturbation must be verified to land where you intended — print the line
  number — before its result means anything. This is the eighth instrument fault
  in two days and the pattern holds: **suspect the measurement first.**

**Two things fixed that nobody had asked for, because they were in the way:**

- `parity-fixture.sql` was **not re-runnable**. Its cleanup missed
  `event_reminder_schedules`, which holds a foreign key to `events`, so a second
  run died at the events DELETE and silently seeded nothing after that point —
  indistinguishable from not having run it. Fixed.
- `-WriteBaseline` on the stub gate **regenerates the baseline from scratch and
  drops the `_raised` provenance block**, the only record of why the count went
  316 → 562 when the counting model widened. Restored by hand, with a `_lowered`
  entry beside it. If you re-baseline, check that block survived.

**One thing left red that is NOT ours:** the nightly `Mobile Device Tests`
workflow has failed every night since it was created (four for four,
`07-profile-explore` and `05-view-events` Maestro assertions). It runs only on a
schedule, so no push shows it. Mobile workstream's.

---

## 1. Read these first, in this order

| # | Document | Why |
| --- | --- | --- |
| 1 | [`HANDOFF_PROMPT.md`](HANDOFF_PROMPT.md) | The standing session brief — roles, invariants, definition of done, forbidden actions, concurrency rules. **Paste it into your session before doing anything.** |
| 2 | `C:\Users\jaspe\.claude\plans\okay-i-want-you-quizzical-sloth.md` | **The plan.** Why the conversion exists, the audit findings behind it, the phase sequence, and the time frames. Owner-approved 2026-08-21. |
| 3 | [`decisions/ADR-0003-aspnet-is-a-committed-deliverable.md`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md) | Why this is a committed deliverable, not an experiment. |
| 4 | [`decisions/ADR-0004-journey-equivalence-is-the-target.md`](decisions/ADR-0004-journey-equivalence-is-the-target.md) | 🔴 **How the goal is measured, and what is OUT of scope.** Read before any parity work. |
| 5 | [`JOURNEY_CERTIFICATION_LEDGER.md`](JOURNEY_CERTIFICATION_LEDGER.md) | The work list — 250 rows. Pick work up here. |
| 6 | [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) | The score, its derivation, the open gates and the queue. |

---

## 2. State as at handoff — verify before trusting

```
origin/main   87b9ba69c   ALL GREEN (7 workflows)
local HEAD    04b9b0124   4 commits UNPUSHED
score         290/1000 published, ASPNET_BANKED_FLOOR = 274 (banked)
rubric        ASPNET-CONTRACT-R5, denominator FROZEN at 250 journey rows
certified     1 row (1.21, the exchange transaction)
stub count    562 routes / 326 methods across 4 categories
```

🔴 **Four commits are unpushed and only ONE of them is ASP.NET's** —
`6c77472a9`. The other three are the concurrent mobile workstream's. **A push
sends every commit on the branch**, so `git log --oneline origin/main..HEAD`
BEFORE pushing, and say what you are about to send. This happened three times on
2026-08-21 and one of those pushes red-ed `main` with someone else's test.

🔴 **`6c77472a9` has not been through CI.** Two consequences: the floor cannot
rise to 290 until it is green, and the rewritten stub gate
(`scripts/check-noop-stubs.ps1`) **runs under `pwsh` 7 in CI while only Windows
PowerShell 5.1 exists on this machine**. That is UNAVAILABLE, not a pass. If CI
reds on the `ASP.NET build` job, suspect that first.

---

## 3. Next steps, in order

**1. Push `6c77472a9`, watch CI, then raise the floor to 290.** Ask the owner
first — that is a standing rule, not a formality. If green, the floor rise is a
one-line commit and it banks the Web UK work. If red, fix before anything else: a
red `main` is inherited by every later commit.

**2. Two owner decisions are blocking real points. Get them, do not decide them.**
   - **Does POSTing the client's own rendered form satisfy ADR-0004 condition 1?**
     Rows 4.1 and 4.22–4.26 and 4.30 are PROVEN solely because the form is posted
     over HTTP rather than clicked. The argument for yes: `web-uk` is HTML-first
     with progressive enhancement, deliberately built to work without JavaScript,
     so a form POST *is* its primary path, and the instrument submits the form the
     page itself rendered with the page's own hidden fields and CSRF token. If
     yes, Tier 4 credit goes 0.306 → 0.394 and the score rises ~15.
   - **The Tier 5 escalation.** Thirteen substantial admin areas are named by NO
     ledger row (federation 62 endpoints / 24 broken, marketplace 20, crm 19,
     tools 14, courses 10, ki-agents 10 all broken, insurance 9, partner-venues 9,
     fadp 9, api-partners 8, plus `/admin/volunteering` 57 only nominally named
     and `/admin/jobs` 19 unnamed). Two reserve rows cannot absorb thirteen, so by
     the plan's own rule this is an owner escalation, NOT a rename and NOT a
     silent re-cut. Recommendation on record: scope federation, CRM and courses
     admin out as explicit Laravel-only exclusions, and re-point the five thin
     rows (admin shell, analytics, taxonomy, gamification, credits — 3.0–5.7
     endpoints per row against a tier average of 16.0) at the rest.

**3. Fix the two diagnosed Web UK defects.** Both have the line to change.
   - Row 4.28, **broken for every group**: `GET /api/v2/groups/{id}` returns
     `{"group":…,"my_membership":…}` as siblings; Laravel returns a flat `data`
     with `owner_id`/`my_role`/`my_status`/`viewer_membership`. `web-uk` unwraps
     `dataFrom(result)?.group` (`web-uk/src/routes/groups.js:1059`) so membership
     is discarded, and the page offers **Join to the group's own owner**, whose
     join 400s. Fix at `GroupsController.cs:293-306`.
   - Row 4.29, two faults: `POST /api/reviews` is a do-nothing stub
     (`MiscParityController.cs:1678-1680`) — an ADR-0004 condition 5 failure — and
     `GET /api/reviews/pending` omits `receiver_id`, which `web-uk` reads
     (`reviews.js:183`) and Laravel emits (`ReviewService.php:293-300`), so the
     form posts an empty recipient. ASP.NET also derives pending reviews from
     Exchanges where Laravel uses completed transactions
     (`ReviewTrustController.cs:37-95`).

**4. Two fixture gaps belong to the Measurer**, in
   `aspnet-backend/scripts/parity-fixture.sql`, both measured at the API not
   guessed: 4.27 returns 422 *"You cannot apply to your own opportunity"* because
   the fixture's only opportunity is `created_by` the control member; 4.28's
   single group has the control member as its owner and an owner cannot leave.

**5. Then the plan's Phase 5 onward** — community modules, the staff tier against
   the admin corpus, extended modules, the platform substrate, the mobile tier.
   🔴 The plan's **RE-ESTIMATE CHECKPOINT** is due: it needs six measured inputs
   (admin defect density, member defect-rate actuals, green batches/day achieved,
   migration-lane throughput, control-arm yield, certified rows/day). Do not carry
   the old day-counts forward without it.

---

## 4. What the admin corpus already tells you, so you do not re-measure it

`docs/generated/admin-corpus/` (README + JSON; the CSV is gitignored).

- 1,119 admin routes (GET **516**, not the 514 previously claimed), 1,008 with a
  reader. **257 of 1,008 client-called admin endpoints (25.5%) are stub or
  absent** — a static LOWER bound on work.
- Worst measured: `/admin/ki-agents` 10 of 10 broken, `/admin/legal-documents`
  15 of 16, `/admin/volunteering` 34 of 52, groups 60%, enterprise 59%,
  newsletters 56%.
- 🔴 **Least trustworthy figure in it:** `/admin/caring-community` reports 155
  endpoints with ZERO stubs. That is the family where "the route exists" has
  historically meant least. **First place a live run should go.**
- Roughly 1 in 15 endpoints still classified as real is expected hollow — order
  of 50 more defects, not individually named.
- **Measure before implementing.** 514 endpoints is one measurement task, not
  514 tasks. That rule is why this corpus exists.

---

## 5. Hard-won lessons from 2026-08-21 — do not rediscover these

**Eight instruments were found reporting wrongly in one day. Assume the
measurement is broken before you believe a defect.**

1. The React smoke's `step()` swallowed every exception and never set an exit
   code — **every run exited 0 regardless**. Fixed and proved red.
2. Score markers were `opaque` and enforced nothing, while a comment claimed they
   could not drift. Now recompute the ledger and fail on mismatch.
3. `build-stub-route-inventory.mjs` reported false clean twice: an off-by-one
   regex group emptied every route template, and it records one route per method
   so a do-nothing method carrying six routes looked clean.
4. `dotnet test --no-build` ran a **stale binary** after a sibling broke the test
   project — it reads exactly like a code fault.
5. A balance reader could not capture a **minus sign**, so a provider correctly
   credited −2.00 → −1.00 was reported as "credits moved by the wrong amount".
   The tool was accusing the backend of a bug that did not exist.
6. The stub scanner's work-detection tokens were **unanchored and matched inside
   response field names** — `_token` matched `csrf_token` — so three genuinely
   empty endpoints excused themselves with their own fabricated output.
7. A PHP test inserted a user against a tenant it never created; it passed
   locally only because a sibling suite had left that tenant behind. **A test
   must establish its own preconditions.**
8. A healthy container proves it answers, **not which build answers**. Confirm a
   rebuild by behaviour: call an endpoint and check a field only the new build
   emits.

**Other traps, each paid for:**
- `MSYS_NO_PATHCONV=1` is required for `--check <path>` on Git Bash, or a leading
  `/` is mangled into a Windows path and the tool reports a false clean.
- Line endings are **mixed** in this tree (`PersonalWalletLedgerService.cs` is
  CRLF, the test file beside it LF) and `cat -A` in Git Bash does not show it — a
  patch assuming the wrong ending fails **silently**.
- Heredocs in Bash break on this content; write a script file instead.
- EF migrations serialise: the chain tail is pinned by
  `CompatibilityAuditEntrySchemaTests` and
  `CURRENT_SCHEMA_READINESS.md`'s marker is filesystem-checked. Update both in
  the same change.
- One controller owns one verb. A duplicate throws `AmbiguousMatchException` — a
  500 whose lost CORS headers make every browser report a CORS error.
- **Three defects were overstated on 2026-08-21 and each cost more to correct
  than it saved** (organisation-name truncation is latent not live; the "5 OAuth
  routes missing" exist but are hollow; the consumed-field reduction was 80 → 64,
  not a collapse). Report what you measured, not what you inferred.

---

## 6. Do not repeat these mistakes about the score

- **The denominator is frozen at 250 rows.** New journeys FILL a named `RESERVE`
  row. Reserves exhausted in a tier is an **owner escalation**.
- **The floor never falls.** A demotion is recorded in the ledger immediately;
  the headline republishes at the next net-non-negative banking transaction.
- **Never compare an R5 total with R1–R4** (712 / 598 / 653 / 353). Different
  questions. `check-doc-scores.mjs` fails on a retired literal in maintained
  prose, deliberately.
- **Banking requires CI green at a pushed SHA**, the five-block format, ledger
  rows moved in the same commit, and the floor raised. Never estimated, never
  silent.
- Promoting a row FORCES the category arithmetic, because the checker recomputes
  from the rows. That is not a licence to bank early: publish the computed number,
  hold the floor, raise it after CI.

---

## 7. Still true, still not code

The live ASP.NET database's **scheduled** backup has been failing since
2026-03-08 — but a **restore-tested off-server copy from 2026-08-10 exists**
(265/265 tables, 49,958 rows) and the container has been stopped since, so that
recovery point is current. Read
[`DATABASE_BACKUP_DECISION.md`](DATABASE_BACKUP_DECISION.md) before repeating
"there is no backup". Real remaining gaps: no scheduled backup, a ~2.5-hour
single-copy tail, migrate-on-start dormant rather than removed, and no deploy
path. Owner infrastructure work, and it gates any production role.
