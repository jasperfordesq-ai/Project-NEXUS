// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MasterTenantChooser — "Choose your community" page for the master tenant.
 *
 * The master tenant (id 1) is the platform root, not a working community. When
 * a visitor lands here — most often because an error redirected them to the
 * platform root instead of their own community — they must not see a normal,
 * indistinguishable-looking home page. Instead they see an obvious, searchable
 * directory of every active community so they can jump back into their own.
 *
 * This mirrors the accessible (GOV.UK) frontend's tenant-chooser
 * (accessible-frontend/views/tenant-chooser.blade.php +
 * AlphaController::tenantChooser). It is rendered ONLY for tenant id 1 — the
 * gate lives in HomePage.tsx. Every other tenant renders the normal landing
 * page and is completely unaffected.
 *
 * Community links are full-document navigations (<a href>), NOT SPA <Link>s, so
 * the app cleanly re-bootstraps into the target tenant — the same reason the
 * CommunityNotFound screen in TenantShell.tsx uses <a href>.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Search from 'lucide-react/icons/search';
import Building2 from 'lucide-react/icons/building-2';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface CommunityTenant {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  tagline?: string;
}

/**
 * Resolve the destination URL for a community.
 *
 * Prefer the tenant's own custom domain when it has one (that is the canonical
 * home a member expects to land on). Otherwise fall back to path-based routing
 * on the shared platform host (/{slug}), which always resolves the tenant by
 * slug regardless of environment.
 */
function communityHref(community: CommunityTenant): string {
  if (community.domain) {
    return `https://${community.domain}`;
  }
  return `/${community.slug}`;
}

export function MasterTenantChooser() {
  const { t } = useTranslation('public');
  const [communities, setCommunities] = useState<CommunityTenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetchCommunities = async () => {
      setIsLoading(true);
      try {
        // Public, cached endpoint — excludes the master tenant by default.
        const response = await api.get<CommunityTenant[]>('/v2/tenants', {
          skipAuth: true,
          skipTenant: true,
        });
        if (cancelled) return;
        if (response.success && Array.isArray(response.data)) {
          setCommunities(response.data);
        }
      } catch (err) {
        if (!cancelled) logError('[MasterTenantChooser] Failed to fetch communities', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchCommunities();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return communities;
    return communities.filter((community) => {
      const haystack = [community.name, community.slug, community.tagline ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [communities, query]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <PageMeta title={t('community_chooser.title')} description={t('community_chooser.subtitle')} />

      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-theme-primary sm:text-4xl">
          {t('community_chooser.title')}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-theme-muted">
          {t('community_chooser.subtitle')}
        </p>
      </header>

      {/* Search box — filters the list client-side as you type. */}
      <div className="mx-auto mb-8 max-w-md">
        <Input
          type="search"
          aria-label={t('community_chooser.search_label')}
          placeholder={t('community_chooser.search_placeholder')}
          value={query}
          onValueChange={setQuery}
          isClearable
          onClear={() => setQuery('')}
          startContent={<Search className="h-4 w-4 text-theme-muted" aria-hidden="true" />}
          classNames={{ inputWrapper: 'rounded-xl border border-theme-default bg-theme-elevated' }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label={t('community_chooser.loading')} />
        </div>
      ) : communities.length === 0 ? (
        <p className="py-16 text-center text-theme-muted">{t('community_chooser.empty')}</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-theme-muted">
          {t('community_chooser.no_results', { query: query.trim() })}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((community) => (
            <li key={community.id}>
              <a
                href={communityHref(community)}
                aria-label={t('community_chooser.go_to', { name: community.name })}
                className="group flex h-full flex-col rounded-xl border border-theme-default bg-theme-card p-5 shadow-sm transition hover:border-theme-hover hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)]"
              >
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-theme-hover">
                  <Building2 className="h-5 w-5 text-accent" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold text-theme-primary">{community.name}</h2>
                {community.tagline ? (
                  <p className="mt-1 line-clamp-2 text-sm text-theme-muted">{community.tagline}</p>
                ) : null}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
                  {t('community_chooser.go_to', { name: community.name })}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MasterTenantChooser;
