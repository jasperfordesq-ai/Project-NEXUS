# Volunteering Module Guide

Last reviewed: 2026-07-30

How-to / reference guide for the Volunteering module: organisations, opportunities, shifts, hour logging, and the time-credit mint on approval. Verified against the live service layer (`app/Services/Volunteer*`, `app/Services/Shift*`, `app/Services/VolOrgWalletService.php`) and `routes/api.php`.

> This guide replaces an archived engine-report snapshot that documented an older "auto-pay" behaviour. The current model is **auto-mint on approval** — see [Hour logging and the credit mint](#hour-logging-and-the-credit-mint). Do not treat the archived report as live.

---

## Audience and supported workflows

The module serves two distinct roles — the "two hats" model. A single user can wear either or both hats.

| Hat | Who | Supported workflows |
| --- | --- | --- |
| **Volunteer** | Any member | Browse opportunities, apply, sign up for shifts, log hours, join shift waitlists, request shift swaps, QR check-in, earn an impact certificate, review organisations. |
| **Organisation** | A member who registers/owns/admins a `vol_organization` | Post opportunities, review applications, approve/decline logged hours (which mints credits), manage the organisation wallet, manage shifts, view volunteers and stats. |

Platform/tenant admins have a superset of both via the `/v2/admin/volunteering/*` surface (`AdminVolunteerController`, `VolunteerCommunityController`, `VolunteerWellbeingController`, `VolunteerExpenseController`). Every volunteering setting, the five reminder switches and timings included, is `volunteering.*` tenant configuration (`VolunteeringConfigurationService`, edited through `PUT /v2/admin/config/volunteering/bulk` and the admin Module Configuration window); the `vol_reminder_settings` table is retired (2026-10-18). Outbound webhooks are not a volunteering concern any more: they are managed through `/v2/admin/integrations/webhooks*` (`AdminOutboundWebhooksController`), which only a god account that is also a platform super admin may call, and they subscribe to the six events the platform actually fires (`WebhookDispatchService::ALLOWED_EVENTS`).

The two hats are enforced in code: an organisation starts at `status = 'pending'` after registration (`VolunteerService::createOrganization`) and only appears in the (member-only) organisation directory once a tenant admin approves it to `active`/`approved` (`getOrganisations` filters on `whereIn('status', ['approved', 'active'])`). Until then the owner sees a pending-approval state rather than a live org.

## Tenant scoping and feature gate

- **Feature gate:** every member-facing endpoint calls `VolunteerController::ensureFeature()`, which throws `403 FEATURE_DISABLED` when `TenantContext::hasFeature('volunteering')` is false. `volunteering` defaults to on via the `FEATURE_DEFAULTS` constant in `app/Services/TenantFeatureConfig.php` (resolved through `TenantContext`), so it is enabled unless a tenant turns it off.
- **Tenant scoping:** every query is scoped by `TenantContext::getId()` — either through the `HasTenantScope` trait on the Eloquent models (`VolOpportunity`, `VolApplication`, `VolLog`, `VolShift`, `VolOrganization`) or explicit `AND tenant_id = ?` clauses in the raw-SQL paths. Cross-tenant joins are pinned with `whereColumn('o.tenant_id', 'a.tenant_id')` style predicates so a join can never bridge two tenants.
- **Caring Community interplay:** member self-logging can be disabled per tenant via `CaringCommunityWorkflowPolicyService`. When `allow_member_self_log` is false, `logHours()` returns `403` unless the caller can bypass the policy (admin role or `volunteering.hours.review` permission).

## Key code locations

| Concern | Code |
| --- | --- |
| HTTP entry (member) | `app/Http/Controllers/Api/VolunteerController.php` |
| HTTP entry (admin) | `AdminVolunteerController`, `VolunteerCommunityController`, `VolunteerWellbeingController`, `VolunteerExpenseController`, `VolunteerCheckInController`, `VolunteerCertificateController` |
| Core service | `app/Services/VolunteerService.php` (opportunities, applications, shifts, **hour log + verify/mint**, organisations, reviews) |
| Org wallet | `app/Services/VolOrgWalletService.php` |
| Certificates | `app/Services/VolunteerCertificateService.php` |
| QR check-in | `app/Services/VolunteerCheckInService.php` |
| Matching / recommendations | `app/Services/VolunteerMatchingService.php` |
| Shift waitlist | `app/Services/ShiftWaitlistService.php` |
| Shift swaps | `app/Services/ShiftSwapService.php` |
| Per-tenant config | `app/Services/VolunteeringConfigurationService.php` |
| Safeguarding | `app/Services/SafeguardingService.php`, `SafeguardingTriggerService`, `SafeguardingPreferenceService` |
| Wellbeing | `app/Services/VolunteerWellbeingService.php`, `app/Services/Volunteering/WellbeingRecipientResolver.php`, `WellbeingSettingsService.php`, `app/Jobs/SendVolunteerLowMoodEmails.php` |
| Vol-log status events | `app/Providers/EventServiceProvider.php` → `App\Events\VolLogStatusChanged` |
| Listeners | `AwardXpOnVolLogApproved`, `RevertRegionalPointsOnVolLogChange`, `PostFeedActivityOnVolLogApproved` |

**Tables:** `vol_organizations`, `vol_opportunities`, `vol_applications`, `vol_shifts`, `vol_logs`, `vol_org_transactions`, `vol_certificates`, `vol_shift_checkins`, `vol_shift_waitlist`, `vol_shift_swap_requests`, `vol_reviews`. Membership/roles are stored in `org_members` with `org_type = 'volunteer'`. Minted credits also write the platform-wide `transactions` table and adjust `users.balance`.

**Frontend entry points:** React `react-frontend/src/pages` (volunteering pages and org dashboard) and the accessible GOV.UK track under `/{tenantSlug}/accessible/...` (`app/Http/Controllers/GovukAlpha`, `VolunteeringParityTest` and friends).

**Routes / API contract:** the main member block `/v2/volunteering/*` is `routes/api.php` lines 1161–1203, with the community / shift / certificate routes at 3340–3406; the admin routes are the `/v2/admin/volunteering/*` block of the same file (line numbers move; search for the prefix). Refer to that file and the OpenAPI surface rather than copying the endpoint table here. **Every `/v2/volunteering/*` route requires `auth:sanctum` except the two guardian-consent verification routes** — so `opportunities`, `showOpportunity`, `organisations` and `showOrganisation` are all authenticated. The only anonymous exceptions in the module are `GET` and `POST /v2/volunteering/guardian-consents/verify/{token}` (`routes/api.php:3386-3387`), which are the only volunteering routes that chain `->withoutMiddleware('auth:sanctum')`; they authenticate by signed token instead. The `GET` is a read-only token lookup and the grant itself is `POST`-only, so an unauthenticated prefetch (e.g. a mail scanner) can never flip consent state.

## Hour logging and the credit mint

This is the core invariant of the module. **Approving logged hours always mints time credits to the volunteer** — classic timebanking, not a transfer gated by any balance.

1. **Log** — `VolunteerService::logHours()` inserts a `vol_logs` row. The member must have a real relationship with the organisation (an approved application, or owner/admin membership). Default status is `pending`; the Caring Community policy can auto-approve.
   - Per-entry ceiling: `volunteering.max_hours_per_shift` (admin-configurable, absolute hard cap of 24h).
   - Future dates and duplicate (`org` + `date` + `opportunity`) entries are rejected; concurrent duplicate submits are serialised with a cache lock.
2. **Verify** — an org owner/admin (never the volunteer themselves) calls `VolunteerService::verifyHours($logId, $adminUserId, 'approve'|'decline')`. Approval runs inside a single DB transaction:
   - The status flip is conditional (`... WHERE status = 'pending'`). A concurrent/retried approval finds 0 rows affected and returns `already_processed` without re-minting — the idempotency gate.
   - **The mint always runs on approval.** Whole hours (`floor(hours)`) are added to `users.balance`; the same integer is debited from `vol_organizations.balance`, which is **allowed to go negative**. The org wallet is a reconciliation figure, not a spending limit. There is **no** `insufficient_balance` rejection on this path and **no** dependency on the `auto_pay_enabled` flag.
   - A second idempotency guard checks `vol_org_transactions` for an existing `volunteer_payment` for that `vol_log_id` (returns `already_paid`).
   - If the log floors to **zero whole hours**, no credits move and the outcome is `no_whole_hours`. Fractional remainders stay in the org wallet.
   - Rows are written to `vol_org_transactions` (audit, `balance_after` may be negative) and the platform `transactions` table (`transaction_type = 'volunteer'`).
   - Payment outcomes are exposed via `VolunteerService::getLastPaymentOutcome()`: `paid` | `no_whole_hours` | `already_paid` | `already_processed` | `null` (declined).

> **Removed in the June-2026 overhaul:** the old per-org "auto-pay" dependency and the `insufficient_balance` trap that used to block credit when the org wallet was empty. Both were removed from *both* mint paths. `verifyHours()` mints unconditionally, and so does the legacy private helper `applyVolunteerAutoPayment()` (`app/Services/VolunteerService.php:2850`), which debits the org wallet unconditionally and lets it go negative. That helper is still reached on the self-log auto-approve path, but it is called whenever the new log resolves to `status = 'approved'` — **not** gated on `org.auto_pay_enabled`. Nothing in the codebase reads `auto_pay_enabled` to decide whether to mint; it survives only as a reported flag.

### Side-effects on `pending → approved`

`verifyHours()` dispatches `VolLogStatusChanged`, wired to three listeners in `EventServiceProvider`:

| Listener | Effect | Idempotency |
| --- | --- | --- |
| `AwardXpOnVolLogApproved` | +20 XP per hour (`GamificationService::XP_VALUES['volunteer_hour']`); re-checks `vol_1h..vol_500h` badges. | Encodes `[vol_log:N]` in the XP description and skips if already present. |
| `PostFeedActivityOnVolLogApproved` | Posts a `volunteer` feed-activity row. | `INSERT ... ON DUPLICATE KEY UPDATE` on `(tenant_id, source_type, source_id)`. |
| `RevertRegionalPointsOnVolLogChange` | Only fires when a log leaves `approved` (e.g. approved→declined); reverses any Caring Community regional points. No-op on the mint path. | Guards on `previousStatus === 'approved'`. |

All three pin tenant context with `TenantContext::setById()` / `restoreAfterScopedListener()` and swallow their own exceptions so a side-effect failure can never roll back the committed approval.

## Shifts: waitlists, swaps, and check-in

- **Shifts** (`vol_shifts`) hang off an opportunity, with optional `capacity`. A volunteer signs up only after their application is approved. Capacity is re-checked under `FOR UPDATE` row locks (`signUpForShift`, `handleApplication` via `shiftHasApprovalCapacity`) so concurrent signups cannot overbook.
- **Waitlist** (`ShiftWaitlistService`, `vol_shift_waitlist`): join/leave with locked position re-ordering. When a slot frees (cancellation, declined approval, swap displacement), `notifyNext()` marks the next `waiting` entry `notified` and notifies them in their own locale; they claim via `promoteUser()` (re-checks capacity under lock). Stale offers are expired and cascaded by `expireStaleNotifications()` (cron).
- **Swaps** (`ShiftSwapService`, `vol_shift_swap_requests`): a signed-up volunteer proposes a swap to another signed-up volunteer. Optional admin approval is gated by `volunteering.swap_requires_admin`. `executeSwap()` runs under locks, refuses started shifts, and blocks double-booking via `hasOverlappingShift()`.
- **QR check-in** (`VolunteerCheckInService`, `vol_shift_checkins`): per shift+volunteer token (`bin2hex(random_bytes(32))`), only issued to approved volunteers. Scanning verifies check-in (allowing 30 min early); coordinators view check-ins via the admin dashboard. `getShiftCheckIns()` deliberately omits `qr_token`.

## The organisation wallet

`VolOrgWalletService` manages each `vol_organization`'s time-credit balance.

- **All balance mutations** use `DB::transaction()` + `FOR UPDATE` locks and write a `vol_org_transactions` row with `balance_after` for audit integrity.
- **Lock order is fixed (user → org)** across `depositFromUser()` and the hours-approval mint in `VolunteerService::verifyHours()` (and the admin approval path in `AdminVolunteerController`) to avoid deadlock when a deposit and payout race.
- **Operations:** `depositFromUser` (member tops up the org from personal credits, capped at 1000), `adminAdjustment` (admin top-up/deduct; refuses to push the balance below zero). There is no manual "pay a volunteer" operation: the unreferenced `payVolunteer()` was deleted in September 2026 (security finding F-293) because it minted credits with no authorisation or cap check; volunteers are paid only through hours approval.
- **Whole-hour invariant:** `users.balance` stores whole hours, so every cross-account move floors to an integer and debits/credits the **same** integer — no phantom credits are created or destroyed.
- The mint inside `verifyHours()` debits the org wallet **directly** (allowing negative balances); it is the only path that pays a volunteer from an org wallet.

## Certificates

`VolunteerCertificateService::generate()` sums a volunteer's **approved** hours (optionally filtered by org/date), writes a `vol_certificates` row with a 16-character `verification_code`, and emails the volunteer in their locale. Anyone shown a certificate checks it through the public, rate-limited `POST /v2/volunteering/certificates/check`, which needs both the code and the holder's name and answers only whether they match; a revoked certificate fails exactly as an unknown code does. `/certificates/{code}/html` (the printable copy) is for the signed-in holder only. Community admins list certificates and revoke one issued in error under `/v2/admin/volunteering/certificates`. Optional minimum-hours gate: `volunteering.min_hours_for_certificate`.

## Safeguarding

Safeguarding is a cross-cutting concern, not a sub-feature of hour logging. `SafeguardingService` manages guardian↔ward assignments (with an active-user, no-self-assignment guard), safeguarding training records, and incident reporting with a constrained status-transition map. `volunteering.guardian_consent_required` gates guardian-consent flows per tenant. Admin/broker surfaces live under `/v2/admin/safeguarding/*` and `/v2/admin/caring-community/safeguarding/*`. Message-level safeguarding flags flow through `SafeguardingFlaggedEvent` → `NotifySafeguardingStaff`.

## Volunteer wellbeing

A volunteer records how they feel (1 Struggling … 5 Great) with an optional note on the Wellbeing tab (website), `/volunteering/wellbeing` (accessible site) and the phone app. `VolunteerWellbeingService::detectBurnoutRisk()` turns shifts, hours, engagement gaps and the latest **shared** check-in into a 0–100 risk score; `vol_wellbeing_alerts` holds one active row per volunteer once the score reaches 30, written only by the daily `volunteering:assess-wellbeing` (04:00) and by a shared check-in, never by a read.

**Telling people (20 Oct 2026).** For a Low or Struggling check-in with "Let someone get in touch with me" ticked, `recordCheckin()` asks `App\Services\Volunteering\WellbeingRecipientResolver` who to tell, in this order, each person once: the community's named **wellbeing contacts** and extra address (`volunteering.wellbeing_contact_user_ids`, `volunteering.wellbeing_contact_email`); its **safeguarding staff** (`SafeguardingStaff::scope`), **including the volunteer when they are staff** — on a community with one staff account, excluding them meant nobody was told; the contacts of each **organisation** they volunteered with in the last 180 days; the safeguarding staff of the community **directly above** (never a sibling, never tenant 1); and only when none of those exists, the community's `tenants.contact_email`. Each person gets a bell (and the curated, time-sensitive `volunteer_wellbeing` push) at once and an email from the `emails` queue (`SendVolunteerLowMoodEmails`), rendered in their own language and naming the **person** (`UserDisplayName::person()`), never the organisation their account represents. The note is never in a bell, push or email.

**Organisation side (20 Oct 2026).** `GET /v2/volunteering/organisations/{orgId}/wellbeing` (`VolunteerWellbeingService::getOrganisationWellbeing()`; owner, admin members and the organisation's safeguarding lead via `IncidentAccess::organisationRelation()`) lists the organisation's recent volunteers who raised a low-mood alert in the last 90 days — name, mood, check-in time, status and `told_at` from the notification record; never the note, never a private check-in. It feeds the Manage Organisation **Wellbeing** tab (`OrgWellbeingTab.tsx`) and the accessible site's `/volunteering/organisations/{id}/wellbeing`. The organisation tier's bell and email link there for owners and admin members (`org_admin` on the resolver entry); a safeguarding lead who is not on the team gets the volunteer's profile.

**The record.** Every attempt is a row in `vol_wellbeing_alert_notifications` (tier, channel, `queued`/`sent`/`failed`, error code; never the note or the mood). The job marks each row as it goes, so a retry sends only to the people not yet reached. `team_notified` in the check-in response is true only when at least one person or address was reached, and `vol_mood_checkins.team_notified_at` is set only then, so the once-a-day limit cannot be tripped by a day on which nobody could be told. The response also carries `outcome` (`told`, `told_self_only`, `already_told_today`, `nobody_available`, `private`, `not_low`), `told_count` (OTHER people or addresses, never the volunteer's own staff account) and `told_at`; all three clients show it honestly. A queued email counts as reached until it is known not to be: `SendVolunteerLowMoodEmails` retries a send that did not work (three attempts, backoff), and on its last attempt records the rows `failed` and clears `team_notified_at` on any check-in that reached nobody, so the next check-in tries the chain again; `recordCheckin` applies the same rule when it meets a stamp with no non-failed row behind it (wellbeing audit, 21 Oct 2026).

**Alert lifecycle (wellbeing audit, 21 Oct 2026).** One open case per volunteer: the nightly scan refreshes an `active` OR `acknowledged` alert in place (acknowledging never spawns a twin), and reopens a `resolved`/`dismissed` one only when a shared check-in is newer than the conclusion. The scan visits everyone with an open alert as well as everyone with recent hours, shifts or check-ins, so an alert whose only signal has aged out of the 14-day window is resolved rather than left active for ever. The scan skips a community whose volunteering feature is off or whose Wellbeing tab is switched off (`VolunteerWellbeingService::isEnabledForCurrentTenant()`): the tab switch switches the whole thing off, scan and alerts included. Shift-frequency counts only shifts that have started (a booking next month is not recent activity); `cancellation_rate` is reported `measured: false` with `rate_percent: null`, because cancellations are not retained as records; the member dashboard carries `score_basis` (`activity` or `no_data`) so a volunteer with nothing to score is not shown 100/100 "Excellent". Every recipient's words, the mood word included, are rendered inside that recipient's locale.

**Staff side.** `GET /v2/admin/volunteering/wellbeing/alerts` (list, with `told_count`/`last_told_at`), `GET …/alerts/{id}` (indicators, shared check-ins with notes, who was told, notes) and `POST …/alerts/{id}/notes` are open to brokers, coordinators and admins; notes go to `vol_wellbeing_alert_notes`, which database triggers make append-only while the alert exists (once the alert is gone — erasure, or retention disposing of a concluded alert — `deleteOrphanedNotes()` removes them, and erasure calls it). `GET`/`PUT …/wellbeing/settings` (the contacts and the "If you need support now" box, `WellbeingSettingsService`) are for community administrators only. The admin page is `/admin/volunteering/wellbeing` (sidebar badge `active_wellbeing_alerts`; bells and emails link to it with `?alert=`); brokers use the panel on `/broker/safeguarding/volunteering`.
## Per-tenant configuration

`VolunteeringConfigurationService` stores `volunteering.*` keys in `tenant_settings` (5-minute cache). It controls 17 tab-visibility toggles plus behavioural settings used across the services above: `max_hours_per_shift`, `cancellation_deadline_hours`, `min_hours_for_certificate`, `swap_requires_admin`, `auto_approve_applications`, `guardian_consent_required`, `enable_qr_checkin`, `enable_matching`, and others. Read `DEFAULTS` in that file for the authoritative list and default values.

## Security and privacy invariants

- Volunteers cannot verify/approve their **own** logged hours (`verifyHours` self-check).
- Opportunity creators cannot apply to their own opportunity (`apply` self-check).
- `is_owner` on an opportunity means **creator only** — org owners/admins use the broader `can_manage` grant; admin tooling must not surface owner-only UI on other members' posts.
- QR tokens are never returned in shift roster listings.
- All notifications/emails render in the **recipient's** `preferred_language` via `LocaleContext::withLocale()` (admin fan-outs wrap per-recipient inside the loop).
- Hour-log credit movement conserves credits: same integer debited from org and credited to volunteer; fractional remainders never vanish.

## Failure modes and recovery

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Approving hours mints nothing (`no_whole_hours`) | Log floored to 0 whole hours (e.g. 0.5h entry). | Expected. Sub-hour logs accumulate value in the org wallet; the volunteer is credited once whole hours are reached. |
| Hours approved but no second credit on retry | Idempotency gate (`already_processed` / `already_paid`). | Expected and correct — no action. |
| Org wallet shows a negative balance | The mint debits the org unconditionally on approval. | Expected by design; reconcile via `depositFromUser` or `adminAdjustment`. |
| New organisation not in the organisation directory | Status is `pending` awaiting tenant-admin approval. | Approve it (`/v2/admin/volunteering/organizations/{id}/status`). |
| A volunteer's shared check-in reached nobody (`team_notified: false`, `outcome: nobody_available`) | No named wellbeing contact, no staff, no recent organisation, no parent-community staff and no `tenants.contact_email`. | Set wellbeing contacts on Admin → Volunteering → Wellbeing alerts, or give the community a contact address; the next check-in retries. `vol_wellbeing_alert_notifications` shows every attempt. |
| Staff got the bell but no email | `emails` queue not running, or the row is `failed` with an error code. | Check the row's `error_code` and `email_log`; the job's `failed()` marks unsent rows `job_failed`. |
| Volunteer cannot log hours | Caring Community `allow_member_self_log` is off, or no approved application / org membership. | Grant membership/approve application, or adjust the tenant policy. |
| Waitlist spot offer never claimed | `notified` offer expired. | `expireStaleNotifications()` (cron) cascades the offer to the next person automatically. |
| All endpoints return `403 FEATURE_DISABLED` | `volunteering` feature off for the tenant. | Re-enable the feature in tenant settings. |
| XP/feed activity missing after approval | Listener swallowed an exception (logged as warning), or already idempotently applied. | Check logs for `AwardXpOnVolLogApproved` / `PostFeedActivityOnVolLogApproved`. The mint itself is unaffected. |

## Tests and verification

Run the volunteering suites (these may be run in parallel — see [local performance](../LOCAL-PERFORMANCE.md)):

```bash
vendor/bin/phpunit --filter Volunteer --colors=always
vendor/bin/phpunit --filter 'Shift(Waitlist|Swap)' --colors=always
vendor/bin/phpunit tests/Laravel/Feature/Volunteering --colors=always
```

Important regression tests:

- `tests/Laravel/Unit/Services/VolunteerServiceTest.php` — core hour-log, approval, and mint behaviour.
- `tests/Laravel/Unit/Services/VolunteerFlowIntegrationTest.php` — end-to-end apply → approve → log → verify → mint.
- `tests/Laravel/Unit/Services/VolunteerSecurityRegressionTest.php` — self-approval, ownership, and tenant-scoping guards.
- `tests/Laravel/Feature/Volunteering/VolunteerApplyDuplicateGuardTest.php` — concurrent duplicate-apply lock.
- `tests/Laravel/Feature/Volunteering/VolunteeringAuditFixesTest.php` — fixes from the 2026-06 audit (verify-hours race, etc.).
- `tests/Laravel/Unit/Services/ShiftWaitlistServiceTest.php`, `ShiftSwapServiceTest.php` — slot-freeing, promotion, double-booking guards.
- `tests/Laravel/Unit/Services/VolunteerCertificateServiceTest.php`, `VolunteerCheckInServiceTest.php`, `VolunteerMatchingServiceTest.php`, `VolunteeringConfigurationServiceTest.php`.
- `tests/Laravel/Integration/VolunteerEmailReliabilityTest.php` — recipient-locale notification rendering.
- `tests/Laravel/Feature/Volunteering/VolunteerWellbeingMoodCheckinTest.php`, `VolunteerWellbeingRecipientChainTest.php`, `SendVolunteerLowMoodEmailsJobTest.php`, `VolunteerWellbeingAlertDetailTest.php`, `VolunteerWellbeingSettingsTest.php` — who is told, the record of it, honest outcomes, notes and settings.

After any schema change, run PHPStan and refresh the schema dump per the project deploy rules.
