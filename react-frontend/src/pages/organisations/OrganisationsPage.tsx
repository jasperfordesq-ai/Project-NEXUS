// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisations Page - Browse volunteer organisations
 *
 * Uses V2 API: GET /api/v2/volunteering/organisations
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Building2 from 'lucide-react/icons/building-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Globe from 'lucide-react/icons/globe';
import Heart from 'lucide-react/icons/heart';
import Clock from 'lucide-react/icons/clock';
import Star from 'lucide-react/icons/star';
import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { CoverTile } from '@/components/ui/CoverTile';
import { coverSeed } from '@/lib/coverSeeds';
import Building2Icon from 'lucide-react/icons/building-2';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Breadcrumbs } from '@/components/navigation';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { extractCollectionItems } from '@/pages/volunteering/extractCollectionItems';

/* ───────────────────────── Types ───────────────────────── */

interface Organisation {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
  contact_email: string | null;
  opportunity_count: number;
  total_hours: number;
  volunteer_count: number;
  average_rating: number | null;
  created_at: string;
}

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/* ───────────────────────── Main Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function OrganisationsPage() {
  const { t } = useTranslation('community');
  usePageTitle(t('organisations.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();

  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [manageableOrgs, setManageableOrgs] = useState<{ id: number }[]>([]);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cursor for "load more" pagination held in a ref, so loadOrganisations does
  // not have to be recreated (and re-fire) every time the cursor advances.
  const cursorRef = useRef<string | undefined>(undefined);
  // AbortController ref to cancel stale requests. A superseded search — or an
  // out-of-order "load more" — must never overwrite or append to newer results.
  const abortRef = useRef<AbortController | null>(null);
  // Stable ref for t — avoids re-creating loadOrganisations when the i18n
  // namespace finishes loading mid-flight.
  const tRef = useRef(t);
  tRef.current = t;

  // Does the signed-in user own/admin any (live) organisation? If so we surface a
  // clear "Manage my organisation" entry here, not just on the volunteering page.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    api.get<unknown>('/v2/volunteering/my-organisations')
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;
        const items = extractCollectionItems<{ id: number; status: string; member_role: string }>(res.data);
        setManageableOrgs(
          items
            .filter((o) => ['approved', 'active'].includes(o.status) && ['owner', 'admin'].includes(o.member_role))
            .map((o) => ({ id: o.id })),
        );
      })
      .catch(() => { /* silent — the manage entry just won't show */ });
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  const soleManagedOrg = manageableOrgs.length === 1 ? manageableOrgs[0] : undefined;
  const manageHref = soleManagedOrg
    ? tenantPath(`/volunteering/org/${soleManagedOrg.id}/dashboard`)
    : tenantPath('/volunteering/my-organisations');

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  const loadOrganisations = useCallback(async (append = false) => {
    // Cancel any in-flight request. A new search (or a reset) must invalidate a
    // pending "load more" so its page can never append to a newer query.
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
      params.set('per_page', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);
      if (debouncedQuery.trim()) params.set('search', debouncedQuery.trim());

      // api.get() already unwraps { data: [...], meta: {...} } → response.data = Organisation[]
      const response = await api.get<Organisation[]>(
        `/v2/volunteering/organisations?${params}`
      );

      // Stale-response guard: a newer request (search change / reset) aborted
      // this controller while it was in flight — drop the result entirely so a
      // superseded page never overwrites or appends to fresher results.
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = extractCollectionItems<Organisation>(response.data);

        if (append) {
          setOrganisations((prev) => [...prev, ...items]);
        } else {
          setOrganisations(items);
        }
        cursorRef.current = response.meta?.cursor ?? undefined;
        setHasMore(response.meta?.has_more ?? false);
      } else {
        if (!append) setError(tRef.current('organisations.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load organisations', err);
      if (!append) setError(tRef.current('organisations.error_load_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery]);

  // (Re)load whenever the debounced query changes. loadOrganisations is
  // recreated on every debouncedQuery change, so depending on it here runs the
  // reset load exactly once per query. Reset the cursor first so the fresh query
  // starts from page one, and abort any in-flight request on cleanup / unmount.
  useEffect(() => {
    cursorRef.current = undefined;
    loadOrganisations();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadOrganisations]);

  return (
    <div className="space-y-6">
      <PageMeta title={t('organisations.page_title')} description={t('organisations.page_description')} />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('organisations.breadcrumb_volunteering'), href: tenantPath('/volunteering') },
        { label: t('organisations.breadcrumb_organisations') },
      ]} />

      <PublicPageHero
        eyebrow={t('organisations.hero_eyebrow')}
        title={t('organisations.heading')}
        description={t('organisations.subtitle')}
        accent="indigo"
        icon={<Building2 className="h-7 w-7" aria-hidden="true" />}
        stats={organisations.length > 0 && !isLoading ? [{ label: t('organisations.hero_showing_label'), value: organisations.length.toLocaleString(getFormattingLocale()) }] : undefined}
        action={
          isAuthenticated ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {manageableOrgs.length > 0 && (
                <Button as={Link} to={manageHref}
                  className="w-full sm:w-auto bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                  startContent={<Building2 className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('organisations.manage_my_button')}
                </Button>
              )}
              <Button as={Link} to={tenantPath('/organisations/register')}
                variant={manageableOrgs.length > 0 ? 'secondary' : 'primary'}
                className={manageableOrgs.length > 0 ? 'w-full sm:w-auto' : 'w-full sm:w-auto bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'}
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('organisations.register_button')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="w-full sm:max-w-md">
        <SearchField
          placeholder={t('organisations.search_placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t('organisations.search_placeholder')}
          classNames={{
            input: 'bg-transparent text-theme-primary',
            inputWrapper: 'bg-theme-elevated border-theme-default',
          }}
        />
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('organisations.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadOrganisations()}
          >
            {t('organisations.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Organisations Grid */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label={t('organisations.loading')}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : organisations.length === 0 ? (
            <PublicEmptyState
              icon={<Building2 className="w-12 h-12" aria-hidden="true" />}
              title={t('organisations.no_organisations_found')}
              description={debouncedQuery ? t('organisations.try_different_search') : t('organisations.no_organisations_available')}
              accent="indigo"
              tips={[t('organisations.empty_tip_volunteer'), t('organisations.empty_tip_partner'), t('organisations.empty_tip_register')]}
              action={
                isAuthenticated ? (
                  <Button as={Link} to={tenantPath('/organisations/register')} variant="primary" startContent={<Plus className="w-4 h-4" aria-hidden="true" />}>
                    {t('organisations.register_button')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {organisations.map((org) => (
                  <motion.div key={org.id} variants={itemVariants}>
                    <OrganisationCard organisation={org} />
                  </motion.div>
                ))}
              </motion.div>

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="secondary"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={() => loadOrganisations(true)}
                    isLoading={isLoadingMore}
                  >
                    {t('organisations.load_more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Organisation Card ───────────────────────── */

interface OrganisationCardProps {
  organisation: Organisation;
}

function OrganisationCard({ organisation }: OrganisationCardProps) {
  const { t } = useTranslation('community');
  const { tenantPath } = useTenant();
  return (
    <Link to={tenantPath(`/organisations/${organisation.id}`)}>
      <GlassCard hoverable className="p-5 h-full">
        <div className="flex items-center gap-3 mb-3">
          {/* Its logo, or a tile in its own colour — the same as its page. */}
          <CoverTile
            data-testid="organisation-card-tile"
            seed={coverSeed.organisation(organisation.id)}
            icon={Building2Icon}
            imageUrl={organisation.logo_url}
            name={organisation.name}
            className="h-14 w-14 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-theme-primary truncate">{organisation.name}</h3>
          </div>
        </div>

        {organisation.description && (
          <p className="text-sm text-theme-muted mb-3 line-clamp-2">{organisation.description}</p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle">
          {organisation.opportunity_count > 0 && (
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-400" aria-hidden="true" />
              {t('organisations.opportunity_count', { count: organisation.opportunity_count })}
            </span>
          )}
          {organisation.volunteer_count > 0 && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3 text-accent" aria-hidden="true" />
              {t('organisations.volunteer_count', { count: organisation.volunteer_count })}
            </span>
          )}
          {organisation.total_hours > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-emerald-400" aria-hidden="true" />
              {t('organisations.hours_logged', { hours: organisation.total_hours })}
            </span>
          )}
          {organisation.average_rating && organisation.average_rating > 0 && (
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" aria-hidden="true" />
              {organisation.average_rating.toFixed(1)}
            </span>
          )}
          {organisation.website && (
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3 text-blue-400" aria-hidden="true" />
              {t('organisations.website')}
            </span>
          )}
        </div>
      </GlassCard>
    </Link>
  );
}

export default OrganisationsPage;
