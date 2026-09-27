// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// check-help-staleness.test.mjs — runs the real CLI against throwaway git
// repositories, so every rule is shown to fail as well as pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-help-staleness.mjs');
const DATA = 'react-frontend/src/pages/help/guides/data';
const created = [];

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function commit(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** A repository with two member articles and the page files they describe. */
function makeRepo() {
  const root = tempDir('help-staleness-');
  git(root, 'init', '-q');
  write(root, `${DATA}/members.registry.json`, [
    { id: 'wallet', icon: 'wallet', articles: [{ id: 'sending', link: '/wallet' }, { id: 'history' }] },
  ]);
  write(root, `${DATA}/brokers.registry.json`, []);
  write(root, `${DATA}/admins.registry.json`, []);
  write(root, 'app/Wallet.tsx', 'export const v = 1;\n');
  write(root, 'app/history/List.tsx', 'export const v = 1;\n');
  write(root, 'app/Other.tsx', 'export const v = 1;\n');
  const first = commit(root, 'initial');
  return { root, first };
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function setSources(root, entries) {
  write(root, `${DATA}/sources.json`, { '//': 'test', ...entries });
}

function json(root) {
  return JSON.parse(run(root, '--json').out);
}

test('an unmapped article fails until it is accepted into the baseline', () => {
  const { root } = makeRepo();
  const before = run(root);
  assert.equal(before.code, 1, before.out);
  assert.match(before.out, /NEW unmapped articles/);
  assert.match(before.out, /members\/wallet\/sending/);
  assert.equal(run(root, '--write-baseline').code, 0);
  const after = run(root);
  assert.equal(after.code, 0, after.out);
  assert.match(after.out, /PASS/);
});

test('an article whose source changed after it was verified is stale; re-verifying clears it', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  commit(root, 'map sources');
  assert.equal(run(root).code, 0, 'clean at first');

  write(root, 'app/Other.tsx', 'export const v = 2;\n');
  commit(root, 'unrelated change');
  assert.equal(run(root).code, 0, 'a change to an unrelated file is not drift');

  write(root, 'app/Wallet.tsx', 'export const v = 2;\n');
  const changed = commit(root, 'change the wallet page');
  const result = run(root);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /NEW stale articles/);
  assert.match(result.out, new RegExp(`members/wallet/sending .*${changed.slice(0, 7)}`));
  assert.doesNotMatch(result.out, /members\/wallet\/history\s/);

  assert.equal(run(root, '--mark-verified', 'members/wallet/sending').code, 0);
  const sources = JSON.parse(fs.readFileSync(path.join(root, DATA, 'sources.json'), 'utf8'));
  assert.equal(sources['members/wallet/sending'].verified, git(root, 'rev-parse', 'HEAD'));
  assert.equal(sources['//'], 'test', 'comment keys survive a rewrite');
  assert.equal(run(root).code, 0);
});

test('a change inside a source folder counts', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  commit(root, 'map');
  write(root, 'app/history/List.tsx', 'export const v = 3;\n');
  commit(root, 'history change');
  assert.deepEqual(json(root).stale, ['members/wallet/history']);
});

test('a renamed or deleted source is stale and reported as missing', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  commit(root, 'map');
  git(root, 'mv', 'app/Wallet.tsx', 'app/WalletPage.tsx');
  commit(root, 'rename');
  const report = json(root);
  assert.deepEqual(report.stale, ['members/wallet/sending']);
  assert.deepEqual(report.missingSources, ['members/wallet/sending | app/Wallet.tsx']);
  assert.equal(report.status, 'FAIL');
});

test('accepted drift passes, but a baseline line that no longer applies fails', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  commit(root, 'map');
  write(root, 'app/Wallet.tsx', 'export const v = 2;\n');
  commit(root, 'change');
  assert.equal(run(root, '--write-baseline').code, 0);
  assert.equal(run(root).code, 0, 'known drift is accepted');

  run(root, '--mark-verified', 'all');
  const result = run(root);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /Baseline lines that no longer apply/);
  assert.match(result.out, /members\/wallet\/sending/);
});

test('entries for articles that do not exist, and malformed entries, always fail', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first.slice(0, 12) },
    'members/wallet/history': { sources: ['C:\\app\\history'], verified: first },
    'members/wallet/gone': { sources: ['app/Wallet.tsx'], verified: first },
  });
  const report = json(root);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.invalid.length, 3, report.invalid.join('\n'));
  assert.match(report.invalid.join('\n'), /gone: no such article/);
  assert.match(report.invalid.join('\n'), /full 40-character commit sha/);
  assert.match(report.invalid.join('\n'), /repo-relative path/);
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, '--root', root, '--write-baseline'], { stdio: 'pipe' }));
});

test('a verified commit missing from the clone is UNAVAILABLE (exit 2), never a pass', () => {
  const { root } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: 'a'.repeat(40) },
    'members/wallet/history': { sources: ['app/history/'], verified: git(root, 'rev-parse', 'HEAD') },
  });
  commit(root, 'map');
  const result = run(root);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /UNAVAILABLE/);
  assert.match(result.out, /not in this clone/);
});

test('a shallow clone names the fetch depth it needs', () => {
  const { root, first } = makeRepo();
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: first },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  commit(root, 'map');
  write(root, 'app/Other.tsx', 'export const v = 9;\n');
  commit(root, 'later');
  const shallow = tempDir('help-staleness-shallow-');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${root.replace(/\\/g, '/')}`, shallow], { stdio: 'pipe' });
  const result = run(shallow);
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /fetch-depth: 0/);
});

test('a verified commit on another branch is rejected', () => {
  const { root, first } = makeRepo();
  git(root, 'checkout', '-q', '-b', 'side');
  write(root, 'app/Other.tsx', 'side\n');
  const side = commit(root, 'side');
  git(root, 'checkout', '-q', '-');
  setSources(root, {
    'members/wallet/sending': { sources: ['app/Wallet.tsx'], verified: side },
    'members/wallet/history': { sources: ['app/history/'], verified: first },
  });
  const report = json(root);
  assert.equal(report.status, 'FAIL');
  assert.match(report.invalid.join('\n'), /not in HEAD's history/);
});
