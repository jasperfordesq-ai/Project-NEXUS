// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

/**
 * 🔴 Shrink-only ceiling on hand-written `<strong class="govuk-tag">` markup.
 *
 * On 2026-08-19, 321 of 349 tag sites were moved onto the official `govukTag`
 * macro so the next govuk-frontend upgrade updates this markup for us instead of
 * leaving hundreds of copies to drift. Nothing then stopped a 322nd hand-written
 * copy being added, and every other convention from that audit has a ratchet
 * protecting it (stylesheet coverage, table scroll regions, empty-state headings,
 * form integrity). This is that missing guard.
 *
 * 🔴 The macro's output is NOT byte-identical — it puts the label on its own line
 * inside the <strong> — but it IS pixel-identical, because CSS strips leading and
 * trailing whitespace inside an inline-block. Measured in a real browser at the
 * time of the migration: both forms render at exactly 79.38 x 30.00. That is why
 * a handful of assertions elsewhere match the label with `\s*` around it rather
 * than hard against the tag; do not "tidy" those back to exact adjacency.
 *
 * 🔴 The 30 that remain are NOT debt to be bulk-converted. They are the shapes the
 * conversion could not express as a substitution:
 *   - 23 carry a `{% if %}` INSIDE the class attribute. The macro takes `classes:`
 *     as a value, so these would have to become inline if-expressions — a semantic
 *     rewrite, not a swap, for no visible gain.
 *   - 5 have compound content ("Community: {{ name }}", or an inline conditional),
 *     which `text:` cannot hold as a single expression.
 *   - 2 span lines in a shape that does not pair cleanly.
 *
 * The number may only go DOWN. If this fails because it rose, the fix is to use the
 * macro for the new tag — `{{ govukTag({ text: ..., classes: ... }) }}` with
 * `{% from "govuk/components/tag/macro.njk" import govukTag %}` — not to raise the
 * ceiling. Lower CEILING in the same commit as any genuine conversion.
 */
const CEILING = 30;

// A deliberately dumb counter: the opening tag only. An earlier converter used a
// full open-to-close regex and silently disagreed with this count by two on
// multi-line shapes, so the ratchet counts something that cannot be ambiguous.
const HAND_WRITTEN = /<strong class="govuk-tag/g;
const MACRO_CALL = /govukTag\(\{/g;

const VIEWS = path.join(__dirname, '..', 'src', 'views');

function templates(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...templates(p));
    else if (entry.name.endsWith('.njk')) out.push(p);
  }
  return out;
}

function scan() {
  const files = templates(VIEWS);
  const perFile = {};
  let handWritten = 0;
  let macroCalls = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const hand = (source.match(HAND_WRITTEN) || []).length;
    macroCalls += (source.match(MACRO_CALL) || []).length;
    if (hand) {
      perFile[path.relative(VIEWS, file).split(path.sep).join('/')] = hand;
      handWritten += hand;
    }
  }

  return { files, perFile, handWritten, macroCalls };
}

describe('govuk-tag macro adoption', () => {
  it(`keeps hand-written tags at or below the recorded ceiling of ${CEILING}`, () => {
    const { perFile, handWritten } = scan();

    const worst = Object.entries(perFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f, n]) => `${n} in ${f}`)
      .join(', ');

    if (handWritten > CEILING) {
      throw new Error(
        `Hand-written govuk-tag markup rose to ${handWritten} (ceiling ${CEILING}).\n`
        + 'Use the official component instead of writing the markup by hand:\n'
        + '  {% from "govuk/components/tag/macro.njk" import govukTag %}\n'
        + '  {{ govukTag({ text: t("some.key"), classes: "govuk-tag--green" }) }}\n'
        + `Worst files: ${worst}`
      );
    }

    // Enforced downward too: a genuine conversion must lower CEILING in the same
    // commit, so this can never quietly drift into a meaningless cap.
    expect(handWritten).toBe(CEILING);
  });

  it('cannot pass vacuously, and proves the macro is the established convention', () => {
    const { files, macroCalls } = scan();

    // A broken path or a changed extension would otherwise make the count zero and
    // the ceiling trivially satisfied.
    expect(files.length).toBeGreaterThan(300);
    // The migration left 321 call sites. If this collapses, the convention has been
    // reverted wholesale rather than a single tag slipping through.
    expect(macroCalls).toBeGreaterThan(300);
  });
});
