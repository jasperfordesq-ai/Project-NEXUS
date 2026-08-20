# Laravel Full-Parity Map

Last reviewed: 2026-07-15

Status: **Maintained reference — detailed evidence and gap map, not a current score**

Evidence provenance: the published backend was re-audited on 2026-07-15 against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and ASP.NET implementation
`9ad163c969a935407297eb459a9840798a1a9e78`; dirty backend work is excluded.
Every older inventory lacking its own exact source pair is historical and
provenance-incomplete, regardless of words such as “latest” retained inside a
checkpoint.

Canonical source: `C:\platforms\htdocs\staging` (read-only).

This is the detailed evidence and gap map. Use
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) for the
only current overall score, baseline SHAs, published/unscored split, and active
completion queue. Every inventory below is dated evidence and must be
regenerated before it is described as current.

The eleven backend commits published from `60715dfd` through `9ad163c9` after
the restart scorecard remain a single unscored delta. Some change real semantic
behavior and others correct the test harness or expectations. The canonical
status lists them. 🔴 **The bank is no longer 712/1000: it was rescored to
598/1000 on 2026-08-18 under Fixed Rubric Baseline 2 (`ASPNET-CONTRACT-R2`).**
The paragraph below is the Baseline 1 position and is history; it kept the bank at
712/1000 pending a complete scoring and
semantic-audit transaction. A later post-pause exact-SHA CI aggregate is green
at `dbafc5c3`, but it does not regenerate or accept this detailed map; this map
does not estimate their value.

Published `main` now includes schema merge `df8c8b96`. Its nine schema slices
are current published implementation evidence in `SCHEMA_PARITY.md`, not a silent
API/workflow score movement. The broader semantic map below remains anchored to
the `9ad163c9` behavior boundary until a full regeneration and scoring
transaction accepts the merged lineage.

Later published commit `c767050a` changes compatibility-controller,
authorization, Event offline check-in, marketplace-report, migration, fixture,
test, and CI behavior. It remains the latest product/API behavior source and one
unscored delta: this map has not received a complete semantic regeneration or
scoring transaction for it. Later `b3f946b3` and `dbafc5c3` commits change the
required CI workflow and test evidence only. Their terminal-green exact-SHA run
does not alter this map's semantic boundary. See
`CURRENT_ASPNET_CONTRACT_STATUS.md` and `CURRENT_SCHEMA_READINESS.md` before
using the detailed rows below.

## Latest Verified Backend Slice

Marketplace card settlement, Connect onboarding, paid-transition delivery,
escrow settlement, provider refunds, signed external-refund reconciliation,
held-escrow and paid-transfer charge-dispute recovery, and refund notifications
now have committed provider boundaries. Destination-charge and separate-charge
economics are provider-bound; unsafe or incomplete evidence fails closed.
Connect creates/reuses Express accounts, generates tenant-correct links, polls
completion capabilities, reconciles signed replay-safe `account.updated`
events, and emits an idempotent localized completion bell. Paid, payout, and
refund delivery records per-channel evidence so provider or notification replay
does not duplicate a delivered channel.

The published migration sequence includes
`20260714105831_MarketplacePaymentSettlementParity`,
`20260714115746_MarketplaceConnectOnboardingParity`,
`20260714132232_MarketplacePaidNotificationParity`,
`20260714150317_MarketplaceEscrowSettlementParity`, and
`20260714165402_MarketplaceRefundReconciliationParity`. Each slice has its named
focused service/controller and disposable-schema evidence in the canonical
status/runbook. Live Stripe/Connect execution, the complete suite, exact-SHA CI,
and unchanged-client runtime certification remain open. Refund copy is not yet
uniformly localized: the partial-refund seller path covers all 11 Laravel
locales, while full-refund buyer/seller and partial-refund buyer copy remains
English.

Secure tenant SSO/OIDC is also committed. Public discovery, redirect, callback,
and browser exchange now use signed durable state, browser/server PKCE, OIDC
nonce and JWKS validation, public-HTTPS endpoint checks, tenant-qualified
identity linking, domain and provisioning gates, one-time encrypted callback
grants, refresh-token issuance, and logout-all invalidation. Focused fake-IdP,
controller, migration-SQL, and disposable-PostgreSQL evidence is recorded at
implementation `c20d064e`; live IdP/browser proof, complete-suite/CI evidence,
and unchanged-client runtime certification remain open.

The seven apparent document-era vetting gaps are retired OpenAPI-only artifacts:
Laravel live routes omit them, the controller prohibits them, feature tests assert
404/405, and canonical React uses the metadata-only replacement. The comparator now
conditionally retires them only while Laravel routes omit them; fixture and live proof
pass at **2,601/2,601 active operations matched, 0 missing** *(frozen-baseline
figure; live on 2026-08-18 it is 2,648/2,667 matched with 9 genuine method-level
gaps)*, with seven retired entries
reported separately. ASP.NET runtime proof matches the removal responses and preserves
both legacy and current vetting rows. Static route parity is closed. Live-
provider settlement, complete-suite/CI proof, unchanged-frontend runtime proof, schema/
localization depth, federation transport, and live-provider certification remain open.

## Historical Inventory Baseline

| Surface | Laravel Edition | .NET Edition |
| --- | ---: | ---: |
| Controllers | 309 | 225 |
| Services | 483 | 188 |
| Models/entities | 200 Laravel models | 191 EF entity files |
| Migrations | 377 | 131 static migration source files; 129 EF-discovered/applied runtime IDs |
| OpenAPI operations | 1,022 | 4,452 static controller operations from parity script |
| Schema tables | 455 Laravel source tables | 378 .NET static table names |
| Frontend routes | 589 React / 607 accessible in the historical comparator; the separate 2026-07-08 Web UK checkpoint reported 608 Laravel declarations | 462 legacy React routes; the 2026-07-08 Web UK checkpoint reported 612 local declarations, 608 matches, 0 missing, 2 extra exchange workflow routes, and 3 ignored infrastructure routes |
| Localization | 11 locales / 605 locale namespaces | 7 locales / 280 locale namespaces |
| Module guides | 24 curated Laravel module guides | maintained .NET parity docs recreated in this pass |
| Locales | 11 | 7 |

These counts are directional. They are not a parity score.

`scripts/compare-laravel-api-parity.ps1` generated
`artifacts/parity/api/api-parity.json` on 2026-07-13 after its fixture passed,
with 4,452 ASP.NET controller operations, 2,592 Laravel source operations after
supplemental API route parsing and de-duplication, 2,532 static matches, and 60
missing operations. All fourteen Event Offline Check-in shapes and all eight Event People workspace shapes are now owned with
focused proof passing 4/4. Group invite preview/accept and queued export
request/status/download now have canonical V2 owners; focused lifecycle proof
passed 3/3 and the combined group gate passed 6/6. The expanded remainder is
dominated by event-product routes and also includes the seven document-era
admin vetting writes plus
prerender reset/invalidate. Guardian-consent token lookup and grant now have
their distinct Laravel-compatible GET and POST owners.
Laravel `govuk-alpha*` accessible page
routes are excluded from the API comparator and tracked in the frontend
comparator. Regenerate the artifact before using the numbers for implementation
planning.

`scripts/compare-laravel-schema-parity.ps1` generated
`artifacts/parity/schema/schema-parity.json` on 2026-07-13 after its fixture
passed. That checkpoint's live table baseline was 377 Laravel migrations, 131 ASP.NET
migration source files, 129 runtime IDs, 455 Laravel source tables, 378 .NET
table names, 187 exact matches, 268 missing Laravel-side names, and 191 .NET-
only names. The artifact is ignored by git; regenerate it before using the
numbers for schema implementation planning.

`scripts/compare-laravel-frontend-parity.ps1` generated
`artifacts/parity/frontend/frontend-parity.json` on 2026-07-04 with 589 Laravel
React routes, 462 .NET React routes, 393 React matches, 196 missing Laravel-side
React routes, 607 Laravel accessible routes, 136 `apps/web-uk` routes, 53
accessible matches, and 554 missing Laravel-side accessible routes. The artifact
is ignored by git. The React side of this artifact is historical inventory for
the `apps/react-frontend` fork, which was deleted on 2026-08-09. It cannot be
used to plan React work in this repo, because this repo has no React frontend.
Use the production Laravel React
frontend at `C:\platforms\htdocs\staging\react-frontend` as the contract target
for ASP.NET backend compatibility.

For current `web-uk/` accessible frontend work, read
`web-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md` and then its generated
matrix. At the historical 2026-07-08 merge commit `f7c80d32`, that matrix reported 608/608 Laravel accessible routes
matched, 0 missing, 2 extra local exchange workflow routes, and 3 ignored
infrastructure routes.

`scripts/compare-laravel-localization-parity.ps1` generated
`artifacts/parity/localization/localization-parity.json` on 2026-07-04 with 11
Laravel locales, 7 .NET locales, 605 Laravel locale namespaces, 280 .NET locale
namespaces, 49 namespace matches, and an English key scan showing 17,280 Laravel
keys, 5,575 .NET keys, 157 matched keys, and 4,942 missing Laravel-side keys in
matched namespaces. The artifact is ignored by git; regenerate it before using
the numbers for localization implementation planning.

`scripts/export-laravel-parity-backlog.ps1` generated
`artifacts/parity/backlog/parity-backlog.json` on 2026-07-05 with 6,487 open
implementation items across API, schema, frontend, and localization artifacts.
The artifact is ignored by git; `docs/PARITY_BACKLOG.md` is the curated rollup.

## Source Evidence For Former Exclusions

> **2026-07-15 marketplace/SSO correction:** The broad Marketplace/commerce and
> Tenant SSO rows below predate the final committed slices. Where those rows say
> real Stripe settlement, escrow, refunds/disputes, refund notifications, or the
> public SSO redirect/callback are absent, the “Latest Verified Backend Slice”
> above supersedes them. The rows remain useful as long-tail module inventories;
> they are not the current evidence boundary.
> Likewise, any later row or dated quote saying the full suite or CI remained
> open preserves its checkpoint state only. General exact-SHA run 29451087913 is
> green at `dbafc5c3`; live-provider, module-specific fixed-rubric, and
> unchanged-client runtime proof remain separate gaps.

> **2026-07-10 admin/auth correction:** The broad `Admin users` row below is
> historical where it describes scheduled runs as observability-only or lists
> tenant/global privilege columns and God-only semantics as absent. Commit
> `d2132a50` adds dedicated privilege columns, DB-backed policy rehydration,
> explicit `GodOnly`, protected God targets, real execution for
> `listing-expiry` and `job-expiry`; the guardian follow-up also maps
> `volunteer-expire-consents`, and recurring-shift parity maps
> `recurring-shifts`, leaving explicit disabled/501 behavior for the other 38
> cron definitions. Route-owner collisions are covered by live
> endpoint-table tests. Remaining gaps are full application-runtime
> certification, resource-level SuperPanel/hub authorization, user-move
> orchestration, notifications/audits, process-local auth challenges, and the
> 38 unmapped cron workflows.

> **2026-07-12 volunteer-hours checkpoint:** One canonical
> `VolunteerHoursService` now owns all eight Laravel member, organisation, and
> administrator hours routes, plus Caring support relationship hour logging.
> Locked tenant-scoped `vol_logs` decisions create semantically linked personal,
> organisation, and XP evidence exactly once; sub-hour approvals award XP
> without zero-value ledger rows. Direct Caring logging preserves the raw
> fractional input for whole-hour flooring and regional-points calculation before
> storing rounded hours. Migration `20260711192124_VolunteerHoursLedgerParity` is
> runtime ID 111 and never inserts legacy transaction/payment/XP value;
> evidence-free approved whole-hour organisation rows become `pending`, while
> approved Caring sub-hour rows remain valid. Its source also defines the tenant-
> scoped `feed_activity` projection and public-hours preference. Approved
> hours publish idempotently as `volunteer_hours` only when the volunteer has not
> opted out, with no description copied into feed content or metadata. Other
> producers, admin moderation integration, cleanup, and backfill remain open.
> Debug API/test builds and the required solution-wide Release build complete
> with zero errors and only the same four pre-existing `xUnit1031` warnings; the
> Release build took 4m36s. One disposable Linux run discovered 3,007 tests
> and passed 53/53: all 51 `VolunteerHoursParityTests` plus both
> `V15FeedActivityCompatibilityTests`. Final migration certification is also
> green: blank ID-111 replay with exact feed/privacy/FK assertions, valid
> populated 110-to-111 behavior, invalid `P0001` atomic abort with no partial
> DDL, and `has-pending-model-changes`. Disposable Docker cleanup left zero
> matching resources. The clean affected rerun discovered 3,007 tests, selected
> 243, and passed 243/243 with zero failed/skipped in 418.639s. The full 3,007-
> test suite, CI, and unchanged-frontend proof remain open.

> **2026-07-12 safeguarding/messaging checkpoint:** The runtime chain now ends
> at ID 115, `20260712060051_DirectMessageStateParity`.
> Migration 112 creates the five exact metadata-only Laravel safeguarding
> tables; migration 113 adds the `messaging_disabled` monitoring adapter; and
> migration 114 installs required consent time, a unique tenant/user/option
> selection, wider selected values, and tenant/option cascades. Migration 115
> adds durable edit/delete/archive state, false/null defaults, and a nullable
> deletion-audit user relationship with `SET NULL`. Blank 115 and populated
> 114-to-115 replays are green and preserve message content/read timestamps;
> migration 114's invalid duplicate `P0001`/no-partial-schema and catalog-
> containment proof remains retained. Model drift is green, migration 115 is
> forward-only, legacy vetting evidence does not authorize contact, and no
> frontend source was changed.
>
> Onboarding, member, admin/broker vetting, policy rotation, and protected
> option CRUD/reorder now use the locked metadata-only policy domain with exact
> risk-specific rate limits. Live message restrictions, hardened direct send,
> transactional detected-audio voice send, and the Laravel group-exchange
> caller/role/lifecycle/ledger cutover are implemented with focused contracts.
> Provider transcription, notification depth, and unchanged-frontend smoke
> remain open. P0 sender-only 24-hour edit, participant-scoped durable delete,
> and partner-ID per-user archive/restore are implemented. P1 durable reactions,
> full typing preflight/Pusher delivery, coordinator-help delivery/dedupe/audit,
> and exact read/unread envelopes/rates remain. The final deterministic direct-
> message state gate passed 39/39 with zero failed or skipped. The broader exact regression completed
> 57/58 with its sole existing race green in isolation; a separate class
> aggregate completed 12/13 before disposable PostgreSQL OOM `exit 137`, with
> the race also green in isolation. Neither aggregate is fully green, and this
> is not a full-suite, CI, runtime-frontend, or 1000/1000 claim.

| Area | Laravel evidence | .NET evidence | Current gap |
| --- | --- | --- | --- |
| Safeguarding metadata and policy | Laravel metadata-only attestation/jurisdiction/policy services, onboarding/member/admin controllers, safeguarding option workflows, and canonical React onboarding/messages consumers | `AdminSafeguardingVettingController`, `SafeguardingVettingMemberController`, `OnboardingSafeguardingController`, `AdminSafeguardingController`, the locked safeguarding services, five exact tables in migration 112, messaging adapter migration 113, preference dependency migration 114, and focused schema/domain/access/controller/rate/replay tests | Dedicated custom permission roles beyond current broker/admin authorization, queued email/provider fidelity, controlled legacy evidence disposition, non-v2 alias reconciliation, frontend runtime smoke, full suite, and CI remain open. |
| Direct messaging safety | Laravel `MessagesController`, `MessageService`, audio uploader, safeguarding interaction policy, canonical React `MessagesPage`/`ConversationPage` | Live restriction lifecycle; hardened text send/thread/attachments/side effects; POST-only staff blocked-attempt alerting; corrected partner/attachment projection; transactional detected-audio voice send; migration-115 durable state; sender-only 24-hour edit; participant-safe `self|everyone` delete; and partner-ID per-user archive/restore with active/archived inbox and unread filtering | P1 real reaction storage/batch/policy, typing preflight plus Pusher event, coordinator-help restricted-only delivery/dedupe/audit, and exact read/unread envelopes/rates remain. Provider transcription remains open. The final deterministic focused gate is 39/39 with zero failed/skipped, but the earlier 57/58 and 12/13 aggregates were not fully green for the qualified race/OOM reasons above. |
| Group exchange policy/ledger | Laravel group exchange controller/service and canonical React group-exchange pages | `GroupExchangeController`, `GroupExchangeService`, and focused lifecycle/policy/conservation/race tests now enforce caller/role identity, create/add authorization order, deterministic locking, caller-order policy evaluation, lifecycle state, canonical provider transaction rows, and hidden ledger adapters | Notification fidelity and frontend runtime smoke remain; legacy one-to-one `Exchange` is a separate fail-closed workflow. |
| Volunteer hours ledger | Laravel volunteering hours member, organisation, and administrator controllers/services; Caring support relationship hour logging; canonical React hours consumers | `VolunteerHoursController`, `VolunteerHoursService`, `VolunteerHoursLedgerParity`, and focused hours/badge/email/regional-points tests; the eight Laravel method/path pairs share strict request/action parsing, tenant/feature/policy gates, separate rate buckets, locked approval/decline transitions, exact-once whole-hour personal and organisation settlement, volunteer-hour XP/badge evidence, normal non-Caring reviewed-decision bell/push, forced-immediate approved-decision email, immediate declined-decision email only for an explicit global `instant` frequency, represented-family post-approval badge sweep, explicit no-decision-notification behavior for reviewed Caring, sub-hour no-ledger behavior, raw fractional Caring semantics, and regional-points convergence | Current focused proof is one 53/53 disposable-Linux run: all 51 `VolunteerHoursParityTests` and both `V15FeedActivityCompatibilityTests`, with 3,007 tests discovered. Debug API/test builds and the solution-wide Release build have zero errors and only the same four pre-existing `xUnit1031` warnings; the Release build took 4m36s. Final blank/populated/invalid migration-111 replay and `has-pending-model-changes` gates are green, with zero disposable Docker resources left. The clean affected rerun selected and passed 243/243 with zero failed/skipped in 418.639s. The full 3,007-test suite, CI, exact permission-table fidelity, tenant-default notification-frequency fallback, daily/monthly notification-queue delivery, recipient locale/provider breadth, Laravel-only badge families, realtime badge broadcast, and unchanged-frontend runtime certification remain open; this is not a 1000/1000 claim. |
| Admin users | `AdminUsersController.php`, `AdminSuperController.php`, Laravel React `admin/api/adminApi.ts`, `admin/modules/users/UserList.tsx`, super-admin user pages/tests | `AdminController.cs`, `AdminCompatibilityController.cs`, `AdminCompatibility3Controller.cs`, `AdminExplicitParityController.cs`, `NexusUserAccessAuthorization.cs`, `CanonicalRoleSemantics`, and focused role/writer/hidden-route tests | V2 list/detail/create/update/import, single/bulk actions, badges, consents, password helpers, impersonation, and tenant/global privilege toggles expose Laravel React envelopes with tenant scoping. Dedicated `is_admin`, `is_super_admin`, `is_tenant_super_admin`, and `is_god` columns now back DB-rehydrated policies; role-only `god` cannot cross `GodOnly`, explicit-God targets are protected, and stale role/tenant tokens fail. Manual cron execution now runs `ListingExpiry`, `JobVacancyExpiry`, `VolunteerGuardianConsentExpiry`, or `VolunteerRecurringShiftGeneration`, while the other 38 definitions are disabled/501 rather than fabricated successes. Remaining gaps include resource-level SuperPanel/hub rules, related-table user movement, notifications/audits, provider-backed email side effects, distributed scheduler locking, and the wider catch-all/scheduled workflow backlog. |
| Admin matching configuration | `AdminMatchingController::getConfig/updateConfig/clearCache`, `SmartMatchingEngine::getConfig`, Laravel React `react-frontend/src/admin/api/adminApi.ts`, `react-frontend/src/admin/modules/matching/MatchingConfig.tsx` | `AdminCompatibilityController.GetMatchingConfig/UpdateMatchingConfig`, `LaravelReactFrontendContractTests.AdminMatchingConfigV2_*`; `/api/v2/admin/matching/config` now returns Laravel's `data` envelope with React `SmartMatchingConfig` fields, five proximity bands, gates, engine version, pillars, adjustments, and AI flags; `PUT /api/v2/admin/matching/config` persists Laravel React partial updates into tenant-scoped matching config and reads them back in the Laravel response shape while preserving legacy `/api/admin/matching/config` behavior | SmartMatchingEngine score parity, `match_cache` table deletion semantics for clear-cache, analytics fidelity, broker approval workflow parity, provider/AI availability fidelity, and runtime frontend smoke coverage remain gaps |
| Admin analytics / impact reporting | `AdminCommunityAnalyticsController.php`, `AdminImpactReportController.php`, Laravel React `admin/modules/analytics/CommunityAnalytics.tsx`, `admin/modules/impact/ImpactReport.tsx` | `AdminCompatibilityController.cs`, `LaravelReactFrontendContractTests`, `AdminCompatibilityControllerTests`; community analytics dashboard/geography/export routes already have Laravel React coverage, and impact-report GET/config PUT now return Laravel React `data.sroi/health/timeline/config` and `data.message` envelopes | Deeper Laravel service equivalence, social-value cross-report sync, CSV/runtime frontend smoke coverage, and exact SROI formula parity remain gaps |
| Admin CMS pages | `AdminContentController::getPages/getPage/createPage/updatePage/deletePage`, Laravel React `adminApi.ts` `adminPages.*` | `AdminPagesController.cs`, `LaravelReactFrontendContractTests`; `/api/v2/admin/pages` list/detail/create/update/delete now accepts Laravel React `status`, numeric `show_in_menu`, `content_format`, `design_json`, `menu_order`, returns React-compatible `data` rows, and stores Laravel-only metadata in tenant config alongside the .NET `Page` entity | Builder rendering fidelity, exact Laravel `pages` schema columns, menu-item cleanup/side effects, cache invalidation, and runtime frontend smoke coverage remain gaps |
| Admin blog CRUD and bulk actions | `AdminBlogController::index/show/store/update/destroy/toggleStatus/bulkDelete/bulkPublish`, `BlogPublicController::index/categories/show`, Laravel React `adminBlog.*`, `BlogPage.tsx`, `BlogPostPage.tsx`, `POST /api/v2/admin/blog/bulk-delete`, `POST /api/v2/admin/blog/bulk-publish` | `AdminBlogController.cs`, `AdminExplicitParityController.cs`, `BlogV2Controller.cs`, `AdminBlogControllerTests`, `BlogControllerTests`; anonymous `/api/v2/blog`, `/api/v2/blog/categories`, and `/api/v2/blog/{slug}` now return Laravel React `success/data/meta` envelopes with cursor pagination, `per_page/has_more/cursor`, title/excerpt search, `featured_image`, author/category rows, post counts, SEO fields, and detail content while preserving legacy `/api/blog` auth behavior. `/api/v2/admin/blog` list matches Laravel React pagination defaults, `current_page/per_page/total/total_pages/has_more` meta, content/title search, ignored invalid status filters, and flattened `author_name`/`category_name` rows. Create/show/update/delete/toggle-status accepts React `slug`, `status`, `featured_image`, `meta_title`, `meta_description`, and `noindex` payload fields, returns Laravel `success/data` blog-post envelopes, and stores Laravel-only `noindex` in tenant config. `/api/v2/admin/blog/bulk-delete` and `/api/v2/admin/blog/bulk-publish` accept React `post_ids`, tenant-scope existing `BlogPost` rows, return Laravel `success/data.success/failed/skipped_ids`, delete eligible rows, and publish draft rows while skipping already-published/missing ids | Exact Laravel `posts`/`seo_metadata` schema fidelity, Laravel activity/audit side effects, blog comments/reactions, resource workflows, and runtime frontend smoke coverage remain gaps |
| Public resources | `ResourcePublicController::index/categories/store/download`, `ResourceCategoryController::tree`, Laravel React `ResourcesPage.tsx` | `ResourcesV2Controller.cs`, `FileUpload`, `TenantConfig`, `ResourcesControllerTests`; anonymous tenant-scoped `/api/v2/resources` now returns Laravel React `success/data/meta` cursor envelopes with `per_page`, `has_more`, `cursor`, `base_url`, search/category filters, `file_url`, `file_path`, `file_type`, `file_size`, `downloads`, uploader rows, category color rows, default social counters, and Laravel's `sort_order` plus newest-first ordering. Anonymous `/api/v2/resources/categories` returns category `id/name/slug/color/resource_count`; `/api/v2/resources/categories/tree` is explicitly routed. Authenticated multipart `POST /api/v2/resources` now accepts React `title`/`description`/`category_id`/`file`, enforces Laravel's resource upload extension/content-type allowlist, rejects SVG before storage with `errors[].code=FILE_TYPE_NOT_ALLOWED`, stores accepted bytes on disk, persists resource-linked `FileUpload` metadata, returns MIME `file_type`, byte `file_size`, stored `file_path`, and `file_url`, and list reads preserve that metadata. Authenticated `/api/v2/resources/{id}/download` streams stored upload bytes and increments a tenant-scoped compatibility download counter that list reads expose, with focused runtime coverage. Legacy `/api/resources` remains auth-protected. | Exact Laravel `resources.file_path/file_type/file_size/downloads/content_*` column fidelity, localized validation text, persisted category color/slug storage, update/delete error-message parity, resource likes/comments integration, and browser smoke coverage remain gaps |
| Admin feed moderation and announcer role | `AdminFeedController::index/show/hide/destroy/stats/grantAnnouncer/revokeAnnouncer`, Laravel React `adminModeration.*` feed calls and `UserEdit.tsx` announcer toggle | `AdminFeedController.cs`, `AdminExplicitParityController.cs`, `AdminController.cs`, `LaravelReactFrontendContractTests`; `/api/v2/admin/feed/posts`, `/posts/{id}`, `/posts/{id}/hide`, `/posts/{id}?type=...`, and `/stats` now return Laravel React `success/data/meta` envelopes, snake_case rows, counts, hidden/flagged state, detail rows, and success action bodies for post-backed, listing-backed, event-backed, poll-backed, goal-backed, job-backed, challenge-backed, volunteer-backed, blog-backed, and discussion-backed feed moderation while preserving legacy `/api/admin/feed` behavior. Feed moderation now uses the Laravel-aligned `BrokerOrAdmin` policy for admin-tier, broker, and coordinator callers while preserving member denial and admin-only announcer grant/revoke behavior; post-backed, authored non-post, and compatibility-authored challenge hide/delete now deny broker/coordinator self-moderation with a Laravel-style 403 while admin-tier callers retain access. The canonical `FeedActivity` entity/configuration/service and migration definition for `feed_activity` now exist at source level, but non-post hide/delete visibility and challenge feed authors still use tenant config; those admin consumers and producers have not migrated to the canonical projection; Laravel React `POST /api/v2/ideation-challenges` now creates persisted challenges and writes challenge feed authors, `GET/PUT /api/v2/ideation-challenges/{id}` now return/persist Laravel React edit-form metadata, and `DELETE /api/v2/ideation-challenges/{id}` now returns Laravel's HTTP 204 while removing the challenge/feed compatibility state. `grant-announcer`/`revoke-announcer` now return Laravel React success envelopes and update admin user-detail `roles[]` with `municipality_announcer` for the user-edit screen | migration of admin moderation and remaining producers to canonical `feed_activity`, cleanup/backfill fidelity, Laravel `roles`/`user_roles` schema fidelity, notification/audit/email side effects, and runtime frontend smoke coverage remain gaps |
| Feed tracking | `SocialController::recordImpression/recordClick/recordImpressionV2/recordClickV2`, `FeedRankingService::recordImpression/recordClick`, Laravel React `useFeedTracking.ts`, `useFeedImpression.ts` | `V15SocialCompatibilityController.TrackFeedEvent`, `LaravelReactFrontendContractTests`; `/api/v2/feed/posts/{id}/impression`, `/api/v2/feed/posts/{id}/click`, `/api/v2/feed/impression`, and `/api/v2/feed/click` now return Laravel v2 `data.recorded` envelopes, validate React `target_type`/`target_id`, tenant-scope feed target existence, and return Laravel-style `errors[]` for validation/not-found failures. Focused Debug runtime smoke coverage passes for post impression, polymorphic post impression, listing click, and invalid target type | Native .NET still lacks Laravel `feed_impressions`/`feed_clicks` storage, per-user debounce, CTR aggregation, and FeedRankingService side effects; runtime frontend browser smoke coverage remains a gap |
| Feed hide / not interested | `SocialController::hidePostV2/notInterested`, Laravel React feed/detail hide controls, Laravel `feed_hidden` table | `V15SocialCompatibilityController.HidePost/NotInterested`, `HiddenPost`, `TenantConfig`, `V15SocialCompatibilityControllerUnitTests`; `/api/v2/feed/posts/{id}/hide` and `/api/v2/feed/posts/{id}/not-interested` now accept Laravel React route id plus optional `type`, validate tenant-scoped feed targets, write post hides to `HiddenPost`, write non-post hidden state to deterministic tenant-config rows, and return Laravel-compatible `success/data` envelopes. Focused controller-level runtime coverage passes for listing hide and not-interested | Native .NET still lacks Laravel `feed_hidden` table/schema parity and EdgeRank/feed-ranking side effects; browser smoke coverage remains a gap |
| Feed post delete | `SocialController::deletePostV2`, Laravel React feed/profile/group/detail delete controls | `V15SocialCompatibilityController.DeletePost`, `FeedPost`, `V15SocialCompatibilityControllerUnitTests`; `DELETE /api/v2/feed/posts/{id}` and `POST /api/v2/feed/posts/{id}/delete` now tenant-scope post lookup, enforce owner-only deletion, return Laravel-style 404/403 `errors[]`, delete the post, and return `success/data.deleted/id`. Focused controller-level runtime coverage passes for success and forbidden paths | canonical `feed_activity` row cleanup and historical backfill side effects, notification/audit side effects, and browser smoke coverage remain gaps |
| Feed user mute | `SocialController::muteUserV2`, Laravel React feed/profile/group/detail mute controls, Laravel `feed_muted_users` table | `V15SocialCompatibilityController.MuteUserV2/MuteUser`, `MutedUser`, `V15SocialCompatibilityControllerUnitTests`; `/api/v2/feed/users/{id}/mute` now tenant-scopes target-user lookup, rejects self/invalid mutes, idempotently stores `MutedUser`, and returns Laravel-compatible `success/data.muted/user_id`; legacy `/api/feed/mute` keeps the body alias | Exact Laravel `feed_muted_users` table/schema naming, broader missing-user/browser smoke coverage, and feed-ranking side effects remain gaps |
| Feed reports | `SocialController::reportPostV2/reportItemV2`, Laravel React feed/detail/group report modals, Laravel `reports` table | `V15SocialCompatibilityController.ReportPost/ReportFeedItem`, `ContentReport`, legacy `FeedReport` mirror, `V15SocialCompatibilityControllerUnitTests`; `/api/v2/feed/posts/{id}/report` and `/api/v2/feed/items/{type}/{id}/report` now accept Laravel React report payloads, validate tenant-scoped feed targets, persist non-post reports in `ContentReport`, mirror post reports into `FeedReport`, reject duplicate open reports, and return Laravel-compatible `success/data.reported/target_type/target_id` envelopes. Focused controller-level runtime coverage passes for listing reports | Native .NET still maps Laravel `reports.target_type/target_id` onto `ContentReport`/`FeedReport` rather than exact schema; localized validation text, moderator notification fan-out, and browser smoke coverage remain gaps |
| Feed hashtags | `FeedSocialController::getTrendingHashtags/searchHashtags/getHashtagPosts`, Laravel React hashtag widgets/pages | `V15SocialCompatibilityController.TrendingHashtags/SearchHashtags/HashtagPosts`, `Hashtag`, `HashtagUsage`, `V15SocialCompatibilityControllerUnitTests`; `/api/v2/feed/hashtags/trending` now honors React `limit`, tenant-scopes rows, applies Laravel's recent-use window, returns `success/data[]`, and projects Laravel `tag/post_count/last_used_at` fields; `/api/v2/feed/hashtags/search` now strips wildcard characters, returns an empty Laravel data array for empty queries, tenant-scopes rows, honors `limit`, and projects `tag/post_count`; `/api/v2/feed/hashtags/{tag}` now returns Laravel React `success/data/meta` collection envelopes, honors `per_page`/cursor, tenant-scopes tag and usage rows, and filters hidden/out-of-tenant/non-post rows | Exact Laravel hashtag/post_hashtags table counter semantics, HMAC cursor signing, richer FeedService item projection parity, and browser smoke coverage remain gaps |
| Feed like toggle | `SocialController::likeV2/like`, Laravel React `useSocialInteractions.ts`, feed/detail/profile/group/listing calls | `V15SocialCompatibilityController.ToggleLike`, `ContentLike`, legacy `PostLike` mirror, `V15SocialCompatibilityControllerUnitTests`; `/api/v2/feed/like` and `/api/social/like` now accept React `target_type/target_id`, validate supported feed-backed targets, toggle post and non-post likes through a Laravel-compatible polymorphic `likes` table, mirror post likes into `PostLike` for existing .NET callers, and return Laravel React `success/data.action/status/likes_count` while preserving legacy top-level fields | Exact Laravel `likes` schema/index naming, notification/realtime/feed-ranking side effects, broader target workflow tests, and browser smoke coverage remain gaps |
| Feed likers | `SocialController::likers`, Laravel React `useSocialInteractions.ts`, `LikersModal.tsx` | `V15SocialCompatibilityController.Likers`, `V15SocialCompatibilityControllerUnitTests`; `/api/social/likers` now accepts React `target_type/target_id/page/limit`, returns Laravel React `success/data.likers/total_count/page/has_more`, default avatar fallback, `liked_at`, and `liked_at_formatted` for post and non-post polymorphic likers | Exact schema parity, notification/realtime side effects, and browser smoke coverage remain gaps |
| Feed shares | `FeedSocialController::share/unshare/getSharers`, `ShareService`, Laravel React `ShareButton.tsx`, `useSocialInteractions.ts` | `V15SocialCompatibilityController.Share/Unshare/Sharers`, `PostShare`, `LaravelReactFrontendContractTests`; `/api/v2/shares` now supports Laravel React polymorphic share/toggle/delete for `post`, `listing`, `event`, `poll`, `job`, `blog`, `discussion`, `goal`, `challenge`, and `volunteer` target types, returns Laravel `data/meta` envelopes with 201 new-share status, idempotent delete, invalid-type 422 errors, self-share guard, and Laravel sharer list shape | Laravel notification side effects, unified feed activity/repost rows, exact share-service notification behavior, and runtime frontend browser smoke coverage remain gaps |
| Legacy social comments | `SocialController::comments/fetchComments/submitComment`, `CommentService`, `MentionService`, `SocialNotificationService`, `HtmlSanitizer` | `V15SocialCompatibilityController.Comments`, `ThreadedComment`, `ContentMention`, `SocialCommentContactPolicy`, `LaravelHtmlSanitizer`, `20260714234546_SocialCommentMentionParity`, and focused unit/PostgreSQL tests; `/api/social/comments` accepts Laravel legacy `action=fetch|submit` payloads, sanitizes HTML before persistence and mention resolution, persists tenant-bound mentions, applies the shared safeguarding boundary, and creates recipient-locale mention/reply/content-owner notifications before non-critical push fan-out. Canonical mention search returns the tenant-unique public username instead of email | Broader target workflow tests, provider-backed push proof, and browser smoke coverage remain gaps |
| Legacy social comment reactions | `SocialController::reaction`, `CommentService::toggleReaction` | `V15SocialCompatibilityController.ToggleReaction`, `CommentReaction`, `V15SocialCompatibilityControllerUnitTests`; `/api/social/reaction` now accepts Laravel legacy `comment_id`/`target_id` plus `emoji` named reaction payloads, toggles one user reaction per threaded comment, and returns `data.action/reactions` while preserving `/api/v2/posts/{id}/reactions` post behavior | Exact Laravel polymorphic `reactions.target_type=comment` schema parity, notification/realtime side effects, broader target workflow tests, and browser smoke coverage remain gaps |
| Feed comments and reactions | `CommentsController`, `CommentService`, `HtmlSanitizer`, Laravel React `useSocialInteractions.ts` | `CommentsV2Controller`, `ThreadedCommentService`, `LaravelHtmlSanitizer`, `CompatibilityAliasController.AddCommentReaction`, `CommentReaction`, `LaravelReactFrontendContractTests`; `/api/v2/comments` supports Laravel React post-target create/reply/list/edit/delete with `data/meta`, `comments/count`, threaded replies, subtree `deleted_count`, invalid-target `errors[]`, and reaction toggle responses. Shared-service create/edit sanitization preserves Laravel-safe formatting and removes executable blocks, unsafe attributes, inline styles, and dangerous URL schemes; the lifecycle and sanitizer assertions pass against disposable PostgreSQL | Mention processing, notifications, broader non-post target workflow tests, and browser smoke coverage remain gaps |
| Feed item reactions | `ReactionController`, `ReactionService`, Laravel React feed/profile/detail/group reaction calls and `ReactionDetailsModal.tsx` | `MiscParityController.CreateReaction/Reactions/ReactionUsers`, `ContentReaction`, `LaravelReactFrontendContractTests`; `/api/v2/reactions` now supports Laravel React polymorphic reaction toggle/show/reactor-list contracts for post and listing targets, Laravel reaction types including `celebrate`, `clap`, and `time_credit`, `data.action/reaction_type/reactions` envelopes, `top_reactors`, `user_reaction`, invalid-reaction `errors[]`, and paginated `meta.has_more`. Focused Debug runtime smoke coverage passes for the feed reaction workflow | Exact Laravel `reactions` schema column/index naming, notification/realtime fan-out, feed-ranking side effects, broader target workflow tests, and browser smoke coverage remain gaps |
| Mention search | `MentionController::search`, `SocialController::mentionSearch`, `MentionService::searchUsers`, `CommentService::searchUsersForMention`, Laravel React `MentionInput.tsx`, `useSocialInteractions.ts` | `MemberParityController.MentionSearch`, `V15SocialCompatibilityController.MentionSearch`, `ContentMention`, `SocialCommentContactPolicy`, `20260714234546_SocialCommentMentionParity`, route alias convention, and focused unit/PostgreSQL tests; both search contracts return Laravel's nullable tenant-unique public username, never email, while comment submission resolves canonical React handles into durable tenant-bound mention rows and recipient notifications | The Laravel V2 service documents blocked-user exclusion but its frozen raw SQL does not implement it; provider-backed push proof and browser smoke remain open without inventing a divergent ASP.NET filter |
| Gamification profile | `GamificationV2Controller::profile`, `GamificationService::getLevelProgress`, Laravel React `AchievementsPage.tsx` profile bootstrap | `GamificationController.GetProfile`, route alias convention, `GamificationControllerTests.LaravelReactProfileV2Alias_UsesSuccessDataEnvelope`; `/api/v2/gamification/profile` now returns the Laravel React `success/data/meta` envelope with `data.user`, `xp`, `level`, `level_progress`, `badges_count`, `showcased_badges`, `is_own_profile`, `xp_values`, and `level_thresholds` while preserving legacy top-level fields for older .NET callers. Focused Debug runtime coverage passes for the V2 alias | Exact Laravel XP value table, public `user_id` profile lookup semantics, showcased badge fidelity, privacy rules, and browser smoke coverage remain gaps |
| Gamification daily reward | `GamificationV2Controller::dailyRewardStatus/claimDailyReward`, `DailyRewardService`, Laravel React `AchievementsPage.tsx` daily reward widget | `ReactFrontendCompatibilityController.DailyRewardStatus/ClaimDailyReward`, `DailyReward`, `GamificationV2ControllerTests`; `/api/v2/gamification/daily-reward` now returns Laravel React `data.claimed_today/current_streak/reward_xp/next_reward_xp/next_claim_at` on read, `data.claimed` plus nested `data.reward.xp_earned/base_xp/milestone_bonus/streak_day/longest_streak` on claim, and a Laravel-style 409 `errors[].code=RESOURCE_CONFLICT` duplicate-claim envelope. Focused Debug runtime coverage passes for read/claim/reload through the Laravel React V2 alias | Broader gamification profile, badges, collections, XP shop, showcase, challenge claim, seasons, nexus-score, community-dashboard, engagement-history, service-side XP log fidelity, and browser smoke coverage remain gaps |
| Gamification badges | `GamificationV2Controller::badges/showBadge`, `GamificationService::getBadgeByKey`, Laravel React `AchievementsPage.tsx` badge grid/detail modal | `GamificationController.GetBadges/GetBadgeByKey`, route alias convention, `GamificationControllerTests.LaravelReactBadgesV2Alias_UsesBadgeKeyListAndStringDetailShape`; `/api/v2/gamification/badges` now returns tenant-scoped Laravel React rows with `badge_key`, `name`, `description`, `icon`, `type`, `earned`, `earned_at`, `is_showcased`, and `meta.available_types`; `/api/v2/gamification/badges/{badgeKey}` now accepts string badge keys and returns the badge detail shape consumed by the React modal. Focused Debug runtime coverage passes for list/detail through the V2 alias | Exact Laravel `user_badges.badge_key/is_showcased/showcase_order` schema fidelity, Laravel badge-definition taxonomy/rarity fields, notification side effects, and browser smoke coverage remain gaps |
| Gamification showcase | `GamificationV2Controller::updateShowcase`, `UserBadge::updateShowcase/getShowcased`, Laravel React `AchievementsPage.tsx` showcase modal | `CompatibilityAliasController.UpdateShowcase`, `BadgeShowcase`, `GamificationController.GetBadges`, `GamificationControllerTests.LaravelReactShowcaseV2Alias_PersistsOwnedBadgeSelectionForBadgeReload`; `PUT /api/v2/gamification/showcase` now accepts React `{ badge_keys }`, enforces max five badges, validates tenant-scoped ownership, persists ordered showcase rows, returns Laravel React `success/data.message/showcased_badges`, and badge reloads expose `is_showcased: true` for selected badges | Exact Laravel `user_badges.is_showcased/showcase_order` storage-column fidelity, profile showcased badge enrichment, localized validation text, and browser smoke coverage remain gaps |
| Ideation challenge status | `IdeationChallengesController::updateStatus`, `IdeationChallengeService::updateChallengeStatus`, Laravel React `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeStatus`, `LaravelReactFrontendContractTests`; `PUT /api/v2/ideation-challenges/{id}/status` now exists, requires admin, accepts Laravel lifecycle statuses, enforces Laravel transition rules, persists the status metadata used by `GET /api/v2/ideation-challenges/{id}`, and returns the Laravel React challenge projection | Native .NET storage still maps Laravel-only status onto tenant config until exact ideation challenge schema parity exists; notification/audit side effects and runtime frontend smoke coverage remain gaps |
| Ideation challenge favorites | `IdeationChallengesController::toggleFavorite`, `IdeationChallengeService::toggleFavorite`, Laravel React `IdeationPage.tsx`, `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeFavorite`, `ProjectIdeationChallengeAsync`, `LaravelReactFrontendContractTests`; `POST /api/v2/ideation-challenges/{id}/favorite` now toggles the caller's favorite state, returns Laravel React `success/data.favorited/favorites_count`, and `GET /api/v2/ideation-challenges/{id}` now includes `is_favorited` and `favorites_count` for the authenticated caller | Native .NET storage maps Laravel `challenge_favorites` and `ideation_challenges.favorites_count` onto tenant config until exact schema parity exists; notification/analytics side effects and runtime frontend smoke coverage remain gaps |
| Ideation challenge duplicate | `IdeationChallengesController::duplicate`, `IdeationChallengeService::duplicateChallenge`, Laravel React `ChallengeDetailPage.tsx` | `ReactFrontendCompatibilityController.DuplicateIdeationChallenge`, `LaravelReactFrontendContractTests`; `POST /api/v2/ideation-challenges/{id}/duplicate` now requires admin, creates a `[Copy]` draft challenge, copies Laravel React edit metadata, writes the compatibility feed author, returns HTTP 201 with `success/data`, and opens cleanly through `GET /api/v2/ideation-challenges/{id}` | Native .NET storage still maps Laravel-only challenge columns onto tenant config; exact duplicate side effects, notifications/audit, and runtime frontend smoke coverage remain gaps |
| Ideation challenge outcomes | `IdeationChallengesController::getOutcome/upsertOutcome/outcomesDashboard`, `ChallengeOutcomeService`, Laravel React `ChallengeDetailPage.tsx`, `OutcomesDashboardPage.tsx` | `ReactFrontendCompatibilityController.IdeationChallengeOutcome/UpsertIdeationChallengeOutcome/IdeationOutcomesDashboard`, `LaravelReactFrontendContractTests`; `GET/PUT /api/v2/ideation-challenges/{id}/outcome` now read and persist React outcome modal fields including `winning_idea_id`, `implementation_status`, and `impact_description`, with admin-only writes and Laravel React `success/data` envelopes. `GET /api/v2/ideation-outcomes/dashboard` now returns React summary counters and outcome rows with challenge titles. | Native .NET storage maps Laravel `challenge_outcomes` onto tenant config until exact schema parity exists; winning-idea challenge membership validation, broader dashboard filters/ordering fidelity, notifications/audit, and runtime frontend smoke coverage remain gaps |
| Ideation campaigns | `IdeationChallengesController::listCampaigns/showCampaign/createCampaign/updateCampaign/deleteCampaign/linkChallengeToCampaign/unlinkChallengeFromCampaign`, `CampaignService`, Laravel React `CampaignsPage.tsx`, `CampaignDetailPage.tsx`, `ChallengeDetailPage.tsx` campaign-link modal | `ReactFrontendCompatibilityController.IdeationCampaigns/CreateIdeationCampaign/IdeationCampaignDetail/LinkIdeationCampaignChallenge/UnlinkIdeationCampaignChallenge`, `LaravelReactFrontendContractTests`; `GET/POST /api/v2/ideation-campaigns`, `GET/PUT/DELETE /api/v2/ideation-campaigns/{id}`, `POST /api/v2/ideation-campaigns/{id}/challenges`, and `DELETE /api/v2/ideation-campaigns/{id}/challenges/{challengeId}` now support the Laravel React campaign workflow with 201 create/link, 204 delete/unlink, `success/data` envelopes, `challenges_count` aliases, and linked challenge rows | Native .NET storage maps Laravel `campaigns` and `campaign_challenges` onto tenant config until exact schema parity exists; exact cursor pagination, creator display names, audit/notification side effects, and runtime frontend smoke coverage remain gaps |
| Ideation bootstrap taxonomies/templates | `IdeationChallengesController::listCategories/popularTags/listTags/listTemplates/showTemplate/getTemplateData`, `ChallengeCategoryService`, `ChallengeTagService`, `ChallengeTemplateService`, Laravel React `IdeationPage.tsx`, `CreateChallengePage.tsx` | `CompatibilityController.GetIdeationCategories`, `ReactFrontendCompatibilityController.PopularIdeationTags/IdeationTemplates/IdeationTemplateData`, `MiscParityController.IdeationTags/IdeationTemplate`, `IdeationBootstrapCompatibility`, `LaravelReactFrontendContractTests`; `/api/v2` aliases now return Laravel React `success/data` envelopes for ideation categories, popular tags, tag list, template list/detail, and template form data, with category/tag/template field names used by the React create/list flows. Focused Debug runtime smoke coverage passes for the bootstrap workflow | Native .NET currently returns a compatibility default taxonomy/template set; exact Laravel `challenge_categories`, `challenge_tags`, `challenge_templates`, challenge-tag-link usage, tenant-custom admin CRUD persistence, and service side effects remain gaps |
| Ideation ideas/comments/media | `IdeationChallengesController::ideas/submitIdea/showIdea/updateIdea/updateDraft/deleteIdea/voteIdea/updateIdeaStatus/convertToGroup/comments/addComment/deleteComment/listIdeaMedia/addIdeaMedia/deleteIdeaMedia`, Laravel React `ChallengeDetailPage.tsx`, `IdeaDetailPage.tsx` | `ReactFrontendCompatibilityController`, `LaravelReactFrontendContractTests`; explicit `/api/v2` handlers now cover idea submit/list/drafts/detail/update/draft/status/delete, vote, convert-to-group, comment list/create/delete, and JSON link-media list/create/delete with Laravel React `success/data`, `data.voted/votes_count`, `data.id` for converted groups, 201 creates/convert, and 204 deletes. Runtime execution of the focused contract test is blocked locally by Windows Application Control on the copied test `Nexus.Api.dll` in this pass. | Native .NET storage maps Laravel media rows onto tenant config and maps challenge membership through `Idea.Category` until exact Laravel `ideation_ideas` and media schema parity exists; deeper validation/authorization, cursor pagination, conversion side effects, and runtime frontend smoke coverage remain gaps |
| Ideation team tasks | `IdeationChallengesController::listTasks/createTask/showTask/updateTask/deleteTask/taskStats`, `TeamTaskService`, Laravel React `TeamTasks.tsx` | `GroupsParityController.Tasks/TaskStats`, `CompatibilityAliasController.CreateGroupTask/ShowTeamTask/UpdateTeamTask/DeleteTeamTask`, `LaravelReactFrontendContractTests`; `/api/v2` aliases now cover list/create/detail/update/delete/task-stats with Laravel React `success/data`, list `meta.cursor/per_page/has_more`, statuses, priorities, stats counters, and 204 deletes on the `/api/v2` path. Focused Debug runtime smoke coverage passes for the task workflow | Native .NET storage maps Laravel `team_tasks` onto tenant config until exact schema parity exists; assignment validation, cursor fidelity, and notifications/audit remain gaps |
| Ideation team documents | `IdeationChallengesController::listDocuments/uploadDocument/deleteDocument`, `TeamDocumentService`, Laravel React `TeamDocuments.tsx` | `GroupsParityController.Documents`, `CompatibilityAliasController.UploadGroupDocument/DeleteTeamDocument`, `LaravelReactFrontendContractTests`; `/api/v2` aliases now cover upload/list/delete with Laravel React `success/data/meta`, document row fields, persisted upload-refresh behavior, 201 uploads, and 204 deletes. Focused Debug runtime smoke coverage passes for upload/list/delete | Native .NET storage maps Laravel `team_documents` onto `group_files` until exact schema parity exists; MIME allow-list parity, file cleanup, cursor fidelity, and notifications/audit remain gaps |
| Ideation team chatrooms | `IdeationChallengesController::listChatrooms/createChatroom/deleteChatroom/chatroomMessages/postChatroomMessage/deleteChatroomMessage/pinChatroomMessage/unpinChatroomMessage/pinnedChatroomMessages`, `GroupChatroomService`, Laravel React `TeamChatrooms.tsx` | `GroupsParityController.Chatrooms/CreateChatroom/PostChatroomMessage/ChatroomMessages/DeleteChatroomMessage/DeleteStoredChatroom/PinMessage/UnpinMessage/PinnedMessages`, `LaravelReactFrontendContractTests`; `/api/v2` aliases now cover channel list/create/delete, message list/create/delete, pin/unpin, and pinned-message reads with Laravel React `success/data`, 201 creates/pins, and 204 deletes. Focused Debug runtime smoke coverage passes for the channel/message/pin/delete workflow | Native .NET storage maps Laravel `group_chatrooms` and `group_chatroom_messages` onto tenant config until exact schema parity exists; private-channel permissions, cursor encoding fidelity, Pusher/broadcast side effects, notifications/audit, and exact table parity remain gaps |
| Caring Community | 260 matched files including `app/Services/CaringCommunity/*`, `CaringCommunityApiController.php`, `FutureCareFundService.php`, `AhvPensionExportService.php`, `AdminCaringCommunityController::workflow/tandemSuggestions/dismissTandemSuggestion/assistedOnboarding`, `MunicipalSurveyController.php`, `TrustTierController.php`, `WarmthPassController.php`, `CaregiverApiController.php`, `VereinFederationMemberController.php`, KISS/municipal/civic services, caring admin pages | Initial .NET parity now covers emergency alerts, external integration backlog, federation peers plus member federation-directory, sub-regions, care providers, success stories, caregiver links plus burnout/schedule/request-on-behalf and cover-request reads/create/assign, public municipality events-calendar default/code routes, admin assisted onboarding, admin workflow dashboard read plus policy update, review assignment, review decision, and review escalation routes, admin tandem suggestions read/dismiss routes with suppression log, project announcements, category coefficients, commercial boundary, municipal copilot, data-quality reads, civic digest member digest/prefs plus admin cadence, disclosure packs, operating policy, member statements, municipal ROI, nudge analytics/config plus tandem-candidate dispatch, paper onboarding, pilot scoreboard, recipient circle, regional-points admin plus member summary/history/transfer/marketplace quote/redeem, research reads plus member consent, agreement-template render, research partner create, dataset generation, dataset-export revoke, and role-preset status/install, trust-tier member/admin routes, warmth-pass member/admin reads, safeguarding reads plus member report submission/report assignment/escalation/note/status actions, SLA/support reads plus admin support-relationship create/update/hour logging, admin and member Verein member import/preview plus admin assignment, member relationship lifecycle, member request-help and voice prefill, member GDPR/FADP data export, member Future Care Fund summary, member AHV pension evidence-pack export, integration showcase, favours including member offer-favour, forecast dashboard, KPI baseline, launch readiness, lead nurture, loyalty, municipality feedback, municipality surveys, legacy hour estate, same-platform hour transfer, hour-gift inbox/sent reads plus send/accept/decline/revert mutations, KISS Treffen member list/detail reads plus admin upsert/minutes mutations, Caring Community Markt member feed, invite codes, and isolated-node decision gates. Evidence includes represented tables/settings such as `caring_federation_peers`, `caring_cover_requests`, `caring_help_requests`, `caring_municipality_feedback`, `caring_support_categories`, `caring_tandem_suggestion_log`, `caring_trust_tier_config`, `caring_hour_gifts`, `caring_kiss_treffen`, `caring_smart_nudges`, `municipality_surveys`, `municipality_survey_questions`, `municipality_survey_responses`, `municipal_report_templates`, `municipal_verifications`, `verein_federation_consents`, regional-points/research/loyalty tables, shared `categories.substitution_coefficient`, `users.trust_tier`, listing geo/image fields for the Markt feed, `TenantConfig` civic digest/user prefs and workflow policy keys, `MunicipalSurveyService`, `TrustTierService`, `WarmthPassService`, `CaregiverSupportService`, `CaringCommunityWorkflowService`, `CaringCommunityDataExportService`, `CaringCommunityFutureCareFundService`, `CaringCommunityAhvPensionExportService`, `CaringRegionalPointService`, `CaringResearchPartnershipService`, `ResearchAgreementTemplateService`, `CaringCommunityRolePresetService`, `CaringSafeguardingService`, `CaringSupportRelationshipService`, `CaringCommunityVereineAdminService`, `CaringTandemMatchingService`, `CaringNudgeAnalyticsService`, `CaringHourGiftService`, `KissTreffenService`, `CaringCommunityMarktService`, `MunicipalityEventsCalendarController`, `AdminCaringCommunityAssistedOnboardingController`, `AdminCaringCommunitySupportController`, `AdminCaringCommunityVereineController`, and `AdminCaringCommunityKissTreffenController`. | These tiers have initial parity only. Frontend and accessible surfaces are out of scope for this backend-only session; backend gaps still include non-tandem nudge trigger parity, civic digest email dispatch/delivery claims, remote federation transfer delivery, missing `caring_help_requests.category_id` category derivation for warmth pass, and broader caring backend/admin workflows. |
| Marketplace / commerce | 244 matched files including `Marketplace*Controller.php`, `MerchantOnboardingController.php`, `MerchantOnboardingService.php`, `MarketplaceAiController.php`, `MarketplacePromotionController.php`, `MarketplaceCommunityDeliveryController.php`, `MarketplaceGroupController.php`, `MarketplacePickupSlotController.php`, `Marketplace*Service.php`, marketplace models, merchant/coupon/ads routes, Laravel React marketplace pages and components | 10 matched files including `MarketplaceController.cs`, `MarketplaceService.cs`, `MarketplaceEntities.cs`; `CaringCommunityMarktController.cs` now aggregates marketplace items into the caring-community feed; `MemberParityController.cs` now covers the Laravel React merchant-onboarding status/step/complete contract with focused tests; `LaravelReactFrontendContractController.cs` now returns React-shaped buyer shipping options for `/api/v2/marketplace/sellers/{sellerId}/shipping-options`; `MarketplaceController.cs` now covers the Laravel React listing browse/detail/save/report/create/edit/media upload contract, public seller profile/listings contract, group marketplace member-gated listings/stats contract, collections/saved-searches, seller dashboard/my-listings/renew/delete workflow, seller shipping-options CRUD, promotion-selector products/promote-submit, marketplace offer-create/list/action, owner-only AI auto-reply request/response shape, seller coupon CRUD, BuyNow order/payment-intent plus listing pickup-slot availability reads, order history/sales/purchases plus ship, confirm-delivery, and rating actions, seller pickup-slot create/list/delete, pickup reservation/my-pickups/QR-scan, and community-delivery offer create/list/accept/confirm contracts; `AdminMarketplaceController.cs` now covers Laravel React admin dashboard, listing moderation reads, seller list/verify/suspend, and coupon oversight envelopes; `V15SocialCompatibilityController.cs` now covers BuyNow coupon validation | Deep workflow and contract parity still needed across provider-backed AI auto-reply quality, deeper seller profile storage fields (`cover_image_url`, separate community trust score, response metrics, partner badge timestamps), deeper seller-management analytics/media/bulk workflows, deeper order lifecycle workflows such as refunds/disputes/auto-complete, real Stripe payments, escrow, full pickup order/payment orchestration, coupon redemption/payment side effects, ads, stricter offer action authorization/expiry/notification side effects, persisted community-delivery notes/estimated-minutes/timestamps, and broader merchant workflows |
| Courses learner/instructor API | `CourseController.php`, `CourseEnrollmentController.php`, `CourseContentController.php`, `CourseQuizController.php`, `CourseCohortController.php`, `CourseGroupController.php`, `CourseDiscussionController.php`, `CourseService.php`, Laravel React `src/lib/api/courses.ts` and course pages | `CoursesCompatibilityController.cs`, `CoursesCompatibilityService.cs`, `AdminCoursesService.cs`, `CoursesCompatibilityControllerUnitTests`, `AdminCoursesControllerUnitTests`; routes cover browse, category, show, review, create/update/delete, publish/unpublish, enrollment, progress, prerequisites, certificate, content builder, discussions, quizzes, cohorts, groups, analytics, grading, and admin moderation with `/api/v2` aliases. Course endpoints now honor the tenant `features.courses=false` flag with Laravel-style `FEATURE_DISABLED` responses. Course create now matches Laravel's draft/pending lifecycle and default `members` visibility for the instructor dashboard. Course create and authored-course reads now honor Laravel's `courses.allow_member_authoring=false` policy by requiring an instructor grant or admin role. Core course update/publish/unpublish/delete/analytics plus content-builder and grading endpoints now require the course owner or admin; grade-attempt resolves the owning course before applying the same guard. Course group attach/detach now match Laravel's `requireManageableGroup` behavior by returning `RESOURCE_NOT_FOUND` for missing groups and `FORBIDDEN` unless the caller can manage the target group. Course publish now honors Laravel's `courses.moderation_enabled` tenant setting by keeping moderated publishes pending and leaving `published_at` null until approval. Admin moderation now reads the same instructor-created compatibility state, approves pending published courses, stamps `published_at`, and makes them public-browseable. | Compatibility state is still stored in tenant config rather than full Laravel course tables; admin approval workflow side effects beyond state transition, feed/notification side effects, real certificate rendering, and browser smoke coverage remain gaps. |
| Donations / billing / member premium | `DonationPaymentController.php`, `StripeDonationService.php`, `AdminBillingController.php`, `MemberPremiumController.php`, `Admin/MemberPremiumAdminController.php`, donation/member-premium admin routes, Laravel React `DonationCheckout.tsx`, `DonationReceipt.tsx`, `admin/api/billingApi.ts`, `admin/api/memberPremiumApi.ts`, `PricingPage.tsx`, `MySubscriptionPage.tsx`, member-premium finance admin pages | `MiscParityController.cs`, `AdminExplicitParityController.cs`, `MemberParityController.cs`, `MoneyDonation`, `SubscriptionPlan`, `UserSubscription`, `LaravelReactDonationContractTests.cs`, `LaravelReactMemberPremiumCompatibilityTests.cs`, `AdminV2RouteAliasRuntimeTests`, `AdminExplicitParityControllerTests`, admin donation/member-premium compatibility routes | Laravel React payment-intent and receipt calls now have tenant-scoped ASP.NET contract coverage with `success/data`, `client_secret`, `donation_id`, and receipt JSON fields. Member-premium public tiers, `me`, checkout, billing-portal, and local cancel member calls now project public active `SubscriptionPlan` rows into React `data.tiers[]`, project `UserSubscription`/`SubscriptionPlan` into React `subscription`/`entitled_tier`/`unlocked_features`, accept React `tier_id`/`interval`/`return_url` and `return_url` payloads, return Laravel React `data.checkout_url/session_id` plus `data.portal_url` envelopes, and mark active local subscriptions cancelled with `data.cancelled`. Admin `GET /api/v2/admin/member-premium/tiers`, `GET /api/v2/admin/member-premium/tiers/{id}`, `POST /api/v2/admin/member-premium/tiers`, `PUT /api/v2/admin/member-premium/tiers/{id}`, `DELETE /api/v2/admin/member-premium/tiers/{id}`, `POST /api/v2/admin/member-premium/tiers/{id}/sync-stripe`, and `GET /api/v2/admin/member-premium/subscribers` now return Laravel React tier/subscriber envelopes, include inactive tenant-scoped tiers for admin users, project `tenant_id`, price cents, normalized feature arrays, Stripe price-id metadata, detail timestamps, missing-tier `TIER_NOT_FOUND`, HTTP 201 creates, partial update payloads, tenant-config Laravel-only tier metadata, list `active_subscriber_count`, stale Stripe price metadata clearing on price changes, local sync price metadata, delete active-subscriber conflicts, and paginated subscriber rows. `/api/v2/billing/plans` now reads active public tenant-scoped `SubscriptionPlan` rows and returns the Laravel React `Plan` shape with numeric ids, generated slugs, prices, normalized feature arrays, and `is_active`. `/api/v2/admin/billing/subscription` now returns the latest tenant subscription as the singular Laravel React `SubscriptionDetails` object instead of an admin list. `/api/v2/admin/billing/checkout` now matches Laravel's zero-price plan behavior by activating the tenant subscription locally and returning `data.activated=true` with `data.checkout_url=null`; paid plans now return a Laravel-style local `data.checkout_url` plus `data.session_id` envelope and audit row instead of `501`. `/api/v2/admin/billing/invoices` now maps subscription-backed rows into the React invoice shape with `number`, `date`, `amount`, `currency`, `status`, `hosted_invoice_url`, and `invoice_pdf` while retaining internal aliases for admin/debug use. `/api/v2/admin/billing/portal` now returns Laravel's `NO_SUBSCRIPTION` error envelope instead of a generic accepted compatibility write when ASP.NET has no Stripe customer record. `/api/v2/admin/billing/upgrade-request` now returns Laravel `data.sent=true` and writes a tenant-scoped `billing.upgrade_requested` audit row instead of a generic compatibility row. Real Stripe PaymentIntent/paid Checkout/Portal/Product/Price creation, provider-backed member-premium cancellation/webhooks, exact Laravel `pay_plans`/`tenant_plan_assignments`/member-premium schema parity, billing-interval storage, Gift Aid persistence, receipt email delivery, provider-backed upgrade email delivery, refunds, disputes, Stripe invoice retrieval, and full member-premium finance workflow parity remain open. |
| Verein / Clubs | 47 matched Laravel files including `app/Http/Controllers/Api/Verein/*`, dues/federation services, club controller | `VereineParityController.cs` and auth tests | Mostly compatibility shell; domain model/workflows need audit |
| Regional Analytics | route file, services, PDF generator, billing, admin pages; schema migrations for `regional_analytics_subscriptions`, `regional_analytics_reports`, `regional_analytics_access_log`, and `regional_analytics_cache` | EF entities, mappings, tests, and migration now represent the four Laravel Regional Analytics tables; Laravel React super-admin subscription list/create/update/cancel, report queue, and access-log contracts are covered by `RegionalAnalyticsSuperAdminController.cs` plus focused regression tests; tenant-admin overview, heatmap, demand/supply, demographics, engagement trends, volunteer breakdown, help-request analytics, export JSON, and cache invalidation contracts are covered by `RegionalAnalyticsAdminController.cs` plus focused regression tests; partner report download now returns a valid minimal PDF derived from report metadata/payload instead of placeholder bytes | Billing, stored-file fidelity, scheduled report orchestration, deeper Laravel service workflow parity, runtime route smoke coverage, and localization remain gaps |
| National KISS | `NationalKissDashboardController.php`, `NationalKissDashboardService.php`, Laravel React `NationalKissDashboardPage.tsx` | `NationalKissDashboardController.cs` now covers summary, comparative, trend, and cooperatives contracts with cross-tenant KISS aggregation, privacy-preserving member/recipient buckets, and focused regression tests | Laravel `tenants.tenant_category` schema alignment, `national.kiss_dashboard.view` permission parity, cache parity, runtime smoke coverage, and deeper service equivalence remain gaps |
| Non-Stripe ID providers | `VeriffProvider.php`, `OnfidoProvider.php`, `JumioProvider.php`, `IdenfyProvider.php`, `RegistrationPolicyController::listProviders`, `TenantProviderCredentialService.php` | `NonStripeIdentityProviders.cs` adds Veriff, Onfido, Jumio, and iDenfy adapters; `ReactFrontendCompatibilityController` now returns Laravel-style admin provider list/policy payloads and saves encrypted tenant provider credentials in `tenant_provider_credentials` | Live/sandbox HTTP contract, provider-specific webhook end-to-end verification, and full admin workflow parity still need verification |
| Tenant SSO providers | `AdminSsoProvidersController.php`, `SsoOidcService.php`, `tenant_sso_providers` migration | `AdminSsoProvidersController.cs`, `TenantSsoProviderService.cs`, `SsoOidcAuthenticationService.cs`, `TenantSsoProvider.cs`, `SsoOidcFlow`, `OAuthCallbackGrant`, `OAuthIdentity`, and `20260714223452_SsoOidcAuthenticationParity` | Admin provider CRUD/test plus public discovery, redirect, callback, and browser exchange are implemented with signed state, browser/server PKCE, nonce/JWKS validation, public-HTTPS endpoint checks, tenant-qualified account linking, domain/provisioning gates, one-time grants, refresh-token issuance, and logout-all invalidation. The general complete exact-SHA aggregate is green at `dbafc5c3`; live IdP/browser proof, fixed-rubric module acceptance, and unchanged-client runtime certification remain open. |
| Mailchimp-like behavior | `MailchimpService.php` | no matched provider files; email templates exist | Decide equivalent behavior and implement or document replacement |
| Partner API / portal | `app/Http/Controllers/Api/PartnerApi`, `app/Services/PartnerApi`, `react-frontend/src/partners` | API partner admin entity/service/controller | External partner API/auth/webhook parity incomplete |
| Accessible frontend | 🔴 `accessible-frontend/`, `routes/govuk-alpha.php` and `routes/govuk-alpha-parity/*` **were deleted on 2026-08-14 and do not exist** — the frozen inventory at `web-uk/scripts/blade-route-inventory.frozen.json` replaces them as the behaviour record | `web-uk/` (not `apps/web-uk/`) is the shared accessible frontend implementation target; Laravel Blade defines the product/UI behaviour and the Laravel backend defines the API contract; ASP.NET is not authoritative and belongs to a separate contract-identity workstream | Advanced implementation with route/workflow/manual-certification gaps; static coverage does not certify production readiness or unchanged ASP.NET switching |

## Historical Backlog Order (Superseded)

The numbered list below is retained as 2026-07-13 planning history. It is not a
current resume queue. Resume only from the finite queue in
`CURRENT_ASPNET_CONTRACT_STATUS.md`, after the pause handoff's explicit
authorization gate and an exact-SHA refresh.

1. **Contract inventory and tooling**
   - Generate a .NET OpenAPI snapshot from the running API.
   - Normalize Laravel `/api/v2` paths against .NET `/api` and compatibility
     prefixes.
   - Build explicit schema alias mapping for renamed tables, especially
     Laravel `vol_*` tables versus .NET `volunteer_*` names.
   - Build route alias mapping for frontend redirects and intentionally renamed
     accessible paths.
   - Build namespace alias mapping for Laravel backend/email/accessible
     translation namespaces versus React and future .NET backend targets.
   - Use `scripts/export-laravel-parity-backlog.ps1` after every artifact refresh
     so missing API/schema/frontend/localization rows remain ordered and
     acceptance-criteria backed.
   - Acceptance: `docs/API_PARITY.md` can list matched, missing, extra, and
     intentionally-renamed endpoints from generated artifacts, and
     `docs/SCHEMA_PARITY.md` can distinguish exact matches, accepted aliases,
     missing tables, and extra .NET tables. `docs/FRONTEND_PARITY.md` can
     distinguish React route gaps from accessible HTML route gaps, and
     `docs/LOCALIZATION_PARITY.md` can distinguish missing locales, namespaces,
     and keys.

2. **User-facing API gaps**
   - Prioritize endpoints used by Laravel React frontend pages and accessible
     frontend routes.
   - Acceptance: route, method, `/api/v2` alias, auth, tenant scoping, request
     validation, response shape, error shape, upload behavior, realtime config,
     and status codes match the Laravel React frontend contract or have
     documented .NET-compatible aliases.

3. **Caring Community and National KISS**
   - Port domain entities, services, admin routes, member routes, scheduled
     tasks, locale keys, and backend contracts needed by the canonical Laravel
     React frontend.
   - Acceptance: Laravel caring/KISS tests or equivalent .NET integration tests
     cover workflows, tenant isolation, admin authorization, and Laravel React
     request/response compatibility.

4. **Marketplace / commerce / monetization**
   - Complete the remaining marketplace listing, order, pickup, coupon,
     merchant, local-advertising, and promotion workflows, and live-certify the
     committed payment/Connect/escrow/refund/dispute paths.
   - Current evidence: Laravel React merchant-onboarding wizard status,
     step-1/2/3, and complete calls now have ASP.NET contract coverage.
     Buyer shipping selector options and seller shipping-options CRUD now return
     React-compatible fields.
     Promotion selector products and promote-submit calls now use React
     `promotion_type` and Laravel-style success/data envelopes. Marketplace
     offer-create calls now accept the React `amount`/`currency`/`message`
     payload and return Laravel snake_case offer fields in a success envelope.
     MyOffers sent/received reads and counter/accept-counter/withdraw actions
     now return React-compatible success envelopes, cursor metadata, nested
     listing/counterparty fields, and Laravel action statuses. Direct
     accept/decline now uses Laravel seller-only authorization, accepted-offer
     listing reservation, and competing-offer decline side effects. Seller
     pickup-slot create/list/delete now accepts React `slot_start`/`slot_end`
     payloads and returns Laravel slot field names with persisted recurrence
     and booked-count state. Seller coupon CRUD now accepts the React coupon
     form payload and returns formatted `data.items`/coupon/delete envelopes.
     BuyNow coupon validation, direct order creation, and local payment-intent
     calls now accept the React payloads and return Laravel-style envelopes.
     Seller profile avatar/cover multipart uploads now return React-compatible
     `data.url` payloads on `/api/v2/marketplace/seller/profile`.
     Category reads now return Laravel React category rows with
     `listing_count` for active approved listings.
     Category template reads now return the Laravel empty-template
     `success/data` envelope with `category_id`, `name: null`, and `fields: []`
     for the create/edit/category React pages.
     Admin marketplace dashboard and moderation listing reads now return the
     Laravel React stats, pagination metadata, `per_page` support, and
     formatted listing rows instead of raw EF entities.
     Admin moderation approve/reject/delete actions now return Laravel React
     success message envelopes and use Laravel-style removed/rejected state
     transitions instead of hard deletes or raw entity payloads.
     Admin marketplace bulk reject now accepts the React `listing_ids`/`reason`
     payload and returns the shared bulk action `success`/`failed`/`skipped_ids`
     result while leaving out-of-tenant or missing ids untouched.
     Admin seller management now returns Laravel React seller rows for
     `MarketplaceSellerAdmin.tsx`, accepts `per_page`/`seller_type`/`verified`
     filters plus the React search query, and returns success message envelopes
     for business verification and empty-body seller suspension.
     Admin coupon oversight now returns Laravel React `data.items` rows and
     success envelopes for suspend/delete actions.
     Marketplace map-search nearby listing calls now support React `lat`/`lng`,
     `radius_km`, `q`, `category_id`, `limit`, and return `distance_km`.
      Seller Stripe onboarding status/start calls return the React
      `stripe_onboarding_complete` status shape and both `onboarding_url` and
      `url` aliases. The provider-backed flow now creates/reuses Express
      accounts, polls completion, and reconciles signed account webhooks; live
      Stripe credentials/browser execution remains the external proof gap.
     Listing create/edit media upload accepts Laravel React snake_case listing
     payloads and multipart `images[]`/`video` uploads. Pickup reservation,
     buyer my-pickups, and seller QR scan calls now return Laravel reservation
     field names and picked-up status transitions.
     Community delivery offer create/list/accept/confirm
     calls now use React payloads and Laravel response field names/statuses.
     Donation checkout payment-intent and receipt calls now return the React-compatible `client_secret`,
     `donation_id`, and receipt JSON envelopes.
   - Acceptance: member/admin APIs and React/admin pages match Laravel
     workflows, with payment-provider safety tests.

5. **Verein / Clubs and Regional Analytics**
   - Replace remaining compatibility shells with real domain models, services,
     reports, dues/federation workflows, billing/export, and scheduled jobs.
   - Acceptance: integration tests cover dues, federation consent, analytics
     reports, billing/export, and tenant isolation.

6. **Identity provider parity**
   - Verify Veriff, Onfido, Jumio, and Idenfy adapters against live or sandbox
     HTTP contracts and tenant-level provider configuration.
   - Extend the React admin workflow tests beyond controller-level contracts,
     including browser/API round trips for credential save/delete and
     registration-policy writes.
   - Acceptance: provider config persistence, webhook signature validation,
     sanitized audit events, fallback behavior, and admin settings are tested end
     to end against provider sandbox contracts.

7. **Partner API and accessible frontend**
   - Complete external partner API auth, rate limiting, webhooks, and portal
     workflows.
   - Map `apps/web-uk/` against Laravel `accessible-frontend/` route by route.
   - Keep `apps/web-uk/` visually aligned to Laravel Blade accessible while
     preserving Express/Nunjucks/GOV.UK Frontend as the preferred future stack.
   - Acceptance: accessible route tests cover tenant, auth, feature gates, and
     core workflows.

8. **Localization, docs, and operational readiness**
   - Close locale count/key gaps and update all docs after each module batch.
   - Acceptance: docs maps reflect source state; test commands pass or failures
     are documented with owners.

## Acceptance Criteria For 100% Parity

- Every Laravel OpenAPI operation and route-file endpoint is matched,
  intentionally renamed with compatibility behavior, or documented as replaced
  by an equivalent .NET workflow.
- Every Laravel module guide has a corresponding .NET implementation note and
  test plan.
- React admin/member workflows from the canonical Laravel React frontend have
  equivalent ASP.NET API support proven by route/API matrix rows, regression
  tests, and runtime smoke tests.
- The legacy `apps/react-frontend/` copy was deleted on 2026-08-09 and must not
  be recreated.
- Formerly excluded modules have real implementations or explicitly approved product
  decisions outside this technical parity goal.
- `dotnet test Nexus.sln --configuration Release` and relevant frontend checks
  pass for the implemented surfaces.
