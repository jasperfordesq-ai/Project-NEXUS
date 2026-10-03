// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Match Approval Detail
 *
 * Full view of one smart-match proposal: score gauge with quality label,
 * match type / distance / category, the algorithm's match reasons, both
 * party cards, the associated listing, review details once decided, and
 * approve / reject actions while pending. Ported from the admin matching
 * module and restyled to the broker design language.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import MapPin from 'lucide-react/icons/map-pin';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import User from 'lucide-react/icons/user';
import FileText from 'lucide-react/icons/file-text';
import Clock from 'lucide-react/icons/clock';
import UserCheck from 'lucide-react/icons/user-check';
import Sparkles from 'lucide-react/icons/sparkles';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import { adminMatching } from '@/admin/api/adminApi';
import type { MatchApproval, MatchApprovalDetail } from '@/admin/api/types';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Progress,
  Avatar,
  Separator,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerSkeleton,
  BrokerEmptyState,
  BrokerStatusChip,
} from '../components';
import { BrokerQueueNav } from '../components/BrokerQueueNav';
import { MatchRejectModal } from '../components/exchanges/MatchRejectModal';
import { MemberName } from '../BrokerMemberWindow';
import { useBrokerBreadcrumbLabel } from '../BrokerBreadcrumbContext';
import { useBrokerQueue } from '../useBrokerQueue';

/** Short breadcrumb label: "Alice ↔ Bob · Gardening" (null while loading). */
export function matchCrumbLabel(item: MatchApprovalDetail | null): string | null {
  if (!item) return null;
  const parties = `${item.user_1_name} ↔ ${item.user_2_name}`;
  return item.listing_title ? `${parties} · ${item.listing_title}` : parties;
}

function scoreColor(score: number): 'danger' | 'warning' | 'success' {
  if (score < 50) return 'danger';
  if (score < 75) return 'warning';
  return 'success';
}

function scoreLabelKey(score: number): string {
  if (score >= 90) return 'matching.score_excellent';
  if (score >= 75) return 'matching.score_good';
  if (score >= 50) return 'matching.score_fair';
  return 'matching.score_low';
}

const cardClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

// "Not found" (the API answered, there is no such match) is a different
// message from "the request itself failed" (network, 500) — only the latter
// is worth a Retry.
type LoadErrorKind = 'not_found' | 'load_failed';

// Guide article for this page; shared with the list.
const HELP = { sectionId: 'broker_exchanges', articleId: 'broker_match_approvals' } as const;

export function MatchApprovalDetailPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('matching.detail_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [item, setItem] = useState<MatchApprovalDetail | null>(null);
  useBrokerBreadcrumbLabel(matchCrumbLabel(item));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ kind: LoadErrorKind; message: string | null } | null>(null);

  const [approveLoading, setApproveLoading] = useState(false);

  // Matches waiting for a decision; after one, the next opens straight away.
  const queue = useBrokerQueue({
    currentId: id ? Number(id) : null,
    fetchQueue: async () => {
      const res = await adminMatching.getApprovals({ status: 'pending' });
      if (!res.success || !res.data) return null;
      // Same two shapes the list page accepts.
      const raw = res.data as unknown;
      const rows = Array.isArray(raw)
        ? (raw as MatchApproval[])
        : ((raw as { data?: MatchApproval[] }).data ?? []);
      const nested = Array.isArray(raw) ? undefined : (raw as { meta?: { total?: number } }).meta?.total;
      const total = nested ?? (res.meta as { total?: number } | undefined)?.total ?? rows.length;
      return { ids: rows.map((r) => r.id), total };
    },
    itemPath: (next) => `/broker/match-approvals/${next}`,
    listPath: '/broker/match-approvals?status=pending',
  });
  // The reject modal is shared with the list page (../components/exchanges/MatchRejectModal).
  const [rejectOpen, setRejectOpen] = useState(false);

  // Every request is wrapped: a thrown request used to escape this loader and
  // leave the skeleton up for ever.
  const loadItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminMatching.getApproval(Number(id));
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (data && typeof data === 'object' && 'data' in data) {
          setItem((data as { data: MatchApprovalDetail }).data);
        } else {
          setItem(data as MatchApprovalDetail);
        }
      } else {
        setError({ kind: 'not_found', message: res.error || null });
      }
    } catch {
      setError({ kind: 'load_failed', message: null });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadItem();
  }, [loadItem]);

  const handleApprove = async () => {
    if (!item) return;
    setApproveLoading(true);
    try {
      const res = await adminMatching.approveMatch(item.id);
      if (res.success) {
        toast.success(t('matching.approved_toast'));
        void queue.goNext();
      } else {
        toast.error(res.error || t('matching.approve_failed'));
      }
    } catch {
      toast.error(t('matching.approve_failed'));
    } finally {
      setApproveLoading(false);
    }
  };

  const backButton = (
    <Button
      variant="tertiary"
      size="sm"
      startContent={<ArrowLeft size={16} />}
      onPress={() => navigate(tenantPath('/broker/match-approvals'))}
    >
      {t('matching.back')}
    </Button>
  );

  if (loading) {
    return (
      <BrokerPageShell
        help={HELP}
        title={t('matching.detail_title')}
        description={t('matching.detail_description')}
        icon={UserCheck}
        color="accent"
        actions={backButton}
      >
        <BrokerSkeleton variant="detail" />
      </BrokerPageShell>
    );
  }

  if (error || !item) {
    const kind: LoadErrorKind = error?.kind ?? 'not_found';
    return (
      <BrokerPageShell
        help={HELP}
        title={t('matching.detail_title')}
        description={t('matching.detail_description')}
        icon={UserCheck}
        color="accent"
        actions={backButton}
      >
        <BrokerEmptyState
          icon={XCircle}
          color="danger"
          title={kind === 'load_failed' ? t('matching.load_failed') : t('matching.not_found_title')}
          hint={kind === 'load_failed' ? t('matching.load_error_hint') : error?.message || t('matching.not_found_hint')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {kind === 'load_failed' && (
                <Button
                  variant="danger-soft"
                  size="sm"
                  startContent={<RefreshCw size={16} aria-hidden="true" />}
                  onPress={loadItem}
                >
                  {t('matching.retry')}
                </Button>
              )}
              {backButton}
            </div>
          }
        />
      </BrokerPageShell>
    );
  }

  const isPending = item.status === 'pending';
  const matchTypeKey = `matching.type_${item.match_type || 'one_way'}`;
  const matchTypeLabel = t(matchTypeKey, {
    defaultValue: (item.match_type || 'one_way').replace(/_/g, ' '),
  });

  return (
    <BrokerPageShell
      help={HELP}
      title={t('matching.detail_title')}
      description={t('matching.detail_description')}
      icon={UserCheck}
      color="accent"
      actions={
        <>
          <BrokerQueueNav queue={queue} />
          {backButton}
        </>
      }
    >
      {/* Match score hero */}
      <Card className={`${cardClass} mb-6`}>
        <CardHeader className="flex items-center gap-3 pb-0">
          <Sparkles size={20} className="text-accent" aria-hidden="true" />
          <h3 className="text-lg font-semibold tracking-tight">{t('matching.match_information')}</h3>
          <div className="ml-auto">
            <BrokerStatusChip status={item.status} />
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Score gauge */}
            <div className="flex flex-col items-center justify-center rounded-xl bg-surface-secondary p-6">
              <p className="mb-2 text-sm text-muted">{t('matching.score_label')}</p>
              <Progress
                size="lg"
                value={item.match_score}
                color={scoreColor(item.match_score)}
                className="mb-2 w-32"
                aria-label={t('matching.match_score_aria', { score: Math.round(item.match_score) })}
              />
              <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {Math.round(item.match_score)}%
              </p>
              <Chip size="sm" variant="soft" color={scoreColor(item.match_score)} className="mt-1">
                {t(scoreLabelKey(item.match_score))}
              </Chip>
            </div>

            {/* Details */}
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted">{t('matching.match_type')}</p>
                <Chip size="sm" variant="soft" className="mt-1 capitalize">
                  {matchTypeLabel}
                </Chip>
              </div>
              {item.distance_km !== null && item.distance_km !== undefined && (
                <div>
                  <p className="text-xs text-muted">{t('matching.distance')}</p>
                  <p className="flex items-center gap-1 text-sm tabular-nums text-foreground">
                    <MapPin size={14} className="text-muted" aria-hidden="true" />
                    {t('matching.distance_km', { km: item.distance_km.toFixed(1) })}
                  </p>
                </div>
              )}
              {item.category_name && (
                <div>
                  <p className="text-xs text-muted">{t('matching.category')}</p>
                  <p className="text-sm text-foreground">{item.category_name}</p>
                </div>
              )}
            </div>

            {/* Match reasons */}
            <div>
              <p className="mb-2 text-xs text-muted">{t('matching.match_reasons')}</p>
              {item.match_reasons && item.match_reasons.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.match_reasons.map((reason, i) => (
                    <Chip key={i} size="sm" variant="soft" color="accent">
                      {reason}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-muted">{t('matching.no_reasons')}</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Parties */}
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <User size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('matching.matched_member')}</h3>
          </CardHeader>
          <CardBody>
            <div className="flex items-start gap-4">
              <Avatar src={item.user_1_avatar || undefined} name={item.user_1_name} size="lg" className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-foreground">
                  <MemberName userId={item.user_1_id} name={item.user_1_name} />
                </p>
                {item.user_1_email && <p className="text-sm text-muted">{item.user_1_email}</p>}
                {item.user_1_location && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                    <MapPin size={12} aria-hidden="true" />
                    {item.user_1_location}
                  </p>
                )}
                {item.user_1_bio && <p className="mt-2 line-clamp-3 text-sm text-muted">{item.user_1_bio}</p>}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <User size={18} className="text-success" aria-hidden="true" />
            <h3 className="font-semibold">{t('matching.listing_owner')}</h3>
          </CardHeader>
          <CardBody>
            <div className="flex items-start gap-4">
              <Avatar src={item.user_2_avatar || undefined} name={item.user_2_name} size="lg" className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-foreground">
                  <MemberName userId={item.user_2_id} name={item.user_2_name} />
                </p>
                {item.user_2_email && <p className="text-sm text-muted">{item.user_2_email}</p>}
                {item.user_2_location && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                    <MapPin size={12} aria-hidden="true" />
                    {item.user_2_location}
                  </p>
                )}
                {item.user_2_bio && <p className="mt-2 line-clamp-3 text-sm text-muted">{item.user_2_bio}</p>}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Listing */}
      {item.listing_title && (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <FileText size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('matching.associated_listing')}</h3>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              <p className="text-lg font-medium text-foreground">{item.listing_title}</p>
              <div className="flex gap-2">
                {item.listing_type && (
                  <Chip size="sm" variant="soft">
                    {t(`matching.listing_type_${item.listing_type}`, { defaultValue: t('status.unknown') })}
                  </Chip>
                )}
                {item.listing_status && <BrokerStatusChip status={item.listing_status} />}
              </div>
              {item.listing_description && (
                <p className="line-clamp-3 text-sm text-muted">{item.listing_description}</p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Review details (once decided) */}
      {item.reviewed_at && (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <Clock size={18} className="text-muted" aria-hidden="true" />
            <h3 className="font-semibold">{t('matching.review_details')}</h3>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted">{t('matching.reviewed_by')}</p>
                <p className="text-sm font-medium text-foreground">
                  {item.reviewer_name || t('matching.unknown')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted">{t('matching.reviewed_at')}</p>
                <p className="text-sm tabular-nums text-foreground">
                  {formatServerDateTime(item.reviewed_at)}
                </p>
              </div>
              {item.notes && (
                <>
                  <Separator className="my-2" />
                  <div>
                    <p className="mb-1 text-sm text-muted">
                      {item.status === 'rejected'
                        ? t('matching.reject_reason_label')
                        : t('matching.notes_label')}
                    </p>
                    <p className="rounded-lg bg-surface-secondary p-3 text-sm text-foreground">{item.notes}</p>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Decision bar for pending items */}
      {isPending && (
        <Card className={cardClass}>
          <CardBody className="flex flex-row items-center justify-end gap-3 p-4">
            <Button
              variant="danger-soft"
              startContent={<XCircle size={16} />}
              onPress={() => setRejectOpen(true)}
            >
              {t('matching.reject')}
            </Button>
            <Button
              color="success"
              startContent={<CheckCircle size={16} />}
              onPress={handleApprove}
              isLoading={approveLoading}
            >
              {t('matching.approve')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Reject modal — shared with the list page; after a decision the next
          waiting match opens. */}
      {rejectOpen && (
        <MatchRejectModal
          match={item}
          onClose={() => setRejectOpen(false)}
          onRejected={() => void queue.goNext()}
        />
      )}
    </BrokerPageShell>
  );
}

export default MatchApprovalDetailPage;
