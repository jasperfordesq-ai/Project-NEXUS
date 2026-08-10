# Events Depth Tenant Links Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Events depth pages tenant-aware in source by routing local `/events...` links and forms through `urlFor()`.

**Architecture:** This is a Nunjucks source-conversion slice. The Express response rewriter already protects mounted responses, but these templates should be directly auditable like Laravel named routes. Tests will cover both source code and rendered `/{tenantSlug}/accessible` output.

**Tech Stack:** Express, Nunjucks, Jest, Supertest.

---

### Task 1: Add Failing Source And Render Tests

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`
- Modify: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] **Step 1: Write the failing source regression**

Add a test that reads:

```text
src/views/events/browse.njk
src/views/events/map.njk
src/views/events/polls.njk
src/views/events/recurring-edit.njk
src/views/events/translate.njk
```

Assert they do not contain raw `href="/events` or `action="/events`, and that the joined source contains `urlFor('/events`.

- [x] **Step 2: Update mounted render expectations**

In the existing Events depth render tests, add mounted `GET /acme/accessible/...` assertions for:

```text
/events/browse?category_id=4
/events/7/polls?status=polls-updated
/events/7/translate?status=translate-failed
/events/7/recurring-edit
/events/42/map
```

Assert rendered back links and form actions include `/acme/accessible/events...`.

- [x] **Step 3: Run tests to verify failure**

Run:

```powershell
npm --prefix apps/web-uk test -- --runInBand tests/template-source.test.js -t "event depth"
```

Expected: FAIL because the five templates currently contain raw `/events` links/forms.

Then run the focused shared render test selection and confirm at least one mounted expectation fails before implementation.

### Task 2: Convert Events Depth Templates

**Files:**
- Modify: `apps/web-uk/src/views/events/browse.njk`
- Modify: `apps/web-uk/src/views/events/map.njk`
- Modify: `apps/web-uk/src/views/events/polls.njk`
- Modify: `apps/web-uk/src/views/events/recurring-edit.njk`
- Modify: `apps/web-uk/src/views/events/translate.njk`

- [x] **Step 1: Replace local links**

Use `urlFor('/events')` and `urlFor('/events/' + (id | string))` for local links.

- [x] **Step 2: Replace local form actions**

Use `urlFor('/events')`, `urlFor('/events/' + (event.id | string) + '/polls')`, `urlFor('/events/' + (event.id | string) + '/recurring-edit')`, and `urlFor('/events/' + (event.id | string) + '/translate')`.

- [x] **Step 3: Keep external OpenStreetMap URLs unchanged**

Do not wrap `map.viewUrl`, `map.directionsUrl`, or the iframe `src`.

### Task 3: Verify And Document

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md`

- [x] **Step 1: Run focused tests**

Run:

```powershell
npm --prefix apps/web-uk test -- --runInBand tests/template-source.test.js -t "event depth"
npm --prefix apps/web-uk test -- --runInBand tests/shared-accessible-shell.test.js -t "events"
```

- [x] **Step 2: Run broad Web UK checks**

Run:

```powershell
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

- [x] **Step 3: Update docs**

Record that Events browse/map/polls/recurring-edit/translate templates now use `urlFor()` for local links/forms. Keep the remaining visual/runtime caveats explicit.

- [x] **Step 4: Commit only the Web UK slice**

Stage only the changed Web UK tests, templates, docs, generated route matrix if meaningfully changed, and this plan. Do not stage unrelated backend/API parity files.
