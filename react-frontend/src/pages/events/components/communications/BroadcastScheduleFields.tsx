// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { getLocalTimeZone, parseDate, parseTime, today } from '@internationalized/date';
import { DatePicker } from '@/components/ui/DatePicker';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { TimeInput } from '@/components/ui/TimeInput';
import { eventLocalInputToIso } from '@/lib/eventLocalDateTime';
import { formatWhen, timeZoneCity } from './broadcastPresentation';

export interface ScheduleFieldValues {
  when: 'now' | 'later';
  date: string | null;
  time: string | null;
}

export interface ScheduleFieldErrors {
  when?: string;
  date?: string;
  time?: string;
}

interface BroadcastScheduleFieldsProps {
  idPrefix: string;
  values: ScheduleFieldValues;
  errors: ScheduleFieldErrors;
  eventTimezone: string;
  isDisabled?: boolean;
  onChange: (next: Partial<ScheduleFieldValues>) => void;
}

function safeToday(timeZone: string) {
  try {
    return today(timeZone);
  } catch {
    return today(getLocalTimeZone());
  }
}

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function safeParse<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

export function BroadcastScheduleFields({
  idPrefix,
  values,
  errors,
  eventTimezone,
  isDisabled,
  onChange,
}: BroadcastScheduleFieldsProps) {
  const { t } = useTranslation('event_communications');
  const city = timeZoneCity(eventTimezone);
  const dateValue = values.date ? safeParse(() => parseDate(values.date as string)) : null;
  const timeValue = values.time ? safeParse(() => parseTime(values.time as string)) : null;

  const iso = values.date && values.time ? eventLocalInputToIso(`${values.date}T${values.time}`, eventTimezone) : null;
  const viewerZone = browserZone();
  const showViewerTime = iso !== null && viewerZone !== null && viewerZone !== eventTimezone;
  const viewerTime = showViewerTime ? formatWhen(iso, viewerZone) : null;

  return (
    <fieldset className="space-y-3" id={`${idPrefix}-when`}>
      <legend className="font-semibold text-theme-primary">{t('composer.when_legend')}</legend>
      <RadioGroup
        aria-label={t('composer.when_legend')}
        value={values.when}
        isDisabled={isDisabled}
        orientation="horizontal"
        onValueChange={(next) => {
          if (next === 'now' || next === 'later') onChange({ when: next });
        }}
      >
        <Radio value="now">{t('composer.when_now')}</Radio>
        <Radio value="later">{t('composer.when_later')}</Radio>
      </RadioGroup>
      {errors.when ? (
        <p className="text-sm text-danger" role="alert">{errors.when}</p>
      ) : null}
      {values.when === 'later' && (
        <div className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div id={`${idPrefix}-date`}>
              <DatePicker
                label={t('composer.date_label')}
                value={dateValue}
                minValue={safeToday(eventTimezone)}
                isRequired
                isDisabled={isDisabled}
                isInvalid={!!errors.date}
                errorMessage={errors.date}
                onChange={(next) => onChange({ date: next ? next.toString() : null })}
              />
            </div>
            <div id={`${idPrefix}-time`}>
              <TimeInput
                label={t('composer.time_label')}
                value={timeValue}
                isRequired
                isDisabled={isDisabled}
                isInvalid={!!errors.time}
                errorMessage={errors.time}
                onChange={(next) => onChange({
                  time: next ? `${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}` : null,
                })}
              />
            </div>
          </div>
          <p className="text-sm text-theme-muted">
            {t('composer.zone_hint', { city })}
            {viewerTime ? ` ${t('composer.browser_time_hint', { time: viewerTime })}` : ''}
          </p>
        </div>
      )}
    </fieldset>
  );
}
