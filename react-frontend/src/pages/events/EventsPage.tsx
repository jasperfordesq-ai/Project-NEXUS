// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { Progress } from '@/components/ui/Progress';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { EventFilterSheet, type EventFilterDraft } from '@/components/events/EventFilterSheet';
import { Label } from '@heroui/react/label';
import { ListBox } from '@heroui/react/list-box';
import { Select as HeroSelect } from '@heroui/react/select';
/**
 * Events Page - Community events listing with category filtering
 */

import { lazy, Suspense, useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Calendar from 'lucide-react/icons/calendar';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import Plus from 'lucide-react/icons/plus';
import Filter from 'lucide-react/icons/filter';
import CalendarDays from 'lucide-react/icons/calendar-days';
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Tag from 'lucide-react/icons/tag';
import Ban from 'lucide-react/icons/ban';
import PencilLine from 'lucide-react/icons/pencil-line';
import Hourglass from 'lucide-react/icons/hourglass';
import X from 'lucide-react/icons/x';
import Repeat from 'lucide-react/icons/repeat';
import List from 'lucide-react/icons/list';
import Rows3 from 'lucide-react/icons/rows-3';
import { useTranslation } from 'react-i18next';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { useAuth } from '@/contexts/AuthContext';
import { canCreateEvents } from '@/lib/access';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { eventsApi, type Event, type EventCategory } from '@/lib/events-api';
import { logError } from '@/lib/logger';
import { formatDateTime, formatDateValue, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { PageMeta } from '@/components/seo/PageMeta';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';
import {
  EventCalendarViews,
  type EventCalendarView,
} from './components/EventCalendarViews';
import { CalendarSubscriptionPanel } from './components/CalendarSubscriptionPanel';

const LazyProximityFilter = lazy(() =>
  import('@/components/proximity/ProximityFilter').then((module) => ({
    default: module.ProximityFilter,
  })),
);

type EventFilter = 'upcoming' | 'past' | 'all';
type StepFreeFilter = 'any' | 'yes' | 'no' | 'unknown';
type EventsView = 'list' | EventCalendarView;

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const STEP_FREE_FILTERS: readonly StepFreeFilter[] = ['any', 'yes', 'no', 'unknown'];

function stepFreeFilterFrom(value: string | null): StepFreeFilter {
  return STEP_FREE_FILTERS.includes(value as StepFreeFilter) ? value as StepFreeFilter : 'any';
}

/**
 * What "Clear all" resets inside the phone filter sheet. Events has no sort
 * control, so every dimension resets. `useFilterDraft` merges this over the open
 * draft.
 */
const EMPTY_EVENT_FILTER_DRAFT: Partial<EventFilterDraft> = {
  when: 'upcoming',
  category: 'all',
  stepFree: 'any',
  proximity: null,
};

interface EventQueryInput {
  q: string;
  when: EventFilter;
  category: string;
  stepFree: StepFreeFilter;
  proximity: ProximityFilterParams | null;
  cursor?: string | null;
}

/**
 * Single source of truth for filter → API params. The list fetch is the only
 * consumer: `GET /v2/events` answers through `respondWithCollection`, whose meta
 * carries no `total_items`, so there is deliberately no live-count probe that
 * could drift away from this (see EventFilterSheet).
 */
function buildEventQueryParams(f: EventQueryInput): Record<string, string | number | undefined> {
  return {
    q: f.q || undefined,
    when: f.when === 'all' ? undefined : f.when,
    per_page: ITEMS_PER_PAGE,
    cursor: f.cursor ?? undefined,
    category_id: f.category === 'all' ? undefined : f.category,
    step_free: f.stepFree === 'any' ? undefined : f.stepFree,
    near_lat: f.proximity?.near_lat,
    near_lng: f.proximity?.near_lng,
    radius_km: f.proximity?.radius_km,
  };
}

function localDateKey(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

/**
 * Phone view-mode toggle button (list / month / agenda). Icon-only and 40px tall
 * so the segmented cluster fits the sticky bar's `trailing` slot alongside the
 * search pill and the Filters button — same anatomy ListingsPage ships.
 */
const PHONE_VIEW_TOGGLE_CLASS =
  'h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-amber-500/15 data-[selected=true]:text-amber-600 dark:data-[selected=true]:text-amber-300';

/** Event category metadata — names resolved via t() inside the component */
const CATEGORY_ICONS: Record<string, typeof Tag> = {
  social: Users,
  outdoor: MapPin,
  online: CalendarDays,
  meeting: Calendar,
  training: Clock,
};

export function EventsPage() {
  const { t } = useTranslation(['events', 'event_accessibility']);
  usePageTitle(t('title'));
  // On phones the page hides its own hero; the title lives in the app bar.
  useSetAppBarTitle(t('title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { isAuthenticated, user } = useAuth();
  // A community can restrict Event creation to brokers/admins. Offering Create to
  // someone who cannot use it wastes a whole form before the server refuses.
  const mayCreateEvent = isAuthenticated && canCreateEvents(user);
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const activeView: EventsView = requestedView === 'month' || requestedView === 'agenda'
    ? requestedView
    : 'list';

  const [events, setEvents] = useState<Event[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [, setNextCursor] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [filter, setFilter] = useState<EventFilter>('upcoming');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all');
  const [stepFreeFilter, setStepFreeFilter] = useState<StepFreeFilter>(() => stepFreeFilterFrom(searchParams.get('step_free')));
  const [proximityParams, setProximityParams] = useState<ProximityFilterParams | null>(null);
  // Native-app search: phones open a full-screen overlay with recents instead of
  // typing into the inline filter field. Desktop keeps the inline SearchField.
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count += 1;
    if (filter !== 'upcoming') count += 1;
    if (selectedCategory !== 'all') count += 1;
    if (stepFreeFilter !== 'any') count += 1;
    if (proximityParams) count += 1;
    return count;
  }, [searchQuery, filter, selectedCategory, stepFreeFilter, proximityParams]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilter('upcoming');
    setSelectedCategory('all');
    setStepFreeFilter('any');
    setProximityParams(null);
  }, []);

  // ── Phone filter sheet (draft state — nothing applies until the footer button) ──
  // The draft machine (snapshot / patch / apply / clear) lives in useFilterDraft.
  // No `countFor`: /v2/events answers through respondWithCollection, whose meta has
  // no total_items, so there is nothing to probe and the footer reads "Show results".
  const commitDraftFilters = useCallback((next: EventFilterDraft) => {
    setFilter(next.when);
    setSelectedCategory(next.category);
    setStepFreeFilter(next.stepFree);
    setProximityParams(next.proximity);
  }, []);

  const filterSheet = useFilterDraft<EventFilterDraft>({
    onApply: commitDraftFilters,
    emptyDraft: EMPTY_EVENT_FILTER_DRAFT,
  });
  const { open: openDraft } = filterSheet;

  const openFilterSheet = useCallback(() => {
    openDraft({
      when: filter,
      category: selectedCategory,
      stepFree: stepFreeFilter,
      proximity: proximityParams,
    });
  }, [openDraft, filter, selectedCategory, stepFreeFilter, proximityParams]);

  // Phone: removable chips for every applied filter. Search is represented by the
  // search pill instead, so it deliberately has no chip (and the Filters badge,
  // which defaults to chips.length, therefore excludes it).
  const phoneFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (filter !== 'upcoming') {
      chips.push({ key: 'when', label: t(`filter_${filter}`), onRemove: () => setFilter('upcoming') });
    }
    if (selectedCategory !== 'all') {
      const cat = categories.find((c) => String(c.id) === selectedCategory);
      chips.push({
        key: 'category',
        label: cat?.name ?? selectedCategory,
        onRemove: () => setSelectedCategory('all'),
      });
    }
    if (stepFreeFilter !== 'any') {
      chips.push({
        key: 'step_free',
        label: t(`event_accessibility:filters.step_free_options.${stepFreeFilter}`),
        onRemove: () => setStepFreeFilter('any'),
      });
    }
    if (proximityParams) {
      chips.push({
        key: 'near',
        label: t(`radius_${proximityParams.radius_km}`, { defaultValue: `${proximityParams.radius_km} km` }),
        onRemove: () => setProximityParams(null),
      });
    }
    return chips;
  }, [filter, selectedCategory, stepFreeFilter, proximityParams, categories, t]);

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    eventsApi.categories({ signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted && response.success && response.data) {
        setCategories(response.data);
      }
    }).catch((err) => {
      if (!controller.signal.aborted) logError('Failed to load event categories', err);
    });
    return () => controller.abort();
  }, []);

  // Debounce search query
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const loadEvents = useCallback(async (append = false): Promise<void> => {
    // Abort any in-flight request (initial OR append) to prevent race conditions —
    // a stale append finishing after a filter change must not concatenate
    // old-filter events into the new list
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (controller.signal.aborted) return;
      if (!append) {
        setIsLoading(true);
        setError(null);
        setTotalCount(null);
      } else {
        setIsLoadingMore(true);
      }

      const response = await eventsApi.list(buildEventQueryParams({
        q: debouncedQuery,
        when: filter,
        category: selectedCategory,
        stepFree: stepFreeFilter,
        proximity: proximityParams,
        cursor: append ? nextCursorRef.current : undefined,
      }), { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        if (controller.signal.aborted) return;
        if (append) {
          setEvents((prev) => [...prev, ...response.data!]);
        } else {
          setEvents(response.data);
        }
        if (controller.signal.aborted) return;
        const cursor = response.meta?.cursor ?? null;
        nextCursorRef.current = cursor;
        setNextCursor(cursor);
        setHasMore(response.meta?.has_more ?? (response.data?.length ?? 0) >= ITEMS_PER_PAGE);
        if (response.meta?.total_items !== undefined) {
          setTotalCount(response.meta.total_items);
        }
      } else {
        if (controller.signal.aborted) return;
        if (!append) {
          setError(tRef.current('unable_to_load'));
        } else {
          toastRef.current.error(response.error || tRef.current('error_load_more'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load events', err);
      if (!append) {
        setError(tRef.current('unable_to_load'));
      } else {
        toastRef.current.error(tRef.current('error_load_more'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery, filter, selectedCategory, stepFreeFilter, proximityParams]);

  const loadEventsRef = useRef(loadEvents);
  loadEventsRef.current = loadEvents;

  useEffect(() => {
    if (activeView !== 'list') {
      abortControllerRef.current?.abort();
      setIsLoading(false);
      return;
    }
    nextCursorRef.current = null;
    setNextCursor(null);
    setHasMore(true);
    loadEventsRef.current(false);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [activeView, debouncedQuery, filter, selectedCategory, stepFreeFilter, proximityParams]);

  // Update URL params
  useEffect(() => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (searchQuery) params.set('q', searchQuery);
      else params.delete('q');
      if (selectedCategory && selectedCategory !== 'all') params.set('category', selectedCategory);
      else params.delete('category');
      if (stepFreeFilter !== 'any') params.set('step_free', stepFreeFilter);
      else params.delete('step_free');
      return params;
    }, { replace: true });
  }, [searchQuery, selectedCategory, stepFreeFilter, setSearchParams]);

  const changeView = useCallback((view: EventsView) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', view);
      const today = localDateKey();
      if (view === 'month') {
        next.set('month', today.slice(0, 7));
        next.set('date', today);
        next.delete('from');
        next.delete('to');
      } else if (view === 'agenda') {
        const end = new Date();
        end.setDate(end.getDate() + 30);
        next.set('from', today);
        next.set('to', localDateKey(end));
        next.delete('month');
        next.delete('date');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const loadMoreEvents = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadEvents(true);
  }, [isLoadingMore, hasMore, loadEvents]);

  // Group events by month
  const groupedEvents = events.reduce((groups, event) => {
    const date = new Date(event.schedule.start_at ?? event.created_at ?? 0);
    let timeZone = event.schedule.timezone || 'UTC';
    try {
      new Intl.DateTimeFormat(getFormattingLocale(), { timeZone }).format(date);
    } catch {
      timeZone = 'UTC';
    }
    const key = formatDateValue(date, { month: 'long', year: 'numeric', timeZone });
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {} as Record<string, Event[]>);

  /**
   * Phone view switcher — the same three views and the same `changeView()` state
   * plumbing as the desktop card, rendered icon-only. It lives in the sticky
   * bar's `trailing` slot in list view, and in a compact row of its own in
   * month/agenda view (where a search pill and a Filters button would be dead:
   * EventCalendarViews reads only month/date/from/to and ignores q, when,
   * category, step_free and proximity entirely).
   */
  const phoneViewToggle = isPhone ? (
    <ToggleButtonGroup
      aria-label={t('calendar.view_aria')}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([activeView])}
      onSelectionChange={(keys) => {
        const [next] = Array.from(keys);
        if (next === 'list' || next === 'month' || next === 'agenda') changeView(next);
      }}
      className="shrink-0 gap-0 overflow-hidden rounded-full border border-theme-default bg-theme-elevated"
    >
      <ToggleButton id="list" isIconOnly variant="ghost" aria-label={t('calendar.view_list')} className={PHONE_VIEW_TOGGLE_CLASS}>
        <List className="h-4 w-4" aria-hidden="true" />
      </ToggleButton>
      <ToggleButton id="month" isIconOnly variant="ghost" aria-label={t('calendar.view_month')} className={PHONE_VIEW_TOGGLE_CLASS}>
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </ToggleButton>
      <ToggleButton id="agenda" isIconOnly variant="ghost" aria-label={t('calendar.view_agenda')} className={PHONE_VIEW_TOGGLE_CLASS}>
        <Rows3 className="h-4 w-4" aria-hidden="true" />
      </ToggleButton>
    </ToggleButtonGroup>
  ) : null;

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_title')} description={t('page_description')} />
      {/* The hero owns this page's only <h1> and is hidden on phones, where the
          title moves into the app bar as plain text — leaving a phone with no
          heading to orient by. Keep one for screen readers. Mirrors BlogPage. */}
      {isPhone && <h1 className="sr-only">{t('title')}</h1>}
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <PublicPageHero
        eyebrow={t('subtitle')}
        title={t('title')}
        description={t('page_description')}
        accent="amber"
        icon={<CalendarDays className="h-7 w-7" aria-hidden="true" />}
        stats={totalCount != null && !isLoading ? [{ label: t('hero_events_label'), value: totalCount.toLocaleString(getFormattingLocale()) }] : undefined}
        action={
          isAuthenticated ? (
            <div className="flex flex-wrap gap-2">
              {/* Calendar feeds stay for every signed-in member — only creating is gated. */}
              <CalendarSubscriptionPanel />
              {mayCreateEvent && (
                <Button as={Link} to={tenantPath('/events/create')}
                  color="primary"
                  className="font-semibold"
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('create_event')}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      )}

      {/* Phone: slim sticky control bar (list view only — see phoneViewToggle). */}
      {isPhone && activeView === 'list' && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="amber"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchQuery}
          onFiltersPress={openFilterSheet}
          chips={phoneFilterChips}
          onClearAll={clearFilters}
          labels={{ search: t('search_aria') }}
          trailing={phoneViewToggle}
        />
      )}

      {/* Phone, month/agenda: the calendar owns the surface, so only the view switcher. */}
      {isPhone && activeView !== 'list' && (
        <div className="flex justify-end px-1">{phoneViewToggle}</div>
      )}

      {/* Phone: the hidden hero was the ONLY entry point to calendar feeds and Create
          Event, so both are re-homed here rather than lost. */}
      {isPhone && isAuthenticated && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <CalendarSubscriptionPanel />
          {mayCreateEvent && (
            <Button as={Link} to={tenantPath('/events/create')}
              color="primary"
              className="font-semibold"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('create_event')}
            </Button>
          )}
        </div>
      )}

      {!isPhone && (
      <GlassCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-theme-primary">{t('calendar.view_heading')}</h2>
          <p className="text-sm text-theme-muted">{t('calendar.view_description')}</p>
        </div>
        <ToggleButtonGroup
          aria-label={t('calendar.view_aria')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          selectedKeys={new Set([activeView])}
          onSelectionChange={(keys) => {
            const [next] = Array.from(keys);
            if (next === 'list' || next === 'month' || next === 'agenda') changeView(next);
          }}
          className="flex flex-wrap gap-2"
        >
          <ToggleButton id="list" variant="ghost">
            <List className="h-4 w-4" aria-hidden="true" />
            {t('calendar.view_list')}
          </ToggleButton>
          <ToggleButton id="month" variant="ghost">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t('calendar.view_month')}
          </ToggleButton>
          <ToggleButton id="agenda" variant="ghost">
            <Rows3 className="h-4 w-4" aria-hidden="true" />
            {t('calendar.view_agenda')}
          </ToggleButton>
        </ToggleButtonGroup>
      </GlassCard>
      )}

      {/* Search & Time Filter (desktop and tablet — phones use the sticky bar + sheet) */}
      {activeView === 'list' && !isPhone && <>
      <GlassCard className="p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto_auto] lg:items-center">
          <div className="flex-1">
            <SearchField
              placeholder={t('search_placeholder')}
              aria-label={t('search_aria')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </div>

          <Select
            placeholder={t('filter_placeholder')}
            aria-label={t('filter_aria')}
            selectedKeys={[filter]}
            disallowEmptySelection
            onChange={(e) => setFilter(e.target.value as EventFilter)}
            className="w-full lg:w-40"
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
            startContent={<Filter className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
          >
            <SelectItem key="upcoming" id="upcoming">{t('filter_upcoming')}</SelectItem>
            <SelectItem key="past" id="past">{t('filter_past')}</SelectItem>
            <SelectItem key="all" id="all">{t('filter_all')}</SelectItem>
          </Select>

          <HeroSelect
            aria-label={t('event_accessibility:filters.step_free_label')}
            value={stepFreeFilter}
            onChange={(value) => {
              const selected = Array.isArray(value) ? value[0] : value;
              const next = selected === null || selected === undefined ? 'any' : String(selected);
              setStepFreeFilter(stepFreeFilterFrom(next));
            }}
            placeholder={t('event_accessibility:filters.step_free_options.any')}
            variant="secondary"
            className="w-full lg:w-56"
          >
            <Label className="sr-only">{t('event_accessibility:filters.step_free_label')}</Label>
            <HeroSelect.Trigger className="border border-theme-default bg-theme-elevated text-theme-primary hover:bg-theme-hover">
              <HeroSelect.Value />
              <HeroSelect.Indicator />
            </HeroSelect.Trigger>
            <HeroSelect.Popover>
              <ListBox>
                {STEP_FREE_FILTERS.map((option) => (
                  <ListBox.Item
                    key={option}
                    id={option}
                    textValue={t(`event_accessibility:filters.step_free_options.${option}`)}
                  >
                    {t(`event_accessibility:filters.step_free_options.${option}`)}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </HeroSelect.Popover>
          </HeroSelect>

          <Suspense fallback={null}>
            <LazyProximityFilter value={proximityParams} onFilter={setProximityParams} />
          </Suspense>

        </div>

        {activeFilterCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-theme-default pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-theme-muted">
              <span className="font-medium text-theme-secondary">{t('active_filters')}</span>
              {searchQuery.trim() && <Chip size="sm" variant="flat">{t('active_search', { query: searchQuery.trim() })}</Chip>}
              {filter !== 'upcoming' && <Chip size="sm" variant="flat">{t(`filter_${filter}`)}</Chip>}
              {selectedCategory !== 'all' && (
                <Chip size="sm" variant="flat">
                  {categories.find((cat) => String(cat.id) === selectedCategory)?.name ?? selectedCategory}
                </Chip>
              )}
              {stepFreeFilter !== 'any' && (
                <Chip size="sm" variant="flat">
                  {t('event_accessibility:filters.step_free_active', {
                    value: t(`event_accessibility:filters.step_free_options.${stepFreeFilter}`),
                  })}
                </Chip>
              )}
              {proximityParams && <Chip size="sm" variant="flat">{t('active_near_me', { radius: proximityParams.radius_km })}</Chip>}
            </div>
            <Button
              size="sm"
              variant="light"
              className="text-theme-muted"
              startContent={<X className="h-4 w-4" aria-hidden="true" />}
              onPress={clearFilters}
            >
              {t('clear_filters')}
            </Button>
          </div>
        )}
      </GlassCard>

      {/* Category Filter — single-select ToggleButtonGroup */}
      <ToggleButtonGroup
        aria-label={t('category_aria')}
        selectionMode="single"
        disallowEmptySelection
        isDetached
        size="sm"
        selectedKeys={new Set([selectedCategory])}
        onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setSelectedCategory(String(k)); }}
        className="flex flex-wrap gap-2"
      >
        <ToggleButton
          id="all"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted transition-colors hover:bg-theme-hover data-[selected=true]:bg-linear-to-r data-[selected=true]:from-accent data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
        >
          <Tag className="w-3.5 h-3.5" aria-hidden="true" />
          {t('category.all')}
        </ToggleButton>
        {categories.map((cat) => {
          const IconComp = CATEGORY_ICONS[cat.slug] ?? Tag;
          return (
            <ToggleButton
              key={cat.id}
              id={String(cat.id)}
              variant="ghost"
              className="bg-theme-elevated text-theme-muted transition-colors hover:bg-theme-hover data-[selected=true]:bg-linear-to-r data-[selected=true]:from-accent data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
            >
              <IconComp className="w-3.5 h-3.5" aria-hidden="true" />
              {cat.name}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      </>}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchQuery}
          onValueChange={setSearchQuery}
          onSubmit={(value) => setDebouncedQuery(value)}
          placeholder={t('search_placeholder')}
          recentKey="events"
        />
      )}

      {/* Phone filter sheet — every filter as chips, draft-apply (no live count:
          /v2/events reports no total). */}
      {isPhone && filterSheet.draft && (
        <EventFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          categories={categories}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
        />
      )}

      {activeView !== 'list' && <EventCalendarViews view={activeView} />}

      {/* Error State */}
      {activeView === 'list' && error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            color="primary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadEvents()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Events List / Map */}
      {activeView === 'list' && !error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-6" aria-label={t('loading_aria')} aria-busy="true">
              {[1, 2, 3].map((i) => (
                <GlassCard key={i} className="p-5">
                  <div className="flex gap-4">
                    <Skeleton className="w-16 h-20 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 rounded-lg w-1/2" />
                      <Skeleton className="h-4 rounded-lg w-3/4" />
                      <Skeleton className="h-3 rounded-lg w-1/4" />
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : events.length === 0 ? (
            <PublicEmptyState
              icon={<Calendar className="w-12 h-12" aria-hidden="true" />}
              title={t('no_events')}
              description={
                selectedCategory !== 'all'
                  ? t('no_events_category', { category: categories.find((c) => String(c.id) === selectedCategory)?.name })
                  : filter === 'upcoming'
                    ? t('no_events_upcoming')
                    : t('no_events_search')
              }
              accent="amber"
              tips={[t('empty_tip_workshops'), t('empty_tip_social'), t('empty_tip_online')]}
              action={
                mayCreateEvent && (
                  <Button as={Link} to={tenantPath('/events/create')} color="primary">
                    {t('create_event')}
                  </Button>
                )
              }
            />
          ) : (
            <motion.div
              key={debouncedQuery + filter + selectedCategory}
              className="space-y-8"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {Object.entries(groupedEvents).map(([month, monthEvents]) => (
                <section key={month} aria-label={t('events_in_month', { month })}>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-theme-muted mb-3 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />
                    {month}
                  </h2>
                  <div className="space-y-4">
                    {monthEvents.map((event) => (
                      <motion.div
                        key={event.id}
                        variants={itemVariants}
                      >
                        <EventCard event={event} />
                      </motion.div>
                    ))}
                  </div>
                </section>
              ))}

              {/* Load More Button */}
              {hasMore && (
                <div className="space-y-3 pt-4">
                  {totalCount != null && totalCount > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-theme-muted px-1">
                        <span>{events.length.toLocaleString(getFormattingLocale())} / {totalCount.toLocaleString(getFormattingLocale())}</span>
                        <span className="font-medium text-theme-secondary">{Math.round((events.length / totalCount) * 100)}%</span>
                      </div>
                      <Progress
                        aria-label={t('loading_more_aria')}
                        size="sm"
                        value={Math.round((events.length / totalCount) * 100)}
                        classNames={{ track: 'bg-theme-elevated', indicator: 'bg-accent' }}
                      />
                    </div>
                  )}
                  <div className="text-center">
                    <Button
                      variant="flat"
                      className="bg-theme-elevated text-theme-muted hover:bg-theme-hover"
                      onPress={loadMoreEvents}
                      isLoading={isLoadingMore}
                    >
                      {totalCount != null && totalCount > events.length
                        ? t('load_more_count', { remaining: (totalCount - events.length).toLocaleString(getFormattingLocale()) })
                        : t('load_more')}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

interface EventCardProps {
  event: Event;
}

const EventCard = memo(function EventCard({ event }: EventCardProps) {
  const { t } = useTranslation('events');
  const { tenantPath } = useTenant();
  const startDate = new Date(event.schedule.start_at ?? event.created_at ?? 0);
  const formattingLocale = getFormattingLocale();
  let eventTimezone = event.schedule.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat(formattingLocale, { timeZone: eventTimezone }).format(startDate);
  } catch {
    eventTimezone = 'UTC';
  }
  const isPast = event.schedule.state === 'ended' || event.schedule.state === 'completed';
  const isCancelled = event.schedule.state === 'cancelled';
  // Unpublished events only reach the list for their own organiser (and tenant
  // admins), so a state chip here is what stops a fresh draft looking lost.
  const isDraft = event.schedule.publication_state === 'draft';
  const isPendingReview = event.schedule.publication_state === 'pending_review';
  const eventDateLabel = formatDateValue(startDate, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: eventTimezone,
  });
  const monthLabel = formatDateValue(startDate, {
    month: 'short',
    timeZone: eventTimezone,
  }).toLocaleUpperCase(formattingLocale);
  const dayLabel = formatDateValue(startDate, {
    day: 'numeric',
    timeZone: eventTimezone,
  });
  const weekdayLabel = formatDateValue(startDate, {
    weekday: 'short',
    timeZone: eventTimezone,
  });
  const timeLabel = event.schedule.all_day
    ? t('calendar.all_day')
    : formatDateTime(startDate, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: eventTimezone,
        timeZoneName: 'short',
      });
  const coverImageProps = event.primary_image?.url
    ? responsiveThumbnailProps(event.primary_image.url, {
        width: 360,
        height: 220,
        sizes: '(min-width: 640px) 112px, 92vw',
      })
    : null;
  const freq = event.series.recurrence?.frequency;
  const repeatsLabel = freq && ['daily', 'weekly', 'monthly', 'yearly'].includes(freq)
    ? t(`card.repeats_${freq}`)
    : t('card.repeats_generic');
  const seriesCount = event.series.recurrence?.occurrence_count ?? event.series.named?.event_count ?? 0;

  return (
    <Link to={tenantPath(`/events/${event.id}`)} aria-label={t('card.open_aria', { title: event.title, date: eventDateLabel })}>
      <article>
        <GlassCard className={`overflow-hidden hover:border-accent/40 hover:shadow-lg transition ${isPast || isCancelled ? 'opacity-65' : ''}`}>
          {coverImageProps && (
            <img
              {...coverImageProps}
              alt={t('detail.cover_alt', { title: event.title })}
              className="h-36 w-full object-cover sm:hidden"
              loading="lazy"
              decoding="async"
            />
          )}
          <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
            {/* Date Box */}
            <div className="flex-shrink-0 w-14 sm:w-16 text-center">
              <time dateTime={event.schedule.start_at ?? undefined} className="block rounded-lg border border-amber-500/25 bg-amber-500/10 p-2">
                <span className="text-theme-warning text-xs font-medium uppercase block">
                  {monthLabel}
                </span>
                <span className="text-theme-primary text-xl sm:text-2xl font-bold block">
                  {dayLabel}
                </span>
                <span className="text-theme-subtle text-xs block">
                  {weekdayLabel}
                </span>
              </time>
            </div>

            {/* Event Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-theme-primary text-base sm:text-lg leading-snug">{event.title}</h3>
                    {event.category?.name && (
                      <Chip size="sm" variant="flat" color="secondary" className="text-xs">
                        {event.category.name}
                      </Chip>
                    )}
                  </div>
                  <SafeHtml content={event.description ?? ''} className="text-theme-muted text-sm line-clamp-2 mt-1" as="p" />
                </div>
                {coverImageProps && (
                  <img
                    {...coverImageProps}
                    alt={t('detail.cover_alt', { title: event.title })}
                    className="hidden h-20 w-28 flex-shrink-0 rounded-lg object-cover sm:block"
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(event.series.recurrence || event.series.named) && (
                  <Chip
                    size="sm"
                    variant="flat"
                    color="secondary"
                    startContent={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {seriesCount > 1
                      ? `${repeatsLabel} · ${t('card.series_dates', { count: seriesCount })}`
                      : repeatsLabel}
                  </Chip>
                )}
                {isDraft && (
                  <Chip size="sm" variant="flat" color="warning" startContent={<PencilLine className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {t('detail.event_draft')}
                  </Chip>
                )}
                {isPendingReview && (
                  <Chip size="sm" variant="flat" color="warning" startContent={<Hourglass className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {t('detail.event_pending_review')}
                  </Chip>
                )}
                {isCancelled && (
                  <Chip size="sm" variant="flat" color="danger" startContent={<Ban className="h-3.5 w-3.5" aria-hidden="true" />}>
                    {t('card.cancelled')}
                  </Chip>
                )}
                {event.relationship.capacity.is_full && !isCancelled && (
                  <Chip size="sm" variant="flat" color="danger">{t('card.full')}</Chip>
                )}
                {event.relationship.capacity.limit != null && event.relationship.capacity.remaining != null && event.relationship.capacity.remaining > 0 && !isCancelled && (
                  <Chip size="sm" variant="flat" color={event.relationship.capacity.remaining <= 3 ? 'danger' : 'success'}>
                    {t('card.spots_left', { count: event.relationship.capacity.remaining })}
                  </Chip>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm text-theme-subtle">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <time dateTime={event.schedule.start_at ?? undefined}>
                    {timeLabel}
                  </time>
                </span>
                {event.location.label && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{event.location.label}</span>
                  </span>
                )}
                {event.distance_km !== undefined && (
                  <span className="flex items-center gap-1.5 text-accent font-medium">
                    <MapPin className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {event.distance_km < 1
                      ? `${Math.round(event.distance_km * 1000)} m`
                      : `${event.distance_km.toFixed(1)} km`}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  {t('going', { count: event.metrics.confirmed_count })}
                  {event.metrics.interested_count > 0 && (
                    <span className="text-theme-subtle">&middot; {t('interested', { count: event.metrics.interested_count })}</span>
                  )}
                </span>
              </div>
            </div>

            <div className="hidden flex-shrink-0 self-center sm:block">
              <ChevronRight className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
            </div>
          </div>
        </GlassCard>
      </article>
    </Link>
  );
});

export default EventsPage;
