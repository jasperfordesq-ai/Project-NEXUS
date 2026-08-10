# Poll Source Tenant Links Implementation Plan

> **Historical plan:** Do not execute this plan as a current queue. Read
> `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` first. Any runtime smoke in
> this file is stateful and may run only against a separately provisioned,
> verified disposable Laravel environment, never the ordinary
> production-derived environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every local poll link, button target, and no-JS form action source-auditable through `urlFor()` so poll pages remain tenant-aware under shared `/accessible`, slugless custom-domain, and parent-domain child contexts.

**Architecture:** This is a Nunjucks source cleanup only. Existing poll route modules already route POST redirects through `res.locals.urlFor`; this slice moves the rendered poll controls from literal root-relative `/polls...` strings to the shared template helper used by the rest of Web UK.

**Tech Stack:** Express, Nunjucks, Jest, Web UK Laravel runtime smoke harness.

---

### Task 1: Add Red Source Coverage

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`

- [ ] **Step 1: Write the failing test**

Add a Jest case named `keeps poll browse, create, manage, rank, and detail controls behind urlFor()` that reads:

```javascript
const templates = [
  readView(path.join('polls', 'index.njk')),
  readView(path.join('polls', 'create.njk')),
  readView(path.join('polls', 'detail.njk')),
  readView(path.join('polls', 'manage.njk')),
  readView(path.join('polls', 'rank.njk'))
];
const source = templates.join('\n');

expect(source).not.toMatch(/(?:href|action)="\/polls/);
expect(source).toMatch(/urlFor\(["']\/polls/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "poll browse" --runInBand`

Expected: FAIL because `polls/*.njk` still contains literal `href="/polls...` and `action="/polls...` source strings.

### Task 2: Convert Poll Templates

**Files:**
- Modify: `apps/web-uk/src/views/polls/index.njk`
- Modify: `apps/web-uk/src/views/polls/create.njk`
- Modify: `apps/web-uk/src/views/polls/detail.njk`
- Modify: `apps/web-uk/src/views/polls/manage.njk`
- Modify: `apps/web-uk/src/views/polls/rank.njk`

- [ ] **Step 1: Replace fixed poll targets**

Use direct helper calls for fixed paths:

```nunjucks
href="{{ urlFor('/polls') }}"
action="{{ urlFor('/polls') }}"
href="{{ urlFor('/polls/parity/create') }}"
action="{{ urlFor('/polls/parity/create') }}"
href="{{ urlFor('/polls/parity/manage') }}"
```

- [ ] **Step 2: Replace dynamic poll targets**

Use string concatenation for dynamic paths:

```nunjucks
href="{{ urlFor('/polls/' + (poll.id | string)) }}"
href="{{ urlFor('/polls/' + (poll.id | string) + '/rank') }}"
href="{{ urlFor('/polls/' + (poll.id | string) + '/export') }}"
action="{{ urlFor('/polls/' + (poll.id | string) + '/vote') }}"
action="{{ urlFor('/polls/' + (poll.id | string) + '/delete') }}"
action="{{ urlFor('/polls/' + (poll.id | string) + '/like') }}"
action="{{ urlFor('/polls/' + (poll.id | string) + '/comment') }}"
action="{{ urlFor('/polls/' + (poll.id | string) + '/rank') }}"
```

- [ ] **Step 3: Run source test to verify it passes**

Run: `npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "poll browse" --runInBand`

Expected: PASS.

### Task 3: Verify Rendered Shared-Mount Behavior

**Files:**
- Modify only if needed: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [ ] **Step 1: Run existing focused poll render/action coverage**

Run: `npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "poll"`

Expected: PASS, including existing shared-mount poll action redirects and Laravel-backed poll page render coverage.

### Task 4: Update Documentation

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`

- [ ] **Step 1: Record the slice**

Add concise notes saying the poll source slice routes poll browse, create, manage, rank, detail, vote, delete, like, comment, and export controls through `urlFor()`.

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

Run a temporary or current Web UK Laravel smoke with poll paths:

```powershell
$env:WEB_UK_BASE_URL = 'http://127.0.0.1:5180'
$env:LARAVEL_BASE_URL = 'http://127.0.0.1:8088'
$env:SMOKE_MODULE_PAGE_PATHS = '/polls,/polls/parity/create,/polls/parity/manage,/polls/20,/polls/20/rank,/polls/8,/polls/4'
$env:SMOKE_BODY_TEXT_PAGE_PATHS = '/polls=>Polls,/polls/parity/create=>Create a poll,/polls/parity/manage=>Manage my polls,/polls/20=>Polls at this community,/polls/20/rank=>Polls at this community,/polls/8=>Polls at this community,/polls/4=>Polls at this community'
$env:SMOKE_UNSIGNED_AUTH_REQUIRED_PAGE_PATHS = 'none'
$env:SMOKE_UNSIGNED_LOGIN_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_GATED_PAGE_PATHS = 'none'
$env:SMOKE_REDIRECT_PAGE_PATHS = 'none'
$env:SMOKE_CONTENT_TYPE_PAGE_PATHS = 'none'
$env:SMOKE_TENANT_DOMAIN_PAGE_PATHS = 'none'
npm --prefix apps/web-uk run smoke:laravel
```

Expected: poll module/body checks pass against the Laravel backend. If port `5180` is not running, start a temporary Web UK process with `TENANT_ID=2` and use its port.

- [ ] **Step 3: Commit only this slice**

Run:

```powershell
git status --short
git add apps/web-uk/src/views/polls apps/web-uk/tests/template-source.test.js apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md apps/web-uk/docs/TENANT_ROUTING_PARITY.md apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md apps/web-uk/docs/superpowers/plans/2026-07-10-poll-source-tenant-links.md
git commit -m "Certify poll source tenant links"
```

Expected: commit succeeds without staging unrelated backend files.
