// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mobile Navigation Drawer
 * Uses HeroUI Drawer component for accessibility and animations.
 * Sections are collapsible via HeroUI Accordion.
 * Admin/Help/Theme/Language consolidated into a utility row at the bottom.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Separator } from '@/components/ui/Separator';
import X from 'lucide-react/icons/x';
import MessageSquare from 'lucide-react/icons/message-square';
import Settings from 'lucide-react/icons/settings';
import LogOut from 'lucide-react/icons/log-out';
import HelpCircle from 'lucide-react/icons/circle-help';
import Search from 'lucide-react/icons/search';
import Shield from 'lucide-react/icons/shield';
import FileText from 'lucide-react/icons/file-text';
import Fingerprint from 'lucide-react/icons/fingerprint';
import BadgeCheck from 'lucide-react/icons/badge-check';
import ExternalLink from 'lucide-react/icons/external-link';
import Download from 'lucide-react/icons/download';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { ReportProblemButton } from '@/components/feedback/ReportProblemButton';
import { TenantLogo } from '@/components/branding';
import { VerificationBadgeRow } from '@/components/verification/VerificationBadge';
import { SourceRepositoryLink } from './SourceRepositoryLink';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import { useCookieConsent } from '@/contexts/CookieConsentContext';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { hasAdminPanelAccess, hasBrokerPanelAccess } from '@/lib/access';
import { buildAccessibleFrontendUrl } from '@/lib/accessible-frontend';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemePicker } from '@/components/layout/ThemePicker';
import { useMenuContext } from '@/contexts/MenuContextCore';
import { MobileMenuItems } from '@/components/navigation';
import {
  getNavigationItems,
  type MobileNavigationSection,
  type NavigationItemPolicy,
} from '@/components/navigation/navigationRegistry';

import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Drawer, DrawerContent, DrawerHeader, DrawerBody } from '@/components/ui/Drawer';
interface IdentityStatusResponse {
  has_id_verified_badge: boolean;
}

// Per-tab cache so opening/closing the drawer doesn't refetch on every cycle.
const IDENTITY_CACHE_KEY = (uid: number) => `nexus.identity_status.${uid}`;

function readCachedVerified(userId: number): boolean | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(IDENTITY_CACHE_KEY(userId));
  return raw === 'true' ? true : raw === 'false' ? false : null;
}

function writeCachedVerified(userId: number, value: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(IDENTITY_CACHE_KEY(userId), String(value));
}

// Identity verification CTA for mobile menu — shows "Verify Identity" if not verified
function IdentityVerificationCTA({ userId, tenantPath, onClose }: { userId: number; tenantPath: (p: string) => string; onClose: () => void }) {
  const [isVerified, setIsVerified] = useState<boolean | null>(() => readCachedVerified(userId));
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'broker']);

  useEffect(() => {
    if (!userId) return;
    if (readCachedVerified(userId) !== null) return; // already cached for this tab
    let cancelled = false;
    import('@/lib/api').then(({ api }) => {
      api.get<IdentityStatusResponse>('/v2/identity/status').then((res) => {
        const verified = res?.data?.has_id_verified_badge === true;
        if (!cancelled) {
          writeCachedVerified(userId, verified);
          setIsVerified(verified);
        }
      }).catch(() => { if (!cancelled) setIsVerified(false); });
    }).catch(() => { if (!cancelled) setIsVerified(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (isVerified === null) return null; // Loading
  if (isVerified) return null; // Already verified — VerificationBadgeRow handles display

  return (
    <Button
      variant="flat"
      onPress={() => { onClose(); setTimeout(() => navigate(tenantPath('/verify-identity-optional')), 150); }}
      className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-3.5 min-h-[48px] rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-base font-semibold hover:bg-emerald-500/20 min-h-9 min-w-0"
    >
      <Fingerprint className="w-5 h-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{t('nav.verify_identity')}</span>
    </Button>
  );
}

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSearchOpen?: () => void;
}

export function MobileDrawer({ isOpen, onClose, onSearchOpen }: MobileDrawerProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation('common');
  const { user, isAuthenticated, logout } = useAuth();
  const { tenant, hasFeature, hasModule, tenantPath } = useTenant();
  const { unreadCount, counts } = useNotificationsOptional();
  const { resetConsent } = useCookieConsent();
  const { mobileMenus, headerMenus, hasCustomMenus } = useMenuContext();
  const year = new Date().getFullYear();
  const accessibleFrontendUrl = buildAccessibleFrontendUrl(tenant?.slug, '/', undefined, tenant?.accessible_domain);

  const isAdmin = hasAdminPanelAccess(user);
  const isBroker = !isAdmin && hasBrokerPanelAccess(user);

  // Match this to the drawer's exit animation; lets the drawer slide closed before route changes.
  const DRAWER_CLOSE_MS = 150;
  const navigateAndClose = (path: string) => {
    onClose();
    setTimeout(() => navigate(tenantPath(path)), DRAWER_CLOSE_MS);
  };

  // Use mobile-specific menus if available, fall back to header menus
  const apiMenus = mobileMenus.length > 0 ? mobileMenus : headerMenus;

  // Track which accordion sections are expanded
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(['main']));

  type ResolvedMobileNavigationItem = NavigationItemPolicy & { label: string };
  const resolveMobileSection = (section: MobileNavigationSection): ResolvedMobileNavigationItem[] => (
    getNavigationItems('mobile', section, {
      isAuthenticated,
      tenantSlug: tenant?.slug,
      hasFeature,
      hasModule,
    }).map(item => ({ ...item, label: t(item.labelKey) }))
  );

  // Presentation stays local to the drawer; all route and entitlement policy is shared.
  const mainNavItems = resolveMobileSection('main');

  const timebankingNavItems = resolveMobileSection('timebanking');

  const communityNavItems = resolveMobileSection('community');

  const engageNavItems = resolveMobileSection('engage');

  const exploreNavItems = resolveMobileSection('explore');

  // Section header is "Partner Communities" — drop the redundant "Federated" / "Federation" prefix on each item.
  // Fallback strings on t() let i18next show the short label until translators add proper keys.
  const federationNavItems = resolveMobileSection('federation');

  const aboutNavItems = resolveMobileSection('about');

  const legalNavItems = resolveMobileSection('legal');

  // Track previous pathname to only close on actual navigation
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      onClose();
      prevPathRef.current = pathname;
    }
  }, [pathname, onClose]);

  const handleLogout = async () => {
    await logout();
    onClose();
    navigate(tenantPath('/login'));
  };

  const renderNavLink = (item: Pick<ResolvedMobileNavigationItem, 'label' | 'href' | 'icon'>) => {
    const Icon = item.icon;
    const resolvedHref = tenantPath(item.href);
    const isActive = pathname === resolvedHref || pathname.startsWith(resolvedHref + '/');

    return (
      <Button
        key={item.href}
        variant="light"
        onPress={() => navigateAndClose(item.href)}
        className={`flex items-center gap-3 px-4 rounded-xl text-base font-medium transition-all w-full text-start min-h-9 [min-height:var(--nav-row-min-h,48px)] [padding-block:var(--nav-row-py,0.875rem)] justify-start min-w-0 ${
          isActive
            ? 'bg-theme-active text-theme-primary'
            : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{item.label}</span>
      </Button>
    );
  };

  // Accordion section header style
  const sectionTitleClass = 'text-sm font-semibold uppercase tracking-wider text-theme-muted';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      placement="bottom"
      size="md"
      hideCloseButton
      classNames={{
        base: 'nexus-mobile-navigation-sheet bg-[var(--surface-dropdown)] border-t border-[var(--border-default)] shadow-2xl w-full max-w-none max-h-[calc(100dvh-var(--safe-area-top)-0.5rem)] rounded-t-3xl',
        backdrop: 'z-[var(--z-modal-backdrop)]',
        wrapper: 'z-[var(--z-modal)]',
        header: 'border-b border-[var(--border-default)] p-3',
        body: 'p-0',
      }}
    >
      <DrawerContent id="mobile-drawer" aria-label={t('aria.mobile_navigation')} className="ps-[var(--safe-area-left)] pe-[var(--safe-area-right)] pb-[var(--safe-area-bottom)]">
        <div aria-hidden="true" className="flex shrink-0 justify-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-[var(--text-subtle)]/40" />
        </div>
        {/* Header */}
        <DrawerHeader className="flex-row items-center justify-between gap-3">
          <TenantLogo size="md" showName collapseLogoOnMobile className="min-w-0 flex-1" />
          <Button
            isIconOnly
            variant="light"
            className="shrink-0 text-theme-muted hover:text-theme-primary min-w-[48px] min-h-[48px]"
            onPress={onClose}
            aria-label={t('accessibility.close_menu')}
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </Button>
        </DrawerHeader>

        <DrawerBody>
          {/* Search Button */}
          {onSearchOpen && (
            <div className="px-4 pt-3 pb-1 min-w-0">
              <Button
                variant="flat"
                fullWidth
                className="flex items-center justify-start gap-3 px-4 py-3.5 min-h-[48px] rounded-xl bg-theme-elevated hover:bg-theme-hover border border-theme-default text-base text-theme-muted min-h-9 min-w-0"
                onPress={() => { onClose(); onSearchOpen(); }}
                aria-label={t('aria.open_search')}
              >
                <Search className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{t('search.placeholder')}</span>
              </Button>
            </div>
          )}

          {/* User Section */}
          {isAuthenticated && user && (
            <div className="p-4 border-b border-[var(--border-default)]">
              <Button
                variant="light"
                onPress={() => navigateAndClose('/profile')}
                className="flex items-center gap-3 w-full text-start min-h-9 p-2 min-h-[56px] justify-start rounded-xl hover:bg-theme-hover"
              >
                <Avatar
                  name={resolveUserDisplayName(user)}
                  src={resolveAvatarUrl(user.avatar_url || user.avatar)}
                  size="lg"
                  showFallback
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-theme-primary truncate">
                    {user.first_name} {user.last_name}
                  </p>
                  <p className="text-sm text-theme-muted truncate">{user.email}</p>
                </div>
              </Button>

              {/* Identity Verification Status */}
              <VerificationBadgeRow userId={user.id} size="sm" />
              {hasFeature('identity_verification') && (
                <IdentityVerificationCTA userId={user.id} tenantPath={tenantPath} onClose={onClose} />
              )}

              {/* Quick Stats */}
              <div
                className="mt-3 grid w-full min-w-0 grid-cols-3 gap-2"
                data-testid="mobile-account-stats"
              >
                <Button
                  variant="flat"
                  onPress={() => navigateAndClose('/wallet')}
                  className="h-auto min-h-[76px] w-full min-w-0 flex-col justify-center gap-1 overflow-visible rounded-xl border border-theme-default bg-theme-elevated px-2 py-3 text-center transition-colors hover:bg-theme-hover"
                >
                  <span className="block text-xl font-bold leading-none text-theme-primary">
                    {user.balance ?? 0}
                  </span>
                  <span className="block w-full whitespace-normal text-center text-sm font-medium leading-tight text-theme-secondary">
                    {t('stats.credits')}
                  </span>
                </Button>
                <Button
                  variant="flat"
                  onPress={() => navigateAndClose('/messages')}
                  className="relative h-auto min-h-[76px] w-full min-w-0 flex-col justify-center gap-1 overflow-visible rounded-xl border border-theme-default bg-theme-elevated px-2 py-3 text-center transition-colors hover:bg-theme-hover"
                >
                  <span className="block text-xl font-bold leading-none text-theme-primary">
                    {counts.messages > 0 ? counts.messages : 0}
                  </span>
                  <span className="block w-full whitespace-normal text-center text-sm font-medium leading-tight text-theme-secondary">
                    {t('stats.messages')}
                  </span>
                  {counts.messages > 0 && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  variant="flat"
                  onPress={() => navigateAndClose('/notifications')}
                  className="relative h-auto min-h-[76px] w-full min-w-0 flex-col justify-center gap-1 overflow-visible rounded-xl border border-theme-default bg-theme-elevated px-2 py-3 text-center transition-colors hover:bg-theme-hover"
                >
                  <span className="block text-xl font-bold leading-none text-theme-primary">
                    {unreadCount > 0 ? unreadCount : 0}
                  </span>
                  <span className="block w-full whitespace-normal text-center text-sm font-medium leading-tight text-theme-secondary">
                    {t('stats.alerts')}
                  </span>
                  {unreadCount > 0 && (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Navigation — Collapsible Sections */}
          <nav className="flex-1 overflow-y-auto" aria-label={t('aria.mobile_navigation')}>
            {hasCustomMenus ? (
              <div className="p-4 space-y-1">
                <MobileMenuItems menus={apiMenus} />
              </div>
            ) : (
            <Accordion
              selectionMode="multiple"
              selectedKeys={expandedKeys}
              onSelectionChange={(keys) => setExpandedKeys(keys as Set<string>)}
              className="px-2 py-2"
              itemClasses={{
                base: 'py-0.5',
                title: sectionTitleClass,
                trigger: 'py-3 px-2 min-h-[48px]',
                content: 'pb-2 pt-0',
                indicator: 'text-theme-muted',
              }}
            >
              {/* Main Navigation */}
              <AccordionItem key="main" id="main" title={t('sections.main')} aria-label={t('aria.main_navigation')}>
                <div className="space-y-1">
                  {mainNavItems.map(renderNavLink)}
                </div>
              </AccordionItem>

              {/* Timebanking */}
              {timebankingNavItems.length > 0 ? (
                <AccordionItem key="timebanking" id="timebanking" title={t('nav.timebanking')} aria-label={t('aria.timebanking_navigation')}>
                  <div className="space-y-1">
                    {timebankingNavItems.map(renderNavLink)}
                  </div>
                </AccordionItem>
              ) : null}

              {/* Community */}
              {communityNavItems.length > 0 ? (
                <AccordionItem key="community" id="community" title={t('sections.community')} aria-label={t('aria.community_navigation')}>
                  <div className="space-y-1">
                    {communityNavItems.map(renderNavLink)}
                  </div>
                </AccordionItem>
              ) : null}

              {/* Engage */}
              {engageNavItems.length > 0 ? (
                <AccordionItem key="engage" id="engage" title={t('sections.engage')} aria-label={t('aria.engage_navigation')}>
                  <div className="space-y-1">
                    {engageNavItems.map(renderNavLink)}
                  </div>
                </AccordionItem>
              ) : null}

              {/* Explore / Activity */}
              {exploreNavItems.length > 0 ? (
                <AccordionItem key="explore" id="explore" title={t('sections.explore')} aria-label={t('aria.explore_navigation')}>
                  <div className="space-y-1">
                    {exploreNavItems.map(renderNavLink)}
                  </div>
                </AccordionItem>
              ) : null}

              {/* Partner Communities (federation) */}
              {federationNavItems.length > 0 ? (
                <AccordionItem
                  key="federation" id="federation"
                  title={t('sections.partner_communities')}
                  aria-label={t('aria.partner_communities_navigation')}
                >
                  <div className="space-y-1">
                    {federationNavItems.map(renderNavLink)}
                  </div>
                </AccordionItem>
              ) : null}

              {/* About */}
              <AccordionItem key="about" id="about" title={t('sections.about')} aria-label={t('aria.about_navigation')}>
                <div className="space-y-1">
                  {aboutNavItems.map(renderNavLink)}
                  {(tenant?.menu_pages?.about || []).map((p: { title: string; slug: string }) => renderNavLink({
                    label: p.title,
                    href: `/page/${p.slug}`,
                    icon: FileText,
                  }))}
                </div>
              </AccordionItem>

              {/* Legal */}
              <AccordionItem key="legal" id="legal" title={t('sections.legal')} aria-label={t('aria.legal_navigation')}>
                <div className="space-y-1">
                  {legalNavItems.map(renderNavLink)}
                  <Button
                    variant="light"
                    onPress={() => { resetConsent(); onClose(); }}
                    className="flex items-center gap-3 px-4 py-3.5 min-h-[48px] rounded-xl text-base font-medium text-theme-muted hover:text-theme-primary hover:bg-theme-hover transition-all w-full justify-start min-h-9"
                  >
                    <Settings className="w-5 h-5" aria-hidden="true" />
                    <span>{t('cookie_consent.manage')}</span>
                  </Button>
                </div>
              </AccordionItem>
            </Accordion>
            )}

            {/* Utility Row — consolidated secondary actions */}
            <div className="px-4 py-3 border-t border-[var(--border-default)]">
              <div className="flex items-center justify-between gap-2">
                {/* Left: Admin + Help links */}
                <div className="flex items-center gap-1 flex-wrap">
                  {isAuthenticated && (
                    <Button
                      variant="light"
                      size="sm"
                      className="text-theme-muted hover:text-theme-primary h-11 min-h-[44px] min-w-0 px-3 gap-2 text-sm"
                      onPress={() => navigateAndClose('/help')}
                    >
                      <HelpCircle className="w-4 h-4" aria-hidden="true" />
                      {t('user_menu.help_center')}
                    </Button>
                  )}
                  {isAuthenticated && (
                    <ReportProblemButton className="h-11 min-h-[44px] min-w-0 px-3 gap-2 text-sm" />
                  )}
                  {accessibleFrontendUrl && (
                    <a
                      href={accessibleFrontendUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-[8px] text-theme-muted hover:text-theme-primary hover:bg-surface-secondary h-11 min-h-[44px] min-w-0 px-3 gap-2 text-sm outline-solid outline-transparent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                      aria-label={t('accessibility.accessibility_alpha_new_tab')}
                      onClick={onClose}
                    >
                      <BadgeCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{t('nav.accessibility_alpha')}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  )}
                  {!isAuthenticated && (
                    <Button
                      variant="light"
                      size="sm"
                      className="text-theme-muted hover:text-theme-primary h-11 min-h-[44px] min-w-0 px-3 gap-2 text-sm"
                      onPress={() => navigateAndClose('/contact')}
                    >
                      <MessageSquare className="w-4 h-4" aria-hidden="true" />
                      {t('support.contact')}
                    </Button>
                  )}
                  {isAuthenticated && (isAdmin || isBroker) && (
                    <>
                      <Button
                        variant="light"
                        size="sm"
                        className="text-theme-muted hover:text-theme-primary h-11 min-h-[44px] min-w-0 px-3 gap-2 text-sm"
                        onPress={() => navigateAndClose(isBroker ? '/broker' : '/admin')}
                      >
                        <Shield className="w-4 h-4" aria-hidden="true" />
                        {isBroker ? t('broker:sidebar.title') : t('user_menu.admin_panel')}
                      </Button>
                    </>
                  )}
                </div>

                {/* Right: Language + Theme */}
                <div className="flex items-center gap-1 shrink-0">
                  <LanguageSwitcher />
                  <ThemePicker
                    triggerSize="md"
                    placement="top-end"
                    triggerClassName="text-theme-muted hover:text-theme-primary min-w-[44px] min-h-[44px]"
                  />
                </div>
              </div>
            </div>

            {/* Account Actions */}
            {isAuthenticated && (
              <div className="px-4 py-3 border-t border-[var(--border-default)]">
                <div className="flex items-center gap-2">
                  <Button
                    variant="light"
                    onPress={() => navigateAndClose('/settings')}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-3 min-h-[48px] rounded-xl text-base font-medium text-theme-muted hover:text-theme-primary hover:bg-theme-hover border border-[var(--border-default)] transition-all min-h-9"
                  >
                    <Settings className="w-5 h-5" aria-hidden="true" />
                    <span>{t('account.settings')}</span>
                  </Button>
                  <Button
                    variant="light"
                    onPress={handleLogout}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-3 min-h-[48px] rounded-xl text-base font-medium text-[var(--color-error)] hover:bg-red-500/10 transition-all min-h-9 border border-red-500/20"
                  >
                    <LogOut className="w-5 h-5" aria-hidden="true" />
                    <span>{t('account.log_out')}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Auth buttons for guests */}
            {!isAuthenticated && (
              <div className="px-4 py-3 border-t border-[var(--border-default)] space-y-2">
                <Button
                  variant="flat"
                  className="w-full bg-theme-elevated text-theme-secondary min-h-[48px] text-base"
                  onPress={() => { onClose(); navigate(tenantPath('/login')); }}
                >
                  {t('auth.log_in')}
                </Button>
                <Button
                  color="primary"
                  className="w-full min-h-[48px] text-base font-medium"
                  onPress={() => { onClose(); navigate(tenantPath('/register')); }}
                >
                  {t('auth.sign_up')}
                </Button>
              </div>
            )}

            {/* Install app is a secondary action, kept near the bottom of the menu. */}
            <InstallAppButton>
              {({ onClick, label, sublabel }) => (
                <div
                  className="min-w-0 border-t border-[var(--border-default)] px-4 py-3"
                  data-testid="mobile-install-app"
                >
                  <Button
                    variant="flat"
                    fullWidth
                    className="h-auto min-h-[52px] min-w-0 justify-start gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-theme-primary hover:bg-accent/20"
                    onPress={() => { onClose(); setTimeout(onClick, DRAWER_CLOSE_MS); }}
                  >
                    <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-start">
                      <span className="block truncate text-sm font-semibold">{label}</span>
                      <span className="block truncate text-sm text-theme-secondary">{sublabel}</span>
                    </span>
                  </Button>
                </div>
              )}
            </InstallAppButton>

            {/* Attribution (AGPL Section 7(b) — required on all pages) */}
            <div className="pt-4 pb-4 px-4">
              <Separator className="bg-theme-elevated mb-3" />
              <div className="flex flex-col items-center gap-2">
                <SourceRepositoryLink compact className="w-full justify-center" />
                <p className="text-center text-sm text-theme-muted">
                  <span className="font-medium text-theme-secondary">{t('footer.project_nexus')}</span>
                  <span aria-hidden="true"> &middot; </span>
                  <span>{t('footer.agpl_notice', { year })}</span>
                </p>
              </div>
              <div className="flex justify-center items-center gap-1 mt-2">
                <Button
                  variant="light"
                  size="sm"
                  onPress={() => navigateAndClose('/platform/terms')}
                  className="text-sm text-theme-muted hover:text-theme-primary transition-colors h-11 min-h-[44px] px-3"
                >
                  {t('footer.terms')}
                </Button>
                <span className="text-theme-muted/40" aria-hidden="true">&middot;</span>
                <Button
                  variant="light"
                  size="sm"
                  onPress={() => navigateAndClose('/platform/privacy')}
                  className="text-sm text-theme-muted hover:text-theme-primary transition-colors h-11 min-h-[44px] px-3"
                >
                  {t('footer.privacy')}
                </Button>
              </div>
            </div>
          </nav>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default MobileDrawer;
