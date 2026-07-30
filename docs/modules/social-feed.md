# Social Feed Module

Last reviewed: 2026-07-30

This guide covers the Social Feed module in Project NEXUS — the unified activity stream, standalone posts, polls, stories, comments, reactions, sharing, and the EdgeRank-style ranking algorithm. It is for maintainers adding features, fixing bugs, or changing ranking behaviour.

## Audience and supported workflows

Use this guide when touching:

- Feed post create/edit/delete, including scheduled and draft posts
- Polls (create, vote, export, ranked-choice results)
- Stories (24-hour disappearing media with inline polls)
- Comments and threaded replies
- Reactions on any feed entity
- Sharing / quote-reposting
- Bookmarking / saved filter
- Feed ranking (EdgeRank 15-signal pipeline)
- Moderation and admin controls
- Per-post analytics (views, clicks, CTR)

## Tenant and feature-gate rules

| Gate | Type | Key | Default |
|------|------|-----|---------|
| Feed module | Module (core, see `TenantContext::hasFeature`) | `feed` | ON |
| Polls standalone page | Feature flag | `polls` | ON |
| Individual event/goal/job/challenge/blog filter pills on the feed | Feature flags | `events`, `goals`, `job_vacancies`, `ideation_challenges`, `volunteering`, `blog`, `groups` | per-feature default |

- **Module gate `feed`** — all feed routes in `react-frontend/src/routes/AppRoutes.tsx` are wrapped with `<FeatureGate module="feed" redirect="/dashboard">`. When the module is disabled, the feed nav link and all `/feed/*` routes redirect to `/dashboard`.
- **Feature gate `polls`** — the standalone `/polls` page uses `<FeatureGate feature="polls">`. The polls filter pill on the feed also gates on `hasFeature('polls')`. The `/v2/feed/polls/*` inline poll endpoints follow the same gate via the `SocialController`.
- **Stories** share the feed module gate; there is no separate `stories` feature flag in `TenantFeatureConfig::FEATURE_DEFAULTS`.
- **All queries are tenant-scoped.** `FeedService` joins `users` with `WHERE u.tenant_id = ?`. All sub-queries (bookmarks, post_shares, likes, comments, connections, group_members) include explicit `tenant_id` guards. The `FeedActivity` model carries a `HasTenantScope` global scope.
- **Admin endpoints** are additional to user-facing gates, but they do **not** all use the same middleware. Only `/v2/admin/polls/*` uses `admin`. The moderation routes — all of `/v2/admin/comments/*`, plus `/v2/admin/feed/posts*` and `/v2/admin/feed/stats` — are registered with `withoutMiddleware('admin')->middleware('broker-or-admin')`, which deliberately also admits the `broker` and `coordinator` roles (they own these surfaces in the broker panel). That is a wider authorization surface than `admin`; the controllers add self-dealing guards. Announcer grant/revoke (`/v2/admin/feed/{grant,revoke}-announcer`) is privilege management and stays admin-only.

## Key code and data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). Do not copy the endpoint table here; read the route file for the live list. Entry-point summary:

| Concern | Route prefix | Controller |
|---------|-------------|------------|
| Feed (read, post, like, hide, mute, share) | `/v2/feed/*` | `App\Http\Controllers\Api\SocialController`, `FeedSocialController` |
| Inline polls (create, get, vote) | `/v2/feed/polls/*` | `SocialController` |
| Standalone polls (CRUD, ranked-choice, export) | `/v2/polls/*` | `App\Http\Controllers\Api\PollsController` |
| Stories | `/v2/stories/*` | `App\Http\Controllers\Api\StoryController` |
| Comments | `/v2/comments/*` | `App\Http\Controllers\Api\CommentsController` |
| Reactions (polymorphic) | `/v2/reactions/*` | `App\Http\Controllers\Api\ReactionController` |
| Post analytics (views, clicks) | `/v2/feed/posts/{id}/view`, `/analytics` | `App\Http\Controllers\Api\PostAnalyticsController` |
| Feed sidebar (stats, suggestions) | `/v2/feed/sidebar` | `App\Http\Controllers\Api\FeedSidebarController` |
| Admin feed moderation | `/v2/admin/feed/*`, `/v2/admin/comments/*`, `/v2/admin/polls/*` | `AdminFeedController`, `AdminCommentsController`, `AdminPollsController` |
| Admin algorithm config | `/v2/admin/config/feed-algorithm` | `AdminConfigController` |

Services:

- `app/Services/FeedService.php` — unified feed query (`getFeed`), post CRUD (`createPost`, `updatePost`, `deletePost`), scheduled-post publisher, poll batch loading.
- `app/Services/FeedRankingService.php` — full 15-signal EdgeRank pipeline, CTR tracking, diversity reordering.
- `app/Services/PersonalisedFeedService.php` — personalisation wrapper (called inside `SocialController::feedV2` after `FeedService::getFeed`).
- `app/Services/PollService.php` — standalone poll CRUD with hidden-totals ballot rule.
- `app/Services/StoryService.php` — story create/view/react/reply/highlight/archive, 24h expiry, story-inline polls.
- `app/Services/CommentService.php` — threaded comments on any entity, emoji reactions on comments.
- `app/Services/ReactionService.php` — polymorphic emoji reactions (8 named types) with toggle/replace semantics and a DB-level unique index.
- `app/Http/Controllers/Api/FeedSocialController.php` / `app/Services/FeedSocialService.php` — share/unshare, `shared_by` hydration, trending/search hashtags.
- `app/Services/FeedActivityService.php` — low-level `feed_activity` row insertion and deletion (called by other services when content is published/deleted).
- `app/Services/MentionService.php` — `@mention` extraction and notification fanout on post create/publish.
- `app/Services/LinkPreviewService.php` — batch-loads URL preview cards for post items.
- `app/Services/ShareService.php` — polymorphic share count, `is_shared` flags, `post_shares` table.
- `app/Services/BookmarkService.php` — bookmark toggle; the `saved` feed filter joins `bookmarks` on `(bookmarkable_type, bookmarkable_id)`.
- `app/Services/ContentModerationService.php` — `detectSpam()` regex called on every new post; spam-flagged posts are hidden and queued in `content_moderation_queue`.
- `app/Services/PostMediaService.php` / `app/Services/PostViewService.php` — media attachments and per-user view tracking.
- `app/Services/GroupScheduledPostService.php` — group-scoped scheduled-post management.

Models:

- `app/Models/FeedActivity.php` — unified activity row (`HasTenantScope`)
- `app/Models/FeedPost.php` — post record
- `app/Models/Poll.php`, `app/Models/PollOption.php` — poll and its options
- `app/Models/Comment.php` — comment with `parent_id` for threading
- `app/Models/PostView.php` — per-user post view record

Tables:

| Table | Purpose |
|-------|---------|
| `feed_activity` | Unified feed stream; one row per published content item (post, listing, event, poll, …) |
| `feed_posts` | Post body, `visibility`, `publish_status`, `scheduled_at`, `quoted_post_id`, `is_official`, `is_hidden`, `deleted_at` |
| `post_media` | Attachments for a post (images, video); ordered by `display_order` |
| `polls` | Poll question, `end_date`, `is_active`, `user_id` |
| `poll_options` | One row per option per poll |
| `poll_votes` | One row per vote; `(poll_id, option_id, user_id, tenant_id)` |
| `stories` | 24-hour stories; `expires_at`, `is_active`, `audience`, inline poll columns |
| `story_views` | `INSERT IGNORE` per viewer |
| `story_reactions` | Reaction per `(story_id, user_id)` — toggle semantics |
| `story_highlights` | Named highlight albums |
| `story_analytics` | Per-event watch telemetry (`event_type`, `watch_duration_ms`) |
| `story_stickers` | Sticker metadata persisted per story |
| `comments` | Polymorphic comments (`target_type`, `target_id`); `parent_id` for threading; soft-deleted via `deleted_at` |
| `likes` | Legacy like table; also used for CTR/engagement batch queries |
| `reactions` | Polymorphic named-type reactions (`target_type`, `target_id`, `emoji`); unique index per `(user_id, target_type, target_id)` |
| `post_shares` | `(original_type, original_post_id, user_id, tenant_id)` — one share per user per item |
| `bookmarks` | `(bookmarkable_type, bookmarkable_id, user_id, tenant_id)` |
| `feed_hidden` / `user_hidden_posts` | Per-user hidden items (two legacy tables — both checked) |
| `feed_muted_users` / `user_muted_users` | Per-user muted authors (two legacy tables — both checked) |
| `feed_impressions` | CTR impression counts (`target_type`, `target_id`, `user_id`); ON DUPLICATE KEY increments `view_count` |
| `feed_clicks` | CTR click counts — same schema as impressions |
| `content_moderation_queue` | Spam-flagged posts queued for admin review |

Frontend entry points:

- `react-frontend/src/pages/feed/FeedPage.tsx` — main feed with filter tabs, ranked/chronological mode toggle, compose button
- `react-frontend/src/pages/feed/PostDetailPage.tsx` — single post / any feed item permalink (`/feed/posts/:id`, `/feed/item/:type/:id`)
- `react-frontend/src/pages/feed/HashtagPage.tsx`, `HashtagsDiscoveryPage.tsx`
- `react-frontend/src/pages/polls/PollsPage.tsx` — standalone polls list/detail
- `react-frontend/src/components/feed/FeedCard.tsx` — the universal feed card component
- `react-frontend/src/components/feed/FeedContentRenderer.tsx` — renders post body with mentions, hashtags, link previews
- `react-frontend/src/components/stories/StoryViewer.tsx`, `StoryCreator.tsx`, `StoryHighlights.tsx`
- `react-frontend/src/components/compose/tabs/PollTab.tsx` — poll creator inside the compose modal
- `react-frontend/src/components/social/SocialInteractionPanel.tsx` — reactions, comments, share row under a card

## Feed architecture

### Unified feed stream

All content types — posts, listings, events, polls, goals, jobs, challenges, volunteer opportunities, blog posts, reviews, badge_earned, level_up — publish a row to `feed_activity` when they go live. `FeedService::getFeed` queries only `feed_activity` and batch-loads enrichment (counts, poll data, quotes, link previews, share attribution). This avoids per-type fan-out queries.

### Feed modes

| Mode | Behaviour |
|------|-----------|
| `ranked` (default) | EdgeRank 15-signal in-memory sort (see Ranking section) |
| `chronological` / `recent` | No ranking; pure `(created_at DESC, id DESC)` |

Mode is passed as `?mode=ranked` or `?mode=chronological` on `GET /v2/feed`.

### Virtual feed filters

`type=saved` — joins `bookmarks` on `(bookmarkable_type, bookmarkable_id)`. Anonymous users always get an empty result.

`type=following` — filters to items authored by users with whom the viewer has an `accepted` connection in either direction.

### Cursor pagination

The cursor is a base64-encoded HMAC-SHA256 signed JSON payload `{ts, id}` where `ts` is the `created_at` of the last seen item and `id` is the `feed_activity.id`. The HMAC uses `config('app.key')`. Unsigned legacy cursors (base64 of `created_at|id`) are accepted for backwards compatibility. Ranked mode advances the cursor from the chronological tail of the scored candidate pool so the next page resumes at the correct database position.

### Post visibility

`FeedService::applyPostVisibilityScope` enforces post-level privacy at query time:

- `visibility = 'public'` or `NULL` — visible to everyone.
- `visibility = 'friends'` or `'connections'` — visible only to the author and users with an `accepted` connection.
- `visibility = 'private'` — visible only to the author.
- Posts with `publish_status = 'draft'` or `'scheduled'` are excluded from the feed.
- Posts with `deleted_at IS NOT NULL` are excluded.
- Posts with `is_hidden = 1` are excluded (admin-hidden).

### Group-scoped posts

Posts inside private groups are hidden from non-members. The visibility query ORs: group is `NULL` (public post), viewer is an `active` group member, or the group's own `visibility = 'public'`.

### Post content limits

- Maximum body length: `FeedService::MAX_POST_LENGTH = 50000` bytes.
- Scheduling: `scheduled_at` must be in the future and no more than 365 days ahead. Schedules that fall in the past publish immediately.
- Quotes: `quoted_post_id` is validated via `FeedItemTables::canView` before saving.

## Posts

Creating a post (`POST /v2/feed/posts` → `SocialController::createPostV2` → `FeedService::createPost`):

1. Content is sanitised by `App\Helpers\HtmlSanitizer::sanitize`.
2. Spam detection (`ContentModerationService::detectSpam`) — match sets `is_hidden = 1` and inserts into `content_moderation_queue`; post is saved but not visible.
3. If the author has the `municipality_announcer` role, `is_official = true` and `is_pinned = true` are set automatically.
4. For `publish_status = 'published'`, a `feed_activity` row is inserted (`INSERT OR IGNORE`) and `@mentions` are processed by `MentionService::processText`.
5. For `publish_status = 'scheduled'` or `'draft'`, no `feed_activity` row is written; the post becomes visible when published.

Updating a post (`PUT /v2/feed/posts/{id}`): only the original author can edit. Content is re-sanitised and `feed_activity.content` / `image_url` are updated in sync.

Deleting a post (`DELETE /v2/feed/posts/{id}`): soft-delete via `deleted_at`; `feed_activity` row is removed by `FeedActivityService::removeActivity`.

## Polls

Polls are a first-class feed type, surfaced both inline in the feed (`/v2/feed/polls/*`) and on a standalone page (`/v2/polls/*`). They share the `polls` / `poll_options` / `poll_votes` tables.

### Fair-voting hidden-totals rule

**While a poll is open** (is_active = true AND end_date has not passed), `FeedService::batchLoadPollData` and `PollService::getById` both enforce:

- Non-creator viewers receive `null` for `vote_count` and `percentage` on every option.
- `total_votes` is also withheld from non-creators on open polls.
- The poll creator always sees full running totals.

**Once the poll is closed** (end_date <= now), full totals and percentages are returned to all viewers.

This prevents bandwagon/strategic voting where early-result knowledge changes later voters' behaviour.

### Voting

`POST /v2/polls/{id}/vote` records one vote per user. A user changing their vote replaces the existing `poll_votes` row. The `vote_count` in the response respects the hidden-totals rule above.

### Ranked-choice and export

`POST /v2/polls/{id}/rank` stores a preference ordering.  
`GET /v2/polls/{id}/ranked-results` returns the Condorcet-style tally.  
`GET /v2/polls/{id}/export` streams a CSV of anonymised vote data. It is served by `PollsController@export` behind plain `auth:sanctum` and is restricted to **the poll's own creator** — `PollExportService::exportToCsv()` returns `null` unless `poll.user_id` matches the caller, and the controller maps that to a 404 `RESOURCE_NOT_FOUND`. An admin who did not create the poll is refused. `AdminPollsController` has no `export` method (only `index`, `show`, `destroy`). Note the service comment says "creator or admin"; the code checks creator only.

### Story-inline polls

Stories can carry a poll question with 2–4 options (stored as JSON in `stories.poll_options`). `POST /v2/stories/{id}/poll/vote` records a vote. Totals follow the same hidden-until-close rule as feed polls — the story `expires_at` is the poll close time.

## Stories

Stories are 24-hour ephemeral media managed by `StoryService`. Key behaviours:

- **Capacity guard** — maximum 30 active stories per user. `StoryService::create` uses a `SELECT ... FOR UPDATE` locking count inside a transaction to prevent concurrent requests from bypassing the limit.
- **Lifetime** — `stories.expires_at = NOW() + 24 hours`. Stories with `expires_at <= NOW()` are excluded from listing queries.
- **Media types** — `image`, `video`, `text`, `poll`. Video duration is stored in `stories.video_duration`; the display duration is clamped to 3–30 seconds.
- **Audience** — `stories.audience` field (e.g. `'everyone'`, `'close_friends'`). Close-friend lists are managed via `/v2/stories/close-friends/*`.
- **View tracking** — `POST /v2/stories/{id}/view` does `INSERT IGNORE INTO story_views`; viewer IDs are returned by `GET /v2/stories/{id}/viewers`.
- **Reactions** — toggle via `POST /v2/stories/{id}/react`; one reaction type per `(story_id, user_id)`.
- **Replies** — `POST /v2/stories/{id}/reply` sends a direct message to the story author.
- **Highlights** — permanent named albums (`story_highlights`); items added / removed / reordered.
- **Analytics** — `POST /v2/stories/{id}/analytics` records watch events (`event_type`, `watch_duration_ms`) to `story_analytics`.
- **Stickers** — arbitrary sticker metadata saved to `story_stickers` per story.

## Comments

Comments use a polymorphic model (`comments.target_type` / `target_id`) and support one level of threading via `parent_id`. The same `comments` table is used for posts, listings, events, polls, goals, and any other commentable entity.

`CommentService::getForEntity` returns top-level comments with nested replies, each enriched with the commenter's reaction summary from the `reactions` table (`target_type = 'comment'`).

Soft-deletes are supported: if `deleted_at` is present (detected at runtime via `Schema::hasColumn('comments', 'deleted_at')`), deleted comments are excluded from counts and listings.

Comment visibility inherits from the parent entity — `CommentService::targetIsCommentableAndVisible` checks `FeedItemTables::canView` before returning data.

Admin endpoints (`/v2/admin/comments/*`) allow hiding and deleting comments by moderators.

## Reactions

`ReactionService::toggleReaction` implements toggle / replace semantics:

- **Same type → toggle off** (removes the row).
- **Different type → replace** (updates the existing row to the new type).
- **No prior reaction → add** (inserts a new row).

A DB-level unique index on `(user_id, target_type, target_id)` in the `reactions` table prevents duplicate rows from concurrent requests. Serialisation is also enforced at the service level with a cache lock.

**Valid named types:** `love`, `like`, `laugh`, `wow`, `sad`, `celebrate`, `clap`, `time_credit`  
**Valid target types:** `post`, `comment`, `listing`, `event`, `goal`, `poll`, `review`, `volunteer`, `challenge`, `resource`, `job`, `blog`, `discussion`

`FeedRankingService::REACTION_WEIGHTS` maps named types to scoring multipliers used in Signal 11 of the ranking pipeline:

| Type | Weight |
|------|--------|
| `love` | 2.0 |
| `celebrate` | 1.8 |
| `insightful` | 1.5 |
| `like` | 1.0 |
| `curious` | 0.8 |
| `sad` | 0.6 |
| `angry` | 0.5 |

## Sharing / quote reposting

`POST /v2/feed/posts/{id}/share` (and the polymorphic `POST /v2/shares`, with `DELETE /v2/shares` to unshare) inserts a row into `post_shares`. One share per `(user_id, original_type, original_post_id, tenant_id)`.

`share_count` on feed items comes from two sources:

- For `type = 'post'`: the denormalised `feed_posts.share_count` column (updated by `ShareService`).
- For all other types: computed on demand by `ShareService::batchShareCount`.

The `shared_by` field on feed items surfaces the most recent sharer who is not the original author and not the current viewer, so friends' reposts appear as social proof. On a profile feed view, the profile owner's own reposts take priority.

Quote reposting: creating a post with `quoted_post_id` embeds the quoted post in the `feed_posts.quoted_post_id` FK. The quoted post is batch-loaded with its author and media and returned as `quoted_post` in feed item payloads.

## Feed ranking (EdgeRank)

`FeedRankingService::rankFeedItems` applies a 15-signal multiplicative scoring pipeline to the candidate pool returned by `FeedService::getFeed`, then applies diversity reordering.

### Signals (in order applied)

| # | Signal | Key behaviour |
|---|--------|---------------|
| 1 | Time Decay | Hacker News decay; 24h full score, 72h half-life, 0.30 floor |
| 2 | Engagement | Log-scaled `likes × 1 + comments × 5`; zero-engagement posts get a ×1.05 floor |
| 3 | Velocity | Rapid engagement within 2h window (threshold: 3 actions); boost up to ×1.8, decays over 6h |
| 4 | Content Type | Events ×1.4, challenges ×1.3, polls ×1.25, volunteer ×1.2, goals ×1.1, posts ×1.0, listings/jobs ×0.9, reviews ×0.8 |
| 5 | Social Affinity | Interaction-weighted score for viewer→author relationship (90-day window, up to ×2.0); falls back to connection-follower ×1.5 |
| 6 | Creator Vitality | Author recent-activity score; full at ≤7 days, decays to 0.50 at ≥30 days |
| 7 | Geo Decay | Haversine distance; full score within 50 km, exponential decay (λ=0.003), 0.15 floor |
| 8 | Content Quality | Images ×1.3, video ×1.4, links ×1.1, hashtags ×1.1, @mentions ×1.15, body ≥50 chars ×1.2 |
| 9 | Context Timing | Post/poll evening boost ×1.12; events on Monday morning ×1.20; volunteer on weekends ×1.18; late-night (2–6 am) post penalty ×0.90 |
| 10 | Conversation Depth | Thread depth ≥3 replies boosts up to ×1.5 |
| 11 | Reaction Weighting | Named-type reaction scores (see table above) |
| 12 | Negative Signals | Admin-hidden: score 0.0; each report: −0.15 (floor 0.1) |
| 13 | CTR Feedback | Click-through rate vs 2% neutral baseline; min 5 impressions to apply; max boost ×1.5 |
| 14 | User Type Prefs | Per-viewer content-type preference from 30-day interaction history; max boost ×1.4 |
| 15 | Save/Bookmark | Items saved ≥2 times get a save-signal boost; max ×1.35 |

After scoring, items are sorted descending by score, then diversity reordering prevents more than 2 consecutive items from the same author or 3 consecutive items of the same content type.

**CTR tracking consent gate:** `FeedRankingService::recordImpression` / `recordClick` check `cookie_consents.analytics` for the user before writing to `feed_impressions` / `feed_clicks`. No tracking if consent is `0` or if the check throws. Impressions are debounced per `(user, type, id)` with a 5-minute cache window.

### Per-tenant algorithm configuration

Ranking weights and thresholds can be overridden per tenant via `tenants.configuration.feed_algorithm` (JSON). The `PUT /v2/admin/config/feed-algorithm` endpoint writes these. Defaults fall through from `FeedRankingService::getConfig()`. Invalid values are clamped before use.

### Ranking reasons

Pass `includeReasons=true` to `rankFeedItems` to attach `ranking_reasons` (top 3 i18n-key signals) to each item. Used by the "why am I seeing this?" affordance.

## Moderation and privacy

- **Spam detection** — `ContentModerationService::detectSpam` on every new post; regex-matched posts are hidden automatically and queued in `content_moderation_queue` for admin review.
- **Admin hide** — `POST /v2/admin/feed/posts/{id}/hide` sets `feed_activity.is_hidden = 1`; the post disappears from all feeds without deletion.
- **User hide** — `POST /v2/feed/posts/{id}/hide` adds a row to `feed_hidden` / `user_hidden_posts`; FeedService excludes these with `WHERE NOT EXISTS`.
- **User mute** — `POST /v2/feed/users/{id}/mute` adds to `feed_muted_users` / `user_muted_users`; FeedService excludes all content from muted authors.
- **Block** — `BlockUserService::getBlockedPairIds` excludes blocked users in both directions.
- **Report** — `POST /v2/feed/posts/{id}/report` records in `reports`; each report applies a `−0.15` ranking penalty (Signal 12).
- **Municipality announcer** — users with the `municipality_announcer` role have their posts marked `is_official = true` and `is_pinned = true` automatically by `FeedService::createPost`.
- **Orphan pruning** — `FeedService::filterOutOrphanedItems` removes `feed_activity` rows whose source entity has been deleted from the backing table (listings, events, polls, etc.) to prevent ghost cards.

## Security and privacy invariants

- All feed queries are tenant-scoped: `feed_activity.tenant_id` and a `JOIN users ... WHERE u.tenant_id = ?` prevent cross-tenant user data leakage.
- Post visibility (`public` / `friends` / `private`) is enforced at the SQL level inside `applyPostVisibilityScope`, not post-hoc in PHP. Connections check is done with a correlated sub-query on the `connections` table, also scoped by `tenant_id`.
- Private group posts are hidden from non-members by a `WHERE EXISTS (group_members)` guard.
- Poll votes are one-per-user enforced by the `poll_votes` primary or unique key; changing a vote replaces the row.
- CTR data is withheld unless the user's `cookie_consents.analytics` is explicitly set (fail-closed).
- Story view records use `INSERT IGNORE` — no error on double-view, but no double-count either.
- Reaction uniqueness is enforced by a DB-level unique index on `reactions (user_id, target_type, target_id)` plus a service-level cache lock.
- The HMAC-signed feed cursor prevents clients from forging arbitrary pagination positions.

## Failure modes and recovery

| Failure | Effect | Recovery |
|---------|--------|----------|
| `feed_activity` row missing for a published post | Post invisible in feed but still accessible via `/feed/posts/{id}` | `FeedActivityService::recordActivity` re-inserts the row (idempotent upsert; preserves an existing visibility bit) |
| EdgeRank ranking throws | `FeedService::getFeed` catches `\Throwable`, logs a warning, and returns items in chronological order | Restart is not needed; ranking is stateless |
| Link preview batch load fails | Feed is returned without `link_previews` (exception caught silently) | No action; previews are cosmetic |
| Quoted post batch load fails | Feed is returned without `quoted_post` embeds (exception caught, warning logged) | No action |
| `feed_impressions` / `feed_clicks` insert fails | Silently ignored; CTR signal drops to neutral for affected items | Check DB capacity |
| Spam flagging false positive | Legitimate post hidden, queued for moderation | Admin reviews `content_moderation_queue` via `/v2/admin/feed/posts?status=flagged` |
| Story max-stories limit race | `StoryService::create` uses `SELECT ... FOR UPDATE`; extra concurrent request receives a `RuntimeException` | Client retries; safe |
| FeedRankingService static config cache stale after tenant switch | `FeedRankingService::clearStaticCache()` flushes; Octane workers re-pin on next request | Call `clearStaticCache()` in queue-job `handle()` if ranking is called from a worker |

## Tests

Run the feed test suite:

```bash
vendor/bin/phpunit tests/Laravel/Feature/Controllers/FeedControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/SocialControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/PollsControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/StoryControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/CommentsControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/ReactionControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/FeedSocialControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/FeedSidebarControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Personalisation/PersonalisedFeedTest.php
vendor/bin/phpunit tests/Laravel/Feature/GovukAlpha/FeedParityTest.php
```

Key regression tests:

- `SocialControllerTest` — post CRUD, scheduled post publish, visibility filter, mute/hide/report flows, `shared_by` hydration.
- `PollsControllerTest` — hidden-totals rule (open poll, non-creator sees `null` counts; closed poll returns counts; creator always sees counts).
- `StoryControllerTest` — 30-story cap with concurrent-request simulation, story poll vote, reaction toggle.
- `ReactionControllerTest` — toggle-off, type-replace, invalid-type rejection, cross-tenant isolation.
- `PersonalisedFeedTest` — personalised ranking applied after base feed.
- `FeedParityTest` (accessible frontend) — GOV.UK-accessible feed routes return same content shape.

React tests:

```bash
cd react-frontend
npm test -- --reporter=verbose src/pages/feed/ src/components/feed/ src/pages/polls/
```
