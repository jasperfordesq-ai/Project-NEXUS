# Members & GDPR / Data Protection Module

Last reviewed: 2026-07-14

Audience: maintainers and contributors working on the member directory, the
data-subject-rights surface (export and erasure), consent records, and the
compliance alarms that back them.

This guide covers two related areas:

1. **Member directory** — how members are listed and discovered.
2. **GDPR / data protection** — data export (DSAR / Article 15 & 20), account
   deletion (Article 17 right to erasure), consent records, the request
   lifecycle, and the overdue-request alarm.

> This guide supersedes an earlier archived report that described account
> deletion as a shallow PII-column wipe. That is no longer accurate. The
> self-service deletion path now runs a **full Article 17 purge** through
> `GdprService::executeAccountDeletion()`. The sections below describe the real
> behaviour as implemented in code.

---

## Member directory

The directory is a tenant-scoped member list served by `UsersController`.

| Surface | Route | Handler |
|---------|-------|---------|
| Member directory (search, paginate) | `GET /api/v2/users` | `UsersController::index` |
| Members near me | `GET /api/v2/members/nearby` | `UsersController::nearby` |
| Suggested members (feed sidebar) | `GET /api/v2/members/suggested` | `FeedSidebarController::suggestedMembers` |
| Endorsements | `GET/POST/DELETE /api/v2/members/{id}/endorse…` | `EndorsementController` |

Every member-listing surface applies the same visibility rules: the member's
"show me in member search" choice (`MemberDirectoryVisibility`), their profile
visibility (`MemberProfileVisibility` — connections-only profiles are listed
only to connections and administrators), blocks in either direction, and the
surname rule (non-administrators see a first name; organisations keep their
name). Other members' coordinates are rounded to about 1 km.

The legacy `GET /api/members` route (`CoreController::members`) was retired
in September 2026 because it bypassed all of those rules and returned member
email addresses. Its siblings `GET /api/listings` and `GET /api/groups` were
retired at the same time; use `/api/v2/listings` and `/api/v2/groups`.

The `users` Meilisearch index also powers member discovery via the search
module; see [search.md](search.md). That index excludes `banned`/`suspended`
status and is tenant-filtered.

---

## GDPR surface — overview

| Capability | Endpoint(s) | Backing code |
|------------|-------------|--------------|
| Self-service data export (DSAR) | `POST /api/v2/me/data-export`, `GET /api/v2/me/data-export/history` | `MemberDataExportController` → `MemberDataExportService` |
| Self-service account deletion (immediate purge) | `DELETE /api/v2/users/me` | `UsersController::deleteAccount` → `GdprService::executeAccountDeletion` |
| Queue a data request (admin-fulfilled) | `POST /api/v2/users/me/gdpr-request` (UsersController), `POST /api/gdpr/request`, `POST /api/gdpr/delete-account` (GdprController) | `UsersController`/`GdprController` → `GdprService::createRequest` |
| Consent read / update | `GET/PUT /api/v2/users/me/consent`, `POST /api/gdpr/consent` | `GdprService::getUserConsents` / `updateUserConsent` |
| Admin GDPR queue & audit | `…/v2/admin/enterprise/gdpr/*` | `AdminEnterpriseController` → `GdprService` |
| Overdue-request alarm | `php artisan gdpr:check-overdue-requests` (scheduled daily) | `OverdueGdprRequestCheck` |

Primary service: `app/Services/Enterprise/GdprService.php` (namespace
`App\Services\Enterprise`). It uses the raw Laravel PDO directly rather than
Eloquent, and **captures its tenant id at construction time** — see the tenant
scoping warning below.

There are **two distinct export paths** and they are not interchangeable:

- `MemberDataExportService` — the self-service download a member triggers from
  settings. Builds an archive in-memory and streams it back immediately
  (`json` or `zip`), rate limited to 5 export *requests* per 24h per user
  (DB-tracked — the row is recorded before the archive builds, so a failed
  build still counts against the quota). Framed under Swiss FADP and EU GDPR
  portability.
- `GdprService::generateDataExport()` — the comprehensive retention export
  written to disk as a ZIP, used by admin request fulfilment and automatically
  generated immediately before an erasure. Sets a 7-day expiry
  (`export_expires_at`) and is cleaned up by `cleanupExpiredExports()`.

---

## Data export (DSAR — Articles 15 & 20)

`GdprService::collectUserData()` assembles the subject's data across ~24
sections (profile, listings, messages, transactions, events, groups,
volunteering and detailed volunteer records, gamification, activity log,
consents, notifications, connections, login history, messaging restrictions,
AI chat history, reviews, exchanges, vetting records, insurance metadata,
identity verification, safeguarding preferences).

Each section runs inside `safeSection()`, a fault-isolation boundary: if a
single section's query throws (a drifted column, an absent table on an older
deployment), that section is logged as a breadcrumb and substituted with its
default (empty array / null) so the **rest of the export still completes**. One
bad table never aborts the whole DSAR.

`generateDataExport()` produces a ZIP containing `data.json`, `data.html`, a
`README.txt`, and copied user uploads, then records `export_file_path` and a
7-day `export_expires_at` on the request row.

### Insurance records are metadata-only

Insurance workflows no longer accept or retain certificate documents. The
member endpoints `GET/POST /api/v2/users/me/insurance` expose a tenant-scoped
record containing the insurance type, optional provider, required expiry date,
status, and verification timestamps. A member submission containing
`certificate_file` fails with `DOCUMENT_UPLOAD_FORBIDDEN` (HTTP 422). The
accessible frontend enforces the same contract, and
`InsuranceCertificateService::create()` always writes
`certificate_file_path`, `policy_number`, and `coverage_amount` as `NULL`.

Migration `2026_07_14_000100_remove_insurance_document_data.php` cleared legacy
document/detail columns and deleted the retired
`httpdocs/uploads/insurance/` tree. Service reads use an explicit safe-column
allow-list, so raw document paths, policy numbers, coverage amounts, and private
notes cannot re-enter member or broker API responses. DSARs and erasure still
include/delete the remaining insurance metadata rows.

---

## Account deletion (Article 17 — right to erasure)

### The real behaviour: a full purge, not a shallow anonymize

`GdprService::executeAccountDeletion(int $userId, ?int $adminId, ?int $requestId)`
performs a comprehensive erasure inside a single database transaction (it
detects an already-open transaction and only manages its own when it owns one,
so it nests safely under test transactions). The steps, as implemented:

1. **Pre-deletion retention export** — `generateDataExport()` is called first.
   This is *best-effort*: a failure here is logged and the erasure continues,
   because the legal erasure duty outweighs the retention copy.
2. **Capture original email** before anonymisation (needed to purge the
   platform-wide `email_suppression` cache, which is keyed by address).
3. **Anonymise the `users` row in place** — email becomes a unique
   `deleted_{id}_<random>@anonymized.local`, name becomes "Deleted User",
   PII columns (phone, bio, skills, interests, location, lat/long, avatar,
   tagline) nulled, `password`/`password_hash` blanked, `remember_token`
   cleared, `status='inactive'`, `deleted_at`/`anonymized_at` set. The row is
   **anonymised, never row-deleted** — this is deliberate (it keeps
   counterparties' transaction/message history attributable) and is the reason
   many `ON DELETE CASCADE` constraints never fire, so dependent tables must be
   cleaned explicitly.
4. **Messages** — not hard-deleted (that would orphan the counterparty's half
   of the thread). The erased user's authored body is replaced with a
   tombstone and transcript nulled. Their attachment rows and private files
   under `storage/app/private/message-media/{tenant}/attachments/` are removed,
   and voice files under the adjacent `voice/` root are unlinked before their
   `audio_url` pointers are cleared. Canonical tenant containment is mandatory.
   Invalid, traversal, remote, and cross-tenant legacy pointers are scrubbed
   without being followed; a physical file referenced by another sender is
   preserved while only the erased member's pointer is removed. Failed unlinks
   retain their database linkage for retry; an associated `gdpr_requests` row
   remains `processing` rather than reporting false completion.
5. **Hard-deleted personal content / credentials** include: notifications,
   `user_consents`, push subscriptions, FCM tokens, AI conversations and
   messages, WebAuthn credentials/passkeys, Sanctum `personal_access_tokens`,
   cookie consents, connections, group memberships, event RSVPs, TOTP/2FA
   secrets and backup codes, notification preferences, feed activity and feed
   comments, user blocks (both directions), stories and story reactions, poll
   votes and rankings, goals/goal check-ins/progress logs, course
   enrolments/reviews/quiz attempts, marketplace seller profile, and a large
   set of volunteering records (credentials and their uploaded files,
   mood/wellbeing data, accessibility needs, guardian consents, safeguarding
   training, certificates, shift waitlist/swaps/check-ins, emergency-alert
   recipients, custom field values, vol reviews).
6. **Identity & compliance metadata is erased with a legacy-evidence safety
   exception** — current `member_vetting_attestations`, their event/review rows,
   `insurance_certificates` metadata, and `identity_verification_sessions` are
   deleted. Evidence-free legacy `vetting_records` rows are deleted immediately.
   A legacy row that still carries `document_url` is reduced to a revoked,
   minimised cleanup tombstone until the DPO-authorised legacy-evidence command
   (`php artisan safeguarding:legacy-vetting-evidence`) removes the referenced
   object; dropping that pointer first could orphan the most sensitive copy. The
   retired legacy insurance directory is also removed defensively if it still
   exists. **Safeguarding reports are deliberately retained** under legal hold
   — they are not in this set.
7. **Anonymised-but-kept records** (financial / org-accounting audit value):
   `transactions` flagged `deleted_for_sender`/`deleted_for_receiver` (amounts
   kept); `reviews.reviewer_id` nulled; exchange request notes nulled; vol
   donations/applications/logs/expenses free-text and copied PII scrubbed while
   hours and donation amounts stay (they back org wallet ledgers).
8. **Listings** soft-deleted (`status='deleted'`, description `[DELETED]`).
9. **Activity logs** anonymised (IP and user-agent nulled).
10. **Other owned upload directories** removed; **all sessions** deleted.
11. After commit (outside the transaction): a queued `UserFederatedOptOut` event
    retracts the profile from federation partners, the user and their listings
    are removed from the Meilisearch index, and per-user Redis cache keys are
    purged. These external steps are all best-effort and non-blocking.

A `gdpr_audit_log` entry (`account_deleted`) is written and the
`gdpr.deletion.completed` metric incremented.

### Re-authentication requirement

Self-service deletion requires the member to re-enter their password. In
`UsersController::deleteAccount` (`DELETE /api/v2/users/me`):

- Empty password → `400 VALIDATION_ERROR`.
- The supplied password is checked with `password_verify()` against the
  tenant-scoped `users.password_hash`; mismatch → `403 INVALID_PASSWORD`.
- Only on success is `executeAccountDeletion()` called. The endpoint is rate
  limited (`delete_account`, 1 per 60s).
- A farewell email is sent to the captured original address, rendered in the
  member's pre-deletion `preferred_language` via `LocaleContext::withLocale`
  (the account is anonymised by send time, so the locale must be captured
  beforehand).

`GdprController::deleteAccount` (`POST /api/gdpr/delete-account`) also
re-verifies the password but does **not** purge immediately — it creates an
`erasure` request for admin fulfilment.

---

## Request lifecycle (admin-fulfilled requests)

`GdprService::createRequest()` stores a row in `gdpr_requests`. Valid types:
`access`, `erasure`, `rectification`, `restriction`, `portability`,
`objection`. A second pending/processing request of the same type for the same
user makes the service throw a `RuntimeException`. How that surfaces depends on
the caller: the `/api/v2/users/me/gdpr-request` (UsersController) path maps it to
`409 DUPLICATE_REQUEST`, whereas the `/api/gdpr/request` and
`/api/gdpr/delete-account` (GdprController) paths currently catch the broader
`\Exception` and return `500 REQUEST_FAILED` / `500 DELETE_FAILED` — so a
duplicate there surfaces as a generic 500 rather than a 409. (A small
consistency fix worth making later.)

```
createRequest()  → status 'pending'  (verification_token generated, audit logged)
processRequest() → status 'processing' (acknowledged_at set)
fulfilment       → status 'completed' (processed_at, processed_by set;
                                       export_file_path + 7-day expiry for exports)
                 → status 'rejected'  (admin decision)
```

There is **no automated processor** — fulfilment is a manual admin action in
the GDPR queue (`…/v2/admin/enterprise/gdpr/requests`). Requests can be
assigned to a specific admin (`assigned_to` column, added by
`database/migrations/2026_04_03_000001_add_assigned_to_gdpr_requests.php`).

---

## Overdue-request alarm

Because fulfilment is manual, a request nobody opens silently breaches the
GDPR Article 12(3) one-month response deadline. `OverdueGdprRequestCheck`
turns that DB state into a wired alarm.

- Command: `php artisan gdpr:check-overdue-requests`
- Options: `--days=25` (warn-threshold age before the deadline), `--max=100`.
- Statutory deadline constant: **30 days** (`STATUTORY_DEADLINE_DAYS`).
- Scans `gdpr_requests` for `pending`/`processing` rows older than the
  threshold; separately counts how many have already passed the 30-day
  deadline (accurate regardless of the `--max` sample cap).
- Returns a **non-zero exit** (`FAILURE`) when any overdue requests exist, and
  fans the alert out to log → Sentry → Slack. Each leg is guarded and
  non-fatal; it degrades to log-only when Sentry/Slack are unconfigured.
- It is **platform-wide (cross-tenant) by design** — an operator alarm, not a
  tenant-scoped query — and it never processes or modifies a request.
- Scheduled daily at 07:50 (`bootstrap/app.php`), `withoutOverlapping()` and
  `onOneServer()`.

---

## Consent records

Consent definitions are global (`consent_types`) with optional per-tenant
version/text overrides (`tenant_consent_overrides`). Per-user records live in
`user_consents`, keyed unique on `(user_id, tenant_id, consent_type)` and
upserted via `ON DUPLICATE KEY UPDATE`. Each record captures the consent text
hash, IP, user agent, source, and `given_at`/`withdrawn_at`.

`hasCurrentVersionConsent()` / `getOutdatedRequiredConsents()` resolve the
required version against a tenant override first, then the global default, so a
tenant can force re-consent independently. Updating the `marketing_email`
consent also syncs the newsletter subscription
(`UsersController::updateConsent`).

---

## Security & privacy invariants

- **Tenant scoping at construction.** `GdprService` captures `tenant_id` in its
  constructor. The container-injected instance can be resolved before the
  request tenant is guaranteed set, which would silently scope an erasure to
  the wrong tenant (a 0-row no-op). `UsersController::deleteAccount` therefore
  builds a fresh `new GdprService($tenantId)` with the explicitly resolved
  tenant rather than reusing the injected one. **Follow this pattern for any
  new caller of erasure/export.**
- **Re-authentication is mandatory** for self-service deletion (password
  re-verify, tenant-scoped, before any destructive work).
- **Every GDPR query is tenant-scoped** (`WHERE … AND tenant_id = ?`) except
  the cross-tenant operator alarm, which is intentionally platform-wide.
- **Uploaded files are erased, not just rows** — authored private message
  attachments and voice recordings, volunteer credentials, and job CVs are
  deleted from disk/storage as part of erasure. Shared canonical message-media
  files are preserved for another sender, and failed unlinks retain retry
  pointers. Legacy vetting evidence follows the DPO-authorised tombstone cleanup
  path described above; current insurance records have no document file.
- **Counterparty records are preserved** — messages, transactions, reviews, and
  two-party marketplace/exchange records are anonymised in place rather than
  deleted, so the other participant's history stays intact.
- **External cleanup is best-effort and post-commit** — Meilisearch removal,
  federation opt-out, and cache purge run after the transaction commits and
  must never roll back or block the erasure.
- **Retention exports expire** after 7 days and are pruned by
  `cleanupExpiredExports()` (Article 5(1)(e) storage limitation).

---

## Schema

GDPR tables are created by `migrations/2026_02_27_create_gdpr_tables.sql`:
`consent_types`, `tenant_consent_overrides`, `user_consents`, `gdpr_requests`,
`data_breach_log`, `gdpr_audit_log`. The `assigned_to` column on
`gdpr_requests` is added by
`database/migrations/2026_04_03_000001_add_assigned_to_gdpr_requests.php`.

Note: the legacy SQL file's header still points at the service's pre-migration
location under the old top-level source tree; the service now lives at
`app/Services/Enterprise/GdprService.php` after the Laravel migration (that old
top-level source tree has since been removed).

### Residual schema-drift caveats (documented in code)

`GdprService` carries extensive inline notes where its queries were corrected
against the real schema. These are worth knowing before editing export/erasure
queries, because they are easy to reintroduce:

- `listings` has `hours_estimate` and `view_count` — **not** `time_credits` /
  `views_count`.
- `messages` body column is `body`, not `content`.
- `transactions` parties are `sender_id` / `receiver_id`, not
  `from_user_id` / `to_user_id`.
- `events` has `start_date` + `start_time`/`end_time`, no `end_date`.
- `reviews` links to a `transaction_id`, not a `listing_id`.
- `vol_applications` uses `org_note` (no `reviewed_by`/`reviewed_at`);
  `vol_logs` approval is captured by `status`; `vol_expenses` uses
  `submitted_at` (no `created_at`).
- `connections` uses `requester_id` / `receiver_id`.

Several optional tables are wrapped in `try/catch` so erasure/export still run
on older deployments where they may be absent (AI chat, WebAuthn, cookie
consents, email log/suppression, courses, goals, stories, etc.).

---

## Tests & verification

```bash
# Service-level GDPR tests (request lifecycle, consent, type validation)
vendor/bin/phpunit tests/Laravel/Unit/Services/GdprServiceTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/Enterprise/GdprServiceTest.php

# Controller-level (auth gates, consent update, export request, delete auth)
vendor/bin/phpunit tests/Laravel/Feature/Controllers/GdprControllerTest.php

# Private message-media erasure, vetting erasure, and metadata-only insurance
vendor/bin/phpunit tests/Laravel/Integration/MessageErasureConcurrencyTest.php
vendor/bin/phpunit tests/Laravel/Feature/Gdpr/VettingAttestationGdprTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/UserInsuranceControllerTest.php
vendor/bin/phpunit tests/Laravel/Unit/Services/InsuranceCertificateServiceTest.php

# Overdue-request alarm (threshold, statutory-deadline count, healthy case)
vendor/bin/phpunit tests/Laravel/Feature/Console/OverdueGdprRequestAlertTest.php
```

Important regression coverage to keep green:

- `OverdueGdprRequestAlertTest::test_alerts_on_request_pending_past_threshold`
  and `…::test_reports_count_past_statutory_deadline` — the compliance alarm.
- `GdprControllerTest::test_delete_account_requires_auth` — deletion must never
  proceed without re-authentication.
- `GdprServiceTest::testCreateRequestThrowsWhenDuplicatePending` — duplicate
  request guard.

The overdue alarm can be run on demand to confirm wiring:

```bash
php artisan gdpr:check-overdue-requests --days=25
```

---

## Operational failure modes & recovery

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Erasure returns `500 DELETE_FAILED` | exception inside the transaction (it rolls back) | Check the `gdpr` log channel for the failing step; the user row is left intact — safe to retry. |
| Erasure scoped to 0 rows / no-op | wrong tenant captured at construction | Ensure callers build `new GdprService($tenantId)` with the resolved tenant (see invariants). |
| Overdue alarm fires but no Slack message | `SLACK_SLO_ALERTS_WEBHOOK` unset | Expected degraded mode — the alert is still logged and Sentry-captured; configure the webhook to restore Slack. |
| Backlog of old pending requests | no automated processor; admins not actioning the queue | Action requests manually in the admin GDPR queue; the alarm only surfaces them. |
| Export download fails (`EXPORT_FAILED`) | a section query threw during archive build | Check the `gdpr` log for the skipped section; `safeSection()` should isolate it — investigate the drifted table/column. |
| Stale export files on disk | expiry cleanup not running | Run `GdprService::cleanupExpiredExports()` (schedule/cron) to prune files past `export_expires_at`. |

---

## Related code

- `app/Services/Enterprise/GdprService.php` — export, erasure, consent, audit.
- `app/Services/MemberDataExportService.php` — self-service portability export.
- `app/Http/Controllers/Api/UsersController.php` — `deleteAccount`, consent,
  `createGdprRequest`, member proximity.
- `app/Http/Controllers/Api/GdprController.php` — consent, request, queued
  deletion.
- `app/Http/Controllers/Api/MemberDataExportController.php` — download/history.
- `app/Http/Controllers/Api/CoreController.php` — member directory listing.
- `app/Console/Commands/OverdueGdprRequestCheck.php` — compliance alarm.
- `routes/api.php` — endpoint definitions (source of truth for routes; do not
  duplicate the full table here).
