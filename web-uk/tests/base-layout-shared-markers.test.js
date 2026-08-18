// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// layouts/base.njk renders two hidden marker elements that page JavaScript
// depends on: the session-timeout block (public/js/timeout-warning.js finds it
// by [data-authenticated="true"]) and #character-count-translations (read by
// public/js/init.js so the GOV.UK character count speaks the member's language).
//
// Both used to live INSIDE {% block content %}. Overriding a Nunjucks block
// replaces its entire body, and 110 templates override `content` rather than
// `mainContent` — so all 110 dropped both markers. Nothing looked wrong: the
// pages rendered fine, no test failed, and the only symptom was that signed-in
// members got no session-timeout warning there, and character counts on those
// pages counted in English whatever language the member had chosen.
//
// These tests pin the arrangement that makes the choice of block name harmless.

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const VIEWS_DIRECTORY = path.join(__dirname, '..', 'src', 'views');
const BASE_LAYOUT = path.join(VIEWS_DIRECTORY, 'layouts', 'base.njk');

function renderThroughChildLayout(childTemplate, context) {
  const environment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
      VIEWS_DIRECTORY,
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]),
    { autoescape: true }
  );

  // Only the filters/globals the base layout itself needs.
  environment.addFilter('date', (value) => String(value));
  environment.addGlobal('t', (key) => key);
  environment.addGlobal('tc', (key) => key);
  environment.addGlobal('urlFor', (value) => value);
  environment.addGlobal('formatLocaleDate', (value) => String(value));

  return environment.renderString(childTemplate, context);
}

const SIGNED_IN_CONTEXT = {
  isAuthenticated: true,
  csrfToken: 'test-csrf',
  sessionTimeout: 30,
  t: (key) => key,
  urlFor: (value) => value,
  shellPhase: 'Beta',
  shellFeedback: 'feedback',
  feedbackUrl: '/contact'
};

describe('base layout shared markers', () => {
  it('keeps both markers outside the overridable content block', () => {
    // Nunjucks comments are stripped first: the explanatory comment above the
    // markers quotes "{% block content %}", and matching that instead of the
    // real tag would make this assertion measure the wrong position.
    const source = fs.readFileSync(BASE_LAYOUT, 'utf8').replace(/\{#[\s\S]*?#\}/g, '');

    const contentBlockIndex = source.indexOf('{% block content %}');
    const timeoutMarkerIndex = source.indexOf('data-authenticated="true"');
    const characterCountIndex = source.indexOf('id="character-count-translations"');

    expect(contentBlockIndex).toBeGreaterThan(-1);
    expect(timeoutMarkerIndex).toBeGreaterThan(-1);
    expect(characterCountIndex).toBeGreaterThan(-1);

    // Both must be declared BEFORE the content block opens, so a child that
    // overrides `content` cannot replace them.
    expect(timeoutMarkerIndex).toBeLessThan(contentBlockIndex);
    expect(characterCountIndex).toBeLessThan(contentBlockIndex);
  });

  it('renders both markers for a page that overrides content', () => {
    const html = renderThroughChildLayout(
      '{% extends "layouts/base.njk" %}{% block content %}<p>page body</p>{% endblock %}',
      SIGNED_IN_CONTEXT
    );

    expect(html).toContain('page body');
    expect(html).toContain('data-authenticated="true"');
    expect(html).toContain('id="character-count-translations"');
  });

  it('renders both markers for a page that overrides mainContent', () => {
    const html = renderThroughChildLayout(
      '{% extends "layouts/base.njk" %}{% block mainContent %}<p>page body</p>{% endblock %}',
      SIGNED_IN_CONTEXT
    );

    expect(html).toContain('page body');
    expect(html).toContain('data-authenticated="true"');
    expect(html).toContain('id="character-count-translations"');
  });

  it('omits only the session marker when signed out, keeping character counts localised', () => {
    const html = renderThroughChildLayout(
      '{% extends "layouts/base.njk" %}{% block content %}<p>page body</p>{% endblock %}',
      { ...SIGNED_IN_CONTEXT, isAuthenticated: false }
    );

    expect(html).not.toContain('data-authenticated="true"');
    expect(html).toContain('id="character-count-translations"');
  });
});
