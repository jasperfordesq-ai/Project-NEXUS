// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Risk Tags
 * View, filter, create, edit and remove listing risk tags.
 * Parity: PHP BrokerControlsController::riskTags()
 *
 * Restyled to the broker design language: BrokerPageShell frame, a KPI header
 * with per-level counts (deep-linked to the ?level= filter the dashboard
 * already uses), BrokerStatusChip severity chips, category iconography and
 * consolidated requirement chips. Data flow, endpoints and the create/edit
 * modal + listing autocomplete + remove flow are unchanged.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import Shield from 'lucide-react/icons/shield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldHalf from 'lucide-react/icons/shield-half';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import CircleAlert from 'lucide-react/icons/circle-alert';
import Banknote from 'lucide-react/icons/banknote';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Scale from 'lucide-react/icons/scale';
import Star from 'lucide-react/icons/star';
import Tag from 'lucide-react/icons/tag';
import Umbrella from 'lucide-react/icons/umbrella';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import SearchX from 'lucide-react/icons/search-x';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import type { LucideIcon } from 'lucide-react';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminBroker, adminListings } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { RiskTag } from '@/admin/api/types';
import {
  Select,
  SelectItem,
  Button,
  Spinner,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Switch,
  Tabs,
  Tab,
  Chip,
  Avatar,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

const RISK_LEVEL_KEYS = ['low', 'medium', 'high', 'critical'] as const;

const RISK_CATEGORY_KEYS = [
  'safeguarding',
  'financial',
  'health_safety',
  'legal',
  'reputation',
  'fraud',
  'other',
] as const;

// Risk level filter is mirrored to `?level=` so stat-card deep-links work.
// `elevated` is not a stored level: the API expands it to high + critical,
// the same set the broker dashboard's "High-risk listings" tile counts and
// links here with.
const RISK_LEVELS = ['all', 'elevated', 'critical', 'high', 'medium', 'low'] as const;

// Category → decorative icon. Unknown categories fall back to a neutral tag.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  safeguarding: Shield,
  financial: Banknote,
  health_safety: HeartPulse,
  legal: Scale,
  reputation: Star,
  fraud: TriangleAlert,
  other: Tag,
};

// Level → icon used in tabs and the KPI header (severity-coded).
const LEVEL_ICONS: Record<(typeof RISK_LEVELS)[number], LucideIcon> = {
  all: Shield,
  elevated: ShieldAlert,
  critical: ShieldAlert,
  high: TriangleAlert,
  medium: ShieldHalf,
  low: ShieldCheck,
};

interface RiskTagForm {
  listing_id: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_category: string;
  risk_notes: string;
  member_visible_notes: string;
  requires_approval: boolean;
  insurance_required: boolean;
}

const EMPTY_FORM: RiskTagForm = {
  listing_id: '',
  risk_level: 'medium',
  risk_category: '',
  risk_notes: '',
  member_visible_notes: '',
  requires_approval: false,
  insurance_required: false,
};

interface ListingSearchResult {
  id: number;
  title: string;
  owner_name?: string;
}

export function RiskTagsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('risk_tags.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  type RiskLevel = (typeof RISK_LEVELS)[number];
  const [searchParams, setSearchParams] = useSearchParams();
  const urlLevel = searchParams.get('level') as RiskLevel | null;
  const riskLevel: RiskLevel =
    urlLevel && RISK_LEVELS.includes(urlLevel) ? urlLevel : 'all';
  const setRiskLevel = useCallback(
    (next: RiskLevel) => {
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

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<RiskTag | null>(null);
  const [form, setForm] = useState<RiskTagForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RiskTag | null>(null);

  // Listing search state
  const [listingSearch, setListingSearch] = useState('');
  const [listingResults, setListingResults] = useState<ListingSearchResult[]>([]);
  const [searchingListings, setSearchingListings] = useState(false);
  const [selectedListing, setSelectedListing] = useState<ListingSearchResult | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Stash the latest `t` and `toast` in refs so loadItems keeps one identity —
  // a language switch must not refetch the register.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // Always load the WHOLE register; the level tab filters the table only.
  // The KPI boxes above the table count every level, so they must come from
  // the unfiltered register. They used to be counted from the filtered
  // response, so opening ?level=high (or the dashboard's ?level=elevated)
  // showed "0" for every other level.
  const loadItems = useCallback(async () => {
    setLoading(true);
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
      toastRef.current.error(tRef.current('risk_tags.load_failed'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Listing search with debounce
  useEffect(() => {
    if (!listingSearch.trim() || listingSearch.trim().length < 2) {
      setListingResults([]);
      return;
    }
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setSearchingListings(true);
      try {
        const res = await adminListings.list({ search: listingSearch.trim(), page: 1 });
        if (res.success && res.data) {
          const data = Array.isArray(res.data) ? res.data : (res.data as { items?: ListingSearchResult[] }).items ?? [];
          setListingResults(data.slice(0, 8).map((l: Record<string, unknown>) => ({
            id: l.id as number,
            title: (l.title as string) || t('risk_tags.listing_fallback', { id: l.id }),
            owner_name: (l.owner_name ?? l.user_name ?? '') as string,
          })));
        }
      } catch {
        // silently fail
      } finally {
        setSearchingListings(false);
      }
    }, 300);
    return () => clearTimeout(searchDebounce.current);
  }, [listingSearch, t]);

  function openCreateModal() {
    setEditingTag(null);
    setForm(EMPTY_FORM);
    setSelectedListing(null);
    setListingSearch('');
    setListingResults([]);
    setModalOpen(true);
  }

  function openEditModal(tag: RiskTag) {
    setEditingTag(tag);
    setForm({
      listing_id: String(tag.listing_id),
      risk_level: tag.risk_level,
      risk_category: tag.risk_category,
      risk_notes: tag.risk_notes ?? '',
      member_visible_notes: tag.member_visible_notes ?? '',
      requires_approval: tag.requires_approval,
      insurance_required: tag.insurance_required,
    });
    setSelectedListing(null);
    setListingSearch('');
    setListingResults([]);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingTag(null);
    setForm(EMPTY_FORM);
    setSelectedListing(null);
    setListingSearch('');
    setListingResults([]);
  }

  function selectListing(listing: ListingSearchResult) {
    setSelectedListing(listing);
    setForm(f => ({ ...f, listing_id: String(listing.id) }));
    setListingSearch('');
    setListingResults([]);
  }

  async function handleSave() {
    const listingId = parseInt(form.listing_id);
    if (!listingId || listingId <= 0) {
      toast.error(t('risk_tags.select_listing_error'));
      return;
    }
    if (!form.risk_category.trim()) {
      toast.error(t('risk_tags.category_required_error'));
      return;
    }

    setSaving(true);
    try {
      const res = await adminBroker.saveRiskTag(listingId, {
        risk_level: form.risk_level,
        risk_category: form.risk_category.trim(),
        risk_notes: form.risk_notes || undefined,
        member_visible_notes: form.member_visible_notes || undefined,
        requires_approval: form.requires_approval,
        insurance_required: form.insurance_required,
      });
      if (res.success) {
        toast.success(editingTag ? t('risk_tags.updated_success') : t('risk_tags.created_success'));
        closeModal();
        loadItems();
      } else {
        toast.error(t('risk_tags.save_failed'));
      }
    } catch {
      toast.error(t('risk_tags.save_failed'));
    } finally {
      setSaving(false);
    }
  }

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
    const counts: Record<(typeof RISK_LEVEL_KEYS)[number], number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const item of items) {
      if (item.risk_level in counts) counts[item.risk_level] += 1;
    }
    return counts;
  }, [items]);

  const columns: Column<RiskTag>[] = [
    {
      key: 'listing_title',
      label: t('risk_tags.col_listing'),
      sortable: true,
      render: (item) => (
        <div className="min-w-0 max-w-[220px]">
          <p className="truncate text-sm font-medium text-foreground">
            {item.listing_title || '—'}
          </p>
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
            <span className="truncate text-sm text-foreground/80">{item.owner_name}</span>
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
      label: t('risk_tags.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="tertiary"
            isIconOnly
            onPress={() => openEditModal(item)}
            aria-label={t('risk_tags.edit_aria')}
          >
            <Edit size={14} />
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            isIconOnly
            isLoading={removing === item.listing_id}
            onPress={() => setRemoveTarget(item)}
            aria-label={t('risk_tags.remove_aria')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

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
            color="primary"
            startContent={<Plus size={16} aria-hidden="true" />}
            onPress={openCreateModal}
            size="sm"
          >
            {t('risk_tags.tag_listing')}
          </Button>
        </>
      }
      toolbar={
        <Tabs
          aria-label={t('risk_tags.tabs_aria')}
          selectedKey={riskLevel}
          onSelectionChange={(key) => setRiskLevel(key as RiskLevel)}
          variant="underlined"
          size="sm"
        >
          {RISK_LEVELS.map((level) => {
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
            <Button size="sm" variant="danger-soft" onPress={loadItems}>
              {t('risk_tags.retry')}
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI header — counts by level, deep-linked into the ?level= filter */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

          <DataTable
            columns={columns}
            data={filteredItems}
            isLoading={loading}
            searchable
            onSearch={setTableSearch}
            onRefresh={loadItems}
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
                      color="primary"
                      startContent={<Plus size={14} aria-hidden="true" />}
                      onPress={openCreateModal}
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

      {/* Create / Edit Modal */}
      <Modal isOpen={modalOpen} onClose={closeModal} size="lg">
        <ModalContent>
          <ModalHeader>
            {editingTag ? t('risk_tags.modal_title_edit') : t('risk_tags.modal_title_create')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            {/* Listing search — only shown when creating */}
            {!editingTag && (
              <div className="relative">
                {selectedListing ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-secondary">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{selectedListing.title}</p>
                      <p className="text-xs text-muted">
                        {t('risk_tags.id_label', { id: selectedListing.id })}
                        {selectedListing.owner_name && ` · ${selectedListing.owner_name}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        setSelectedListing(null);
                        setForm(f => ({ ...f, listing_id: '' }));
                      }}
                    >
                      {t('risk_tags.change')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      label={t('risk_tags.search_listing_label')}
                      value={listingSearch}
                      onValueChange={setListingSearch}
                      placeholder={t('risk_tags.search_listing_placeholder')}
                      isRequired
                      startContent={searchingListings ? <Spinner size="sm" /> : <Search size={14} />}
                    />
                    {listingResults.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-overlay border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {listingResults.map(listing => (
                          <Button
                            key={listing.id}
                            variant="light"
                            className="w-full text-left px-3 py-2 justify-start min-h-9 rounded-none"
                            onPress={() => selectListing(listing)}
                          >
                            <div className="text-left">
                              <p className="text-sm font-medium">{listing.title}</p>
                              <p className="text-xs text-muted">
                                {t('risk_tags.id_label', { id: listing.id })}
                                {listing.owner_name && ` · ${listing.owner_name}`}
                              </p>
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}
                    {/* Fallback: manual ID entry */}
                    <Input
                      label={t('risk_tags.manual_id_label')}
                      type="number"
                      value={form.listing_id}
                      onValueChange={v => setForm(f => ({ ...f, listing_id: v }))}
                      placeholder={t('risk_tags.manual_id_placeholder')}
                      min={1}
                      className="mt-2"
                      size="sm"
                    />
                  </>
                )}
              </div>
            )}
            {editingTag && (
              <div>
                <p className="text-sm text-muted">{t('risk_tags.listing_field_label')}</p>
                <p className="font-medium">{editingTag.listing_title ?? t('risk_tags.listing_fallback', { id: editingTag.listing_id })}</p>
              </div>
            )}

            <Select
              label={t('risk_tags.risk_level_label')}
              selectedKeys={new Set([form.risk_level])}
              onSelectionChange={keys => {
                const val = Array.from(keys)[0] as RiskTagForm['risk_level'];
                if (val) setForm(f => ({ ...f, risk_level: val }));
              }}
              isRequired
            >
              {RISK_LEVEL_KEYS.map(key => (
                <SelectItem key={key} id={key}>
                  {t(`risk_tags.level_${key}`)}
                </SelectItem>
              ))}
            </Select>

            <Select
              label={t('risk_tags.risk_category_label')}
              selectedKeys={form.risk_category ? new Set([form.risk_category]) : new Set()}
              onSelectionChange={keys => {
                const val = Array.from(keys)[0] as string;
                if (val) setForm(f => ({ ...f, risk_category: val }));
              }}
              isRequired
            >
              {RISK_CATEGORY_KEYS.map(key => (
                <SelectItem key={key} id={key}>
                  {t(`risk_tags.category_${key}`)}
                </SelectItem>
              ))}
            </Select>

            <Textarea
              label={t('risk_tags.risk_notes_label')}
              value={form.risk_notes}
              onValueChange={v => setForm(f => ({ ...f, risk_notes: v }))}
              placeholder={t('risk_tags.risk_notes_placeholder')}
              minRows={3}
            />

            <Textarea
              label={t('risk_tags.member_visible_notes_label')}
              value={form.member_visible_notes}
              onValueChange={v => setForm(f => ({ ...f, member_visible_notes: v }))}
              placeholder={t('risk_tags.member_visible_notes_placeholder')}
              minRows={3}
            />

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{t('risk_tags.requires_approval_label')}</p>
                <p className="text-xs text-muted">{t('risk_tags.requires_approval_description')}</p>
              </div>
              <Switch
                isSelected={form.requires_approval}
                onValueChange={v => setForm(f => ({ ...f, requires_approval: v }))}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{t('risk_tags.insurance_required_label')}</p>
                <p className="text-xs text-muted">{t('risk_tags.insurance_required_description')}</p>
              </div>
              <Switch
                isSelected={form.insurance_required}
                onValueChange={v => setForm(f => ({ ...f, insurance_required: v }))}
                size="sm"
              />
            </div>

            {editingTag?.dbs_required && (
              <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4" role="alert">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('risk_tags.legacy_role_vetting_unavailable')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {t('risk_tags.legacy_role_vetting_unavailable_description')}
                  </p>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={closeModal}>
              {t('risk_tags.cancel')}
            </Button>
            <Button color="primary" onPress={handleSave} isLoading={saving} isDisabled={saving}>
              {editingTag ? t('risk_tags.update_tag') : t('risk_tags.create_tag')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Remove confirmation — replaces native window.confirm() so the
          dialog matches the rest of the broker panel (HeroUI styled,
          non-blocking, iOS-friendly). */}
      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && handleRemove(removeTarget)}
        title={t('risk_tags.confirm_remove_title')}
        message={
          removeTarget
            ? t('risk_tags.confirm_remove_message', {
                listing: removeTarget.listing_title ?? t('risk_tags.listing_fallback', { id: removeTarget.listing_id }),
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
