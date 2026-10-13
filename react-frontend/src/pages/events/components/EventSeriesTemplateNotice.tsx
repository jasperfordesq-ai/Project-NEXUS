// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shown on a recurring series' template pages (E-104, 13 Oct 2026).
 *
 * The template row is what the events list links to, but registration,
 * safety, tickets, check-in and calendar links exist only on each concrete
 * date, so those APIs refuse the template. Instead of rendering error states,
 * tell the person what the page is and send them to a date.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Repeat from 'lucide-react/icons/repeat';
import { Alert } from '@/components/ui/Alert';
import { getFormattingLocale } from '@/lib/helpers';
import type { Event } from '@/lib/events-api';

type RecurrenceOccurrence = NonNullable<Event['series']['recurrence']>['occurrences'][number];

interface EventSeriesTemplateNoticeProps {
  occurrences: RecurrenceOccurrence[];
  timezone: string;
  hrefFor: (occurrenceId: number) => string;
  /** `manage` wording names the organiser tools; `detail` names the member actions. */
  variant: 'detail' | 'manage';
  className?: string;
}

const MAX_DATES = 6;

export function EventSeriesTemplateNotice({
  occurrences,
  timezone,
  hrefFor,
  variant,
  className,
}: EventSeriesTemplateNoticeProps) {
  const { t } = useTranslation('events');
  const locale = getFormattingLocale();
  const dated = occurrences.filter((occ) => occ.start_at);
  const shown = dated.slice(0, MAX_DATES);
  const format = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(iso));
    } catch {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    }
  };

  return (
    <Alert
      color="primary"
      className={className}
      title={t(`series_template.${variant}_title`)}
      icon={<Repeat className="h-5 w-5" aria-hidden="true" />}
    >
      <p className="text-sm">{t(`series_template.${variant}_desc`)}</p>
      {shown.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('series_template.dates_label')}>
          {shown.map((occ) => (
            <li key={occ.id}>
              <Link
                to={hrefFor(occ.id)}
                className="inline-flex min-h-9 items-center rounded-lg border border-theme-default bg-theme-elevated px-3 text-sm font-medium text-theme-primary hover:bg-theme-muted"
              >
                {format(occ.start_at as string)}
              </Link>
            </li>
          ))}
          {dated.length > shown.length && (
            <li className="inline-flex min-h-9 items-center px-1 text-sm text-theme-muted">
              {t('series_template.more_dates', { count: dated.length - shown.length })}
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-theme-muted">{t('series_template.no_dates')}</p>
      )}
    </Alert>
  );
}
