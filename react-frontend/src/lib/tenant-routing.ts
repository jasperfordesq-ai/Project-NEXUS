// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tenant Routing Utilities
 *
 * Shared constants and helpers for tenant slug resolution from URLs.
 * These lists are derived from TRS-001 Section 4 (Reserved Words).
 *
 * @see docs/TRS-001-TENANT-RESOLUTION-SPEC.md
 */

/**
 * Reserved subdomains — TRS-001 Section 4 (27 entries).
 * Used for R2 (subdomain resolution). If the subdomain matches, it is NOT a tenant slug.
 */
export const RESERVED_SUBDOMAINS = new Set([
  'app', 'api', 'www', 'admin', 'mail', 'smtp', 'imap', 'pop', 'ftp',
  'ns1', 'ns2', 'ns3', 'ns4', 'cdn', 'static', 'assets', 'status',
  'help', 'support', 'docs', 'blog', 'staging', 'dev', 'test', 'demo',
  'beta', 'alpha', 'preview',
]);

/**
 * Reserved top-level path segments — TRS-001 Section 4.
 * Used for R3 (path-based resolution on app.project-nexus.ie) and R1 (custom-domain
 * child-slug resolution). Must stay in sync with TenantContext::getReservedPaths() in PHP.
 * If the first path segment matches, it is a React route, NOT a tenant slug.
 */
export const RESERVED_PATHS = new Set([
  // Auth & session
  'login', 'register', 'password', 'logout', 'verify-email', 'verify-identity',
  'verify-identity-optional', 'auth', 'consent-required', 'consent',
  // Core app routes
  'dashboard', 'feed', 'listings', 'messages', 'compose', 'notifications',
  'wallet', 'profile', 'settings', 'members', 'connections', 'saved',
  'users', 'premium', 'donations',
  // Feature modules
  'events', 'groups', 'community-groups', 'volunteering', 'organisations',
  'federation', 'blog', 'resources', 'polls', 'goals', 'reviews',
  'exchanges', 'group-exchanges', 'matches', 'search', 'explore',
  'achievements', 'leaderboard', 'nexus-score', 'activity', 'skills',
  'ideation', 'jobs', 'kb', 'marketplace', 'chat',
  'courses', 'podcasts', 'coupons', 'clubs', 'me', 'municipality-calendar',
  'advertise', 'join', 'venues', 'whats-on',
  'caring', 'caring-community', 'proposals', 'newsletter', 'onboarding',
  'support-actions', 'linked-accounts',
  // Public/info pages
  'home', 'about', 'contact', 'faq', 'help', 'legal', 'terms', 'platform',
  'privacy', 'accessibility', 'cookies', 'community-guidelines', 'acceptable-use',
  'timebanking-guide', 'partner', 'partner-with-us', 'social-prescribing',
  'strategic-plan', 'impact-summary', 'impact-report', 'our-story',
  'how-it-works', 'guide', 'news', 'post',
  'features', 'changelog', 'development-status',
  'communities', 'local-groups', 'services',
  'trust-and-safety', 'pilot-inquiry', 'pilot-apply', 'developers',
  'regional-analytics', 'partner-analytics', 'pricing',
  // System / admin
  'admin', 'admin-legacy', 'super-admin', 'broker', 'partner-timebanks', 'dev',
  'api', 'v2', 'assets', 'downloads', 'uploads',
  'cron', 'test-email', 'mobile', 'mobile-download', 'share-target',
  'migrate-messages',
  // Static files / well-known
  'sitemap.xml', 'robots.txt', 'manifest.json', 'service-worker.js',
  'favicon.ico', 'health', 'classic', '.well-known', 'page',
]);

/**
 * Platform domain used for R3 path-based resolution.
 * Path-based tenant slugs only apply on this domain (and localhost for dev).
 */
const PLATFORM_DOMAIN = 'project-nexus.ie';

/**
 * Detect tenant slug from the current URL.
 *
 * Implements TRS-001 resolution rules:
 * - R1: Custom domain → not handled here (backend resolves via Host header)
 * - R2: Subdomain of project-nexus.ie → extract subdomain as slug
 * - R3: First path segment on app.project-nexus.ie → extract as slug if not reserved
 * - R4: No tenant → return null (show chooser)
 *
 * @returns Object with slug (if detected) and source ('subdomain' | 'path' | null)
 */
export function detectTenantFromUrl(): { slug: string | null; source: 'subdomain' | 'path' | null } {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  // Development: localhost/127.0.0.1 — only path-based resolution
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const slug = extractSlugFromPath(pathname);
    return { slug, source: slug ? 'path' : null };
  }

  // R2: Subdomain resolution — {sub}.project-nexus.ie
  if (hostname.endsWith('.' + PLATFORM_DOMAIN)) {
    const subdomain = hostname.slice(0, hostname.length - PLATFORM_DOMAIN.length - 1);
    // Must be a single-level subdomain (no dots)
    if (subdomain && !subdomain.includes('.') && !RESERVED_SUBDOMAINS.has(subdomain.toLowerCase())) {
      return { slug: subdomain.toLowerCase(), source: 'subdomain' };
    }

    // Reserved subdomain (app, api, etc.) — fall through to path-based
    if (subdomain === 'app') {
      const slug = extractSlugFromPath(pathname);
      return { slug, source: slug ? 'path' : null };
    }

    // Other reserved subdomains — no tenant resolution here
    return { slug: null, source: null };
  }

  // R1: Custom domain — not project-nexus.ie
  // Check whether the first path segment is a sub-tenant slug.
  // Direct child tenants of a domain-owning parent are reachable at parent.domain/child-slug
  // (e.g. timebanking.uk/cardiff). We attempt the path segment as a slug and let the
  // bootstrap API validate it: valid sub-tenant → returns parent_domain; unknown → 404.
  // Reserved paths (login, dashboard, listings, etc.) are excluded by extractSlugFromPath,
  // so standard SPA routes on the parent domain are never misidentified as tenant slugs.
  const potentialSlug = extractSlugFromPath(pathname);
  if (potentialSlug) {
    return { slug: potentialSlug, source: 'path' };
  }
  return { slug: null, source: null };
}

/**
 * Extract tenant slug from the first path segment.
 * Returns null if the segment is a reserved path or empty.
 *
 * Slugs are normalised to lowercase here; the DB enforces lowercase on write
 * (TenantHierarchyService validates with lowercase slug rule), so the
 * lowercased value will always match the stored slug.
 */
function extractSlugFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();

  if (!firstSegment) return null;
  if (RESERVED_PATHS.has(firstSegment)) return null;

  return firstSegment;
}

/**
 * Build a path with the tenant slug prefix.
 * Used by components to generate tenant-scoped links.
 *
 * @param path - The page path (e.g., "/dashboard", "/listings/42")
 * @param tenantSlug - The current tenant slug (from context), or null
 * @returns The full path with slug prefix if applicable
 */
export function tenantPath(path: string, tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return path;
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  // Prevent double-prefixing (e.g. Breadcrumbs wrapping an already-wrapped href)
  const prefix = '/' + tenantSlug;
  if (normalizedPath.toLowerCase().startsWith(prefix.toLowerCase() + '/') ||
      normalizedPath.toLowerCase() === prefix.toLowerCase()) {
    return normalizedPath;
  }
  return prefix + normalizedPath;
}

/**
 * Strip the tenant slug prefix from a pathname.
 * Used when we need the "real" page path without the slug.
 *
 * @param pathname - Full pathname (e.g., "/hour-timebank/dashboard")
 * @param tenantSlug - The tenant slug to strip
 * @returns The path without the slug prefix (e.g., "/dashboard")
 */
export function stripTenantSlug(pathname: string, tenantSlug: string): string {
  const prefix = '/' + tenantSlug;
  if (pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = pathname.slice(prefix.length);
    return rest || '/';
  }
  return pathname;
}
