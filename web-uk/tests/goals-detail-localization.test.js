// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { createTranslator, SUPPORTED_LOCALES } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([viewsDirectory, govukViewsDirectory], { noCache: true }),
  { autoescape: true }
);

const requiredKeys = [
  'states.success_title',
  'states.error_title',
  'goals.caption',
  'goals.status_active',
  'goals.status_completed',
  'goals.progress_label',
  'goals.back_to_goals',
  'goals.edit_goal',
  'goals.update_title',
  'goals.increment_label',
  'goals.increment_button',
  'goals.mark_complete',
  'goals.buddy_section_title',
  'goals.buddy_has_buddy',
  'goals.buddy_you_are_buddy',
  'goals.become_buddy_title',
  'goals.become_buddy_intro',
  'goals.become_buddy_button',
  'goals.buddy_notes_title',
  'goals.a_member',
  'goals.history_title',
  'goals.history_empty',
  'goals.history_type_created',
  'goals.history_type_progress_update',
  'goals.history_type_checkin',
  'goals.history_type_milestone',
  'goals.history_type_buddy_joined',
  'goals.history_type_buddy_action',
  'goals.history_type_completed',
  'govuk_alpha_goals.nav.insights',
  'govuk_alpha_goals.nav.social',
  'govuk_alpha_goals.nav.history'
];

function baseLocals(locale) {
  return {
    alphaFooterColumns: [],
    alphaLanguageQueryParams: [],
    alphaLocaleOptions: [],
    alphaNavItems: [],
    buddyNotes: [],
    canBecomeBuddy: false,
    csrfToken: 'csrf-token',
    currentPath: '/goals/42',
    currentUrl: '/goals/42',
    errorHref: '',
    errorStateKey: '',
    goal: {
      currentText: '3',
      description: 'Member-authored goal description',
      done: false,
      id: 42,
      progressPercent: 50,
      targetText: '6',
      title: 'Member-authored goal title'
    },
    goalHistory: [],
    hasBuddy: false,
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    htmlLang: locale,
    isAuthenticated: true,
    isBuddy: false,
    isOwner: true,
    serviceName: 'Project NEXUS',
    successStateKey: 'goals.states.goal-edited',
    t: createTranslator(locale),
    tenantName: 'Test Community',
    title: 'Member-authored goal title',
    urlFor: (pathname) => pathname
  };
}

describe('Laravel-first goal detail localization', () => {
  it.each(SUPPORTED_LOCALES)('resolves every literal detail key in %s', (locale) => {
    const t = createTranslator(locale);
    for (const key of requiredKeys) {
      expect(t(key)).not.toBe(key);
    }
  });

  it('delegates fixed goal-detail chrome to exact Laravel keys', () => {
    const source = fs.readFileSync(path.join(viewsDirectory, 'goals', 'detail.njk'), 'utf8');
    for (const key of requiredKeys.filter((key) => !key.startsWith('goals.history_type_'))) {
      expect(source).toContain(`t(\"${key}\"`);
    }
    expect(source).toContain('t("goals.history_type_" + event.type)');
    expect(source).toContain('{{ goal.title }}');
    expect(source).toContain('{{ goal.description }}');
  });

  it.each([
    ['ga', 'ltr'],
    ['ar', 'rtl']
  ])('renders the detail workflow through the %s translator', (locale, direction) => {
    const t = createTranslator(locale);
    const html = templateEnvironment.render('goals/detail.njk', baseLocals(locale));

    expect(html).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
    expect(html).toContain(t('goals.back_to_goals'));
    expect(html).toContain(t('goals.states.goal-edited'));
    expect(html).toContain(t('goals.status_active'));
    expect(html).toContain(t('goals.progress_label', { current: '3', target: '6' }));
    expect(html).toContain(t('goals.edit_goal'));
    expect(html).toContain(t('goals.update_title'));
    expect(html).toContain(t('goals.history_empty'));
    expect(html).toContain('Member-authored goal title');
    expect(html).toContain('Member-authored goal description');
  });
});
