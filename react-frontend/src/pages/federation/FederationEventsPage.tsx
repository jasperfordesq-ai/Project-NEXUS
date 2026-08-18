// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Autocomplete } from '@/components/ui/Autocomplete';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { SearchField } from '@/components/ui/SearchField';
import { MediaRowsSkeleton } from '@/components/ui/Skeletons';
import { Switch } from '@/components/ui/Switch';

/**
 * Federation Events Page - Browse events from partner communities
 *
 * Features:
 * - Search input with debounce
 * - Partner community Select dropdown
 * - Upcoming-only toggle via Switch
 * - Card list layout (not grid) with date box fallback
 * - Cursor-based pagination with Load More
 * - Loading skeletons and error states
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import Calendar from 'lucide-react/icons/calendar';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Wifi from 'lucide-react/icons/wifi';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { FederationOptInNotice } from '@/components/federation/FederationOptInNotice';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import type { FederatedEvent, FederationPartner } from '@/types/api';

const SEARCH_DEBOUNCE_MS = 300;
const PER_PAGE = 20;

export function FederationEventsPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('events.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Data
  const [events, setEvents] = useState<FederatedEvent[]>([]);
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
  const [upcomingOnly, setUpcomingOnly] = useState(
    searchParams.get('upcoming') !== 'false'
  );

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const loadEventsRef = useRef<(append?: boolean) => Promise<void>>(null!);

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

  // â”€â”€ Load events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadEvents = useCallback(
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
        if (upcomingOnly) params.set('upcoming', 'true');
        if (append && cursor) params.set('cursor', cursor);
        params.set('per_page', String(PER_PAGE));

        const response = await api.get<FederatedEvent[]>(
          `/v2/federation/events?${params}`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted) return;

        if (response.success && response.data) {
          if (!append) setOptInRequired(false);
          if (append) {
            setEvents((prev) => [...prev, ...response.data!]);
          } else {
            setEvents(response.data);
          }
          const nextCursor = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
          setCursor(nextCursor);
          setHasMore(response.meta?.has_more ?? response.data.length >= PER_PAGE);
        } else {
          if (!append) {
            setEvents([]);
            // The backend 403s with FEDERATION_NOT_ENABLED when the viewer has
            // not opted in — show the opt-in CTA instead of "nothing found".
            setOptInRequired(response.code === 'FEDERATION_NOT_ENABLED');
          }
          setHasMore(false);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logError('Failed to load federated events', error);
        if (!append) {
          setLoadError(tRef.current('events.load_error'));
        } else {
          toastRef.current.error(tRef.current('events.load_more_error'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [debouncedQuery, selectedPartner, upcomingOnly, cursor]
  );
  loadEventsRef.current = loadEvents;

  // Reload on filter change
  useEffect(() => {
    setCursor(null);
    setHasMore(false);
    loadEventsRef.current(false);

    return () => {
      abortRef.current?.abort();
    };
  }, [debouncedQuery, selectedPartner, upcomingOnly]);

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedPartner) params.set('partner_id', selectedPartner);
    if (!upcomingOnly) params.set('upcoming', 'false');
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedPartner, upcomingOnly, setSearchParams]);

  function handleLoadMore() {
    if (!isLoadingMore && hasMore) {
      loadEvents(true);
    }
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('events.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('events.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('events.breadcrumb_events') },
        ]}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <Calendar className="w-7 h-7 text-amber-400" aria-hidden="true" />
          {t('events.heading')}
        </h1>
        <p className="text-theme-muted mt-1">
          {t('events.subheading')}
        </p>
      </div>

      {/* Filter Bar */}
      <GlassCard className="p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <SearchField
              placeholder={t('events.search_placeholder')}
              aria-label={t('events.search_placeholder')}
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
            placeholder={t('events.all_communities')}
            searchPlaceholder={t('events.search_communities')}
            aria-label={t('events.filter_by_community')}
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

          {/* Upcoming toggle */}
          <Switch
            isSelected={upcomingOnly}
            onChange={setUpcomingOnly}
            color="primary"
            className="self-start"
            classNames={{
              label: 'text-sm font-medium text-theme-primary',
            }}
          >
            {t('events.upcoming_only')}
          </Switch>
        </div>
      </GlassCard>

      {/* Loading State */}
      {isLoading && events.length === 0 && (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="space-y-4">
          {[1, 2, 3].map((i) => (
            <MediaRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {!isLoading && loadError && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {t('events.unable_to_load')}
          </h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            variant="primary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => { setCursor(null); loadEvents(false); }}
          >
            {t('events.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Opt-in required */}
      {!isLoading && !loadError && optInRequired && <FederationOptInNotice />}

      {/* Empty State */}
      {!isLoading && !loadError && !optInRequired && events.length === 0 && (
        <EmptyState
          icon={<Calendar className="w-12 h-12" />}
          title={t('events.empty_title')}
          description={
            upcomingOnly
              ? t('events.empty_description_upcoming')
              : t('events.empty_description_general')
          }
        />
      )}

      {/* Events List */}
      {!isLoading && !loadError && events.length > 0 && (
        <>
          <div className="space-y-4">
            {events.map((event) => (
              <motion.div
                key={`${event.timebank.id}-${event.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <FederatedEventCard event={event} />
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
                {t('events.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Federated Event Card
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FederatedEventCardProps {
  event: FederatedEvent;
}

function FederatedEventCard({ event }: FederatedEventCardProps) {
  const { t } = useTranslation('federation');
  const startDate = new Date(event.start_date);
  const isPast = startDate < new Date();
  const avatarSrc = resolveAvatarUrl(event.organizer?.avatar);
  const coverProps = event.cover_image
    ? responsiveThumbnailProps(event.cover_image, {
        width: 240,
        height: 240,
        sizes: '(min-width: 640px) 96px, 80px',
      })
    : null;

  const formattedDate = startDate.toLocaleDateString(getFormattingLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = startDate.toLocaleTimeString(getFormattingLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <article>
      <GlassCard className={`p-5 hover:scale-[1.01] transition-transform ${isPast ? 'opacity-60' : ''}`}>
        <div className="flex gap-3 sm:gap-4">
          {/* Cover Image or Date Box */}
          {coverProps ? (
            <div className="flex-shrink-0 w-20 sm:w-24 h-20 sm:h-24 rounded-lg overflow-hidden bg-theme-hover">
              <img
                {...coverProps}
                alt={event.title}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : (
            <div className="flex-shrink-0 w-14 sm:w-16 text-center">
              <time
                dateTime={event.start_date}
                className="block bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-lg p-2"
              >
                <span className="text-theme-warning text-xs font-medium uppercase block">
                  {startDate.toLocaleString(getFormattingLocale(), { month: 'short' })}
                </span>
                <span className="text-theme-primary text-xl sm:text-2xl font-bold block">
                  {startDate.getDate()}
                </span>
                <span className="text-theme-subtle text-xs block">
                  {startDate.toLocaleString(getFormattingLocale(), { weekday: 'short' })}
                </span>
              </time>
            </div>
          )}

          {/* Event Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-theme-primary text-lg">
                {event.title}
              </h3>
              {event.is_online && (
                <Chip
                  size="sm"
                  variant="flat"
                  className="bg-cyan-500/20 text-cyan-600 dark:text-cyan-400"
                  startContent={<Wifi className="w-3 h-3" aria-hidden="true" />}
                >
                  {t('events.online')}
                </Chip>
              )}
            </div>

            <p className="text-theme-muted text-sm line-clamp-2 mb-2">
              {event.description}
            </p>

            {/* Meta Row */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-theme-subtle">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" aria-hidden="true" />
                <time dateTime={event.start_date}>
                  {t('events.date_at_time', { date: formattedDate, time: formattedTime })}
                </time>
              </span>

              {event.location && !event.is_online && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  <span className="truncate max-w-[150px]">{event.location}</span>
                </span>
              )}

              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" aria-hidden="true" />
                {t('events.attendees_going', { count: event.attendees_count })}
              </span>
            </div>

            {/* Footer: Organizer + Community */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-theme-default">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar
                  src={avatarSrc}
                  name={event.organizer?.name || t('events.organizer_fallback')}
                  size="sm"
                  className="flex-shrink-0 w-6 h-6"
                />
                <span className="text-sm text-theme-subtle truncate">
                  {event.organizer?.name}
                </span>
              </div>
              <Chip
                size="sm"
                variant="flat"
                className="bg-accent/10 text-accent dark:text-accent"
                startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
              >
                {event.timebank.name}
              </Chip>
            </div>
          </div>

        </div>
      </GlassCard>
    </article>
  );
}

export default FederationEventsPage;
