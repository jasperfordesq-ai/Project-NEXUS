# Route Specific Compound Tenant Gates Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Web UK return Laravel-style 403 responses for route-specific compound feature gates proven by Laravel Blade controller source.

**Architecture:** Keep Web UK's central tenant gate middleware as the only route-level feature gate. Extend it from a single first-match prefix gate to an all-matching gate list so broad gates and route-specific gates can both apply to the same request. Preserve Laravel's default-enabled semantics for omitted module/feature keys except for existing default-off gates already represented in the table.

**Tech Stack:** Express middleware, Jest/Supertest, Nunjucks error rendering, Laravel source reference under `C:\platforms\htdocs\staging`.

---

### Task 1: Pin Laravel Compound Gates With A Failing Test

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Write the failing test**

Add a test after the disabled core route-gate test:

```javascript
it('returns Laravel-style 403 for tenant-mounted route-specific compound gates', async () => {
  const api = require('../src/lib/api');
  const tenantBootstrap = {
    data: {
      id: 2,
      name: 'Acme Timebank',
      slug: 'acme',
      modules: {
        messages: true
      },
      features: {
        connections: false,
        events: true,
        job_vacancies: false,
        maps: false,
        volunteering: true
      }
    }
  };

  const paths = [
    '/acme/accessible/events/6/map',
    '/acme/accessible/organisations/42/jobs',
    '/acme/accessible/messages/groups/new'
  ];

  for (let index = 0; index < paths.length; index += 1) {
    api.getTenantBootstrap.mockResolvedValueOnce(tenantBootstrap);
  }

  for (const path of paths) {
    const response = await request(app)
      .get(path)
      .set('Cookie', signedCookieHeader());

    expect(response.status).toBe(403);
    expect(response.text).toContain('Forbidden');
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "route-specific compound tenant gates"
```

Expected: FAIL because at least one of the three routes continues past the middleware instead of returning 403.

### Task 2: Implement All-Matching Route Gates

**Files:**
- Modify: `apps/web-uk/src/middleware/tenant-feature-gates.js`

- [ ] **Step 3: Add specific route patterns and all-match gate lookup**

Add these gate entries before the broad prefix gates:

```javascript
{ pattern: /^\/events\/[^/]+\/map\/?$/, featureKey: 'maps' },
{ pattern: /^\/organisations\/[^/]+\/jobs\/?$/, featureKey: 'job_vacancies' },
{ pattern: /^\/messages\/groups(?:\/|$)/, featureKey: 'connections' },
```

Replace the single-gate lookup with a helper that returns every matching gate:

```javascript
function pathMatchesGate(pathname, gate) {
  if (gate.pattern) {
    return gate.pattern.test(pathname);
  }

  return pathMatchesPrefix(pathname, gate.prefix);
}

function routeGatesForPath(pathname = '') {
  return FEATURE_ROUTE_GATES.filter((gate) => pathMatchesGate(pathname, gate));
}
```

Loop through each matched gate in `tenantFeatureGate`, returning the same 403 error render on the first disabled required module or feature.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "route-specific compound tenant gates|disabled core route gates|default-off feature pages"
```

Expected: PASS for the selected gate tests.

### Task 3: Verify And Document The Slice

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`

- [ ] **Step 5: Run broad verification**

Run:

```bash
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

Expected: all commands exit 0.

- [ ] **Step 6: Update docs**

Document that the route-specific compound gate slice now covers:

- `/events/{id}/map` requiring `events` plus `maps`
- `/organisations/{id}/jobs` requiring `volunteering` plus `job_vacancies`
- `/messages/groups...` requiring `messages` plus `connections`

Keep visual/manual Blade parity, message translation, active-club evidence, broker workflow gating, and ASP.NET backend switching listed as remaining certification work.

- [ ] **Step 7: Commit the verified slice**

Stage only Web UK files changed by this slice and commit:

```bash
git add apps/web-uk/src/middleware/tenant-feature-gates.js apps/web-uk/tests/shared-accessible-shell.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/generated/accessible-route-matrix.json apps/web-uk/docs/generated/accessible-route-matrix.md apps/web-uk/docs/superpowers/plans/2026-07-09-route-specific-compound-tenant-gates.md
git commit -m "Gate Web UK compound tenant routes"
```
