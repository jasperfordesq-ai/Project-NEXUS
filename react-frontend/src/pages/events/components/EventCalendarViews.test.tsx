// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalendarDate } from '@internationalized/date';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventCalendarProjection } from '@/lib/events-api';
import {
  EventCalendarViews,
  eventDateKeys,
  eventLocalTimeLabel,
  normalizeAgendaRange,
} from './EventCalendarViews';

const { calendarMock, logErrorMock } = vi.hoisted(() => ({
  calendarMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('@/lib/events-api', () => ({
  eventsApi: { calendar: calendarMock },
}));

vi.mock('@/lib/logger', () => ({ logError: logErrorMock }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'calendar.selected_date_announcement') {
        return `selected ${String(values?.date)} count ${String(values?.count)}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/hour-timebank${path}`, hasFeature: vi.fn((_key: string) => true), hasModule: vi.fn((_key: string) => true) }),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onPress,
    startContent,
    endContent,
    isLoading,
    ...props
  }: {
    children?: ReactNode;
    onPress?: () => void;
    startContent?: ReactNode;
    endContent?: ReactNode;
    isLoading?: boolean;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) => (
    <button type="button" onClick={onPress} disabled={isLoading} {...props}>
      {startContent}{children}{endContent}
    </button>
  ),
}));

vi.mock('@/components/ui/Chip', () => ({
  Chip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock('@heroui/react/calendar', async () => {
  const ReactModule = await import('react');
  type ChildProps = { children?: ReactNode };
  type FocusedDate = {
    add: (duration: { months: number }) => FocusedDate;
    toString: () => string;
  };
  type CalendarProps = ChildProps & {
    focusedValue: FocusedDate;
    onFocusChange?: (date: FocusedDate) => void;
  };
  const container = ({ children }: ChildProps) => ReactModule.createElement('div', null, children);
  const empty = () => null;
  const CalendarRoot = ({ children, focusedValue, onFocusChange }: CalendarProps) => (
    ReactModule.createElement(
      'div',
      null,
      ReactModule.createElement('button', {
        type: 'button',
        'aria-label': 'mock next month',
        onClick: () => onFocusChange?.(focusedValue.add({ months: 1 })),
      }),
      children,
    )
  );

  return {
    Calendar: Object.assign(CalendarRoot, {
      Header: container,
      YearPickerTrigger: container,
      YearPickerTriggerHeading: empty,
      YearPickerTriggerIndicator: empty,
      NavButton: empty,
      Grid: container,
      GridHeader: empty,
      HeaderCell: empty,
      GridBody: empty,
      Cell: empty,
      CellIndicator: empty,
      YearPickerGrid: empty,
      YearPickerGridBody: empty,
      YearPickerCell: empty,
    }),
  };
});

const projection: EventCalendarProjection = {
  id: 17,
  uid: 'event-17@example.test',
  title: 'Cancelled community event',
  description: 'Open this event in Project NEXUS.',
  starts_at: '2026-02-01T09:00:00+00:00',
  ends_at: '2026-02-01T10:00:00+00:00',
  timezone: 'Europe/Dublin',
  all_day: false,
  operational_status: 'cancelled',
  calendar_status: 'cancelled',
  sequence: 3,
  updated_at: '2026-01-15T10:00:00+00:00',
  detail_url: 'https://app.example.test/hour-timebank/events/17',
};

function renderCalendar(view: 'month' | 'agenda', entry: string) {
  return render(
    <MemoryRouter
      initialEntries={[entry]}

    >
      <EventCalendarViews view={view} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

describe('eventDateKeys', () => {
  it('uses event-local ISO dates and exclusive all-day or midnight end boundaries', () => {
    expect(eventDateKeys({
      ...projection,
      starts_at: '2026-03-01T23:30:00-05:00',
      ends_at: '2026-03-04T00:00:00-05:00',
      all_day: true,
    })).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);

    expect(eventDateKeys({
      ...projection,
      starts_at: '2026-03-01T23:30:00-05:00',
      ends_at: '2026-03-02T00:00:00-05:00',
      all_day: false,
    })).toEqual(['2026-03-01']);
  });

  it('formats a timed event in the timezone that defines its calendar day', () => {
    const label = eventLocalTimeLabel({
      ...projection,
      starts_at: '2026-07-11T09:00:00+09:00',
      ends_at: '2026-07-11T10:00:00+09:00',
      timezone: 'Asia/Tokyo',
    });

    expect(label).toMatch(/^09:00/);
  });
});

describe('normalizeAgendaRange', () => {
  const fallback = new CalendarDate(2026, 2, 1);

  it.each([
    ['invalid', '2026-02-01', 'not-a-date'],
    ['reversed', '2026-02-01', '2026-01-31'],
    ['oversized', '2026-02-01', '2028-02-01'],
  ])('normalizes a %s pair to a safe 30-day half-open range', (_label, from, to) => {
    const normalized = normalizeAgendaRange(from, to, fallback);
    expect(normalized.from.toString()).toBe('2026-02-01');
    expect(normalized.to.toString()).toBe('2026-03-03');
    expect(normalized.normalized).toBe(true);
  });
});

describe('EventCalendarViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calendarMock.mockResolvedValue({ success: true, data: [projection] });
  });

  it('requests exact half-open month boundaries and announces non-colour status text', async () => {
    calendarMock.mockResolvedValue({
      success: true,
      data: [
        projection,
        {
          ...projection,
          id: 18,
          uid: 'event-18@example.test',
          title: 'Postponed community event',
          operational_status: 'postponed',
          calendar_status: 'tentative',
        },
      ],
    });
    const { container } = renderCalendar('month', '/events?month=2026-02&date=2026-02-01');

    await waitFor(() => expect(calendarMock).toHaveBeenCalledWith(
      '2026-02-01',
      '2026-03-01',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(await screen.findByText('Cancelled community event')).toBeInTheDocument();
    expect(screen.getByText('calendar.status_cancelled')).toBeInTheDocument();
    expect(screen.getByText('calendar.status_tentative')).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('count 2');

    fireEvent.click(screen.getByRole('button', { name: 'mock next month' }));
    await waitFor(() => expect(calendarMock).toHaveBeenCalledWith(
      '2026-03-01',
      '2026-04-01',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it('surfaces load failure and retries with the same bounded agenda interval', async () => {
    calendarMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ success: true, data: [] });

    renderCalendar('agenda', '/events?from=2026-02-01&to=2026-03-03');
    expect(await screen.findByRole('alert')).toHaveTextContent('calendar.load_error');
    fireEvent.click(screen.getByRole('button', { name: 'try_again' }));

    await waitFor(() => expect(calendarMock).toHaveBeenCalledTimes(2));
    expect(calendarMock).toHaveBeenLastCalledWith(
      '2026-02-01',
      '2026-03-03',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid', '/events?from=2026-02-01&to=not-a-date'],
    ['reversed', '/events?from=2026-02-01&to=2026-01-31'],
    ['oversized', '/events?from=2026-02-01&to=2028-02-01'],
  ])('canonicalizes %s agenda params before they can cause a 422', async (_label, entry) => {
    calendarMock.mockResolvedValue({ success: true, data: [] });
    renderCalendar('agenda', entry);

    await waitFor(() => expect(calendarMock).toHaveBeenCalledWith(
      '2026-02-01',
      '2026-03-03',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(
      '?from=2026-02-01&to=2026-03-03',
    ));
  });

  it('aborts the in-flight request on unmount so stale responses cannot update state', async () => {
    let resolveRequest: ((value: { success: boolean; data: EventCalendarProjection[] }) => void) | undefined;
    calendarMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const rendered = renderCalendar('agenda', '/events?from=2026-02-01&to=2026-03-03');
    await waitFor(() => expect(calendarMock).toHaveBeenCalledTimes(1));
    const signal = calendarMock.mock.calls[0][2].signal as AbortSignal;

    rendered.unmount();
    expect(signal.aborted).toBe(true);
    resolveRequest?.({ success: true, data: [projection] });
    await Promise.resolve();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('renders an explicit empty-range state and updates the URL when agenda navigation moves', async () => {
    calendarMock.mockResolvedValue({ success: true, data: [] });
    renderCalendar('agenda', '/events?from=2026-02-01&to=2026-03-03');

    expect(await screen.findByText('calendar.no_events_range')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'calendar.next_range' }));
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(
      '?from=2026-03-03&to=2026-04-02',
    ));
    await waitFor(() => expect(calendarMock).toHaveBeenCalledWith(
      '2026-03-03',
      '2026-04-02',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });
});
