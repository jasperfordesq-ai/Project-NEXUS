<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Load testing

Last reviewed: 2026-08-12

## Why this exists

Timebanking UK's supplier due diligence asked for "load-testing evidence" and
there was none. Not a partial answer — none at all.

That mattered because the platform already records per-request performance in
production (see [ARCHITECTURE.md](ARCHITECTURE.md)), which tells you how it
behaves at today's volume and nothing whatsoever about ten or a hundred times
that. Growth asks the second question, and the platform is growing — so the point
of this harness is capacity *planning*: knowing in advance which knob to turn, and
at what point, rather than finding out from members.

## Running it

```bash
# Defaults: 20 users, 30 seconds, against the local API container
node scripts/load-test.mjs --base http://127.0.0.1:8090

# A concurrency sweep is usually more informative than a single run
node scripts/load-test.mjs --base http://127.0.0.1:8090 --users 40 --duration 30

# Keep the numbers
node scripts/load-test.mjs --base http://127.0.0.1:8090 --json results.json
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base` | `http://127.0.0.1:5173` | Target origin |
| `--tenant` | `hour-timebank` | Tenant slug used in paths |
| `--users` | `20` | Concurrent virtual users |
| `--duration` | `30` | Seconds of load, after the ramp |
| `--ramp` | `5` | Seconds over which users arrive |
| `--json` | — | Write the full result set to a file |
| `--p95` / `--p99` / `--error-rate` | `1500` / `3000` / `1` | Override thresholds |

Exit codes: `0` all thresholds met, `1` a threshold breached (so it can gate),
`2` refused to run.

**No dependencies.** Node 22's native `fetch` and `worker_threads` do the whole
job, so there is no package to audit, no lockfile churn and no binary for CI to
install. For a platform whose continuity argument is "you can fork this and run it
yourself", a load tester with its own supply chain would be a poor trade.

## 🔴 It refuses to run against production

Production hosts are blocked outright. 365 real members share a single VM, so a
load test against production is an outage you scheduled yourself.

```
✗ Refusing to load-test app.project-nexus.ie — it is a production host serving
  real members on a single VM.
```

Overriding needs `LOAD_TEST_I_KNOW_THIS_IS_PRODUCTION=1`, deliberately, inside a
maintenance window. The blocked list is in `scripts/load-test.mjs`; add new
production domains to it when they are created.

## What it measures, and why percentiles

Per scenario and overall: request count, throughput, latency p50/p90/p95/p99/max,
and a status-code breakdown.

Percentiles, not averages. An average hides the member who waited nine seconds
behind ninety-nine who waited one.

Scenarios are weighted to resemble real traffic — browsing dominates a timebank,
because members look far more often than they post — and are all unauthenticated
GETs, so a run creates no data and can be repeated against the same environment
without leaving anything to clean up.

🔴 **Every scenario path is verified to return 200 before being added.** A
scenario pointed at a 404 still produces a tidy latency table; it just measures
Laravel's error path instead of the work it claims to. Check with `curl` first.

One scenario, `/health.php`, deliberately bypasses the framework. It is a control:
it separates how much of the measured latency is application boot from how much is
network and container.

## 🔴 429 is not an error, and not a success either

A rate-limited response means the limiter is working. Counting it as a failure
would make correct behaviour look like a fault.

But it must not be counted as a success. A run where half the responses were
throttled has measured the throttle, not the platform, and reporting "0% errors"
would overstate what was proven. The harness tracks 429s separately and warns:

```
⚠ 64 of 145 responses (44.1%) were rate-limited (429).
  That is the limiter working, not a fault — but it caps measured throughput,
  so this run does NOT establish server capacity.
```

To measure capacity rather than the DoS protection, raise the limits in the test
environment first.

## First results — local, 2026-08-12

A sweep against the local Docker API stack. **These are not capacity figures**,
for reasons in the next section, but the shape is informative.

| Users | p50 | p95 | Throughput | 200s | 429s |
| --- | --- | --- | --- | --- | --- |
| 5 | 1,349 ms | 1,849 ms | 6.1 /s | 99 | 0 |
| 10 | 2,504 ms | 3,203 ms | 6.2 /s | 101 | 3 |
| 20 | 3,189 ms | 4,223 ms | 7.1 /s | 92 | 30 |
| 40 | 4,690 ms | 6,508 ms | 7.7 /s | 81 | 64 |

Two findings, both worth acting on:

**1. Throughput is flat while latency rises linearly.** Eight times the users
produced the same ~6–8 requests per second and roughly 3.5× the latency. That is
the signature of a **saturated fixed worker pool** — requests are queueing, not
being served in parallel. Adding load adds waiting, not work. On this stack that
is the PHP-FPM worker count — a configuration value, not an architectural limit.
Repeating the measurement against production tells us the real ceiling and
therefore the **trigger point**: the concurrency at which we add workers, then
capacity. That is exactly the planning information you want to hold before you
need it.

**2. Rate limiting engages hard and early.** Zero throttled at 5 users, 44% at 40.
Good news for abuse protection, and it means any capacity number from this
environment is really a limiter number.

## Why local figures are not capacity figures

Every framework endpoint costs **~2 seconds** locally. `/health.php`, which never
boots the framework, costs **~24 ms** — a difference of roughly eighty times.

That gap is the local development environment, not the platform:

- Config and routes are **not cached** locally, so Laravel boots 47 service
  providers and 4,077 routes on every request.
- The repository is **bind-mounted into Docker over 9p**, measured at ~103× slower
  than the container's own filesystem for reads — see
  [LOCAL-PERFORMANCE.md](LOCAL-PERFORMANCE.md).

Production has cached config and routes and a native filesystem, so its baseline
is far lower. **Read the shape locally; get the numbers from a production-like
target.**

## What still needs doing

- **Run against a production-like target** — the CI stack or an inactive
  blue/green colour, with config and routes cached. That produces the figures fit
  to quote, and the worker-count trigger point.
- **Agree an uptime target and a latency objective.** The thresholds in the script
  are starting figures for that conversation, not an agreed service level. A
  made-up number quietly becoming a commitment is exactly how that goes wrong.
- **Model growth volumes** — the sweep above tops out at 40 users against a
  365-member platform. Knowing the shape at ten and a hundred times that lets
  capacity be added on a schedule rather than in a hurry.
- **Add authenticated scenarios** once the above is settled. Writes need a
  disposable environment, because unlike these read-only scenarios they leave data
  behind.

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md) — the single-VM topology this measures.
- [LOCAL-PERFORMANCE.md](LOCAL-PERFORMANCE.md) — why the local filesystem is slow.
- [TESTING.md](TESTING.md) — the other test layers and what each proves.
- [REAL-SAFARI-TESTING.md](REAL-SAFARI-TESTING.md) — the same principle applied to
  browser coverage: a check that looks like coverage and isn't is worse than none.
