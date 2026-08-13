// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

/**
 * 🔴 Shrink-only ceiling on hardcoded English page titles.
 *
 * A `title:` passed to res.render() becomes the page's <title>: the browser tab
 * name, the bookmark name, and what a screen reader announces as the page. On a
 * frontend serving eleven languages it must come from a translator, as Blade's does.
 *
 * Found 2026-08-13 by comparing every page's <title> against Blade in Irish: eight
 * of the most-used pages — Feed, Listings, Events, Groups, Ideas and the three
 * "create" forms — stayed English on web-uk while Blade rendered Irish.
 *
 * 🔴 A `title:` literal is NOT counted when the same render call also passes a
 * `titleKey`. That pairing is a DELIBERATE contract, not debt: the route supplies an
 * English fallback in `title` and the translation key in `titleKey`, and the layout
 * resolves the key at render time. routes/jobs.js uses it for all 16 of its page
 * titles, and tests/jobs-title-localization.test.js asserts the exact shape
 * (`title: 'Post an opportunity'` alongside `titleKey: 'jobs_t3.create_title'`).
 * An earlier version of this counter ignored the pairing, reported 253, and led to
 * those 16 being "fixed" — which broke the contract and the test above. Do not count
 * them again. The honest, pairing-aware figure on 2026-08-13 was 56, after the four
 * generic error-page titles ('Page not found', 'Forbidden', 'Service unavailable',
 * 'Too many requests' — 75 occurrences across 22 files) were translated.
 *
 * The number may only go DOWN. Lower it in the same commit as any fix. If this test
 * fails because the count rose, the fix is to translate the new title — or pair it
 * with a `titleKey` — not to raise the ceiling.
 */
const CEILING = 56;

const SRC = path.join(__dirname, '..', 'src');
const TITLE_LITERAL = /title:\s*'[A-Z][^']{2,80}'/g;

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('hardcoded page-title debt', () => {
  it(`does not exceed the recorded ceiling of ${CEILING}`, () => {
    const perFile = {};
    let total = 0;

    for (const file of jsFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      let count = 0;
      for (const match of source.matchAll(TITLE_LITERAL)) {
        // Skip literals that are a deliberate fallback beside a `titleKey`. The
        // window is the remainder of the render call's object literal.
        const tail = source.slice(match.index, match.index + 400);
        const objectEnd = tail.indexOf('});');
        const scope = objectEnd === -1 ? tail : tail.slice(0, objectEnd);
        if (/\btitleKey\s*:/.test(scope)) continue;
        count += 1;
      }
      if (count) {
        perFile[path.relative(SRC, file).split(path.sep).join('/')] = count;
        total += count;
      }
    }

    const worst = Object.entries(perFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f, n]) => `${n} in ${f}`)
      .join(', ');

    if (total > CEILING) {
      throw new Error(
        `Hardcoded English page titles rose to ${total} (ceiling ${CEILING}).\n`
        + `Use res.locals.t('<namespace>.<key>') for the new title instead of a literal.\n`
        + `Worst files: ${worst}`
      );
    }

    // Enforced downward too: a real fix must lower CEILING in the same commit, so
    // the ceiling can never drift into meaninglessness the way a stale cap does.
    expect(total).toBe(CEILING);
  });

  /**
   * The eight titles proven user-visible are pinned by name so they cannot silently
   * regress to literals while the aggregate count stays under the ceiling.
   */
  it('keeps the eight proven-visible core titles translated', () => {
    const cases = [
      ['routes/feed.js', 'govuk_alpha.feed.title'],
      ['routes/listings.js', 'govuk_alpha.listings.title'],
      ['routes/listings.js', 'govuk_alpha.listings.create.title'],
      ['routes/events.js', 'govuk_alpha.events.title'],
      ['routes/events.js', 'govuk_alpha.events.create_title'],
      ['routes/groups.js', 'govuk_alpha.groups.title'],
      ['routes/groups.js', 'govuk_alpha.groups.create.title'],
      ['routes/ideation.js', 'govuk_alpha.ideation.title'],
      ['routes/federation.js', 'govuk_alpha.federation.title']
    ];

    for (const [file, key] of cases) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect(source).toContain(`t('${key}')`);
    }
  });
});
