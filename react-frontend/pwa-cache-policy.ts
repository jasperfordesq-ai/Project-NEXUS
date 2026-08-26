// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Workbox cache policy for navigation and API requests.
 *
 * Privacy is fail-closed: only explicitly identity-free informational pages may
 * use the offline HTML-shell cache. Authentication, token workflows, CMS pages,
 * member modules, and unknown application paths always go to the network.
 */

// Keep this as one literal: Workbox serializes route callbacks rather than
// bundling their module scope, so vite.config.ts embeds this same self-contained
// expression in each navigation matcher. The source-level test guards drift.
export const CACHEABLE_PUBLIC_NAVIGATION_PATH_PATTERN = /^(?:|features|changelog|development-status|about|faq|contact|pilot-inquiry|pilot-apply|help|terms|privacy|accessibility|cookies|community-guidelines|trust-and-safety|account-deletion|child-safety|acceptable-use|legal|timebanking-guide|regional-analytics|partner|social-prescribing|impact-summary|impact-report|strategic-plan|pricing|blog(?:\/[^/]+)?|(?:terms|privacy|accessibility|cookies|community-guidelines|acceptable-use)\/versions|platform\/(?:terms|privacy|disclaimer)|developers(?:\/(?:auth|endpoints|webhooks))?)$/;

export function normalizeNavigationPath(pathname: string): string {
  // Do not guess that an unknown first segment is a tenant slug. Shared-domain
  // tenant paths therefore stay network-only; that is safer than allowing an
  // unknown future route to inherit a public route's cache policy.
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function isCacheablePublicNavigationPath(pathname: string): boolean {
  const normalized = normalizeNavigationPath(pathname);
  return CACHEABLE_PUBLIC_NAVIGATION_PATH_PATTERN.test(normalized);
}

export function isPublicTenantBootstrapPath(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/, '') === '/api/v2/tenant/bootstrap';
}

export function isPublicBlogApiPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '');
  return /^\/api\/v2\/blog(?:\/[^/]+)?$/.test(normalized);
}

export function isPrivateApiPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return (normalized === '/api' || normalized.startsWith('/api/'))
    && !isPublicTenantBootstrapPath(normalized)
    && !isPublicBlogApiPath(normalized);
}
