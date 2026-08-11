<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Testing on real Safari and real macOS

Last reviewed: 2026-08-11

## Why this document exists

On 2026-08-09 a Mac user reported that the platform behaved oddly in Safari —
dropdown menus not opening consistently. Investigating it turned up something
worse than the bug: **Safari had never been tested in this project at all**, for
three independent reasons, each sufficient on its own.

1. There was no desktop-Safari Playwright project.
2. The only WebKit project, `mobile-safari`, sat in the `e2e-cross-browser` job,
   which is gated on E2E secrets. Those are not set, so the job is **skipped and
   the workflow still reports success**.
3. Every other workflow installed `chromium` only, so even a WebKit project would
   have had no browser to run in.

Two layers now exist. Understanding the difference between them matters, because
one of them is easy to over-trust.

## Layer 1 — `webkit-modern`: Safari's engine, on every push

Playwright bundles a real WebKit build, the same engine Safari uses. It runs
locally and in CI with no account and no cost.

```bash
npx playwright install webkit
npx playwright test e2e/tests/ui/dropdowns.spec.ts --grep @smoke --project=webkit-modern
```

In CI it runs in the **`e2e-smoke`** job — deliberately not the secret-gated one,
so it cannot silently skip.

🔴 **What this layer cannot tell you.** WebKit is the engine, not the browser.
Out of scope, entirely:

- Safari's own native form controls and menus
- content blockers and ad blockers (a very common cause of "it's broken for me")
- Safari extensions
- Lockdown Mode
- Safari's Intelligent Tracking Prevention and storage partitioning behaviour

A clean `webkit-modern` run means the engine is fine. It does **not** mean Safari
is fine. Do not report it as if it does.

## Layer 2 — `real-safari`: actual Safari on actual macOS

This is the layer that closes the gap, and it needs a remote browser grid because
CI runners are Linux.

The configuration is **provider-agnostic**. Set one environment variable and any
Playwright-compatible grid works — BrowserStack, Sauce Labs, LambdaTest, or
self-hosted:

```bash
PLAYWRIGHT_REMOTE_WS_ENDPOINT="wss://<your-grid-endpoint>"
```

For BrowserStack specifically, these two are enough and the endpoint is
constructed for you:

```bash
BROWSERSTACK_USERNAME="…"
BROWSERSTACK_ACCESS_KEY="…"
BROWSERSTACK_OS_VERSION="Sonoma"   # optional, defaults to Sonoma
```

The `real-safari` project **only exists when one of those is configured**, so an
unconfigured checkout is not left with a project that always fails.

### Enabling it in CI

Add the secrets to the repository — `BROWSERSTACK_USERNAME` and
`BROWSERSTACK_ACCESS_KEY`, or `PLAYWRIGHT_REMOTE_WS_ENDPOINT` — plus the usual
`E2E_BASE_URL`, `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` so there is a running
site to point Safari at.

The **`real-safari`** job in `.github/workflows/e2e-tests.yml` then runs on every
push to `main`.

🔴 **That job runs unconditionally and always reports what it did.** It does not
use a secret-gated `if:`, because that is precisely how Safari went untested for
the life of the project. With no grid configured it emits a **warning** saying
real Safari was not covered, and passes. It never implies coverage it did not
provide.

### Scope, deliberately narrow

`real-safari` runs the smoke suite and the dropdown specs only. A remote grid is
billed by the minute and is the wrong place to run 831 tests. The engine layer
already covers breadth on every push; this layer answers "does the real thing
work".

## Running it by hand

Useful when chasing a specific report:

```bash
export PLAYWRIGHT_REMOTE_WS_ENDPOINT="wss://<endpoint>"
export E2E_BASE_URL="https://app.project-nexus.ie"
export E2E_USER_EMAIL="…" E2E_USER_PASSWORD="…"
npx playwright test --project=real-safari
```

## Traps that produce false results

Every one of these was hit while building this, and each produced a confident
wrong answer:

- **`devices['Desktop Safari']` is 1280×720**, below the header's desktop
  breakpoint, so the menus collapse into the mobile drawer and menu tests
  **silently skip while the run reports green**. Both Safari projects pin a
  1440×950 viewport. Never let a missing element become `test.skip`.
- **The header menus are popovers containing links**, not `role="menuitem"`.
  Asserting on menu-item roles reported two working menus as broken in *every*
  engine. Assert `aria-expanded` on the trigger plus a visible `role="dialog"`.
- **React Aria holds `data-pressed` briefly after closing** and swallows a click
  that lands in that window, so a rapid reopen looks like a failure — in Chromium
  roughly two runs in three, and never in WebKit. Wait for the trigger to settle.
- **`openssl s_client -servername …` against the origin proved nothing** — it
  returned no certificate even for a working host. Verify from the public URL.

## What was ruled out, so nobody re-checks it

Each of these is a genuine, historically real Safari fault. All were tested on
2026-08-11 against WebKit 26.4 and are **not** problems here:

| Candidate | Finding |
| --- | --- |
| MySQL space-separated dates (`2026-08-11 15:17:04`) | Modern Safari parses them. The old `Invalid Date` bug is gone. |
| `backdrop-filter` missing its `-webkit-` prefix | Already correctly prefixed. |
| `@starting-style` (unsupported in WebKit 26.4) | Not used anywhere in the codebase. |
| `100vh` under Safari's address bar | `dvh` and safe-area insets are already in place. |
| CORS for the `timebank.global` tenant domains | Correct for every origin tested. |

## Related

- [TESTING.md](TESTING.md) — the full test-suite map and what each gate proves.
- [DEPLOYMENT.md](DEPLOYMENT.md) — why a green tick is not proof a check ran.
