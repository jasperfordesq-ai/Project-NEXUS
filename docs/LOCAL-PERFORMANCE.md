# Local Performance

Last reviewed: 2026-08-04

How to get full speed out of a local development machine, which knobs are
machine-aware, and — most importantly — which bottleneck is **not** solved by a
faster CPU.

## Reference workstation

The numbers on this page were measured on the machine the project is currently
developed on:

| Component | Value |
| --- | --- |
| CPU | AMD Ryzen 9 9950X3D — 16 cores / 32 threads |
| RAM | 96 GB DDR5-5200 (2 × 48 GB) |
| Disk | Samsung 9100 PRO 4 TB NVMe |
| OS | Windows 11 Pro 26200 |
| Docker/WSL2 allocation | 32 CPUs, 45.9 GB (WSL2's default 50%-of-RAM; no `.wslconfig`) |

This replaced a 16 GB machine on 2026-08-04. Several settings in the repo were
sized for that older machine and have been retuned; the history matters because
comments and docs written under the old constraint read as safety rules when
they were really capacity workarounds.

## The rule that no longer applies

> ~~Never run more than one heavy test suite at a time; run suites sequentially
> to avoid CPU starvation and false failures.~~

Retired 2026-08-04. On 32 threads, running suites one at a time leaves the
machine almost entirely idle. Run them in parallel.

## Frontend tests: concurrency is automatic and machine-aware

`react-frontend/vitest.config.ts` derives fork count from
`os.availableParallelism()`:

- **Locally** — half the logical cores (16 on the reference machine), with
  `fileParallelism` on.
- **In CI** — unchanged, `maxForks: 2` / `fileParallelism: false`. Every ci.yml
  job runs on `ubuntu-latest` (4 vCPU) and the eight-shard `React Full Suite`
  gate was stabilised on those numbers. Retuning the gate is a separate exercise
  needing its own evidence; this config change is scoped to developer machines.
- **Override** — `NEXUS_VITEST_MAX_FORKS=1` forces a serial run when you suspect
  a test-ordering or shared-state bug and want to reproduce it deterministically.

Measured, `--retry=0`, pass counts identical in every pair:

| Suite | Files | Serial (old) | Parallel (new) | Speed-up |
| --- | --- | --- | --- | --- |
| `src/hooks` | 29 | 28.5s | 5.3s | 5.4× |
| `src/components/ui` | 66 | 78.8s | 12.1s | 6.5× |
| `src/pages/groups` | 51 | 72.3s | 9.3s | 7.8× |
| Events React step (`scripts/test-events.mjs --react-only`) | 39 | 67s | 11s | 6.1× |

Why the gain is so large: almost all of the wall-clock is per-file jsdom
construction, not assertions. A 66-file run spent ~10s in `environment` and ~7s
in `tests`. That setup cost is embarrassingly parallel.

`isolate: true` is kept at every concurrency level — a fresh fork per file is
what prevents the heap and jsdom accumulation that hangs a long `singleFork`
run. Concurrency does not replace isolation.

### Whole-suite result, and one honest caveat

All eight shards, `--retry=0`, run locally on 2026-08-04:

| | |
| --- | --- |
| Total wall-clock, 8 shards sequentially | **3.92 min** (1,238 suites) |
| Per shard | 27–34s |
| Result | 7 shards green; shard 2 failed once |

The one failure was `src/pages/messages/ConversationPage.test.tsx > rechecks when
the document becomes visible`. What is actually known about it:

- The shard runner's own header comments already name this exact file as a known
  flake from the gate's shakedown runs, which is why the runner defaults to
  `--retry=1`. It predates this change.
- Run alone it passes 5/5 serially and 5/5 in parallel. It is load-sensitive, not
  broken.
- Across five parallel runs of shard 2 it failed once; a single serial run of
  shard 2 passed. **That is not enough evidence to say whether concurrency raises
  its flake rate.** Treat it as an open question, not a settled one.

Two things bound the risk: the shard runner retries once by default (the run above
deliberately disabled that), and CI is unaffected because CI keeps the serial
settings. If this test starts failing more often, fix the test — do not raise the
retry count and do not quarantine it.

### Sharding is still required on Windows

Running all 1,238 files in a single vitest invocation fails immediately, and not
for any hardware reason: ~1,238 paths is roughly 72,000 characters of argv against
a 32,767-character `CreateProcess` limit. Use `--shard i/8`. This is unrelated to
CPU or memory and does not change on a faster machine.

🔴 **Do not pin `--maxWorkers` or `--no-file-parallelism` in scripts.** Those
flags override the config and reimpose the serial run on every machine including
this one. `scripts/test-events.mjs` used to do exactly that.

## 🔴 The real bottleneck is container file I/O, not CPU

The repo lives on `C:\` and is bind-mounted into Docker over the **9p** protocol
(`msize=65536`). That path is roughly two orders of magnitude slower than the
container's own filesystem.

Reading `app/`'s 1,750 PHP files, measured inside `nexus-php-app`:

| Source | Time |
| --- | --- |
| The 9p bind mount | **4,644 ms** |
| The container's own ext4 | **45 ms** |

That is ~103× slower. Consequences:

- **More PHPStan workers barely help.** Going from 2 to 12 parallel processes
  moved a cold full run from 8.6 min to 7.6 min — about 11%, because the
  analyser is waiting on file reads, not on CPU.
- **PHPStan is the big victim.** Run against a copy of the project on the
  container's own ext4, a cold full run drops from **458s to 53s** — 8.6×, same
  1,750 files, same `[OK] No errors`.
- **No amount of CPU or RAM tuning fixes the PHPStan case.** Only moving the files
  does — see "Not done yet" below.

### 🔴 But it does NOT explain slow PHPUnit — measured, not assumed

An earlier version of this page claimed "the same tax applies to PHPUnit". **That
was wrong.** The same 30 test files (348 tests), run twice in the same container:

| Source | Time |
| --- | --- |
| the 9p bind mount | 539,815 ms |
| the container's own ext4 | 539,059 ms |

Identical — the mount costs PHPUnit essentially nothing. Nor do the other usual
suspects, all measured in `nexus-php-app`:

| Candidate | Measurement | Verdict |
| --- | --- | --- |
| Laravel bootstrap | 94 ms | not the cause |
| Database round-trip | 0.29 ms per query (100× `SELECT 1` in 29 ms) | not the cause |
| OPcache disabled for CLI (`opcache.enable_cli=0`) | enabling it: 77.2s → 72.0s on a 3-file run; `opcache.file_cache` added nothing | ~7% only |

🔴 Do not attribute slow PHP tests to the bind mount. That was measured and ruled
out.

## Why PHP tests were slow — FOUND AND FIXED (2026-08-04)

**The local test suite was running in the `development` environment, not
`testing`.** That single fact cost ~1.1 seconds on every test.

How it was traced, each step measured rather than guessed:

| Step | Finding |
| --- | --- |
| Per-test times were flat | fastest 1.440s, median 1.521s, slowest 2.023s ⇒ fixed overhead, not slow tests |
| Probe: plain PHPUnit, no Laravel | 10 ms per test — PHPUnit itself is not the cost |
| Probe: project base `TestCase`, empty tests | 1,566 ms per test |
| Probe: same, custom setUp hooks stubbed | 1,549 ms ⇒ the tenant/federation upserts cost only ~17 ms |
| Timed from inside a real run | `setUp` 1,573 ms, `tearDown` 3.5 ms |
| Split across Laravel's six bootstrappers | `BootProviders` 1,324 ms (vs 224 ms under `testing`) |
| Timed every provider's `boot()` | `App\Providers\AppServiceProvider` 1,159 ms vs 48 ms |

The expensive work is in `AppServiceProvider::loadCachedJsonTranslations()`, which
freshness-checks every locale JSON file on the bind mount. **A testing-only fast
path for exactly this already existed** — as did a testing-only locale narrowing
(`app.test_translation_locales`, default `en,ga,de`). Neither ever engaged,
because the environment was not `testing`.

### The root cause

Laravel resolves `env()` through Dotenv adapters consulted in order:
`ServerConstAdapter` (`$_SERVER`) **before** `EnvConstAdapter` (`$_ENV`).

- The dev container exports a real `APP_ENV=development`, which PHP CLI exposes in
  `$_SERVER`.
- `tests/bootstrap.php` set only `$_ENV['APP_ENV'] = 'testing'` — it lost the race.
- `phpunit.xml`'s `<env name="APP_ENV" value="testing"/>` could not win either:
  PHPUnit's `PhpHandler` writes `putenv()` and `$_ENV`, never `$_SERVER`. **Adding
  `force="true"` alone does not fix this** — a useful thing to know before
  "fixing" a similar variable.

So `app()->environment()` returned `development` for the entire local suite.

### The fix, and why it was low-risk

`tests/bootstrap.php` now also sets `$_SERVER['APP_ENV']` and `putenv()`.
`phpunit.xml` gains `force="true"` as defence in depth.

**CI was never affected** — its workflow exports a real `APP_ENV=testing` in six
places, so CI always took the fast path. This was a local-only divergence, and the
fix makes local match CI rather than diverging from it. 🔴 Corollary: this change
makes **no difference to CI times at all**. Do not expect one.

### Measured result — 3.4×, with identical outcomes

| | Before | After |
| --- | --- | --- |
| `setUp`, per test | 1,573 ms | **514 ms** |
| Empty probe test | 1,566 ms | **497 ms** |
| 6 service test files (95 tests) | 145.0s | **41.0s** |
| 30 service test files (348 tests) | 539.8s | **159.8s** |

Outcomes were byte-identical on the 30-file set: 348 tests, 1,295 assertions,
2 errors, 4 skipped, 6 incomplete both before and after (those 2 errors are
pre-existing and unrelated). Because the change activates the locale narrowing,
the highest-risk areas were run explicitly: all **102** i18n tests pass, and all
**53** `WebAuthnControllerTest` tests pass.

### What is left, honestly

~490 ms per test remains, and ~406 ms of that is booting a complete Laravel
application — 47 providers and 4,077 routes — once per test, which is what
Laravel's `TestCase` does by design. Reducing it further means not rebooting per
test (or caching routes for the suite) and is a genuine architectural change, not
a config tweak. Not attempted.

## PHP static analysis

`phpstan.neon` pins `maximumNumberOfProcesses: 2`, which is correct for a 4-vCPU
CI runner and wrong for this workstation. Rather than change the shared file and
alter CI as a side effect, `phpstan.local.neon` includes it and overrides only
the parallelism:

```bash
docker exec nexus-php-app php vendor/bin/phpstan analyse \
  --configuration phpstan.local.neon --memory-limit=4G --no-progress
```

That file changes worker count and job size only — never the level, paths, or
ignore rules — so a finding here is a finding in CI. Add `clear-result-cache`
before `analyse` for a true cold timing; warm runs are cache-dominated.

### Full local PHPStan used to be impossible, and now works

The app container's `mem_limit` was 2 GB while the documented PHPStan invocation
passes `--memory-limit=2G` — the entire container budget. The analyser was
OOM-killed rather than finishing, which is what the old advice ("PHPStan hangs
locally, analyse specific paths instead") was actually describing. `compose.yml`
now gives the container 8 GB and a full run completes cleanly in ~8 min.

Production limits in `compose.bluegreen.yml` are
**deliberately unchanged** — the production VM has 16 GB total and its 2 GB cap
is correctly sized for it.

## Constraints that are still real

These are not about machine size and do not go away on faster hardware:

- **Never background a vitest run** — it deadlocks. Foreground only.
- **Never run PHPUnit on the Windows host.** The host `vendor/` is incomplete
  (no ext-gmp/pcntl/posix) and produces dozens of false failures. Use the
  container, or record the check as unavailable — never as a pass.
- **`phpunit --filter` scans the whole suite.** Pass a path plus `--no-coverage`.
- **PHP tests touching `Crypt` need an explicit `APP_KEY`** on the `docker exec`
  line; the container `.env` ships an invalid placeholder. See `AGENTS.md`.
- **CI is still the authoritative gate.** A fast local machine makes preflight
  cheaper, not more conclusive. `scripts/preflight.mjs` deliberately defers full
  suites, Docker builds, E2E, and accessibility to CI.

## Not done yet (candidate follow-ups)

Listed honestly as unmeasured proposals, not recommendations already validated:

1. **Move the working tree onto the WSL2 ext4 filesystem — CONSIDERED AND
   REJECTED, 2026-08-04.** It would fix the 103× read penalty, and it is the
   standard advice for Docker on Windows. It was rejected here on measured
   grounds, and the reasoning should be re-read before anyone proposes it again:
   - The only thing it demonstrably buys is PHPStan (458s → 53s). PHPUnit gains
     nothing (see above), and the whole frontend toolchain already runs natively
     on Windows and never touches the mount.
   - Full local PHPStan is a rare command. CI runs it on every push, and
     `scripts/preflight.mjs` analyses only changed files locally.
   - The cost lands on the tools in constant use. Both AI coding assistants run
     natively against `C:\platforms\htdocs\staging`. Moving the tree means either
     reaching it from Windows via `\\wsl.localhost\...` — the *same* slow bridge
     in reverse, applied to every file read and search — or relocating those tools
     inside Linux. Either way the tax moves from an occasional Docker command onto
     the hourly workflow, which is a worse trade.
   - It also drags Node, `node_modules`, Playwright browsers, `.claude/` config,
     `launch.json` paths, and `.secrets.local/` handling with it.

   The cheap alternative, if a fast full PHPStan is ever wanted: copy the project
   into the container's own filesystem and analyse the copy (the 53s run). Keep it
   **explicit and optional** — it analyses a copy, so a stale copy would produce a
   clean result that proves nothing, which is exactly the failure class this repo
   has been bitten by before.
2. **Parallel PHPUnit via `paratest`.** Not installed. With 16 cores this could
   cut the backend suite substantially, but parallel PHP tests need per-worker
   database isolation, and this suite shares `nexus_test`. Non-trivial.
3. **A `.wslconfig`.** There is none, so WSL2 uses its defaults: 50% of RAM and
   all CPUs — already generous. The gain would be from `autoMemoryReclaim`,
   letting the VM return idle memory. Applying it requires `wsl --shutdown`,
   which stops running containers, so it is not a silent change.
4. **Retuning the eight-shard CI gate.** Out of scope here by design; CI runner
   size, not local hardware, governs it.
