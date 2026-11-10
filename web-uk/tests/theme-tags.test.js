// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (Nov 2026): "clear categories, attractive visuals". Each
 * offer's theme shows as a GOV.UK tag, coloured only from the official tag set,
 * by the same rule as the React site (react-frontend/src/lib/categoryColours.ts
 * themeColourNames): while every theme has the same stored colour (the database
 * default, blue) they are coloured in turn; once an admin gives themes different
 * colours, each shows its own.
 */

const fs = require('fs');
const path = require('path');
const { THEME_ROTATION, themeTagClasses, tagClassForColour } = require('../src/lib/theme-tags');

const OFFICIAL = new Set(['', 'govuk-tag--green', 'govuk-tag--purple', 'govuk-tag--red', 'govuk-tag--orange',
  'govuk-tag--teal', 'govuk-tag--magenta', 'govuk-tag--yellow', 'govuk-tag--grey']);

describe('theme tags', () => {
  it('only ever uses a colour from the official GOV.UK tag set (no deprecated ones)', () => {
    for (const colour of ['red', 'rose', 'orange', 'amber', 'yellow', 'green', 'emerald', 'teal', 'cyan', 'sky',
      'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'gray', 'slate', 'unknown', '', null]) {
      expect(OFFICIAL.has(tagClassForColour(colour))).toBe(true);
    }
    for (const name of THEME_ROTATION) expect(OFFICIAL.has(`govuk-tag--${name}`)).toBe(true);
  });

  it('keeps the rotation clear of the offer (blue) and request (purple) tags, red (urgent) and grey (inactive)', () => {
    for (const name of ['blue', 'purple', 'red', 'grey']) expect(THEME_ROTATION).not.toContain(name);
  });

  it('colours themes in turn while they all share one stored colour', () => {
    const classes = themeTagClasses([
      { id: 1, color: 'blue' }, { id: 2, color: 'blue' }, { id: 3, color: 'blue' },
      { id: 4, color: 'blue' }, { id: 5, color: 'blue' }, { id: 6, color: 'blue' }
    ]);
    expect(classes.get(1)).toBe(`govuk-tag--${THEME_ROTATION[0]}`);
    expect(classes.get(2)).toBe(`govuk-tag--${THEME_ROTATION[1]}`);
    expect(classes.get(6)).toBe(`govuk-tag--${THEME_ROTATION[5 % THEME_ROTATION.length]}`);
  });

  it('shows the colour an admin chose once themes differ', () => {
    const classes = themeTagClasses([{ id: 1, color: 'red' }, { id: 2, color: 'emerald' }, { id: 3, color: 'blue' },
      { id: 4, color: 'mauve' }]);
    expect(classes.get(1)).toBe('govuk-tag--red');
    expect(classes.get(2)).toBe('govuk-tag--green');
    expect(classes.get(3)).toBe('');
    expect(classes.get(4)).toBe('govuk-tag--grey');
  });

  it('renders an escaped, labelled theme tag on the offers list', () => {
    const nunjucks = require('nunjucks');
    const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([
      path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]), { autoescape: true });
    require('../src/lib/template-filters').registerTemplateFilters(env);
    const html = env.render('listings/index.njk', {
      t: createTranslator('en'), tc: createChoiceTranslator('en'), urlFor: (value) => value,
      filters: { hours: 'any', service: 'any', posted: 'any', near: 'any' }, pagination: { total: 1 },
      listings: [{ id: 7, type: 'offer', title: 'Help', categoryName: 'Garden <b>& yard</b>', themeTagClass: 'govuk-tag--teal' }]
    });
    expect(html.replace(/\s+/g, ' ')).toContain('<strong class="govuk-tag govuk-tag--teal nexus-alpha-theme-tag"> <span class="govuk-visually-hidden">Category: </span>Garden &lt;b&gt;&amp; yard&lt;/b&gt; </strong>');
  });

  it('renders the theme as a tag on the offers list', () => {
    const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'listings', 'index.njk'), 'utf8');
    expect(view).toContain('(listing.categoryName | escape), classes: (listing.themeTagClass ~ " nexus-alpha-theme-tag") | trim })');
    // Shown once: the tag replaced the plain "Category" line.
    expect(view).not.toContain('<dt>{{ t("listings.category") }}</dt>');
  });
});
