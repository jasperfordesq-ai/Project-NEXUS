// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Layout Shell
 * Provides the admin sidebar + header + content area.
 * All admin pages render inside this layout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminSidebar } from './components/AdminSidebar';
import { AdminHeader } from './components/AdminHeader';
import { AdminBreadcrumbs } from './components/AdminBreadcrumbs';
import { AdminMetaProvider, AdminMetaTags } from './AdminMetaContext';
import { adminVetting } from './api/adminApi';
import { useAuth } from '@/contexts';
import { isAdminTierUser } from '@/lib/access';
import { JurisdictionNotice } from '@/components/safeguarding/JurisdictionNotice';
export function AdminLayout() {
  const { t } = useTranslation('admin_nav');
  const defaultMeta = useMemo(() => ({
    title: t('admin'),
    description: t('admin_meta_description'),
  }), [t]);

  return (
    <AdminMetaProvider defaultMeta={defaultMeta}>
      <AdminLayoutShell />
    </AdminMetaProvider>
  );
}

function AdminLayoutShell() {
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

  const { t } = useTranslation('admin_nav');
  const { user } = useAuth();

  // The same "safeguarding jurisdiction not set" notice the broker panel
  // shows on every page (owner decision, 3 Oct 2026): admins are the only
  // people who can set it, and some never open the broker panel. Read once
  // per visit to the admin panel; only an explicit "not configured" shows
  // it, so a failed read never cries wolf.
  const [jurisdictionConfigured, setJurisdictionConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    adminVetting.policy()
      .then((res) => {
        if (cancelled || !res.success || !res.data?.policy) return;
        setJurisdictionConfigured(res.data.policy.configured === true);
      })
      .catch(() => { /* unknown — show nothing */ });
    return () => { cancelled = true; };
  }, []);

  const openMobileDrawer = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileDrawerOpen(true);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  // Move focus into drawer on open, return to trigger on close
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
        {t('skip_to_main')}
      </a>
      <AdminMetaTags />
      {/* Sidebar — hidden on mobile, shown on md+ */}
      <div className="hidden md:block">
        <AdminSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
        />
      </div>

      {/* Header */}
      <AdminHeader sidebarCollapsed={sidebarCollapsed} onSidebarToggle={() => mobileDrawerOpen ? closeMobileDrawer() : openMobileDrawer()} />

      {/* Mobile sidebar overlay */}
      {mobileDrawerOpen && (
        <button
          type="button"
          aria-label={t('close_sidebar')}
          className="fixed inset-0 z-30 w-full cursor-default bg-black/50 md:hidden"
          onClick={closeMobileDrawer}
        />
      )}
      {/* Mobile sidebar drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('admin_navigation')}
        inert={!mobileDrawerOpen || undefined}
        className={`fixed left-0 top-0 z-40 h-[100dvh] w-64 max-w-[calc(100dvw-var(--safe-area-left)-var(--safe-area-right))] border-r border-divider bg-surface transition-transform duration-300 md:hidden ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <AdminSidebar
          collapsed={false}
          onToggle={closeMobileDrawer}
        />
      </div>

      {/* Main content */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`min-h-screen pt-16 transition-all duration-300 outline-none ${
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'
        }`}
      >
        <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-4 md:p-6">
          <AdminBreadcrumbs />
          {jurisdictionConfigured === false && <JurisdictionNotice canSet={isAdminTierUser(user)} />}
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;
