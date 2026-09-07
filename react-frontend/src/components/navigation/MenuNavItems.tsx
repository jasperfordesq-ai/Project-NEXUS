// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * API-driven navigation renderers.
 * Renders ApiMenuItem[] as desktop nav links/dropdowns or mobile drawer links.
 * Used by Navbar and MobileDrawer when hasCustomMenus is true.
 */

import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { isNavigationPathEnabled } from './navigationRegistry';
import type { ApiMenu, ApiMenuItem } from '@/types/menu';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client-side visibility check as defense-in-depth.
 * Server already filters, but we double-check for stale cache / race conditions.
 */
function isItemVisible(
  item: ApiMenuItem,
  isAuthenticated: boolean,
  userRole: string | undefined,
  hasFeature: (f: string) => boolean,
  pathEnabled: (url: string) => boolean,
): boolean {
  if (!item.is_active) return false;
  if (item.url && !pathEnabled(item.url)) return false;

  const rules = item.visibility_rules;
  if (!rules) return true;

  if (rules.requires_auth && !isAuthenticated) return false;

  if (rules.min_role && userRole) {
    // tenant_admin was merged into admin (same tier), so treat them as equal
    // rank — otherwise a min_role of 'tenant_admin' would hide the item from a
    // migrated tenant super-admin (now role 'admin').
    const rankOf = (r: string) => ['user', 'admin', 'super_admin'].indexOf(r === 'tenant_admin' ? 'admin' : r);
    const minIdx = rankOf(rules.min_role);
    const userIdx = rankOf(userRole);
    if (minIdx >= 0 && userIdx < minIdx) return false;
  }

  if (rules.exclude_roles && userRole && rules.exclude_roles.includes(userRole)) {
    return false;
  }

  if (rules.requires_feature && !hasFeature(rules.requires_feature)) {
    return false;
  }

  return true;
}

/** Resolve a menu item URL — prepend tenantPath if it's a relative path */
function resolveItemUrl(item: ApiMenuItem, tenantPath: (p: string) => string): string {
  const url = item.url || '/';
  // External URLs or already-absolute paths with protocol
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return tenantPath(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Navigation Items
// ─────────────────────────────────────────────────────────────────────────────

interface DesktopMenuItemsProps {
  menus: ApiMenu[];
}

/**
 * Renders API menus as desktop navigation.
 * Top-level items are rendered as direct NavLinks.
 * Items with children (type=dropdown) are rendered as HeroUI Dropdowns.
 */
export function DesktopMenuItems({ menus }: DesktopMenuItemsProps) {
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const pathEnabled = (url: string) => isNavigationPathEnabled(url, { hasFeature, hasModule }, tenantPath('/'));
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('common');

  const dropdownNavigate = (href: string) => {
    if (href.startsWith('http')) {
      window.open(href, '_blank', 'noopener,noreferrer');
    } else {
      navigate(href);
    }
  };

  // Flatten all menu items from all menus at this location
  const allItems = menus.flatMap((menu) => menu.items ?? []);

  // Filter visible items
  const visibleItems = allItems.filter((item) =>
    isItemVisible(item, isAuthenticated, user?.role, (f) => hasFeature(f as never), pathEnabled)
  );

  return (
    <>
      {visibleItems.map((item) => {
        const href = resolveItemUrl(item, tenantPath);
        const hasChildren = item.children && item.children.length > 0;

        // Dropdown type with children
        if ((item.type === 'dropdown' || hasChildren) && item.children?.length) {
          const visibleChildren = item.children.filter((child) =>
            isItemVisible(child, isAuthenticated, user?.role, (f) => hasFeature(f as never), pathEnabled)
          );

          if (visibleChildren.length === 0) return null;

          const childPaths = visibleChildren.map((c) => resolveItemUrl(c, tenantPath));
          const isActive = childPaths.some((p) => location.pathname.startsWith(p));

          return (
            <Dropdown key={item.id} placement="bottom-start" shouldBlockScroll={false}>
              <DropdownTrigger>
                <Button
                  variant="light"
                  size="sm"
                  className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-theme-active text-theme-primary'
                      : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
                  }`}
                  endContent={<ChevronDown className="w-3 h-3" aria-hidden="true" />}
                >
                  <DynamicIcon name={item.icon} className="w-4 h-4" />
                  {item.label}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={`${item.label} ${t('nav.more')}`}
                className="min-w-[180px]"
                classNames={{
                  base: 'bg-[var(--surface-overlay)] border border-[var(--border-default)] shadow-xl',
                }}
                onAction={(key) => dropdownNavigate(String(key))}
              >
                {visibleChildren.map((child) => {
                  const childHref = resolveItemUrl(child, tenantPath);
                  return (
                    <DropdownItem
                      key={childHref} id={childHref}
                      startContent={<DynamicIcon name={child.icon} className="w-4 h-4" />}
                      className={location.pathname.startsWith(childHref) ? 'bg-theme-active' : ''}
                    >
                      {child.label}
                    </DropdownItem>
                  );
                })}
              </DropdownMenu>
            </Dropdown>
          );
        }

        // Divider type — render nothing in desktop nav
        if (item.type === 'divider') return null;

        // External link
        if (item.type === 'external') {
          return (
            <a
              key={item.id}
              href={item.url || '#'}
              target={item.target || '_blank'}
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-theme-muted hover:text-theme-primary hover:bg-theme-hover transition-all"
            >
              <DynamicIcon name={item.icon} className="w-4 h-4" />
              <span>{item.label}</span>
            </a>
          );
        }

        // Default: direct NavLink
        return (
          <NavLink
            key={item.id}
            to={href}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-theme-active text-theme-primary'
                  : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
              }`
            }
          >
            <DynamicIcon name={item.icon} className="w-4 h-4" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Navigation Items
// ─────────────────────────────────────────────────────────────────────────────

interface MobileMenuItemsProps {
  menus: ApiMenu[];
}

/**
 * Renders API menus as mobile drawer links.
 * Matches the existing MobileDrawer renderNavLink style.
 * Dropdown items render their children directly (flat, no nesting on mobile).
 */
export function MobileMenuItems({ menus }: MobileMenuItemsProps) {
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const pathEnabled = (url: string) => isNavigationPathEnabled(url, { hasFeature, hasModule }, tenantPath('/'));
  const { isAuthenticated, user } = useAuth();

  const allItems = menus.flatMap((menu) => menu.items ?? []);

  const renderItem = (item: ApiMenuItem) => {
    if (!isItemVisible(item, isAuthenticated, user?.role, (f) => hasFeature(f as never), pathEnabled)) {
      return null;
    }

    if (item.type === 'divider') {
      return <div key={item.id} className="border-t border-theme-default my-2" />;
    }

    // Dropdown items: render children directly on mobile (no nested dropdown)
    if ((item.type === 'dropdown' || (item.children && item.children.length > 0)) && item.children?.length) {
      const visibleChildren = item.children.filter((child) =>
        isItemVisible(child, isAuthenticated, user?.role, (f) => hasFeature(f as never), pathEnabled)
      );
      if (visibleChildren.length === 0) return null;

      return (
        <div key={item.id}>
          <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-theme-subtle break-words">
            {item.label}
          </p>
          {visibleChildren.map((child) => renderLink(child))}
        </div>
      );
    }

    return renderLink(item);
  };

  const renderLink = (item: ApiMenuItem) => {
    const href = resolveItemUrl(item, tenantPath);

    if (item.type === 'external') {
      return (
        <a
          key={item.id}
          href={item.url || '#'}
          target={item.target || '_blank'}
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-theme-muted hover:text-theme-primary hover:bg-theme-hover transition-all min-w-0"
        >
          <DynamicIcon name={item.icon} className="w-5 h-5 shrink-0" />
          <span className="min-w-0 truncate">{item.label}</span>
        </a>
      );
    }

    return (
      <NavLink
        key={item.id}
        to={href}
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all min-w-0 ${
            isActive
              ? 'bg-theme-active text-theme-primary'
              : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
          }`
        }
      >
        <DynamicIcon name={item.icon} className="w-5 h-5 shrink-0" />
        <span className="min-w-0 truncate">{item.label}</span>
      </NavLink>
    );
  };

  return <>{allItems.map(renderItem)}</>;
}
