// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// src/lib/nl2br.js HTML-escapes its input and THEN inserts <br>. It is
// therefore the escaping step, and its output must be emitted with `| safe`.
//
// Both halves of that pairing matter, in opposite directions:
//
//   nl2br without | safe → Nunjucks escapes the already-escaped output again,
//   so the member reads a literal "<br>" between every line and "&amp;" for
//   every ampersand. This shipped on the main listing detail page — the one
//   call site of 33 that had lost its `| safe`.
//
//   | safe without nl2br on member-entered text → raw HTML reaches the page.
//   That direction is the security one, which is why this test pins the pairing
//   rather than just adding the missing filter.

const fs = require('fs');
const path = require('path');

const VIEWS_DIRECTORY = path.join(__dirname, '..', 'src', 'views');

function nunjucksFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return nunjucksFilesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

describe('nl2br / safe pairing', () => {
  it('emits every nl2br result with | safe', () => {
    const violations = [];
    let callSites = 0;

    for (const templatePath of nunjucksFilesUnder(VIEWS_DIRECTORY)) {
      const source = fs.readFileSync(templatePath, 'utf8');

      // Each {{ ... }} output expression that pipes through nl2br.
      for (const match of source.matchAll(/\{\{([^}]*\|\s*nl2br[^}]*)\}\}/g)) {
        callSites += 1;
        const expression = match[1];

        // `safe` must come after nl2br in the pipe chain.
        const afterNl2br = expression.slice(expression.indexOf('nl2br') + 'nl2br'.length);
        if (!/\|\s*safe\b/.test(afterNl2br)) {
          violations.push(
            `${path.relative(VIEWS_DIRECTORY, templatePath)}:${lineNumberAt(source, match.index)}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
    // Guards against the matcher silently finding nothing.
    expect(callSites).toBeGreaterThan(20);
  });

  it('escapes markup before inserting line breaks', () => {
    const { nl2br } = require('../src/lib/nl2br');

    // A member typing a tag must see it as text, never have it rendered.
    expect(nl2br('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    // A real newline still becomes a real break.
    expect(nl2br('one\ntwo')).toBe('one<br>two');
    // A member typing "<br>" gets the text, not a break.
    expect(nl2br('a<br>b')).toBe('a&lt;br&gt;b');
  });
});
