// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';
import { Progress } from '@/components/ui/Progress';
import type { EventBroadcast } from '@/lib/event-communications-api';
import { getFormattingLocale } from '@/lib/helpers';
import {
  broadcastExcerpt,
  describeBroadcast,
  FAILED_REASON_KEYS,
  groupReasons,
  SKIPPED_REASON_KEYS,
  timeZoneCity,
} from './broadcastPresentation';

export type CardAction = 'open' | 'discard' | 'change' | 'dont_send' | 'retry' | 'activity';

export interface CardError {
  message: string;
  drift?: boolean;
}

interface BroadcastCardProps {
  broadcast: EventBroadcast;
  now: number;
  eventTimezone: string;
  /** The action currently running for this card, if any. */
  busyAction: CardAction | null;
  /** True while ANY action on the page is running: one thing at a time. */
  isLocked: boolean;
  error: CardError | null;
  onAction: (action: CardAction, broadcast: EventBroadcast) => void;
  onDismissError: () => void;
}

export function BroadcastCard({
  broadcast,
  now,
  eventTimezone,
  busyAction,
  isLocked,
  error,
  onAction,
  onDismissError,
}: BroadcastCardProps) {
  const { t } = useTranslation('event_communications');
  const description = describeBroadcast(broadcast, now, eventTimezone, getFormattingLocale());
  const city = timeZoneCity(eventTimezone);
  const when = description.whenLabel
    ? t('when_with_zone', { when: description.whenLabel, city })
    : t('when_unknown');
  const people = t('people_count', { count: description.people });
  const excerpt = broadcastExcerpt(broadcast);
  const nameExcerpt = broadcastExcerpt(broadcast, 60) ?? t(`variants.${broadcast.variant}`);
  const headingId = `event-broadcast-${broadcast.id}-title`;
  const retryPeople = t('people_count', { count: Math.max(1, broadcast.delivery.dead_lettered) });

  const statusLine = (() => {
    switch (description.kind) {
      case 'draft':
        return t('status_line.draft', { people });
      case 'scheduled':
        return t('status_line.scheduled', { when, people });
      case 'due':
        return t('status_line.due');
      case 'sending': {
        // Every delivery is accounted for, so the numbers add up (E-106 browser check).
        const parts = [t('status_line.sending', { delivered: description.delivered, total: description.total })];
        if (description.skipped > 0) parts.push(t('status_line.partial_skipped', { n: description.skipped }));
        if (description.failed > 0) parts.push(t('status_line.partial_failed', { n: description.failed }));
        if (description.pending > 0) parts.push(t('status_line.sending_pending', { pending: description.pending }));
        return parts.join(' · ');
      }
      case 'sent':
        return t('status_line.sent', { people, when });
      case 'partial': {
        const parts = [t('status_line.partial', { when, delivered: description.delivered, total: description.total })];
        if (description.skipped > 0) parts.push(t('status_line.partial_skipped', { n: description.skipped }));
        if (description.failed > 0) parts.push(t('status_line.partial_failed', { n: description.failed }));
        return parts.join(' · ');
      }
      case 'failed':
        return t('status_line.failed', { when });
      case 'cancelled':
        return t('status_line.cancelled', { when });
      default:
        return '';
    }
  })();

  const lineClass = description.kind === 'failed'
    ? 'text-danger'
    : description.kind === 'cancelled'
      ? 'text-theme-subtle'
      : 'text-theme-primary';

  const skipped = groupReasons(broadcast.summary?.skipped_reasons, SKIPPED_REASON_KEYS);
  const failed = groupReasons(broadcast.summary?.failed_reasons, FAILED_REASON_KEYS);
  const showReasons = description.kind === 'partial' || (description.kind === 'failed' && (skipped.length > 0 || failed.length > 0));

  const button = (
    action: CardAction,
    label: string,
    ariaLabel: string,
    variant: 'primary' | 'secondary' | 'danger-soft' = 'secondary',
  ) => (
    <Button
      key={action}
      size="sm"
      variant={variant}
      aria-label={ariaLabel}
      isPending={busyAction === action}
      isDisabled={isLocked && busyAction !== action}
      onPress={() => onAction(action, broadcast)}
    >
      {label}
    </Button>
  );

  const { capabilities } = broadcast;
  const actions = [];
  if (broadcast.status === 'draft') {
    if (capabilities.edit) actions.push(button('open', t('actions.open'), t('aria.open', { excerpt: nameExcerpt }), 'primary'));
    if (capabilities.cancel) actions.push(button('discard', t('actions.discard'), t('aria.discard', { excerpt: nameExcerpt }), 'danger-soft'));
  } else if (broadcast.status === 'scheduled') {
    if (capabilities.cancel) {
      actions.push(button('change', t('actions.change'), t('aria.change', { excerpt: nameExcerpt }), 'primary'));
      actions.push(button('dont_send', t('actions.dont_send'), t('aria.dont_send', { excerpt: nameExcerpt }), 'danger-soft'));
    }
  } else if (capabilities.retry) {
    actions.push(button(
      'retry',
      t('actions.retry', { people: retryPeople }),
      t('aria.retry', { people: retryPeople, excerpt: nameExcerpt }),
      'primary',
    ));
  }
  actions.push(button('activity', t('actions.activity'), t('aria.activity', { excerpt: nameExcerpt })));

  return (
    <Card as="article" aria-labelledby={headingId} className="border border-theme-default">
      <CardHeader className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="font-semibold text-theme-primary">{t(`variants.${broadcast.variant}`)}</h3>
        <Chip color={description.tone} variant="flat" size="sm">{t(`chips.${description.kind}`)}</Chip>
      </CardHeader>
      <CardBody className="space-y-3">
        <blockquote className={`line-clamp-2 border-s-4 border-theme-default ps-3 text-sm ${excerpt ? 'text-theme-primary' : 'italic text-theme-subtle'}`}>
          {excerpt ?? t('no_text')}
        </blockquote>
        <p className={`text-sm ${lineClass}`} role={description.kind === 'due' ? 'status' : undefined}>
          {statusLine}
        </p>
        {description.kind === 'sending' && description.progress !== null && (
          <Progress aria-label={t('progress_label')} value={description.progress} size="sm" />
        )}
        {showReasons && (
          <Disclosure className="rounded-lg border border-theme-default">
            <DisclosureHeading>
              <DisclosureTrigger className="flex w-full items-center justify-between gap-2 p-3 text-start text-sm font-medium text-theme-primary">
                {t('reasons_toggle')}
                <DisclosureIndicator className="shrink-0" />
              </DisclosureTrigger>
            </DisclosureHeading>
            <DisclosureContent>
              <DisclosureBody className="space-y-3 border-t border-theme-default p-3 text-sm">
                {description.skipped > 0 && (
                  <div>
                    <p className="font-medium text-theme-primary">{t('reasons_skipped_title')}</p>
                    {skipped.length > 0 ? (
                      <ul className="mt-1 list-disc ps-5 text-theme-muted">
                        {skipped.map((reason) => (
                          <li key={reason.key}>
                            {t('reasons_line', { reason: t(`skipped_reasons.${reason.key}`), n: reason.count })}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-theme-muted">{t('reasons_none')}</p>}
                  </div>
                )}
                {description.failed > 0 && (
                  <div>
                    <p className="font-medium text-theme-primary">{t('reasons_failed_title')}</p>
                    {failed.length > 0 ? (
                      <ul className="mt-1 list-disc ps-5 text-theme-muted">
                        {failed.map((reason) => (
                          <li key={reason.key}>
                            {t('reasons_line', { reason: t(`failed_reasons.${reason.key}`), n: reason.count })}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-theme-muted">{t('reasons_none')}</p>}
                  </div>
                )}
              </DisclosureBody>
            </DisclosureContent>
          </Disclosure>
        )}
        {broadcast.status !== 'draft' && broadcast.status !== 'scheduled' && capabilities.retry && (
          <p className="text-sm text-theme-muted">{t('actions.retry_note')}</p>
        )}
        {error && (
          error.drift ? (
            <Alert
              color="danger"
              title={t('errors.drift_title')}
              description={t('errors.drift_description')}
              endContent={(
                <Button size="sm" variant="danger-soft" onPress={() => window.location.reload()}>
                  {t('errors.reload')}
                </Button>
              )}
            />
          ) : (
            <Alert
              color="danger"
              description={error.message}
              endContent={(
                <Button size="sm" variant="secondary" onPress={onDismissError}>{t('dismiss')}</Button>
              )}
            />
          )
        )}
      </CardBody>
      <CardFooter className="flex flex-wrap gap-2">{actions}</CardFooter>
    </Card>
  );
}
