// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AlertCircle from 'lucide-react/icons/alert-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Clock from 'lucide-react/icons/clock';
import Heart from 'lucide-react/icons/heart';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import StopCircle from 'lucide-react/icons/stop-circle';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalHeading } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { PageMeta } from '@/components/seo';
import { useTenant, useToast } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentLog {
  date: string;
  hours: number;
  status: string;
}

interface Partner {
  id: number;
  name: string;
  avatar_url: string | null;
}

interface SupportRelationship {
  id: number;
  title: string;
  description: string;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'ad_hoc';
  expected_hours: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  start_date: string;
  end_date: string | null;
  last_logged_at: string | null;
  next_check_in_at: string | null;
  role: 'supporter' | 'recipient';
  intergenerational?: boolean;
  partner: Partner;
  recent_logs: RecentLog[];
}

type ActionKind = 'pause' | 'end';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOverdue(nextCheckInAt: string | null): boolean {
  if (!nextCheckInAt) return false;
  return new Date(nextCheckInAt) < new Date();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RelationshipCardSkeleton() {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3 rounded-lg" />
          <Skeleton className="h-3 w-2/3 rounded-lg" />
          <Skeleton className="h-3 w-1/2 rounded-lg" />
        </div>
      </div>
    </GlassCard>
  );
}

interface RelationshipCardProps {
  relationship: SupportRelationship;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onPause: (rel: SupportRelationship) => void;
  onEnd: (rel: SupportRelationship) => void;
  onResume: (rel: SupportRelationship) => void;
  busyId: number | null;
}

function RelationshipCard({ relationship, t, onPause, onEnd, onResume, busyId }: RelationshipCardProps) {
  const overdue = relationship.status === 'active' && isOverdue(relationship.next_check_in_at);

  const statusColor =
    relationship.status === 'active'
      ? 'success'
      : relationship.status === 'paused'
        ? 'warning'
        : 'default';

  const roleColor = relationship.role === 'supporter' ? 'primary' : 'secondary';
  const isBusy = busyId === relationship.id;

  return (
    <GlassCard className="p-5" role="article" aria-labelledby={`support-relationship-${relationship.id}`}>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar
            src={relationship.partner.avatar_url ?? undefined}
            name={relationship.partner.name}
            size="md"
            className="shrink-0"
          />
          <div>
            <p id={`support-relationship-${relationship.id}`} className="font-semibold text-theme-primary">{relationship.partner.name}</p>
            <p className="text-sm text-theme-muted">{relationship.title}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" color={roleColor} variant="flat">
            {t(`my_support_relationships.role.${relationship.role}`)}
          </Chip>
          <Chip size="sm" color={statusColor} variant="flat">
            {t(`my_support_relationships.status.${relationship.status}`)}
          </Chip>
          {relationship.intergenerational && (
            <Tooltip content={t('inter_gen.tooltip')} placement="top">
              <Chip
                size="sm"
                color="secondary"
                variant="flat"
                startContent={<HeartHandshake className="h-3 w-3" aria-hidden="true" />}
                classNames={{ base: 'bg-accent/15 text-accent dark:text-accent' }}
              >
                {t('inter_gen.badge')}
              </Chip>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Details row */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-theme-muted">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(`my_support_relationships.frequency.${relationship.frequency}`)}
          <span aria-hidden="true">/</span>
          {t('my_support_relationships.expected_hours', { hours: relationship.expected_hours })}
        </span>

        {relationship.status === 'active' && relationship.next_check_in_at && (
          <span
            className={`flex items-center gap-1.5 ${overdue ? 'font-medium text-danger' : ''}`}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {overdue
              ? t('my_support_relationships.overdue')
              : `${t('my_support_relationships.next_check_in')}: ${formatDate(relationship.next_check_in_at)}`}
          </span>
        )}
      </div>

      {/* Description */}
      {relationship.description && (
        <p className="mt-2 text-sm leading-6 text-theme-muted">{relationship.description}</p>
      )}

      {/* Recent logs */}
      <div className="mt-4 rounded-lg border border-theme-default bg-theme-elevated p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
          {t('my_support_relationships.recent_logs')}
        </p>
        {relationship.recent_logs.length === 0 ? (
          <p className="text-sm text-theme-muted">
            {t('my_support_relationships.no_recent_logs')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {relationship.recent_logs.map((log, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-theme-muted">{formatDate(log.date)}</span>
                <span className="font-medium text-theme-primary">
                  {t('my_support_relationships.hours_short', { hours: log.hours })}
                </span>
                <Chip
                  size="sm"
                  color={
                    log.status === 'approved'
                      ? 'success'
                      : log.status === 'pending'
                        ? 'warning'
                        : 'default'
                  }
                  variant="flat"
                >
                  {t(`my_support_relationships.log_status.${log.status}`)}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Member-side actions */}
      {(relationship.status === 'active' || relationship.status === 'paused') && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {relationship.status === 'active' && (
            <>
              <Button
                size="sm"
                color="warning"
                variant="flat"
                startContent={<Pause className="h-4 w-4" aria-hidden="true" />}
                onPress={() => onPause(relationship)}
                isDisabled={isBusy}
              >
                {t('caring_community:relationships.actions.pause')}
              </Button>
              <Button
                size="sm"
                color="danger"
                variant="flat"
                startContent={<StopCircle className="h-4 w-4" aria-hidden="true" />}
                onPress={() => onEnd(relationship)}
                isDisabled={isBusy}
              >
                {t('caring_community:relationships.actions.end')}
              </Button>
            </>
          )}
          {relationship.status === 'paused' && (
            <Button
              size="sm"
              color="success"
              variant="flat"
              startContent={<Play className="h-4 w-4" aria-hidden="true" />}
              onPress={() => onResume(relationship)}
              isDisabled={isBusy}
              isLoading={isBusy}
            >
              {t('caring_community:relationships.actions.resume')}
            </Button>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Action confirmation modal
// ---------------------------------------------------------------------------

interface ActionModalProps {
  kind: ActionKind | null;
  relationship: SupportRelationship | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, resumeAt: string) => void;
}

function ActionModal({ kind, relationship, isSubmitting, onCancel, onConfirm }: ActionModalProps) {
  const { t } = useTranslation(['common', 'caring_community']);
  const [reason, setReason] = useState('');
  const [resumeAt, setResumeAt] = useState('');

  // Reset fields whenever the modal opens for a new action. Done during render
  // with a prev-prop comparison (not useEffect) so the form never shows a stale
  // frame from the previous action.
  const [prevActionKey, setPrevActionKey] = useState<string>(`${kind}:${relationship?.id ?? ''}`);
  const actionKey = `${kind}:${relationship?.id ?? ''}`;
  if (actionKey !== prevActionKey) {
    setPrevActionKey(actionKey);
    if (kind !== null) {
      setReason('');
      setResumeAt('');
    }
  }

  const isOpen = kind !== null && relationship !== null;

  const handleConfirm = () => {
    onConfirm(reason.trim(), resumeAt.trim());
  };

  const titleKey =
    kind === 'pause'
      ? 'caring_community:relationships.pause_modal.title'
      : 'caring_community:relationships.end_modal.title';
  const descKey =
    kind === 'pause'
      ? 'caring_community:relationships.pause_modal.description'
      : 'caring_community:relationships.end_modal.description';
  const reasonLabelKey =
    kind === 'pause'
      ? 'caring_community:relationships.pause_modal.reason_label'
      : 'caring_community:relationships.end_modal.reason_label';
  const confirmKey =
    kind === 'pause'
      ? 'caring_community:relationships.pause_modal.confirm'
      : 'caring_community:relationships.end_modal.confirm';

  return (
    <Modal isOpen={isOpen} onClose={isSubmitting ? undefined : onCancel} size="md" placement="center">
      <ModalContent>
        <ModalHeader>
          <ModalHeading className="text-lg font-semibold text-theme-primary">
            {t(titleKey)}
          </ModalHeading>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm leading-6 text-theme-muted">{t(descKey)}</p>
          <Textarea
            label={t(reasonLabelKey)}
            value={reason}
            onValueChange={setReason}
            maxLength={500}
            variant="bordered"
            classNames={{ inputWrapper: 'mt-1' }}
          />
          {kind === 'pause' && (
            <Input
              type="date"
              label={t('caring_community:relationships.pause_modal.resume_at_label')}
              value={resumeAt}
              onValueChange={setResumeAt}
              variant="bordered"
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onCancel} isDisabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            color={kind === 'end' ? 'danger' : 'warning'}
            onPress={handleConfirm}
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
          >
            {t(confirmKey)}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MySupportRelationshipsPage() {
  // RelationshipCard receives this `t` as a prop and renders caring_community:*
  // keys, so that namespace must be loaded here too.
  const { t } = useTranslation(['common', 'caring_community']);
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  const toast = useToast();
  usePageTitle(t('my_support_relationships.meta.title'));

  const { data: relationships, isLoading, error, refetch } = useApi<SupportRelationship[]>(
    '/v2/caring-community/my-relationships',
    { immediate: true },
  );

  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [actionTarget, setActionTarget] = useState<SupportRelationship | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Redirect if feature is disabled
  useEffect(() => {
    if (!hasFeature('caring_community')) {
      void navigate(tenantPath('/caring-community'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  const openPause = useCallback((rel: SupportRelationship) => {
    setActionKind('pause');
    setActionTarget(rel);
  }, []);

  const openEnd = useCallback((rel: SupportRelationship) => {
    setActionKind('end');
    setActionTarget(rel);
  }, []);

  const closeAction = useCallback(() => {
    setActionKind(null);
    setActionTarget(null);
  }, []);

  const handleConfirmAction = useCallback(
    async (reason: string, resumeAt: string) => {
      if (!actionTarget || !actionKind) return;
      setBusyId(actionTarget.id);
      try {
        if (actionKind === 'pause') {
          const body: { reason?: string; resume_at?: string } = {};
          if (reason !== '') body.reason = reason;
          if (resumeAt !== '') body.resume_at = resumeAt;
          const res = await api.post(
            `/v2/caring-community/my-relationships/${actionTarget.id}/pause`,
            body,
          );
          if (res.success) {
            toast.success(t('caring_community:relationships.toast_paused'));
            closeAction();
            await refetch();
          } else {
            toast.error(t('my_support_relationships.errors.load_failed'));
          }
        } else {
          const body: { reason?: string } = {};
          if (reason !== '') body.reason = reason;
          const res = await api.post(
            `/v2/caring-community/my-relationships/${actionTarget.id}/end`,
            body,
          );
          if (res.success) {
            toast.success(t('caring_community:relationships.toast_ended'));
            closeAction();
            await refetch();
          } else {
            toast.error(t('my_support_relationships.errors.load_failed'));
          }
        }
      } catch (err: unknown) {
        logError('MySupportRelationshipsPage: action failed', err);
        toast.error(t('my_support_relationships.errors.load_failed'));
      } finally {
        setBusyId(null);
      }
    },
    [actionKind, actionTarget, closeAction, refetch, t, toast],
  );

  const handleResume = useCallback(
    async (rel: SupportRelationship) => {
      setBusyId(rel.id);
      try {
        const res = await api.post(`/v2/caring-community/my-relationships/${rel.id}/resume`);
        if (res.success) {
          toast.success(t('caring_community:relationships.toast_resumed'));
          await refetch();
        } else {
          toast.error(t('my_support_relationships.errors.load_failed'));
        }
      } catch (err: unknown) {
        logError('MySupportRelationshipsPage: resume failed', err);
        toast.error(t('my_support_relationships.errors.load_failed'));
      } finally {
        setBusyId(null);
      }
    },
    [refetch, t, toast],
  );

  return (
    <>
      <PageMeta
        title={t('my_support_relationships.meta.title')}
        description={t('my_support_relationships.meta.description')}
        noIndex
      />

      <ActionModal
        kind={actionKind}
        relationship={actionTarget}
        isSubmitting={busyId !== null}
        onCancel={closeAction}
        onConfirm={handleConfirmAction}
      />

      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={tenantPath('/caring-community')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('my_support_relationships.back')}
        </Link>

        {/* Page header */}
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <Users className="h-6 w-6 text-[var(--color-primary)]" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                {t('my_support_relationships.meta.title')}
              </h1>
              <p className="mt-2 text-base leading-8 text-theme-muted">
                {t('my_support_relationships.subtitle')}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Error state */}
        {error && !isLoading && (
          <GlassCard className="p-6" role="alert">
            <div className="flex items-center gap-3 text-danger">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-medium">{t('my_support_relationships.errors.load_failed')}</p>
            </div>
          </GlassCard>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
            <p className="text-center text-base text-theme-muted">{t('my_support_relationships.loading')}</p>
            {[0, 1, 2].map((i) => (
              <RelationshipCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && relationships !== null && relationships.length === 0 && (
          <GlassCard className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
              <Heart className="h-7 w-7 text-rose-500" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold text-theme-primary">
              {t('my_support_relationships.empty.title')}
            </h2>
            <p className="mt-2 text-sm text-theme-muted">
              {t('my_support_relationships.empty.body')}
            </p>
          </GlassCard>
        )}

        {/* Relationship cards */}
        {!isLoading && !error && relationships && relationships.length > 0 && (
          <div className="space-y-4">
            {relationships.map((rel) => (
              <RelationshipCard
                key={rel.id}
                relationship={rel}
                t={t}
                onPause={openPause}
                onEnd={openEnd}
                onResume={handleResume}
                busyId={busyId}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default MySupportRelationshipsPage;
