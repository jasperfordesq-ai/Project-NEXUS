# Explore Active Club Card Implementation Plan

> **Historical plan:** Do not execute this plan as a current queue. Read
> `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Any runtime smoke in
> this file is stateful and may run only against a separately provisioned,
> verified disposable Laravel environment, never the ordinary
> production-derived environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web UK Explore page show the Clubs card only when Laravel-backed active-club evidence exists, matching `accessible-frontend/views/explore.blade.php`.

**Architecture:** Keep the pure shell helper bootstrap-gated behavior unchanged, but override `res.locals.alphaExploreLinks` inside the signed Explore route after probing Laravel clubs with a minimal unfiltered request. If the probe fails or returns no active clubs, hide the Clubs card just like Blade's guarded DB check.

**Tech Stack:** Express route handlers, Nunjucks shell locals, Jest + Supertest, Laravel-backed API client mocks.

---

### Task 1: Pin Explore Clubs Card Behavior

**Files:**
- Modify: `tests/shared-accessible-shell.test.js`

- [x] **Step 1: Write the failing test for flat signed Explore**

Add a live club response to the existing Explore render test and assert that Web UK probes clubs and renders the card:

```javascript
api.getClubs.mockResolvedValueOnce({
  data: [{ id: 7, name: 'Velo Club', status: 'active', org_type: 'club' }]
});
```

Expected assertions:

```javascript
expect(api.getClubs).toHaveBeenCalledWith({ per_page: 1 });
expect(response.text).toContain('Clubs');
expect(response.text).toContain('href="/clubs"');
```

- [x] **Step 2: Write the failing test for tenant-mounted Explore**

Add a new test proving route-level live evidence wins even when tenant bootstrap does not expose `has_clubs`:

```javascript
it('uses live active-club evidence for tenant-mounted Explore Clubs card', async () => {
  const api = require('../src/lib/api');
  api.getTenantBootstrap.mockResolvedValueOnce({
    data: {
      id: 2,
      name: 'Acme Timebank',
      slug: 'acme',
      modules: { feed: true, listings: true, wallet: true },
      features: { connections: true, events: true, volunteering: true },
      has_clubs: false
    }
  });
  api.getExplore.mockResolvedValueOnce({ data: {} });
  api.getClubs.mockResolvedValueOnce({
    data: [{ id: 7, name: 'Velo Club', status: 'active', org_type: 'club' }]
  });

  const response = await request(app)
    .get('/acme/accessible/explore')
    .set('Cookie', signedCookieHeader());

  expect(response.status).toBe(200);
  expect(api.getClubs).toHaveBeenCalledWith({ per_page: 1 });
  expect(response.text).toContain('Clubs');
  expect(response.text).toContain('href="/acme/accessible/clubs"');
});
```

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "Explore"
```

Expected: FAIL because `api.getClubs` is not called and Clubs is absent from the Explore route output.

### Task 2: Implement Route-Level Active Club Evidence

**Files:**
- Modify: `src/routes/explore.js`

- [x] **Step 1: Import dependencies**

Change the imports to include `getClubs` and `buildExploreLinks`:

```javascript
const {
  ApiError,
  ApiOfflineError,
  getClubs,
  getExplore
} = require('../lib/api');
const { buildExploreLinks } = require('../lib/accessible-shell');
```

- [x] **Step 2: Add local helpers**

Add helpers near the other route helpers:

```javascript
function prefixExploreLinks(items, res) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return items.map((item) => ({
    ...item,
    href: urlFor(item.href)
  }));
}

function routedTenantFrom(req) {
  return req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
}

async function hasActiveClubEvidence() {
  const clubs = asList(dataFrom(await getClubs({ per_page: 1 })));
  return clubs.length > 0;
}

async function applyExploreCardEvidence(req, res) {
  let hasClubs = false;
  try {
    hasClubs = await hasActiveClubEvidence();
  } catch (error) {
    hasClubs = false;
  }

  const tenant = {
    ...routedTenantFrom(req),
    has_clubs: hasClubs
  };
  res.locals.alphaExploreLinks = prefixExploreLinks(buildExploreLinks({ tenant }), res);
}
```

- [x] **Step 3: Call the evidence helper before rendering**

After `getExplore(token)` succeeds, run:

```javascript
await applyExploreCardEvidence(req, res);
```

- [x] **Step 4: Run focused test and verify GREEN**

Run:

```bash
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand -t "Explore"
```

Expected: PASS.

### Task 3: Verify, Document, And Commit

**Files:**
- Modify: `docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Possibly modify generated route matrix timestamps from `npm run route:matrix`

- [x] **Step 1: Run broader checks**

Run:

```bash
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js --runInBand
npm run lint
npm run route:matrix
npm test -- --runInBand
```

Expected: all commands exit `0`.

- [x] **Step 2: Run a scoped Laravel smoke**

Run against a temporary or already-running Web UK process:

```bash
npm run smoke:laravel
```

Use chunking or targeted variables if the unchunked run is too slow. Expected: scoped Explore route still renders against Laravel.

- [x] **Step 3: Update docs**

Record that Explore-card active-club sourcing now has route-level Jest proof and that no-active-club route behavior remains separately covered by the Clubs route gate. Keep broader visual/manual parity and ASP.NET backend switching listed as incomplete.

- [x] **Step 4: Commit only this slice**

Stage only Web UK files touched by this slice:

```bash
git add apps/web-uk/src/routes/explore.js apps/web-uk/tests/shared-accessible-shell.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/superpowers/plans/2026-07-09-explore-active-club-card.md apps/web-uk/docs/generated/accessible-route-matrix.json apps/web-uk/docs/generated/accessible-route-matrix.md
git commit -m "Certify Explore active club card evidence"
```
