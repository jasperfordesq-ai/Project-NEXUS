// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Exchange Detail
 * Full detail view for a single exchange request, restyled to the broker
 * design language: lifecycle pipeline strip, avatar party cards, risk-tag
 * surfacing, and a proper history timeline. Approve / reject actions are
 * available on pending_broker exchanges so brokers don't have to return
 * to the list to act; a disputed exchange can be settled and a completed one
 * reversed (see ../components/ExchangeResolution).
 * Parity: PHP BrokerControlsController::showExchange()
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Separator,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Avatar,
} from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import User from 'lucide-react/icons/user';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Clock from 'lucide-react/icons/clock';
import Check from 'lucide-react/icons/check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import RouteIcon from 'lucide-react/icons/route';
import Hourglass from 'lucide-react/icons/hourglass';
import Calendar from 'lucide-react/icons/calendar';
import FileText from 'lucide-react/icons/file-text';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import { usePageTitle } from '@/hooks';
import { adminBroker } from '@/admin/api/adminApi';
import type { ExchangeDetail as ExchangeDetailType } from '@/admin/api/types';
import { useTenant, useToast } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import {
  BrokerPageShell,
  BrokerSkeleton,
  BrokerEmptyState,
  BrokerStatusChip,
} from '../components';
import {
  DisputeSettlePanel,
  ReverseExchangeButton,
  ReversedNotice,
  canReverse,
} from '../components/ExchangeResolution';

const cardClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle pipeline — the linear happy path plus the terminal off-ramps this
// page already knows about. Unknown statuses render the strip with no stage
// highlighted (the status chip in the card header still names them).
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = ['pending', 'pending_broker', 'accepted', 'completed'] as const;
const TERMINAL_STATUSES = new Set(['cancelled', 'disputed']);

function StatusPipeline({ status }: { status: string }) {
  const { t } = useTranslation('broker');
  const isTerminal = TERMINAL_STATUSES.has(status);
  const currentIdx = (PIPELINE_STAGES as readonly string[]).indexOf(status);

  return (
    <ol
      aria-label={t('exchanges.detail_pipeline_title')}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2"
    >
      {PIPELINE_STAGES.map((stage, i) => {
        const done = !isTerminal && currentIdx > i;
        const current = !isTerminal && currentIdx === i;
        const hasConnector = i < PIPELINE_STAGES.length - 1 || isTerminal;
        return (
          <li
            key={stage}
            aria-current={current ? 'step' : undefined}
            className={`flex min-w-0 items-center gap-2 ${hasConnector ? 'sm:flex-1' : ''}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-1 ring-inset transition-colors motion-reduce:transition-none ${
                done
                  ? 'bg-success/15 text-success ring-success/30'
                  : current
                    ? 'bg-accent/15 text-accent ring-2 ring-accent/60'
                    : 'bg-surface-tertiary text-muted ring-divider'
              }`}
            >
              {done ? <Check size={14} aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={`truncate text-sm ${
                current ? 'font-semibold text-foreground' : done ? 'text-foreground' : 'text-muted'
              }`}
            >
              {t(`status.${stage}`)}
            </span>
            {hasConnector && (
              <span
                aria-hidden="true"
                className={`hidden h-px min-w-4 flex-1 sm:block ${done ? 'bg-success/40' : 'bg-divider'}`}
              />
            )}
          </li>
        );
      })}
      {isTerminal && (
        <li aria-current="step" className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger ring-2 ring-inset ring-danger/40">
            <XCircle size={14} aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold text-danger">{t(`status.${status}`)}</span>
        </li>
      )}
    </ol>
  );
}

type LoadErrorKind = 'invalid_id' | 'not_found' | 'load_failed';

const ERROR_TITLE_KEY: Record<LoadErrorKind, string> = {
  invalid_id: 'exchanges.detail_invalid_id',
  not_found: 'exchanges.detail_not_found',
  load_failed: 'exchanges.detail_load_failed',
};

export default function ExchangeDetail() {
  const { t } = useTranslation('broker');
  usePageTitle(t('exchanges.detail_title'));
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [data, setData] = useState<ExchangeDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<LoadErrorKind | null>(null);

  // Approve / reject actions — available on the detail page for pending_broker
  // exchanges so brokers don't have to return to the list to act.
  const [actionModal, setActionModal] = useState<'approve' | 'reject' | null>(null);
  const [actionText, setActionText] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Stable fetch (no t/toast in deps) — the effect below keys on the route id.
  const loadExchange = useCallback(async (exchangeId: number) => {
    setLoading(true);
    setErrorKind(null);
    try {
      const res = await adminBroker.showExchange(exchangeId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setErrorKind('not_found');
      }
    } catch {
      setErrorKind('load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId) || numericId <= 0) {
      setErrorKind('invalid_id');
      setLoading(false);
      return;
    }
    loadExchange(numericId);
  }, [id, loadExchange]);

  const handleAction = async () => {
    if (!data || actionModal === null) return;
    if (actionModal === 'reject' && !actionText.trim()) {
      toast.error(t('exchanges.reason_required_error'));
      return;
    }
    setActionLoading(true);
    try {
      const res = actionModal === 'approve'
        ? await adminBroker.approveExchange(data.exchange.id, actionText || undefined)
        : await adminBroker.rejectExchange(data.exchange.id, actionText);
      if (res?.success) {
        toast.success(t('exchanges.action_succeeded'));
        setActionModal(null);
        setActionText('');
        loadExchange(data.exchange.id);
      } else {
        toast.error(res?.error || t('exchanges.action_failed'));
      }
    } catch {
      toast.error(t('exchanges.action_failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const backButton = (
    <Button
      as={Link}
      to={tenantPath('/broker/exchanges')}
      variant="tertiary"
      size="sm"
      startContent={<ArrowLeft size={16} aria-hidden="true" />}
    >
      {t('exchanges.detail_back_to_exchanges')}
    </Button>
  );

  if (loading) {
    return (
      <BrokerPageShell
        title={t('exchanges.detail_title')}
        description={t('exchanges.detail_default_description')}
        icon={ArrowLeftRight}
        color="accent"
        actions={backButton}
      >
        <BrokerSkeleton variant="detail" />
      </BrokerPageShell>
    );
  }

  if (errorKind || !data) {
    const kind: LoadErrorKind = errorKind ?? 'not_found';
    const numericId = id ? parseInt(id, 10) : NaN;
    const canRetry = kind === 'load_failed' && !Number.isNaN(numericId) && numericId > 0;
    return (
      <BrokerPageShell
        title={t('exchanges.detail_title')}
        description={t('exchanges.detail_default_description')}
        icon={ArrowLeftRight}
        color="accent"
        actions={backButton}
      >
        <BrokerEmptyState
          icon={XCircle}
          color="danger"
          title={t(ERROR_TITLE_KEY[kind])}
          hint={t('exchanges.detail_error_hint')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {canRetry && (
                <Button
                  variant="tertiary"
                  size="sm"
                  startContent={<RefreshCw size={16} aria-hidden="true" />}
                  onPress={() => loadExchange(numericId)}
                >
                  {t('exchanges.retry')}
                </Button>
              )}
              {backButton}
            </div>
          }
        />
      </BrokerPageShell>
    );
  }

  const { exchange, history, risk_tag, dispute_window: disputeWindow } = data;
  const reload = () => loadExchange(exchange.id);
  const riskIsSevere = risk_tag ? risk_tag.risk_level === 'critical' || risk_tag.risk_level === 'high' : false;

  return (
    <BrokerPageShell
      title={t('exchanges.detail_title_with_id', { id: exchange.id })}
      description={exchange.listing_title ?? t('exchanges.detail_default_description')}
      icon={ArrowLeftRight}
      color="accent"
      actions={
        <>
          {exchange.status === 'pending_broker' && (
            <>
              <Button
                color="success"
                size="sm"
                startContent={<CheckCircle size={16} aria-hidden="true" />}
                onPress={() => { setActionModal('approve'); setActionText(''); }}
              >
                {t('exchanges.approve')}
              </Button>
              <Button
                variant="danger-soft"
                size="sm"
                startContent={<XCircle size={16} aria-hidden="true" />}
                onPress={() => { setActionModal('reject'); setActionText(''); }}
              >
                {t('exchanges.reject')}
              </Button>
            </>
          )}
          {canReverse(exchange) && <ReverseExchangeButton exchange={exchange} onDone={reload} />}
          {backButton}
        </>
      }
    >
      {exchange.status === 'disputed' && disputeWindow && (
        <DisputeSettlePanel exchange={exchange} window={disputeWindow} onDone={reload} />
      )}
      {exchange.reversal_transaction_id ? <ReversedNotice /> : null}

      {/* Lifecycle pipeline + key facts */}
      <Card className={`${cardClass} mb-6`}>
        <CardHeader className="flex items-center gap-3 pb-0">
          <RouteIcon size={18} className="text-accent" aria-hidden="true" />
          <h3 className="font-semibold tracking-tight">{t('exchanges.detail_pipeline_title')}</h3>
          <div className="ml-auto">
            <BrokerStatusChip status={exchange.status} />
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <StatusPipeline status={exchange.status} />
          <Separator />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {exchange.final_hours !== undefined && exchange.final_hours !== null && (
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('exchanges.detail_hours_label')}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground">
                  <Hourglass size={14} className="text-muted" aria-hidden="true" />
                  {t('exchanges.detail_hours_value', { hours: exchange.final_hours })}
                </p>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted">{t('exchanges.detail_created_label')}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground">
                <Calendar size={14} className="text-muted" aria-hidden="true" />
                {formatServerDateTime(exchange.created_at)}
              </p>
            </div>
            {exchange.broker_approved_at && (
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('exchanges.detail_approved_label')}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground">
                  <CheckCircle size={14} className="text-success" aria-hidden="true" />
                  {formatServerDateTime(exchange.broker_approved_at)}
                </p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Parties */}
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <User size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('exchanges.detail_requester')}</h3>
          </CardHeader>
          <CardBody>
            <div className="flex items-start gap-4">
              <Avatar
                src={exchange.requester_avatar || undefined}
                name={exchange.requester_name}
                size="lg"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-foreground">{exchange.requester_name}</p>
                {exchange.requester_email && (
                  <p className="truncate text-sm text-muted">{exchange.requester_email}</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card className={cardClass}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <User size={18} className="text-success" aria-hidden="true" />
            <h3 className="font-semibold">{t('exchanges.detail_provider')}</h3>
          </CardHeader>
          <CardBody>
            <div className="flex items-start gap-4">
              <Avatar
                src={exchange.provider_avatar || undefined}
                name={exchange.provider_name}
                size="lg"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-foreground">{exchange.provider_name}</p>
                {exchange.provider_email && (
                  <p className="truncate text-sm text-muted">{exchange.provider_email}</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Risk Tag */}
      {risk_tag && (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <ShieldAlert
              size={18}
              className={riskIsSevere ? 'text-danger' : 'text-warning'}
              aria-hidden="true"
            />
            <h3 className="font-semibold">{t('exchanges.detail_risk_tag')}</h3>
            <div className="ml-auto">
              <BrokerStatusChip status={risk_tag.risk_level} />
            </div>
          </CardHeader>
          <CardBody>
            <p className="text-sm font-medium text-foreground">
              {t(`risk_tags.category_${risk_tag.risk_category}`, { defaultValue: risk_tag.risk_category })}
            </p>
            {risk_tag.risk_notes && (
              <p className="mt-2 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-foreground">
                {risk_tag.risk_notes}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {risk_tag.requires_approval && (
                <Chip size="sm" variant="soft" color="warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  <Chip.Label>{t('exchanges.detail_approval_required')}</Chip.Label>
                </Chip>
              )}
              {risk_tag.insurance_required && (
                <Chip size="sm" variant="soft" color="warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  <Chip.Label>{t('exchanges.detail_insurance_required')}</Chip.Label>
                </Chip>
              )}
              {risk_tag.dbs_required && (
                <Chip size="sm" variant="soft" color="danger">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  <Chip.Label>{t('exchanges.legacy_role_vetting_unavailable')}</Chip.Label>
                </Chip>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Broker Notes & Conditions */}
      {(exchange.broker_notes || exchange.broker_conditions) && (
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          {exchange.broker_notes && (
            <Card className={cardClass}>
              <CardHeader className="flex items-center gap-3 pb-0">
                <FileText size={18} className="text-muted" aria-hidden="true" />
                <h3 className="font-semibold">{t('exchanges.detail_broker_notes')}</h3>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-foreground">{exchange.broker_notes}</p>
              </CardBody>
            </Card>
          )}
          {exchange.broker_conditions && (
            <Card className={cardClass}>
              <CardHeader className="flex items-center gap-3 pb-0">
                <ClipboardList size={18} className="text-muted" aria-hidden="true" />
                <h3 className="font-semibold">{t('exchanges.detail_broker_conditions')}</h3>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-foreground">{exchange.broker_conditions}</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* History Timeline */}
      <Card className={cardClass}>
        <CardHeader className="flex items-center gap-3 pb-0">
          <Clock size={18} className="text-muted" aria-hidden="true" />
          <h3 className="font-semibold tracking-tight">{t('exchanges.detail_history')}</h3>
        </CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <BrokerEmptyState
              bare
              icon={Clock}
              color="neutral"
              title={t('exchanges.detail_no_history')}
            />
          ) : (
            <ol className="space-y-5">
              {history.map((entry, i) => (
                <li key={entry.id} className="flex gap-3">
                  <span className="flex flex-col items-center" aria-hidden="true">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent ring-4 ring-accent/15" />
                    {i < history.length - 1 && <span className="mt-1.5 w-px flex-1 bg-divider" />}
                  </span>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="text-sm font-medium text-foreground">
                      {t(`exchanges.detail_history_actions.${entry.action}`, { defaultValue: entry.action })}
                    </p>
                    {entry.actor_name && (
                      <p className="text-xs text-muted">{t('exchanges.detail_history_by', { name: entry.actor_name })}</p>
                    )}
                    {entry.notes && (
                      <p className="mt-1 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-foreground">
                        {entry.notes}
                      </p>
                    )}
                    <p className="mt-1 text-xs tabular-nums text-muted">{formatServerDateTime(entry.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {/* Approve/Reject Modal — mirrors the list page's action modal */}
      {actionModal && (
        <Modal isOpen={!!actionModal} onClose={() => { setActionModal(null); setActionText(''); }} size="md">
          <ModalContent>
            <ModalHeader className="flex items-center gap-2">
              {actionModal === 'approve' ? (
                <>
                  <CheckCircle size={20} className="text-success" aria-hidden="true" />
                  {t('exchanges.approve_modal_title')}
                </>
              ) : (
                <>
                  <XCircle size={20} className="text-danger" aria-hidden="true" />
                  {t('exchanges.reject_modal_title')}
                </>
              )}
            </ModalHeader>
            <ModalBody>
              <p className="text-foreground/70 mb-3">
                {actionModal === 'approve'
                  ? t('exchanges.approve_confirm_text')
                  : t('exchanges.reject_confirm_text')}
              </p>
              <Textarea
                label={actionModal === 'approve' ? t('exchanges.notes_optional_label') : t('exchanges.reason_required_label')}
                placeholder={actionModal === 'approve'
                  ? t('exchanges.approval_notes_placeholder')
                  : t('exchanges.rejection_reason_placeholder')}
                value={actionText}
                onValueChange={setActionText}
                minRows={3}
                variant="bordered"
                isRequired={actionModal === 'reject'}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={() => { setActionModal(null); setActionText(''); }} isDisabled={actionLoading}>
                {t('common.cancel')}
              </Button>
              <Button
                color={actionModal === 'approve' ? 'success' : 'danger'}
                onPress={handleAction}
                isLoading={actionLoading}
              >
                {actionModal === 'approve' ? t('exchanges.approve') : t('exchanges.reject')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </BrokerPageShell>
  );
}
