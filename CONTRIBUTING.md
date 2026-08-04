# Contributing to Project NEXUS

Thank you for your interest in contributing to Project NEXUS — an open-source, multi-tenant community timebanking platform. This guide covers everything you need to get started, including environment setup, coding standards, and the pull request process.

Project NEXUS is released under **AGPL-3.0-or-later**. By contributing, you agree that your contributions will be licensed under the same terms.

By submitting a contribution, you also agree to the [Project NEXUS Contributor Terms](CONTRIBUTOR_TERMS.md), including the licence, patent, ownership, third-party-code, and AI-disclosure terms described there.

**Repository:** https://github.com/jasperfordesq-ai/nexus-v1

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Contributor Terms](#contributor-terms)
3. [Getting Started](#getting-started)
4. [Development Environment Setup](#development-environment-setup)
5. [Project Structure Overview](#project-structure-overview)
6. [How to Contribute](#how-to-contribute)
7. [Frontend Contribution Workflow](#frontend-contribution-workflow)
8. [Backend Contribution Workflow](#backend-contribution-workflow)
9. [Mobile Contribution Workflow](#mobile-contribution-workflow)
10. [SPDX Header Requirement (Mandatory)](#spdx-header-requirement-mandatory)
11. [Coding Standards](#coding-standards)
12. [Git Commit Convention](#git-commit-convention)
13. [Running Tests](#running-tests)
14. [AGPL-3.0 Compliance](#agpl-30-compliance)
15. [Attribution Requirements](#attribution-requirements)

---

## Code of Conduct

All contributors are expected to behave respectfully and professionally. We do not tolerate harassment, discrimination, or hostile behaviour in any project space — issues, pull requests, discussions, or elsewhere. Please report any concerns to the project maintainer.

---

## Contributor Terms

All contributions are subject to the [Project NEXUS Contributor Terms](CONTRIBUTOR_TERMS.md). These terms give Jasper Ford, and any entity he designates to steward Project NEXUS, the right to use contributions under AGPL-3.0-or-later and under commercial or proprietary licence terms.

These terms are intentionally broad so the Project Steward can keep Project NEXUS open source while also offering private licensing, hosted services, support, and other commercial arrangements. Do not submit a contribution unless you can grant the copyright, patent, sublicensing, and relicensing rights described in `CONTRIBUTOR_TERMS.md`.

Do not submit a contribution unless you have the right to make that grant. Contributions must not include secrets, confidential material, incompatible third-party code, or undisclosed AI-generated material.

Pull requests are checked automatically. A PR cannot pass the Project NEXUS PR quality checks unless the contributor-terms acknowledgement is checked and the AI and third-party-material disclosure fields are completed.

---

## Getting Started

1. **Fork** the repository on GitHub: https://github.com/jasperfordesq-ai/nexus-v1
2. **Clone** your fork:

   ```bash
   git clone https://github.com/YOUR_USERNAME/nexus-v1.git
   cd nexus-v1
   ```

3. **Set up the development environment** (see below).
4. **Create a branch** for your work:

   ```bash
   git checkout -b feat/your-feature-name
   ```

5. Make your changes, write tests, and submit a pull request.

---

## Development Environment Setup

Project NEXUS is Docker-first for local development. Use Docker for the PHP app, database, Redis, and Meilisearch. The default frontend workflow runs Vite natively for fast HMR and proxies `/api` to the Docker PHP app.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) or Docker Engine + Compose (Linux)
- Node.js 22+ and npm 10+ for the React/Vite frontend when running it natively
- Git

### Start the platform

```bash
# Start the Docker PHP app, database, Redis, and Meilisearch
docker compose --profile docker-php up -d app

# Start the React frontend with native Vite
npm run dev:frontend
```

The first Docker run will pull and build images, which may take several minutes. The Laravel API is available through the Docker PHP app at `localhost:8090`.

### Service URLs

| Service | URL |
|---------|-----|
| React Frontend | http://localhost:5173 |
| PHP API | http://localhost:8090 |
| Sales Site | http://localhost:3001 |
| React Admin | http://localhost:5173/admin |
| phpMyAdmin | http://localhost:8091 (start with `--profile tools`) |

### Environment variables

Copy `.env.example` to `.env` and fill in the required values. **Never commit `.env`** — the repository is public.

### Additional setup notes

Current local-development commands are maintained in `README.md`, `AGENTS.md`, `compose.yml`, and `package.json`.

### Documentation hygiene

The public `docs/` directory is for maintained reference material only. Do not add raw prompts, handoffs, scratch plans, generated audits, exported PDFs, or one-off reports there. Put local task output in `.local-docs-archive/` instead.

Every new public doc must be linked from `docs/README.md` and pass:

```bash
npm run check:docs
```

### Version and changelog hygiene

Project NEXUS keeps the current platform version in `VERSION`. When preparing a release, update `VERSION`, `composer.json`, `react-frontend/package.json`, `config/app.php`, `README.md`, `CHANGELOG.md`, `react-frontend/src/config/releaseStatus.ts`, and current public collateral together, then run:

```bash
npm run check:version
```

Every release-relevant contribution should update `CHANGELOG.md` under `[Unreleased]`. After editing the root changelog, refresh the copy served by the React app:

```bash
npm --prefix react-frontend run copy-changelog
```

For internal-only changes with no release note, say so in the PR or commit notes.

---

## Project Structure Overview

```text
nexus-v1/
├── react-frontend/               # React 19 + HeroUI v3 + Tailwind CSS 4 SPA (PRIMARY UI)
│   ├── src/
│   │   ├── components/           # Shared UI components
│   │   ├── contexts/             # React context providers
│   │   ├── hooks/                # Custom React hooks
│   │   ├── pages/                # Page-level components (one per route)
│   │   ├── lib/                  # Utilities, API client, helpers
│   │   ├── styles/               # tokens.css (theme-aware CSS variables)
│   │   └── types/                # TypeScript type definitions
│   └── CLAUDE.md                 # React-specific conventions
├── app/                          # Laravel 12 application (PHP 8.2+)
│   ├── Http/Controllers/         # Laravel controllers
│   ├── Models/                   # Eloquent models
│   ├── Services/                 # Business logic services
│   └── Listeners/                # Event listeners
├── accessible-frontend/          # HTML-first accessible frontend served by Laravel
├── mobile/                       # Expo (React Native) mobile app
├── database/
│   └── migrations/               # Laravel migrations (use these for new schema changes)
├── migrations/                   # Legacy SQL migrations (historical)
├── tests/                        # PHPUnit test suite
├── docs/                         # Developer documentation
├── scripts/                      # Build, deploy, and maintenance scripts
├── compose.yml                   # Docker Compose (development)
└── compose.prod.yml              # Docker Compose (production)
```

**The React frontend (`react-frontend/`) is the primary UI.** All maintained user-facing and admin UI work belongs in React, except for the approved accessible frontend under `accessible-frontend/`. Legacy PHP views are retired; do not create new PHP views.

---

## How to Contribute

### Reporting bugs

Open an issue on GitHub with:

- A clear, descriptive title
- Steps to reproduce
- Expected vs. actual behaviour
- Browser/OS/version details if relevant
- Any relevant console errors or screenshots

### Requesting features

Open a GitHub Discussion or issue tagged `enhancement`. Describe the use case, not just the solution. Large features should be discussed before implementation begins.

### Submitting a pull request

1. Make sure your branch is based on the latest `main`.
2. Write or update tests for your changes.
3. Run the relevant blocking checks below and make sure they pass; CI re-runs the authoritative gates.
4. Open a PR against `main` with a clear description of:
   - What the change does
   - Why it is needed
   - How to test it
5. Link any related issues.

Fix PRs must include a **Root Cause** and **Prevention** explanation in the description.

### Discussions

For questions, architectural ideas, or anything not suited to an issue, use GitHub Discussions.

---

## Frontend Contribution Workflow

The React frontend lives in `react-frontend/`. See [react-frontend/CLAUDE.md](react-frontend/CLAUDE.md) for full conventions.

### Stack

| Tool | Version |
|------|---------|
| React | 19 |
| TypeScript | 5 (strict mode) |
| HeroUI | v3 via `@heroui/react` |
| Tailwind CSS | 4 |
| Animation | Local `@/lib/motion` CSS-transition shim; do not add `framer-motion` |
| Icons | Lucide React (`lucide-react`) only |
| Testing | Vitest |

### Component rules

- **HeroUI first.** Use HeroUI components (`Button`, `Card`, `Modal`, `Input`, `Chip`, etc.) as primary building blocks. Only fall back to raw HTML elements when HeroUI has no equivalent.
- **Tailwind utilities only.** Apply all layout, spacing, and colour via Tailwind utility classes. Do not create separate CSS component files.
- **CSS tokens.** Use theme-aware colour variables from `src/styles/tokens.css` (e.g., `var(--color-primary)`) for colours that must adapt to light/dark themes.
- **Icons.** Import icons exclusively from `lucide-react`. Do not use other icon libraries.
- **No hardcoded colours.** Never use raw hex values or Tailwind colour utilities that bypass the token system for brand/semantic colours.

### Adding a new page

1. Create a page component in `react-frontend/src/pages/`.
2. Add the route in the right route module — `react-frontend/src/routes/AppRoutes.tsx` for member pages (this is also where all `FeatureGate` gating lives), `src/routes/PublicAppRoutes.tsx` for pre-auth public pages, `src/routes/AuthRoutes.tsx` for auth pages, `src/admin/routes.tsx` for admin. `src/App.tsx` is a thin shell with one catch-all delegating to `TenantShell` — do not add page routes there.
3. Call `usePageTitle()` at the top of the component.
4. Use `tenantPath()` for all internal navigation links.
5. Write a Vitest test covering the key render paths.

### Running the frontend dev server

```bash
# Native Vite (recommended on Windows maintainer machines)
cd react-frontend
npm install
npm run dev

# Or from the repository root
npm run dev:frontend

# Docker Vite is available when deliberately testing the frontend container
docker compose --profile docker-frontend up -d frontend
```

### Frontend tests

```bash
cd react-frontend
npm test          # Run Vitest in watch mode
npm run lint      # ESLint + TypeScript (blocking)
npm run build     # Production build check
```

---

## Backend Contribution Workflow

The backend is Laravel 12 + PHP 8.2+. Follow existing patterns in `app/Services/`, `app/Http/Controllers/Api/`, Eloquent models, and `routes/api.php`; old standalone PHP conventions notes have been retired.

### Namespace conventions

| Code | Namespace | Location |
|------|-----------|----------|
| New Laravel code | `App\` | `app/` |

All new PHP code goes in `app/`. The legacy top-level `src/` namespace has been removed.

### Multi-tenant scoping (CRITICAL)

**Every database query against a tenant-scoped table must include a `tenant_id` filter.** This is a security requirement, not a preference.

```php
// Correct
$listings = Listing::where('tenant_id', TenantContext::getId())
    ->where('status', 'active')
    ->get();

// WRONG — never do this
$listings = Listing::where('status', 'active')->get();
```

The `tenant_id` column must appear in every `WHERE`, `UPDATE`, and `DELETE` on tenant-scoped tables. A missing scope is a cross-tenant data leak (IDOR vulnerability).

### Services

- Services use static methods.
- Always resolve the tenant ID via `TenantContext::getId()` at the start of each method.
- Business logic lives in services; controllers are thin.

### Database migrations

New schema changes use Laravel migrations in `database/migrations/`:

```bash
php artisan make:migration create_my_table
```

- Always use `if exists` / `if not exists` guards for idempotency.
- Never modify existing migration files that have already run in production — create a new migration instead.

### Running the backend

```bash
docker compose --profile docker-php up -d app
# Docker PHP API is available at http://localhost:8090
```

### Backend tests

```bash
# From your local machine via Docker
docker exec nexus-php-app vendor/bin/phpunit
docker exec nexus-php-app vendor/bin/phpunit --testsuite Laravel
docker exec nexus-php-app vendor/bin/phpunit --testsuite LaravelMigrated
docker exec nexus-php-app vendor/bin/phpunit --testsuite Integration
```

The only declared suites are `Laravel`, `Integration`, and `LaravelMigrated`
(`phpunit.xml`). Names that match nothing — `--testsuite Unit`, `--testsuite Services` —
exit 0 with "No tests executed!", which reads as a pass. Unit tests live under
`tests/Laravel/Unit` and run as part of the `Laravel` suite.

Test environment uses `APP_ENV=testing`, database `nexus_test`, and `CACHE_DRIVER=array`.

---

## Mobile Contribution Workflow

The mobile app is an Expo (React Native) application in `mobile/`, built and released through EAS. It shares the same React component patterns as the main frontend. It does **not** use Capacitor — Capacitor (`@capacitor/cli`, `@capacitor/core` in the root `package.json`) wraps the React web app, not `mobile/`.

### Stack

- Expo (React Native) + Expo Router, released via EAS
- TypeScript strict mode
- Same HeroUI and Tailwind conventions as `react-frontend/` where applicable

### Running mobile tests

```bash
cd mobile
npm test
```

`mobile/package.json` maps `test` to Jest. There is no `expo test` command in the installed Expo SDK.

### Key notes

- Mobile-specific API calls live in `mobile/lib/api/`.
- Security-sensitive logic (certificate pinning, etc.) lives in `mobile/lib/security/`.
- Follow the same SPDX header and multi-tenant rules that apply everywhere else.

---

## SPDX Header Requirement (Mandatory)

**Every new source file** (`.php`, `.ts`, `.tsx`) must include the following SPDX copyright header.

**TypeScript / TSX** — first lines of the file:

```typescript
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

**PHP** — immediately after `<?php`:

```php
<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

### Tooling

```bash
# Add headers to all files missing them
node scripts/add-spdx-headers.mjs

# Verify all files have correct headers
node scripts/check-spdx.mjs
```

Pull requests that introduce new source files without SPDX headers will not be merged.

---

## Coding Standards

### Global platform — no locale-specific validation

Project NEXUS serves timebanks worldwide. **Never add Ireland-specific or any other locale-specific validation.**

- Use `Validator::isPhone()` for international E.164 phone validation — never `isIrishPhone()` or any pattern matching `+353`, `08x`, or `00353`.
- Use neutral international examples in form placeholders (e.g., `+1 555 123 4567`), not Irish numbers.
- Never default maps or location fields to Ireland/Dublin. Use a neutral global centre.
- Do not add locale-specific location validation. The old `validateIrishLocation()` helper has been deleted; `app/Core/Validator.php` deliberately exposes no Irish-specific validator (see the note at the top of that file about `isIrishPhone()`).

### Dead legacy themes — never touch

PHP-rendered themes under `views/` are retired legacy code. Do not modify, fix, refactor, or add PHP views for product UI. The maintained UIs are the React app and the approved accessible frontend.

### General rules

- **Prepared statements always.** Never concatenate user input into SQL queries.
- **CSRF tokens** on all state-changing forms.
- **`htmlspecialchars()`** on all PHP output that is not already escaped.
- **Rate-limit auth endpoints.**
- **Validate and sanitize all input** before use.
- **Never expose internal error details** to the client.
- **No raw arrays as query parameters** — use `implode(',', array_fill(0, count($ids), '?'))` for `IN` clauses.
- **TypeScript strict mode** — no `any` unless absolutely unavoidable, and document why.
- **Accessibility (WCAG 2.1 AA)** — minimum 4.5:1 contrast ratio, focus indicators, semantic HTML, ARIA labels, keyboard navigation. HeroUI provides built-in accessibility props.

---

## Git Commit Convention

Use the following prefixes for commit messages:

| Prefix | When to use |
|--------|-------------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `style:` | Formatting, whitespace (no logic change) |
| `refactor:` | Code restructure (no feature or bug change) |
| `test:` | Adding or fixing tests |
| `chore:` | Maintenance, dependency updates, tooling |

**Format:**

```
<prefix>(<scope>): <short imperative description>

Optional longer explanation if needed.

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Examples:**

```
feat(wallet): Add time credit transfer confirmation modal
fix(listings): Correct tenant_id scope in search query
test(events): Add PHPUnit coverage for EventService::create
refactor(auth): Extract token validation to AuthHelper
```

- Keep the subject line under 72 characters.
- Use the imperative mood ("Add" not "Added", "Fix" not "Fixed").
- Reference GitHub issues in the body when relevant (`Closes #123`).

### Pre-commit verify gate

Install the repository-managed hook with `bash scripts/git-hooks/install-hooks.sh`. Its pre-commit gate runs only when PHP test files are staged: it enforces the schema-skip budget and, when PHP plus the test database are available, runs those staged test files in isolation. The repository does not install a pre-push hook; GitHub Actions remains the authoritative full gate.

Never use `--no-verify` to bypass a failure from the staged-PHP-test gate: fix the test or remove it from the commit. The documented exception applies only when another locally configured lint/build hook is blocked solely by a pre-existing failure in files your change does not touch; explain that exception in the pull-request description.

---

## Running Tests

### React frontend (Vitest)

```bash
cd react-frontend
npm test -- SearchPage                  # Targeted Vitest watch example
npm run lint                            # ESLint + TypeScript (blocking)
npm run test:a11y -- --run              # Accessibility contracts (blocking)
npm run test:ui-contracts -- --run      # UI contracts (blocking)
npm run build                           # Production build (blocking)
```

The full frontend suite **is** a release success criterion. CI runs it as `React Full Suite (shard N/8)` (`react-tests-full`, via `react-frontend/scripts/run-vitest-shard.mjs`), blocking since 2026-07-28 and listed in the `release-gate` `needs:` array. It covers every suite except the 55 quarantined in `react-frontend/src/test/failing-suites.baseline.json`, so a green pipeline proves 1,228 of 1,283 suites; that list may only shrink, and its ceiling is enforced by `react-frontend/scripts/check-quarantine-budget.mjs` (run as `npm run check:quarantine-budget`). That ceiling step deliberately lives in the `react-build` job, not in `react-tests-full`, so it cannot be swallowed by a job-level `continue-on-error`. The focused smoke step is also blocking — it runs serially (`--pool=forks --poolOptions.forks.singleFork=true`), which is what fixed the old parallel worker-pool hang. Only the coverage report step is non-blocking.

Test files run concurrently on a developer machine and serially in CI — see
[docs/LOCAL-PERFORMANCE.md](docs/LOCAL-PERFORMANCE.md). Use
`NEXUS_VITEST_MAX_FORKS=1` to reproduce a suspected ordering bug serially, and do
not hard-code `--maxWorkers` or `--no-file-parallelism` into scripts.

### PHP backend (PHPUnit)

```bash
# Via Docker (recommended)
docker exec nexus-php-app vendor/bin/phpunit
docker exec nexus-php-app vendor/bin/phpunit --testsuite Laravel
docker exec nexus-php-app vendor/bin/phpunit --testsuite LaravelMigrated
docker exec nexus-php-app vendor/bin/phpunit --testsuite Integration
docker exec nexus-php-app php tests/run-api-tests.php
```

### Mobile (Expo)

```bash
cd mobile
npm run verify:release
npm run type-check
npm test -- --runInBand --silent
npx expo-doctor
```

### Static analysis (PHP)

```bash
docker exec nexus-php-app vendor/bin/phpstan analyse --no-progress --memory-limit=512M
```

PHPStan/Larastan targets the Laravel `app/` codebase with the repository baseline in `phpstan-baseline.neon`. Keep new findings out of touched code and run the configured command before risky backend changes.

For a full local run, use the workstation config, which raises only the worker
count and job size — never the level, paths, or ignore rules:

```bash
docker exec nexus-php-app php vendor/bin/phpstan analyse --configuration phpstan.local.neon --memory-limit=4G --no-progress
```

---

## AGPL-3.0 Compliance

Project NEXUS is licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

Key obligations for contributors:

1. **Any modified version** of this software, when made available over a network (e.g., as a hosted service), must provide the complete corresponding source code to users of that service.
2. **All new files** you contribute must carry the SPDX header shown in the [SPDX Header Requirement](#spdx-header-requirement-mandatory) section.
3. **Attribution must not be removed.** The footer, mobile drawer, and auth pages must display the AGPL Section 7(b) attribution. Do not remove or obscure this attribution.
4. **Third-party dependencies** you add must be compatible with AGPL-3.0. Licenses that are incompatible with AGPL (e.g., proprietary, SSPL, non-commercial-only) may not be introduced.
5. **The NOTICE file** contains authoritative legal terms (Section 7 a–f). Do not modify it without fully understanding the implications.

The full license text is in the `LICENSE` file at the repository root.

---

## Attribution Requirements

Project NEXUS applies AGPL Section 7(b) attribution requirements. This means:

- **Every user-facing page** (footer, mobile drawer, authentication pages) must display the project attribution. Do not remove these.
- **Contributors** are listed in `react-frontend/src/data/contributors.json` and rendered programmatically on the About page. They are never hardcoded in templates.
- **AI-generated code** (e.g., produced with Claude Code) should include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit message.
- The `NOTICE` file at the repository root is the canonical record of authorship and third-party acknowledgements.

---

## Questions?

If anything in this guide is unclear, open a GitHub Discussion or file an issue. We're happy to help new contributors get set up.
