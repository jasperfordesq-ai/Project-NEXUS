# Project NEXUS E2E Tests

Last reviewed: 2026-07-14

End-to-end tests use Playwright and target the React frontend plus the Laravel API. Run Playwright from the repository root dependency tree for normal work; do not create or rely on a nested `e2e/node_modules` install.

## Prerequisites

- Node.js 22+ and npm 10+
- Local frontend at `http://localhost:5173`
- Local API at `http://localhost:8090` from the Docker PHP app
- Test credentials in `e2e/.env.test` or the appropriate CI secrets

The root Playwright config defaults to `E2E_BASE_URL=http://localhost:5173` and tenant `hour-timebank`.

## Running Tests

From the repository root:

```bash
# Full configured suite
npm run test:e2e

# Headed/debug/UI modes
npm run test:e2e:headed
npm run test:e2e:debug
npm run test:e2e:ui

# Smoke subset
npx playwright test e2e/tests/smoke.spec.ts --grep '@smoke' --project=chromium-modern

# One file or one test
npx playwright test e2e/tests/auth.spec.ts --project=chromium-modern
npx playwright test e2e/tests/auth.spec.ts -g "login" --project=chromium-modern
```

The `e2e/package.json` scripts are retained for compatibility, but the project standard is to use the root `package.json` scripts so Playwright resolves one local version.

## Reports

HTML and JSON reports are written under `e2e/reports/` by the root Playwright config:

```bash
npm run test:e2e:report
```

## Test Structure

```text
e2e/
├── tests/             # Playwright specs
├── journeys/          # Opt-in multi-actor journeys, held outside the default suite
├── helpers/           # Login, fixtures, and shared utilities
├── fixtures/          # Auth state and seeded-test artifacts
├── page-objects/      # Page object helpers where useful
├── global.setup.ts    # Auth/session setup
└── docs/              # Route reference notes (see REACT_ROUTES_REFERENCE.md)
```

`journeys/` holds opt-in journeys that must not be swept into the default projects,
because those point at the production-derived local database. Each carries its own
config and setup notes: [journeys/caring/README.md](journeys/caring/README.md).

## Current Status

The E2E suite combines broad smoke coverage with real journey assertions. CI does not treat a configured zero-test run as green, but some lower-priority browser specs still use defensive presence checks. See [../docs/TESTING.md](../docs/TESTING.md) before treating a lower-priority spec as release evidence, and use [docs/REACT_ROUTES_REFERENCE.md](docs/REACT_ROUTES_REFERENCE.md) when reconciling route coverage.

When converting an E2E test, run it against a live local stack and assert real outcomes such as persisted state, changed balances, visible messages, route protection, or form validation. Do not replace a stale selector with another unverified fallback.
