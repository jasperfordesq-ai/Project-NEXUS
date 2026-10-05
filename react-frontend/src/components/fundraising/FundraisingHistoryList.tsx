// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The permanent history of a fundraising campaign: every campaign change,
 * gift and hand-over, newest first. Used on the admin Fundraising campaigns
 * page (with Stripe references) and on the organisation dashboard (without).
 */

import { useTranslation } from 'react-i18next';
import History from 'lucide-react/icons/history';
import { formatCurrency, getFormattingLocale } from '@/lib/helpers';
import type { HistoryItem } from '@/lib/fundraisingTypes';

interface FundraisingHistoryListProps {
  items: HistoryItem[];
  /** Community admins see the Stripe object ids; organisations never receive them. */
  showStripe?: boolean;
}

function formatWhen(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function FundraisingHistoryList({ items, showStripe = false }: FundraisingHistoryListProps) {
  const { t } = useTranslation('fundraising');

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted">
        <History className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm">{t('history.empty')}</p>
      </div>
    );
  }

  const value = (v: string | number | null) => (v === null || v === '' ? t('history.empty_value') : String(v));

  return (
    <ol className="flex flex-col divide-y divide-[var(--border-default)]">
      {items.map((item) => {
        const who = item.actor_name
          ? t('history.by', { name: item.actor_name })
          : t(`history.actor.${item.actor_kind}`);
        const changes = Object.entries(item.details?.changes ?? {});

        return (
          <li key={item.id} className="flex flex-col gap-1 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">{t(`history.event.${item.event}`)}</span>
              <time dateTime={item.created_at} className="text-xs text-muted">{formatWhen(item.created_at)}</time>
            </div>
            <p className="text-sm text-muted">
              {[
                item.amount !== null && item.currency ? formatCurrency(item.amount, item.currency) : null,
                item.donation_id !== null ? t('history.gift_number', { number: item.donation_id }) : null,
                who,
              ].filter(Boolean).join(' · ')}
            </p>
            {changes.map(([field, change]) => (
              <p key={field} className="text-sm text-foreground">
                {t('history.change', {
                  field: t(`history.field.${field}`, { defaultValue: field }),
                  from: value(change.from),
                  to: value(change.to),
                })}
              </p>
            ))}
            {item.details?.reason && (
              <p className="text-sm text-foreground">{t('history.reason', { reason: item.details.reason })}</p>
            )}
            {showStripe && item.stripe_object_id && (
              <p className="break-all font-mono text-xs text-muted">{t('history.stripe_reference', { id: item.stripe_object_id })}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default FundraisingHistoryList;
