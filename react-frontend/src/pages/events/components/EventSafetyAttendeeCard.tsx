// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Check from 'lucide-react/icons/check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Undo2 from 'lucide-react/icons/undo-2';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventSafetyApi,
  type EventSafety,
} from '@/lib/event-safety-api';
import { logError } from '@/lib/logger';

interface EventSafetyAttendeeCardProps {
  eventId: number;
  onChanged?: (safety: EventSafety) => void;
}

function idempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function EventSafetyAttendeeCard({ eventId, onChanged }: EventSafetyAttendeeCardProps) {
  const { t } = useTranslation('event_safety');
  const toast = useToast();
  const confirm = useConfirm();
  const [safety, setSafety] = useState<EventSafety | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [hasReadCode, setHasReadCode] = useState(false);

  const apply = useCallback((next: EventSafety) => {
    setSafety(next);
    setHasReadCode(false);
    onChanged?.(next);
  }, [onChanged]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventSafetyApi.get(eventId);
      if (response.success && response.data) {
        apply(response.data);
      } else {
        setLoadError(true);
      }
    } catch (caught) {
      logError('Failed to load attendee Event Safety projection', caught);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [apply, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async (action: string, request: () => Promise<{ success: boolean; data?: EventSafety }>): Promise<boolean> => {
    setPendingAction(action);
    try {
      const response = await request();
      if (response.success && response.data) {
        apply(response.data);
        toast.success(t(`safety.attendee.success.${action}`));
        return true;
      }
      toast.error(t('safety.attendee.action_error'));
      return false;
    } catch (caught) {
      logError('Attendee Event Safety mutation failed', { action, caught });
      toast.error(t('safety.attendee.action_error'));
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const acknowledgeCode = async () => {
    const code = safety?.requirements?.version.code_of_conduct;
    if (!code?.text_version || !code.text_hash || !hasReadCode) return;
    await complete('acknowledge', () => eventSafetyApi.acknowledgeCode(
      eventId,
      code.text_version as string,
      code.text_hash as string,
      idempotencyKey('event-safety-code'),
    ));
  };

  const withdrawCode = async () => {
    const acknowledgementId = safety?.evidence.code_of_conduct.acknowledgement_id;
    if (!acknowledgementId) return;
    const accepted = await confirm({
      title: t('safety.confirmations.withdraw_code_title'),
      body: t('safety.confirmations.withdraw_code_body'),
      confirmLabel: t('safety.actions.withdraw_acknowledgement'),
      cancelLabel: t('safety.actions.cancel'),
      status: 'danger',
    });
    if (!accepted) return;
    await complete('withdraw_code', () => eventSafetyApi.withdrawCode(
      eventId,
      acknowledgementId,
      idempotencyKey('event-safety-code-withdraw'),
    ));
  };

  if (isLoading) {
    return (
      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="flex min-h-32 items-center justify-center p-5">
          <Spinner label={t('safety.attendee.loading')} />
        </CardBody>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="border border-danger/30 bg-theme-surface">
        <CardBody className="space-y-4 p-5">
          <Alert
            color="danger"
            title={t('safety.attendee.load_error_title')}
            description={t('safety.attendee.load_error_description')}
          />
          <Button
            variant="flat"
            startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onPress={() => void load()}
          >
            {t('safety.actions.retry')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!safety || (safety.requirements === null && safety.rollout.mode === 'off')) {
    return null;
  }

  const code = safety.requirements?.version.code_of_conduct;
  const codeEvidence = safety.evidence.code_of_conduct;
  const isBlocked = safety.eligibility.status === 'deny' || safety.eligibility.status === 'unavailable';

  return (
    <Card className="border border-theme-default bg-theme-surface" data-testid="event-safety-attendee-card">
      <CardBody className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-theme-primary">
              <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
              {t('safety.attendee.title')}
            </h2>
            <p className="mt-1 text-sm text-theme-muted">{t('safety.attendee.description')}</p>
          </div>
          <Chip color={isBlocked ? 'warning' : 'success'} variant="flat">
            {t(`safety.eligibility.${safety.eligibility.status}`)}
          </Chip>
        </div>

        {safety.evidence.active_denial && (
          <Alert
            color="danger"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            title={t('safety.attendee.denial_title')}
            description={t(`safety.reasons.${safety.evidence.active_denial.reason_code}`)}
          />
        )}

        {safety.eligibility.reason_codes.length > 0 && safety.eligibility.status !== 'allow' && (
          <section aria-labelledby={`event-safety-${eventId}-status`} className="rounded-xl border border-warning/25 bg-warning/5 p-4">
            <h3 id={`event-safety-${eventId}-status`} className="font-semibold text-theme-primary">
              {t('safety.attendee.attention_title')}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-theme-muted">
              {safety.eligibility.reason_codes.map((reason) => (
                <li key={reason}>{t(`safety.reasons.${reason}`, { defaultValue: t('safety.reasons.unknown') })}</li>
              ))}
            </ul>
          </section>
        )}

        {code?.required && (
          <section aria-labelledby={`event-safety-${eventId}-code`} className="space-y-3 border-t border-theme-default pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`event-safety-${eventId}-code`} className="font-semibold text-theme-primary">
                {t('safety.code.title')}
              </h3>
              <Chip color={codeEvidence.status === 'acknowledged' ? 'success' : 'warning'} size="sm" variant="flat">
                {t(`safety.code.status.${codeEvidence.status}`)}
              </Chip>
            </div>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-theme-default bg-theme-elevated p-4 text-sm text-theme-primary">
              {code.text}
            </div>
            {safety.permissions.acknowledge_code_of_conduct && (
              <div className="space-y-3">
                <Checkbox isSelected={hasReadCode} onValueChange={setHasReadCode}>
                  {t('safety.code.confirm_read')}
                </Checkbox>
                <Button
                  color="primary"
                  isDisabled={!hasReadCode || pendingAction !== null}
                  isLoading={pendingAction === 'acknowledge'}
                  startContent={<Check className="h-4 w-4" aria-hidden="true" />}
                  onPress={() => void acknowledgeCode()}
                >
                  {t('safety.actions.acknowledge')}
                </Button>
              </div>
            )}
            {safety.permissions.withdraw_code_of_conduct && (
              <Button
                color="danger"
                variant="flat"
                isDisabled={pendingAction !== null}
                isLoading={pendingAction === 'withdraw_code'}
                startContent={<Undo2 className="h-4 w-4" aria-hidden="true" />}
                onPress={() => void withdrawCode()}
              >
                {t('safety.actions.withdraw_acknowledgement')}
              </Button>
            )}
          </section>
        )}
      </CardBody>
    </Card>
  );
}
