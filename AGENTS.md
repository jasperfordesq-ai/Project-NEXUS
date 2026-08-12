# Project NEXUS — Agent Guide

Universal guide for all AI coding agents (Claude Code, Codex, GitHub Copilot, Cursor, etc.).
This is the single source of truth for project conventions, rules, and workflows.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Project** | Project NEXUS - Timebanking Platform |
| **License** | AGPL-3.0-or-later (open source) |
| **GitHub Repo** | <https://github.com/jasperfordesq-ai/Project-NEXUS> |
| **Frontend Stack** | React 19 + TypeScript + HeroUI v3 + Tailwind CSS 4 |
| **PHP Version** | 8.2+ (API backend only) |
| **Database** | MariaDB 10.11 (MySQL compatible) |
| **Cache** | Redis 7+ |
| **Production Server** | Azure VM — see `.secrets.local/deploy.env` (`PROD_SSH_HOST`) |
| **React Frontend URL** | <https://app.project-nexus.ie> |
| **Accessible Frontend URL** | <https://accessible.project-nexus.ie> |
| **PHP API URL** | <https://api.project-nexus.ie> |
| **Sales Site URL** | <https://project-nexus.ie> |
| **Test Tenant** | `hour-timebank` (tenant 2) |

---

## Project Overview

Project NEXUS is an enterprise **multi-tenant community platform** with timebanking, enabling communities to exchange services using time credits.

**Core Modules:** Feed, Listings, Messages, Events, Groups, Members, Connections, Wallet, Volunteering, Organizations, Blog, Resources, Goals, Matches, Reviews, Search, Leaderboard, Achievements, Help, AI Chat.

**Platform Features:** Multi-tenant architecture, gamification (badges, XP, challenges), federation, real-time WebSockets (Pusher), push notifications (FCM), light/dark theme, PWA, and two separate native paths — a Capacitor wrapper around the React web app, and a distinct Expo / React Native client in `mobile/`. Those are different codebases; do not treat "the mobile app" as one thing. 🔴 The Capacitor native project directory `capacitor/` is **not in this repo** — it was removed in `df8bf84d6` and is gitignored (`.gitignore:176`), so it is machine-local. Only `react-frontend/src/types/capacitor.d.ts` and the Capacitor-aware hooks are public. Do not assume `capacitor/` exists in a fresh clone.

**Federation is two things.** Internal cross-tenant federation (communities on one installation) is live and ungated by design. External partner federation (other installations, other platforms) is built and tested but **switched off by default** and has been off in production since 2026-07-27, with no partner connected — see the kill-switch rules below and `docs/FEDERATION_API_MANUAL.md`.

**Infrastructure:** The web server is **Apache** (not nginx) running on Plesk/Azure. Do not assume nginx for any server configuration tasks.

---

## Directory Structure

```text
project-nexus/
├── react-frontend/               # React 19 + HeroUI v3 + Tailwind CSS 4 SPA (PRIMARY UI)
│   ├── src/                      # components/, contexts/, pages/, lib/, hooks/, styles/, types/
│   ├── CLAUDE.md                 # React frontend conventions
│   └── package.json
├── app/                          # PHP source — Laravel 12 (PSR-4: App\)
│   ├── Http/Controllers/Api/     # V2 API controllers (for React)
│   ├── Http/Middleware/          # Tenant, auth, CORS middleware
│   ├── Services/                 # Business logic (220+ services)
│   ├── Models/                   # Eloquent models
│   ├── Listeners/                # Event listeners
│   └── Core/                     # Legacy helpers (TenantContext, ImageUploader)
├── views/                        # PHP admin templates only (DEAD — see rules below)
├── httpdocs/                     # Web root (index.php, routes.php, health.php)
├── tests/                        # PHPUnit tests
├── migrations/                   # SQL migration files
├── scripts/                      # Build, deploy, maintenance
├── docs/                         # Documentation
├── compose.yml                   # Docker Compose (primary dev env)
└── Dockerfile                    # PHP app container
```

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [react-frontend/CLAUDE.md](react-frontend/CLAUDE.md) | React frontend stack conventions, contexts, hooks, pages |
| [docs/README.md](docs/README.md) | Public documentation index and publication standards |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Maintained platform architecture map and major runtime boundaries |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide (public-safe; secrets stay in local env files) |
| [docs/REACT-DUAL-BACKEND.md](docs/REACT-DUAL-BACKEND.md) | React dual-backend guardrails: Laravel production/default, ASP.NET development-only until contract-compatible |
| [docs/PLATFORM-MONOREPO.md](docs/PLATFORM-MONOREPO.md) | Monorepo boundaries, provenance, deployment isolation, and contract-work commands |
| [docs/govuk-alpha/RESEARCH.md](docs/govuk-alpha/RESEARCH.md) | GOV.UK-based accessible frontend architecture, official repos, licensing, and branding limits |
| [LARAVEL_MIGRATION_PLAN.md](LARAVEL_MIGRATION_PLAN.md) | Historical Laravel migration record and current backend migration guidance |
| `BACKUP.md` (local-only, gitignored) | Full backup system and private backup-remote workflow for machine transfers |

> Note: `docs/` is public documentation. Local prompts, scratch reports, handoffs, and stale generated artifacts belong in `.local-docs-archive/`, which is gitignored. PHP_CONVENTIONS / API_REFERENCE / REGRESSION_PREVENTION / QA_AUDIT_AND_TEST_PLAN / LOCAL_DEV_SETUP have been retired — follow existing code patterns in `app/Services/` and `routes/api.php` instead.

### Documentation Hygiene

`docs/` must stay small, public-safe, and maintained. Do not write routine prompts, plans, handoffs, audit dumps, generated reports, exported PDFs, screenshots, or scratch notes into `docs/`, including `docs/superpowers/plans/`. Put local task output in `.local-docs-archive/` instead.

Every public doc must be Markdown, linked from [docs/README.md](docs/README.md), and pass:

```bash
npm run check:docs
```

### Version and Changelog Hygiene

`VERSION` is the canonical platform semantic version. Keep it in sync with `composer.json`, `react-frontend/package.json`, `config/app.php`, `README.md`, `CHANGELOG.md`, `react-frontend/src/config/releaseStatus.ts`, and current public collateral. Verify with:

```bash
npm run check:version
```

For every release-relevant change (code, config, scripts, CI, public docs, user-visible behaviour, or release/version metadata), update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]` before finishing. Then refresh the in-app bundled copy:

```bash
npm --prefix react-frontend run copy-changelog
```

If a change genuinely needs no release note, state that explicitly in the final response. Do not silently skip the changelog.

---

## Local Development (Docker-First)

| Service | URL |
|---------|-----|
| **React Frontend** | http://127.0.0.1:5173 |
| **PHP API** | http://127.0.0.1:8090 |
| **React Admin** | http://127.0.0.1:5173/admin |
| **Docker DB** | 127.0.0.1:3307 -> MariaDB 3306 |
| **Docker Redis** | 127.0.0.1:6379 |
| **Meilisearch** | http://127.0.0.1:7700 |

```bash
npm run dev:docker      # Start Docker PHP, database, Redis, Meilisearch, and native Vite
npm run dev:frontend    # Start only native Vite on http://127.0.0.1:5173
npm run dev:accessible-frontend  # Start accessible frontend dev server
```

**Important:** Project NEXUS is Docker-first for local development. The Laravel/PHP API runs in the Docker PHP app on `127.0.0.1:8090`; MariaDB, Redis, and Meilisearch run from the same Compose stack. The default frontend workflow uses native Vite on Windows for fast HMR, proxying `/api` to the Docker PHP app. Use the Docker frontend profile only when deliberately testing the frontend container.

Docker queue, sales, and frontend are opt-in profiles:

```bash
docker compose --profile docker-php up -d app
docker compose --profile docker-frontend up -d frontend
```

### WebAuthn / Passkeys — Windows Dev Environment

**RP ID is derived per tenant.** `WebAuthnController::getRpId()` reads the request's `Origin` header and validates it against the tenant's registered domains (`tenants.domain`, `tenants.accessible_domain`) plus the platform default — a tenant on a custom domain (e.g. `hour-timebank.ie`) gets its own domain as RP ID, because WebAuthn requires the RP ID to be a registrable suffix of the page's domain. Slug-only sub-tenants (no domain, `parent_id` set — e.g. `stratford` served at `uk.timebank.global/stratford`) inherit the parent tenant's domains as valid RP IDs; credentials stay tenant-scoped in `webauthn_credentials`, so a shared RP ID cannot cross-authenticate tenants. Passkeys are scoped to the RP ID they were registered under, so a passkey created on `app.project-nexus.ie` does not work on a tenant custom domain and vice versa.
- `WEBAUTHN_RP_ID` is the **platform default**, used for `*.project-nexus.ie` origins and as the fallback for unrecognised origins: `project-nexus.ie` in production (set as a container env var, not in compose files), `localhost` in local dev
- The `HTTP_HOST` code fallback (when `WEBAUTHN_RP_ID` is unset) sees the **API** host, never the frontend's custom domain — do not rely on it in production
- Regression tests: `tests/Laravel/Feature/Controllers/WebAuthnControllerTest.php` (RP ID derivation section)

**Windows Hello requirement:** Chrome uses the native Windows WebAuthn API which requires `WbioSrvc` (Windows Biometric Service) to be **running** at the moment the passkey dialog opens. This service idles down and stops automatically — if it's stopped, Chrome's "Choose a passkey" dialog will show NO "This Windows device" / Windows Hello option.

**Fix:** Run `scripts/setup-wbio-keepalive.ps1` once as Administrator on your dev machine. This sets service auto-recovery and a scheduled task to restart WbioSrvc every 5 minutes.
- Manual restart: `Start-Service WbioSrvc` in PowerShell
- Check status: `(Get-Service WbioSrvc).Status`

**If "This Windows device" never appears in Chrome's passkey dialog:**
The NGC folder (`%LOCALAPPDATA%\Microsoft\Ngc`) must exist — this is where Windows Hello credentials are stored. If it doesn't exist, Windows Hello is NOT enrolled and Chrome has no platform authenticator to offer.
- Diagnostic: `Test-Path "$env:LOCALAPPDATA\Microsoft\Ngc"` — must be `True`
- Fix: Open Settings > Accounts > Sign-in options > PIN (Windows Hello) and set it up. A regular Windows sign-in PIN is NOT the same as Windows Hello PIN and does NOT support WebAuthn.
- WbioSrvc stops immediately when no biometric hardware and no NGC credentials exist — this is a symptom of the above, not the cause.

**Key files:**
- `react-frontend/src/lib/webauthn.ts` — all WebAuthn frontend logic (SimpleWebAuthn wrapper)
- `react-frontend/src/components/security/BiometricSettings.tsx` — passkey settings UI
- `app/Http/Controllers/Api/WebAuthnController.php` — registration/auth endpoints
- `app/Services/WebAuthnChallengeStore.php` — Redis/file challenge storage

---

## LARAVEL MIGRATION — STATUS

The Laravel migration has been **merged to `main`** (2026-03-19) and is live in production. The `laravel-migration` branch no longer exists.

- **Phases 0–5 are complete**: Laravel 12.54 is the sole HTTP handler, routing, middleware, controllers, and auth
- **All 223 services are native Laravel implementations** — zero stubs remain (47 converted + 45 dead stubs deleted on 2026-03-21)
- **Legacy top-level `src/` directory has been fully removed** — all PHP now lives in `app/` (PSR-4 `App\`); there is no longer a `Nexus\` autoload namespace. `app/Core/ImageUploader.php` is the last remaining legacy-style helper.
- **5 Event Listeners** in `app/Listeners/` are fully implemented (completed 2026-03-21)
- All new schema changes use Laravel migrations in `database/migrations/` (5 Laravel, 190 legacy SQL)
- See [LARAVEL_MIGRATION_PLAN.md](LARAVEL_MIGRATION_PLAN.md) for the historical migration record and current schema-migration guidance.

---

## MANDATORY RULES

### 🔴 PRIORITIZE PUBLIC REPOSITORIES & SHARED COMPONENTS

When upgrading this platform, ALWAYS look through public repositories for the best available shared components before writing custom code. **Your 1st priority must ALWAYS be using HeroUI and Tailwind CSS shared components.** It is highly preferable to use established, working components rather than building custom variations from scratch.

---

### 🔴 NO HARDCODED STRINGS — ALL USER-FACING TEXT MUST USE TRANSLATIONS (CRITICAL)

**NEVER write hardcoded English strings in email templates or end-user React frontend output.** This has regressed repeatedly — every new feature ships with inline English, making the platform untranslatable.

**Rules:**
- **PHP emails/services:** Every user-facing string MUST use `__('emails.section.key')` with keys in `lang/en/emails.json`
- **React frontend (end-user UI):** Every label MUST use `t('key')` with keys in the appropriate namespace — applies to everything under `react-frontend/src/pages/`, `src/components/`, etc.
- **When adding a new email:** Add ALL translation keys to `lang/en/emails.json` FIRST, then reference them with `__()`

**What counts as hardcoded:** Subject lines, greetings ("Hi {name},"), button text ("View Profile"), footer text ("All rights reserved"), info card labels, body paragraphs, notice text, page titles. All of these must be translated — in emails, React frontend, and the admin panel.

**CI enforcement:** `scripts/check-i18n.sh` runs in CI. It does **not** run in a git hook — there is no pre-push hook (see "Local hooks" below), so nothing catches a hardcoded string before you push.

---

### 🔴 EMAIL & NOTIFICATION LOCALE — MUST WRAP IN LocaleContext (CRITICAL)

Every user-facing `__('emails...')`, `__('notifications...')`, or `__('svc_notifications...')` call MUST render in the **recipient's** `preferred_language` — not the HTTP caller's locale, not the queue worker's default, not `config('app.locale')`. Without the wrap, Laravel's `__()` resolves against `App::getLocale()` at call time, so emails dispatched from cron/queues go out in English regardless of what the recipient chose.

**Rules:**
- Every service/listener/job that renders a notification MUST wrap the render + send block in `App\I18n\LocaleContext::withLocale($recipient, fn () => {...})`
- Every user SELECT / eager-load feeding a notification MUST include `preferred_language` (or use `User::findByIdSelectColumns`, which already returns it)
- **Admin fanouts / attendee loops:** wrap INSIDE the per-recipient loop — the subject line must also render in each admin's language, not just the body
- **Queue jobs:** pass `preferred_language` into the job payload and wrap the `handle()` body — queue workers boot once with a default locale and never change it otherwise
- `LocaleContext::withLocale()` accepts a string locale code, a User-like object with `->preferred_language`, or null (no-op). It restores the prior locale in a `finally` block, so exceptions can't leak the switched locale

**Before (leaks caller locale to recipient):**
```php
foreach ($admins as $admin) {
    $subject = __('emails.report.subject'); // renders in caller's locale
    $mailer->send($admin->email, $subject, $body);
}
```

**After (renders in each admin's `preferred_language`):**
```php
use App\I18n\LocaleContext;

foreach ($admins as $admin) {
    LocaleContext::withLocale($admin, function () use ($admin, $mailer, $body) {
        $subject = __('emails.report.subject');
        $mailer->send($admin->email, $subject, $body);
    });
}
```

Regression test: `tests/Laravel/Feature/I18n/EmailLocaleIntegrationTest.php`.

---

### 🔴 GLOBAL PLATFORM — NO LOCALE-SPECIFIC VALIDATION (CRITICAL)

Project NEXUS is a **global platform** serving timebanks worldwide. It is NOT an Irish-only product.

- **NEVER use `Validator::isIrishPhone()`** — use `Validator::isPhone()` for international E.164 format
- **NEVER validate phone numbers against Irish patterns** (no `+353`, `08x`, `00353` checks)
- **NEVER add Irish-specific placeholders** in forms — use neutral international examples like `+1 555 123 4567`
- **NEVER hardcode Ireland/Dublin as a default location** — maps default to a neutral global center
- **No locale-specific location validation** — the old `validateIrishLocation()` helper has been deleted; do not reintroduce anything like it
- `isIrishPhone()` no longer exists: `app/Core/Validator.php` only records at the top of the file that it is deliberately not exposed, and offers `isPhone()` instead — do not reintroduce it

---

### 🔴 OPEN SOURCE — AGPL-3.0 (CRITICAL)

This project is **publicly released** under AGPL-3.0-or-later at <https://github.com/jasperfordesq-ai/Project-NEXUS>.

- **Every new source file** (PHP, TS, TSX) MUST have this SPDX header:

  ```text
  // Copyright © 2024–2026 Jasper Ford
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Author: Jasper Ford
  // See NOTICE file for attribution and acknowledgements.
  ```

  PHP: after `<?php`. TS/TSX: first lines. Run `node scripts/add-spdx-headers.mjs` to batch-add, `node scripts/check-spdx.mjs` to verify.

- **Attribution on every page** — Footer, mobile drawer, auth pages must show AGPL Section 7(b) attribution. Do NOT remove.
- **About page contributors** from `react-frontend/src/data/contributors.json` — rendered programmatically, never hardcoded.
- **NOTICE file** contains authoritative legal terms (Section 7 a–f). Do NOT modify without understanding implications.
- **Never commit secrets** — `.gitignore` protects `.env`, uploads, vendor. The repo is PUBLIC.

---

### 🔴 LEGACY PHP THEMES ARE DEAD — NEVER TOUCH (CRITICAL)

**ALL `views/` content is DEAD legacy code.** `/admin-legacy/` and `/super-admin/` have been decommissioned. Do NOT spend any time or credits on any PHP views. Ever.

- **NEVER modify, fix, refactor, or audit** any PHP view files under `views/` (including `views/admin/`, `views/modern/admin/`, `views/civicone/`, `views/starter/`, etc.)
- **NEVER create hooks, checks, or CI gates** that reference legacy views
- **NEVER suggest improvements** to any legacy PHP view code
- All user-facing UI is React. Period.
- **⚠️ Two live exceptions (do NOT delete):** `views/emails/match_{hot,mutual,digest}.php` are still rendered by `app/Services/NotificationDispatcher.php` (each with an inline HTML fallback), and `views/errors/404.php` by `app/Middleware/TenantModuleMiddleware.php`. Deleting these silently changes match-notification emails / the module-404 page. To fully retire `views/`, migrate these into the Laravel mail/view layer first.

---

### 🔴 REACT FRONTEND IS THE PRIMARY UI (CRITICAL)

**The React frontend (`react-frontend/`) is the sole frontend for all pages.** There are no maintained PHP views.

- **ALL UI work** goes in `react-frontend/`
- **UI stack**: React 19 + TypeScript + **HeroUI v3** (`@heroui/react`) + **Tailwind CSS 4**. The v3 package migration is complete (no v2 npm alias). Framer Motion has been removed — animations use the local `@/lib/motion` shim (CSS-transition-backed) or Tailwind/CSS. Do NOT reintroduce `framer-motion`.
- **Icons**: Lucide React (`lucide-react`)
- Use HeroUI components as primary building blocks
- Use Tailwind CSS utilities for layout/spacing — **no separate CSS component files**
- Use CSS tokens in `src/styles/tokens.css` for theme-aware colors
- **Do NOT** create PHP views
- **Header/footer logo exception:** Tenant logos rendered in the React header/footer must use uploaded raster image assets (prefer transparent PNG; JPEG only when transparency is not required). Do **not** replace these brand logos with inline SVGs or generated SVG wrappers. SVG may still be appropriate elsewhere in the app for icons/illustration, but header/footer brand marks are the exception because light/dark logo contrast depends on real transparent raster assets.

- **Laravel is the production/default backend contract.** ASP.NET compatibility work is development-only and must make ASP.NET conform to the Laravel React API rather than changing production frontend behaviour; see [docs/REACT-DUAL-BACKEND.md](docs/REACT-DUAL-BACKEND.md).
- **Repository co-location does not change deployment scope.** `aspnet-backend/`
  is development-only. `web-uk/` is **destined for production** (see
  [docs/ACCESSIBLE-FRONTEND-TAKEOVER.md](docs/ACCESSIBLE-FRONTEND-TAKEOVER.md))
  but is **not deployed today**. Neither may be added to the Laravel blue/green
  Compose file or production deployment scripts without separate, explicit
  authorization — for `web-uk` that authorization also requires the open owner
  prerequisites in the takeover document to be answered, because adding it to both
  colours costs roughly 1 GB on a VM that already has a memory squeeze.

See [react-frontend/CLAUDE.md](react-frontend/CLAUDE.md) for full styling rules, contexts, hooks, and component reference.

### Accessible Frontend (GOV.UK-Based)

The accessible frontend is an explicitly approved UI track that complements, but does not replace, `react-frontend/`. It is the only maintained exception to the React-primary UI rule and is intended for users who benefit from a highly accessible, HTML-first experience. The public-facing track is now Beta and served under `/{tenantSlug}/accessible/...` (legacy `/alpha/...` URLs permanently redirect); the `GovukAlpha`, `govuk_alpha`, and `govuk-alpha.*` names remain as internal code-path names (namespaces, translation files, route names) until a deliberate namespace migration is done.

> 🔴 **There are TWO accessible frontends, and the one described below is being
> replaced.** `accessible-frontend/` is Laravel Blade and is what production
> serves today. `web-uk/` is an Express/Nunjucks application consuming the Laravel
> API, and on **2026-08-11** the owner decided it takes over and Blade retires.
> Both public URL shapes are preserved exactly, so nothing a member has bookmarked
> changes. **`web-uk` is not deployed yet** and the deployment path is not built.
> Read [docs/ACCESSIBLE-FRONTEND-TAKEOVER.md](docs/ACCESSIBLE-FRONTEND-TAKEOVER.md)
> before acting on any status claim about either one — it is the single place the
> current phase is stated. The rules below still govern the Blade track for as long
> as it is deployed, and its GOV.UK branding prohibitions apply to **both**.

- Keep it isolated under root-level `accessible-frontend/`, `app/Http/Controllers/GovukAlpha/`, and `/{tenantSlug}/accessible/...` routes.
- Preferred public subdomain: `accessible.project-nexus.ie`.
- Deploy it through the Laravel/PHP blue-green app container, not the React container. Run `npm run build:accessible-frontend`, `npm run test:accessible-frontend:php`, and `npm run test:accessible-frontend:a11y` before deployment.
- Use official `govuk-frontend` first. The project currently installs `govuk-frontend@6.1.0`; npm latest stable was verified as `6.3.0` on 2026-06-23 and should be upgraded only after a compatibility pass.
- Use official GOV.UK Frontend markup/classes/Sass/JS with HTML-first progressive enhancement; do not use unofficial React GOV.UK libraries as the foundation.
- Do not use the GOV.UK crown, GOV.UK logotype, GOV.UK header identity, GDS Transport, or wording that implies this is an official UK government service.
- Do not use deprecated GOV.UK repos/packages: `govuk_template`, `govuk_elements`, or `govuk_frontend_toolkit`.
- All user-facing strings must use `lang/en/govuk_alpha.php`.
- Preserve tenant context, module gates, and AGPL Section 7(b) attribution on every accessible frontend page.

See [docs/govuk-alpha/RESEARCH.md](docs/govuk-alpha/RESEARCH.md) for the architecture decision and source list.

---

### 🔴 NEVER AUTO-DEPLOY (CRITICAL)

**NEVER start a deployment unless the user explicitly tells you to deploy.** Completing a task (code changes, bug fix, feature implementation, audit fix, etc.) does NOT imply "deploy it." Always stop after committing/pushing and wait for the user to give a direct deployment instruction.

No agent may initiate SSH, run `bluegreen-deploy.sh` / `safe-deploy.sh`, or trigger any production deployment autonomously.

---

### 🔴 NEVER AUTO-PUSH TO BACKUP REPO (CRITICAL)

**NEVER push to the `backup` remote (`Project-NEXUS-backup`) unless the user explicitly tells you to.** The backup repo is private and contains credentials, secrets, and all gitignored files.

See local-only `BACKUP.md` for the full backup system documentation.

---

## General Principles

- **Do NOT default to the quickest solution** — prioritize maintainability
- Follow existing patterns in the codebase
- Ask if unsure about where code should live
- **Don't hallucinate fixes** — never claim you've fixed something you haven't actually edited
- **Don't go in circles when debugging** — if an approach fails twice, stop and reassess the root cause
- **Verify before claiming complete** — after deploying a fix, verify it actually resolved the issue

---

## HeroUI Migration Workflow

For any HeroUI v2/v3 migration, component API question, or related React code change, check the official HeroUI v3 docs before giving migration advice or editing components.

- Prefer official HeroUI v3 migration docs over memory, especially for `Select`, `Dropdown`, `Accordion`, `Progress`, `DateInput`, `TimeInput`, modals, hooks, and styling.
- Use the project-installed HeroUI skills in `.agents/skills/` as persistent local guidance, and use `https://heroui.com/react/llms.txt` as the lightweight docs index.
- For broader static reference, use `https://heroui.com/react/llms-full.txt`; for narrower reference, use `https://heroui.com/react/llms-components.txt` or `https://heroui.com/react/llms-patterns.txt`.
- Treat broad renames as suspicious until verified against the docs, because many v3 components use compound APIs rather than simple find-and-replace migrations.
- In progress updates or final summaries, state which HeroUI docs were checked when HeroUI migration work was involved.

---

## Git & Commits

**Commit directly to `main`.** Do not create feature branches or PRs — this is a solo project and the branch-per-change workflow adds unnecessary overhead.

#### 🔴 No git worktrees. If you create one, you remove it.

`C:\platforms\htdocs\staging` is the working checkout. **Do not create a git
worktree**, and do not assume one you find is meant to be there.

This is written down because it went wrong. A Codex session created
`C:\platforms\htdocs\nexus-platform-consolidation` on a branch
`codex/platform-monorepo`. When that work merged on 2026-08-10 the branch was
deleted, but the folder stayed behind on disk — tens of gigabytes of
dependencies and build output, orphaned, for the owner to find and clear up.
No workflow step caught it, because worktrees are not part of this workflow.

If a task genuinely needs one, the session that creates it removes it:

```bash
git worktree remove <path>       # NOT rm -rf: that leaves stale git metadata
git worktree prune               # tidy any leftover registrations
git worktree list                # verify: only the main checkout should remain
```

🔴 Three traps, all hit in practice on 2026-08-10:

1. **`git worktree remove` fails on Windows while any process has that
   directory as its working directory** — including the agent session running
   inside it. Git still deregisters the worktree, but the folder survives and
   `Remove-Item -Recurse -Force` then reports *"being used by another
   process"*. Finish worktree work from the main checkout, or leave the folder
   for the owner to delete after the session ends.
2. **`git branch -d` compares against your LOCAL `main`.** A branch merged on
   the remote reports "not fully merged" until you fast-forward local `main`.
   Fast-forward first (`git merge --ff-only origin/main`) rather than reaching
   for `-D`, which discards the check that keeps you safe.
3. **The `nexus-php-app` container bind-mounts `C:\platforms\htdocs\staging` to
   `/var/www/html`.** Anything `docker cp`-ed into that container lands in the
   staging working tree, not in a container-only path. A temporary test file
   copied in that way turned up as an untracked file in the owner's checkout.

#### Local hooks — what actually runs

Exactly **one** git hook is installed: `pre-commit`, copied from `scripts/git-hooks/pre-commit` by
`bash scripts/git-hooks/install-hooks.sh`, which installs nothing else. There is **no pre-push
hook**, there is **no `.husky/` directory**, and no lint, typecheck or build runs locally on commit
or push. `scripts/pre-push-checks.sh` exists but nothing invokes it — it is a script you run by
hand. **CI is the only safety net**, which is why a push can only be judged by CI going green.

If a commit is ever blocked by a pre-existing lint or build failure in files your change did not
touch, `--no-verify` is the documented escape hatch — but note that no such hook exists today, so
in practice the only thing `--no-verify` can bypass is the gate below, and it must not.

#### 🔴 EXCEPTION — never `--no-verify` past the test verify-gate

The `pre-commit` hook (`scripts/git-hooks/pre-commit`, installed via `bash scripts/git-hooks/install-hooks.sh`) has **two gates**. Gate A is a **credential scan** that runs on every commit and needs only git+grep — it blocks private keys, AWS/`sk-` keys, literal-IP SSH strings and database dumps in staged content (restored 2026-08-10 from the upstream ASP.NET hook the monorepo move dropped; deliberately excludes the two generic password patterns, which false-positive constantly on Laravel factories/seeders). Gate B runs **only the PHP test files staged in the current commit**. A failure there is, by definition, in a file *you are committing right now* — it is never "pre-existing" or "unrelated". If this gate fails, **fix the test or drop the file. Do NOT `--no-verify` past it.** This exists because automated coverage/test batches repeatedly landed broken tests on `main` and turned CI red. The `--no-verify` allowance above applies ONLY to pre-existing lint/build failures in files you did not change.

Any automated loop that generates and commits test batches MUST let this gate run (no `--no-verify`); if it commits a failing test, it has broken `main` for everyone.

### Git Commit Convention

```
feat: Add new feature       fix: Bug fix           docs: Documentation only
style: Formatting           refactor: Restructure  test: Adding tests
chore: Maintenance

Example: feat(wallet): Add time credit transfer confirmation modal
Co-Authored-By: Claude <noreply@anthropic.com>
```

### GitHub PR Gates (READ BEFORE OPENING ANY PR)

Some environments (Claude Code on the web, GitHub Actions) force a branch + PR workflow. PRs in this repo are gated by **description checks** that fail instantly unless the PR body contains exact fields from `.github/pull_request_template.md`. These gates re-run when the PR body is **edited** — no push needed to clear them.

When opening a PR, always build the body from `.github/pull_request_template.md`. The hard requirements:

1. **Root Cause Analysis Check** — any PR whose title starts with `fix` or contains `bug`/`hotfix` MUST include literal `**Root Cause:**` and `**Prevention:**` fields (the colon is required; a `### Root Cause` heading does NOT satisfy it).
2. **Translation Review Check** — any PR touching `react-frontend/public/locales/<non-en>/*.json` MUST include `**Translation Status:** reviewed` (or `approved`) and `**Translation Reviewer:** @handle`. Owner-authored PRs are exempt; call out machine-filled translations in a `**Translation Notes:**` field regardless.
3. **Contributor Terms Acceptance** — the `## Contributor Terms` section with all three checkboxes checked (`- [x]`) plus `**Third-Party Material Disclosure:**` and `**AI Contribution Disclosure:**` fields (use `None` when not applicable). Owner-authored and bot PRs are exempt.
4. **Translation Drift Detection** — `node scripts/check-php-lang-parity.mjs` AND `node scripts/check-php-lang-untranslated.mjs` must pass. Adding keys to `lang/en/*.php` means adding **translated** counterparts to all ten other locales in the same commit. 🔴 Do NOT copy the English value across to satisfy parity: parity compares **key sets only**, which is exactly how 99,139 values ended up as byte-identical English while it stayed green. Use `node scripts/translate-php-lang-gaps.mjs --google --namespace <file>` — see the i18n section below for the full sequence.

### 🔴 Keep `main` green

A failing check on `main` is inherited by **every** subsequent PR and trains everyone to ignore CI. If a push to `main` turns any CI gate red (lang parity, i18n baseline, build), fix it or revert it immediately — do not leave it for "later". Before starting feature work on a branch, if CI on `main` is already red for a mechanical reason (e.g. missing translation keys), fix that first in its own commit so your PR isn't born failing.

---

## Code Patterns

PHP patterns: follow existing services in `app/Services/` (the conventions doc has been retired).

### Multi-Tenant Awareness (CRITICAL)

**Always scope queries by tenant:**

```php
$tenantId = TenantContext::getId();
$stmt = Database::query(
    "SELECT * FROM users WHERE tenant_id = ? AND status = ?",
    [$tenantId, 'active']
);
```

**CRITICAL**: Never pass arrays to query parameters. Use `implode(',', array_fill(...))` for IN clauses.

### Key Patterns

- **Services**: Static methods, always scope by `TenantContext::getId()`
- **Controllers**: `jsonResponse()` + `getJsonInput()` helpers
- **Authentication**: `Auth::user()`, `ApiAuth::authenticate()` (token-based), `Csrf::token()`
- **Feature gating**: `TenantContext::hasFeature('events')` (PHP) / `useTenant().hasFeature('events')` (React)

### 🔴 Authorisation — there are FIVE tiers, and `broker` is not a junior admin

Full reference: [docs/ROLES-AND-PERMISSIONS.md](docs/ROLES-AND-PERMISSIONS.md).
Summary, because getting this wrong is common:

`member` → `broker`/`coordinator` → `admin`/`tenant_admin` → `is_tenant_super_admin`
(network admin: own tenant **+ its sub-tenants**) → `is_super_admin`/`god` (platform).

- `app/Support/Authorization/AdminTier.php` is the canonical predicate. It
  **deliberately returns `false` for `broker`/`coordinator`** — a broker is an
  operational role with its own application (`react-frontend/src/broker/`), not a
  lesser admin, and is deliberately refused generic `/v2/admin/*`.
- Gates: `EnsureIsBrokerOrAdmin`, `EnsureIsAdmin`, `EnsureIsSuperAdmin`.
  `EnsureIsSuperAdmin` deliberately rejects `is_tenant_super_admin`.
- Cross-tenant scoping in the super-admin panel is `app/Core/SuperPanelAccess.php`:
  level `master` (god, or master-tenant super admin) sees everything; level
  `regional` (hub-tenant super admin) is confined to its own subtree by a
  materialised-path prefix match. Cross-tenant actions must check
  `canAccessTenant()` **at both ends** — see `AdminSuperController::userMoveTenant()`.
- 🔴 `super_admin`, `god`, `tenant_admin` and `coordinator` are **never written to
  `users.role`** by the API — they are expressed as boolean flags. A gate that
  checks only the role string will under-authorise a real platform admin. Use
  `AdminTier`.
- 🔴 Most declared RBAC permission slugs are **not enforced anywhere**. Grantable
  ≠ checked. Verify before relying on one.

### 🔴 Safeguarding, guardians and consent EXIST — ~30 tables, previously undocumented

Full reference: [docs/SAFEGUARDING-AND-CONSENT.md](docs/SAFEGUARDING-AND-CONSENT.md).
This subsystem had no documentation until 2026-08-04, which caused at least one
audit to conclude it did not exist. It does, and parts of it are the best-built
code in the repo.

- Guardian relationships: `safeguarding_assignments` (staff-created, record-only —
  confers **no** capability), `event_guardian_consents` (encrypted identity,
  single-use token, DB-trigger-enforced append-only history — copy this pattern),
  `vol_guardian_consents` (genuinely gates minors).
- Consent: `user_consents` is versioned and hashed. `consent_types` is
  PLATFORM-GLOBAL GDPR consent and does **not** model proxy representation.
- Concerns: `safeguarding_reports` is a real case workflow (SLA, escalation,
  append-only action log). 🔴 There are **four** parallel reporting systems and
  none can reference an exchange.
- Staff decisions: `member_vetting_attestations` has closed reason codes and
  before/after values — the model to imitate.
- `account_relationships` presents four carer permissions. `can_view_activity`,
  `can_manage_listings` and `can_transact` are enforced (since 2026-08-04) via
  `SubAccountService`; proxy actions MUST record `acting_user_id` and audit to
  `org_audit_log`. 🔴 **`can_view_messages` is still NOT enforced** — it needs the
  counterparty notice first; do not wire it up or present it as working.
- A relationship record is never authorisation. Nothing is implicit — add an
  explicit check.

### 🔴 Request performance recording — two endpoints, easily confused

`/admin/performance` reads **`/v2/admin/performance/summary`**
(`AdminPerformanceController` → `PerformanceInsightsService`). It read
`/v2/metrics/summary` until 2026-08-05 and crashed on the first missing key:
that route is `MetricsController`, an unrelated **event counter** returning
`period` / `total_events` / `events_by_type`. Do not point the page back at it,
and do not bolt profiling keys onto `MetricsService` — they answer different
questions. The shape is pinned from both ends by
`tests/Laravel/Feature/Performance/PerformanceSummaryContractTest.php`; rename a
key there and you must rename it in `PerformanceDashboard.tsx` in the same commit.

Recording is `App\Http\Middleware\RecordPerformanceSample` (terminable — all work
happens **after** the response is sent) plus `App\Support\Performance\PerformanceRecorder`
(query listener attached in `AppServiceProvider::boot`). Config and thresholds:
`config/performance.php`.

- Every request increments **one hourly counter row**; a detail row is written
  only when the request is slow / memory-hungry / query-heavy / repeating a
  query. Totals and the volume chart are therefore exact, not sampled. Do not
  "simplify" this into a row per request.
- 🔴 Only the query **template** is stored (`QueryExecuted::$sql`, placeholder
  form). Never interpolate bindings — that would put member data in a
  diagnostics table. A test enforces it.
- The master switch is **platform-wide by design**, not per tenant: reading a
  per-tenant setting on every request would cost a query on the hottest path.
- Recording failures are swallowed and logged once per process. That is the
  narrow, allowed case of the `catch (\Throwable)` rule above — nothing returns a
  success-shaped value to a caller.
- `performance:prune` (nightly, 03:15) enforces retention. Without it the tables
  grow for ever.

---

## Validation Commands

### Local preflight — run BEFORE pushing

```bash
node scripts/preflight.mjs               # check working tree + unpushed commits
node scripts/preflight.mjs --base <sha>  # replay a committed range (validation)
```

Change-aware local checks (a few minutes) that catch ordinary mistakes before the 20–35-minute CI round-trip: docs/version/changelog hygiene, SPDX, workflow YAML parsing, scoped PHPStan + focused PHPUnit on changed files (Docker; **never** host PHPUnit — incomplete host `vendor/` gives false failures), frontend `tsc` + test-type ratchet + focused vitest (`--retry=0`), mobile `tsc`, and the php-lang gates. Area detection reads `.github/ci-paths.yml`, so preflight and CI agree on what a change touches.

Statuses are honest: **UNAVAILABLE** (e.g. Docker down, timeout) is never a pass — exit 0 all good, 1 something failed, 2 nothing failed but something couldn't run. Passing preflight does **not** replace CI: the full GitHub pipeline remains the authoritative gate, and full suites / Docker builds / E2E / accessibility are deliberately deferred to it. There is intentionally no pre-push hook — run it yourself.

### Backend CI gates

```bash
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always
vendor/bin/phpstan analyse --no-progress --memory-limit=512M --error-format=github
```

### React / Frontend checks

```bash
cd react-frontend && npx tsc --noEmit
cd react-frontend && npm run build
cd react-frontend && npm test
```

### i18n checks (run after any locale changes)

```bash
npm run check:i18n:baseline
npm run check:i18n:gaps
node scripts/check-php-lang-parity.mjs
node scripts/check-php-lang-untranslated.mjs
```

**Adding a new PHP lang key — the sequence that does not recreate the debt.**
`check-php-lang-parity.mjs` compares **key sets only**, so copying the English
value into the other ten locales makes it pass while leaving the string
untranslated. `check-php-lang-untranslated.mjs` is the gate that catches that: a
shrink-only ratchet (ceiling in `.github/php-lang-untranslated-baseline.json`,
currently **249**) counting values byte-identical to English. It is BLOCKING.

1. Add the key to `lang/en/<ns>.php`.
2. Insert the same key with the **English** value into each of the ten locale
   files (the translator only fills keys that already exist).
3. Clear that namespace from `.local-docs-archive/php-lang-translate-checkpoint.json`,
   or the script prints `already done … skipping` and does nothing.
4. `node scripts/translate-php-lang-gaps.mjs --google --namespace <ns>.php`
   (a separate script — the React one hard-excludes PHP).
5. Check the result: the placeholder guard protects `:name`, but it cannot see
   that Google capitalised a literal field name (`peer_slug` → `Peer_slug`) or
   mistranslated a technical word.
6. Re-run both gates. Re-baseline (`--write-baseline`) only on genuine improvement.

🔴 **`__()` reads `lang/<locale>/<ns>.json` FIRST** (`App\I18n\Translator`) and
falls back to Laravel's `.php` loader only when that misses. So a `.php`
namespace can be entirely dead while the live JSON is entirely English — and the
ratchet scans `.php` only, so it cannot see it. Check which of the two files
actually serves a namespace before translating either.

A value that is correct *because* it is identical to English (a brand name, an
SI unit, a language endonym, a placeholder-only string) belongs in
`scripts/php-lang-invariant-allowlist.json`. A `byLocale` entry must survive the
gate's own check: that locale must never render the same English value
differently anywhere else in `lang/`. If it does, a translator did translate it,
and it is real work.

### E2E / Browser tests

```bash
npm run test:e2e
npx playwright test e2e/tests/smoke.spec.ts --grep '@smoke' --project=chromium-modern
```

E2E defaults to `http://localhost:5173`; use `E2E_BASE_URL=...` only when deliberately targeting another environment. Run Playwright from the root dependency tree — do not keep a nested `e2e/node_modules` alongside root Playwright.

### Accessible frontend

```bash
npm run build:accessible-frontend
npm run test:accessible-frontend:php
npm run test:accessible-frontend:a11y
```

---

## Testing

```bash
# PHP
vendor/bin/phpunit                          # All tests
vendor/bin/phpunit --testsuite Unit         # Unit only
vendor/bin/phpunit --testsuite Services     # Services only
php tests/run-api-tests.php                 # API tests

# React
cd react-frontend
npm test                                    # Vitest
npm run lint                                # TypeScript check (tsc --noEmit)
npm run build                               # Production build
```

Test environment: `APP_ENV=testing`, `DB_DATABASE=nexus_test`, `CACHE_DRIVER=array`.

### 🔴 What a green pipeline actually proves (frontend)

`npm test` is not the gate. The gate is **`React Full Suite (shard N/8)`**, which
runs the whole Vitest suite across eight shards via
`react-frontend/scripts/run-vitest-shard.mjs`. It is **BLOCKING** as of
2026-07-28 and is in the release gate's `needs:` list.

It skips the suites listed in `react-frontend/src/test/failing-suites.baseline.json`
— currently **55 of 1,283**, so a green pipeline proves **1,228** suites, not all
of them. That list is a fix-and-remove queue, not a set of exemptions:

- It may only **shrink**. `react-frontend/scripts/check-quarantine-budget.mjs`
  holds a `BASELINE` constant that must be lowered in the **same commit** as any
  removal, and it runs in `react-build`, not in the shard job, so growing the
  list cannot make a red shard green.
- A quarantined path that no longer exists fails the runner rather than rotting
  there silently.
- A visibility step runs the quarantined suites on shard 1 without gating, so a
  suite that gets fixed is noticed.
- Verify a fix with `--retry=0`. The shard runner passes `--retry=1`, so a suite
  can be retry-rescued; removing one on that basis puts a flaky suite in the gate.

🔴 **Two ways a test greens locally and reds a CI shard.** Laravel's test HTTP
kernel does not populate `$_SERVER['REQUEST_METHOD']`, so any code reading it
directly 500s under test only. And config sourced from a dev `.env` — e.g.
`FEDERATION_JWT_SECRET` — is simply absent in CI; a test must establish its own
preconditions rather than inherit them. Reproduce by clearing the variable on the
command line before assuming the test is fine.

🔴 The `pre-commit` hook's second gate runs **only the PHP test files staged in this commit** (its first gate is a credential scan that runs on every commit).
A failure there is in a file you are committing right now, so it is never
"pre-existing" — fix it or drop the file. This is the one gate the `--no-verify`
allowance never covers.

> **🔴 NOTE — running PHP tests via `docker exec` that use `Crypt`/encryption:** You MUST pass the test `APP_KEY` explicitly on the `docker exec` line. The container's `.env` ships a dev placeholder (`APP_KEY=nexus-dev-app-key-change-in-production`) that is **not** a valid base64 32-byte key. Laravel loads that value into config during app bootstrap, and phpunit.xml's `<env name="APP_KEY" force="true">` does **not** reliably override it for the `Encrypter` singleton inside the container — so any test that touches `Crypt` (e.g. the federation listener tests in `tests/Laravel/Unit/Listeners/`: `PushGroupToFederatedPartnersTest`, `PushGroupMembershipToFederatedPartnersTest`, `PushGroupRetractionToFederatedPartnersTest`, `PushMemberProfileUpdateToFederatedPartnersTest`) fails with `RuntimeException: Unsupported cipher or incorrect key length` from `Encrypter.php`.
>
> **Fix:** add `-e APP_KEY="base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls="` (the same fixed, non-secret test key already in `phpunit.xml`) to the `docker exec` command:
>
> ```bash
> docker exec \
>   -e MAIL_MAILER=array \
>   -e APP_KEY="base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=" \
>   nexus-php-app php vendor/bin/phpunit tests/Laravel/Unit/Listeners/...
> ```
>
> This applies to CI and any local `docker exec` run. The `-e APP_KEY=...` flag is not needed when running phpunit directly on the host, where phpunit.xml's `<env>` is authoritative.

---

## Deployment

Full deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

| Item | Value |
|------|-------|
| **Host** | Azure VM — `.secrets.local/deploy.env` holds `PROD_SSH_HOST` (a full `user@host` string, not a bare IP) and `PROD_SSH_KEY` |
| **SSH** | `ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST"` — 🔴 do **not** prefix a user: `PROD_SSH_HOST` already contains one, and there is no `PROD_SSH_USER`. `RequestTTY=force` is required because the remote sudoers uses `use_pty`. Read the values with `grep`/`cut`, not `source` (see `scripts/deploy.sh:43-45`). |
| **Deploy Path** | `/opt/nexus-php/` |
| **Deploy Script** | `scripts/deploy/bluegreen-deploy.sh` (canonical production deploy engine) |
| **Legacy Wrapper** | `scripts/safe-deploy.sh` (compatibility shim only; production delegates to blue-green) |
| **Method** | Zero-downtime blue/green switch via Apache route file |

**Preferred: gated deploy from the dev machine.** Run `bash scripts/deploy.sh` — it runs the larastan/PHPStan static-analysis gate first (catches the job-offers class of bug; only NEW findings beyond `phpstan-baseline.neon` block — override a false alarm with `ALLOW_PHPSTAN_FAIL=1`), pushes, **then blocks until GitHub confirms the pushed commit is fully checked**, runs the blue/green deploy below, and finally **watches production error rates for 30 minutes after the traffic switch** (`scripts/postdeploy-watch.mjs` — Sentry counts scoped to the new release tag; on a spike it alarms and prints the rollback command, never rolls back itself; skip with `SKIP_POSTDEPLOY_WATCH=1`). The watch needs a Sentry token with `org:read, project:read, event:read` in `.secrets.local/sentry.env` as `SENTRY_AUTH_TOKEN_MONITOR`; without one it reports UNVERIFIED rather than pretending health. The static gate runs locally in the `nexus-php-app` container, so it adds only a couple of minutes and can't break the server-side deploy. The raw steps below still work as a fallback — but they bypass the check gate and the watch.

### 🔴 A green tick is NOT proof the code was checked

`ci.yml` skips whole jobs when its `changes` filter judges an area untouched, and `release-gate` treats a **skipped** need as passing (it fails only on `failure`/`cancelled`). Combined with `cancel-in-progress`, a commit routinely carries a green tick while its PHP suite, React suite, Docker build, E2E and accessibility jobs never ran on it. Example: run `30795897364` on `7277682cd` is green with **11 of 20 jobs skipped**.

`scripts/predeploy-ci-check.sh` is the compensating control at deploy time. Evidence evaluation lives in `scripts/predeploy-ci-verify.mjs`, which uses **result inheritance**: a required check counts as passed if it ran and passed on the exact deploy SHA, **or** on an ancestor commit with none of its watched paths (per `.github/ci-paths.yml`) changed since. A check that *failed* on the newest code it ran against always refuses — the walk never skips past a failure — and skipped/cancelled are never evidence. It **fails closed** (no `gh`/`node`, not authenticated, no evidence, commit not on `origin/main` ⇒ refuse). `scripts/deploy.sh` calls it with `--trigger`, so a genuinely uncovered commit forces a full run and waits; with the nightly scheduled full run, evidence is normally fresh and deploys verify in seconds.

```bash
bash scripts/predeploy-ci-check.sh            # is HEAD fully checked? (report only)
bash scripts/predeploy-ci-check.sh --trigger  # force a full run only if evidence is missing
```

🔴 Invariants to preserve when touching CI or the verifier:

- `.github/ci-paths.yml` is the **single source of truth** for which paths wake which areas — both `dorny/paths-filter` steps in ci.yml and the verifier read it. Change watch-lists there and only there.
- `workflow_dispatch` **and** `schedule` must genuinely force **every** job (each job's `if:` carries the escape), or the verifier can never reach full coverage and deploys block forever. `docker-verify` and `i18n-drift` needed explicit escapes for this reason.
- A new ci.yml job ⇒ add it to `REQUIRED_JOBS` in `scripts/predeploy-ci-verify.mjs` (an unrecognised job name on the deploy SHA's runs makes it refuse, by design).
- The nightly `schedule` run (03:30 UTC) has its **own concurrency group** so it and push runs never cancel each other — keep that when editing `concurrency:`.

Emergency override: `ALLOW_UNVERIFIED_DEPLOY=1 bash scripts/deploy.sh` — deliberate, loud, and not for routine use.

```bash
# Step 1: Push code
git push origin main

# Step 2: Deploy with the canonical blue-green engine
source .secrets.local/deploy.env
ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \
  "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach"

# Step 3: Check progress
source .secrets.local/deploy.env
ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \
  "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh logs"

# Other modes
sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach # Rollback to previous color
sudo bash scripts/deploy/bluegreen-deploy.sh status            # Show active color + deploy status
sudo bash scripts/deploy/bluegreen-deploy.sh logs              # Blue-green specific log tail
sudo bash scripts/deploy/bluegreen-deploy.sh logs -f           # Follow blue-green log live
sudo bash scripts/deploy/bluegreen-deploy.sh monitor           # Live monitor dashboard
```

> **ALWAYS use `--detach` for deploys.** Docker builds take 10+ minutes. Without `--detach`, SSH will timeout mid-build.
>
> **How it works on production:** `bluegreen-deploy.sh` builds and tests the inactive color while the active color keeps serving live traffic. The Apache route file is atomically swapped after smoke checks pass: **zero downtime, no maintenance window.**

### 🔴 Critical Deploy Rules

1. **Blue-green builds the inactive color** — the live color keeps serving; no maintenance window required
2. **Never build React locally and upload `dist/`** — always rebuild on server inside the container image
3. **Cloudflare cache purge after every deploy** — automated, fires after traffic switch + smoke tests pass
4. **Do not use `safe-deploy.sh quick/full` as the normal production command** — those modes are legacy maintenance-mode fallback paths only

### Container Ownership

**Our containers (production — blue-green):** `nexus-blue-php-app`, `nexus-blue-react`, `nexus-blue-sales`, `nexus-blue-php-queue`, `nexus-blue-php-scheduler`, `nexus-green-php-app`, `nexus-green-react`, `nexus-green-sales`, `nexus-green-php-queue`, `nexus-green-php-scheduler`, `nexus-php-db`, `nexus-php-redis`, `nexus-meilisearch`.

**Legacy single-color containers** (may still exist on first migration): `nexus-php-app`, `nexus-react-prod`, `nexus-sales-site`, `nexus-php-queue`, `nexus-php-scheduler`.

**NEVER touch:** `nexus-frontend-*`, `nexus-civic-*` — they belong to other projects.

🔴 **Corrected 2026-08-10.** `nexus-backend-*` and `nexus-uk-*` were also listed
here as "other projects". They are **not** — they are this platform's own
experimental ASP.NET backend and Web UK frontend, live at
`api.project-nexus.net` and `uk.project-nexus.net`, deployed from the former
`api.project-nexus.net` repository into `/opt/nexus-backend/`. The wording made
every agent refuse to look at the very containers it was asked about.

They are still **not to be deployed, restarted or modified** — but for the real
reasons, which an agent needs to know rather than a false ownership claim:

- The owner declared that repository and its deployment **dead** on 2026-08-10.
  The domains are kept; this repository is the control panel, and how it deploys
  is undesigned work.
- 🔴 The live ASP.NET database has **no successful backup since 2026-03-08**
  (156 consecutive failures), and its app runs `Database.MigrateAsync()` on
  every start. Restarting that container can irreversibly change live data with
  nothing to restore from. See `docs/PLATFORM-MONOREPO.md`.

Read-only inspection is fine and often necessary. Anything that writes, restarts
or redeploys needs explicit owner authorization, as always.

---

## 🔴 Global Maintenance Mode (CRITICAL — CANONICAL METHOD)

**This section documents the ONLY reliable method for putting the entire Project NEXUS platform into maintenance mode. Do NOT improvise, guess, or use alternative approaches. Updated 2026-03-21.**

When maintenance mode is ON, **all tenants across the entire platform** are blocked. Two independent layers enforce this — **BOTH must be toggled together**.

| Layer | Mechanism | Where checked | What it blocks |
|-------|-----------|---------------|---------------|
| **Layer 1: File** | `.maintenance` file in PHP container | `httpdocs/index.php` line 16 (pre-framework) | ALL HTTP traffic except localhost |
| **Layer 2: Database** | `tenant_settings.general.maintenance_mode` | Laravel `CheckMaintenanceMode` middleware + React `TenantShell` | Non-admin API requests + React frontend |

**`scripts/maintenance.sh` controls BOTH layers atomically.** One command toggles both.

```bash
# Enable maintenance mode (file + database, all tenants, immediate)
sudo bash scripts/maintenance.sh on

# Disable maintenance mode (file + database, all tenants, immediate)
sudo bash scripts/maintenance.sh off

# Check both layers' status
sudo bash scripts/maintenance.sh status
```

**Blue-green path (production):** The deploy script does NOT use maintenance mode. The inactive color builds and tests while the live color keeps serving.

**Migrations run automatically.** As of 2026-05-03, `bluegreen-deploy.sh deploy` runs `php artisan migrate --force` against the new color before the traffic switch. Pass `--no-migrate` only for emergency rollback deploys.

**NEVER toggle only one layer.** Always use `maintenance.sh` which handles both.

---

## Database & Migrations

- Before writing code that queries tables, verify actual column names via schema inspection — do not assume.
- When generating migrations, check for FK column type consistency (signed vs unsigned int) against referenced tables.
- Use current Laravel 12 migration APIs; avoid deprecated patterns.

### 🔴 `catch (\Throwable)` hides schema mismatches — the gate is the compensating control

This codebase wraps method bodies in `catch (\Throwable)` as a matter of course:
**2,882 occurrences across 540 files in `app/`, 350 of which return a falsy
default** (`null`, `false`, `[]`, `0`) from the catch. That is an established
idiom here, not a smell to be stamped out — but it has one specific, expensive
consequence you must account for.

**A query against a column that does not exist becomes a plausible return value.**
`GroupModerationService` wrote `updated_at`, `moderated_at` and `action_taken` to
`group_content_flags`, whose real columns are `resolved_at` and
`moderation_action`. Every write threw. `flagContent()` returned `null`,
`moderateContent()` returned `false`, `getModerationHistory()` returned `[]` — all
of which read as "nothing to do" rather than "broken". It went unnoticed from
2026-03-20 to 2026-07-30, and the tests covering those paths asserted the
swallowed value. PHPStan cannot see it; it does not know the schema.

Two consequences for how you work:

- **When auditing a service whose methods each swallow `Throwable`, assume nothing
  works until you have proven otherwise.** A green test and a plausible return
  value are not evidence.
- **Do not add a `catch (\Throwable)` whose only effect is to convert a schema or
  contract error into a success-shaped value.** If the caller cannot distinguish
  "no rows" from "the query is invalid", log at `error` and re-throw, or return a
  result type that says which happened.

The compensating control is `npm run check:db-columns`
(`scripts/check-db-column-references.mjs`), **BLOCKING** in the Migration Safety
Gate. It parses the committed schema dump — no database, so it cannot pass
vacuously on a runner with different env config — and fails when PHP writes a
column or table that does not exist. Pre-existing problems are tracked in
`.github/db-column-reference-baseline.json`, shrink-only and enforced in both
directions: an entry that no longer occurs also fails, so a fix cannot land
without removing its entry. It checks the ~8,400 places where both the table and
the column are literal; `where()`/`orderBy()`/`select()` are deliberately out of
scope because they can name a joined table's column.

🔴 The provenance is worth knowing: commit `de2e48396` (2026-03-20, "add missing
service methods") wrote **15 services against an imagined schema**. Anything that
commit touched deserves a column-level check before you trust it.

### Schema Dump (for fresh database setup)

`database/schema/mysql-schema.sql` contains the **full database schema** plus `laravel_migrations` table data. This is committed to git so new contributors can set up a working database with:

```bash
docker compose up -d
docker exec nexus-php-app php artisan migrate   # loads schema dump + runs any newer migrations
```

**Keeping it current:** To refresh manually:

```bash
bash scripts/refresh-schema-dump.sh             # local Docker
bash scripts/refresh-schema-dump.sh --production # on production server
```

After refreshing, **commit the updated `database/schema/mysql-schema.sql` to git**.

### Laravel Migrations (primary system)

New schema changes go in `database/migrations/` using standard Laravel migrations (`php artisan make:migration`). Use `Schema::hasTable()` / `Schema::hasColumn()` guards for idempotency.

### Legacy SQL Migrations

Located in `/migrations/` with timestamp naming. **Do not add new legacy SQL migrations** — use Laravel migrations instead.

### 🔴 Running migrations on production — CORRECT METHOD

**Laravel migrations (preferred):**
```bash
source .secrets.local/deploy.env
ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \
    "sudo docker exec nexus-php-app php artisan migrate --force"
```

**Legacy SQL migrations (if needed):**
Use the checked-in wrappers below. Do not publish production hostnames, database credentials, or copied one-off shell snippets in documentation.

**Why `-o RequestTTY=force`?** Sudoers has `use_pty` — sudo refuses without a terminal. `-t` and `-tt` fail when stdin isn't a TTY. `-o RequestTTY=force` is the only flag that works.

**After running migrations, refresh the schema dump:**
```bash
bash scripts/refresh-schema-dump.sh
# Then commit the updated database/schema/mysql-schema.sql
```

### Migration workflow (Makefile wrappers)

Prefer the checked-in wrappers for raw SQL migrations:
- `make migrate FILE=...`
- `make migrate-dry FILE=...`
- `make migrate-prod FILE=...`
- `make migrate-prod-dry FILE=...`
- `make drift-check`

---

## Regression Prevention

(The standalone regression-prevention doc has been retired; the layers are summarised below.)

**5 layers:** Staged-PHP-test pre-commit hook (`scripts/git-hooks/pre-commit`, installed manually via `bash scripts/git-hooks/install-hooks.sh`) → CI pipeline (stages 0–8 in `.github/workflows/ci.yml`) → PR enforcement → Zod runtime validation (dev only) → Local scripts + deploy rules.

🔴 There is **no Husky and no lint-staged in this repo's root** (no `.husky/` directory, no `prepare` script, neither package in `package.json` — they exist only inside the `mobile/` subproject) and **no pre-push hook**. `scripts/pre-push-checks.sh` is a manual bundle and must not be wired into `.husky/pre-push` without an explicit instruction. Do not assume any local gate other than the pre-commit hook (credential scan + staged PHP tests) — CI is the authoritative net.

### Mandatory Rules (NEVER SKIP)

1. **`--no-cache` on production builds**
2. **Restart `nexus-php-app` after PHP deploys** (OPCache)
3. **Never double-unwrap** — `response.data` IS the final data
4. **Every DELETE/UPDATE must include `AND tenant_id = ?`** on tenant-scoped tables
5. **Dockerfile limits must match** between `Dockerfile` and `Dockerfile.prod`
6. **Fix PRs must explain Root Cause + Prevention** — enforced by CI

---

## Common Tasks

### Add a New API Endpoint

1. Create controller in `app/Http/Controllers/Api/`
2. Add route in `routes/api.php`
3. Add tests in `tests/Laravel/Feature/Controllers/`

### Add a New Service

1. Create in `app/Services/` (scope by tenant — see existing services)
2. Always scope by tenant — follow existing services
3. Add unit tests

### Add a New Page (React Frontend)

1. Create page in `react-frontend/src/pages/`
2. Use HeroUI + Tailwind CSS — see [react-frontend/CLAUDE.md](react-frontend/CLAUDE.md)
3. Add the route in `react-frontend/src/routes/AppRoutes.tsx` with `FeatureGate` if needed (`src/App.tsx` holds only providers and one catch-all route; public routes go in `PublicAppRoutes.tsx`, auth routes in `AuthRoutes.tsx`, admin routes in `src/admin/routes.tsx`)
4. Add `usePageTitle()` hook
5. Use `tenantPath()` for internal links

### Add a Database Migration

1. Create migration: `php artisan make:migration add_foo_to_bar_table`
2. Use `Schema::hasTable()` / `Schema::hasColumn()` guards for idempotency
3. Run locally: `docker exec nexus-php-app php artisan migrate`
4. Refresh schema dump: `bash scripts/refresh-schema-dump.sh`
5. Commit both the migration file AND the updated `database/schema/mysql-schema.sql`

---

## Security Checklist

- [ ] Prepared statements (never concatenate SQL)
- [ ] CSRF tokens on forms
- [ ] Scope all queries by `tenant_id`
- [ ] `htmlspecialchars()` for output
- [ ] Rate limit auth endpoints
- [ ] Validate/sanitize all input
- [ ] Never expose internal errors

## Accessibility (WCAG 2.1 AA)

Minimum 4.5:1 contrast, focus indicators, semantic HTML, ARIA labels, keyboard navigation, screen reader support. HeroUI provides built-in accessibility props.

## Environment Variables

Key `.env` variables (never commit — repo is PUBLIC):

```
DB_HOST, DB_NAME, DB_USER, DB_PASS
PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET
USE_GMAIL_API, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
OPENAI_API_KEY
```

---

## Useful Commands

```bash
# React Frontend
npm run dev:frontend                # Native Vite dev server (localhost:5173)
npm run build                       # Production build
npm test                            # Vitest
npm run lint                        # TypeScript check

# PHP Backend
vendor/bin/phpunit                  # All tests
php tests/run-api-tests.php         # API tests

# Database
docker exec nexus-php-app php artisan migrate  # Run migrations (local)
bash scripts/refresh-schema-dump.sh            # Refresh schema dump after migrations
php scripts/backup_database.php                # Backup

# Maintenance Mode (run on Azure VM via SSH)
sudo bash scripts/maintenance.sh on         # Enable (all tenants, immediate)
sudo bash scripts/maintenance.sh off        # Disable (platform goes live)
sudo bash scripts/maintenance.sh status     # Check current status

# Deploy (run on Azure VM via SSH) — ALWAYS use --detach to survive SSH disconnects
sudo bash scripts/deploy/bluegreen-deploy.sh deploy --detach   # Zero-downtime production deploy
sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach # Rollback to previous color
sudo bash scripts/deploy/bluegreen-deploy.sh status            # Show active color + deploy status
sudo bash scripts/deploy/bluegreen-deploy.sh logs              # Tail blue-green deploy log
sudo bash scripts/deploy/bluegreen-deploy.sh logs -f           # Follow blue-green log live
sudo bash scripts/deploy/bluegreen-deploy.sh monitor           # Live deploy dashboard
bash scripts/purge-cloudflare-cache.sh                         # Cache purge only

# Meilisearch — re-sync search index (run from LOCAL machine via SSH)
# scripts/ is NOT volume-mounted in the PHP container, so must docker cp before exec
# Run after: bulk listing imports, data migrations, or any Meilisearch data loss
source .secrets.local/deploy.env
ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \
  "sudo docker exec nexus-php-app mkdir -p /var/www/html/scripts && \
   sudo docker cp /opt/nexus-php/scripts/sync_search_index.php \
     nexus-php-app:/var/www/html/scripts/sync_search_index.php && \
   sudo docker exec nexus-php-app php scripts/sync_search_index.php --all-tenants"

# Backup (full project snapshot to private repo)
# See BACKUP.md for full documentation
git checkout full-backup                    # Switch to backup branch
git merge main --no-edit                    # Merge latest source
# (swap .gitignore to minimal version — see BACKUP.md)
git add -A && git commit --no-verify -m "chore: backup snapshot $(date +%Y-%m-%d)"
git checkout main                           # Switch back
git push backup full-backup                 # Push ONLY when user says to

# Prerender operations
sudo bash scripts/prerender-tenants.sh --force              # Re-render everything
sudo bash scripts/prerender-tenants.sh --tenant hour-timebank  # Re-render one tenant
sudo bash scripts/prerender-tenants.sh --routes /about,/blog   # Re-render specific routes
sudo docker stop nexus-prerender-worker                        # Stop a stuck worker
```

> 🔴 **Path note for the generated HeroUI docs index below.** Its `root: ./.heroui-docs/react` resolves from `react-frontend/`, not from the repo root where this file lives — the tree is at `react-frontend/.heroui-docs/react/`. Repo-root `.heroui-docs/` holds only `migration/`. The directory is gitignored (`.gitignore:325`), so it is machine-local; regenerate with `heroui agents-md --react` from `react-frontend/` if it is missing.

<!-- HEROUI-REACT-AGENTS-MD-START -->
[HeroUI React v3 Docs Index]|root: ./.heroui-docs/react|STOP. What you remember about HeroUI React v3 is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: heroui agents-md --react --output ../AGENTS.md|.:{components\(buttons)\button-group.mdx,components\(buttons)\button.mdx,components\(buttons)\close-button.mdx,components\(buttons)\toggle-button-group.mdx,components\(buttons)\toggle-button.mdx,components\(collections)\dropdown.mdx,components\(collections)\list-box.mdx,components\(collections)\tag-group.mdx,components\(colors)\color-area.mdx,components\(colors)\color-field.mdx,components\(colors)\color-picker.mdx,components\(colors)\color-slider.mdx,components\(colors)\color-swatch-picker.mdx,components\(colors)\color-swatch.mdx,components\(controls)\slider.mdx,components\(controls)\switch.mdx,components\(data-display)\badge.mdx,components\(data-display)\chip.mdx,components\(data-display)\table.mdx,components\(date-and-time)\calendar.mdx,components\(date-and-time)\date-field.mdx,components\(date-and-time)\date-picker.mdx,components\(date-and-time)\date-range-picker.mdx,components\(date-and-time)\range-calendar.mdx,components\(date-and-time)\time-field.mdx,components\(feedback)\alert.mdx,components\(feedback)\meter.mdx,components\(feedback)\progress-bar.mdx,components\(feedback)\progress-circle.mdx,components\(feedback)\skeleton.mdx,components\(feedback)\spinner.mdx,components\(forms)\checkbox-group.mdx,components\(forms)\checkbox.mdx,components\(forms)\description.mdx,components\(forms)\error-message.mdx,components\(forms)\field-error.mdx,components\(forms)\fieldset.mdx,components\(forms)\form.mdx,components\(forms)\input-group.mdx,components\(forms)\input-otp.mdx,components\(forms)\input.mdx,components\(forms)\label.mdx,components\(forms)\number-field.mdx,components\(forms)\radio-group.mdx,components\(forms)\search-field.mdx,components\(forms)\text-area.mdx,components\(forms)\text-field.mdx,components\(layout)\card.mdx,components\(layout)\separator.mdx,components\(layout)\surface.mdx,components\(layout)\toolbar.mdx,components\(media)\avatar.mdx,components\(navigation)\accordion.mdx,components\(navigation)\breadcrumbs.mdx,components\(navigation)\disclosure-group.mdx,components\(navigation)\disclosure.mdx,components\(navigation)\link.mdx,components\(navigation)\pagination.mdx,components\(navigation)\tabs.mdx,components\(overlays)\alert-dialog.mdx,components\(overlays)\drawer.mdx,components\(overlays)\modal.mdx,components\(overlays)\popover.mdx,components\(overlays)\toast.mdx,components\(overlays)\tooltip.mdx,components\(pickers)\autocomplete.mdx,components\(pickers)\combo-box.mdx,components\(pickers)\select.mdx,components\(typography)\kbd.mdx,components\(typography)\typography.mdx,components\(utilities)\scroll-shadow.mdx,components\index.mdx,getting-started\(handbook)\animation.mdx,getting-started\(handbook)\colors.mdx,getting-started\(handbook)\composition.mdx,getting-started\(handbook)\styling.mdx,getting-started\(handbook)\theming.mdx,getting-started\(overview)\cli.mdx,getting-started\(overview)\design-principles.mdx,getting-started\(overview)\frameworks.mdx,getting-started\(overview)\quick-start.mdx,getting-started\(ui-for-agents)\agent-skills.mdx,getting-started\(ui-for-agents)\agents-md.mdx,getting-started\(ui-for-agents)\llms-txt.mdx,getting-started\(ui-for-agents)\mcp-server.mdx,getting-started\index.mdx,releases\index.mdx,releases\v3-0-0-alpha-32.mdx,releases\v3-0-0-alpha-33.mdx,releases\v3-0-0-alpha-34.mdx,releases\v3-0-0-alpha-35.mdx,releases\v3-0-0-beta-1.mdx,releases\v3-0-0-beta-2.mdx,releases\v3-0-0-beta-3.mdx,releases\v3-0-0-beta-4.mdx,releases\v3-0-0-beta-6.mdx,releases\v3-0-0-beta-7.mdx,releases\v3-0-0-beta-8.mdx,releases\v3-0-0-rc-1.mdx,releases\v3-0-0.mdx,releases\v3-0-2.mdx,releases\v3-0-3.mdx,releases\v3-0-4.mdx,releases\v3-0-5.mdx}|demos/.:{accordion\basic.tsx,accordion\controlled.tsx,accordion\custom-indicator.tsx,accordion\custom-render-function.tsx,accordion\custom-styles.tsx,accordion\disabled.tsx,accordion\faq.tsx,accordion\multiple.tsx,accordion\surface.tsx,accordion\without-separator.tsx,alert-dialog\backdrop-variants.tsx,alert-dialog\close-methods.tsx,alert-dialog\controlled.tsx,alert-dialog\custom-animations.tsx,alert-dialog\custom-backdrop.tsx,alert-dialog\custom-icon.tsx,alert-dialog\custom-portal.tsx,alert-dialog\custom-trigger.tsx,alert-dialog\default.tsx,alert-dialog\dismiss-behavior.tsx,alert-dialog\placements.tsx,alert-dialog\sizes.tsx,alert-dialog\statuses.tsx,alert-dialog\with-close-button.tsx,alert\basic.tsx,autocomplete\allows-empty-collection.tsx,autocomplete\asynchronous-filtering.tsx,autocomplete\controlled-open-state.tsx,autocomplete\controlled.tsx,autocomplete\custom-indicator.tsx,autocomplete\default.tsx,autocomplete\disabled.tsx,autocomplete\email-recipients.tsx,autocomplete\full-width.tsx,autocomplete\location-search.tsx,autocomplete\multiple-select.tsx,autocomplete\required.tsx,autocomplete\single-select.tsx,autocomplete\tag-group-selection.tsx,autocomplete\user-selection-multiple.tsx,autocomplete\user-selection.tsx,autocomplete\variants.tsx,autocomplete\with-description.tsx,autocomplete\with-disabled-options.tsx,autocomplete\with-sections.tsx,avatar\basic.tsx,avatar\colors.tsx,avatar\custom-styles.tsx,avatar\fallback.tsx,avatar\group.tsx,avatar\sizes.tsx,avatar\variants.tsx,badge\basic.tsx,badge\colors.tsx,badge\dot.tsx,badge\placements.tsx,badge\sizes.tsx,badge\variants.tsx,badge\with-content.tsx,breadcrumbs\basic.tsx,breadcrumbs\custom-render-function.tsx,breadcrumbs\custom-separator.tsx,breadcrumbs\disabled.tsx,breadcrumbs\level-2.tsx,breadcrumbs\level-3.tsx,button-group\basic.tsx,button-group\disabled.tsx,button-group\full-width.tsx,button-group\orientation.tsx,button-group\sizes.tsx,button-group\variants.tsx,button-group\with-icons.tsx,button-group\without-separator.tsx,button\basic.tsx,button\custom-render-function.tsx,button\custom-variants.tsx,button\disabled.tsx,button\full-width.tsx,button\icon-only.tsx,button\loading-state.tsx,button\loading.tsx,button\outline-variant.tsx,button\ripple-effect.tsx,button\sizes.tsx,button\social.tsx,button\variants.tsx,button\with-icons.tsx,calendar\basic.tsx,calendar\booking-calendar.tsx,calendar\controlled.tsx,calendar\custom-icons.tsx,calendar\custom-styles.tsx,calendar\default-value.tsx,calendar\disabled.tsx,calendar\focused-value.tsx,calendar\international-calendar.tsx,calendar\min-max-dates.tsx,calendar\multiple-months.tsx,calendar\read-only.tsx,calendar\unavailable-dates.tsx,calendar\with-indicators.tsx,calendar\year-picker.tsx,card\default.tsx,card\horizontal.tsx,card\variants.tsx,card\with-avatar.tsx,card\with-form.tsx,card\with-images.tsx,checkbox-group\basic.tsx,checkbox-group\controlled.tsx,checkbox-group\custom-render-function.tsx,checkbox-group\disabled.tsx,checkbox-group\features-and-addons.tsx,checkbox-group\indeterminate.tsx,checkbox-group\on-surface.tsx,checkbox-group\validation.tsx,checkbox-group\with-custom-indicator.tsx,checkbox\basic.tsx,checkbox\controlled.tsx,checkbox\custom-indicator.tsx,checkbox\custom-render-function.tsx,checkbox\custom-styles.tsx,checkbox\default-selected.tsx,checkbox\disabled.tsx,checkbox\form.tsx,checkbox\full-rounded.tsx,checkbox\indeterminate.tsx,checkbox\invalid.tsx,checkbox\render-props.tsx,checkbox\variants.tsx,checkbox\with-description.tsx,checkbox\with-label.tsx,chip\basic.tsx,chip\statuses.tsx,chip\variants.tsx,chip\with-icon.tsx,close-button\default.tsx,close-button\interactive.tsx,close-button\variants.tsx,close-button\with-custom-icon.tsx,color-area\basic.tsx,color-area\controlled.tsx,color-area\custom-render-function.tsx,color-area\disabled.tsx,color-area\space-and-channels.tsx,color-area\with-dots.tsx,color-field\basic.tsx,color-field\channel-editing.tsx,color-field\controlled.tsx,color-field\custom-render-function.tsx,color-field\disabled.tsx,color-field\form-example.tsx,color-field\full-width.tsx,color-field\invalid.tsx,color-field\on-surface.tsx,color-field\required.tsx,color-field\variants.tsx,color-field\with-description.tsx,color-picker\basic.tsx,color-picker\controlled.tsx,color-picker\with-fields.tsx,color-picker\with-sliders.tsx,color-picker\with-swatches.tsx,color-slider\alpha-channel.tsx,color-slider\basic.tsx,color-slider\channels.tsx,color-slider\controlled.tsx,color-slider\custom-render-function.tsx,color-slider\disabled.tsx,color-slider\rgb-channels.tsx,color-slider\vertical.tsx,color-swatch-picker\basic.tsx,color-swatch-picker\controlled.tsx,color-swatch-picker\custom-indicator.tsx,color-swatch-picker\custom-render-function.tsx,color-swatch-picker\default-value.tsx,color-swatch-picker\disabled.tsx,color-swatch-picker\sizes.tsx,color-swatch-picker\stack-layout.tsx,color-swatch-picker\variants.tsx,color-swatch\accessibility.tsx,color-swatch\basic.tsx,color-swatch\custom-render-function.tsx,color-swatch\custom-styles.tsx,color-swatch\shapes.tsx,color-swatch\sizes.tsx,color-swatch\transparency.tsx,combo-box\allows-custom-value.tsx,combo-box\asynchronous-loading.tsx,combo-box\controlled-input-value.tsx,combo-box\controlled.tsx,combo-box\custom-filtering.tsx,combo-box\custom-indicator.tsx,combo-box\custom-render-function.tsx,combo-box\custom-value.tsx,combo-box\default-selected-key.tsx,combo-box\default.tsx,combo-box\disabled.tsx,combo-box\full-width.tsx,combo-box\menu-trigger.tsx,combo-box\on-surface.tsx,combo-box\required.tsx,combo-box\with-description.tsx,combo-box\with-disabled-options.tsx,combo-box\with-sections.tsx,date-field\basic.tsx,date-field\controlled.tsx,date-field\custom-render-function.tsx,date-field\disabled.tsx,date-field\form-example.tsx,date-field\full-width.tsx,date-field\granularity.tsx,date-field\invalid.tsx,date-field\on-surface.tsx,date-field\required.tsx,date-field\variants.tsx,date-field\with-description.tsx,date-field\with-prefix-and-suffix.tsx,date-field\with-prefix-icon.tsx,date-field\with-suffix-icon.tsx,date-field\with-validation.tsx,date-picker\basic.tsx,date-picker\controlled.tsx,date-picker\custom-render-function.tsx,date-picker\disabled.tsx,date-picker\form-example.tsx,date-picker\format-options-no-ssr.tsx,date-picker\format-options.tsx,date-picker\international-calendar.tsx,date-picker\with-custom-indicator.tsx,date-picker\with-validation.tsx,date-range-picker\basic.tsx,date-range-picker\controlled.tsx,date-range-picker\custom-render-function.tsx,date-range-picker\disabled.tsx,date-range-picker\form-example.tsx,date-range-picker\format-options-no-ssr.tsx,date-range-picker\format-options.tsx,date-range-picker\input-container.tsx,date-range-picker\international-calendar.tsx,date-range-picker\with-custom-indicator.tsx,date-range-picker\with-validation.tsx,description\basic.tsx,disclosure-group\basic.tsx,disclosure-group\controlled.tsx,disclosure\basic.tsx,disclosure\custom-render-function.tsx,drawer\backdrop-variants.tsx,drawer\basic.tsx,drawer\controlled.tsx,drawer\navigation.tsx,drawer\non-dismissable.tsx,drawer\placements.tsx,drawer\scrollable-content.tsx,drawer\with-form.tsx,dropdown\controlled-open-state.tsx,dropdown\controlled.tsx,dropdown\custom-trigger.tsx,dropdown\default.tsx,dropdown\long-press-trigger.tsx,dropdown\single-with-custom-indicator.tsx,dropdown\with-custom-submenu-indicator.tsx,dropdown\with-descriptions.tsx,dropdown\with-disabled-items.tsx,dropdown\with-icons.tsx,dropdown\with-keyboard-shortcuts.tsx,dropdown\with-multiple-selection.tsx,dropdown\with-section-level-selection.tsx,dropdown\with-sections.tsx,dropdown\with-single-selection.tsx,dropdown\with-submenus.tsx,error-message\basic.tsx,error-message\with-tag-group.tsx,field-error\basic.tsx,fieldset\basic.tsx,fieldset\on-surface.tsx,form\basic.tsx,form\custom-render-function.tsx,input-group\default.tsx,input-group\disabled.tsx,input-group\full-width.tsx,input-group\invalid.tsx,input-group\on-surface.tsx,input-group\password-with-toggle.tsx,input-group\required.tsx,input-group\variants.tsx,input-group\with-badge-suffix.tsx,input-group\with-copy-suffix.tsx,input-group\with-icon-prefix-and-copy-suffix.tsx,input-group\with-icon-prefix-and-text-suffix.tsx,input-group\with-keyboard-shortcut.tsx,input-group\with-loading-suffix.tsx,input-group\with-prefix-and-suffix.tsx,input-group\with-prefix-icon.tsx,input-group\with-suffix-icon.tsx,input-group\with-text-prefix.tsx,input-group\with-text-suffix.tsx,input-group\with-textarea.tsx,input-otp\basic.tsx,input-otp\controlled.tsx,input-otp\disabled.tsx,input-otp\form-example.tsx,input-otp\four-digits.tsx,input-otp\on-complete.tsx,input-otp\on-surface.tsx,input-otp\variants.tsx,input-otp\with-pattern.tsx,input-otp\with-validation.tsx,input\basic.tsx,input\controlled.tsx,input\full-width.tsx,input\on-surface.tsx,input\types.tsx,input\variants.tsx,kbd\basic.tsx,kbd\inline.tsx,kbd\instructional.tsx,kbd\navigation.tsx,kbd\special.tsx,kbd\variants.tsx,label\basic.tsx,link\basic.tsx,link\custom-icon.tsx,link\custom-render-function.tsx,link\icon-placement.tsx,link\underline-and-offset.tsx,link\underline-offset.tsx,link\underline-variants.tsx,list-box\controlled.tsx,list-box\custom-check-icon.tsx,list-box\custom-render-function.tsx,list-box\default.tsx,list-box\multi-select.tsx,list-box\virtualization.tsx,list-box\with-disabled-items.tsx,list-box\with-sections.tsx,meter\basic.tsx,meter\colors.tsx,meter\custom-value.tsx,meter\sizes.tsx,meter\without-label.tsx,modal\backdrop-variants.tsx,modal\close-methods.tsx,modal\controlled.tsx,modal\custom-animations.tsx,modal\custom-backdrop.tsx,modal\custom-portal.tsx,modal\custom-trigger.tsx,modal\default.tsx,modal\dismiss-behavior.tsx,modal\placements.tsx,modal\scroll-comparison.tsx,modal\sizes.tsx,modal\with-form.tsx,number-field\basic.tsx,number-field\controlled.tsx,number-field\custom-icons.tsx,number-field\custom-render-function.tsx,number-field\disabled.tsx,number-field\form-example.tsx,number-field\full-width.tsx,number-field\on-surface.tsx,number-field\required.tsx,number-field\validation.tsx,number-field\variants.tsx,number-field\with-chevrons.tsx,number-field\with-description.tsx,number-field\with-format-options.tsx,number-field\with-step.tsx,number-field\with-validation.tsx,pagination\basic.tsx,pagination\controlled.tsx,pagination\custom-icons.tsx,pagination\disabled.tsx,pagination\simple-prev-next.tsx,pagination\sizes.tsx,pagination\with-ellipsis.tsx,pagination\with-summary.tsx,popover\basic.tsx,popover\custom-render-function.tsx,popover\interactive.tsx,popover\placement.tsx,popover\with-arrow.tsx,progress-bar\basic.tsx,progress-bar\colors.tsx,progress-bar\custom-value.tsx,progress-bar\indeterminate.tsx,progress-bar\sizes.tsx,progress-bar\without-label.tsx,progress-circle\basic.tsx,progress-circle\colors.tsx,progress-circle\custom-svg.tsx,progress-circle\indeterminate.tsx,progress-circle\sizes.tsx,progress-circle\with-label.tsx,radio-group\basic.tsx,radio-group\controlled.tsx,radio-group\custom-indicator.tsx,radio-group\custom-render-function.tsx,radio-group\delivery-and-payment.tsx,radio-group\disabled.tsx,radio-group\horizontal.tsx,radio-group\on-surface.tsx,radio-group\uncontrolled.tsx,radio-group\validation.tsx,radio-group\variants.tsx,range-calendar\allows-non-contiguous-ranges.tsx,range-calendar\basic.tsx,range-calendar\booking-calendar.tsx,range-calendar\controlled.tsx,range-calendar\default-value.tsx,range-calendar\disabled.tsx,range-calendar\focused-value.tsx,range-calendar\international-calendar.tsx,range-calendar\invalid.tsx,range-calendar\min-max-dates.tsx,range-calendar\multiple-months.tsx,range-calendar\read-only.tsx,range-calendar\three-months.tsx,range-calendar\unavailable-dates.tsx,range-calendar\with-indicators.tsx,range-calendar\year-picker.tsx,scroll-shadow\custom-size.tsx,scroll-shadow\default.tsx,scroll-shadow\hide-scroll-bar.tsx,scroll-shadow\orientation.tsx,scroll-shadow\visibility-change.tsx,scroll-shadow\with-card.tsx,search-field\basic.tsx,search-field\controlled.tsx,search-field\custom-icons.tsx,search-field\custom-render-function.tsx,search-field\disabled.tsx,search-field\form-example.tsx,search-field\full-width.tsx,search-field\on-surface.tsx,search-field\required.tsx,search-field\validation.tsx,search-field\variants.tsx,search-field\with-description.tsx,search-field\with-keyboard-shortcut.tsx,search-field\with-validation.tsx,select\asynchronous-loading.tsx,select\controlled-multiple.tsx,select\controlled-open-state.tsx,select\controlled.tsx,select\custom-indicator.tsx,select\custom-render-function.tsx,select\custom-value-multiple.tsx,select\custom-value.tsx,select\default.tsx,select\disabled.tsx,select\full-width.tsx,select\multiple-select.tsx,select\on-surface.tsx,select\required.tsx,select\variants.tsx,select\with-description.tsx,select\with-disabled-options.tsx,select\with-sections.tsx,separator\basic.tsx,separator\custom-render-function.tsx,separator\manual-variant-override.tsx,separator\variants.tsx,separator\vertical.tsx,separator\with-content.tsx,separator\with-surface.tsx,skeleton\animation-types.tsx,skeleton\basic.tsx,skeleton\card.tsx,skeleton\grid.tsx,skeleton\list.tsx,skeleton\single-shimmer.tsx,skeleton\text-content.tsx,skeleton\user-profile.tsx,slider\custom-render-function.tsx,slider\default.tsx,slider\disabled.tsx,slider\range.tsx,slider\vertical.tsx,spinner\basic.tsx,spinner\colors.tsx,spinner\sizes.tsx,surface\variants.tsx,switch\basic.tsx,switch\controlled.tsx,switch\custom-render-function.tsx,switch\custom-styles.tsx,switch\default-selected.tsx,switch\disabled.tsx,switch\form.tsx,switch\group-horizontal.tsx,switch\group.tsx,switch\label-position.tsx,switch\render-props.tsx,switch\sizes.tsx,switch\with-description.tsx,switch\with-icons.tsx,switch\without-label.tsx,table\async-loading.tsx,table\basic.tsx,table\column-resizing.tsx,table\custom-cells.tsx,table\empty-state.tsx,table\expandable-rows.tsx,table\pagination.tsx,table\secondary-variant.tsx,table\selection.tsx,table\sorting.tsx,table\tanstack-table.tsx,table\virtualization.tsx,tabs\basic.tsx,tabs\custom-render-function.tsx,tabs\custom-styles.tsx,tabs\disabled.tsx,tabs\secondary-vertical.tsx,tabs\secondary.tsx,tabs\vertical.tsx,tabs\with-separator.tsx,tag-group\basic.tsx,tag-group\controlled.tsx,tag-group\custom-render-function.tsx,tag-group\disabled.tsx,tag-group\selection-modes.tsx,tag-group\sizes.tsx,tag-group\variants.tsx,tag-group\with-error-message.tsx,tag-group\with-list-data.tsx,tag-group\with-prefix.tsx,tag-group\with-remove-button.tsx,textarea\basic.tsx,textarea\controlled.tsx,textarea\full-width.tsx,textarea\on-surface.tsx,textarea\rows.tsx,textarea\variants.tsx,textfield\basic.tsx,textfield\controlled.tsx,textfield\custom-render-function.tsx,textfield\disabled.tsx,textfield\full-width.tsx,textfield\input-types.tsx,textfield\on-surface.tsx,textfield\required.tsx,textfield\textarea.tsx,textfield\validation.tsx,textfield\with-description.tsx,textfield\with-error.tsx,time-field\basic.tsx,time-field\controlled.tsx,time-field\custom-render-function.tsx,time-field\disabled.tsx,time-field\form-example.tsx,time-field\full-width.tsx,time-field\invalid.tsx,time-field\on-surface.tsx,time-field\required.tsx,time-field\with-description.tsx,time-field\with-prefix-and-suffix.tsx,time-field\with-prefix-icon.tsx,time-field\with-suffix-icon.tsx,time-field\with-validation.tsx,toast\callbacks.tsx,toast\custom-indicator.tsx,toast\custom-queue.tsx,toast\custom-toast.tsx,toast\default.tsx,toast\placements.tsx,toast\promise.tsx,toast\simple.tsx,toast\variants.tsx,toggle-button-group\attached.tsx,toggle-button-group\basic.tsx,toggle-button-group\controlled.tsx,toggle-button-group\disabled.tsx,toggle-button-group\full-width.tsx,toggle-button-group\orientation.tsx,toggle-button-group\selection-mode.tsx,toggle-button-group\sizes.tsx,toggle-button-group\without-separator.tsx,toggle-button\basic.tsx,toggle-button\controlled.tsx,toggle-button\disabled.tsx,toggle-button\icon-only.tsx,toggle-button\sizes.tsx,toggle-button\variants.tsx,toolbar\basic.tsx,toolbar\custom-styles.tsx,toolbar\vertical.tsx,toolbar\with-button-group.tsx,tooltip\basic.tsx,tooltip\custom-render-function.tsx,tooltip\custom-trigger.tsx,tooltip\placement.tsx,tooltip\with-arrow.tsx,typography\default.tsx,typography\primitives.tsx,typography\prose.tsx,typography\render-props.tsx,typography\typography-scale.tsx}
<!-- HEROUI-REACT-AGENTS-MD-END -->
