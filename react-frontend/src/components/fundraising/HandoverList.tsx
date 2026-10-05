// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Money a community has passed on to the organisation a campaign raised it
 * for: raised / passed on / still held, then each hand-over with its status.
 * Community admins get a Cancel action, the organisation a Confirm action;
 * both only on hand-overs that are still waiting for confirmation.
 */

import { useTranslation } from 'react-i18next';
import { Button, Chip } from '@/components/ui';
import { formatCurrency, getFormattingLocale } from '@/lib/helpers';
import type { Handover, HandoverListData, HandoverStatus } from '@/lib/fundraisingTypes';

interface HandoverListProps {
  data: HandoverListData;
  onCancel?: (handover: Handover) => void;
  onConfirm?: (handover: Handover) => void;
  /** The hand-over whose action is in flight, so its button can show busy. */
  busyId?: number | null;
}

const STATUS_COLOR: Record<HandoverStatus, 'warning' | 'success' | 'default'> = {
  recorded: 'warning',
  confirmed: 'success',
  cancelled: 'default',
};

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium' }).format(date);
}

export function HandoverList({ data, onCancel, onConfirm, busyId = null }: HandoverListProps) {
  const { t } = useTranslation('fundraising');
  const { summary } = data;

  const figures = [
    { label: t('handovers.raised'), value: summary.raised },
    { label: t('handovers.handed_over'), value: summary.handed_over },
    { label: t('handovers.still_held'), value: summary.still_held },
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-lg bg-[var(--surface-elevated)] p-3">
            <dt className="text-xs text-muted">{figure.label}</dt>
            <dd className="text-base font-semibold text-foreground sm:text-lg">{formatCurrency(figure.value, summary.currency)}</dd>
          </div>
        ))}
      </dl>

      {data.items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('handovers.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-default)]">
          {data.items.map((handover) => {
            const open = handover.status === 'recorded';
            return (
              <li key={handover.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{formatCurrency(handover.amount, handover.currency)}</span>
                    <Chip size="sm" variant="soft" color={STATUS_COLOR[handover.status]}>
                      {t(`handovers.status.${handover.status}`)}
                    </Chip>
                  </div>
                  <p className="text-sm text-muted">
                    {[formatDay(handover.handed_over_on), t(`handovers.methods.${handover.method}`), handover.reference].join(' · ')}
                  </p>
                  {handover.note && <p className="text-sm text-foreground">{handover.note}</p>}
                  {handover.recorded_by_name && (
                    <p className="text-xs text-muted">{t('handovers.recorded_by', { name: handover.recorded_by_name })}</p>
                  )}
                  {handover.confirmed_by_name && (
                    <p className="text-xs text-muted">{t('handovers.confirmed_by', { name: handover.confirmed_by_name })}</p>
                  )}
                  {handover.cancelled_by_name && (
                    <p className="text-xs text-muted">{t('handovers.cancelled_by', { name: handover.cancelled_by_name })}</p>
                  )}
                  {handover.cancel_reason && (
                    <p className="text-sm text-foreground">{t('history.reason', { reason: handover.cancel_reason })}</p>
                  )}
                </div>
                {open && (onCancel || onConfirm) && (
                  <div className="flex shrink-0 gap-2">
                    {onConfirm && (
                      <Button size="sm" variant="primary" isDisabled={busyId === handover.id} onPress={() => onConfirm(handover)}>
                        {t('handovers.confirm_action')}
                      </Button>
                    )}
                    {onCancel && (
                      <Button size="sm" variant="tertiary" isDisabled={busyId === handover.id} onPress={() => onCancel(handover)}>
                        {t('handovers.cancel_action')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default HandoverList;
