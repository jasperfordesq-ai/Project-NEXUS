# Remove Legacy Chat Router Implementation Plan

> **Historical plan:** Retained for implementation history only. Do not use it
> as a current queue; read `../../CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unmounted legacy `src/routes/chat.js` router so source audits only inspect the mounted Laravel-compatible `/chat` implementation in `src/routes/ai-chat.js`.

**Architecture:** `src/server.js` mounts `src/routes/ai-chat.js` at `/chat`. The older `src/routes/chat.js` file is not imported by the app and still contains raw root-relative redirects, which makes tenant-routing scans noisy and misleading.

**Tech Stack:** Express, Jest, route matrix generator.

---

### Task 1: Add Red Source Coverage

**Files:**
- Modify: `apps/web-uk/tests/template-source.test.js`

- [ ] **Step 1: Write the failing test**

Add a Jest case asserting that `src/routes/chat.js` does not exist and that the mounted server route still uses `ai-chat`.

- [ ] **Step 2: Run the focused test**

Run:

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "legacy chat"
```

Expected: FAIL while `src/routes/chat.js` exists.

### Task 2: Remove Dead Router

**Files:**
- Delete: `apps/web-uk/src/routes/chat.js`
- Modify docs as needed.

- [ ] **Step 1: Delete the unused file**

Remove `src/routes/chat.js`; do not touch `src/routes/ai-chat.js`.

- [ ] **Step 2: Record the cleanup**

Update current handoff and component audit docs to say the legacy unmounted chat router was removed.

### Task 3: Verify And Commit

- [ ] **Step 1: Run focused source test**

```powershell
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js -t "legacy chat"
```

- [ ] **Step 2: Run broader Web UK gates**

```powershell
npm --prefix apps/web-uk run lint
npm --prefix apps/web-uk run route:matrix
npm --prefix apps/web-uk test -- --runTestsByPath tests/template-source.test.js tests/shared-accessible-shell.test.js -t "AI chat"
```

- [ ] **Step 3: Commit only Web UK cleanup files**

Expected: route matrix remains `608/608`, with `/chat` mapped to `src/routes/ai-chat.js`.
