# Listing Exchange Request Tenant Links Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the listing exchange-request page's back link and no-JS POST form tenant-aware at template source, matching Laravel's `/listings/{listingId}/exchange-request` route without relying on response rewriting.

**Architecture:** Laravel registers exchange requests as `GET/POST /listings/{listingId}/exchange-request` inside the accessible route set. Web UK already implements the route and broker workflow gate; this slice converts the Nunjucks source links/forms to the shared `urlFor()` helper and adds regression coverage so shared tenant mounts and custom-domain contexts remain auditable.

**Tech Stack:** Express 4, Nunjucks, Jest, supertest, Laravel Blade accessible route source as read-only reference.

---

### Task 1: Add Red Source And Render Coverage

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Add the failing template source test**

Add a test near the existing listing source tests:

```javascript
  it('keeps listing exchange request controls behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'listings', 'exchange-request.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/listings/);
    expect(template).not.toMatch(/action="\/listings/);
    expect(template).toMatch(/urlFor\(["']\/listings\/["']\s*\+/);
    expect(template).toContain("'/exchange-request'");
  });
```

- [ ] **Step 2: Add the failing shared-mount render assertion**

Extend the existing listing exchange request render test in `tests/shared-accessible-shell.test.js` to request `/acme/accessible/listings/42/exchange-request?status=compliance-failed` and assert:

```javascript
    expect(mounted.status).toBe(200);
    expect(mounted.text).toContain('href="/acme/accessible/listings/42"');
    expect(mounted.text).toContain('method="post" action="/acme/accessible/listings/42/exchange-request"');
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "listing exchange request controls"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "renders the Laravel-backed listing exchange request form"
```

Expected: the source test fails because the template still has raw `/listings` targets; the render test should fail until the template source uses `urlFor()`.

### Task 2: Convert The Template Source

**Files:**
- Modify: `apps/web-uk/src/views/listings/exchange-request.njk`

- [ ] **Step 1: Route the back link through `urlFor()`**

Replace:

```nunjucks
<a class="govuk-back-link" href="/listings/{{ listing.id }}">Back to listings</a>
```

with:

```nunjucks
<a class="govuk-back-link" href="{{ urlFor('/listings/' + (listing.id | string)) }}">Back to listings</a>
```

- [ ] **Step 2: Route the form action through `urlFor()`**

Replace:

```nunjucks
<form method="post" action="/listings/{{ listing.id }}/exchange-request" novalidate>
```

with:

```nunjucks
<form method="post" action="{{ urlFor('/listings/' + (listing.id | string) + '/exchange-request') }}" novalidate>
```

- [ ] **Step 3: Run focused tests and verify GREEN**

Run the two focused commands from Task 1. Expected: both pass.

### Task 3: Update Documentation And Verify The Slice

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`

- [ ] **Step 1: Update docs**

Record that the listing exchange-request template now routes its back link and POST action through `urlFor()`, while live disabled-tenant broker workflow proof remains unproven.

- [ ] **Step 2: Run verification**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "listing exchange request controls"
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "renders the Laravel-backed listing exchange request form"
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

Expected: all commands exit 0. Route matrix remains `608/608` matched, `0` missing, `0` extra.

- [ ] **Step 3: Commit only this Web UK slice**

Stage only the Web UK files touched for this slice plus meaningful route-matrix generated files if their content changed beyond timestamps:

```powershell
git status --short
git diff -- apps/web-uk
git add apps/web-uk/src/views/listings/exchange-request.njk apps/web-uk/tests/template-source.test.js apps/web-uk/tests/shared-accessible-shell.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/TENANT_ROUTING_PARITY.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md
git commit -m "Certify listing exchange request tenant links"
```

Do not stage unrelated backend premium parity files.
