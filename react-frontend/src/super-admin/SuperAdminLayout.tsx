// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Layout Shell
 * Dedicated shell for platform-wide operations, separate from the tenant
 * admin sidebar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SuperAdminHeader } from './components/SuperAdminHeader';
import { SuperAdminSidebar } from './components/SuperAdminSidebar';
import { SuperAdminBreadcrumbs } from './components/SuperAdminBreadcrumbs';
import { PlatformNoticeBand } from '@/admin/components/PlatformNoticeBand';

export function SuperAdminLayout() {
  const { t } = useTranslation('super_admin');
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

  const openMobileDrawer = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileDrawerOpen(true);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

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

  useEffect(() => {
    if (!mobileDrawerOpen) return;

    const focusableSelector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileDrawer();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileDrawerOpen, closeMobileDrawer]);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[9999] focus-visible:rounded-lg focus-visible:bg-[var(--color-primary)] focus-visible:px-4 focus-visible:py-2 focus-visible:text-white focus-visible:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t('layout.skip_to_main')}
      </a>

      <div className="hidden md:block">
        <SuperAdminSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
        />
      </div>

      <SuperAdminHeader
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => mobileDrawerOpen ? closeMobileDrawer() : openMobileDrawer()}
      />

      {mobileDrawerOpen && (
        <button
          type="button"
          aria-label={t('layout.close_navigation')}
          className="fixed inset-0 z-30 h-full w-full cursor-default bg-black/50 md:hidden"
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
        <SuperAdminSidebar collapsed={false} onToggle={closeMobileDrawer} />
      </div>

      <main
        id="main-content"
        tabIndex={-1}
        className={`min-h-screen pt-16 outline-none transition-all duration-300 ${
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
        }`}
      >
        <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-4 md:p-6">
          {/* A notice from the platform team to every community's admins. */}
          <PlatformNoticeBand />
          <SuperAdminBreadcrumbs />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default SuperAdminLayout;
