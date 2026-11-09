import { Button, Chip, Card, CardBody, CardHeader, Textarea, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Tooltip, Pagination } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import { Separator } from '@/components/ui';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import XCircle from 'lucide-react/icons/circle-x';
import Flag from 'lucide-react/icons/flag';
import Clock from 'lucide-react/icons/clock';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import BarChart3 from 'lucide-react/icons/chart-column';
import Inbox from 'lucide-react/icons/inbox';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { EmptyState } from '../../components/EmptyState';

// Written out in full so Tailwind can find them (a class built at runtime,
// such as `text-${color}`, is never generated and shows no colour).
const STATUS_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Job Moderation Queue
 *
 * Displays jobs pending moderation review with approve/reject/flag actions, * moderation statistics, and spam detection score indicators.
 */


interface PendingJob {
  id: number;
  title: string;
  description: string;
  type?: string;
  category?: string;
  location?: string;
  status: string;
  moderation_status: string;
  moderation_notes?: string;
  spam_score?: number;
  spam_flags?: string[];
  created_at: string;
  poster_name?: string;
  poster_avatar?: string;
  user_id: number;
}

interface ModerationStats {
  pending: number;
  approved_today: number;
  rejected_today: number;
  flagged: number;
  total_reviewed: number;
}

interface SpamStats {
  total_analyzed: number;
  blocked: number;
  flagged: number;
  avg_score: number;
  top_flags: Record<string, number>;
}

type ModerationAction = 'approve' | 'reject' | 'flag';

const PAGE_SIZE = 20;

function getSpamScoreColor(score: number): 'success' | 'warning' | 'danger' | 'default' {
  if (score > 70) return 'danger';
  if (score > 40) return 'warning';
  if (score > 0) return 'success';
  return 'default';
}

export function JobModerationQueue() {
  const { t } = useTranslation('jobs');
  const { t: tAdmin } = useTranslation('admin_jobs');
  usePageTitle(t('moderation.title'));
  const toast = useToast();

  // State
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [stats, setStats] = useState<ModerationStats | null>(null);
  const [spamStats, setSpamStats] = useState<SpamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Modal state
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    action: ModerationAction;
    job: PendingJob | null;
  }>({ isOpen: false, action: 'approve', job: null });
  const [actionReason, setActionReason] = useState('');
  const getFlagLabel = useCallback((flag: string) => t(`spam.flag_labels.${flag}`), [t]);

  // Load pending jobs
  const loadPendingJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      const res = await api.get<{ items: PendingJob[]; total: number }>(
        `/v2/admin/jobs/moderation-queue?${params.toString()}`
      );
      if (res.success && res.data) {
        setPendingJobs(res.data.items ?? []);
        setTotal(res.data.total ?? 0);
      } else {
        setPendingJobs([]);
        setTotal(0);
        toast.error(t('moderation.load_error'));
      }
    } catch {
      toast.error(t('moderation.load_error'));
    } finally {
      setLoading(false);
    }
  }, [page, t, toast]);


  // Load stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [modRes, spamRes] = await Promise.all([
        api.get<ModerationStats>('/v2/admin/jobs/moderation-stats'),
        api.get<SpamStats>('/v2/admin/jobs/spam-stats'),
      ]);
      if (modRes.success && modRes.data) setStats(modRes.data);
      if (spamRes.success && spamRes.data) setSpamStats(spamRes.data);
    } catch {
      // Stats are non-critical, just log
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingJobs();
    loadStats();
  }, [loadPendingJobs, loadStats]);

  // Open action modal
  const openActionModal = (action: ModerationAction, job: PendingJob) => {
    setActionModal({ isOpen: true, action, job });
    setActionReason('');
  };

  // Execute moderation action
  const executeAction = async () => {
    const { action, job } = actionModal;
    if (!job) return;

    // Reject and flag require a reason
    if ((action === 'reject' || action === 'flag') && !actionReason.trim()) {
      toast.error(t('moderation.reason_required'));
      return;
    }

    setActionLoading(true);
    try {
      const endpoint = `/v2/admin/jobs/${job.id}/${action}`;
      const body: Record<string, string> = {};

      if (action === 'approve') {
        if (actionReason.trim()) body.notes = actionReason.trim();
      } else {
        body.reason = actionReason.trim();
      }

      const res = await api.post(endpoint, body);

      if (res.success) {
        const successKey = `moderation.${action}_success`;
        toast.success(t(successKey));
        setPendingJobs((prev) => prev.filter((j) => j.id !== job.id));
        setTotal((prev) => Math.max(0, prev - 1));
        loadStats();
      } else {
        const errorKey = `moderation.${action}_error`;
        toast.error(t(errorKey));
      }
    } catch {
      toast.error(t('something_wrong'));
    } finally {
      setActionLoading(false);
      setActionModal({ isOpen: false, action: 'approve', job: null });
    }
  };

  const actionConfig: Record<ModerationAction, { color: 'success' | 'danger' | 'warning'; icon: typeof CheckCircle2; label: string }> = {
    approve: { color: 'success', icon: CheckCircle2, label: t('moderation.approve') },
    reject: { color: 'danger', icon: XCircle, label: t('moderation.reject') },
    flag: { color: 'warning', icon: Flag, label: t('moderation.flag') },
  };

  return (
    <div>
      <PageHeader
        title={t('moderation.title')}
        description={t('moderation.description')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={() => { loadPendingJobs(); loadStats(); }}
          >
            {t('moderation.refresh')}
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-6">
        <StatCard
          label={t('moderation.stats.pending_count')}
          value={stats?.pending ?? 0}
          icon={Clock}
          color="warning"
          loading={statsLoading}
        />
        <StatCard
          label={t('moderation.stats.approved_today')}
          value={stats?.approved_today ?? 0}
          icon={ShieldCheck}
          color="success"
          loading={statsLoading}
        />
        <StatCard
          label={t('moderation.stats.rejected_today')}
          value={stats?.rejected_today ?? 0}
          icon={XCircle}
          color="danger"
          loading={statsLoading}
        />
        <StatCard
          label={t('moderation.stats.flagged_count')}
          value={stats?.flagged ?? 0}
          icon={Flag}
          color="warning"
          loading={statsLoading}
        />
        <StatCard
          label={t('moderation.stats.total_reviewed')}
          value={stats?.total_reviewed ?? 0}
          icon={BarChart3}
          color="default"
          loading={statsLoading}
        />
      </div>

      {/* Spam Stats Summary */}
      {spamStats && spamStats.total_analyzed > 0 && (
        <Card className="mb-6">
          <CardHeader className="flex items-center gap-2 pb-2">
            <ShieldAlert aria-hidden="true" size={18} className="text-warning" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('spam.title')}
            </h3>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted">{t('spam.total_analyzed')}:</span>{' '}
                <span className="font-medium">{spamStats.total_analyzed}</span>
              </div>
              <div>
                <span className="text-muted">{t('spam.blocked_count')}:</span>{' '}
                <span className="font-medium text-danger">{spamStats.blocked}</span>
              </div>
              <div>
                <span className="text-muted">{t('spam.flagged_count')}:</span>{' '}
                <span className="font-medium text-warning">{spamStats.flagged}</span>
              </div>
              <div>
                <span className="text-muted">{t('spam.avg_score')}:</span>{' '}
                <span className="font-medium">{spamStats.avg_score}</span>
              </div>
            </div>
            {Object.keys(spamStats.top_flags).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(spamStats.top_flags).map(([flag, count]) => (
                  <Chip key={flag} size="sm" variant="soft" color="default">
                    {getFlagLabel(flag)}: {count}
                  </Chip>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Pending Jobs List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner label={t('moderation.loading')} /></div>
        </div>
      ) : pendingJobs.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t('moderation.no_pending')}
          description={t('moderation.no_pending_description')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {pendingJobs.map((job) => (
            <Card key={job.id}>
              <CardBody className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Job Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <Avatar
                        src={resolveAvatarUrl(job.poster_avatar) || undefined}
                        name={job.poster_name ?? tAdmin('common.unknown')}
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-foreground truncate">
                          {job.title}
                        </h3>
                        <p className="text-xs text-muted">
                          {job.poster_name
                            ? t('moderation.posted_by', { name: job.poster_name })
                            : t('moderation.user_fallback', { id: job.user_id })}
                          {' '}&middot;{' '}
                          {new Date(job.created_at).toLocaleDateString(getFormattingLocale(), {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Description preview */}
                    <p className="text-sm text-muted line-clamp-3 mb-2">
                      {job.description || t('moderation.no_description')}
                    </p>

                    {/* Meta chips */}
                    <div className="flex flex-wrap gap-2">
                      {job.type && (
                        <Chip size="sm" variant="soft" color="accent" className="capitalize">
                          {t(`jobs.type_${job.type}`, {
                            defaultValue: t('jobs.type_unknown'),
                          })}
                        </Chip>
                      )}
                      {job.category && (
                        <Chip size="sm" variant="soft" color="default">
                          {t('jobs.category_value', { category: job.category })}
                        </Chip>
                      )}
                      {job.location && (
                        <Chip size="sm" variant="soft" color="default">
                          {job.location}
                        </Chip>
                      )}
                      {job.spam_score != null && job.spam_score > 0 && (
                        <Tooltip content={
                          job.spam_flags && job.spam_flags.length > 0
                            ? t('moderation.flags_tooltip', {
                                flags: job.spam_flags.map(getFlagLabel).join(', '),
                              })
                            : t('moderation.no_flags')
                        }>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={getSpamScoreColor(job.spam_score)}
                            startContent={<AlertTriangle aria-hidden="true" size={12} />}
                          >
                            {t('moderation.spam_score', { score: job.spam_score })}
                          </Chip>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  <Separator className="sm:hidden" />

                  {/* Actions */}
                  <div className="flex gap-2 shrink-0 sm:flex-col sm:items-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={<CheckCircle2 aria-hidden="true" size={14} />}
                      onPress={() => openActionModal('approve', job)}
                    >
                      {t('moderation.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      startContent={<XCircle aria-hidden="true" size={14} />}
                      onPress={() => openActionModal('reject', job)}
                    >
                      {t('moderation.reject')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      startContent={<Flag aria-hidden="true" size={14} />}
                      onPress={() => openActionModal('flag', job)}
                    >
                      {t('moderation.flag')}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
          {total > PAGE_SIZE && (
            <div className="flex justify-center pt-2">
              <Pagination
                showControls
                page={page}
                total={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                onChange={setPage}
                aria-label={t('moderation.pagination_label')}
              />
            </div>
          )}
        </div>
      )}

      {/* Action Modal */}
      <Modal
        isOpen={actionModal.isOpen}
        onClose={() => setActionModal({ isOpen: false, action: 'approve', job: null })}
        size="md"
      >
        <ModalContent>
          {actionModal.job && (() => {
            const config = actionConfig[actionModal.action];
            const ActionIcon = config.icon;
            const requiresReason = actionModal.action === 'reject' || actionModal.action === 'flag';

            return (
              <>
                <ModalHeader className="flex items-center gap-2">
                  <ActionIcon aria-hidden="true" size={20} className={STATUS_TEXT[config.color]} />
                  {config.label}: {actionModal.job.title}
                </ModalHeader>
                <ModalBody>
                  <p className="text-sm text-muted mb-3">
                    {actionModal.action === 'approve' && t('moderation.confirm_approve')}
                    {actionModal.action === 'reject' && t('moderation.confirm_reject')}
                    {actionModal.action === 'flag' && t('moderation.confirm_flag')}
                  </p>
                  <Textarea
                    label={requiresReason
                      ? t('moderation.reason_label')
                      : t('moderation.notes_label')
                    }
                    placeholder={requiresReason
                      ? t('moderation.reason_placeholder')
                      : t('moderation.notes_placeholder')
                    }
                    value={actionReason}
                    onValueChange={setActionReason}
                    isRequired={requiresReason}
                    minRows={3}
                    maxRows={6}
                  />
                </ModalBody>
                <ModalFooter>
                  <Button
                    variant="tertiary"
                    onPress={() => setActionModal({ isOpen: false, action: 'approve', job: null })}
                  >
                    {t('moderation.cancel')}
                  </Button>
                  <Button
                    variant={actionModal.action === 'reject' ? 'danger' : 'secondary'}
                    isLoading={actionLoading}
                    isDisabled={requiresReason && !actionReason.trim()}
                    onPress={executeAction}
                    startContent={!actionLoading && <ActionIcon aria-hidden="true" size={16} />}
                  >
                    {config.label}
                  </Button>
                </ModalFooter>
              </>
            );
          })()}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default JobModerationQueue;
