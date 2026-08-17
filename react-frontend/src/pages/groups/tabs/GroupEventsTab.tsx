// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
/**
 * Group Events Tab
 * Lists upcoming and past events for the group, with create-event shortcut for members.
 */

import { Link } from 'react-router-dom';import Calendar from 'lucide-react/icons/calendar';
import Plus from 'lucide-react/icons/plus';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import ChevronRight from 'lucide-react/icons/chevron-right';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { useTenant } from '@/contexts';
import { canCreateEvents } from '@/lib/access';
import { formatDateTime, formatMonthShort, getFormattingLocale } from '@/lib/helpers';
import type { Event } from '@/types/api';

interface GroupEventsTabProps {
  groupId: number;
  events: Event[];
  eventsLoading: boolean;
  eventsLoadingMore?: boolean;
  eventsHasMore?: boolean;
  isMember: boolean;
  onLoadMoreEvents?: () => void;
}

export type GroupEventTiming = 'upcoming' | 'ongoing' | 'past';

function parseEventDate(dateValue: string, timeValue?: string, endOfDay = false): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const time = timeValue || (endOfDay ? '23:59:59.999' : '00:00:00');
    return new Date(`${dateValue}T${time}`);
  }
  return new Date(dateValue);
}

export function classifyGroupEvent(event: Event, now = new Date()): GroupEventTiming {
  const start = parseEventDate(event.start_date, event.start_time);
  const end = event.end_date
    ? parseEventDate(event.end_date, event.end_time, true)
    : event.end_time
      ? parseEventDate(event.start_date.slice(0, 10), event.end_time, true)
      : null;

  if (end && start <= now && end >= now) return 'ongoing';
  if (end ? end < now : start < now) return 'past';
  return 'upcoming';
}

export function GroupEventsTab({
  groupId,
  events,
  eventsLoading,
  eventsLoadingMore = false,
  eventsHasMore = false,
  isMember,
  onLoadMoreEvents,
}: GroupEventsTabProps) {
  const { t } = useTranslation('groups');
  const { isAuthenticated, user } = useAuth();
  const { tenantPath } = useTenant();
  // Group membership is not enough: the community can restrict who creates Events.
  const mayCreateEvent = isMember && isAuthenticated && canCreateEvents(user);

  return (
    <GlassCard className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-theme-primary">{t('detail.group_events_heading')}</h2>
        {mayCreateEvent && (
          <Button as={Link} to={tenantPath(`/events/create?group_id=${groupId}`)}
            className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white sm:w-auto"
            size="sm"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          >
            {t('detail.create_event')}
          </Button>
        )}
      </div>

      {eventsLoading ? (
        <div role="status" aria-busy="true" aria-label={t('detail.events_loading')} className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-12 h-12" aria-hidden="true" />}
          title={t('detail.no_events_title')}
          description={t('detail.no_events_desc')}
          action={
            mayCreateEvent && (
              <Button as={Link} to={tenantPath(`/events/create?group_id=${groupId}`)}
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail.create_event')}
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const eventDate = parseEventDate(event.start_date, event.start_time);
            const timing = classifyGroupEvent(event);
            const isPast = timing === 'past';
            const monthLabel = formatMonthShort(eventDate, true);
            const timeLabel = formatDateTime(eventDate, { hour: '2-digit', minute: '2-digit' });

            return (
              <Link key={event.id} className="block min-w-0" to={tenantPath(`/events/${event.id}`)}>
                <div className={`flex min-w-0 items-center gap-3 rounded-lg bg-theme-elevated p-3 transition-colors hover:bg-theme-hover sm:gap-4 sm:p-4 ${isPast ? 'opacity-60' : ''}`}>
                  {/* Date Badge */}
                  <time dateTime={event.start_date} className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 text-center">
                    <span className="text-xs font-medium text-accent dark:text-accent uppercase">
                      {monthLabel}
                    </span>
                    <span className="text-lg font-bold text-theme-primary leading-none">
                      {eventDate.getDate()}
                    </span>
                  </time>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-theme-primary truncate">{event.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-subtle">
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {timeLabel}
                      </span>
                      {event.location && (
                        <span className="flex min-w-0 max-w-full items-center gap-1 truncate">
                          <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        {(event.attendees_count ?? 0).toLocaleString(getFormattingLocale())} {t('detail.attending')}
                      </span>
                    </div>
                  </div>

                  {isPast && (
                    <Chip size="sm" variant="flat" className="shrink-0 bg-theme-hover text-theme-subtle">
                      {t('detail.past_chip')}
                    </Chip>
                  )}
                  {timing === 'ongoing' && (
                    <Chip size="sm" variant="flat" className="shrink-0 bg-success-soft text-success">
                      {t('detail.ongoing_chip')}
                    </Chip>
                  )}

                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-theme-subtle rtl:rotate-180" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
          {eventsHasMore && onLoadMoreEvents && (
            <div className="flex justify-center pt-2">
              <Button
                variant="flat"
                className="min-h-11 w-full sm:w-auto"
                isDisabled={eventsLoadingMore}
                isLoading={eventsLoadingMore}
                onPress={onLoadMoreEvents}
              >
                {t('detail.events_load_more')}
              </Button>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
