# Broker Workflow Gating Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certify Web UK listing exchange-request behavior against Laravel's broker exchange workflow gate.

**Architecture:** Laravel checks `BrokerControlConfigService::isExchangeWorkflowEnabled()` before rendering or creating listing exchange requests. Web UK should call the Laravel exchange config endpoint before listing lookup or exchange creation, redirect disabled tenants back to the listing with `status=exchange-disabled`, and leave enabled behavior unchanged.

**Tech Stack:** Express route modules, Nunjucks templates, Jest/supertest, Laravel API client helpers.

---

### Task 1: Add Failing Broker Workflow Tests

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] **Step 1: Add a signed GET disabled-workflow regression**

Add a test beside the existing listing exchange request tests:

```javascript
it('redirects listing exchange request GET when broker exchange workflow is disabled', async () => {
  const api = require('../src/lib/api');
  api.getExchangeConfig.mockResolvedValueOnce({ data: { exchange_workflow_enabled: false } });

  const response = await request(app)
    .get('/listings/42/exchange-request')
    .set('Cookie', signedCookieHeader());

  expect(response.status).toBe(302);
  expect(response.headers.location).toBe('/listings/42?status=exchange-disabled');
  expect(api.getExchangeConfig).toHaveBeenCalledWith('test-token');
  expect(api.callListingApi).not.toHaveBeenCalledWith('test-token', 'GET', '/42');
  expect(api.callWalletApi).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Add a signed POST disabled-workflow regression**

Add a test beside the existing listing action aliases:

```javascript
it('redirects listing exchange request POST before create when broker exchange workflow is disabled', async () => {
  const api = require('../src/lib/api');
  api.getExchangeConfig.mockResolvedValueOnce({ data: { exchange_workflow_enabled: false } });

  const agent = request.agent(app);
  const form = await agent
    .get('/contact')
    .set('Cookie', signedCookieHeader());
  const csrf = form.text.match(/name="_csrf" value="([^"]+)"/);

  const response = await agent
    .post('/listings/42/exchange-request')
    .set('Cookie', signedCookieHeader())
    .type('form')
    .send({
      _csrf: csrf[1],
      proposed_hours: '2',
      message: 'Could you help?'
    });

  expect(response.status).toBe(302);
  expect(response.headers.location).toBe('/listings/42?status=exchange-disabled');
  expect(api.getExchangeConfig).toHaveBeenCalledWith('test-token');
  expect(api.createExchangeRequest).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Run focused tests to verify RED**

Run:

```powershell
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "broker exchange workflow is disabled|listing exchange request" --runInBand
```

Expected: the new disabled-workflow tests fail because `listings.js` does not call `getExchangeConfig()` before rendering or creating the exchange request.

### Task 2: Implement Minimal Laravel-Aligned Gate

**Files:**
- Modify: `apps/web-uk/src/routes/listings.js`

- [x] **Step 1: Import `getExchangeConfig`**

Add the helper to the existing API destructuring:

```javascript
const {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
  callListingApi,
  createExchangeRequest,
  getExchangeConfig,
  createComment,
  getComments,
  toggleFeedLike,
  createReport,
  callWalletApi,
  getProfile
} = require('../lib/api');
```

- [x] **Step 2: Add a small workflow helper**

Add near the existing listing helper functions:

```javascript
async function exchangeWorkflowEnabled(token) {
  const payload = await getExchangeConfig(token);
  const data = dataFrom(payload) || {};
  return data.exchange_workflow_enabled !== false;
}
```

- [x] **Step 3: Gate POST before creating the exchange**

Inside `router.post('/:listingId(\\d+)/exchange-request'...)`, after `listingId` is parsed and before building the payload:

```javascript
  const enabled = await exchangeWorkflowEnabled(token);
  if (!enabled) {
    return redirectTo(res, listingRedirect(listingId, 'exchange-disabled'));
  }
```

- [x] **Step 4: Gate GET before listing/profile/wallet lookup**

Inside `router.get('/:listingId(\\d+)/exchange-request'...)`, after `listingId` is parsed and before `Promise.all([...])`:

```javascript
  const enabled = await exchangeWorkflowEnabled(token);
  if (!enabled) {
    return redirectTo(res, listingRedirect(listingId, 'exchange-disabled'));
  }
```

- [x] **Step 5: Run focused tests to verify GREEN**

Run:

```powershell
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "broker exchange workflow is disabled|listing exchange request|listing action aliases" --runInBand
```

Expected: disabled-workflow tests pass, existing enabled exchange request behavior still passes.

### Task 3: Update Certification Docs And Verify

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Modify: `apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md`

- [x] **Step 1: Update docs**

Record that broker workflow gating now has focused Jest proof for listing exchange-request GET/POST. Keep ASP.NET backend switching marked future/not-certified.

- [ ] **Step 2: Run verification**

Run:

```powershell
npm run lint
npm run route:matrix
npm test -- --runTestsByPath tests/shared-accessible-shell.test.js -t "broker exchange workflow is disabled|listing exchange request|listing action aliases" --runInBand
```

Expected:
- lint exits 0;
- route matrix remains `608` matched, `0` missing, `0` extra Web UK routes;
- focused Jest passes.

- [ ] **Step 3: Stage narrowly and commit**

Run:

```powershell
git status --short
git add apps/web-uk/src/routes/listings.js apps/web-uk/tests/shared-accessible-shell.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md apps/web-uk/docs/superpowers/plans/2026-07-10-broker-workflow-gating.md
git diff --cached --stat
git commit -m "Certify broker exchange workflow gates"
```

Expected: only Web UK broker-workflow slice files are staged. Pre-existing unrelated backend/root docs changes are not included.
