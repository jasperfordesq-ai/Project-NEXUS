// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

/**
 * A back link belongs in `{% block beforeContent %}`, above `<main>`.
 *
 * The skip link targets `#main-content`. When a page declares its back link
 * inside `content`/`mainContent`, the first thing a keyboard user reaches after
 * skipping is "Back" — and the link becomes part of the main landmark, which it
 * is not. 61 of 215 templates had drifted this way while 154 were already
 * correct, so this is drift rather than a house style.
 *
 * `beforeContent` in layouts/base.njk is a genuinely empty slot (documented at
 * base.njk:215-227) and needs no `{{ super() }}` — the phase banner sits
 * outside it on purpose, so a page cannot delete the banner by filling it.
 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.njk')) out.push(full);
  }
  return out;
}

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const stripComments = (src) => src.replace(/\{#[\s\S]*?#\}/g, '');

describe('back links sit above <main>, not inside it', () => {
  const templates = walk(viewsDir).filter((f) => fs.readFileSync(f, 'utf8').includes('govuk-back-link'));

  it('covers the real set of back-link templates', () => {
    // Guards against a regex change silently reducing this to nothing.
    expect(templates.length).toBeGreaterThan(180);
  });

  it('declares every back link before the content block', () => {
    const offenders = [];
    for (const file of templates) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const back = src.search(/<a\b[^>]*class="[^"]*govuk-back-link/);
      // Macro-based back links (govukBackLink) are equally valid.
      const macro = src.search(/govukBackLink\s*\(/);
      const first = [back, macro].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      if (first === undefined) continue;

      const decl = src.search(/\{%\s*block\s+(mainContent|content)\s*%\}/);
      if (decl < 0) continue; // partial/include, no content block of its own
      if (first > decl) offenders.push(path.relative(viewsDir, file));
    }
    expect(offenders).toEqual([]);
  });
});
