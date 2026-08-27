// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Autocomplete } from '@/components/ui/Autocomplete';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';

/**
 * Federation Members Page
 *
 * Browse and search members from partner communities.
 * Route: /federation/members
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import MapPin from 'lucide-react/icons/map-pin';
import MessageSquare from 'lucide-react/icons/message-square';
import User from 'lucide-react/icons/user';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Users from 'lucide-react/icons/users';
import Compass from 'lucide-react/icons/compass';
import Car from 'lucide-react/icons/car';
import Home from 'lucide-react/icons/house';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { FederatedTrustBadge } from '@/components/federation';
import { FederationOptInNotice } from '@/components/federation/FederationOptInNotice';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import type { FederatedMember, FederationPartner } from '@/types/api';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Constants
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type ServiceReachFilter = 'all' | 'local_only' | 'remote_ok' | 'travel_ok';

type FederationSourceMeta = {
  pagination_scope?: string;
  cursor_scope?: string;
  load_more_scope?: string;
  external_pagination_scope?: string;
  external_results_paginated?: boolean;
  external_results_included?: boolean;
  source_counts?: {
    internal_returned?: number;
    internal_total_items?: number;
    external_returned?: number;
    returned_total?: number;
  };
};

const SERVICE_REACH_OPTIONS: { key: ServiceReachFilter; icon: typeof Home }[] = [
  { key: 'all', icon: Users },
  { key: 'local_only', icon: Home },
  { key: 'remote_ok', icon: Compass },
  { key: 'travel_ok', icon: Car },
];



const SERVICE_REACH_ICONS: Record<string, typeof Home> = {
  local_only: Home,
  remote_ok: Compass,
  travel_ok: Car,
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Page Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function FederationMembersPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('members.page_title'));
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { hasFeature, tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Redirect if federation not enabled
  const federationEnabled = hasFeature('federation');
  useEffect(() => {
    if (!federationEnabled) {
      toast.warning(t('members.federation_not_enabled'));
      navigate(tenantPath('/federation'), { replace: true });
    }
  }, [federationEnabled, navigate, toast, t, tenantPath]);

  // Data state
  const [members, setMembers] = useState<FederatedMember[]>([]);
  const [partners, setPartners] = useState<FederationPartner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optInRequired, setOptInRequired] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [sourceMeta, setSourceMeta] = useState<FederationSourceMeta | null>(null);

  // Filter state — initialised from URL params so links like
  // /federation/members?partner_id=X (partner detail "Browse Members") apply the filter
  const initialReach = searchParams.get('service_reach') as ServiceReachFilter | null;
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [selectedPartner, setSelectedPartner] = useState<string>(searchParams.get('partner_id') || '');
  const [serviceReach, setServiceReach] = useState<ServiceReachFilter>(
    initialReach && SERVICE_REACH_OPTIONS.some((option) => option.key === initialReach) ? initialReach : 'all'
  );
  const [skillsFilter, setSkillsFilter] = useState(searchParams.get('skills') || '');
  const [debouncedSkillsFilter, setDebouncedSkillsFilter] = useState(skillsFilter);

  // Debounce refs
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skillsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const loadMembersRef = useRef<(append?: boolean) => Promise<void>>(null!);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Debounce skills filter input
  useEffect(() => {
    if (skillsTimeoutRef.current) {
      clearTimeout(skillsTimeoutRef.current);
    }
    skillsTimeoutRef.current = setTimeout(() => {
      setDebouncedSkillsFilter(skillsFilter);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (skillsTimeoutRef.current) {
        clearTimeout(skillsTimeoutRef.current);
      }
    };
  }, [skillsFilter]);

  // Load partners for dropdown
  useEffect(() => {
    if (!federationEnabled) return;

    async function fetchPartners() {
      try {
        const response = await api.get<FederationPartner[]>('/v2/federation/partners');
        if (response.success && response.data) {
          setPartners(response.data);
        }
      } catch (err) {
        logError('Failed to load federation partners', err);
      }
    }

    fetchPartners();
  }, [federationEnabled]);

  // Load members
  const loadMembers = useCallback(async (append = false, cursorParam?: string) => {
    if (!federationEnabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (selectedPartner) params.set('partner_id', selectedPartner);
      if (serviceReach !== 'all') params.set('service_reach', serviceReach);
      if (debouncedSkillsFilter.trim()) params.set('skills', debouncedSkillsFilter.trim());
      params.set('per_page', ITEMS_PER_PAGE.toString());

      if (append && cursorParam) {
        params.set('cursor', cursorParam);
      }

      const response = await api.get<FederatedMember[]>(
        `/v2/federation/members?${params}`,
        { signal: controller.signal }
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        if (!append) setOptInRequired(false);
        if (append) {
          setMembers((prev) => [...prev, ...response.data!]);
        } else {
          setMembers(response.data);
        }
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
        setCursor(response.meta?.cursor ?? undefined);
        if (!append) {
          setSourceMeta(response.meta ? {
            pagination_scope: response.meta.pagination_scope,
            cursor_scope: response.meta.cursor_scope,
            load_more_scope: response.meta.load_more_scope,
            external_pagination_scope: response.meta.external_pagination_scope,
            external_results_paginated: response.meta.external_results_paginated,
            external_results_included: response.meta.external_results_included,
            source_counts: response.meta.source_counts,
          } : null);

          if (typeof response.meta?.total_items === 'number') {
            setTotalCount(response.meta.total_items);
          } else {
            setTotalCount(null);
          }
        }
      } else {
        if (!append) {
          if (response.code === 'FEDERATION_NOT_ENABLED') {
            // The viewer has not opted in — show the opt-in CTA instead of an
            // un-retryable error card.
            setOptInRequired(true);
            setMembers([]);
          } else {
            setError(tRef.current('members.load_error'));
          }
          setSourceMeta(null);
        } else {
          toastRef.current.error(tRef.current('members.load_more_error'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load federated members', err);
      if (!append) {
        setError(tRef.current('members.load_error'));
        setSourceMeta(null);
      } else {
        toastRef.current.error(tRef.current('members.load_more_error'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [federationEnabled, debouncedQuery, selectedPartner, serviceReach, debouncedSkillsFilter]);
  loadMembersRef.current = loadMembers;

  // Load on mount and when filters change
  useEffect(() => {
    setCursor(undefined);
    setHasMore(true);
    loadMembersRef.current();

    return () => {
      abortRef.current?.abort();
    };
  }, [debouncedQuery, selectedPartner, serviceReach, debouncedSkillsFilter]);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadMembers(true, cursor);
  }, [isLoadingMore, hasMore, loadMembers, cursor]);

  // Sync filters back to URL params (mirrors FederationListingsPage)
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedPartner) params.set('partner_id', selectedPartner);
    if (serviceReach !== 'all') params.set('service_reach', serviceReach);
    if (skillsFilter) params.set('skills', skillsFilter);
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedPartner, serviceReach, skillsFilter, setSearchParams]);

  const externalResultCount = sourceMeta?.source_counts?.external_returned ?? 0;
  const visibleResultCount = sourceMeta?.pagination_scope === 'external_partner'
    ? members.length
    : Math.max(0, members.length - externalResultCount);
  const sourceNoteKey = sourceMeta?.pagination_scope === 'external_partner'
    ? 'members.external_source_note_external_only'
    : 'members.external_source_note';

  // Navigation handlers
  const handleViewProfile = useCallback((member: FederatedMember) => {
    // External members (id starts with 'ext-') don't have profile pages
    const memberId = String(member.id);
    if (member.is_external || memberId.startsWith('ext-')) {
      toast.info(
        t('members.external_profile_title'),
        t('members.external_profile_message')
      );
      return;
    }
    const tenantId = member.tenant_id ?? member.timebank?.id;
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(String(tenantId))}` : '';
    navigate(tenantPath(`/federation/members/${member.id}${tenantParam}`));
  }, [navigate, tenantPath, toast, t]);

  const handleSendMessage = useCallback((member: FederatedMember) => {
    const memberName = resolveUserDisplayName(member);
    const nameParam = memberName ? `&name=${encodeURIComponent(memberName)}` : '';
    navigate(
      tenantPath(`/federation/messages?compose=true&to_user=${member.id}&to_tenant=${member.timebank.id}${nameParam}`)
    );
  }, [navigate, tenantPath]);

  // Don't render if federation is disabled (redirect in progress)
  if (!federationEnabled) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('members.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('members.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('members.breadcrumb_members') },
        ]}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <Globe className="w-7 h-7 text-accent dark:text-accent" aria-hidden="true" />
          {t('members.title')}
        </h1>
        <p className="text-theme-muted mt-1">
          {t('members.subtitle')}
        </p>
      </div>

      {/* Filter Bar */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-4">
          {/* Row 1: Search + Partner dropdown */}
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <SearchField
                placeholder={t('members.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('members.aria_search')}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                }}
              />
            </div>

            <Autocomplete
              placeholder={t('members.all_communities')}
              searchPlaceholder={t('members.search_communities')}
              value={selectedPartner || null}
              onChange={(key) => setSelectedPartner(key && !Array.isArray(key) ? String(key) : '')}
              className="w-full lg:w-56"
              aria-label={t('members.aria_filter_community')}
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

          {/* Row 2: Service reach chips + Skills filter */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <ToggleButtonGroup
              aria-label={t('members.service_reach_filter')}
              selectionMode="single"
              disallowEmptySelection
              isDetached
              size="sm"
              selectedKeys={new Set([serviceReach])}
              onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setServiceReach(k as ServiceReachFilter); }}
              className="flex flex-wrap gap-2"
            >
              {SERVICE_REACH_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleButton
                    key={option.key}
                    id={option.key}
                    variant="ghost"
                    className="bg-theme-elevated text-theme-muted hover:bg-theme-hover data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {t(`members.reach_${option.key}`)}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>

            <div className="flex-1 w-full sm:w-auto">
              <Input
                placeholder={t('members.skills_filter_placeholder')}
                value={skillsFilter}
                onChange={(e) => setSkillsFilter(e.target.value)}
                size="sm"
                aria-label={t('members.aria_filter_skills')}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                }}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Results Count */}
      {!isLoading && !error && totalCount !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            variant="flat"
            size="sm"
            className="bg-theme-elevated text-theme-muted"
          >
            {t('members.showing_count', { shown: visibleResultCount.toLocaleString(getFormattingLocale()), total: totalCount.toLocaleString(getFormattingLocale()) })}
          </Chip>
          {externalResultCount > 0 && (
            <Chip
              variant="flat"
              size="sm"
              className="bg-theme-elevated text-theme-muted"
            >
              {t(sourceNoteKey, { count: externalResultCount })}
            </Chip>
          )}
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">
            {t('members.unable_to_load')}
          </h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            variant="primary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadMembers()}
          >
            {t('members.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading State */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('members.loading')} className="flex items-center justify-center py-20">
          <Spinner size="lg" label={t('members.loading')} />
        </div>
      )}

      {/* Opt-in required */}
      {!isLoading && !error && optInRequired && <FederationOptInNotice />}

      {/* Empty States */}
      {!isLoading && !error && !optInRequired && members.length === 0 && (
        <>
          {partners.length === 0 ? (
            <EmptyState
              icon={<Globe className="w-12 h-12 text-theme-subtle" />}
              title={t('members.no_partner_communities')}
              description={t('members.no_partner_communities_description')}
            />
          ) : (
            <EmptyState
              icon={<Users className="w-12 h-12 text-theme-subtle" />}
              title={t('members.no_members_found')}
              description={
                debouncedQuery || skillsFilter || selectedPartner || serviceReach !== 'all'
                  ? t('members.no_members_search')
                  : t('members.no_members_available')
              }
            />
          )}
        </>
      )}

      {/* Members Grid */}
      {!isLoading && !error && members.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {members.map((member) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <FederatedMemberCard
                  member={member}
                  isAuthenticated={isAuthenticated}
                  onViewProfile={handleViewProfile}
                  onSendMessage={handleSendMessage}
                />
              </motion.div>
            ))}
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="pt-4 text-center">
              <Button
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                onPress={handleLoadMore}
                isLoading={isLoadingMore}
              >
                {t('members.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Member Card Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FederatedMemberCardProps {
  member: FederatedMember;
  isAuthenticated: boolean;
  onViewProfile: (member: FederatedMember) => void;
  onSendMessage: (member: FederatedMember) => void;
}

const FederatedMemberCard = memo(function FederatedMemberCard({
  member,
  isAuthenticated,
  onViewProfile,
  onSendMessage,
}: FederatedMemberCardProps) {
  const { t } = useTranslation('federation');
  const displayName =
    resolveUserDisplayName(member) ||
    t('members.member_fallback');

  const skills = member.skills ?? [];
  const visibleSkills = skills.slice(0, 5);
  const remainingSkillsCount = skills.length - visibleSkills.length;

  const reachKey = member.service_reach ?? 'local_only';
  const ReachIcon = SERVICE_REACH_ICONS[reachKey] ?? Home;

  return (
    <GlassCard className="p-5 flex flex-col h-full">
      {/* Avatar + Community Badge */}
      <div className="flex items-start gap-4 mb-3">
        <div className="relative flex-shrink-0">
          <Avatar
            src={resolveAvatarUrl(member.avatar)}
            name={displayName}
            className="w-14 h-14 ring-2 ring-theme-muted/20"
          />
          {/* Community badge overlay */}
          <div
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center ring-2 ring-white dark:ring-gray-900"
            title={member.timebank.name}
          >
            <Globe className="w-3 h-3 text-white" aria-hidden="true" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-theme-primary text-lg leading-tight truncate">
            {displayName}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Chip
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
            >
              {member.timebank.name}
            </Chip>
            {member.is_external && (
              <Chip
                size="sm"
                variant="flat"
                className="bg-accent/10 text-accent dark:text-accent"
                startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
              >
                {t('external')}
              </Chip>
            )}
            {typeof member.reputation_score === 'number' && (member.reputation_count ?? 0) > 0 && (
              <FederatedTrustBadge
                score={member.reputation_score}
                reviewCount={member.reputation_count ?? 0}
                isFederated
                size="sm"
              />
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {member.bio && (
        <p className="text-sm text-theme-muted line-clamp-2 mb-3">
          {member.bio}
        </p>
      )}

      {/* Skills */}
      {visibleSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {visibleSkills.map((skill) => (
            <Chip
              key={skill}
              size="sm"
              variant="flat"
              className="bg-theme-elevated text-theme-subtle text-xs"
            >
              {skill}
            </Chip>
          ))}
          {remainingSkillsCount > 0 && (
            <Chip
              size="sm"
              variant="flat"
              className="bg-theme-elevated text-theme-subtle text-xs"
            >
              {t('members.more_skills', { count: remainingSkillsCount })}
            </Chip>
          )}
        </div>
      )}

      {/* Location + Service Reach */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-theme-subtle mb-4 mt-auto">
        {member.location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="truncate max-w-[140px]">{member.location}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <ReachIcon className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t(`members.reach_${reachKey}`)}</span>
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2 border-t border-theme-default">
        {!member.is_external && (
          <Button
            size="sm"
            variant="flat"
            className="flex-1 bg-theme-elevated text-theme-primary hover:bg-theme-hover"
            startContent={<User className="w-3.5 h-3.5" aria-hidden="true" />}
            onPress={() => onViewProfile(member)}
          >
            {t('members.view_profile')}
          </Button>
        )}
        {/* Hide the compose button when the member has federated messaging off —
            the backend 403s (MESSAGING_DISABLED) only after the user composes.
            External members omit the field (partner-level gating), so only an
            explicit false hides it. */}
        {isAuthenticated && member.messaging_enabled !== false && (
          <Button
            size="sm"
            variant="primary"
            className="flex-1"
            startContent={<MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />}
            onPress={() => onSendMessage(member)}
          >
            {t('members.send_message')}
          </Button>
        )}
      </div>
    </GlassCard>
  );
});

export default FederationMembersPage;
