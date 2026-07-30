# Jobs / Hiring Module Guide

Last reviewed: 2026-07-30

How-to / reference guide for the Jobs (Hiring) module: posting vacancies, the application and hiring pipeline, interviews and offers, job alerts, syndication feeds, the hiring **bias / fairness audit**, and GDPR handling for applicant data. Verified against the live service layer (`app/Services/Job*`), `app/Listeners/NotifyJobAlertSubscribers.php`, and `routes/api.php`.

For applicant data subject rights at the account level (export and erasure across the whole platform), see [members-and-gdpr.md](members-and-gdpr.md). This guide covers only the job-specific slice.

---

## Audience and supported workflows

The module serves two roles. A single member can act as both — a job seeker on one vacancy and a hiring employer on another.

| Role | Who | Supported workflows |
| --- | --- | --- |
| **Job seeker** | Any member | Browse and search vacancies, view a match percentage, save jobs, apply (optionally with a CV upload), track applications, manage a saved candidate profile/CV, subscribe to job alerts, accept/decline interviews, accept/reject offers, export or erase their own job data (GDPR). |
| **Employer / poster** | The vacancy creator, plus added hiring-team members | Post and edit vacancies, review applicants, move applications through pipeline stages, propose interviews, send offers, score candidates (scorecards), run pipeline automation rules, export applicant CSVs, feature/renew postings. |

Tenant/platform admins have a moderation and analytics superset via `/v2/admin/jobs/*` (`AdminJobsController`): a moderation queue, spam stats, the bias audit, and platform-wide job stats.

## Tenant scoping and feature gate

- **Feature gate:** every member-facing endpoint calls `JobVacanciesController::ensureFeature()`, which returns `403 FEATURE_DISABLED` when `TenantContext::hasFeature('job_vacancies')` is false. `job_vacancies` defaults to **on** (`'job_vacancies' => true` in `app/Services/TenantFeatureConfig.php`), so the module is enabled unless a tenant turns it off. The public feed endpoints (`/v2/jobs/feed.*`) are syndication URLs and are not gated by the React route guard.
- **Per-tenant behaviour toggles:** `JobConfigurationService` stores `jobs.*` keys in `tenant_settings` (5-minute cache). These are *behaviour* flags layered on top of the feature gate — moderation on/off, CV upload, cover-message requirement, interview scheduling, offers, scorecards, pipeline rules, blind hiring, referrals, RSS feed, default currency, max postings per user, default deadline days, and per-tab visibility. Read `JobConfigurationService::DEFAULTS` for the authoritative key list and defaults.
- **Tenant scoping:** every query is scoped by `TenantContext::getId()`, either through the `tenant_id` column on the job models or explicit `AND tenant_id = ?` predicates in raw-SQL and reporting paths. Cross-table joins in the bias audit and GDPR services pin `j.tenant_id` so a join can never bridge two tenants.

## Key code locations

| Concern | Code |
| --- | --- |
| HTTP entry (member/employer) | `app/Http/Controllers/Api/JobVacanciesController.php` |
| HTTP entry (admin moderation/analytics) | `app/Http/Controllers/Api/AdminJobsController.php` |
| HTTP entry (public feeds) | `app/Http/Controllers/Api/JobFeedController.php` |
| Core vacancy/application service | `app/Services/JobVacancyService.php` (post, apply, status transitions, CSV export, history) |
| Per-tenant config | `app/Services/JobConfigurationService.php` |
| Moderation workflow | `app/Services/JobModerationService.php` |
| Spam scoring | `app/Services/JobSpamDetectionService.php` |
| Interviews | `app/Services/JobInterviewService.php`, `JobInterviewSchedulingService` |
| Offers | `app/Services/JobOfferService.php` |
| Scorecards | `app/Services/JobScorecardService.php` |
| Pipeline automation | `app/Services/JobPipelineRuleService.php` |
| Hiring team | `app/Services/JobTeamService.php` |
| Referrals | `app/Services/JobReferralService.php` |
| Saved candidate profile / CV | `app/Services/JobSavedProfileService.php` |
| Job alerts (email) | `app/Services/JobAlertEmailService.php` |
| Alert fan-out on new vacancy | `app/Listeners/NotifyJobAlertSubscribers.php` (on `App\Events\JobVacancyCreated`) |
| Expiry reminders | `app/Services/JobExpiryNotificationService.php` |
| Syndication feeds | `app/Services/JobFeedService.php` |
| **Bias / fairness audit** | `app/Services/JobBiasAuditService.php` |
| **GDPR (job slice)** | `app/Services/JobGdprService.php` |

**Tables:** `job_vacancies`, `job_vacancy_applications`, `job_application_history`, `job_interviews`, `job_offers`, `job_scorecards`, `job_alerts`, `job_referrals`, `job_saved_profiles`, `job_pipeline_rules`, `job_templates`, `job_vacancy_team`, `job_interview_slots`, `job_vacancy_views`. Notifications/emails additionally write `notifications` and `email_log`.

**Frontend entry points:** React jobs pages under `react-frontend/src/pages` and `react-frontend/src/admin` (hiring surfaces), plus the accessible GOV.UK track at `/{tenantSlug}/accessible/...` (parity tests `JobsParityTest`, `JobsBiasAuditParityTest`, `JobsCvUploadParityTest`, `JobsApplicationHistoryParityTest`).

**Routes / API contract:** the public syndication feeds `/v2/jobs/feed.*` are at `routes/api.php` lines 67–69, member routes `/v2/jobs/*` run from line 993 to 1097, and admin routes `/v2/admin/jobs/*` run 2625–2645. Refer to that file and the OpenAPI surface rather than copying the endpoint table here. **Only the three syndication feeds are anonymous** — and not via `withoutMiddleware`: they are registered outside the `auth:sanctum` group with throttle-only middleware. Every other jobs route, including `index`, `show` and `employerReviews`, requires `auth:sanctum`.

## Posting a vacancy

`JobVacancyService::create()` (via `POST /v2/jobs`) builds a `job_vacancies` row. The initial status depends on spam scoring and tenant moderation settings:

1. **Spam scoring** — when `jobs.spam_detection` is on (default), `JobSpamDetectionService::analyzeJob()` returns a `score`, `flags`, and `action` (`allow` / `flag` / `block`). The score and flags are stored on the vacancy.
2. **Status resolution:**
   - `block` → vacancy is forced to `status = closed`, `moderation_status = rejected`.
   - `flag`, **or** moderation enabled for the tenant (`JobModerationService::isModerationEnabled()`) → `status = draft`, `moderation_status = pending_review` (held out of public listings until an admin approves it).
   - Otherwise the requested status (typically `open`) is used with no moderation hold.
3. **Allowed job types** are gated per tenant: `jobs.allow_paid`, `jobs.allow_volunteer`, `jobs.allow_timebank`. Default currency falls back to `jobs.default_currency` (`EUR`).
4. **Alert fan-out** — on a successful create, `createVacancy()` dispatches `JobVacancyCreated`, which the queued `NotifyJobAlertSubscribers` listener consumes (see [Job alerts](#job-alerts-and-subscriptions)).

`isModerationEnabled()` checks the typed `jobs.moderation_enabled` key first and falls back to the legacy `jobs_require_moderation` tenant setting for older tenants.

## Application and hiring pipeline

### Applying

`POST /v2/jobs/{id}/apply` (`JobVacanciesController::apply` → `JobVacancyService::apply`) creates one `job_vacancy_applications` row:

- A member **cannot apply to their own vacancy** (`RESOURCE_FORBIDDEN`).
- The vacancy must be `open`, within its deadline, and `moderation_status` either null or `approved`, or the application is rejected (`VACANCY_CLOSED`).
- **Duplicate applications are blocked** under a `lockForUpdate()` row lock inside a DB transaction, so concurrent submits cannot create two rows; a repeat returns `409 RESOURCE_CONFLICT` (`job_already_applied`).
- A new application starts at `status = pending`, `stage = applied`, and an initial `job_application_history` row is written.
- **CV upload** (optional, gated by `jobs.enable_cv_upload`): only `pdf`/`doc`/`docx`, max 5 MB, with a strict extension-to-MIME whitelist that deliberately rejects `application/octet-stream` so a renamed executable cannot pass. Files are stored on the `local` disk under `job-applications/{tenantId}`. If the application is then rejected, the orphaned upload is best-effort deleted.
- A cover message can be made mandatory per tenant via `jobs.require_cover_message`.

### Pipeline stages

Applications move through stages tracked on the `stage`/`status` columns and mirrored into `job_application_history`. The valid status set in `JobVacancyService::updateApplicationStatus()` is:

```
applied · pending · screening · reviewed · shortlisted · interview · offer · accepted · rejected · withdrawn
```

The bias audit uses a narrower canonical funnel: `applied → screening → interview → offer → accepted`.

- Stage changes go through `PUT /v2/jobs/applications/{id}` (single) or `POST /v2/jobs/{id}/applications/bulk-status` (bulk).
- **Authorisation:** only the vacancy owner, a tenant admin, or an added hiring-team member can change a stage (`canManageVacancy`). The one exception is an applicant **withdrawing their own** application (`status = withdrawn`, no reviewer fields written).
- **Terminal-state guard:** once an application is `accepted`, `rejected`, or `withdrawn`, it cannot transition to a different status (`INVALID_TRANSITION`).
- Every transition writes a `job_application_history` row (from-status, to-status, actor, notes) and dispatches a `job.application.status_changed` webhook. The applicant is notified in their own language.

### Interviews and offers

- **Interviews** (`JobInterviewService`, `job_interviews`): only the **job poster** can `propose()` an interview, and only on applications that are not `withdrawn`/`rejected`. Only the **applicant** can `accept()`/`decline()` a `proposed` interview; only the poster can `cancel()`. Reminder emails fire at 24-hour and 1-hour windows via `sendReminders()` (Laravel scheduler), each with its own sent-marker column (`reminder_24h_sent_at` / `reminder_1h_sent_at`) and a cache lock so a reminder is sent exactly once.
- **Offers** (`JobOfferService`, `job_offers`): gated by `jobs.enable_offers`. The employer creates an offer on an application; the candidate accepts or rejects; the employer can withdraw.
- **Scorecards** (`JobScorecardService`, `job_scorecards`): gated by `jobs.enable_scorecards`. Structured per-candidate assessments visible to the hiring team.
- **Pipeline rules** (`JobPipelineRuleService`, `job_pipeline_rules`): gated by `jobs.enable_pipeline_rules`. Per-vacancy automation that can move applications between stages.

## Job alerts and subscriptions

Members subscribe to alerts via `POST /v2/jobs/alerts` (`job_alerts` rows: keywords, type, commitment, location, remote-only, `is_active`).

When a vacancy is created, the queued `NotifyJobAlertSubscribers` listener loads active alerts for the tenant and notifies subscribers whose criteria match the vacancy. `matchesAlert()` checks, in order: keyword substring against title/description, exact `type`, exact `commitment`, location substring, and remote-only. An empty alert field means "any".

The listener is hardened against the email-bombing regression class:

- `tries = 1`, `timeout = 60s` — it fails fast rather than letting Redis re-deliver a long fan-out mid-flight.
- A vacancy-level `Cache::add()` claim plus a `done` marker means one vacancy produces exactly one fan-out.
- A per-recipient `sent` marker (`(tenant, vacancy, alert)`) means each subscriber is notified at most once even if a duplicate delivery slips past the vacancy-level claim.
- Bell, push, and email all render in each subscriber's `preferred_language` via `LocaleContext::withLocale()`. The alert is only marked `last_notified_at` when the email actually sends.

Subscribers can unsubscribe/resubscribe (`PUT /v2/jobs/alerts/{id}/unsubscribe|resubscribe`) or delete an alert.

## Bias / fairness audit

`JobBiasAuditService::generateReport($tenantId, $jobId?, $dateFrom?, $dateTo?)` produces a tenant-scoped hiring-fairness report, served to admins via `GET /v2/admin/jobs/bias-audit`. The default window is the last 12 months.

**Design principle:** the audit measures **process metrics**, not protected demographic attributes. It looks for patterns in *how the funnel behaves* (where candidates drop out, how long stages take, which sources convert) that could indicate bias, without collecting or grouping by race, gender, or other protected characteristics. The canonical pipeline order is `applied → screening → interview → offer → accepted`.

The report returns:

| Metric | Meaning |
| --- | --- |
| `total_applications` | Count of applications created in the window. |
| `funnel` | Count of applications that reached each stage. Stage attainment is reconstructed from current status **and** `job_application_history`, so candidates rejected at a later stage still count as having reached the earlier ones. |
| `rejection_rates` | Per stage: number rejected *from* that stage, the number that entered it, and the rejection rate %. Computed from `job_application_history` `from_status → 'rejected'` transitions. |
| `avg_time_in_stage` | Average days between entering and leaving each stage (from history timestamps). |
| `skills_match_correlation` | Ratio of accepted vs rejected outcomes — a rough check of whether outcomes track skills match. |
| `source_effectiveness` | Acceptance rate for `direct` vs `referral` applications (referral data drawn from `job_referrals` when present). |
| `hiring_velocity_days` | Average time-to-fill: days from vacancy creation to an accepted application. |

The admin endpoint is rate-limited (`jobs_bias_audit`, 10/min) to prevent rapid enumeration of aggregate hiring patterns.

## CSV exports

`GET /v2/jobs/{id}/applications/export-csv` (`JobVacancyService::exportApplicationsCsv`) returns a CSV of all applications for one vacancy.

- **Authorisation:** only someone who can manage the vacancy (owner, admin, or hiring-team member) — `canManageVacancy`. Others get `403`.
- Columns: ID, Name, Email, Status, Stage, Applied At, Updated At.
- **CSV injection is prevented:** any field starting with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with a single quote so spreadsheet apps treat it as text, not a formula.

## GDPR handling for applicant data

`JobGdprService` implements the job-specific slice of data subject rights. It is invoked from `GET /v2/jobs/gdpr-export` and `DELETE /v2/jobs/gdpr-erase-me` (both operate on the authenticated user only). For the platform-wide member export/erasure path that this plugs into, see [members-and-gdpr.md](members-and-gdpr.md).

- **Export** (`exportUserData`) returns the user's applications, interviews, offers, alerts, and saved profile as a structured array, tenant-scoped.
- **Erasure** (`eraseUserData`) anonymises rather than hard-deletes, preserving aggregate hiring structure while removing PII, inside a single DB transaction:
  - Applications: clears `message`, `reviewer_notes`, `cv_path`, `cv_filename`, `cv_size`.
  - Interviews: clears `candidate_notes`, `interviewer_notes`, `location_notes` (the latter can hold a home address).
  - Offers: clears whichever free-text column exists (`message` legacy / `details` current).
  - Scorecards: clears `notes`, resets `criteria` to `[]` (it is NOT NULL with a JSON CHECK constraint).
  - History: clears `notes` and `changed_by`.
  - Referrals: de-links the user as `referred_user_id` (set null).
  - View history (`job_vacancy_views`): de-links `user_id` (anonymous counts remain).
  - Alerts and saved profile rows are deleted.
  - CV files on disk are then best-effort deleted; an individual file failure is logged and only downgrades the return value (the committed DB erasure is never rolled back for a file error).

## Security and privacy invariants

- A member cannot apply to their own vacancy; only the poster proposes interviews; only the applicant accepts/declines them.
- **CV access** (`downloadCv`): only the applicant, the job poster, or an admin may download a CV. When **blind hiring** is enabled on the vacancy, even the poster cannot download the CV (only the applicant can).
- Application stage changes and CSV export require `canManageVacancy` (owner/admin/hiring-team); applicants may only withdraw their own application.
- Terminal application states (`accepted`/`rejected`/`withdrawn`) are not reversible to a different status.
- CV uploads enforce an extension-to-MIME whitelist and reject `application/octet-stream`; stored filenames are sanitised against path traversal.
- The bias audit reports process metrics only, never protected demographic attributes, and is rate-limited.
- All applicant/poster notifications and emails render in the **recipient's** `preferred_language` via `LocaleContext::withLocale()`.
- Alert fan-out is idempotent at vacancy and per-recipient level (regression guard against the email-bombing class).
- CSV output is hardened against formula injection.
- Every query is tenant-scoped; reporting joins pin `tenant_id` so a join cannot cross tenants.

## Syndication feeds

`JobFeedService` (public, served by `JobFeedController`) generates feeds of open, approved, non-expired vacancies — the 100 most recent — cached for 15 minutes:

- `GET /v2/jobs/feed.xml` — RSS 2.0.
- `GET /v2/jobs/feed.json` — Schema.org `JobPosting` JSON (Google Jobs structured data).
- `GET /v2/jobs/feed/indeed.xml` — Indeed XML.

The feed query (`getOpenJobs`) returns only `status = open`, `deadline` null-or-future, and `moderation_status` null-or-`approved`, so vacancies held for moderation or rejected never syndicate. Feeds are throttled to 30/min and can be disabled per tenant via `jobs.enable_rss_feed`.

## Failure modes and recovery

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| All job endpoints return `403 FEATURE_DISABLED` | `job_vacancies` feature off for the tenant. | Re-enable the feature in tenant settings. |
| New vacancy is not publicly visible | Spam `flag`, or tenant moderation on → held as `draft` / `pending_review`. | Approve it in the admin moderation queue (`POST` approve via `AdminJobsController`). |
| New vacancy auto-closed on creation | Spam scoring returned `block` → `status = closed`, `moderation_status = rejected`. | Review `spam_score`/`spam_flags`; re-post legitimate content or relax `jobs.spam_detection`. |
| Applicant gets `409` when applying again | Duplicate-application idempotency. | Expected — one application per member per vacancy. |
| CV upload rejected | Wrong extension/MIME, over 5 MB, or `jobs.enable_cv_upload` off. | Re-upload a valid PDF/DOC/DOCX, or enable CV upload for the tenant. |
| Stage change returns `INVALID_TRANSITION` | Application is in a terminal state. | Expected — terminal states are final. |
| Stage change returns `403` | Caller is not owner/admin/hiring-team. | Add them to the hiring team or act as the owner. |
| Poster cannot download a CV | Blind hiring is enabled on the vacancy. | Expected by design — disable `jobs.enable_blind_hiring`/the per-vacancy flag if not desired. |
| Subscribers got no alert email / a duplicate | Idempotency markers (vacancy claim or per-recipient `sent`), or the email send returned false. | Check logs for `NotifyJobAlertSubscribers`; the alert is only marked notified on a successful send. |
| Interview reminder not sent | Email send failed, so the window marker was deliberately not set. | The scheduler retries on the next run; check `JobInterviewService::sendReminders` logs. |
| Feed shows stale vacancies | 15-minute feed cache. | Wait for the TTL or clear the `job_feed_*` cache keys. |

## Tests and verification

Run the job suites (sequentially — never run multiple heavy suites at once):

```bash
vendor/bin/phpunit --filter Job --colors=always
vendor/bin/phpunit tests/Laravel/Feature/GovukAlpha --filter Jobs --colors=always
```

Important regression tests:

- `tests/Laravel/Feature/Controllers/JobVacanciesControllerTest.php` — apply, pipeline, CV upload, CSV export, authorisation.
- `tests/Laravel/Feature/Controllers/AdminJobsControllerTest.php` — moderation queue, stats, bias audit endpoint.
- `tests/Laravel/Unit/Services/JobBiasAuditServiceTest.php` — funnel, rejection rates, time-in-stage, source effectiveness, velocity.
- `tests/Laravel/Unit/Services/JobGdprServiceTest.php` — export shape and erasure anonymisation/file cleanup.
- `tests/Laravel/Unit/Services/JobModerationServiceTest.php` — approve/reject/flag and recipient-locale notifications.
- `tests/Laravel/Unit/Services/JobInterviewServiceTest.php` — propose/accept/decline/cancel authorisation and reminder windows.
- `tests/Laravel/Unit/Services/JobConfigurationServiceTest.php` — typed config get/set/defaults.
- `tests/Laravel/Integration/JobEmailReliabilityTest.php` — recipient-locale job email rendering.
- `tests/Laravel/Feature/GovukAlpha/JobsBiasAuditParityTest.php`, `JobsCvUploadParityTest.php`, `JobsApplicationHistoryParityTest.php` — accessible-frontend parity.

After any schema change, run PHPStan and refresh the schema dump per the project deploy rules.
