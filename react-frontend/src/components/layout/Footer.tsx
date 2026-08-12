// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCookieConsent } from '@/contexts/CookieConsentContext';
import { useFeature, useTenant } from '@/contexts/TenantContext';
import { useTheme } from '@/contexts/ThemeContext';
import Mail from 'lucide-react/icons/mail';
import Phone from 'lucide-react/icons/phone';
import MapPin from 'lucide-react/icons/map-pin';
import Cookie from 'lucide-react/icons/cookie';
import { TenantLogo } from '@/components/branding';
import Sparkles from 'lucide-react/icons/sparkles';
import ExternalLink from 'lucide-react/icons/external-link';
import { RELEASE_STATUS } from '@/config/releaseStatus';
import { PROJECT_NEXUS_DOCS_URL } from '@/config/externalLinks';
import { SourceRepositoryLink } from './SourceRepositoryLink';
import { Button } from '@/components/ui/Button';
import { resolveBrandingImageUrl } from '@/lib/helpers';


export interface FooterProps {
  /** Footer content/links */
  children?: ReactNode;
  /** Copyright text override */
  copyright?: string;
}

/**
 * Footer - Glass-styled footer component
 * Shows tenant branding, contact info, and footer_text from bootstrap API.
 * Desktop footer carries full navigation. Mobile attribution and legal links live
 * in MobileDrawer so the responsive website keeps an app-like content surface.
 */
export function Footer({ children, copyright }: FooterProps) {
  const { t } = useTranslation('common');
  const { tenant, branding, tenantPath } = useTenant();
  const { resolvedTheme } = useTheme();
  const hasConnections = useFeature('connections');
  const hasEvents = useFeature('events');
  const hasBlog = useFeature('blog');
  const { resetConsent } = useCookieConsent();
  const year = new Date().getFullYear();

  // Powered-by branding: hardcoded NEXUS defaults, overridable per-tenant by God only.
  // God-uploaded images take priority; otherwise the built-in assets ship with every fork/clone.
  const DEFAULT_PB_IMAGE_LIGHT = '/images/powered-by-nexus-light.png';
  const DEFAULT_PB_IMAGE_DARK  = '/images/powered-by-nexus-dark.png';
  const DEFAULT_PB_URL         = 'https://project-nexus.ie';

  const pbImageLight = (tenant?.config?.powered_by_image_light as string | undefined) || DEFAULT_PB_IMAGE_LIGHT;
  const pbImageDark  = (tenant?.config?.powered_by_image_dark  as string | undefined) || DEFAULT_PB_IMAGE_DARK;
  const pbImage = resolveBrandingImageUrl(resolvedTheme === 'dark' ? pbImageDark : pbImageLight);
  const pbUrl   = (tenant?.config?.powered_by_url   as string | undefined) || DEFAULT_PB_URL;
  const pbLabel = tenant?.config?.powered_by_label as string | undefined;

  const partnerLogoUrl  = resolveBrandingImageUrl(tenant?.config?.partner_logo_url as string | undefined);
  const partnerLogoLabel = tenant?.config?.partner_logo_label   as string | undefined;
  const partnerLinkUrl  = tenant?.config?.partner_logo_link_url as string | undefined;
  const partnerLabel = partnerLogoLabel || t('footer.community_partner');

  // Use tenant's footer_text from config if set, otherwise build a default
  const footerText = tenant?.config?.footer_text?.trim()
    || copyright
    || `${branding.name} — ${t('footer.agpl_notice', { year })}`;

  const contact = tenant?.contact;

  return (
    <footer className="relative z-10 hidden border-t border-theme-default mt-auto glass-surface backdrop-blur-sm md:block" data-nosnippet>
      <div className="hidden px-4 py-6 pb-[calc(var(--safe-area-bottom)+5rem)]">
        <div className="flex flex-col items-center gap-4">
          {/* Powered-by banner — always shown; defaults to NEXUS branding, overridable by God */}
          <a
            href={pbUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={pbLabel || t('footer.powered_by')}
            className="max-w-full transition-opacity hover:opacity-80"
          >
            <img src={pbImage} alt={pbLabel || t('footer.powered_by')} className="h-auto max-h-24 w-auto max-w-[15rem] object-contain" />
          </a>
          <SourceRepositoryLink compact className="w-full max-w-[18rem] justify-center" />
          {/* Tenant partner logo — real or placeholder */}
          {partnerLogoUrl ? (
            partnerLinkUrl ? (
              <a href={partnerLinkUrl} target="_blank" rel="noopener noreferrer" title={partnerLabel} aria-label={partnerLabel} className="max-w-full transition-opacity hover:opacity-80">
                <img src={partnerLogoUrl} alt={partnerLabel} className="max-h-16 w-auto max-w-44 object-contain" />
              </a>
            ) : (
              <img src={partnerLogoUrl} alt={partnerLabel} className="max-h-16 w-auto max-w-44 object-contain" />
            )
          ) : (
            <div className="w-full max-w-[22rem] border-2 border-dashed border-theme-default/40 rounded-xl h-16 flex items-center justify-center">
              <span className="text-xs text-theme-subtle/40">{t('footer.tenant_logo_placeholder')}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-theme-subtle/70">
            <span>{t('footer.agpl_notice', { year })}</span>
            <span aria-hidden="true">&middot;</span>
            <Link to={tenantPath('/platform/terms')} className="hover:text-theme-primary transition-colors">
              {t('footer.terms')}
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link to={tenantPath('/platform/privacy')} className="hover:text-theme-primary transition-colors">
              {t('footer.privacy')}
            </Link>
          </div>
        </div>
      </div>
      <div className="hidden md:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children ? (
          children
        ) : (
          <div className="space-y-8">
            {/* Footer Links Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
              {/* Brand + Contact */}
              <div className="space-y-3">
                <TenantLogo size="sm" showName />
                <p className="text-sm text-theme-subtle">
                  {branding.tagline || 'Building stronger communities through the exchange of time.'}
                </p>
                {/* Contact info from tenant bootstrap */}
                {contact && (
                  <div className="space-y-1.5 pt-1">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-1.5 text-sm text-theme-muted hover:text-theme-primary transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex items-center gap-1.5 text-sm text-theme-muted hover:text-theme-primary transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                        {contact.phone}
                      </a>
                    )}
                    {contact.location && (
                      <p className="flex items-center gap-1.5 text-sm text-theme-muted">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                        {contact.location}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Platform */}
              <nav aria-label={t('footer.platform')}>
                <h3 className="text-sm font-semibold text-theme-primary mb-3">{t('footer.platform')}</h3>
                <ul className="space-y-2">
                  <li><FooterLink href={tenantPath('/listings')}>{t('nav.listings')}</FooterLink></li>
                  {hasConnections && <li><FooterLink href={tenantPath('/members')}>{t('nav.members')}</FooterLink></li>}
                  {hasEvents && <li><FooterLink href={tenantPath('/events')}>{t('nav.events')}</FooterLink></li>}
                  {hasBlog && <li><FooterLink href={tenantPath('/blog')}>{t('nav.blog')}</FooterLink></li>}
                </ul>
              </nav>

              {/* Support */}
              <nav aria-label={t('footer.support')}>
                <h3 className="text-sm font-semibold text-theme-primary mb-3">{t('footer.support')}</h3>
                <ul className="space-y-2">
                  <li><FooterLink href={tenantPath('/help')}>{t('footer.help_center')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/kb')}>{t('nav.knowledge_base')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/trust-and-safety')}>{t('footer.trust_safety')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/contact')}>{t('footer.contact_us')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/about')}>{t('footer.about')}</FooterLink></li>
                  {/*
                    "Report a problem" intentionally removed from the footer: it is desktop-only
                    here, and the floating reporter (bottom-right, logged-in users only) already
                    covers desktop. Keeping both duplicated the entry point.
                  */}
                </ul>
              </nav>

              {/* Legal */}
              <nav aria-label={t('footer.legal')}>
                <h3 className="text-sm font-semibold text-theme-primary mb-3">{t('footer.legal')}</h3>
                <ul className="space-y-2">
                  <li><FooterLink href={tenantPath('/legal')}>{t('legal.legal_hub')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/terms')}>{t('legal.terms_of_service')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/privacy')}>{t('legal.privacy_policy')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/community-guidelines')}>{t('legal.type_community_guidelines')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/acceptable-use')}>{t('legal.type_acceptable_use')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/cookies')}>{t('legal.cookie_policy')}</FooterLink></li>
                  <li><FooterLink href={tenantPath('/accessibility')}>{t('legal.accessibility')}</FooterLink></li>
                </ul>
              </nav>
            </div>

            {/* Dynamic footer pages from admin CMS */}
            {tenant?.menu_pages?.footer?.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
                <div>
                  <h3 className="text-sm font-semibold text-theme-primary mb-3">{t('footer.pages')}</h3>
                  <ul className="space-y-2">
                    {tenant.menu_pages.footer.map((p) => (
                      <li key={p.slug}><FooterLink href={tenantPath(`/page/${p.slug}`)}>{p.title}</FooterLink></li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {/* Tenant Copyright */}
            <div className="border-t border-theme-default pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-theme-subtle">{footerText}</p>
              <Button
                variant="tertiary"
                size="sm"
                onPress={resetConsent}
                className="inline-flex min-h-7 min-w-0 items-center gap-1 px-1 text-xs text-theme-subtle transition-colors hover:text-theme-primary"
                aria-label={t('aria.cookie_settings')}
                startContent={<Cookie className="w-3 h-3" aria-hidden="true" />}
              >
                {t('footer.cookie_settings')}
              </Button>
            </div>

            {/* Release status — GA strip with Features + Changelog links */}
            <div className="border-t border-theme-default pt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-theme-subtle">
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>
                <span className="font-semibold text-theme-primary">{t('release_stage')}</span>
                {' — '}
                {t('release_status.summary')}
              </span>
              <span aria-hidden="true">&middot;</span>
              <Link
                to={RELEASE_STATUS.readMorePath}
                className="underline font-medium hover:text-theme-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent rounded whitespace-nowrap"
              >
                {t('release_status.features_link')}
              </Link>
              <span aria-hidden="true">&middot;</span>
              <Link
                to={tenantPath('/changelog')}
                className="underline font-medium hover:text-theme-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent rounded whitespace-nowrap"
              >
                {t('release_status.changelog_link')}
              </Link>
              <span aria-hidden="true">&middot;</span>
              {/* External: the documentation site is a separate domain, so this
                  opens in a new tab and says so to screen readers. */}
              <a
                href={PROJECT_NEXUS_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('release_status.docs_link_aria')}
                className="inline-flex items-center gap-1 underline font-medium hover:text-theme-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent rounded whitespace-nowrap"
              >
                {t('release_status.docs_link')}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
              </a>
            </div>

            {/* Platform Attribution — 3-column grid */}
            <div className="border-t border-theme-default pt-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 items-start">

                {/* COL 1: Community partner logo */}
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-theme-subtle/50">
                    {partnerLabel}
                  </span>
                  {partnerLogoUrl ? (
                    partnerLinkUrl ? (
                      <a href={partnerLinkUrl} target="_blank" rel="noopener noreferrer" title={partnerLabel} aria-label={partnerLabel} className="max-w-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent rounded-lg">
                        <img src={partnerLogoUrl} alt={partnerLabel} className="max-h-20 w-auto max-w-48 object-contain" />
                      </a>
                    ) : (
                      <img src={partnerLogoUrl} alt={partnerLabel} className="max-h-20 w-auto max-w-48 object-contain" />
                    )
                  ) : (
                    <div className="h-20 w-48 border-2 border-dashed border-theme-default/40 rounded-xl flex items-center justify-center">
                      <span className="text-xs text-theme-subtle/40 text-center leading-snug px-3">
                        {t('footer.tenant_logo_placeholder')}
                      </span>
                    </div>
                  )}
                </div>

                {/* COL 2: Open source */}
                <div className="flex flex-col items-start sm:items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-theme-subtle/50">
                    {t('footer.open_source')}
                  </span>
                  <SourceRepositoryLink />
                </div>

                {/* COL 3: Powered by — always shown; defaults to NEXUS branding, overridable by God */}
                <div className="flex min-w-0 flex-col items-start sm:items-end gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-theme-subtle/50">
                    {pbLabel || t('footer.powered_by')}
                  </span>
                  <a
                    href={pbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={pbLabel || t('footer.powered_by')}
                    aria-label={pbLabel || t('footer.powered_by')}
                    className="max-w-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent rounded-lg"
                  >
                    {/*
                      Cap BOTH axes. A height-only cap lets a wide wordmark scale out to
                      ~470px, past its native resolution, which renders pixelated. Square
                      marks stay bound by the height, wide ones by the width.
                    */}
                    <img
                      src={pbImage}
                      alt={pbLabel || t('footer.powered_by')}
                      className="h-auto max-h-28 w-auto max-w-[15rem] object-contain sm:max-w-[17rem]"
                    />
                  </a>
                </div>

              </div>

              {/* Legal strip */}
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-theme-subtle/70">
                <span>{t('footer.agpl_notice', { year })}</span>
                <span aria-hidden="true">&middot;</span>
                <Link to={tenantPath('/platform/terms')} className="hover:text-theme-primary transition-colors">
                  {t('footer.terms')}
                </Link>
                <span aria-hidden="true">&middot;</span>
                <Link to={tenantPath('/platform/privacy')} className="hover:text-theme-primary transition-colors">
                  {t('footer.privacy')}
                </Link>
                <span
                  className="hidden"
                  aria-hidden="true"
                  data-build-commit={__BUILD_COMMIT__}
                  data-build-time={__BUILD_TIME__}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </footer>
  );
}

/**
 * FooterLink - Subtle link styled for footer
 */
export interface FooterLinkProps {
  href: string;
  children: ReactNode;
}

export function FooterLink({ href, children }: FooterLinkProps) {
  return (
    <Link
      to={href}
      className="text-sm text-theme-muted hover:text-theme-primary transition-colors"
    >
      {children}
    </Link>
  );
}

export default Footer;
