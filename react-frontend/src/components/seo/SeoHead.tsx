// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { toJsonLd } from '@/lib/json-ld';

/**
 * SeoHead — Global SEO tags rendered on every page via Layout.
 *
 * Renders:
 *  - Webmaster verification meta tags (Google, Bing)
 *  - Organization JSON-LD structured data
 *  - WebSite JSON-LD (name and address only)
 *
 * BreadcrumbList moved to PageMeta on 2026-10-23: it needs the page's own
 * title, which only the page knows (see breadcrumbs.ts).
 *  - x-default hreflang (clean URL, no language query params)
 *
 * NOTE: This is a client-side SPA with i18next for localisation.
 * Language switching happens in the browser — there are no separate
 * server-side language URLs. Therefore we emit only `x-default`
 * hreflang pointing to the clean canonical URL, not per-language
 * `?lng=` variants (which created 3,997 hreflang/HTML-lang mismatches
 * in Ahrefs because the rendered HTML lang didn't match the hreflang).
 *
 * The `<html lang>` attribute is synced dynamically by i18n.ts via
 * `i18n.on('languageChanged')` — no Helmet intervention needed.
 */

/**
 * schema.org has no NonprofitOrganization, CommunityOrganization or
 * VolunteerOrganization type; Google drops structured data whose @type it does
 * not recognise. The super-admin "Organisation type" choices are stored as
 * chosen and mapped to a real type here (2026-10-23). NGO is schema.org's type
 * for a non-governmental, non-profit body.
 */
const SCHEMA_ORG_TYPE: Record<string, string> = {
  NonprofitOrganization: 'NGO',
  CommunityOrganization: 'NGO',
  VolunteerOrganization: 'NGO',
  NGO: 'NGO',
  LocalBusiness: 'LocalBusiness',
  GovernmentOrganization: 'GovernmentOrganization',
  Organization: 'Organization',
};

/**
 * A webmaster verification value as the tool expects it: only the token.
 * Admins paste the whole tag, or "google-site-verification=TOKEN" (which the
 * SEO page's own example text suggested); either would fail verification.
 */
export function verificationToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  const fromTag = v.match(/content\s*=\s*["']([^"']+)["']/i);
  if (fromTag?.[1]) v = fromTag[1];
  const eq = v.lastIndexOf('=');
  if (eq !== -1 && /^(google-site-verification|msvalidate\.01)\s*=/i.test(v)) v = v.slice(eq + 1);
  return v.replace(/[<>"'\s]/g, '');
}

function absoluteUrl(value: string | undefined, origin: string): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  try {
    return new URL(v, origin || undefined).href;
  } catch {
    return origin && v.startsWith('/') ? `${origin}${v}` : v;
  }
}

// areaServed — only emitted for LocalBusiness; maps service_area scope to Schema @type.
// Combines location_name (e.g. "Cork") with country_code (e.g. "IE") for Google disambiguation.
const areaServedTypeMap: Record<string, string> = {
  local: 'City',
  regional: 'AdministrativeArea',
  national: 'Country',
  international: 'Place',
};

export function SeoHead() {
  const { branding, tenant, tenantPath } = useTenant();
  const location = useLocation();

  const siteName = branding.name || 'NEXUS';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // The community's own base: the origin, plus its folder when it lives under
  // a hub's domain (uk.timebank.global/west-somerset). Until 2026-10-23 this
  // was the bare origin, and the route path came from the router (which strips
  // the community folder), so a sub-community's hreflang, organisation URL and
  // breadcrumbs all pointed at the hub's home page.
  const basePath = (typeof tenantPath === 'function' ? tenantPath('/') : '/').replace(/\/+$/, '');
  const siteUrl = `${origin}${basePath}`;
  // Browser pathname (keeps the community folder), as PageMeta's canonical does.
  const browserPath = typeof window !== 'undefined' ? window.location.pathname : location.pathname;
  const cleanPath = browserPath === '/' ? '/' : browserPath.replace(/\/+$/, '');
  const canonicalPath = `${origin}${cleanPath}`;

  const seo = tenant?.seo;
  const settings = tenant?.settings as Record<string, unknown> | undefined;

  // Build Organization JSON-LD. Type defaults to NonprofitOrganization for
  // community timebanks (most tenants); admins can override via the
  // `seo_organization_type` setting if their tenant is a different entity.
  const chosenType = typeof settings?.seo_organization_type === 'string' ? settings.seo_organization_type : '';
  const orgType = SCHEMA_ORG_TYPE[chosenType] ?? 'NGO';

  const contact = tenant?.contact;
  const social = tenant?.social;

  const sameAs: string[] = social
    ? [social.facebook, social.twitter, social.instagram, social.linkedin, social.youtube]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  // Optional structured PostalAddress — only emit if we have an address string.
  const postalAddress = contact?.address
    ? {
        '@type': 'PostalAddress',
        streetAddress: contact.address,
        ...(contact.location ? { addressLocality: contact.location } : {}),
        ...(contact.country_code ? { addressCountry: contact.country_code } : {}),
      }
    : undefined;

  const areaServedSchemaType = areaServedTypeMap[contact?.service_area ?? ''];
  const areaServed = orgType === 'LocalBusiness' && (contact?.location || contact?.country_code)
    ? {
        ...(areaServedSchemaType ? { '@type': areaServedSchemaType } : {}),
        ...(contact?.location ? { name: contact.location } : {}),
        ...(contact?.country_code
          ? { containedInPlace: { '@type': 'Country', name: contact.country_code } }
          : {}),
      }
    : undefined;

  const orgSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': orgType,
    '@id': `${siteUrl}/#org`,
    name: siteName,
    url: siteUrl,
    // Google expects a full address for the logo; the stored one is relative.
    ...(absoluteUrl(branding.logo, origin) ? { logo: absoluteUrl(branding.logo, origin) } : {}),
    ...(branding.tagline ? { description: branding.tagline } : {}),
    ...(contact?.email ? { email: contact.email } : {}),
    ...(contact?.phone ? { telephone: contact.phone } : {}),
    ...(postalAddress ? { address: postalAddress } : {}),
    ...(areaServed ? { areaServed } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };

  // WebSite JSON-LD. No SearchAction (removed 2026-10-23): it pointed search
  // engines at /listings?q=, and both /listings and /search need a sign-in, so
  // a searcher using it landed on the login page. There is no public site-wide
  // search to point it at instead.
  const webSiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
  };

  const googleVerification = verificationToken(settings?.seo_google_verification);
  const bingVerification = verificationToken(settings?.seo_bing_verification);

  // Geo meta tags — emit when we have at least a country code.
  // geo.region uses ISO 3166-1 alpha-2; geo.placename is the human-readable locality.
  // ICBM is the legacy lat/long format still read by some crawlers.
  const geoCountry = contact?.country_code ?? '';
  const geoPlacename = contact?.location ?? '';
  // Coordinates only when real: a community with no map position stored 0,0,
  // which is a point in the Atlantic off West Africa.
  const lat = Number(contact?.latitude);
  const lng = Number(contact?.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
    && contact?.latitude != null && contact?.longitude != null && !(lat === 0 && lng === 0);
  const geoLat = hasCoords ? lat : null;
  const geoLng = hasCoords ? lng : null;

  return (
    // No title here, not even Helmet's defaultTitle: under React 19 each
    // Helmet writes its own <title> element, so a default here became a second
    // title on every page. PageMeta sets the title and removes index.html's
    // placeholder (shellTitle.ts); a page without PageMeta keeps the
    // placeholder, which is still exactly one title.
    <Helmet>
      {/* Robots directive — only emitted when admin has set a non-default value.
          Default (index, follow) is omitted to keep the HTML clean. */}
      {seo?.robots_directive && (
        <meta name="robots" content={seo.robots_directive} />
      )}

      {/* Google Search Console verification */}
      {googleVerification && (
        <meta name="google-site-verification" content={googleVerification} />
      )}

      {/* Bing Webmaster Tools verification */}
      {bingVerification && (
        <meta name="msvalidate.01" content={bingVerification} />
      )}

      {/* Organization JSON-LD (NonprofitOrganization by default).
          Contains address, contact, sameAs links — used by Google Knowledge
          Graph, Bing, and AI assistants to identify and describe the org. */}
      <script type="application/ld+json">
        {toJsonLd(orgSchema)}
      </script>

      {/* WebSite JSON-LD — the site's name and address. */}
      <script type="application/ld+json">
        {toJsonLd(webSiteSchema)}
      </script>

      {/* Geo meta tags — help Google and Bing assign geographic context to
          this tenant's domain, reducing multi-tenant duplicate-content risk. */}
      {geoCountry && <meta name="geo.region" content={geoCountry} />}
      {geoCountry && <meta name="geo.country" content={geoCountry} />}
      {geoPlacename && <meta name="geo.placename" content={geoPlacename} />}
      {geoLat !== null && geoLng !== null && (
        <meta name="ICBM" content={`${geoLat}, ${geoLng}`} />
      )}

      {/* x-default hreflang — clean canonical URL, no ?lng= variants.
          This is the only hreflang needed for a client-side i18n SPA. */}
      <link rel="alternate" hrefLang="x-default" href={canonicalPath} />

    </Helmet>
  );
}

export default SeoHead;
