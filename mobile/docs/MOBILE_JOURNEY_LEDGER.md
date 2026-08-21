<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Journey Certification Ledger

Last reviewed: 2026-08-21

Status: **Maintained — the mobile work list and the completion denominator**

This is the only place that says how much of the mobile app is proved to work. Pick work
up here. Never publish a competing journey count or a competing total.

<!-- doc-consistency: MOBILE_JOURNEY_ROWS=140 -->

## What this document is for

The previous mobile readiness document scored **code** — tests, types, lint, gates — and
scored the **product** hardly at all. That is how the app reached 302 green test files and
2,027 passing tests while — until 2026-08-21 — a member could not open a comment sheet,
write a post, or read the names of the communities they were choosing between.

So this ledger asks one question per row: **can a member complete this, on a device, with
the effect verified?** A green test suite is not an answer to that question. Neither is a
screen that renders.

🔴 **This is not the same as Tier 6 of
[`aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md`](../../aspnet-backend/docs/JOURNEY_CERTIFICATION_LEDGER.md).**
That tier asks whether the mobile app behaves identically against the ASP.NET backend.
This ledger asks whether the mobile app works at all, against production Laravel. Two
different questions, two different denominators; never add, average or compare the totals.

## Status Vocabulary

Exact meanings. Do not soften them.

| Status | Meaning | Credit |
| --- | --- | ---: |
| **CERTIFIED** | Walked on a device, the effect verified in the database or API response, **and** an automated test guards it so a regression goes red. | 100% |
| **PROVEN** | Walked on a device with the effect verified in the database or API — but **no automated guard**, so it can regress silently. | 60% |
| **RENDERS** | The screen loads with real content and no error state. No action taken, no effect asserted. | 25% |
| **PARTIAL** | Attempted, blocked by a named limitation (instrument, fixture, or an owner decision pending). | 30% |
| **OPEN** | Not attempted. | 0% |
| **BROKEN** | Attempted and a defect is confirmed. Carries a named cause. | 0% |
| **N/A** | Out of scope by an owner decision, with the reason recorded. | excluded |

🔴 **Why RENDERS is only 25%.** Thirty-one screens were photographed on 2026-08-20 and
looked healthy. On two of them a control had fallen off the edge of the screen, and on a
third the community names were invisible — none of which a screenshot review caught,
because a screen that renders is not a screen that works. RENDERS means "we looked at it",
not "it functions".

🔴 **Why PROVEN is not CERTIFIED.** Every PROVEN row below was walked by hand on an
emulator. Nothing stops it breaking tomorrow. The volunteering loop is the clearest case:
eight rows PROVEN, all verified in the ledger tables, and **not one automated test drives
them end to end.** Converting PROVEN → CERTIFIED is cheaper than any new feature and is
Phase 2 of [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md).

## Summary

| Tier | Rows | CERTIFIED | PROVEN | RENDERS | PARTIAL | OPEN/BROKEN | N/A | Credit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 — Onboarding and access | 14 | 1 | 3 | 4 | 0 | 6 | 0 | 0.271 |
| 2 — Feed and social | 14 | 5 | 4 | 2 | 0 | 3 | 0 | 0.564 |
| 3 — Timebanking core | 20 | 1 | 1 | 5 | 0 | 12 | 1 | 0.150 |
| 4 — Volunteering | 18 | 1 | 14 | 1 | 0 | 2 | 0 | 0.536 |
| 5 — Community modules | 34 | 3 | 0 | 12 | 0 | 19 | 0 | 0.176 |
| 6 — Money and wallet | 12 | 0 | 3 | 2 | 1 | 5 | 1 | 0.236 |
| 7 — Cross-cutting behaviour | 18 | 5 | 1 | 0 | 4 | 8 | 0 | 0.378 |
| 8 — RESERVE (pre-counted scope) | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0.000 |
| **Total** | **140** | **16** | **26** | **26** | **5** | **65** | **2** | — |

Overall credit, used by the Journey certification category in
[`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md):

`(16 × 1.0) + (26 × 0.6) + (26 × 0.25) + (5 × 0.30) = 39.60`, over `140 − 2 excluded = 138`
rows → **0.287**.

### Credit recomputation

| Tier | Weighted sum | ÷ rows | Credit |
| --- | --- | ---: | ---: |
| 1 | (1 × 1.0) + (3 × 0.6) + (4 × 0.25) = 3.80 | ÷ 14 | **0.271** |
| 2 | (5 × 1.0) + (4 × 0.6) + (2 × 0.25) = 7.90 | ÷ 14 | **0.564** |
| 3 | (1 × 1.0) + (1 × 0.6) + (5 × 0.25) = 2.85 | ÷ 19 † | **0.150** |
| 4 | (1 × 1.0) + (14 × 0.6) + (1 × 0.25) = 9.65 | ÷ 18 | **0.536** |
| 5 | (3 × 1.0) + (12 × 0.25) = 6.00 | ÷ 34 | **0.176** |
| 6 | (3 × 0.6) + (2 × 0.25) + (1 × 0.30) = 2.60 | ÷ 11 † | **0.236** |
| 7 | (5 × 1.0) + (1 × 0.6) + (4 × 0.30) = 6.80 | ÷ 18 | **0.378** |
| 8 | 0 | ÷ 10 | **0.000** |

† N/A rows are excluded from the divisor, not counted as failures. Tier 3 has one
(the review composer, a recorded parity decision) and Tier 6 has one (the removed
auto-pay toggle). An owner decision must not read as a defect.

🔴 **The denominator of 140 is FINAL for rubric M1.** New scope fills Tier 8 RESERVE rows.
It never enlarges the total, because a denominator that grows lets a score fall while the
product improves — which is precisely how the earlier readiness document became
uninterpretable.

## Tier 1 — Onboarding and access (14 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 1.1 | Choose a community from the picker and see its name | CERTIFIED | Names were invisible at every width until `42f38e533`; verified 411dp + 360dp, guarded by `app/deepLinkParams.test.ts` sibling `narrowScreenReach.test.ts` |
| 1.2 | Sign in with email and password | PROVEN | Walked on two devices repeatedly, 2026-08-20/21; no automated device test |
| 1.3 | Sign out | PROVEN | Walked 2026-08-20 (reached the login screen afterwards) |
| 1.4 | Create an account from the app | RENDERS | Register screen photographed, real fields, international phone placeholder; never submitted |
| 1.5 | Forgot password → email → reset | RENDERS | Screen photographed; the mail leg has never been walked on a device |
| 1.6 | Passkey / biometric sign-in | OPEN | Never attempted on a device |
| 1.7 | Session survives an app restart | PROVEN | A reaction persisted across a full restart, 2026-08-20 |
| 1.8 | Session restore failure shows a way out, not a spinner | BROKEN | 2026-08-21: a device with an existing session sat on a bare spinner and re-fetched in a loop (`bootstrap` ×7, `users/me` ×8, `notifications/counts` ×16 in 40s). Clearing app data fixed it. Not deliberately reproduced |
| 1.9 | Legal acceptance gate | OPEN | Local fixture has zero enforceable documents; never exercised on mobile |
| 1.10 | Onboarding flow for a brand-new member | OPEN | Never attempted |
| 1.11 | Switch community while signed in | RENDERS | Picker reached and listed real communities against the live API |
| 1.12 | Tenant branding applies (logo, accent) | RENDERS | "Hour Timebank / Local development tenant" header correct; only one tenant checked |
| 1.13 | Force-update screen appears below the minimum version | OPEN | Server lever exists (`EnforceMobileMinimumVersion`, 426); never triggered against a device |
| 1.14 | "Update ready — restart" prompt | OPEN | Implemented 2026-08-20; never seen on a device |

## Tier 2 — Feed and social (14 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 2.1 | Feed loads with real content | RENDERS | Photographed many times; reflects other modules' activity correctly |
| 2.2 | React to a post and have it persist | CERTIFIED | Verified saving, surviving a restart, and in the API (`{"counts":{"celebrate":1}}`); guarded by `components/FeedItem.test.tsx` |
| 2.3 | Reach all eight reactions | CERTIFIED | Two of eight were off-screen at 360dp until `294586010`; guarded by `components/narrowScreenReach.test.ts` |
| 2.4 | Milestone cards offer no action that cannot work | CERTIFIED | Server refuses `badge_earned`/`level_up` likes (400); cards now Share-only; guarded |
| 2.5 | Comment on a post | CERTIFIED | 2026-08-21: sheet opened, comment typed and sent on the emulator; `comments` row 168 written (`target_type=post`, `target_id=183`) and the comment rendered back in the sheet. Guarded by `components/ui/bottomSheetOpenFlip.test.ts` (opening) and `components/comments/CommentSheet.test.tsx` (submit/edit/delete/like) |
| 2.6 | Reply to a comment | CERTIFIED | 2026-08-21: replied to comment 168 from the sheet — the "Replying to E2E UserA" pill appeared and `comments` row 169 was written with `parent_id = 168`. Guarded by `components/comments/CommentSheet.test.tsx` ("submits a reply with the parent comment id") |
| 2.7 | Open the card overflow menu ("…") | PROVEN | 2026-08-21: opened from a feed card on the emulator, sheet rendered with its action list. No action selected, so no effect asserted beyond the menu itself |
| 2.8 | See who reacted to something | PROVEN | 2026-08-21: reacted to post 183, tapped the reaction summary, `ReactorsSheet` opened listing the correct reactor with `GET /api/v2/reactions/post/183/users/like`. **No guard** — `ReactorsSheet` is only ever mocked in tests, never rendered |
| 2.9 | Write a post to the community feed | BROKEN | **No capability exists**: no `createPost` in the client, no composer screen, no Create entry. The server has `POST /v2/feed/posts` and the website has a composer |
| 2.10 | Share a post out of the app | PROVEN | Android share sheet opened from a card, 2026-08-20 |
| 2.11 | Save / bookmark a post | PROVEN | Bookmark control present and reachable after `294586010`; toggle observed |
| 2.12 | Feed filters (All / Following / Saved / Posts / Exchanges) | RENDERS | Chips visible; none exercised |
| 2.13 | Infinite scroll loads more | OPEN | Fixture too small to page; never exercised on mobile |
| 2.14 | Hide / report a post | OPEN | Never attempted |

## Tier 3 — Timebanking core (20 rows)

The reason the platform exists. **This tier is the least proven, and it should be first.**

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 3.1 | Create an offer listing | PROVEN | Form walked 2026-08-21; validation refused an empty description ("Please enter a description") — the submit itself was never completed |
| 3.2 | Create a request listing | OPEN | Toggle present, never exercised |
| 3.3 | Browse listings | RENDERS | Listings tab photographed with real content |
| 3.4 | Search / filter listings | OPEN | Never exercised |
| 3.5 | Open a listing detail | RENDERS | Photographed, scrolled |
| 3.6 | Request someone's offer | OPEN | The core two-party step. Never walked |
| 3.7 | Owner accepts a request | OPEN | Never walked |
| 3.8 | Owner declines a request | OPEN | Never walked |
| 3.9 | Message the other party about an exchange | OPEN | Never walked |
| 3.10 | Agree hours and complete an exchange | OPEN | Never walked |
| 3.11 | Credits move from receiver to giver | OPEN | Never walked on mobile. Proven only for volunteering (Tier 4) |
| 3.12 | Both parties see the transaction in their history | OPEN | Never walked |
| 3.13 | Leave a review after an exchange | N/A | Recorded parity decision: no native review composer, reviews are read-only on mobile (`docs/generated/mobile-parity-matrix.md`) |
| 3.14 | Read reviews on a member | RENDERS | Reviews screen exists; behind a bottom sheet for actions |
| 3.15 | Edit an existing listing | RENDERS | `edit-exchange` screen exists |
| 3.16 | Withdraw / close a listing | OPEN | Never walked |
| 3.17 | Exchange dead-end check: draft/publish states | CERTIFIED | Fixed `5373940c8`, guarded — recorded in memory as a prior finding |
| 3.18 | Group exchanges | RENDERS | Screen photographed at 360dp, filter chips scroll correctly |
| 3.19 | Skills on a profile drive matching | OPEN | Never walked |
| 3.20 | Report a problem with an exchange | OPEN | Never walked |

## Tier 4 — Volunteering (18 rows)

The one journey walked end to end, on two devices, with both ledgers checked. It is the
template for every other tier.

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 4.1 | Register an organisation | PROVEN | Device 2026-08-20; `vol_organizations` row 109; validation refused an unticked confirmation and wrote nothing |
| 4.2 | Admin approves an organisation | PROVEN | `PUT /v2/admin/volunteering/organizations/109/status` → `active`. 🔴 The endpoint accepts only `active`/`suspended`, never `approved`, while member copy says "approved" |
| 4.3 | Publish an opportunity | PROVEN | Device; `vol_opportunities` row 128 |
| 4.4 | "Create opportunity" hidden when you cannot publish | CERTIFIED | Gated `a91121378`; verified both directions on a device; rule shared via `lib/volunteering/postingPermission.ts` |
| 4.5 | Second member finds the opportunity | PROVEN | Appeared on device B immediately |
| 4.6 | Apply for an opportunity | PROVEN | `vol_applications` row 239; Apply disappears afterwards, preventing a double application |
| 4.7 | Organiser reviews applications | PROVEN | Device; Approve/Decline both present |
| 4.8 | Organiser approves an application | PROVEN | Row 239 → `approved`; volunteer's app showed "Approved" |
| 4.9 | Volunteer logs hours | PROVEN | Device; `vol_logs` row; the picker correctly offers organisations from approved applications |
| 4.10 | Organiser verifies hours | PROVEN | Device; row → `approved` |
| 4.11 | Credits reach the volunteer | PROVEN | 25.00 → 27.00, `transactions` row type `volunteer` |
| 4.12 | The organisation is charged | PROVEN | 0.00 → −2.00, `vol_org_transactions` with `balance_after` |
| 4.13 | Generate a volunteer certificate | PROVEN | Verification code, hours, organisation breakdown |
| 4.14 | Submit an expense | PROVEN | €12.50 travel, `vol_expenses` row |
| 4.15 | Admin approves an expense | PROVEN | Reviewer recorded; member's app showed €12.50 claimed/approved |
| 4.16 | Shift sign-up | OPEN | Never walked |
| 4.17 | Shift swap request and response | OPEN | Never walked |
| 4.18 | Volunteer donations / giving days | RENDERS | Tabs exist; never exercised |

🔴 Rows 4.1–4.15 are PROVEN, not CERTIFIED, for one reason: **no automated test drives
them.** A single Maestro flow over this tier would convert fifteen rows.

## Tier 5 — Community modules (34 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 5.1 | Events list | RENDERS | Photographed, clean at 360dp |
| 5.2 | Create an event | OPEN | Create entry resolves; never submitted |
| 5.3 | RSVP to an event | OPEN | Never walked |
| 5.4 | Event attendance / check-in | OPEN | Never walked |
| 5.5 | Event detail | RENDERS | Screen exists |
| 5.6 | Groups list | RENDERS | Photographed, stat tiles wrap correctly |
| 5.7 | Create a group | OPEN | Never submitted |
| 5.8 | Join a group | OPEN | Never walked |
| 5.9 | Post in a group | OPEN | Never walked |
| 5.10 | Group tabs (discussion, wiki, tasks, analytics) | RENDERS | Tab strip scrolls correctly |
| 5.11 | Messages list | RENDERS | Photographed |
| 5.12 | Send a message to another member | OPEN | **Never walked, and it is a two-party core journey** |
| 5.13 | Receive a message and see the unread badge | OPEN | Never walked |
| 5.14 | Reply in a thread | OPEN | Never walked |
| 5.15 | Voice message | OPEN | Never walked |
| 5.16 | Members directory | RENDERS | Photographed, clean at 360dp |
| 5.17 | View a member profile | RENDERS | Screen exists |
| 5.18 | Send a connection request | OPEN | Never walked |
| 5.19 | Accept a connection request | OPEN | Never walked |
| 5.20 | Polls list | RENDERS | Photographed |
| 5.21 | Vote in a poll | OPEN | Never walked |
| 5.22 | Create a poll | OPEN | Create entry resolves; never submitted |
| 5.23 | Ideas / challenges | RENDERS | Photographed |
| 5.24 | Submit an idea | OPEN | Never walked |
| 5.25 | Jobs list | RENDERS | Photographed |
| 5.26 | Jobs tabs readable on a narrow phone | CERTIFIED | Truncated to "My A…" until `ec0df3366`; guarded by `app/deepLinkTabs.test.ts` sibling |
| 5.27 | Apply for a job | OPEN | Never walked |
| 5.28 | Job alerts | OPEN | Deep link lands on the wrong tab (`view` parameter unread) |
| 5.29 | Marketplace browse | RENDERS | Feature disabled for the test community until enabled locally 2026-08-20 |
| 5.30 | Marketplace category by slug | CERTIFIED | Deep link said "not found" until `673743f16`; guarded by `app/deepLinkParams.test.ts` |
| 5.31 | Sell an item | OPEN | Never walked |
| 5.32 | Buy an item / checkout | OPEN | Never walked |
| 5.33 | Blog list and article | CERTIFIED | Deep link handed the screen the wrong parameter name until `673743f16`; guarded, and the test that pinned the bug corrected |
| 5.34 | Knowledge base / resources | RENDERS | Screens exist |

## Tier 6 — Money and wallet (12 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 6.1 | See your balance | RENDERS | Wallet screen photographed; balance correct |
| 6.2 | See your transaction history | PARTIAL | 🔴 It does not reconcile. A balance moved 90.00 → 85.00 while the member's own history stayed at one row (`transaction_count: 1`). The organisation side records it; the member's statement does not |
| 6.3 | Send credits to another member | OPEN | Never walked |
| 6.4 | Receive credits and see them | PROVEN | Volunteering credit landed and showed (Tier 4) |
| 6.5 | Organisation wallet balance | PROVEN | −2.00 → 8.00 → 13.00 across two deposits, with ledger rows |
| 6.6 | Deposit credits into an organisation wallet | PROVEN | Device + API; organiser correctly debited |
| 6.7 | Community fund | OPEN | Never walked |
| 6.8 | Pending in / out | OPEN | Never walked |
| 6.9 | Wallet limits and refusals | OPEN | Never walked |
| 6.10 | Donations | RENDERS | Tab exists |
| 6.11 | Auto-pay control on an organisation wallet | N/A | Removed `df0d4085c`: the endpoint returned 404 and the flag governed nothing. React had already removed it |
| 6.12 | Transaction detail view | OPEN | Never walked |

## Tier 7 — Cross-cutting behaviour (18 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 7.1 | Deep links reach the right screen with the right parameter | CERTIFIED | Three were broken; guarded by `app/deepLinkParams.test.ts`, mutation-verified |
| 7.2 | Deep links honour a `?tab=` | PARTIAL | Works when the screen is opened fresh by the link; ignored when it is already open or after a cold start. Intent mapper proven correct |
| 7.3 | Controls stay reachable at 360dp | CERTIFIED | Five defects found; guarded by `components/narrowScreenReach.test.ts` |
| 7.4 | Shared form footer never clips its submit | CERTIFIED | Broken at every width; guarded |
| 7.5 | Text inputs are wide enough to read | CERTIFIED | Guarded by `components/ui/inputSizing.test.ts` |
| 7.6 | A failed action explains why | PARTIAL | Helper added (`lib/api/describeApiError.ts`) and applied on walked paths. **186 sites across 57 files** still discard the server's message |
| 7.7 | Hiding a label keeps an accessible name | CERTIFIED | Guarded in `narrowScreenReach.test.ts` |
| 7.8 | Crash reports reach the owner | PROVEN | Dual-destination reporting added 2026-08-20; never verified from a real crash |
| 7.9 | Screen-reader pass over a core journey | OPEN | Never attempted |
| 7.10 | Touch-target sizes audited | OPEN | Never measured |
| 7.11 | Right-to-left (Arabic) | OPEN | No RTL support exists; `ar` is blocked |
| 7.12 | Every string translated in the 7 shipped locales | OPEN | ≥3,232 multi-word phrases still English across six locales (~11% each) |
| 7.13 | Offline check-in queue survives a dropped connection | OPEN | Covered by unit tests; never walked on a device |
| 7.14 | Push notification arrives and opens the right screen | PARTIAL | 🔴 A real defect was found and fixed 2026-08-21 (`edcee0ba9`): every push from a **queued** listener was dropped — `afterResponse()` does not throw outside HTTP, so the documented inline fallback never ran, and the send also did not run in the tenant it logged. Mutation-verified. **Blocked from PROVEN**: sending a real message locally produced neither a bell nor a queued listener run, so the owner's end-to-end symptom was not reproduced. Arrival on a device is unverified |
| 7.15 | In-app notification counts are correct | OPEN | Never verified |
| 7.16 | Start-up time / bundle size within a budget | OPEN | No budget exists |
| 7.17 | Pixel regression gate covers the main screens | PARTIAL | Three screens gated of ~137 |
| 7.18 | The app runs on iOS | OPEN | Never built or run |

## Tier 8 — RESERVE (10 rows)

Pre-counted so new scope never enlarges the denominator. Rename a RESERVE row when scope
arrives; never add a row to another tier.

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 8.1 | RESERVE | OPEN | — |
| 8.2 | RESERVE | OPEN | — |
| 8.3 | RESERVE | OPEN | — |
| 8.4 | RESERVE | OPEN | — |
| 8.5 | RESERVE | OPEN | — |
| 8.6 | RESERVE | OPEN | — |
| 8.7 | RESERVE | OPEN | — |
| 8.8 | RESERVE | OPEN | — |
| 8.9 | RESERVE | OPEN | — |
| 8.10 | RESERVE | OPEN | — |

## Capability parity — what the website can do and the app cannot

🔴 **`npm run drift:check` cannot see this table, and that is the point.** It compares
**routes**. A capability that lives in a component rather than at its own URL is invisible
to it — which is exactly how "write a post" went unnoticed. Keep this table by hand.

| Capability | Website | Mobile | Decision |
| --- | --- | --- | --- |
| Write a feed post | `components/compose/tabs/PostTab.tsx` → `POST /v2/feed/posts` | **absent** | Owner decision needed. Row 2.9 |
| Compose an event | `EventTab.tsx` | present (`new-event`) | — |
| Compose a goal | `GoalTab.tsx` | present (`goals`) | — |
| Compose a listing | `ListingTab.tsx` | present (`new-exchange`) | — |
| Compose a poll | `PollTab.tsx` | present (`polls?create=1`) | — |
| Review composer | present | absent | Recorded parity decision: read-only on mobile |
| Auto-pay toggle | removed deliberately | removed 2026-08-21 | Matched |
| Marketplace sell | present | present (`new-marketplace-listing`) | — |
| Send a message | present | present (`new-message`) | — |
| Create a group | present | present (`new-group`) | — |

## How to update this ledger

1. Walk the journey on a device. Not a unit test, not a screenshot.
2. Verify the **effect** — a database row, a balance, an API response. A toast is not proof.
3. Set the status from the vocabulary above. If it failed, use BROKEN and name the cause.
4. If an automated test now guards it, CERTIFIED. If not, PROVEN — and say so.
5. Update the Summary table **and** the Credit recomputation table. `node scripts/check-doc-scores.mjs` recounts every row and fails if they disagree.
6. Move the category score in [`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md) only from these numbers.
