// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Activity Timeline
 * Admin CRM page listing what members and coordinators have done, newest
 * first and grouped by day: last visits, sign-ups, listings, exchanges,
 * notes, tasks, group joins and profile edits.
 *
 * The filters live in the address (/admin/crm/timeline?user_id=&type=&days=&page=)
 * so a reload, the back button or a link from a member's page lands on the
 * same view, and the same filters drive the CSV export.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';
import type { LucideIcon } from 'lucide-react';

import Activity from 'lucide-react/icons/activity';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Download from 'lucide-react/icons/download';
import FileText from 'lucide-react/icons/file-text';
import Filter from 'lucide-react/icons/filter';
import LogIn from 'lucide-react/icons/log-in';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import StickyNote from 'lucide-react/icons/sticky-note';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import User from 'lucide-react/icons/user';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';

import { getFormattingLocale } from '@/lib/helpers';
import {
  Card, CardBody, Button, Chip, Spinner, Select, SelectItem, Pagination,
  ToggleButtonGroup, ToggleButton,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import type { TimelineEntry } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

// ----- Activity types -----

const ACTIVITY_TYPES = [
  'login', 'signup', 'listing_created', 'exchange_completed',
  'note_added', 'task_created', 'profile_updated', 'group_joined',
] as const;
type ActivityType = typeof ACTIVITY_TYPES[number];
const isActivityType = (value: string): value is ActivityType =>
  (ACTIVITY_TYPES as readonly string[]).includes(value);

const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  login: LogIn,
  signup: UserPlus,
  listing_created: FileText,
  exchange_completed: ArrowRightLeft,
  note_added: StickyNote,
  task_created: ClipboardList,
  profile_updated: User,
  group_joined: Users,
};

// The tinted tile in front of each entry. Only the theme's soft tokens are
// used: numbered shades (bg-warning-50 …) do not exist in this theme.
const ACTIVITY_TILE_CLASSES: Record<ActivityType, string> = {
  login: 'bg-accent-soft text-accent',
  signup: 'bg-success-soft text-[color:var(--success-soft-foreground)]',
  listing_created: 'bg-warning-soft text-[color:var(--warning-soft-foreground)]',
  exchange_completed: 'bg-success-soft text-[color:var(--success-soft-foreground)]',
  note_added: 'bg-surface-secondary text-foreground',
  task_created: 'bg-surface-secondary text-foreground',
  profile_updated: 'bg-accent-soft text-accent',
  group_joined: 'bg-warning-soft text-[color:var(--warning-soft-foreground)]',
};
const DEFAULT_TILE_CLASSES = 'bg-surface-secondary text-foreground';

// ----- Date ranges -----

const DATE_RANGES = ['7', '30', '90', 'all'] as const;
type DateRange = typeof DATE_RANGES[number];
const DEFAULT_RANGE: DateRange = '30';
const isDateRange = (value: string): value is DateRange =>
  (DATE_RANGES as readonly string[]).includes(value);
const DATE_RANGE_LABEL_KEYS: Record<DateRange, string> = {
  '7': 'crm.date_range_7',
  '30': 'crm.date_range_30',
  '90': 'crm.date_range_90',
  all: 'crm.date_range_all',
};
// The server applies its own 30-day default when `days` is absent, so "all
// time" has to be sent explicitly as 0.
const daysParam = (range: DateRange): number => (range === 'all' ? 0 : Number(range));

const ITEMS_PER_PAGE = 25;

// ----- Formatting -----

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatTime = (date: Date) =>
  date.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });

const formatDateTime = (date: Date) =>
  date.toLocaleString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDayHeading = (date: Date, now: Date) =>
  date.toLocaleDateString(getFormattingLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });

interface DayGroup {
  key: string;
  label: string;
  dateTime: string;
  entries: TimelineEntry[];
}

export function ActivityTimeline() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_crm');
  const { t: tCommon } = useTranslation('common');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- The address is the source of truth -----
  const rawUserId = searchParams.get('user_id') || '';
  const filterUserId = /^\d+$/.test(rawUserId) ? rawUserId : '';
  const rawType = searchParams.get('type') || '';
  const filterType: ActivityType | '' = isActivityType(rawType) ? rawType : '';
  const rawRange = searchParams.get('days') || DEFAULT_RANGE;
  const range: DateRange = isDateRange(rawRange) ? rawRange : DEFAULT_RANGE;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Changing a filter always starts again from the first page.
  const setFilter = useCallback(
    (changes: Record<string, string | null>) => updateParams({ ...changes, page: null }),
    [updateParams],
  );

  const hasFilters = Boolean(filterUserId || filterType || range !== DEFAULT_RANGE);

  // ----- Data -----
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1, limit: ITEMS_PER_PAGE });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filterMember, setFilterMember] = useState<MemberSearchMember | null>(null);
  const [exporting, setExporting] = useState(false);

  const requestFilters = useMemo(() => ({
    user_id: filterUserId ? Number(filterUserId) : undefined,
    type: filterType || undefined,
    days: daysParam(range),
  }), [filterUserId, filterType, range]);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminCrm.getTimeline({ ...requestFilters, page, limit: ITEMS_PER_PAGE });
      if (res.success) {
        setEntries(Array.isArray(res.data) ? res.data : []);
        setMeta({
          total: res.meta?.total || 0,
          pages: res.meta?.total_pages || 1,
          limit: res.meta?.per_page || ITEMS_PER_PAGE,
        });
      } else {
        setEntries([]);
        setLoadError(true);
      }
    } catch {
      setEntries([]);
      setLoadError(true);
    }
    setLoading(false);
  }, [requestFilters, page]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  // ----- Filters -----

  const clearFilters = () => {
    setFilterMember(null);
    setFilter({ user_id: null, type: null, days: null });
  };

  const showOnlyMember = (entry: TimelineEntry) => {
    setFilterMember({
      id: entry.user_id,
      name: entry.user_name || t('crm.member_with_id', { id: entry.user_id }),
      email: '',
      avatar_url: entry.user_avatar,
    });
    setFilter({ user_id: String(entry.user_id) });
  };

  const rangeSelection = useMemo(() => new Set<Key>([range]), [range]);

  // ----- Export -----

  const handleExport = async () => {
    setExporting(true);
    try {
      await adminCrm.exportTimeline(requestFilters);
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(tCommon('errors.download_failed'));
    } finally {
      setExporting(false);
    }
  };

  // ----- Derived -----

  const memberName = (entry: TimelineEntry) =>
    entry.user_name || t('crm.member_with_id', { id: entry.user_id });

  const activityLabel = (type: string) =>
    t(`crm.activity_type_${type}`, { defaultValue: t('crm.activity_type_unknown') });

  const activityDescription = (entry: TimelineEntry): string => {
    const code = entry.description_code || entry.activity_type;
    const params: Record<string, string | number | null> = { ...(entry.description_params ?? {}) };
    const withFallback = (value: string | number | null | undefined, key: string) =>
      typeof value === 'string' && value.trim() !== '' ? value : t(key);

    if (code === 'listing_created') {
      params.title = withFallback(params.title, 'crm.activity_value_untitled_listing');
    } else if (code === 'exchange_completed') {
      params.member_name = withFallback(params.member_name, 'crm.activity_value_unknown_member');
    } else if (code === 'note_added') {
      params.author_name = withFallback(params.author_name, 'crm.activity_value_system');
      params.content = typeof params.content === 'string' ? params.content : '';
    } else if (code === 'task_created') {
      params.title = withFallback(params.title, 'crm.activity_value_untitled_task');
    } else if (code === 'group_joined') {
      params.group_name = withFallback(params.group_name, 'crm.activity_value_unknown_group');
    }

    return t(`crm.activity_description_${code}`, {
      ...params,
      defaultValue: t('crm.activity_description_unknown'),
    });
  };

  // Entries arrive newest first; they are shown under one heading per calendar
  // day (in the admin's own time zone) so the date is read once, not 25 times.
  const dayGroups = useMemo<DayGroup[]>(() => {
    const now = new Date();
    const todayKey = localDayKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDayKey(yesterday);

    const groups: DayGroup[] = [];
    for (const entry of entries) {
      const date = new Date(entry.created_at);
      const key = localDayKey(date);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        const label = key === todayKey
          ? t('crm.day_today')
          : key === yesterdayKey
            ? t('crm.day_yesterday')
            : formatDayHeading(date, now);
        group = { key, label, dateTime: key, entries: [] };
        groups.push(group);
      }
      group.entries.push(entry);
    }
    return groups;
  }, [entries, t]);

  const summaryText = (() => {
    if (meta.pages > 1) {
      const from = (page - 1) * meta.limit + 1;
      const to = Math.min(page * meta.limit, meta.total);
      // `total`, not `count`: a `count` option would make i18next look for plural forms.
      return t('crm.timeline_summary_range', { from, to, total: meta.total });
    }
    return hasFilters
      ? t('crm.timeline_summary_filtered', { count: meta.total })
      : t('crm.timeline_summary', { count: meta.total });
  })();

  // ----- Render -----

  const renderEmpty = () => {
    if (loadError) {
      return (
        <EmptyState
          icon={TriangleAlert}
          title={t('crm.timeline_load_failed')}
          description={t('crm.timeline_load_failed_hint')}
          actionLabel={t('common.retry')}
          onAction={() => { loadTimeline(); }}
        />
      );
    }
    if (hasFilters) {
      return (
        <EmptyState
          icon={Activity}
          title={t('crm.no_activity_found')}
          description={t('crm.no_activity_hint_filtered')}
          actionLabel={t('crm.clear_filters')}
          onAction={clearFilters}
        />
      );
    }
    // Nothing in the default window: the useful next step is a wider one.
    return (
      <EmptyState
        icon={Activity}
        title={t('crm.no_activity_found')}
        description={t('crm.no_activity_hint_default')}
        actionLabel={t('crm.show_all_time')}
        onAction={() => setFilter({ days: 'all' })}
      />
    );
  };

  const renderEntry = (entry: TimelineEntry, isLast: boolean) => {
    const type = entry.activity_type;
    const Icon = isActivityType(type) ? ACTIVITY_ICONS[type] : Activity;
    const tileClasses = isActivityType(type) ? ACTIVITY_TILE_CLASSES[type] : DEFAULT_TILE_CLASSES;
    const date = new Date(entry.created_at);
    const name = memberName(entry);
    const alreadyFiltered = filterUserId === String(entry.user_id);

    return (
      <li
        key={`${type}-${entry.id}`}
        className={`flex gap-3 px-4 py-3 sm:gap-4 ${isLast ? '' : 'border-b border-divider/60'}`}
      >
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tileClasses}`}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={tenantPath(`/admin/users/${entry.user_id}/edit`)}
              className="break-words font-semibold text-foreground transition-colors hover:text-accent [overflow-wrap:anywhere]"
            >
              {name}
            </Link>
            <Chip size="sm" variant="secondary">{activityLabel(type)}</Chip>
          </div>
          <p className="mt-0.5 break-words text-sm text-foreground/90 [overflow-wrap:anywhere]">
            {activityDescription(entry)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span>{t('crm.member_with_id', { id: entry.user_id })}</span>
            <span aria-hidden="true" className="sm:hidden">·</span>
            <time dateTime={entry.created_at} title={formatDateTime(date)} className="tabular-nums sm:hidden">
              {formatTime(date)}
            </time>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <time
            dateTime={entry.created_at}
            title={formatDateTime(date)}
            className="hidden text-sm tabular-nums text-muted sm:block"
          >
            {formatTime(date)}
          </time>
          {!alreadyFiltered && (
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              className="-me-2 shrink-0"
              onPress={() => showOnlyMember(entry)}
              aria-label={t('crm.only_this_member_aria', { name })}
            >
              <Filter size={14} />
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t('crm.activity_timeline_title')}
        description={t('crm.activity_timeline_desc')}
        icon={<Activity size={20} />}
        actions={
          <>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={handleExport}
              isLoading={exporting}
              isDisabled={exporting}
            >
              {t('crm.export_activity')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={() => { loadTimeline(); }}
              isDisabled={loading}
            >
              {t('crm.refresh')}
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <MemberSearchPicker
          label={t('crm.label_search_member')}
          placeholder={t('crm.placeholder_type_name_or_email')}
          noResultsText={t('crm.no_members_found')}
          clearText={t('crm.clear')}
          className="w-full sm:max-w-[280px]"
          size="sm"
          value={filterUserId}
          selectedMember={filterMember}
          onSelectedMemberChange={setFilterMember}
          onValueChange={(value) => setFilter({ user_id: value || null })}
        />

        <Select
          size="sm"
          label={t('crm.label_activity_type')}
          className="w-full sm:max-w-[220px]"
          selectedKeys={[filterType || 'all']}
          onChange={(e) => setFilter({ type: isActivityType(e.target.value) ? e.target.value : null })}
        >
          <SelectItem key="all" id="all">{t('crm.activity_type_all')}</SelectItem>
          {ACTIVITY_TYPES.map((type) => (
            <SelectItem key={type} id={type}>{t(`crm.activity_type_${type}`)}</SelectItem>
          ))}
        </Select>

        <ToggleButtonGroup
          aria-label={t('crm.label_date_range')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={rangeSelection}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            const next = key == null ? '' : String(key);
            setFilter({ days: isDateRange(next) && next !== DEFAULT_RANGE ? next : null });
          }}
          className="flex flex-wrap justify-start gap-2 sm:ms-auto"
        >
          {DATE_RANGES.map((value) => (
            <ToggleButton key={value} id={value}>{t(DATE_RANGE_LABEL_KEYS[value])}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {hasFilters && (
          <Button size="sm" variant="tertiary" onPress={clearFilters} className="self-start sm:self-end">
            {t('crm.clear_filters')}
          </Button>
        )}
      </div>

      {/* The spinner only replaces the list on the first load; a filter change
          or refresh keeps the entries in place (dimmed) instead of blanking
          the page. */}
      {loading && entries.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" label={t('crm.loading_activity')} />
        </div>
      ) : entries.length === 0 ? (
        renderEmpty()
      ) : (
        <div
          className={`flex flex-col gap-6 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
          aria-busy={loading || undefined}
        >
          <p className="-mb-3 text-sm text-muted" aria-live="polite">{summaryText}</p>

          {dayGroups.map((group) => (
            <section key={group.key} aria-labelledby={`timeline-day-${group.key}`}>
              <h2
                id={`timeline-day-${group.key}`}
                className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                <time dateTime={group.dateTime}>{group.label}</time>
              </h2>
              <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
                <CardBody className="p-0">
                  <ul>
                    {group.entries.map((entry, index) =>
                      renderEntry(entry, index === group.entries.length - 1))}
                  </ul>
                </CardBody>
              </Card>
            </section>
          ))}

          {meta.pages > 1 && (
            <div className="flex justify-center">
              <Pagination
                total={meta.pages}
                page={page}
                onChange={(next) => updateParams({ page: next > 1 ? String(next) : null })}
                showControls
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ActivityTimeline;
