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

Platform/tenant admins have a superset of both via the `/v2/admin/volunteering/*` surface (`AdminVolunteerController`, `VolunteerCommunityController`, `VolunteerWellbeingController`, `VolunteerExpenseController`).

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
| Vol-log status events | `app/Providers/EventServiceProvider.php` → `App\Events\VolLogStatusChanged` |
| Listeners | `AwardXpOnVolLogApproved`, `RevertRegionalPointsOnVolLogChange`, `PostFeedActivityOnVolLogApproved` |

**Tables:** `vol_organizations`, `vol_opportunities`, `vol_applications`, `vol_shifts`, `vol_logs`, `vol_org_transactions`, `vol_certificates`, `vol_shift_checkins`, `vol_shift_waitlist`, `vol_shift_swap_requests`, `vol_reviews`. Membership/roles are stored in `org_members` with `org_type = 'volunteer'`. Minted credits also write the platform-wide `transactions` table and adjust `users.balance`.

**Frontend entry points:** React `react-frontend/src/pages` (volunteering pages and org dashboard) and the accessible GOV.UK track under `/{tenantSlug}/accessible/...` (`app/Http/Controllers/GovukAlpha`, `VolunteeringParityTest` and friends).

**Routes / API contract:** the main member block `/v2/volunteering/*` is `routes/api.php` lines 1161–1203, with the community / shift / certificate routes at 3340–3406; admin routes `/v2/admin/volunteering/*` are 2543–2601. Refer to that file and the OpenAPI surface rather than copying the endpoint table here. **Every `/v2/volunteering/*` route requires `auth:sanctum` except the two guardian-consent verification routes** — so `opportunities`, `showOpportunity`, `organisations` and `showOrganisation` are all authenticated. The only anonymous exceptions in the module are `GET` and `POST /v2/volunteering/guardian-consents/verify/{token}` (`routes/api.php:3386-3387`), which are the only volunteering routes that chain `->withoutMiddleware('auth:sanctum')`; they authenticate by signed token instead. The `GET` is a read-only token lookup and the grant itself is `POST`-only, so an unauthenticated prefetch (e.g. a mail scanner) can never flip consent state.

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
- **Lock order is fixed (user → org)** across `depositFromUser()` and `payVolunteer()` to avoid deadlock when a deposit and payout race.
- **Operations:** `depositFromUser` (member tops up the org from personal credits, capped at 1000), `payVolunteer` (manual payout; pays only the integer floor and retains the fractional remainder), `adminAdjustment` (admin top-up/deduct; refuses to push the balance below zero).
- **Whole-hour invariant:** `users.balance` stores whole hours, so every cross-account move floors to an integer and debits/credits the **same** integer — no phantom credits are created or destroyed.
- The mint inside `verifyHours()` debits the org wallet **directly** (allowing negative balances), independently of `payVolunteer()`.

## Certificates

`VolunteerCertificateService::generate()` sums a volunteer's **approved** hours (optionally filtered by org/date), writes a `vol_certificates` row with a 12-char `verification_code`, and emails the volunteer in their locale. `verify($code)` is the verification path (tenant-scoped when a tenant context is present); it is **not** anonymous — both `GET /v2/volunteering/certificates/verify/{code}` (`routes/api.php:3343`) and `/certificates/{code}/html` (`routes/api.php:3344`) explicitly carry `->middleware('auth:sanctum')`, so a third party cannot verify a certificate without a signed-in session. `generateHtml()` renders a printable certificate. Optional minimum-hours gate: `volunteering.min_hours_for_certificate`.

## Safeguarding

Safeguarding is a cross-cutting concern, not a sub-feature of hour logging. `SafeguardingService` manages guardian↔ward assignments (with an active-user, no-self-assignment guard), safeguarding training records, and incident reporting with a constrained status-transition map. `volunteering.guardian_consent_required` gates guardian-consent flows per tenant. Admin/broker surfaces live under `/v2/admin/safeguarding/*` and `/v2/admin/caring-community/safeguarding/*`. Message-level safeguarding flags flow through `SafeguardingFlaggedEvent` → `NotifySafeguardingStaff`.

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
| Volunteer cannot log hours | Caring Community `allow_member_self_log` is off, or no approved application / org membership. | Grant membership/approve application, or adjust the tenant policy. |
| Waitlist spot offer never claimed | `notified` offer expired. | `expireStaleNotifications()` (cron) cascades the offer to the next person automatically. |
| All endpoints return `403 FEATURE_DISABLED` | `volunteering` feature off for the tenant. | Re-enable the feature in tenant settings. |
| XP/feed activity missing after approval | Listener swallowed an exception (logged as warning), or already idempotently applied. | Check logs for `AwardXpOnVolLogApproved` / `PostFeedActivityOnVolLogApproved`. The mint itself is unaffected. |

## Tests and verification

Run the volunteering suites (sequentially — never run multiple heavy suites at once):

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

After any schema change, run PHPStan and refresh the schema dump per the project deploy rules.
