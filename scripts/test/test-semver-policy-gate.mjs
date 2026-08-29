#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract tests for scripts/check-semver-policy.mjs.
 *
 * 🔴 A gate nobody has watched fail is not evidence. This repository has been
 * bitten by that specific thing more than once — a checker whose comment claimed
 * it pinned a value while it pinned nothing, and a bundle-size budget that was
 * written but never invoked. So every rule the semver gate claims to enforce is
 * exercised here in BOTH directions: a fixture that must pass, and a fixture
 * that must fail for the stated reason.
 *
 * Fixtures are written to a temporary directory and the gate is pointed at them
 * with NEXUS_SEMVER_ROOT. Nothing in the repository is touched.
 *
 * Run: node scripts/test/test-semver-policy-gate.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-semver-policy.mjs');
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-semver-gate-'));

const REPO = 'https://github.com/jasperfordesq-ai/Project-NEXUS';

/** Build a changelog from section descriptors. */
function changelog(sections, { links = null } = {}) {
  const head = [
    '# Changelog',
    '',
    'All notable changes to Project NEXUS will be documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),',
    'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
    '',
    '---',
    '',
  ];

  const body = [];
  for (const s of sections) {
    body.push(s.date ? `## [${s.version}] - ${s.date}` : `## [${s.version}]`, '');
    body.push(...(s.lines ?? []), '');
  }

  const released = sections.filter((s) => s.version !== 'Unreleased');
  const linkLines =
    links ??
    [
      `[Unreleased]: ${REPO}/compare/v${released[0].version}...HEAD`,
      ...released.map((s, i) => {
        const prev = released[i + 1];
        return prev
          ? `[${s.version}]: ${REPO}/compare/v${prev.version}...v${s.version}`
          : `[${s.version}]: ${REPO}/releases/tag/v${s.version}`;
      }),
    ];

  return [...head, ...body, ...linkLines, ''].join('\n');
}

const added = (text) => ['### Added', '', `- **${text}**`];
const fixed = (text) => ['### Fixed', '', `- **${text}**`];

let passCount = 0;
let failCount = 0;

function run(name, { version, sections, links, expect, expectMatch }) {
  const dir = fs.mkdtempSync(path.join(tmpBase, 'case-'));
  fs.writeFileSync(path.join(dir, 'VERSION'), `${version}\n`);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog(sections, { links }));

  const r = spawnSync(process.execPath, [gate], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NEXUS_SEMVER_ROOT: dir },
  });

  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const okCode = r.status === expect;
  const okMatch = !expectMatch || expectMatch.test(output);

  if (okCode && okMatch) {
    console.log(`  PASS  ${name}`);
    passCount++;
    return;
  }

  console.log(`  FAIL  ${name}`);
  if (!okCode) console.log(`        expected exit ${expect}, got ${r.status}`);
  if (!okMatch) console.log(`        expected output to match ${expectMatch}`);
  console.log(output.split('\n').map((l) => `        ${l}`).join('\n'));
  failCount++;
}

console.log('check-semver-policy contract tests\n');

// ---------------------------------------------------------------- must pass
run('a clean patch release passes', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: fixed('something was broken') },
    { version: '1.7.0', date: '2026-08-28', lines: added('a feature') },
  ],
  expect: 0,
});

run('a minor release carrying an ### Added entry passes', {
  version: '1.8.0',
  sections: [
    { version: 'Unreleased' },
    { version: '1.8.0', date: '2026-08-29', lines: added('a new thing members can see') },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 0,
});

run('a two-digit patch component is accepted (no carry at nine)', {
  version: '1.7.10',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.10', date: '2026-08-29', lines: fixed('the tenth fix') },
    { version: '1.7.9', date: '2026-08-28', lines: fixed('the ninth fix') },
  ],
  expect: 0,
});

run('### Internal does not force a minor bump', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    {
      version: '1.7.1',
      date: '2026-08-29',
      lines: ['### Internal', '', '- **A new CI gate no consumer can observe.**'],
    },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 0,
});

run('a pre-release sorts below its final version', {
  version: '1.8.0',
  sections: [
    { version: 'Unreleased' },
    { version: '1.8.0', date: '2026-08-29', lines: fixed('a bug') },
    { version: '1.8.0-rc.1', date: '2026-08-28', lines: fixed('a bug') },
    { version: '1.7.0', date: '2026-08-27', lines: fixed('a bug') },
  ],
  expect: 0,
});

// ---------------------------------------------------------------- must fail
run('a feature shipped as a PATCH bump is refused', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: added('a whole new member journey') },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /is a PATCH bump.*requires at least a MINOR/s,
});

run('a BREAKING entry shipped as a MINOR bump is refused', {
  version: '1.8.0',
  sections: [
    { version: 'Unreleased' },
    {
      version: '1.8.0',
      date: '2026-08-29',
      lines: ['### Removed', '', '- **BREAKING:** `GET /v2/listings` no longer returns `legacy_category`.'],
    },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /requires at least a MAJOR/,
});

run('an unrecognised subsection heading is refused', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: ['### New Stuff', '', '- **A thing.**'] },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /"### New Stuff" is not a recognised subsection/,
});

run('a lower-case ### added cannot dodge the minor rule', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: ['### added', '', '- **A whole new journey.**'] },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /not a recognised subsection/,
});

run('entries floating above every subsection are refused', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: ['- **An uncategorised entry.**'] },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /above any "### " subsection/,
});

run('a retired heading is refused above the enforcement floor', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: ['### Notes', '', '- **A note.**'] },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /retired heading/,
});

run('VERSION disagreeing with the newest section is refused', {
  version: '1.7.5',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: fixed('a bug') },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /VERSION is 1\.7\.5 but the newest changelog release section is 1\.7\.1/,
});

run('releases listed out of order are refused', {
  version: '1.7.0',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.0', date: '2026-08-29', lines: fixed('a bug') },
    { version: '1.7.2', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /is not greater than it/,
});

run('a future release date is refused', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2099-01-01', lines: fixed('a bug') },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /in the future/,
});

run('a missing compare link is refused', {
  version: '1.7.1',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.1', date: '2026-08-29', lines: fixed('a bug') },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  links: [`[Unreleased]: ${REPO}/compare/v1.7.1...HEAD`],
  expect: 1,
  expectMatch: /release 1\.7\.0 has no compare link/,
});

run('an invalid VERSION is refused', {
  version: '1.7',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.0', date: '2026-08-28', lines: fixed('a bug') },
  ],
  expect: 1,
  expectMatch: /not a valid semantic version/,
});

// ------------------------------------------- history below the floor is exempt
run('a pre-1.7.0 release that violates the policy is left alone', {
  version: '1.7.0',
  sections: [
    { version: 'Unreleased' },
    { version: '1.7.0', date: '2026-08-29', lines: fixed('a bug') },
    // 1.6.2 ships a feature as a patch bump, exactly as the real history did.
    { version: '1.6.2', date: '2026-08-28', lines: added('a feature shipped as a patch') },
    { version: '1.6.1', date: '2026-08-17', lines: ['### Notes', '', '- **A retired heading.**'] },
  ],
  expect: 0,
});

fs.rmSync(tmpBase, { recursive: true, force: true });

console.log('');
console.log(`${passCount} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
