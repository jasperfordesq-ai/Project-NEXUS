// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Safeguarding vetting confirmations without certificate evidence.
 *
 * Brokers record controlled certification schemes, encrypted operational scope
 * and private notes, and the dates needed to renew the community decision.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Check from 'lucide-react/icons/check';
import CircleSlash from 'lucide-react/icons/circle-slash';
import FileText from 'lucide-react/icons/file-text';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserCheck from 'lucide-react/icons/user-check';
import Users from 'lucide-react/icons/users';

import {
  Avatar,
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';
import { DataTable, type Column } from '@/admin/components';
import { adminVetting } from '@/admin/api/adminApi';
import type {
  VettingPolicyResponse,
  VettingRecord,
  VettingStats,
  VettingAttestation,
} from '@/admin/api/types';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { formatServerDateTime } from '@/lib/serverTime';
import {
  BrokerEmptyState,
  BrokerPageShell,
  BrokerSkeleton,
  BrokerStatCard,
  BrokerStatusChip,
} from '../components';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const SAFE_REVIEW_RESOLUTION_CODES: VettingPolicyResponse['review_resolution_codes'] = [
  'no_change',
  'duplicate_request',
  'member_contacted',
];
type ReviewResolutionCode = VettingPolicyResponse['review_resolution_codes'][number];

const FILTERS = [
  'all',
  'review_requested',
  'confirmed',
  'expired',
  'revoked',
  'not_confirmed',
] as const;

type VettingFilter = (typeof FILTERS)[number];

interface VettingListMeta {
  total?: number;
  total_items?: number;
  pagination?: {
    total?: number;
    current_page?: number;
    last_page?: number;
    per_page?: number;
  };
}

function memberName(item: VettingRecord): string {
  return resolveUserDisplayName(item);
}

function rowStatus(item: VettingRecord): string {
  if (item.review_status === 'pending') return 'review_requested';
  return item.is_expired ? 'expired' : item.decision;
}

function rowTimestamp(item: VettingRecord): string | null {
  if (item.review_status === 'pending') return item.requested_at;
  if (item.decision === 'confirmed') return item.confirmed_at;
  if (item.decision === 'revoked') return item.revoked_at;
  return null;
}

export function VettingRecords() {
  const { t } = useTranslation('broker');
  usePageTitle(t('vetting.title'));
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const requestedFilter = searchParams.get('status') as VettingFilter | null;
  const filter: VettingFilter = requestedFilter && FILTERS.includes(requestedFilter)
    ? requestedFilter
    : 'all';

  const [items, setItems] = useState<VettingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);

  const [stats, setStats] = useState<VettingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [policyData, setPolicyData] = useState<VettingPolicyResponse | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [confirmItem, setConfirmItem] = useState<VettingRecord | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [certificationCodes, setCertificationCodes] = useState<Set<string>>(new Set());
  const [scopeSummary, setScopeSummary] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [reviewDueAt, setReviewDueAt] = useState('');
  const [authorityExpiresAt, setAuthorityExpiresAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [detailItem, setDetailItem] = useState<VettingRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<VettingAttestation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revokeItem, setRevokeItem] = useState<VettingRecord | null>(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [resolveItem, setResolveItem] = useState<VettingRecord | null>(null);
  const [resolutionCode, setResolutionCode] = useState<ReviewResolutionCode | ''>('');
  const [resolving, setResolving] = useState(false);

  const role = String(user?.role ?? '');
  const userFlags = user as Record<string, unknown> | null;
  const canConfigurePolicy =
    ['admin', 'tenant_admin', 'super_admin', 'god'].includes(role) ||
    userFlags?.is_admin === true ||
    userFlags?.is_super_admin === true ||
    userFlags?.is_tenant_super_admin === true ||
    userFlags?.is_god === true;

  const policy = policyData?.policy ?? stats?.policy ?? null;
  const canRecordDecision = Boolean(policy?.configured && policy.contact_policy_available);
  const reviewPending = stats?.review_pending ?? stats?.review_requested ?? 0;
  const certificationLabel = useCallback((code: string, recordPolicy = policy) =>
    recordPolicy?.certification_options.find((option) => option.code === code)?.label
      ?? t(`vetting.attestation_${code}`, { defaultValue: code }), [policy, t]);
  const authorityExpiryRequired = Array.from(certificationCodes).some((code) =>
    confirmItem?.policy.certification_options.some((option) =>
      option.code === code && option.authority_expiry_required,
    ),
  );
  const confirmFormValid = acknowledged
    && certificationCodes.size > 0
    && scopeSummary.trim().length > 0
    && reviewDueAt !== ''
    && (!authorityExpiryRequired || authorityExpiresAt !== '');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const setFilter = useCallback((next: VettingFilter) => {
    setPage(1);
    setSearchParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      if (next === 'all') nextParams.delete('status');
      else nextParams.set('status', next);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyError(false);
    try {
      const response = await adminVetting.policy();
      if (!response.success || !response.data) {
        setPolicyError(true);
        return;
      }
      const data = response.data;
      const reviewResolutionCodes = SAFE_REVIEW_RESOLUTION_CODES.filter((code) =>
        data.review_resolution_codes.includes(code),
      );
      setPolicyData({ ...data, review_resolution_codes: reviewResolutionCodes });
      setSelectedJurisdiction(data.policy.jurisdiction);
      setRevocationReason(data.revocation_reason_codes[0] ?? '');
      setResolutionCode(reviewResolutionCodes.includes('no_change') ? 'no_change' : '');
    } catch {
      setPolicyError(true);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(false);
    try {
      const response = await adminVetting.stats();
      if (response.success && response.data) setStats(response.data);
      else setStatsError(true);
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setListError(false);
    try {
      const response = await adminVetting.list({
        status: filter,
        page,
        per_page: PAGE_SIZE,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      if (!response.success || !Array.isArray(response.data)) {
        setListError(true);
        return;
      }
      setItems(response.data);
      const meta = response.meta as unknown as VettingListMeta | undefined;
      setTotal(meta?.pagination?.total ?? meta?.total ?? meta?.total_items ?? response.data.length);
    } catch {
      setListError(true);
      toastRef.current.error(tRef.current('vetting.toast_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filter, page]);

  const refreshAll = useCallback(() => {
    void Promise.all([loadItems(), loadStats(), loadPolicy()]);
  }, [loadItems, loadPolicy, loadStats]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadStats();
    void loadPolicy();
  }, [loadPolicy, loadStats]);

  const handleSavePolicy = async () => {
    if (!selectedJurisdiction || !canConfigurePolicy) return;
    setSavingPolicy(true);
    try {
      const response = await adminVetting.updatePolicy(selectedJurisdiction);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_policy_failed'));
        return;
      }
      toast.success(t('vetting.toast_policy_saved'));
      refreshAll();
    } catch {
      toast.error(t('vetting.toast_policy_failed'));
    } finally {
      setSavingPolicy(false);
    }
  };

  const openConfirm = useCallback((item: VettingRecord) => {
    const available = item.policy.certification_options ?? [];
    const existingCodes = item.certification_codes.filter((code) =>
      available.some((option) => option.code === code),
    );
    setCertificationCodes(new Set(existingCodes.length > 0
      ? existingCodes
      : available.length === 1 && available[0] ? [available[0].code] : []));
    setScopeSummary('');
    setPrivateNotes('');
    setReviewDueAt('');
    setAuthorityExpiresAt('');
    setAcknowledged(false);
    setConfirmItem(item);
  }, []);

  const openDetails = useCallback(async (item: VettingRecord) => {
    if (!item.attestation_id) return;
    setDetailItem(item);
    setDetailRecord(null);
    setDetailLoading(true);
    try {
      const response = await adminVetting.show(item.attestation_id);
      if (response.success && response.data) setDetailRecord(response.data);
      else toastRef.current.error(response.error || tRef.current('vetting.toast_details_failed'));
    } catch {
      toastRef.current.error(tRef.current('vetting.toast_details_failed'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleConfirm = async () => {
    if (!confirmItem || !acknowledged || !canRecordDecision || certificationCodes.size === 0 || !scopeSummary.trim() || !reviewDueAt) return;
    setConfirming(true);
    try {
      const response = await adminVetting.confirm(confirmItem.user_id, {
        certification_codes: Array.from(certificationCodes),
        scope_summary: scopeSummary.trim(),
        ...(privateNotes.trim() ? { private_notes: privateNotes.trim() } : {}),
        review_due_at: reviewDueAt,
        ...(authorityExpiresAt ? { authority_expires_at: authorityExpiresAt } : {}),
      }, confirmItem.review_request_id);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_confirm_failed'));
        return;
      }
      toast.success(t('vetting.toast_confirmed'));
      setConfirmItem(null);
      setAcknowledged(false);
      refreshAll();
    } catch {
      toast.error(t('vetting.toast_confirm_failed'));
    } finally {
      setConfirming(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeItem || !revocationReason || !canRecordDecision) return;
    setRevoking(true);
    try {
      const response = await adminVetting.revoke(
        revokeItem.user_id,
        revocationReason,
        revokeItem.review_request_id,
      );
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_revoke_failed'));
        return;
      }
      toast.success(t('vetting.toast_revoked'));
      setRevokeItem(null);
      refreshAll();
    } catch {
      toast.error(t('vetting.toast_revoke_failed'));
    } finally {
      setRevoking(false);
    }
  };

  const handleResolve = async () => {
    if (!resolveItem?.review_request_id || !resolutionCode) return;
    setResolving(true);
    try {
      const response = await adminVetting.resolveReview(resolveItem.review_request_id, resolutionCode);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_resolve_failed'));
        return;
      }
      toast.success(t('vetting.toast_resolved'));
      setResolveItem(null);
      refreshAll();
    } catch {
      toast.error(t('vetting.toast_resolve_failed'));
    } finally {
      setResolving(false);
    }
  };

  const columns = useMemo<Column<VettingRecord>[]>(() => [
    {
      key: 'member',
      label: t('vetting.col_member'),
      isRowHeader: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar
            src={resolveAvatarUrl(item.avatar_url) || undefined}
            name={memberName(item)}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{memberName(item)}</p>
            <p className="truncate text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'scheme',
      label: t('vetting.col_scheme'),
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.certification_codes.length > 0
            ? item.certification_codes.map((code) => (
              <Chip key={code} size="sm" variant="soft" color="accent">
                {certificationLabel(code, item.policy)}
              </Chip>
            ))
            : <span className="text-sm text-muted">{item.policy.attestation_label || t('vetting.scheme_unavailable')}</span>}
        </div>
      ),
    },
    {
      key: 'decision',
      label: t('vetting.col_status'),
      render: (item) => <BrokerStatusChip status={rowStatus(item)} />,
    },
    {
      key: 'updated',
      label: t('vetting.col_updated'),
      render: (item) => (
        <span className="text-sm text-muted">
          {rowTimestamp(item) ? formatServerDateTime(rowTimestamp(item)) : t('vetting.not_recorded')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('vetting.col_actions'),
      render: (item) => (
        <div className="flex flex-wrap gap-2">
          {item.decision !== 'confirmed' || item.is_expired ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!canRecordDecision}
              onPress={() => openConfirm(item)}
            >
              <Check size={14} aria-hidden="true" />
              {item.is_expired ? t('vetting.action_renew') : t('vetting.action_confirm')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={!canRecordDecision}
              onPress={() => setRevokeItem(item)}
            >
              <CircleSlash size={14} aria-hidden="true" />
              {t('vetting.action_revoke')}
            </Button>
          )}
          {item.attestation_id && (
            <Button size="sm" variant="tertiary" onPress={() => { void openDetails(item); }}>
              <FileText size={14} aria-hidden="true" />
              {t('vetting.action_details')}
            </Button>
          )}
          {item.review_status === 'pending' && item.review_request_id && (
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => {
                setResolutionCode(policyData?.review_resolution_codes.includes('no_change') ? 'no_change' : '');
                setResolveItem(item);
              }}
            >
              {t('vetting.action_resolve')}
            </Button>
          )}
        </div>
      ),
    },
  ], [canRecordDecision, certificationLabel, openConfirm, openDetails, policyData?.review_resolution_codes, t]);

  const emptyContent = (
    <BrokerEmptyState
      bare
      icon={filter === 'review_requested' ? ShieldCheck : Users}
      color={filter === 'review_requested' ? 'success' : 'neutral'}
      title={filter === 'review_requested' ? t('vetting.empty_review_title') : t('vetting.empty_title')}
      hint={debouncedSearch || filter !== 'all' ? t('vetting.empty_filtered_hint') : t('vetting.empty_hint')}
    />
  );

  return (
    <BrokerPageShell
      title={t('vetting.title')}
      description={t('vetting.description')}
      icon={ShieldCheck}
      color="success"
      actions={(
        <>
          <Button as={Link} to={tenantPath('/broker')} variant="tertiary" size="sm">
            <ArrowLeft size={15} aria-hidden="true" />
            {t('vetting.back')}
          </Button>
          <Button isIconOnly variant="tertiary" size="sm" onPress={refreshAll} aria-label={t('vetting.refresh')}>
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <Card className="rounded-2xl border border-divider/70 bg-surface">
          <CardBody className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-success" size={20} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-foreground">{t('vetting.policy_title')}</h2>
                {policyLoading ? (
                  <BrokerSkeleton variant="cards" count={1} className="mt-2" />
                ) : policyError || !policy ? (
                  <p className="mt-1 text-sm text-danger">{t('vetting.policy_load_error')}</p>
                ) : (
                  <div className="mt-2 grid gap-2 text-sm text-muted sm:grid-cols-3">
                    <p><span className="font-medium text-foreground">{t('vetting.policy_jurisdiction')}:</span> {policy.label}</p>
                    <p><span className="font-medium text-foreground">{t('vetting.policy_attestation')}:</span> {policy.attestation_label || t('vetting.scheme_unavailable')}</p>
                    <p><span className="font-medium text-foreground">{t('vetting.policy_purpose')}:</span> {t('vetting.purpose_safeguarded_contact')}</p>
                  </div>
                )}
              </div>
            </div>

            {!policyLoading && policy && !canRecordDecision && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>{policy.configured ? t('vetting.policy_not_available') : t('vetting.policy_unconfigured')}</p>
              </div>
            )}

            {canConfigurePolicy && policyData && (
              <div className="flex flex-col gap-3 border-t border-divider/70 pt-4 sm:flex-row sm:items-end">
                <Select
                  className="sm:max-w-md"
                  label={t('vetting.jurisdiction_label')}
                  selectedKeys={selectedJurisdiction ? new Set([selectedJurisdiction]) : new Set()}
                  onSelectionChange={(keys) => setSelectedJurisdiction(String(Array.from(keys)[0] ?? ''))}
                >
                  {policyData.jurisdictions.map((jurisdiction) => (
                    <SelectItem key={jurisdiction.code} id={jurisdiction.code} textValue={jurisdiction.label}>
                      {jurisdiction.label}
                    </SelectItem>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  isPending={savingPolicy}
                  isDisabled={!selectedJurisdiction || selectedJurisdiction === policyData.policy.jurisdiction}
                  onPress={handleSavePolicy}
                >
                  {t('vetting.save_jurisdiction')}
                </Button>
              </div>
            )}

            <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
              <p className="text-sm font-semibold text-foreground">{t('vetting.privacy_title')}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{t('vetting.privacy_body')}</p>
            </div>
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <BrokerStatCard label={t('vetting.stat_total_members')} value={stats?.total_members} icon={Users} color="neutral" loading={statsLoading} />
          <BrokerStatCard label={t('vetting.stat_review_requested')} value={reviewPending} icon={RefreshCw} color="warning" loading={statsLoading} to={tenantPath('/broker/vetting?status=review_requested')} />
          <BrokerStatCard label={t('vetting.stat_confirmed')} value={stats?.confirmed} icon={UserCheck} color="success" loading={statsLoading} to={tenantPath('/broker/vetting?status=confirmed')} />
          <BrokerStatCard label={t('vetting.stat_expired')} value={stats?.expired} icon={CalendarClock} color="danger" loading={statsLoading} to={tenantPath('/broker/vetting?status=expired')} />
          <BrokerStatCard label={t('vetting.stat_revoked')} value={stats?.revoked} icon={CircleSlash} color="danger" loading={statsLoading} to={tenantPath('/broker/vetting?status=revoked')} />
        </div>

        {statsError && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4" role="alert">
            <p className="font-medium text-danger">{t('vetting.stats_error_title')}</p>
            <Button className="mt-2" size="sm" variant="tertiary" onPress={loadStats}>{t('vetting.retry')}</Button>
          </div>
        )}

        <div className="flex max-w-sm">
          <Select
            label={t('vetting.filter_label')}
            selectedKeys={new Set([filter])}
            onSelectionChange={(keys) => setFilter(String(Array.from(keys)[0] ?? 'all') as VettingFilter)}
          >
            {FILTERS.map((value) => (
              <SelectItem key={value} id={value}>{t(`vetting.filter_${value}`)}</SelectItem>
            ))}
          </Select>
        </div>

        {listError ? (
          <BrokerEmptyState
            icon={AlertTriangle}
            color="danger"
            title={t('vetting.list_error_title')}
            hint={t('vetting.list_error_body')}
            action={<Button size="sm" variant="secondary" onPress={loadItems}>{t('vetting.retry')}</Button>}
          />
        ) : (
          <DataTable
            columns={columns}
            data={items}
            keyField="user_id"
            isLoading={loading}
            searchable
            searchPlaceholder={t('vetting.search_placeholder')}
            totalItems={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onSearch={setSearch}
            onRefresh={loadItems}
            emptyContent={emptyContent}
          />
        )}
      </div>

      <Modal isOpen={Boolean(confirmItem)} onOpenChange={(open) => { if (!open) setConfirmItem(null); }}>
        <ModalContent>
          <ModalHeader>{t('vetting.confirm_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p>{t('vetting.confirm_body', { name: confirmItem ? memberName(confirmItem) : '' })}</p>
            <Select
              label={t('vetting.certification_codes_label')}
              description={t('vetting.certification_codes_help')}
              selectionMode="multiple"
              selectedKeys={certificationCodes}
              onSelectionChange={(keys) => setCertificationCodes(keys === 'all'
                ? new Set((confirmItem?.policy.certification_options ?? []).map((option) => option.code))
                : new Set(Array.from(keys).map(String)))}
              isRequired
            >
              {(confirmItem?.policy.certification_options ?? []).map((option) => (
                <SelectItem key={option.code} id={option.code} textValue={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
            <Textarea
              label={t('vetting.scope_summary_label')}
              description={t('vetting.scope_summary_help')}
              value={scopeSummary}
              onValueChange={setScopeSummary}
              maxLength={500}
              minRows={2}
              maxRows={5}
              isRequired
            />
            <Textarea
              label={t('vetting.private_notes_label')}
              description={t('vetting.private_notes_help')}
              value={privateNotes}
              onValueChange={setPrivateNotes}
              maxLength={2000}
              minRows={3}
              maxRows={8}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="date"
                label={t('vetting.review_due_label')}
                description={t('vetting.review_due_help')}
                value={reviewDueAt}
                onValueChange={setReviewDueAt}
                isRequired
              />
              <Input
                type="date"
                label={t('vetting.authority_expiry_label')}
                description={authorityExpiryRequired
                  ? t('vetting.authority_expiry_required_help')
                  : t('vetting.authority_expiry_help')}
                value={authorityExpiresAt}
                onValueChange={setAuthorityExpiresAt}
                isRequired={authorityExpiryRequired}
              />
            </div>
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm text-muted">
              {t('vetting.privacy_body')}
            </div>
            <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>
              {t('vetting.confirm_acknowledgement', { name: confirmItem ? memberName(confirmItem) : '' })}
            </Checkbox>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setConfirmItem(null)}>{t('vetting.cancel')}</Button>
            <Button isPending={confirming} isDisabled={!confirmFormValid} onPress={handleConfirm}>
              {t('vetting.confirm_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={Boolean(detailItem)} onOpenChange={(open) => { if (!open) { setDetailItem(null); setDetailRecord(null); } }}>
        <ModalContent>
          <ModalHeader>{t('vetting.details_title', { name: detailItem ? memberName(detailItem) : '' })}</ModalHeader>
          <ModalBody className="space-y-4">
            {detailLoading ? (
              <BrokerSkeleton variant="detail" count={3} />
            ) : detailRecord ? (
              <>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('vetting.certification_codes_label')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detailRecord.certification_codes.map((code) => (
                      <Chip key={code} size="sm" variant="soft" color="accent">{certificationLabel(code, detailItem?.policy)}</Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('vetting.scope_summary_label')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{detailRecord.scope_summary || t('vetting.not_recorded')}</p>
                </div>
                <div className="rounded-xl border border-divider/70 bg-surface-secondary p-3">
                  <p className="text-sm font-medium text-foreground">{t('vetting.private_notes_label')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{detailRecord.private_notes || t('vetting.no_private_notes')}</p>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="font-medium text-foreground">{t('vetting.review_due_label')}</dt><dd className="text-muted">{detailRecord.review_due_at || t('vetting.not_recorded')}</dd></div>
                  <div><dt className="font-medium text-foreground">{t('vetting.authority_expiry_label')}</dt><dd className="text-muted">{detailRecord.authority_expires_at || t('vetting.not_applicable')}</dd></div>
                </dl>
              </>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => { setDetailItem(null); setDetailRecord(null); }}>{t('vetting.close')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={Boolean(revokeItem)} onOpenChange={(open) => { if (!open) setRevokeItem(null); }}>
        <ModalContent>
          <ModalHeader>{t('vetting.revoke_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p>{t('vetting.revoke_body', { name: revokeItem ? memberName(revokeItem) : '' })}</p>
            <Select
              label={t('vetting.reason_label')}
              selectedKeys={revocationReason ? new Set([revocationReason]) : new Set()}
              onSelectionChange={(keys) => setRevocationReason(String(Array.from(keys)[0] ?? ''))}
            >
              {(policyData?.revocation_reason_codes ?? []).map((code) => (
                <SelectItem key={code} id={code}>{t(`vetting.reason_${code}`)}</SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setRevokeItem(null)}>{t('vetting.cancel')}</Button>
            <Button variant="danger" isPending={revoking} isDisabled={!revocationReason} onPress={handleRevoke}>
              {t('vetting.revoke_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={Boolean(resolveItem)} onOpenChange={(open) => { if (!open) setResolveItem(null); }}>
        <ModalContent>
          <ModalHeader>{t('vetting.resolve_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p>{t('vetting.resolve_body', { name: resolveItem ? memberName(resolveItem) : '' })}</p>
            <Select
              label={t('vetting.resolution_label')}
              selectedKeys={resolutionCode ? new Set([resolutionCode]) : new Set()}
              onSelectionChange={(keys) => {
                const value = String(Array.from(keys)[0] ?? '');
                setResolutionCode(
                  SAFE_REVIEW_RESOLUTION_CODES.includes(value as ReviewResolutionCode)
                    ? value as ReviewResolutionCode
                    : '',
                );
              }}
            >
              {(policyData?.review_resolution_codes ?? []).map((code) => (
                <SelectItem key={code} id={code}>{t(`vetting.resolution_${code}`)}</SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setResolveItem(null)}>{t('vetting.cancel')}</Button>
            <Button isPending={resolving} isDisabled={!resolutionCode} onPress={handleResolve}>
              {t('vetting.resolve_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BrokerPageShell>
  );
}

export default VettingRecords;
