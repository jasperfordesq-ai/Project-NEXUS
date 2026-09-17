// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// sentry-triage-config.test.mjs — the nightly Sentry job runs in GitHub Actions,
// where `.secrets.local/sentry.env` does not exist. Until 2026-09-17 the triage
// script read that file and ONLY that file, so it could never run anywhere but
// the owner's machine — which is why "the nightly Sentry loop" it describes in
// its own header had never once run on a schedule, and why a 10-day Redis fault
// (1237 events) and a daily safeguarding pager both went unseen for weeks.
//
// Contract pinned here:
//   1. config comes from the env file when present (unchanged local behaviour),
//   2. from the process environment when the file is absent (the CI case),
//   3. the FILE WINS on any key it defines, so a stray exported variable on a
//      dev machine can never silently redirect the sweep at another org,
//   4. importing the module does NOT run the sweep — otherwise this very test
//      would hit Sentry and rewrite the committed ledger.
//
// Run: node --test scripts/test/sentry-triage-config.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'sentry-triage.mjs');
const tmp = mkdtempSync(path.join(tmpdir(), 'sentry-cfg-'));
const missing = path.join(tmp, 'does-not-exist.env');

const scriptUrl = pathToFileURL(SCRIPT).href;
const { loadEnv } = await import(scriptUrl);

test('reads the env file when it is present (unchanged local behaviour)', () => {
  const f = path.join(tmp, 'a.env');
  writeFileSync(f, 'SENTRY_ORG=from-file\nSENTRY_PROJECT_PHP=111\n', 'utf8');
  const env = loadEnv(f, {});
  assert.equal(env.SENTRY_ORG, 'from-file');
  assert.equal(env.SENTRY_PROJECT_PHP, '111');
});

test('falls back to the process environment when the file is absent (the CI case)', () => {
  const env = loadEnv(missing, { SENTRY_ORG: 'from-ci', SENTRY_PROJECT_PHP: '222' });
  assert.equal(env.SENTRY_ORG, 'from-ci');
  assert.equal(env.SENTRY_PROJECT_PHP, '222');
});

test('the file wins over the process environment on keys it defines', () => {
  const f = path.join(tmp, 'b.env');
  writeFileSync(f, 'SENTRY_ORG=from-file\n', 'utf8');
  const env = loadEnv(f, { SENTRY_ORG: 'from-ci', SENTRY_PROJECT_PHP: '333' });
  assert.equal(env.SENTRY_ORG, 'from-file', 'a stray exported var must not redirect the sweep');
  assert.equal(env.SENTRY_PROJECT_PHP, '333', 'but it still fills keys the file omits');
});

test('returns an empty object, not null, when neither source has anything', () => {
  assert.deepEqual(loadEnv(missing, {}), {});
});

test('importing the module does not run the sweep', () => {
  // If main() still ran on import, this child would report missing config and
  // print its usual output. Guarded, it imports and exits silently.
  const probe = path.join(tmp, 'probe.mjs');
  writeFileSync(probe, `import ${JSON.stringify(scriptUrl)};
console.log('CLEAN');
`, 'utf8');
  const out = execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: { ...process.env, SENTRY_ENV_FILE: missing, SENTRY_AUTH_TOKEN: '', SENTRY_ORG: '', SENTRY_API_BASE: '', SENTRY_PROJECT_PHP: '' },
  });
  assert.match(out, /CLEAN/);
  assert.doesNotMatch(out, /cannot reach Sentry|queue/);
});

process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
