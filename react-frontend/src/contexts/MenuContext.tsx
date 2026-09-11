// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTenant } from './TenantContext';
import { MenuContext, type MenuContextValue } from './MenuContextCore';
import { useMenus } from '@/hooks/useMenus';
export { useMenuContext } from './MenuContextCore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const value = useMenuRuntimeValue();

  return (
    <MenuContext.Provider value={value}>{children}</MenuContext.Provider>
  );
}

export function MenuHydrator({ onChange }: { onChange: (value: MenuContextValue) => void }) {
  const value = useMenuRuntimeValue();

  useEffect(() => {
    onChange(value);
  }, [onChange, value]);

  return null;
}

function useMenuRuntimeValue(): MenuContextValue {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const location = useLocation();
  const isAuthRoute = /(^|\/)(login|register|verify-email|password\/forgot|password\/reset|auth\/two-factor\/setup)(\/|$)/.test(
    location.pathname
  );
  const shouldLoadMenus = !isAuthRoute && !authLoading && !tenantLoading;
  const { menus, isLoading, hasCustomMenus, refresh } = useMenus(
    isAuthenticated,
    tenant?.id,
    shouldLoadMenus
  );

  return useMemo<MenuContextValue>(
    () => ({
      headerMenus: menus['header-main'] ?? [],
      mobileMenus: menus.mobile ?? [],
      footerMenus: menus.footer ?? [],
      allMenus: menus,
      isLoading,
      hasCustomMenus,
      refreshMenus: refresh,
    }),
    [menus, isLoading, hasCustomMenus, refresh]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

