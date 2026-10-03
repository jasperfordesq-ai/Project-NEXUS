// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ExchangeDateRangeFilter — "Created between" picker for the Exchanges list.
 *
 * Holds no state of its own: the page keeps `from` / `to` as Y-m-d strings
 * (mirrored to the URL and sent to the API), and this converts them to and
 * from the calendar values HeroUI's DateRangePicker works with. Composed per
 * the HeroUI v3 DateRangePicker docs (DateField + RangeCalendar), with the
 * project's own Clear button beside it.
 */

import { parseDate, type DateValue } from '@internationalized/date';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react/icons/x';
import { Button, DateField, DateRangePicker, Label, RangeCalendar } from '@/components/ui';

export interface ExchangeDateRangeFilterProps {
  /** Inclusive bounds as Y-m-d, or null when unset. */
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}

function toRange(from: string | null, to: string | null): { start: DateValue; end: DateValue } | null {
  if (!from || !to) return null;
  try {
    return { start: parseDate(from), end: parseDate(to) };
  } catch {
    return null;
  }
}

export function ExchangeDateRangeFilter({ from, to, onChange }: ExchangeDateRangeFilterProps) {
  const { t } = useTranslation('broker');
  const value = toRange(from, to);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <DateRangePicker
        className="w-full sm:w-auto"
        value={value}
        onChange={(next) => {
          if (next) onChange(next.start.toString(), next.end.toString());
          else onChange(null, null);
        }}
      >
        <Label>{t('exchanges.date_range_label')}</Label>
        <DateField.Group fullWidth variant="secondary">
          <DateField.Input slot="start">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
          <DateRangePicker.RangeSeparator />
          <DateField.Input slot="end">
            {(segment) => <DateField.Segment segment={segment} />}
          </DateField.Input>
          <DateField.Suffix>
            <DateRangePicker.Trigger>
              <DateRangePicker.TriggerIndicator />
            </DateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <DateRangePicker.Popover className="nexus-responsive-datepicker-popover">
          <RangeCalendar aria-label={t('exchanges.date_range_label')}>
            <RangeCalendar.Header>
              <RangeCalendar.YearPickerTrigger>
                <RangeCalendar.YearPickerTriggerHeading />
                <RangeCalendar.YearPickerTriggerIndicator />
              </RangeCalendar.YearPickerTrigger>
              <RangeCalendar.NavButton slot="previous" />
              <RangeCalendar.NavButton slot="next" />
            </RangeCalendar.Header>
            <RangeCalendar.Grid>
              <RangeCalendar.GridHeader>
                {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
              </RangeCalendar.GridHeader>
              <RangeCalendar.GridBody>
                {(date) => <RangeCalendar.Cell date={date} />}
              </RangeCalendar.GridBody>
            </RangeCalendar.Grid>
            <RangeCalendar.YearPickerGrid>
              <RangeCalendar.YearPickerGridBody>
                {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
              </RangeCalendar.YearPickerGridBody>
            </RangeCalendar.YearPickerGrid>
          </RangeCalendar>
        </DateRangePicker.Popover>
      </DateRangePicker>
      {value && (
        <Button
          size="sm"
          variant="tertiary"
          startContent={<X size={14} aria-hidden="true" />}
          onPress={() => onChange(null, null)}
        >
          {t('exchanges.date_range_clear')}
        </Button>
      )}
    </div>
  );
}

export default ExchangeDateRangeFilter;
