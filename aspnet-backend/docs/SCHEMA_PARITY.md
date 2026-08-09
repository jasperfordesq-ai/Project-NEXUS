# Schema Parity Map

Last reviewed: 2026-07-15

Status: **Maintained reference — current comparison method with dated evidence**

Evidence provenance: the current static table inventory was regenerated on
2026-07-15 against Laravel
`903d03d3db78bbf87129ad35728be3b72819acaf` and committed schema implementation
tree `97b8a4a004362aef8356e8d76333f1efc9d44b36`, including
`20260715152156_MemberResidencyVerificationStorageParity`. Those nine schema
commits are now merged into published `main`; the inventory remains tied to the
named implementation tree until regenerated on a later exact mainline SHA.
Published product/schema commit `c767050a3eabd064bdf647695b9699b98186342b`
adds `20260715184200_AddCompatibilityAuditEntriesTable`, taking the source to
165 migration classes and 163 runtime IDs. The table was already represented
by the model and therefore does not change the static table totals below. Its
original exact-SHA CI Test job timed out. The later required-CI workflow at
`b3f946b3` and test/evidence SHA `dbafc5c3` retain the same schema implementation;
run 29451087913 completed the full required suite terminal green. That closes
the general exact-SHA CI subgate, not dedicated blank/populated migration-163,
storage-classification, release, or production gates. Any older table/count
without its own exact source pair is a historical, provenance-incomplete
checkpoint and cannot support current score or upgrade-safety claims.

Laravel source of truth: `C:\platforms\htdocs\staging\database\migrations` and
`C:\platforms\htdocs\staging\app\Models`.

Use [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) for
the current banked score and active schema/upgrade deductions. Dated sections
here are retained evidence. Static table-name counts are never an overall score
and remain historical until explicitly regenerated against named SHAs.

Use [`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md) for the concise
pause verdict, current runtime boundary, exact-SHA CI result, and ordered
recommission package.

## 2026-07-15 Member Residency Verification Storage Evidence

Migration `20260715152156_MemberResidencyVerificationStorageParity` closes the
genuine `member_residency_verifications` gap. The tenant-scoped declaration and
attestation history preserves Laravel's member, municipality, postcode,
optional address/evidence, pending/approved/rejected state, optional attester
and rejection evidence, timestamps, defaults, lengths, and lookup indexes.
ASP.NET additionally enforces the status domain plus tenant-composite member
and attester relationships; this replaces non-persisting member stubs and
generic admin compatibility handling at the schema boundary.

Verification on committed predecessor
`7d5552cf04df290abb66719038601e26ffe5e446`:

- a forced clean Release solution build passed in 5m33.50s with zero errors and
  the seven known API/test warnings;
- the focused `MemberResidencyVerificationSchemaParityTests` class executed
  and passed 3/3 with 18 seconds of test execution;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 162 runtime
  migrations and exposed 13 columns, seven total indexes, three FKs, and one
  status check;
- a valid tenant/member declaration resolved the `pending` default, while an
  invalid status and missing member were rejected;
- a second disposable database was held exactly at
  `20260715144509_SalaryBenchmarkStorageParity` with 161 migrations and no
  residency table, then populated with two tenants, two users, and one salary
  benchmark;
- exactly the residency migration upgraded that database to 162 without losing
  any seeded row; same-tenant approval/attestation succeeded, while
  cross-tenant member and attester links were rejected;
- the regenerated schema comparator and its fixture passed, and both
  disposable PostgreSQL containers were removed.

This slice moves the static exact-name inventory from 241 to 242 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Salary Benchmark Storage Evidence

Migration `20260715144509_SalaryBenchmarkStorageParity` closes the genuine
`salary_benchmarks` gap. The current 13-column Laravel contract comes from the
schema dump plus the active model/service: optional tenant, role keyword,
industry/location, min/max/median salary, salary type, currency, year, source,
and created timestamp. Laravel's guarded fallback migration describes a stale
alternative shape and does not run when the existing table is present. ASP.NET
therefore follows the converged live contract, preserves global null-tenant
rows without a query filter, and adds an optional restrictive tenant FK plus
the documented salary-type domain.

Verification on committed predecessor
`7981389be628d16baf93ca210b48900dc4788dab`:

- a forced clean Release solution build passed in 7m21.57s with zero errors and
  the seven known API/test warnings;
- the focused `SalaryBenchmarkSchemaParityTests` class executed and passed 3/3
  with 20 seconds of test execution;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 161 runtime
  migrations and exposed 13 columns, three total indexes, one optional tenant
  FK, and one salary-type check;
- blank-database inserts resolved `annual`, `EUR`, `2026`, and timestamp
  defaults, while an invalid salary type and a missing tenant reference were
  rejected;
- a second disposable database was held exactly at
  `20260715135048_CookieInventoryStorageParity` with 160 migrations and no
  salary table, then populated with one tenant and one cookie-inventory row;
- exactly the salary migration upgraded that database to 161 without losing
  either seeded row; global and tenant-specific salary rows then coexisted, and
  invalid salary-type/tenant writes were rejected;
- the regenerated schema comparator and its fixture passed, and both
  disposable PostgreSQL containers were removed.

This slice moves the static exact-name inventory from 240 to 241 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Cookie Inventory Storage Evidence

Migration `20260715135048_CookieInventoryStorageParity` closes the genuine
`cookie_inventory` gap. The ten-column aggregate preserves Laravel's cookie
name, category, purpose, duration, optional third-party provider, nullable
tenant, active flag, timestamps, category/tenant/active indexes, and composite
cookie-name/tenant uniqueness. A null tenant continues to mean a platform-wide
cookie, so the EF aggregate deliberately has no tenant query filter; a
tenant-specific row instead carries an optional restrictive tenant FK. ASP.NET
also enforces the four documented category values.

Verification on committed predecessor
`cb54e2d94ec0170c9aee6cdc06494f1daa5fbea5`:

- a forced clean Release solution build passed in 5m58.98s with zero errors and
  the seven known API/test warnings;
- the focused `CookieInventorySchemaParityTests` class executed and passed 3/3
  with 16 seconds of test execution;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 160 runtime
  migrations and exposed ten columns, five total indexes, one optional tenant
  FK, and one category check;
- blank-database inserts resolved active/created/updated defaults, while an
  invalid category and a missing tenant reference were rejected;
- a second disposable database was held exactly at
  `20260715131714_HealthCheckHistoryStorageParity` with 159 migrations and no
  cookie-inventory table, then populated with one tenant and one health-history
  row before exactly the cookie-inventory migration was applied;
- both populated rows survived, global and tenant-specific entries sharing a
  cookie name coexisted, and a duplicate tenant-specific entry plus an invalid
  category were rejected;
- transient Docker Desktop mapped-port failures on earlier disposable attempts
  occurred before the one-step migration began; the fixed-loopback-port run
  supplied the accepted 159-to-160 evidence, and all disposable containers were
  removed;
- the regenerated schema comparator and its fixture passed.

This slice moves the static exact-name inventory from 239 to 240 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Health Check History Storage Evidence

Migration `20260715131714_HealthCheckHistoryStorageParity` closes the genuine
`health_check_history` gap. The tenant-scoped ledger preserves Laravel's health
status, required JSON check outcomes, optional latency, current-timestamp
default, and tenant index. ASP.NET additionally enforces the documented health
status domain, non-negative unsigned latency, and tenant relationship.

Verification on committed predecessor
`387a566f579cabadfa4c9d6acbd7cebe101c1848`:

- a forced clean Release API build passed in 4m48.57s with zero errors and the
  same three pre-existing warnings;
- the focused `HealthCheckHistorySchemaParityTests` class executed and passed
  3/3 in 22 seconds;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 159 runtime
  migrations through the health-history migration and exposed all six
  columns, two total indexes, one tenant FK, and two checks;
- after a transient host-port read timeout left the first populated database
  pristine, a fresh disposable database was populated at
  `20260715124331_PilotInquiryStorageParity` with one tenant, one user, and one
  pilot inquiry, then upgraded by exactly the health-history migration without
  losing any seeded row;
- a Laravel-shaped degraded-health row accepted nested JSON, latency `123`,
  and the current-timestamp default; missing-tenant, invalid-status, and
  negative-latency inserts were rejected with no invalid row left behind;
- the regenerated schema comparator and its fixture passed, and both
  disposable PostgreSQL containers were removed after verification.

This slice moves the static exact-name inventory from 238 to 239 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Pilot Inquiry Storage Evidence

Migration `20260715124331_PilotInquiryStorageParity` closes the genuine
`pilot_inquiries` gap. The 29-column tenant-scoped record preserves Laravel's
municipality, contact, qualification, JSON interest/fit evidence, score,
pipeline, optional assignee, lifecycle timestamps, notes, source, defaults,
lengths, precision, and lookup indexes. ASP.NET additionally enforces the
documented stage/score/flag/range domains and tenant-composite assignee
isolation.

Verification on committed predecessor
`20a8056b602f5d35f965caa269acaea17b053fa4`:

- a forced clean Release API build passed in 5m44.80s with zero errors and the
  same three pre-existing warnings;
- the focused `PilotInquirySchemaParityTests` class executed and passed 3/3 in
  14 seconds;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 158 runtime
  migrations through the pilot-inquiry migration and exposed all 29 columns,
  five total indexes, two foreign keys, and six checks;
- a second disposable database was populated at
  `20260715074605_EngagementRecognitionStorageParity` with two tenants, one
  user per tenant, and one monthly-engagement row, then upgraded by exactly the
  pilot-inquiry migration without losing any seeded row;
- a Laravel-shaped inquiry accepted JSON interest/fit evidence and resolved
  defaults to `CH`, `0`, `0`, and `new`; cross-tenant assignee, invalid stage,
  and out-of-range fit-score inserts were rejected with no invalid row left
  behind;
- the regenerated schema comparator and its fixture passed, and the disposable
  PostgreSQL container was removed after verification.

This slice moves the static exact-name inventory from 237 to 238 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Engagement Recognition Storage Evidence

Migration `20260715074605_EngagementRecognitionStorageParity` closes the two
genuine engagement-recognition gaps created together by Laravel:
`monthly_engagement` and `seasonal_recognition`. They carry the exact tenant,
user, month/season, activity, recognition, and timestamp shapes, including
Laravel's defaults, lengths, unique natural keys, and lookup indexes. ASP.NET
also enforces tenant-composite user relationships and non-negative unsigned-
value contracts.

Verification on committed predecessor
`91e3d99ba01aede1053d2a1f77d8861deee50806`:

- a forced clean Release API build passed in 4m33.42s with zero errors and the
  same three pre-existing warnings;
- the focused `EngagementRecognitionSchemaParityTests` class executed and
  passed 3/3 in 15 seconds;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 157 runtime
  migrations through the engagement-recognition migration and exposed both
  tables, their 4/3 total indexes, two tenant-composite user FKs, and two
  non-negative checks;
- a second disposable database was populated at
  `20260715070811_DonationDisputeStorageParity` with two tenants, one user per
  tenant, and one donation dispute, then upgraded by exactly the engagement-
  recognition migration without losing any seeded row;
- valid monthly and seasonal rows resolved defaults to `false`/`0` and `0`;
  cross-tenant user linkage, a duplicate monthly natural key, and a negative
  months-active value were rejected with no invalid rows left behind;
- the regenerated schema comparator and its fixture passed, and the disposable
  PostgreSQL container was removed after verification.

This slice moves the static exact-name inventory from 235 to 237 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Donation Dispute Storage Evidence

Migration `20260715070811_DonationDisputeStorageParity` closes the genuine
`donation_disputes` exact-name gap. The tenant-scoped table carries Laravel's
Stripe dispute, payment-intent, charge, amount, currency, status, reason,
evidence deadline, payment-route, connected-account, JSON payload, and
timestamp fields. It also preserves the unique dispute identifier, Laravel's
four lookup indexes, and adds the ASP.NET tenant relationship plus a
non-negative amount check for Laravel's unsigned amount contract.

Verification on committed predecessor
`0864f72acb607dbe79f1b9bc198d81f31c62c1cd`:

- a forced clean Release API build passed in 6m18.09s with zero errors; the
  compact incremental summary reported zero warnings and zero errors, while
  the Debug test build surfaced the same three pre-existing API warnings;
- the focused `DonationDisputeSchemaParityTests` class executed and passed 3/3
  in 20 seconds;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 156 runtime
  migrations through the donation-dispute migration and exposed the table,
  four explicit indexes plus its primary-key index, tenant FK, and amount
  check;
- a second disposable database was populated at
  `20260715062938_MarketplaceSupportStorageParity` with one tenant and one
  marketplace category template, then upgraded by exactly the donation-
  dispute migration without losing either row;
- a Laravel-shaped dispute row accepted JSON evidence and resolved defaults to
  `0`, `gbp`, `needs_response`, and `platform_default`; missing-tenant and
  negative-amount inserts were both rejected with no invalid row left behind;
- the regenerated schema comparator and its fixture passed, and the disposable
  PostgreSQL container was removed after verification.

This slice moves the static exact-name inventory from 234 to 235 matches. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Marketplace Support Storage Evidence

Migration `20260715062938_MarketplaceSupportStorageParity` closes the two
remaining `marketplace_*` exact-name gaps: `marketplace_category_templates` and
`marketplace_report_notifications`. The first carries tenant-scoped dynamic
listing-field JSON with Laravel's nullable tenant/category shape. The second is
the durable report bell/email outbox with dedupe, retry, status, attempt, error,
payload, and delivery timing evidence. It is distinct from the existing paid-
order notification ledger. A tenant/report alternate key and tenant-composite
report/recipient relationships reject cross-tenant outbox rows.

Verification on committed predecessor `92125875456ecf87d5fb1b8bb4062da8d3146085`:

- a forced clean Release API build passed in 3m14.93s with zero errors and
  three pre-existing warnings;
- the focused `MarketplaceSupportSchemaParityTests` class passed 3/3 in 1.0921
  minutes after discovering 3,337 tests in the Debug test assembly;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 155 runtime
  migrations through the marketplace-support migration and exposed both tables
  plus the marketplace-report tenant/id key;
- a second disposable database was populated at
  `20260715054926_VereinDuesAndFederationSchemaParity` with one tenant, two
  users, one category, one listing, and one report, then upgraded by exactly the
  marketplace-support migration without losing those rows;
- both new tables accepted Laravel-shaped JSON/outbox rows, notification
  defaults resolved to `pending` and `0`, and a cross-tenant recipient insert
  failed on the tenant-composite user foreign key with no invalid row left
  behind;
- the schema-comparator fixture passed, and the disposable PostgreSQL container
  was removed after verification.

These two names were previously part of the 198 unclassified set. Closing them
reduces that set to 196 and clears the `marketplace_*` exact-name family. The
banked schema category remains **129/150** until the canonical ASP.NET status
document records an accepted scoring movement.

## 2026-07-15 Verein Dues And Federation Schema Evidence

Migration `20260715054926_VereinDuesAndFederationSchemaParity` closes the five
genuine Verein/Clubs table gaps: `verein_membership_fees`,
`verein_member_dues`, `verein_dues_payments`, `verein_event_shares`, and
`verein_cross_invitations`. It adds the required `events(TenantId, Id)`
alternate key and uses tenant-composite relationships for users,
organisations, events, and member dues. Laravel-compatible names, column
types, lengths, defaults, status/value checks, uniqueness, and indexes are
covered by focused model/migration tests.

Verification on the `ea352690c95bbb6dea26a7b00c8454a37b51a859` lineage:

- a forced clean Release API build passed in 7m12.34s with zero errors and
  three pre-existing warnings;
- the focused `VereinSchemaParityTests` class passed 3/3 in 44.6 seconds after
  discovering 3,334 tests in the Debug test assembly; the newly copied Release
  test DLL was separately blocked by local Windows Application Control and was
  not counted as a test pass;
- `dotnet ef migrations has-pending-model-changes` reported no model drift;
- a blank disposable PostgreSQL 16.4 database applied all 154 runtime
  migrations through the Verein migration and exposed all five tables plus the
  event tenant/id key;
- a second disposable database was populated at
  `20260714234546_SocialCommentMentionParity` with one tenant, two users, two
  organisations, and one event, then upgraded by exactly the Verein migration
  without losing those rows;
- valid rows were inserted into every new table; defaults resolved to
  `CHF`, `annual`, `30`, `true`, `pending`, `0`, `active`, and `sent` as
  applicable; and a cross-tenant event share failed on
  `FK_verein_event_shares_events_tenant_id_event_id` with no invalid row left
  behind;
- the schema-comparator fixture passed, and the disposable PostgreSQL container
  was removed after verification.

This evidence closes five exact-name gaps and makes the slice eligible for the
canonical scoring transaction. It does not silently rescore the fixed rubric:
the banked schema category remains **129/150** until the canonical ASP.NET
status document records an accepted movement.

## 2026-07-15 Current Static Inventory And Classification Boundary

This is the current repeatable, read-only source inventory. It is a table-name
comparison, not runtime migration proof, API/workflow parity, or a score.

| Source | Count | Notes |
| --- | ---: | --- |
| Laravel migration files | 384 | PHP files under `database/migrations`. |
| ASP.NET EF migration source files | 165 | Excludes designer files and the model snapshot; current product boundary `c767050a`. |
| Laravel created tables | 301 | Unique `Schema::create(...)` names. |
| Laravel touched tables | 131 | Unique `Schema::table(...)` names. |
| Laravel explicit model tables | 268 | Unique explicit model `$table` declarations. |
| Laravel source tables | 458 | Union of created, touched, and explicit model table names. |
| ASP.NET tables | 440 | Union of EF `ToTable`, `[Table]`, and migration `CreateTable` names. |
| Exact matched tables | 242 | Identical normalized names in both sources. |
| Missing Laravel exact names | 216 | Laravel names with no identical ASP.NET name. |
| ASP.NET-only exact names | 198 | ASP.NET names with no identical Laravel name. |

The 216 missing exact names currently partition as follows. These categories
are mutually exclusive, so their counts reconcile to the comparator total.

| Classification | Count | Evidence boundary |
| --- | ---: | --- |
| Classified aliases | 24 | A differently named ASP.NET aggregate has been identified. `email_log` maps to the existing `email_logs` entity/table and deliverability consumers; `activity_log` maps to the tenant/user-scoped `member_activity_logs` ledger; `push_log` maps to the dedicated but differently shaped `push_notification_logs` delivery ledger; and `fadp_consent_records` maps to current-state `consent_records`, which supplies the member/admin FADP consent routes but is not yet proved equivalent to Laravel's append-only action/version/metadata ledger. Each alias remains a gap until its migration shape and external workflow are proved equivalent. |
| Compatibility-storage gaps | 20 | Podcast: `podcast_episode_chapters`, `podcast_episode_listens`, `podcast_episode_reactions`, `podcast_episode_reports`, `podcast_episodes`, `podcast_media_cleanup_tasks`, `podcast_show_subscriptions`, and `podcast_shows`. Advertising: `ad_campaigns`, `ad_creatives`, `ad_impressions`, and `ad_clicks`, currently persisted as campaign/creative/aggregate JSON under tenant-config key `local_advertising.campaigns`. Appreciations: `appreciations` and `appreciation_reactions`, currently persisted under tenant-config key `social.appreciations`. Email suppression: `email_suppression`, currently persisted under tenant-config prefix `email_deliverability.suppression.`. Support triage: `support_reports`, currently persisted under tenant-config key `admin_explicit.support_reports`. FADP: `fadp_data_retention_config` and `fadp_processing_activities`, whose route writes are recorded in `compatibility_audit_entries` while the processing-register read also composes `legal_documents` and `gdpr_consent_types`. Tenant retention: `tenant_retention_policies` and `tenant_retention_runs`, persisted under tenant-config prefix `admin.retention.policy.` and key `admin.retention.runs`. Existing API compatibility does not replace these Laravel storage/evidence contracts, so these are not accepted aliases or exact matches. |
| Unclassified missing names | 172 | No accepted alias or replacement classification has yet been recorded. |
| **Total missing exact names** | **216** | **24 + 20 + 172.** |

### Merged Implementation Boundary - Not Rescored

The nine commits through `97b8a4a004362aef8356e8d76333f1efc9d44b36`
are now merged into published `main`. Their implementation-tree comparator reports 458
Laravel tables, 440 ASP.NET tables, 242 exact names, 216 missing Laravel exact
names, 198 ASP.NET-only names, and 164 EF migration source files. Current
product commit `c767050a` adds migration source/runtime ID 163 without changing
those static table-name totals, so the current tree has 165 migration classes.
Each slice
has its own focused build, test, model-drift, blank-replay, and populated-upgrade
evidence above. The combined lineage now has a complete required exact-SHA CI
aggregate at `dbafc5c3`: the allocator covered 3,361 logical tests, downloaded
TRX artifacts reported 3,385 runtime rows, and all passed. It has not yet
received dedicated migration-163 blank/populated-upgrade proof or a new
canonical scoring transaction. The current banked schema category therefore
remains **129/150**.

The five Verein names previously classified as genuine missing storage are now
represented exactly and are therefore absent from this missing-name partition.
The Verein slice moved the static exact-name inventory from 227 to 232 matches,
the marketplace-support slice moved it from 232 to 234, and the donation-
dispute slice moved it from 234 to 235. The engagement-recognition slice moves
it from 235 to 237, and the pilot-inquiry slice moves it from 237 to 238. The four advertising names and two
appreciation names move from unclassified to compatibility-storage gaps,
reducing the unclassified set from 196 to 190 before the donation-dispute
closure reduces it again to 189 and engagement recognition reduces it to 187.
Classifying `email_log`, `email_suppression`, and `support_reports` reduces it
to 184 before the pilot-inquiry closure reduces it to 183. Classifying
`activity_log` and `push_log` reduces it to 181 before the health-history
closure reduces it to 180 and moves exact matches from 238 to 239. Classifying
the three FADP names and two tenant-retention names reduces it to 175 before
the cookie-inventory closure reduces it to 174 and moves exact matches from
239 to 240. The salary-benchmark closure reduces it to 173 and moves exact
matches from 240 to 241. The residency-verification closure reduces the
unclassified set to 172 and
moves exact matches from 241 to 242. Exact-name coverage is therefore 242/458,
or 52.8%; this remains a diagnostic inventory rather than an overall parity
percentage.

The comparator's Markdown renderer was also corrected in this audit. Missing
and ASP.NET-only rows now render concrete table names and source paths rather
than literal PowerShell object expressions; the fixture test rejects that
malformed output.

## 2026-07-14 Marketplace Connect Onboarding Schema Evidence

Published migration `20260714115746_MarketplaceConnectOnboardingParity` aligns
the seller provider-account identifier with Laravel's 100-character contract,
enforces global provider-account uniqueness, and fails before schema mutation
when legacy values are overlong or duplicated. It applies after the published
payment-settlement migration on disposable upgraded PostgreSQL; the focused
Connect/payment suite passes and EF reports no pending model changes. Live
provider certification remains separate from schema proof.

## 2026-07-14 Marketplace Payment Settlement Schema Evidence

Published migration `20260714105831_MarketplacePaymentSettlementParity` adds
durable payment and payout ledgers, tenant/order composite integrity, unique
provider-intent identity, seller onboarding state, checkout mode, expiry, and
economic/status checks. It applies on disposable PostgreSQL and EF reports no
pending model changes. Escrow, refunds, disputes, notifications, and live Stripe
evidence remain certification gaps rather than missing migration claims.

## 2026-07-14 Group Auto-Assignment Schema Evidence

Migration 146 creates canonical `group_auto_assign_rules` storage with snake-case
columns, allowed-type and nonblank-value checks, active/tenant and group indexes,
tenant/group foreign keys, and EF tenant filtering. It applies on both maintained
disposable PostgreSQL histories, the lifecycle/isolation suite passes 2/2 on each,
cross-tenant poisoned rows are concealed, and `has-pending-model-changes` reports no
drift.

## 2026-07-14 Podcast Artwork Persistence Evidence

No schema migration is required. Podcast state already carries show artwork and
episode cover URLs, while the existing `file_uploads` aggregate provides durable
tenant, uploader, podcast subject, MIME, size, path, and timestamp evidence. Focused
runtime proof confirms two successful images persist as podcast-category file rows and
that invalid, foreign-owner, and cross-tenant attempts leave no staged rows behind.

## 2026-07-14 Atomic Notification Settings Schema Evidence

Migration 145 adds `users.federation_notifications_enabled` plus
`match_preferences.notification_frequency`, `notify_hot_matches`, and
`notify_mutual_matches`, all non-null with Laravel-compatible safe defaults. The
migration applies after the complete prior chain on two disposable PostgreSQL
histories, focused persistence/no-partial-write proof passes 2/2 on each, and
`has-pending-model-changes` reports no drift. The broader static schema-table counts
below predate migrations 141-145 and remain historical until regenerated.

## 2026-07-14 Marketplace Dispute Settlement Schema Evidence

Migration 144 adds `marketplace_disputes`, wallet purchase/refund transaction links
on marketplace orders, canonical reason/status/refund checks, and tenant-scoped
queue/order indexes. The refund-link index prevents one reversal transaction from
settling multiple orders. The full 144-migration chain replays on blank disposable
PostgreSQL, the same three lifecycle tests pass on upgraded and blank-chain schemas,
and `has-pending-model-changes` reports no drift. The broader static schema-table
inventory below predates this migration and must be regenerated before using its
counts as current coverage evidence.

## 2026-07-13 Event Recurrence V2 Schema Evidence

Migration 140 adds the exact recurrence rule, revision, occurrence-ledger,
definition-blueprint, and definition-application aggregates plus tenant-scoped
event recurrence identity fields. Unique keys bind rule/root, recurrence identity,
revision version/idempotency, blueprint version/idempotency, and one definition
application per occurrence. PostgreSQL triggers validate parent/tenant recurrence
identity and make all four evidence ledgers append-only. A blank database replayed
the complete chain through migration 140, the migrated runtime suite passes 8/8,
catalog inspection confirms all five recurrence triggers, and EF reports no pending
model changes.

## 2026-07-13 Event Publication Lifecycle Schema Evidence

Migration 139 adds the exact `content_moderation_queue` table with tenant/content
subject uniqueness, state checks, tenant/user/event relationships, and queue timing
evidence. Submit, approve, reject, and publish maintain that row in the same
transaction as event state and immutable lifecycle history. A blank PostgreSQL
database replayed the complete chain through migration 139; the focused runtime
suite passes 8/8 on that migrated schema, including the history immutability trigger,
and EF reports no pending model changes.

## Historical Static Source Counts (2026-07-13)

The static schema-table counts were regenerated with
`scripts/compare-laravel-schema-parity.ps1` on 2026-07-13 after the event
ticketing workflow slice. Runtime migration counts come from a separate
blank PostgreSQL replay.

| Source | Count | Notes |
| --- | ---: | --- |
| Laravel migrations | 377 | PHP migration files under `database/migrations`. |
| ASP.NET migration source files | 132 | Static comparator migration-source count. |
| ASP.NET runtime migrations | 130 | Blank replay applied every recorded EF migration through `20260713025352_EventTicketingWorkflowParity`; `has-pending-model-changes` is green. |
| Laravel created tables | 298 | Unique `Schema::create(...)` table names. |
| Laravel touched tables | 128 | Unique `Schema::table(...)` table names. |
| Laravel explicit model tables | 267 | Unique `protected/public $table = ...` model declarations. |
| Laravel source tables | 455 | Union of migration-created, migration-touched, and explicit model tables. |
| ASP.NET tables | 383 | Static table union after adding canonical Event Ticketing storage. |
| Exact matched tables | 192 | Exact table-name matches in this dated snapshot. |
| Missing Laravel tables | 263 | Laravel source names not represented exactly in ASP.NET. |
| Extra ASP.NET tables | 191 | .NET table names with no exact Laravel table name. |

These counts are not a parity score. Static table-name matching will overstate
some gaps where .NET intentionally renamed tables, for example Laravel `vol_*`
tables versus .NET `volunteer_*` tables. Those aliases still need explicit
triage and compatibility decisions before any table can be marked equivalent.

## 2026-07-12 Runtime Migration, Direct-Message, And Safeguarding Evidence Status

`20260713025352_EventTicketingWorkflowParity` is migration 130 and adds the
five exact ticket type, type history, entitlement, entitlement history, and
inventory history tables. Twenty-seven PostgreSQL checks enforce type,
price, capacity, sales/refund windows, lifecycle, free-only materialization,
version, and inventory invariants. Twelve triggers validate inserts and
updates, serialize capacity enforcement, prohibit aggregate deletion, and
make all three histories append-only. Blank replay passed 130/130, EF model
drift is clean, trigger catalog proof is 12/12, and an invalid occurrence
insert failed closed with SQLSTATE `P0001 event_ticket_concrete_occurrence_required`.

`20260713004944_EventOfflineCheckinWorkflowParity` is the preceding
migration and runtime ID 128. It adds exact `event_checkin_credentials`,
`event_checkin_devices`, `event_offline_sync_batches`,
`event_offline_sync_items`, and `event_offline_sync_decisions` storage. Twenty-
one PostgreSQL checks enforce secret verifiers, state/version/count bounds,
subject completeness, and attendance-linked accepted decisions. Seven triggers
make submitted items and decisions immutable and prohibit deletion of the five
evidence aggregates. A blank replay applied 128/128 migrations, model drift is
clean, and direct item tampering failed with SQLSTATE `P0001`.

`20260713015034_EventSafetyWorkflowParity` supersedes that runtime checkpoint
as migration 129. It adds the eight exact safety requirement/version/history,
code acknowledgement, guardian consent/history, and participation denial/
history tables. Eight database checks enforce lifecycle, policy, hash, age,
relationship, and effective-window invariants; thirteen triggers protect
immutable evidence and prohibit deletion of safety records. Blank replay passed
129/129 and EF model drift remains clean.

`20260712221737_EventPeopleAttendanceWorkflowParity` is the current latest
migration and runtime ID 124. It deterministically upgrades existing attendance
facts to version 1 with state timestamps and inferred check-in/check-out times,
then creates exact `event_attendance_activity` evidence. PostgreSQL triggers
make activity append-only, and downgrade refuses to discard evidence. All 124
migrations applied to blank disposable PostgreSQL 16, EF reports no pending
model changes, and focused Event People proof passed 4/4. No production
resource was touched.

`20260712224838_EventAgendaWorkflowParity` is now the latest migration and
runtime ID 125. It adds exact `event_sessions`, `event_session_speakers`,
`event_session_resources`, `event_session_history`,
`event_session_registrations`, and `event_session_registration_history`
tables plus `events.AgendaVersion`. PostgreSQL checks enforce session/resource/
registration domains, positive capacity, time ordering, and speaker identity;
three triggers keep both histories immutable and prevent destructive
registration deletion. Blank replay, model-drift proof, trigger catalog proof
at 3/3, and focused agenda workflow proof at 4/4 are green.

`20260712232721_EventStaffWorkflowParity` is now the latest migration and
runtime ID 126. It adds exact `event_staff_assignments` and
`event_staff_assignment_history` tables with unique subject, version, and
idempotency keys; closed role/status/action domains; revoke-state consistency;
and two PostgreSQL triggers that reject history updates and deletes. Blank
replay, model-drift proof, trigger catalog proof at 2/2, and focused Event Staff
workflow proof at 4/4 are green.

`20260713000700_EventCalendarWorkflowParity` is now the latest migration and
runtime ID 127. It adds exact `event_calendar_feed_tokens` storage with a global
hash uniqueness key, owner/revocation index, fixed lowercase SHA-256 hashes,
redacted token prefixes, locale validation, and use/revocation timestamp
ordering checks. Blank replay, model-drift proof, and focused calendar/feed
security proof at 4/4 are green.

`20260712214912_EventRegistrationWaitlistLifecycleParity` is the preceding
migration and runtime ID 123. It deterministically upgrades existing canonical
audience rows with `event` capacity-pool keys, version 1, state timestamps, and
collision-free queue sequences before adding uniqueness constraints. It adds
the exact Laravel tables `event_registration_history` and
`event_waitlist_entry_history`; PostgreSQL triggers make both append-only and
the downgrade refuses to discard evidence. All 123 migrations applied to blank
disposable PostgreSQL 16, EF reports no pending model changes, and focused
registration/waitlist proof passed 4/4. No production resource was touched.

`20260712204651_EventBroadcastWorkflowParity` is the preceding migration and
runtime ID 122. It adds canonical `event_registrations`,
`event_waitlist_entries`, and `event_attendance` audience ledgers plus exact
Laravel tables `event_broadcasts`, `event_broadcast_history`,
`event_broadcast_deliveries`, and `event_broadcast_delivery_attempts`.
PostgreSQL checks and triggers enforce lifecycle transitions, version
progression, identity and content freezing, terminal state, delivery state, and
append-only history/attempt evidence. All 122 migrations applied to blank
disposable PostgreSQL 16, EF reports no pending model changes, and focused
broadcast proof passed 4/4. No production resource was touched.

`20260712191551_EventTemplateWorkflowParity` is the preceding migration and
runtime ID 121. It adds the exact Laravel tables `event_templates`,
`event_template_versions`, `event_template_materializations`, and
`event_template_audit`, plus the safe event fields required for capture and
materialization. PostgreSQL constraints and triggers reject mutation of
version, materialization, and audit evidence and direct template deletion. All
121 migrations applied to a blank disposable PostgreSQL 16 database, EF
reports no pending model changes, focused template proof passed 4/4, and the
combined event lifecycle/template gate passed 8/8. No production resource was
touched.

`20260712175611_EventLifecycleParity` is the preceding migration and runtime ID
120. It safely projects existing `IsCancelled` rows into Laravel's
publication/operational axes, adds lifecycle moderation/cancellation metadata,
adds close state to reminders, and creates the exact Laravel table names
`event_status_history` and `event_domain_outbox`. PostgreSQL triggers reject
history updates and deletes. All 120 migrations applied to a blank disposable
PostgreSQL 16 database, EF reports no pending model changes, focused lifecycle
proof passed 4/4, and the combined admin-event gate passed 10/10. No production
resource was touched.

`20260712163203_GroupInviteAndExportLifecycleParity` is the preceding migration
and remains runtime ID 119. It adds durable invite type, acceptance identity
and timestamps, active membership status, cached group member counts, and the
Laravel-named `group_data_exports` queue with requester and expiry indexes.
Existing memberships are preserved as active, invite type is derived from the
existing email value, update time is initialized from creation time, and cached
counts are rebuilt from active memberships. All 119 migrations applied to a
blank disposable PostgreSQL 16 database and EF reports no pending model
changes. Focused invite/export HTTP and generation proof passed 3/3; the
combined affected group gate passed 6/6. No production resource was touched.

The preceding `20260712152645_GroupFormLifecycleParity`,
`20260712145614_GroupQaLifecycleParity`, and
`20260712104503_DurableMessageReactions` migrations are runtime IDs 118, 117,
and 116 respectively.

`20260712060051_DirectMessageStateParity` was the latest migration at the
direct-message checkpoint and remains runtime ID 115. It adds durable edit,
participant-scoped deletion, per-user
archive, and nullable deletion-audit state to messages. New boolean state
defaults to `false`; optional timestamps and audit identity default to null.
The audit user relationship uses `ON DELETE SET NULL`. Blank 115 and populated
114-to-115 PostgreSQL replays are green, existing content and read timestamps
were preserved, and `has-pending-model-changes` is green. The migration is
forward-only because downgrade would discard message visibility and audit
history.

The preceding safeguarding checkpoint ended at
`20260712023810_SafeguardingPreferenceDependencyParity`, runtime ID 114. Its
preceding two IDs are
`20260712020049_SafeguardingVettingAttestationParity` and
`20260712022243_MessagingDisabledRestrictionParity`. Together they add the five
exact Laravel tables `tenant_safeguarding_settings`,
`member_vetting_attestations`, `member_vetting_attestation_events`,
`safeguarding_vetting_review_requests`, and
`safeguarding_policy_rotation_events`; the
`user_monitoring_restrictions.messaging_disabled` storage adapter; preference
policy-review metadata; and the final consent-value/dependency constraints.

The safeguarding tables are metadata-only. They persist catalog codes,
decisions, policy versions, review lifecycle, and append-only events without
certificate files, reference numbers, free-text notes, expiry dates, or other
sensitive evidence. Legacy `vetting_records` are marked for controlled
redaction but never authorize the new contact policy. Direct attestation deletion
is rejected outside an explicit user/tenant cascade.

Final non-production certification applied all 115 migrations to a blank
PostgreSQL database and asserted the five tables, messaging flag, catalog
containment, unique tenant/user/option preference, required consent time, and
tenant/option cascade relationships plus the new message defaults/audit FK. A
valid populated 114-to-115 upgrade preserved message content and read
timestamps and initialized the new fields to false/null. Retained valid
populated 113-to-114 evidence
preserved rows, widened `SelectedValue`, and filled null `ConsentGivenAt` from
the row's `CreatedAt`. A duplicate tenant/user/option fixture raised PostgreSQL
`P0001` before DDL or data change: history remained at 113 and no migration-114
schema was left behind. The final deterministic direct-message state gate
passed 39/39 with zero failed or skipped, covering migration/model contracts,
behavior, concurrency, and route ownership. The broader exact regression completed
57/58; its sole existing first-writer race subsequently passed in isolation. A
separate class aggregate completed 12/13 before disposable PostgreSQL was OOM-
killed with `exit 137`; the race was green in isolation. Neither interrupted
aggregate is fully green. No production database or container was touched.

The physical monitoring table is intentionally documented as an adapter for
Laravel's `user_messaging_restrictions`; matching the workflow and constraints
does not imply identical table naming.

## 2026-07-12 Volunteer Hours Evidence Status (Preceding)

`20260711192124_VolunteerHoursLedgerParity` is runtime ID 111. It hardens
canonical `vol_logs` hours, status, organisation,
opportunity, reviewer, recipient, and Caring relationship provenance; installs
tenant-composite relationships and active natural-key uniqueness; adds the
personal `transactions.VolunteerLogId` link; and enforces unique, semantically
linked organisation-payment and volunteer-hour XP evidence. The same migration
source adds the Laravel-aligned tenant-scoped `feed_activity` projection with its
unique source tuple/hot-path indexes and the nullable `users.show_on_leaderboard`
privacy preference. `FeedActivityService` publishes approved hours idempotently
as `volunteer_hours` without copying the volunteer description; other producers,
admin moderation integration, cleanup, and backfill remain gaps. Its preflight
rejects invalid hours/status, orphan or cross-tenant relationships, inconsistent
organisation/opportunity/Caring provenance, ambiguous or contradictory payout/
XP evidence, and duplicate active log keys before any DDL. It never inserts
legacy transaction, payment, or XP rows. Uniquely provable existing evidence may
be linked; evidence-free approved whole-hour organisation rows are downgraded to
`pending`, while approved Caring sub-hour rows remain valid without fabricated
evidence. Source-level migration contract tests cover the no-mint and conditional
hours rules. At that checkpoint, non-production certification applied all 111
migrations to a blank PostgreSQL database; direct assertions verified the exact
13-column/eight-index `feed_activity` schema, nullable-boolean
`users.show_on_leaderboard` with default `true`, all 11 column-specific
`ON DELETE SET NULL` relationships, and the volunteer-user `CASCADE`
relationship. A valid populated 110-to-111 upgrade preserved and linked existing
evidence without minting transaction, payment, or XP value. A deliberately
invalid fixture raised PostgreSQL `P0001` atomically: history remained at 110 and
no migration-111 DDL was left behind. `has-pending-model-changes` is green.
Disposable Docker container, network, and anonymous-volume cleanup left zero
matching resources. No production database or container was touched.

The preceding `20260711143546_VolunteerQrAttendanceParity` migration makes
`volunteer_check_ins.CheckedInAt` nullable, adds nullable global
`QrToken`, nullable `CheckedInById`/`CheckedOutById`, required lifecycle
`Status`, and required `UpdatedAt`, and installs a global filtered unique token
index plus one attendance row per `(TenantId, ShiftId, UserId)`. Status is
restricted to `pending`, `checked_in`, `checked_out`, or `no_show`. Historical
rows are deterministically backfilled to `checked_out` when `CheckedOutAt` is
present, otherwise `checked_in` when `CheckedInAt` is present, otherwise
`pending`; `UpdatedAt` is copied from `CreatedAt`. Historical QR tokens and
coordinator IDs remain null, and compatibility `HoursLogged`, `Notes`, and
`TransactionId` evidence is preserved.

The migration adds tenant-composite attendance user/shift/coordinator/
transaction relationships and a composite application
tenant/opportunity/shift relationship, so an assigned shift must belong to the
same opportunity and tenant. It also expands the volunteer-organisation member
role constraint to `owner`, `admin`, `manager`, `coordinator`, or `member`.
Preflight aborts before any DDL for duplicate tenant/shift/user attendance rows,
orphaned relationships, or cross-tenant opportunity, shift, application,
reviewer, volunteer, attendance, or transaction evidence. Duplicate rows are
not merged because their legacy hours/transaction evidence cannot be reconciled
safely.

The preceding `20260711100817_LoyaltyEstateOrganisationEvidence` adds
tenant-composite, unique transaction evidence for Caring
loyalty debits/refunds and positive hour-estate settlements. Applied legacy
loyalty and settled estate rows are retained with null evidence links for
manual reconciliation; the migration does not guess a transaction from amount
or timestamp proximity. The services now refuse a loyalty reversal when its
authoritative debit link is absent or invalid.

That preceding migration also hardens the generic organisation domain. Organisation
owners, memberships, wallets, and wallet transactions now use tenant-composite
foreign keys; membership is unique by tenant/organisation/user; and the only
accepted roles are `owner`, `admin`, `member`, and `volunteer`. Upgrade preflight
aborts before schema changes on cross-tenant relationships or unknown roles.
Known role values are lowercased and trimmed. The migration is intentionally
irreversible because removing ledger evidence or tenant constraints cannot be
done without weakening financial and isolation guarantees.

The preceding `20260711083852_WalletLedgerFederationPartnerParity` makes the
main .NET `transactions` sender and receiver relationships nullable so
one-sided debits and credits do not require a fabricated user. It adds explicit
transaction types and participant-specific history-hide flags, hardens
federated transaction provenance, persists partner access tokens, and adds
reservation/settlement evidence links for Caring hour gifts. This is an
explicit ledger adapter for Laravel's direct `users.balance` storage, not a
claim of identical internal persistence.

The preceding `20260711010201_VolunteerOrganisationRelationshipsParity` creates
canonical `vol_organizations`, `org_members`, and `vol_org_transactions` storage
and adds nullable
`volunteer_opportunities.organization_id`. Owner, membership, and opportunity
foreign keys use tenant-composite principals; the opportunity link uses
non-destructive `RESTRICT`. No organisations or opportunity links are
backfilled. Its original nullable `vol_org_transactions.vol_log_id` scalar is
now a tenant-composite foreign key to `vol_logs`, with Laravel's unique
`(tenant_id, vol_log_id, type)` payment guard retained. The canonical hours
migration also links the matching personal transaction and XP evidence rather
than degrading to zero-hour aggregates.
Historical NULL-linked opportunities require explicit tenant/operator mapping;
`OrganizerId` is a user key and must never be treated as an organisation id.

The preceding `20260710221715_RecurringShiftPatternCrudParity` corrects the
recurring creator/capacity model. `20260710211122_RecurringShiftGenerationParity`
replaces the simple recurring-pattern tenant index with an active/end-date
sweep index and adds a filtered unique `(TenantId, RecurringPatternId,
StartsAt)` key to generated shifts. The upgrade explicitly fails if historical
duplicates exist; it does not guess which shift to delete because any duplicate
may already own check-ins, applications, reservations, or waitlist history.

The migration builds on `20260710192521_GuardianConsentLifecycle` and
`20260710171315_AdminVolunteerApprovalWorkflow`, which added nullable
`ShiftId` and `OrgNote` application fields, canonical notification `Link`
values, a non-unique tenant/opportunity/user lookup that permits legitimate
reapplication history, shift/capacity indexes, nullable guardian opportunity/
expiry scope, and `SET NULL` shift/opportunity relationships.

The lifecycle migration adds nullable `GuardianPhone`, `ConsentIp`, and unique
filtered `ConsentTokenHash` fields; expands guardian name storage; requires and
backfills `GuardianRelationship`; and adds `(TenantId, MinorUserId, Id)` and
`(TenantId, Status, Id)` read indexes. It normalizes `Granted` to `Active` and
`Revoked`/`Rejected` to `Withdrawn`, expires all legacy pending or active rows
that lack a guardian-held credential, removes orphan minor rows, and replaces
the historical minor-user relationship with a cascade foreign key. A null
opportunity still represents tenant-wide consent; a populated value scopes it
to one opportunity.

Storing only a SHA-256 credential hash is an intentional security divergence
from Laravel's raw `consent_token` column while preserving the external
single-use verification contract. The API and test projects build cleanly, the
prior transactional core passes 61/61 focused tests, and the guardian lifecycle
passes a clean 7/7 PostgreSQL-backed regression. Recurring-shift math,
idempotence, concurrency, tenant sweep, and scheduled-run persistence pass a
clean 13/13 PostgreSQL-backed regression.

The recorded runtime inventory is 115 EF-discovered/applicable migrations
through `20260712060051_DirectMessageStateParity`. Blank 115, populated
114-to-115, and model-drift gates are green as described above; migration 114's
invalid atomic-abort and catalog-containment evidence remains retained. The
preceding discovery repair
restored explicit discovery metadata to 27 essential designer-less migrations,
including `20260303120000_AddAiMessageTenantId`. The overlapping
`20260307181700_FederationCoreExpansion` class remains intentionally outside
the runtime chain because the later `Phase38to40_JobsKBLegal` migration is its
full schema superset. `20260305120000_AddTenantUpdatedAt` also remains outside:
`InitialCreate` already creates `tenants.UpdatedAt`, so discovering it would
duplicate the column.

The Debug API/test builds and required solution-wide Release build complete with
zero errors; the only warnings are the same four pre-existing `xUnit1031`
warnings in the test project. The Release build took 4m36s. One disposable Linux run
discovered 3,007 tests and passed 53/53: all 51
`VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`.
Windows Smart App Control prevents loading the freshly rebuilt unsigned API
assembly locally; host policy was not weakened. The clean affected rerun
discovered 3,007 tests, selected 243, and passed 243/243 with zero failed and zero
skipped in 418.639s. The
preceding 32/32 QR attendance, 1/1 persistence-failure, 12/12 shift-swap, 5/5
route/auth, 90/90 affected-module, and ambient-transaction results remain useful
historical evidence but do not certify the new hours slice or replace full-suite
and frontend-runtime gates. Descendant CI run `29154079189` was later
cancelled after its completed Integration Tests job reported 51 failures out of
2,888 tests. Its only direct regression from the preceding
`bfeafb2e` backend slice was nested transaction handling, now fixed and green
locally; the other CI failures remain open for independent triage.

Migration 115's blank/populated replay and model-drift gates are green as
described above; migration 114's safeguarding replay and migration 111's no-mint
replay remain retained evidence. The
preceding QR migration has a populated 109-to-110 backfill and
duplicate/cross-tenant atomic-abort proof. No production database or container
was inspected or changed.

Do not auto-link null legacy loyalty/estate evidence or rewrite ambiguous
self-transfers, admin grants, starting-balance grants, or hour transfers. The
copy-ready `BEGIN TRANSACTION READ ONLY` candidate report in
`docs/database-migrations.md` exposes current and expected balance effects for
manual disposition without making changes.

Schema presence is not workflow parity. Legacy one-to-one exchange, sub-account
pooling, community-fund writes, and federation settlement remain explicit HTTP
503 or equivalent fail-closed workflows until their missing approval/evidence/
saga models are implemented. Volunteer-hours schema and workflow now exist, but
the full 3,007-test suite, CI, and unchanged-frontend runtime certification
remain open.

`AdminVolunteerApprovalWorkflow.Down()` is intentionally irreversible. Restoring
the former unique application index after valid reapplication history could
fail or require silent data loss, so `Down()` throws before dropping any of the
new constraints or columns. `GuardianConsentLifecycle.Down()` is also
intentionally irreversible because rollback would discard hashed credentials
and restore unsafe legacy status/verification semantics.
`VolunteerQrAttendanceParity.Down()` likewise throws before changing schema: a
downgrade would discard QR token, attendance-status, and coordinator evidence
and make pending attendance timestamps non-nullable. Recovery requires a tested
pre-migration backup or a reviewed forward remediation, never a forced down
migration.
`VolunteerHoursLedgerParity.Down()` also throws before changing schema because
rollback would remove immutable feedback and personal/organisation/XP ledger
provenance. Restore a verified pre-migration backup or use a reviewed forward
remediation.
The three subsequent safeguarding/messaging migrations also throw before any
downgrade mutation: removing append-only attestation/policy evidence,
`messaging_disabled`, or canonical consent dependencies would lose evidence or
weaken safety. Recover from a verified backup or apply a reviewed forward
remediation.
`DirectMessageStateParity.Down()` also throws before changing schema because a
downgrade would discard durable edit, visibility, archive, and deletion-audit
history. Restore a verified backup or use a reviewed forward remediation.
`RecurringShiftGenerationParity.Down()` removes the two new indexes and
restores the former simple tenant index; no application data is deleted.

## Generated Artifacts

The repeatable static comparison script writes these ignored artifacts by
default:

```text
artifacts/parity/schema/schema-parity.json
artifacts/parity/schema/schema-parity.csv
artifacts/parity/schema/schema-parity.md
```

Run the fixture test before relying on a regenerated report:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-schema-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-schema-parity.ps1
```

## High-Risk Missing Table Families

The current missing-table prefix scan is strongest as a planning aid, not proof
of semantic absence. It highlights the domains that need table-by-table review:

| Prefix/family | Missing source tables | Parity implication |
| --- | ---: | --- |
| `caring_*` | 0 | Caring Community and KISS exact-name `caring_*` schema gaps are currently cleared in the static schema comparator; `caring_emergency_alerts`, `caring_federation_peers`, `caring_sub_regions`, `caring_care_providers`, `caring_caregiver_links`, `caring_cover_requests`, `caring_support_categories`, `caring_support_relationships`, `caring_tandem_suggestion_log`, `caring_help_requests`, `caring_project_announcements`, `caring_project_updates`, `caring_project_subscriptions`, `caring_smart_nudges`, `caring_paper_onboarding_intakes`, `caring_favours`, `caring_municipality_feedback`, `caring_trust_tier_config`, `municipality_surveys`, `municipality_survey_questions`, `municipality_survey_responses`, `caring_hour_estates`, `caring_hour_transfers`, `caring_hour_gifts`, `caring_kiss_treffen`, `caring_invite_codes`, `caring_kpi_baselines`, `caring_loyalty_redemptions`, `caring_regional_point_accounts`, `caring_regional_point_transactions`, `caring_research_partners`, `caring_research_consents`, and `caring_research_dataset_exports` are now represented in .NET. Laravel's `municipal_report_templates`, `municipal_verifications`, shared `categories.substitution_coefficient`, `users.trust_tier`, `safeguarding_reports`, `safeguarding_report_actions`, and member-facing `user_safeguarding_preferences` are also represented. Success stories intentionally use tenant-config key `caring.success_stories` to mirror Laravel's tenant-setting storage. |
| `vol_*` | 17 | The 115-ID runtime inventory retains canonical `vol_logs` with tenant-composite user/organisation/opportunity/reviewer/Caring provenance, hours/status checks, active natural-key uniqueness, personal transaction links, organisation-payment links, and volunteer-hour XP evidence. Migration 111 never inserts legacy value: evidence-free approved whole-hour organisation rows become `pending`, while approved Caring sub-hour rows remain valid. The eight member/organisation/admin hour routes and Caring relationship logging share the same locked workflow; direct Caring input retains raw fractional semantics for whole-hour flooring/regional points before rounded storage. QR attendance separately has migration-backed token/status/coordinator evidence and remains deliberately free of credit/XP side effects. The current live count reports 17 exact-name gaps because other Laravel `vol_*` tables/aliases remain; broader workflow semantics, the full 3,007-test suite, CI, and unchanged-frontend certification still require reconciliation. |
| `federation_*` | 16 | Receiver-scoped partnership decisions now persist native status/audit state, but exact federation-level permission columns, rejection actor/time/reason metadata, initial-sync/outbox state, and broader partner/network schema still need reconciliation. |
| `course_*` | 14 | Course module has no clear .NET implementation surface. |
| `job_*` | 13 | Job schema is partially present but not exact-name complete. |
| `marketplace_*` | 0 | Category-template and report-notification storage now clear the last two exact-name gaps; API/workflow delivery proof remains separate from this static result. |
| `podcast*` | 8 | Podcast API route compatibility now exists, but the eight dedicated Laravel storage/media/evidence tables listed in the current classification remain open gaps. |
| `verein_*` | 0 | `verein_federation_consents` and the five dues, payment, event-share, and cross-invitation tables are now represented exactly; wider Verein workflow/consumer proof remains separate from the static table-name result. |
| `regional_*` | 0 | Regional Analytics subscription, report, access-log, and cache schema tables are now represented; API/service/report workflow parity remains open. |

## Acceptance Criteria For Schema Parity

- Every Laravel table is matched exactly, mapped to a documented .NET alias, or
  replaced by a documented equivalent .NET workflow.
- Every alias has migration evidence and tests covering the external workflow
  that depends on it.
- Formerly excluded module tables are treated as gaps until implemented or
  explicitly superseded by a product decision.
- EF migrations, entity configurations, and tenant isolation tests are updated
  together for each schema batch.
