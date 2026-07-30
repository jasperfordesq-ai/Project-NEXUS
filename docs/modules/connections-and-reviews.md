# Connections, Reviews & Endorsements Module

Audience: maintainers and contributors working on member social graph, reputation, or skill endorsement features.

Last reviewed: 2026-07-30

## Supported workflows

- **Member connections** — send, accept, decline, cancel, and list connections between members of the same tenant ("friends" / network graph).
- **Connection suggestions** — ranked "People You May Know" panel driven by mutual connections, shared groups, and recent activity.
- **Member reviews** — leave a 1–5 star rating with optional comment after a completed exchange; view a member's review history and aggregate reputation score.
- **Skill endorsements** — publicly endorse a specific named skill on another member's profile, optionally with a short comment. Results are grouped by skill on the profile page.
- **Peer endorsements** — a lightweight separate mechanism where accumulating 3 peer vouches auto-grants the `peer_endorsed` verification badge.

## Feature gates

Both features default to **on** and are togglable per tenant in the admin "Module Configuration" panel (`/admin/module-configuration`). `/admin/tenant-features` is retired and survives only as a redirect stub to that path.

| Flag | Default | Toggle key |
|------|---------|------------|
| `connections` | `true` | `TenantFeatureConfig::FEATURE_DEFAULTS['connections']` |
| `reviews` | `true` | `TenantFeatureConfig::FEATURE_DEFAULTS['reviews']` |

In the React app, the Connections routes and the `/reviews` and `/reviews/create` routes are gated in `react-frontend/src/routes/AppRoutes.tsx` with their respective feature flags. Disabled tenants receive the route's coming-soon/redirect fallback. The API routes themselves inherit `auth:sanctum` but are not wrapped in matching `feature:` middleware; skill and peer endorsement endpoints have no separate feature gate.

## Member connections

### Lifecycle

```
none  →  pending_sent / pending_received  →  connected
                                          →  (deleted/rejected)
```

A connection request creates a row in `connections` with `status = 'pending'`. Only the **receiver** may accept or decline. Either party may cancel/remove at any time. Self-connections are rejected with a 400. Blocked users (in either direction) cannot exchange connection requests.

### Tenant scoping

`Connection` uses the `HasTenantScope` trait, which automatically appends `tenant_id = <current>` to every query. `ConnectionService::request()` additionally verifies both users share the same `tenant_id` before inserting; cross-tenant connections are impossible.

### Database table: `connections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK |
| `tenant_id` | int unsigned | FK, indexed |
| `requester_id` | int | FK → `users.id` ON DELETE CASCADE |
| `receiver_id` | int | FK → `users.id` ON DELETE CASCADE |
| `status` | varchar(20) | `'pending'` or `'accepted'` |

Unique constraint: `(tenant_id, requester_id, receiver_id)` — prevents duplicate requests in one direction. The service checks both directions to prevent parallel racing requests.

### Deadlock prevention

`ConnectionService::request()` acquires `SELECT ... FOR UPDATE` on both user rows in ascending `id` order before checking for existing connections, serialising concurrent requests between the same pair.

### Events and notifications

After the transaction commits, the service fires:

- `ConnectionRequested` — handled by `NotifyConnectionRequest` (queued, `ShouldQueue`). Sends a bell notification and email to the target user in their `preferred_language` via `LocaleContext::withLocale()`. One-time-use idempotency guard in Redis prevents duplicate sends on queue re-delivery.
- `ConnectionAccepted` — dispatched after `accept()` commits. `NotifyConnectionAccepted` sends the original requester a locale-aware, idempotency-guarded notification; `PushConnectionAcceptedToFederatedPartner` mirrors the acceptance when federation applies. This event does not award connection XP or run badge checks.

Declining a request sends a `connection_declined` bell notification and email to the requester, rendered in the requester's `preferred_language`. Email sending is gated by the requester's `email_connections` notification preference.

### API endpoints

See `routes/api.php` and `app/Http/Controllers/Api/ConnectionsController.php`.

| Method | Path | Description | Auth | Rate limit |
|--------|------|-------------|------|------------|
| GET | `/api/v2/connections` | List connections (cursor-paginated) | required | 60/min |
| GET | `/api/v2/connections/pending` | Pending count summary | required | 120/min |
| GET | `/api/v2/connections/status/{userId}` | Connection status with a specific user | required | 120/min |
| POST | `/api/v2/connections/request` | Send a connection request | required | 20/min |
| POST | `/api/v2/connections/{id}/accept` | Accept a pending request | required | 30/min |
| POST | `/api/v2/connections/{id}/decline` | Decline a pending request | required | 30/min |
| DELETE | `/api/v2/connections/{id}` | Remove connection or cancel request | required | 30/min |
| GET | `/api/v2/connections/suggestions` | "People You May Know" ranked list | required | 30/min |

Query parameters for `GET /api/v2/connections`:

| Param | Values | Default |
|-------|--------|---------|
| `status` | `accepted`, `pending`, `pending_sent`, `pending_received` | `accepted` |
| `per_page` | 1–100 | 20 |
| `cursor` | opaque base64 string | — |

The `status()` response returns one of: `none`, `pending_sent`, `pending_received`, `connected`.

Connection suggestions are ranked by: mutual connections × 5, shared groups × 2, recent activity (active in last 30 days) + 2. Blocked users and already-connected or pending-connection users are excluded. A fallback simple query runs if the scoring query fails.

### Frontend entry point

`react-frontend/src/pages/connections/ConnectionsPage.tsx` — three tabs: My Connections, Requests, Sent. Uses cursor pagination via `GET /api/v2/connections`.

`react-frontend/src/components/feed/ConnectionSuggestionsWidget.tsx` — sidebar widget for the feed page.

### Key service and controller

- `app/Services/ConnectionService.php` — all connection logic, static methods
- `app/Http/Controllers/Api/ConnectionsController.php`
- `app/Http/Controllers/Api/ConnectionSuggestionController.php`
- `app/Listeners/NotifyConnectionRequest.php`

### Interplay with blocking

`ConnectionService::request()` checks `user_blocks` bidirectionally before inserting a new request. If either user has blocked the other, the request returns a 422. `ConnectionSuggestionController::suggestions()` also filters blocked users from suggestion results. See `docs/modules/members-and-gdpr.md` for the block mechanism.

## Member reviews

### Overview

Member reviews capture a 1–5 star rating with optional text. The pending-review UI is generated from completed transactions, one slot per participant. The create API also accepts a transaction id after validating that the reviewer and receiver are its parties, but `ReviewService::create()` does not independently require that transaction to be completed. Reviews appear on the reviewed member's in-app profile as an aggregate reputation score.

This section covers **member (peer) reviews only**. Exchange ratings stored in `exchange_ratings` are part of the exchange workflow — see `docs/modules/wallet-exchanges.md`. Course reviews (`course_reviews`) and volunteer reviews (`vol_reviews`) are separate sub-systems covered by their respective module guides.

### Review creation rules

- Self-reviews are rejected (400).
- Reviewer, receiver, and any supplied transaction are tenant-scoped. For a transaction-backed review, both users must be transaction participants.
- One review per `(reviewer_id, transaction_id)` — enforced by a unique index `uq_reviews_reviewer_transaction` and checked in `ReviewService::create()` before insert. A concurrent race past the exists-check is caught by the unique constraint.
- Without a `transaction_id`, at most one review per `(reviewer_id, receiver_id)` per 24-hour window to limit spam.
- Reviews are created with `status = 'approved'`; moderation can move them to `status = 'rejected'`.
- The reviewer may soft-delete their own review, which sets `status = 'rejected'` and stamps `deleted_by_author_at`. Admin moderator rejects are also `'rejected'` but without `deleted_by_author_at`, allowing the queue to distinguish the two.
- Read queries exclude `status = 'rejected'` by filtering for `status IS NULL OR status IN ('active', 'approved')`.
- A `ReviewCreated` event fires after save; federation listeners use this to push the review to the receiver's home-partner tenant (reputation portability).

### Federated reviews

`Review::scopeWithFederated()` expands the tenant scope to include reviews where `review_type = 'federated'` and `receiver_tenant_id = <current>` and `show_cross_tenant = 1`. This means a member's reputation travels with them across federated communities. The aggregate statistics endpoints (`getStats`, `getForUser`) apply the federated scope so the displayed average and count reflect cross-tenant reputation.

### Database table: `reviews`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK |
| `tenant_id` | int unsigned | Scoped by `HasTenantScope` |
| `reviewer_id` | int | FK → `users.id` ON DELETE CASCADE |
| `receiver_id` | int | FK → `users.id` ON DELETE CASCADE |
| `transaction_id` | int | nullable; FK → `transactions.id` |
| `rating` | int | 1–5 |
| `comment` | text | nullable, max 2000 chars |
| `status` | enum | `'pending'`, `'approved'`, `'rejected'` (default `'approved'`) |
| `review_type` | enum | `'local'`, `'federated'` |
| `is_anonymous` | tinyint | hides reviewer identity in read responses |
| `deleted_by_author_at` | timestamp | set on author self-delete |
| `show_cross_tenant` | tinyint | included in federated receiver's read scope |

### Privacy

When `is_anonymous = 1`, the reviewer's name and avatar are replaced with `'Anonymous'` / `null` in all read responses. This is enforced in `ReviewService::getForUser()`.

### Notifications

After create, `ReviewService::notifyReceiver()` sends a bell notification and a review email to the recipient in their `preferred_language`, unless `is_anonymous` is set (anonymous reviews send no notification because the reviewer name is required for the template). Email and push use `LocaleContext::withLocale()`.

### API endpoints

See `routes/api.php` and `app/Http/Controllers/Api/ReviewsController.php`.

| Method | Path | Description | Auth | Rate limit |
|--------|------|-------------|------|------------|
| GET | `/api/v2/reviews/pending` | Completed transactions without a review from the caller | required | — |
| GET | `/api/v2/reviews/given` | Reviews written by the caller | required | 60/min |
| GET | `/api/v2/reviews/user/{userId}` | Reviews received by a user | required | 60/min |
| GET | `/api/v2/users/{userId}/reviews` | Alias for the above | required | 60/min |
| GET | `/api/v2/reviews/user/{userId}/stats` | Aggregate stats (total, average, distribution) | required | 120/min |
| GET | `/api/v2/reviews/{id}` | Single review | required | 120/min |
| POST | `/api/v2/reviews` | Create a review | required | 10/min |
| DELETE | `/api/v2/reviews/{id}` | Author self-delete | required | 10/min |

`GET /api/v2/reviews/pending` accepts an optional `?transaction_id=<int>` to resolve a single transaction — used by the review-request email deep link (`/reviews/create?transaction_id=…`).

### Admin moderation endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/admin/reviews` | List all reviews with filters |
| GET | `/api/v2/admin/reviews/{id}` | Single review |
| POST | `/api/v2/admin/reviews/{id}/flag` | Flag for review (sets `status = 'pending'`) |
| POST | `/api/v2/admin/reviews/{id}/hide` | Hide (sets `status = 'rejected'`) and notifies reviewer |
| DELETE | `/api/v2/admin/reviews/{id}` | Hard-delete review and notify reviewer |

Served by `app/Http/Controllers/Api/AdminReviewsController.php`. These routes use the `broker-or-admin` middleware rather than the stricter admin-only middleware.

### Gamification

Leaving a review awards XP via `GamificationService::awardXP($userId, XP_VALUES['leave_review'], ...)`. The review is also recorded as a feed activity item.

### Frontend entry point

`react-frontend/src/pages/reviews/ReviewsPage.tsx` — three tabs: Received, Given, Pending.

`react-frontend/src/components/reviews/ReviewModal.tsx` — modal used to submit a new review.

### Key service and controller

- `app/Services/ReviewService.php`
- `app/Http/Controllers/Api/ReviewsController.php`
- `app/Http/Controllers/Api/AdminReviewsController.php`
- `app/Models/Review.php`

## Skill endorsements

### Overview

Any authenticated member may endorse another member's named skill with an optional short comment (max 500 chars). Endorsements are unique per `(endorser_id, endorsed_id, skill_name, tenant_id)`. The `skill_name` is a free-text string (max 100 chars) and may optionally reference a `skill_id` from the `skills` table (denormalised for display flexibility).

Results are grouped by skill name on the profile page — each skill shows an endorser count and the list of endorsers with avatars.

### Peer endorsements (distinct mechanism)

`peer_endorsements` is a separate table for a simpler vouching mechanism. Once a member accumulates 3 endorsements (the `ENDORSEMENT_THRESHOLD`), `PeerEndorsementController` automatically grants the `peer_endorsed` verification badge via `MemberVerificationBadgeService`. Duplicate peer-endorse requests are silently ignored (`INSERT IGNORE`).

Peer endorsements are not grouped by skill; they represent an unqualified vouching signal for the member as a whole.

### Database tables

**`skill_endorsements`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK |
| `tenant_id` | int | Scoped by `HasTenantScope` |
| `endorser_id` | int | FK → `users.id` |
| `endorsed_id` | int | FK → `users.id` |
| `skill_id` | int | nullable; references `skills.id` |
| `skill_name` | varchar(100) | denormalised for display |
| `comment` | varchar(500) | nullable |
| `created_at` | timestamp | no `updated_at` — immutable after creation |

Unique constraint: `(endorser_id, endorsed_id, skill_name, tenant_id)`.

**`peer_endorsements`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint unsigned | PK |
| `tenant_id` | int unsigned | indexed |
| `endorser_id` | int unsigned | |
| `endorsed_id` | int unsigned | indexed |

Unique constraint: `(tenant_id, endorser_id, endorsed_id)`.

### Tenant scoping

`SkillEndorsement` uses `HasTenantScope`. `EndorsementService::endorse()` additionally verifies the endorsed user exists in the current tenant via `User::where('tenant_id', TenantContext::getId())` before inserting.

`EndorsementService::getEndorsementsForUser()` performs a direct SQL join and explicitly filters on `se.tenant_id = $tenantId`, verifying the target user belongs to the tenant before returning any data.

### API endpoints

See `routes/api.php` and `app/Http/Controllers/Api/EndorsementController.php`.

| Method | Path | Description | Auth | Rate limit |
|--------|------|-------------|------|------------|
| POST | `/api/v2/members/{id}/endorse` | Endorse a skill on a member's profile | required | 20/min |
| DELETE | `/api/v2/members/{id}/endorse` | Remove your endorsement of a skill | required | — |
| GET | `/api/v2/members/{id}/endorsements` | List endorsements grouped by skill | required | 30/min |
| GET | `/api/v2/members/top-endorsed` | Top endorsed members (by total count) | required | 10/min |
| POST | `/api/v2/members/{id}/peer-endorse` | Submit a peer endorsement (badge trigger) | required | 20/min |

`POST /api/v2/members/{id}/endorse` body: `{ "skill_name": string, "skill_id": int|null, "comment": string|null }`.

`DELETE /api/v2/members/{id}/endorse` requires `skill_name` as body or query param.

`GET /api/v2/members/{id}/endorsements` with `?skill_name=<name>` returns the detailed endorser list for one skill and a caller-relative `has_endorsed` boolean.

`GET /api/v2/members/top-endorsed` accepts `?limit=<int>` (default 10, max 50).

### Frontend entry points

- `react-frontend/src/components/endorsements/EndorseButton.tsx` — inline endorse/remove button on member profile.
- `react-frontend/src/components/endorsements/TopEndorsedWidget.tsx` — leaderboard widget.

### Key service and controller

- `app/Services/EndorsementService.php`
- `app/Http/Controllers/Api/EndorsementController.php`
- `app/Http/Controllers/Api/PeerEndorsementController.php`
- `app/Models/SkillEndorsement.php`

## Security and privacy invariants

- **Tenant isolation** — all three systems use `HasTenantScope` or explicit `tenant_id` filters. Cross-tenant data cannot be returned.
- **Block and safeguarding interplay** — blocked users cannot send connection requests, and suggestion results exclude both directions of block. Review creation and skill-endorsement writes also call the safeguarding interaction policy. Peer endorsements enforce tenant membership, reject self-endorsement, and rely on their duplicate guard, but do not call that safeguarding policy directly.
- **Self-action prevention** — all three systems reject self-requests at the service layer before any DB write.
- **Duplicate guards** — connections: unique index + locked `FOR UPDATE` check. Reviews: unique index `uq_reviews_reviewer_transaction` + pre-insert exists check + 24h spam window for transaction-less reviews. Skill endorsements: unique index `unique_endorsement`. Peer endorsements: `INSERT IGNORE` + unique index.
- **Author-delete vs moderator-reject distinction** — `deleted_by_author_at` timestamp differentiates who initiated a review removal; admin moderation cannot resurrect an author-deleted review.
- **Anonymous reviews** — `is_anonymous = 1` strips reviewer identity from all read paths, including notifications.
- **GDPR erasure** — `connections.requester_id`/`receiver_id`, `reviews.reviewer_id`/`receiver_id`, and `skill_endorsements.endorser_id`/`endorsed_id` all carry `ON DELETE CASCADE` (connections, reviews) or are naturally orphaned (endorsements) when a user is erased. See `docs/modules/members-and-gdpr.md` for the full erasure flow.

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --testsuite=Laravel --filter=Connection
vendor/bin/phpunit --testsuite=Laravel --filter=Review
vendor/bin/phpunit --testsuite=Laravel --filter=Endorsement

# Or target individual files
vendor/bin/phpunit tests/Laravel/Unit/Services/ConnectionServiceTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/ConnectionsControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/ConnectionSuggestionControllerTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/ReviewServiceTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/ReviewsControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Reviews/ReviewDuplicateGuardTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/EndorsementServiceTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/EndorsementControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/PeerEndorsementControllerTest.php

# React — run from react-frontend/
npm test -- ConnectionsPage
npm test -- ReviewsPage
```

Key regression tests:

- `ReviewDuplicateGuardTest` — verifies that concurrent submissions of the same `(reviewer_id, transaction_id)` resolve to exactly one review.
- `ConnectionServiceTest` — covers deadlock-safe request creation, block enforcement, cross-tenant rejection, accept/decline/remove lifecycle.
- `NotifyConnectionRequestTest` — verifies idempotency guard (Redis) and locale-context wrapping.
- `FederatedConnectionEmailTest` — integration test for cross-tenant connection notification locale.

## Failure modes and recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| `ConnectionRequested` event listener fails | Listener is queued; exception is logged to `Log::error`; **connection row is already committed** and visible to the requester. Notification may not be delivered. | Check queue worker logs. Manually re-queue or notify the user through admin tools. |
| `ReviewCreated` event dispatch fails | Caught by try/catch in `ReviewService::create()`; logged as warning. Review is saved. Federation push may be missed. | Review stands; federation sync is eventually consistent via federation reconciliation processes. |
| Review notification email fails | Caught in `ReviewService::notifyReceiver()`; logged as warning. | Review is saved. User can view it on their profile; no re-send mechanism exists in the current implementation. |
| Duplicate review race condition | Caught by the `UniqueConstraintViolationException` handler in `ReviewService::create()`; returns the same error message as the pre-insert check. | Expected behaviour; no recovery needed. |
| Suggestion query fails (complex SQL) | `ConnectionSuggestionController` catches the exception, logs a warning, and falls back to a simple `ORDER BY last_active_at` query. | No action needed; suggestions degrade to recency-ordered. Investigate the logged exception if scoring signals are persistently missing. |
| Peer endorsement badge grant fails | `MemberVerificationBadgeService::grantBadge()` returns `null` if the badge already exists; `badge_granted = false` in the response. This is not an error. | Normal behaviour for repeat endorsements above the threshold. |
