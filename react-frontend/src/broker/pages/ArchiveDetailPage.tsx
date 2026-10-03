// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Archive Detail
 * Read-only compliance record for a reviewed broker message copy.
 * Shows decision info, the target message, and a frozen conversation snapshot.
 * No action buttons — this is a pure read-only view.
 *
 * Restyled to the broker design language: BrokerPageShell frame ('neutral'
 * records domain), an archival banner card marking the record as frozen, a
 * decision summary card, the preserved message and conversation snapshot in
 * read-only styled cards with tabular timestamps, shaped skeleton loading
 * and an honest error state with retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Archive from 'lucide-react/icons/archive';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Flag from 'lucide-react/icons/flag';
import Lock from 'lucide-react/icons/lock';
import Mail from 'lucide-react/icons/mail';
import MessageSquare from 'lucide-react/icons/message-square';

import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerArchiveDetail as BrokerArchiveDetailType } from '@/admin/api/types';
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ScrollShadow,
  Separator,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

const cardClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

// Decision chip — 'flagged' keeps its flag-badged danger chip; every other
// decision (approved, or anything unexpected) goes through BrokerStatusChip,
// which names the unknown with a translated "Unknown" rather than a
// capitalised slug. Mirrors ReviewArchivePage.
function DecisionChip({ decision }: { decision: string }) {
  const { t } = useTranslation('broker');
  if (decision !== 'flagged') {
    return <BrokerStatusChip status={decision} />;
  }
  return (
    <Chip size="sm" variant="soft" color="danger">
      <Flag size={12} aria-hidden="true" />
      <Chip.Label>{t('archives.decision_flagged')}</Chip.Label>
    </Chip>
  );
}

export function ArchiveDetail() {
  const { t } = useTranslation('broker');
  usePageTitle(t('archives.detail_page_title'));
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const [data, setData] = useState<BrokerArchiveDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stash the latest `t` in a ref so the fetch effect stays keyed on the
  // record id only — a language switch should relabel, not refetch.
  const tRef = useRef(t);
  tRef.current = t;

  const loadArchive = useCallback(async (archiveId: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminBroker.showArchive(archiveId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(tRef.current('archives.not_found'));
      }
    } catch {
      setError(tRef.current('archives.load_record_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  const numericId = Number(id);
  const isValidId = Number.isFinite(numericId) && numericId > 0;

  useEffect(() => {
    if (!id) return;
    const archiveId = Number(id);
    if (!Number.isFinite(archiveId) || archiveId <= 0) {
      setError(tRef.current('archives.invalid_id'));
      setLoading(false);
      return;
    }
    loadArchive(archiveId);
  }, [id, loadArchive]);

  const backButton = (
    <Button
      as={Link}
      to={tenantPath('/broker/archives')}
      variant="tertiary"
      startContent={<ArrowLeft aria-hidden="true" size={16} />}
      size="sm"
    >
      {t('archives.back')}
    </Button>
  );

  if (loading) {
    return (
      <BrokerPageShell
        title={t('archives.detail_title')}
        description={t('archives.detail_description')}
        icon={Archive}
        color="neutral"
        actions={backButton}
      >
        <BrokerSkeleton variant="detail" />
      </BrokerPageShell>
    );
  }

  if (error || !data) {
    return (
      <BrokerPageShell
        title={t('archives.detail_title')}
        description={t('archives.detail_description')}
        icon={Archive}
        color="neutral"
        actions={backButton}
      >
        {/* Honest error state — a missing record must never render as an
            empty-but-ok archive view. */}
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('archives.record_unavailable')}
          hint={error || t('archives.not_found')}
          action={
            isValidId ? (
              <Button size="sm" variant="danger-soft" onPress={() => loadArchive(numericId)}>
                {t('archives.retry')}
              </Button>
            ) : undefined
          }
        />
      </BrokerPageShell>
    );
  }

  const isApproved = data.decision === 'approved';

  return (
    <BrokerPageShell
      title={t('archives.detail_title')}
      description={t('archives.detail_description')}
      icon={Archive}
      color="neutral"
      actions={backButton}
    >
      <div className="space-y-6">
        {/* Archival banner — this record is frozen */}
        <Card className="rounded-2xl border border-divider/70 bg-surface-secondary shadow-sm shadow-black/[0.03]">
          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary text-muted ring-1 ring-inset ring-current/10"
                aria-hidden="true"
              >
                <Archive size={20} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold tracking-tight text-foreground">
                  {t('archives.record_id', { id: data.id })}
                </p>
                <p className="text-sm text-muted">{t('archives.frozen_note')}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Chip size="sm" variant="tertiary" color="default">
                <Lock aria-hidden="true" size={12} />
                <Chip.Label>{t('archives.read_only_badge')}</Chip.Label>
              </Chip>
              <DecisionChip decision={data.decision} />
            </div>
          </CardBody>
        </Card>

        {/* Decision summary */}
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-2">
            {isApproved ? (
              <CheckCircle aria-hidden="true" size={18} className="text-success" />
            ) : (
              <Flag aria-hidden="true" size={18} className="text-danger" />
            )}
            <h3 className="font-semibold tracking-tight">{t('archives.section_decision')}</h3>
          </CardHeader>
          <Separator />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted">{t('archives.label_decision')}</p>
                <div className="mt-1">
                  <DecisionChip decision={data.decision} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">{t('archives.label_decided_by')}</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <Avatar name={data.decided_by_name} size="sm" className="shrink-0" />
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {data.decided_by_name}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">{t('archives.label_date')}</p>
                <p className="mt-1 text-sm tabular-nums text-foreground">
                  {formatServerDateTime(data.decided_at)}
                </p>
              </div>
            </div>

            {data.decision_notes && (
              <div>
                <p className="text-xs text-muted">{t('archives.label_decision_notes')}</p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-surface-secondary p-3 text-sm text-foreground">
                  {data.decision_notes}
                </p>
              </div>
            )}

            {data.flag_reason && (
              <div className="rounded-xl border border-danger/20 bg-danger/10 p-3">
                <p className="text-xs font-medium text-danger">{t('archives.label_flag_reason')}</p>
                <p className="mt-1 text-sm text-foreground">{data.flag_reason}</p>
                {data.flag_severity && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-danger">
                      {t('archives.label_severity')}
                    </span>
                    <BrokerStatusChip status={data.flag_severity} />
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Target message — preserved exactly as sent */}
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-2">
            <Mail aria-hidden="true" size={18} className="text-muted" />
            <h3 className="font-semibold tracking-tight">{t('archives.section_target')}</h3>
          </CardHeader>
          <Separator />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={data.sender_name} size="sm" className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted">{t('archives.label_sender')}</p>
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {data.sender_name}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={data.receiver_name} size="sm" className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted">{t('archives.label_receiver')}</p>
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {data.receiver_name}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted">{t('archives.label_body')}</p>
              <p className="whitespace-pre-wrap rounded-xl bg-surface-secondary p-4 text-sm leading-relaxed text-foreground">
                {data.target_message_body}
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-xs text-muted">{t('archives.label_copy_reason')}</p>
                <Chip size="sm" variant="tertiary" color="default" className="mt-1">
                  {t(`archives.copy_reason_${data.copy_reason}`, {
                    defaultValue: data.copy_reason.replace(/_/g, ' '),
                  })}
                </Chip>
              </div>
              <div>
                <p className="text-xs text-muted">{t('archives.label_sent_at')}</p>
                <p className="mt-1 text-sm tabular-nums text-foreground">
                  {formatServerDateTime(data.target_message_sent_at)}
                </p>
              </div>
              {data.listing_title && (
                <div>
                  <p className="text-xs text-muted">{t('archives.label_listing')}</p>
                  <p className="mt-1 text-sm text-foreground">{data.listing_title}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Conversation snapshot — frozen at review time */}
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-2">
            <MessageSquare aria-hidden="true" size={18} className="text-muted" />
            <h3 className="font-semibold tracking-tight">
              {t('archives.section_conversation_snapshot')}
            </h3>
            <Chip size="sm" variant="tertiary" color="default" className="ml-auto tabular-nums">
              {t('archives.messages_count', { count: data.conversation_snapshot.length })}
            </Chip>
          </CardHeader>
          <Separator />
          <CardBody>
            {data.conversation_snapshot.length === 0 ? (
              <BrokerEmptyState
                bare
                icon={MessageSquare}
                color="neutral"
                title={t('archives.no_snapshot')}
              />
            ) : (
              <ScrollShadow className="max-h-[500px]">
                <div className="space-y-0">
                  {data.conversation_snapshot.map((msg, index) => (
                    <div key={msg.id}>
                      {index > 0 && <Separator className="my-3" />}
                      <div className="flex gap-3 py-1">
                        <Avatar name={msg.sender_name} size="sm" className="mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                              {msg.sender_name}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {formatServerDateTime(msg.created_at)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-muted">
                            {msg.is_deleted ? (
                              <span className="italic text-muted">{t('archives.deleted')}</span>
                            ) : (
                              msg.body
                            )}
                          </p>
                          {msg.is_edited && (
                            <span className="text-xs italic text-muted">{t('archives.edited')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollShadow>
            )}
          </CardBody>
        </Card>
      </div>
    </BrokerPageShell>
  );
}

export default ArchiveDetail;
