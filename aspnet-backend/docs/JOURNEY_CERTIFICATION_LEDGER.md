# Journey Certification Ledger

Last verified: 2026-08-21 (evidence: monorepo `869a2a030`, platform-contracts
run at that SHA all green)

Status: **Canonical current - the finite denominator for ASP.NET completion**

<!-- doc-consistency: ASPNET_JOURNEY_ROWS=130 -->

This ledger is the denominator for "is the ASP.NET edition finished?". It exists
because the previous denominator — roughly 2,650 API endpoints — is not a
delivery plan. It cannot be scheduled, cannot be parallelised, and gets *bigger*
the more carefully you look at it. A journey list is finite, each row is
independently certifiable by one agent, and the list only shrinks.

Authority: [`ADR-0004`](decisions/ADR-0004-journey-equivalence-is-the-target.md)
defines what certification means. [`ADR-0003`](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)
defines why the work is committed. The score derived from this ledger lives in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) — do not
publish a competing total here.

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
and asserts effects — but it does **not** run the same steps against Laravel in
the same execution. So when a step fails, we cannot immediately tell an ASP.NET
defect from a fixture difference, and when it passes we have not proved the two
engines agree. The web-uk instrument (`scripts/smoke-webuk-against-aspnet.mjs`)
*does* run a Laravel control, which is why its weaker evidence is more
trustworthy per row.

**Adding a Laravel control arm to the React smoke is the single highest-value
next change in this whole workstream.** It converts ~20 rows from PROVEN to
CERTIFIED, is a test-harness change with no product risk, and every subsequent
journey inherits it. It is item 1 in the queue for that reason.

## Summary

| Tier | Rows | CERTIFIED | PROVEN | RENDERS | PARTIAL | OPEN/BROKEN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 — Core member journeys (React) | 35 | 0 | 20 | 0 | 2 | 13 |
| 2 — Community module journeys (React) | 20 | 0 | 1 | 7 | 0 | 12 |
| 3 — Extended module journeys (React) | 20 | 0 | 0 | 2 | 0 | 18 |
| 4 — Member journeys (Web UK accessible) | 30 | 0 | 1 | 20 | 0 | 9 |
| 5 — Staff journeys (admin / super-admin / broker) | 25 | 0 | 0 | 1 | 0 | 24 |
| **Total** | **130** | **0** | **22** | **30** | **2** | **76** |

Category credit, computed from the rows above and used verbatim by the score:
Tier 1 = (20x0.6 + 2x0.3) / 35 = 0.360. Tiers 2+3 combined = (1x0.6 + 9x0.25) / 40
= 0.071. Tier 4 = (1x0.6 + 20x0.25) / 30 = 0.187. Tier 5 = (1x0.25) / 25 = 0.010.

Row counts are fixed by this document. A newly discovered journey is added as a
new row with a note, and the totals above are corrected in the same commit — it
is never absorbed silently into an existing row.

## Tier 1 — Core Member Journeys (React) — 35 rows

The journeys without which the product is unusable. These are the procurement
demo.

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
| 1.21 | Exchange: request → accept → complete → credits move | OPEN | **highest-value open core row** — this is the product's core transaction |
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
| 1.34 | Settings: edit a field and save it | PARTIAL→OPEN | the 14-field edit surface opens; **no save is asserted**. There is no Edit control on the profile page; editing lives in Settings |
| 1.35 | Settings: theme persists across reload | PROVEN | smoke `journey-settings-theme`; proves `PUT /users/me/theme` end to end |

Also PROVEN in Tier 1 and folded into rows above: notifications list +
mark-all-read (smoke `journey-notifications`), cookie-consent save (was a
500 disguised as a CORS error until `c108c90c4`).

## Tier 2 — Community Module Journeys (React) — 20 rows

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

## Tier 3 — Extended Module Journeys (React) — 20 rows

Entirely unproven except where noted. Several are commercially optional for a
public-sector buyer and are candidates for an explicit scope decision.

| # | Journey | Status |
| ---: | --- | --- |
| 3.1–3.4 | Marketplace: browse, sell, order, pickup/scan | OPEN ×4 |
| 3.5–3.7 | Jobs: browse, apply, employer pipeline | OPEN ×3 |
| 3.8–3.9 | Courses: learn, instruct/grade | OPEN ×2 |
| 3.10 | Podcasts: listen / studio | OPEN |
| 3.11 | Ideation: submit and campaign | OPEN |
| 3.12 | Clubs / Verein: dues and invitations | OPEN |
| 3.13–3.14 | Venues: pass, check-in | OPEN ×2 |
| 3.15 | Donations: receipt | OPEN |
| 3.16 | Coupons | OPEN |
| 3.17 | Premium: subscribe / manage | OPEN |
| 3.18 | Caring Community: request help, relationships, safeguarding report | OPEN |
| 3.19 | Federation: partners, members, cross-tenant listings | RENDERS (blog/resources arm only) |
| 3.20 | AI chat | RENDERS |

## Tier 4 — Member Journeys, Web UK Accessible Frontend — 30 rows

This is the accessible frontend serving three live hostnames. Its instrument
**does** run a Laravel control, so its evidence is comparatively trustworthy.

| # | Journey | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| 4.1 | Sign-in (scripted double-CSRF at HTTP layer) | PROVEN | both logins succeed; `tenant_slug` is a **required form field**; the login GET sets `nexus.csrf` twice and the page token pairs with the **last** |
| 4.2–4.13 | Signed-out pages render vs Laravel control (12) | RENDERS ×12 | 11/12 + 1 diagnosed fixture asymmetry (master-tenant exclusion in `TenantBootstrapController::list`) |
| 4.14–4.21 | Signed-in member pages render vs control (8) | RENDERS ×8 | `/dashboard /listings /events /feed /groups /volunteering /explore /kb` — same statuses, no error pages |
| 4.22–4.30 | **Any form submission through Web UK** (9 journeys: post, create listing, RSVP, message, transfer, apply, join, review, settings) | OPEN ×9 | the instrument compares page *pairs*; it submits nothing |

Rows 4.2–4.21 assert **renders**, not byte-identity, deliberately: the two
fixtures hold different data volumes, so structural equality would report
fixture asymmetry as a fault on every run.

## Tier 5 — Staff Journeys — 25 rows

The largest untouched surface, and where the do-nothing endpoints concentrate.
**Public-sector buyers evaluate the admin panel**, so this tier is not optional
for the commercial goal even though no member ever sees it.

| # | Journey | Status |
| ---: | --- | --- |
| 5.1 | Admin: sign in and land on the admin dashboard | RENDERS (unverified depth) |
| 5.2–5.6 | Admin: members list, view, suspend, role change, tenant move | OPEN ×5 |
| 5.7–5.9 | Admin: listings moderation, events admin, groups admin | OPEN ×3 |
| 5.10–5.11 | Admin: safeguarding reports queue, action log | OPEN ×2 |
| 5.12–5.13 | Admin: credits/wallet adjustments, transaction audit | OPEN ×2 |
| 5.14–5.16 | Admin: tenant settings, module gates, branding | OPEN ×3 |
| 5.17–5.18 | Admin: performance dashboard, metrics | OPEN ×2 |
| 5.19–5.21 | Super-admin: tenant CRUD, subtree confinement, user move | OPEN ×3 |
| 5.22–5.24 | Broker: exchange list, dispute resolve, reverse | OPEN ×3 |
| 5.25 | Admin: email/notification send and log | OPEN |

243 admin GET endpoints have never been compared. That is one measurement task,
not 243 — a generated corpus plus the Laravel control answers most of this tier
in a single pass, and should be run **before** implementing anything in it.

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

## Named Owner Decisions Blocking Rows

These cannot be resolved by an agent:

1. **`data-testid` on `FeedCard`** (frontend change) — unblocks rows 1.11 and
   1.15. Small, low-risk, and the only way to anchor a feed card across a reload.
2. **The 63 uncalled do-nothing endpoints** — delete in both engines, or
   implement? ADR-0004 says delete; the owner sees the list first.
3. **The undeclared `api/sub-accounts` credit-moving API** — delete or declare.
4. **Tier 3 scope** — which extended modules must be in the .NET edition for the
   procurement claim, and which are Laravel-only for now.
5. **Live-provider certification** (Stripe, FCM, identity providers) — needs real
   credentials against real services.
6. **The ASP.NET database backup** — no successful backup since 2026-03-08.
   Infrastructure, and the hard stop on any production role.
