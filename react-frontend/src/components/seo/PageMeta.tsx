// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PageMeta — Per-page SEO meta tags via react-helmet-async.
 *
 * Sets title, description, canonical URL (query-param-stripped), Open Graph,
 * Twitter Card, and robots directives.
 *
 * Reads admin-configured SEO settings from the tenant context:
 *  - seo_title_suffix → custom title suffix (overrides branding.name)
 *  - seo_meta_description → global fallback description
 *  - seo_meta_keywords → global fallback keywords
 *  - seo_og_image_url → default OG image (via branding.og_image_url)
 *  - seo_canonical_urls → whether to emit canonical link tags
 *  - seo_open_graph → whether to emit OG tags
 *  - seo_twitter_cards → whether to emit Twitter Card tags
 */

import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts/TenantContext';

// Map our short language codes to OG locale codes (BCP 47 with region).
// Google and Facebook expect e.g. en_GB / fr_FR, not the bare lang code.
// Picked plausible defaults for each tenant region; if a tenant later
// needs a different region (e.g. pt_BR vs pt_PT), this can be moved into
// tenant settings.
const OG_LOCALES: Record<string, string> = {
  en: 'en_GB',
  ga: 'ga_IE',
  de: 'de_DE',
  fr: 'fr_FR',
  it: 'it_IT',
  pt: 'pt_PT',
  es: 'es_ES',
  nl: 'nl_NL',
  pl: 'pl_PL',
  ja: 'ja_JP',
  ar: 'ar_001', // Modern Standard Arabic, no region
};

interface PageMetaProps {
  /** Page title (appears before the site name suffix). */
  title?: string;
  /** Meta description — aim for 150–160 characters. */
  description?: string;
  /** Comma-separated meta keywords. */
  keywords?: string;
  /** Open Graph / Twitter Card image URL (absolute). Falls back to tenant og_image_url or logo. */
  image?: string;
  /** Canonical URL override. Defaults to current pathname (query params stripped). */
  url?: string;
  /** Open Graph type. */
  type?: 'website' | 'article' | 'profile';
  /** Set true for pages that should not be indexed (auth, dashboard, settings, etc.). */
  noIndex?: boolean;
  /** Published date for article type (ISO 8601). */
  publishedTime?: string;
  /** Modified date for article type (ISO 8601). */
  modifiedTime?: string;
  /**
   * The community's home page. When the admin has filled in the tenant
   * "Meta title" / "Meta description" on /admin/seo, those are the page's
   * title (exactly, no " | site name" suffix) and description, replacing the
   * translated defaults passed in `title` / `description`. Only the browser
   * tab title and the search-result snippet are affected: the page body comes
   * from the landing page builder and is untouched.
   */
  tenantHome?: boolean;
}

/**
 * Strip query parameters and hash from a URL to produce a clean canonical.
 * Search engines treat ?page=2, ?lng=fr, ?q=test as separate pages — we
 * canonicalize them all back to the base pathname URL.
 */
function buildCanonicalUrl(origin: string, pathname: string): string {
  // Ensure no trailing slash except for root
  const cleanPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  return `${origin}${cleanPath}`;
}

function toAbsoluteUrl(value: string | undefined, origin: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    return new URL(trimmed, origin || undefined).href;
  } catch {
    return origin && trimmed.startsWith('/') ? `${origin}${trimmed}` : trimmed;
  }
}

/** Read a string setting from tenant.settings safely. */
function getSetting(settings: Record<string, unknown> | undefined, key: string): string {
  if (!settings || typeof settings[key] !== 'string') return '';
  return settings[key] as string;
}

/** Read a boolean setting from tenant.settings safely (defaults to true). */
function getBoolSetting(settings: Record<string, unknown> | undefined, key: string): boolean {
  if (!settings || settings[key] === undefined) return true;
  const val = settings[key];
  if (typeof val === 'boolean') return val;
  if (val === '1' || val === 'true') return true;
  if (val === '0' || val === 'false') return false;
  return true;
}

export function PageMeta({
  title,
  description,
  keywords,
  image,
  url,
  type = 'website',
  noIndex = false,
  publishedTime,
  modifiedTime,
  tenantHome = false,
}: PageMetaProps) {
  const { branding: tenantBranding, tenant } = useTenant();
  const branding = tenantBranding ?? { name: 'NEXUS', tagline: '', og_image_url: '', logo: '' };
  const location = useLocation();
  const { i18n } = useTranslation();

  // Active language → OG locale (BCP 47). Falls back to en_GB if unknown.
  const activeLang = (i18n?.language || 'en').split('-')[0] ?? 'en';
  const ogLocale = OG_LOCALES[activeLang] || OG_LOCALES.en;
  const ogLocaleAlternates = useMemo(
    () => Object.entries(OG_LOCALES)
      .filter(([code]) => code !== activeLang)
      .map(([, locale]) => locale),
    [activeLang]
  );

  const settings = tenant?.settings as Record<string, unknown> | undefined;

  // Admin-configured SEO settings (from tenant_settings table via bootstrap)
  const adminTitleSuffix = getSetting(settings, 'seo_title_suffix');
  const adminDescription = getSetting(settings, 'seo_meta_description');
  const adminKeywords = getSetting(settings, 'seo_meta_keywords');
  const enableCanonical = getBoolSetting(settings, 'seo_canonical_urls');
  const enableOpenGraph = getBoolSetting(settings, 'seo_open_graph');
  const enableTwitterCards = getBoolSetting(settings, 'seo_twitter_cards');

  // Tenant "Meta title" / "Meta description" from /admin/seo (tenants table).
  const seoTitle = (tenant?.seo?.meta_title || '').trim();
  const seoDescription = (tenant?.seo?.meta_description || '').trim();

  // Site name (the " | …" suffix on every page): admin title suffix > branding
  // name > tenant meta title > NEXUS. Until 2026-10-22 the tenant meta title
  // came before the branding name, so a descriptive meta title such as
  // "TimeBank Ireland | Swap Skills, Earn Time Credits" was appended to EVERY
  // page ("About TimeBank Ireland | TimeBank Ireland | Swap Skills, …").
  const siteName = adminTitleSuffix
    ? adminTitleSuffix.replace(/^\s*\|\s*/, '') // Strip leading " | " if present
    : branding.name || seoTitle || 'NEXUS';
  const titleSuffix = adminTitleSuffix || ` | ${siteName}`;
  const suffixedTitle = title ? `${title}${titleSuffix}` : siteName;
  // The home page is the one page whose title IS the tenant meta title.
  const fullTitle = tenantHome && seoTitle ? seoTitle : suffixedTitle;

  // Description: home page → tenant seo description first; otherwise
  // explicit > admin global > tenant seo description > branding tagline > platform default
  const metaDescription =
    (tenantHome ? seoDescription : '') ||
    description ||
    adminDescription ||
    seoDescription ||
    branding.tagline ||
    'Community timebanking platform — exchange skills, build connections, strengthen your community.';

  // Keywords: explicit > admin global keywords
  const metaKeywords = keywords || adminKeywords || undefined;

  // Canonical: always clean pathname, never include query params or hash
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const browserPathname = typeof window !== 'undefined' ? window.location.pathname : location.pathname;
  const canonicalUrl = toAbsoluteUrl(url, origin) || buildCanonicalUrl(origin, browserPathname);

  // OG image fallback chain: explicit prop -> tenant og_image_url -> tenant logo -> platform default
  const richCardImage = toAbsoluteUrl(image || branding.og_image_url || branding.logo, origin);
  const ogImage = richCardImage || toAbsoluteUrl('/og-default.svg', origin) || '/og-default.svg';
  const twitterCard = richCardImage ? 'summary_large_image' : 'summary';

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={metaDescription} />
      {metaKeywords && <meta name="keywords" content={metaKeywords} />}

      {/* Canonical URL — always clean, no query params */}
      {enableCanonical && canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Robots */}
      {/* admin-i18n-ignore: standards-defined robots directive, not rendered copy */}
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph / Facebook (respects admin toggle) */}
      {enableOpenGraph && <meta property="og:type" content={type} />}
      {enableOpenGraph && <meta property="og:site_name" content={siteName} />}
      {enableOpenGraph && <meta property="og:title" content={fullTitle} />}
      {enableOpenGraph && <meta property="og:description" content={metaDescription} />}
      {enableOpenGraph && canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      {enableOpenGraph && <meta property="og:image" content={ogImage} />}
      {enableOpenGraph && <meta property="og:image:width" content="1200" />}
      {enableOpenGraph && <meta property="og:image:height" content="630" />}
      {enableOpenGraph && <meta property="og:locale" content={ogLocale} />}
      {enableOpenGraph && ogLocaleAlternates.map((locale) => (
        <meta key={locale} property="og:locale:alternate" content={locale} />
      ))}

      {/* Article-specific OG tags */}
      {enableOpenGraph && type === 'article' && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {enableOpenGraph && type === 'article' && modifiedTime && (
        <meta property="article:modified_time" content={modifiedTime} />
      )}

      {/* Twitter Card (respects admin toggle) */}
      {enableTwitterCards && <meta name="twitter:card" content={twitterCard} />}
      {enableTwitterCards && <meta name="twitter:title" content={fullTitle} />}
      {enableTwitterCards && <meta name="twitter:description" content={metaDescription} />}
      {enableTwitterCards && <meta name="twitter:image" content={ogImage} />}
    </Helmet>
  );
}

export default PageMeta;
