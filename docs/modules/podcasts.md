# Podcasts Module

Last reviewed: 2026-07-30

Audience: maintainers and contributors working on the Podcasts feature — audio hosting, RSS distribution, listen analytics, or admin moderation.

> **Status: production-hardened, tenant opt-in.** The module ships behind the `podcasts` tenant feature flag (default OFF). React and accessible-frontend routes are gated, member-facing catalogue reads require a same-tenant authenticated session, and only the identity-free distribution projection is anonymous.

---

## Overview

The Podcasts module lets community members create and publish podcast shows directly inside a tenant. Key workflows:

- **Creator** — create a show, upload or link episode audio, schedule publication, manage chapters and transcripts.
- **Listener** — browse and search shows, subscribe for episode notifications, react to and report episodes.
- **Admin** — moderate shows and episodes (approve/reject/flag), validate RSS feeds, triage episode reports, view listen analytics.

---

## Feature gate

The `podcasts` feature flag on `tenants.features` controls the entire module. Every API route calls `ensurePodcastsFeature()` (defined in `app/Http/Controllers/Api/Concerns/InteractsWithPodcasts.php`), which returns `HTTP 403 FEATURE_DISABLED` when the flag is absent. The React frontend wraps every podcast route in `<FeatureGate feature="podcasts" redirect="/">`.

To enable for a tenant:

```sql
UPDATE tenants SET features = JSON_SET(features, '$.podcasts', true) WHERE id = <tenant_id>;
```

Or toggle through the admin UI at `/admin/module-configuration` (`/admin/tenant-features` is retired and survives only as a redirect stub to that path).

---

## Database schema

All tables carry `tenant_id` for row-level tenant isolation. There are no database-level foreign keys (matching the course/marketplace convention for loosely-coupled modules). All queries scope by `tenant_id` through Eloquent global scopes on the models.

| Table | Purpose |
|---|---|
| `podcast_shows` | One row per show; `owner_user_id`, lifecycle (`status`, `moderation_status`, `visibility`), iTunes/RSS metadata (`author_name`, `owner_email`, `copyright`, `funding_url`, `explicit`), counters (`episode_count`, `subscriber_count`) |
| `podcast_episodes` | Episodes; `show_id`, `author_user_id`, audio location (`audio_url`, `audio_storage_path`, `audio_storage_disk`, `audio_mime`, `audio_bytes`), media pipeline (`media_processing_status`, `media_scan_status`), scheduling (`scheduled_for`, `published_at`, `announced_at`), optional `transcript` / `cover_image_url` |
| `podcast_media_cleanup_tasks` | Tenant-scoped durable deletion ledger for hosted audio and local podcast artwork; retains the last storage pointer, retry status, attempt count, and error until cleanup is confirmed |
| `podcast_episode_chapters` | Chapter markers per episode (`starts_at_seconds`, `title`, `url`, `position`) |
| `podcast_episode_listens` | One row per deduped listen event; privacy-safe hashes of IP, user-agent, and session ID; `listened_seconds`, `completed`, `client_family`, `retention_bucket` |
| `podcast_episode_reactions` | Emoji/like reactions (`reaction` varchar); unique per `(tenant_id, episode_id, user_id, reaction)` |
| `podcast_show_subscriptions` | Member subscriptions to shows; `notify_new_episodes` flag |
| `podcast_episode_reports` | Member content reports; `reason`, `details`, `status` (`open`/`resolved`/`dismissed`/`escalated`), `reviewed_by`, `reviewed_at` |

Migrations (in order):

- `database/migrations/2026_06_03_000001_create_podcast_module_tables.php` — core tables
- `database/migrations/2026_06_03_000002_add_distribution_metadata_to_podcasts.php` — RSS/iTunes metadata columns
- `database/migrations/2026_06_03_000003_harden_podcast_media_and_moderation.php` — media pipeline columns, subscriptions, reports
- `database/migrations/2026_06_04_120500_add_announced_at_to_podcast_episodes.php` — idempotent announcement guard
- `database/migrations/2026_07_03_000001_harden_podcast_media_pipeline.php` — fail-closed media readiness and hosted-object metadata
- `database/migrations/2026_07_12_000075_create_podcast_media_cleanup_tasks.php` — durable hosted-media and artwork cleanup ledger

---

## Key code locations

| Layer | File |
|---|---|
| Service (core logic) | `app/Services/PodcastService.php` |
| Tenant configuration | `app/Services/PodcastConfigurationService.php` |
| Member API controller | `app/Http/Controllers/Api/PodcastController.php` |
| Admin API controller | `app/Http/Controllers/Api/AdminPodcastController.php` |
| Shared controller concern | `app/Http/Controllers/Api/Concerns/InteractsWithPodcasts.php` |
| Async media job | `app/Jobs/ProcessPodcastEpisodeMedia.php` |
| Durable cleanup service/job/command | `app/Services/PodcastMediaCleanupService.php`, `app/Jobs/CleanupPodcastMedia.php`, `app/Console/Commands/DispatchPodcastMediaCleanup.php` |
| Scheduled release command | `app/Console/Commands/ReleaseScheduledPodcastEpisodes.php` |
| Models | `app/Models/PodcastShow.php`, `PodcastEpisode.php`, `PodcastEpisodeChapter.php`, `PodcastEpisodeListen.php`, `PodcastEpisodeReaction.php` |
| React pages | `react-frontend/src/pages/podcasts/` |
| React audio player | `react-frontend/src/components/podcasts/PodcastAudioPlayer.tsx` |
| React API client | `react-frontend/src/lib/api/podcasts.ts` |
| React admin panel | `react-frontend/src/admin/modules/podcasts/PodcastsAdmin.tsx` |
| Accessible-frontend views | `accessible-frontend/views/podcasts.blade.php`, `podcast-detail.blade.php`, `podcast-episode.blade.php`, `commerce-podcast-*.blade.php` |

---

## API routes

Routes are defined in `routes/api.php`. See that file (or the project OpenAPI reference) for the canonical endpoint list. A summary follows.

**Identity-free distribution (no auth required):**

| Method | Path | Handler |
|---|---|---|
| `GET` | `/v2/podcasts/{showSlug}/feed.xml` | RSS feed (iTunes-compatible) |
| `GET` | `/v2/podcasts/feed/{tenantId}/{showSlug}.xml` | RSS feed by numeric tenant ID (for aggregator subscriptions) |
| `GET` | `/v2/podcasts/media/{tenantId}/{episodeId}/audio` | Approved public hosted audio, or capability-signed restricted audio |
| `GET` | `/v2/podcasts/transcripts/{tenantId}/{episodeId}.txt` | Approved public episode transcript |
| `GET` | `/v2/podcasts/chapters/{tenantId}/{episodeId}.json` | Approved public Podcast Namespace chapters JSON |
| `POST` | `/v2/podcasts/episodes/{episodeId}/listen` | Record a listen event |

**Authenticated members (Sanctum):**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v2/podcasts` | Browse/search member-visible shows; response metadata includes the complete category list |
| `GET` | `/v2/podcasts/{showSlug}` | Authorized show detail + visible episodes |
| `GET` | `/v2/podcasts/{showSlug}/{episodeSlug}` | Authorized episode detail |
| `GET` | `/v2/podcasts/mine` | Caller's shows with all episodes |
| `POST` | `/v2/podcasts` | Create a show |
| `PUT` | `/v2/podcasts/{id}` | Update a show |
| `POST` | `/v2/podcasts/{id}/artwork` | Upload tenant-hosted square show artwork (`multipart/form-data`, field `image`) |
| `POST` | `/v2/podcasts/{id}/publish` | Publish a show |
| `POST` | `/v2/podcasts/{id}/archive` | Archive a show |
| `DELETE` | `/v2/podcasts/{id}` | Delete a show (cascades to episodes and audio files) |
| `POST` | `/v2/podcasts/{showId}/episodes` | Create an episode (JSON body or `multipart/form-data` with `audio` file) |
| `PUT` | `/v2/podcasts/{showId}/episodes/{episodeId}` | Update an episode |
| `POST` | `/v2/podcasts/{showId}/episodes/{episodeId}/cover` | Upload a tenant-hosted episode cover (`multipart/form-data`, field `image`) |
| `POST` | `/v2/podcasts/{showId}/episodes/{episodeId}/publish` | Publish an episode |
| `POST` | `/v2/podcasts/{showId}/episodes/{episodeId}/archive` | Archive an episode |
| `DELETE` | `/v2/podcasts/{showId}/episodes/{episodeId}` | Delete an episode and its hosted audio |
| `POST` | `/v2/podcasts/{showId}/subscribe` | Toggle show subscription |
| `POST` | `/v2/podcasts/episodes/{episodeId}/reaction` | Toggle episode reaction |
| `POST` | `/v2/podcasts/episodes/{episodeId}/report` | Report an episode |

**Admin only:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v2/admin/podcasts` | Dashboard (shows, episodes, stats, top episodes, reports, analytics) |
| `POST` | `/v2/admin/podcasts/shows/{id}/moderate` | Approve/reject/flag a show |
| `GET` | `/v2/admin/podcasts/shows/{id}/validate-feed` | Validate a show's RSS feed |
| `POST` | `/v2/admin/podcasts/episodes/{id}/moderate` | Approve/reject/flag an episode |
| `POST` | `/v2/admin/podcasts/reports/{reportId}/resolve` | Resolve one report without changing sibling reports |
| `GET` | `/v2/admin/config/podcasts` | Get tenant podcast configuration |
| `PUT` | `/v2/admin/config/podcasts/bulk` | Update tenant podcast configuration |

---

## Audio handling

Episodes support two audio storage modes, set at upload time:

**Hosted audio** — a file is uploaded via `multipart/form-data` with the `audio` field. `PodcastService::storeHostedAudio()` validates the MIME type (mp3, m4a, aac, wav, ogg, webm accepted), stores the file on the configured disk (`local` by default, or a cloud disk when `podcasts.media_storage_driver` is set to `cloud`), and writes `audio_storage_path` and `audio_storage_disk` on the episode. Queue work is dispatched after the database transaction commits. Member/private responses receive a one-hour HMAC capability URL; approved public episodes receive a stable unsigned proxy URL.

**External audio** — a plain HTTPS URL is accepted in the `audio_url` field. Hosted-audio columns are left null. The RSS feed uses the external URL directly for the `<enclosure>` element.

**Media pipeline** (async): when a file is uploaded with `podcasts.enable_media_processing` or `podcasts.enable_media_scanning` enabled, `ProcessPodcastEpisodeMedia` runs after commit and retries up to three times with a 30-second backoff. Publication, RSS, feed activity, and media delivery fail closed unless processing is `complete` and scanning is `clean` or explicitly `not_required`. `pending`, `not_audio`, `scan_unavailable`, `infected`, and processing failures are not distributable. Invalid or infected objects are immediately returned to draft with a non-servable sentinel URL, then deletion is recorded in `podcast_media_cleanup_tasks`. The hidden storage pointer is cleared only after the cleanup worker confirms the object is absent; false returns, exceptions, queue outages, and exhausted queue retries retain a pending ledger entry for the minute scheduler to redispatch. Normal episode/show deletion records the same durable pointer in the domain transaction before removing the database row, so failed storage cleanup cannot create an untracked orphan. If scanning is enabled, operators must configure the scanner before creators can publish hosted uploads; disabling the tenant scanning setting records `not_required` explicitly.

**Audio delivery** (`GET /v2/podcasts/media/{tenantId}/{episodeId}/audio`):

- Local disk: served as a `BinaryFileResponse` with `Accept-Ranges: bytes` for Range support (seekable in browsers).
- Cloud disk: an episode projection prefers a 10-minute
  `Storage::disk(...)->temporaryUrl()`. If URL generation is unavailable, the
  projection returns the in-app proxy URL rather than exposing the storage path
  or failing the detail request. The proxy then resolves its own temporary URL
  and returns 404 if the configured disk still cannot provide one. This is
  regression-tested in
  `tests/Laravel/Feature/Services/PodcastEpisodeAudioUrlFallbackTest.php`.
- Members-only or private episodes require a valid HMAC capability (`?expires=<ts>&signature=<hex>`). The media route deliberately does not treat an unrelated Bearer token as authorization, so changing the tenant ID in a media URL cannot reuse another tenant's member/admin privileges. Public episodes served through RSS get unsigned URLs so native players and aggregators can fetch without signing.

**Artwork** — creator-controlled external artwork URLs are rejected and legacy external values are suppressed from API, RSS, accessible HTML, feed cards, and the React player. Show artwork and episode covers use the owner-bound upload endpoints above, are stored under the tenant's podcast upload directory, and are normalized to a high-resolution square asset. Show/episode deletion records local artwork in the durable cleanup ledger; failed deletion remains visible and retryable rather than losing the only pointer.

**Allowed MIME types**: `audio/mpeg`, `audio/mp3`, `audio/mp4`, `audio/aac`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/webm`, `video/webm`. Default max upload size is 250 MB (configurable per tenant via `podcasts.max_audio_size_mb`).

---

## RSS / podcast distribution

When `podcasts.enable_rss_feed` is `true` (the default), each public show exposes an iTunes-compatible RSS 2.0 feed with Podcast Namespace 1.0 extensions.

Feed URL: `GET /v2/podcasts/{showSlug}/feed.xml`
Aggregator-stable URL: `GET /v2/podcasts/feed/{tenantId}/{showSlug}.xml`

The feed includes:

- Identity-free tenant publisher metadata: `<itunes:author>` names the tenant/community, creator names and owner email are omitted, and eligible local artwork is emitted as an absolute `<itunes:image>` URL. Category, explicit, copyright, and funding metadata remain content fields.
- `<podcast:funding>` when `funding_url` is set.
- Per-episode `<enclosure>` (with `length` and `type`), `<itunes:duration>` (HH:MM:SS), `<itunes:episodeType>` (`full`/`trailer`/`bonus`), `<itunes:season>`, `<itunes:episode>`.
- `<podcast:transcript>` (plain-text URL) when `podcasts.enable_transcripts` is `true` and a transcript is stored.
- `<podcast:chapters>` (JSON Podcast Namespace chapters URL) when `podcasts.enable_chapters` is `true` and chapters exist.

The feed only includes published, approved, public-or-inherit-visible episodes whose media is distributable. Future-scheduled episodes and unsafe, pending, or failed hosted media are excluded. Up to 300 episodes are included per feed.

Episodes with hosted audio use unsigned proxy URLs in the feed so podcast aggregators can fetch audio without time-expiring signatures.

`GET /v2/admin/podcasts/shows/{id}/validate-feed` runs a pre-submission validation and returns `{valid, errors[], warnings[], skipped_episode_count}` for feed-level problems (for example missing artwork) and per-episode media/readiness problems. Admin dashboard `rss_ready_shows` counts only genuinely feed-eligible shows, not every published row.

---

## Scheduled publishing

Episodes can be scheduled by setting `scheduled_for` to a future RFC 3339 timestamp when creating or updating an episode. The React studio converts the creator's `datetime-local` choice to an explicit UTC ISO timestamp before sending it, so server timezone and daylight-saving changes cannot shift the intended instant. Publishing such an episode sets `published_at = scheduled_for` and does not immediately notify subscribers.

The `podcasts:release-due` Artisan command (backed by
`ReleaseScheduledPodcastEpisodes`) is registered in `bootstrap/app.php`
every five minutes with overlap prevention and single-server execution. It
queries published, approved, not-yet-announced episodes whose `scheduled_for`
has passed, sets `announced_at` via a conditional update, posts a feed
activity, and notifies subscribers.

The `announced_at` column acts as an idempotent guard: the publish path, the moderation-approval path, and the scheduler all call `PodcastService::announceEpisode()`, which uses `UPDATE ... WHERE announced_at IS NULL` and returns early if the row was already claimed.

To run manually:

```bash
php artisan podcasts:release-due
php artisan podcasts:release-due --limit=50
```

Durable deletion retries are scheduler-owned:
`podcasts:dispatch-media-cleanup --limit=100` runs every minute with overlap
prevention and single-server execution. A failed storage deletion must remain
in `podcast_media_cleanup_tasks`; never clear the last private object pointer
merely because a queue dispatch or filesystem delete failed.

---

## Subscriptions and notifications

Members subscribe to a show via `POST /v2/podcasts/{showId}/subscribe`, which toggles the subscription. The `notify_new_episodes` field (default `true`) controls whether the subscriber receives an in-app notification when a new episode goes live. Subscriber counts on `podcast_shows.subscriber_count` are kept in sync with a `lockForUpdate` recount to avoid race conditions.

---

## Listen analytics

When `podcasts.enable_listen_analytics` is `true` (the default), `POST /v2/podcasts/episodes/{episodeId}/listen` records starts, periodic progress, pauses, navigation/page-hide flushes, and completion. The deduplication window is six hours: authenticated listeners are deduped by tenant user ID; anonymous listeners use a private session hash or IP+UA hash. Later events update the row's maximum `listened_seconds`. The server clamps progress to its trusted episode duration and derives completion at 95% rather than trusting a client-provided boolean.

Stored fields are privacy-preserving: IP, user-agent, and session ID are stored only as SHA-256 hashes. No raw PII is retained.

The admin dashboard (`GET /v2/admin/podcasts`) returns aggregate stats:

- Total and completed listen counts, completion rate, unique listener count.
- Client-family breakdown (browser/app family extracted from user-agent).
- Retention bucket breakdown (what proportion of episodes listeners completed: 0–25%, 25–50%, 50–75%, 75–100%, 100%+).
- Top 10 episodes by `listen_count`.

---

## Moderation

When `podcasts.moderation_enabled` is `true`, every newly created or published show and episode is placed in `moderation_status = pending` and must be approved by an admin before it appears publicly.

When moderation is off (the default), content is set to `approved` immediately on creation.

Episode reports from members are stored in `podcast_episode_reports`. When moderation is enabled, the first report sets `moderation_status = flagged` and retires its feed activity. When moderation is off, auto-flagging requires reports from at least three distinct members (`REPORT_AUTO_FLAG_THRESHOLD = 3`) to prevent a single bad actor from suppressing content. Admins resolve one row at a time via `POST /v2/admin/podcasts/reports/{reportId}/resolve` (status: `resolved`, `dismissed`, or `escalated`). A flagged episode is restored only after the final open report is resolved/dismissed. The admin review dialog provides signed audio, full text/transcript, chapters, report history, and creator-facing notes.

Material edits to an approved show or episode (including audio, transcript, chapters, artwork, scheduling, metadata, or visibility) reset it to `pending`, clear the previous moderation decision, and retire stale feed activity until a new approval. Creator APIs expose only `moderation_feedback`; internal notes, moderator IDs, and timestamps stay hidden outside admin responses.

---

## Tenant-level configuration

All settings are stored in `tenant_settings` under the `podcasts` category and read/written by `PodcastConfigurationService`. Values are cached for 5 minutes per tenant.

| Key | Default | Purpose |
|---|---|---|
| `podcasts.allow_member_show_creation` | `true` | When `false`, only admins can create shows |
| `podcasts.moderation_enabled` | `false` | Pre-publication review queue for all content |
| `podcasts.enable_rss_feed` | `true` | Expose `feed.xml` endpoints |
| `podcasts.enable_private_shows` | `true` | Allow `members` and `private` visibility |
| `podcasts.enable_transcripts` | `true` | Accept and expose episode transcripts |
| `podcasts.enable_chapters` | `true` | Accept and expose chapter markers |
| `podcasts.enable_episode_reactions` | `true` | Reactions on episodes |
| `podcasts.enable_listen_analytics` | `true` | Record listen events |
| `podcasts.max_shows_per_user` | `5` | Per-user show limit (0 = unlimited) |
| `podcasts.max_audio_size_mb` | `250` | Upload size ceiling |
| `podcasts.media_storage_driver` | `local` | `local` or `cloud` |
| `podcasts.cloud_storage_disk` | `s3` | Laravel disk name for cloud storage |
| `podcasts.cloud_cdn_base_url` | (empty) | CDN prefix for cloud audio URLs |
| `podcasts.enable_media_scanning` | `true` | Queue a scan job after audio upload |
| `podcasts.enable_media_processing` | `true` | Queue a processing job after audio upload |

Configuration can be read and written via the admin API (`GET /v2/admin/config/podcasts`, `PUT /v2/admin/config/podcasts/bulk`) or through the admin React panel under Podcasts settings.

---

## Visibility and access control

Show visibility: `public` (eligible for identity-free RSS/media distribution and visible to authenticated members), `members` (authenticated members only), `private` (owner and admins only). Episode visibility: `inherit` (follows the show), or overridden to `public`, `members`, or `private`. Identity-bearing catalogue and detail projections always require authentication even when visibility is `public`.

`PodcastService::canViewShow()` and `canViewEpisode()` enforce these rules. The show and episode API endpoints return HTTP 404 (not 403) when access is denied to avoid disclosing the existence of private content.

Future-scheduled episodes are hidden from all non-owner/non-admin viewers even after they are "published" — the embargo is enforced both in `canViewEpisode()` and in the `scopePublished()` Eloquent scope used by browse queries and RSS.

---

## React frontend entry points

| Page | Route | Notes |
|---|---|---|
| Browse shows | `/podcasts` | Authenticated, feature-gated; debounced search, server category metadata, sort filters, and explicit retry/error states |
| Show detail | `/podcasts/:showSlug` | Authenticated; canonical visibility/moderation projection |
| Episode detail | `/podcasts/:showSlug/:episodeSlug` | Authenticated; canonical visibility/moderation projection |
| Podcast Studio | `/podcasts/studio` | Auth required; show/episode management |

The `PodcastAudioPlayer` component (`react-frontend/src/components/podcasts/PodcastAudioPlayer.tsx`) handles in-browser playback, keyboard seeking, visible volume control, accessible slider value text, resume state, retry recovery, and partial listen reporting. The Studio supports create/edit workflows, tenant capability/limit metadata, image upload, RFC 3339 UTC scheduling, RSS metadata, transcript/chapter controls, and local upload cancellation/retry.

Podcast shows and episodes also appear in the authenticated main feed.
`FeedCard` has explicit podcast types plus a neutral unknown-type fallback;
activity is updated or retired when content is edited, made private, archived,
rejected/flagged, or deleted. Unified search queries the tenant-scoped SQL
projection rather than a podcast Meilisearch index. It includes eligible
public/member-visible titles and conditionally searches transcripts; private
content is excluded.

---

## Security and privacy invariants

- All queries include a `tenant_id` filter. The Eloquent global scope on `PodcastShow` and `PodcastEpisode` enforces this automatically; the handful of `withoutGlobalScopes()` calls (audio proxy, transcript, chapters, RSS by tenant ID) set `TenantContext` explicitly before querying and then authorize without borrowing the caller's original tenant role.
- Hosted audio URLs for non-public content are signed with HMAC (app-key-derived secret, 1-hour TTL). The signature is verified on every audio request via `hasValidMediaSignature()`; Bearer authentication alone never grants a cross-tenant media capability.
- Listen analytics store only hashed PII (SHA-256 of IP, user-agent, session ID). No raw values are persisted.
- Episode reports require authentication; the report reason must be non-empty.
- Upload MIME types are validated against an allowlist; the storage path uses `bin2hex(random_bytes(12))` for the filename to prevent enumeration.
- Content reports auto-flag episodes at a threshold of three distinct reporters (when moderation is off) to mitigate single-reporter griefing of creators.
- Cloud audio redirect uses `temporaryUrl()` (10-minute expiry) rather than a long-lived public URL. If `temporaryUrl()` is unavailable on the configured disk, the route returns 404 rather than leaking the storage path.
- The member export and enterprise GDPR export include podcast ownership/authorship, transcripts, chapters, listens, reactions, subscriptions, reports, and moderation activity attributable to that member. Erasure removes behavioural rows and creator content, including hosted media and tenant-local artwork; failed object cleanup leaves a private minimized tombstone and the request in a visible processing state for DPO follow-up.
- The OpenAPI coverage test enumerates every registered podcast route and fails if either checked-in contract omits an operation. Anonymous distribution operations explicitly override global bearer security; browse, studio, image upload, and admin operations inherit it.

---

## Tests

```bash
# Feature / integration tests
vendor/bin/phpunit --filter PodcastControllerTest
vendor/bin/phpunit --filter PodcastEpisodeAudioUrlFallbackTest
vendor/bin/phpunit --filter PodcastConfigurationServiceTest
vendor/bin/phpunit --filter PodcastsCategoryParityTest
vendor/bin/phpunit --filter PodcastOpenApiCoverageTest
vendor/bin/phpunit --filter PodcastErasureTest

# All podcast-related tests in one run
vendor/bin/phpunit --filter Podcast

# E2E smoke
npx playwright test e2e/tests/podcasts/podcasts-smoke.spec.ts --project=chromium-modern
```

Key regression tests:

| Test | Guards against |
|---|---|
| `PodcastControllerTest` | Full CRUD, audio upload, listen dedup, subscription toggle, RSS output, report flow, auth/tenant isolation |
| `PodcastEpisodeAudioUrlFallbackTest` | Missing cloud disk driver (e.g. `league/flysystem-aws-s3-v3` not installed) causing a fatal on audio URL generation (Sentry NEXUS-PHP-2K) |
| `PodcastConfigurationServiceTest` | Default values, typed persistence, tenant scoping of config |
| `PodcastsCategoryParityTest` | Accessible-frontend category filter parity with the React browse page |
| `PodcastOpenApiCoverageTest` | Every registered member/admin/distribution route exists in both OpenAPI contracts with the right auth boundary |
| `PodcastErasureTest` / `MemberDataExportTest` | Podcast portability, behavioural-data erasure, hosted-object cleanup, and tenant isolation |
| `GovukAlphaFrontendTest` / `CommerceParityTest` | Accessible 404 authorization, members-only catalogue parity, RSS links, creation limits, and existing-creator management |

React regressions for the player, mini-player, Studio, admin moderation, feed cards, artwork guard, browse errors/debounce, and unified search live beside their components under `react-frontend/src/**/*.test.tsx`.

---

## Failure modes and recovery

**Audio upload fails mid-write** — `storeHostedAudio()` throws `\InvalidArgumentException('Podcast media storage failed')`; episode creation rolls back and a failed replacement preserves the prior usable object/pointer. Newly written replacement objects are removed if persistence fails. The creator can retry from the preserved Studio form.

**Media job exhausts retries** — `ProcessPodcastEpisodeMedia::failed()` sets `media_processing_status = failed`, returns the episode to draft, retires any feed activity, and logs a warning. The episode cannot be published, streamed, or included in RSS until valid media is processed. Monitor `pending_media_processing`, `failed_media_processing`, `media_scan_unavailable`, and `infected_media` in the admin dashboard.

**Cloud disk driver unavailable** — audio URL generation falls back to the in-app proxy (`/v2/podcasts/media/…/audio`) instead of throwing, preventing a 500 on episode detail pages. The fallback is logged at `warning` level so it is visible in application logs and Sentry.

**Scheduled episode missed** — if the `podcasts:release-due` command is not running (scheduler down), episodes past their `scheduled_for` will not be announced. Re-running the command at any time will announce all outstanding due episodes. The `announced_at` guard prevents double-notifications.

**Duplicate announce race** — two concurrent processes (e.g. publish + scheduler) calling `announceEpisode()` at the same moment are protected by the conditional `UPDATE WHERE announced_at IS NULL`. Only one wins the row; the other exits early without re-notifying subscribers.

**RSS feed returns 404** — common causes: show `visibility` is not `public`, `status` is not `published`, `moderation_status` is not `approved`, or `podcasts.enable_rss_feed` is `false`. Run `GET /v2/admin/podcasts/shows/{id}/validate-feed` to get a structured error list.
