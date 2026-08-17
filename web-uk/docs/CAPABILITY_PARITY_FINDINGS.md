# Capability parity findings — accessible frontend vs React

**Measured 2026-08-17.** This is the audit that
[REACT_PARITY_AND_ROADMAP.md](REACT_PARITY_AND_ROADMAP.md) lists as roadmap item 7: comparing
what a member can actually **do** on the 179 pages that exist on *both* frontends, rather than
whether the page exists.

## 🔴 The headline: route parity badly overstates behaviour parity

`docs/generated/accessible-route-matrix.*` records **707 of 707 matched, 0 missing**. Every
money route in scope is `matched`. Behind those matched routes this audit found **roughly 70
real divergences**, of which about **30 stop a member or organiser completing something React
allows** and **12 move money or destroy data**.

That is not a criticism of the matrix — it measures route *declaration* against a frozen Blade
inventory, and says so. It is the reason this document exists. **No existing test catches any
finding below.**

Scope audited: events, groups, volunteering, organisations, wallet, listings, marketplace,
exchanges, premium/donations. Method: source inspection of route handlers, templates, and the
Laravel services/controllers behind them, with the most severe claims re-verified individually.
**Nothing was executed** — the shared local database is production-derived and off-limits.

---

## Tier 0 — accessibility regressions on the accessible frontend

These come first because of where they are.

### 0.1 ✅ FIXED 2026-08-17 — a volunteer's accessibility needs were collapsed on read and overwritten on save

Each need now has its own fields (`description[mobility]`, `description[hearing]`, …), read
back per need. Detail groups render for every need type because with no JavaScript nothing can
reveal a hidden group when a box is ticked, and every label is the one the page already used,
reused inside each need's own fieldset legended with that need's existing translated name — so
**no new translation keys** were needed.

Two further data-loss risks were found and closed in the same change: a need whose type this
build does not recognise would have been **deleted** by an ordinary save (the API replaces the
whole set), so those rows are now carried through hidden fields untouched; and a member holding
the **old** form in a cache would have written nulls over everything, so that submission is now
refused rather than accepted.

🔴 A pre-existing test had **encoded the bug** — it posted a single flat description and
asserted it was applied to the need — and the disposable-env runtime spec had the same fault,
giving both needs identical details. Both are corrected, and one new test fails on the old
implementation.

The original finding follows.

- Read: `web-uk/src/routes/volunteering-actions.js:1850-1881` keeps only the **first non-empty**
  value across all needs.
- Write: `:2710-2736` builds ONE `sharedDetails` object and spreads it into **every** selected
  need type.
- React stores an array of needs, each with its own description, accommodations and emergency
  contact (`react-frontend/src/pages/volunteering/AccessibilityTab.tsx:60-66`).

A member who recorded a mobility need *and* a separate sensory need in React sees one
description here, and pressing Save writes it over the other — permanently. **Verified on disk.**

🔴 **This is not a template fix.** The form has one set of detail fields and cannot express
per-need edits, so a correct fix needs per-need field groups (new labels ⇒ eleven locales) or a
merge that preserves unedited needs. Do not "fix" it by only sending changed fields without
first proving the read path stops collapsing.

### 0.2 The single-event edit form cannot record venue accessibility at all

`web-uk/src/views/events/edit.njk` contains **zero** occurrences of "accessib" (verified). The
shared partial `events/_venue-accessibility-fields.njk` is imported by `new.njk:12` and
`recurring-edit.njk:6` — never by `edit.njk`. So an organiser cannot add or correct step-free
access, accessible toilet, hearing loop, quiet space, seating, parking, transit details,
assistance contact or notes on an existing one-off event. No data is wiped (the payload builder
guards on `hasOwnProperty`), but the information is uneditable.

🔴 Two traps for whoever fixes this:

1. `CHANGELOG.md:643` claims the create fix shares "one common block with the edit form so the
   two cannot drift apart again". That is true only of the **recurring** edit form.
2. **The value shape is ambiguous and guessing it causes data loss.** The macro reads
   `a.stepFree || a.accessibility_step_free`. On the plain edit GET the route passes a
   normalised event whose `venue_accessibility` comes straight from the API
   (`events.js:649-651,667`) — if those keys match neither form, every select silently defaults
   to `unknown` and **saving overwrites real accessibility data with "unknown"**. Confirm the
   API's actual field names first (the recurring-edit path builds camelCase explicitly at
   `events.js:1137-1142` via a `triState()` helper — copy that, don't assume). Add an
   assertion to `tests/runtime/events-mutation.spec.js`, which today has none.

---

## Tier 1 — money moves wrongly, or member data is destroyed

| # | Finding | Evidence |
|---|---|---|
| 1.1 | ✅ **FIXED 2026-08-17.** A countered offer is now the buyer's move: the seller's tab acts only on `pending`, the buyer gets a new `/offers/:id/accept-counter` route calling the endpoint that promotes the counter, and the counter amount is displayed to both parties. All offer buttons gained `data-prevent-double-click`. *Original finding:* accepting a countered offer bound the buyer's ORIGINAL lower price and `counter_amount` was never even displayed. | `views/marketplace/offers.njk:62-70` renders Accept for `countered` (`marketplace.js:665`); `MarketplaceOfferService.php:155-175` `accept()` never touches `amount` — only `acceptCounter()` `:406-411` promotes it |
| 1.2 | ✅ **FIXED 2026-08-17.** A Total row now shows unit x quantity, and quantity moved to its own GET form so the total is always derived from a confirmed quantity (no JavaScript can recalculate one in place). The purchase form posts that quantity as a hidden field, so displayed and charged amounts cannot diverge. Shipping stays on its own option label deliberately — a radio that can change without a reload would recreate the same lie. *Original finding:* the page showed the UNIT price while the server charges unit x quantity, so buying 3 of a 5-credit listing displayed "5 time credits" and debited 15. | `views/marketplace/buy.njk:33` uses a per-unit label (`marketplace.js:463-475`); server charges unit × quantity (`MarketplaceOrderService.php:378-380,396-399`) |
| 1.3 | ✅ **FIXED 2026-08-17.** Two server-side layers, because a client-side guard needs JavaScript: a single-use submission token minted with the form and consumed before any await (compared with `timingSafeEqual`, mirroring the marketplace direct-buy flow), plus the duplicate check `listings.js` already imported and never called — an existing exchange now redirects to the listing, which already renders "You already have an active exchange for this listing." with a link, in all eleven locales. No new keys. A pre-existing test had to stop posting the form blind, which was asserting the unguarded behaviour. *Original finding:* the only money form in web-uk missing even `data-prevent-double-click`; two POSTs created two exchanges on one listing and confirming both moved credits twice. | `views/listings/exchange-request.njk:72-93`; handler `listings.js:958-1007` never calls its own `checkExchangeForListing`; `ExchangeWorkflowService.php:105-166` inserts unconditionally |
| 1.4 | **Editing a coupon silently applies its discount to the seller's whole catalogue.** | `marketplace-actions.js:290` hardcodes `applies_to: 'all_listings'` in the shared create/update payload; `MerchantCouponService.php:100-109` re-normalises to it |
| 1.5 | ✅ **FIXED 2026-08-17.** A fixed amount is now converted both ways: what the seller types, what is stored, and what is displayed all agree. The field's hint already said "For a fixed amount, enter the amount", so making that true needed no wording change and no new locale work; the display renders real money with its currency instead of a bare stored number. Percentages are unitless and untouched. 🔴 **THREE pre-existing tests had absorbed the bug** — one asserted a coupon stored as `3` displayed "3.00", and two asserted the raw pass-through of `3` and `4.5` — all corrected. *Original finding:* a seller typing `5` for £5 created a £0.05 coupon and was shown "5.00". 🔴 The sibling `min_order_cents` field is genuinely in minor units and its label says so, so it is left alone — but the form now mixes units between two money fields, which is worth resolving when its wording is next translated. | React labels cents and divides (`CouponDetailPage.tsx:122`); web-uk neither (`marketplace.js:868-883`) |
| 1.6 | **Adding a participant to a weighted group exchange rewrites their weight to 1**, changing everyone's share. web-uk also cannot create a weighted split. | `group-exchange-actions.js:124` hardcodes `weight: 1`; `:107` coerces to `equal` |
| 1.7 | **web-uk lets an organiser complete a DISPUTED group exchange**; React refuses. Credits move. | `group-exchanges.js:232` treats only completed/cancelled as closed; `GroupExchangeService.php:823-829` likewise |
| 1.8 | **`community_delivery` purchases are stored broken and reported as success** — no `shipping_method` sent, so the order can never receive a delivery offer. | `marketplace-actions.js:661-678`; `MarketplaceOrderService.php:843-854` → NULL |
| 1.9 | **A failed donation to a person silently retargets the retry at the community fund**, with the amount pre-filled and the recipient changed. The transfer form loses its recipient the same way. | `wallet.js:404` → `views/wallet/index.njk:52` hardcodes `target=community_fund`; `manage.njk:84-87` omits the `recipient_q` field `index.njk:74` includes |
| 1.10 | **Hybrid cash+credit prices display as credits-only** in every list — a €25 + 3-credit listing reads "3 time credits". Also returns a hardcoded English `'Free'`. | `marketplace.js:498-512`, `:474`, `:503` |
| 1.11 | **A group exchange cannot be started**, so it never leaves draft: participants are asked to confirm with **no notification** (start is the only caller of `notifyParticipantsToConfirm`), and React participants deadlock. | no `/start` in `group-exchange-actions.js`; `GroupExchangeService.php:648` |
| 1.12 | **Order status tabs are wired to values the database does not have.** The buyer's **Active tab is permanently empty**; Completed hides `delivered`; Cancelled hides `refunded`. | `marketplace.js:197` sends `status=active`, absent from the enum; `MarketplaceOrderService.php:1367-1373` exact-matches |

---

## Tier 2 — member or organiser cannot complete the task (selected)

**Events / groups / volunteering / organisations**

- **Event staff cannot be assigned at all** — no `/staff` route; an organiser cannot delegate check-in.
- **Ticket types cannot be created** — display + allocate only, so a paid or capacity-limited event cannot be set up here.
- **Volunteering waitlists are leave-only** — a member notified a spot opened cannot take it.
- **Under-18s can never apply to volunteer** — `GUARDIAN_CONSENT_REQUIRED` is unhandled (`volunteering-actions.js:370-388`); distinct from the known emailed-page gap.
- **Group invite links cannot be redeemed** — organisers mint and email links to a route that does not exist.
- **Group announcements are unreachable** — the whole feature exists (`groups.js:1236,1782+`) and nothing links to it.
- **No comments or likes on events or opportunities** — though the plumbing already exists (`feed-actions.js:423,465` accepts any target type, plus a reusable comments macro). Cheap.
- Six group tabs absent (Q&A, Wiki, Media, Challenges, Tasks, Chatrooms); group feed is post-only with **no report action**; cannot cancel a pending join request; cannot create an event inside a group (`GET /new` never reads `group_id`).
- **Organiser queues truncate to the first page** — volunteering `per_page=20`, groups fixed `per_page:100`, no search or pagination: item 21 is unapprovable.
- Cannot decline a volunteer application where the tenant requires a note (no note field rendered, API rejects empty).
- Event moderation offers 2 of 7 actions; org settings for a pending org renders blank **and saving wipes description, contact email and website**.

**Money / trading**

- **Regional Points does not exist** on web-uk (a whole third-currency page in React).
- **Nothing in the marketplace paginates** (caps 30/50/100). Escalation: with >50 sent offers a buyer **cannot complete a purchase the seller already accepted** (`marketplace.js:742`).
- **Listing photos cannot be added, replaced or removed** — `uploadMarketplaceListingImages` exists (`lib/api.js:1085`) and is called by no route.
- Counter-offers absent; coupon codes and loyalty redemption cannot be applied at checkout; sellers cannot manage shipping options (so cannot sell shipped items); coupons cannot be redeemed in store; **reports vanish after submission and a seller cannot appeal**; donating to a specific member picks `recipients[0]` only; fractional hours blocked on 2 of 3 credit forms; Stripe Connect seller onboarding absent (a plain hosted redirect, so outside the deliberate card-payment fence).

---

## Tier 3 — completes, but with data loss or silence (selected)

- **A failed safety report is indistinguishable from a successful one** on listings and marketplace — the status banners are never rendered (`views/listings/detail.njk`, `marketplace/detail.njk`).
- The listings index "Saved" tag reads the wrong table (`listings.js:1235` uses bookmarks; save writes `user_saved_listings`; the correct `is_favorited` is already on the row and used correctly at `:1395`).
- **"Newest" sort never sorts by newest** — `sort` is never sent, so signed-in members silently get algorithmic ranking with no disclosure.
- Validation failure destroys typed input in three money forms (exchange message up to 5000 chars, pickup-slot fields, manage-page transfer) although `storeListingFormReplay` exists.
- `proposed_hours` is silently **clamped** (40 → 24) with no message.
- The wallet "Pending" filter shows the complete list while marked `aria-current`; the transfer ceiling is hardcoded 1000 ignoring the tenant cap; **the wallet throttle is ~15× stricter than the API's and keyed by IP**, so two members in a care home or library can lock each other out — while `/members` (which carries a transfer POST) has no limiter at all.
- Actionable API messages are discarded on every money path — `INSUFFICIENT_BALANCE` becomes "check the current status and try again".
- Cancelling a paid subscription takes one click with no confirmation.
- **Per-tab tenant configuration is ignored entirely** (zero references to `volunteering.tab_*`/`tab_qa`/`tab_wiki`), so members are shown features their community switched off; the organisations journey has no volunteering feature gate at all.
- `GET /organisations/:id/jobs` hardcodes `jobs: []` behind complete markup, asserting "no vacancies" for organisations that have them.

---

## 🔴 Two defects found in REACT, not here

1. **A GBP tenant's members are shown "€10" and charged £10.** `PricingPage.tsx:186` calls
   `formatPrice(cents)` whose `currency = 'EUR'` default is never overridden, while Stripe
   charges `TenantContext::getCurrency()` (`MemberPremiumService.php:307`). web-uk reads the
   tenant currency correctly (`premium.js:100-113`) — **the accessible frontend is right and
   React is wrong.**
2. Single-exchange pagination is a known-broken `limit`/`offset` in React, flagged in its own
   comments (`ExchangesPage.tsx:483-487`); web-uk's works.

## Where web-uk is BETTER — do not "fix" by removing

Marketplace direct buy is the model implementation in either frontend (GET confirmation page,
double-click guard, session-bound idempotency key compared with `timingSafeEqual`, unique
`checkout_key` server-side, price recomputed from the locked row). Wallet CSV export is complete
where React's exports only what is loaded. Balance formatting is locale-aware. The exchange
report form offers all seven reasons where React hardcodes `other`. web-uk shows a wallet
balance and low-balance warning on the exchange page that React does not show at all.

## Verified safe — do not re-raise

Every credit-moving action **except exchange creation** is idempotent or state-guarded
server-side (each guard read individually). Hours are never posted from a hidden field. Omitting
`category_id` on transfers, `prep_time`, and latitude/longitude on create are all safe — the
backend drops or back-fills them. Splitting tabs and modals into separate pages, GET
delete-confirmation pages, and the deliberate card-payment refusal at
`marketplace-actions.js:937-947` are correct.

## Suggested order

1. ~~**0.1**~~ — ✅ **done 2026-08-17.**
2. ~~**1.1, 1.2, 1.5**~~ — ✅ **all done 2026-08-17.**
3. ~~**1.3**~~ — ✅ **done 2026-08-17.**
4. **0.2** — same bug class as the one already "fixed", and the changelog wrongly implies it cannot recur. **Next**, but read its two traps first: the value shape is ambiguous and a wrong guess silently defaults every field to "unknown" and overwrites real accessibility data on save.
5. **1.4, 1.6, 1.7, 1.8, 1.9, 1.12** — silent wrong writes.
6. Tier 2 blockers, cheapest first: group invite redemption (one route), announcements (one link), event/opportunity comments (plumbing exists).

## Caveats

- **Nothing was executed.** Rendered states are inferred from source.
- **Tenant gating was not traced per community** beyond the checks recorded in the roadmap
  document. If a module is off for the live communities, the practical severity of its findings
  drops.
- Locale files other than `en` were not diffed, so untranslated-string findings describe the
  mechanism, not per-language counts.
