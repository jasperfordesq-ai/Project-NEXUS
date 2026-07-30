# Ideation & Challenges Module

Audience: maintainers and contributors working on community idea management, challenge lifecycles, voting, outcomes, or campaign organisation.

Last reviewed: 2026-07-14

---

## What it does

The Ideation & Challenges module lets tenants run structured idea-collection campaigns:

- **Authenticated members** can create *challenges* — community problem statements with a lifecycle, deadlines, optional categories, tags, and a prize description. Subsequent challenge update/delete/status operations are admin-only.
- **Members** submit ideas in response to a challenge, vote on each other's ideas, comment, and save drafts.
- **Admins** progress challenges through a controlled lifecycle, shortlist and select winning ideas, and record outcomes (implementation status and impact).
- **Campaigns** group related challenges into a themed collection.
- **Templates** allow admins to pre-configure recurring challenge patterns.
- Winning ideas can be **converted into groups** (implementation teams) with a dedicated chatroom, task board, and document store.

> **Not to be confused with Gamification Challenges.** The `challenges` table and `ChallengeService` power time-bound XP/badge rewards on the gamification track (`GET /v2/gamification/challenges`). Ideation challenges use the `ideation_challenges` table and `IdeationChallengeService`. The two systems are fully independent — they share only the word "challenge".

---

## Feature gate

Feature flag: `ideation_challenges` (default: **ON**).

- PHP: `TenantContext::hasFeature('ideation_challenges')` — checked in `IdeationChallengesController::ensureFeature()` before every action. Returns HTTP 403 when the feature is disabled.
- React: all ideation routes are wrapped in `<FeatureGate feature="ideation_challenges">`. When disabled, the browse page shows a coming-soon placeholder; deeper routes redirect to `/`.
- Accessible (GOV.UK) frontend: gated in `AlphaController` using the same `TenantContext::hasFeature()` check (see `app/Http/Controllers/GovukAlpha/Concerns/IdeationParity.php`).
- Default value declared in `app/Services/TenantFeatureConfig.php`.

---

## Challenge lifecycle

Status transitions are validated server-side. Only admins can change the status of an existing challenge.

```
draft      → open
open       → voting | evaluating | closed
voting     → evaluating | closed
evaluating → closed
closed     → open | archived
archived   → closed
```

Allowed transitions are enforced by `IdeationChallengeService::updateChallengeStatus()`. Attempting an invalid transition returns HTTP 409.

`POST /v2/ideation-challenges` currently accepts any valid challenge status at creation (default `open`), so the transition graph only governs later status changes. **Idea statuses** are admin-controlled via `updateIdeaStatus()`, but are a set rather than a transition chain: an admin may directly assign any of `submitted`, `shortlisted`, `winner`, or `withdrawn`.

---

## Database tables

All ideation tables are prefixed with `challenge_` or `ideation_`; they carry no cross-tenant data.

| Table | Purpose |
|---|---|
| `ideation_challenges` | Root challenge records; holds `tenant_id`, lifecycle `status`, deadlines, tags (JSON), `ideas_count`, `favorites_count`, `views_count`, `is_featured` |
| `challenge_ideas` | Idea submissions; `challenge_id` FK; `status` (`draft`, `submitted`, `shortlisted`, `winner`, `withdrawn`); `votes_count`, `comments_count` |
| `challenge_idea_votes` | One row per `(idea_id, user_id)` pair — toggled atomically |
| `challenge_idea_comments` | Comments on ideas |
| `challenge_favorites` | User bookmarks on challenges |
| `challenge_categories` | Tenant-scoped taxonomy for classifying challenges; has `slug`, `icon`, `color`, `sort_order` |
| `challenge_tags` | Reusable tags; linked via `challenge_tag_links` |
| `challenge_tag_links` | Many-to-many join between `challenge_tags` and `ideation_challenges` |
| `challenge_templates` | Admin-created templates with pre-filled fields; `default_tags` + `evaluation_criteria` stored as JSON |
| `challenge_outcomes` | One outcome per challenge; tracks `winning_idea_id`, implementation `status` (`not_started`, `in_progress`, `implemented`, `abandoned`), and `impact_description` |
| `idea_media` | Files or URLs attached to ideas |
| `idea_team_links` | Links a converted idea to its implementation group |
| `campaigns` | Thematic collections of challenges |
| `campaign_challenges` | Many-to-many join with `sort_order` |
| `group_chatrooms` | Chatrooms attached to implementation groups |
| `group_chatroom_messages` | Messages inside chatrooms; supports pinning |
| `team_tasks` | Kanban tasks inside implementation groups |
| `team_documents` | File uploads inside implementation groups |

Tenant scoping: `ideation_challenges.tenant_id` is the root anchor. Most idea, vote, and comment operations scope transitively through their parent challenge; the known `getIdeas()` exception is called out under [Security and privacy invariants](#security-and-privacy-invariants). Categories, tags, templates, and outcomes carry their own `tenant_id` via the `HasTenantScope` trait on the relevant Eloquent models.

---

## Backend

### Services

| Service | Responsibility |
|---|---|
| `app/Services/IdeationChallengeService.php` | Core CRUD for challenges, ideas, votes, comments, favorites, and draft management; sends email/push notifications to recipients in their preferred language via `LocaleContext::withLocale()` |
| `app/Services/ChallengeCategoryService.php` | Per-tenant category CRUD (admin only) |
| `app/Services/ChallengeTagService.php` | Tag CRUD (admin-create/delete; any authenticated user can list) |
| `app/Services/ChallengeTemplateService.php` | Template CRUD; `getTemplateData()` returns pre-filled form defaults for the challenge-create flow |
| `app/Services/ChallengeOutcomeService.php` | Upsert/read outcome record; `getDashboard()` returns aggregate stats across all closed challenges |
| `app/Services/CampaignService.php` | Campaign CRUD and challenge-linking |
| `app/Services/IdeaTeamConversionService.php` | Promotes a winning idea to an implementation group; records the link in `idea_team_links` |
| `app/Services/IdeaMediaService.php` | Media attachments on ideas |
| `app/Services/GroupChatroomService.php` | Chatrooms and messages inside implementation groups |
| `app/Services/TeamTaskService.php` | Task board for implementation groups |
| `app/Services/TeamDocumentService.php` | Document uploads for implementation groups |

### Controllers

| Controller | Path prefix | Notes |
|---|---|---|
| `app/Http/Controllers/Api/IdeationChallengesController.php` | `/api/v2/` | Authenticated member-facing endpoints; also hosts group chatroom, task, and document endpoints that belong to implementation teams |
| `app/Http/Controllers/Api/AdminIdeationController.php` | `/api/v2/admin/ideation` | Moderation view: list all challenges (offset-paginated), show, delete, advance status; requires admin middleware |

### Key API endpoints

All endpoints below require `auth:sanctum`; there are no anonymous ideation reads. See `routes/api.php` for the full list.

**Challenges**

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/v2/ideation-challenges` | required | Cursor-paginated; non-admins see `open`, `voting`, `evaluating`, and `closed`; admins may also query `draft`/`archived` |
| POST | `/v2/ideation-challenges` | required | Any authenticated member may create; fires feed activity; rate-limited 10 req/min |
| GET | `/v2/ideation-challenges/{id}` | required | Detail with `ideas_count` and caller-relative `is_favorited`; draft/archived restricted to creator/admin |
| PUT | `/v2/ideation-challenges/{id}` | admin | Update challenge fields |
| DELETE | `/v2/ideation-challenges/{id}` | admin | Hard delete |
| PUT | `/v2/ideation-challenges/{id}/status` | admin | Status transition (validates allowed paths) |
| POST | `/v2/ideation-challenges/{id}/favorite` | required | Toggle bookmark |
| POST | `/v2/ideation-challenges/{id}/duplicate` | admin | Copies challenge as `draft` with `[Copy]` prefix |

**Ideas**

| Method | Path | Notes |
|---|---|---|
| GET | `/v2/ideation-challenges/{id}/ideas` | `?sort=votes` (default) or `newest`; cursor-paginated |
| POST | `/v2/ideation-challenges/{id}/ideas` | Submit idea; notifies challenge creator |
| GET | `/v2/ideation-challenges/{id}/ideas/drafts` | User's own drafts for a challenge |
| GET | `/v2/ideation-ideas/{id}` | Single idea; includes caller-relative `has_voted` |
| PUT | `/v2/ideation-ideas/{id}` | Edit own idea while challenge is `open` |
| PUT | `/v2/ideation-ideas/{id}/draft` | Save/publish a draft (`?publish=true` transitions `draft → submitted`) |
| DELETE | `/v2/ideation-ideas/{id}` | Owner or admin; decrements counter atomically |
| POST | `/v2/ideation-ideas/{id}/vote` | Toggle vote; blocked if idea is `draft`/`withdrawn` or challenge is not `open`/`voting`; users cannot vote on their own ideas |
| PUT | `/v2/ideation-ideas/{id}/status` | Admin only; directly assigns an allowed status and notifies the idea author |
| POST | `/v2/ideation-ideas/{id}/convert-to-group` | Idea author, challenge creator, or admin creates an implementation group; idea status is not checked |

**Comments**

| Method | Path |
|---|---|
| GET | `/v2/ideation-ideas/{id}/comments` |
| POST | `/v2/ideation-ideas/{id}/comments` |
| DELETE | `/v2/ideation-comments/{id}` |

**Taxonomy and templates**

| Method | Path | Notes |
|---|---|---|
| GET | `/v2/ideation-categories` | Authenticated list |
| POST/PUT/DELETE | `/v2/ideation-categories/{id}` | Admin only |
| GET | `/v2/ideation-tags` | `?type=` filter |
| GET | `/v2/ideation-tags/popular` | Ranked by usage count |
| POST/DELETE | `/v2/ideation-tags/{id}` | Admin only |
| GET | `/v2/ideation-templates` | Admin and member |
| GET | `/v2/ideation-templates/{id}/data` | Pre-filled form defaults |
| POST/PUT/DELETE | `/v2/ideation-templates/{id}` | Admin only |

**Outcomes and campaigns**

| Method | Path |
|---|---|
| GET/PUT | `/v2/ideation-challenges/{id}/outcome` (read: authenticated; write: admin enforced in the service) |
| GET | `/v2/ideation-outcomes/dashboard` |
| GET/POST/PUT/DELETE | `/v2/ideation-campaigns`, `/v2/ideation-campaigns/{id}` |
| POST/DELETE | `/v2/ideation-campaigns/{id}/challenges` |

**Admin moderation**

| Method | Path |
|---|---|
| GET | `/v2/admin/ideation` — offset-paginated list; `?status=`, `?search=`, `?page=`, `?limit=` (max 200) |
| GET | `/v2/admin/ideation/{id}` |
| DELETE | `/v2/admin/ideation/{id}` |
| POST | `/v2/admin/ideation/{id}/status` |

---

## Frontend entry points

**React frontend** (`react-frontend/src/`):

| File | Route |
|---|---|
| `pages/ideation/IdeationPage.tsx` | `/{tenant}/ideation` |
| `pages/ideation/ChallengeDetailPage.tsx` | `/{tenant}/ideation/:id` |
| `pages/ideation/IdeaDetailPage.tsx` | `/{tenant}/ideation/:challengeId/ideas/:id` |
| `pages/ideation/CreateChallengePage.tsx` | `/{tenant}/ideation/create` (authenticated) |
| `pages/ideation/CampaignsPage.tsx` | `/{tenant}/ideation/campaigns` |
| `pages/ideation/CampaignDetailPage.tsx` | `/{tenant}/ideation/campaigns/:id` |
| `pages/ideation/OutcomesDashboardPage.tsx` | `/{tenant}/ideation/outcomes` |
| `admin/modules/ideation/IdeationAdmin.tsx` | `/admin/ideation` |
| `components/ideation/` | `TeamChatrooms`, `TeamTasks` (the only two symbols exported from `components/ideation/index.ts`) — rendered inside the group/team detail view |

**Accessible (GOV.UK) frontend** (`accessible-frontend/views/`):

`ideation.blade.php`, `ideation-idea.blade.php`, `ideation-detail.blade.php`, `ideation-challenge-form.blade.php`, `ideation-drafts.blade.php`, `ideation-manage.blade.php`, `ideation-outcome-form.blade.php`, `ideation-outcomes.blade.php`, `ideation-campaigns.blade.php`, `ideation-campaign-detail.blade.php`, `ideation-tags.blade.php`.

Controller trait: `app/Http/Controllers/GovukAlpha/Concerns/IdeationParity.php`.
Lang file: `lang/en/govuk_alpha_ideation.php` (plus 10 locale variants).

---

## Security and privacy invariants

- Challenge CRUD and single-idea/comment operations scope through `ideation_challenges.tenant_id`. **Known gap:** `IdeationChallengeService::getIdeas()` currently filters only by the supplied `challenge_id` and does not join back to the tenant-scoped challenge. Do not treat authentication alone as tenant authorization; add the parent tenant check before extending or reusing that method.
- Voting: users cannot vote on their own ideas; votes are rejected if the challenge is not in `open` or `voting` status; a duplicate vote toggles the existing vote off (idempotent toggle).
- Challenge update and delete are admin-only. Idea edit is owner-only and blocked once the challenge leaves `open` status.
- Draft ideas are owner-private: `getUserDrafts()` always filters by both `challenge_id` and `user_id`.
- Outcome upsert (including selecting a winning idea) is admin-only. The winning idea's membership in the challenge is validated before the FK is written.
- Idea submission, voting, commenting, favoriting, and cross-user team conversion apply `SafeguardingInteractionPolicy` before creating contact between members.
- Duplicate operation creates a `draft` with zeroed counters; deadlines are intentionally cleared.
- All notification emails are rendered inside `LocaleContext::withLocale($recipient, ...)` so they go out in the recipient's `preferred_language`, not the caller's locale.

---

## Notifications

`IdeationChallengeService` fires in-app notifications and push (via `NotificationDispatcher::fanOutPush`) and templated HTML email (via `EmailDispatchService::sendRaw`) for:

| Trigger | Recipient |
|---|---|
| New idea submitted to a challenge | Challenge creator |
| Vote cast on an idea | Idea author (not on unvote) |
| Comment added to an idea | Idea author |
| Idea status changed by admin | Idea author |

Email templates use `lang/en/emails_ideation.json` (plus 10 locale variants).

---

## Prerender invalidation

`app/Observers/IdeationChallengePrerenderObserver.php` — registered as an Eloquent observer on `IdeationChallenge`. On model save or delete it marks `/ideation` and `/ideation/{id}` for cache invalidation via `PrerenderService`.

---

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --testsuite=Laravel --filter=Ideation
vendor/bin/phpunit tests/Laravel/Feature/Controllers/IdeationChallengesControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/AdminIdeationControllerTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/IdeationChallengeServiceTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/ChallengeOutcomeServiceTest.php
vendor/bin/phpunit tests/Laravel/Feature/GovukAlpha/IdeationParityTest.php

# React — run from react-frontend/
npx vitest run src/pages/ideation src/components/ideation src/admin/modules/ideation
```

Key coverage:

- `IdeationChallengesControllerTest` — HTTP-level feature tests for challenge CRUD, idea submission, voting, and auth guards using `DatabaseTransactions`.
- `IdeationChallengeServiceTest` — unit tests with mocked DB; covers pagination shape, vote toggle, and draft publish path.
- `ChallengeOutcomeServiceTest` — outcome upsert and dashboard aggregation.
- `IdeationParityTest` — GOV.UK accessible-frontend route integration tests.
- React page/component tests: `IdeationPage.test.tsx`, `ChallengeDetailPage.test.tsx`, `IdeaDetailPage.test.tsx`, `CreateChallengePage.test.tsx`, `IdeationAdmin.test.tsx`, and the team sub-components.

---

## Failure modes and recovery

| Failure | Behaviour | Recovery |
|---|---|---|
| Feature disabled for tenant | All API endpoints return HTTP 403 (`FEATURE_DISABLED`); React routes show a coming-soon page | Enable `ideation_challenges` in tenant settings via the admin panel |
| Invalid status transition | `updateChallengeStatus()` returns `CONFLICT` error; HTTP 409 | Use one of the explicit transitions above; `open` may move directly to `voting`, `evaluating`, or `closed` |
| Vote on closed/evaluating challenge | `voteIdea()` returns `CONFLICT` (`challenge_voting_not_allowed`) | No action needed; the challenge must be `open` or `voting` to accept votes |
| Idea edit after challenge leaves `open` | `updateIdea()` returns `CONFLICT` (`challenge_closed_for_edits`) | Editing becomes available only if an admin returns the challenge to `open` through a valid lifecycle path; idea status can be changed separately by an admin |
| Notification email failure | `EmailDispatchService::sendRaw()` returns false; logged as `Log::warning` — the primary action still succeeds | Check the `email_log` table and the configured mail provider's delivery logs |
| Outcome `winning_idea_id` FK violation | Service validates that the idea belongs to the challenge; returns `VALIDATION_INVALID_VALUE` | Pass a valid idea ID that was submitted to the same challenge |
| Team conversion denied or repeated | Caller is not the idea author/challenge creator/admin, or `idea_team_links` already contains the idea | Use an authorized caller; if already converted, reuse the existing implementation group rather than creating another |
| Category deleted while challenges reference it | `ChallengeCategoryService::delete()` nulls out `category_id` on affected challenges before deleting the category row | No recovery needed; challenges retain their free-text `category` field |
