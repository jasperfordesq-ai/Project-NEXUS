// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two different refusals must not read the same (2026-08-25).
 *
 * Found by opening /courses in a community that has not switched courses on.
 * The page said:
 *
 *     You do not have permission to view this page
 *     This page is not available to your account. If you think this is wrong,
 *     contact your community organisers.
 *
 * Both sentences are false in that situation. Nothing is wrong with the member's
 * account — their community simply has not enabled the module — and the advice
 * sends them to ask organisers about a non-problem.
 *
 * The gate already knew the difference: it passed
 * `message: 'This feature is not enabled for this community.'` alongside the
 * render. Except the template never rendered `message`, and the string was a
 * hardcoded English literal that would have been English in all eleven
 * languages had it ever been shown.
 *
 * Both replacement strings already existed and were already translated:
 * `states.not_available` and `home.module_unavailable_hint`.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { tenantFeatureGate } = require('../src/middleware/tenant-feature-gates');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

function render(locals = {}, locale = 'en') {
  return env.render('errors/403.njk', {
    t: createTranslator(locale),
    tc: createChoiceTranslator(locale),
    urlFor: (p) => p,
    serviceName: 'Project NEXUS Accessible',
    tenantName: 'Acme Timebank',
    htmlLang: locale,
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    alphaNavItems: [],
    alphaFooterColumns: [],
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    ...locals
  });
}

function visibleText(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(html);
  return (main ? main[0] : html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a module the community has not enabled', () => {
  it('says it is not available here, not that the member lacks permission', () => {
    const text = visibleText(render({ reason: 'feature-disabled' }));

    expect(text).toContain('Not available');
    expect(text).toContain('This module is not enabled for this community.');
    // The account-permission wording must be gone entirely.
    expect(text).not.toContain('You do not have permission');
    expect(text).not.toContain('not available to your account');
    expect(text).not.toContain('contact your community organisers');
  });

  it('says it in the reader\'s own language', () => {
    const english = visibleText(render({ reason: 'feature-disabled' }, 'en'));
    const irish = visibleText(render({ reason: 'feature-disabled' }, 'ga'));

    // 🔴 The message the gate used to pass was an English literal.
    expect(irish).not.toBe(english);
    expect(irish).not.toContain('This module is not enabled');
  });

  it('titles the browser tab to match the page', () => {
    const html = render({ reason: 'feature-disabled' });
    const title = (/<title>([\s\S]*?)<\/title>/.exec(html) || [, ''])[1];

    expect(title).toContain('Not available');
    expect(title).not.toContain('You do not have permission');
  });
});

describe('a genuine permission refusal is unchanged', () => {
  it('still tells an ordinary member that an admin-only page is not theirs', () => {
    // /ideation/new is admin-only. That refusal is about the ACCOUNT, and the
    // original wording is correct for it.
    const text = visibleText(render({}));

    expect(text).toContain('You do not have permission to view this page');
    expect(text).toContain('contact your community organisers');
    expect(text).not.toContain('This module is not enabled');
  });

  it('is not switched by an unrelated reason value', () => {
    const text = visibleText(render({ reason: 'something-else' }));

    expect(text).toContain('You do not have permission to view this page');
  });
});

describe('the gate passes a reason, never a sentence', () => {
  function runGate(pathname, tenant) {
    let rendered = null;
    const res = {
      status() { return this; },
      render(view, locals) { rendered = { view, locals }; },
      locals: { t: createTranslator('en') }
    };
    tenantFeatureGate({ path: pathname, method: 'GET', accessibleRouting: { tenant } }, res, () => {
      rendered = { view: null, locals: null };
    });
    return rendered;
  }

  it('refuses a disabled FEATURE with reason: feature-disabled', () => {
    // `courses` defaults off, matching TenantFeatureConfig::FEATURE_DEFAULTS.
    const out = runGate('/courses', { id: 2, features: {}, modules: {} });

    expect(out.view).toBe('errors/403');
    expect(out.locals.reason).toBe('feature-disabled');
    // 🔴 Never an English sentence: the template owns the wording.
    expect(out.locals.message).toBeUndefined();
  });

  it('refuses a disabled MODULE with the same reason', () => {
    const out = runGate('/wallet', { id: 2, features: {}, modules: { wallet: false } });

    expect(out.view).toBe('errors/403');
    expect(out.locals.reason).toBe('feature-disabled');
    expect(out.locals.message).toBeUndefined();
  });

  it('lets an enabled module through untouched', () => {
    const out = runGate('/wallet', { id: 2, features: {}, modules: { wallet: true } });

    expect(out.view).toBeNull();
  });
});
