// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const DEFAULT_ACCESSIBLE_FRONTEND_BASE_URL = 'https://accessible.project-nexus.ie';

export function getAccessibleFrontendBaseUrl(): string {
  const configured = (import.meta.env.VITE_ACCESSIBLE_FRONTEND_BASE_URL as string | undefined)?.trim();
  return (configured || DEFAULT_ACCESSIBLE_FRONTEND_BASE_URL).replace(/\/+$/, '');
}

export function buildAccessibleFrontendUrl(
  tenantSlug: string | null | undefined,
  path = '/',
  baseUrl = getAccessibleFrontendBaseUrl(),
  accessibleDomain?: string | null,
): string | null {
  const normalizedPath = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;

  // The tenant has its own accessible (GOV.UK) custom domain → slug-less clean
  // entry: the host resolves the tenant server-side, so no /{slug} prefix.
  const customDomain = accessibleDomain
    ?.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (customDomain) {
    // The custom accessible domain is the clean public entry point: the host
    // resolves the tenant server-side, so every route is served slug-less at
    // the bare root (mirroring React custom domains). Deep links are bare
    // paths too — the server registers the same routes without any prefix.
    return normalizedPath
      ? `https://${customDomain}${normalizedPath}`
      : `https://${customDomain}`;
  }

  const slug = tenantSlug?.trim();
  if (!slug) return null;

  const normalizedBaseUrl = (baseUrl.trim() || DEFAULT_ACCESSIBLE_FRONTEND_BASE_URL).replace(/\/+$/, '');

  return `${normalizedBaseUrl}/${encodeURIComponent(slug)}/accessible${normalizedPath}`;
}

/**
 * Pages that exist on the accessible site at a known address, keyed by the
 * main site's tenant-relative path. Each entry is [pattern, accessible path]:
 * the accessible path may use `$1` for the captured segment.
 *
 * 🔴 Only list a page whose accessible twin has the same meaning AND an
 * address that `web-uk` really serves (web-uk/src/routes, web-uk/src/server.js).
 * A wrong entry sends a disabled visitor to a "page not found".
 */
const ACCESSIBLE_PAGE_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/$/, '/'],
  [/^\/about$/, '/about'],
  [/^\/faq$/, '/faq'],
  [/^\/contact$/, '/contact'],
  [/^\/help$/, '/help'],
  [/^\/trust-and-safety$/, '/trust-and-safety'],
  [/^\/accessibility$/, '/accessibility'],
  [/^\/terms$/, '/terms'],
  [/^\/privacy$/, '/privacy'],
  [/^\/cookies$/, '/cookies'],
  [/^\/legal$/, '/legal'],
  [/^\/community-guidelines$/, '/legal/community-guidelines'],
  [/^\/acceptable-use$/, '/legal/acceptable-use'],
  [/^\/blog$/, '/blog'],
  [/^\/blog\/([A-Za-z0-9_-]+)$/, '/blog/$1'],
  [/^\/page\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/, '/page/$1'],
  [/^\/whats-on$/, '/whats-on'],
  [/^\/whats-on\/(\d+)$/, '/whats-on/$1'],
  [/^\/timebanking-guide$/, '/guide'],
];

/**
 * The accessible-site path for the main-site page the visitor is on, so the
 * "accessible version" link opens the same page there. A page the accessible
 * site does not have at the same address opens its home page instead.
 *
 * @param pathname  the browser path, e.g. "/hour-timebank/blog/spring-fair"
 * @param basePath  the community's path prefix ("/hour-timebank"), or "" when
 *                  the community is served from its own domain
 */
export function accessibleFrontendPathFor(pathname: string | null | undefined, basePath = ''): string {
  let path = (pathname ?? '/').split(/[?#]/)[0] || '/';
  const base = basePath.replace(/\/+$/, '');
  if (base) {
    const lowerPath = path.toLowerCase();
    const lowerBase = base.toLowerCase();
    if (lowerPath === lowerBase) path = '/';
    else if (lowerPath.startsWith(`${lowerBase}/`)) path = path.slice(base.length);
  }
  path = path.length > 1 ? path.replace(/\/+$/, '') : path;

  for (const [pattern, target] of ACCESSIBLE_PAGE_MAP) {
    const match = pattern.exec(path);
    if (match) return target.replace('$1', match[1] ?? '');
  }
  return '/';
}
