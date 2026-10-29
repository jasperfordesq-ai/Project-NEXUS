// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "Error: " title prefix for a validation outcome now comes from the layout
 * itself (29 Oct 2026). Until then only three routes passed `pageHasErrors` for a
 * `?status=x-invalid` redirect, so every other form that redirects with an
 * "-invalid" status rendered its error summary under an unprefixed title. `status`,
 * `statusBanner` and `statusMessage` are route locals, so the layout can see them.
 */

const path = require('path');
const nunjucks = require('nunjucks');
const { createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function titleFor(locals) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
  registerTemplateFilters(env);
  const html = env.renderString('{% extends "layouts/base.njk" %}{% block content %}<p>x</p>{% endblock %}', {
    title: 'Edit staff',
    serviceName: 'Project NEXUS',
    t: createTranslator('en'),
    urlFor: (value) => String(value || '/'),
    alphaNavItems: [],
    alphaFooterColumns: [],
    ...locals
  });
  return html.match(/<title[^>]*>([^<]*)<\/title>/)[1].trim();
}

describe('the layout prefixes the title for a validation outcome', () => {
  it.each([
    [{ status: 'staff-invalid' }],
    [{ status: 'invalid' }],
    [{ statusBanner: { status: 'announcement-invalid', type: 'error' } }],
    [{ statusMessage: { status: 'comment-invalid', type: 'error' } }]
  ])('prefixes for %j', (locals) => {
    expect(titleFor(locals).startsWith('Error:')).toBe(true);
  });

  it.each([
    [{}],
    [{ status: 'save-failed' }],
    [{ status: 'auth-required' }],
    [{ status: 'saved' }],
    [{ statusBanner: { status: 'announcement-failed', type: 'error' } }],
    [{ status: { type: 'success' } }]
  ])('does not prefix for %j', (locals) => {
    expect(titleFor(locals).startsWith('Error:')).toBe(false);
  });
});
