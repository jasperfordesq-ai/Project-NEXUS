// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// preflight.mjs — fast, change-aware local checks to run BEFORE pushing.
//
// Catches the ordinary mistakes (type errors, broken tests you just touched,
// missing changelog entries, phantom DB columns) locally in a few minutes,
// instead of discovering them 20–35 minutes later in a CI run. It is NOT a
// substitute for CI: the full GitHub pipeline remains the authoritative gate,
// and the deploy verifier (scripts/predeploy-ci-check.sh) remains the gate
// for production. Passing preflight proves nothing about the checks it
// deliberately defers (full suites, Docker builds, E2E, accessibility).
//
// WHAT IT RUNS, BY CHANGED AREA (area detection reuses .github/ci-paths.yml —
// the same file CI's own skip logic reads, so preflight and CI agree on what
// a change touches):
//   docs/meta   → docs hygiene, version consistency, SPDX, changelog guard
//   workflows   → YAML-parse every changed .github/workflows/*.yml
//   php         → PHPStan on the changed app files (Docker), focused PHPUnit
//                 on the changed test files (Docker), db-column check
//   frontend    → tsc --noEmit; test-type ratchet + focused vitest when test
//                 files changed
//   mobile      → mobile tsc --noEmit
//   i18n        → parity + untranslated ratchet + JSON integrity (only when
//                 lang/ or locale files changed — tighter than CI's filter)
//
// HONESTY RULES (the whole point):
//   - Every check reports PASS, FAIL, SKIP (not applicable to this change),
//     or UNAVAILABLE (should have run but a prerequisite is missing — e.g.
//     Docker down). UNAVAILABLE is never silently treated as a pass.
//   - PHP tests NEVER run on the host: the host vendor/ is incomplete (host
//     PHP lacks ext-gmp/pcntl/posix) and produces dozens of false failures.
//     Container or UNAVAILABLE — no third option.
//   - Exit 0 all good · 1 something FAILED · 2 nothing failed but a required
//     check was UNAVAILABLE (treat as "not fully checked", not as green).
//
// USAGE
//   node scripts/preflight.mjs               # check working tree + unpushed commits
//   node scripts/preflight.mjs --base <sha>  # replay mode: check <sha>..HEAD only
//   node scripts/preflight.mjs --list        # show detected areas, run nothing

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const mmMod = require('minimatch');
const minimatch = mmMod.minimatch || mmMod;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const CHECK_TIMEOUT_MS = 300_000; // one stuck check must not hang the push
const VITEST_FILE_CAP = 10;       // focused tests only — a bigger set is CI's job

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = baseIdx !== -1 ? args[baseIdx + 1] : null;
const LIST_ONLY = args.includes('--list');

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// 1. What changed?
// ---------------------------------------------------------------------------
function changedFiles() {
  const files = new Set();
  if (BASE) {
    // Replay mode: exactly the committed range. Lets the script be validated
    // against historical diffs without manufacturing changes.
    for (const f of git('diff', '--name-only', BASE, 'HEAD').split('\n')) if (f) files.add(f);
    return { files: [...files], mode: `commits ${BASE.slice(0, 9)}..HEAD` };
  }
  // Default: everything that would be new to origin/main — unpushed commits
  // plus staged, unstaged, and untracked working-tree changes.
  let range = false;
  try {
    git('fetch', 'origin', 'main', '--quiet');
    if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
      for (const f of git('diff', '--name-only', 'origin/main', 'HEAD').split('\n')) if (f) files.add(f);
      range = true;
    }
  } catch { /* offline: working-tree changes still checked below */ }
  for (const f of git('diff', '--name-only', 'HEAD').split('\n')) if (f) files.add(f);
  for (const f of git('ls-files', '--others', '--exclude-standard').split('\n')) if (f) files.add(f);
  return { files: [...files], mode: range ? 'unpushed commits + working tree' : 'working tree' };
}

// ---------------------------------------------------------------------------
// 2. Which areas does that wake? (same path lists CI uses)
// ---------------------------------------------------------------------------
const ciPaths = yaml.load(readFileSync(path.join(ROOT, '.github', 'ci-paths.yml'), 'utf8'));
const matches = (file, globs) => globs.some((g) => minimatch(file, g, { dot: true }));

function detectAreas(files) {
  const areas = {
    php: [], frontend: [], mobile: [], docsMeta: [], workflows: [], i18n: [],
  };
  const DOCS_META = ['docs/**', '*.md', '.github/**', 'VERSION', 'package.json'];
  const I18N_LOCAL = ['lang/**', 'react-frontend/public/locales/**'];
  for (const f of files) {
    if (matches(f, ciPaths.php)) areas.php.push(f);
    if (matches(f, ciPaths.frontend)) areas.frontend.push(f);
    if (matches(f, ciPaths.mobile)) areas.mobile.push(f);
    if (matches(f, DOCS_META)) areas.docsMeta.push(f);
    if (matches(f, ['.github/workflows/*.yml'])) areas.workflows.push(f);
    if (matches(f, I18N_LOCAL)) areas.i18n.push(f);
  }
  return areas;
}

// ---------------------------------------------------------------------------
// 3. Check runner with honest statuses
// ---------------------------------------------------------------------------
const results = []; // { name, status: PASS|FAIL|SKIP|UNAVAILABLE, note }

function record(name, status, note = '') {
  results.push({ name, status, note });
  const icon = { PASS: '✓', FAIL: '✗', SKIP: '·', UNAVAILABLE: '⚠' }[status];
  console.log(`  ${icon} ${status.padEnd(11)} ${name}${note ? ` — ${note}` : ''}`);
}

function sh(name, command, { cwd = ROOT, timeout = CHECK_TIMEOUT_MS } = {}) {
  console.log(`  ▸ running: ${name}`);
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    record(name, 'UNAVAILABLE', `timed out after ${timeout / 1000}s`);
    return false;
  }
  if (r.status === 0) { record(name, 'PASS'); return true; }
  const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
  console.log(tail.replace(/^/gm, '      '));
  record(name, 'FAIL', `exit ${r.status}`);
  return false;
}

function dockerPhpAvailable() {
  const r = spawnSync('docker exec nexus-php-app php -v', { shell: true, encoding: 'utf8', timeout: 15_000 });
  return r.status === 0;
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------
const { files, mode } = changedFiles();
console.log(`[preflight] inspecting: ${mode} (${files.length} changed file${files.length === 1 ? '' : 's'})`);

if (files.length === 0) {
  console.log('[preflight] nothing changed — nothing to check.');
  process.exit(0);
}

const areas = detectAreas(files);

if (LIST_ONLY) {
  for (const [k, v] of Object.entries(areas)) console.log(`  ${k}: ${v.length} file(s)`);
  process.exit(0);
}

// --- docs / metadata --------------------------------------------------------
if (areas.docsMeta.length) {
  sh('docs hygiene', 'node scripts/check-docs-hygiene.mjs');
  sh('version consistency', 'node scripts/check-version-consistency.mjs');
} else {
  record('docs hygiene', 'SKIP', 'no docs/meta changes');
}

// SPDX is seconds and protects a hard release rule — run when any source changed.
if (files.some((f) => /\.(php|ts|tsx|mjs)$/.test(f))) {
  sh('SPDX headers', 'node scripts/check-spdx.mjs');
} else {
  record('SPDX headers', 'SKIP', 'no source files changed');
}

// Changelog guard reads COMMITTED state, so it is only meaningful when there
// are commits to judge; working-tree-only changes get a reminder instead.
if (files.includes('CHANGELOG.md') || areas.php.length || areas.frontend.length) {
  const baseForGuard = BASE || (mode.startsWith('unpushed') ? 'origin/main' : null);
  if (baseForGuard) {
    sh('changelog guard', `node scripts/check-changelog-updated.mjs --base ${baseForGuard}`);
  } else {
    record('changelog guard', 'SKIP', 'uncommitted changes only — guard runs on committed state; re-run after committing');
  }
}

// --- workflow YAML -----------------------------------------------------------
for (const wf of areas.workflows) {
  try {
    yaml.load(readFileSync(path.join(ROOT, wf), 'utf8'));
    record(`workflow parses: ${wf}`, 'PASS');
  } catch (e) {
    record(`workflow parses: ${wf}`, 'FAIL', e.message.split('\n')[0]);
  }
}

// --- PHP ---------------------------------------------------------------------
if (areas.php.length) {
  const phpApp = files.filter((f) => f.startsWith('app/') && f.endsWith('.php') && existsSync(path.join(ROOT, f)));
  const phpTests = files.filter((f) => f.startsWith('tests/') && f.endsWith('.php') && existsSync(path.join(ROOT, f)));
  const docker = dockerPhpAvailable();

  if (phpApp.length) {
    if (docker) {
      sh(`PHPStan (${phpApp.length} changed app file${phpApp.length === 1 ? '' : 's'})`,
        `docker exec nexus-php-app php vendor/bin/phpstan analyse ${phpApp.join(' ')} --memory-limit=1G --no-progress`);
    } else {
      record('PHPStan (changed app files)', 'UNAVAILABLE', 'nexus-php-app container not running — CI will run it; do not assume it passes');
    }
  }
  if (phpTests.length) {
    if (docker) {
      // Host PHPUnit is deliberately never attempted: incomplete host vendor/
      // produces false failures. APP_KEY must be passed explicitly — the
      // container .env ships a placeholder that breaks Crypt-touching tests.
      sh(`PHPUnit (${phpTests.length} changed test file${phpTests.length === 1 ? '' : 's'})`,
        `docker exec -e MAIL_MAILER=array -e APP_KEY="base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=" nexus-php-app php vendor/bin/phpunit ${phpTests.join(' ')} --no-coverage`,
        { timeout: 420_000 });
    } else {
      record('PHPUnit (changed test files)', 'UNAVAILABLE', 'nexus-php-app container not running — these tests have NOT been run');
    }
  }
  if (files.some((f) => f.startsWith('app/') || f.startsWith('database/') || f.startsWith('migrations/'))) {
    sh('DB column references', 'node scripts/check-db-column-references.mjs');
  }
} else {
  record('PHP checks', 'SKIP', 'no PHP-area changes');
}

// --- React frontend -----------------------------------------------------------
if (areas.frontend.length) {
  const feDir = path.join(ROOT, 'react-frontend');
  if (!existsSync(path.join(feDir, 'node_modules'))) {
    record('frontend checks', 'UNAVAILABLE', 'react-frontend/node_modules missing — run npm ci first');
  } else {
    // Same memory headroom the repo's own lint script uses; a cold tsc on
    // Windows can exceed 5 minutes, so this check gets a longer leash.
    sh('frontend tsc --noEmit', 'npx cross-env NODE_OPTIONS=--max-old-space-size=20480 tsc --noEmit', { cwd: feDir, timeout: 600_000 });
    const feTests = files.filter((f) => /^react-frontend\/src\/.*\.test\.(ts|tsx)$/.test(f) && existsSync(path.join(ROOT, f)));
    if (feTests.length) {
      // tsc --noEmit does NOT cover test files; the ratchet does.
      sh('frontend test-type ratchet', 'npm run check:test-types', { cwd: feDir });
      const capped = feTests.slice(0, VITEST_FILE_CAP);
      if (feTests.length > VITEST_FILE_CAP) {
        record('focused vitest scope', 'SKIP', `${feTests.length} test files changed — running first ${VITEST_FILE_CAP}, CI runs the rest`);
      }
      // --retry=0: preflight must see flakiness, not hide it. Foreground only
      // (backgrounded vitest deadlocks on this machine).
      sh(`focused vitest (${capped.length} file${capped.length === 1 ? '' : 's'}, --retry=0)`,
        `npx vitest run ${capped.map((f) => f.replace('react-frontend/', '')).join(' ')} --retry=0`,
        { cwd: feDir, timeout: 420_000 });
    }
  }
} else {
  record('frontend checks', 'SKIP', 'no frontend changes');
}

// --- Mobile --------------------------------------------------------------------
if (areas.mobile.length) {
  if (!existsSync(path.join(ROOT, 'mobile', 'node_modules'))) {
    record('mobile tsc', 'UNAVAILABLE', 'mobile/node_modules missing — run npm ci in mobile/ first');
  } else {
    sh('mobile tsc --noEmit', 'npm run type-check', { cwd: path.join(ROOT, 'mobile') });
    record('mobile jest suite', 'SKIP', 'deferred to CI (full suite ~5 min); run npm test in mobile/ if touching contracts');
  }
} else {
  record('mobile checks', 'SKIP', 'no mobile changes');
}

// --- i18n -----------------------------------------------------------------------
if (areas.i18n.length) {
  sh('php-lang key parity', 'node scripts/check-php-lang-parity.mjs');
  sh('php-lang untranslated ratchet', 'node scripts/check-php-lang-untranslated.mjs');
  sh('locale JSON integrity', 'node scripts/check-i18n-json-integrity.mjs');
} else {
  record('i18n checks', 'SKIP', 'no lang/locale changes');
}

// ---------------------------------------------------------------------------
// 5. Verdict — plainly, and never let "couldn't run" read as "passed"
// ---------------------------------------------------------------------------
const failed = results.filter((r) => r.status === 'FAIL');
const unavailable = results.filter((r) => r.status === 'UNAVAILABLE');
const passed = results.filter((r) => r.status === 'PASS');

console.log('\n[preflight] ──────────────────────────────────────────');
console.log(`[preflight] ${passed.length} passed, ${failed.length} failed, ${unavailable.length} unavailable`);
if (failed.length) {
  console.log('[preflight] ✗ FIX BEFORE PUSHING:');
  for (const r of failed) console.log(`    - ${r.name}`);
  process.exit(1);
}
if (unavailable.length) {
  console.log('[preflight] ⚠ NOT fully checked — these could not run here:');
  for (const r of unavailable) console.log(`    - ${r.name} (${r.note})`);
  console.log('[preflight] Pushing is allowed but CI is the only thing that will run them.');
  process.exit(2);
}
console.log('[preflight] ✓ all applicable local checks passed. CI remains the authoritative gate.');
process.exit(0);
