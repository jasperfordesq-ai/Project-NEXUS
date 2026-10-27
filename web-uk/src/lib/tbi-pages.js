// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Timebank Ireland's own content pages (owner approval, 27 Oct 2026).
 *
 * React serves four pages of one community's own material — its social
 * prescribing pathway, impact summary, 2023 impact report and 2026–2030
 * strategic plan — each wrapped in `<TenantSlugGate slug="hour-timebank">`
 * (react-frontend/src/routes/AppRoutes.tsx and PublicAppRoutes.tsx). These are
 * NOT platform features: the text describes that one organisation, so they exist
 * here only for the community whose slug is `hour-timebank`, on the shared mount
 * and on its own accessible domain alike (both set req.accessibleRouting.tenant).
 *
 * Every other community gets this app's ordinary "Page not found". React's gate
 * renders `<Navigate to="about" replace />`, a RELATIVE navigation from inside
 * the matched route, which resolves to /social-prescribing/about — an unknown
 * address that lands on React's catch-all NotFoundPage. The gate's own comment
 * says "Other tenants see NotFoundPage". A 404 is that outcome without the hop.
 */

const TBI_TENANT_SLUG = 'hour-timebank';

// React's RelatedPages.tsx order, minus /partner (no accessible page exists for
// it yet). The timebanking guide is /guide here (see seo-meta MAIN_SITE_PATHS).
const TBI_PAGE_PATHS = Object.freeze([
  '/social-prescribing',
  '/impact-summary',
  '/impact-report',
  '/strategic-plan'
]);

// Footer labels: React's navigation registry entries for the same four pages
// (navigationRegistry.ts, tenantSlugs ['hour-timebank'], "community pages").
const NAV_LABEL_KEYS = Object.freeze({
  '/social-prescribing': 'govuk_alpha_tbi_pages.nav.social_prescribing',
  '/impact-summary': 'govuk_alpha_tbi_pages.nav.our_impact',
  '/impact-report': 'govuk_alpha_tbi_pages.nav.impact_report',
  '/strategic-plan': 'govuk_alpha_tbi_pages.nav.strategic_plan'
});

function routedTenantSlug(tenant) {
  return tenant && typeof tenant === 'object' && typeof tenant.slug === 'string' ? tenant.slug : '';
}

/** True only for the routed hour-timebank community — React's `tenant?.slug === slug`. */
function isTbiTenant(tenant) {
  return routedTenantSlug(tenant) === TBI_TENANT_SLUG;
}

function requestTenant(req) {
  const tenant = req && req.accessibleRouting && req.accessibleRouting.tenant;
  return tenant && typeof tenant === 'object' ? tenant : null;
}

/**
 * The Related Pages strip (React RelatedPages.tsx) for one of these pages: the
 * guide plus the other three, each with its label and one-line description.
 */
function relatedPages(currentPath, t) {
  const links = [
    { href: '/guide', id: 'timebanking-guide' },
    ...TBI_PAGE_PATHS.map((href) => ({ href, id: href.slice(1) }))
  ];
  return links
    .filter((link) => link.href !== currentPath)
    .map((link) => ({
      href: link.href,
      label: t(`govuk_alpha_tbi_pages.related.link_${link.id}_label`),
      description: t(`govuk_alpha_tbi_pages.related.link_${link.id}_description`)
    }));
}

/** Footer links for the community-pages column, unprefixed. */
function footerLinks(tenant, t) {
  if (!isTbiTenant(tenant)) return [];
  return TBI_PAGE_PATHS.map((href) => ({
    key: `tbi_${href.slice(1).replace(/-/g, '_')}`,
    label: t(NAV_LABEL_KEYS[href]),
    href
  }));
}

module.exports = {
  TBI_PAGE_PATHS,
  TBI_TENANT_SLUG,
  footerLinks,
  isTbiTenant,
  relatedPages,
  requestTenant
};
