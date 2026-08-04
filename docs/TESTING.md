# Testing

Last reviewed: 2026-07-30

This page explains what each test layer proves and where the remaining test-documentation risk sits.

## Test Layers

| Layer | Command | Proves |
| --- | --- | --- |
| Laravel PHPUnit | `vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always` | Backend routes, controllers, services, tenant boundaries, auth, money paths, and migrations. |
| PHPStan / Larastan | `vendor/bin/phpstan analyse --no-progress --memory-limit=512M --error-format=github` | Static-analysis regressions beyond the configured baseline. |
| React type check | `cd react-frontend && npx tsc --noEmit` | TypeScript correctness for the primary frontend. |
| React build | `cd react-frontend && npm run build` | Production build viability. |
| Vitest (local) | `cd react-frontend && npm test` | Component, hook, and frontend behavior tests. |
| Vitest (the CI gate) | `cd react-frontend && node scripts/run-vitest-shard.mjs --shard 1/8` | The whole suite minus the quarantine list, split across eight shards. This — not `npm test` — is what gates a release. See "Frontend quarantine" below. |
| Playwright E2E | `npm run test:e2e` | Browser behavior against the React frontend and Laravel API. |
| Events enterprise E2E | `npm run test:events:e2e:enterprise` | The destructive five-step create, publication, registration, waitlist, check-in, cancellation, notification, and cleanup lifecycle against an isolated fixture environment. |
| Accessible frontend | `npm run build:accessible-frontend`, `npm run test:accessible-frontend:php`, `npm run test:accessible-frontend:a11y` | HTML-first frontend build, PHP route behavior, and accessibility smoke coverage. |
| Android native release | `cd mobile && npm run verify:release && npm run type-check && npm test -- --runInBand` | OTA/release policy, native configuration contracts, TypeScript, and mobile behavior before Expo prebuild. |
| Documentation | `npm run check:docs`, `npm run check:version`, `npx markdownlint-cli2`, Redocly, strict MkDocs build | Public-doc hygiene, version/changelog integrity, Markdown structure, OpenAPI validity, and publishable site navigation. |

## Frontend quarantine — what a green pipeline proves

The eight-shard `React Full Suite` job has been **blocking since 2026-07-28**. It
skips the suites listed in `react-frontend/src/test/failing-suites.baseline.json`,
so a green pipeline currently proves **1,228 of 1,283 suites**. Before that job
existed the blocking Vitest steps covered roughly 150 files — about 88% of the
suite could break with a green build, which is why frontend breakage was only ever
discovered in large batches.

The list is a fix-and-remove queue, not a set of exemptions:

- It may only **shrink**. `react-frontend/scripts/check-quarantine-budget.mjs`
  carries a `BASELINE` constant that must be lowered in the **same commit** as any
  removal. It runs in the `React Build & Tests` job rather than in the shard job,
  so the list cannot be grown to turn a red shard green.
- A listed path that no longer exists fails the runner, rather than rotting there
  because a rename quietly excluded it forever.
- A non-gating visibility step runs the quarantined suites on shard 1, so a suite
  that gets fixed elsewhere is noticed instead of sitting there unrun.
- Verify a fix with `--retry=0`. The shard runner passes `--retry=1`, so a suite
  can pass by retry rescue; removing one on that evidence puts a flaky suite into
  the gate.
- Record *why* each entry fails. Entries sharing a root cause get fixed as a group;
  lumping unrelated failures together is how the queue becomes an exemption list.

## Local concurrency differs from CI on purpose

`react-frontend/vitest.config.ts` derives its fork count from
`os.availableParallelism()`. A developer machine runs test files concurrently
(half its logical cores); CI stays on the original serial settings
(`maxForks: 2`, `fileParallelism: false`) because every ci.yml job runs on a
4-vCPU `ubuntu-latest` runner and the eight-shard gate was stabilised there.

Two consequences worth knowing:

- A suite that depends on file execution order or on shared module state can
  pass in one mode and fail in the other. Reproduce serially with
  `NEXUS_VITEST_MAX_FORKS=1` before concluding a test is flaky.
- Do not pin `--maxWorkers` or `--no-file-parallelism` in scripts; those flags
  override the config and reimpose serial execution everywhere.

See [LOCAL-PERFORMANCE.md](LOCAL-PERFORMANCE.md) for the measured figures and for
the container file-I/O limit that dominates PHP-side timings.

## Two ways a test passes locally and fails in CI

Both have cost real debugging time, and both are properties of the environment
rather than of the test:

- **`$_SERVER` is not populated by Laravel's test HTTP kernel.** PHP-FPM always
  sets `REQUEST_METHOD`; the test kernel dispatches a `Request` object without
  writing the superglobal, so code reading it directly returns 500 under test
  only. Read from the request object instead.
- **Config sourced from a developer `.env` is absent in CI.** A test that needs a
  signing key, an API credential, or a feature flag must set it in `setUp()`
  rather than inherit it. Reproduce a suspected case by clearing the variable on
  the command line (`FOO= vendor/bin/phpunit <path>`) before concluding the test
  is sound.

## E2E Status

The Playwright suite combines broad smoke coverage with real journey assertions. CI does not treat a configured zero-test run as green, but some lower-priority specs still contain defensive presence checks; those checks are not substitutes for outcome assertions on release-critical flows.

Before treating E2E as release evidence, prefer tests that assert real outcomes:

- account state changed;
- balances or ledgers changed correctly;
- a message, notification, listing, event, or review persists after reload;
- route protection works for signed-out and cross-tenant users;
- validation errors are visible and keyboard reachable.

The Events enterprise journey is deliberately excluded from the broad Chromium,
Firefox, and mobile projects. Run it only through
`npm run test:events:e2e:enterprise`; it refuses Project NEXUS production hosts
and requires an explicit opt-in for any other non-loopback fixture target. CI
runs it against a disposable database with CI-local actors, not repository or
environment secrets.

## Generated Reports

Playwright reports under `e2e/reports/`, coverage reports, raw PHPStan output, and temporary static-analysis dumps are generated artifacts. Do not commit them as maintained docs. If a one-off report must be retained locally, put it under `.local-docs-archive/`.

## Test Documentation Rules

- Keep test instructions near the test harness they describe (`tests/README.md`, `e2e/README.md`, `mobile/README.md`).
- Put platform-wide testing policy here.
- Update this page when a test layer changes meaningfully, especially if a green check no longer proves what this page says it proves.
