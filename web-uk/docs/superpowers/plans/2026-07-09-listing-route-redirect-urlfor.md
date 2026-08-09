# Listing Route Redirect URL Helper Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert remaining legacy listing route redirects to the active Web UK tenant/custom-domain URL helper.

**Architecture:** Laravel and Web UK serve canonical shared-host accessible routes under `/{tenantSlug}/accessible` and strip that prefix on accessible custom domains. Legacy `/{tenantSlug}/alpha` requests are redirect compatibility only and must never be emitted as public links. Web UK uses `res.locals.urlFor()` as the route-local equivalent for tenant mounts, parent-domain child paths, and slugless custom-domain hosts.

**Tech Stack:** Express 4, Jest, Supertest, Nunjucks, GOV.UK Frontend.

---

### Task 1: Source Regression For Listing Redirects

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`
- Inspect: `apps/web-uk/src/routes/listings.js`

- [ ] **Step 1: Write the failing source test**

Add a test that reads `src/routes/listings.js` and rejects raw local `res.redirect('/listings...')` calls.

```javascript
it('keeps listing route redirects behind the active tenant URL helper', () => {
  const source = read('src', 'routes', 'listings.js');

  expect(source).not.toMatch(/res\.redirect\(['"`]\/listings/);
  expect(source).toMatch(/res\.locals\.urlFor/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "listing route redirects"
```

Expected: FAIL because `src/routes/listings.js` still contains raw `/listings` redirects.

### Task 2: Convert Listing Redirects

**Files:**
- Modify: `apps/web-uk/src/routes/listings.js`

- [ ] **Step 1: Add route-local helpers**

Add small helpers near the top of `listings.js`:

```javascript
function urlFor(res, path) {
  return typeof res.locals?.urlFor === 'function' ? res.locals.urlFor(path) : path;
}

function redirectTo(res, path) {
  return res.redirect(urlFor(res, path));
}
```

- [ ] **Step 2: Replace raw listing redirects**

Change create, unauthorized-edit, update, and delete redirects from raw `/listings...` paths to `redirectTo(res, ...)`.

```javascript
return redirectTo(res, '/listings');
return redirectTo(res, `/listings/${req.params.id}`);
```

- [ ] **Step 3: Run focused source test**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath -t "listing route redirects"
```

Expected: PASS.

### Task 3: Behavioral Verification

**Files:**
- Use existing tests in `apps/web-uk/tests/shared-accessible-shell.test.js`
- Use route matrix artifacts under `apps/web-uk/docs/generated`

- [ ] **Step 1: Run listing-related focused tests**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "listing"
```

Expected: PASS.

- [ ] **Step 2: Run routing source tests**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/template-source.test.js --runInBand --runTestsByPath
```

Expected: PASS.

- [ ] **Step 3: Refresh route matrix**

Run:

```powershell
npm --prefix apps/web-uk run route:matrix
```

Expected: `608` Laravel routes, `608` matched, `0` missing, `0` extra Web UK routes, `3` ignored infrastructure routes.

- [ ] **Step 4: Commit scoped files only**

Stage only:

```text
apps/web-uk/src/routes/listings.js
apps/web-uk/tests/template-source.test.js
apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md
apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md
apps/web-uk/docs/TENANT_ROUTING_PARITY.md
apps/web-uk/docs/generated/accessible-route-matrix.json
apps/web-uk/docs/generated/accessible-route-matrix.md
apps/web-uk/docs/superpowers/plans/2026-07-09-listing-route-redirect-urlfor.md
```

Do not stage unrelated ASP.NET backend test changes.
