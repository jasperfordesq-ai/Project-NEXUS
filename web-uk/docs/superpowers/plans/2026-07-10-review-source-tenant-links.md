# Review Source Tenant Links Implementation Plan

> **Historical plan:** Do not execute this plan as a current queue. Read
> `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Any runtime smoke in
> this file is stateful and may run only against a separately provisioned,
> verified disposable Laravel environment, never the ordinary
> production-derived environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every local review summary, list, comments, reaction, pending-review, tab, and pagination control through `urlFor()` so review pages remain source-auditable under shared `/accessible`, slugless custom-domain, and parent-domain child contexts.

**Architecture:** This is a Nunjucks source cleanup only. Existing review POST redirects already delegate to `res.locals.urlFor`; this slice converts rendered review controls from literal root-relative paths and route-provided local hrefs to the shared template helper.

**Tech Stack:** Express, Nunjucks, Jest, Web UK Laravel runtime smoke harness.

---

### Task 1: Add Red Source Coverage

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`

- [ ] **Step 1: Write the failing test**

Add a Jest case named `keeps review summary, list, and comment controls behind urlFor()`:

```javascript
const templates = [
  path.join('reviews', 'index.njk'),
  path.join('reviews', 'list.njk'),
  path.join('reviews', 'comments.njk')
].map((templatePath) => fs.readFileSync(
  path.join(__dirname, '..', 'src', 'views', templatePath),
  'utf8'
));
const source = templates.join('\n');

expect(source).not.toMatch(/(?:href|action)="\/reviews/);
expect(source).toMatch(/urlFor\(["']\/reviews/);
expect(source).toContain('urlFor(loadMoreHref)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "review summary" --runInBand`

Expected: FAIL because `reviews/*.njk` still contains literal `href="/reviews...` and `action="/reviews...` source strings.

### Task 2: Convert Review Templates

**Files:**
- Modify: `apps/web-uk/src/views/reviews/index.njk`
- Modify: `apps/web-uk/src/views/reviews/list.njk`
- Modify: `apps/web-uk/src/views/reviews/comments.njk`

- [ ] **Step 1: Replace fixed review targets**

Use helper calls for fixed paths:

```nunjucks
href="{{ urlFor('/reviews') }}"
href="{{ urlFor('/reviews/list') }}"
action="{{ urlFor('/reviews') }}"
```

- [ ] **Step 2: Replace dynamic review targets**

Use string concatenation for dynamic review paths:

```nunjucks
href="{{ urlFor('/reviews/' + (review.id | string) + '/comments') }}"
action="{{ urlFor('/reviews/' + (review.id | string) + '/comments') }}"
action="{{ urlFor('/reviews/' + (review.id | string) + '/react') }}#review-reactions"
```

- [ ] **Step 3: Replace tab and pagination targets**

Use helper calls for list tabs and route-provided load-more hrefs:

```nunjucks
href="{{ urlFor('/reviews/list?tab=received') }}"
href="{{ urlFor('/reviews/list?tab=given') }}"
href="{{ urlFor(loadMoreHref) }}"
```

- [ ] **Step 4: Run source test to verify it passes**

Run: `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "review summary" --runInBand`

Expected: PASS.

### Task 3: Verify Focused Review Rendering

**Files:**
- Modify only if needed: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Run focused review tests**

Run: `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "review"`

Expected: PASS, including review summary, list, comments, action aliases, and shared-mount redirect coverage.

### Task 4: Update Documentation

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`

- [ ] **Step 1: Record the slice**

Add concise notes saying the review source slice routes review summary/list/comments links, tabs, pending-review forms, reaction/comment forms, and load-more links through `urlFor()`.

### Task 5: Full Verification And Commit

**Files:**
- Inspect generated route matrix files after refresh.
- Stage only Web UK files from this slice.

- [ ] **Step 1: Run verification**

Run:

```powershell
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

Expected:
- Lint exits 0.
- Route matrix reports Laravel accessible routes `608`, matched `608`, missing `0`, extra Web UK `0`.
- Jest exits 0.

- [ ] **Step 2: Run scoped Laravel smoke if Laravel is reachable**

Use a current-code Web UK process with `TENANT_ID=2` and run:

```powershell
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:<port>'
$env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'
$env:SMOKE_MODULE_PAGE_PATHS = '/reviews,/reviews/list,/reviews/18/comments'
$env:SMOKE_BODY_TEXT_PAGE_PATHS = '/reviews=>Reviews,/reviews/list=>All reviews,/reviews/18/comments=>Comments on this review'
$env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'
$env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_GATED_PAGE_PATHS = 'none'
$env:SMOKE_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'
$env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'
npm --prefix apps/web-uk run smoke:laravel
```

Expected: review module/body checks pass against the Laravel backend.

- [ ] **Step 3: Commit only this slice**

Run:

```powershell
git add apps/web-uk/src/views/reviews apps/web-uk/tests/template-source.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/TENANT_ROUTING_PARITY.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/generated/accessible-route-matrix.json apps/web-uk/docs/generated/accessible-route-matrix.md apps/web-uk/docs/superpowers/plans/2026-07-10-review-source-tenant-links.md
git commit -m "Certify review source tenant links"
```

Expected: commit succeeds without staging unrelated backend files.
