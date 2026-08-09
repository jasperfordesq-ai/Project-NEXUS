# Accessible Dual-Backend Preparation Implementation Plan

Status: **Historical checkpoint — completed 2026-07-05 plan, not a current queue**

> Do not execute or resume this plan. Its “candidate” framing and backend notes
> are preserved as implementation history. Read
> `../../../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for the
> current Web UK boundary and queue, and
> `../../CURRENT_ASPNET_CONTRACT_STATUS.md` for the separate backend-owned
> switching gate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `apps/web-uk` as the future shared accessible frontend candidate by mirroring the Laravel Blade shell contract, documenting route/backend compatibility, and adding safe smoke-test scaffolding.

**Architecture:** Keep shell links and labels in `src/lib/accessible-shell.js`, render them through the existing Nunjucks base/footer templates, and document Blade route/component parity in Markdown. Backend switching is prepared through contract notes and tests only; no production switch or real adapter is introduced in this pass.

**Tech Stack:** Express, Nunjucks, GOV.UK Frontend, Sass, Jest, Supertest, Markdown docs.

---

### Task 1: Mirror Blade Shell Contract

**Files:**
- Modify: `apps/web-uk/src/lib/accessible-shell.js`
- Modify: `apps/web-uk/src/views/layouts/base.njk`
- Modify: `apps/web-uk/src/views/partials/footer.njk`
- Modify: `apps/web-uk/src/assets/scss/main.scss`
- Test: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] Update service name to `Project NEXUS Accessible`.
- [x] Add Blade-derived header labels, phase text, feedback URL, report-problem URL, cookie settings URL, and source URL.
- [x] Update service navigation to match the Blade IA: Home for anonymous users, Dashboard for signed-in users, Feed, Listings, Members, Events, Volunteering, Explore for signed-in users, plus Sign in/Register for anonymous users.
- [x] Update footer columns to match Blade labels: Platform, Support, Legal.
- [x] Render report-problem and cookie-settings utility links in the footer.
- [x] Keep sign-out as a CSRF-protected POST form.
- [x] Add tests that assert the exact visible header/footer labels and key hrefs.

### Task 2: Port Explore Skeleton Closer To Blade

**Files:**
- Modify: `apps/web-uk/src/lib/accessible-shell.js`
- Modify: `apps/web-uk/src/views/explore.njk`
- Test: `apps/web-uk/tests/shared-accessible-shell.test.js`

- [x] Update Explore card candidates to the Blade order: Exchanges, AI assistant, Polls, Search, Groups, Goals, Skills, Organisations, Blog, Resources, Marketplace, Jobs, Courses, Podcasts, Coupons, Premium, Ideation, Federation, Clubs.
- [x] Keep cards as local-route placeholders where routes do not exist yet.
- [x] Add recent listings/upcoming events placeholder sections matching Blade headings.
- [x] Mark the page as preparation-only and not route/workflow certified.

### Task 3: Add Route Matrix And Component Audit Docs

**Files:**
- Create: `apps/web-uk/docs/LARAVEL_ACCESSIBLE_ROUTE_MATRIX.md`
- Create: `apps/web-uk/docs/BLADE_COMPONENT_PORT_AUDIT.md`
- Modify: `apps/web-uk/docs/ACCESSIBLE_SHARED_FRONTEND.md`
- Modify: `docs/ACCESSIBLE_SHARED_FRONTEND.md`

- [x] Document Laravel `govuk-alpha.php` and `govuk-alpha-parity` route sources.
- [x] Itemize implemented, placeholder, and missing `apps/web-uk` route families.
- [x] Document Blade shell, Explore, card list, footer, language selector, account hub, tenant logo, cookie/report utility, and module nav patterns.
- [x] State that docs are preparation scaffolding and do not certify ASP.NET readiness.

### Task 4: Add Backend Contract Notes For Future Switching

**Files:**
- Create: `apps/web-uk/docs/BACKEND_SWITCHING_CONTRACT.md`
- Modify: `apps/web-uk/CLAUDE.md`
- Modify: `apps/web-uk/README.md`

- [x] Define the future backend modes: Laravel-compatible and ASP.NET-compatible.
- [x] Document required compatibility areas: tenant resolution, auth/session, CSRF/forms, validation, uploads, redirects, errors, feature flags, localization, and realtime.
- [x] State that ASP.NET must bend to Laravel accessible behavior where the Blade frontend already defines the contract.
- [x] State that no real adapter or traffic switch is implemented in this pass.

### Task 5: Verify And Commit

**Files:**
- Test output only.

- [x] Run `npm test -- --runInBand --forceExit` in `apps/web-uk`.
- [x] Run `npm run brand:check` in `apps/web-uk`.
- [x] Run `npm run build:css` in `apps/web-uk`.
- [x] Run `git diff --check`.
- [x] Confirm only intended files are staged.
- [x] Commit with a scoped message.
