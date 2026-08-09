// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([viewsDirectory, govukViewsDirectory], { noCache: true }),
  { autoescape: true }
);

templateEnvironment.addFilter('nl2br', (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')
  .replace(/\n/g, '<br>'));

function templateSource(name) {
  return fs.readFileSync(path.join(viewsDirectory, name), 'utf8');
}

function baseLocals(locale, extra = {}) {
  return {
    alphaFooterColumns: [],
    alphaLanguageQueryParams: [],
    alphaLocaleOptions: [],
    alphaNavItems: [],
    currentPath: '/jobs',
    currentUrl: '/jobs',
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    htmlLang: locale,
    isAuthenticated: true,
    serviceName: 'Project NEXUS',
    t: createTranslator(locale),
    tenantName: 'Test Community',
    title: 'Jobs',
    urlFor: (pathname) => pathname,
    ...extra
  };
}

describe('Laravel-first Jobs template localization', () => {
  it('delegates the application-history heading and empty state to exact Laravel keys', () => {
    const source = templateSource('jobs/application-history.njk');

    expect(source).toContain('t("govuk_alpha_jobs.history.back_link")');
    expect(source).toContain('<h1 class="govuk-heading-xl">{{ t("govuk_alpha_jobs.history.title") }}</h1>');
    expect(source).toContain('t("govuk_alpha_jobs.history.empty")');
    expect(source).toContain('{{ vacancyTitle or tenantName }}');
    expect(source).not.toContain('>Back to my applications<');
    expect(source).not.toContain('>Application timeline<');
    expect(source).not.toContain('>There are no status updates for this application yet.<');
  });

  it('localizes talent-profile chrome while preserving candidate-authored fields', () => {
    const source = templateSource('jobs/talent-profile.njk');

    for (const translationKey of [
      'govuk_alpha_jobs.talent.title',
      'govuk_alpha_jobs.talent.headline_none',
      'govuk_alpha_jobs.talent.last_active',
      'govuk_alpha_jobs.talent.member_since',
      'govuk_alpha_jobs.talent.skills_heading',
      'govuk_alpha_jobs.talent.no_skills',
      'govuk_alpha_jobs.talent.summary_heading',
      'govuk_alpha_jobs.talent.about_heading'
    ]) {
      expect(source).toContain(`t("${translationKey}"`);
    }

    expect(source).toContain('<h1 class="govuk-heading-xl govuk-!-margin-bottom-1">{{ candidate.name }}</h1>');
    expect(source).not.toContain('govuk-visually-hidden');
    expect(source).not.toContain('t("candidate.name")');
    expect(source).toContain('{{ candidate.summary | nl2br | safe }}');
    expect(source).toContain('{{ candidate.bio | nl2br | safe }}');
  });

  it('delegates high-impact table and score labels to Laravel keys', () => {
    const biasAudit = templateSource('jobs/bias-audit.njk');
    const qualification = templateSource('jobs/qualification.njk');

    for (const translationKey of [
      'govuk_alpha_jobs.bias_audit.funnel_caption',
      'govuk_alpha_jobs.bias_audit.rejection_rates_caption',
      'govuk_alpha_jobs.bias_audit.time_in_stage_caption',
      'govuk_alpha_jobs.bias_audit.skills_match_caption',
      'govuk_alpha_jobs.bias_audit.source_effectiveness_caption'
    ]) {
      expect(biasAudit).toContain(`govuk-table__caption--s">{{ t("${translationKey}") }}`);
    }

    expect(qualification).toContain(
      '<progress value="{{ dimension.score }}" max="100" aria-label="{{ t(\'govuk_alpha_jobs.qualification.score_aria\', { dimension: dimension.label }) }}">'
    );
  });

  it('renders the exact localized Jobs detail error and chrome supplied by the route', () => {
    const source = templateSource('jobs/detail.njk');

    expect(source).toContain('{% if errorMessage %}');
    expect(source).toContain('<a href="#cv">{{ errorMessage }}</a>');
    expect(source).toContain('{% else %}{{ errorMessage }}{% endif %}');
    expect(source).not.toContain('We could not complete that jobs action. Please try again.');

    for (const translationKey of [
      'jobs_t2.unsave_button',
      'jobs.location_label',
      'jobs.about_label',
      'jobs.skills_label',
      'jobs.apply_title',
      'jobs.already_applied',
      'jobs.cv_label',
      'jobs.cv_hint',
      'jobs.apply_button'
    ]) {
      expect(source).toContain(`t("${translationKey}")`);
    }
  });

  it('delegates the complete interview and offer response surface to Laravel keys', () => {
    const source = templateSource('jobs/responses.njk');

    for (const translationKey of [
      'caption',
      'title',
      'description',
      'interviews_heading',
      'no_interviews',
      'for_opportunity',
      'scheduled_for',
      'no_date',
      'duration',
      'location_label',
      'add_to_calendar',
      'note_label',
      'note_hint',
      'accept_interview',
      'decline_interview',
      'offers_heading',
      'no_offers',
      'start_date',
      'expires_on',
      'message_heading',
      'accept_offer_warning',
      'accept_offer',
      'reject_offer'
    ]) {
      expect(source).toContain(`govuk_alpha_jobs.responses.${translationKey}`);
    }

    expect(source).toContain('t(interview.statusKey)');
    expect(source).toContain('t(offer.statusKey)');
    expect(source).not.toContain('>Interviews and offers<');
    expect(source).not.toContain('>Accept interview<');
    expect(source).not.toContain('>Accept offer<');
    expect(source).not.toContain('>Decline offer<');
  });

  it.each([
    ['ga', 'ltr'],
    ['ar', 'rtl']
  ])('renders application history through the %s request translator', (locale, direction) => {
    const t = createTranslator(locale);
    const html = templateEnvironment.render('jobs/application-history.njk', baseLocals(locale, {
      applicationId: 42,
      history: []
    }));

    expect(html).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
    expect(html).toContain(t('govuk_alpha_jobs.history.back_link'));
    expect(html).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha_jobs.history.title')}</h1>`);
    expect(html).toContain(t('govuk_alpha_jobs.history.empty'));
  });

  it.each([
    ['ga', 'ltr'],
    ['ar', 'rtl']
  ])('renders talent profile labels in %s while escaping candidate content', (locale, direction) => {
    const t = createTranslator(locale);
    const html = templateEnvironment.render('jobs/talent-profile.njk', baseLocals(locale, {
      candidate: {
        avatarUrl: '',
        bio: 'Community organiser <script>alert(1)</script>',
        headline: 'Mentor & organiser',
        initial: 'A',
        lastActiveLabel: '10 Jul 2026',
        location: 'Cork & Kerry',
        memberSinceLabel: '2024',
        name: 'Amina <Candidate>',
        skills: ['Mentoring & care'],
        summary: 'Available weekly'
      }
    }));

    expect(html).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
    expect(html).toContain(t('govuk_alpha_jobs.talent.skills_heading'));
    expect(html).toContain(t('govuk_alpha_jobs.talent.about_heading'));
    expect(html).toContain(t('govuk_alpha_jobs.talent.member_since', { date: '2024' }));
    expect(html).toContain('Amina &lt;Candidate&gt;');
    expect(html).toContain('Mentoring &amp; care');
    expect(html).toContain('Community organiser &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
