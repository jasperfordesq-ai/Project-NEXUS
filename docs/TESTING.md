# Testing

Last reviewed: 2026-09-27

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
| Accessible frontend (`web-uk`) | `npm --prefix web-uk run brand:check`, `npm --prefix web-uk run lint`, `npm --prefix web-uk test`, `npm --prefix web-uk run build:css` | GOV.UK branding prohibitions, lint, 80 Jest suites, and Sass compilation for the HTML-first accessible frontend. The three `*:accessible-frontend*` commands this row named until 2026-08-14 were removed with the Blade accessible frontend and no longer exist. |
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

## Help Centre guides

The Help Centre (`/help`, and `/broker/help` inside the Broker Panel) is a set of built-in
guides for three audiences: members, brokers and coordinators, and community admins. It is
shown only for the features a community has switched on. The phone app shows the members'
guide too (`mobile/lib/help/`), fetching the same text from the website.

Where things live:

| What | Where |
| --- | --- |
| Structure: sections, articles, order, icons, feature switches, the page each article is about | `react-frontend/src/pages/help/guides/data/{members,brokers,admins}.registry.json` |
| Text, in every language | `react-frontend/public/locales/<lang>/help_{members,brokers,admins}.json`; page chrome in `help_centre.json` |
| Body format (paragraphs, `##`, `-`, `1.`, `>`, `**bold**`, internal links — never HTML) | `react-frontend/src/pages/help/guides/HelpBody.tsx` |
| The app's copy of the members' structure | `mobile/lib/help/membersRegistry.json`, kept identical by `mobile/lib/help/guides.test.ts` |
| Which code each article describes, and when it was last checked | `react-frontend/src/pages/help/guides/data/sources.json` |

Three checks guard the guides:

1. **Integrity** — `src/pages/help/guides/guides.integrity.test.ts`. Every registered article has
   text in every language and nothing is unregistered; feature switches exist; links stay inside
   the app and are hidden whenever the page they point at is switched off; translations keep the
   English links, lists and steps. Runs in the React suite.
2. **Labels** — `src/pages/help/guides/guides.labels.test.ts`, rules in `labelCheck.ts`. Every
   `**bold**` span must be words the app really shows in that language: it is looked up in the
   locale's other UI translation files, ignoring spacing and a trailing colon or ellipsis,
   otherwise exactly (capitals count). Placeholder texts (`{{count}} left today`) match filled-in
   labels; a bolded sentence ending in a full stop is emphasis and is skipped; a bold guide title is
   a cross-reference and passes. Genuine exceptions go in `data/label-allowlist.json` with a
   reason. Known failures are in `data/label-baseline.json`, which may only shrink: a new unmatched
   label fails, and so does a baseline line that is fixed. A pass proves the words exist in the
   interface, not that they are on the page the article describes. Labels that only the server or
   the phone app produces are not in these files and show as failures until allowlisted.
   Regenerate the baseline, after checking the change is an improvement, from `react-frontend/`
   with `node scripts/write-help-label-baseline.mjs` (`--report <file>` also writes every failure
   for translators).
3. **Staleness** — `npm run check:help-staleness` (`scripts/check-help-staleness.mjs`, tests in
   `npm run test:help-staleness`). Each `sources.json` entry maps an article
   (`<audience>/<section>/<article>`) to the files it depends on and the full commit sha its text
   was last checked at. The check lists articles whose sources changed since that commit, articles
   with no entry, sources that no longer exist, and entries that are malformed or point at an
   article that no longer exists. `.github/help-staleness-baseline.json` holds the drift accepted
   today; only new drift, or a baseline line that no longer applies, fails. A verified commit that
   is not in the clone is reported as UNAVAILABLE (exit 2), never as a pass — CI needs a full
   history checkout (`fetch-depth: 0`).

The staleness workflow: when an article has been read against its sources and is right, run
`node scripts/check-help-staleness.mjs --mark-verified <audience>/<section>/<article>` (sets
`verified` to HEAD) and commit `sources.json` with the text change. When a change to a page makes
an article stale, update the article, then mark it verified. Accept existing drift only with
`--write-baseline`, and only after looking at what it accepts.

## Generated Reports

Playwright reports under `e2e/reports/`, coverage reports, raw PHPStan output, and temporary static-analysis dumps are generated artifacts. Do not commit them as maintained docs. If a one-off report must be retained locally, put it under `.local-docs-archive/`.

## Test Documentation Rules

- Keep test instructions near the test harness they describe (`tests/README.md`, `e2e/README.md`, `mobile/README.md`).
- Put platform-wide testing policy here.
- Update this page when a test layer changes meaningfully, especially if a green check no longer proves what this page says it proves.
