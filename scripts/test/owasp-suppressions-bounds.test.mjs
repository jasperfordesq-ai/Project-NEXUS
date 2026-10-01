// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// owasp-suppressions-bounds.test.mjs — F-501.
//
// Three entries in owasp-suppressions.xml suppressed their advisory at ANY
// version of the package (`@.*$`), so the BLOCKING dependency gate
// (failOnCVSS 7) would have stayed silent if the package ever regressed to a
// vulnerable release. The in-house counter-example in the same file is
// form-data, bounded to its patched range. These tests pin the bounds:
//
//   * ejs (CVE-2023-29827, CVSS 9.8) is suppressed only from 3.1.10, the fix;
//   * js-yaml (GHSA-h67p-54hq-rp68, a dev-tooling excuse) only at the two
//     versions installed when the excuse was last judged — a new version must
//     be re-reviewed rather than inherit it;
//   * tar (GHSA-vmf3-w455-68vh) is installed in no lockfile, so its
//     suppression hid nothing and is gone — if tar returns, it is reported.
//
// OWASP Dependency-Check evaluates these as Java regexes; every construct used
// here (groups, alternation, classes, {n,} quantifiers) means the same in JS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(path.join(here, '..', '..', 'owasp-suppressions.xml'), 'utf8');

/** The packageUrl regex of the suppression for one advisory. */
function suppressionFor(advisory) {
  const blocks = xml.split('<suppress>').slice(1);
  const block = blocks.find((b) => b.includes(`<vulnerabilityName>${advisory}</vulnerabilityName>`));
  if (!block) return null;
  const m = block.match(/<packageUrl regex="true">([^<]+)<\/packageUrl>/);
  assert.ok(m, `${advisory}: suppression has a regex packageUrl`);
  return new RegExp(m[1]);
}

test('F-501: ejs CVE-2023-29827 is suppressed only on the patched releases', () => {
  const re = suppressionFor('CVE-2023-29827');
  assert.ok(re, 'the ejs suppression still exists');
  for (const v of ['3.1.10', '3.1.11', '3.1.99', '3.2.0', '3.10.4', '4.0.0', '10.1.2']) {
    assert.ok(re.test(`pkg:npm/ejs@${v}`), `${v} is patched and stays suppressed`);
  }
  assert.ok(re.test('pkg:npm/ejs@3.1.10?type=module'), 'a purl qualifier does not break the match');
  for (const v of ['3.1.9', '3.1.1', '3.0.2', '2.7.4', '1.0.0']) {
    assert.equal(re.test(`pkg:npm/ejs@${v}`), false, `${v} is vulnerable and must be REPORTED`);
  }
});

test('F-501: js-yaml GHSA-h67p-54hq-rp68 is suppressed only at the reviewed versions', () => {
  const re = suppressionFor('GHSA-h67p-54hq-rp68');
  assert.ok(re, 'the js-yaml suppression still exists');
  assert.ok(re.test('pkg:npm/js-yaml@3.15.2'));
  assert.ok(re.test('pkg:npm/js-yaml@4.3.2'));
  for (const v of ['3.13.0', '3.15.3', '4.3.1', '4.3.20', '5.0.0']) {
    assert.equal(re.test(`pkg:npm/js-yaml@${v}`), false, `${v} has not been reviewed and must be reported`);
  }
});

test('F-501: the dead tar suppression is gone, so a returning tar is reported', () => {
  assert.equal(suppressionFor('GHSA-vmf3-w455-68vh'), null);
});

test('control: form-data, the bounded counter-example, is unchanged', () => {
  const re = suppressionFor('GHSA-hmw2-7cc7-3qxx');
  assert.ok(re.test('pkg:npm/form-data@4.0.5'));
  assert.equal(re.test('pkg:npm/form-data@4.0.3'), false);
});
