// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks Layout Shell
 * Sidebar + header + content area for the super-admin Partner Timebanks
 * panel. Mirrors BrokerLayout, minus the badge polling and command palette
 * (this is a low-frequency configuration area, not a daily work queue).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PartnersSidebar } from './components/PartnersSidebar';
import { PartnersHeader } from './components/PartnersHeader';
import { PartnersBreadcrumbs } from './components/PartnersBreadcrumbs';
import { ExternalFederationBanner } from './components/ExternalFederationBanner';

export function PartnersLayout() {
  const { t } = useTranslation('partners');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileDrawerOpen(false);
  }

  // Focus management for mobile drawer
  const openMobileDrawer = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileDrawerOpen(true);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  // Move focus into drawer on open, return it on close
  useEffect(() => {
    if (mobileDrawerOpen) {
      const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(focusableSelector);
      firstFocusable?.focus();
    } else {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [mobileDrawerOpen]);

  // Escape key and Tab-trap for mobile drawer
  useEffect(() => {
    if (!mobileDrawerOpen) return;

    const focusableSelector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeMobileDrawer(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileDrawerOpen, closeMobileDrawer]);

  return (
    <div className="min-h-screen bg-background">
      {/* Skip navigation — screen-reader / keyboard users jump straight to content */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[9999] focus-visible:rounded-lg focus-visible:bg-[var(--color-primary)] focus-visible:px-4 focus-visible:py-2 focus-visible:text-white focus-visible:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t('layout.skip_to_main')}
      </a>

      {/* Desktop fixed sidebar — md+ only */}
      <div className="hidden md:block">
        <PartnersSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
        />
      </div>

      <PartnersHeader
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => mobileDrawerOpen ? closeMobileDrawer() : openMobileDrawer()}
      />

      {mobileDrawerOpen && (
        <button
          type="button"
          aria-label={t('layout.close_navigation')}
          className="fixed inset-0 z-30 w-full h-full cursor-default bg-black/50 md:hidden"
          onClick={closeMobileDrawer}
        />
      )}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('layout.navigation')}
        inert={!mobileDrawerOpen || undefined}
        className={`fixed left-0 top-0 z-40 h-[100dvh] w-64 max-w-[calc(100dvw-var(--safe-area-left)-var(--safe-area-right))] border-r border-divider bg-surface transition-transform duration-300 md:hidden ${
          mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <PartnersSidebar
          collapsed={false}
          onToggle={closeMobileDrawer}
        />
      </div>

      <main
        id="main-content"
        tabIndex={-1}
        className={`min-h-screen pt-16 transition-all duration-300 outline-none ${
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
        }`}
      >
        <div className="p-3 sm:p-4 md:p-6">
          <PartnersBreadcrumbs />
          {/* Shown on every page in this panel while external partner
              federation is switched off — see ExternalFederationBanner. */}
          <ExternalFederationBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default PartnersLayout;
