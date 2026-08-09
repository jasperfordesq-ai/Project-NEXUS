# Core Tenant Route Gates Implementation Plan

> **Historical plan:** Do not execute this plan as a current queue. Read
> `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Any runtime smoke in
> this file is stateful and may run only against a separately provisioned,
> verified disposable Laravel environment, never the ordinary
> production-derived environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Web UK return Laravel-style 403 responses for tenant-mounted pages when Laravel tenant bootstrap disables the core feature/module gates that Laravel controllers enforce.

**Architecture:** Reuse the existing `tenantFeatureGate` middleware and Laravel-mirrored defaults from `accessible-shell.js`. Extend route prefix declarations to support both `featureKey` and `moduleKey`, then test tenant-mounted paths before auth/API handlers can leak enabled pages.

**Tech Stack:** Express middleware, Jest/Supertest, Laravel generated route matrix.

---

### Task 1: Add Core Disabled Gate Regression

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Write the failing test**

Add a focused Supertest case near the existing default-off tenant feature gate test:

```javascript
it('returns Laravel-style 403 for tenant-mounted disabled core route gates', async () => {
  const api = require('../src/lib/api');
  api.getTenantBootstrap.mockResolvedValue({
    data: {
      id: 2,
      name: 'Acme Timebank',
      slug: 'acme',
      modules: {
        dashboard: false,
        feed: false,
        listings: false,
        messages: false,
        wallet: false,
        notifications: false
      },
      features: {
        connections: false,
        events: false,
        volunteering: false,
        gamification: false,
        blog: false
      }
    }
  });

  const paths = [
    '/acme/accessible/dashboard',
    '/acme/accessible/feed',
    '/acme/accessible/listings',
    '/acme/accessible/exchanges',
    '/acme/accessible/matches',
    '/acme/accessible/events',
    '/acme/accessible/volunteering',
    '/acme/accessible/organisations',
    '/acme/accessible/members',
    '/acme/accessible/connections',
    '/acme/accessible/messages',
    '/acme/accessible/wallet',
    '/acme/accessible/notifications',
    '/acme/accessible/achievements',
    '/acme/accessible/leaderboard',
    '/acme/accessible/nexus-score',
    '/acme/accessible/blog'
  ];

  for (const path of paths) {
    const response = await request(app)
      .get(path)
      .set('Cookie', signedCookieHeader());

    expect(response.status).toBe(403);
    expect(response.text).toContain('Forbidden');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "disabled core route gates"
```

Expected: FAIL because current middleware only blocks Marketplace, Courses, Podcasts, Coupons, and Premium.

### Task 2: Extend Tenant Gate Middleware

**Files:**
- Modify: `apps/web-uk/src/middleware/tenant-feature-gates.js`

- [ ] **Step 1: Add module and feature gate prefixes**

Extend the existing route gate table with Laravel matrix-backed prefixes:

```javascript
{ prefix: '/dashboard', moduleKey: 'dashboard' },
{ prefix: '/feed', moduleKey: 'feed' },
{ prefix: '/listings', moduleKey: 'listings' },
{ prefix: '/exchanges', moduleKey: 'listings' },
{ prefix: '/matches', moduleKey: 'listings' },
{ prefix: '/events', featureKey: 'events' },
{ prefix: '/volunteering', featureKey: 'volunteering' },
{ prefix: '/organisations', featureKey: 'volunteering' },
{ prefix: '/members', featureKey: 'connections' },
{ prefix: '/connections', featureKey: 'connections' },
{ prefix: '/messages', moduleKey: 'messages' },
{ prefix: '/wallet', moduleKey: 'wallet' },
{ prefix: '/notifications', moduleKey: 'notifications' },
{ prefix: '/achievements', featureKey: 'gamification' },
{ prefix: '/leaderboard', featureKey: 'gamification' },
{ prefix: '/nexus-score', featureKey: 'gamification' },
{ prefix: '/blog', featureKey: 'blog' }
```

- [ ] **Step 2: Check either gate type**

Update `tenantFeatureGate()` so `moduleKey` checks `tenant.modules` and `featureKey` checks `tenant.features`, both through `flagEnabled()`.

- [ ] **Step 3: Run focused test to verify it passes**

Run:

```bash
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "disabled core route gates|default-off feature pages"
```

Expected: PASS for the new core gate and the existing default-off feature gate.

### Task 3: Verify and Document

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`

- [ ] **Step 1: Run focused and broad checks**

Run:

```bash
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk test -- --runInBand
```

- [ ] **Step 2: Run targeted Laravel runtime smoke**

Start a temporary Web UK process with `TENANT_ID=2`, then run `smoke:laravel` with default page sweeps disabled and a targeted `SMOKE_GATED_PAGE_PATHS` list for the changed tenant-mounted gates.

- [ ] **Step 3: Update docs with exact evidence**

Record the new core route gate coverage, unchanged 608/608 route matrix, commands run, and any remaining gaps.

- [ ] **Step 4: Commit**

Stage only the Web UK files changed by this slice and commit:

```bash
git add apps/web-uk/src/middleware/tenant-feature-gates.js apps/web-uk/tests/shared-accessible-shell.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/TENANT_ROUTING_PARITY.md apps/web-uk/docs/superpowers/plans/2026-07-09-core-tenant-route-gates.md
git commit -m "Gate Web UK core tenant routes"
```
