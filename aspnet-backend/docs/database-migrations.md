# Database Migration Workflow

Last reviewed: 2026-07-15

Status: **Maintained reference — current migration workflow with historical evidence**

## Overview

All database schema changes go through a single canonical workflow. This prevents schema drift between local development and production environments.

**Golden Rule: Never modify the production database directly. All changes flow through migrations committed to git.**

For the current migration/schema deductions and named evidence baseline, read
`CURRENT_ASPNET_CONTRACT_STATUS.md`, `CURRENT_SCHEMA_READINESS.md`, and
`SCHEMA_PARITY.md`. The long runtime
chain below is a retained 2026-07-12 checkpoint; its count and latest migration
must not be presented as the current repository chain.

At the pre-publication audit's remote `origin/main` commit `9ad163c969a935407297eb459a9840798a1a9e78`, the then-published
backend migration tail runs from marketplace payment settlement
`20260714105831_MarketplacePaymentSettlementParity` through Connect onboarding,
paid-notification, escrow-settlement, refund-ledger, SSO/OIDC, and finally
`20260714234546_SocialCommentMentionParity`. Commit `fefbb5ce` changed the
integration fixture to apply the complete EF migration chain instead of using
`EnsureCreated`; its fresh-migrated PostgreSQL subset passed 14/14 and the five
affected classes passed 57/57. That is focused migrated-schema evidence, not a
complete-suite, CI, production-upgrade, or deployment claim. Replay, preflight,
and model-drift evidence for individual migrations is recorded in
`SCHEMA_PARITY.md`. Always obtain the runtime migration list from the current
checkout before an upgrade claim.

At the 2026-07-15 17:41 +01:00 pre-publication audit boundary, the nine clean schema commits
through `97b8a4a0` had been user-authorized for merge into local `main` at
`df8c8b96`; that local boundary contains 164 migration source files and 162
runtime IDs, while then-current `origin/main` at `9ad163c9` contains 155 source
files. The refreshed table inventory and per-slice evidence are recorded in
`SCHEMA_PARITY.md`. Publication can change this local/remote relationship, so
verify both SHAs before repeating it. At the named boundary these migrations
were not yet published, production-authorized, fully certified at the merge
SHA, or banked. The later publication transaction puts that same migration chain
on `origin/main`; it remains unbanked and not production-authorized.

The current backend product/schema implementation boundary is later commit
`c767050a3eabd064bdf647695b9699b98186342b`. It adds
`20260715184200_AddCompatibilityAuditEntriesTable`, taking the repository to 165
migration classes and 163 runtime-discovered IDs. The EF model/snapshot already
represented the table, so this repairs a latent fresh-chain creation hole. CI
run 29441392036 passed Build, but the migrated Test job was cancelled at its
75-minute limit without a terminal summary. That original result remains
historical. The separately authorized required-CI workflow at `b3f946b3` and
test/evidence SHA `dbafc5c3` retain the same schema implementation; GitHub run
29451087913 completed Build, Frontend, all four test shards, and Docker Build &
Push terminal green. Its allocator covered 3,361 logical tests and its TRX files
reported 3,385 executed rows, all passed with 0 failed or skipped. Read
[`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md) before resuming;
the current source and complete-suite CI subgate are green, but dedicated
migration-163 blank/populated-upgrade, production, and release certification
remain open. No production container or Laravel database was touched.

## Historical Runtime Chain And Replay Evidence (2026-07-12)

At this checkpoint, EF discovered 115 migration IDs. The latest was
`20260712060051_DirectMessageStateParity`. The runtime inventory was
repaired by restoring explicit `[Migration]` and `[DbContext]` metadata to 27
essential designer-less migrations, including
`20260303120000_AddAiMessageTenantId`. A `.Designer.cs` file is not itself the
discovery contract. Do not add metadata to another legacy class merely to make
a count move: first prove that its DDL is not duplicated elsewhere and that
every supported database history can accept it. In particular,
`20260307181700_FederationCoreExpansion` remains outside the runtime chain
because `20260307195033_Phase38to40_JobsKBLegal` is its full schema superset;
discovering both would attempt duplicate table creation.
`20260305120000_AddTenantUpdatedAt` also remains outside the runtime chain
because `InitialCreate` already creates `tenants.UpdatedAt`; discovering it
would attempt to add the same column again.

Recorded non-production evidence at this checkpoint was:

- the recorded runtime inventory contains 115 discovered IDs from
  `20260202085043_InitialCreate` through
  `20260712060051_DirectMessageStateParity`;
- the final blank replay applied all 115 migrations and directly verified the
  new message state defaults and deletion-audit relationship as well as the
  preceding safeguarding metadata, catalog, and preference shape;
- a populated 114-to-115 replay preserved existing message content and read
  timestamps, initialized boolean state to `false`, left optional timestamps
  and audit identity null, and installed the audit foreign key with
  `ON DELETE SET NULL`;
- retained valid populated 113-to-114 evidence preserves all safeguarding
  preference rows, widens `SelectedValue`, and losslessly fills null
  `ConsentGivenAt` from `CreatedAt`;
- a duplicate tenant/user/option fixture raised PostgreSQL `P0001` before DDL
  or data mutation, leaving history at 113 and no partial migration-114 schema;
- retained 110-to-111 evidence proves the volunteer-hours migration preserved
  and linked existing evidence without minting transaction, payment, or XP
  value, while its invalid fixture left history at 110 and no partial
  migration-111 DDL;
- the final deterministic direct-message state gate passed 39/39 with zero
  failed or skipped; the broader exact regression completed 57/58 with its sole existing
  first-writer race subsequently green in isolation, while a separate class
  aggregate completed 12/13 before disposable PostgreSQL was OOM-killed with
  `exit 137` and the race again passed in isolation; neither interrupted
  aggregate is a fully green result;
- `has-pending-model-changes` is green, and disposable Docker container,
  network, and anonymous-volume cleanup left zero matching resources; and
- no production database or container was touched.

`20260712060051_DirectMessageStateParity` adds durable message edit metadata,
participant-scoped deletion state, per-user archive state, and a nullable
deletion-audit user relationship. New boolean state defaults to `false`; edit,
delete, and archive timestamps plus audit identity default to null. Its blank 115 and populated
114-to-115 PostgreSQL replays are green and the populated replay preserves
message content and read timestamps. The audit relationship uses
`ON DELETE SET NULL` so deleting an auditor principal does not delete message
history. The migration is intentionally forward-only: downgrade would discard
visibility, edit, deletion, and audit history. Use a verified pre-migration
backup or a reviewed forward remediation instead of forcing `Down()`.

`20260712023810_SafeguardingPreferenceDependencyParity` makes
`user_safeguarding_preferences.SelectedValue` 255 characters, requires
`ConsentGivenAt`, installs one unique `(TenantId, UserId, OptionId)` selection,
and changes tenant/option deletion to cascade like Laravel. It fails before any
change when duplicate preference history exists rather than selecting a winner
and discarding consent evidence. Null consent timestamps are the only lossless
backfill and use the row's original `CreatedAt`.

`20260712022243_MessagingDisabledRestrictionParity` adds the persisted
`messaging_disabled` flag to `user_monitoring_restrictions`. This is the
documented .NET storage adapter for Laravel's `user_messaging_restrictions`;
the workflow contract is equivalent even though the physical table name is not.

`20260712020049_SafeguardingVettingAttestationParity` creates the exact Laravel
metadata tables `tenant_safeguarding_settings`,
`member_vetting_attestations`, `member_vetting_attestation_events`,
`safeguarding_vetting_review_requests`, and
`safeguarding_policy_rotation_events`; adds preference policy-review state; and
marks legacy vetting metadata for controlled redaction. These tables store
attestation decisions and lifecycle metadata, not certificates, reference
numbers, arbitrary notes, or other sensitive evidence. Attestation events and
policy rotations are append-only, and legacy `vetting_records` do not authorize
new contact policy.

`20260711192124_VolunteerHoursLedgerParity` hardens canonical `vol_logs` hours,
status, and tenant-scoped provenance; adds feedback plus the personal
`transactions.VolunteerLogId` evidence link; binds organisation payment rows to
their logs; installs tenant-composite user/organisation/opportunity/reviewer/
Caring relationships; and enforces active natural-key, personal transaction,
organisation payment, and volunteer-hour XP uniqueness. It also creates the
tenant-scoped `feed_activity` table with Laravel's unique source tuple and feed
indexes, plus nullable `users.show_on_leaderboard` privacy evidence. The
associated service publishes approved hours as idempotent `volunteer_hours`
rows without broadcasting the organisation-facing description; other feed
producers, admin moderation integration, cleanup, and backfill remain separate
gaps. Its preflight rejects
invalid hours/status, orphan/cross-tenant relationships, inconsistent
opportunity/Caring provenance, and contradictory, ambiguous, or duplicate
payout/XP evidence before DDL. It never creates transaction, payment, or XP rows
for legacy logs. Uniquely provable existing evidence may be linked; evidence-
free approved whole-hour organisation rows are downgraded to `pending`, while
approved Caring sub-hour rows remain valid without fabricated evidence. The
migration is intentionally forward-only because rollback would remove immutable
feedback and ledger provenance.

The preceding `20260711143546_VolunteerQrAttendanceParity` adds nullable 64-character QR
tokens and coordinator identities, required attendance status/updated evidence,
a global filtered unique QR-token index, and a unique tenant/shift/user
attendance index. It backfills `checked_out`, then `checked_in`, then `pending`
from existing timestamps and copies `CreatedAt` to `UpdatedAt`, while preserving
null historical tokens/coordinators and legacy `HoursLogged`/`TransactionId`.
Tenant-composite attendance relationships and the application
tenant/opportunity/shift foreign key reject cross-tenant or cross-opportunity
assignments. The volunteer-organisation membership role constraint now accepts
`owner`, `admin`, `manager`, `coordinator`, or `member`. Duplicate attendance
and orphan/cross-tenant relationship preflights abort before DDL because legacy
hours/transaction evidence cannot be merged safely.

The preceding `20260711100817_LoyaltyEstateOrganisationEvidence` adds authoritative,
tenant-composite ledger links for Caring loyalty redemption/reversal and hour
estate settlement evidence. It also replaces generic organisation, membership,
wallet, and wallet-transaction relationships with tenant-composite keys,
enforces one membership per tenant/organisation/user, and restricts membership
roles to `owner`, `admin`, `member`, or `volunteer`. Its preflight aborts on
cross-tenant owners, members, wallets, wallet transactions, transaction users,
or unknown roles. It only normalizes casing/whitespace for known role values.
The migration is intentionally irreversible because silently removing financial
evidence or tenant constraints would be unsafe.

The preceding `20260711083852_WalletLedgerFederationPartnerParity` makes both
relationships in the main .NET `transactions` ledger nullable so canonical
one-sided debits and credits do not require fabricated users. It adds explicit
transaction types and participant-specific history-hide flags, hardens
federation transaction provenance, stores durable partner access-token state,
and adds reservation/settlement evidence for Caring hour gifts. Its data
conversion fails closed on ambiguous federation links or invalid pending gift
provenance.

The preceding `20260711010201_VolunteerOrganisationRelationshipsParity` creates
the canonical `vol_organizations`, `org_members`,
and `vol_org_transactions` tables, adds a nullable
`volunteer_opportunities.organization_id`, and enforces tenant-composite owner,
membership, and opportunity relationships. It performs no organisation
backfill. The opportunity foreign key uses non-destructive `RESTRICT`; its
original nullable transaction `vol_log_id` scalar is now bound by
`VolunteerHoursLedgerParity` to the canonical tenant-scoped `vol_logs` row. The
filtered unique `(tenant_id, vol_log_id, type)` payment guard remains, and the
canonical hours migration also links personal transaction and XP evidence.
Existing NULL-linked opportunities require an
explicit operator mapping; never backfill from the user-valued `OrganizerId`.

The preceding `20260710221715_RecurringShiftPatternCrudParity` migration makes
the canonical recurring-pattern creator and unsigned capacity fields explicit.
`20260710211122_RecurringShiftGenerationParity` replaces the recurring-pattern
tenant index with a tenant/active/end-date sweep index and adds a filtered
unique generated-shift key on tenant, pattern, and exact start time. The latter
fails before index creation if duplicate historical occurrences exist; it never
chooses a shift to delete because linked operational history may already depend
on either row.

The preceding `20260710192521_GuardianConsentLifecycle` migration adds guardian
phone, consent IP, a unique nullable SHA-256 token hash, required
relationship storage, canonical lifecycle-status cleanup, safe read indexes,
and a cascade minor-user relationship. It expires unverifiable legacy pending/
active rows and removes orphan minor rows before enforcing the new constraint.
The preceding `20260710171315_AdminVolunteerApprovalWorkflow` migration added
application `ShiftId`/`OrgNote`, notification `Link`, opportunity-scoped expiry,
and the indexes and `SET NULL` foreign keys used by transactional volunteering
capacity checks. The Debug API/test builds and required solution-wide Release
build complete with zero errors; the only warnings are the same four pre-
existing `xUnit1031` warnings in the test project. The Release build took 4m36s.
One disposable Linux run discovered 3,007 tests and passed 53/53: all 51
`VolunteerHoursParityTests` plus both `V15FeedActivityCompatibilityTests`.
Windows Smart App Control blocks the freshly rebuilt unsigned API assembly, so
the run used Linux without weakening host policy. The clean affected rerun then
discovered 3,007 tests, selected 243, and passed 243/243 with zero failed and zero
skipped in 418.639s. The full 3,007-test suite, CI, and unchanged-frontend
runtime proof remain open. The
preceding QR attendance, shift-swap, route/auth, affected-module,
and ambient-transaction results remain historical evidence; none replaces a
clean current full-suite run.
Descendant CI run `29154079189` was later cancelled after its completed
Integration Tests job reported 51 failures out of 2,888 tests; only its nested-transaction
failure was a direct regression from the preceding `bfeafb2e` slice, and that
case is fixed and green locally. Do not report CI green from this evidence.

Before applying `RecurringShiftGenerationParity`, inventory duplicate rows by
`("TenantId", "RecurringPatternId", "StartsAt")` where the pattern id is not
null. Reconcile any duplicates and their linked check-ins, applications,
reservations, waitlist entries, and other history explicitly before retrying.

If an explicitly authorized future production plan includes
`GuardianConsentLifecycle`, first read
`../.claude/production-containers.md`, verify the exact component, source SHA,
and database target, and require independently checked backup/restore evidence
plus an agreed rollback or forward-remediation plan. Review affected-row counts
before approval. The migration deliberately expires legacy pending/active rows
that cannot prove guardian possession of a credential and removes consent rows
whose minor user no longer exists.

`AdminVolunteerApprovalWorkflow` deliberately changes the tenant/opportunity/
user application index from unique to non-unique. Declined or withdrawn history
can therefore be retained when a volunteer reapplies. Its `Down()` method
intentionally throws before any destructive operation because recreating the
former unique index could fail after valid use or require data loss.

The historical `20260706120000_AddTenantInviteCodes` migration now uses the
quoted PostgreSQL principal column `Id`, not lowercase `id`, for its tenant and
user foreign keys. This repairs future fresh installs; databases that already
recorded the migration are not changed or replayed.

Migration discovery must continue to fail closed if a new source migration is
invisible to EF, a deliberately excluded overlapping migration becomes
discoverable, or an intended migration ID no longer matches its type. At this
checkpoint, the green blank replay certified the 115 IDs discovered in that
exact source snapshot. It did not certify later migrations or authorize
replaying either intentionally excluded duplicate.

## Read-Only Legacy Financial Audit

The following PostgreSQL report is deliberately read-only and is intended for
an operator working on a database upgraded at least through
`20260711192124_VolunteerHoursLedgerParity`. At the historical 2026-07-12
checkpoint used to author this report, the recorded chain ended at
`20260712060051_DirectMessageStateParity`; that is not the current repository
tail. The report identifies candidates;
it does not decide their meaning. Do not auto-fix, relink, delete, cancel, or
recreate any returned row. Each row needs a documented manual disposition that
states the intended business event, the existing sender/receiver balance
impact, the proposed balance impact (if any), and the evidence used to justify
that decision. Take the normal backup before any later approved remediation.

```sql
BEGIN TRANSACTION READ ONLY;

-- 1. Legacy self-transfers, admin grants, and starting-balance grants.
--    The delta columns show how the present ledger affects balances.
SELECT
    t."TenantId" AS tenant_id,
    t."Id" AS transaction_id,
    CASE
        WHEN t."SenderId" IS NOT NULL AND t."SenderId" = t."ReceiverId" THEN 'self_transfer'
        WHEN t."TransactionType" = 'starting_balance'
          OR t."Description" IN ('Starting balance', 'Starting balance credit')
          OR t."Description" LIKE '[Welcome Bonus]%' THEN 'starting_balance'
        ELSE 'possible_admin_grant'
    END AS candidate_kind,
    t."SenderId" AS sender_id,
    t."ReceiverId" AS receiver_id,
    t."Amount" AS amount,
    CASE WHEN t."Status" = 'Completed' AND t."SenderId" IS NOT NULL THEN -t."Amount" ELSE 0 END AS current_sender_delta,
    CASE WHEN t."Status" = 'Completed' AND t."ReceiverId" IS NOT NULL THEN t."Amount" ELSE 0 END AS current_receiver_delta,
    t."TransactionType" AS transaction_type,
    t."Status" AS status,
    t."Description" AS description,
    t."CreatedAt" AS created_at,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_FIX' AS disposition
FROM transactions AS t
WHERE t."SenderId" = t."ReceiverId"
   OR t."TransactionType" IN ('admin_grant', 'starting_balance')
   OR t."Description" IN ('Admin grant', 'Starting balance', 'Starting balance credit')
   OR t."Description" ILIKE '%admin%grant%'
   OR t."Description" LIKE '[Welcome Bonus]%'
ORDER BY t."TenantId", t."CreatedAt", t."Id";

-- 1b. Organisation-wallet admin grants. Review the initiating actor and the
--     recorded running balance; do not assume Category alone proves authority.
SELECT
    tx."TenantId" AS tenant_id,
    wallet."OrganisationId" AS organisation_id,
    tx."Id" AS org_wallet_transaction_id,
    tx."InitiatedById" AS initiated_by_user_id,
    tx."Amount" AS amount,
    tx."BalanceAfter" AS recorded_balance_after,
    wallet."Balance" AS current_wallet_balance,
    tx."Amount" AS expected_org_wallet_delta,
    tx."Description" AS description,
    tx."CreatedAt" AS created_at,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_FIX' AS disposition
FROM org_wallet_transactions AS tx
JOIN org_wallets AS wallet
  ON wallet."TenantId" = tx."TenantId"
 AND wallet."Id" = tx."OrgWalletId"
WHERE tx."Category" = 'admin_grant'
ORDER BY tx."TenantId", wallet."OrganisationId", tx."CreatedAt", tx."Id";

-- 2. Starting-balance configuration precedence. The API uses
--    wallet.starting_balance first, then general.welcome_credits, then 5.
WITH settings AS (
    SELECT
        tenant."Id" AS tenant_id,
        MAX(config."Value") FILTER (WHERE config."Key" = 'wallet.starting_balance') AS primary_value,
        MAX(config."Value") FILTER (WHERE config."Key" = 'general.welcome_credits') AS legacy_value
    FROM tenants AS tenant
    LEFT JOIN tenant_configs AS config
      ON config."TenantId" = tenant."Id"
     AND config."Key" IN ('wallet.starting_balance', 'general.welcome_credits')
    GROUP BY tenant."Id"
)
SELECT
    tenant_id,
    primary_value,
    legacy_value,
    COALESCE(primary_value, legacy_value, '5') AS selected_raw_value,
    CASE
        WHEN primary_value IS NOT NULL AND legacy_value IS NOT NULL
             AND primary_value IS DISTINCT FROM legacy_value THEN 'conflicting_values'
        WHEN COALESCE(primary_value, legacy_value) IS NULL THEN 'default_5_applies'
        WHEN COALESCE(primary_value, legacy_value) ~ '^\s*-' THEN 'negative_value_clamps_to_0'
        WHEN COALESCE(primary_value, legacy_value) !~ '^\s*[+]?[0-9]+([.][0-9]+)?\s*$' THEN 'noncanonical_value_requires_runtime_parse_review'
        ELSE 'review_current_value'
    END AS candidate_reason,
    'CONFIG_ONLY_NO_BALANCE_CHANGE_UNTIL_A_GRANT_IS_WRITTEN' AS balance_impact,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_FIX' AS disposition
FROM settings
ORDER BY tenant_id;

-- 3. Loyalty rows without valid authoritative debit/refund links.
SELECT
    r."TenantId" AS tenant_id,
    r."Id" AS redemption_id,
    r."Status" AS redemption_status,
    r."MemberUserId" AS member_user_id,
    r."CreditsUsed" AS credits_used,
    r."RedemptionTransactionId" AS debit_transaction_id,
    debit."Id" AS valid_debit_id,
    r."ReversalTransactionId" AS refund_transaction_id,
    refund."Id" AS valid_refund_id,
    -r."CreditsUsed" AS expected_applied_member_delta,
    CASE WHEN r."Status" = 'reversed' THEN 0 ELSE -r."CreditsUsed" END AS expected_net_member_delta,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_LINK_OR_BALANCE_CHANGE' AS disposition
FROM caring_loyalty_redemptions AS r
LEFT JOIN transactions AS debit
  ON debit."TenantId" = r."TenantId"
 AND debit."Id" = r."RedemptionTransactionId"
 AND debit."SenderId" = r."MemberUserId"
 AND debit."ReceiverId" IS NULL
 AND debit."Amount" = r."CreditsUsed"
 AND debit."TransactionType" = 'caring_loyalty_adapter'
 AND debit."Status" = 'Completed'
LEFT JOIN transactions AS refund
  ON refund."TenantId" = r."TenantId"
 AND refund."Id" = r."ReversalTransactionId"
 AND refund."SenderId" IS NULL
 AND refund."ReceiverId" = r."MemberUserId"
 AND refund."Amount" = r."CreditsUsed"
 AND refund."TransactionType" = 'caring_loyalty_adapter'
 AND refund."Status" = 'Completed'
WHERE r."RedemptionTransactionId" IS NULL
   OR debit."Id" IS NULL
   OR (r."Status" = 'reversed' AND (r."ReversalTransactionId" IS NULL OR refund."Id" IS NULL))
ORDER BY r."TenantId", r."Id";

-- 4. Settled hour estates that lack valid settlement evidence.
SELECT
    e.tenant_id,
    e.id AS estate_id,
    e.member_user_id,
    e.beneficiary_user_id,
    e.policy_action,
    e.settled_hours,
    e.settlement_transaction_id,
    ledger."Id" AS valid_settlement_transaction_id,
    -e.settled_hours AS expected_member_delta,
    CASE WHEN e.policy_action = 'transfer_to_beneficiary' THEN e.settled_hours ELSE 0 END AS expected_beneficiary_delta,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_LINK_OR_BALANCE_CHANGE' AS disposition
FROM caring_hour_estates AS e
LEFT JOIN transactions AS ledger
  ON ledger."TenantId" = e.tenant_id
 AND ledger."Id" = e.settlement_transaction_id
 AND ledger."SenderId" = e.member_user_id
 AND ledger."ReceiverId" IS NOT DISTINCT FROM
     (CASE WHEN e.policy_action = 'transfer_to_beneficiary' THEN e.beneficiary_user_id ELSE NULL END)
 AND ledger."Amount" = e.settled_hours
 AND ledger."TransactionType" = 'caring_hour_estate_adapter'
 AND ledger."Status" = 'Completed'
WHERE e.status = 'settled'
  AND COALESCE(e.settled_hours, 0) > 0
  AND (e.settlement_transaction_id IS NULL OR ledger."Id" IS NULL)
ORDER BY e.tenant_id, e.id;

-- 5. Same-platform Caring hour transfers have reciprocal tracking rows but no
--    authoritative transaction-id columns. Never choose a match solely by
--    amount or timestamp proximity.
SELECT
    source.tenant_id AS source_tenant_id,
    source.id AS source_transfer_id,
    source.member_user_id AS source_member_id,
    source.hours_transferred,
    destination.tenant_id AS destination_tenant_id,
    destination.id AS destination_transfer_id,
    destination.member_user_id AS destination_member_id,
    source_matches.match_count AS source_ledger_candidate_count,
    source_matches.transaction_ids AS source_ledger_candidate_ids,
    destination_matches.match_count AS destination_ledger_candidate_count,
    destination_matches.transaction_ids AS destination_ledger_candidate_ids,
    -source.hours_transferred AS expected_source_member_delta,
    source.hours_transferred AS expected_destination_member_delta,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_LINK_OR_BALANCE_CHANGE' AS disposition
FROM caring_hour_transfers AS source
LEFT JOIN caring_hour_transfers AS destination
  ON destination.id = source.linked_transfer_id
 AND destination.linked_transfer_id = source.id
 AND destination.role = 'destination'
LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS match_count,
           ARRAY_AGG(t."Id" ORDER BY t."CreatedAt", t."Id") AS transaction_ids
    FROM transactions AS t
    WHERE t."TenantId" = source.tenant_id
      AND t."SenderId" = source.member_user_id
      AND t."ReceiverId" IS NULL
      AND t."Amount" = source.hours_transferred
      AND t."Status" = 'Completed'
      AND t."Description" LIKE '[hour_transfer_out]%'
) AS source_matches ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS match_count,
           ARRAY_AGG(t."Id" ORDER BY t."CreatedAt", t."Id") AS transaction_ids
    FROM transactions AS t
    WHERE destination.id IS NOT NULL
      AND t."TenantId" = destination.tenant_id
      AND t."SenderId" IS NULL
      AND t."ReceiverId" = destination.member_user_id
      AND t."Amount" = destination.hours_transferred
      AND t."Status" = 'Completed'
      AND t."Description" LIKE '[hour_transfer_in]%'
) AS destination_matches ON TRUE
WHERE source.role = 'source'
  AND source.status = 'completed'
ORDER BY source.tenant_id, source.id;

-- 6. Federated hour transfers whose recorded link is absent or no longer has
--    the exact tenant/user/amount/direction shape required by the migration.
SELECT
    f."TenantId" AS tenant_id,
    f."Id" AS federated_transfer_id,
    f."Direction" AS direction,
    f."LocalUserId" AS local_user_id,
    f."Amount" AS amount,
    f."LocalTransactionId" AS recorded_transaction_id,
    ledger."Id" AS valid_transaction_id,
    CASE WHEN f."Direction" = 'Outbound' THEN -f."Amount" ELSE f."Amount" END AS expected_local_user_delta,
    'MANUAL_DISPOSITION_REQUIRED_NO_AUTO_LINK_OR_BALANCE_CHANGE' AS disposition
FROM federated_hour_transfers AS f
LEFT JOIN transactions AS ledger
  ON ledger."TenantId" = f."TenantId"
 AND ledger."Id" = f."LocalTransactionId"
 AND ledger."Amount" = f."Amount"
 AND ledger."Status" = 'Completed'
 AND ((f."Direction" = 'Outbound' AND ledger."SenderId" = f."LocalUserId" AND ledger."ReceiverId" IS NULL)
   OR (f."Direction" = 'Inbound' AND ledger."ReceiverId" = f."LocalUserId" AND ledger."SenderId" IS NULL))
WHERE f."Status" = 'Reconciled'
  AND (f."LocalTransactionId" IS NULL OR ledger."Id" IS NULL)
ORDER BY f."TenantId", f."Id";

ROLLBACK;
```

## Maintained Migration Workflow

```text
Edit entity/DbContext -> create migration -> review SQL -> disposable replay ->
focused/full tests -> PR/CI -> merge -> explicitly authorized deployment plan
```

> **Production boundary:** This document does not authorize production access,
> migration, backup, restore, or deployment. Before any production action, read
> `../.claude/production-containers.md`, obtain explicit authorization for the
> exact component and SHA, and inspect the current operator scripts. The
> production-oriented Make targets are fail-closed historical recipes, not
> helpers, a standing runbook, or proof that a backup, workflow, or target is
> currently valid.

## Prerequisites

- .NET 8 SDK on the host
- the pinned local EF tool restored with `dotnet tool restore`
- an explicitly named, verified disposable PostgreSQL 16.4 database for replay
- the current source branch or isolated schema worktree

The root API container is runtime-only. It has no .NET SDK and no repository
source mount, so running EF tooling inside that container cannot be the migration
workflow. Root Compose also does not expose PostgreSQL to the host by default.
Provision the disposable database explicitly rather than repointing EF at a
shared, Laravel, production-derived, or production database.

## Quick Reference

Run these from the repository root after setting
`ConnectionStrings__DefaultConnection` to the disposable database:

```powershell
dotnet tool restore
dotnet build src/Nexus.Api/Nexus.Api.csproj --configuration Release
dotnet ef migrations list --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet ef migrations has-pending-model-changes --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet ef migrations script --idempotent --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
dotnet ef database update --project src/Nexus.Api --startup-project src/Nexus.Api --configuration Release --no-build
```

Read the command output as evidence at the exact source SHA. Never redirect the
generated SQL into a real target merely because script generation succeeded.

## Step-by-Step Workflow

### 1. Make Your Schema Changes

Edit entity files in `src/Nexus.Api/Entities/` or the `NexusDbContext.cs`.

### 2. Create a Migration

```powershell
dotnet tool restore
dotnet ef migrations add AddUserPreferences `
  --project src/Nexus.Api `
  --startup-project src/Nexus.Api `
  --output-dir Migrations `
  --configuration Release
```

This generates migration source under `src/Nexus.Api/Migrations/`; it does not
apply the migration. Review the migration, designer metadata, and model snapshot
before any replay.

**Migration naming convention:** Use PascalCase descriptive names that explain the change:
- `AddUserPreferences` - adding new tables/columns
- `AddIndexOnEmail` - performance changes
- `RemoveDeprecatedFields` - removal of old schema
- `RenameStatusToState` - renaming operations

### 3. Review the Generated Migration

Always review the generated files before committing:

```powershell
dotnet ef migrations script --idempotent `
  --project src/Nexus.Api `
  --startup-project src/Nexus.Api `
  --configuration Release
```

Look for:
- Unintended table/column drops
- Missing index additions
- Correct nullable/default values

### 4. Test Locally

```powershell
# ConnectionStrings__DefaultConnection must name a verified disposable DB.
dotnet ef database update `
  --project src/Nexus.Api `
  --startup-project src/Nexus.Api `
  --configuration Release
dotnet test tests/Nexus.Api.Tests/Nexus.Api.Tests.csproj --configuration Release
```

For a parity slice, prove a blank replay and an upgrade replay from the relevant
prior migration, then assert defaults, constraints, indexes, tenant rejection,
and representative valid rows. A clean blank replay alone does not prove an
upgrade path or semantic correctness.

### 5. Commit and Push

```powershell
git add src/Nexus.Api/Migrations/
git commit -m "migration: add user preferences table"
git push
```

### 6. CI Validates Your PR

The PR Quality Gate is intended to:
- **Builds** the project
- **Runs tests** against a fresh PostgreSQL database
- **Verifies migration discovery** - fails on an unclassified or accidentally restored migration class
- **Checks for pending model changes** - fails if you changed entities without a migration
- **Applies all migrations** to verify they execute cleanly
- **Warns** if entity files changed but no migration was added

Verify the workflow result at the exact commit rather than assuming intent is
green. The discovery gate must cover every compiled migration subclass and keep any
reviewed overlapping source explicitly outside the runtime chain. It prevents a
new class from becoming silently invisible, but it does not make duplicate DDL
safe. A successful blank `database update` certifies only the IDs discovered in
that exact checkout; it does not certify every migration-shaped source file or
an intentionally excluded duplicate. Record the exact source SHA, discovered
count, latest ID, replay result, and `has-pending-model-changes` result for each
new claim. The historical checkpoint above is not current-chain proof.

### 7. Prepare An Explicitly Authorized Production Plan

Merge does not itself authorize or prove a deployment. Do not assume GitHub
Actions applies migrations automatically. A production migration must not run
unless every item below is satisfied:

1. the user explicitly authorized the named component, source SHA, migration
   set, and database target;
2. the operator read `../.claude/production-containers.md` immediately before
   the action and confirmed the component-specific procedure;
3. the live target and currently deployed source/image SHA were independently
   verified;
4. a restorable pre-change backup has recorded path, timestamp, size,
   completion evidence, checksum, and appropriate restore-test evidence; and
5. write fencing/maintenance handling, health checks, abort criteria, and an
   agreed rollback or forward-remediation plan are recorded.

If any item is missing or uncertain, stop. This guide supplies no executable
production migration or restore command.

The `Makefile` migration/production targets are **unsupported and unapproved**.
They assume SDK tooling inside the runtime API container and conflict with
checked-in database names and current deployment boundaries. The presence of a
prompt, health probe, target name, or GitHub workflow is not safety evidence.
The file now fails closed unconditionally for every target except `help`.
Historical recipes remain readable as archaeology but are not executable
interfaces.

## Drift Detection

### What is Schema Drift?

Schema drift occurs when the database schema doesn't match what the codebase expects. Common causes:
- Applying migrations directly on production without committing them
- Forgetting to create a migration after editing entities
- Different migration histories between environments

### Running the Drift Check

```powershell
dotnet ef migrations has-pending-model-changes `
  --project src/Nexus.Api `
  --startup-project src/Nexus.Api `
  --configuration Release `
  --no-build
```

This is a source/model-snapshot check. It does not compare a production
database. Production history inspection is a separate read-only operator
action requiring explicit authorization and current target verification.

### CI Drift Prevention

The PR workflow prevents drift from entering `main`:

| Check | Severity | What it catches |
|-------|----------|----------------|
| Migration discovery quarantine | **Error** (blocks merge) | New invisible migrations, abstract migration classes, stale quarantine entries, and migration-id mismatches |
| Pending model changes | **Error** (blocks merge) | Entity changes without migration |
| Migrations apply cleanly | **Error** (blocks merge) | Broken/conflicting migrations |
| Entity changes without migration files | **Warning** | Possible missing migration |

## Production Safety

### Backup Evidence

Never assume a backup exists because a workflow or Make target intends to
create one. Before an authorized migration, record the exact backup path,
timestamp, size, completion marker, checksum, and an appropriate restore test.
Verify scheduled or deployment backups from the current external system rather
than treating this repository document as evidence that they ran.

### Rollback

If a production migration causes issues, stop and use the previously reviewed
incident plan. A restore requires fresh explicit authorization for the named
database and backup; migration authorization alone is not restore
authorization. Do not paste a generic restore command from repository
documentation: confirm the active database container, database name, backup
integrity, restore ordering, application stop/write fencing, and exact source
SHA with the operator. Prefer a tested forward remediation where safe; restore
only the verified backup through the explicitly approved procedure.

`20260710171315_AdminVolunteerApprovalWorkflow` cannot be rolled back with an
automatic down-migration: its `Down()` throws before changing schema because
restoring the former unique volunteer-application index is not data-safe after
legitimate reapplications. Use a tested forward remediation or restore the
pre-migration backup instead.

`20260710192521_GuardianConsentLifecycle` is also intentionally irreversible:
its `Down()` throws before changing schema because rollback would discard
hashed guardian credentials and restore unsafe legacy status and verification
semantics. Use a tested forward remediation or restore the pre-migration backup.

`20260711143546_VolunteerQrAttendanceParity` is intentionally forward-only.
Its `Down()` throws before changing schema because a downgrade would discard QR
token, attendance-status, and coordinator evidence and would make pending
attendance timestamps non-nullable. Restore a tested pre-migration backup or
apply a reviewed forward remediation; do not force the `Down()` path or
manually drop its evidence-preserving columns and constraints.

`20260711192124_VolunteerHoursLedgerParity` is also intentionally forward-only.
Its `Down()` throws before changing schema because rollback would remove
immutable feedback and personal, organisation, and XP ledger provenance.
Restore a verified pre-migration backup or apply a reviewed forward remediation;
do not force the disabled destructive path.

The three safeguarding/messaging migrations
`20260712020049_SafeguardingVettingAttestationParity`,
`20260712022243_MessagingDisabledRestrictionParity`, and
`20260712023810_SafeguardingPreferenceDependencyParity` are also forward-only.
Their `Down()` methods throw before mutation because rollback would discard
append-only policy/attestation evidence, silently re-enable restricted
messaging, or reintroduce ambiguous consent dependencies. Use a verified backup
or reviewed forward remediation; never force a destructive downgrade.

`20260710211122_RecurringShiftGenerationParity` has a data-preserving `Down()`:
it removes the filtered occurrence and active-pattern indexes and restores the
former simple recurring-pattern tenant index.

`20260711083852_WalletLedgerFederationPartnerParity` and
`20260711100817_LoyaltyEstateOrganisationEvidence` are also intentionally
irreversible. Their one-sided ledger semantics, financial evidence links,
partner-token storage, and tenant-composite organisation constraints cannot be
removed without changing balances, dropping provenance, or weakening tenant
isolation. Use a reviewed forward remediation or restore the pre-migration
backup; do not improvise a down migration.

### Connection Strings

Connection strings are **never** stored in the repository. They are provided via:

| Environment | How connection string is set |
|-------------|----------------------------|
| Local dev | Root `compose.yml` sets the in-container connection; host EF needs a separately exposed disposable database |
| CI/CD | GitHub Actions workflow environment |
| Production | Current secret/environment management, verified during an explicitly authorized operation; do not assume a legacy Compose path |
| Tests | Testcontainers by default or an explicitly disposable `NEXUS_TEST_POSTGRES` target |

## Troubleshooting

### "DbContext has changes not captured in a migration"

Your entity files have been modified but no migration exists for the changes.

Create a reviewed migration with the host `dotnet ef migrations add` command
shown above.

### "Migration failed to apply"

The migration SQL has an error. Check the generated migration code:

Inspect the generated `.cs`, `.Designer.cs`, and model snapshot diff. If the
migration has never been applied or shared, use the host EF tool's `migrations
remove` command, correct the model, and regenerate it. Never remove a migration
that has been applied or published without a reviewed reconciliation plan.

### "Production has migrations not in local codebase"

Treat this as a production incident, not a prompt to copy files or modify the
database. Stop the planned change and preserve the evidence. With explicit
authorization for read-only investigation, read
`../.claude/production-containers.md`, verify the target and deployed SHA, then
compare the live migration history with trusted repository history. Escalate
the discrepancy and agree a reviewed reconciliation and recovery plan before
any source, schema, migration-history, or deployment change.

### "Entity changes detected but no migration in PR" (CI warning)

Not all entity file changes require migrations (e.g., adding a `[NotMapped]` property). If the change doesn't affect the database schema, the warning can be safely ignored. If it does, create a migration.

## Architecture Notes

- **Development**: Migrations auto-apply on startup (`Program.cs` calls `MigrateAsync()`)
- **Production**: No standing command is authorized here. Follow an explicitly
  approved, component-specific plan after reading the production container map
- **Testing**: Uses Testcontainers with a fresh database per test run
- **EF Core tools** run from the pinned repository-local host tool manifest; the runtime API image has no SDK
- **PostgreSQL 16.4** is the recorded local/CI target; verify the live
  production engine/version during each explicitly authorized operation
