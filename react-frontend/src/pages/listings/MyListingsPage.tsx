// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyListingsPage — the signed-in member's own offers and requests.
 *
 * Every public listings view shows only listings that are live and approved,
 * so before this page a member could not find their own listing once it
 * expired, was waiting for an administrator, or was not approved. This page
 * groups them by what other members can see:
 *
 *   Live · Waiting for review · Not approved · Expired · Closed
 *
 * The tab and the offer/request filter live in the URL (?tab=expired&type=offer),
 * so the dashboard, notifications and the back button can all land on the
 * right view. Data comes from GET /v2/listings/mine, which returns one group
 * at a time plus a count for every group.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Bookmark from 'lucide-react/icons/bookmark';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import Hourglass from 'lucide-react/icons/hourglass';
import ListTodo from 'lucide-react/icons/list-todo';
import Lock from 'lucide-react/icons/lock';
import Pencil from 'lucide-react/icons/pen-line';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import Trash2 from 'lucide-react/icons/trash-2';
import XCircle from 'lucide-react/icons/circle-x';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { MediaRowsSkeleton } from '@/components/ui/Skeletons';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { EmptyState } from '@/components/feedback';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { PageMeta } from '@/components/seo';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import { getFormattingLocale, resolveThumbnailUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type { Listing } from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types and constants
// ─────────────────────────────────────────────────────────────────────────────

export type OwnerGroup = 'live' | 'review' | 'rejected' | 'expired' | 'closed';
type TypeFilter = 'all' | 'offer' | 'request';
type GroupCounts = Record<OwnerGroup, number>;

const GROUPS: OwnerGroup[] = ['live', 'review', 'rejected', 'expired', 'closed'];
/** Shown even when empty — the two states every member can reach. */
const ALWAYS_SHOWN: OwnerGroup[] = ['live', 'expired'];
const PAGE_SIZE = 20;
/** A live listing this close to its end date offers "Extend". */
const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_COUNTS: GroupCounts = { live: 0, review: 0, rejected: 0, expired: 0, closed: 0 };

type OwnedListing = Listing & { owner_state?: OwnerGroup };

const TAB_ICONS: Record<OwnerGroup, typeof ListTodo> = {
  live: ListTodo,
  review: Hourglass,
  rejected: XCircle,
  expired: Clock,
  closed: Lock,
};

function isGroup(value: string | null): value is OwnerGroup {
  return value !== null && (GROUPS as string[]).includes(value);
}

function isTypeFilter(value: string | null): value is TypeFilter {
  return value === 'all' || value === 'offer' || value === 'request';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days from now until `iso`, rounded up; negative once it has passed. */
function daysUntil(iso: string): number | null {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / DAY_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function MyListingsPage() {
  const { t } = useTranslation('listings');
  usePageTitle(t('mine.page_title'));
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const requestedType = searchParams.get('type');
  const tab: OwnerGroup = isGroup(requestedTab) ? requestedTab : 'live';
  const typeFilter: TypeFilter = isTypeFilter(requestedType) ? requestedType : 'all';

  const [listings, setListings] = useState<OwnedListing[]>([]);
  const [counts, setCounts] = useState<GroupCounts>(EMPTY_COUNTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  // Ignores a slow response for a tab the member has already left.
  const requestIdRef = useRef(0);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnedListing | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateParams = useCallback((next: { tab?: OwnerGroup; type?: TypeFilter }) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      const nextTab = next.tab ?? tab;
      const nextType = next.type ?? typeFilter;
      if (nextTab === 'live') params.delete('tab'); else params.set('tab', nextTab);
      if (nextType === 'all') params.delete('type'); else params.set('type', nextType);
      return params;
    }, { replace: true });
  }, [setSearchParams, tab, typeFilter]);

  const load = useCallback(async (append = false) => {
    const requestId = ++requestIdRef.current;
    if (append) setIsLoadingMore(true); else { setIsLoading(true); setLoadFailed(false); }

    const params = new URLSearchParams({ status: tab, limit: String(PAGE_SIZE) });
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (append && cursorRef.current) params.set('cursor', cursorRef.current);

    try {
      const response = await api.get<OwnedListing[]>(`/v2/listings/mine?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;

      if (!response.success || !Array.isArray(response.data)) {
        if (!append) { setListings([]); setLoadFailed(true); }
        else toast.error(t('mine.load_error'));
        return;
      }

      const meta = (response.meta ?? {}) as { cursor?: string | null; has_more?: boolean; counts?: Partial<GroupCounts> };
      const page = response.data;
      setListings((prev) => (append ? [...prev, ...page] : page));
      cursorRef.current = meta.cursor ?? null;
      setHasMore(Boolean(meta.has_more));
      if (meta.counts) setCounts({ ...EMPTY_COUNTS, ...meta.counts });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load my listings', err);
      if (!append) { setListings([]); setLoadFailed(true); }
      else toast.error(t('mine.load_error'));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [tab, typeFilter, toast, t]);

  useEffect(() => {
    if (!user?.id) return;
    cursorRef.current = null;
    void load(false);
  }, [user?.id, load]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRenew = useCallback(async (listing: OwnedListing) => {
    const wasExpired = tab === 'expired';
    setBusyId(listing.id);
    try {
      const response = await api.post(`/v2/listings/${listing.id}/renew`, {});
      if (response.success) {
        toast.success(wasExpired ? t('mine.renewed') : t('mine.extended'));
        cursorRef.current = null;
        await load(false);
      } else {
        toast.error(t('mine.renew_failed'), response.error);
      }
    } catch (err) {
      logError('Failed to renew listing', err);
      toast.error(t('mine.renew_failed'));
    } finally {
      setBusyId(null);
    }
  }, [load, tab, toast, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await api.delete(`/v2/listings/${deleteTarget.id}`);
      if (response.success) {
        toast.success(t('mine.deleted'));
        setDeleteTarget(null);
        cursorRef.current = null;
        await load(false);
      } else {
        toast.error(t('mine.delete_failed'), response.error);
      }
    } catch (err) {
      logError('Failed to delete listing', err);
      toast.error(t('mine.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, load, toast, t]);

  // ── Derived view state ─────────────────────────────────────────────────────

  const visibleTabs = useMemo(
    () => GROUPS.filter((g) => ALWAYS_SHOWN.includes(g) || counts[g] > 0 || g === tab),
    [counts, tab],
  );

  const showAttention = tab === 'live' && !isLoading && (counts.expired > 0 || counts.rejected > 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageMeta title={t('mine.page_title')} noIndex />

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <PublicPageHero
          eyebrow={t('mine.eyebrow')}
          title={t('mine.title')}
          description={t('mine.description')}
          accent="emerald"
          icon={<ClipboardList className="h-7 w-7" aria-hidden="true" />}
          stats={isLoading ? undefined : [{ label: t('mine.stat_live'), value: counts.live.toLocaleString(getFormattingLocale()) }]}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Button
                as={Link}
                to={tenantPath('/listings/create')}
                variant="primary"
                className="font-semibold"
                startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('mine.new_listing')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/listings')}
                variant="tertiary"
                startContent={<Search className="h-4 w-4" aria-hidden="true" />}
              >
                {t('mine.browse_all')}
              </Button>
            </div>
          }
        />

        {/* State tabs + offer/request filter */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs
            aria-label={t('mine.tabs_aria')}
            selectedKey={tab}
            onSelectionChange={(key) => updateParams({ tab: key as OwnerGroup })}
            variant="secondary"
            classNames={{ base: 'min-w-0', tabList: 'gap-1 sm:gap-2' }}
          >
            {visibleTabs.map((group) => {
              const Icon = TAB_ICONS[group];
              return (
                <Tab
                  key={group}
                  title={
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{t(`mine.tab_${group}`)}</span>
                      {!isLoading && (
                        <span
                          className={`rounded-full px-1.5 text-xs tabular-nums ${
                            group === 'rejected' || (group === 'expired' && counts.expired > 0)
                              ? 'bg-warning-soft text-[color:var(--warning-soft-foreground)]'
                              : 'bg-theme-elevated text-theme-muted'
                          }`}
                        >
                          {counts[group]}
                        </span>
                      )}
                    </span>
                  }
                />
              );
            })}
          </Tabs>

          <ToggleButtonGroup
            aria-label={t('mine.type_aria')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([typeFilter])}
            onSelectionChange={(keys) => {
              const [key] = Array.from(keys);
              if (isTypeFilter(key == null ? null : String(key))) updateParams({ type: key as TypeFilter });
            }}
            size="sm"
            className="shrink-0 self-start overflow-hidden rounded-full border border-theme-default bg-theme-elevated md:self-auto"
          >
            {(['all', 'offer', 'request'] as const).map((value) => (
              <ToggleButton
                key={value}
                id={value}
                variant="ghost"
                className="rounded-none px-4 text-theme-muted data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-700 dark:data-[selected=true]:text-emerald-300"
              >
                {t(`mine.type_${value}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        {/* Nudge on the Live tab when something elsewhere needs the member */}
        {showAttention && (
          <div className="space-y-2">
            {counts.expired > 0 && (
              <AttentionBanner
                text={t('mine.attention_expired', { count: counts.expired })}
                cta={t('mine.attention_expired_cta')}
                onPress={() => updateParams({ tab: 'expired' })}
              />
            )}
            {counts.rejected > 0 && (
              <AttentionBanner
                text={t('mine.attention_rejected', { count: counts.rejected })}
                cta={t('mine.attention_rejected_cta')}
                onPress={() => updateParams({ tab: 'rejected' })}
              />
            )}
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <MediaRowsSkeleton key={i} />)}
          </div>
        ) : loadFailed ? (
          <EmptyState
            icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
            title={t('mine.load_error')}
            action={{ label: t('mine.retry'), onClick: () => { void load(false); } }}
          />
        ) : listings.length === 0 ? (
          <EmptyState
            icon={(() => { const Icon = TAB_ICONS[tab]; return <Icon className="h-8 w-8" aria-hidden="true" />; })()}
            title={t(`mine.empty_${tab}_title`)}
            description={typeFilter !== 'all' ? t('mine.empty_filtered_body') : t(`mine.empty_${tab}_body`)}
            action={
              typeFilter !== 'all'
                ? { label: t('mine.show_all'), onClick: () => updateParams({ type: 'all' }) }
                : tab === 'live'
                  ? (
                    <Button as={Link} to={tenantPath('/listings/create')} variant="primary" startContent={<Plus className="h-4 w-4" aria-hidden="true" />}>
                      {t('mine.create_listing')}
                    </Button>
                  )
                  : undefined
            }
          />
        ) : (
          <>
            <ul className="space-y-3" aria-label={t('mine.list_aria')}>
              {listings.map((listing) => (
                <li key={listing.id}>
                  <OwnedListingRow
                    listing={listing}
                    group={tab}
                    isBusy={busyId === listing.id}
                    onRenew={handleRenew}
                    onDelete={setDeleteTarget}
                  />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="tertiary" onPress={() => { void load(true); }} isLoading={isLoadingMore}>
                  {t('mine.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={deleteTarget !== null} onClose={() => { if (!isDeleting) setDeleteTarget(null); }} size="sm">
        <ModalContent>
          <ModalHeader>{t('mine.delete_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">{t('mine.delete_body', { title: deleteTarget?.title ?? '' })}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setDeleteTarget(null)} isDisabled={isDeleting}>
              {t('mine.cancel')}
            </Button>
            <Button variant="danger" onPress={() => { void handleDelete(); }} isLoading={isDeleting}>
              {t('mine.delete_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function AttentionBanner({ text, cta, onPress }: { text: string; cta: string; onPress: () => void }) {
  return (
    <Alert
      color="warning"
      className="items-center"
      title={text}
      endContent={
        <Button size="sm" variant="tertiary" onPress={onPress} endContent={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />} className="shrink-0">
          {cta}
        </Button>
      }
    />
  );
}

interface OwnedListingRowProps {
  listing: OwnedListing;
  group: OwnerGroup;
  isBusy: boolean;
  onRenew: (listing: OwnedListing) => void;
  onDelete: (listing: OwnedListing) => void;
}

function OwnedListingRow({ listing, group, isBusy, onRenew, onDelete }: OwnedListingRowProps) {
  const { t } = useTranslation('listings');
  const { tenantPath } = useTenant();

  const detailPath = tenantPath(`/listings/${listing.id}`);
  const isOffer = listing.type === 'offer';
  const views = listing.view_count ?? listing.views_count ?? 0;
  const saves = listing.save_count ?? 0;
  const daysLeft = group === 'live' && listing.expires_at ? daysUntil(listing.expires_at) : null;
  const expiringSoon = daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS;

  const canEdit = group === 'live' || group === 'review' || group === 'expired';
  const canRenew = group === 'expired' || (group === 'live' && expiringSoon);
  const showStats = group === 'live' || group === 'expired';

  return (
    <GlassCard className="p-4">
      <div className="flex gap-4">
        {/* Decorative: the title link below is the accessible way in. */}
        <Link to={detailPath} className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg sm:h-20 sm:w-20" tabIndex={-1} aria-hidden="true">
          {listing.image_url ? (
            <img
              src={resolveThumbnailUrl(listing.image_url, { width: 160, height: 160 })}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center ${
                isOffer
                  ? 'bg-success-soft text-[color:var(--success-soft-foreground)]'
                  : 'bg-warning-soft text-[color:var(--warning-soft-foreground)]'
              }`}
            >
              <ListTodo className="h-7 w-7" aria-hidden="true" />
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={isOffer ? 'success' : 'warning'}>
              {isOffer ? t('offer') : t('request')}
            </Chip>
            {listing.category_name && (
              <span className="text-xs text-theme-muted">{listing.category_name}</span>
            )}
          </div>

          <h2 className="text-base font-semibold leading-snug text-theme-primary">
            <Link to={detailPath} className="hover:text-accent hover:underline focus-visible:underline">
              {listing.title}
            </Link>
          </h2>

          <StateLine listing={listing} group={group} daysLeft={daysLeft} expiringSoon={expiringSoon} />

          {showStats && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-theme-muted">
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                {t('mine.views', { count: views })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                {t('mine.saves', { count: saves })}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-theme-default pt-3">
        <Button
          as={Link}
          to={detailPath}
          size="sm"
          variant="tertiary"
          startContent={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
          aria-label={t('mine.action_view_aria', { title: listing.title })}
          // On phones the title already opens the listing; three buttons fit one row.
          className="hidden sm:inline-flex"
        >
          {t('mine.action_view')}
        </Button>
        {canEdit && (
          <Button
            as={Link}
            to={tenantPath(`/listings/edit/${listing.id}`)}
            size="sm"
            variant="tertiary"
            startContent={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
            aria-label={t('mine.action_edit_aria', { title: listing.title })}
          >
            {t('mine.action_edit')}
          </Button>
        )}
        {canRenew && (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => onRenew(listing)}
            isLoading={isBusy}
            startContent={isBusy ? undefined : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            aria-label={t(group === 'expired' ? 'mine.action_renew_aria' : 'mine.action_extend_aria', { title: listing.title })}
          >
            {group === 'expired' ? t('mine.action_renew') : t('mine.action_extend')}
          </Button>
        )}
        <Button
          size="sm"
          variant="danger-soft"
          onPress={() => onDelete(listing)}
          isDisabled={isBusy}
          startContent={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
          aria-label={t('mine.action_delete_aria', { title: listing.title })}
        >
          {t('mine.action_delete')}
        </Button>
      </div>
    </GlassCard>
  );
}

function StateLine({ listing, group, daysLeft, expiringSoon }: {
  listing: OwnedListing;
  group: OwnerGroup;
  daysLeft: number | null;
  expiringSoon: boolean;
}) {
  const { t } = useTranslation('listings');

  if (group === 'review') {
    return <p className="text-sm text-theme-muted">{t('mine.state_review')}</p>;
  }

  if (group === 'rejected') {
    return (
      <Alert
        color="danger"
        title={t('mine.state_rejected')}
        description={
          <span className="block space-y-1">
            {listing.rejection_reason && (
              <span className="block font-medium">{t('mine.rejected_reason', { reason: listing.rejection_reason })}</span>
            )}
            <span className="block">{t('mine.state_rejected_next')}</span>
          </span>
        }
      />
    );
  }

  if (group === 'expired') {
    const date = listing.expires_at ? formatDate(listing.expires_at) : '';
    return (
      <p className="text-sm text-[color:var(--warning-soft-foreground)]">
        {date ? t('mine.state_expired', { date }) : t('mine.state_expired_no_date')}
      </p>
    );
  }

  if (group === 'closed') {
    return <p className="text-sm text-theme-muted">{t('mine.state_closed')}</p>;
  }

  // Live
  const posted = listing.created_at ? formatDate(listing.created_at) : '';
  let expiry: string | null = null;
  if (listing.expires_at && daysLeft !== null) {
    if (expiringSoon) {
      expiry = daysLeft <= 0 ? t('mine.expires_today') : t('mine.expires_in_days', { count: daysLeft });
    } else {
      expiry = t('mine.visible_until', { date: formatDate(listing.expires_at) });
    }
  }

  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-theme-muted">
      {posted && <span>{t('mine.posted_on', { date: posted })}</span>}
      {expiry && (
        <span className={expiringSoon ? 'font-medium text-[color:var(--warning-soft-foreground)]' : undefined}>
          {expiry}
        </span>
      )}
    </p>
  );
}

export default MyListingsPage;
