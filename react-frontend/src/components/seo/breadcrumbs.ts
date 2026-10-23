// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BreadcrumbList structured data for a page.
 *
 * Until 2026-10-23 SeoHead built this from the raw address, one crumb per
 * segment: /whats-on/42 became "Home > whats-on > 42", and
 * /help/members/getting-started linked to /help/members/getting-started's
 * parents whether or not they were pages. Search engines show these crumbs
 * in results, so they must be real page names that link to real pages.
 *
 * The rules now:
 *  - first crumb: the community's home page (its folder kept, for a
 *    community that lives under a hub's domain);
 *  - middle crumb: the section the page belongs to, only when its first
 *    address segment is a known section with a page of its own, named by
 *    its translated label; anything deeper (ids, slugs, sub-folders) is
 *    dropped rather than guessed at;
 *  - last crumb: the page's own title, linking to the page itself.
 */

/** First address segment → `common` translation key of that section's name. */
export const BREADCRUMB_SECTIONS: Record<string, string> = {
  listings: 'nav.listings',
  events: 'nav.events',
  'whats-on': 'nav.whats_on',
  groups: 'nav.groups',
  members: 'nav.members',
  blog: 'nav.blog',
  volunteering: 'nav.volunteering',
  organisations: 'nav.organisations',
  jobs: 'nav.jobs',
  marketplace: 'nav.marketplace',
  ideation: 'nav.ideation',
  kb: 'nav.knowledge_base',
  about: 'nav.about',
  faq: 'nav.faq',
  help: 'footer.help_center',
  'timebanking-guide': 'nav.timebanking_guide',
  'impact-report': 'nav.impact_report',
  'strategic-plan': 'nav.strategic_plan',
  'social-prescribing': 'nav.social_prescribing',
  features: 'nav.features',
  legal: 'legal.legal_hub',
  terms: 'legal.terms_of_service',
  privacy: 'legal.privacy_policy',
  cookies: 'legal.cookie_policy',
  accessibility: 'legal.accessibility',
  'community-guidelines': 'legal.type_community_guidelines',
  'acceptable-use': 'legal.type_acceptable_use',
};

export interface BreadcrumbInput {
  /** The community's own base address, e.g. https://uk.timebank.global/west-somerset */
  siteUrl: string;
  /** The community folder ('' when the community has its own domain). */
  basePath: string;
  /** Path of the page being described (the canonical page's path). */
  pagePath: string;
  /** The page's own title, without the " | site name" suffix. */
  pageTitle: string;
  /** Translated name of the home page. */
  homeName: string;
  /** Translated name of a section, by its `common` key. */
  sectionName: (key: string) => string;
}

export interface BreadcrumbListItem {
  '@type': 'ListItem';
  position: number;
  name: string;
  item: string;
}

/** The BreadcrumbList for a page, or null when the page is the home page. */
export function buildBreadcrumbList(input: BreadcrumbInput): Record<string, unknown> | null {
  const { siteUrl, basePath, pageTitle, homeName, sectionName } = input;
  const title = pageTitle.trim();
  if (!title) return null;

  const cleanPath = input.pagePath === '/' ? '/' : input.pagePath.replace(/\/+$/, '');
  const relative = basePath && (cleanPath === basePath || cleanPath.startsWith(`${basePath}/`))
    ? cleanPath.slice(basePath.length)
    : cleanPath;
  const segments = relative.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs: Array<{ name: string; item: string }> = [{ name: homeName, item: siteUrl || '/' }];

  const first = segments[0] ?? '';
  const sectionKey = BREADCRUMB_SECTIONS[first];
  if (segments.length > 1 && sectionKey) {
    const name = sectionName(sectionKey);
    if (name && name !== sectionKey && name !== title) {
      crumbs.push({ name, item: `${siteUrl}/${first}` });
    }
  }

  crumbs.push({ name: title, item: `${siteUrl}/${segments.join('/')}` });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index): BreadcrumbListItem => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  };
}
