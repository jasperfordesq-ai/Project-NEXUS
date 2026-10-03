// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Layout Shell
 * Provides the broker sidebar + header + content area.
 * Simplified version of AdminLayout for broker users.
 *
 * Owns the sidebar badge counts so we only fetch them once even though we
 * mount two BrokerSidebar instances (desktop fixed + mobile drawer).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminBroker, adminUsers, adminMatching } from '@/admin/api/adminApi';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { isAdminTierUser } from '@/lib/access';
import type { MatchApprovalStats } from '@/admin/api/types';
import { BROKER_BADGES_REFRESH_EVENT } from '@/admin/modules/safeguarding/safeguardingShared';
import { BrokerSidebar, type BrokerBadgeCounts } from './components/BrokerSidebar';
import { BrokerHeader } from './components/BrokerHeader';
import { BrokerBreadcrumbs } from './components/BrokerBreadcrumbs';
import { BrokerCommandPalette } from './components/BrokerCommandPalette';
import { JurisdictionNotice } from '@/components/safeguarding/JurisdictionNotice';

const EMPTY_BADGES: BrokerBadgeCounts = {
  pending_members: 0,
  safeguarding_alerts: 0,
  vetting_review_requests: 0,
  pending_exchanges: 0,
  unreviewed_messages: 0,
  monitored_users: 0,
  high_risk_listings: 0,
  pending_matches: 0,
  support_needs_unseen: 0,
  pending_support_actions: 0,
};

export function BrokerLayout() {
  const { t } = useTranslation('broker');
  const { hasFeature } = useTenant();
  const showMatches = hasFeature('exchange_workflow');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [badges, setBadges] = useState<BrokerBadgeCounts>(EMPTY_BADGES);
  // From the dashboard read the badges already make, so the "jurisdiction not
  // set" notice costs no extra request. Only an explicit `false` shows it —
  // unknown (null) must not cry wolf.
  const [jurisdictionConfigured, setJurisdictionConfigured] = useState<boolean | null>(null);
  const { user } = useAuth();
  const { pathname } = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileDrawerOpen(false);
  }

  const fetchBadges = useCallback(async () => {
    try {
      const [dashRes, usersRes, matchRes, safeguardingRes] = await Promise.all([
        adminBroker.getDashboard(),
        adminUsers.list({ status: 'pending', limit: 1 }),
        // Match approvals only exist on exchange_workflow tenants; a null
        // placeholder keeps Promise.all's shape stable without the request.
        showMatches
          ? adminMatching.getApprovalStats(30).catch(() => null)
          : Promise.resolve(null),
        // The safeguarding pages' own counts, from the endpoint those pages
        // read, so a badge always matches the list it sits beside.
        api
          .get<{ support_needs_unseen?: number; pending_support_actions?: number }>('/v2/admin/safeguarding/dashboard')
          .catch(() => null),
      ]);

      const safeguarding = safeguardingRes?.success && safeguardingRes.data ? safeguardingRes.data : null;

      let pendingMembers = 0;
      if (usersRes.success) {
        // api client unwrap: the row array is usersRes.data and the pagination
        // meta is usersRes.meta — the request uses limit=1 as a cheap count, so
        // counting rows here would cap the badge at 1.
        if (typeof usersRes.meta?.total === 'number') {
          pendingMembers = usersRes.meta.total;
        } else if (usersRes.data) {
          const payload = usersRes.data as unknown;
          if (Array.isArray(payload)) {
            pendingMembers = payload.length;
          } else if (payload && typeof payload === 'object') {
            const paged = payload as { data?: unknown[]; meta?: { total?: number } };
            pendingMembers = paged.meta?.total ?? paged.data?.length ?? 0;
          }
        }
      }

      let pendingMatches = 0;
      if (matchRes?.success && matchRes.data) {
        const payload = matchRes.data as unknown;
        const stats =
          payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
            ? (payload as { data: MatchApprovalStats }).data
            : (payload as MatchApprovalStats);
        pendingMatches = Number(stats?.pending_count ?? 0);
      }

      if (dashRes.success && dashRes.data) {
        const d = dashRes.data as unknown as Record<string, unknown>;
        setBadges({
          pending_members: pendingMembers,
          safeguarding_alerts: Number(d.safeguarding_alerts ?? 0),
          vetting_review_requests: Number(d.vetting_review_requests ?? 0),
          pending_exchanges: Number(d.pending_exchanges ?? 0),
          unreviewed_messages: Number(d.unreviewed_messages ?? 0),
          monitored_users: Number(d.monitored_users ?? 0),
          high_risk_listings: Number(d.high_risk_listings ?? 0),
          pending_matches: pendingMatches,
          support_needs_unseen: Number(safeguarding?.support_needs_unseen ?? 0),
          pending_support_actions: Number(safeguarding?.pending_support_actions ?? 0),
        });
        const configured = d.safeguarding_jurisdiction_configured;
        setJurisdictionConfigured(typeof configured === 'boolean' ? configured : null);
      }
    } catch {
      // Badges are non-critical — silently fail (e.g. on 401/403/network).
    }
  }, [showMatches]);

  useEffect(() => {
    void fetchBadges();
    const interval = setInterval(() => void fetchBadges(), 60_000);
    // Pages fire this after an action that changes a count (e.g. "Mark as
    // seen"), so the badge moves at once instead of up to a minute later.
    const onRefresh = () => void fetchBadges();
    window.addEventListener(BROKER_BADGES_REFRESH_EVENT, onRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener(BROKER_BADGES_REFRESH_EVENT, onRefresh);
    };
  }, [fetchBadges]);

  // Scopes the broker panel's text-contrast tokens (tokens.css, "BROKER
  // PANEL — TEXT CONTRAST"). Set on <html>, not on this layout's own element,
  // so modals, popovers and toasts — rendered in portals outside it — get
  // the same readable colours.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-panel', 'broker');
    return () => root.removeAttribute('data-panel');
  }, []);

  // ⌘K / Ctrl+K opens the command palette from anywhere in the panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        <BrokerSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
          badges={badges}
        />
      </div>

      <BrokerHeader
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => mobileDrawerOpen ? closeMobileDrawer() : openMobileDrawer()}
        onOpenSearch={() => setPaletteOpen(true)}
      />

      <BrokerCommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />

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
        <BrokerSidebar
          collapsed={false}
          onToggle={closeMobileDrawer}
          badges={badges}
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
          <BrokerBreadcrumbs />
          {jurisdictionConfigured === false && <JurisdictionNotice canSet={isAdminTierUser(user)} />}
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default BrokerLayout;
