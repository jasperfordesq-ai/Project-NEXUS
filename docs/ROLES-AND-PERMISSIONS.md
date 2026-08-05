# Roles & Permissions

Last reviewed: 2026-08-04

This page describes the authorisation model as it exists in code. It was written
by reading `app/Support/Authorization/AdminTier.php`, the `app/Http/Middleware/EnsureIs*.php`
gates, `routes/api.php`, and the `users` / RBAC tables in
`database/schema/mysql-schema.sql` — not from prior documentation. The source code
remains authoritative; where behaviour and this page disagree, the code is right
and this page is a bug.

Timebanking vocabulary varies between networks. Project NEXUS deliberately uses
generic role names so it can serve communities in any country; the first table
below maps the common UK terms onto them.

---

## The five tiers

| Common term | NEXUS role / flag | Gate |
|---|---|---|
| member | `role = 'member'` | — (default) |
| broker / coordinator | `role = 'broker'`, `role = 'coordinator'` | `app/Http/Middleware/EnsureIsBrokerOrAdmin.php` |
| administrator | `role = 'admin'`, `role = 'tenant_admin'`, `is_admin` | `app/Http/Middleware/EnsureIsAdmin.php` |
| network administrator | `is_tenant_super_admin` (+ Hub/sub-tenant hierarchy) | `EnsureIsAdmin`, scoped by `app/Services/TenantHierarchyService.php` |
| platform administrator | `is_super_admin`, `role = 'god'` | `app/Http/Middleware/EnsureIsSuperAdmin.php` |

### A broker is not a junior administrator

This is the most commonly misread part of the model. `AdminTier::ROLES` contains
only `admin`, `tenant_admin`, `super_admin`, `god`. `AdminTier::OPERATIONAL_ROLES`
contains `broker` and `coordinator`, and `AdminTier::allows()` **explicitly returns
`false`** for them before it checks anything else — so a stray legacy admin flag on
a broker's row does not promote them.

Brokers are deliberately refused the generic `/v2/admin/*` surface (tenant
settings, federation controls, tenant CRUD). They get their own routes and their
own application.

### What each tier adds

- **Member** — their own content, their own exchanges, their own wallet.
- **Broker / coordinator** — the community-operations role: approve members,
  moderate listings and content, approve exchanges that need broker sign-off,
  manage safeguarding assignments and vetting attestations, adjust a member's
  balance. Scoped to one tenant.
- **Administrator** — everything a broker can do, plus tenant configuration:
  module and feature flags, categories, legal documents, registration policy,
  pages and branding. Scoped to one tenant. Cannot move users between tenants or
  grant platform privileges.
- **Network administrator** (`is_tenant_super_admin`) — an administrator whose
  scope extends to their tenant *and its sub-tenants*. Only grantable where the
  parent tenant has `allows_subtenants`. Accepted by `EnsureIsAdmin`, **not** by
  `EnsureIsSuperAdmin` — a compromised network admin cannot become a platform
  compromise.
- **Platform administrator** — cross-tenant: tenant CRUD, moving users between
  tenants, platform-wide federation controls, the super-admin panel. `god` is the
  break-glass tier and is the only one with an unconditional allow.

### Hierarchy scoping in the super-admin panel

The super-admin panel is not all-or-nothing. `app/Core/SuperPanelAccess.php`
resolves an access *level* and every cross-tenant action is checked against it:

| Who | Level | Scope |
|---|---|---|
| `is_god` / `role = 'god'` | `master` | Platform-global |
| `is_tenant_super_admin` on the **master** tenant (id 1) | `master` | Platform-global |
| `is_tenant_super_admin` on a **hub** tenant (`allows_subtenants = 1`) | `regional` | That tenant **and its descendants only** |

`SuperPanelAccess::canAccessTenant()` implements the subtree test as a
materialised-path prefix match (`str_starts_with($target->path, $access['tenant_path'])`),
and `getScopeClause()` gives the equivalent `path LIKE ?` predicate for list
queries.

**This is what keeps a network administrator inside their own network.** A hub
tenant's super admin sees and acts on their own tenant and the children beneath
it, and nothing else. Moving a user is checked at **both ends** — source tenant
*and* destination tenant — in `AdminSuperController::userMoveTenant()`, so a
network administrator cannot move a member out of, or into, someone else's
hierarchy. The platform (`god`/`master`) tier is unrestricted by design.

> ⚠️ **The authorisation on moving a user is correct. What the move does to the
> member's data is not.** `User::moveTenant()` updates `users.tenant_id` and
> nothing else, so the member's balance travels with them while their transaction
> history, listings, group memberships and messages stay behind in the old tenant.
> See [DATABASE.md](DATABASE.md) and the caveat below before using this on real
> data.

### Self-dealing guards

Broker-tier actions carry conflict-of-interest checks in the controller, not just
the middleware: a broker cannot moderate content they are a party to, cannot
resolve a report they filed, and cannot approve a match they submitted. A broker
also cannot adjust their own balance. Regression tests live in
`tests/Laravel/Feature/Controllers/BrokerModerationAuthorizationTest.php` and
`BrokerMatchApprovalAuthorizationTest.php`.

---

## The broker application

Brokers have a dedicated interface at `react-frontend/src/broker/`, separate from
the admin panel. It covers: Dashboard, Members, Onboarding, Exchanges, Match
Approvals, Messages / Message Review, Content / Comment / Feed / Review
moderation, Risk Tags, Safeguarding, Vetting, Insurance Certificates, User
Monitoring, Reports and Archive.

Exchange sign-off is part of the exchange state machine rather than bolted on:
`exchange_requests` carries a `pending_broker` status alongside
`broker_approved_at`, `broker_notes` and `broker_conditions`.

---

## Two authorisation systems coexist

**1. Role string plus boolean flags on `users`** — the live system for
tenant/platform tiers. `users.role` plus `is_admin`, `is_super_admin`,
`is_tenant_super_admin`, `is_god`, `is_approved`. `AdminTier` is the canonical
predicate; prefer it over reading columns directly.

**2. A permission/RBAC schema** — `roles`, `permissions`, `role_permissions`,
`user_roles`, `user_permissions`. `user_roles.scope_organization_id` supports
per-organisation scoped roles. This system is used narrowly today, for a specific
set of permissions rather than as a general replacement for tier 1.

Permission slugs that are genuinely enforced in code today:

| Slug | Enforced in |
|---|---|
| `safeguarding.manage`, `safeguarding.view` | `AdminSafeguardingController`, `CaringCommunity\SafeguardingService` |
| `volunteering.hours.review` | `VolunteerService` |
| `national.kiss_dashboard.view` | `Admin/NationalKissDashboardController` |
| `verein.members.import` | `EnsureIsAdmin` (the one permission-based bypass of the admin gate), `AdminCaringCommunityController` |
| `verein.dues.manage`, `verein.members.manage` | `Verein/VereinDuesAdminController` |

Role presets for hierarchical deployments are installed by
`app/Services/CaringCommunityRolePresetService.php` (`national_admin`,
`canton_admin`, `municipality_admin`, `cooperative_coordinator`,
`organisation_coordinator`, `trusted_reviewer`).

---

## Known caveats

These are real and worth knowing before you write an authorisation check.

- **Some role strings are never written.** The admin API only ever assigns
  `member`, `admin` or `broker` to `users.role`. `super_admin`, `god`,
  `tenant_admin` and `coordinator` are checked in code but are expressed through
  boolean flags (or not granted at all). **A gate that tests only the role string
  will under-authorise a real platform administrator.** Always go through
  `AdminTier`, or check the flags alongside the string.
- **Most declared RBAC permission slugs are not enforced.** The permission
  catalogue offered in the role editor is much larger than the enforced set listed
  above. A slug being grantable does not mean anything checks it — verify before
  relying on one. `members.assisted_onboarding` is a notable example: it is granted
  by four role presets and checked nowhere.
- **`is_admin` is legacy.** The column is still honoured by `AdminTier`, but it is
  marked deprecated in the schema and has no granting endpoint. Prefer roles.
- **Acting on behalf of another member is a separate subject** with its own
  mechanisms and its own gaps — see [SAFEGUARDING-AND-CONSENT.md](SAFEGUARDING-AND-CONSENT.md).
- **Moving a user between tenants does not move their data.** `User::moveTenant()`
  changes `users.tenant_id`, revokes sessions and deletes passkeys (which are
  RP-ID-scoped, so they cannot survive the move) — and touches nothing else. Every
  other tenant-scoped table keeps the old `tenant_id`. Because `users.balance` is a
  column on `users`, the member arrives in the destination tenant with their
  balance intact but no transaction history behind it, while the origin tenant
  retains that history. There is no repair tooling. The API response fields
  `records_moved` and `tables_failed` describe the single-row update and a passkey
  precondition respectively — they do not report a multi-table migration, because
  none happens. Treat the feature as "reassign an account", not "transfer a
  member".

---

## Adding an authorisation check

1. Use the existing middleware where you can: `admin`, `broker-or-admin`, or the
   super-admin group. Route-level gating is the norm in `routes/api.php`.
2. In a controller, use the `BaseApiController` helpers (`requireAdmin()`,
   `requireBrokerOrAdmin()`) rather than reading `users.role` yourself.
3. If the action can create a conflict of interest, add a self-dealing guard and a
   test for it.
4. If you add a genuinely new capability, prefer extending the tier model over
   adding an unenforced permission slug.
