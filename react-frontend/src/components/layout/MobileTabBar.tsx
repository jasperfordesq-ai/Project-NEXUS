// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mobile Bottom Tab Bar
 * Fixed navigation bar at the bottom of the screen on mobile devices.
 * Shows up to 5 tabs: Feed, Listings, Create, Messages, Menu.
 * Only visible when the user is authenticated and not on auth pages.
 *
 * 🔴 Breakpoint: `lg:hidden`, NOT `md:hidden`. It must stay aligned with the
 * desktop navigation's `hidden lg:flex` in Navbar.tsx, because those two are the
 * only primary navigation an authenticated member has — the hamburger that opens
 * MobileDrawer is deliberately rendered for guests only. When this bar was
 * `md:hidden` there was a dead band from 768px to 1023px in which a signed-in
 * member had NO navigation at all: the bar had gone and the desktop nav had not
 * yet appeared. A phone in landscape is 844–932px, so it landed squarely in that
 * band. If you change this breakpoint, change Navbar's to match, and also update
 * the `[data-mobile-tabbar]` media query in index.css and the mini-player offset
 * in PodcastMiniPlayer.tsx.
 */

import React, { useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import { Badge } from '@/components/ui/Badge';
import Newspaper from 'lucide-react/icons/newspaper';
import ListTodo from 'lucide-react/icons/list-todo';
import Plus from 'lucide-react/icons/plus';
import MessageSquare from 'lucide-react/icons/message-square';
import Menu from 'lucide-react/icons/menu';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { QuickCreateMenu } from './QuickCreateMenu';
import { Button } from '@/components/ui/Button';

interface MobileTabBarProps {
  onMenuOpen?: () => void;
  /** Whether the mobile drawer is currently open — hides tab bar when true */
  isMenuOpen?: boolean;
}

/** Routes where the tab bar should be hidden */
const hiddenRoutes = ['/login', '/register', '/password/forgot', '/password/reset', '/onboarding'];

/**
 * Route patterns where the tab bar is hidden so the page can own the full
 * viewport height (native-messenger style). Routes are tenant-prefixed
 * (`/:tenantSlug/messages/123`) or root-level (`/messages/123`), so match on
 * pattern rather than literal prefixes. Conversation threads
 * (`/messages/:id`, `/messages/new/:userId`) hide the bar; the `/messages`
 * list itself keeps it.
 */
const hiddenRoutePatterns: RegExp[] = [
  /^\/(?:[^/]+\/)?messages\/(?:new\/)?\d+\/?$/,
];

/**
 * Whether the mobile tab bar renders on the current route/auth state.
 * Shared with components that stack above it (e.g. the podcast mini-player)
 * so their bottom offsets can never drift from the tab bar's own rules.
 * CSS (`md:hidden`) still controls the desktop case.
 */
export function useMobileTabBarVisible(): boolean {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    isAuthenticated
    && !hiddenRoutes.some((route) => location.pathname.includes(route))
    && !hiddenRoutePatterns.some((pattern) => pattern.test(location.pathname))
  );
}

export function MobileTabBar({ onMenuOpen, isMenuOpen }: MobileTabBarProps) {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const visible = useMobileTabBarVisible();
  const { hasModule, tenantPath } = useTenant();
  const { counts } = useNotificationsOptional();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const handleCreateOpen = useCallback(() => setIsCreateOpen(true), []);
  const handleCreateClose = useCallback(() => setIsCreateOpen(false), []);

  // Native-app chrome behavior: slide away on scroll-down, return on
  // scroll-up or near the top. Shares the top navbar's scroll semantics.
  const { isUtilityBarVisible } = useHeaderScroll(64);
  const isHidden = isMenuOpen || isCreateOpen || !isUtilityBarVisible;

  // Don't render for unauthenticated users or on auth/onboarding pages
  if (!visible) return null;

  const currentPath = location.pathname;

  const isActive = (path: string) => {
    if (path.endsWith('/dashboard')) {
      return currentPath.endsWith('/dashboard') || currentPath === '/' || currentPath.match(/^\/[^/]+\/?$/);
    }
    return currentPath.includes(path.replace(tenantPath(''), ''));
  };

  // Build tabs dynamically based on enabled modules
  const tabs: {
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>;
    path?: string;
    action?: () => void;
    isCreate?: boolean;
    badgeCount?: number;
    module?: string;
  }[] = [
    { key: 'feed',     label: t('nav.feed'),     icon: Newspaper,     path: tenantPath('/feed'), module: 'feed' },
    { key: 'listings', label: t('nav.listings'), icon: ListTodo,      path: tenantPath('/listings'),  module: 'listings' },
    { key: 'create',   label: t('mobile_tab.create'),   icon: Plus,          action: handleCreateOpen,       isCreate: true },
    { key: 'messages', label: t('nav.messages'), icon: MessageSquare, path: tenantPath('/messages'),  badgeCount: counts.messages, module: 'messages' },
    { key: 'menu',     label: t('mobile_tab.menu'),     icon: Menu,          action: onMenuOpen },
  ];

  const visibleTabs = tabs.filter((tab) => {
    if (!tab.module) return true;
    return hasModule(tab.module as never);
  });

  return (
    <>
      {/* Spacer so page content isn't hidden behind the fixed bar */}
      {/* Spacer matches tab bar height + safe-area bottom so content isn't hidden behind it */}
      <div className="h-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:hidden" aria-hidden="true" />

      <nav
        data-mobile-tabbar
        className={`fixed bottom-0 left-0 right-0 z-300 pb-[env(safe-area-inset-bottom,0px)] lg:hidden transition-all duration-200 ${isHidden ? 'translate-y-[calc(100%+12px)] pointer-events-none' : ''}`}
        aria-label={t('aria.mobile_navigation')}
      >
        {/* Glass surface */}
        <div className="bg-[var(--glass-bg)] backdrop-blur-xl border-t border-[var(--border-default)] shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
          <div className="flex h-16 items-stretch ps-[calc(var(--safe-area-left)+0.25rem)] pe-[calc(var(--safe-area-right)+0.25rem)]">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.path ? isActive(tab.path) : false;

              /* ── Create FAB ────────────────────────────── */
              if (tab.isCreate) {
                return (
                  <div
                    key={tab.key}
                    className="relative min-w-0 flex-1"
                  >
                    <div className="absolute start-1/2 top-[-1rem] -translate-x-1/2 rtl:translate-x-1/2">
                      <Button
                        isIconOnly
                        radius="full"
                        onPress={tab.action}
                        className="w-[52px] h-[52px] min-w-0 bg-gradient-to-br from-accent to-accent-gradient-end text-white shadow-lg shadow-accent/40 hover:shadow-accent/60 hover:scale-105 active:scale-95 transition-all duration-200"
                        // Same stable per-tab hook as the regular tabs below.
                        data-mobile-tab={tab.key}
                        aria-label={t('mobile_tab.create_new_content')}
                      >
                        <motion.div
                          animate={{ rotate: isCreateOpen ? 45 : 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        >
                          <Plus className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
                        </motion.div>
                      </Button>
                    </div>
                    <span
                      data-mobile-tab-label
                      className="pointer-events-none absolute inset-x-0 bottom-4 truncate px-1 text-center text-[10px] font-medium leading-none text-theme-subtle"
                    >
                      {tab.label}
                    </span>
                  </div>
                );
              }

              /* ── Regular tab ───────────────────────────── */
              const hasBadge = (tab.badgeCount ?? 0) > 0;

              const tabButton = (
                <Button
                  variant="light"
                  radius="lg"
                  onPress={() => {
                    if (tab.action) tab.action();
                    else if (tab.path) navigate(tab.path);
                  }}
                  className={`
                    relative flex flex-col items-center justify-center flex-1 h-full gap-0.5
                    min-w-0 px-1 py-1.5 rounded-none
                    transition-colors duration-150
                    ${active
                      ? 'text-accent dark:text-accent'
                      : 'text-theme-muted hover:text-theme-primary'
                    }
                  `}
                  // Stable per-tab hook for the E2E suite. `aria-label` is the
                  // translated tab name, so it cannot identify a tab reliably;
                  // `tab.key` can. Same convention as `data-mobile-tab-label`.
                  data-mobile-tab={tab.key}
                  aria-label={tab.label}
                  aria-current={active ? 'page' : undefined}
                >
                  {/* Active background pill — always rendered, opacity-driven */}
                  <div
                    className={`absolute inset-x-2 top-1.5 h-8 rounded-xl transition-opacity duration-200 ${
                      active
                        ? 'opacity-100 bg-accent/10 dark:bg-accent/10'
                        : 'opacity-0'
                    }`}
                  />

                  <div className="absolute inset-0 z-10">
                    <Icon
                      className={`absolute start-1/2 top-3 w-5 h-5 -translate-x-1/2 transition-transform duration-150 rtl:translate-x-1/2 ${active ? 'scale-110' : ''}`}
                      strokeWidth={active ? 2.5 : 2}
                      aria-hidden="true"
                    />
                    <span
                      data-mobile-tab-label
                      className="pointer-events-none absolute inset-x-0 bottom-4 truncate px-1 text-center text-[10px] font-medium leading-none"
                    >
                      {tab.label}
                    </span>
                  </div>

                  {/* Active indicator dot — always rendered, opacity-driven */}
                  <div
                    className={`absolute bottom-1.5 w-1 h-1 rounded-full transition-opacity duration-200 ${
                      active
                        ? 'opacity-100 bg-accent dark:bg-accent'
                        : 'opacity-0'
                    }`}
                  />
                </Button>
              );

              // Always wrap in Badge — use isInvisible to avoid DOM structure changes on count update
              if (tab.badgeCount !== undefined) {
                return (
                  <Badge
                    key={tab.key}
                    content={hasBadge ? (tab.badgeCount! > 99 ? '99+' : tab.badgeCount) : 0}
                    color="danger"
                    size="sm"
                    placement="top-right"
                    isInvisible={!hasBadge}
                    classNames={{ base: 'flex min-w-0 flex-1' }}
                    className="translate-x-[-8px] translate-y-[6px]"
                  >
                    {tabButton}
                  </Badge>
                );
              }

              return <React.Fragment key={tab.key}>{tabButton}</React.Fragment>;
            })}
          </div>
        </div>
      </nav>

      {/* Quick Create Menu Modal */}
      <QuickCreateMenu isOpen={isCreateOpen} onClose={handleCreateClose} />
    </>
  );
}

export default MobileTabBar;
