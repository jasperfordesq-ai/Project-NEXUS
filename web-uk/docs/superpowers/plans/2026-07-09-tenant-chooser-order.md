# Tenant Chooser Order Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web UK shared-root tenant chooser match Laravel Blade ordering for active non-master tenants.

**Architecture:** Laravel `AlphaController::tenantChooser()` orders tenants by `name`, while Web UK currently normalizes the Laravel API response in its received order. Keep the existing `/api/v2/tenants` data source, but sort normalized chooser communities by display name before rendering.

**Tech Stack:** Express, Nunjucks, Jest, Supertest.

---

### Task 1: Pin Laravel Tenant Chooser Ordering

**Files:**
- Modify: `apps/web-uk/tests/routes.test.js`
- Modify: `apps/web-uk/src/server.js`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`

- [x] **Step 1: Write the failing test**

Add a route test where `api.getTenants()` returns active tenants in non-alphabetical order:

```javascript
it('orders shared-root tenant chooser communities by name like Laravel Blade', async () => {
  const api = require('../src/lib/api');
  api.getTenants.mockResolvedValueOnce({
    data: [
      { id: 2, name: 'Zebra Timebank', slug: 'zebra' },
      { id: 3, name: 'Acme Timebank', slug: 'acme' }
    ]
  });

  const response = await request(app).get('/');

  expect(response.status).toBe(200);
  expect(response.text.indexOf('Acme Timebank')).toBeLessThan(response.text.indexOf('Zebra Timebank'));
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "orders shared-root tenant chooser"
```

Expected: FAIL because Web UK preserves the API response order.

- [x] **Step 3: Write minimal implementation**

Update `normalizeTenantChooserCommunities()` in `apps/web-uk/src/server.js` to sort the mapped communities by `name` using `localeCompare()`.

- [x] **Step 4: Run focused tests**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath -t "tenant chooser|shared tenant accessible mount|custom accessible domains"
```

Expected: PASS.

- [x] **Step 5: Run broader verification and docs**

Run:

```powershell
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk test -- tests/routes.test.js --runInBand --runTestsByPath
git diff --check -- apps/web-uk
```

Update tenant-routing docs with the new chooser-order evidence.

- [ ] **Step 6: Commit only Web UK files**

Run:

```powershell
git add apps/web-uk
git commit -m "Match Laravel tenant chooser ordering"
```
