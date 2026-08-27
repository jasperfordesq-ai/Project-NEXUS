// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { getTenantConfig, type TenantConfig } from '@/lib/api/tenant';
import { DEFAULT_TENANT, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { themeStore } from '@/lib/theme/themeStore';

interface TenantContextValue {
  tenant: TenantConfig | null;
  tenantSlug: string;
  /** Whether this installation has explicitly selected and remembered a community. */
  hasSelectedTenant: boolean;
  isLoading: boolean;
  /** Check if a feature flag is enabled for the current tenant */
  hasFeature: (feature: string) => boolean;
  /** Check if a module is enabled for the current tenant */
  hasModule: (module: string) => boolean;
  /** Switch the active tenant (persists to storage) */
  setTenantSlug: (slug: string) => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/** Default brand color used before tenant config loads */
const FALLBACK_PRIMARY = '#006FEE';

/** SecureStore key for cached tenant config — mirrors AuthContext's cache-first pattern. */
const TENANT_CONFIG_CACHE_PREFIX = 'nexus_tenant_config';

/**
 * 🔴 Expo SecureStore REJECTS a key containing anything outside
 * `[A-Za-z0-9._-]`, and this key used to be joined with a colon
 * (`nexus_tenant_config:hour-timebank`). Every read and every write therefore
 * threw on a real device — and because `lib/storage.ts` swallows both (returning
 * `null` from `get`, reporting and continuing from `set`), the failure looked
 * exactly like "no cache yet" instead of "this cache can never work".
 *
 * The visible cost was not an error screen. It was that the tenant config cache
 * was dead: the app had to reach the network on every single launch, and a cold
 * start with no connection fell through to `tenant === null`, which renders with
 * no community branding and every module gated off.
 *
 * Sanitising the slug as well as the separator, because the slug is read back
 * out of storage and is not guaranteed by this module to be well-formed. No
 * migration is needed: the old key never successfully stored anything.
 */
function tenantConfigCacheKey(slug: string): string {
  return `${TENANT_CONFIG_CACHE_PREFIX}_${slug.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function isMissingTenantError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 410;
}

type TenantLoadResult = 'loaded' | 'missing' | 'unavailable';

export function TenantProvider({ children }: { children: React.ReactNode }) {
  // Start with null slug to indicate "not yet read from storage".
  // This prevents a flicker where the default tenant config renders briefly
  // before the stored tenant slug is read from SecureStore/AsyncStorage.
  const [tenantSlug, setSlug] = useState<string | null>(null);
  const [hasSelectedTenant, setHasSelectedTenant] = useState<boolean | null>(null);
  const [tenant, setTenant] = useState<TenantConfig | null>(null);

  // Point HeroUI's accent at this community's own brand colour. It lives in the theme
  // store rather than in this context because ~200 components read the theme through a
  // provider-free store, and because the switch has to survive a light/dark change.
  // A community with no palette in this bundle falls back to the platform default, so
  // this is safe to call with any slug.
  useEffect(() => {
    themeStore.setTenant(tenant?.slug ?? null);
  }, [tenant?.slug]);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const recoverFromMissingTenant = useCallback(async () => {
    await storage.remove(STORAGE_KEYS.TENANT_SLUG);
    if (!isMountedRef.current) return;

    setSlug(DEFAULT_TENANT);
    setHasSelectedTenant(false);
    setTenant(null);

    // With the stale slug removed, the public bootstrap resolves against the
    // platform default. This provides neutral picker branding without silently
    // remembering that fallback as the member's chosen community.
    try {
      const response = await getTenantConfig();
      if (!isMountedRef.current) return;
      setTenant(response.data);
      await storage.setJson(tenantConfigCacheKey(DEFAULT_TENANT), response.data);
    } catch {
      // The community picker itself is anonymous and remains usable with the
      // platform colour if the neutral bootstrap is temporarily unavailable.
    }
  }, []);

  const loadTenantConfig = useCallback(async (
    slug: string,
    skipCache = false,
    persistSlug = true,
  ): Promise<TenantLoadResult> => {
    if (!isMountedRef.current) return 'unavailable';
    setIsLoading(true);
    try {
      // Write the slug so the API client's X-Tenant-Slug header is correct.
      if (persistSlug) {
        await storage.set(STORAGE_KEYS.TENANT_SLUG, slug);
      }
      const cacheKey = tenantConfigCacheKey(slug);

      // Cache-first: render from cached config immediately, then validate
      // in the background. Mirrors AuthContext's session restore pattern.
      if (!skipCache) {
        const cached = await storage.getJson<TenantConfig>(cacheKey);
        if (!isMountedRef.current) return 'unavailable';
        if (cached?.slug === slug) {
          setTenant(cached);
          setIsLoading(false);

          // Background: fetch fresh config and update if successful.
          // On network failure, keep the cached config (offline resilience).
          getTenantConfig()
            .then(async (response) => {
              if (!isMountedRef.current) return;
              setTenant(response.data);
              await storage.setJson(cacheKey, response.data);
            })
            .catch(async (error: unknown) => {
              if (isMissingTenantError(error)) {
                await storage.remove(cacheKey);
                await recoverFromMissingTenant();
              }
              // For an ordinary network failure, keep the cached config.
            });
          return 'loaded';
        }

        if (cached) {
          await storage.remove(cacheKey);
        }
      }

      // No cache (first launch or explicit refresh) — must wait for network
      const response = await getTenantConfig();
      if (!isMountedRef.current) return 'unavailable';
      setTenant(response.data);
      await storage.setJson(cacheKey, response.data);
      return 'loaded';
    } catch (error: unknown) {
      // Tenant config failed — app still works with null tenant (graceful degradation)
      if (isMountedRef.current) setTenant(null);
      if (isMissingTenantError(error)) {
        await recoverFromMissingTenant();
        return 'missing';
      }
      return 'unavailable';
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [recoverFromMissingTenant]);

  // Restore previously selected tenant on app start — read storage FIRST,
  // then set slug and load config, so the initial render never shows the
  // wrong tenant.
  useEffect(() => {
    async function init() {
      const stored = (await storage.get(STORAGE_KEYS.TENANT_SLUG))?.trim() || null;
      if (!isMountedRef.current) return;
      const slug = stored ?? DEFAULT_TENANT;
      setSlug(slug);
      setHasSelectedTenant(stored !== null);
      // The default tenant supplies neutral startup branding and the API context
      // needed to list communities, but it must not become a remembered choice.
      await loadTenantConfig(slug, false, stored !== null);
    }
    void init();
  }, [loadTenantConfig, recoverFromMissingTenant]);

  const setTenantSlug = useCallback(
    async (slug: string) => {
      setSlug(slug);
      // Clear stale cache when switching tenants — force fresh fetch
      await storage.remove(TENANT_CONFIG_CACHE_PREFIX);
      await storage.remove(tenantConfigCacheKey(slug));
      const result = await loadTenantConfig(slug, true);
      if (result !== 'missing' && isMountedRef.current) {
        setHasSelectedTenant(true);
      }
    },
    [loadTenantConfig],
  );

  const hasFeature = useCallback(
    (feature: string): boolean => {
      return tenant?.features[feature] === true;
    },
    [tenant],
  );

  const hasModule = useCallback(
    (module: string): boolean => {
      return tenant?.modules[module] === true;
    },
    [tenant],
  );

  // Use the resolved slug once storage has been read, otherwise fall back
  // to DEFAULT_TENANT for the public context value type (string, not null).
  const resolvedSlug = tenantSlug ?? DEFAULT_TENANT;

  const value = useMemo<TenantContextValue>(
    () => ({
      tenant,
      tenantSlug: resolvedSlug,
      hasSelectedTenant: hasSelectedTenant ?? false,
      // Stay in loading state until the stored slug has been read from storage
      // AND the tenant config has been fetched — prevents flicker.
      isLoading: isLoading || tenantSlug === null || hasSelectedTenant === null,
      hasFeature,
      hasModule,
      setTenantSlug,
    }),
    [
      tenant,
      resolvedSlug,
      hasSelectedTenant,
      isLoading,
      tenantSlug,
      hasFeature,
      hasModule,
      setTenantSlug,
    ],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenantContext must be used within <TenantProvider>');
  return ctx;
}

/** Resolve the primary brand color, falling back to NEXUS blue */
export function usePrimaryColor(): string {
  const { tenant } = useTenantContext();
  return tenant?.branding.primary_color ?? FALLBACK_PRIMARY;
}

/**
 * The brand colour, or the platform default when there is no TenantProvider above.
 *
 * 🔴 Deliberately non-throwing, unlike `usePrimaryColor`. A presentational component — an
 * icon, a badge — should not make its whole screen depend on tenant context. Adding
 * `AccentIcon` (which needs this to match a button label) to 37 screens broke 12 test
 * suites that render components standalone, because `useTenantContext` throws without a
 * provider. Failing to a readable default is the right answer for a colour: the icon still
 * renders, just in the platform colour.
 *
 * Screens that genuinely need tenant DATA should keep using `useTenantContext` and get the
 * loud error.
 */
export function useOptionalPrimaryColor(): string {
  const ctx = useContext(TenantContext);
  return ctx?.tenant?.branding.primary_color ?? FALLBACK_PRIMARY;
}
