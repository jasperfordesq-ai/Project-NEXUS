// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Timebank Ireland's four content pages, ported from React
 * (react-frontend/src/pages/about/SocialPrescribingPage.tsx, ImpactSummaryPage.tsx,
 * ImpactReportPage.tsx, StrategicPlanPage.tsx). Public, and served ONLY for the
 * hour-timebank community — see lib/tbi-pages.js for why every other community
 * falls through to the ordinary 404.
 *
 * Figures that React keeps in code (100%, 95%, 16:1, €16, €803K, the age bands)
 * are kept in code here too; figures React keeps in its translations (activity
 * counts, SROI amounts) come from govuk_alpha_tbi_pages like the rest of the text.
 * React's stat cards become GOV.UK summary lists and its demographic cards a table
 * with a caption, carrying exactly the same numbers.
 */

const express = require('express');

const { resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { breadcrumbJsonLdFor, pageDescription } = require('../lib/seo-meta');
const { isTbiTenant, relatedPages, requestTenant } = require('../lib/tbi-pages');

const router = express.Router();


// The same documents React links (resolveAssetUrl → the API's /uploads/ path).
const FULL_REPORT_PDF = '/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Final-Full-Report-May-23.pdf';
const EXEC_SUMMARY_PDF = '/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Executive-Summary-Design-Version-Final.pdf';
const STRATEGIC_PLAN_PDF = '/uploads/tenants/hour-timebank/Timebank-Ireland-Strategic-Plan-2026-2030.pdf';

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

/** The gate: anyone but hour-timebank falls through to the app's own 404. */
function tbiOnly(handler) {
  return (req, res, next) => {
    if (!isTbiTenant(requestTenant(req))) return next();
    return handler(req, res, next);
  };
}

function helpers(res) {
  const t = (key, replacements) => res.locals.t(key, replacements);
  const percent = (value) => res.locals.formatLocaleNumber(value, { style: 'percent', maximumFractionDigits: 0 });
  return { t, percent };
}

function pageLocals(req, res, { path, titleKey, descriptionKey, breadcrumbKey }) {
  const { t } = helpers(res);
  const title = t(titleKey);
  return {
    title,
    metaDescription: pageDescription(t(descriptionKey)),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, [
      { name: t(breadcrumbKey.about), path: '/about' },
      { name: t(breadcrumbKey.page || titleKey), path }
    ]),
    activeNav: 'about',
    breadcrumbAbout: t(breadcrumbKey.about),
    related: relatedPages(path, res.locals.t),
    relatedHeading: t('govuk_alpha_tbi_pages.related.heading')
  };
}

router.get('/social-prescribing', tbiOnly((req, res) => {
  const { t, percent } = helpers(res);
  const values = [percent(1), percent(0.95), '16:1'];

  res.render('tbi-pages/social-prescribing', {
    ...pageLocals(req, res, {
      path: '/social-prescribing',
      titleKey: 'govuk_alpha_tbi_pages.social_prescribing.page_title',
      descriptionKey: 'govuk_alpha_tbi_pages.social_prescribing.meta_description',
      breadcrumbKey: { about: 'govuk_alpha_tbi_pages.social_prescribing.breadcrumb_about' }
    }),
    outcomes: values.map((value, index) => ({
      value,
      label: t(`govuk_alpha_tbi_pages.social_prescribing.outcome_${index}_label`),
      description: t(`govuk_alpha_tbi_pages.social_prescribing.outcome_${index}_description`)
    })),
    strategicFit: range(5).map((index) => t(`govuk_alpha_tbi_pages.social_prescribing.strategic_fit_${index}`)),
    steps: range(4).map((index) => ({
      title: t(`govuk_alpha_tbi_pages.social_prescribing.referral_step_${index}_title`),
      description: t(`govuk_alpha_tbi_pages.social_prescribing.referral_step_${index}_description`)
    }))
  });
}));

router.get('/impact-summary', tbiOnly((req, res) => {
  const { t, percent } = helpers(res);

  res.render('tbi-pages/impact-summary', {
    ...pageLocals(req, res, {
      path: '/impact-summary',
      titleKey: 'govuk_alpha_tbi_pages.impact_summary.page_title',
      descriptionKey: 'govuk_alpha_tbi_pages.impact_summary.meta_description',
      breadcrumbKey: { about: 'govuk_alpha_tbi_pages.impact_summary.breadcrumb_about' }
    }),
    stats: [
      { value: '€16', label: t('govuk_alpha_tbi_pages.impact_summary.stat_return_label') },
      { value: percent(1), label: t('govuk_alpha_tbi_pages.impact_summary.stat_wellbeing_label') },
      { value: percent(0.95), label: t('govuk_alpha_tbi_pages.impact_summary.stat_connected_label') },
      { value: '€803K', label: t('govuk_alpha_tbi_pages.impact_summary.stat_value_label') }
    ],
    wellbeingFigures: [
      { value: percent(1), text: t('govuk_alpha_tbi_pages.impact_summary.wellbeing_100_text') },
      { value: percent(0.95), text: t('govuk_alpha_tbi_pages.impact_summary.wellbeing_95_text') }
    ]
  });
}));

router.get('/impact-report', tbiOnly((req, res) => {
  const { t, percent } = helpers(res);
  const tocIds = ['introduction', 'literature', 'activity', 'impact', 'sroi', 'discussion', 'recommendations'];
  // React: Critical, High, High, Medium, Medium, Medium (hardcoded English there).
  const priorities = ['critical', 'high', 'high', 'medium', 'medium', 'medium'];

  res.render('tbi-pages/impact-report', {
    ...pageLocals(req, res, {
      path: '/impact-report',
      titleKey: 'govuk_alpha_tbi_pages.impact_report.page_title',
      descriptionKey: 'govuk_alpha_tbi_pages.impact_report.meta_description',
      breadcrumbKey: { about: 'govuk_alpha_tbi_pages.impact_report.breadcrumb_about' }
    }),
    fullReportUrl: resolveBackendAssetUrl(FULL_REPORT_PDF),
    execSummaryUrl: resolveBackendAssetUrl(EXEC_SUMMARY_PDF),
    toc: tocIds.map((id) => ({ id, label: t(`govuk_alpha_tbi_pages.impact_report.toc_${id}`) })),
    sectionLabel: (number) => t('govuk_alpha_tbi_pages.impact_report.section_label', { number }),
    objectives: range(5).map((index) => t(`govuk_alpha_tbi_pages.impact_report.study_objective_${index}`)),
    literature: range(4).map((index) => ({
      title: t(`govuk_alpha_tbi_pages.impact_report.lit_review_${index}_title`),
      description: t(`govuk_alpha_tbi_pages.impact_report.lit_review_${index}_description`)
    })),
    activityRows: range(4).map((index) => ({
      metric: t(`govuk_alpha_tbi_pages.impact_report.activity_metric_${index}`),
      value: t(`govuk_alpha_tbi_pages.impact_report.activity_value_${index}`)
    })),
    ageBands: [
      ['18–34', 0.12],
      ['35–44', 0.18],
      ['45–64', 0.42],
      ['65+', 0.28]
    ].map(([band, share]) => ({ label: t('govuk_alpha_tbi_pages.age_band', { band }), value: percent(share) })),
    connectionFigure: percent(0.95),
    wellbeingFigure: percent(1),
    sroiRows: [
      ['sroi_total_investment', 'sroi_total_investment_value'],
      ['sroi_total_present_value', 'sroi_total_present_value_amount'],
      ['sroi_net_social_value', 'sroi_net_social_value_amount'],
      ['sroi_ratio_label', 'sroi_ratio_value']
    ].map(([label, value]) => ({ label: t(`govuk_alpha_tbi_pages.impact_report.${label}`), value: t(`govuk_alpha_tbi_pages.impact_report.${value}`) })),
    discussion: range(4).map((index) => ({
      title: t(`govuk_alpha_tbi_pages.impact_report.discussion_factor_${index}_title`),
      description: t(`govuk_alpha_tbi_pages.impact_report.discussion_factor_${index}_description`)
    })),
    recommendations: priorities.map((priority, index) => ({
      number: index + 1,
      text: t(`govuk_alpha_tbi_pages.impact_report.rec_${index}`),
      priority: t(`govuk_alpha_tbi_pages.priority.${priority}`),
      tag: priority === 'critical' ? 'govuk-tag--red' : (priority === 'high' ? 'govuk-tag--orange' : 'govuk-tag--blue')
    }))
  });
}));

router.get('/strategic-plan', tbiOnly((req, res) => {
  const { t } = helpers(res);
  const tocIds = ['executive-summary', 'vision-mission', 'swot', 'pillars', 'roadmap', 'risks'];
  // React's roadmap grid, row by row: Q1..Q4 badge type, or null for no activity.
  const roadmap = [
    ['submit', 'secure', null, null],
    ['pitch', 'launch', 'launch', 'launch'],
    [null, 'pitch', 'ongoing', 'ongoing'],
    [null, 'launch', 'ongoing', 'ongoing'],
    ['pitch', 'pitch', 'secure', null],
    ['ongoing', 'ongoing', 'ongoing', 'ongoing'],
    ['submit', 'secure', null, null],
    [null, null, null, 'launch']
  ];
  const badgeTag = {
    submit: 'govuk-tag--purple',
    secure: 'govuk-tag--green',
    launch: 'govuk-tag--blue',
    ongoing: 'govuk-tag--turquoise',
    pitch: 'govuk-tag--yellow'
  };
  const swot = ['strengths', 'weaknesses', 'opportunities', 'threats'];
  const pillar = (number) => ({
    label: t(`govuk_alpha_tbi_pages.strategic_plan.pillar_${number}_label`),
    title: t(`govuk_alpha_tbi_pages.strategic_plan.pillar_${number}_title`),
    caption: t(`govuk_alpha_tbi_pages.strategic_plan.aria.pillar_${number}_initiatives`),
    rows: range(6).map((index) => ({
      initiative: t(`govuk_alpha_tbi_pages.strategic_plan.pillar_${number}_row_${index}_initiative`),
      priority: t(`govuk_alpha_tbi_pages.strategic_plan.pillar_${number}_row_${index}_priority`),
      kpi: t(`govuk_alpha_tbi_pages.strategic_plan.pillar_${number}_row_${index}_kpi`)
    }))
  });

  res.render('tbi-pages/strategic-plan', {
    ...pageLocals(req, res, {
      path: '/strategic-plan',
      titleKey: 'govuk_alpha_tbi_pages.strategic_plan.page_title',
      descriptionKey: 'govuk_alpha_tbi_pages.strategic_plan.meta_description',
      breadcrumbKey: { about: 'govuk_alpha_tbi_pages.strategic_plan.breadcrumb_about', page: 'govuk_alpha_tbi_pages.strategic_plan.breadcrumb_plan' }
    }),
    planUrl: resolveBackendAssetUrl(STRATEGIC_PLAN_PDF),
    toc: tocIds.map((id) => ({ id, label: t(`govuk_alpha_tbi_pages.strategic_plan.toc_${id}`) })),
    sectionLabel: (number) => t('govuk_alpha_tbi_pages.strategic_plan.section_label', { number }),
    swot: swot.map((key) => ({
      title: t(`govuk_alpha_tbi_pages.strategic_plan.swot_${key}_title`),
      items: range(5).map((index) => t(`govuk_alpha_tbi_pages.strategic_plan.swot_${key}_${index}`))
    })),
    pillars: [pillar(1), pillar(2)],
    quarters: range(4).map((index) => t(`govuk_alpha_tbi_pages.strategic_plan.roadmap_q${index + 1}`)),
    roadmapRows: roadmap.map((cells, index) => ({
      activity: t(`govuk_alpha_tbi_pages.strategic_plan.roadmap_activity_${index}`),
      cells: cells.map((type) => (type ? { label: t(`govuk_alpha_tbi_pages.strategic_plan.badge_${type}`), tag: badgeTag[type] } : null))
    })),
    badgeLegend: ['submit', 'secure', 'launch', 'ongoing', 'pitch'].map((type) => ({
      label: t(`govuk_alpha_tbi_pages.strategic_plan.badge_${type}`),
      tag: badgeTag[type]
    })),
    risks: range(5).map((index) => ({
      name: t(`govuk_alpha_tbi_pages.strategic_plan.risk_${index}_name`),
      likelihood: t(`govuk_alpha_tbi_pages.strategic_plan.risk_${index}_likelihood`),
      impact: t(`govuk_alpha_tbi_pages.strategic_plan.risk_${index}_impact`),
      mitigation: t(`govuk_alpha_tbi_pages.strategic_plan.risk_${index}_mitigation`)
    }))
  });
}));

module.exports = router;
