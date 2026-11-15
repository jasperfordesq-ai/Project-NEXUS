# Roles & Permissions

Last reviewed: 2026-11-15

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

## The access levels

These are the owner's names for the levels (12 October 2026). Use them. The
older name "network administrator" for a tenant super admin is retired — it
appears only in historical records and in the names of some older test files.

| Level | What it reaches | Flags / role on `users` | Gate |
|---|---|---|---|
| member | own content | `role = 'member'` | — (default) |
| broker / coordinator | operational work in **own tenant** | `role = 'broker'` / `'coordinator'` | `app/Http/Middleware/EnsureIsBrokerOrAdmin.php` |
| tenant admin | **own tenant** | `role = 'admin'` (or `'tenant_admin'`), or legacy `is_admin = 1` | `app/Http/Middleware/EnsureIsAdmin.php` |
| tenant super admin | **own tenant + every tenant below it** in the hierarchy | `is_tenant_super_admin = 1`, on a tenant with `allows_subtenants = 1` | `EnsureIsAdmin`; super-admin panel tier A (`EnsureSuperPanelAccess`) |
| global super admin | **every tenant** (platform-wide) | `is_super_admin = 1` (or `role = 'super_admin'`) | `app/Http/Middleware/EnsureIsSuperAdmin.php` |
| global super admin with "god" status — on screen, the **platform team** | every tenant, plus the god-only actions and the [Platform team panel](#the-platform-team-panel-15-november-2026) | `is_god = 1` **and** `is_super_admin = 1` (see below) | `EnsureIsSuperAdmin`, plus `requireGod()` in `AdminSuperController`; `requireGodPlatformAdmin()` / middleware `platform-team` for the panel |

### The reach rule (owner, 12 October 2026)

> "A tenant super admin can administer all communities below it in the
> hierarchy, but not above it."

- A **tenant admin** acts on its own tenant only.
- A **tenant super admin** acts on its own tenant and on every tenant **below**
  it — children, grandchildren and so on. Never on a tenant above it (its
  parent), never on a tenant beside it (a sibling), never on an unrelated tree.
  "Below" is a prefix match on the materialised path `tenants.path`, anchored on
  the trailing slash so `/1/4/1/` can never match `/1/4/11/`.
- 🔴 **There is no special level for a tenant super admin on the master tenant
  (id 1).** It follows the same rule: it reaches tenants whose path is under
  `/1/`, and not a separate root such as `/3/`. Be aware that the super-admin
  panel creates new communities beneath tenant 1, so in production a tenant
  super admin on tenant 1 does reach most communities. Grant it there sparingly.
- A **global super admin** and a **god** account act on every tenant.

Until 12 October 2026 two other readings applied, and older code comments,
register entries and tests may still describe them: before 11 October a tenant
super admin on tenant 1 was treated as platform-wide (`master`); on 11 October
the reach below was removed entirely (own tenant only). Both are superseded by
the rule above.

### Where the rule is applied today — and where it is not yet

- **Super-admin panel:** applies the rule. A tenant super admin sees and acts on
  its own tenant and its sub-tenants (see "Hierarchy scoping" below).
- **The per-record predicate** `app/Support/Authorization/TenantAdminScope.php`
  (used by `EventPolicy` and other services to ask "is this actor an admin of
  this record's tenant?") applies the same rule: own tenant, plus descendants for
  a tenant super admin, failing closed on a missing path.
- **Ordinary admin screens (`/v2/admin/*`): applies the rule at the API.**
  Before any controller runs, the HTTP layer decides whether a signed-in account
  may work inside a tenant other than its own:
  `app/Support/Authorization/CrossTenantEntry.php`, called from
  `TenantContext` (tenant chosen by header, slug or custom domain) and
  `app/Http/Middleware/Authenticate.php` (`403 tenant_mismatch` /
  `token_tenant_mismatch`). A global super admin or god may enter any tenant for
  any request. A tenant super admin may enter a tenant **strictly below** its
  home tenant, and only for management requests
  (`CrossTenantEntry::isManagementRequest()`): `/api/v2/admin/*`; read-only
  `GET`/`HEAD /api/v2/users/me` and the member-directory search
  `GET /api/v2/users`; and the event organiser tools, views and changes alike (an
  explicit method + path list, `EVENT_ORGANISER_ROUTES`) — with a token issued
  for its home tenant. Since 15 Oct 2026 it may also **read** the member side
  there (`CrossTenantEntry::isVisitorReadRequest()`: `GET`/`HEAD` of `api/v2/*`
  and the navigation menus, minus `VISITOR_REFUSED_READS` — reads that write,
  export personal data, or create rows for the caller). Everything else
  (posting, messaging, wallet, registering for events) is still refused there,
  answered `403 visiting_manager_read_only`, so a parent tenant super admin
  manages and looks around a sub-community but never acts in it as a member.
  Looking around leaves no trace: view and download counters skip a visitor
  (`CrossTenantEntry::isVisitingNow()`), it never shows as online, and a read
  never creates its delegate (`actorMayActIn()` admits management requests
  only). Tenant
  admins, brokers and members are always pinned to their home tenant. Admin controllers that load "the acting admin" now load that account
  by id and check it with `CrossTenantEntry`/`TenantAdminScope`; the members and
  records being administered stay confined to the request's tenant.
- 🔴 **A manager from another community acts below as its DELEGATE** (owner,
  12 Oct 2026: "Go with option 3"). About 45 event tables record the acting
  account with a composite foreign key `(<actor column>, tenant_id) →
  users(id, tenant_id)`, so the database only accepts an actor of the record's
  own community. A tenant super admin from above — or the global super admin
  from any other community — therefore acts there through a `users` row of that
  community with `status = 'delegate'`
  (`app/Support/Authorization/ManagerDelegate.php`; link table
  `tenant_manager_delegates`): role admin, the manager's name, no password, a
  non-deliverable `@delegate.invalid` email. `CrossTenantEntry::activeActor()`
  and `BaseApiController::getActingUserId()` swap it in on event organiser
  requests; records then name the delegate.
  - It is **usable only while** the manager is still active and still admitted
    to that community (`ManagerDelegate::isUsable()`, checked on every use):
    revoking the flag stops it at once.
  - It **never signs in**: `Authenticate` refuses every status but `active`,
    and `TokenService` refuses to mint any token for one.
  - It **cannot be taken over**: database triggers
    (`trg_users_delegate_*_guard`) refuse a password, an email, role, community
    or platform-flag change, turning it into an ordinary account, and turning an
    ordinary account into one.
  - It is **not a member**: member-facing queries filter `status = 'active'`
    and never see it; the admin user list, admin user detail and member export
    exclude it. 🔴 Actor checks that read `status = 'active'` must use
    `ManagerDelegate::isActingAccount()` to accept it; a member being acted ON
    (registrant, ticket recipient, team member, attendee) must stay strictly
    `active` and in-community.
  - Personal data: the manager's name is copied into each community it changes
    something in — DPO register item DPO-11.
- **Signing in below.** Owner, 12 Oct 2026: "If a user tries to sign in to a
  community that they're not allowed to sign in to, it should sign them out. If
  they're allowed to sign in, they're allowed to sign in to manage those
  communities." `CrossTenantEntry::mayEnter()` is the same rule without a
  request: the global super admin anywhere, an admin-tier tenant super admin
  strictly below its home tenant. The login page of a sub-community finds such
  an account from above (login priority 4, after every existing match), and a
  refresh token keeps working in a tenant the account may enter. The React app
  no longer signs anyone out on a community switch, and no longer clears the
  stored session when it boots a different community: it asks
  `GET /v2/users/me` there (`COMMUNITY_CHANGED_EVENT`), and a `tenant_mismatch`
  answer ends the session (`visiting_manager_read_only` never does). A visiting
  tenant super admin (`isVisitingManager()`) may open member pages, under a
  permanent "visiting" banner (`VisitingManagerBanner`); pages about its own
  membership (dashboard, messages, wallet, notifications, settings, exchanges,
  matches, create/edit forms) send it to the community feed, and that
  community's member terms and onboarding are not asked of it.

### Flags each level needs

- **Tenant admin:** `role = 'admin'`. `is_admin` is legacy (see caveats) but is
  still honoured.
- **Tenant super admin:** `is_tenant_super_admin = 1`. The flag alone is enough —
  `AdminTier` accepts it without an admin role string, and that is how the grant
  endpoint writes it. It can only be granted on a tenant with
  `allows_subtenants = 1`.
- **Global super admin:** `is_super_admin = 1` (the god-only grant endpoint writes
  the flag only; `role = 'super_admin'` is also honoured).
- **God:** `is_god = 1` **and** `is_super_admin = 1`. 🔴 `is_god` on its own is
  not enough everywhere: the shared `BaseApiController::requireSuperAdmin()` —
  the first check on every super-admin panel endpoint — accepts
  `is_super_admin`, `is_tenant_super_admin` or a `super_admin`/`god` role
  string, but **not** the `is_god` flag. Conversely `requireGod()` reads only
  the `is_god` column, not `role = 'god'`. Give god accounts both flags.

### A broker is not a junior administrator

This is the most commonly misread part of the model. `AdminTier::ROLES` contains
only `admin`, `tenant_admin`, `super_admin`, `god`. `AdminTier::OPERATIONAL_ROLES`
contains `broker` and `coordinator`, and `AdminTier::allows()` **explicitly returns
`false`** for them before it checks anything else — so a stray legacy admin flag on
a broker's row does not promote them.

Brokers are deliberately refused the generic `/v2/admin/*` surface (tenant
settings, federation controls, tenant CRUD). They get their own routes and their
own application.

**Every function of the broker application works for a broker** (owner decision,
2 October 2026). Where a broker page reuses an admin endpoint — safeguarding,
moderation settings, member notes, the vetting jurisdiction — that endpoint
admits `broker` (and, except for vetting decisions, `coordinator`) by role, with
no individual permission grant. If you add an endpoint to a broker page, put it in
the `broker-or-admin` route group and use `requireBrokerOrAdmin()` (or
`requireVettingDecisionMaker()` for vetting). The self-interest guards still
apply: a broker cannot act on a record about themselves or about someone they do
not outrank.

### What each tier adds

- **Member** — their own content, their own exchanges, their own wallet.
- **Broker / coordinator** — the community-operations role: approve members,
  moderate listings and content and the content-queue settings, approve
  exchanges that need broker sign-off, see members' safeguarding preferences and
  the flagged-message queue, manage safeguarding assignments, support and
  authority attestations and vetting (brokers also set the vetting
  jurisdiction; coordinators make no vetting decisions), keep member notes,
  adjust a member's balance. Scoped to one tenant.
- **Tenant admin** — everything a broker can do, plus tenant configuration:
  module and feature flags, categories, legal documents, registration policy,
  pages and branding. Scoped to one tenant. Cannot move users between tenants or
  grant platform privileges.
- **Tenant super admin** (`is_tenant_super_admin`) — a tenant admin of its own
  tenant which, through the super-admin panel, also administers every tenant
  below it in the hierarchy: see and edit those communities, deactivate them,
  create sub-communities, move members between its own tenant and the tenants
  below it, and log in as their members. Only grantable where the tenant has
  `allows_subtenants`. Accepted by `EnsureIsAdmin` and by the subtree tier of
  the super panel (`EnsureSuperPanelAccess`). **Not** accepted by
  `EnsureIsSuperAdmin` — a compromised tenant super admin cannot become a
  platform compromise. In the ordinary admin screens it is still held to its
  home tenant (see "Where the rule is applied today").
- **Global super admin** — platform-wide: tenant CRUD, moving users between any
  tenants, platform-wide federation controls, the whole super-admin panel.
- **God** — a global super admin with `is_god`. The break-glass tier: the only
  one with an unconditional allow, and the only one that can grant or revoke
  global super admin.

### Hierarchy scoping in the super-admin panel

The super-admin panel is not all-or-nothing. `app/Core/SuperPanelAccess.php`
resolves an access *level* and every cross-tenant action is checked against it:

| Who | Level | Scope |
|---|---|---|
| global super admin or god (`is_super_admin` / `is_god` / `role = 'super_admin'`\|`'god'`) | `master` | Platform-global, **wherever their account sits** |
| tenant super admin (`is_tenant_super_admin`) on a hub tenant (`allows_subtenants = 1`) — **including the master tenant, id 1** | `regional` | That tenant **and the tenants below it only** |
| anyone else | `none` | No panel |

`master` belongs to global super admins and god alone. A tenant super admin on
tenant 1 is `regional` like any other: before 11 October 2026 it was resolved to
`master` (every community), and that is no longer true.

`SuperPanelAccess::canAccessTenant()` implements the subtree test as a
materialised-path prefix match anchored on the trailing slash, and
`getScopeClause()` / `subtreeFilter()` give the equivalent `path LIKE ?`
predicate for list queries. A tenant above or beside the caller's own never
matches.

> 🔴 **`tenants.path` is nullable, and an empty prefix means EVERYTHING, not
> nothing.** `str_starts_with($x, '')` is `true` and `LIKE '%'` matches every row.
> A `regional` grant therefore REQUIRES a usable path: `getAccess()` refuses
> otherwise, `canAccessTenant()` and `getScopeClause()` fail closed, and
> `subtreeFilter()` exists so the six list call-sites cannot repeat the old
> fail-open idiom (`if (regional && !empty(path)) { filter }` applied **no** filter
> when the path was empty). Do not make the column `NOT NULL` — the path is set in
> a second UPDATE after insert, because it is built from the row's own id.
> Tests: `tests/Laravel/Feature/SuperAdmin/SubtreeBoundaryEmptyPathTest.php`.

### The panel has two tiers (2026-08-05)

Endpoints are split by **what the power reaches**, not by convenience:

| Tier | Gate | Contents |
|---|---|---|
| **A — subtree** | `super-panel` (`EnsureSuperPanelAccess`) | Tenant/user lists, hierarchy, dashboard, audit, and the tenant/user mutations — all of which confine themselves via `canAccessTenant()` or `subtreeFilter()`. Admits `master` **and** `regional`. |
| **B — platform only** | `super-admin` (`EnsureIsSuperAdmin`) | Platform revenue/pricing, external-federation kill switches, platform capabilities, provisioning queue, granting global super admin, and tenant delete/purge. `master` only — and since 15 November 2026 most of it is narrower still: see below. |

🔴 Two reasons something is in tier B, and both matter:

1. The power is platform-wide. Granting global super admin especially — that is
   the escape hatch out of one's own branch.
2. It is **not yet safe** for a regional caller. The billing endpoints read
   `tenant_id` from the request body and check only `requireSuperAdmin()`, with no
   `canAccessTenant()`. Add that check before ever moving one to tier A.

Tenant delete/purge stay in tier B by choice despite scoping correctly: they are
irreversible, and building a network needs create/move, not destroy.

🔴 **Tier B is mostly the platform team's since 15 November 2026.** The
platform-wide screens left the super admin panel for the
[Platform team panel](#the-platform-team-panel-15-november-2026), and the
endpoints only they call now ask for the platform team (`is_god` **and** super
admin) inside the controller, behind the `super-admin` route group: the
federation system controls and kill switches, platform billing and revenue,
platform capabilities, the provisioning queue, the translation key and the
regional analytics subscriptions. A global super admin who is not on the
platform team gets 403 from them. What a global super admin still reaches in
tier B is listed under "Left open on purpose" in that section, plus the
grant/revoke of global super admin, tenant purge and the identity fee, which
keep their own checks.

**Frontend.** `GET /v2/users/me` returns `super_panel_level`
(`master`/`regional`/`none`), resolved server-side — the UI must not infer it from
flags, because eligibility also depends on `allows_subtenants` and the path.
`SuperAdminRoute` admits both levels, and the panel now shows both the **same six
pages** (dashboard, communities, hierarchy, users, bulk operations, audit log).
`PlatformOnlyRoute` and the menu's tier-B sections no longer exist: the old
`/super-admin/...` addresses of the moved screens are redirects that send the
platform team to the new page and anyone else to the super admin home page.
Isolation is proven by
`tests/Laravel/Feature/SuperAdmin/RegionalPanelIsolationTest.php`.

**This is what keeps a tenant super admin inside its own branch.** A tenant
super admin sees and acts on its own tenant and the tenants below it, and
nothing else — not its parent, not a sibling. Moving a user is checked at
**both ends** — source tenant *and* destination tenant — in
`AdminSuperController::userMoveTenant()`, so a tenant super admin cannot move a
member out of, or into, a tenant outside its branch. The global super admin and
god (`master`) level is unrestricted by design.

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

## The Platform team panel (15 November 2026)

The people who run the whole installation have their own panel at
`/platform-team`, beside the admin, broker, partner and super admin panels. On
screen the tier is always called **"Platform team"** (owner, 15 November 2026).
The code keeps the names it had: `is_god`, `requireGod()`, `isGodUser()`.

**Who is on the platform team.** `users.is_god = 1` **and** super admin
(`is_super_admin = 1` or `role = 'super_admin'`). Both legs:

- `is_god` is the column. The role string `god` is not accepted.
- `is_tenant_super_admin` is not a platform super admin.
- A global super admin without `is_god` is **not** on the platform team.

**One definition, three callers.**

| Where | What |
|---|---|
| `app/Support/Authorization/PlatformTeam.php` | `PlatformTeam::includes(int $userId)` reads the three columns from the database on every call |
| `BaseApiController::requireGodPlatformAdmin()` | the controller check; delegates to `PlatformTeam::includes()` |
| route middleware `platform-team` (`EnsureIsPlatformTeam`) | the same check for a route group |
| `react-frontend/src/lib/access.ts` `isPlatformTeamUser()` | the browser's mirror; decides whether the panel and its links are shown |

**The browser.** `react-frontend/src/platform-team/` holds the guard
(`PlatformTeamRoute`), the frame and the routes. The page components stay in
`src/admin/modules/` and are imported from there. Someone who is not on the
platform team and opens a panel address lands on their own panel: an admin on
`/admin`, a broker on `/broker`, a member on `/dashboard`, a signed-out visitor
on the login page. Every old `/admin/...` or `/super-admin/...` address of a
moved page is a redirect (`MovedToPlatformTeam`) that keeps the record id, the
query string and the fragment. From an old `/super-admin/...` address, someone
who is not on the platform team stays in the super admin panel, on its home
page. `GodOnlyRoute`, `GodPlatformRoute` and `PlatformOnlyRoute` no longer
exist.

**What is in it.** The pages the owner had restricted to the platform team in
the admin panel (menus, email settings and deliverability, performance, SEO
audit and redirects, the prerender engine, 404 tracking, search analytics,
plans and subscriptions, registration policy, cron jobs, the enterprise
dashboard, roles and permissions, monitoring, outbound webhooks, the matching
diagnostics, the Tests page), and the platform-wide half of the super admin
panel (the federation dashboard with its whitelist, partnerships and audit
pages, platform billing and revenue, the provisioning queue, pilot inquiries,
platform capabilities, the translation key, regional analytics subscriptions
and the national dashboard).

**The server.** A page in the panel is locked on the server, not only hidden:
every endpoint that only panel pages call starts with
`requireGodPlatformAdmin()`. A community admin, a global super admin who is not
on the platform team, and an account with `is_god` alone each get 403. The locks
are pinned one file per controller in
`tests/Laravel/Feature/Security/PlatformTeamLocks/`, each endpoint requested as
four accounts (`tests/Laravel/Concerns/ActsAsAccessTiers.php`).

**Left open on purpose.** An endpoint that a screen outside the panel still
calls keeps its previous check, and a test pins that a community admin still
gets an answer:

| Endpoint | Still used by |
|---|---|
| `GET` / `POST /v2/admin/tools/seo-audit` | the SEO overview (`/admin/seo`) |
| `GET /v2/admin/pages` | Pages |
| invite codes, the sign-up pause status | Community settings → Joining |
| `GET /v2/admin/matching/stats` | Smart matching |
| federation whitelist (read, add, remove) and partnerships (list, suspend, terminate) under `/v2/admin/super/federation/` | the per-community federation switches page, which stays in the super admin panel — open to a global super admin, as before |
| `GET /v2/admin/super/audit`, `GET /v2/admin/super/tenants` | the super admin audit log and community pages (tier A, confined to the caller's branch) |
| `GET /v2/admin/super/federation` (read-only overview) | no screen; `RegionalPanelIsolationTest` uses it as its control that a global super admin still reaches tier B |
| everything under `/v2/admin/national/kiss/` | the national dashboard's endpoints are not changed (they also admit holders of `national.kiss_dashboard.view`); only the screen moved |

**Not in the panel.** Community billing (`/admin/billing*`), the Impact report
and the SEO overview stay in the admin panel (owner, 15 November 2026). Controls
*inside* pages that stay (the footer badge switch, the global super admin switch
on a user, permanent purge) keep their own checks and are only relabelled.

**Adding a page to the panel.** Mount it in `PlatformTeamRoutes.tsx`, add it to
`PlatformTeamSidebar.tsx` in the zone that matches what the page acts on ("The
whole platform" or "This community"), start each of its endpoints with
`requireGodPlatformAdmin()`, and add the endpoint to its controller's lock test.
Before locking an endpoint, grep `react-frontend/src`, `mobile/` and `web-uk/`
for other callers: one that stays outside the panel makes the endpoint a
left-open exception, recorded in the table above.

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
| `safeguarding.manage`, `safeguarding.view` | `CaringCommunity\SafeguardingService`, `AdminSafeguardingController` (for accounts that are neither admin tier nor broker/coordinator — those pass by role). No screen can grant either today. |
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
