// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

/**
 * The review star rating used `flex-direction: row-reverse` so a CSS
 * general-sibling selector could fill "earlier" stars. Radio-group arrow keys
 * follow DOM order, so in that layout Right Arrow moved focus visually LEFT —
 * a WCAG 1.3.2 / 2.4.3 failure that the correct-looking fill hid completely.
 *
 * The fix keeps DOM order = visual order and does the cumulative fill with
 * :has(). This pins the compiled CSS, so a Sass refactor that quietly
 * reintroduces the reversed row fails here.
 */
describe('star rating keyboard order (compiled CSS contract)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.css'), 'utf8');

  it('never reverses the star row', () => {
    expect(css).not.toContain('row-reverse');
  });

  it('keeps the :has() cumulative fill for all five stars', () => {
    for (let star = 1; star <= 5; star += 1) {
      expect(css).toContain(
        `.app-star-rating:has(.app-star-rating__input[value="${star}"]:checked)`
      );
    }
    // The checked star itself fills without :has() support too.
    expect(css).toMatch(/\.app-star-rating__input:checked \+ \.app-star-rating__label \.app-star-rating__star/);
  });
});
