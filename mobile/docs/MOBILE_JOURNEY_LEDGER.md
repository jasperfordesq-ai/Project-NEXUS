<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Journey Certification Ledger

Last reviewed: 2026-08-23

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
| 1 — Onboarding and access | 14 | 6 | 3 | 3 | 0 | 2 | 0 | 0.611 |
| 2 — Feed and social | 14 | 6 | 4 | 2 | 0 | 2 | 0 | 0.636 |
| 3 — Timebanking core | 20 | 6 | 6 | 5 | 0 | 2 | 1 | 0.571 |
| 4 — Volunteering | 18 | 2 | 14 | 1 | 1 | 0 | 0 | 0.608 |
| 5 — Community modules | 34 | 17 | 6 | 11 | 0 | 0 | 0 | 0.687 |
| 6 — Money and wallet | 12 | 0 | 7 | 2 | 1 | 1 | 1 | 0.455 |
| 7 — Cross-cutting behaviour | 18 | 6 | 1 | 0 | 4 | 7 | 0 | 0.433 |
| 8 — RESERVE (pre-counted scope) | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0.000 |
| **Total** | **140** | **43** | **41** | **24** | **6** | **24** | **2** | — |

Overall credit, used by the Journey certification category in
[`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md):

`(43 × 1.0) + (41 × 0.6) + (24 × 0.25) + (6 × 0.30) = 75.40`, over `140 − 2 excluded = 138`
rows → **0.546**.

### Credit recomputation

| Tier | Weighted sum | ÷ rows | Credit |
| --- | --- | ---: | ---: |
| 1 | (6 × 1.0) + (3 × 0.6) + (3 × 0.25) = 8.55 | ÷ 14 | **0.611** |
| 2 | (6 × 1.0) + (4 × 0.6) + (2 × 0.25) = 8.90 | ÷ 14 | **0.636** |
| 3 | (6 × 1.0) + (6 × 0.6) + (5 × 0.25) = 10.85 | ÷ 19 † | **0.571** |
| 4 | (2 × 1.0) + (14 × 0.6) + (1 × 0.25) + (1 × 0.30) = 10.95 | ÷ 18 | **0.608** |
| 5 | (17 × 1.0) + (6 × 0.6) + (11 × 0.25) = 23.35 | ÷ 34 | **0.687** |
| 6 | (7 × 0.6) + (2 × 0.25) + (1 × 0.30) = 5.00 | ÷ 11 † | **0.455** |
| 7 | (6 × 1.0) + (1 × 0.6) + (4 × 0.30) = 7.80 | ÷ 18 | **0.433** |
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
| 1.5 | Forgot password → email → reset | CERTIFIED | Walked 2026-08-22, both halves. Request: the screen validates, the API resolves the member in the right tenant, and the confirmation is deliberately non-committal ("If an account exists…") so it cannot be used to enumerate addresses. Reset: the deep link to the reset screen carried the token through, the new password was accepted, and the token was consumed — the row was gone afterwards, so it is single-use. Verified by API: the new password signs in and the old one is refused. The fixture password was then restored. 🔴 **The mail leg cannot complete locally and that is correct behaviour, not a defect**: the token is stored ONLY after the dispatcher accepts the email, deliberately, so a mail outage leaves any previous valid link usable instead of silently invalidating it. With no SMTP in the container the send returns false, no token is written, and a WARNING is logged (`[PasswordReset] reset email send returned false`) — the log level is `warning` on purpose because production runs at that level. To walk the mail leg for real, point the container at a mail catcher; to walk the reset screen without one, insert a `password_resets` row whose stored token column holds the SHA-256 of a plaintext you keep, then open the reset deep link carrying that plaintext |
| 1.6 | Passkey / biometric sign-in | BROKEN | **No capability exists.** Checked 2026-08-22: not one file under `mobile/` mentions passkey, WebAuthn or credentials, and `package.json` carries no library for it. The previous status said "never attempted on a device", which implied the feature was there and merely untested — it is not there at all. The website has it (`react-frontend/src/lib/webauthn.ts`, `components/security/BiometricSettings.tsx`) and the server has the endpoints, so this is a capability gap between the two frontends rather than a missing platform feature. Note the emulator could host it: this AVD carries Play Services, so a platform authenticator is available to test against. **Owner decision — not started** |
| 1.7 | Session survives an app restart | PROVEN | A reaction persisted across a full restart, 2026-08-20 |
| 1.8 | Session restore failure shows a way out, not a spinner | CERTIFIED | Reproduced deliberately 2026-08-22 by deleting the member's 377 `refresh_token_sessions` rows and launching: the app lands on the sign-in screen with "Signed out — Your session has expired. Please log in again.", and the request log shows one attempt plus one retry, not the 7-16 request loop recorded in August. 🔴 The BROKEN status predated the session-expiry rewrite; the fix had landed and nobody had checked it. Both refresh outcomes are unit-tested — `rejected` for 401/403 only, `unreachable` for 500/502/503/429, a throw, and a 200 carrying no token — so a bad connection cannot sign a member out or purge the offline check-in queue |
| 1.9 | Legal acceptance gate | CERTIFIED | Walked 2026-08-22 by deleting the member's acceptance row and attempting a write. 🔴 The gate is attached PER WRITE ROUTE, never to a group (`bootstrap/app.php`), so landing on the feed unblocked is correct — reading is allowed, writing is refused. Sending a message produced the acceptance screen with the document, its version, a link to read it in full, and "Sign out instead"; accepting recorded `user_legal_acceptances` for user 674 with user-agent `okhttp/4.12.0` — the first acceptance on this fixture that came from a device rather than a script — and the typed message survived. One defect fixed: the refusal ALSO raised "Message failed to send. Tap to retry.", so the member got the screen explaining it and a red technical failure on top, inviting a retry that cannot work until they accept. 🔴 Recorded, not fixed: `acceptance_method` is stored as `login_prompt` even when the prompt came from a write refusal mid-session, so the legal audit trail names the wrong trigger |
| 1.10 | Onboarding flow for a brand-new member | CERTIFIED | Walked 2026-08-22: registration form filled on a device, `users` row 900019 created in tenant 2 as `pending`, unapproved and unverified — then deleted. Three real defects found, all fixed. 🔴 **The account was created and the app said "Request timed out. Please check your connection."** — registration does an MX lookup and a breach-database check before answering, and the ordinary 15s mutation timeout fired on a request the server completed. Registration now has its own 45s timeout, and a no-answer no longer claims failure: it says the account may already exist and to try signing in. The error banner also renders at the TOP of a form taller than the screen, so a member at the bottom saw nothing at all; it now scrolls into view. Guarded by three tests in `app/(auth)/register.test.tsx` and one in `lib/api/auth.test.ts`, all mutation-verified. 🔴 A `.local` email address cannot register — the MX check refuses it, which is why every fixture account was seeded directly |
| 1.11 | Switch community while signed in | RENDERS | Picker reached and listed real communities against the live API |
| 1.12 | Tenant branding applies (logo, accent) | RENDERS | "Hour Timebank / Local development tenant" header correct; only one tenant checked |
| 1.13 | Force-update screen appears below the minimum version | CERTIFIED | **Fired for the first time, 2026-08-22.** The server floor was raised to 1.3.0 in local config, the API refused the 1.2.0 build with 426, and the app replaced itself with the blocking screen — "Time to update", the server's own download link, and no dismiss, back or skip. Floor restored afterwards and the app confirmed unblocked. 🔴 One real defect found by firing it: the footer read **"Latest version 1.2.0 · you have 1.2.0"** on a screen refusing to let the member continue — a sentence that tells them the block is a bug and leaves them nothing to do. The server was not wrong (`current_version` is the newest build that exists, and no 1.3.0 existed), but a screen this final must not present a contradiction whatever it is told: it now shows the version actually required, and says nothing at all when neither number is ahead. Three tests added, mutation-verified |
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
| 2.14 | Hide / report a post | CERTIFIED | 🔴 **No capability existed.** The card's "…" menu offered Share, Save and View post; the app called none of the server's four moderation endpoints, while the website has had hide, not-interested and mute since the V2 feed. Built 2026-08-22 (`lib/api/feedModeration.ts`) and walked: `reports` row 9 (post 183, `safety_concern`, open) and `feed_hidden` row 10. Guarded by `lib/api/feedModeration.test.ts` and four card-level tests, all mutation-verified |

## Tier 3 — Timebanking core (20 rows)

The reason the platform exists. It was the least proven tier until 2026-08-21, when the core
chain — request → accept → start → complete → both confirm → credits move → both see it —
was walked across two emulators and verified in the database.

🔴 **Half of that chain did not exist in the app and had to be built.** `lib/api/exchanges.ts`
called three of the server's twelve exchange endpoints (`config`, `check`, `store`), so a
member could send a request and then nothing: no accept, no decline, no start, no complete,
no confirm, no list of your exchanges, no detail screen. What remains open here is now
genuinely unwalked rather than unbuilt.

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 3.1 | Create an offer listing | PROVEN | Form walked 2026-08-21; validation refused an empty description ("Please enter a description") — the submit itself was never completed |
| 3.2 | Create a request listing | PROVEN | 2026-08-22: posted from the device — `listings` row 529, `type = request`, active. The Offer/Request toggle changes the submit button to "Post request", and a missing category was refused inline with "Please choose a category." 🔴 After a successful post the form used to STAY OPEN (no confirmation, duplicate-post trap); fixed in the same session |
| 3.3 | Browse listings | RENDERS | Listings tab photographed with real content |
| 3.4 | Search / filter listings | CERTIFIED | Walked 2026-08-22. Text search narrowed 3 results to 1 ("Shelves"), and the Offer tab narrowed to the 2 offers — verified in the API access log as `GET /v2/listings?personalised=true&type=offer`, and against the endpoint directly (3 / 2 / 1 for none / offer / request). 🔴 I first recorded the type tabs as broken; that was a screenshot taken before the filtered response arrived plus a mis-aimed tap. Guarded by a new case in `app/(tabs)/exchanges.test.tsx` |
| 3.5 | Open a listing detail | RENDERS | Photographed, scrolled |
| 3.6 | Request someone's offer | PROVEN | 2026-08-21: requested listing 513 from the second emulator as UserB — `exchange_requests` row 61 written (`pending_provider`, 1.00 proposed hours). 🔴 The button reads "Request this service" and opens a MESSAGE thread until the community switches the exchange workflow on; see the harness note |
| 3.7 | Owner accepts a request | CERTIFIED | 2026-08-21: accepted on the provider's device, status → `accepted`. Required BUILDING the screen — no client function for accept existed. Guarded by `app/(modals)/exchange-request-detail.test.tsx` (including that a requester is never offered Accept, which the server 403s) |
| 3.8 | Owner declines a request | PROVEN | 2026-08-22: declined request 62 on the provider's device — status → `cancelled` (the server has no separate `declined` state) with `exchange_history` recording provider/status_changed. The requester's note was shown on the card before deciding |
| 3.9 | Message the other party about an exchange | CERTIFIED | 2026-08-22: **the capability did not exist.** The exchange screen showed status, hours, confirmations and history and offered no route to the person on the other side of it. Added, matching the website (`ExchangeDetailPage.tsx`): a "Message {name}" button shown only while the exchange is live, since once it is finished there is nothing to arrange. Walked on a device — it opened the existing 6-message conversation with the right member and `messages` row 547 was sent from it. The check used a local fixture row temporarily set to `accepted` and restored to `cancelled` afterwards |
| 3.10 | Agree hours and complete an exchange | CERTIFIED | 2026-08-21: start → mark as done → both parties confirmed 1.00 hour from their own emulators; `exchange_history` records the whole chain and the status reached `completed`. Guarded by the detail-screen tests (confirm sheet pre-fill, comma decimals, zero-hours refusal) |
| 3.11 | Credits move from receiver to giver | PROVEN | 2026-08-21: UserA 85.00 → **86.00**, UserB 27.00 → **26.00**, `transactions` row 269 (1.00, "Exchange #61 for listing…"), `exchange_requests.transaction_id = 269`. No automated guard on the credit movement itself |
| 3.12 | Both parties see the transaction in their history | PROVEN | 2026-08-21: the requester's own wallet on the device shows "Exchange #61 … −1h" with SPENT −1h; the provider's side verified through `/v2/wallet/transactions` (credit, sender UserB) and their balance. 🔴 `transactions.giver_id` is NULL for this row — reading the table alone suggests the debit is unrecorded; the API derives it from the exchange, so the member's statement is correct |
| 3.13 | Leave a review after an exchange | N/A | Recorded parity decision: no native review composer, reviews are read-only on mobile (`docs/generated/mobile-parity-matrix.md`) |
| 3.14 | Read reviews on a member | RENDERS | Reviews screen exists; behind a bottom sheet for actions |
| 3.15 | Edit an existing listing | RENDERS | `edit-exchange` screen exists |
| 3.16 | Withdraw / close a listing | CERTIFIED | Walked 2026-08-22. The app calls it Delete, under "Listing tools" on the owner's own listing, behind a confirmation that says what it does. `listings` row 530 moved `active` -> `deleted`, the app returned to the directory and the count fell from 3 to 2. There is no separate "pause"/"close" state in the app |
| 3.17 | Exchange dead-end check: draft/publish states | CERTIFIED | Fixed `5373940c8`, guarded — recorded in memory as a prior finding |
| 3.18 | Group exchanges | RENDERS | Screen photographed at 360dp, filter chips scroll correctly |
| 3.19 | Skills on a profile drive matching | OPEN | Never walked |
| 3.20 | Report a problem with an exchange | BROKEN | **No capability exists anywhere on the platform**, so this is not a mobile gap. Checked 2026-08-22: the only route that reaches `disputed` is the automatic hours-variance rule, and the only dispute route is `POST /v2/admin/broker/exchanges/{id}/resolve-dispute` — a broker RESOLVING one, with nothing that raises it. `POST /v2/support/reports` takes free-text summary/description/impact and cannot name an exchange, which matches the known finding that four parallel reporting systems exist and none can reference an exchange. Building this means an API route, a structured target, moderation routing and notifications, with safeguarding implications — **owner decision, not started** |

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
| 4.16 | Shift sign-up | CERTIFIED | 2026-08-23: joined, moved and cancelled a shift on the device — `vol_applications.shift_id` 65 → 66 → NULL, and the shift list's spot counts followed. 🔴 **The walk found a real defect and it is now fixed.** A volunteer can hold exactly ONE shift per opportunity, because the server stores the sign-up as `vol_applications.shift_id` — a single column on the application, not a row per shift. Every card looked identical, including the one they had just joined, so signing up for a second shift silently dropped them from the first while the toast said "Shift joined — You have signed up for this shift". The held shift now carries a Confirmed chip and a Cancel action, and joining another asks first, naming the shift that would be lost. Guarded by three tests in `volunteering-detail.test.tsx`, each mutation-verified. 🔴 Two things the walk also established: **nothing on the platform can create a shift** — no route, no screen, in either frontend — they exist only where `RecurringShiftService` materialises a recurring pattern, and `createPattern()` generates none, so a coordinator sees nothing until the nightly cron runs; and `vol_shift_signups` is a **dead table** on this path, which made a successful sign-up look like a failed one until the code was read |
| 4.17 | Shift swap request and response | PARTIAL | **The response half works and is now guarded; the request half does not exist anywhere on the platform.** 2026-08-23: UserB asked UserA to swap, UserA accepted on the device, and both applications moved — 675 went 66 → 67 and 674 went 67 → 66, request row `accepted`. 🔴 The walk found a real defect in both frontends and both are fixed. The payload is **requester-relative** — `original_shift` is always the requester's own shift — but each card labelled `original_shift` "Your shift" unconditionally, so on a **received** request, the only kind carrying Accept and Reject, the two shifts were named the wrong way round: UserA's card read "YOUR SHIFT — Aug 26" for UserB's shift and "PROPOSED SHIFT — Aug 29" for their own. A volunteer checking their diary would decline a swap that suited them. Both are now viewer-relative, with a "Their shift" label, guarded by two tests each side (`volunteering.test.tsx`, `ShiftSwapsTab.test.tsx`), all mutation-verified. 🔴 **PARTIAL, not CERTIFIED, because nothing can create a swap request.** `POST /v2/volunteering/swaps` works — probed directly, and it is what seeded this walk — but **no client calls it**: not mobile, not the website. Building it needs a roster showing which volunteer is on which shift, which is a privacy and safeguarding decision, not a screen. Same family as 3.20 and 6.12. The website's own empty state already tells members "you can request a swap from the shift details page", which does not exist — **owner decision** |
| 4.18 | Volunteer donations / giving days | RENDERS | Tabs exist; never exercised |

🔴 Rows 4.1–4.15 are PROVEN, not CERTIFIED, for one reason: **no automated test drives
them.** A single Maestro flow over this tier would convert fifteen rows.

## Tier 5 — Community modules (34 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 5.1 | Events list | RENDERS | Photographed, clean at 360dp |
| 5.2 | Create an event | PROVEN | 2026-08-22: created "WalkEvent" and then PUBLISHED it — `events` row 162, draft → `active`, behind a confirmation naming what publishing triggers. 🔴 The date is in `start_time`; `events.start_date` exists, is always NULL, and reading it first nearly produced a false "the date was not saved" finding |
| 5.3 | RSVP to an event | PROVEN | 2026-08-22: the second member tapped Going on the published event — `event_rsvps` row 1009 (`going`), and the card moved to "1 going" with the button in its selected state. 🔴 The table is `event_rsvps`; `event_attendance` is a different thing and `event_attendees` does not exist |
| 5.4 | Event attendance / check-in | CERTIFIED | 2026-08-23: on event 163 the organiser checked a member in and then out — `event_attendance` row 12 `checked_in` v1 → `checked_out` v2, and the RSVP moved to `attended`. 🔴 **The walk found that every manual check-in reported failure while succeeding.** `EventAttendanceTransitionResult::toArray()` has always returned `credit_status`; the mobile `mutation` schema is `.strict()` and did not declare it, so `parseContract` threw `EVENTS_CONTRACT_DRIFT` (422) **after** the server committed the transition. The organiser saw "Attendance not updated" over a roster still reading "Not checked in", and their only reasonable next move — tapping again — then really did fail, because the member was already `attended`. 🔴 **The existing test suite stayed green through this**, because its fixture was written from the schema instead of from the server and omitted the very field the server always sends. Both new guards now use the real payload; the error path also refreshes the roster, so a failure can never leave an organiser looking at a state that is not the server's. Three tests, all mutation-verified. 🔴 Systemic risk recorded, not fixed: **141 `.strict()` schemas across the events API layer**, each of which turns an undeclared server field into a member-facing failure. Nothing checks them against the PHP DTOs |
| 5.5 | Event detail | RENDERS | Screen exists |
| 5.6 | Groups list | RENDERS | Photographed, stat tiles wrap correctly |
| 5.7 | Create a group | PROVEN | 2026-08-22: created "WalkGroup" from the device — `groups` row 974 (owner 674, public, active). 🔴 Tenant 2 had **zero** groups before this, so 5.8 and 5.9 could not have been walked at all without it. The form refused an 11-character description and said why ("Use 20 to 2000 characters") |
| 5.8 | Join a group | PROVEN | 2026-08-22: joined group 974 from the second emulator — `group_members` row (974, 675, `member`), the header switched to "Joined" with a Leave button, and MEMBERS went 1 → 2 |
| 5.9 | Post in a group | PROVEN | 2026-08-22: started a discussion from the joined member's device — `group_discussions` row 49 and its first message in `group_posts` row 48. 🔴 The first message is in **`group_posts`**; `group_discussion_messages` is a two-column stub and reading it first nearly produced a false "the message vanished" finding |
| 5.10 | Group tabs (discussion, wiki, tasks, analytics) | RENDERS | Tab strip scrolls correctly |
| 5.11 | Messages list | RENDERS | Photographed |
| 5.12 | Send a message to another member | CERTIFIED | 2026-08-21: sent from the second emulator as UserB — `messages` row 545 (675 → 674, unread). Guarded by `app/(modals)/thread.test.tsx` ("sends replies to the other user from conversation metadata") |
| 5.13 | Receive a message and see the unread badge | CERTIFIED | 2026-08-21: the recipient's device showed **1 unread**, and opening the thread flipped `messages.is_read` to 1 — the read receipt was verified as well as the badge. Guarded by `app/(tabs)/messages.test.tsx` ("shows unread badge on conversation with unread messages") |
| 5.14 | Reply in a thread | CERTIFIED | 2026-08-21: replied from the recipient's device — `messages` row 546 (674 → 675). Guarded by the same thread-screen send test |
| 5.15 | Voice message | CERTIFIED | Walked 2026-08-22 — record, stop, review, send, and it plays back in the thread. 🔴 Found a defect that made **every voice message on the platform one second long**: `MessagesController::sendVoice()` passed a literal `0` to `AudioUploader::upload()`, which stores `max(1, duration)`, so a 38-second note arrived as `audio_duration = 1` and rendered as "0:00". The sibling `/messages/voice` route had always read the field; only the route both frontends call did not. Fixed on both sides (the client never sent it either) and verified: `messages` row 551 stores 2 for a 2-second recording. Guarded by `VoiceMessageControllerTest` and `lib/api/messages.test.ts`, both mutation-verified. The website has the same client-side omission and is recorded, not changed |
| 5.16 | Members directory | RENDERS | Photographed, clean at 360dp |
| 5.17 | View a member profile | RENDERS | Screen exists |
| 5.18 | Send a connection request | PROVEN | 2026-08-22: sent from UserB's profile — `connections` row 160 (674 → 675, `pending`) |
| 5.19 | Accept a connection request | CERTIFIED | 2026-08-22: accepted on the recipient's device, row 160 → `accepted`. Two defects found and fixed on this screen: the status chip printed the raw key `connections.status.pending`, and a pending request was labelled "Connected <date>". Guarded by `app/(modals)/connections.test.tsx` (both mutation-verified) |
| 5.20 | Polls list | RENDERS | Photographed |
| 5.21 | Vote in a poll | CERTIFIED | Walked on two devices 2026-08-22. UserA voted (poll_votes 226), UserB voted the other option (227). Found and fixed three real faults: the tallies the server withholds from non-creators rendered as a chip with no number in it, then as 0%/0% bars after voting, and the card printed the question twice. Now reads "Vote to see results" / "Results revealed when poll closes", per the website's wording. |
| 5.22 | Create a poll | CERTIFIED | Walked 2026-08-22: Create tab -> New poll -> question + two options -> Publish. polls row 41 (tenant 2, user 674) with poll_options 141/142; the new poll appeared in the list and in both members' feeds. |
| 5.23 | Ideas / challenges | CERTIFIED | 2026-08-22: challenge created from the Create tab (ideation_challenges row 14, tenant 2, `open`), both members' ideas listed under it, and a vote from the second member recorded (challenge_idea_votes row 8). One defect fixed: voting or submitting replaced the whole page with a spinner for several seconds, because the screen treated any refresh as a first load. |
| 5.24 | Submit an idea | CERTIFIED | Walked on both devices 2026-08-22. challenge_ideas rows 35 (user 674) and 36 (user 675), both `submitted`; the challenge header moved 0 -> 1 -> 2 ideas and the idea's own count read "1 vote" after the second member voted. |
| 5.25 | Jobs list | RENDERS | Photographed |
| 5.26 | Jobs tabs readable on a narrow phone | CERTIFIED | Truncated to "My A…" until `ec0df3366`; guarded by `app/deepLinkTabs.test.ts` sibling |
| 5.27 | Apply for a job | CERTIFIED | 2026-08-23: applied from the device — `job_vacancy_applications` row 12, `pending`/`applied`, cover message stored in full, and the "Application submitted!" confirmation shown. Two defects found and fixed. 🔴 **The "Posted by" card was a heading with nothing under it.** `legacyGetById()` — the method `GET /v2/jobs/{id}` actually calls — joined `organizations` but never `users`, so `enrichVacancy()` built `creator.name` from absent aliases and returned `''`. A shared API fault, so the website's job page had it too; the list queries have always joined `users`, which is why the cards looked right and only the detail screen was blank. 🔴 **The fix first went to the wrong method**: `getById()` and `legacyGetById()` have byte-identical query bodies and a plain search-and-replace hit the one the route does not use. The guard test asserts both. 🔴 **Applying takes 9.5 seconds against a 15-second timeout**, because the endpoint sends two emails inside the request. The application row is written in the first second, so a timeout does not undo it: the member is told it failed while the employer already has it, and applying again is refused as a duplicate. Same shape as registration (1.9). Given its own 45s timeout and an honest message; the durable fix is to move those emails off the request, which is **not done**. 🔴 One walk artefact worth recording so it is not re-filed as a defect: `adb shell input text` breaks on spaces, which truncated a cover message to "I" and looked exactly like a broken field |
| 5.28 | Job alerts | CERTIFIED | 2026-08-22: `nexus://jobs/alerts` now opens the Alerts tab and an alert was created and read back (`job_alerts` row 1, user 674, keywords "gardening", active). Two defects fixed on the way: the screen never read its own `view` parameter, so every alerts link landed on Browse; and the alert list was **unreachable** — the root SafeAreaView relied on an inert `className` for flex, so the list rendered below the bottom of the screen with nothing to scroll. Guarded by `lib/hooks/useParamTab.test.ts` and the tightened `components/safeAreaFlex.test.ts` |
| 5.29 | Marketplace browse | RENDERS | Feature disabled for the test community until enabled locally 2026-08-20 |
| 5.30 | Marketplace category by slug | CERTIFIED | Deep link said "not found" until `673743f16`; guarded by `app/deepLinkParams.test.ts` |
| 5.31 | Sell an item | CERTIFIED | Walked 2026-08-22: Create tab -> Sell item -> title, tagline, description, price, currency, condition, category -> Publish. marketplace_listings row 100 (tenant 2, user 674, EUR 12.00 fixed, `good`, category 51). 🔴 Found the worst defect of the sweep: marketplace moderation is ON by default, so the new listing was `pending` and BOTH frontends then navigated the seller to a public read that hides it — "Listing not found. This item may have been sold, removed, or moved." about the item they had just created. Fixed in the API (a seller may read their own listing at any moderation status) and the app now shows the server's "waiting for a moderator" notice. |
| 5.32 | Buy an item / checkout | CERTIFIED | Walked on the second device 2026-08-22. marketplace_orders row 35 (`paid`, 2 time credits, buyer 675 -> seller 674), balances moved 25 -> 23 and 86 -> 88, and the app landed on Purchases showing the order. Two findings: the order row printed the CASH total, so a time-credit purchase read "€0.00" (fixed — it now says "2 time credits"), and the Checkout card renders a heading with nothing under it when there are fewer than two payment methods (recorded, not fixed). Card payments are not configured for this community, which the app reports clearly. |
| 5.33 | Blog list and article | CERTIFIED | Deep link handed the screen the wrong parameter name until `673743f16`; guarded, and the test that pinned the bug corrected |
| 5.34 | Knowledge base / resources | RENDERS | Screens exist |

## Tier 6 — Money and wallet (12 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 6.1 | See your balance | RENDERS | Wallet screen photographed; balance correct |
| 6.2 | See your transaction history | PROVEN | 2026-08-22: walked on the device — rows for the transfer, the exchange and the volunteering auto-payment, each with an earned/spent tag and date, All/Earned/Spent/Pending filters, an Export action and EARNED/SPENT/PENDING aggregates that matched the ledger. 🔴 Each row's meta line was clipped by the bottom of its card — **fixed 2026-08-23**: the whole row sat inside a `HeroButton`, which caps its own height, so the description and the amount were not rendered at all. The same fault as the notification cards, in a second place; swapped to `NativePressable` and now covered by a shrink-only guard (`components/cardInsideButton.test.ts`, 8 sites left). PARTIAL until 6.2 was walked |
| 6.3 | Send credits to another member | PROVEN | 2026-08-22: sent 1 hour from the wallet — UserA 86.00 → 85.00, UserB 26.00 → 27.00, `transactions` row 270 ("Time credit transfer"). 🔴 The recipient search field was a narrow pill, hard to hit and showing almost no text; fixed in `components/ui/Input.tsx` for every field in the app |
| 6.4 | Receive credits and see them | PROVEN | Volunteering credit landed and showed (Tier 4) |
| 6.5 | Organisation wallet balance | PROVEN | −2.00 → 8.00 → 13.00 across two deposits, with ledger rows |
| 6.6 | Deposit credits into an organisation wallet | PROVEN | Device + API; organiser correctly debited |
| 6.7 | Community fund | PROVEN | 2026-08-22: donated 1 credit from the wallet — member 85.00 → 84.00, `community_fund_accounts` balance 1.00 / total_donated 1.00, `community_fund_transactions` row 8. 🔴 This walk uncovered a platform-wide backend defect: the fund's own endpoints were gated on `hasFeature('wallet')` when `wallet` is a MODULE, so the fund reported `{balance: 0, enabled: false}` for every tenant, always. Fixed and guarded in `WalletFeaturesControllerTest` |
| 6.8 | Pending in / out | PARTIAL | **Walked with a seeded fixture, because no member can reach this screen state.** 🔴 The only code path that writes `transactions.status = 'pending'` is external federation (`FederationController`), which is off by default and has never had a partner connected — `WalletService` writes `completed` on both of its insert paths. So in every real community these figures are permanently 0.00, while the wallet devotes a chip, a stat tile and a filter tab to them. 🔴 **Two defects found and fixed.** The app **added pending-in to pending-out** and printed the sum: with 7 in and 4 out it read "11 pending" in the chip and "PENDING 11h" in the tile, beside EARNED "+3h" and SPENT "−5h" which do carry a direction. 11 was a figure the member had nowhere. And the **Pending filter could only ever answer "No matching transactions"**, because `getTransactions()` was hard-scoped to `completed()` — so the tile claimed hours were pending and tapping Pending showed none of them. Both faults existed on the **website** too and both are fixed there. The server now honours `type=pending` and is deliberately additive: every other filter stays completed-only, because clients derive earned/spent from that list and a pending amount must never count as settled. Guarded by two tests each side plus a feature test pinning both halves of the server rule; all mutation-verified |
| 6.9 | Wallet limits and refusals | PROVEN | 2026-08-22: tried to send 999 credits on an 85-credit balance — refused before any request with "Check the details / You do not have enough time credits for this amount." Balances untouched, no transaction row |
| 6.10 | Donations | RENDERS | Tab exists |
| 6.11 | Auto-pay control on an organisation wallet | N/A | Removed `df0d4085c`: the endpoint returned 404 and the flag governed nothing. React had already removed it |
| 6.12 | Transaction detail view | OPEN | 🔴 Cannot be walked: there is no such screen. The history rows have no `onPress` and no client calls `GET /v2/wallet/transactions/{id}` — **not the website either**, so this is an unused server endpoint rather than a mobile gap. Owner question: build it or drop the row |

## Tier 7 — Cross-cutting behaviour (18 rows)

| # | Journey | Status | Evidence / cause |
| --- | --- | --- | --- |
| 7.1 | Deep links reach the right screen with the right parameter | CERTIFIED | Three were broken; guarded by `app/deepLinkParams.test.ts`, mutation-verified |
| 7.2 | Deep links honour a `?tab=` | PARTIAL | Works when the screen is opened fresh by the link; ignored when it is already open or after a cold start. Intent mapper proven correct. 2026-08-22: `lib/hooks/useParamTab.ts` now handles both halves and is adopted by `jobs`; the remaining tabbed screens still use `useState(() => fromParam())` and keep the already-open half of the fault |
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
| 7.15 | In-app notification counts are correct | CERTIFIED | 2026-08-22: the header said "10 unread" against 26 genuinely unread rows, because it counted the loaded page rather than asking the server. `/v2/notifications/counts` had the right number all along and `getNotificationCounts` was in the client, unused. Now reads 26, matching the database, and refetches after mark-read/delete. The same walk found the notification cards cropped by a `HeroButton` wrapper — title, category and timestamp were hidden on every row and the body was cut mid-word; swapped to `NativePressable` |
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
