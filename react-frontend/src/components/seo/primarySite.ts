// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which of a community's two sites search engines should index
 * (`settings.seo_primary_site`, /admin/seo, 2026-10-23).
 *
 *  - 'standard' (default, also when absent or unrecognised): this site.
 *  - 'accessible': the accessible site (web-uk). For communities, such as
 *    councils, that promote only the accessible site. Pages of this site that
 *    have an accessible twin name that twin as their canonical; pages with no
 *    twin are kept out of search, so the two sites never compete and nothing
 *    points at an unrelated page.
 */

import {
  accessibleFrontendEquivalentFor,
  buildAccessibleFrontendUrl,
} from '@/lib/accessible-frontend';

export type SeoPrimarySite = 'standard' | 'accessible';

interface TenantLike {
  slug?: string | null;
  accessible_domain?: string | null;
  settings?: Record<string, unknown>;
}

export function seoPrimarySite(tenant: TenantLike | null | undefined): SeoPrimarySite {
  return tenant?.settings?.seo_primary_site === 'accessible' ? 'accessible' : 'standard';
}

/**
 * The accessible-site address of this page, or null when the accessible site
 * has no equivalent (or the community has no accessible address at all).
 *
 * @param pathname  the browser path of the page, community folder included
 * @param basePath  the community's folder ("/hour-timebank") or ""
 */
export function accessibleEquivalentUrl(
  tenant: TenantLike | null | undefined,
  pathname: string,
  basePath: string,
): string | null {
  const path = accessibleFrontendEquivalentFor(pathname, basePath);
  if (path === null) return null;
  return buildAccessibleFrontendUrl(tenant?.slug, path, undefined, tenant?.accessible_domain);
}

/** The accessible site's home page for this community, or null. */
export function accessibleHomeUrl(tenant: TenantLike | null | undefined): string | null {
  return buildAccessibleFrontendUrl(tenant?.slug, '/', undefined, tenant?.accessible_domain);
}
