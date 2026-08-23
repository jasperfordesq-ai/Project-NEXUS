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
 *
 * 🔴 The 22 that remain are NOT all debt, and should not be bulk-converted:
 *   - Specific not-found titles ('Event not found', 'Listing not found', 'Ticket not
 *     found', …). The only existing key is the GENERIC error_pages.404_title, so
 *     substituting it would make the page LESS informative, and tests assert the
 *     specific wording. These need their own translated keys, which do not exist.
 *   - 'Access denied', 'Error', 'Problem with the service', and a 503 titled
 *     'Federation': the available keys reword them.
 *   - Anything not inside a `res.render(` call. `res` is only definitionally in scope
 *     there; helper functions in route files (buildProfileSettingsViewModel(req,
 *     data)) and module-level data (lib/account-links.js) have no `res`, and a blind
 *     rewrite threw ReferenceError at require time and broke 926 tests in one run.
 *
 * 🔴 21 -> 19 on 2026-08-17: both 419 CSRF-expiry titles (lib/errorHandler.js and
 * the server.js CSRF handler) now use the EXISTING, already-translated
 * `error_pages.419_title`, whose English value is byte-identical to the literal
 * they replaced. Every sibling status in that same block (403, 404, 413, 429,
 * 503) already used the translator, so 419 was a plain oversight rather than
 * missing copy — and `errors/419.njk` was already fully translated, meaning the
 * page heading read Irish while the browser tab read English. The remaining 19
 * are the categories listed above and still need their own new keys.
 *
 * 🔴 19 -> 18 on 2026-08-23: the member profile page's `'User not found'` literal
 * is gone. That page no longer renders one generic 404 for every refusal — a
 * profile still being set up and one restricted to its owner's connections now
 * get their own translated page, and a 403 gets errors/403 — so the literal had
 * nothing left to title. See members.js memberProfileRefusal().
 */
const CEILING = 18;

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
        // Skip literals that are a deliberate fallback beside a `titleKey`.
        //
        // 🔴 Scan BOTH directions. `titleKey` is written after `title` in the route
        // files but BEFORE it in lib/account-links.js, and a forward-only window
        // therefore reported that entry as debt. Chasing that false count is how a
        // bulk edit put `res.locals.t` into account-links.js — module-level data
        // where `res` does not exist — breaking 926 tests in one go.
        const before = source.slice(Math.max(0, match.index - 400), match.index);
        const after = source.slice(match.index, match.index + 400);
        // Stay inside the current object literal in each direction.
        const openIdx = before.lastIndexOf('{');
        const scopeBefore = openIdx === -1 ? before : before.slice(openIdx);
        const closeIdx = after.search(/\}\s*[,;)\]]/);
        const scopeAfter = closeIdx === -1 ? after : after.slice(0, closeIdx);
        if (/\btitleKey\s*:/.test(scopeBefore + scopeAfter)) continue;
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
