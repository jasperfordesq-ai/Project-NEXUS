# Listings / Marketplace Module Guide

Last reviewed: 2026-07-30

Audience: maintainers and contributors working on the listings module — the offer/request board at the heart of the timebanking workflow.

## Overview

Listings are the primary way members advertise services they can offer or request from their community. Every listing is classified as either an **offer** (member can provide the service) or a **request** (member needs the service). An approved listing with `status = active` and `moderation_status = approved` is visible to authenticated members of the same tenant. The primary browse and detail routes are not anonymous.

Separate from the time-credit listings module, a **Marketplace** subsystem (`/v2/marketplace/*`) handles physical-goods commerce with pricing, inventory, escrow, seller profiles, and delivery. The marketplace uses its own `marketplace_listings` table and service layer. This guide covers the timebanking listings module; for the Marketplace, see `app/Services/MarketplaceListingService.php` and the routes grouped under `/v2/marketplace/` in `routes/api.php`.

## Audience and supported workflows

Use this guide when changing listing creation, moderation, expiry, search indexing, or the path from a listing to an exchange request.

Supported workflows:

- **Browse and search** — authenticated tenant members can list, filter, and search active approved listings.
- **Create offer or request** — authenticated members create listings; if moderation is enabled they enter `pending_review` first.
- **Edit / pause / delete** — the listing owner or an admin can update fields, pause a listing (`status = paused`), or soft-delete it (`status = deleted`).
- **Renew** — owners extend the expiry date by 30 days (currently a fixed maximum of 12 renewals).
- **Favourite / save** — authenticated members can save listings to a personal list.
- **Moderation** — admins review the pending queue, approve or reject with a reason.
- **Featured / boosted** — admins pin listings to the top of the browse page via `is_featured`.
- **Initiate an exchange** — a member clicks "Request this service" on a listing; this creates an `exchange_requests` row that begins the exchange workflow (see [docs/modules/wallet-exchanges.md](wallet-exchanges.md)).
- **Analytics** — listing owners can view their own view/contact/save counts.

## Tenant and feature-gate rules

- **Module gate:** `listings`. All listing routes are wrapped in `Route::middleware('module:listings')` in `routes/api.php`. The React frontend wraps the listings pages in `<FeatureGate module="listings" redirect="/" />` in `react-frontend/src/routes/AppRoutes.tsx`.
- **Authentication:** browse, detail, featured, nearby, CRUD, analytics, reports, and favourites inherit `auth:sanctum`. Only the popular-tag and tag-autocomplete helper routes deliberately remove that middleware while retaining the module gate.
- The module defaults to **enabled**. `listings` is a *module* default, not a feature default: `App\Services\TenantFeatureConfig::MODULE_DEFAULTS['listings'] => true`, and `listings: true` in the React `defaultModules` map (`react-frontend/src/contexts/TenantContext.tsx`). There is no `TenantContext::FEATURE_DEFAULTS` constant — `app/Core/TenantContext.php` only references `TenantFeatureConfig::FEATURE_DEFAULTS`, which does not contain `listings`. A tenant admin can disable the module to hide the board entirely.
- **Tenant scoping is enforced by the `HasTenantScope` trait** on `App\Models\Listing`. Every query automatically includes `WHERE tenant_id = <current>`. Never bypass this; always use `TenantContext::getId()` in raw queries.
- Category resolution (slug → id) is also tenant-scoped: `WHERE type = 'listing' AND tenant_id = ?`.
- The `user_saved_listings` table carries an explicit `tenant_id` column; favourite operations filter on it.

## Key code and data locations

Routes are in [`routes/api.php`](../../routes/api.php) (search for `module:listings`). Do not copy the full endpoint table here — read the route file directly. Primary entry points:

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Member browse / search / nearby | `GET /v2/listings` | `App\Http\Controllers\Api\ListingsController` |
| Single listing detail | `GET /v2/listings/{id}` | `App\Http\Controllers\Api\ListingsController` |
| CRUD (create / update / delete) | `POST/PUT/DELETE /v2/listings` | `App\Http\Controllers\Api\ListingsController` |
| Renew / analytics / tags / report | `POST /v2/listings/{id}/renew` etc. | `App\Http\Controllers\Api\ListingsController` |
| Featured listings | `GET /v2/listings/featured` | `App\Http\Controllers\Api\ListingsController` |
| Admin moderation queue | `/v2/admin/listings/*` | `App\Http\Controllers\Api\AdminListingsController` |

Services:

- `app/Services/ListingService.php` — all listing CRUD, public visibility filter, cursor pagination, Haversine proximity search, and the `canModify()` permission check.
- `app/Services/ListingModerationService.php` — approve / reject workflow, review queue, moderation stats.
- `app/Services/ListingExpiryService.php` — processes expired listings across tenants (scheduled), and one-click renewal. The service currently hardcodes max 12 renewals and +30 days.
- `app/Services/ListingFeaturedService.php` — sets/clears `is_featured` and `featured_until`.
- `app/Services/ListingConfigurationService.php` — typed tenant config with Redis cache (5-minute TTL). Keys live in `tenant_settings` with a `listing.` prefix.
- `app/Services/ListingSkillTagService.php` — tag CRUD on `listing_skill_tags`; autocomplete and popular tags.
- `app/Services/ListingAnalyticsService.php` — records views (dedup by IP hash), increments save counts, returns owner analytics.
- `app/Services/ListingRankingService.php` — post-query MatchRank re-ranking (engagement × quality × reciprocity × personalisation score). Applied in `ListingsController::index()` unless `sort=newest` or proximity is active.

Models and tables:

| Model / table | Purpose |
| --- | --- |
| `App\Models\Listing` / `listings` | Core listing row |
| `listing_skill_tags` | Many-to-many skill tags on a listing |
| `listing_images` / `App\Models\ListingImage` | Up to N images per listing (configurable, default 5) |
| `listing_views` | View events with IP-hash deduplication; the current listing-detail API requires authentication even though the schema can represent a nullable user |
| `listing_reports` / `App\Models\ListingReport` | Community abuse reports awaiting admin review |
| `user_saved_listings` | Favourites (userId × listingId × tenantId) |
| `categories` | Tenant-scoped listing categories (`type = 'listing'`) |
| `exchange_requests` | Exchanges initiated from a listing (`listing_id` FK) |

Frontend entry points (React):

- `react-frontend/src/pages/listings/ListingsPage.tsx` — browse / filter UI.
- `react-frontend/src/pages/listings/ListingDetailPage.tsx` — single listing with reciprocity panel, member offers/requests, "Request this service" CTA.
- `react-frontend/src/pages/listings/CreateListingPage.tsx` — creation form with AI description helper.
- `react-frontend/src/components/compose/tabs/ListingTab.tsx` — quick-create listing from the global compose drawer.

## Listing data model

Key columns on the `listings` table:

| Column | Type | Notes |
| --- | --- | --- |
| `tenant_id` | int | FK to `tenants.id`; enforced by `HasTenantScope` |
| `user_id` | int | Listing owner; FK to `users.id` (CASCADE DELETE) |
| `type` | varchar(50) | `offer` or `request` — the core distinction |
| `status` | enum | `active`, `draft`, `paused`, `expired`, `deleted`, `pending`, `rejected`, `closed`, `inactive`, `completed` |
| `moderation_status` | enum | `NULL` (not moderated), `pending_review`, `approved`, `rejected` |
| `hours_estimate` | decimal(5,2) | Suggested time cost in hours (0.5–2000) |
| `service_type` | enum | `physical_only`, `remote_only`, `hybrid`, `location_dependent` |
| `federated_visibility` | enum | `none`, `listed`, `bookable` — controls federation partner visibility |
| `is_featured` | tinyint | Set by admin; pins listing to top of browse page |
| `featured_until` | datetime | Optional expiry for the featured window |
| `expires_at` | datetime | Auto-expiry date set by `listing.auto_expire_days` config |
| `renewal_count` | int unsigned | Times renewed; current service cap is hardcoded at 12 |
| `sdg_goals` | JSON | Optional UN Sustainable Development Goals tags (integers 1–17) |
| `availability` | JSON | Free-form availability schedule |
| `direct_messaging_disabled` | tinyint | Disables direct contact; forces use of the exchange workflow |
| `exchange_workflow_required` | tinyint | Marks listing as requiring formal exchange |

**Member visibility rule** (enforced in `ListingService::applyPublicVisibility()`): a listing is visible to members only when `(status IS NULL OR status = 'active') AND (moderation_status IS NULL OR moderation_status = 'approved')`. Draft, paused, expired, deleted, pending, and rejected listings are hidden from non-owners.

## Offer / request model

The `type` column is the single source of truth:

- **`offer`** — the listing author is offering a service; any member can request it.
- **`request`** — the author needs help; any member can respond.

Both types use the same table, routes, and exchange workflow. The tenant can disable one or both types via `listing.allow_offers` / `listing.allow_requests` configuration keys. An attempt to create a listing of a disabled type returns HTTP 422.

## Lifecycle: create → active → expired

```
POST /v2/listings
        │
        ├─ moderation enabled? ──yes──► status=pending, moderation_status=pending_review
        │                                    │
        │                               admin reviews
        │                                    ├── approve ──► status=active, moderation_status=approved → feed_activity
        │                                    └── reject  ──► status=rejected, moderation_status=rejected + reason
        │
        └─ moderation disabled? ─────► status=active, moderation_status=approved → feed_activity
                                              │
                                         expires_at reached?
                                              │ (cron: ListingExpiryService::processAllTenants)
                                              ▼
                                        status=expired → expiry email + bell notification
                                              │
                                        owner renews?
                                         (POST /v2/listings/{id}/renew)
                                              ▼
                                        status=active, expires_at += 30 days
```

**Status transitions** controlled by `ListingService::update()`:

- Non-admin callers may only set `active`, `draft`, or `paused`.
- Setting `status=active` on a `deleted`, `suspended`, or `rejected` listing is blocked for non-admin callers.
- `deleted` status is set by `ListingService::delete()` only; it is a soft delete — the row remains.

**Soft delete side effects** (all within the same tenant scope):

- `listing_skill_tags`, `user_saved_listings`, `listing_views`, `listing_contacts` rows for the listing are deleted.
- `SearchService::removeListing()` removes the document from the Meilisearch `listings` index.
- `ListingObserver` marks matching feed activity as `is_visible = 0`; the feed row is retained rather than hard-deleted.

## Categories and skill tags

**Categories** are managed per tenant under `categories WHERE type = 'listing'`. They carry `name`, `color`, and `slug`. Tenants control via admin UI whether a category is required (`listing.require_category` defaults to `true`). The API accepts either `category_id` (integer) or `category` (slug, resolved to ID inside the service).

**Skill tags** live in `listing_skill_tags` (one row per tag per listing). They are normalised to lowercase. The API endpoint `PUT /v2/listings/{id}/tags` replaces the full tag set atomically. Tags are indexed in the Meilisearch `listings` index as an array field `skill_tags`, enabling filter expressions like `skill_tags = 'gardening'`.

- Popular tags: `GET /v2/listings/tags/popular`
- Autocomplete (min 2 chars): `GET /v2/listings/tags/autocomplete?q=<prefix>`

## Search indexing

Listings are indexed in Meilisearch under the `listings` index. See [docs/modules/search.md](search.md) for the index schema, ranking rules, and synonym map.

**Indexing trigger:** the `ListingCreated` event fires after a new listing is saved to the database. The queued listener `App\Listeners\UpdateFeedOnListingCreated` calls `SearchService::indexListing($event->listing)`. The same listener updates `feed_activity`. Index updates on edit are handled at save time via model observers.

**Index document shape:**

| Field | Source |
| --- | --- |
| `id`, `tenant_id`, `user_id` | `listings` columns |
| `title`, `description`, `location` | `listings` columns |
| `type`, `category_id`, `category_name` | `listings` + `categories` join |
| `status`, `moderation_status` | `listings` columns |
| `skill_tags` | `listing_skill_tags.tag[]` |
| `author_name` | `users.first_name + last_name` |
| `created_at` | Unix timestamp |

**Search fallback:** when Meilisearch is unreachable `ListingService::getAll()` falls through to a SQL `LIKE` query on `title`, `description`, and `location`. Faceted filters (hours range, service type, posted-within) are always applied in SQL, even when Meilisearch provides the initial ID list — this prevents pagination drift from post-search filtering.

**Manual re-index:**

```bash
php scripts/sync_search_index.php --all-tenants --type=listing
```

## Moderation

Moderation is **opt-in per tenant** (`listing.moderation_enabled`, default `false`). When enabled:

1. New listings enter `status=pending, moderation_status=pending_review` and are invisible to non-owners.
2. Admins see the queue via `GET /v2/admin/listings/moderation-queue` (served by `AdminListingsController`).
3. `ListingModerationService::approve()` sets both `status=active` and `moderation_status=approved`, writes a `feed_activity` row, and sends a bell + push notification to the owner in their `preferred_language`.
4. `ListingModerationService::reject()` requires a non-empty reason; sends bell notification and email to the owner. The listing is not auto-deleted — the owner can edit and re-submit.

**Community reporting** (independent of the admin moderation queue): authenticated members can report a listing once via `POST /v2/listings/{id}/report`. Accepted reasons: `inappropriate`, `safety_concern`, `misleading`, `spam`, `not_timebank_service`, `other`. A report creates a `listing_reports` row and fires a moderation-alert notification to admin users.

## Featured listings

Admins set `is_featured = 1` (with an optional `featured_until` date) via `POST /v2/admin/listings/{id}/feature`. Featured listings are returned by `GET /v2/listings/featured` and receive a boost in the MatchRank scorer (`FEATURED_BOOST`). The `ListingFeaturedService` enforces that `featured_until` cannot exceed 365 days from now.

## Exchange workflow integration

A listing is the entry point for an exchange. The "Request this service" button on `ListingDetailPage` creates a row in `exchange_requests` with:

- `listing_id` FK to the listing.
- `requester_id` — the member initiating.
- `provider_id` — the listing owner.
- `proposed_hours` — negotiated at request time.

`exchange_requests.listing_id` has an `ON DELETE CASCADE` constraint for a physical listing-row deletion. The normal API `ListingService::delete()` is only a status soft delete, so it retains both the listing row and its exchange requests. Do not rely on the FK cascade for the ordinary delete endpoint; inspect in-progress exchanges before soft-deleting or hard-deleting a listing.

For the full exchange state machine and credit transfer, see [docs/modules/wallet-exchanges.md](wallet-exchanges.md).

## Tenant configuration keys

All keys stored in `tenant_settings` with a `listing.` prefix. Managed by `ListingConfigurationService`. A 5-minute Redis cache per tenant is invalidated on every `set()` call.

| Key | Default | Description |
| --- | --- | --- |
| `listing.moderation_enabled` | `false` | Enable admin review queue |
| `listing.allow_offers` | `true` | Allow `type=offer` listings |
| `listing.allow_requests` | `true` | Allow `type=request` listings |
| `listing.max_per_user` | `50` | Max active listings per user (0 = unlimited) |
| `listing.max_images` | `5` | Max images per listing |
| `listing.require_category` | `true` | Category required on create |
| `listing.require_location` | `false` | Location required on create |
| `listing.require_hours_estimate` | `false` | Hours estimate required |
| `listing.auto_expire_days` | `0` | Days until auto-expiry (0 = never) |
| `listing.max_renewals` | `12` | Maximum renewals per listing |
| `listing.enable_featured` | `true` | Enable featured listings |
| `listing.enable_ai_descriptions` | `true` | Enable AI description generator |
| `listing.enable_favourites` | `true` | Enable save/favourite |
| `listing.enable_reporting` | `true` | Enable community reporting |
| `listing.enable_map_view` | `true` | Enable map/proximity search |

## Security and privacy invariants

- **Owner-only mutations:** `ListingService::canModify()` returns `true` only for the listing owner or a user with `role IN ('admin', 'tenant_admin')`, `is_super_admin`, or `is_tenant_super_admin`. The controller enforces this before any write.
- **No cross-tenant data:** all queries carry `tenant_id` from `TenantContext::getId()`. The `HasTenantScope` trait is applied at the model level.
- **Hidden listings:** a non-owner viewing a listing in `pending`, `rejected`, `deleted`, `draft`, or `paused` status receives HTTP 404 (treated as not found), not 403 — to avoid revealing that a listing exists.
- **Image upload validation:** only JPEG, PNG, WebP, and GIF are accepted; files over 8 MB are rejected before upload to cloud storage.
- **Report deduplication:** a user can only report a given listing once (409 on duplicate). Self-reports return 403.
- **Skill tag injection:** `SearchService::buildEqFilter()` and `assertFilterableField()` whitelist which Meilisearch filter fields can be constructed from user input.

## Failure modes and recovery

| Failure | Behaviour | Recovery |
| --- | --- | --- |
| Meilisearch unavailable at search time | Falls back to SQL LIKE; result shape unchanged | Restore Meilisearch, then run `sync_search_index.php --type=listing` to backfill any missed updates |
| Meilisearch unavailable at create/delete time | Index update silently skipped; listing is live in the database | Run `sync_search_index.php --type=listing --tenant=<id>` to re-sync |
| Listing expiry cron fails for a tenant | Listings remain `active` past `expires_at`; owner does not receive expiry email | Re-run `ListingExpiryService::processAllTenants()` manually; it is idempotent |
| `listing.max_per_user` cap reached | Create returns HTTP 422 with `VALIDATION_ERROR` | Admin can raise the cap in tenant settings, or the member deletes an old listing |
| In-progress exchange when listing is soft-deleted | Exchange rows remain because `ListingService::delete()` retains the listing row | Check `exchange_requests WHERE listing_id = ? AND status NOT IN ('completed','cancelled')` first; pause instead when the workflow must remain visible |
| Featured listing not expiring | `featured_until` stored but never enforced on display — `getFeaturedListings()` filters `featured_until > now()` | No action needed; featured status expires automatically on next browse request |
| Moderation queue stuck (no admin action) | Listing stays `pending_review`; owner sees no update | Admin must process the queue; there is no automatic escalation |

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --testsuite=Laravel --filter=Listing
vendor/bin/phpunit tests/Laravel/Feature/Controllers/ListingsControllerTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/ListingExpiryReminderServiceTest.php
vendor/bin/phpunit tests/Laravel/Integration/ListingEmailReliabilityTest.php

# React — run from react-frontend/
npm test -- ListingsPage
npm test -- ListingDetailPage
npm test -- CreateListingPage
```

Key PHP test files:

| File | What it covers |
| --- | --- |
| `tests/Laravel/Feature/Controllers/ListingsControllerTest.php` | CRUD, auth, ownership, pagination, module gate |
| `tests/Laravel/Feature/Controllers/AdminListingsControllerTest.php` | Moderation approve/reject, featured toggle |
| `tests/Laravel/Unit/Services/ListingExpiryReminderServiceTest.php` | Expiry reminder emails, renewal counting |
| `tests/Laravel/Unit/Services/ListingRankingServiceTest.php` | MatchRank scorer, reciprocity signal |
| `tests/Laravel/Integration/ListingEmailReliabilityTest.php` | Creation and expiry emails rendered in recipient locale |
| `tests/Laravel/Feature/Listeners/UpdateFeedOnListingCreatedTest.php` | Feed activity and Meilisearch indexing on `ListingCreated` event |
| `tests/Laravel/Unit/Models/ListingTest.php` | Model scopes, visibility, status transitions |
