// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Main Layout Component
 * Wraps all pages with navigation, footer, and background
 */

import { lazy, Suspense, useState, useCallback, type CSSProperties } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Navbar } from './Navbar';
import { MobileDrawer } from './MobileDrawer';
import { MobileTabBar } from './MobileTabBar';
import { Footer } from './Footer';
import { SourceRepositoryLink } from './SourceRepositoryLink';
import { BackToTop } from '@/components/ui/BackToTop';
import { OfflineIndicator } from '@/components/feedback/OfflineIndicator';
import { PageTransition } from '@/components/layout/PageTransition';
import { InstallModalHost } from '@/components/pwa/InstallModalHost';
import { SessionExpiredModal } from '@/components/feedback/SessionExpiredModal';
import { SessionTimeoutWarning } from '@/components/feedback/SessionTimeoutWarning';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { SeoHead } from '@/components/seo/SeoHead';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

const EmergencyAlertBanner = lazy(() => import('@/components/caring-community/EmergencyAlertBanner'));
const FadpConsentBanner = lazy(() => import('@/components/legal/FadpConsentBanner').then((mod) => ({
  default: mod.FadpConsentBanner,
})));
const FloatingReportProblemButton = lazy(() => import('@/components/feedback/FloatingReportProblemButton'));
const PodcastMiniPlayer = lazy(() => import('@/components/podcasts/PodcastMiniPlayer').then((mod) => ({
  default: mod.PodcastMiniPlayer,
})));

interface LayoutProps {
  /**
   * Whether to show the footer (default: true)
   */
  showFooter?: boolean;

  /**
   * Whether to show the navbar (default: true)
   */
  showNavbar?: boolean;

  /**
   * Whether to add padding for the fixed navbar (default: true)
   */
  withNavbarPadding?: boolean;
}

export function Layout({
  showFooter = true,
  showNavbar = true,
  withNavbarPadding = true,
}: LayoutProps) {
  const { t } = useTranslation('common');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleMobileMenuOpen = useCallback(() => setIsMobileMenuOpen(true), []);
  const handleMobileMenuClose = useCallback(() => setIsMobileMenuOpen(false), []);
  const handleSearchOpen = useCallback(() => setIsSearchOpen(true), []);
  const handleSearchOpenChange = useCallback((open: boolean) => setIsSearchOpen(open), []);

  // Listen for API errors and display toast notifications
  useApiErrorHandler();

  // Scroll state for dynamic padding — when utility bar hides, reduce top padding
  const { isUtilityBarVisible } = useHeaderScroll(48);

  const { isAuthenticated } = useAuth();
  const { branding, hasFeature } = useTenant();

  return (
    <div className="min-h-screen max-w-[100vw] flex flex-col overflow-x-clip">
      {/* Global SEO tags (verification meta, Organization JSON-LD) */}
      <SeoHead />

      {/* Skip navigation — visible on keyboard focus only (WCAG 2.4.1 + 2.4.7) */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-[9999] focus-visible:px-4 focus-visible:py-2 focus-visible:bg-[var(--color-primary)] focus-visible:text-white focus-visible:rounded-lg focus-visible:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t('accessibility.skip_to_content')}
      </a>

      {/* Impersonation notice + exit — renders only in an impersonated tab */}
      <ImpersonationBanner />

      {/* Offline indicator */}
      <OfflineIndicator />

      {/* Global install-instructions modal host — survives when triggers unmount */}
      <InstallModalHost />

      {/* Navigation */}
      {showNavbar && (
        <>
          <Navbar
            onMobileMenuOpen={handleMobileMenuOpen}
            externalSearchOpen={isSearchOpen}
            onSearchOpenChange={handleSearchOpenChange}
            isMobileMenuOpen={isMobileMenuOpen}
          />
          <MobileDrawer
            isOpen={isMobileMenuOpen}
            onClose={handleMobileMenuClose}
            onSearchOpen={handleSearchOpen}
          />
        </>
      )}

      {/* Main Content — padding adapts when utility bar hides on scroll */}
      <main
        id="main-content"
        tabIndex={-1}
        // --logo-extra grows the top offset to match the navbar when it expands
        // for a tall square/stacked logo; 0 for wide/landscape (compact bar).
        // Applied at sm+ only: on mobile the navbar collapses the logo to a
        // compact icon (see TenantLogo collapseLogoOnMobile), so the bar never
        // grows there and the extra offset would just leave a dead gap.
        style={{
          '--logo-extra': branding.logoShape === 'square' ? '1.75rem' : '0rem',
          '--app-header-mobile-offset': withNavbarPadding && showNavbar
            ? 'calc(var(--safe-area-top) + 3.5rem)'
            : '0px',
          '--app-header-desktop-offset': withNavbarPadding && showNavbar
            ? isUtilityBarVisible
              ? 'calc(var(--safe-area-top) + 7.5rem + var(--logo-extra, 0rem))'
              : 'calc(var(--safe-area-top) + 5.5rem + var(--logo-extra, 0rem))'
            : '0px',
        } as CSSProperties}
        className={`flex-1 relative z-10 min-w-0 transition-[padding-top] duration-200 ${
          withNavbarPadding && showNavbar
            ? isUtilityBarVisible
              ? 'pt-[calc(var(--safe-area-top)+3.5rem)] sm:pt-[calc(var(--safe-area-top)+7.5rem+var(--logo-extra,0rem))]'
              : 'pt-[calc(var(--safe-area-top)+3.5rem)] sm:pt-[calc(var(--safe-area-top)+5.5rem+var(--logo-extra,0rem))]'
            : ''
        }`}
      >
        {/* AG70 — Emergency/safety alert banner (caring community tenants only) */}
        {hasFeature('caring_community') && (
          <Suspense fallback={null}>
            <EmergencyAlertBanner />
          </Suspense>
        )}

        {/* AG42 — Swiss FADP consent banner (fadp_compliance feature tenants only) */}
        {hasFeature('fadp_compliance') && (
          <Suspense fallback={null}>
            <FadpConsentBanner />
          </Suspense>
        )}

        {/* The one-time PWA install banner used to render here. Withdrawn
            2026-08-12 (owner instruction): its install path does not work on
            Apple devices, so the banner promised something a large share of
            members could not do. The install affordance now lives on the
            /install-app page, which is honest about which devices work today.
            <InstallBanner /> is still in the tree (components/pwa) so it can be
            put back once Safari/iOS install is fixed. */}

        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8 min-w-0">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
      </main>

      {/* Footer */}
      {showFooter && <Footer />}

      {/* Persistent podcast mini-player (renders only while a track is loaded) */}
      {isAuthenticated && hasFeature('podcasts') && (
        <Suspense fallback={null}>
          <PodcastMiniPlayer tabBarMayShow={showNavbar} />
        </Suspense>
      )}

      {/* Mobile bottom tab bar */}
      {showNavbar && <MobileTabBar onMenuOpen={handleMobileMenuOpen} isMenuOpen={isMobileMenuOpen} />}

      {/* Same-page support capture */}
      {showNavbar && isAuthenticated && (
        <Suspense fallback={null}>
          <FloatingReportProblemButton />
        </Suspense>
      )}

      {/* Back to top button */}
      <BackToTop />

      {/* WCAG 2.2.1 — warns ≥ 30 s before session token expires */}
      <SessionTimeoutWarning />

      {/* Session Expired Modal */}
      <SessionExpiredModal />

    </div>
  );
}

/**
 * Auth Layout - simplified layout for auth pages (no navbar/footer)
 */
export function AuthLayout() {
  const { t } = useTranslation('common');
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen max-w-[100vw] flex flex-col overflow-x-clip">
      {/* Skip navigation — visible on keyboard focus only (WCAG 2.4.1 + 2.4.7) */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-[9999] focus-visible:px-4 focus-visible:py-2 focus-visible:bg-[var(--color-primary)] focus-visible:text-white focus-visible:rounded-lg focus-visible:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t('accessibility.skip_to_content')}
      </a>

      {/* Language switcher — top-right on auth pages */}
      <div className="absolute top-[calc(var(--safe-area-top)+1rem)] right-[calc(var(--safe-area-right)+1rem)] z-20">
        <LanguageSwitcher
          triggerClassName="border border-theme-default bg-theme-elevated text-theme-primary shadow-sm backdrop-blur hover:border-theme-primary/40 hover:bg-theme-hover"
        />
      </div>

      {/* Main Content */}
      <main id="main-content" className="relative z-10 flex-1">
        <Outlet />
      </main>

      {/* Attribution (AGPL Section 7(b) — required on all pages) */}
      <footer className="relative z-10 px-4 py-4 pb-[calc(var(--safe-area-bottom)+1rem)] text-center" data-nosnippet>
        <div className="flex flex-col items-center justify-center gap-2">
          <SourceRepositoryLink compact className="max-w-[18rem] justify-center" />
          <p className="text-xs text-theme-subtle">
            <span className="font-medium text-theme-secondary">{t('footer.project_nexus')}</span>
            <span aria-hidden="true"> &middot; </span>
            <span>{t('footer.agpl_notice', { year })}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
