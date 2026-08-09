# Tenant Feature Route Gates Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Web UK return Laravel-style `403` responses for tenant-mounted default-off accessible route families when Laravel tenant bootstrap omits or disables those feature flags.

**Architecture:** Reuse the Laravel-aligned defaults already in `src/lib/accessible-shell.js`, add a small Express middleware after shell locals are built, and gate only known Laravel `TenantContext::hasFeature()` route prefixes in tenant contexts. This keeps route behavior moving toward Laravel Blade without changing flat local development routes unnecessarily.

**Tech Stack:** Express, Nunjucks, Jest, Supertest, Laravel Blade source as read-only reference.

---

### Task 1: Pin Default-Off Feature Route Gates

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] **Step 1: Write the failing test**

Add a focused test near `uses Laravel tenant feature defaults for tenant-mounted Explore cards`:

```javascript
  it('returns Laravel-style 403 for tenant-mounted default-off feature pages', async () => {
    const api = require('../src/lib/api');
    api.getTenantBootstrap.mockResolvedValue({
      data: {
        id: 2,
        name: 'Acme Timebank',
        slug: 'acme',
        modules: {
          feed: true,
          listings: true,
          wallet: true
        },
        features: {
          connections: true,
          events: true,
          volunteering: true
        }
      }
    });

    const paths = [
      '/acme/accessible/marketplace',
      '/acme/accessible/courses',
      '/acme/accessible/podcasts',
      '/acme/accessible/coupons',
      '/acme/accessible/premium'
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

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "tenant-mounted default-off feature pages"
```

Expected: FAIL because at least one default-off route currently renders or redirects instead of returning `403`.

### Task 2: Implement Route Gate Middleware

**Files:**
- Modify: `apps/web-uk/src/lib/accessible-shell.js`
- Create: `apps/web-uk/src/middleware/tenant-feature-gates.js`
- Modify: `apps/web-uk/src/server.js`

- [x] **Step 1: Export existing flag helpers**

Export `flagEnabled`, `featureDefaults`, and `moduleDefaults` from `accessible-shell.js`.

- [x] **Step 2: Add middleware**

Create `tenant-feature-gates.js` with a prefix map for:

```javascript
[
  { prefix: '/marketplace', featureKey: 'marketplace' },
  { prefix: '/courses', featureKey: 'courses' },
  { prefix: '/podcasts', featureKey: 'podcasts' },
  { prefix: '/coupons', featureKey: 'merchant_coupons' },
  { prefix: '/premium', featureKey: 'member_premium' }
]
```

If `req.accessibleRouting.tenant` exists and the matched feature is disabled by `flagEnabled(tenant, key, 'features', true)`, render `errors/403`.

- [x] **Step 3: Register middleware**

Import and use the middleware in `src/server.js` immediately after common shell locals are created and before page routes are mounted.

### Task 3: Verify And Document

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`

- [x] **Step 1: Run focused green tests**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "tenant-mounted default-off feature pages|uses Laravel tenant feature defaults"
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "shared tenant accessible mount"
```

- [x] **Step 2: Run broad verification**

Run:

```powershell
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

- [x] **Step 3: Update docs and commit**

Document the focused red/green result, route matrix result, and remaining certification gaps. Stage only `apps/web-uk` files and commit with:

```powershell
git add apps/web-uk
git commit -m "Gate Web UK tenant feature pages"
```
