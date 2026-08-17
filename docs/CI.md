# Continuous Integration & Quality Gates

Last reviewed: 2026-08-17

> **Diátaxis:** explanation. What runs on every push and pull request, which checks are blocking, and how to run the same checks locally before you push.

Project NEXUS uses GitHub Actions. The pipeline is designed so that **`main` stays green** — a failing check on `main` is inherited by every later PR, so gates are kept meaningful and are fixed or reverted immediately.

## The main pipeline — `.github/workflows/ci.yml`

| Job | Blocking steps | What it proves |
|-----|----------------|----------------|
| **PHP Tests / PHP Static Analysis / PHP Checks** | Sharded PHPUnit suites; schema-driven test-skip budget; PHPStan/Larastan with the checked-in baseline; Laravel boot/cache checks; PHP syntax checks | Backend behaviour, static analysis, and bootability. `PHP Checks` is the stable aggregate status. |
| **React Build & Tests** | TypeScript; ESLint (`--max-warnings 30`); component accessibility tests; UI-contract tests; dead-mock and mock-contract checks; quarantine-budget ceiling; production build | Frontend type safety, lint, accessibility contracts, UI contracts, and buildability. The *focused* Vitest smoke and coverage steps are warnings because of the documented worker-pool hang — the whole suite is gated by the job below instead. |
| **React Full Suite (shard N/8)** | The entire Vitest suite, split across eight shards by `scripts/run-vitest-shard.mjs` | Frontend behaviour across **1,228 of 1,283 suites**. **Blocking since 2026-07-28** and present in the release gate's `needs:` list. The other 55 suites are quarantined in `react-frontend/src/test/failing-suites.baseline.json`; see [TESTING.md](TESTING.md). |
| **API Contract Validation** | Focused Zod response-shape tests | Representative Laravel responses still match the TypeScript contract consumed by React. |
| **Docker Build Verify / Dockerfile Drift Detection** | Development and production PHP images; React image; PHP configuration parity | Deployment images build and paired Dockerfiles have not silently diverged. Image builds run after merge or by manual dispatch rather than on every pull request. |
| **Migration Safety Gate** | Schema changes require Laravel migrations; new legacy SQL migrations are rejected | Schema evolution remains deployable and uses the supported migration system. |
| **Translation Drift Detection** | Changed-locale parity and i18n quality gates | Locale files stay structurally aligned and new translated output passes the repository checks. |
| **Documentation, Version, and Changelog Hygiene** | `check:docs`, `check:version`, base-aware `check:changelog` | Public docs are indexed and safe, version metadata agrees, and release-relevant changes include a release note. |
| **SPDX License Compliance / Regression Pattern Detection** | SPDX header check; repository-specific security and regression scans | New source remains AGPL-attributed and known failure patterns do not return. |
| **E2E Smoke Tests / Accessibility Audit** | Authenticated browser smoke matrix; Events enterprise journey; real-browser accessibility; PWA offline; editor isolation; axe scan | Cross-surface runtime journeys and accessibility contracts work in built applications. |
| **Android Native Release Gate** | Release/OTA verifier; typecheck/tests; Expo prebuild; generated network-security policy inspection | Android release channels, certificate pins, deep links, and native release configuration are safe to publish. |
| **Accessible Frontend Release Gate** | Production build; Laravel contract tests; browser accessibility suite | The maintained HTML-first frontend builds and preserves its Laravel/accessibility contract. |
| **Release Gate** | Aggregates every authoritative job above | A failure or cancellation in any required release gate keeps the overall pipeline red; legitimate path-filter skips are allowed. |

Steps labelled **BLOCKING** fail their job. Steps labelled **WARNING**, and steps with `continue-on-error: true`, report evidence without blocking. The focused Vitest smoke/coverage run remains explicitly non-blocking; TypeScript, ESLint, accessibility/UI contracts, the production React build, and the eight-shard full Vitest suite are all blocking.

> Two structural traps this pipeline has been bitten by, recorded so they are not
> reintroduced. A job-level `continue-on-error: true` silently swallows **every**
> step inside that job, including ones labelled BLOCKING. And `Release Gate`
> aggregates `needs.*.result`, so a job that is not in its `needs:` list cannot
> fail the pipeline no matter what it concludes — adding a gate without adding it
> there produces something that reads as enforced and enforces nothing.

## Other workflows

| Workflow | Purpose |
|----------|---------|
| `pr-checks.yml` | PR description gates (Root-Cause/Prevention, Translation Status, Contributor Terms). |
| `contributor-terms.yml` | Enforces the contributor-terms acceptance section on PRs. |
| `dependency-review.yml` | Flags risky dependency changes on PRs. |
| `docs-lint.yml` | Markdown structure, OpenAPI lint, documentation hygiene, and strict MkDocs build. |
| `docs-site.yml` | Publishes the MkDocs/Redoc documentation site when maintained documentation changes. |
| `security-scan.yml` | Security scanners (see [SECURITY-SCANNING.md](SECURITY-SCANNING.md)). |
| `e2e-tests.yml` | Playwright end-to-end smoke tests. |
| `lighthouse.yml` | Lighthouse performance/accessibility budget. |
| `deploy-drift-watchdog.yml` | Detects drift between deployed and committed state. |
| `release.yml` | Builds a GitHub Release from a version tag (see [RELEASES.md](../RELEASES.md)). |

## Pull-request gates

Some PRs are gated by **description checks** that fail instantly unless the PR body contains exact fields (these re-run when the PR body is edited — no push needed):

- **Root Cause Analysis** — `fix`/`bug`/`hotfix` PRs must include `**Root Cause:**` and `**Prevention:**`.
- **Translation Review** — PRs touching non-English locale files must declare `**Translation Status:**` and `**Translation Reviewer:**`.
- **Contributor Terms** — the `## Contributor Terms` section with all checkboxes checked (owner/bot PRs exempt).
- **Translation drift** — `node scripts/check-php-lang-parity.mjs` and `node scripts/check-php-lang-untranslated.mjs` must both pass. Parity checks key sets; the ratchet checks that the values are not still English. See [I18N.md](I18N.md).

Build the PR body from [.github/pull_request_template.md](../.github/pull_request_template.md).

## Run the gates locally (before you push)

```bash
# Backend
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated
vendor/bin/phpstan analyse --no-progress --memory-limit=512M

# Frontend
cd react-frontend && npm run lint && npm run test:a11y -- --run && npm run test:ui-contracts -- --run && npm run build

# Docs / version / changelog
npm run check:docs && npm run check:version && npm run check:changelog

# Published documentation and API contract (same pinned tools as CI)
npx --yes markdownlint-cli2@0.23.0
node scripts/check-openapi-route-contract.mjs
npx --yes @redocly/cli@2.39.0 lint openapi.json resources/openapi.json resources/openapi.yaml --max-problems 1000
python -m pip install "mkdocs==1.6.1" "mkdocs-material==9.7.6" "pymdown-extensions==11.0.1"
cp openapi.json docs/openapi.json
python -m mkdocs build --clean --strict
rm -f docs/openapi.json

# i18n (after locale changes)
npm run check:i18n
npm --prefix web-uk run locales:audit
npm --prefix web-uk run locales:audit-irish
```

**Nothing above runs automatically on commit or push.** Husky is intentionally disabled at repository root — there is no root `.husky/` directory and no `husky`/`lint-staged` dependency (the only Husky config in the tree belongs to the `mobile/` subproject). Run the commands yourself, or rely on CI.

The one real local hook is `scripts/git-hooks/pre-commit`, installed once per clone with `bash scripts/git-hooks/install-hooks.sh`. It has two gates: a **credential scan** on every commit (private keys, AWS/`sk-` keys, literal-IP SSH strings, database dumps — git+grep only, so it works even where PHP is unavailable), then the **PHP test files staged in the current commit**, so a test failure is always in a file you are committing right now. 🔴 Never `--no-verify` past it. The pre-existing-failure exception in [CONTRIBUTING.md](../CONTRIBUTING.md) covers lint/build failures in files your change does not touch — it does not cover this gate.
