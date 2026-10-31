// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const { getExchangeConfig, getHelpFaqs } = require('../lib/api');
const { catalogFor, valueInCatalog } = require('../lib/localization');
const { asyncRoute } = require('../lib/routeHelpers');
const { accessibleHelpLink } = require('../lib/help-guide-links');
const {
  AUDIENCES: HELP_AUDIENCES,
  articleText,
  audiencePath,
  centreText,
  gateContext,
  helpPath,
  isAudience,
  renderableBody,
  searchGuides,
  sectionText,
  visibleSections
} = require('../lib/help-guides');
const { sanitizeCmsHtml, htmlToPlainText } = require('../lib/html-sanitizer');
const { breadcrumbJsonLdFor, pageDescription } = require('../lib/seo-meta');

const { translateFields } = require('../lib/ugc-translation');
const router = express.Router();
function faqTranslationSpec(faq, category) {
  return { type: 'faq', id: Number(faq.id), fields: { question: faq.question, body: htmlToPlainText(faq.answer), category } };
}

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

// 🔴 `res.locals.tenantName` first, as legal.js does. The shell never sets
// `res.locals.tenant`, so /help and /trust-and-safety named every community
// "Project NEXUS Accessible" in their lead paragraph (and, since 23 Oct 2026, in
// their meta description).
function communityName(res) {
  const tenant = res.locals.tenant || {};
  return trimmed(res.locals.tenantName) || trimmed(tenant.name) || trimmed(tenant.slug) || 'Project NEXUS Accessible';
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

// ---------------------------------------------------------------------------
// Help Centre (built-in guides generated from React, plus the community's FAQs)
// ---------------------------------------------------------------------------

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function helpLocale(res) {
  return res.locals.locale || 'en';
}

function centreTranslator(res) {
  const locale = helpLocale(res);
  return (key, params) => centreText(locale, key, params);
}

/**
 * Community settings the guides depend on. React reads `exchange_workflow` from
 * GET /v2/exchanges/config for a signed-in member and treats it as unknown (so ON)
 * otherwise; the same here. A failure is "unknown", never a hidden guide.
 */
async function helpSettings(req) {
  const token = req.signedCookies && req.signedCookies.token;
  if (!token) return {};
  try {
    const config = dataFrom(await getExchangeConfig(token));
    return config && typeof config.exchange_workflow_enabled === 'boolean'
      ? { exchange_workflow: config.exchange_workflow_enabled }
      : {};
  } catch {
    return {};
  }
}

async function helpGateContext(req) {
  return gateContext(req.accessibleRouting && req.accessibleRouting.tenant, await helpSettings(req));
}

function audienceNav(ct, current) {
  return HELP_AUDIENCES.map((audience) => ({
    key: audience,
    title: ct(`audience.${audience}.title`),
    description: ct(`audience.${audience}.description`),
    href: audiencePath(audience),
    current: audience === current
  }));
}

/** Help Centre > audience crumbs; members' guides ARE the Help Centre home. */
function helpCrumbs(ct, audience) {
  const crumbs = [{ text: ct('page_title'), href: '/help' }];
  if (audience && audience !== 'members') {
    crumbs.push({ text: ct(`audience.${audience}.title`), href: audiencePath(audience) });
  }
  return crumbs;
}

function renderHelpNotFound(res) {
  const ct = centreTranslator(res);
  return res.status(404).render('support/help-not-found', {
    title: ct('not_found_title'),
    activeNav: 'help',
    ct
  });
}

async function renderHelpHome(req, res, audience) {
  const ct = centreTranslator(res);
  const locale = helpLocale(res);
  const ctx = await helpGateContext(req);
  const community = communityName(res);
  const searchQuery = trimmed(req.query.q);
  const searching = searchQuery.length >= 2;

  // The community's own questions: on the members' page, and in search results.
  let faqGroups = [];
  if (audience === 'members' || searching) {
    faqGroups = normalizeFaqGroups(await getHelpFaqs(searchQuery ? { q: searchQuery } : {}), res.locals.t);
  }

  const token = req.token || req.signedCookies?.token;
  await Promise.all(faqGroups.flatMap(group => group.faqs.map(async faq => {
    faq.translationAvailable = Boolean(token) && (req.accessibleRouting?.tenant || res.locals.tenant)?.translation?.enabled !== false;
    faq.translationFailed = req.query.translationStatus === 'failed' && String(req.query.faqId) === String(faq.id);
    faq.translation = await translateFields(req, res, token, faqTranslationSpec(faq, group.category));
  })));
  const sections = visibleSections(audience, ctx);
  const sectionCards = sections.map((section) => {
    const text = sectionText(locale, audience, section.id);
    return {
      title: text.title,
      summary: text.summary,
      href: helpPath(audience, section.id),
      countLabel: ct('articles_count', { count: section.articles.length })
    };
  });
  const popular = sections
    .flatMap((section) => section.articles
      .filter((article) => article.popular)
      .map((article) => {
        const text = articleText(locale, audience, section.id, article.id);
        return { title: text.title, summary: text.summary, href: helpPath(audience, section.id, article.id) };
      }))
    .slice(0, 6);

  const guideResults = searching
    ? searchGuides(locale, searchQuery, ctx).map((result) => ({
      title: result.title,
      summary: result.summary,
      href: helpPath(result.audience, result.sectionId, result.articleId),
      meta: `${ct(`audience.${result.audience}.title`)} · ${result.sectionTitle}`
    }))
    : [];

  const isHome = audience === 'members';
  const title = isHome
    ? res.locals.t('help.title')
    : ct('audience_page_title', { audience: ct(`audience.${audience}.title`) });
  const trail = [{ name: res.locals.t('help.title'), path: '/help' }];
  if (!isHome) trail.push({ name: ct(`audience.${audience}.title`), path: audiencePath(audience) });

  return res.render('support/help', {
    title,
    metaDescription: pageDescription(isHome
      ? res.locals.t('help.subtitle', { name: community })
      : ct(`audience.${audience}.description`)),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, trail),
    activeNav: 'help',
    communityName: community,
    ct,
    audience,
    isHome,
    crumbs: isHome ? [] : helpCrumbs(ct, null),
    audienceTitle: ct(`audience.${audience}.title`),
    audienceDescription: ct(`audience.${audience}.description`),
    audienceNav: audienceNav(ct, audience),
    searchAction: audiencePath(audience),
    searchQuery,
    searching,
    guideResults,
    guideResultsCount: ct('search_results_count', { count: guideResults.length }),
    popular,
    sectionCards,
    faqGroups
  });
}

router.post('/help/faqs/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = req.token || req.signedCookies?.token;
  if (!token) return res.redirect(res.locals.urlFor('/login?status=auth-required'));
  const groups = normalizeFaqGroups(await getHelpFaqs({}), res.locals.t);
  let result = null;
  for (const group of groups) {
    const faq = group.faqs.find(row => Number(row.id) === Number(req.params.id));
    if (faq) { result = await translateFields(req, res, token, faqTranslationSpec(faq, group.category), true); break; }
  }
  if (req.session && result) req.session.ugcTranslation = result;
  return res.redirect(res.locals.urlFor(`/help?faqId=${Number(req.params.id)}&translationStatus=${result ? 'done' : 'failed'}#faq-translation-${Number(req.params.id)}`));
}));

router.get('/help', asyncRoute(async (req, res) => renderHelpHome(req, res, 'members')));

router.get('/help/:audience([a-z]+)', asyncRoute(async (req, res) => {
  const { audience } = req.params;
  // Members' guides are the Help Centre home, and React sends any unknown
  // audience there too.
  if (audience === 'members' || !isAudience(audience)) return redirectTo(res, '/help');
  return renderHelpHome(req, res, audience);
}));

router.get('/help/:audience([a-z]+)/:section([a-z0-9_]+)', asyncRoute(async (req, res) => {
  const { audience, section: sectionId } = req.params;
  if (!isAudience(audience)) return renderHelpNotFound(res);
  const section = visibleSections(audience, await helpGateContext(req)).find((s) => s.id === sectionId);
  if (!section) return renderHelpNotFound(res);

  const ct = centreTranslator(res);
  const locale = helpLocale(res);
  const text = sectionText(locale, audience, section.id);

  return res.render('support/help-section', {
    title: text.title,
    metaDescription: pageDescription(text.summary),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, [
      { name: res.locals.t('help.title'), path: '/help' },
      { name: text.title, path: helpPath(audience, section.id) }
    ]),
    activeNav: 'help',
    ct,
    crumbs: helpCrumbs(ct, audience),
    audienceTitle: ct(`audience.${audience}.title`),
    section: {
      title: text.title,
      summary: text.summary,
      articles: section.articles.map((article) => {
        const articleCopy = articleText(locale, audience, section.id, article.id);
        return {
          title: articleCopy.title,
          summary: articleCopy.summary,
          href: helpPath(audience, section.id, article.id)
        };
      })
    }
  });
}));

router.get('/help/:audience([a-z]+)/:section([a-z0-9_]+)/:article([a-z0-9_]+)', asyncRoute(async (req, res) => {
  const { audience, section: sectionId, article: articleId } = req.params;
  if (!isAudience(audience)) return renderHelpNotFound(res);
  const section = visibleSections(audience, await helpGateContext(req)).find((s) => s.id === sectionId);
  const index = section ? section.articles.findIndex((a) => a.id === articleId) : -1;
  if (!section || index < 0) return renderHelpNotFound(res);

  const ct = centreTranslator(res);
  const locale = helpLocale(res);
  const article = section.articles[index];
  const sectionCopy = sectionText(locale, audience, section.id);
  const copy = articleText(locale, audience, section.id, article.id);
  const body = renderableBody(copy.body);
  const headings = body.filter((block) => block.kind === 'heading');
  const linkTarget = article.link ? accessibleHelpLink(article.link) : null;
  const neighbour = (other) => (other ? {
    title: articleText(locale, audience, section.id, other.id).title,
    href: helpPath(audience, section.id, other.id)
  } : null);

  return res.render('support/help-article', {
    title: copy.title,
    metaDescription: pageDescription(copy.summary),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, [
      { name: res.locals.t('help.title'), path: '/help' },
      { name: sectionCopy.title, path: helpPath(audience, section.id) },
      { name: copy.title, path: helpPath(audience, section.id, article.id) }
    ]),
    activeNav: 'help',
    ct,
    crumbs: [...helpCrumbs(ct, audience), { text: sectionCopy.title, href: helpPath(audience, section.id) }],
    sectionTitle: sectionCopy.title,
    article: {
      title: copy.title,
      summary: copy.summary,
      body,
      headings: headings.length >= 2 ? headings : [],
      link: linkTarget,
      // A broker or admin guide about a panel this site does not have says where
      // the task is done rather than linking to a page that does not exist.
      mainWebsiteOnly: Boolean(article.link && !linkTarget && audience !== 'members')
    },
    previous: neighbour(section.articles[index - 1]),
    next: neighbour(section.articles[index + 1]),
    others: section.articles
      .filter((other) => other.id !== article.id)
      .map((other) => neighbour(other))
  });
}));

router.get('/trust-and-safety', (req, res) => {
  const community = communityName(res);

  return res.render('support/trust-safety', {
    title: res.locals.t('trust_safety.title'),
    metaDescription: pageDescription(res.locals.t('trust_safety.subtitle', { name: community })),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, [{ name: res.locals.t('trust_safety.title'), path: '/trust-and-safety' }]),
    activeNav: 'trust-safety',
    communityName: community,
    sections: trustSafetySections(res)
  });
});

module.exports = router;
