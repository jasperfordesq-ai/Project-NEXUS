// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * When the app tells a member an action failed, it must pass on the server's reason.
 *
 * 🔴 The measurement that started this. Walking the volunteering journey on 2026-08-20,
 * logging hours failed and the app said only "Could not log these hours" — while the server
 * had answered **"You have already logged hours for this organization and date"**. The
 * member is told nothing, retries, and fails again. The information existed and was thrown
 * away, because `catch {` with no binding cannot see the error at all.
 *
 * That shape was in **165 places across 53 files** (journey 7.6). All of them now bind the
 * error and pass it through `describeApiError`, which shows the server's wording only when
 * it is fit for a member: never a 5xx, never something long or HTML-ish, never a code the
 * app answers with its own screen.
 *
 * This is a source scan rather than 165 screen tests, for the same reason as the other
 * guards in this directory: the fault is a pattern, and a pattern is what has to stay gone.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/** Every `.tsx` under app/ and components/, tests excluded. */
function screens(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) screens(full, out);
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** The body of the `catch` block whose opening brace is at `braceIndex`. */
function catchBody(source: string, braceIndex: number): string {
  let depth = 0;
  for (let i = braceIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceIndex + 1, i);
    }
  }
  return '';
}

interface Site {
  file: string;
  line: number;
}

function silentFailures(): Site[] {
  const found: Site[] = [];
  for (const dir of SEARCH_DIRS) {
    for (const file of screens(path.join(MOBILE_ROOT, dir))) {
      const source = fs.readFileSync(file, 'utf8');
      const re = /\}\s*catch\s*\{/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const body = catchBody(source, match.index + match[0].length - 1);
        // Only blocks that TELL the member something failed. A catch that swallows on
        // purpose — an optional prefetch, a best-effort refresh — is not this defect.
        if (!body.includes('showToast')) continue;
        if (!body.includes("'danger'")) continue;
        if (!body.includes('description:')) continue;
        if (body.includes('describeApiError')) continue;
        found.push({
          file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
          line: source.slice(0, match.index).split('\n').length,
        });
      }
    }
  }
  return found;
}

describe('a failed action passes on the reason the server gave', () => {
  it('has no screen left that reports a failure and discards the explanation', () => {
    const sites = silentFailures();

    /*
      The explanation goes in a thrown message rather than a second argument to `expect`:
      this Jest version takes only one, and a red guard has to name the files or it is
      useless to whoever has to fix it.
    */
    const listed = sites.map((s) => `${s.file}:${s.line}`);
    if (listed.length > 0) {
      throw new Error(
        `${listed.length} screen(s) tell a member an action failed while discarding the `
        + "server's reason. Bind the error (catch (err)) and wrap the fallback: "
        + "description: describeApiError(err, t('…')).\n  "
        + listed.join('\n  '),
      );
    }
    expect(listed).toEqual([]);
  });

  it('uses `catch {` freely where nothing is reported to the member', () => {
    /*
      🔴 This half matters as much as the first. A blanket ban on `catch {` would push
      people towards catching-and-toasting where the right answer is to say nothing —
      a best-effort refresh that fails should not raise an error at a member. So the
      guard above is deliberately narrow, and this asserts that narrowness rather than
      leaving it to be re-derived: bare catches still exist in the tree, by design.
    */
    let bare = 0;
    for (const dir of SEARCH_DIRS) {
      for (const file of screens(path.join(MOBILE_ROOT, dir))) {
        bare += (fs.readFileSync(file, 'utf8').match(/\}\s*catch\s*\{/g) ?? []).length;
      }
    }

    expect(bare).toBeGreaterThan(0);
  });
});
