# Monetization Module Guide

Last reviewed: 2026-07-30

This guide is a how-to/reference for maintainers of the three optional **monetization** sub-features in Project NEXUS: **Member Premium** subscriptions, **Merchant Coupons**, and **Local Advertising**. All three are opt-in, default-OFF, and tenant-scoped. They are independent surfaces with separate feature flags, services, tables, and routes — there is no shared "monetization" service.

> Real-money vs time-credits: **Member Premium charges real money via Stripe.** Merchant Coupons and Local Advertising do **not** charge platform money — coupons are merchant-defined discounts that members redeem in-store/online, and ad budgets are tracked as internal cents counters, not Stripe charges. Time credits ("hours") are never involved in any of these three features. The time-credit ledger is documented separately in [wallet-exchanges.md](wallet-exchanges.md).

## Audience & supported workflows

Use this guide when changing premium tiers, the member-subscription billing path, merchant coupon issuance/redemption, or the local ad campaign lifecycle.

Supported workflows:

- **Member Premium** — a tenant defines paid tiers; members subscribe through Stripe Checkout; tier feature keys gate UI/server logic; Stripe webhooks keep subscription status in sync.
- **Merchant Coupons** — a marketplace seller issues discount coupons (percent / fixed / BOGO); members browse and redeem them, either online against a marketplace order or in-store via a one-time QR token scanned by seller staff.
- **Local Advertising** — an advertiser submits an ad campaign with creatives for admin review; approved campaigns are served into feed placements; impressions and clicks are tracked, with click cost deducted from an internal budget counter.

## Tenant & feature-gate rules

All three features default OFF. The defaults live in `app/Services/TenantFeatureConfig.php`:

| Feature flag | Default | Sub-feature |
| --- | --- | --- |
| `member_premium` | `false` | Member Premium subscriptions |
| `merchant_coupons` | `false` | Merchant Coupons (also requires `marketplace`) |
| `local_advertising` | `false` | Local Advertising |

Gate enforcement:

- **Member Premium** — `MemberPremiumController::guardFeature()` returns `FEATURE_DISABLED` (HTTP 403) when `member_premium` is off. The public tier-list endpoint (`GET /v2/member-premium/tiers`) is unauthenticated (`withoutMiddleware('auth:sanctum')`) but still gated. On the React side there is no premium-specific gate component: the `/premium*` routes use the generic `<FeatureGate feature="member_premium" redirect="/">`, so a tenant without the feature is redirected to `/` rather than seeing a degraded page.
- **Merchant Coupons** — both `MerchantCouponController` and `MerchantCouponSellerController` call `ensureFeature()`, which requires **both** `marketplace` AND `merchant_coupons` and `abort(403)`s otherwise. Note `MerchantOnboardingController` (the seller-profile wizard) gates only on `marketplace`, not `merchant_coupons`.
- **Local Advertising** — `LocalAdvertisingController::featureEnabled()` checks `local_advertising`, but **admins bypass the gate** (roles `admin`/`tenant_admin`/`super_admin`/`god`, or the super-admin flags) so they can configure advertising before enabling it for members. The public `GET /v2/ads/active` returns an empty array (not a 403) when the feature is off, so the feed never errors.

Every service additionally guards against its tables not yet existing. `LocalAdvertisingService::isAvailable()` and `MerchantOnboardingService::isAvailable()` use `Schema::hasTable(...)`; advertising methods throw a `RuntimeException` if tables are missing, and the controller degrades gracefully (empty data / `service_unavailable`).

**Tenant scoping is mandatory.** Every query is scoped by `App\Core\TenantContext::getId()`. `member_premium_tiers`, `member_subscriptions`, `merchant_coupons`, `merchant_coupon_redemptions`, and all four `ad_*` tables carry `tenant_id`, and every read/write/redemption filters on it.

## Real-money handling (Member Premium / Stripe)

**Member Premium is the only one of the three that moves real money.** It uses Stripe Checkout (mode `subscription`), the Stripe Billing Portal, and Stripe webhooks. Key invariants:

- **Stripe is the source of truth for billing state.** Our `member_subscriptions` rows are a projection updated by webhook handlers, never the authority. `MemberPremiumService::createCheckoutSession()` only opens the session; the subscription row is created/updated when `checkout.session.completed` / `customer.subscription.*` / `invoice.*` events arrive.
- **Prices are stored in minor units** (`monthly_price_cents` / `yearly_price_cents`, `unsignedInteger`). `syncTierToStripe()` creates a Stripe Product + recurring Prices and persists `stripe_price_id_monthly` / `stripe_price_id_yearly` back onto the tier. Checkout fails with a clear error if the tier has no synced Price for the requested interval — an admin must run **Sync to Stripe** first.
- **Currency is per-tenant.** `TenantContext::getCurrency()` resolves the tenant's `default_currency` setting, falling back to `services.stripe.default_currency` / `STRIPE_DEFAULT_CURRENCY` / `eur`.
- **Metadata routing.** Every member-premium Stripe object is stamped with `metadata.nexus_kind = 'member_premium'` (plus `nexus_user_id` / `nexus_tenant_id` / `nexus_tier_id` / `nexus_interval`). The shared `StripeWebhookController` inspects this via `MemberPremiumService::eventBelongsHere()` and routes member-premium events to `MemberPremiumService::applyWebhookEvent()`; events **without** that marker fall through to `StripeSubscriptionService` (tenant-plan billing) or the marketplace/donation handlers.
- **Webhook security & idempotency** are handled centrally in `StripeWebhookController::handleWebhook()`: signature verification via `StripeService::constructWebhookEvent()`, and an atomic `INSERT IGNORE` claim on `stripe_webhook_events.event_id` (globally unique Stripe IDs — no tenant in the dedup key). A handler crash marks the row `failed`, calls `report($e)` so it reaches Sentry, and returns 500 so Stripe retries; `app/Console/Commands/StuckStripeWebhookCheck.php` alarms on stuck rows.
- **Entitlement.** `statusIsEntitled()` treats `active`/`trialing` as entitled, and `past_due`/`grace` as entitled only while `grace_period_ends_at` is in the future (a 7-day grace window is set on `invoice.payment_failed`). `hasUnlocked($userId, $featureKey)` is the server-side gate; the `unlocked_features` array it returns is consumed directly by the premium pages (e.g. `pages/premium/MySubscriptionPage.tsx`).
- **Email never fails the webhook.** Billing notification emails (`payment_failed` / `paid` / `cancelled`) are sent inside `LocaleContext::withLocale($recipient, ...)` so they render in the member's `preferred_language`; a send failure is logged but does not fail the webhook (Stripe would otherwise retry for days). Send state is tracked per event in `member_subscription_events` (`notification_sent_at` / `notification_failed_at` / `notification_last_error`).

> `StripeSubscriptionService` (tenant **plan** billing — `pay_plans` / `tenant_plan_assignments`) shares the same Stripe account, webhook endpoint, and patterns, but it bills the *community* for its platform plan, not individual members. It is adjacent to, not part of, this module. Free plans (price 0/0) are activated directly without a Stripe round-trip.

## Non-money handling (Coupons / Advertising)

- **Merchant Coupons carry no platform charge.** A coupon describes a discount a merchant honours; redemption records the discount applied (`discount_applied_cents`) but moves no money through the platform. `discount_value` is `decimal(10,2)`; `min_order_cents` and `discount_applied_cents` are integer minor units. Discount math is in `calculateDiscountCents()` (percent clamped 0–100; fixed clamped to order total; BOGO defaults to 50%-off-total unless the caller adjusts line items).
- **Local Advertising budgets are internal counters, not Stripe charges.** `budget_cents` / `spent_cents` are `unsignedBigInteger` columns. A click deducts a flat `DEFAULT_CPC_CENTS` (10 cents) from `spent_cents` via `recordClick()`. No real payment is taken; "revenue" in `getOverviewStats()` is the sum of `spent_cents`, an internal accounting figure only.

## Key code & data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). Do not copy the endpoint tables here — read the route file or the OpenAPI/`docs/API.md` reference for the live list. Primary entry points:

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Member Premium (member-facing) | `/v2/member-premium/*` | `App\Http\Controllers\Api\MemberPremiumController` |
| Member Premium (admin) | `/v2/admin/member-premium/*` | `App\Http\Controllers\Api\Admin\MemberPremiumAdminController` |
| Coupons (member browse/redeem) | `/v2/coupons/*` | `App\Http\Controllers\Api\MerchantCouponController` |
| Coupons (seller CRUD) | `/v2/marketplace/seller/coupons/*` | `App\Http\Controllers\Api\MerchantCouponSellerController` |
| Coupons (admin moderation) | `/v2/admin/marketplace/coupons/*` | `App\Http\Controllers\Api\Admin\MerchantCouponAdminController` |
| Merchant onboarding wizard | `/v2/merchant-onboarding/*` | `App\Http\Controllers\Api\MerchantOnboardingController` |
| Advertising (advertiser + admin + beacons) | `/v2/me/ad-campaigns/*`, `/v2/admin/ad-campaigns/*`, `/v2/ads/*` | `App\Http\Controllers\Api\LocalAdvertisingController` |
| Stripe webhooks (shared) | `/v2/webhooks/stripe`, `/v2/marketplace/webhooks/stripe` | `App\Http\Controllers\Api\StripeWebhookController` |

Services:

- `app/Services/MemberPremiumService.php` — tier CRUD, Stripe sync, member checkout/cancel/billing-portal, webhook handlers, entitlement (`hasUnlocked`), and admin subscriber listings.
- `app/Services/StripeSubscriptionService.php` — tenant-plan billing (adjacent; not member premium).
- `app/Services/StripeService.php` — Stripe client + webhook signature verification (shared by all Stripe surfaces).
- `app/Services/MerchantCouponService.php` — coupon issuance, validation, atomic redemption, and the QR-token in-store flow.
- `app/Services/MerchantOnboardingService.php` — 4-step seller-profile wizard; grants the `marktplatz_partner` badge on completion.
- `app/Services/LocalAdvertisingService.php` — ad campaign/creative CRUD, ad serving, signed impression/click tracking, stats.

Models / tables:

- Member Premium: `member_premium_tiers`, `member_subscriptions`, `member_subscription_events`. Stripe customer id is also persisted on `users.stripe_customer_id` (and `tenants.stripe_customer_id` for tenant plans).
- Coupons: `merchant_coupons` (`App\Models\MerchantCoupon`), `merchant_coupon_redemptions` (`App\Models\MerchantCouponRedemption`); seller identity via `marketplace_seller_profiles`.
- Advertising: `ad_campaigns`, `ad_creatives`, `ad_impressions`, `ad_clicks`.
- Shared Stripe state: `stripe_webhook_events` (idempotency ledger).

Frontend entry points (React, all under `react-frontend/src/`):

- Premium: `pages/premium/PricingPage.tsx` (`/premium`), `MySubscriptionPage.tsx` (`/premium/manage`), `SubscriptionReturnPage.tsx` (`/premium/return`). All `/premium*` routes are wrapped in the generic `<FeatureGate feature="member_premium" redirect="/">` in `react-frontend/src/routes/AppRoutes.tsx`; there is no dedicated premium gate component.
- Coupons: `pages/coupons/CouponsPage.tsx` (`/coupons`), `CouponDetailPage.tsx`; seller `pages/marketplace/seller/SellerCouponsPage.tsx` + `SellerCouponEditPage.tsx`; `pages/marketplace/MerchantOnboardingPage.tsx`. Coupon routes are `FeatureGate feature="merchant_coupons"`.
- Advertising: `pages/advertise/MyAdCampaignsPage.tsx` (`/advertise/campaigns`), `MyPushCampaignsPage.tsx`. Gated by `ProtectedRoute` + `FeatureGate feature="local_advertising"`.
- Admin: `admin/modules/premium/*`, `admin/modules/marketplace/AdminCouponsPage.tsx`, `admin/modules/advertising/*`.

## Member Premium lifecycle

1. **Admin defines tiers** (`createTier` / `updateTier`) with `slug`, `name`, prices in cents, and an open-ended `features` array (common keys: `verified_badge`, `priority_matching`, `advanced_search`, `ad_free`). Tiers cannot be deleted while they have active/trialing/past_due/grace subscribers (`deleteTier` throws) — deactivate instead.
2. **Admin syncs to Stripe** (`syncTierToStripe`) to create the Stripe Product + Prices and store the price ids.
3. **Member subscribes** — `createCheckoutSession()` resolves/creates the Stripe customer (persisting `users.stripe_customer_id` when the column exists), opens a Checkout session for the chosen interval, and returns the hosted `checkout_url`. The `return_url` is sanitised by `safeReturnUrl()` to prevent open-redirect.
4. **Stripe webhooks drive state** — `checkout.session.completed` upserts the row to `active`; `customer.subscription.updated` refines status/period dates (mapping Stripe statuses to `active`/`trialing`/`past_due`/`canceled`/`incomplete`); `invoice.payment_failed` sets `past_due` + 7-day grace; `invoice.paid` clears grace back to `active`; `customer.subscription.deleted` marks `canceled`.
5. **Member manages/cancels** — `cancel()` sets Stripe `cancel_at_period_end` (default) and stamps `canceled_at`; `createBillingPortalSession()` returns a Stripe Billing Portal URL.

## Merchant Coupon lifecycle & redemption

- **Issuance.** `issueCoupon()` enforces a unique code per tenant, defaults `status` to `draft`, and supports `discount_type` of `percent` / `fixed` / `bogo`, scope (`all_listings` / `listing_ids` / `category_ids`), validity window, `max_uses`, and `max_uses_per_member` (default 1).
- **Validation.** `validateCoupon()` checks active status, validity window, minimum order, total usage cap, per-member cap, and scope; it throws `InvalidArgumentException` on any failure (surfaced as HTTP 422).
- **Atomic redemption.** `redeemForOrder()` runs inside `DB::transaction(...)`, locks the coupon row with `lockForUpdate()`, re-checks every limit under the lock, inserts a `merchant_coupon_redemptions` row, and increments `usage_count` — so two concurrent redemptions cannot exceed the cap.
- **In-store QR flow.** `generateQrToken()` runs a pre-flight `validateCoupon()` and writes a 16-char one-time token to the cache with a **5-minute** TTL (`QR_TTL_SECONDS = 300`) keyed by tenant; no DB row is written yet. `redeemQrToken()` is staff-side: it verifies the scanning user owns the seller profile that issued the coupon (`marketplace_seller_profiles`), then performs the same atomic `redeemForOrder()` (method `qr_scan`) and forgets the token. Tokens are tenant-scoped in the cache key.

## Local Advertising lifecycle & tracking

- **Submit → review → serve.** `createCampaign()` starts at `pending_review`. An admin `approveCampaign()` (→ `active`, records approver), `rejectCampaign()` (→ `rejected` with reason), or `pauseCampaign()` (→ `paused`). `getActiveAds()` serves only active campaigns whose placement matches, whose date window is current, and whose budget is not exhausted (`budget_cents = 0` means unlimited).
- **Signed tracking tokens.** Each served creative carries a `tracking_token`: an HMAC-SHA256 (`app.key`-derived secret) over `{tenant, campaign, creative, placement, expiry}`, base64url-encoded, with a 15-minute TTL. `recordImpression()` rejects a missing/invalid/expired token and re-checks that the creative is genuinely serveable before inserting an `ad_impressions` row and incrementing `impression_count`.
- **Click accounting.** `recordClick()` is idempotent per impression (a second click on the same impression is a no-op), inserts an `ad_clicks` row, increments `click_count`, and adds `DEFAULT_CPC_CENTS` (10) to `spent_cents`. Creative `destination_url`s are validated against `OutboundUrlGuard::isSafeBrowserUrl()` at creation to block unsafe redirects.
- **Beacons never break UX.** The impression/click controller methods swallow errors and return success-shaped payloads so ad tracking can never surface an error to the user or break the feed.

## Security & privacy invariants

- Every coupon/subscription/campaign read, write, redemption, and tracking event is scoped by `tenant_id`. Never issue an `UPDATE`/`DELETE`/redemption without it.
- Member-facing tier responses strip `stripe_price_id_monthly` / `stripe_price_id_yearly` (`MemberPremiumController::listTiers`) — Stripe price ids are never sent to the browser.
- Stripe webhook endpoints are public (no auth/CSRF) but protected by signature verification + global event-id idempotency. Member-premium routing depends on the `nexus_kind` metadata marker; do not strip it.
- `return_url` for checkout/billing-portal is validated by `MemberPremiumService::safeReturnUrl()` (rejects protocol-relative, control chars, and off-tenant hosts) to prevent open-redirect.
- Coupon QR redemption requires the scanner to own the issuing seller profile; QR tokens are one-time and expire in 5 minutes.
- Ad impression/click tokens are HMAC-signed and time-limited; creative destination URLs are guarded against unsafe schemes/SSRF-style targets.
- Coupon redemption and member-subscription state changes are atomic (row lock / DB transaction) so usage caps and entitlements cannot be exceeded under concurrency.

## Failure modes & recovery

| Failure | How it is handled |
| --- | --- |
| **Tier has no synced Stripe Price** | `createCheckoutSession()` throws a clear error; admin must run **Sync to Stripe**. |
| **Stripe webhook handler crashes** | Row marked `failed`, `report()` to Sentry, 500 returned so Stripe retries; stuck rows alarmed by `StuckStripeWebhookCheck`. Re-delivery reclaims `failed`/stale `processing` rows. |
| **Duplicate webhook delivery** | `INSERT IGNORE` on `stripe_webhook_events.event_id` suppresses the second; endpoint acks 200. |
| **Billing email fails** | Logged, never fails the webhook; per-event send state recorded in `member_subscription_events`. |
| **Payment fails / past due** | Subscription → `past_due` with 7-day `grace_period_ends_at`; member stays entitled during grace; `invoice.paid` restores `active`. |
| **Concurrent coupon redemption** | Coupon row `lockForUpdate()` inside a transaction; caps re-checked under lock; over-redeem is impossible. |
| **Expired / over-used / out-of-scope coupon** | `validateCoupon()` / `redeemForOrder()` throw `InvalidArgumentException` → HTTP 422 with a specific message. |
| **Expired or forged QR token** | `redeemQrToken()` rejects invalid/expired tokens and non-owning staff. |
| **Ad tables missing (mid-migration)** | `isAvailable()` false → graceful degradation (empty data / `service_unavailable`); beacons return success-shaped no-ops. |
| **Ad budget exhausted** | `getActiveAds()` / `isServeableCreative()` exclude the campaign; clicks stop accruing spend. |
| **Forged/expired ad tracking token** | `recordImpression()` rejects it before writing any row. |

## Test commands & key regression tests

Run the backend suites (these may be run in parallel — see [local performance](../LOCAL-PERFORMANCE.md)):

```bash
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always
```

Targeted runs:

```bash
vendor/bin/phpunit tests/Laravel/Unit/Services/MemberPremiumServiceTest.php
vendor/bin/phpunit tests/Laravel/Feature/Marketplace/MerchantOnboardingWizardTest.php
```

Important regression tests:

| Test | What it locks down |
| --- | --- |
| `tests/Laravel/Unit/Services/MemberPremiumServiceTest.php` | Tier CRUD, entitlement/grace logic, webhook upsert/status mapping, `member_premium` metadata routing. |
| `tests/Laravel/Integration/MemberPremiumBillingEmailTest.php` | Billing emails render in the recipient's locale and never fail the webhook. |
| `tests/Laravel/Feature/Controllers/StripeWebhookControllerTest.php` | Signature verification, event-id idempotency, and member-premium vs tenant-plan routing. |
| `tests/Laravel/Feature/Console/StuckStripeWebhookAlertTest.php` | Stuck/failed webhook rows are detected and alarmed. |
| `tests/Laravel/Feature/Marketplace/MerchantOnboardingWizardTest.php` | 4-step seller-profile wizard + `marktplatz_partner` badge grant. |
| `tests/Laravel/Unit/Services/StripeSubscriptionServiceTest.php`, `tests/Laravel/Integration/StripeSubscriptionReminderEmailTest.php` | Adjacent tenant-plan billing (free-plan direct activation, reminder emails). |

React tests (run from `react-frontend/`):

```bash
npm test -- MySubscriptionPage
npm test -- PricingPage
npm test -- CouponsPage
```

## Related references

- [wallet-exchanges.md](wallet-exchanges.md) — the time-credit ledger (distinct from real-money premium).
- [listings.md](listings.md) — marketplace listings/orders that coupons discount.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — runtime boundaries.
- [MODULES.md](../MODULES.md) — module map and guide checklist.
- [`routes/api.php`](../../routes/api.php) — authoritative endpoint list (do not duplicate here).
