# Group Depth Tenant Links Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **Stateful-command fence:** The signed Laravel smoke below is historical, not
> standing authorization. It may run only against a separately provisioned and
> verified disposable Laravel application, database, and storage environment.
> Never point it at the ordinary `127.0.0.1:8088` environment or its
> confidential production-derived database.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert remaining group discussion, invite, image, notification, and management links/forms/redirects to the active tenant-aware URL helper.

**Architecture:** Keep the existing Express/Nunjucks route family and template structure. Replace source-level root-relative group/member URLs with `urlFor()` in templates, and route group redirects through `res.locals.urlFor` so shared `/{tenantSlug}/accessible`, custom-domain, and parent-domain child contexts do not rely on response rewriting.

**Tech Stack:** Express 4, Nunjucks, Jest, Supertest, GOV.UK Frontend.

---

### Task 1: Add Source Regression Tests

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`
- Test: `apps/web-uk/tests/template-source.test.js`

- [ ] **Step 1: Write the failing source tests**

Add tests proving the selected group templates no longer contain raw `/groups` or `/members` `href`/`action` targets and the group route module no longer redirects to raw `/groups...` paths.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "group depth|group route redirects" --runInBand
```

Expected: FAIL because the selected group templates still contain raw `/groups` and `/members` links/forms, and `src/routes/groups.js` still redirects to raw `/groups...` paths.

### Task 2: Convert Group Templates

**Files:**
- Modify: `apps/web-uk/src/views/groups/announcement-edit.njk`
- Modify: `apps/web-uk/src/views/groups/discussion-create.njk`
- Modify: `apps/web-uk/src/views/groups/discussion-detail.njk`
- Modify: `apps/web-uk/src/views/groups/discussions.njk`
- Modify: `apps/web-uk/src/views/groups/image.njk`
- Modify: `apps/web-uk/src/views/groups/invite.njk`
- Modify: `apps/web-uk/src/views/groups/manage.njk`
- Modify: `apps/web-uk/src/views/groups/notifications.njk`

- [ ] **Step 1: Replace root-relative local links/forms with `urlFor()`**

Use this pattern:

```nunjucks
{{ urlFor('/groups/' + (group.id | string) + '/discussions') }}
{{ urlFor('/groups/' + (group.id | string) + '/members/' + (member.id | string)) }}
{{ urlFor('/members/' + (member.id | string)) }}
```

- [ ] **Step 2: Run the group-depth source test**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "group depth" --runInBand
```

Expected: PASS for the template-source test.

### Task 3: Convert Group Route Redirects

**Files:**
- Modify: `apps/web-uk/src/routes/groups.js`

- [ ] **Step 1: Route redirect helpers through `res.locals.urlFor`**

Add a local URL helper and pass `res` into group redirect helper calls so all local group redirect destinations stay inside the active tenant/custom-domain context.

- [ ] **Step 2: Run the group-route redirect source test**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "group route redirects" --runInBand
```

Expected: PASS.

### Task 4: Verify And Document

**Files:**
- Modify: `apps/web-uk/docs/CURRENT_WEB_UK_HANDOFF.md`
- Modify: `apps/web-uk/docs/TENANT_ROUTING_PARITY.md`
- Modify: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`

- [ ] **Step 1: Run focused render/action coverage**

Run:

```powershell
npm --prefix apps/web-uk test -- tests/shared-accessible-shell.test.js --runInBand --runTestsByPath -t "group invite|group notification|group image|group discussions|submits Laravel group"
```

- [ ] **Step 2: Run broad Web UK verification**

Run:

```powershell
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runInBand
```

- [ ] **Step 3: Run scoped Laravel smoke**

Start a temporary Web UK process with `TENANT_ID=2`, then run a scoped smoke for `/groups/484/invite`, `/groups/484/notifications`, `/groups/484/image`, `/groups/484/manage`, `/groups/484/discussions`, and `/groups/484/discussions/new`.

- [ ] **Step 4: Commit only the Web UK slice**

Stage only Web UK files and leave unrelated backend dirty files unstaged.
