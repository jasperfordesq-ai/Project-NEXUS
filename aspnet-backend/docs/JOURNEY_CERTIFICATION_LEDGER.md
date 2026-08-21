# Journey Certification Ledger

Last verified: 2026-08-21 (evidence: monorepo `869a2a030`, platform-contracts
run at that SHA all green). Rebuilt to its final denominator on 2026-08-21.

Status: **Canonical current - the finite, FROZEN denominator for ASP.NET completion**

<!-- doc-consistency: ASPNET_JOURNEY_ROWS=250 -->

This ledger is the denominator for "is the ASP.NET edition finished?". It exists
because the previous denominator — roughly 2,650 API endpoints — is not a
delivery plan. It cannot be scheduled, cannot be parallelised, and gets *bigger*
the more carefully you look at it. A journey list is finite, each row is
independently certifiable by one agent, and — as of the 2026-08-21 expansion —
the row count never changes again.

Authority: [`ADR-0004`](decisions/ADR-0004-journey-equivalence-is-the-target.md)
defines what certification means. [`ADR-0003`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)
defines why the work is committed. The score derived from this ledger lives in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) — do not
publish a competing total here.

## 🔴 The Denominator Is Frozen. Reserve Rows Are How It Stays Frozen.

**This section replaces two statements that directly contradicted each other**
and were both deleted on 2026-08-21. The old header said "the list only
shrinks"; the old summary said "a newly discovered journey is added as a new
row … and the totals above are corrected in the same commit". Both cannot be
true, and the second one is the failure mode ADR-0004 was written to stop: a
denominator that grows when you look harder produces a score that **falls while
the software improves**. That already happened once — 712 to 598 between July
and August 2026 — and it destroyed the number's usefulness as a delivery signal.

The rule from 2026-08-21, binding:

1. **The row count is 250 and does not change.** Not for a newly discovered
   journey, not for a module nobody had noticed, not for a refactor.
2. **A journey discovered after this rebuild FILLS A RESERVE ROW.** Each tier
   carries two (`1.RESERVE-A`, `1.RESERVE-B`, and so on for tiers 2–6). They are
   `OPEN`, carry 0 credit, and are counted in the denominator from day one — so
   filling one **cannot** move the total and cannot lower the score. Rename the
   reserve row to the journey, write its evidence, and record the date.
3. **Reserves exhausted in a tier is an owner escalation, never a silent
   re-cut.** If a tier needs a third new row, stop and put it to the owner: it
   means this catalogue mis-scoped a whole product area, which is a decision, not
   a bookkeeping change.
4. **Rows may be RENAMED, merged in wording, or re-evidenced. Never added,
   never removed.** Phase 3's and Phase 9's measurement passes are expected to
   rename rows as they learn what a journey really is. That is allowed. Changing
   the count is not.
5. **A row may become `N/A` by explicit owner decision only**, with the reason
   recorded in the row. `N/A` rows are excluded from the credit divisor; nothing
   else is.

Row numbers were reassigned during the 2026-08-21 expansion (Tier 3 in
particular, where range rows were split into individual journeys). Numbers are
stable from this commit onward.

## Status Vocabulary

Exact meanings. Do not soften them.

| Status | Meaning | Credit |
| --- | --- | ---: |
| **CERTIFIED** | All five ADR-0004 conditions met, including a Laravel control in the same run and a committed automated test. | 100% |
| **PROVEN** | Runs against ASP.NET through the unchanged client's own UI with an assertion on the *effect*, committed as an automated step — but **no Laravel control in the same run**. | 60% |
| **RENDERS** | The page loads with real content and no error state against ASP.NET. No action, no effect assertion. | 25% |
| **PARTIAL** | Attempted, with a named instrument or product limitation blocking the assertion. | 30% |
| **OPEN** | Not attempted, or attempted and failing. | 0% |
| **BROKEN** | Attempted and a defect is confirmed. Carries a named cause. | 0% |
| **N/A** | Out of scope by an owner decision, with the reason recorded. | excluded |

🔴 **Why PROVEN is not CERTIFIED, and why this matters right now.** The React
smoke (`scripts/smoke-react-against-aspnet.mjs`) drives 37 steps against ASP.NET
and asserts effects. The web-uk instrument
(`scripts/smoke-webuk-against-aspnet.mjs`) does the same for the accessible
frontend. Both now run a Laravel control in the same execution.

🔴 **CORRECTED 2026-08-21 — this section said the React smoke had NO Laravel
control arm and called adding one "the single highest-value next change in this
whole workstream". It was built the same day, so that instruction is done.** The
paragraph is rewritten rather than deleted because a session that half-remembers
it will go and build a second control arm. What the arm actually produced, and it
is worth knowing before reading any row below:

- The React smoke's `step()` swallowed every exception and never set an exit
  code, so **every run exited 0 regardless of outcome**. Fixed and proved red:
  pointed at an unreachable frontend it reported 36 of 37 steps failed and exited
  1. Verdicts are per-step, written to a JSON artifact under
  `aspnet-backend/artifacts/smoke/`.
- First full control run: **34 MATCH, 0 ASPNET_ONLY_FAIL**, after a fixture fix
  added two non-master tenants (with one community the login page renders a card,
  not a `<select>` — so the empty dropdown was never the master-tenant exclusion
  it was first blamed on).
- The four verdicts are the point: `MATCH`, `BOTH_FAIL` (environment suspect,
  not ASP.NET), `ASPNET_ONLY_FAIL` (a real defect candidate), `LARAVEL_ONLY_FAIL`
  (the control itself, usually a fixture gap). Only the third fails the run, so a
  shared environment problem can no longer be misreported as an ASP.NET defect —
  which is exactly what the empty tenant list would have been without it.

So a PROVEN row's missing condition is no longer *"the arm does not exist"*. It
is now always one of: the arm was not run for that row, or a specific ADR-0004
condition is unmet — and the row must name which.

🔴 **A Laravel control is necessary but not sufficient.** Row 4.1 has one and is
still only PROVEN, because ADR-0004 condition 1 — *the unchanged client driving
the journey through its own UI* — is unmet: web-uk's login page renders **four**
submit buttons, which defeated four browser probes, so the instrument signs in
with a scripted HTTP form POST instead. Do not assume "control present ⇒
CERTIFIED". Check all five conditions, one at a time.

## Summary

Row counts and status counts below are **recomputed from the rows in this file**
and must match them exactly; an automated checker recomputes them and fails on
mismatch. Reserve rows are included in every count.

| Tier | Rows | CERTIFIED | PROVEN | RENDERS | PARTIAL | OPEN/BROKEN | Credit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 — Core member journeys (React) | 42 | 1 | 19 | 0 | 3 | 19 | 0.317 |
| 2 — Community module journeys (React) | 28 | 0 | 1 | 7 | 0 | 20 | 0.084 |
| 3 — Extended module journeys (React) | 42 | 0 | 0 | 2 | 0 | 40 | 0.012 |
| 4 — Member journeys (Web UK accessible) | 32 | 0 | 8 | 20 | 0 | 4 | 0.306 |
| 5 — Staff journeys (admin / super-admin / broker) | 72 | 0 | 0 | 1 | 0 | 71 | 0.003 |
| 6 — Mobile app journeys (Expo / React Native) | 34 | 0 | 0 | 0 | 0 | 34 | 0.000 |
| **Total** | **250** | **1** | **28** | **30** | **3** | **188** | — |

**Total row count: 250.** This is the frozen denominator.

### Per-tier credit arithmetic

Weights are from the Status Vocabulary above: CERTIFIED 100%, PROVEN 60%,
RENDERS 25%, PARTIAL 30%, OPEN/BROKEN 0%. Credit = (sum of weighted statuses) ÷
tier row count, to three decimals.

| Tier | Weighted sum | ÷ rows | Credit |
| --- | --- | ---: | ---: |
| 1 | (1 × 1.0) + (19 × 0.6) + (3 × 0.3) = 13.30 | ÷ 42 | **0.317** |
| 2 | (1 × 0.6) + (7 × 0.25) = 2.35 | ÷ 28 | **0.084** |
| 3 | (2 × 0.25) = 0.50 | ÷ 42 | **0.012** |
| 4 | (8 × 0.6) + (20 × 0.25) = 9.80 | ÷ 32 | **0.306** |
| 5 | (1 × 0.25) = 0.25 | ÷ 72 | **0.003** |
| 6 | 0 | ÷ 34 | **0.000** |

🔴 **These six credits are not interchangeable with the pre-2026-08-21 figures.**
Tiers 2 and 3 were previously published as a single combined credit of 0.071
over 40 rows; they are now separate, and Tier 3's denominator more than doubled
because range rows were split. Tier 6 is new. A tier credit falling relative to
its old value here means the denominator got honest, not that the software
regressed — which is exactly why the count is now frozen and cannot do this
again.

## Tier 1 — Core Member Journeys (React) — 42 rows (40 journeys + 2 reserve)

The journeys without which the product is unusable. These are the procurement
demo.

Rows 1.36–1.40 were added on 2026-08-21. The driver was security item **R-20**,
an open deduction with no journey behind it: Laravel's
`app/Http/Controllers/Api/WebAuthnController.php` is **1,994 lines** and there is
**no `*WebAuthn*Controller.cs` anywhere under `aspnet-backend/src/`** — so the
whole passkey surface was an unnamed gap rather than a scheduled row. Search and
activity/nexus-score were in the same position: real member pages, no row.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 1.1 | Sign-up: register form → "verify your email" | PROVEN | smoke `journey-sign-up`; 4 automation traps recorded in script |
| 1.2 | Email verification → first sign-in | PROVEN | smoke flips the verified flag in the dev DB (docker-guarded); `/verify-email` is `[Authorize]` and the code only reaches a member by email |
| 1.3 | Legal acceptance gate on first sign-in | PROVEN | smoke: gate surfaces, is accepted through the UI, member lands on `/onboarding` |
| 1.4 | Sign-in: existing member, tenant select | PROVEN | smoke `login-page`/`select-community`/`login-submit` |
| 1.5 | Sign-out clears session both sides | OPEN | never driven |
| 1.6 | Password reset: request → email → reset → sign-in | OPEN | needs mail capture in the instrument |
| 1.7 | Token refresh across real access-token expiry | PARTIAL | forced-401 probe shows the client routes to `/login` — client behaviour, not a backend verdict |
| 1.8 | Onboarding completion → lands in app | OPEN | smoke stops at `/onboarding` |
| 1.9 | Dashboard renders correct panels | PROVEN | smoke `dashboard`; the events-contract crash here was found this way |
| 1.10 | Feed browse | PROVEN | smoke `feed`; 33 missing fields → 1 (`media`) |
| 1.11 | Feed infinite scroll loads page 2+ | PARTIAL | text-length heuristic only; needs `data-testid` on FeedCard (frontend change, owner approval) |
| 1.12 | Feed filter tabs filter | PROVEN | `?type=` was not a parameter at all until 2026-08-20 |
| 1.13 | Feed: create post | PROVEN | smoke `action-create-feed-post` |
| 1.14 | Feed: comment, visible after | PROVEN | smoke `journey-feed-comment` |
| 1.15 | Feed: reaction persists across reload | PARTIAL | post text renders outside any `[role="article"]`; probe cannot anchor the card. Needs `data-testid` |
| 1.16 | Feed: post with photos | BROKEN | multi-photo shows one photo — no table for the extras |
| 1.17 | Listings browse | PROVEN | smoke `listings`; field-complete |
| 1.18 | Listings: filter and search | OPEN | filters never exercised |
| 1.19 | Listing: create | PROVEN | smoke `action-create-listing`; validated nothing until `a0318b29c` |
| 1.20 | Listing: edit and delete | OPEN | |
| 1.21 | Exchange: request → accept → complete → credits move | CERTIFIED | **CERTIFIED 2026-08-21 on measurement. All five ADR-0004 conditions met, in ONE control run: `aspnet-backend/artifacts/smoke/react-smoke-2026-08-21T19-16-28-440Z.json` (36 MATCH, 2 NOT_COMPARABLE, 0 ASPNET_ONLY_FAIL, 0 LARAVEL_ONLY_FAIL, 0 BOTH_FAIL; `journey-exchange-request-accept-complete` = MATCH).** 🔴 **The score has NOT been banked. This row is the ledger being honest in real time; the headline movement is a separate banking transaction and needs the working tree committed and CI green at a pushed SHA. Nothing here was committed by the batch that measured it.** **THE NUMBERS.** ASP.NET arm: the unchanged React app on :5199 (`VITE_BACKEND_TARGET=dotnet`, `VITE_API_URL=http://127.0.0.1:5080`, configuration only, no frontend file touched) drove exchange **4** end to end through its own UI - provider signs in and publishes a listing, requester finds it, *Request Exchange* → *Send Request*, provider *Accept Request* → *Start Exchange* → *Mark Complete*, then BOTH parties *Confirm Hours* - and the credits moved: requester `member@acme.test` 15.5 → 14.5, provider `coordinator@acme.test` −1 → 0, exactly −1/+1 for 1 agreed hour. Confirmed independently in PostgreSQL, not just in the page: `exchanges` id 4 `Completed`, `FinalHours` 1.00, `RequesterConfirmedHours` 1.00, `ProviderConfirmedHours` 1.00, `TransactionId` 11; `transactions` id 11 Sender 3 → Receiver 4, 1.00, `TransactionType` `exchange`, `Completed` - one row, both legs, right direction. Laravel control arm, SAME run: exchange **67**, requester 95 → 94, provider 30 → 31. **Five-condition breakdown:** (1) unchanged client through its own UI by configuration only - MET; (2) the EFFECT asserted, both balances, not the render - MET; (3) the same journey passing against the Laravel control in the same execution - MET; (4) guarded by a committed smoke step (`journey-exchange-request-accept-complete`) plus 78 passing cases across `ExchangeClientContractTests`, `ExchangeSettlementTests`, `ExchangeConcurrencyTests`, `ExchangeJourneyContractTests` and `ExchangesControllerTests` - MET in substance, but the instrument fix that makes the step pass is UNCOMMITTED in the tree that measured it, so re-verify after the commit; (5) no do-nothing endpoint on the path - MET, all 12 endpoints opened by hand in the previous batch and the stub ratchet re-run today still matches its baseline of 316. 🔴 **THREE THINGS BLOCKED THIS AFTER THE BACKEND WAS ALREADY CORRECT, AND ALL THREE WERE OUTSIDE THE BACKEND. This is the finding of the batch.** (a) `DemoShowcaseSeedData.cs` created ONE required `OnboardingStep` for the tenant and marked it complete for the member only, so every other seeded actor reported `onboarding_completed:false` at `/v2/users/me` and the unchanged client pinned them on `/onboarding` for ever (`react-frontend/src/components/routing/ProtectedRoute.tsx:95-98`); the exchange provider could sign in and then reach nothing. (b) The same file accepted the tenant's `RequiresAcceptance` terms document for the member only, so the provider's `/v2/legal/acceptance/status` said `blocking_pending:true` and the client rendered navigation and footer with NO page content - `/listings/create` came back with 0 inputs and 0 selects, no failing API call and no console error, while `member@acme.test` on the identical path got 13 inputs and 3 selects. Both are now fixed for the three seeded actors explicitly (never 'every user in the tenant', so a member who registers through the form still meets the real gates - re-measured in the same run: a brand-new sign-up still lands on `/onboarding` with the legal gate visible). (c) 🔴 **THE INSTRUMENT'S OWN BALANCE READER DROPPED THE MINUS SIGN AND REPORTED A CORRECT SETTLEMENT AS A LEDGER BUG.** The provider's balance went −2.00 → −1.00, which is +1.00 credited exactly as intended; the wallet page renders that as `-1`, the pattern's capture group could not include a sign, so the step read 2 then 1 and failed with 'credits moved by the WRONG amount: requester -1, provider -1'. The database said one `exchange` row in the right direction. A demo member can legitimately hold a negative balance, and the same reader serves BOTH arms, so it would have mis-scored Laravel identically. **Neither (a), (b) nor (c) was an ASP.NET defect; the settlement code measured in the previous batch was right all along.** **Earlier history, still true:** settlement itself landed on 2026-08-21 - migration `20260821164404_AddExchangeTwoPartyConfirmation` added the five two-party-confirmation columns copied from `database/schema/mysql-schema.sql:8909-8917`, and `ExchangeService.ConfirmHoursAsync` settles on `PersonalWalletLedgerService` in one transaction with advisory locks on both members in sorted order, balance derived from the ledger, no balance column written. `POST /complete` is Laravel's `markReadyForConfirmation` (provider-only, moves no credits); `POST /confirm` settles only when both figures are present and agree within 0.25h, otherwise Disputed with no movement. Six earlier defects were fixed the same day: the `config` stub that took the feature off the map, an accept that answered the listing owner 403 because the client sends POST and the controller declared only PUT, three guard-free aliases that mutated status with no participant check, a 500 `AmbiguousMatchException` on rate, a bare `check` response that removed the *Request Exchange* button from every listing in every community, and a create that bound only `agreed_hours` and silently discarded the hours a member typed. `Support/Exchanges/ExchangeContractMapper.cs` is now the single projection and the single status vocabulary, and `WireStatus` throws on an unmapped enum member rather than lowercasing a PascalCase name onto the wire. **Remaining known shortfalls, recorded not hidden:** `prep_time` is accepted and dropped (no column - needs a migration); `status_history` is DERIVED from timestamps, so a member sees a shorter timeline than on Laravel (no `exchange_history` table here); `broker_notes`/`broker_id`/`risk_level` are honest nulls; and `needs-attention-count` still counts `accepted`, which Laravel excludes - subtractive, so it needs its own evidence. |
| 1.22 | Events browse + discovery filters | PROVEN | `when`/`per_page`/`group_id`/`q`/cursor fixed 2026-08-20 |
| 1.23 | Event: RSVP | PROVEN | smoke `action-rsvp-event` |
| 1.24 | Event: create / edit / manage | OPEN | |
| 1.25 | Event: attendance check-in by code | BROKEN | ASP.NET has no signed `nqx2_` offline-checkin credential subsystem. Re-classified as its own work package, not a route patch |
| 1.26 | Messages: send into existing thread | PROVEN | smoke `journey-message-send` |
| 1.27 | Messages: start a new conversation | OPEN | |
| 1.28 | Messages: voice + attachment send and play back | OPEN | fetch routes built 2026-08-20 with byte-identical private-media headers; the journey is unproven |
| 1.29 | Wallet: transfer credits | PROVEN | smoke `action-transfer-credits` |
| 1.30 | Wallet: history renders | PROVEN | smoke `journey-wallet-history` |
| 1.31 | Members directory browse | PROVEN | smoke `journey-members-connect` (browse arm) |
| 1.32 | Connections: request → accept → appears both sides | OPEN | connect controls render; the journey is not driven |
| 1.33 | Profile: view own and another member's | PROVEN | smoke `journey-profile` (own) |
| 1.34 | Settings: edit a field and save it | OPEN | the 14-field edit surface opens; **no save is asserted**. There is no Edit control on the profile page; editing lives in Settings. 🔴 Status normalised 2026-08-21: this row read `PARTIAL→OPEN`, which is not a value in the vocabulary and made the tier uncountable. With no asserted save there is no attempted-and-blocked assertion, so it is OPEN, not PARTIAL |
| 1.35 | Settings: theme persists across reload | PROVEN | smoke `journey-settings-theme`; proves `PUT /users/me/theme` end to end |
| 1.36 | Sign-out: session cleared server-side, protected page refuses after | OPEN | distinct from 1.5, which only asks whether the client clears local state. Scope origin: 2026-08-21 R5 expansion |
| 1.37 | Passkey / WebAuthn: register a credential from Settings | OPEN | no ASP.NET counterpart found: `app/Http/Controllers/Api/WebAuthnController.php` is 1,994 lines; no `*WebAuthn*Controller.cs` exists under `aspnet-backend/src/`. RP-ID derivation is per tenant in Laravel, which the .NET side must reproduce. Scope origin: 2026-08-21 R5 expansion |
| 1.38 | Passkey / WebAuthn: sign in with a registered credential | OPEN | same missing subsystem as 1.37. `aspnet-backend/CLAUDE.md` records the WebAuthn challenge store as process-local, so distributed challenge continuity is a second blocker. Scope origin: 2026-08-21 R5 expansion |
| 1.39 | Two-factor: enrol, then satisfy the challenge at next sign-in | OPEN | the ASP.NET 2FA challenge store is process-local (architecture invariants, `aspnet-backend/CLAUDE.md`); challenges must be opaque, time-bounded and single-use. Never driven. Scope origin: 2026-08-21 R5 expansion |
| 1.40 | Search: results are correct, not merely present (`/search`) | OPEN | Laravel search is Meilisearch-backed; filter drift there returns 500s. Result *correctness* against a known fixture has never been compared between engines. Scope origin: 2026-08-21 R5 expansion |
| 1.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 1 journey discovered after 2026-08-21. Fill it; never grow the tier. Scope origin: 2026-08-21 R5 expansion |
| 1.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 1 journey discovered after 2026-08-21. Fill it; never grow the tier. Scope origin: 2026-08-21 R5 expansion |

Also PROVEN in Tier 1 and folded into rows above: notifications list +
mark-all-read (smoke `journey-notifications`), cookie-consent save (was a
500 disguised as a CORS error until `c108c90c4`).

🔴 **Those two folded items are unnumbered journeys with real PROVEN evidence,
and that is exactly what reserve rows are for.** They are the first candidates
for `1.RESERVE-A` and `1.RESERVE-B`. Promoting them would *raise* Tier 1 credit
without moving the denominator — which is the mechanism working as designed. It
was deliberately not done in this commit, because a status change needs the
evidence re-read, not a footnote copied into a table.

## Tier 2 — Community Module Journeys (React) — 28 rows (26 journeys + 2 reserve)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 2.1 | Groups: browse | RENDERS | smoke `module-groups`, 9 fixture groups |
| 2.2 | Groups: create | OPEN | |
| 2.3 | Groups: join / leave | OPEN | |
| 2.4 | Groups: post into a group | OPEN | |
| 2.5 | Group exchanges: request → complete | OPEN | |
| 2.6 | Volunteering: browse opportunities | PROVEN | 3 faults fixed 2026-08-21: missing `organization`, `starts_at` vs `start_date`, ignored `per_page`/`cursor`/`is_remote` |
| 2.7 | Volunteering: apply for an opportunity | OPEN | |
| 2.8 | Volunteering: shift signup / cancel | OPEN | |
| 2.9 | Volunteering: QR check-in | OPEN | |
| 2.10 | Volunteering: log hours → approval → credits | OPEN | |
| 2.11 | Goals: create and progress | RENDERS | smoke `module-goals`, 7 fixture goals |
| 2.12 | Polls: vote | RENDERS | smoke `module-polls`, 14 polls. Poll creation never published to the feed until `301ae1244` |
| 2.13 | Polls: create | OPEN | |
| 2.14 | Skills: add and endorse | RENDERS | smoke `module-skills` |
| 2.15 | Achievements / badges | RENDERS | smoke `module-achievements` |
| 2.16 | Leaderboard | RENDERS | smoke `module-leaderboard`; lives under `/api/v2/gamification/*` |
| 2.17 | Reviews: leave a review | OPEN | |
| 2.18 | Matches + preferences | OPEN | |
| 2.19 | Saved collections | OPEN | |
| 2.20 | Knowledge base / resources / help | RENDERS | `/help` FAQs were flat where both frontends read grouped — every FAQ silently vanished. Fixed `abf4329f0` |
| 2.21 | Explore: the unified discovery surface (`/explore`) | OPEN | 🔴 **No ASP.NET counterpart exists.** `app/Services/ExploreService.php` is **2,257 lines** in Laravel; a search of `aspnet-backend/src/` for any `*Explore*` file returns nothing. This is the largest single member-facing service with zero .NET implementation. Note the same route is already in the web-uk instrument's page list (rows 4.10 / 4.20), so it renders *through web-uk* while having no dedicated controller — worth understanding before implementing. Scope origin: 2026-08-21 R5 expansion |
| 2.22 | Impact: member impact report and impact summary (`/impact-report`, `/impact-summary`) | OPEN | two declared React member routes; never compared. Scope origin: 2026-08-21 R5 expansion |
| 2.23 | Advertise: local advertising campaigns and push campaigns (`/advertise/campaigns`, `/advertise/push-campaigns`) | OPEN | member-side arm of the local-advertising surface; the admin arm is Tier 5. Scope origin: 2026-08-21 R5 expansion |
| 2.24 | Verify identity: complete a check through a real provider (`/verify-identity/callback`, `/verify-identity-optional`) | OPEN | four-provider IdP stack in Laravel — Veriff, Onfido, Jumio, Idenfy — all four listed as in-scope gaps in `aspnet-backend/CLAUDE.md`. 🔴 Certification needs live-provider credentials, which is an owner decision (see Named Owner Decisions, item 5), so this row cannot be closed by an agent alone. Scope origin: 2026-08-21 R5 expansion |
| 2.25 | Partner surfaces: partner portal, partner analytics, partner timebanks, organisations | OPEN | four declared React member routes (`/partner`, `/partner-analytics/dashboard`, `/partner-timebanks/*`, `/organisations`). Partner API and partner portal are named in-scope gaps. Scope origin: 2026-08-21 R5 expansion |
| 2.26 | Newsletter, member arm: subscribe, preferences, unsubscribe (`/newsletter/unsubscribe`) | OPEN | member-facing arm only; the admin newsletter family is Tier 5 (rows 5.30–5.34). Scope origin: 2026-08-21 R5 expansion |
| 2.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 2 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |
| 2.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 2 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |

## Tier 3 — Extended Module Journeys (React) — 42 rows (40 journeys + 2 reserve)

🔴 **This tier was 20 rows and four of them read `3.1–3.4 Marketplace: browse,
sell, order, pickup/scan | OPEN ×4`.** Behind those four cells sat roughly
30,000 lines of Laravel: `app/Services/MarketplacePaymentService.php` is **2,841
lines**, `app/Services/MarketplaceOrderService.php` is **1,839**, plus Stripe
Connect seller onboarding, escrow, refunds and disputes — and 40-plus declared
React routes under `/marketplace/*` alone. A range row is not an abstraction, it
is a hiding place: it cannot be assigned, cannot be scheduled, and its single
status silently averages a browse page with a payment escrow. Every range row in
this tier was split on 2026-08-21, which is why Tier 3's denominator doubled.

Several rows here are commercially optional for a public-sector buyer and are
candidates for an explicit scope decision (Named Owner Decisions, item 4). A
scope decision moves a row to `N/A` with a reason — it never deletes it.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 3.1 | Marketplace: browse the catalogue (`/marketplace`) | OPEN | 3 `*Marketplace*Controller.cs` files exist in ASP.NET against ~40 declared React marketplace routes; no journey driven. Scope origin: 2026-08-21 R5 expansion (split from former range row 3.1–3.4) |
| 3.2 | Marketplace: search, category and map discovery (`/marketplace/search`, `/category/:slug`, `/map`, `/free`, `/collections`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.3 | Marketplace: create a listing to sell (`/marketplace/sell`, `/my-listings`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.4 | Marketplace: place an order (`/marketplace/orders`) | OPEN | `MarketplaceOrderService.php` = 1,839 lines. Scope origin: 2026-08-21 R5 expansion |
| 3.5 | Marketplace: pay, with funds held in escrow | OPEN | `MarketplacePaymentService.php` = 2,841 lines. 🔴 Live-provider certification (Stripe) is an owner decision, item 5. Scope origin: 2026-08-21 R5 expansion |
| 3.6 | Marketplace: refund an order | OPEN | inside the 2,841-line payment service; a distinct money-moving journey, not a variant of 3.5. Scope origin: 2026-08-21 R5 expansion |
| 3.7 | Marketplace: raise and resolve a dispute (`/marketplace/reports`, `/reports/:id`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.8 | Marketplace: pickup slots and seller pickup scan (`/marketplace/seller/pickup-slots`, `/seller/pickup-scan`, `/me/pickups`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.9 | Marketplace: seller / merchant onboarding incl. Stripe Connect (`/marketplace/seller/onboard`, `/seller/onboarding`, `/become-partner`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.10 | Marketplace: seller coupons — create, edit, redeem (`/marketplace/seller/coupons`, `/coupons/:id`) | OPEN | absorbs the former standalone row "Coupons" (old 3.16), which was the same product surface counted twice at different granularities. Scope origin: 2026-08-21 R5 expansion |
| 3.11 | Jobs: browse and view a vacancy (`/jobs`, `/jobs/:id`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former range row 3.5–3.7) |
| 3.12 | Jobs: apply for a vacancy | OPEN | 🔴 Laravel has known jobs schema drift; `job_vacancy_applications` is the canonical table. Verify the column set before implementing. Scope origin: 2026-08-21 R5 expansion |
| 3.13 | Jobs: my applications (`/jobs/my-applications`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.14 | Jobs: employer pipeline / kanban (`/jobs/:id/kanban`, `/jobs/:id/analytics`, `/jobs/employer-onboarding`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.15 | Jobs: talent search and alerts (`/jobs/talent-search`, `/jobs/alerts`, `/jobs/bias-audit`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.16 | Courses: browse the catalogue (`/courses`, `/courses/:idOrSlug`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former range row 3.8–3.9) |
| 3.17 | Courses: enrol and learn, progress persists (`/courses/:id/learn`, `/courses/my-learning`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.18 | Courses: instructor creates and edits a course (`/courses/instructor/new`, `/instructor/:id/edit`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.19 | Courses: instructor grades a submission (`/courses/instructor/:id/grading`, `/:id/analytics`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.20 | Podcasts: listen to an episode (`/podcasts`, `/:showSlug/:episodeSlug`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former row 3.10) |
| 3.21 | Podcasts: studio — publish an episode (`/podcasts/studio`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.22 | Ideation: submit an idea (`/ideation`, `/ideation/create`, `/ideation/:id`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former row 3.11) |
| 3.23 | Ideation: run a campaign (`/ideation/campaigns`, `/campaigns/:id`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.24 | Ideation: outcomes published back to members (`/ideation/outcomes`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.25 | Clubs / Verein: dues — charged, paid, recorded (`/clubs`, `/clubs/:id/admin/dues`, `/me/verein-dues`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former row 3.12) |
| 3.26 | Clubs / Verein: invitations and member import (`/me/verein-invitations`, `/clubs/:id/admin/import`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.27 | Venues: member venue pass (`/venues`, `/venues/pass`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former range row 3.13–3.14) |
| 3.28 | Venues: check in with a token (`/venues/checkin/:token`) | OPEN | related to the `nqx2_` signed-credential gap named in row 1.25; confirm whether it shares that subsystem before scheduling. Scope origin: 2026-08-21 R5 expansion |
| 3.29 | Donations: donate and receive a receipt (`/donations/:id/receipt`) | OPEN | 🔴 A prior donation defect here was an actor-lookup tenant-scoping bug, not a route gap. Read `reference_never_tenant_scope_the_actor_lookup` before implementing. Scope origin: 2026-08-21 R5 expansion (former row 3.15) |
| 3.30 | Premium: subscribe (`/premium`, `/premium/return`) | OPEN | **no ASP.NET counterpart found**: zero `*Premium*Controller.cs` under `aspnet-backend/src/`. Scope origin: 2026-08-21 R5 expansion (split from former row 3.17) |
| 3.31 | Premium: manage or cancel a subscription (`/premium/manage`) | OPEN | same missing controller as 3.30. Scope origin: 2026-08-21 R5 expansion |
| 3.32 | Caring Community: request help (`/caring-community/request-help`, `/offer-favour`) | OPEN | Scope origin: 2026-08-21 R5 expansion (split from former row 3.18) |
| 3.33 | Caring Community: my relationships and trust tier (`/my-relationships`, `/my-trust-tier`, `/caregiver/link`) | OPEN | 🔴 A relationship record is never authorisation. `can_view_messages` on `account_relationships` is deliberately **not** enforced in Laravel — do not wire it up in .NET or present it as working. Scope origin: 2026-08-21 R5 expansion |
| 3.34 | Caring Community: raise a safeguarding report as a member (`/safeguarding/report`, `/safeguarding/my-reports`) | OPEN | the member arm; the staff queue is row 5.15. Scope origin: 2026-08-21 R5 expansion |
| 3.35 | Caring Community: warmth pass, hour gift/transfer, future care fund (`/warmth-pass`, `/hour-gift`, `/hour-transfer`, `/future-care-fund`) | OPEN | credit-moving surfaces; tenant scoping and audit rows are part of the assertion, not extras. Scope origin: 2026-08-21 R5 expansion |
| 3.36 | Federation: partner directory and a partner's detail (`/federation/partners`, `/partners/:id`) | OPEN | 9 `*Federation*Controller.cs` files exist in ASP.NET. 🔴 External partner federation is **off by default and off in production since 2026-07-27** with no partner connected — so certifying this needs a deliberately enabled disposable environment, and must not leave a kill switch flipped. Scope origin: 2026-08-21 R5 expansion (split from former row 3.19) |
| 3.37 | Federation: browse federated members and message them (`/federation/members`, `/members/:id`, `/federation/messages`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 3.38 | Federation: cross-tenant content — listings, events, groups, blog, resources | RENDERS | 🔴 Status and evidence carried over verbatim from former row 3.19, which read "RENDERS (blog/resources arm only)". The RENDERS credit belongs to this row because the blog/resources arm is what earned it; rows 3.36 and 3.37 are OPEN precisely so the split does not spread one arm's evidence across three rows |
| 3.39 | Municipality calendar (`/municipality-calendar`) | OPEN | a declared React member route with no row until now. Scope origin: 2026-08-21 R5 expansion |
| 3.40 | AI chat (`/chat`) | RENDERS | carried over from former row 3.20 |
| 3.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 3 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |
| 3.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 3 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |

## Tier 4 — Member Journeys, Web UK Accessible Frontend — 32 rows (30 journeys + 2 reserve)

This is the accessible frontend serving three live hostnames. Its instrument
**does** run a Laravel control, so its evidence is comparatively trustworthy.

The former range rows (`4.2–4.13`, `4.14–4.21`, `4.22–4.30`) are expanded below
into the individual pages the instrument actually visits, taken from
`aspnet-backend/scripts/smoke-webuk-against-aspnet.mjs`. The **row count is
unchanged at 30**; only the hiding place is gone.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 4.1 | Sign-in (scripted double-CSRF at HTTP layer) | PROVEN | 🔴 **Re-examined 2026-08-21 and deliberately NOT promoted to CERTIFIED.** The Laravel control *is* present in the same run (`smoke-webuk-against-aspnet.mjs:338` signs in on the control port immediately after the ASP.NET port), so ADR-0004 condition 3 is met. **Condition 1 is not:** the journey is not driven through the unchanged client's own UI — web-uk's login page renders **four** submit buttons, which defeated four browser probes, so the instrument posts the form over HTTP instead (script comment, :286-288). Two further honesty notes recorded in the script: each side signs in as **its own fixture's member** (`member@acme.test` vs `e2e.user.a@project-nexus.local`), so this is not the same identity on both engines; and condition 5 (no do-nothing endpoint on the path) has not been checked against the 319 success-shaped no-op methods. Original evidence, unchanged: both logins succeed; `tenant_slug` is a **required form field**; the login GET sets `nexus.csrf` twice and the page token pairs with the **last** |
| 4.2 | Signed-out `/` (choose a community) vs Laravel control | RENDERS | pair compared. 🔴 The one diagnosed asymmetry in the whole signed-out set lives here: `GET /api/v2/tenants` excludes the master tenant unless `include_master=1` (`TenantBootstrapController::list`, :205-207) and the disposable Laravel fixture holds *only* the master tenant, so it lists 0 against ASP.NET's 4. Recorded in the script's shrink-only `KNOWN_DIFFERENCES` list — a **fixture** fault, not a backend fault |
| 4.3 | Signed-out `/login` renders vs control | RENDERS | page pair: same status, same redirect target, no GOV.UK error page |
| 4.4 | Signed-out `/register` renders vs control | RENDERS | page pair |
| 4.5 | Signed-out `/blog` renders vs control | RENDERS | page pair |
| 4.6 | Signed-out `/help` renders vs control | RENDERS | page pair |
| 4.7 | Signed-out `/listings` renders vs control | RENDERS | page pair |
| 4.8 | Signed-out `/events` renders vs control | RENDERS | page pair |
| 4.9 | Signed-out `/explore` renders vs control | RENDERS | page pair. Note this renders while Tier 2 row 2.21 records **no ASP.NET `Explore` controller at all** — understand which endpoints this page actually calls before concluding either row is wrong |
| 4.10 | Signed-out `/kb` renders vs control | RENDERS | page pair |
| 4.11 | Signed-out `/feed` gates to `/login` identically on both | RENDERS | the sign-in gate is itself part of the contract: both sides must gate the same pages to the same target |
| 4.12 | Signed-out `/groups` renders or gates identically | RENDERS | page pair |
| 4.13 | Signed-out `/volunteering` renders or gates identically | RENDERS | page pair |
| 4.14 | Signed-in `/dashboard` renders vs control | RENDERS | signed-in tier; asserts renders, not byte-identity |
| 4.15 | Signed-in `/listings` renders vs control | RENDERS | signed-in tier |
| 4.16 | Signed-in `/events` renders vs control | RENDERS | signed-in tier |
| 4.17 | Signed-in `/feed` renders vs control | RENDERS | signed-in tier |
| 4.18 | Signed-in `/groups` renders vs control | RENDERS | signed-in tier |
| 4.19 | Signed-in `/volunteering` renders vs control | RENDERS | signed-in tier |
| 4.20 | Signed-in `/explore` renders vs control | RENDERS | signed-in tier |
| 4.21 | Signed-in `/kb` renders vs control | RENDERS | signed-in tier |
| 4.22 | Web UK: post to the feed | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED: the post body appears on a fresh `GET /feed` on both arms. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.23 | Web UK: create a listing | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED: web-uk redirects to `/listings/{id}` and that page renders the new title (ASP.NET listing 73, Laravel 950135 on the recorded run). 🔴 The id is the load-bearing part — web-uk itself flashes "the listing was saved, but Laravel did not return its ID" when a backend answers success without one (`listings.js:1368-1373`), so a success-shaped response with no id would not pass here. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.24 | Web UK: RSVP to an event | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED: after a reload the event page renders the member as going — the `status-going` radio comes back `checked` and/or the attendee check-in block appears (`events/detail.njk:85-90`, `:365`). The Laravel control member is seeded as already going to the fixture's only event, so the instrument withdraws that RSVP first and then RSVPs for real. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.25 | Web UK: send a message | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED: the message body appears in the thread on a fresh `GET /messages/{peer}`. 🔴 **This row FAILED on ASP.NET when first measured and was FIXED in the same batch.** A direct thread was resolved by `(TenantId, Participant1Id, Participant2Id)` with **no `IsGroup` filter**, and the conversations table reuses those columns for GROUP rows — the unique index is partial (`... WHERE IsGroup = false`). Measured on the dev database: pair (3,4) had four rows, one direct plus three groups, so `SendMessage` persisted a private message onto a **group** conversation while the thread read returned a different, empty group row and the member's own message vanished. Fixed at five call sites: `MessagesController.cs` (v2 thread read, `FindDirectConversationIdAsync`, `SendMessage` write + insert, mark-read) and `MemberParityController.cs` (voice-message write + insert). 186 focused tests pass; re-measured green on both arms. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.26 | Web UK: transfer credits | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED on the MONEY, twice over: the sender's balance falls by exactly the amount sent (0.25 credits; ASP.NET 14.00 → 13.75, Laravel 93.50 → 93.25 on the recorded run) **and** the transfer note appears in the transaction history. The recipient is found through the page's own recipient search ("coordinator" — the member `parity-fixture.sql` added for this purpose). 🔴 The balance reader handles a MINUS SIGN in all four forms Intl.NumberFormat can emit; the React instrument's reader could not, and reported correct credits as wrong on 2026-08-21. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.27 | Web UK: apply for a volunteering opportunity | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED on ASP.NET: a pending application for that opportunity appears on the member's applications tab, and the instrument first withdraws any earlier one and proves the pending count fell — so it asserts the effect in both directions and stays repeatable. 🔴 **The Laravel control CANNOT run this journey, so CERTIFIED is impossible until the fixture changes** (condition 3): `POST /api/v2/volunteering/opportunities/950021/apply` answers 422 "You cannot apply to your own opportunity" because `parity-fixture.sql` makes the control member the `created_by` of the fixture's only opportunity. Measured at the API, because web-uk maps every 4xx to the same `apply-failed` redirect. FIXTURE work, not backend work. |
| 4.28 | Web UK: join a group | BROKEN | ASP.NET defect, named cause: **`GET /api/v2/groups/{id}` answers an unwrapped body.** It returns `{"group":{…},"my_membership":{…}}`; Laravel returns `{"data":{…group fields FLAT…, owner_id, my_role, my_status, viewer_membership},"meta":{…}}` (measured side by side, ASP.NET group 10 vs Laravel group 950032, in the same run). web-uk resolves the group as `dataFrom(result)?.group` falling back to `dataFrom(result)` (`web-uk/src/routes/groups.js:1059`), so with no `data` envelope it unwraps into the nested `group` and `my_membership` — a **sibling** of it — is discarded. `isActiveGroupMember` (`groups.js:529-538`) then sees no membership: the page offers **Join** to a member who is already the **owner**, and the join answers 400 "You are already a member of this group". A member who does join cannot see that they joined, so this is broken for every group, not only an owned one. Fix in `GroupsController.cs:293-306`. 🔴 Separately, the Laravel control also cannot run this journey: the fixture has one group and the control member owns it, and an owner cannot leave — so certifying this row needs the backend fix **and** a second fixture group. |
| 4.29 | Web UK: leave a review | BROKEN | ASP.NET defect, **two faults on one path**, and the Laravel control passes this journey in the same run (receiver 950010, transaction 950110, comment visible in "given"). (1) **`POST /api/reviews` is a do-nothing stub** — `MiscParityController.cs:1678-1680` returns `{data:{id,created:true}}` and writes nothing, which is ADR-0004 condition 5 failing outright. (2) **`GET /api/reviews/pending` omits a field the client reads**: it returns the counterparty as `other_user{id,first_name,last_name}` while web-uk reads `receiver_id` / `receiverId` / `receiver.id` (in that fallback order) (`web-uk/src/routes/reviews.js:183`) and Laravel emits `receiver_id`/`receiver_name`/`receiver_avatar`/`exchange_title`/`transaction_id` (`app/Services/ReviewService.php:293-300`), so the rendered form carries `receiver_id=""` and would post 0. ASP.NET also derives pending reviews from **Exchanges** where Laravel derives them from completed **transactions** (`ReviewTrustController.cs:37-95`) — a semantic difference to settle when implementing, not just a rename. |
| 4.30 | Web UK: change a setting and have it persist | PROVEN | smoke `smoke-webuk-against-aspnet.mjs` write-journey tier, run 2026-08-21, artifact `aspnet-backend/docs/generated/webuk-journey-smoke.json`; both arms in the same execution. EFFECT ASSERTED: the appearance theme is changed to a different rendered option and comes back `checked` on a fresh GET, which reads it back through `GET /api/v2/settings` rather than from the session (`settings.js:506-536`); the instrument then restores the previous value so a repeat run measures the same thing. 🔴 Unchanged caution: do not "fix" a session problem here by assigning `req.session.touch` — `web-uk/src/public/js/timeout-warning.js` **is** the inactivity sign-out, and shadowing `touch` breaks it. 🔴 **PROVEN, not CERTIFIED, and the reason is condition 1, not the evidence.** The journey is driven by POSTing the form the page itself rendered (fields read back out of the HTML: hidden inputs, checked radios, selected options), over HTTP rather than through a browser — the same limitation already recorded for row 4.1, applied consistently. Whether that counts as "the unchanged client driving it through its own UI" is an OWNER/scoring decision; if it does, this row and five others become CERTIFIED. Conditions 2, 3 and 4 are met. |
| 4.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 4 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |
| 4.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 4 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |

Rows 4.2–4.21 assert **renders**, not byte-identity, deliberately: the two
fixtures hold different data volumes, so structural equality would report
fixture asymmetry as a fault on every run.

🔴 **Rows 4.22–4.30 were all OPEN for one reason until 2026-08-21: the instrument
submitted nothing.** It now does. The mechanism matters, so it is recorded here
as well as in the script: web-uk is HTML-first with progressive enhancement, so
every write is a real POST of a real `<form>` guarded by `csrf-csrf` double
submit. The instrument reads the form back out of the rendered page — hidden
inputs including `_csrf`, checked radios, checked checkboxes, prefilled text
inputs, the selected `<option>` — and submits exactly what a browser would,
overriding only the fields the journey is testing. Hand-writing payloads instead
would have proved that endpoints accept bodies no page can produce: `/listings/new`
alone needs `type`, `service_type` and a `category_id` whose valid values are
tenant-configured and differ between the two fixtures (17 on ASP.NET, 642 on the
control). Two traps worth keeping: the CSRF token is **not** session-bound
(`getSessionIdentifier` defaults to `() => ""`) and `generateToken` reuses a
still-valid cookie, so one token scraped from any page keeps working for every
later POST on the same jar; and `NODE_ENV=development` makes `createLimiter`
skip every rate limiter (`web-uk/src/lib/rateLimiter.js:25`), which is why a
run of ~30 POSTs is not throttled — a production-mode run would be.

🔴 **Six of the seven promoted rows stop at PROVEN for the SAME reason row 4.1
does, and it is worth an owner decision.** Their effects are asserted and the
Laravel control passes in the same run, so conditions 2, 3 and 4 are met. What is
not met, on the strict reading already applied to 4.1, is condition 1: the form
is submitted over HTTP rather than clicked in a browser. If the owner decides
that POSTing the client's own rendered form counts as "the unchanged client
driving it through its own UI", rows 4.1, 4.22–4.26 and 4.30 become CERTIFIED and
Tier 4's credit rises from 0.306 to 0.394 ((7 x 1.0) + (1 x 0.6, row 4.27) + (20 x 0.25)) / 32. That decision is deliberately NOT
taken here.

🔴 A caution the instrument records about itself, worth reading before trusting
this tier: "10/10 pages identical" has already once coexisted with a backend
nobody could sign in to (the missing `refresh_expires_in`). Page-pair matching
is real evidence about *serving*; it is not evidence about *doing*.

## Tier 5 — Staff Journeys — 72 rows (70 journeys + 2 reserve), in named families

The largest untouched surface, and where the do-nothing endpoints concentrate.
**Public-sector buyers evaluate the admin panel**, so this tier is not optional
for the commercial goal even though no member ever sees it.

🔴 **This tier was 25 rows covering 260 declared admin route paths and 514 admin
GET routes — roughly 10:1 under-abstraction.** At that ratio a row is not a
journey, it is a chapter heading: `5.14–5.16 Admin: tenant settings, module
gates, branding | OPEN ×3` cannot be handed to an agent, and one status cell
cannot honestly describe a whole product area. Rebuilt on 2026-08-21 into 70
rows grouped in **22 named families**, with names taken from
`react-frontend/src/admin/routes.tsx` so a row maps onto a real admin section.

🔴 **Phase 3's measurement pass may RENAME rows in this tier but must never add
or remove them.** That pass is expected to discover that a family boundary was
drawn slightly wrong — rename the affected rows and say so. If it believes a
genuinely new staff journey exists, it fills `5.RESERVE-A`/`5.RESERVE-B`; if
both are already filled, it escalates to the owner. It does not re-cut the tier.

The original tier note stands and is the right sequencing advice: **the admin
GET corpus is one measurement task, not hundreds.** A generated corpus plus the
Laravel control answers most of this tier in a single pass and should be run
**before** implementing anything in it. The old note said "243 admin GET
endpoints have never been compared"; the current count is **514**, which
strengthens rather than weakens the argument.

### Family A — Admin access and shell (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.1 | Admin: sign in and land on the admin dashboard | RENDERS | unverified depth — carried over unchanged |
| 5.2 | Admin: section gating — a `member` and a `broker` are both refused `/v2/admin/*` | OPEN | 🔴 Five authorisation tiers, and `AdminTier` deliberately returns **false** for `broker`/`coordinator`: a broker is an operational role with its own app, not a junior admin. Also: `super_admin`, `god`, `tenant_admin` and `coordinator` are **never written to `users.role`** — a gate that checks only the role string under-authorises a real platform admin. Scope origin: 2026-08-21 R5 expansion |

### Family B — Members admin (5 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.3 | Admin: members list — filter, search, paginate (`admin/users`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.4 | Admin: open one member's detail record | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.5 | Admin: suspend and reactivate a member, and the member feels it | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.6 | Admin: change a member's role and per-user permissions (`admin/users/:id/permissions`) | OPEN | 🔴 Most declared RBAC permission slugs are **not enforced anywhere** — grantable ≠ checked. Verify before asserting an effect. Scope origin: 2026-08-21 R5 expansion |
| 5.7 | Admin: move a member to another tenant | OPEN | 🔴 Cross-tenant actions must check `canAccessTenant()` at **both** ends. Composite user/tenant FKs mean listings and skills move while history stays. Scope origin: 2026-08-21 R5 expansion |

### Family C — Listings moderation (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.8 | Admin: listings moderation queue renders with real items (`admin/listings`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.9 | Admin: moderate a listing, and the member-facing view changes | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family D — Events admin (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.10 | Admin: events list, event settings, creation-role policy (`admin/events`, `admin/events/settings`) | OPEN | 🔴 `events.creation_role` NULL means *default*, not *nobody*. Scope origin: 2026-08-21 R5 expansion |
| 5.11 | Admin: attendance rewards and attendance administration (`admin/events/attendance-rewards`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family E — Groups admin (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.12 | Admin: groups list, detail and edit (`admin/groups`, `groups/:id/detail`, `groups/:id/edit`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.13 | Admin: approve a pending group (`admin/groups/approvals`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.14 | Admin: group moderation queue and a moderation action (`admin/groups/moderation`) | OPEN | 🔴 The Laravel `GroupModerationService` wrote three columns that do not exist (`updated_at`/`moderated_at`/`action_taken` against real `resolved_at`/`moderation_action`) and every write threw silently for four months. Check the real column set before implementing, and run `npm run check:db-columns`. Scope origin: 2026-08-21 R5 expansion |

### Family F — Safeguarding (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.15 | Admin: safeguarding reports queue with SLA and escalation (`admin/caring-community/safeguarding`, `admin/volunteering/safeguarding`) | OPEN | 🔴 There are **four** parallel reporting systems in Laravel and none can reference an exchange. Do not assume one table. Scope origin: 2026-08-21 R5 expansion |
| 5.16 | Admin: safeguarding action log is append-only and records the actor | OPEN | 🔴 The append-only history on `event_guardian_consents` is DB-trigger-enforced — that is the pattern to copy, not to re-invent. Scope origin: 2026-08-21 R5 expansion |

### Family G — Credits and wallet administration (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.17 | Admin: adjust a member's credit balance — balance moves **and** an audit row is written (`admin/timebanking`, `admin/timebanking/starting-balances`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.18 | Admin: transaction audit, organisation wallets, community fund (`admin/timebanking/org-wallets`, `/community-fund`, `/user-report`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family H — Tenant settings, gates and branding (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.19 | Admin: change a tenant setting and see it take effect (`admin/settings`) | OPEN | 🔴 PHP empty maps serialise as `[]`, not `{}`; a strict TypeScript guard on the settings response blanks the page. Scope origin: 2026-08-21 R5 expansion |
| 5.20 | Admin: module gates hide a member surface (`admin/module-configuration`, `admin/tenant-features`) | OPEN | 🔴 Features default to **true** via `FEATURE_DEFAULTS` but maps default **off**, and that default must be changed in both PHP and TypeScript. A bootstrap feature map does not reflect stored flags. Scope origin: 2026-08-21 R5 expansion |
| 5.21 | Admin: branding, image settings, registration and onboarding policy (`admin/image-settings`, `admin/settings/registration-policy`, `admin/onboarding-settings`) | OPEN | 🔴 Header/footer tenant logos must stay uploaded raster assets — never generated SVG. Scope origin: 2026-08-21 R5 expansion |

### Family I — Performance and monitoring (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.22 | Admin: performance dashboard (`admin/performance`) | OPEN | 🔴 It reads `/v2/admin/performance/summary`, **not** `/v2/metrics/summary` — those are different questions and pointing the page back at the metrics counter crashed it once. The shape is pinned from both ends by `tests/Laravel/Feature/Performance/PerformanceSummaryContractTest.php`. Only the query *template* is ever stored; never interpolate bindings. Scope origin: 2026-08-21 R5 expansion |
| 5.23 | Admin: monitoring — health, logs, log files, requirements (`admin/enterprise/monitoring/*`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family J — Super-admin (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.24 | Super-admin: tenant create, read, update, delete | OPEN | 🔴 The tenants JSON column is `configuration`, not `config`. Scope origin: 2026-08-21 R5 expansion |
| 5.25 | Super-admin: subtree confinement — a `regional` level cannot see outside its own subtree | OPEN | 🔴 `app/Core/SuperPanelAccess.php`: `master` sees everything, `regional` is confined by a materialised-path prefix match. `EnsureIsSuperAdmin` deliberately rejects `is_tenant_super_admin`. This row is a security assertion, not a listing test. Scope origin: 2026-08-21 R5 expansion |
| 5.26 | Super-admin: move a user between tenants from the super panel | OPEN | `AdminSuperController::userMoveTenant()` is the both-ends-check reference. Scope origin: 2026-08-21 R5 expansion |

### Family K — Broker (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.27 | Broker: exchange list in the broker application (`react-frontend/src/broker/`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.28 | Broker: resolve a disputed exchange | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.29 | Broker: reverse an exchange, credits return, audit row written | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family L — Newsletters, deliverability and transactional email (5 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.30 | Admin: compose a newsletter → send → activity and stats (`admin/newsletters`, `/:id/activity`, `/:id/stats`) | OPEN | `app/Http/Controllers/Api/AdminNewsletterController.php` is **3,182 lines**; 1 `*Newsletter*Controller.cs` exists in ASP.NET. Scope origin: 2026-08-21 R5 expansion |
| 5.31 | Admin: segments and subscribers (`admin/newsletters/segments`, `/subscribers`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.32 | Admin: newsletter templates and the design editor (`admin/newsletters/templates`, `/edit/:id/design`) | OPEN | 🔴 Outlook does not render CSS gradients — a template that looks right in a browser can arrive unreadable. Scope origin: 2026-08-21 R5 expansion |
| 5.33 | Admin: bounces, deliverability analytics, send-time optimiser, diagnostics (`admin/deliverability/*`, `admin/email-deliverability`, `admin/newsletters/bounces`, `/diagnostics`, `/send-time-optimizer`) | OPEN | `app/Http/Controllers/Api/AdminEmailDeliverabilityController.php` is **2,727 lines**. Scope origin: 2026-08-21 R5 expansion |
| 5.34 | Admin: transactional email / notification send, and the `email_log` record | OPEN | 🔴 "I got no notification" is answered by querying `email_log` and `notifications` **first**. A new Mailer provider must be added to the `email_log.provider` enum. Every recipient-facing string must render in the recipient's `preferred_language` via `LocaleContext::withLocale()`. Carried over from former row 5.25 |

### Family M — GDPR and enterprise compliance (5 rows)

`app/Services/Enterprise/GdprService.php` is **3,228 lines**. ASP.NET has
`GdprController.cs`, `GdprBreachController.cs` and `GdprService.cs`.

🔴 **Two ASP.NET GDPR endpoints currently return success while doing no work,
and are being changed to honest `501`s.** Until that lands, a green result on
any row in this family may be a fabricated success rather than a working
feature — which is precisely the failure ADR-0001 forbids. Re-verify these five
rows *after* the 501 change, not before, and never accept a 2xx here as
evidence.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.35 | Admin: DSAR request queue (`admin/enterprise/gdpr/requests`) | OPEN | DSAR endpoints stay behind `requireAdmin()`. Scope origin: 2026-08-21 R5 expansion |
| 5.36 | Admin: fulfil a DSAR — the member actually receives their data export | OPEN | one of the two endpoints in the fake-success set above. Scope origin: 2026-08-21 R5 expansion |
| 5.37 | Admin: consents and consent types (`admin/enterprise/gdpr/consents`, `/consent-types`) | OPEN | 🔴 `consent_types` is **platform-global** GDPR consent; per-tenant customisation is a separate override table, and it does **not** model proxy representation. `user_consents` is versioned and hashed. Scope origin: 2026-08-21 R5 expansion |
| 5.38 | Admin: breach register — record and track a breach (`admin/enterprise/gdpr/breaches`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.39 | Admin: enterprise roles and permissions — granted **and** enforced (`admin/enterprise/roles`, `/permissions`) | OPEN | 🔴 Grantable ≠ checked; verify enforcement, not the grant screen. Scope origin: 2026-08-21 R5 expansion |

### Family N — Caring Community administration (4 rows)

`app/Http/Controllers/Api/AdminCaringCommunityController.php` is **2,607
lines**, and 56 `*Caring*Controller.cs` files exist in ASP.NET — the widest
.NET coverage of any family here, and therefore the family where "the route
exists" is least likely to mean the work is done.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.40 | Caring admin: dashboard, KPI baselines, municipal impact and ROI (`admin/caring-community`, `/kpi-baselines`, `/municipal-impact`, `/municipal-roi`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.41 | Caring admin: providers, verification, trust tier (`admin/caring-community/providers`, `/verification`, `/trust-tier`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.42 | Caring admin: hour transfers, loyalty, warmth pass (`admin/caring-community/hour-transfers`, `/loyalty`, `/warmth-pass`) | OPEN | credit-moving; the audit row is part of the assertion. Scope origin: 2026-08-21 R5 expansion |
| 5.43 | Caring admin: safeguarding, disclosure pack, operating policy (`admin/caring-community/safeguarding`, `/disclosure-pack`, `/operating-policy`) | OPEN | 🔴 `member_vetting_attestations` (closed reason codes, before/after values) is the model to imitate. Scope origin: 2026-08-21 R5 expansion |

### Family O — AI and matching administration (4 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.44 | Admin: AI settings and agents — proposals and runs (`admin/ai-settings`, `admin/agents`, `/agents/proposals`, `/agents/runs`, `admin/ai/*`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.45 | Admin: algorithm settings and feed algorithm (`admin/algorithm-settings`, `admin/feed-algorithm`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.46 | Admin: smart matching — configuration, analytics, monitoring (`admin/smart-matching`, `/configuration`, `/analytics`, `admin/smart-match-monitoring`, `/smart-match-users`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.47 | Admin: match debug and matching diagnostic (`admin/match-debug`, `admin/matching-diagnostic`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family P — Analytics and reporting dashboards (4 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.48 | Admin: platform analytics dashboard | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.49 | Admin: community analytics (`admin/community-analytics`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.50 | Admin: search analytics (`admin/search-analytics`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.51 | Admin: regional analytics and the national KISS dashboard (`admin/analytics/regional`, `admin/regional-analytics/subscriptions`, `admin/national/kiss`) | OPEN | named in-scope gaps in `aspnet-backend/CLAUDE.md`. Scope origin: 2026-08-21 R5 expansion |

### Family Q — Billing and premium (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.52 | Admin: billing, invoices, plans, subscriptions (`admin/billing`, `/invoices`, `admin/plans`, `/plans/subscriptions`) | OPEN | 🔴 Four Stripe integrations share one account; webhooks land on `/api/v2/webhooks/stripe`. Live-provider certification is owner decision item 5. Scope origin: 2026-08-21 R5 expansion |
| 5.53 | Admin: member premium and subscribers (`admin/member-premium`, `/subscribers`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family R — Content management (5 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.54 | Admin: author a blog post → publish → a member sees it (`admin/blog`, `/blog/create`, `/blog/edit/:id`, `admin/blog-restore`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.55 | Admin: pages and the menu builder (`admin/pages`, `/pages/builder/:id`, `admin/menus`, `/menus/builder/:id`) | OPEN | 🔴 Menu `visibility_rules` has its own vocabulary — read it before implementing. Scope origin: 2026-08-21 R5 expansion |
| 5.56 | Admin: landing page and SEO — audit, prerender, redirects (`admin/landing-page`, `admin/seo`, `/seo/audit`, `/seo/prerender`, `/seo/redirects`) | OPEN | 🔴 SEO here is **prerender, not SSR** — that architecture is settled; do not reopen it. Scope origin: 2026-08-21 R5 expansion |
| 5.57 | Admin: legal documents — version, publish, and the acceptance gate enforces it (`admin/legal-documents/*`) | OPEN | 🔴 The legal acceptance gate is **enforced by default** and **fails open** on infrastructure errors. Production has 5 enforceable documents; local has zero, so a local pass proves nothing about the gate. Scope origin: 2026-08-21 R5 expansion |
| 5.58 | Admin: resources and help/FAQ authoring (`admin/resources/*`, `admin/help`, `/help/faqs`) | OPEN | 🔴 `/help` FAQs were flat where both frontends read grouped and every FAQ silently vanished (fixed `abf4329f0`, member arm is row 2.20). Scope origin: 2026-08-21 R5 expansion |

### Family S — Gamification administration (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.59 | Admin: create a custom badge and award it (`admin/custom-badges`, `/custom-badges/create`, `admin/gamification/badge-config`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.60 | Admin: nexus-score analytics (`admin/nexus-score/analytics`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.61 | Admin: regional points and group ranking (`admin/regional-points`, `admin/group-ranking`, `admin/groups/ranking`) | OPEN | Scope origin: 2026-08-21 R5 expansion |

### Family T — Platform provisioning and identity (3 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.62 | Admin: provisioning requests — approve a new community (`admin/provisioning-requests`, `admin/platform/pilot-inquiries`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.63 | Admin: residency verifications (`admin/residency-verifications`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.64 | Admin: tenant SSO / OIDC provider administration and the public callback (`admin/sso`) | OPEN | ASP.NET has signed durable state, browser and server PKCE, nonce/JWKS validation and one-time callback grants; **live IdP and browser proof remain certification gaps**, and a general green suite does not substitute. Scope origin: 2026-08-21 R5 expansion |

### Family U — Taxonomy (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.65 | Admin: group types and categories CRUD (`admin/group-types`, `admin/groups/types`, `admin/categories/*`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.66 | Admin: attributes and geocoding groups/locations (`admin/attributes`, `admin/geocode-groups`, `admin/group-locations`) | OPEN | 🔴 Maps default **off** for multi-tenant, and Google Places can return 403 on a misconfigured key. Scope origin: 2026-08-21 R5 expansion |

### Family V — Operations (4 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.67 | Admin: cron jobs — list, logs, settings, and a manual run that reports honestly (`admin/cron-jobs/*`) | OPEN | 🔴 Architecture invariant: a manual scheduled-job endpoint may report success **only** after a registered equivalent job executes and its outcome is persisted. Unmapped, busy, disabled, cancelled and failed executions must fail explicitly. A skipped job under a green tick is a known measurement corruption here. Scope origin: 2026-08-21 R5 expansion |
| 5.68 | Admin: retention and data pruning (`admin/retention`) | OPEN | 🔴 `performance:prune` runs nightly at 03:15; without it the diagnostics tables grow for ever. Scope origin: 2026-08-21 R5 expansion |
| 5.69 | Admin: reports — hours, members, inactive members, municipal impact, social value (`admin/reports/*`, `admin/support-reports`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 5.70 | Admin: translation config, 404-error log, platform capabilities (`admin/translation-config`, `admin/404-errors`, `admin/platform-capabilities`) | OPEN | 🔴 The admin panel **is** translated; `AdminSidebar` uses top-level keys and `admin.json` is drift-gated. Scope origin: 2026-08-21 R5 expansion |

### Tier 5 reserves (2 rows)

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 5.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 5 journey discovered after 2026-08-21. Fill it; never grow the tier. Scope origin: 2026-08-21 R5 expansion |
| 5.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 5 journey discovered after 2026-08-21. Fill it; never grow the tier. Scope origin: 2026-08-21 R5 expansion |

## Tier 6 — Mobile App Journeys (Expo / React Native) — 34 rows (32 journeys + 2 reserve)

**Owner decision, 2026-08-21: the mobile app is in scope.** It was absent from
this ledger entirely, which meant roughly 331 distinct `/api` paths consumed by
a shipping client counted for nothing in either direction — not as work and not
as coverage. ADR-0004 already names `mobile/` as a client whose reads put a
field in scope, so its absence here was an inconsistency, not a scope boundary.

🔴 **Two things to hold in mind before scheduling this tier.**

1. **Most mobile endpoints overlap already-certified member APIs.** The mobile
   client calls the same `/api/v2` surface as `react-frontend/`, so this tier is
   expected to be far more *verification* than *implementation*. The **Phase 9
   measurement pass will quantify that overlap** — do not assume 32 rows of new
   backend work, and do not assume zero either.
2. **The overlap is not identity.** `api.get()` already unwraps the envelope in
   React but **not** in mobile; mobile schemas use `.strict()`, so an added field
   throws at **runtime** rather than failing a build; mobile ships only **7**
   locales against the platform's 11, with about 11% untranslated in de/es/fr/it/pt;
   and the Android CI gate cannot see mobile contract drift at all. A React row
   passing is evidence about React.

Two mobile-specific traps recorded so this tier does not relearn them:
`uiautomator dump` returns **zero nodes** on this app (use screenshots), and the
`className` prop is **inert** on its `SafeAreaView` — a `flex-1` child renders
**blank**. Screen *width* has never been tested: five defects appear at 360dp
and three are broken at every width. Always run the 411dp control.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 6.1 | Mobile: sign-up and email verification (`app/(auth)/register`, `/verify-email`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.2 | Mobile: sign-in with tenant select (`app/(auth)/login`, `/select-tenant`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.3 | Mobile: password reset (`app/(auth)/forgot-password`, `/reset-password`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.4 | Mobile: biometric / device unlock sign-in (`mobile/lib/security`) | OPEN | 🔴 A device workflow here needed the test `APP_KEY` and **only the successful login path failed** without it — a fault that reads exactly like a backend fault. Scope origin: 2026-08-21 R5 expansion |
| 6.5 | Mobile: legal acceptance gate on first sign-in (`app/(modals)/legal-acceptance`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.6 | Mobile: feed browse and create a post (`app/(tabs)/home`, `/create`, `quick-create`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.7 | Mobile: feed comment and reaction persist (`lib/api/comments`, `lib/api/feed`) | OPEN | 🔴 A missing `meta.cursor` once read as cosmetic and **was the whole of pagination**: the client sent `per_page` where the backend read `limit`. Check envelope keys, not just item arrays. Scope origin: 2026-08-21 R5 expansion |
| 6.8 | Mobile: listings browse and create (`lib/api/...`, `app/(modals)/new-marketplace-listing` and listing screens) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.9 | Mobile: exchanges list and detail (`app/(tabs)/exchanges`, `app/(modals)/exchange-detail`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.10 | Mobile: exchange request → accept → complete → credits move (`app/(modals)/new-exchange`, `/edit-exchange`) | OPEN | the mobile arm of the product's core transaction; Tier 1 row 1.21 is the React arm and is also open. Scope origin: 2026-08-21 R5 expansion |
| 6.11 | Mobile: events browse (`app/(tabs)/events`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.12 | Mobile: event detail, RSVP and tickets (`app/(modals)/event-detail`, `/event-tickets`, `lib/api/eventRegistration`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.13 | Mobile: event offline check-in captured and synced (`lib/eventOfflineCheckinStore`, `lib/api/eventOfflineCheckin`) | OPEN | 🔴 Depends on the signed `nqx2_` offline-checkin credential subsystem that ASP.NET does **not** have (row 1.25). This row cannot pass before that work package lands. Scope origin: 2026-08-21 R5 expansion |
| 6.14 | Mobile: message thread list and send (`app/(tabs)/messages`, `app/(modals)/thread`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.15 | Mobile: start a new conversation (`app/(modals)/new-message`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.16 | Mobile: groups browse and join (`app/(tabs)/groups`, `app/(modals)/group-detail`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.17 | Mobile: members directory and a member profile (`app/(tabs)/members`, `app/(modals)/member-profile`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.18 | Mobile: connection request → accept (`app/(modals)/connections`, `lib/api/connections`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.19 | Mobile: wallet balance and history (`app/(modals)/wallet`, `lib/api/wallet`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.20 | Mobile: wallet transfer credits | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.21 | Mobile: volunteering browse and apply (`app/(modals)/volunteering`, `/volunteering-detail`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.22 | Mobile: volunteering log hours → organiser approval → credits (`mobile/lib/volunteering`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.23 | Mobile: volunteering certificate and expense claim | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.24 | Mobile: organiser's own transaction history after a wallet top-up (`app/(modals)/volunteering-org-dashboard`) | OPEN | 🔴 **Known open defect, recorded 2026-08-21:** after a wallet top-up the organiser's own transaction history shows nothing. Deliberately filed OPEN rather than BROKEN — the defect was seen on the shipping (Laravel-backed) app, so attributing it to ASP.NET would be wrong, and it must be fixed on the Laravel side before this row can certify against anything. Credit is 0 either way. Scope origin: 2026-08-21 R5 expansion |
| 6.25 | Mobile: notifications list and push registration (`app/(modals)/notifications`, `lib/notifications`) | OPEN | 🔴 FCM is a live provider — certification needs real credentials (owner decision item 5). Scope origin: 2026-08-21 R5 expansion |
| 6.26 | Mobile: profile view and edit (`app/(tabs)/profile`, `app/(modals)/edit-profile`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.27 | Mobile: settings — change password, blocked users, data export, translation (`app/(modals)/settings*`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.28 | Mobile: deep links and native intents route to the right screen (`app/+native-intent.ts`, `deepLinkParams`, `deepLinkTabs`) | OPEN | 🔴 In-app navigation **hides** deep-link parameter faults — a two-emulator run is how these surface. Scope origin: 2026-08-21 R5 expansion |
| 6.29 | Mobile: offline behaviour and realtime sync (`lib/realtime`, `lib/storage`, `lib/updates`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.30 | Mobile: marketplace browse and order (`app/(modals)/marketplace*`, ~25 marketplace screens) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.31 | Mobile: search (`app/(tabs)/search`, `lib/api/search`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.32 | Mobile: jobs browse and apply (`app/(modals)/jobs`, `/job-detail`, `lib/api/jobs`) | OPEN | Scope origin: 2026-08-21 R5 expansion |
| 6.RESERVE-A | *(reserve — unassigned)* | OPEN | Held for a Tier 6 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |
| 6.RESERVE-B | *(reserve — unassigned)* | OPEN | Held for a Tier 6 journey discovered after 2026-08-21. Scope origin: 2026-08-21 R5 expansion |

## How An Agent Certifies One Row

Deliberately mechanical, so many agents can run this concurrently without
coordinating.

1. Read the row. Read the React page or Web UK route it names.
2. Bring up the disposable Laravel on `:8091` and ASP.NET, both with the parity
   fixtures applied. **Never** use the ordinary local Laravel database — it is a
   confidential production-derived snapshot.
3. Drive the journey through the unchanged client's own UI against **both**
   backends in the same run.
4. Diff what the client actually consumed. Apply ADR-0004: a field with no
   client reader is out of scope — record the decision, do not implement it.
5. Fix ASP.NET only. Never the frontend, never an adapter, never a
   success-shaped response over missing work.
6. Add a focused test **and** a step in the relevant smoke script.
7. Full suite green locally, then push and confirm CI.
8. Update this row, with the evidence and any lesson learned written *in the
   script where it was earned*.

For a Tier 6 row, step 3 means the mobile client on an emulator, and step 1
includes reading the screen **and** its `mobile/lib/api/*` module — the client
does not unwrap envelopes the way React does.

### Concurrency rules that prevent agents fighting each other

Learned from this repository's own collisions:

- **EF migrations serialise.** The chain is linear and
  `CompatibilityAuditEntrySchemaTests` pins its tail. Two agents adding
  migrations in parallel will conflict. Queue schema work through one agent per
  batch.
- **The smoke scripts are shared files.** Agents append steps; batch their edits
  or expect conflicts. Prefer one agent owning the smoke per batch, taking
  step definitions from the others.
- **One controller owns one verb.** Two owners of a template throw
  `AmbiguousMatchException` — a 500 whose error response drops CORS headers and
  reads to a browser as "blocked by CORS policy". Do not declare explicit
  `/api/v2` routes on controllers where the alias convention already generates
  them.
- **Commit by explicit path.** Never `git add -u` or `-A`: concurrent sessions
  and CRLF phantom modifications on `web-uk/src/routes/*.js` will be swept in.
- **A killed `dotnet test` poisons the next run.** Let it finish.
- **This ledger is a shared file too, and its row count is checked.** Edit only
  the rows you certified, in the tier you own, and correct the Summary and the
  credit arithmetic in the same commit. Never renumber someone else's tier, and
  never change a row count to make your edit balance.

## Named Owner Decisions Blocking Rows

These cannot be resolved by an agent:

1. **`data-testid` on `FeedCard`** (frontend change) — unblocks rows 1.11 and
   1.15. Small, low-risk, and the only way to anchor a feed card across a reload.
2. **The 63 uncalled do-nothing endpoints** — delete in both engines, or
   implement? ADR-0004 says delete; the owner sees the list first.
3. **The undeclared `api/sub-accounts` credit-moving API** — delete or declare.
4. **Tier 3 scope** — which extended modules must be in the .NET edition for the
   procurement claim, and which are Laravel-only for now. Now that Tier 3 is 40
   named rows rather than 20 ranges, this decision can be taken row by row, and
   a row taken out of scope becomes `N/A` with a reason — it is never deleted.
5. **Live-provider certification** (Stripe, FCM, identity providers) — needs real
   credentials against real services. Blocks rows 2.24, 3.5, 3.6, 3.9, 5.52 and
   6.25 at minimum.
6. **The ASP.NET database backup** — no successful backup since 2026-03-08 for
   the *scheduled off-server job*. A restore-tested off-server copy from
   2026-08-10 exists and the database container has been stopped since, so the
   recovery point is current; read `docs/DATABASE_BACKUP_DECISION.md` before
   repeating "there is no backup". Still infrastructure, and still the hard stop
   on any production role.
7. **Passkey / WebAuthn as a .NET work package** — rows 1.37 and 1.38 have no
   ASP.NET counterpart at all (1,994 lines of Laravel controller, zero
   `*WebAuthn*Controller.cs`), and the challenge store must be distributed, not
   process-local. This is a sized work package, not a route patch, and needs to
   be scheduled as one.
