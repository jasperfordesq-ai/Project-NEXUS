# Accessible Shared Frontend Prep Implementation Plan

Status: **Historical checkpoint — completed 2026-07-05 plan, not a current queue**

> Do not execute or resume this plan. Its older “candidate” and “ASP.NET
> accessible stack” wording is retained only as history. Read
> `../../../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for the
> current Web UK architecture, ownership boundary, safety rules, and queue.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `apps/web-uk` as the future shared accessible frontend candidate by making its shell and Explore skeleton follow the production Laravel Blade accessible frontend.

**Architecture:** Keep the ASP.NET accessible stack as Express + Nunjucks + GOV.UK Frontend, but treat Laravel `accessible-frontend/` as the visual and workflow source of truth. Add a small shell-data module so header, service navigation, footer, and Explore are driven by one reusable contract instead of hardcoded layout lists.

**Tech Stack:** Node.js, Express, Nunjucks, GOV.UK Frontend, Sass, Jest/Supertest.

---

### Task 1: Document The Accessible Frontend Direction

**Files:**
- Create: `docs/ACCESSIBLE_SHARED_FRONTEND.md`
- Modify: `docs/README.md`
- Modify: `docs/FRONTEND_PARITY.md`
- Modify: `apps/web-uk/CLAUDE.md`
- Create: `apps/web-uk/AGENTS.md`
- Create: `apps/web-uk/docs/ACCESSIBLE_SHARED_FRONTEND.md`

- [x] Record that Laravel Blade accessible is the current visual/workflow source of truth.
- [x] Record that `apps/web-uk` is the future shared accessible frontend candidate.
- [x] Record official GOV.UK upstream references and the no-government-branding rule.
- [x] Record that no production/shared readiness is claimed yet.

### Task 2: Add Shell Contract And Tests

**Files:**
- Create: `apps/web-uk/src/lib/accessible-shell.js`
- Create: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] Add nav, footer, locale, and Explore link contract data.
- [x] Add tests proving `/`, `/explore`, and `/login` render the shared shell.
- [x] Add tests proving forbidden government identity text is absent from rendered footer content.

### Task 3: Port The Laravel Accessible Shell Look

**Files:**
- Modify: `apps/web-uk/src/views/layouts/base.njk`
- Modify: `apps/web-uk/src/views/partials/footer.njk`
- Modify: `apps/web-uk/src/assets/scss/main.scss`

- [x] Replace the `govuk-header` shell with a custom `nexus-alpha-header`.
- [x] Add GOV.UK service navigation under the header.
- [x] Add the Laravel-style footer columns and AGPL/source metadata.
- [x] Port reusable `nexus-alpha-*` Sass styles from the Laravel accessible frontend.

### Task 4: Add Explore Skeleton

**Files:**
- Create: `apps/web-uk/src/routes/explore.js`
- Create: `apps/web-uk/src/views/explore.njk`
- Modify: `apps/web-uk/src/server.js`

- [x] Register `/explore`.
- [x] Render the Laravel-style caption, heading, body, card list, and live-content placeholders.
- [x] Keep the page honest: it is a skeleton for the future shared accessible frontend, not proof of route/workflow parity.

### Task 5: Verify

**Commands:**
- `npm test -- --runInBand`
- `npm run brand:check`
- `npm run build:css`
- `git diff --check`

- [x] All tests pass.
- [x] Brand guard passes.
- [x] Sass builds.
- [x] Diff has no whitespace errors.
