// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK: the error summary goes at the top of the main container and a
 * notification banner immediately before the <h1>. About a hundred templates had
 * them just below the heading until 29 Oct 2026 (scripts/summary-before-heading.js).
 */

const path = require('path');
const { moveSummaries, pending } = require('../scripts/summary-before-heading');

describe('message boxes come before the page heading', () => {
  it('no template has an error summary or banner directly below its heading', () => {
    const rel = pending().map((file) => path.relative(path.join(__dirname, '..', 'src', 'views'), file));
    expect(rel).toEqual([]);
  });

  it('moves a summary from below the heading to above the caption', () => {
    const before = [
      '  <span class="govuk-caption-xl">Caption</span>',
      '  <h1 class="govuk-heading-xl">Title</h1>',
      '  <p class="govuk-body-l">Lede</p>',
      '  {% if loadError %}',
      '    <div class="govuk-error-summary" data-module="govuk-error-summary"></div>',
      '  {% endif %}',
      '  <p class="govuk-body">Body</p>'
    ].join('\n');
    const after = moveSummaries(before).split('\n');
    expect(after[0]).toBe('  {% if loadError %}');
    expect(after.indexOf('  <h1 class="govuk-heading-xl">Title</h1>')).toBeGreaterThan(after.indexOf('  {% endif %}'));
  });

  it('leaves a summary that belongs to a form further down', () => {
    const text = [
      '  <h1 class="govuk-heading-xl">Title</h1>',
      '  <p class="govuk-body">Some content first</p>',
      '  {% if errors %}<div class="govuk-error-summary"></div>{% endif %}',
      '  <form method="post"></form>'
    ].join('\n');
    expect(moveSummaries(text)).toBeNull();
  });

  it('does not move a block that also holds the form', () => {
    const text = [
      '  <h1 class="govuk-heading-xl">Title</h1>',
      '  {% if errors %}',
      '    <div class="govuk-error-summary"></div>',
      '    <form method="post"></form>',
      '  {% endif %}'
    ].join('\n');
    expect(moveSummaries(text)).toBeNull();
  });
});
