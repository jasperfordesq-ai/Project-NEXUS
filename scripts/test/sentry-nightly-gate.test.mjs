// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// sentry-nightly-gate.test.mjs — the nightly Sentry job runs in GitHub Actions on a
// PUBLIC repository, so its logs are public. The gate must therefore emit COUNTS ONLY.
// An issue title like "Safeguarding contact gate unusable for tenants with live
// vetted-interaction selections" names a real safeguarding gap and must never be
// published by our own monitoring.
//
// Contract pinned here:
//   1. counts only — no title, culprit, permalink, shortId or tenant id ever printed,
//   2. exit 1 when anything needs attention, so the scheduled run fails and GitHub emails,
//   3. exit 0 when nothing does,
//   4. exit 2 when the queue file is absent — the sweep did not run, which is NOT a pass.
//
// Run: node --test scripts/test/sentry-nightly-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, '..', 'check-sentry-nightly.mjs');
const tmp = mkdtempSync(path.join(tmpdir(), 'sentry-gate-'));

const SECRET_TITLE = 'Safeguarding contact gate unusable for tenants with live vetted-interaction selections';
const SECRET_CULPRIT = 'app/Console/Commands/SafeguardingPolicyHealthCheck.php';

function queueFile(name, counts, queue = []) {
  const f = path.join(tmp, name);
  writeFileSync(f, JSON.stringify({ generatedAt: '2026-09-17T09:00:00Z', window: '1d', counts, queue }), 'utf8');
  return f;
}

function run(file) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, file], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('exits 0 and reports counts when nothing needs attention', () => {
  const f = queueFile('clean.json', { unresolved: 4, queued: 0, parkedByLedger: 4, newSinceLastRun: 0, sensitive: 0, recurred: 0 });
  const { code, stdout } = run(f);
  assert.equal(code, 0);
  assert.match(stdout, /queued[^0-9]*0/i);
});

test('exits 1 when anything needs attention, so the scheduled run fails', () => {
  const f = queueFile('dirty.json', { unresolved: 15, queued: 3, parkedByLedger: 0, newSinceLastRun: 3, sensitive: 2, recurred: 2 },
    [{ id: '1', shortId: 'NEXUS-PHP-99', title: SECRET_TITLE, culprit: SECRET_CULPRIT, permalink: 'https://sentry.io/x/1', score: 74 }]);
  const { code, stdout } = run(f);
  assert.equal(code, 1);
  // Must not pass vacuously: a missing or crashing gate also exits non-zero, so
  // require proof it actually read the queue and reported.
  assert.match(stdout, /queued[^0-9]*3/i, 'gate did not report — exit code alone proves nothing');
});

test('never prints an issue title, culprit, shortId or permalink (the log is public)', () => {
  const f = queueFile('leak.json', { unresolved: 15, queued: 3, parkedByLedger: 0, newSinceLastRun: 3, sensitive: 2, recurred: 2 },
    [{ id: '1', shortId: 'NEXUS-PHP-99', title: SECRET_TITLE, culprit: SECRET_CULPRIT, permalink: 'https://sentry.io/x/1', score: 74 }]);
  const { stdout } = run(f);
  // Proof the gate ran: otherwise "printed no secrets" is true of an empty
  // output and this test would pass against a gate that does not exist.
  assert.match(stdout, /queued[^0-9]*3/i, 'gate did not report — a silent gate leaks nothing and proves nothing');
  assert.doesNotMatch(stdout, /Safeguarding/i, 'issue title leaked into a public log');
  assert.doesNotMatch(stdout, /vetted-interaction/i, 'issue title leaked into a public log');
  assert.doesNotMatch(stdout, /SafeguardingPolicyHealthCheck/i, 'culprit leaked into a public log');
  assert.doesNotMatch(stdout, /NEXUS-PHP-99/, 'short id leaked into a public log');
  assert.doesNotMatch(stdout, /sentry\.io\/x\/1/, 'permalink leaked into a public log');
});

test('the counts it does print are the real numbers', () => {
  const f = queueFile('numbers.json', { unresolved: 15, queued: 3, parkedByLedger: 4, newSinceLastRun: 1, sensitive: 2, recurred: 2 });
  const { stdout } = run(f);
  for (const [label, n] of [['unresolved', 15], ['queued', 3], ['sensitive', 2], ['recurred', 2]]) {
    assert.match(stdout, new RegExp(`${label}[^0-9]*${n}`, 'i'), `${label} count missing or wrong`);
  }
});

test('exits 2 when the queue file is absent — a sweep that did not run is not a pass', () => {
  const { code } = run(path.join(tmp, 'nope.json'));
  assert.equal(code, 2);
});

// ---------------------------------------------------------------------------
// The private Telegram body and the change signal.
//
// Telegram is the channel the owner already receives (uptime-check.yml,
// deploy-drift-watchdog.yml) and it is PRIVATE, so unlike the CI log it may name
// the issues — that is the whole reason it beats a bare "3 issues need attention".
// The body therefore goes to a FILE the curl step reads directly; it must never
// travel through stdout or a step output, either of which can end up in the log.
// ---------------------------------------------------------------------------

function runWith(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const withIssues = (name, ids) => queueFile(name,
  { unresolved: 15, queued: ids.length, parkedByLedger: 0, newSinceLastRun: 1, sensitive: 1, recurred: 1 },
  ids.map((id) => ({ id: String(id), shortId: `NEXUS-PHP-${id}`, title: SECRET_TITLE, culprit: SECRET_CULPRIT, permalink: `https://sentry.io/x/${id}`, score: 74 })));

test('writes a private message file that DOES name the issues', () => {
  const f = withIssues('msg.json', [99]);
  const out = path.join(tmp, 'message.txt');
  runWith([f, '--message-file', out]);
  const body = readFileSync(out, 'utf8');
  assert.match(body, /Safeguarding/i, 'the private message must name the issue, or it is no better than a count');
  assert.match(body, /NEXUS-PHP-99/, 'the private message should carry the short id to look it up');
});

test('writing the private message does not leak it to stdout', () => {
  const f = withIssues('msg2.json', [99]);
  const out = path.join(tmp, 'message2.txt');
  const { stdout } = runWith([f, '--message-file', out]);
  assert.match(stdout, /queued[^0-9]*1/i, 'gate must still report counts');
  assert.doesNotMatch(stdout, /Safeguarding/i, 'private body leaked into the public log');
  assert.doesNotMatch(stdout, /NEXUS-PHP-99/, 'private body leaked into the public log');
});

test('emits a state key that is stable for the same issues and changes when they change', () => {
  const readKey = (queue, outFile) => {
    runWith([queue], { GITHUB_OUTPUT: outFile });
    const m = readFileSync(outFile, 'utf8').match(/^state_key=(.+)$/m);
    assert.ok(m, 'gate did not emit state_key');
    return m[1].trim();
  };
  const a = readKey(withIssues('s1.json', [1, 2]), path.join(tmp, 'o1.txt'));
  const b = readKey(withIssues('s2.json', [2, 1]), path.join(tmp, 'o2.txt'));
  const c = readKey(withIssues('s3.json', [1, 2, 3]), path.join(tmp, 'o3.txt'));
  assert.equal(a, b, 'same issues in a different order must not count as a change');
  assert.notEqual(a, c, 'a new issue must count as a change');
});

test('the state key does not contain an issue title or short id', () => {
  const out = path.join(tmp, 'o4.txt');
  runWith([withIssues('s4.json', [99])], { GITHUB_OUTPUT: out });
  const written = readFileSync(out, 'utf8');
  assert.doesNotMatch(written, /Safeguarding/i, 'state key leaked the title');
  assert.doesNotMatch(written, /NEXUS-PHP-99/, 'state key leaked the short id');
});

test('an empty queue produces a distinct state key, so recovery is a change', () => {
  const clean = queueFile('s5.json', { unresolved: 0, queued: 0, parkedByLedger: 0, newSinceLastRun: 0, sensitive: 0, recurred: 0 });
  const o = path.join(tmp, 'o5.txt');
  runWith([clean], { GITHUB_OUTPUT: o });
  const key = readFileSync(o, 'utf8').match(/^state_key=(.+)$/m)[1].trim();
  assert.equal(key, 'clear', 'an empty queue should read as "clear" so the recovery message fires');
});

process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
