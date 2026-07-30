# Your First Contribution to Project NEXUS

Last reviewed: 2026-07-30

This tutorial walks you through making a real, merged-quality change to Project NEXUS from scratch. By the end you will have cloned the repository, run the app locally, made a visible change, verified it, and prepared it for a pull request.

This is a **tutorial** — a guided, hands-on learning path. For reference material (architecture, module guides, API) see [docs/README.md](README.md).

---

## What you will do

You will change the English label for a UI string on the public features page using the translation system. The change is small enough to understand completely and visible enough to confirm in the browser. Every step here applies to every future change you make.

---

## Step 1: Check your prerequisites

You need the following tools installed before you begin.

| Tool | Minimum version | How to check |
|------|----------------|--------------|
| Git | any recent | `git --version` |
| Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux) | current stable | `docker --version` |
| Node.js | 22+ | `node --version` |
| npm | 10+ | `npm --version` |

If Docker is not running, start it now. The data services (database, cache, and search) run inside containers.

---

## Step 2: Fork and clone the repository

1. Open https://github.com/jasperfordesq-ai/nexus-v1 in your browser.
2. Click **Fork** to create your own copy under your GitHub account.
3. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/nexus-v1.git
cd nexus-v1
```

4. Add the upstream repository so you can pull future changes:

```bash
git remote add upstream https://github.com/jasperfordesq-ai/nexus-v1.git
```

---

## Step 3: Set up the environment file

Copy the Docker example environment file and open it in a text editor:

```bash
cp .env.docker.example .env.docker
```

The file contains placeholder values. For this tutorial, the defaults are enough to start the data services. The only value you may need to generate is `APP_KEY`; the comment inside the file explains how.

> **Keep `.env.docker` private.** The repository is public and local environment files are gitignored — never commit them.

---

## Step 4: Start the data services and frontend

Install the root and React dependencies:

```bash
npm ci
npm --prefix react-frontend ci
```

Start the Docker PHP app, MariaDB, Redis, and Meilisearch plus the native Vite development server:

```bash
npm run dev:docker
```

The first run downloads and builds images and then keeps Vite attached to the current terminal. In a second terminal, run the database migrations and first-run seed data:

```bash
docker exec nexus-php-app php artisan migrate --seed
```

The seeder creates the master tenant (`tenant_id=1`) and a local platform administrator. Unless you changed `NEXUS_BOOTSTRAP_ADMIN_EMAIL` or `NEXUS_BOOTSTRAP_ADMIN_PASSWORD` in your env file, the first login is:

```text
Email: admin@project-nexus.local
Password: ChangeMe123!
```

Vite will print a message like:

```
  VITE v7.x.x  ready in 1234 ms
  ➜  Local:   http://127.0.0.1:5173/
```

---

## Step 5: Confirm the app loads

Open http://127.0.0.1:5173/ in your browser. You should see the Project NEXUS React frontend. If it shows a loading spinner or a login page, the app is running correctly.

> **Do not add a tenant slug to the URL.** The seed step above creates only the slug-less **Master Tenant**, so there is no `/hour-timebank` (or any other slug) to visit. On the Vite dev server the SPA takes the first path segment as a tenant slug (`extractSlugFromPath` in `react-frontend/src/lib/tenant-routing.ts`) and sends it on to the API, where it fails to resolve: `app/Http/Middleware/ResolveTenant.php` answers `400` with `tenant_resolution_failed` (or `tenant_required`), so the app renders an error rather than a dashboard. On the PHP host at `http://127.0.0.1:8090` the same bad first segment is instead hard-404'd by `app/Core/TenantContext.php` ("STRICT ISOLATION"). Reserved segments such as `/features` and `/about` are React routes, not slugs, so they resolve against the default tenant and work fine. CI inserts a `hour-timebank` tenant by hand for its E2E runs (`.github/workflows/ci.yml`); the default seeder does not create it.

Open http://127.0.0.1:8090/up in a separate tab — if Laravel is healthy, it returns a small successful response.

> If you see an error instead, check that all four Docker containers are running:
>
> ```bash
> docker ps
> ```
>
> You should see containers for the database, Redis, Meilisearch, and the PHP app.

---

## Step 6: Create a branch

Never commit directly to `main` in your fork. Create a branch with a name that describes your change:

```bash
git checkout -b docs/fix-features-page-label
```

---

## Step 7: Make a visible change

The React frontend uses a translation system so every user-facing string can be localised into 11 languages. Strings are stored as JSON files under `react-frontend/public/locales/`. The English source is in `react-frontend/public/locales/en/`.

You are going to change the "Beta" chip label on the public features page. Open the file:

```
react-frontend/public/locales/en/public.json
```

Find this section near the top of the file:

```json
"features_page": {
    "chips": {
        "beta": "Beta",
        "preview": "Preview",
        "dormant": "Built, not enabled"
    },
```

Change the `"beta"` value — for example, to `"Beta (active)"` — so you have a concrete, browser-visible change to verify. Leave `"preview"` and `"dormant"` exactly as they are; deleting a key would fail the i18n gates you run in Step 8:

```json
"chips": {
    "beta": "Beta (active)",
    "preview": "Preview",
    "dormant": "Built, not enabled"
},
```

Save the file.

Now go to your browser and navigate to http://127.0.0.1:5173/features. Because Vite watches the file system, the page reloads automatically. You should see the chip label updated.

You have just made a real, traceable change through the translation system — the same system used for every user-facing string across all 11 supported languages.

> **If you want to try something different:** you can also fix a typo in any of the `.md` files in `docs/`. Public documentation is release-relevant, so still run the documentation and changelog gates below.

---

## Step 8: Verify the change

Before committing, run the checks that CI will run on your pull request.

**Record the release-relevant change:**

Add a concise bullet under `[Unreleased]` in the root `CHANGELOG.md`, for example:

```markdown
- **The public Features page now identifies the active Beta release stage more clearly.**
```

Refresh the ignored in-app copy from that canonical file:

```bash
npm --prefix react-frontend run copy-changelog
```

**Blocking React checks:**

```bash
cd react-frontend
npm run lint
npm run test:a11y -- --run
npm run test:ui-contracts -- --run
npm run build
```

The lint command runs ESLint plus `tsc --noEmit`; the next commands exercise the blocking accessibility/UI contracts and production build.

Locally, a single `npm test -- --run` across the whole suite can still hit the documented worker-pool hang, so it is not a reliable local success criterion — run the suites your change touches instead, in the foreground.

That is a *local* limitation only. **In CI the whole suite does run and does block**, split across eight shards by `scripts/run-vitest-shard.mjs` (blocking since 2026-07-28, covering 1,228 of 1,283 suites). To reproduce a shard locally:

```bash
cd react-frontend
node scripts/run-vitest-shard.mjs --shard 1/8
```

Use `--retry=0` when verifying a suite you have just fixed: the shard runner passes `--retry=1`, so a flaky suite can otherwise look repaired. See [TESTING.md](TESTING.md) for the quarantine list and its rules.

**Documentation hygiene** (required when editing any file in `docs/`):

```bash
cd ..
npm run check:docs
```

**Translation drift check** (required when editing locale files):

```bash
npm run check:i18n:drift
npm run check:i18n:baseline
npm run check:version
npm run check:changelog
```

All checks should pass. If any fail because of your change, fix them before moving on.

---

## Step 9: Add the SPDX header to any new source files

If your change adds a **new** `.ts`, `.tsx`, or `.php` file — rather than editing an existing one — you must add this copyright header as the very first lines of the file.

For TypeScript or TSX:

```typescript
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

For PHP (immediately after `<?php`):

```php
<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
```

For this tutorial you edited an existing JSON file, so no header is needed. But remember this rule for every new source file you create in the future.

To check all files in bulk:

```bash
node scripts/check-spdx.mjs
```

---

## Step 10: Commit your change

Stage the source change and its canonical release note:

```bash
git add react-frontend/public/locales/en/public.json CHANGELOG.md
```

Write a commit message using the [conventional commit](../CONTRIBUTING.md#git-commit-convention) format:

```bash
git commit -m "docs(features): clarify Beta chip label in public features page"
```

Commit message rules:

- Use a prefix: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, or `chore`
- Keep the subject under 72 characters
- Use the imperative mood ("Add", "Fix", "Update") — not past tense

If you used AI assistance, add a co-author line in the commit body:

```
docs(features): clarify Beta chip label in public features page

Co-Authored-By: Claude <noreply@anthropic.com>
```

No hooks run automatically on a fresh clone — Husky is intentionally disabled at repository root, so there is nothing to install and nothing to bypass. The checks in Step 8 are the ones that matter, and CI re-runs them on your pull request.

There is one optional local hook, and it is worth installing:

```bash
bash scripts/git-hooks/install-hooks.sh
```

That installs `pre-commit`, which runs **only the PHP test files staged in the current commit**. A failure there is by definition in a file you are committing right now. 🔴 Never bypass it with `--no-verify` — fix the staged test or remove it from the commit.

---

## Step 11: Push your branch

Push the branch to your fork:

```bash
git push -u origin docs/fix-features-page-label
```

---

## Step 12: Open a pull request

Go to your fork on GitHub and click **Compare & pull request**, or open:

```
https://github.com/YOUR_USERNAME/nexus-v1/compare/docs/fix-features-page-label
```

**Use the PR template** — it is loaded automatically from `.github/pull_request_template.md`. Fill in every section:

- **Summary:** one to three bullet points describing what the PR does and why.
- **Type of Change:** tick the relevant box.
- **Contributor Terms:** read `CONTRIBUTOR_TERMS.md` and tick all three checkboxes. Fill in the `Third-Party Material Disclosure` and `AI Contribution Disclosure` fields (use `None` if neither applies). These checkboxes are enforced by CI — the PR cannot merge without them.
- **Root Cause Analysis:** only required for bug-fix PRs. Delete the section for other PR types.
- **Translation Review:** required when you change a non-English locale file. For this tutorial you only changed English, so you can leave it blank.
- **Pre-Deployment Checklist:** tick the items that apply to your change.
- **Test Plan:** describe how a reviewer can verify your change (for example, "Navigate to /features and confirm the Beta chip reads 'Beta (active)'").

Submit the PR against `main` in the upstream repository.

CI will run automatically — you can watch the checks pass under the **Checks** tab. If a check fails, click through to read the log, fix the issue on your branch, and push again. The PR updates automatically.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full pull request guide.

---

## Step 13: Where to go next

You have completed your first contribution. Here are the best places to go deeper:

| Resource | What it covers |
|----------|---------------|
| [docs/README.md](README.md) | Index of all maintained documentation |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | How the platform is structured — multi-tenant model, runtime boundaries, frontend/backend split |
| [docs/MODULES.md](MODULES.md) | Map of product modules and where to find their code and guides |
| [docs/modules/wallet-exchanges.md](modules/wallet-exchanges.md) | Deep guide to the wallet and exchange workflow |
| [docs/modules/search.md](modules/search.md) | How Meilisearch and the SQL fallback work |
| [react-frontend/CLAUDE.md](../react-frontend/CLAUDE.md) | React frontend stack rules: HeroUI, Tailwind, contexts, hooks |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Full contributor guide: workflows, coding standards, tests, AGPL compliance |

Good places to find first issues:

- GitHub Issues labelled `good first issue` or `docs`
- Translation gaps: run `npm run check:i18n:gaps` to see which strings are missing from non-English locales
- Test coverage: check for components without a matching `.test.tsx` file and add one

Welcome to the project.
