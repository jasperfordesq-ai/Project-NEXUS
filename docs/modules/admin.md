# Admin Module

Last reviewed: 2026-07-30

This guide covers the tenant admin panel and the platform super-admin surface: who can access each tier, how server-side enforcement works, what the audit trail captures, and where the code lives.

---

## Audience and supported workflows

**Tenant admins** — manage one timebank community: approve and suspend members, manage listings, configure modules and features, run newsletters, export audit logs, and configure the tenant. Content moderation and safeguarding are no longer admin-panel surfaces (they moved to the broker panel on 2026-07-02), and federation partnership management is super-admin only — see "Retired from the admin panel" below.

**Platform super-admins** — manage the platform itself: create and delete tenants, move users between tenants, grant or revoke super-admin rights, control the federation whitelist, view cross-tenant billing, and review provisioning requests.

**Brokers / coordinators** — a narrower operational role with read access to member and listing lists, moderation queues, safeguarding, vetting, and insurance workflows. They use a separate Broker Control Panel at `/{tenant}/broker` (not `/{tenant}/admin`). A subset of admin endpoints accepts the `broker-or-admin` middleware for this overlap.

---

## Frontend entry point

The React admin SPA lives at `/{tenantSlug}/admin` and is rendered by `AdminApp.tsx`.

| File | Purpose |
| --- | --- |
| `react-frontend/src/admin/AdminApp.tsx` | Root component; wraps in `AdminLayout` |
| `react-frontend/src/admin/AdminLayout.tsx` | Shell — sidebar navigation and header |
| `react-frontend/src/admin/AdminRoute.tsx` | Client-side route guard (redirects non-admins to `/dashboard`) |
| `react-frontend/src/admin/SuperAdminRoute.tsx` | Client-side guard for super-admin-only child routes |
| `react-frontend/src/admin/routes.tsx` | Full route map (lazy-loaded; see below) |
| `react-frontend/src/lib/access.ts` | Canonical tenant-admin, tenant-super-admin, and platform-super-admin predicates |

`AdminRoute` uses `hasAdminPanelAccess(user)` from `react-frontend/src/lib/access.ts`, which mirrors the server-side check: it returns `true` if `user.role` is `admin`, `tenant_admin`, or `super_admin`, or if any of the boolean flags `is_admin`, `is_super_admin`, `is_tenant_super_admin`, or `is_god` is `true`. If the user's role is `broker`, access is unconditionally denied regardless of other flags.

`SuperAdminRoute` uses `isPlatformSuperAdminUser(user)`: it allows `role=super_admin`, `role=god`, `is_super_admin=true`, or `is_god=true`, and deliberately rejects `is_tenant_super_admin=true`. The admin sidebar uses the same predicate before showing the platform panel link. These client checks are defence-in-depth only; every sensitive endpoint is independently enforced server-side.

Feature-gated admin sections redirect to `/admin/not-found` when the tenant feature is off, using `FeatureGatedElement` inside `routes.tsx`. The complete set of gated features is `volunteering` (13 routes), `member_premium` (2), `caring_community` (1), `podcasts` (1), and `newsletter` (one layout wrapper around `<Outlet />` at `routes.tsx:408-430` that gates 17 child routes). Federation and the partner API are not gated this way because they no longer exist in the admin panel at all.

---

## Permission model

### Role and flag columns (table `users`)

| Column | Type | Purpose |
| --- | --- | --- |
| `role` | `varchar(50)` default `'member'` | String role. Admin-granting values: `admin`, `tenant_admin`, `super_admin`, `god` |
| `is_admin` | `tinyint(1)` | Legacy boolean flag; deprecated in favour of `role` but still accepted |
| `is_super_admin` | `tinyint(1)` | Platform-level super-admin flag |
| `is_tenant_super_admin` | `tinyint(1)` | Scoped to the user's own tenant subtree |
| `is_god` | `tinyint(1)` | Full platform access including super-admin grant/revoke |

### Middleware aliases (`bootstrap/app.php`)

| Alias | Class | Accepts |
| --- | --- | --- |
| `admin` | `EnsureIsAdmin` | `is_admin`, `is_super_admin`, `is_tenant_super_admin`, `is_god`; roles `admin`, `tenant_admin`, `super_admin`. Explicitly rejects `role=broker`. |
| `super-admin` | `EnsureIsSuperAdmin` | `is_super_admin`, `is_god`; roles `super_admin`, `god`. **Does not accept** `is_tenant_super_admin`. |
| `broker-or-admin` | `EnsureIsBrokerOrAdmin` | All of the above plus `role=broker` and `role=coordinator`. |

The critical distinction: `EnsureIsSuperAdmin` deliberately rejects `is_tenant_super_admin`. This prevents a compromised tenant-admin account from escalating to cross-tenant platform controls.

### Route groups in `routes/api.php`

```
Route::middleware(['auth:sanctum', 'admin'])->group(...)       # /v2/admin/* — tenant admin endpoints
Route::middleware(['auth:sanctum', 'super-admin'])->group(...) # /v2/admin/super/* — platform super-admin
Route::middleware(['auth:sanctum', 'super-admin'])->prefix('super-admin/regional-analytics')->group(...)
```

Select user-management and listing endpoints use `withoutMiddleware('admin')->middleware('broker-or-admin')` to allow brokers read-only or moderation access while keeping the parent group admin-only.

### Controller-level defence in depth

Every controller method that performs a state-changing operation calls one of three protected **throwing guards** from `BaseApiController` as a second layer of authorisation:

- `requireAdmin()` — mirrors `EnsureIsAdmin`; throws 403 if not admin.
- `requireSuperAdmin()` — accepts both platform super-admins and tenant super-admins. Used for within-tenant elevated operations.
- `requirePlatformSuperAdmin()` — explicitly rejects `is_tenant_super_admin`; used for cross-tenant operations such as tenant CRUD, federation whitelist, and cross-tenant user moves.

Alongside those three, `BaseApiController` also exposes one **non-throwing predicate**:

- `isPlatformSuperAdmin()` — returns a bool; used to branch between tenant-scoped and cross-tenant views without returning 403.

**Every query that touches tenant data must be scoped by `tenant_id`.** Use `$this->getTenantId()` (which reads `TenantContext::getId()`) and include `AND tenant_id = ?` in every WHERE clause. See `AGENTS.md` for the mandatory pattern.

### Settings with elevated guards

In `AdminConfigController`, certain settings keys have additional server-side checks beyond the `admin` middleware:

- `maintenance_mode` — only a platform super-admin or tenant super-admin may write this. Regular delegated admins receive 403. (SEC-003.)
- `email_verification`, `admin_approval` — only a platform super-admin may write these (`PLATFORM_SUPER_ADMIN_ONLY_KEYS`).

---

## Tenant features and module configuration

Features and core modules are controlled per-tenant through `AdminConfigController`:

- `PUT /v2/admin/config/features` — toggle optional features (`events`, `groups`, `gamification`, `federation`, etc.). Writes to `tenants.features` (JSON column). Validated against `TenantFeatureConfig::FEATURE_DEFAULTS`.
- `PUT /v2/admin/config/modules` — toggle core modules (`listings`, `wallet`, `messages`, `feed`, etc.). Writes to `tenants.configuration.modules` (JSON). Validated against `TenantFeatureConfig::MODULE_DEFAULTS`.

After any write, the tenant bootstrap cache key in Redis is cleared so the next request picks up the new state.

Key files:

| File | Purpose |
| --- | --- |
| `app/Services/TenantFeatureConfig.php` | `FEATURE_DEFAULTS` and `MODULE_DEFAULTS` constants; `mergeFeatures()` |
| `app/Services/TenantSettingsService.php` | Read/write `tenant_settings` key-value table; Redis caching |
| `react-frontend/src/admin/modules/config/ModuleConfiguration.tsx` | Admin UI for features and modules |

The React frontend uses `useTenant().hasFeature()` and `useTenant().hasModule()` — which consume the `tenants.features` and `tenants.configuration` values from the bootstrap API — to gate components and routes.

---

## Admin sections and key controllers

The route map in `react-frontend/src/admin/routes.tsx` defines all admin pages. Key groups:

| Section | React path | Primary API controller |
| --- | --- | --- |
| Dashboard | `/admin` | `AdminDashboardController` |
| Users | `/admin/users` | `AdminUsersController` |
| CRM | `/admin/crm` | `AdminCrmController` |
| Listings | `/admin/listings` | `AdminListingsController` |
| Module configuration | `/admin/module-configuration` | `AdminConfigController` |
| Timebanking / wallet | `/admin/timebanking` | `AdminTimebankingController`, `AdminWalletGrantController` |
| Gamification | `/admin/gamification` | `AdminGamificationController` |
| Smart matching | `/admin/smart-matching` | `AdminMatchingController` |
| Content (blog, pages, menus) | `/admin/blog`, `/admin/pages`, `/admin/menus` | `AdminBlogController`, `AdminContentController` |
| Events | `/admin/events` | `AdminEventsController` |
| Groups | `/admin/groups` | `AdminGroupsController` |
| Volunteering | `/admin/volunteering` | `AdminVolunteerController` |
| Enterprise / GDPR | `/admin/enterprise` | `AdminEnterpriseController` |
| Analytics | `/admin/community-analytics` | `AdminCommunityAnalyticsController`, `AdminAnalyticsReportsController` |
| Newsletters | `/admin/newsletters` | `AdminNewsletterController` |
| Analytics reports | `/admin/reports/members`, `/admin/reports/hours`, `/admin/reports/inactive-members` | `AdminAnalyticsReportsController` |
| System / settings | `/admin/settings`, `/admin/cron-jobs`, `/admin/sso` | `AdminConfigController`, `AdminCronController`, `AdminSsoProvidersController` |
| Retention policies | `/admin/retention` | `AdminRetentionController` |
| Activity log | `/admin/activity-log` | `AdminAuditLogController` |
| Jobs | `/admin/jobs` | `AdminJobsController` |
| Marketplace | `/admin/marketplace` | `AdminMarketplaceController` |
| Billing | `/admin/billing` | `AdminBillingController` |
| SSO providers | `/admin/sso` | `AdminSsoProvidersController` |

### Retired from the admin panel (2026-07-02, no redirects)

The sections below were removed from `routes.tsx` outright — `/admin/moderation`, `/admin/reports` (as a moderation queue), `/admin/safeguarding` and `/admin/federation` do not resolve:

| Former section | Where it lives now | Server-side controllers (still present) |
| --- | --- | --- |
| Content moderation — queue, feed, comments, reviews, member-content reports | Broker panel — `/broker/moderation/*` | `AdminFeedController`, `AdminCommentsController`, `AdminReviewsController`, `AdminReportsController` (`/v2/admin/reports*`, now `broker-or-admin`); moderation settings/queue/stats are served by `AdminAnalyticsReportsController` |
| Safeguarding dashboard and options | Broker panel — `/broker/safeguarding`, `/broker/safeguarding-options` | `AdminSafeguardingController`, `AdminSafeguardingOptionsController` |
| Federation partnerships and inbound API partners | Super-admin-only Partner Timebanks panel — `/partner-timebanks/*` and `/partner-timebanks/inbound-api` | `AdminFederationController` (`/v2/admin/federation/*`) |

The moderation and safeguarding React components stay on disk and are reused in the broker panel via thin wrappers. The federation row is the internal partnership admin surface — not the external federation kill switch, which is a separate, dormant subsystem.

**Super-admin only** (require `super-admin` middleware, served at `/super-admin/*`):

| Section | Primary controller |
| --- | --- |
| Tenant CRUD and hierarchy | `AdminSuperController` |
| Cross-tenant user management | `AdminSuperController` |
| Super-admin grant/revoke | `AdminSuperController` |
| User impersonation | `AdminUsersController.impersonate` |
| Federation system controls | `AdminSuperController` |
| Provisioning requests | `SuperAdmin\TenantProvisioningController` |
| Regional analytics subscriptions | `SuperAdmin\RegionalAnalyticsAdminController` |
| Prerender admin | `AdminPrerenderController` — also uses `requirePlatformSuperAdmin()` |

The React super-admin panel is at `/{tenant}/super-admin` (not a sub-path of `/admin`). Routes in `routes.tsx` redirect `/admin/super/*` to `/super-admin/*`.

---

## Broker safeguarding vetting

The broker panel at `/{tenant}/broker/vetting` records a community's
safeguarding decision, not a criminal-record certificate. Routes under
`/v2/admin/vetting/*` use `broker-or-admin`; brokers and admin-tier users may
make decisions, while coordinators are rejected by
`requireVettingDecisionMaker()`. Only admin-tier users may change or rotate the
tenant jurisdiction policy.

### UK jurisdiction package

`SafeguardingJurisdictionService` requires an explicit jurisdiction because a
country code of `GB` cannot distinguish the three vetting authorities. The
supported UK policies are:

| Policy | Scheme / attestation | Allowed certification code(s) |
| --- | --- | --- |
| United Kingdom | `uk_national_safeguarding` / `uk_safeguarding_clearance` | Any non-empty combination of `dbs_enhanced`, `pvg_scotland`, and `access_ni` (maximum 3) |
| England and Wales | `dbs_england_wales` / `dbs_enhanced` | `dbs_enhanced` |
| Scotland | `pvg_scotland` / `pvg_scotland` | `pvg_scotland` |
| Northern Ireland | `access_ni` / `access_ni` | `access_ni` |

The United Kingdom umbrella policy is for communities that operate across UK
jurisdictions. Confirming under it requires an acknowledgement, at least one
controlled certification code, an operational scope summary, and a community
`review_due_at` date. Selecting PVG also requires
`authority_expires_at`; DBS and AccessNI may carry an authority date but do not
require one. Neither date may be in the past, and the community review cannot
fall after an authority expiry. A single-authority policy fills its sole
certification code automatically when the caller omits the array.

`MemberVettingAttestationService` stores the controlled codes, policy identity,
decision actors/timestamps, dates, and encrypted scope/private notes. Files,
certificate or reference numbers, results, arbitrary statuses, and authority
documents are prohibited; any upload or unknown/prohibited input returns
`VETTING_EVIDENCE_PROHIBITED`. This boundary is deliberate: certificate
evidence stays with the competent authority or arranging organisation, outside
Project NEXUS.

### Authorization, renewal, and policy changes

A confirmation authorizes safeguarded contact only while it is confirmed under
the tenant's current policy version, has not been revoked, and neither its
review date nor authority expiry is in the past. The due date itself remains
current; it becomes expired the following day. Reconfirmation updates the
details and clears all prior reminder stamps.

The scheduled command `safeguarding:vetting-renewals` runs daily at 06:15,
without overlap and on one server. It uses the earlier of `review_due_at` and
`authority_expires_at`, then sends one localized email and bell cycle to active
brokers/admins in each 90-day, 30-day, and 7-day window, on the due date, and
after expiry. A stamp is written only after at least one delivery succeeds, so
a tenant with no reachable safeguarding staff remains retryable. Operators can
preview work without sending or stamping it:

```bash
php artisan safeguarding:vetting-renewals --dry-run
```

Policy rotation is different from certificate expiry. It creates a new policy
version, makes confirmations under the old version non-authorizing, creates
pending review requests for affected confirmed members, and notifies those
members. Use `POST /v2/admin/vetting/policy/rotate` with an acknowledgement and
one of `policy_changed`, `scheduled_review`, or `incident_response`; do not edit
attestation rows directly.

Key regression coverage:

- `tests/Laravel/Feature/Controllers/AdminVettingControllerTest.php` — access
  control plus removal of legacy verify/reject/delete/upload routes.
- `tests/Laravel/Feature/Safeguarding/MemberVettingAttestationWorkflowTest.php` —
  UK certification/date rules, encrypted decision metadata, prohibited
  evidence, confirmation/revocation, expiry, reviews, and policy rotation.
- `tests/Laravel/Feature/Console/VettingRenewalRemindersCommandTest.php` —
  seven-day staff notification delivery and its persisted reminder stamp.

---

## Audit surfaces

Three independent audit tables, all tenant-scoped:

| Table | Written by | What it captures |
| --- | --- | --- |
| `activity_log` | Scattered writes across services (e.g. `ActivityLog::log()`, `SafeguardingService`, wallet operations) | General platform activity: logins, listings, admin actions, wallet events. Columns: `tenant_id`, `user_id`, `action`, `action_type`, `entity_type`, `entity_id`, `details`, `ip_address` |
| `org_audit_log` | `AuditLogService` (org wallet and member management operations) | Organisation-scoped actions: wallet deposits/withdrawals, transfers, member role changes, ownership transfers, settings changes. Columns: `tenant_id`, `organization_id`, `user_id`, `target_user_id`, `action`, `details` (JSON), `ip_address`, `user_agent` |
| `super_admin_audit_log` | `SuperAdminAuditService` | Cross-tenant super-admin actions: tenant CRUD, user moves, super-admin grants/revokes. Columns: `actor_user_id`, `action_type`, `target_type`, `old_values`, `new_values`, `ip_address`, `user_agent` |

`AuditLogService` (in `app/Services/AuditLogService.php`) defines action-type constants and is the canonical way to write `org_audit_log` entries from services and controllers.

Admin export endpoints:

- `GET /v2/admin/audit-log/export.csv?log=activity|admin` — streams `activity_log` or `org_audit_log` as UTF-8 CSV (BOM-prefixed for Excel). Cells are sanitised against spreadsheet formula injection. Hard cap: 100,000 rows. Filter by `date_from`, `date_to`, `user_id`, `action`. Served by `AdminAuditLogController`.
- `GET /v2/admin/super/audit` — super-admin audit trail from `super_admin_audit_log`. Served by `AdminSuperController`.

The prerender admin has its own `prerender_audit_log` table, sanitises secret keys from audit payloads, and exports via `GET /v2/admin/prerender/export/audit.csv`.

---

## Security invariants

- **Every mutating admin endpoint must be behind `auth:sanctum` plus at least the `admin` or `super-admin` middleware alias.** Endpoints using `broker-or-admin` must not perform state changes that tenant admins could not also perform.
- **No cross-tenant data exposure.** All queries must include `tenant_id = ?` bound to `TenantContext::getId()`. The `isPlatformSuperAdmin()` predicate is the only permitted path to unlocked cross-tenant reads, and only inside explicitly designed cross-tenant controllers.
- **`is_tenant_super_admin` is never accepted by `EnsureIsSuperAdmin` or `requirePlatformSuperAdmin()`.** Promoting a tenant super-admin to platform control is done only via an explicit super-admin grant operation.
- **User impersonation requires `super-admin` middleware** (`/v2/admin/users/{id}/impersonate`). The target user must not be a super-admin (`cannot_impersonate_super_admin`). The action is logged to `activity_log` (`admin_impersonate`).
- **`maintenance_mode` is gated above regular admin level.** Only `is_super_admin`, `is_tenant_super_admin`, or `is_god` may write it to prevent delegated admins from taking their own tenant offline.
- **Map API keys are masked in settings responses.** `AdminConfigController` returns redacted values (e.g. `AIza••••YJ4`) for `google_maps_api_key`, `maptiler_api_key`, and `os_maps_api_key`. The full values are only returned by `MapsConfigController` when the corresponding provider is active.
- **Audit CSV cells are sanitised** against spreadsheet formula injection. Any cell value beginning with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a single quote.
- **The `broker` role explicitly cannot access the admin panel.** `EnsureIsAdmin` checks `role === 'broker'` first and returns 403 before evaluating any flags, regardless of what boolean columns are set.

---

## Privacy notes

- `activity_log.ip_address` is NULLed as part of GDPR account deletion (`GdprService::executeAccountDeletion`).
- Data retention policies for `activity_log` and other tables are configurable per-tenant via `AdminRetentionController` (`/v2/admin/retention/policies`). The `RetentionPolicyService` enforces scheduled purges.
- GDPR data subject access requests (DSARs) are managed via `AdminEnterpriseController` and the `GdprService`. The DSAR backlog is monitored by the `gdpr:check-overdue-requests` scheduled command (alerts on items past the Article 12(3) 30-day deadline).

---

## Test commands and key regression tests

```bash
# Run all admin controller tests (59 files)
vendor/bin/phpunit --filter "AdminAccessControlTest|Admin.*Controller" --testsuite=Laravel

# Middleware isolation tests
vendor/bin/phpunit tests/Laravel/Unit/Middleware/EnsureIsAdminTest.php
vendor/bin/phpunit tests/Laravel/Unit/Middleware/EnsureIsSuperAdminTest.php

# Admin access control integration
vendor/bin/phpunit tests/Laravel/Feature/Controllers/AdminAccessControlTest.php

# Specific controller suites (examples)
vendor/bin/phpunit tests/Laravel/Feature/Controllers/AdminUsersControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/AdminConfigControllerTest.php
vendor/bin/phpunit tests/Laravel/Feature/Controllers/AdminSecurityAuditTest.php
```

`AdminAuditLogController` has no dedicated test file of its own; `AdminSecurityAuditTest` is the closest audit-focused suite.

`AdminAccessControlTest` verifies that non-admin users receive 403 from admin endpoints and that broker-role users are rejected by admin-only endpoints while accepted by `broker-or-admin` endpoints.

`EnsureIsAdminTest` and `EnsureIsSuperAdminTest` test the middleware in isolation, including the broker explicit-reject path and the `is_tenant_super_admin` exclusion from the super-admin check.

---

## Operational failure modes

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Admin panel returns 401 on every request | Sanctum token expired or `auth:sanctum` middleware misconfigured | Re-authenticate; check `APP_KEY` and Sanctum config |
| `403 Admin access required` for a known admin user | `role` column set to `broker`, or all boolean flags are `0` | Check `users.role`, `is_admin`, `is_super_admin` for the user in the database |
| Feature toggle appears saved but has no effect | Redis bootstrap cache stale | `php artisan cache:forget tenant_bootstrap` for the tenant, or flush Redis |
| Audit log CSV export is empty or cut short | Date filter returns no rows, or `activity_log` is beyond the 100,000-row cap | Narrow the date range; the cap is enforced in `AdminAuditLogController::MAX_ROWS` |
| Super-admin route returns 403 for a `is_tenant_super_admin=1` user | Expected. `EnsureIsSuperAdmin` rejects tenant super-admins from platform routes by design | Grant the user `is_super_admin=1` via an existing platform super-admin through `/v2/admin/super/users/{id}/grant-super-admin` |
| Maintenance mode cannot be toggled from the admin settings UI | User is a regular admin, not super-admin | Requires `is_super_admin`, `is_tenant_super_admin`, or `is_god` |

---

## Cross-references

- [CONTRIBUTOR_TERMS_ENFORCEMENT.md](../CONTRIBUTOR_TERMS_ENFORCEMENT.md) — how contributor-terms acceptance is enforced via PR checks.
- [SECURITY-SCANNING.md](../SECURITY-SCANNING.md) — CI security scan coverage and suppression rationale.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — overall platform architecture, middleware stack, and tenant isolation.
- [DEPLOYMENT.md](../DEPLOYMENT.md) — blue-green deploy process and maintenance mode operation.
- `app/Http/Middleware/EnsureIsAdmin.php` — authoritative middleware source for the admin permission model.
- `app/Http/Middleware/EnsureIsSuperAdmin.php` — authoritative middleware source for the super-admin permission model.
- `app/Http/Controllers/Api/BaseApiController.php` — `requireAdmin()`, `requirePlatformSuperAdmin()`, `isPlatformSuperAdmin()`.
- `app/Services/AuditLogService.php` — action-type constants and `org_audit_log` write helper.
- `app/Services/SuperAdminAuditService.php` — `super_admin_audit_log` write helper.
