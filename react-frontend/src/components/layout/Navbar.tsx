// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Main Navigation Bar
 * Responsive header with utility bar, desktop nav, and mobile menu trigger.
 * Desktop uses grouped dropdowns and a mega menu for cleaner layout.
 * Theme-aware styling for light and dark modes.
 */

import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';

import ListTodo from 'lucide-react/icons/list-todo';
import Wallet from 'lucide-react/icons/wallet';
import Users from 'lucide-react/icons/users';
import Calendar from 'lucide-react/icons/calendar';
import Settings from 'lucide-react/icons/settings';
import LogOut from 'lucide-react/icons/log-out';
import Menu from 'lucide-react/icons/menu';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import ChevronDown from 'lucide-react/icons/chevron-down';
import UserCircle from 'lucide-react/icons/circle-user';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import FileText from 'lucide-react/icons/file-text';
import Shield from 'lucide-react/icons/shield';
import Fingerprint from 'lucide-react/icons/fingerprint';
import ShieldCheck from 'lucide-react/icons/shield-check';
import BadgeCheck from 'lucide-react/icons/badge-check';
import ExternalLink from 'lucide-react/icons/external-link';
import Download from 'lucide-react/icons/download';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useMenuContext } from '@/contexts/MenuContextCore';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { canCreateEvents, hasAdminPanelAccess, hasBrokerPanelAccess, isPlatformSuperAdminUser } from '@/lib/access';
import { buildAccessibleFrontendUrl } from '@/lib/accessible-frontend';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { DesktopMenuItems } from '@/components/navigation';
import { SearchOverlay } from '@/components/layout/SearchOverlay';
import { MegaMenu } from '@/components/layout/MegaMenu';
import { DesktopNavPanel, type DesktopNavPanelSection } from '@/components/layout/DesktopNavPanel';
import { ThemePicker } from '@/components/layout/ThemePicker';
import { TenantLogo } from '@/components/branding';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useAppBarTitle } from '@/hooks/useAppBarTitle';
import {
  getNavigationItems,
  type DesktopNavigationSection,
  type NavigationItemPolicy,
} from '@/components/navigation/navigationRegistry';
import type { TenantFeatures } from '@/types/api';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection } from '@/components/ui/Dropdown';
import { Kbd } from '@/components/ui/Kbd';
import { Tooltip } from '@/components/ui/Tooltip';
interface IdentityStatusResponse {
  has_id_verified_badge: boolean;
}

const NotificationFlyout = lazy(() =>
  import('@/components/layout/NotificationFlyout').then((module) => ({
    default: module.NotificationFlyout,
  })),
);
const PresenceIndicator = lazy(() =>
  import('@/components/social/PresenceIndicator').then((module) => ({
    default: module.PresenceIndicator,
  })),
);
const StatusSelector = lazy(() =>
  import('@/components/social/StatusSelector').then((module) => ({
    default: module.StatusSelector,
  })),
);

interface NavbarProps {
  /** Opens mobile drawer — only used for unauthenticated users (authenticated users use MobileTabBar) */
  onMobileMenuOpen?: () => void;
  /** External control for search overlay (from MobileDrawer) */
  externalSearchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /** Whether the mobile drawer is currently open — hides navbar on mobile when true */
  isMobileMenuOpen?: boolean;
}

export interface CommunityNavItem {
  label: string;
  desc: string;
  path: string;
  href: string;
  icon: typeof Users;
  /** Optional feature gate. Items without a feature are always visible (auth/module gates handled at build time). */
  feature?: keyof TenantFeatures;
  /** Multi-flag gate (ALL required) — mirrors NavigationItemPolicy so this re-filter can never develop a blind spot for dual-gated items. */
  features?: readonly (keyof TenantFeatures)[];
}

export function getVisibleCommunityItems(
  items: CommunityNavItem[],
  hasFeature: (feature: keyof TenantFeatures) => boolean,
): CommunityNavItem[] {
  return items.filter(item =>
    (!item.feature || hasFeature(item.feature))
    && (!item.features || item.features.every(flag => hasFeature(flag))));
}

// Base styling shared by every utility-bar item, WITHOUT a text colour so each
// variant can own its own colour cleanly.
const utilityBarActionBase = 'utility-bar-action inline-flex items-center justify-center rounded-[8px] !bg-transparent hover:!bg-transparent data-[hovered=true]:!bg-transparent data-[pressed=true]:!bg-transparent !shadow-none border-0 outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 h-8 min-w-0 px-2.5 gap-1.5 text-xs shrink-0 transition-colors';
const utilityBarActionClass = `${utilityBarActionBase} text-theme-muted hover:text-theme-primary`;
const utilityBarIconActionClass = `${utilityBarActionClass} w-8 min-w-8 px-0`;
// Verified / "Verify Identity" affordance — green. Built from the colourless base
// (not utilityBarActionClass) so it never inherits text-theme-muted. The shared
// status token is WCAG-safe on both light and dark utility-bar surfaces and also
// supplies HeroUI's success-soft foreground.
const utilityBarSuccessActionClass = `${utilityBarActionBase} !text-[var(--status-success-foreground)] hover:!text-[var(--status-success-foreground)] font-semibold`;
const utilityBarDividerClass = 'text-[var(--border-default)] text-xs select-none shrink-0 opacity-70';

export function Navbar({ onMobileMenuOpen, externalSearchOpen, onSearchOpenChange, isMobileMenuOpen }: NavbarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation(['common', 'broker']);
  const { user, isAuthenticated, logout } = useAuth();
  const { tenant, hasFeature, hasModule, tenantPath } = useTenant();
  const { counts } = useNotificationsOptional();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { headerMenus, hasCustomMenus } = useMenuContext();
  // Page-provided title shown next to the brand on phones (pages that hide
  // their own header for vertical space publish it via useSetAppBarTitle).
  const appBarTitle = useAppBarTitle();

  // Scroll behavior for utility bar auto-hide + logo shrink
  const { isScrolled, isUtilityBarVisible } = useHeaderScroll(48);

  // Smart nav: track overflow to collapse items into MegaMenu
  const navRef = useRef<HTMLElement>(null);
  const [maxVisibleNav, setMaxVisibleNav] = useState(6);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const availableWidth = el.offsetWidth;
      // Each nav item is ~110px avg, Community dropdown ~130px, More ~90px
      // Reserve 220px for Community + More
      const itemWidth = 110;
      const reserved = 220;
      const count = Math.max(1, Math.floor((availableWidth - reserved) / itemWidth));
      setMaxVisibleNav(count);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute privileged panel access once.
  const isAdmin = hasAdminPanelAccess(user);
  const isBroker = !isAdmin && hasBrokerPanelAccess(user);

  // Search state — can be controlled externally
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const isSearchOpen = externalSearchOpen ?? internalSearchOpen;
  const setIsSearchOpen = useCallback((open: boolean) => {
    setInternalSearchOpen(open);
    onSearchOpenChange?.(open);
  }, [onSearchOpenChange]);

  // Dropdown state - controlled to fix close behavior
  const [timebankingOpen, setTimebankingOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [tenantSwitcherOpen, setTenantSwitcherOpen] = useState(false);

  const closeAllDropdowns = useCallback(() => {
    setTimebankingOpen(false);
    setCommunityOpen(false);
    setMoreOpen(false);
    setCreateOpen(false);
    setUserOpen(false);
    setTenantSwitcherOpen(false);
  }, []);

  const handleTimebankingOpenChange = useCallback((open: boolean) => {
    if (open) { setCommunityOpen(false); setMoreOpen(false); setCreateOpen(false); setUserOpen(false); setTenantSwitcherOpen(false); }
    setTimebankingOpen(open);
  }, []);
  const handleCommunityOpenChange = useCallback((open: boolean) => {
    if (open) { setTimebankingOpen(false); setMoreOpen(false); setCreateOpen(false); setUserOpen(false); setTenantSwitcherOpen(false); }
    setCommunityOpen(open);
  }, []);
  const handleMoreOpenChange = useCallback((open: boolean) => {
    if (open) { setTimebankingOpen(false); setCommunityOpen(false); setCreateOpen(false); setUserOpen(false); setTenantSwitcherOpen(false); }
    setMoreOpen(open);
  }, []);
  const handleCreateOpenChange = useCallback((open: boolean) => {
    if (open) { setTimebankingOpen(false); setCommunityOpen(false); setMoreOpen(false); setUserOpen(false); setTenantSwitcherOpen(false); }
    setCreateOpen(open);
  }, []);
  const handleUserOpenChange = useCallback((open: boolean) => {
    if (open) { setTimebankingOpen(false); setCommunityOpen(false); setMoreOpen(false); setCreateOpen(false); setTenantSwitcherOpen(false); }
    setUserOpen(open);
  }, []);
  const handleTenantSwitcherOpenChange = useCallback((open: boolean) => {
    if (open) { setTimebankingOpen(false); setCommunityOpen(false); setMoreOpen(false); setCreateOpen(false); setUserOpen(false); }
    setTenantSwitcherOpen(open);
  }, []);

  // Identity verification status — shows "Verify Identity" or "Identity Verified" in
  // utility bar. Gated by the per-tenant `identity_verification` feature flag.
  const identityVerificationEnabled = hasFeature('identity_verification');
  const [isIdVerified, setIsIdVerified] = useState<boolean>(false);
  const [idVerifiedLoaded, setIdVerifiedLoaded] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !identityVerificationEnabled) return;
    let cancelled = false;
    import('@/lib/api').then(({ api }) => {
      api.get<IdentityStatusResponse>('/v2/identity/status').then((res) => {
        if (cancelled) return;
        const data = res?.data;
        setIsIdVerified(data?.has_id_verified_badge === true);
        setIdVerifiedLoaded(true);
      }).catch(() => {
        if (!cancelled) { setIsIdVerified(false); setIdVerifiedLoaded(true); }
      });
    }).catch(() => {
      if (!cancelled) { setIsIdVerified(false); setIdVerifiedLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, user?.id, identityVerificationEnabled]);

  const dropdownNavigate = useCallback((path: string) => {
    closeAllDropdowns();
    requestAnimationFrame(() => {
      navigate(path);
    });
  }, [closeAllDropdowns, navigate]);

  const handleLogout = async () => {
    closeAllDropdowns();
    await logout();
    navigate(tenantPath('/login'));
  };

  // Close all dropdowns when route changes
  useEffect(() => {
    closeAllDropdowns();
  }, [pathname, closeAllDropdowns]);

  // Keyboard shortcut: Ctrl/Cmd+K opens search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setIsSearchOpen]);

  // Check if current path matches any in a group
  const isActiveGroup = (paths: string[]) => {
    return paths.some(path => pathname.startsWith(path));
  };

  // ─── Memoized nav item arrays ──────────────────────────────────────────────
  type ResolvedDesktopNavigationItem = NavigationItemPolicy & {
    label: string;
    desc: string;
    path: string;
    href: string;
  };
  const resolveDesktopSection = useCallback((section: DesktopNavigationSection): ResolvedDesktopNavigationItem[] => (
    getNavigationItems('desktop', section, {
      isAuthenticated,
      tenantSlug: tenant?.slug,
      hasFeature,
      hasModule,
    }).map(item => ({
      ...item,
      label: t(item.labelKey),
      desc: item.descriptionKey ? t(item.descriptionKey) : '',
      path: item.href,
      href: tenantPath(item.href),
    }))
  ), [hasFeature, hasModule, isAuthenticated, t, tenant?.slug, tenantPath]);

  // Timebanking dropdown — replaces top-level Listings link
  const timebankingItems = useMemo(
    () => resolveDesktopSection('timebanking'),
    [resolveDesktopSection],
  );

  const communityMainItems = useMemo(
    () => resolveDesktopSection('community-main'),
    [resolveDesktopSection],
  );
  const communityLocalItems = useMemo(
    () => resolveDesktopSection('community-local'),
    [resolveDesktopSection],
  );
  const communityExploreItems = useMemo(
    () => resolveDesktopSection('community-explore'),
    [resolveDesktopSection],
  );
  const communityItems = useMemo<CommunityNavItem[]>(() => {
    const items: CommunityNavItem[] = [
      ...communityMainItems,
      ...communityLocalItems,
      ...communityExploreItems,
    ];
    return items;
  }, [communityExploreItems, communityLocalItems, communityMainItems]);
  const visibleCommunityItems = useMemo(
    () => communityItems.filter(item =>
      (!item.feature || hasFeature(item.feature))
      && (!item.features || item.features.every(flag => hasFeature(flag)))),
    [communityItems, hasFeature],
  );
  const communityLeftSections = useMemo<DesktopNavPanelSection[]>(() => {
    const toPanelItem = (item: CommunityNavItem) => ({
      label: item.label,
      desc: item.desc,
      href: item.href,
      icon: item.icon,
    });
    const mainItems = communityMainItems.map(toPanelItem);
    const localCommunityItems = communityLocalItems.map(toPanelItem);

    return [
      ...(mainItems.length > 0 ? [{
        key: 'main',
        title: t('sections.main'),
        items: mainItems,
      }] : []),
      ...(localCommunityItems.length > 0 ? [{
        key: 'community',
        title: t('sections.community'),
        items: localCommunityItems,
      }] : []),
    ];
  }, [communityLocalItems, communityMainItems, t]);
  const communityRightSections = useMemo<DesktopNavPanelSection[]>(() => {
    const toPanelItem = (item: CommunityNavItem) => ({
      label: item.label,
      desc: item.desc,
      href: item.href,
      icon: item.icon,
    });
    const exploreItems = communityExploreItems.map(toPanelItem);

    return exploreItems.length > 0 ? [{
      key: 'explore',
      title: t('sections.explore'),
      items: exploreItems,
    }] : [];
  }, [communityExploreItems, t]);

  // ─── Collapsed primary nav items → overflow into MegaMenu ────────────────
  const primaryNavigationItems = useMemo(
    () => resolveDesktopSection('primary'),
    [resolveDesktopSection],
  );
  const feedNavigationItem = primaryNavigationItems.find(item => item.id === 'feed');
  const exploreNavigationItem = primaryNavigationItems.find(item => item.id === 'explore');
  const messagesNavigationItem = primaryNavigationItems.find(item => item.id === 'messages');
  const overflowNavItems = useMemo(() => {
    const slotThreshold: Partial<Record<NavigationItemPolicy['id'], number>> = {
      feed: 1,
      explore: 2,
      messages: 4,
    };
    return primaryNavigationItems.filter(item => maxVisibleNav < (slotThreshold[item.id] ?? 0));
  }, [maxVisibleNav, primaryNavigationItems]);
  const engageNavigationItems = useMemo(() => resolveDesktopSection('engage'), [resolveDesktopSection]);
  const progressNavigationItems = useMemo(() => resolveDesktopSection('progress'), [resolveDesktopSection]);
  const toolsNavigationItems = useMemo(() => resolveDesktopSection('tools'), [resolveDesktopSection]);
  const federationNavigationItems = useMemo(() => resolveDesktopSection('federation'), [resolveDesktopSection]);
  const aboutNavigationItems = useMemo(() => resolveDesktopSection('about'), [resolveDesktopSection]);
  const impactNavigationItems = useMemo(() => resolveDesktopSection('impact'), [resolveDesktopSection]);

  // ─── Left column sections ────────────────────────────────────────────────
  const leftSections = useMemo(() => [
    // Overflow section — only visible when primary nav items are collapsed
    ...(overflowNavItems.length > 0 ? [{
      key: 'main',
      title: t('sections.main'),
      items: overflowNavItems,
    }] : []),
    {
      key: 'engage',
      title: t('sections.engage'),
      items: engageNavigationItems,
    },
    {
      key: 'progress',
      title: t('sections.progress'),
      collapsible: true,
      defaultExpanded: false,
      items: progressNavigationItems,
    },
    {
      key: 'tools',
      title: t('sections.tools'),
      collapsible: true,
      defaultExpanded: false,
      items: toolsNavigationItems,
    },
    ...(federationNavigationItems.length > 0 ? [{
      key: 'federation',
      title: t('sections.partner_communities'),
      collapsible: true,
      defaultExpanded: false,
      items: federationNavigationItems,
    }] : []),
  ], [engageNavigationItems, federationNavigationItems, overflowNavItems, progressNavigationItems, t, toolsNavigationItems]);

  // ─── Right column sections ───────────────────────────────────────────────
  const rightSections = useMemo(() => [
    {
      key: 'about',
      title: t('sections.about'),
      items: [
        ...aboutNavigationItems,
        ...(tenant?.menu_pages?.about || []).map((pg: { title: string; slug: string }) => ({
          label: pg.title,
          desc: undefined as string | undefined,
          href: tenantPath(`/page/${pg.slug}`),
          icon: FileText,
        })),
      ],
    },
    ...(impactNavigationItems.length > 0 ? [{
      key: 'impact',
      title: t('sections.impact'),
      collapsible: true,
      defaultExpanded: false,
      items: impactNavigationItems,
    }] : []),
  ], [aboutNavigationItems, impactNavigationItems, t, tenant?.menu_pages?.about, tenantPath]);

  const timebankingPaths = useMemo(() => timebankingItems.map(i => i.href), [timebankingItems]);
  const communityPaths = useMemo(() => visibleCommunityItems.map(i => i.href), [visibleCommunityItems]);
  const morePaths = useMemo(() => [
    ...leftSections.flatMap(s => s.items.map(i => i.href)),
    ...rightSections.flatMap(s => s.items.map(i => i.href)),
  ], [leftSections, rightSections]);
  const accessibleFrontendUrl = useMemo(
    () => buildAccessibleFrontendUrl(tenant?.slug, '/', undefined, tenant?.accessible_domain),
    [tenant?.slug, tenant?.accessible_domain],
  );
  const tenantSwitcherItems = tenant?.tenant_switcher?.items ?? [];
  const hasTenantSwitcherItems = tenantSwitcherItems.length > 0;
  const handleTenantSwitch = useCallback(async (url: string) => {
    closeAllDropdowns();
    // Switching to a different community must start a clean session. The access
    // token is scoped to the current tenant, and the API rejects it with 403
    // `tenant_mismatch` against any other community (see Authenticate.php), so a
    // logged-in member who switches would otherwise land in a broken,
    // half-authenticated state — errors on every tenant-scoped request. Sign out
    // first so the destination boots logged-out and the user re-authenticates
    // against the new community. Platform super admins can legitimately cross
    // tenants with their token, so they keep their session.
    if (isAuthenticated && !isPlatformSuperAdminUser(user)) {
      try {
        await logout();
      } catch {
        // logout() already clears local tokens in its own finally path; never
        // let a failed sign-out block the community switch.
      }
    }
    window.open(url, '_self');
  }, [closeAllDropdowns, isAuthenticated, user, logout]);

  return (
    <>
      {/* Skip-to-content link lives in Layout.tsx (single source). Rendering
          another one here produced two consecutive "Skip to main content"
          links in the DOM — flagged by accessibility audits. */}
      <header data-site-header className={`fixed top-0 left-0 right-0 z-300 backdrop-blur-xl border-b border-theme-default glass-surface overflow-x-clip pt-[env(safe-area-inset-top,0px)] transition-transform duration-200 ${isMobileMenuOpen ? '-translate-y-full md:translate-y-0' : ''}`}>
        {/* Utility Bar — slim top strip, auto-hides on scroll down */}
        <div
          className={`hidden sm:block border-b border-[var(--border-default)] bg-[var(--surface-elevated)] transition-all duration-200 overflow-hidden ${
            isUtilityBarVisible ? 'max-h-9 opacity-100' : 'max-h-0 opacity-0 border-b-0'
          }`}
        >
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-end gap-2 h-9 flex-nowrap overflow-x-auto">
              {hasTenantSwitcherItems && (
                <>
                  <Dropdown placement="bottom-end" isOpen={tenantSwitcherOpen} onOpenChange={handleTenantSwitcherOpenChange} shouldBlockScroll={false}>
                    <DropdownTrigger>
                      <Button
                        variant="light"
                        size="sm"
                        className={utilityBarActionClass}
                        aria-label={t('nav.switch_community')}
                        endContent={<ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />}
                      >
                        <Globe className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="hidden md:inline">{t('nav.switch_community')}</span>
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      aria-label={t('aria.tenant_switcher_navigation')}
                      className="min-w-[240px]"
                      classNames={{
                        base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-xl max-h-[70vh] overflow-y-auto',
                      }}
                      onAction={(key) => {
                        void handleTenantSwitch(String(key));
                      }}
                    >
                      {tenantSwitcherItems.map((item) => (
                        <DropdownItem
                          key={item.url}
                          id={item.url}
                          description={item.tagline}
                          startContent={<Building2 className="w-4 h-4" aria-hidden="true" />}
                          textValue={item.name}
                        >
                          {item.name}
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  </Dropdown>
                  <span className={utilityBarDividerClass}>|</span>
                </>
              )}
              {/* Identity verification status — only when the feature is enabled */}
              {isAuthenticated && identityVerificationEnabled && idVerifiedLoaded && (
                <>
                  <span className={utilityBarDividerClass}>|</span>
                  {isIdVerified ? (
                    <div className={utilityBarSuccessActionClass} aria-label={t('verified')}>
                      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="hidden md:inline" aria-hidden="true">{t('verified')}</span>
                    </div>
                  ) : (
                    <Button
                      variant="light"
                      size="sm"
                      className={utilityBarSuccessActionClass}
                      onPress={() => navigate(tenantPath('/verify-identity-optional'))}
                      aria-label={t('verify_identity')}
                    >
                      <Fingerprint className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="hidden md:inline" aria-hidden="true">{t('verify_identity')}</span>
                    </Button>
                  )}
                </>
              )}
              {/* Admin links — admin users only */}
              {isAuthenticated && (isAdmin || isBroker) && (
                <>
                  <span className={utilityBarDividerClass}>|</span>
                  <Button
                    variant="light"
                    size="sm"
                    className={utilityBarActionClass}
                    onPress={() => navigate(tenantPath(isBroker ? '/broker' : '/admin'))}
                    aria-label={isBroker ? t('broker:sidebar.title') : t('user_menu.admin_panel')}
                  >
                    <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="hidden md:inline">
                      {isBroker ? t('broker:sidebar.title') : t('user_menu.admin_panel')}
                    </span>
                  </Button>
                </>
              )}
              {isAuthenticated && <span className={utilityBarDividerClass}>|</span>}
              {accessibleFrontendUrl && (
                <Tooltip content={t('nav.accessibility_alpha_tooltip')} placement="bottom" delay={300}>
                  <a
                    href={accessibleFrontendUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={utilityBarActionClass}
                    aria-label={t('accessibility.accessibility_alpha_new_tab')}
                  >
                    <BadgeCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="hidden md:inline">{t('nav.accessibility_alpha')}</span>
                    <ExternalLink className="hidden lg:block w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </Tooltip>
              )}
              <LanguageSwitcher triggerClassName={utilityBarActionClass} />
              <ThemePicker triggerSize="sm" placement="bottom-end" triggerClassName={utilityBarIconActionClass} />
              <span className={utilityBarDividerClass}>|</span>
              {/* Search — in utility bar on desktop */}
              <Button
                variant="light"
                size="sm"
                onPress={() => setIsSearchOpen(true)}
                aria-label={t('accessibility.search_ctrl_k')}
                className={utilityBarActionClass}
              >
                <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">{t('accessibility.search')}</span>
                <Kbd className="hidden lg:inline-flex items-center gap-0.5 ms-0.5 px-0 py-0 text-[10px] font-medium !bg-transparent !border-transparent !shadow-none text-theme-subtle">
                  <span className="text-xs">{t('keyboard.command_symbol')}</span>{t('keyboard.k_key')}
                </Kbd>
              </Button>
            </div>
          </div>
        </div>

        {/* Main Navigation Bar */}
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* min-h keeps the bar compact for wide/initials logos but lets it grow
              to fit a tall square/stacked logo. py-1.5 gives a tall logo breathing
              room top & bottom (a no-op for compact logos, where min-h dominates);
              Layout adds a matching --logo-extra offset. */}
          <div className="flex items-center justify-between gap-2 min-h-14 sm:min-h-16 py-1.5">
            {/* Left Section: Mobile Menu + Brand */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 lg:flex-none">
              {/* Mobile Menu Toggle — guests only (authenticated users use MobileTabBar) */}
              {!isAuthenticated && (
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  className="lg:hidden text-theme-muted hover:text-theme-primary min-w-[44px] min-h-[44px]"
                  onPress={onMobileMenuOpen}
                  aria-label={isMobileMenuOpen ? t('accessibility.close_menu') : t('accessibility.open_menu')}
                  aria-expanded={isMobileMenuOpen ?? false}
                  aria-controls="mobile-drawer"
                >
                  <Menu className="w-5 h-5" aria-hidden="true" />
                </Button>
              )}

              {/* Brand — shrinks when scrolled; collapses to a compact icon on
                  mobile so a large custom logo can't bleed past the header. */}
              <TenantLogo size="md" showName compact={isScrolled} collapseLogoOnMobile />
              {appBarTitle && (
                <span className="min-w-0 flex-1 truncate text-base font-semibold text-theme-primary sm:hidden">
                  {appBarTitle}
                </span>
              )}
            </div>

            {/* Desktop Navigation — uses ResizeObserver for smart collapsing */}
            {/* `data-main-nav` is the structural hook the E2E suite anchors on —
                same convention as `data-site-header` and `data-mobile-tabbar`.
                Do not remove: `aria-label` is translated, so it cannot be used
                as a stable selector, and this nav is the exact complement of
                MobileTabBar's `lg:hidden`. */}
            <nav ref={navRef} data-main-nav className="hidden lg:flex items-center gap-1 flex-1 justify-center min-w-0" aria-label={t('aria.main_navigation')}>
              {hasCustomMenus ? (
                <DesktopMenuItems menus={headerMenus} />
              ) : (
              <>
              {/* Primary nav items — collapse into More when space is tight */}
              {feedNavigationItem && maxVisibleNav >= 1 && (
                <NavLink
                  to={feedNavigationItem.href}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-theme-active text-theme-primary'
                        : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
                    }`
                  }
                >
                  <feedNavigationItem.icon className="w-4 h-4" aria-hidden="true" />
                  <span>{feedNavigationItem.label}</span>
                </NavLink>
              )}

              {/* Explore / Discover */}
              {exploreNavigationItem && maxVisibleNav >= 2 && (
                <NavLink
                  to={exploreNavigationItem.href}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-theme-active text-theme-primary'
                        : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
                    }`
                  }
                >
                  <exploreNavigationItem.icon className="w-4 h-4" aria-hidden="true" />
                  <span>{exploreNavigationItem.label}</span>
                </NavLink>
              )}

              {/* Timebanking Dropdown — replaces top-level Listings link */}
              {timebankingItems.length > 0 && maxVisibleNav >= 3 && (
                <Dropdown placement="bottom-start" isOpen={timebankingOpen} onOpenChange={handleTimebankingOpenChange} shouldBlockScroll={false}>
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      size="sm"
                      className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-all ${
                        isActiveGroup(timebankingPaths)
                          ? 'bg-theme-active text-theme-primary'
                          : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
                      }`}
                      endContent={<ChevronDown className="w-3 h-3" aria-hidden="true" />}
                    >
                      <ArrowRightLeft className="w-4 h-4" aria-hidden="true" />
                      {t('nav.timebanking')}
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label={t('aria.timebanking_navigation')}
                    className="min-w-[240px] p-1.5"
                    classNames={{
                      base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-xl max-h-[70vh] overflow-y-auto',
                      list: 'gap-1',
                    }}
                    onAction={(key) => {
                      dropdownNavigate(String(key));
                    }}
                  >
                    {timebankingItems.map((item) => (
                      <DropdownItem
                        key={item.href} id={item.href}
                        textValue={`${item.label} ${item.desc}`}
                        className={`rounded-xl px-3 py-2.5 text-theme-primary data-[hovered=true]:bg-theme-hover data-[focus-visible=true]:bg-theme-hover ${
                          pathname.startsWith(item.href) ? 'bg-theme-active' : ''
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-theme-muted" aria-hidden="true" />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-semibold leading-tight text-theme-primary">
                              {item.label}
                            </span>
                            <span className="text-xs leading-snug text-theme-subtle">
                              {item.desc}
                            </span>
                          </span>
                        </span>
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                </Dropdown>
              )}

              {messagesNavigationItem && maxVisibleNav >= 4 && (
                <NavLink
                  to={messagesNavigationItem.href}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-theme-active text-theme-primary'
                        : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
                    }`
                  }
                >
                  <messagesNavigationItem.icon className="w-4 h-4" aria-hidden="true" />
                  <span>{messagesNavigationItem.label}</span>
                  {counts.messages > 0 && isAuthenticated && (
                    <span
                      className="ms-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full"
                      aria-label={t('nav.unread_notifications', { count: counts.messages })}
                    >
                      <span aria-hidden="true">{counts.messages > 99 ? '99+' : counts.messages}</span>
                    </span>
                  )}
                </NavLink>
              )}

              {/* Community Dropdown — always visible on desktop */}
              {visibleCommunityItems.length > 0 && (
                <DesktopNavPanel
                  ariaLabel={t('aria.community_navigation')}
                  isActive={isActiveGroup(communityPaths)}
                  isOpen={communityOpen}
                  leftSections={communityLeftSections}
                  onNavigate={dropdownNavigate}
                  onOpenChange={handleCommunityOpenChange}
                  rightSections={communityRightSections}
                  triggerIcon={Users}
                  triggerLabel={t('nav.community')}
                />
              )}

              {/* More — Multi-column mega menu */}
              <MegaMenu
                isOpen={moreOpen}
                onOpenChange={handleMoreOpenChange}
                isActive={isActiveGroup(morePaths)}
                leftSections={leftSections}
                rightSections={rightSections}
                onNavigate={dropdownNavigate}
              />
              </>
              )}
            </nav>

            {/* User Actions */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Search — visible on mobile/tablet where utility bar is hidden */}
              <Button
                isIconOnly
                variant="light"
                size="sm"
                onPress={() => setIsSearchOpen(true)}
                aria-label={t('accessibility.search_ctrl_k')}
                className="sm:hidden text-theme-muted hover:text-theme-primary min-w-[44px] min-h-[44px]"
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </Button>

              {isAuthenticated ? (
                <>
                  {/* Create Button */}
                  <Dropdown placement="bottom-end" isOpen={createOpen} onOpenChange={handleCreateOpenChange} shouldBlockScroll={false}>
                    <DropdownTrigger>
                      <Button
                        isIconOnly
                        size="sm"
                        color="primary"
                        className="hidden sm:flex"
                        aria-label={t('accessibility.create_new')}
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      aria-label={t('aria.create_actions')}
                      classNames={{
                        base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-xl max-h-[70vh] overflow-y-auto',
                      }}
                      onAction={(key) => {
                        dropdownNavigate(String(key));
                      }}
                    >
                      <DropdownItem
                        key={tenantPath('/listings/create')} id={tenantPath('/listings/create')}
                        startContent={<ListTodo className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('create.new_listing')}
                      </DropdownItem>
                      {hasFeature('events') && canCreateEvents(user) ? (
                        <DropdownItem
                          key={tenantPath('/events/create')} id={tenantPath('/events/create')}
                          startContent={<Calendar className="w-4 h-4" aria-hidden="true" />}
                        >
                          {t('create.new_event')}
                        </DropdownItem>
                      ) : null}
                    </DropdownMenu>
                  </Dropdown>

                  {/* Notification Flyout — rich popover instead of simple navigate */}
                  <Suspense fallback={null}>
                    <NotificationFlyout />
                  </Suspense>

                  {/* Status Selector (small dot button) */}
                  <div className="hidden min-[390px]:block">
                    <Suspense fallback={null}>
                      <StatusSelector />
                    </Suspense>
                  </div>

                  {/* User Dropdown */}
                  <div className="relative h-10 w-10 shrink-0">
                    <Dropdown placement="bottom-end" isOpen={userOpen} onOpenChange={handleUserOpenChange} shouldBlockScroll={false}>
                      <DropdownTrigger>
                        <Button
                          isIconOnly
                          type="button"
                          variant="light"
                          size="sm"
                          // Structural hook for the E2E suite's "is this session
                          // signed in?" check (e2e/helpers/test-utils.ts already
                          // looks for it). The aria-label is translated and
                          // interpolates the user's name, so it is not a stable
                          // selector.
                          data-user-menu
                          aria-label={t('aria.user_menu_trigger', { name: user?.first_name || '' })}
                          className="group h-10 w-10 min-w-10 overflow-visible rounded-full bg-transparent p-0 text-theme-primary hover:bg-theme-hover focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <Avatar
                            name={resolveUserDisplayName(user)}
                            src={resolveAvatarUrl(user?.avatar_url || user?.avatar)}
                            size="sm"
                            className="pointer-events-none size-9 ring-2 ring-transparent transition-all group-hover:ring-accent/50"
                            showFallback
                          />
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu
                        aria-label={t('aria.user_actions')}
                        classNames={{
                          base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-xl min-w-[220px] max-h-[70vh] overflow-y-auto',
                        }}
                        onAction={(key) => {
                          const k = String(key);
                          if (k === 'theme') { toggleTheme(); closeAllDropdowns(); return; }
                          if (k === 'logout') { handleLogout(); return; }
                          if (k === 'profile-header') return;
                          dropdownNavigate(k);
                        }}
                      >
                      <DropdownSection showDivider>
                        <DropdownItem
                          key="profile-header" id="profile-header"
                          className="h-14 gap-2 cursor-default"
                          textValue={t('user_menu.my_profile')}
                          isReadOnly
                        >
                          <p className="font-semibold text-theme-primary truncate">
                            {user?.first_name} {user?.last_name}
                          </p>
                          <p className="text-sm text-theme-subtle truncate">{user?.email}</p>
                        </DropdownItem>
                      </DropdownSection>

                      <DropdownSection showDivider>
                        <DropdownItem
                          key={tenantPath('/profile')} id={tenantPath('/profile')}
                          startContent={<UserCircle className="w-4 h-4" aria-hidden="true" />}
                        >
                          {t('user_menu.my_profile')}
                        </DropdownItem>
                        {hasModule('wallet') ? (
                          <DropdownItem
                            key={tenantPath('/wallet')} id={tenantPath('/wallet')}
                            startContent={<Wallet className="w-4 h-4" aria-hidden="true" />}
                            endContent={
                              <span className="text-xs text-theme-subtle">
                                {t('hours_short', { count: user?.balance ?? 0 })}
                              </span>
                            }
                          >
                            {t('user_menu.wallet')}
                          </DropdownItem>
                        ) : null}
                        <DropdownItem
                          key={tenantPath('/settings')} id={tenantPath('/settings')}
                          startContent={<Settings className="w-4 h-4" aria-hidden="true" />}
                        >
                          {t('user_menu.settings')}
                        </DropdownItem>
                      </DropdownSection>

                      <DropdownSection showDivider>
                        <DropdownItem
                          key="theme" id="theme"
                          startContent={
                            resolvedTheme === 'dark' ? (
                              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                            ) : (
                              <Moon className="w-4 h-4 text-accent" aria-hidden="true" />
                            )
                          }
                        >
                          {resolvedTheme === 'dark' ? t('user_menu.light_mode') : t('user_menu.dark_mode')}
                        </DropdownItem>
                        {/* Goes to the instructions page — it must NOT fire a
                            browser install prompt. Install is broken on Apple
                            devices, so the page states what works where and
                            offers the one-tap install only when the browser has
                            actually given us a prompt. */}
                        <DropdownItem
                          key={tenantPath('/install-app')} id={tenantPath('/install-app')}
                          description={t('install.menu_sub')}
                          startContent={<Download className="w-4 h-4 text-accent" aria-hidden="true" />}
                        >
                          {t('install.menu_cta')}
                        </DropdownItem>
                      </DropdownSection>

                      <DropdownSection>
                        <DropdownItem
                          key="logout" id="logout"
                          color="danger"
                          startContent={<LogOut className="w-4 h-4" aria-hidden="true" />}
                          className="text-[var(--color-error)]"
                        >
                          {t('user_menu.log_out')}
                        </DropdownItem>
                      </DropdownSection>
                      </DropdownMenu>
                    </Dropdown>
                    {user?.id && (
                      <Suspense fallback={null}>
                        <PresenceIndicator userId={user.id} size="lg" showOffline className="pointer-events-none" />
                      </Suspense>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Both guest actions stay visible at every width — the brand
                      section truncates first (min-w-0 flex-1), so Log in must
                      not disappear on portrait phones. */}
                  <Button as={Link} to={tenantPath('/login')} variant="light" size="sm" className="text-theme-secondary hover:text-theme-primary min-w-0 shrink-0 whitespace-nowrap px-2 sm:px-3">
                    {t('auth.log_in')}
                  </Button>
                  <Button as={Link} to={tenantPath('/register')} size="sm" color="primary" className="font-medium min-w-0 shrink-0 whitespace-nowrap px-2 sm:px-3">
                    {t('auth.sign_up')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search Overlay */}
        <SearchOverlay
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
        />
      </header>

    </>
  );
}

export default Navbar;
