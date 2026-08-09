# Message Translation Policy Implementation Plan

> **Historical plan:** Do not execute this plan as a current queue. Read
> `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Any runtime smoke in
> this file is stateful and may run only against a separately provisioned,
> verified disposable Laravel environment, never the ordinary
> production-derived environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Laravel Blade accessible message translation feature-gate behavior in Web UK.

**Architecture:** Laravel direct messages and federation messages only expose or execute per-message translation when `TenantContext::hasFeature('message_translation')` is true. Web UK already has tenant bootstrap data on `req.accessibleRouting.tenant` and shared `flagEnabled()` defaults; route handlers should short-circuit disabled translation before calling Laravel APIs, and the federation conversation page should hide translate forms when disabled.

**Tech Stack:** Express 4, Nunjucks, Jest, Supertest.

---

### Task 1: Disabled Translation Regression

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Write the failing test**

Add focused tests proving a tenant with `features.message_translation = false` does not call direct/federation translation APIs and redirects with Laravel's `translate-unavailable` status.

```javascript
it('returns Laravel unavailable redirects when tenant message translation is disabled', async () => {
  const cookieSignature = require('cookie-signature');
  const api = require('../src/lib/api');
  api.getTenantBootstrap.mockResolvedValue({
    data: {
      id: 2,
      name: 'Acme Timebank',
      slug: 'acme',
      modules: { messages: true },
      features: { federation: true, message_translation: false }
    }
  });

  const signedToken = `s:${cookieSignature.sign('test-token', process.env.COOKIE_SECRET)}`;
  const agent = request.agent(app);
  const first = await agent.get('/acme/accessible/contact').set('Cookie', `token=${encodeURIComponent(signedToken)}`);
  const csrfMatch = first.text.match(/name="_csrf" value="([^"]+)"/);
  api.callMessageApi.mockClear();
  api.callFederationApi.mockClear();

  const direct = await agent
    .post('/acme/accessible/messages/77/m/12/translate')
    .set('Cookie', `token=${encodeURIComponent(signedToken)}`)
    .type('form')
    .send({ _csrf: csrfMatch[1], target_language: 'ga' });

  expect(direct.status).toBe(302);
  expect(direct.headers.location).toBe('/acme/accessible/messages/77?status=translate-unavailable#m-12');
  expect(api.callMessageApi).not.toHaveBeenCalledWith('test-token', 'POST', '/12/translate', expect.anything());

  const federation = await agent
    .post('/acme/accessible/federation/messages/translate/33')
    .set('Cookie', `token=${encodeURIComponent(signedToken)}`)
    .type('form')
    .send({ _csrf: csrfMatch[1], partner_id: '77', partner_tenant_id: '12', target_language: 'ga' });

  expect(federation.status).toBe(302);
  expect(federation.headers.location).toBe('/acme/accessible/federation/messages/conversation/77?tenant_id=12&status=translate-unavailable#message-33');
  expect(api.callFederationApi).not.toHaveBeenCalledWith('test-token', 'POST', '/messages/33/translate', expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "message translation is disabled"
```

Expected: FAIL because Web UK still calls the translation APIs and redirects with `translate-done`.

### Task 2: Hide Federation Translate Forms

**Files:**
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`
- Modify: `apps/web-uk/src/routes/federation.js`

- [ ] **Step 1: Add render regression**

Add a focused assertion that the federation conversation page does not render `/federation/messages/translate/{id}` forms when tenant `message_translation` is false.

- [ ] **Step 2: Implement route render flag**

Import `flagEnabled` from `../lib/accessible-shell` in `src/routes/federation.js`, add a small `tenantFeatureEnabled(req, key, fallback)` helper, and render `translateEnabled` from that helper instead of hard-coded `true`.

### Task 3: Route Short-Circuit Implementation

**Files:**
- Modify: `apps/web-uk/src/routes/messages.js`
- Modify: `apps/web-uk/src/routes/federation-actions.js`

- [ ] **Step 1: Add tenant feature helper**

Import `flagEnabled` from `../lib/accessible-shell` and add:

```javascript
function tenantFeatureEnabled(req, key, fallback = true) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return fallback;
  return flagEnabled(tenant, key, 'features', fallback);
}
```

- [ ] **Step 2: Short-circuit direct message translate**

Before reading `target_language` or calling `callMessage()`, return:

```javascript
return res.redirect(messageRedirect(userId, 'translate-unavailable', `#m-${messageId}`));
```

when `message_translation` is false.

- [ ] **Step 3: Short-circuit federation message translate**

After valid partner IDs and before calling `callFederation()`, return:

```javascript
return redirectTo(res, conversationRedirect(partnerId, partnerTenantId, 'translate-unavailable', `#message-${id}`));
```

when `message_translation` is false.

### Task 4: Verification And Commit

**Files:**
- Update: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Update: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Update: `apps/web-uk/docs/generated/accessible-route-matrix.json`
- Update: `apps/web-uk/docs/generated/accessible-route-matrix.md`

- [ ] **Step 1: Run focused disabled/enabled tests**

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "message translation is disabled|Laravel message action aliases|Laravel federation action aliases|Federation conversation"
```

- [ ] **Step 2: Run broad verification**

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

- [ ] **Step 3: Run targeted Laravel smoke**

Start a temporary Web UK process with `TENANT_ID=2`, then run:

```powershell
$env:SMOKE_MODULE_PAGE_PATHS = '/messages/77,/federation/messages'
$env:SMOKE_BODY_TEXT_PAGE_PATHS = 'none'
$env:SMOKE_GATED_PAGE_PATHS = 'none'
$env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'
$env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'
$env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'
npm --prefix apps/web-uk run smoke:laravel
```

- [ ] **Step 4: Commit scoped files only**

Commit only Web UK files touched by this slice. Do not stage unrelated ASP.NET backend files.
