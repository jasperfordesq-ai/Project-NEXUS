// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A member's own logged hours, entry by entry, and the shifts they hold
 * (gap C10, 7 Oct 2026). Until now the Hours tab showed only totals, so a member
 * could not see which entry was still waiting or what had been declined, nor a
 * list of their shifts. The API has served both lists all along
 * (GET /v2/volunteering/hours and /v2/volunteering/shifts) with no caller.
 *
 * Read-only by design: the API has no way for a member to change or withdraw a
 * logged entry (only the organisation reviews it), so this offers none.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Clock from 'lucide-react/icons/clock';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface Page<T> {
  items: T[];
  cursor: string | null;
  has_more: boolean;
}

interface HourEntry {
  id: number;
  date_logged: string | null;
  hours: number | string;
  description: string | null;
  status: 'pending' | 'approved' | 'declined';
  organization?: { id: number; name: string } | null;
  opportunity?: { id: number; title: string } | null;
}

interface HeldShift {
  id: number;
  start_time: string;
  end_time: string | null;
  opportunity_id: number;
  opportunity_title: string;
  location: string | null;
}

const STATUS_COLOR: Record<HourEntry['status'], 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
};

function emptyPage<T>(): Page<T> {
  return { items: [], cursor: null, has_more: false };
}

function usePagedList<T>(endpoint: string) {
  const [page, setPage] = useState<Page<T>>(emptyPage);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams({ per_page: '10' });
      if (cursor) query.set('cursor', cursor);
      const response = await api.get<Page<T>>(`${endpoint}?${query.toString()}`);
      if (response.success && response.data) {
        const data = response.data;
        setPage((previous) => ({
          items: cursor ? [...previous.items, ...(data.items ?? [])] : (data.items ?? []),
          cursor: data.cursor ?? null,
          has_more: Boolean(data.has_more),
        }));
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch (err) {
      logError(`Failed to load ${endpoint}`, err);
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load(null);
  }, [load]);

  return { page, isLoading, failed, loadMore: () => load(page.cursor) };
}

export function MyHoursAndShiftsLists({ showHours = true }: { showHours?: boolean }) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const hours = usePagedList<HourEntry>('/v2/volunteering/hours');
  const shifts = usePagedList<HeldShift>('/v2/volunteering/shifts');
  const locale = getFormattingLocale();
  // date_logged is a calendar date; format it in UTC so it never shifts a day.
  const day = (value: string | null) => (value
    ? new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '');
  const when = (value: string) => new Date(value).toLocaleString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      {showHours && (
      <GlassCard className="p-5" data-testid="my-hours-list">
        <h3 className="font-semibold text-theme-primary mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-rose-400" aria-hidden="true" />
          {t('hours_list_title')}
        </h3>
        {!hours.isLoading && hours.page.items.length === 0 && (
          <p className="text-sm text-theme-muted">{hours.failed ? t('something_wrong') : t('hours_list_empty')}</p>
        )}
        <ul className="divide-y divide-theme-default">
          {hours.page.items.map((entry) => (
            <li key={entry.id} className="py-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-primary">
                  {entry.opportunity?.title || entry.organization?.name}
                </p>
                <p className="text-xs text-theme-muted">
                  {[day(entry.date_logged), entry.opportunity?.title ? entry.organization?.name : null].filter(Boolean).join(' · ')}
                </p>
                {entry.description && <p className="text-xs text-theme-subtle mt-1">{entry.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-theme-primary">{t('hours_abbrev', { hours: Number(entry.hours) })}</span>
                <Chip size="sm" variant="soft" color={STATUS_COLOR[entry.status] ?? 'default'}>{t(`status_${entry.status}`)}</Chip>
              </div>
            </li>
          ))}
        </ul>
        {hours.page.has_more && (
          <Button size="sm" variant="secondary" className="mt-3" isLoading={hours.isLoading} onPress={hours.loadMore}>
            {t('load_more')}
          </Button>
        )}
      </GlassCard>
      )}

      <GlassCard className="p-5" data-testid="my-shifts-list">
        <h3 className="font-semibold text-theme-primary mb-4 flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-rose-400" aria-hidden="true" />
          {t('shifts_list_title')}
        </h3>
        {!shifts.isLoading && shifts.page.items.length === 0 && (
          <p className="text-sm text-theme-muted">{shifts.failed ? t('something_wrong') : t('shifts_list_empty')}</p>
        )}
        <ul className="divide-y divide-theme-default">
          {shifts.page.items.map((shift) => {
            const isPast = new Date(shift.end_time || shift.start_time).getTime() < Date.now();
            return (
              <li key={shift.id} className="py-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={tenantPath(`/volunteering/opportunities/${shift.opportunity_id}`)}
                    className="text-sm font-medium text-theme-primary hover:underline"
                  >
                    {shift.opportunity_title}
                  </Link>
                  <p className="text-xs text-theme-muted">
                    {[when(shift.start_time), shift.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Chip size="sm" variant="soft" color={isPast ? 'default' : 'success'}>
                  {isPast ? t('shift_past') : t('shift_upcoming')}
                </Chip>
              </li>
            );
          })}
        </ul>
        {shifts.page.has_more && (
          <Button size="sm" variant="secondary" className="mt-3" isLoading={shifts.isLoading} onPress={shifts.loadMore}>
            {t('load_more')}
          </Button>
        )}
      </GlassCard>
    </>
  );
}
