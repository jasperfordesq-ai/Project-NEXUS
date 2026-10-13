// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar as HeroCalendar } from '@heroui/react/calendar';
import { CalendarDate, parseDate, type DateValue } from '@internationalized/date';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { useTenant } from '@/contexts/TenantContext';
import {
  eventsApi,
  type EventCalendarProjection,
} from '@/lib/events-api';
import { formatDateValue, getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

export type EventCalendarView = 'month' | 'agenda';

const AGENDA_DAYS = 30;
const MAX_CALENDAR_RANGE_DAYS = 366;
/**
 * How far the month view's year picker reaches either side of today. HeroUI's
 * Calendar otherwise offers 1900–2099, which is noise for a community diary.
 * Forward matches how far ahead the create form lets an Event be scheduled.
 */
const MONTH_VIEW_YEARS_BACK = 5;
const MONTH_VIEW_YEARS_AHEAD = 5;

function todayValue(): CalendarDate {
  const now = new Date();
  return new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function validDate(value: string | null): CalendarDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

function validMonth(value: string | null): CalendarDate | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  return validDate(`${value}-01`);
}

export function normalizeAgendaRange(
  fromValue: string | null,
  toValue: string | null,
  fallback: CalendarDate = todayValue(),
): { from: CalendarDate; to: CalendarDate; normalized: boolean } {
  const parsedFrom = validDate(fromValue);
  const parsedTo = validDate(toValue);
  const from = parsedFrom ?? fallback;
  const invalid = parsedFrom === null
    || parsedTo === null
    || parsedTo.compare(from) <= 0
    || parsedTo.compare(from.add({ days: MAX_CALENDAR_RANGE_DAYS })) > 0;

  return invalid
    ? { from, to: from.add({ days: AGENDA_DAYS }), normalized: true }
    : { from, to: parsedTo, normalized: false };
}

function monthKey(value: DateValue): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`;
}

function eventDateKey(event: EventCalendarProjection): string {
  return event.starts_at.slice(0, 10);
}

export function eventLocalTimeLabel(
  event: EventCalendarProjection,
): string {
  const start = new Date(event.starts_at);
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };

  try {
    return start.toLocaleTimeString(getFormattingLocale(), {
      ...baseOptions,
      timeZone: event.timezone,
      timeZoneName: 'short',
    });
  } catch {
    // The API validates IANA zones, but a rolling deployment may briefly serve
    // a legacy value. Keep the calendar usable without misrepresenting it as a
    // named event-local time.
    return start.toLocaleTimeString(getFormattingLocale(), baseOptions);
  }
}

export function eventDateKeys(event: EventCalendarProjection): string[] {
  const start = validDate(eventDateKey(event));
  const rawEnd = validDate(event.ends_at.slice(0, 10));
  if (!start || !rawEnd || rawEnd.compare(start) <= 0) return [eventDateKey(event)];

  // Calendar end values are exclusive for all-day events. Timed events ending
  // exactly at midnight also belong to the preceding day only.
  const endIsExclusive = event.all_day || /T00:00(?::00)?(?:[Z+-]|$)/.test(event.ends_at);
  const last = endIsExclusive ? rawEnd.subtract({ days: 1 }) : rawEnd;
  const keys: string[] = [];
  let cursor = start;
  while (cursor.compare(last) <= 0 && keys.length < 366) {
    keys.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return keys;
}

function readableDate(value: CalendarDate): string {
  return formatDateValue(new Date(value.year, value.month - 1, value.day), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function EventRows({ events }: { events: EventCalendarProjection[] }) {
  const { t } = useTranslation('events');
  const { tenantPath } = useTenant();

  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-theme-default p-5 text-center text-sm text-theme-muted">
        {t('calendar.no_events_day')}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const time = event.all_day
          ? t('calendar.all_day')
          : eventLocalTimeLabel(event);
        return (
          <li key={event.uid}>
            <Link
              to={tenantPath(`/events/${event.id}`)}
              className="block rounded-lg border border-theme-default bg-theme-elevated p-3 transition-colors hover:border-accent/50 hover:bg-theme-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label={t('calendar.open_event_aria', { title: event.title, time })}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-theme-primary">{event.title}</p>
                  <p className="mt-1 text-sm text-theme-muted">{time}</p>
                </div>
                {event.calendar_status !== 'confirmed' && (
                  <Chip
                    size="sm"
                    variant="flat"
                    color={event.calendar_status === 'cancelled' ? 'danger' : 'warning'}
                  >
                    {t(`calendar.status_${event.calendar_status}`)}
                  </Chip>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function EventCalendarViews({ view }: { view: EventCalendarView }) {
  const { t } = useTranslation('events');
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMonth = validMonth(searchParams.get('month')) ?? todayValue().set({ day: 1 });
  const selectedDate = validDate(searchParams.get('date')) ?? currentMonth;
  const agendaRange = normalizeAgendaRange(searchParams.get('from'), searchParams.get('to'));
  const agendaFrom = agendaRange.from;
  const agendaTo = agendaRange.to;
  const currentMonthKey = currentMonth.toString();
  const agendaFromKey = agendaFrom.toString();
  const agendaToKey = agendaTo.toString();
  const [focusedDate, setFocusedDate] = useState<CalendarDate>(currentMonth);
  const [events, setEvents] = useState<EventCalendarProjection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (view === 'month') setFocusedDate(parseDate(currentMonthKey));
  }, [view, currentMonthKey]);

  const range = useMemo(() => {
    if (view === 'month') {
      return {
        from: currentMonthKey,
        to: parseDate(currentMonthKey).add({ months: 1 }).toString(),
      };
    }
    return { from: agendaFromKey, to: agendaToKey };
  }, [view, currentMonthKey, agendaFromKey, agendaToKey]);

  const load = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    setError(false);
    try {
      const response = await eventsApi.calendar(range.from, range.to, { signal });
      if (signal.aborted) return;
      if (!response.success || !response.data) {
        setError(true);
        return;
      }
      setEvents(response.data);
    } catch (loadError) {
      if (signal.aborted) return;
      logError('Failed to load privacy-safe event calendar', loadError);
      setError(true);
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (view !== 'agenda' || !agendaRange.normalized) return;
    updateParams({
      from: agendaFromKey,
      to: agendaToKey,
      month: null,
      date: null,
    });
  }, [
    view,
    agendaRange.normalized,
    agendaFromKey,
    agendaToKey,
    updateParams,
  ]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, EventCalendarProjection[]>();
    events.forEach((event) => {
      eventDateKeys(event).forEach((key) => {
        grouped.set(key, [...(grouped.get(key) ?? []), event]);
      });
    });
    return grouped;
  }, [events]);

  if (error && !isLoading) {
    return (
      <GlassCard role="alert" className="p-8 text-center">
        <p className="font-medium text-theme-primary">{t('calendar.load_error')}</p>
        <Button
          className="mt-4"
          startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          onPress={() => setReloadKey((key) => key + 1)}
        >
          {t('try_again')}
        </Button>
      </GlassCard>
    );
  }

  if (isLoading) {
    return (
      <div role="status" aria-label={t('calendar.loading')} className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (view === 'month') {
    const selectedEvents = eventsByDate.get(selectedDate.toString()) ?? [];
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(300px,420px)_1fr]">
        <GlassCard className="p-4 sm:p-5">
          <HeroCalendar
            aria-label={t('calendar.month_aria')}
            minValue={todayValue().subtract({ years: MONTH_VIEW_YEARS_BACK }).set({ month: 1, day: 1 })}
            maxValue={todayValue().add({ years: MONTH_VIEW_YEARS_AHEAD }).set({ month: 12, day: 31 })}
            value={selectedDate}
            focusedValue={focusedDate}
            onFocusChange={(date) => {
              setFocusedDate(date as CalendarDate);
              const nextMonth = monthKey(date);
              if (nextMonth !== monthKey(currentMonth)) {
                updateParams({ month: nextMonth, date: date.toString(), from: null, to: null });
              }
            }}
            onChange={(date) => updateParams({ date: date.toString() })}
            className="mx-auto w-full"
          >
            <HeroCalendar.Header>
              <HeroCalendar.YearPickerTrigger>
                <HeroCalendar.YearPickerTriggerHeading />
                <HeroCalendar.YearPickerTriggerIndicator />
              </HeroCalendar.YearPickerTrigger>
              <HeroCalendar.NavButton slot="previous" />
              <HeroCalendar.NavButton slot="next" />
            </HeroCalendar.Header>
            <HeroCalendar.Grid>
              <HeroCalendar.GridHeader>
                {(day) => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}
              </HeroCalendar.GridHeader>
              <HeroCalendar.GridBody>
                {(date) => (
                  <HeroCalendar.Cell date={date}>
                    {({ formattedDate }) => (
                      <>
                        {formattedDate}
                        {(eventsByDate.get(date.toString())?.length ?? 0) > 0 && (
                          <HeroCalendar.CellIndicator />
                        )}
                      </>
                    )}
                  </HeroCalendar.Cell>
                )}
              </HeroCalendar.GridBody>
            </HeroCalendar.Grid>
            <HeroCalendar.YearPickerGrid>
              <HeroCalendar.YearPickerGridBody>
                {({ year }) => <HeroCalendar.YearPickerCell year={year} />}
              </HeroCalendar.YearPickerGridBody>
            </HeroCalendar.YearPickerGrid>
          </HeroCalendar>
        </GlassCard>

        <GlassCard className="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-accent" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-theme-primary">{readableDate(selectedDate)}</h2>
          </div>
          <p className="sr-only" aria-live="polite">
            {t('calendar.selected_date_announcement', {
              date: readableDate(selectedDate),
              count: selectedEvents.length,
            })}
          </p>
          <EventRows events={selectedEvents} />
        </GlassCard>
      </div>
    );
  }

  const agendaDates = Array.from(eventsByDate.keys()).sort();
  const moveAgenda = (days: number) => {
    const nextFrom = agendaFrom.add({ days });
    const nextTo = nextFrom.add({ days: AGENDA_DAYS });
    updateParams({
      from: nextFrom.toString(),
      to: nextTo.toString(),
      month: null,
      date: null,
    });
  };
  const agendaEndLabel = agendaTo.subtract({ days: 1 });

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-theme-primary">{t('calendar.agenda_heading')}</h2>
          <p className="text-sm text-theme-muted">
            {t('calendar.agenda_range', {
              from: readableDate(agendaFrom),
              to: readableDate(agendaEndLabel),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="flat"
            startContent={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            onPress={() => moveAgenda(-AGENDA_DAYS)}
          >
            {t('calendar.previous_range')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            onPress={() => {
              const from = todayValue();
              updateParams({
                from: from.toString(),
                to: from.add({ days: AGENDA_DAYS }).toString(),
                month: null,
                date: null,
              });
            }}
          >
            {t('calendar.current_range')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            endContent={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
            onPress={() => moveAgenda(AGENDA_DAYS)}
          >
            {t('calendar.next_range')}
          </Button>
        </div>
      </GlassCard>

      {agendaDates.length === 0 ? (
        <GlassCard className="p-8 text-center text-theme-muted">{t('calendar.no_events_range')}</GlassCard>
      ) : (
        agendaDates.map((date) => {
          const value = validDate(date);
          if (!value) return null;
          return (
            <section key={date} aria-labelledby={`agenda-${date}`}>
              <h2 id={`agenda-${date}`} className="mb-2 text-sm font-semibold uppercase tracking-wide text-theme-muted">
                {readableDate(value)}
              </h2>
              <GlassCard className="p-3 sm:p-4">
                <EventRows events={eventsByDate.get(date) ?? []} />
              </GlassCard>
            </section>
          );
        })
      )}
    </div>
  );
}
