# Goals & Impact (incl. SROI) Module

Audience: maintainers and contributors working on member goals, community impact metrics, or Social Return on Investment (SROI) reporting.

Last reviewed: 2026-07-14

This guide covers two related surfaces:

- **Goals** — member-owned personal goals with progress, check-ins, milestones, templates, and accountability buddies.
- **Impact and SROI** — admin-only community impact metrics and SROI reporting derived from real exchanged service hours.

The two are documented together because impact reporting is the analytics layer above the same community activity that goals participate in, but they are separate feature surfaces with different gating (see below).

## Supported workflows

**Goals (member-facing):**

- Create, edit, and delete a personal goal with a numeric target and optional deadline.
- Track progress by incrementing a value or by recording a percentage check-in (with optional note and mood).
- Automatic milestones at 25 / 50 / 75 / 100 percent, plus milestone congratulation emails.
- Start a goal from a public template, or list/create templates.
- Make a goal public so others can offer to be an accountability buddy (mentor); buddies can send nudges/encouragement notes.
- Check-in streak tracking and per-goal reminders.

**Impact and SROI (admin-facing):**

- View community health metrics (active traders, retention, reciprocity, activation, network density).
- View a monthly impact timeline (hours exchanged, transactions, new members).
- Calculate SROI: monetised value of exchanged service hours, and a methodology-correct SROI projection ratio against a configured investment.

## Feature gate and tenant scoping

| Surface | Gate | Where enforced |
|---------|------|----------------|
| Goals UI | `goals` feature flag | React `FeatureGate feature="goals"` in `react-frontend/src/routes/AppRoutes.tsx`; menu entry gated by `'feature' => 'goals'` in `app/Core/MenuManager.php`. |
| Goals API | none separately | `/v2/goals/*` routes inherit `auth:sanctum`. Enforcement is at the route level in the app, not per-endpoint. |
| Impact / SROI | admin only | `auth:sanctum` + `admin` middleware on the admin report routes. There is no separate tenant feature flag for impact reporting. |

All goal queries are tenant-scoped automatically through the `HasTenantScope` global scope on the `Goal` model. Impact and SROI services scope every query explicitly with `TenantContext::getId()` (or take an explicit `$tenantId`). Goal ownership is additionally checked: update, delete, progress, and complete operations verify `goal->user_id === userId` before mutating, returning `null`/`false` on mismatch.

## Goals

### Key code

| Concern | Location |
|---------|----------|
| Controller | `app/Http/Controllers/Api/GoalsController.php` |
| Goal CRUD, progress, complete, buddy | `app/Services/GoalService.php` |
| Progress history, milestones, insights | `app/Services/GoalProgressService.php` |
| Check-ins (progress + streaks) | `app/Services/GoalCheckinService.php` |
| Templates | `app/Services/GoalTemplateService.php` |
| Milestone emails (25/50/75/100%) | `app/Services/GoalMilestoneEmailService.php` |
| Reminders | `app/Services/GoalReminderService.php` |
| Models | `app/Models/Goal.php`, `GoalCheckin`, `GoalTemplate` |
| Admin moderation | `app/Http/Controllers/Api/AdminGoalsController.php` |
| Frontend | `react-frontend/src/pages/goals/` |

### Tables

- `goals` — owner (`user_id`), `mentor_id` (buddy), `title`, `description`, `deadline`, `is_public`, `status`, `target_value`, `current_value`, `checkin_frequency`, `last_checkin_at`, `streak_count`, `best_streak_count`, `completed_at`, `template_id`.
- `goal_checkins` — per check-in `progress_percent`, `note`, `mood`.
- `goal_milestones` — `target_percent` / `target_value`, `sort_order`, `completed_at`.
- `goal_progress_history` — append-only event log (`created`, `progress_update`, `checkin`, `milestone`, `completed`, `buddy_joined`, `buddy_action`).
- `goal_templates`, `goal_buddy_notes`, and an optional legacy `goal_progress_log` (written only when present).

Some tables are written behind `Schema::hasTable(...)` / `hasColumn(...)` guards, so missing optional tables/columns degrade gracefully instead of erroring.

### Endpoints

Goal endpoints are defined in `routes/api.php` (`/v2/goals*`) and served by `GoalsController`. See the route file and `openapi.json` for the canonical contract; the table below is an orientation map, not a copy of the API reference.

| Area | Endpoints |
|------|-----------|
| List / create | `GET,POST /v2/goals` (`GET` defaults `user_id` to the caller and returns their own public and private goals) |
| Discovery / mentoring | `GET /v2/goals/discover` (public, buddy-able), `GET /v2/goals/mentoring` |
| Templates | `GET /v2/goals/templates`, `GET .../templates/categories`, `POST /v2/goals/templates`, `POST /v2/goals/from-template/{templateId}` |
| Single goal | `GET,PUT,DELETE /v2/goals/{id}` |
| Progress / complete | `POST /v2/goals/{id}/progress`, `POST /v2/goals/{id}/complete` |
| Buddy | `POST /v2/goals/{id}/buddy`, `POST /v2/goals/{id}/buddy/nudge` |
| Check-ins | `GET,POST /v2/goals/{id}/checkins` |
| History / insights | `GET /v2/goals/{id}/history`, `.../history/summary`, `.../insights` |
| Reminders | `GET,PUT,DELETE /v2/goals/{id}/reminder` |
| Admin | `GET /v2/admin/goals`, `GET,DELETE /v2/admin/goals/{id}` |

### Public vs private

- A goal is public when `is_public = true`. The list endpoint defaults to the caller's own goals, including private ones. Supplying another member's `user_id` forces the result to public goals only. Single-goal reads allow the owner, assigned buddy, or any authenticated member when the goal is public; other private reads return 403.
- Discovery (`getPublicForBuddy`) returns public, `active` goals without an existing mentor and excludes the requester. The buddy-write service itself checks public/no-mentor/not-self but does not independently require `status = active`, so callers must not treat discovery filtering as a write-side invariant.
- Feed activity is recorded only for public goals.

### Progress, check-ins, and milestones

- `incrementProgress` adds to `current_value`; reaching `target_value` flips `status` to `completed`. Each update writes `goal_progress_history` and syncs milestones.
- Check-ins (`GoalCheckinService::create`) run inside a DB transaction. A percentage check-in derives `current_value` from `target_value`; 100% completes the goal. Streaks increment when the previous check-in falls inside the frequency window (`daily`/`weekly`/`biweekly`/`monthly`), otherwise reset to 1; `best_streak_count` is retained.
- Milestones are seeded at create time (25/50/75/100% by default, or a template's `default_milestones`) and marked complete when progress crosses their threshold.
- Milestone emails fire on the first newly-crossed threshold per update and use a permanent `Cache::forever` dedup key per `(tenant, user, goal, milestone)`, so they never re-send even if progress regresses and recovers. All goal emails render in the recipient's `preferred_language` via `LocaleContext::withLocale(...)`.

## Impact and SROI

There are **two** SROI surfaces. They use the same exclusion rules but differ in scope and methodology:

| Service | Endpoint | Scope | Output |
|---------|----------|-------|--------|
| `app/Services/ImpactReportingService.php` | `GET /v2/admin/impact-report` | Trailing N months (default 12) | SROI summary, community health metrics, monthly timeline. Config (hourly value, multiplier) stored in `tenants.configuration.settings`. |
| `app/Services/SocialValueService.php` | `GET /v2/admin/reports/social-value` | Arbitrary date range | Full social-value report plus a methodology-correct SROI projection. Config stored in the `social_value_config` and `social_value_outcomes` tables. |

`ImpactReportingService` is served by `AdminImpactReportController`; `SocialValueService` is served by `AdminAnalyticsReportsController` (`socialValue` / `updateSocialValueConfig`). Both require admin auth.

### Community health metrics

`ImpactReportingService::getCommunityHealthMetrics()` returns, per tenant: total/active(90d)/new(30d) users, active traders (30d), engagement rate, retention rate, **reciprocity score** (1 − average give/receive imbalance), **activation rate** (new members who traded within 30 days), and **network density** (accepted connections over possible pairs). Trading-based metrics use only completed service exchanges.

### What counts as an exchanged hour (CRITICAL)

> This module's SROI engine was audited and corrected in June 2026. Earlier versions wrongly counted credit issuance and gifts as exchanged service hours, inflating the impact claim. The current engine **must not** count those. The behaviour below is the correct, current behaviour and replaces any archived report that says otherwise.

Both SROI surfaces aggregate hours from the `transactions` table where `status = 'completed'`, and **exclude** these `transaction_type` values, defined once as `SocialValueService::EXCLUDED_TRANSACTION_TYPES`:

| Excluded type | Why |
|---------------|-----|
| `starting_balance` | System-issued opening credit, not a person-to-person service. |
| `admin_grant` | Administrative credit issuance. |
| `community_fund` | System fund movement, not an exchanged service hour. |
| `donation` | Member-to-member credit gift, not a service rendered. |

Everything else (transfer, exchange, federation, volunteer, `job_completion`, …) represents real exchanged hours and is counted. In `transactions`, `amount` is the hours value in this timebank. The same exclusion is applied consistently across hour totals, active-trader counts, reciprocity, activation, category breakdowns, and the monthly timeline. The shared SQL fragment is `SocialValueService::transactionTypeExclusionSql()`; `ImpactReportingService` reuses `EXCLUDED_TRANSACTION_TYPES` via `whereNotIn(...)`.

### How SROI is calculated

There are two distinct calculations. Do not conflate them.

**1. Direct monetisation (both services).** A simple monetary valuation of exchanged hours:

```
exchanged_hours = SUM(transactions.amount)         -- completed, excluded types removed
direct_value    = exchanged_hours × hour_value
social_value    = direct_value × social_multiplier
```

In `ImpactReportingService` the reported `sroi_ratio` is just `social_value / monetary_value`, which equals the configured multiplier when value > 0 (defaults: hour value 15.00, multiplier 3.5). This is a headline "value of hours" figure, **not** a counterfactual-adjusted SROI ratio.

**2. Methodology-correct SROI projection (`SocialValueService` only).** This follows the Social Value International model (as applied in the 2023 Timebank Ireland study). It is computed by the pure function `SocialValueService::computeSroiProjection($config, $outcomes)` over admin-defined **outcomes** (each a stakeholder `quantity` × financial `proxy_value`), not over transaction hours:

```
gross           = Σ (quantity × proxy_value)                         over outcome categories
year-1 net      = gross × (1 − deadweight) × (1 − displacement) × (1 − attribution)
year-n retained = year-1 net × (1 − dropoff)^(n−1)
year-n PV       = retained / (1 + discount)^(n−1)                    (year 1 undiscounted)
TPV             = Σ yearly present values
sroi_ratio      = TPV / investment_amount                           (null when no investment set)
```

Default coefficients (`social_value_config`, overridable per tenant): deadweight 10%, displacement 10%, attribution 10%, drop-off 70%, discount rate 3.5%, projection 2 years, hour value 15.00 GBP, multiplier 3.5. Every coefficient used is echoed back in the result (`coefficients`) for auditability. The ratio is `null` (and `is_configured = false`) until an `investment_amount` and at least one outcome with positive gross are set, so an unconfigured tenant never reports a misleading ratio.

The direct-monetisation summary and the projection are returned side by side in the `social-value` report so callers can show both the value of exchanged hours and the formal SROI ratio.

## Security and privacy invariants

- Goals: ownership is enforced on every mutation (`user_id` match); cross-user edits/deletes return null/false. Tenant isolation is automatic via `HasTenantScope`.
- Private goals are excluded from public listing, discovery, buddy eligibility, and feed activity.
- Buddy offers and buddy notes pass through `SafeguardingInteractionPolicy`; blocked or otherwise disallowed contact is rejected.
- A successful buddy offer embeds the goal owner and buddy through `User::PUBLIC_IDENTITY_COLUMNS` only. Goal responses may include public identity fields needed for names and avatars, but never contact details, date of birth, precise location, login/account metadata, privacy settings, or payment-provider identifiers.
- Buddy notes are constrained: only the assigned `mentor_id` may post, and `type` is whitelisted (`nudge`, `encouragement`, `offer_help`, `celebration`, `note`).
- Impact/SROI endpoints call `requireAdmin()` and scope every query by tenant. The SROI calculations expose only aggregates, never per-member transaction rows.
- SROI input validation (in `AdminAnalyticsReportsController::updateSocialValueConfig`) bounds hour value (0–10000), multiplier (0–100), percentages (0–100), discount rate (0–20), projection years (1–10), investment (0–100,000,000), reporting period (`monthly`/`quarterly`/`annually`), and outcomes (≤ 25, numeric non-negative quantity/proxy).
- All user-facing goal strings use translation keys (`api_controllers_3.goals.*`, `emails_goals.*`); do not introduce hardcoded English.

## Operational failure modes and recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| Optional goal table/column missing (`goal_milestones`, `goal_buddy_notes`, `goal_progress_log`, `streak_count`) | Writes are guarded by `Schema::hasTable`/`hasColumn` and no-op silently | Run pending migrations; functionality returns without code changes. |
| Goal email send fails (created/completed/abandoned/milestone) | Caught and logged as a warning; the API request still succeeds | Check mail transport/logs; the goal mutation itself is unaffected. |
| Milestone email appears not to send | Permanent dedup cache key already set for that `(tenant, user, goal, milestone)` | Expected once a milestone has fired; clear the specific cache key only if a genuine resend is required. |
| SROI ratio shows as null / "not configured" | No `investment_amount` set, or no outcomes with positive gross | Configure investment and outcomes via `PUT /v2/admin/reports/social-value/config`. |
| SROI/impact totals look inflated | Indicates excluded types are being counted (a regression of the June 2026 fix) | Verify `EXCLUDED_TRANSACTION_TYPES` is applied in the failing query path; run the regression tests below. |

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --testsuite=Laravel --filter=SocialValueService
vendor/bin/phpunit --testsuite=Laravel --filter=ImpactReportingService
vendor/bin/phpunit --testsuite=Laravel --filter=Goal
```

Important regression tests:

- `tests/Laravel/Unit/Services/SocialValueServiceTest.php` — `test_excluded_transaction_types_cover_system_issuance` locks the exclusion of `starting_balance`, `admin_grant`, `community_fund`, and `donation`, and asserts the exclusion SQL fragment. Other cases verify the `computeSroiProjection` arithmetic (deductions, drop-off, discounting, ratio).
- `tests/Laravel/Unit/Services/ImpactReportingServiceTest.php` — covers the trailing-window SROI summary and health metrics.
- `tests/Laravel/Unit/Services/GoalServiceTest.php`, `GoalCheckinServiceTest.php`, `GoalProgressServiceTest.php`, `GoalTemplateServiceTest.php`, `GoalReminderServiceTest.php` — goal CRUD, ownership, check-in/streak, milestone, template, and reminder behaviour.
- `tests/Laravel/Feature/Controllers/GoalsControllerTest.php`, `AdminGoalsControllerTest.php`, `AdminImpactReportControllerTest.php` — endpoint-level coverage.
- `tests/Laravel/Feature/GovukAlpha/GoalsParityTest.php`, `GoalsHistoryParityTest.php` — accessible-frontend parity.

## Related code

- API contract: `routes/api.php` (`/v2/goals*`, `/v2/admin/impact-report`, `/v2/admin/reports/social-value`) and `openapi.json`.
- Architecture context: [../ARCHITECTURE.md](../ARCHITECTURE.md).
- Module map: [../MODULES.md](../MODULES.md).
