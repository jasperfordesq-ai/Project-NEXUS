// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const { getHelpFaqs } = require('../lib/api');
const { catalogFor, valueInCatalog } = require('../lib/localization');
const { asyncRoute } = require('../lib/routeHelpers');
const { sanitizeCmsHtml } = require('../lib/html-sanitizer');

const router = express.Router();

const TRUST_SAFETY_SECTION_KEYS = Object.freeze([
  'how_exchanges', 'what_we_do', 'what_we_dont', 'precautions',
  'vetting', 'insurance', 'disputes', 'responsibilities', 'rights'
]);

function trimmed(value) {
  return String(value || '').trim();
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function communityName(res) {
  const tenant = res.locals.tenant || {};
  return trimmed(tenant.name) || trimmed(tenant.slug) || 'Project NEXUS Accessible';
}

function normalizeFaqGroups(result, t) {
  return rowsFrom(result)
    .map((group) => {
      const row = group && typeof group === 'object' ? group : {};
      const faqs = Array.isArray(row.faqs) ? row.faqs : [];

      return {
        category: trimmed(row.category) || t('help.category_label'),
        faqs: faqs
          .map((faq) => ({
            id: faq && faq.id,
            question: trimmed(faq && faq.question),
            answer: sanitizeCmsHtml(faq && faq.answer)
          }))
          .filter((faq) => faq.question || faq.answer)
      };
    })
    .filter((group) => group.faqs.length > 0);
}

function trustSafetySections(res) {
  const catalog = catalogFor(res.locals.locale);
  return TRUST_SAFETY_SECTION_KEYS.map((key) => {
    const base = `trust_safety.sections.${key}`;
    const items = valueInCatalog(catalog, `${base}.items`);
    return {
      heading: res.locals.t(`${base}.heading`),
      intro: res.locals.t(`${base}.intro`),
      items: Array.isArray(items) ? items : []
    };
  });
}

router.get('/help', asyncRoute(async (req, res) => {
  const searchQuery = trimmed(req.query.q);
  const params = searchQuery ? { q: searchQuery } : {};
  const faqGroups = normalizeFaqGroups(await getHelpFaqs(params), res.locals.t);
  const community = communityName(res);

  return res.render('support/help', {
    title: res.locals.t('help.title'),
    activeNav: 'help',
    communityName: community,
    searchQuery,
    faqGroups
  });
}));

router.get('/trust-and-safety', (req, res) => {
  const community = communityName(res);

  return res.render('support/trust-safety', {
    title: res.locals.t('trust_safety.title'),
    activeNav: 'trust-safety',
    communityName: community,
    sections: trustSafetySections(res)
  });
});

module.exports = router;
