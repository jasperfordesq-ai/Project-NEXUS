// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Risk Tags
 * View, filter, create, edit and remove listing risk tags.
 * Parity: PHP BrokerControlsController::riskTags()
 *
 * Broker design language: BrokerPageShell frame, a KPI header with per-level
 * counts (deep-linked to the ?level= filter the dashboard already uses) ABOVE
 * the level tabs, BrokerStatusChip severity chips, category iconography and
 * consolidated requirement chips. Listing titles open the member-facing
 * listing; owners open the panel-wide member window. `?listing=<id>` opens
 * the tag form for that listing (edit if it is already tagged). The form
 * modal and the listing picker live in `components/risk-tags/`.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldHalf from 'lucide-react/icons/shield-half';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import CircleAlert from 'lucide-react/icons/circle-alert';
import Tag from 'lucide-react/icons/tag';
import Umbrella from 'lucide-react/icons/umbrella';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import SearchX from 'lucide-react/icons/search-x';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Download from 'lucide-react/icons/download';
import type { LucideIcon } from 'lucide-react';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { RiskTag } from '@/admin/api/types';
import { Button, Tabs, Tab, Chip, Avatar } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { useCsvExport } from '@/broker/useCsvExport';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';
import {
  RiskTagFormModal,
  RISK_LEVEL_FILTERS,
  CATEGORY_ICONS,
  LEVEL_ICONS,
  type RiskLevelFilter,
  type RiskLevelKey,
  type ListingSummary,
  type RiskTagRow,
} from '../components/risk-tags';

type TagModalState =
  | { mode: 'create'; listing: ListingSummary | null }
  | { mode: 'edit'; tag: RiskTag }
  | null;

export function RiskTagsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('risk_tags.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const csv = useCsvExport();

  const [searchParams, setSearchParams] = useSearchParams();
  const urlLevel = searchParams.get('level') as RiskLevelFilter | null;
  const riskLevel: RiskLevelFilter =
    urlLevel && RISK_LEVEL_FILTERS.includes(urlLevel) ? urlLevel : 'all';
  const setRiskLevel = useCallback(
    (next: RiskLevelFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') {
            params.delete('level');
          } else {
            params.set('level', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [items, setItems] = useState<RiskTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [tableSearch, setTableSearch] = useState('');

  const [modal, setModal] = useState<TagModalState>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RiskTag | null>(null);

  // Stash the latest `t` and `toast` in refs so loadItems keeps one identity —
  // a language switch must not refetch the register.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // Always load the WHOLE register; the level tab filters the table only.
  // The KPI boxes above the table count every level, so they must come from
  // the unfiltered register. `quiet` is the auto-refresh path: no spinner,
  // no toast — the rows stay put and a visible refresh reports failures.
  const loadItems = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getRiskTags({});
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      if (!opts.quiet) toastRef.current.error(tRef.current('risk_tags.load_failed'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useBrokerAutoRefresh(() => loadItems({ quiet: true }));

  // `?listing=<id>` (from a message copy's "Tag listing" action) opens the
  // form for that listing once the register is known: edit when it is already
  // tagged, otherwise create with the listing pre-filled. The parameter is
  // consumed so closing the form does not reopen it.
  const listingParam = searchParams.get('listing');
  const consumedListingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasLoaded || !listingParam || consumedListingRef.current === listingParam) return;
    consumedListingRef.current = listingParam;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('listing');
      return params;
    }, { replace: true });
    const id = Number(listingParam);
    if (!Number.isInteger(id) || id <= 0) return;
    const existing = items.find((item) => item.listing_id === id);
    setModal(
      existing
        ? { mode: 'edit', tag: existing }
        : { mode: 'create', listing: { id, title: tRef.current('risk_tags.listing_number', { id }) } },
    );
  }, [hasLoaded, listingParam, items, setSearchParams]);

  async function handleRemove(tag: RiskTag) {
    setRemoving(tag.listing_id);
    try {
      const res = await adminBroker.removeRiskTag(tag.listing_id);
      if (res.success) {
        toast.success(t('risk_tags.removed_success'));
        loadItems();
        setRemoveTarget(null);
      } else {
        toast.error(t('risk_tags.remove_failed'));
      }
    } catch {
      toast.error(t('risk_tags.remove_failed'));
    } finally {
      setRemoving(null);
    }
  }

  // Table rows: the level tab first (elevated = high + critical, the set the
  // dashboard's High risk listings tile counts), then the search box.
  const filteredItems = useMemo(() => {
    const byLevel =
      riskLevel === 'all'
        ? items
        : riskLevel === 'elevated'
          ? items.filter((item) => item.risk_level === 'high' || item.risk_level === 'critical')
          : items.filter((item) => item.risk_level === riskLevel);
    if (!tableSearch.trim()) return byLevel;
    const q = tableSearch.toLowerCase();
    return byLevel.filter(item =>
      (item.listing_title ?? '').toLowerCase().includes(q) ||
      (item.owner_name ?? '').toLowerCase().includes(q) ||
      (item.risk_category ?? '').toLowerCase().includes(q) ||
      (item.tagged_by_name ?? '').toLowerCase().includes(q)
    );
  }, [items, riskLevel, tableSearch]);

  // KPI header — per-level counts from the whole register, whatever tab is open.
  const levelCounts = useMemo(() => {
    const counts: Record<RiskLevelKey, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const item of items) {
      if (item.risk_level in counts) counts[item.risk_level] += 1;
    }
    return counts;
  }, [items]);

  const requirementLabels = (item: RiskTag): string[] => {
    const labels: string[] = [];
    if (item.requires_approval) labels.push(t('risk_tags.col_approval_req'));
    if (item.insurance_required) labels.push(t('risk_tags.col_insurance'));
    if (item.dbs_required) labels.push(t('risk_tags.legacy_role_vetting_unavailable'));
    return labels;
  };

  // Export what the table shows: the register is already loaded in full, so
  // one "page" is the current filter.
  const handleExport = () =>
    csv.run<RiskTag>({
      filename: `risk-tags_${riskLevel}`,
      columns: [
        { label: t('risk_tags.col_listing'), value: (r) => r.listing_title ?? '' },
        { label: t('risk_tags.id_label'), value: (r) => r.listing_id },
        { label: t('risk_tags.col_owner'), value: (r) => r.owner_name ?? '' },
        { label: t('risk_tags.col_risk_level'), value: (r) => t(`risk_tags.level_${r.risk_level}`) },
        { label: t('risk_tags.col_category'), value: (r) => t(`risk_tags.category_${r.risk_category}`, { defaultValue: r.risk_category }) },
        { label: t('risk_tags.risk_notes_label'), value: (r) => r.risk_notes ?? '' },
        { label: t('risk_tags.member_visible_notes_label'), value: (r) => r.member_visible_notes ?? '' },
        { label: t('risk_tags.col_requirements'), value: (r) => requirementLabels(r).join('; ') },
        { label: t('risk_tags.col_tagged_by'), value: (r) => r.tagged_by_name ?? '' },
        { label: t('risk_tags.col_date'), value: (r) => r.created_at },
      ],
      fetchPage: async () => ({ rows: filteredItems, hasMore: false }),
    });

  const columns: Column<RiskTag>[] = [
    {
      key: 'listing_title',
      label: t('risk_tags.col_listing'),
      sortable: true,
      render: (item) => (
        <div className="min-w-0 max-w-[220px]">
          <Link
            to={tenantPath(`/listings/${item.listing_id}`)}
            className="block truncate text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            {item.listing_title || t('risk_tags.listing_number', { id: item.listing_id })}
          </Link>
        </div>
      ),
    },
    {
      key: 'owner_name',
      label: t('risk_tags.col_owner'),
      sortable: true,
      render: (item) =>
        item.owner_name ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={item.owner_name} size="sm" className="shrink-0" />
            <MemberName userId={(item as RiskTagRow).owner_id ?? null} name={item.owner_name} className="text-sm" />
          </div>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'risk_level',
      label: t('risk_tags.col_risk_level'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.risk_level} />,
    },
    {
      key: 'risk_category',
      label: t('risk_tags.col_category'),
      sortable: true,
      render: (item) => {
        const cat = item.risk_category;
        if (!cat) return <span className="text-sm text-muted">—</span>;
        const CategoryIcon = CATEGORY_ICONS[cat] ?? Tag;
        return (
          <div className="flex items-center gap-1.5">
            <CategoryIcon size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="text-sm text-foreground/80">
              {t(`risk_tags.category_${cat}`, { defaultValue: cat })}
            </span>
          </div>
        );
      },
    },
    {
      key: 'requirements',
      label: t('risk_tags.col_requirements'),
      render: (item) => {
        const reqs: { key: string; label: string; icon: LucideIcon; color: 'warning' | 'accent' | 'success' | 'danger' }[] = [];
        if (item.requires_approval) {
          reqs.push({ key: 'approval', label: t('risk_tags.col_approval_req'), icon: ClipboardCheck, color: 'warning' });
        }
        if (item.insurance_required) {
          reqs.push({ key: 'insurance', label: t('risk_tags.col_insurance'), icon: Umbrella, color: 'accent' });
        }
        if (item.dbs_required) {
          reqs.push({
            key: 'legacy-role-vetting',
            label: t('risk_tags.legacy_role_vetting_unavailable'),
            icon: ShieldAlert,
            color: 'danger',
          });
        }
        if (reqs.length === 0) {
          return <span className="text-sm text-muted">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {reqs.map(({ key, label, icon: ReqIcon, color }) => (
              <Chip key={key} size="sm" variant="soft" color={color}>
                <ReqIcon size={12} aria-hidden="true" />
                <Chip.Label>{label}</Chip.Label>
              </Chip>
            ))}
          </div>
        );
      },
    },
    {
      key: 'tagged_by_name',
      label: t('risk_tags.col_tagged_by'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.tagged_by_name || '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t('risk_tags.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.created_at)}
        </span>
      ),
    },
    {
      key: 'id',
      isActions: true,
      label: t('risk_tags.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="tertiary"
            isIconOnly
            onPress={() => setModal({ mode: 'edit', tag: item })}
            aria-label={t('risk_tags.edit_aria')}
          >
            <Edit size={14} />
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            isIconOnly
            isPending={removing === item.listing_id}
            onPress={() => setRemoveTarget(item)}
            aria-label={t('risk_tags.remove_aria')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const openCreate = () => setModal({ mode: 'create', listing: null });

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_exchanges', articleId: 'broker_risk_tags' }}
      title={t('risk_tags.title')}
      description={t('risk_tags.description')}
      icon={ShieldAlert}
      color="danger"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            startContent={<Download size={16} aria-hidden="true" />}
            onPress={handleExport}
            isPending={csv.exporting}
            isDisabled={!hasLoaded}
          >
            {csv.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button
            variant="primary"
            startContent={<Plus size={16} aria-hidden="true" />}
            onPress={openCreate}
            size="sm"
          >
            {t('risk_tags.tag_listing')}
          </Button>
        </>
      }
    >
      {!hasLoaded && loading ? (
        <div className="space-y-6">
          <BrokerSkeleton variant="stats" />
          <BrokerSkeleton variant="table" />
        </div>
      ) : loadError && items.length === 0 ? (
        // Honest failure state — a broken register must never render as an
        // empty (all-clear-looking) table.
        <BrokerEmptyState
          icon={CircleAlert}
          color="danger"
          title={t('risk_tags.load_error_title')}
          hint={t('risk_tags.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={() => loadItems()}>
              {t('risk_tags.retry')}
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI header — counts by level, deep-linked into the ?level= filter */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <BrokerStatCard
              label={t('risk_tags.stat_critical')}
              value={levelCounts.critical}
              icon={ShieldAlert}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=critical')}
              linkAriaLabel={t('risk_tags.view_level_aria', { level: t('risk_tags.level_critical') })}
            />
            <BrokerStatCard
              label={t('risk_tags.stat_high')}
              value={levelCounts.high}
              icon={TriangleAlert}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=high')}
              linkAriaLabel={t('risk_tags.view_level_aria', { level: t('risk_tags.level_high') })}
            />
            <BrokerStatCard
              label={t('risk_tags.stat_medium')}
              value={levelCounts.medium}
              icon={ShieldHalf}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=medium')}
              linkAriaLabel={t('risk_tags.view_level_aria', { level: t('risk_tags.level_medium') })}
            />
            <BrokerStatCard
              label={t('risk_tags.stat_low')}
              value={levelCounts.low}
              icon={ShieldCheck}
              color="neutral"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=low')}
              linkAriaLabel={t('risk_tags.view_level_aria', { level: t('risk_tags.level_low') })}
            />
          </div>

          {/* Level tabs — below the KPIs, like every other list page */}
          <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
            <Tabs
              aria-label={t('risk_tags.tabs_aria')}
              selectedKey={riskLevel}
              onSelectionChange={(key) => setRiskLevel(key as RiskLevelFilter)}
              variant="underlined"
              size="sm"
            >
              {RISK_LEVEL_FILTERS.map((level) => {
                const TabIcon = LEVEL_ICONS[level];
                return (
                  <Tab
                    key={level}
                    title={
                      <div className="flex items-center gap-2">
                        <TabIcon size={14} aria-hidden="true" />
                        <span>
                          {level === 'all'
                            ? t('risk_tags.tab_all')
                            : level === 'elevated'
                              ? t('risk_tags.tab_elevated')
                              : t(`risk_tags.level_${level}`)}
                        </span>
                      </div>
                    }
                  />
                );
              })}
            </Tabs>
          </div>

          <DataTable
            stickyActions
            mobileCards
            columns={columns}
            data={filteredItems}
            isLoading={loading}
            searchable
            onSearch={setTableSearch}
            onRefresh={() => loadItems()}
            emptyContent={
              tableSearch.trim() ? (
                <BrokerEmptyState
                  bare
                  icon={SearchX}
                  color="neutral"
                  title={t('risk_tags.empty_search_title')}
                  hint={t('risk_tags.empty_search_hint')}
                />
              ) : riskLevel !== 'all' ? (
                <BrokerEmptyState
                  bare
                  icon={ShieldCheck}
                  color="success"
                  title={t('risk_tags.empty_level_title')}
                  hint={t('risk_tags.empty_level_hint')}
                />
              ) : (
                <BrokerEmptyState
                  bare
                  icon={ShieldCheck}
                  color="success"
                  title={t('risk_tags.empty_title')}
                  hint={t('risk_tags.empty_hint')}
                  action={
                    <Button
                      size="sm"
                      variant="primary"
                      startContent={<Plus size={14} aria-hidden="true" />}
                      onPress={openCreate}
                    >
                      {t('risk_tags.tag_listing')}
                    </Button>
                  }
                />
              )
            }
          />
        </>
      )}

      <RiskTagFormModal
        isOpen={modal !== null}
        tag={modal?.mode === 'edit' ? modal.tag : null}
        initialListing={modal?.mode === 'create' ? modal.listing : null}
        onClose={() => setModal(null)}
        onSaved={() => loadItems()}
      />

      {/* Remove confirmation — HeroUI styled, non-blocking, iOS-friendly. */}
      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && handleRemove(removeTarget)}
        title={t('risk_tags.confirm_remove_title')}
        message={
          removeTarget
            ? t('risk_tags.confirm_remove_message', {
                listing: removeTarget.listing_title ?? t('risk_tags.listing_number', { id: removeTarget.listing_id }),
              })
            : ''
        }
        confirmLabel={t('risk_tags.remove')}
        confirmColor="danger"
        isLoading={removing !== null}
      />
    </BrokerPageShell>
  );
}

export default RiskTagsPage;
