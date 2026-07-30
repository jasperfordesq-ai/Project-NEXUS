# Marketplace Module Guide

Last reviewed: 2026-07-30

This guide is a how-to/reference for maintainers of the **Marketplace** module — a standalone goods/commerce surface where members list physical items for sale, negotiate offers, or give items away. Cash-priced orders use Stripe Connect, while supported item and community-delivery flows can use time credits. It is **completely separate from the timebanking Listings module** (`ListingService` / `listings` table): different tables, service layer, and Meilisearch index.

> **Real money is involved.** When a tenant enables Stripe, a non-zero cash order requires a Connect-ready seller. Non-escrow orders use destination charges; escrow orders use separate charges and delayed transfers so the platform can actually defer the seller payout. Treat payment, escrow, refund, and order-state code with the same rigour as the wallet ledger.

## Audience & supported workflows

Use this guide when changing marketplace listings, the buyer/seller order lifecycle, payments/escrow, click-and-collect, or moderation.

Supported workflows:

- **Listing management** — a seller creates, edits, photographs, renews, and removes item listings (separate from timebanking offers/requests). Explicitly zero-price promotions can activate; priced promotion checkout is fail-closed until a real payment authorization flow is implemented.
- **Browse & discovery** — browse/search/nearby/featured/free, categories, saved listings, saved searches, and personal collections. All of these require a signed-in member; see "Tenant & feature-gate rules" below.
- **Offers / negotiation** — a buyer makes an offer on a listing; the seller accepts, declines, or counters; an accepted offer becomes an order.
- **Order lifecycle** — direct buy-now or offer-driven order, moving through `pending_payment → paid → shipped → delivered → completed`, with cancel, dispute, and rating branches.
- **Payments & escrow** — Stripe Connect PaymentIntents or hosted Checkout Sessions, with destination charges for immediate settlement and separate charge/transfer for delayed escrow payout.
- **Click-and-collect** — sellers publish pickup slots; buyers reserve a slot and receive a QR collection code that the seller scans at handover.
- **Community delivery** — a peer deliverer offers to deliver an order and earns **time credits** from the buyer on confirmation.
- **Moderation & DSA reports** — optional listing moderation, user reports against listings, seller verification/suspension, and transparency stats.

## Tenant & feature-gate rules

- **Feature gate:** `marketplace` (**default OFF** — `App\Services\TenantFeatureConfig::FEATURE_DEFAULTS['marketplace'] => false`). That class declares only `FEATURE_DEFAULTS` and `MODULE_DEFAULTS`; there is no `::DEFAULTS` constant on it (`MarketplaceConfigurationService` is the class that has a `DEFAULTS` — an easy confusion). The whole module is dark until a tenant explicitly enables it.
- **There are no unauthenticated marketplace endpoints.** Every `/v2/marketplace/*` route sits inside an `auth:sanctum` group — the write/management routes in the group opened at `routes/api.php:184`, and the read/browse routes (`listings`, `nearby`, `featured`, `free`, `listings/{id}`, `categories*`, `sellers/*`, `pickup-slots`) in the group opened at `routes/api.php:1558`, whose header comment reads "Courses, podcasts, and marketplace contain member identity and require auth." No marketplace route uses `withoutMiddleware`. The only marketplace route outside an auth group is the Stripe Connect webhook at `routes/api.php:3703`. An unauthenticated browse call therefore gets 401, not a listing page.
- **Feature enforcement is per-controller, not middleware.** Every marketplace controller calls `TenantContext::hasFeature('marketplace')` (via a private `ensureFeature()` helper) and returns `FEATURE_DISABLED` (HTTP 403) when the feature is off. This applies to the browse/search endpoints too — `MarketplaceListingController::index()` gates before serving. The accessible (GOV.UK) frontend gates the same way with `abort_unless(TenantContext::hasFeature('marketplace'), 403)`.
- **React frontend:** marketplace routes are wrapped in `<FeatureGate …>` in `react-frontend/src/routes/AppRoutes.tsx`, but not all on the same flag or with the same off-state behaviour. The main `marketplace` route (`AppRoutes.tsx:780-781`) and `marketplace/free` (`:836-837`) both render a "coming soon" fallback (`<ComingSoonPage feature={t('coming_soon.features.marketplace')} />`); the remaining `marketplace/*` routes redirect instead (`redirect="/"` for the browse/detail/public-seller-profile routes plus `marketplace/:id/edit` at `:1383`, `redirect="/dashboard"` for the other sell/order/seller-tooling routes); and the three `marketplace/seller/coupons*` routes (`:1340-1360`) are gated on `feature="merchant_coupons"`, not `marketplace`. `App.tsx` holds no route definitions — it is a provider shell whose only route is the `/*` catch-all rendering `TenantShell`.
- **Tenant scoping is mandatory.** Every marketplace table carries `tenant_id` and every query is scoped by `App\Core\TenantContext::getId()`. Order, escrow, and pickup operations re-pin tenant via `TenantContext::runForTenant()` / `setById()` so cron and webhook paths (which boot without a tenant) operate under the correct tenant.
- **Module-level config** lives in `App\Services\MarketplaceConfigurationService` (per-tenant key/value with `DEFAULTS`), independent of the authoritative `marketplace` feature flag. Notable defaults: Stripe `false`, shipping `false`, community delivery `false`, hybrid pricing `false`, promotions `false`, escrow `false`, platform fee `5%`, escrow auto-release `14` days, moderation `true`, free items `true`, business sellers `true`, max active listings `50`, listing duration `30` days, max images `20`. The redundant `marketplace.enabled` setting was removed; use the feature flag as the single module switch. Config reads fail closed rather than silently auto-approving or authorizing value movement.

## Key code & data locations

Routes are defined in [`routes/api.php`](../../routes/api.php) under the "Marketplace Module — Authenticated routes" section at line 1282 and the "Marketplace Module — authenticated content routes" section at line 1572 (both `/v2/marketplace/*`), the admin section (`/v2/admin/marketplace/*`), and the Stripe webhook (`/v2/marketplace/webhooks/stripe`). Do not copy the endpoint table here — read the route file or the OpenAPI/`docs/API.md` reference for the live list. The module spans ~14 member-facing controllers, one admin controller, and ~18 services.

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Listing CRUD, images/video, browse, categories, saved, bulk/CSV | `/v2/marketplace/listings/*`, `/v2/marketplace/categories/*` | `MarketplaceListingController` |
| Offers / negotiation | `/v2/marketplace/listings/{id}/offers`, `/v2/marketplace/offers/*`, `/v2/marketplace/my-offers/*` | `MarketplaceOfferController` |
| Orders lifecycle | `/v2/marketplace/orders/*` | `MarketplaceOrderController` |
| Payments / Stripe Connect / payouts | `/v2/marketplace/payments/*`, `/v2/marketplace/seller/{payouts,balance,onboard}` | `MarketplacePaymentController` |
| Seller profile, dashboard, shipping options | `/v2/marketplace/seller/*`, `/v2/marketplace/sellers/{id}` | `MarketplaceSellerController` |
| Discovery (saved searches, collections) | `/v2/marketplace/saved-searches/*`, `/v2/marketplace/collections/*` | `MarketplaceDiscoveryController` |
| Promotions (catalogue; free activation only today) | `/v2/marketplace/promotions/*`, `/v2/marketplace/listings/{id}/promote` | `MarketplacePromotionController` |
| Click-and-collect pickup slots | `/v2/marketplace/seller/pickup-slots/*`, `/v2/marketplace/seller/pickup-scan`, `/v2/marketplace/orders/{id}/pickup-reservation`, `/v2/marketplace/me/pickups` | `MarketplacePickupSlotController` |
| Community delivery (time-credit P2P) | `/v2/marketplace/orders/{orderId}/delivery-offers/*` | `MarketplaceCommunityDeliveryController` |
| Inventory | `/v2/marketplace/seller/listings/{id}/inventory` | `MarketplaceInventoryController` |
| Group-scoped marketplace | `/v2/marketplace/groups/{groupId}/*` | `MarketplaceGroupController` |
| AI auto-reply / description | `/v2/marketplace/listings/{id}/auto-reply`, `…/generate-description` | `MarketplaceAiController`, `MarketplaceListingController` |
| DSA user reports | `/v2/marketplace/listings/{id}/report` | `MarketplaceReportController` |
| Admin moderation / sellers / reports | `/v2/admin/marketplace/*` | `AdminMarketplaceController` |
| Stripe Connect webhooks | `/v2/marketplace/webhooks/stripe` | `StripeWebhookController` |

Services (`app/Services/`):

- `MarketplaceListingService` — listing read/create/update/remove/renew, Meilisearch sync, max-active-listings enforcement, geocoding.
- `MarketplaceOrderService` — order lifecycle (create from offer / direct purchase → ship → deliver → complete / cancel), order numbers (`MKT-000001`), idempotent multi-channel notifications.
- `MarketplacePaymentService` — Stripe Connect account creation/onboarding, PaymentIntent and Checkout Session creation, currency-safe minor-unit conversion, payment confirmation, delayed transfers, and refunds.
- `MarketplaceEscrowService` — hold funds on payment, release on buyer confirm / auto-timeout / admin override / dispute resolution, refund on dispute.
- `MarketplacePickupSlotService` — click-and-collect slot CRUD, atomic reservation, QR (ULID) collection code, seller scan.
- `MarketplaceCommunityDeliveryService` — peer delivery offers settled in **time credits** (writes to the `transactions` ledger).
- `MarketplaceOfferService`, `MarketplaceSellerService`, `MarketplaceRatingService`, `MarketplaceReportService`, `MarketplaceConfigurationService`, `MarketplaceDiscoveryService`, `MarketplacePromotionService`, `MarketplaceInventoryService`, `MarketplaceShippingOptionService`, `MarketplaceGroupService`, `MarketplaceAiService`.

Models / tables (all carry `tenant_id`):

- `marketplace_listings` — item listings (`App\Models\MarketplaceListing`).
- `marketplace_categories` — hierarchical categories (`parent_id`, per-tenant or global `tenant_id = NULL`).
- `marketplace_images` — listing photos (`is_primary`, `sort_order`); listings also have a `video_url`.
- `marketplace_offers` — buyer/seller negotiation.
- `marketplace_orders` — the order record (`order_number`, `status`, `payment_intent_id`, `escrow_released_at`).
- `marketplace_payments` — Stripe payment record (`amount`, `platform_fee`, `seller_payout`, `payout_status`).
- `marketplace_escrow` — escrow hold (`status`, `held_at`, `release_after`, `release_trigger`, `UNIQUE(order_id)`).
- `marketplace_seller_profiles` — seller profile, `stripe_account_id`, verification, `total_sales`/`total_revenue` stats.
- `marketplace_pickup_slots`, `marketplace_pickup_reservations` — click-and-collect.
- `marketplace_delivery_offers` — community delivery offers (settled in time credits).
- `marketplace_saved_listings`, `marketplace_disputes`, `marketplace_reports`, `marketplace_order_notification_deliveries` (notification idempotency ledger).

Frontend entry points:

- React: `react-frontend/src/pages/marketplace/` (`MarketplacePage`, `MarketplaceListingPage`, `CreateMarketplaceListingPage`, `BuyerOrdersPage`, `SellerOrdersPage`, `StripeOnboardingPage`, `FreeItemsPage`, `MarketplaceCollectionsPage`, seller sub-pages incl. `SellerPickupSlotsPage`, etc.), routed in `react-frontend/src/routes/AppRoutes.tsx`.
- Accessible (GOV.UK): commerce parity routes under `app/Http/Controllers/GovukAlpha/` (`CommerceParity` concern).

## Item types & pricing

There is no separate "swap" listing type. Item pricing is driven by `marketplace_listings.price_type`, an enum of:

| `price_type` | Meaning |
| --- | --- |
| `fixed` | Fixed price (default). Buy-now creates an order at `price`. |
| `negotiable` | Price negotiable — buyers make offers; an accepted offer becomes the order amount. |
| `free` | Give-away / free item (gated by the `marketplace.allow_free_items` config, default on). Surfaced by `GET /v2/marketplace/listings/free`. |
| `auction` | Auction-style listing. |
| `contact` | "Contact for price". |

Additional pricing fields are `price` (`decimal(10,2)`), `price_currency`, and optional `time_credit_price` (`decimal(8,2)`). New listings default to the tenant's configured currency, not a platform-wide EUR assumption. Cash currencies are normalized and checked by `App\Support\StripeCurrency`: supported two-decimal currencies use two fractional digits; Stripe zero-decimal currencies such as JPY reject fractional values; ISK and UGX also reject fractional major-unit input. Three-decimal presentment currencies are deliberately unsupported. Orders record `time_credits_used` when settled with credits. `condition` is `new | like_new | good | fair | poor`; `seller_type` is `private | business`; `delivery_method` is `pickup | shipping | both | community_delivery`.

## Listing lifecycle

`marketplace_listings.status` is `draft | active | sold | reserved | expired | removed`; `moderation_status` is `pending | approved | rejected | flagged`.

1. **Create** (`MarketplaceListingService::create`) — status defaults to `active` (or `draft`). Moderation defaults on, so new content is `pending` unless a tenant explicitly disables moderation. `expires_at` is set from the tenant's listing duration (default 30 days). Tenant policies for free/business/hybrid/shipping/community-delivery listings are enforced at the service boundary, and the max-active count plus insert are serialized per seller. Only active, approved content is best-effort synced to the `marketplace_listings` Meilisearch index.
2. **Browse/search** — only `status = active AND moderation_status = approved` listings are visible to browsing members (see the [Search guide](search.md)). Search uses Meilisearch with an SQL fallback; price-range and posted-within facets force the SQL path.
3. **Update / images / video / renew** — owner-only; re-indexed on save. Activation and renewal refuse suspended sellers and terminal `sold`/`reserved`/`removed` listings. Image reordering must contain every gallery image exactly once, and deleting the primary image promotes the next image atomically.
4. **Sold / reserved** — tracked inventory is decremented under a row lock. A listing whose inventory is intentionally untracked (`inventory_count = NULL`) remains available for subsequent orders; a finite inventory reaching zero becomes sold.
5. **Remove** — soft-removes (`status = removed`) and deletes the Meilisearch document.

Ownership is enforced in the controller (`ensureOwner()` → `FORBIDDEN` when `listing.user_id !== auth user`).

## Categories

`marketplace_categories` is a per-tenant (or global, `tenant_id = NULL`) hierarchy with `parent_id`, `slug` (unique per tenant), `icon`, `sort_order`, and `is_active`. Listings reference `category_id` (FK `ON DELETE SET NULL`). Category templates (`MarketplaceCategoryTemplate`, served by `categoryTemplate()`) drive per-category structured fields stored in the listing's `template_data` JSON.

## Buyer/seller order flow

`marketplace_orders.status` enum: `pending_payment | paid | shipped | delivered | completed | disputed | refunded | cancelled`.

1. **Create** — either `createFromOffer()` (from an unexpired `accepted` offer) or `createDirectPurchase()` (buy-now). Both run in a `DB::transaction`, generate an `MKT-NNNNNN` order number, snapshot `unit_price`/`total_price`/`currency`, and apply an optional merchant coupon (AG63). Checkout locks the listing and rechecks current tenant policy, seller state, moderation, expiry, inventory, and fulfilment. Accepted offers get a bounded checkout window; an unconverted expiry releases the reservation, while a cancelled unpaid attempt can create a clean replacement order without reusing coupon, pickup, or payment ledgers. Confirmation emails to both parties are sent **outside** the transaction.
2. **Pay** — `MarketplacePaymentService::confirmPayment()` (driven by the Stripe webhook / confirm endpoint) locks the order, sets `status = paid`, writes a `marketplace_payments` row, and — when escrow is enabled — calls `MarketplaceEscrowService::holdFunds()`. Paid notifications fire after commit.
3. **Ship** — seller-only (`markShipped`): `paid → shipped` with optional tracking; notifies the buyer.
4. **Confirm delivery** — buyer-only (`confirmDelivery`): → `delivered`, sets `auto_complete_at = now + 14 days`; notifies the seller.
5. **Complete** — `complete()` transitions `delivered/paid/shipped → completed` via an **atomic status-predicated `UPDATE`** so a buyer-confirm racing the auto-release cron (or a double-click) can only increment seller stats once. Sets `escrow_released_at`. Escrow release (`releaseFunds`) also calls `complete()`, so completion and payout are coordinated.
6. **Cancel** — only before shipped (`pending_payment`/`paid`); restores inventory or re-activates the listing; notifies both parties.
7. **Dispute** — `dispute()` opens a `marketplace_disputes` row; an open dispute blocks escrow auto-release (the escrow is marked `disputed` instead). Admin resolution releases or refunds.
8. **Rate** — after completion, buyer and seller can rate each other (`MarketplaceRatingService`, `rater_role`, optional anonymity).

### Click-and-collect (collection code)

For `delivery_method` involving pickup, sellers publish `marketplace_pickup_slots` (capacity, `slot_start`/`slot_end`, recurring patterns). When a seller has an active future slot, pickup checkout must choose one; non-pickup orders cannot attach one. A buyer reserves a slot for an order via `reserve()`, which locks and validates the slot, order, buyer, accepted-offer ownership, capacity, and future/active state before incrementing `booked_count` and minting a **QR collection code** (`qr_code`, a URL-safe ULID). At handover the seller calls `scanQr()`, which atomically consumes the code so concurrent or repeated scans cannot redeem it twice. There is no separate human-typed short code — the QR/ULID **is** the collection token.

## Money & credit handling

Three distinct settlement paths exist; be precise about which one applies:

- **Real money (Stripe Connect).** Gated by `marketplace.stripe_enabled`. Positive cash totals require the seller's Connect account to have details submitted and both charges and payouts enabled. Without escrow, `MarketplacePaymentService` creates a destination charge with an application fee and immediate transfer to the seller. PaymentIntent and Checkout Session are mutually exclusive checkout modes, claimed atomically; provider objects are bound only while the local order remains payable, otherwise they are cancelled or expired. Amount and fee conversion uses the currency exponent through `StripeCurrency`, never a blanket `× 100` cents assumption.
- **Zero-total cash orders.** A valid seller-funded coupon can reduce a cash order to zero. These orders settle locally and never create a zero-value Stripe object. Cancellation reverses coupon redemption and related local state through the same reconciled lifecycle.
- **Escrow.** Gated by `marketplace.escrow_enabled`. The payment is a separate platform charge; `holdFunds()` writes a `held` escrow (`amount = seller_payout`, `release_after = now + N days`, default 14), and release creates the seller transfer later. Funds release on `buyer_confirmed`, `auto_timeout`, `admin_override`, or `dispute_resolved`. Release, partial/full refund, dispute resolution, and payout reconciliation serialize on locked rows and use status-predicated updates so payout and refund cannot both win. A `UNIQUE(order_id)` constraint backstops concurrent holds.
- **Time credits.** Community delivery (`MarketplaceCommunityDeliveryService::confirmDelivery`) is the path that moves **time credits**: on confirmation the buyer's `users.balance` is debited and the deliverer's credited inside one `DB::transaction` (balance re-checked under lock; insufficient balance throws), writing a `transactions` ledger row with `transaction_type = 'community_delivery'`. Items can also carry a `time_credit_price` so the item itself is acquired with credits (`orders.time_credits_used`). Merchant coupons (AG63) discount the cash subtotal.

Merchant coupons are resolved from seller-owned server records; the client does not supply an authoritative discount. Fixed/minimum amounts obey currency precision, redemption counters are updated transactionally and reversed on eligible cancellation, and buy-one-get-one quantity/discount rules are derived on the server. Legacy fixed/minimum coupons without an explicit currency fail closed for currencies where a two-decimal assumption would be unsafe.

## Moderation, reports & sellers

- **Listing moderation** is optional (`marketplace.moderation_enabled`). When on, new listings are `pending` and must be approved by an admin (`AdminMarketplaceController::approveListing` / `rejectListing` / `bulkReject`) before they are searchable. There is **no** `marketplace.auto_approve_trusted` config key — the marketplace has no trusted-auto-approve setting (the similarly named `jobs.auto_approve_trusted` and `listing.auto_approve_trusted` belong to other modules).
- **DSA user reports** — any member can report a listing (`POST /v2/marketplace/listings/{id}/report` → `marketplace_reports`, handled by `MarketplaceReportService`). Admins list/acknowledge/resolve reports and view transparency stats (`/v2/admin/marketplace/{reports,transparency}`).
- **Seller management** — admins verify (`verifySeller`) or suspend (`suspendSeller`, which also pulls the seller's live listings to `removed`/`rejected`). Seller stats (`total_sales`, `total_revenue`) are incremented atomically on order completion.

## Security & privacy invariants

- Every marketplace `SELECT`/`UPDATE`/`DELETE` must include `tenant_id`; cron/webhook entry points must set tenant context (`runForTenant` / `setById`) before any scoped query.
- **Listing mutation is owner-gated** (`ensureOwner`); **ship is seller-only**, **confirm-delivery is buyer-only** — keep these gated to prevent IDOR.
- **Money/escrow transitions must use atomic status-predicated `UPDATE`s**, never an unconditional `save()` on a status read into memory — this is what prevents double-payout, refund-after-release, and double stat increments under concurrency.
- **Direct purchase must lock the listing row** and re-check availability/inventory inside the transaction.
- **Never trust client pricing or discount input.** The server snapshots the listing or accepted-offer price, resolves seller-owned coupons, enforces a maximum quantity of 100, and validates currency precision before creating an order.
- **Cash checkout requires a payout-ready seller and enabled card policy.** Re-check Connect readiness for each positive-total order and persist account disablement from `account.updated`; a stale local onboarding flag must not authorize a charge. Connect account creation is serialized and uses a stable provider idempotency key.
- **External evidence links are HTTP(S) only.** Submission validation rejects executable/opaque schemes, and admin rendering treats legacy unsafe values as text rather than clickable URLs.
- Email/notification rendering must wrap in `LocaleContext::withLocale($recipient, …)` so order/payout emails render in the recipient's `preferred_language`. Order notifications are de-duplicated per (order, event, user, channel) via `marketplace_order_notification_deliveries`.
- Notifications run **outside** the financial `DB::transaction` so a notification failure can never roll back a payment, payout, or credit transfer.
- Browse, group, collection, map, and AI-search paths expose only active, approved, unexpired listings from active, approved, non-suspended sellers. These are authenticated reads (`auth:sanctum`), and the feature gate is applied on top of that in the controller.

## Failure modes & recovery

| Failure | How it is handled |
| --- | --- |
| **Feature disabled** | All marketplace endpoints (including browse/search) return `FEATURE_DISABLED` (403) to authenticated callers. Unauthenticated callers get 401 from `auth:sanctum` first. |
| **Two buyers race the same item** | Direct purchase locks the listing row and re-checks `status = active` / inventory inside the transaction; the loser gets "no longer available". |
| **Buyer-confirm races auto-release cron** | Atomic status-predicated completion / escrow release: exactly one caller wins; the loser is a no-op (stats untouched, no second payout). |
| **Concurrent escrow hold** | `UNIQUE(order_id)` plus an exists-check; a concurrent `holdFunds()` returns the existing escrow. |
| **Refund vs release race** | `refundEscrow()` claims `held\|disputed` atomically; if the escrow already `released`, the refund throws rather than overwriting (prevents paying seller AND refunding buyer). |
| **Stripe refund/dispute vs transfer-in-flight** | Webhook reconciliation, manual refund, and escrow release share the same per-payment money-movement lock. A `scheduled`/ambiguous payout defers the webhook until the transfer result is durable; later lost-dispute events can still reverse a payout after an earlier zero-reversal hold. |
| **Fee config changes during checkout** | Provider objects carry the exact total, platform fee, seller payout, currency, parties, and funds-flow metadata. Confirmation validates and persists those bound economics instead of recomputing from mutable tenant config. |
| **Open dispute at auto-release time** | `processAutoReleases()` marks the escrow `disputed` (conditional on still being `held`) and skips payout. |
| **Stripe webhook / payment confirm** | `confirmPayment` is idempotent on `stripe_payment_intent_id` (UNIQUE); escrow hold is supplementary — a failed hold is logged but does not unwind a succeeded payment. |
| **Order cancelled while Stripe checkout is being created** | The provider object is bound only after locking and re-checking the payable order; an object that loses the race is cancelled or expired. |
| **Connect account becomes disabled** | `account.updated` writes both the enabled and disabled state; positive-total order creation and provider checkout re-check seller readiness. |
| **Duplicate pickup reservation / full slot / past slot** | `reserve()` throws typed `DomainException` (`DUPLICATE_RESERVATION`, `SLOT_FULL`, `SLOT_PAST`, `SLOT_INACTIVE`). |
| **Community delivery, buyer underfunded** | Balance re-checked under lock at `confirmDelivery`; throws insufficient-balance and rolls back — no partial credit move. |
| **Meilisearch unavailable** | Listing index/sync no-ops; browse falls back to SQL `LIKE` (see Search guide). Backfill with `php scripts/sync_search_index.php --tenant=<id> --type=marketplace`. |
| **Notification/email failure** | Caught, logged, recorded in the delivery ledger; never rolls back a committed financial transaction. |

Recovery: financial and reservation operations are atomic, so a failed operation leaves no partial state — retry. For a stuck order, inspect `marketplace_orders.status`, the linked `marketplace_payments`/`marketplace_escrow` rows, and `marketplace_order_notification_deliveries` for what was delivered. Escrows past `release_after` are swept hourly by `processAutoReleases()`.

## Test commands & key regression tests

Run the backend suites (run heavy suites one at a time):

```bash
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always
```

Targeted runs:

```bash
vendor/bin/phpunit --filter=Marketplace
vendor/bin/phpunit tests/Laravel/Unit/Services/MarketplaceEscrowServiceTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/MarketplaceOrderServiceTest.php
```

Important test files:

| Test | What it locks down |
| --- | --- |
| `tests/Laravel/Unit/Services/MarketplaceOrderServiceTest.php` | Order lifecycle, atomic completion / double-complete no-op, cancellation + inventory restore. |
| `tests/Laravel/Unit/Services/MarketplaceEscrowServiceTest.php` | Hold/release/refund races, auto-release, dispute blocking, no double-payout. |
| `tests/Laravel/Unit/Services/MarketplacePaymentServiceTest.php` | Stripe Connect intents/fees, refunds. |
| `tests/Laravel/Unit/Services/MarketplaceCommunityDeliveryServiceTest.php` | Time-credit settlement, insufficient-balance rollback. |
| `tests/Laravel/Unit/Services/MarketplaceListingServiceTest.php` | Create/update/renew, moderation gating, max-active enforcement. |
| `tests/Laravel/Unit/Services/MarketplaceOfferServiceTest.php` | Offer accept/decline/counter → order. |
| `tests/Laravel/Feature/Controllers/Marketplace*ControllerTest.php`, `AdminMarketplaceControllerTest.php` | Feature gating (including the browse/content routes), ownership/role gates, moderation, reports, seller verify/suspend. |

React: `react-frontend/src/pages/marketplace/*.test.tsx` (e.g. `npm test -- BuyerOrdersPage`).

## Related references

- [modules/listings.md](listings.md) — the **timebanking** Listings module (distinct table/service; do not conflate).
- [modules/wallet-exchanges.md](wallet-exchanges.md) — the time-credit ledger that community delivery and `time_credit_price` settle against.
- [modules/search.md](search.md) — the `marketplace_listings` Meilisearch index and SQL fallback.
- [`routes/api.php`](../../routes/api.php) — authoritative endpoint list (do not duplicate here).
- [ARCHITECTURE.md](../ARCHITECTURE.md) — runtime boundaries.
