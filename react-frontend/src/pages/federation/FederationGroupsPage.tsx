// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { SearchField } from '@/components/ui/SearchField';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';

/**
 * Federation Groups Page - Browse groups from partner communities
 *
 * Features:
 * - Search input with debounce
 * - Partner community Select dropdown
 * - Card list layout with member count
 * - Cursor-based pagination with Load More
 * - Loading skeletons and error states
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';
import Globe from 'lucide-react/icons/globe';
import Users from 'lucide-react/icons/users';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import UsersRound from 'lucide-react/icons/users-round';
import Lock from 'lucide-react/icons/lock';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { FederationOptInNotice } from '@/components/federation/FederationOptInNotice';
import { logError } from '@/lib/logger';
import type { FederatedGroup, FederationPartner } from '@/types/api';

const SEARCH_DEBOUNCE_MS = 300;
const PER_PAGE = 20;

export function FederationGroupsPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('groups.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Data
  const [groups, setGroups] = useState<FederatedGroup[]>([]);
  const [partners, setPartners] = useState<FederationPartner[]>([]);

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optInRequired, setOptInRequired] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [selectedPartner, setSelectedPartner] = useState(
    searchParams.get('partner_id') || ''
  );

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const loadGroupsRef = useRef<(append?: boolean) => Promise<void>>(null!);

  // â”€â”€ Debounce search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // â”€â”€ Load partners for dropdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadPartners = useCallback(async () => {
    try {
      const response = await api.get<FederationPartner[]>('/v2/federation/partners');
      if (response.success && response.data) {
        setPartners(response.data);
      }
    } catch (error) {
      logError('Failed to load federation partners for filter', error);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  // â”€â”€ Load groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadGroups = useCallback(
    async (append = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!append) {
          setIsLoading(true);
          setLoadError(null);
        } else {
          setIsLoadingMore(true);
        }

        const params = new URLSearchParams();
        if (debouncedQuery) params.set('q', debouncedQuery);
        if (selectedPartner) params.set('partner_id', selectedPartner);
        if (append && cursor) params.set('cursor', cursor);
        params.set('per_page', String(PER_PAGE));

        const response = await api.get<FederatedGroup[]>(
          `/v2/federation/groups?${params}`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted) return;

        if (response.success && response.data) {
          if (!append) setOptInRequired(false);
          if (append) {
            setGroups((prev) => [...prev, ...response.data!]);
          } else {
            setGroups(response.data);
          }
          const nextCursor = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
          setCursor(nextCursor);
          setHasMore(response.meta?.has_more ?? response.data.length >= PER_PAGE);
        } else {
          if (!append) {
            setGroups([]);
            // The backend 403s with FEDERATION_NOT_ENABLED when the viewer has
            // not opted in — show the opt-in CTA instead of "nothing found".
            setOptInRequired(response.code === 'FEDERATION_NOT_ENABLED');
          }
          setHasMore(false);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logError('Failed to load federated groups', error);
        if (!append) {
          setLoadError(tRef.current('groups.load_error'));
        } else {
          toastRef.current.error(tRef.current('groups.load_more_error'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [debouncedQuery, selectedPartner, cursor]
  );
  loadGroupsRef.current = loadGroups;

  // Reload on filter change
  useEffect(() => {
    setCursor(null);
    setHasMore(false);
    loadGroupsRef.current(false);

    return () => {
      abortRef.current?.abort();
    };
  }, [debouncedQuery, selectedPartner]);

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedPartner) params.set('partner_id', selectedPartner);
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedPartner, setSearchParams]);

  function handleLoadMore() {
    if (!isLoadingMore && hasMore) {
      loadGroups(true);
    }
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('groups.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('groups.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('groups.breadcrumb_groups') },
        ]}
      />

      {/* Header — the same soft panel in the community colour that opens the
          offers, events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('groups.heading')}
        description={t('groups.subheading')}
        icon={<UsersRound className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      {/* Filter Bar */}
      <GlassCard className="p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <SearchField
              placeholder={t('groups.search_placeholder')}
              aria-label={t('groups.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </div>

          {/* Partner filter */}
          <Autocomplete
            placeholder={t('groups.all_communities')}
            searchPlaceholder={t('groups.search_communities')}
            aria-label={t('groups.filter_by_community')}
            value={selectedPartner || null}
            onChange={(key) => setSelectedPartner(key && !Array.isArray(key) ? String(key) : '')}
            className="w-full lg:w-52"
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
            startContent={<Globe className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
          >
            {partners.map((partner) => {
              const label = partner.is_external ? `${partner.name} (${t('external')})` : partner.name;
              return (
                <AutocompleteItem key={String(partner.id)} id={String(partner.id)} textValue={label}>
                  {label}
                </AutocompleteItem>
              );
            })}
          </Autocomplete>
        </div>
      </GlassCard>

      {/* Loading State */}
      {isLoading && groups.length === 0 && (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="space-y-4">
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {!isLoading && loadError && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {t('groups.unable_to_load')}
          </h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => { setCursor(null); loadGroups(false); }}
          >
            {t('groups.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Opt-in required */}
      {!isLoading && !loadError && optInRequired && <FederationOptInNotice />}

      {/* Empty State */}
      {!isLoading && !loadError && !optInRequired && groups.length === 0 && (
        <EmptyState
          icon={<UsersRound className="w-12 h-12" />}
          title={t('groups.empty_title')}
          description={t('groups.empty_description')}
        />
      )}

      {/* Groups List */}
      {!isLoading && !loadError && groups.length > 0 && (
        <>
          <div className="space-y-4">
            {groups.map((group) => (
              <motion.div
                key={`${group.timebank.id}-${group.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <FederatedGroupCard group={group} />
              </motion.div>
            ))}
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="flat"
                className="bg-theme-elevated text-theme-primary"
                onPress={handleLoadMore}
                isLoading={isLoadingMore}
              >
                {t('groups.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Federated Group Card
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FederatedGroupCardProps {
  group: FederatedGroup;
}

function FederatedGroupCard({ group }: FederatedGroupCardProps) {
  const { t } = useTranslation('federation');
  const isPrivate = group.privacy === 'private';

  return (
    <article>
      <GlassCard className="p-5 hover:scale-[1.01] transition-transform">
        <div className="flex gap-4 items-start">
          {/* Icon box */}
          <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500/20 to-accent-gradient-end/20 flex items-center justify-center">
            <UsersRound className="w-7 h-7 text-violet-400" aria-hidden="true" />
          </div>

          {/* Group Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-theme-primary text-lg">
                {group.name}
              </h3>
              {isPrivate && (
                <Chip
                  size="sm"
                  variant="flat"
                  className="bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  startContent={<Lock className="w-3 h-3" aria-hidden="true" />}
                >
                  {t('groups.private')}
                </Chip>
              )}
            </div>

            {group.description && (
              <p className="text-theme-muted text-sm line-clamp-2 mb-2">
                {group.description}
              </p>
            )}

            {/* Meta Row */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-theme-subtle">
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" aria-hidden="true" />
                {t('groups.member_count', { count: group.member_count })}
              </span>
            </div>

            {/* Footer: Community badge */}
            <div className="flex items-center justify-end mt-3 pt-2 border-t border-theme-default">
              <Chip
                size="sm"
                variant="flat"
                className="bg-accent/10 text-accent-soft-foreground"
                startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
              >
                {group.timebank.name}
              </Chip>
            </div>
          </div>
        </div>
      </GlassCard>
    </article>
  );
}

export default FederationGroupsPage;
