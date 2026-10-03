// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerDateRangeFilter — a from/to date range for a broker list toolbar.
 *
 * Wraps the HeroUI DateRangePicker (composed per its v3 docs: DateField
 * inputs, a trigger, and a RangeCalendar in the popover) and speaks plain
 * `YYYY-MM-DD` strings outward, which is what the list endpoints' `from` /
 * `to` take. A clear button appears once a range is set.
 */

import { parseDate, toCalendarDate, type DateValue } from '@internationalized/date';
import X from 'lucide-react/icons/x';

import { Button, DateField, DateRangePicker, Label, RangeCalendar } from '@/components/ui';

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

interface BrokerDateRangeFilterProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Accessible label for the field and its calendar. */
  label: string;
  clearLabel: string;
  className?: string;
}

function toRange(value: DateRangeValue): { start: DateValue; end: DateValue } | null {
  if (!value.from || !value.to) return null;
  try {
    return { start: parseDate(value.from), end: parseDate(value.to) };
  } catch {
    return null;
  }
}

export function BrokerDateRangeFilter({ value, onChange, label, clearLabel, className = '' }: BrokerDateRangeFilterProps) {
  const range = toRange(value);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <DateRangePicker
        aria-label={label}
        value={range}
        onChange={(next) => {
          if (!next) {
            onChange({ from: null, to: null });
            return;
          }
          onChange({ from: toCalendarDate(next.start).toString(), to: toCalendarDate(next.end).toString() });
        }}
      >
        <Label className="sr-only">{label}</Label>
        <DateField.Group variant="secondary" className="min-w-0">
          <DateField.Input slot="start">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateRangePicker.RangeSeparator />
          <DateField.Input slot="end">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateField.Suffix>
            <DateRangePicker.Trigger>
              <DateRangePicker.TriggerIndicator />
            </DateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <DateRangePicker.Popover>
          <RangeCalendar aria-label={label}>
            <RangeCalendar.Header>
              <RangeCalendar.YearPickerTrigger>
                <RangeCalendar.YearPickerTriggerHeading />
                <RangeCalendar.YearPickerTriggerIndicator />
              </RangeCalendar.YearPickerTrigger>
              <RangeCalendar.NavButton slot="previous" />
              <RangeCalendar.NavButton slot="next" />
            </RangeCalendar.Header>
            <RangeCalendar.Grid>
              <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
              <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
            </RangeCalendar.Grid>
            <RangeCalendar.YearPickerGrid>
              <RangeCalendar.YearPickerGridBody>{({ year }) => <RangeCalendar.YearPickerCell year={year} />}</RangeCalendar.YearPickerGridBody>
            </RangeCalendar.YearPickerGrid>
          </RangeCalendar>
        </DateRangePicker.Popover>
      </DateRangePicker>
      {range && (
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={clearLabel}
          onPress={() => onChange({ from: null, to: null })}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export default BrokerDateRangeFilter;
