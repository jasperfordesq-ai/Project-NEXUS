// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@heroui/react/tabs';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import BarChart3 from 'lucide-react/icons/chart-column';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import CopyPlus from 'lucide-react/icons/copy-plus';
import Edit from 'lucide-react/icons/square-pen';
import Eye from 'lucide-react/icons/eye';
import Layers3 from 'lucide-react/icons/layers-3';
import ListTree from 'lucide-react/icons/list-tree';
import Megaphone from 'lucide-react/icons/megaphone';
import Network from 'lucide-react/icons/network';
import Settings from 'lucide-react/icons/settings';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Ticket from 'lucide-react/icons/ticket';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo/PageMeta';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { EventSeriesTemplateNotice } from './components/EventSeriesTemplateNotice';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  eventsApi,
  type Event,
  type EventRecurrenceCapabilities,
  type EventRecurrenceDefinitionSections,
  type EventStaffAssignment,
} from '@/lib/events-api';
import { logError } from '@/lib/logger';
import { EventOfflineCheckinWorkspace } from './components/EventOfflineCheckinWorkspace';
import { EventCommunicationsWorkspace } from './components/EventCommunicationsWorkspace';
import { EventAgendaWorkspace } from './components/EventAgendaWorkspace';
import { EventAnalyticsPanel } from './components/EventAnalyticsPanel';
import { EventFederationStatusPanel } from './components/EventFederationStatusPanel';
import { EventLifecycleHistoryPanel } from './components/EventLifecycleHistoryPanel';
import { EventPeopleWorkspace } from './components/EventPeopleWorkspace';
import { EventRecurrenceDefinitionBlueprintManager } from './components/EventRecurrenceDefinitionBlueprintManager';
import { EventRegistrationWorkspace } from './components/EventRegistrationWorkspace';
import { EventStaffWorkspace } from './components/EventStaffWorkspace';
import { EventSafetyWorkspace } from './components/EventSafetyWorkspace';
import { EventTemplatesWorkspace } from './components/EventTemplatesWorkspace';
import { EventTicketsPanel } from './components/EventTicketsPanel';

function canUseImplementedManagement(event: Event): boolean {
  return event.permissions.edit
    || event.permissions.cancel
    || event.permissions.manage_people
    || event.permissions.manage_registration
    || event.permissions.check_in
    || event.permissions.manage_agenda
    || event.permissions.manage_staff
    || event.permissions.manage_finance
    || event.permissions.reconcile_tickets
    || event.permissions.broadcast;
}

function recurrenceDefinitionPermissions(event: Event): EventRecurrenceDefinitionSections {
  return {
    agenda: event.permissions.manage_agenda,
    ticket_types: event.permissions.manage_finance,
    registration: event.permissions.manage_registration,
    safety: event.permissions.edit,
    staff: event.permissions.manage_staff,
  };
}

function hasConcreteV2RecurrenceIdentity(event: Event): boolean {
  const recurrence = event.series.recurrence;
  return recurrence !== null
    && recurrence.is_template === false
    && recurrence.parent_event_id !== null
    && recurrence.recurrence_id !== null
    && /^\d{8}T\d{6}Z$/.test(recurrence.recurrence_id)
    && recurrence.engine === 'sabre-vobject'
    && recurrence.engine_version === '2';
}

function canUseDefinitionBlueprints(
  event: Event | null,
  capabilities: EventRecurrenceCapabilities | null,
  suppressed: boolean,
): boolean {
  if (!event || !capabilities || suppressed || !hasConcreteV2RecurrenceIdentity(event)) return false;
  const permissions = recurrenceDefinitionPermissions(event);

  return Object.values(permissions).some(Boolean)
    && capabilities.engine === 'v2'
    && capabilities.schema_ready
    && capabilities.supports_definition_blueprints
    && capabilities.rollout_state === 'v2_rolling';
}

const managementTabClassName = 'min-h-10 w-auto min-w-fit flex-none rounded-lg px-4 text-sm font-medium data-[selected=true]:bg-theme-hover data-[selected=true]:text-theme-primary';

export function EventManagePage() {
  const { t } = useTranslation([
    'events',
    'event_safety',
    'event_federation',
    'event_templates',
    'event_analytics',
    'event_tickets',
    'event_communications',
    'event_registration',
    'event_recurrence_blueprints',
  ]);
  const { id, section } = useParams<{ id: string; section?: string }>();
  const { tenantPath, hasFeature } = useTenant();
  // Federation sharing is a community feature; without it the tab could only
  // ever say "no partners configured" (E-104).
  const federationVisible = hasFeature('federation');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [assignments, setAssignments] = useState<EventStaffAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [recurrenceCapabilities, setRecurrenceCapabilities] = useState<EventRecurrenceCapabilities | null>(null);
  const [definitionBlueprintsSuppressed, setDefinitionBlueprintsSuppressed] = useState(false);
  const pageAbortRef = useRef<AbortController | null>(null);
  const staffAbortRef = useRef<AbortController | null>(null);
  const managementWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  usePageTitle(event
    ? t('manage.page_title', { title: event.title })
    : t('manage.page_title_fallback'));

  const loadStaff = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;

    setIsLoadingStaff(true);
    setStaffError(null);
    try {
      const response = await eventsApi.listStaff(id, true, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      if (response.success && response.data) {
        setAssignments(response.data);
      } else {
        setStaffError(tRef.current('manage.team.load_error_desc'));
      }
    } catch (caught) {
      if (signal?.aborted) return;
      logError('Failed to load event staff assignments', caught);
      setStaffError(tRef.current('manage.team.load_error_desc'));
    } finally {
      if (!signal?.aborted) setIsLoadingStaff(false);
    }
  }, [id]);

  const loadPage = useCallback(async () => {
    if (!id) return;

    pageAbortRef.current?.abort();
    staffAbortRef.current?.abort();
    const controller = new AbortController();
    pageAbortRef.current = controller;
    setIsLoading(true);
    setPageError(null);
    setStaffError(null);
    setRecurrenceCapabilities(null);
    setDefinitionBlueprintsSuppressed(false);

    try {
      const eventResponse = await eventsApi.get(id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!eventResponse.success || !eventResponse.data) {
        setEvent(null);
        setPageError(tRef.current('manage.load_error_desc'));
        return;
      }

      const loadedEvent = eventResponse.data;
      setEvent(loadedEvent);
      setAssignments([]);

      const definitionPermissions = recurrenceDefinitionPermissions(loadedEvent);
      if (hasConcreteV2RecurrenceIdentity(loadedEvent)
        && Object.values(definitionPermissions).some(Boolean)) {
        try {
          const capabilityResponse = await eventsApi.recurrenceCapabilities({ signal: controller.signal });
          if (controller.signal.aborted) return;
          if (capabilityResponse.success && capabilityResponse.data) {
            setRecurrenceCapabilities(capabilityResponse.data);
          }
        } catch (caught) {
          if (controller.signal.aborted) return;
          // The capability endpoint is a fail-closed enhancement. Keep the
          // ordinary management workspace usable when it cannot be reached.
          logError('Failed to load event recurrence capabilities', caught);
        }
      }

      // The event contract is authoritative. Staff data is requested only
      // after it confirms that this viewer can manage staff.
      if (loadedEvent.permissions.manage_staff) {
        await loadStaff(controller.signal);
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      logError('Failed to load event management workspace', caught);
      setEvent(null);
      setPageError(tRef.current('manage.load_error_desc'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [id, loadStaff]);

  useEffect(() => {
    void loadPage();

    return () => {
      pageAbortRef.current?.abort();
      staffAbortRef.current?.abort();
    };
  }, [loadPage]);

  useEffect(() => {
    if (!id || section) return;
    const legacyTab = searchParams.get('tab');
    const legacySection = legacyTab === 'attendees'
      ? 'people'
      : legacyTab === 'checkin'
        ? 'check-in'
        : legacyTab === 'team'
          ? 'team'
          : 'overview';
    navigate(tenantPath(`/events/${id}/manage/${legacySection}`), { replace: true });
  }, [id, navigate, searchParams, section, tenantPath]);

  const allowedSections = useMemo(() => new Set([
    'overview',
    ...(event?.permissions.edit ? ['safety'] : []),
    ...(event?.permissions.edit && federationVisible ? ['federation'] : []),
    ...(event?.permissions.edit ? ['templates'] : []),
    ...(event?.permissions.edit ? ['analytics'] : []),
    ...((event?.permissions.manage_finance || event?.permissions.reconcile_tickets)
      && event?.schedule.start_at ? ['tickets'] : []),
    ...(event?.permissions.broadcast ? ['communications'] : []),
    ...(event?.permissions.manage_registration ? ['registration'] : []),
    ...(event?.permissions.manage_people ? ['people'] : []),
    ...(event?.permissions.check_in ? ['check-in'] : []),
    ...(event?.permissions.manage_agenda ? ['agenda'] : []),
    ...(event?.permissions.manage_staff ? ['team'] : []),
    ...(canUseDefinitionBlueprints(event, recurrenceCapabilities, definitionBlueprintsSuppressed)
      ? ['series-definitions']
      : []),
  ]), [definitionBlueprintsSuppressed, event, federationVisible, recurrenceCapabilities]);

  const suppressDefinitionBlueprints = useCallback(() => {
    setDefinitionBlueprintsSuppressed(true);
    setRecurrenceCapabilities(null);
  }, []);

  const selectedTab = section && allowedSections.has(section) ? section : 'overview';
  // Registration, safety, tickets, check-in and people exist per concrete
  // date; on the series template those APIs refuse, so show the dates
  // instead of a misleading "check your connection" error (E-104).
  const isSeriesTemplate = event?.series.recurrence?.is_template === true;
  const seriesTemplateNotice = event ? (
    <EventSeriesTemplateNotice
      variant="manage"
      occurrences={event.series.recurrence?.occurrences ?? []}
      timezone={event.schedule.timezone}
      hrefFor={(occurrenceId) => tenantPath(`/events/${occurrenceId}/manage/${selectedTab}`)}
    />
  ) : null;

  useEffect(() => {
    if (!event || !id || !section || allowedSections.has(section)) return;
    navigate(tenantPath(`/events/${id}/manage/overview`), { replace: true });
  }, [allowedSections, event, id, navigate, section, tenantPath]);

  useLayoutEffect(() => {
    if (!event || isLoading) return;
    let cancelled = false;
    let secondFrameId: number | null = null;
    const revealSelectedTab = () => {
      if (cancelled) return;
      const selected = managementWorkspaceRef.current?.querySelector<HTMLElement>(
        `[data-management-section="${selectedTab}"]`,
      );
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      }
    };

    // React Aria finalises the tab collection and its scrollable width after
    // the parent commit. Try immediately, after two layout frames, and once
    // more after the short layout-settling window used by the tab indicator.
    revealSelectedTab();
    const firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(revealSelectedTab);
    });
    const fallbackId = window.setTimeout(revealSelectedTab, 250);
    const tabList = managementWorkspaceRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const observer = tabList && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(revealSelectedTab)
      : null;
    if (tabList) observer?.observe(tabList);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) window.cancelAnimationFrame(secondFrameId);
      window.clearTimeout(fallbackId);
      observer?.disconnect();
    };
  }, [event, isLoading, selectedTab]);

  const refreshStaff = useCallback(async () => {
    staffAbortRef.current?.abort();
    const controller = new AbortController();
    staffAbortRef.current = controller;
    await loadStaff(controller.signal);
  }, [loadStaff]);

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-[24rem] max-w-5xl items-center justify-center" aria-busy="true">
        <Spinner size="lg" aria-label={t('manage.loading')} />
      </div>
    );
  }

  if (pageError || !event) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageMeta title={t('manage.page_title_fallback')} noIndex />
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-6" role="alert">
          <h1 className="text-xl font-semibold text-danger">{t('manage.load_error_title')}</h1>
          <p className="mt-2 text-theme-muted">{pageError ?? t('manage.load_error_desc')}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" onPress={() => void loadPage()}>{t('manage.try_again')}</Button>
            <Button as={Link} to={tenantPath('/events')} variant="outline">{t('detail.browse_events')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!canUseImplementedManagement(event)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageMeta title={t('manage.page_title', { title: event.title })} noIndex />
        <Breadcrumbs items={[
          { label: t('title'), href: '/events' },
          { label: event.title, href: `/events/${event.id}` },
          { label: t('manage.title') },
        ]} />
        <div className="rounded-2xl border border-theme-default bg-theme-surface p-6" role="alert">
          <h1 className="text-xl font-semibold text-theme-primary">{t('manage.access_denied_title')}</h1>
          <p className="mt-2 text-theme-muted">{t('manage.access_denied_desc')}</p>
          <Button
            as={Link}
            to={tenantPath(`/events/${event.id}`)}
            className="mt-5"
            variant="outline"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t('manage.back_to_event')}
          </Button>
        </div>
      </div>
    );
  }

  const selectTab = (key: React.Key) => {
    const nextTab = String(key);
    if (!allowedSections.has(nextTab)) return;
    navigate(tenantPath(`/events/${event.id}/manage/${nextTab}`));
  };

  return (
    <div ref={managementWorkspaceRef} className="mx-auto max-w-6xl space-y-6">
      <PageMeta
        title={t('manage.page_title', { title: event.title })}
        description={t('manage.meta_description', { title: event.title })}
        noIndex
      />
      <Breadcrumbs items={[
        { label: t('title'), href: '/events' },
        { label: event.title, href: `/events/${event.id}` },
        { label: t('manage.title') },
      ]} />

      <header className="rounded-2xl border border-theme-default bg-theme-surface p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-xl bg-accent/10 p-2.5 text-accent" aria-hidden="true">
              <Settings className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-accent">{t('manage.workspace_label')}</p>
              <h1 className="mt-1 text-2xl font-bold text-theme-primary sm:text-3xl">{event.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-theme-muted sm:text-base">{t('manage.subtitle')}</p>
            </div>
          </div>
          <Button
            as={Link}
            to={tenantPath(`/events/${event.id}`)}
            variant="outline"
            startContent={<Eye className="h-4 w-4" aria-hidden="true" />}
          >
            {t('manage.view_event')}
          </Button>
        </div>
      </header>

      <Tabs className="w-full min-w-0" selectedKey={selectedTab} onSelectionChange={selectTab}>
        <Tabs.ListContainer className="w-full min-w-0 max-w-full rounded-xl border border-theme-default bg-theme-surface p-1">
          <Tabs.List aria-label={t('manage.tabs_aria')} className="w-full min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain">
            <Tabs.Tab
              id="overview"
              data-management-section="overview"
              className={managementTabClassName}
            >
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              {t('manage.tab_overview')}
            </Tabs.Tab>
            {event.permissions.manage_people && (
              <Tabs.Tab
                id="people"
                data-management-section="people"
                className={managementTabClassName}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                {t('manage.tab_people')}
              </Tabs.Tab>
            )}
            {event.permissions.manage_registration && (
              <Tabs.Tab
                id="registration"
                data-management-section="registration"
                className={managementTabClassName}
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                {t('event_registration:title')}
              </Tabs.Tab>
            )}
            {event.permissions.edit && (
              <Tabs.Tab
                id="safety"
                data-management-section="safety"
                className={managementTabClassName}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t('event_safety:manage.tab')}
              </Tabs.Tab>
            )}
            {event.permissions.edit && federationVisible && (
              <Tabs.Tab
                id="federation"
                data-management-section="federation"
                className={managementTabClassName}
              >
                <Network className="h-4 w-4" aria-hidden="true" />
                {t('event_federation:manage.federation.tab')}
              </Tabs.Tab>
            )}
            {event.permissions.edit && (
              <Tabs.Tab
                id="templates"
                data-management-section="templates"
                className={managementTabClassName}
              >
                <CopyPlus className="h-4 w-4" aria-hidden="true" />
                {t('event_templates:tab')}
              </Tabs.Tab>
            )}
            {event.permissions.edit && (
              <Tabs.Tab
                id="analytics"
                data-management-section="analytics"
                className={managementTabClassName}
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                {t('event_analytics:analytics.title')}
              </Tabs.Tab>
            )}
            {(event.permissions.manage_finance || event.permissions.reconcile_tickets)
              && event.schedule.start_at && (
                <Tabs.Tab
                  id="tickets"
                  data-management-section="tickets"
                  className={managementTabClassName}
                >
                  <Ticket className="h-4 w-4" aria-hidden="true" />
                  {t('event_tickets:tickets.title')}
                </Tabs.Tab>
              )}
            {event.permissions.check_in && (
              <Tabs.Tab
                id="check-in"
                data-management-section="check-in"
                className={managementTabClassName}
              >
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                {t('manage.tab_check_in')}
              </Tabs.Tab>
            )}
            {event.permissions.broadcast && (
              <Tabs.Tab
                id="communications"
                data-management-section="communications"
                className={managementTabClassName}
              >
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                {t('event_communications:title')}
              </Tabs.Tab>
            )}
            {event.permissions.manage_agenda && (
              <Tabs.Tab
                id="agenda"
                data-management-section="agenda"
                className={managementTabClassName}
              >
                <ListTree className="h-4 w-4" aria-hidden="true" />
                {t('manage.tab_agenda')}
              </Tabs.Tab>
            )}
            {event.permissions.manage_staff && (
              <Tabs.Tab
                id="team"
                data-management-section="team"
                className={managementTabClassName}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                {t('manage.tab_team')}
              </Tabs.Tab>
            )}
            {canUseDefinitionBlueprints(event, recurrenceCapabilities, definitionBlueprintsSuppressed) && (
              <Tabs.Tab
                id="series-definitions"
                data-management-section="series-definitions"
                className={managementTabClassName}
              >
                <Layers3 className="h-4 w-4" aria-hidden="true" />
                {t('event_recurrence_blueprints:tab')}
              </Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview" className="pt-5 outline-none">
          {selectedTab === 'overview' && <EventManagementOverview event={event} />}
        </Tabs.Panel>
        {event.permissions.manage_people && (
          <Tabs.Panel id="people" className="pt-5 outline-none">
            {selectedTab === 'people' && (isSeriesTemplate ? seriesTemplateNotice : <EventPeopleWorkspace eventId={event.id} />)}
          </Tabs.Panel>
        )}
        {event.permissions.manage_registration && (
          <Tabs.Panel id="registration" className="pt-5 outline-none">
            {selectedTab === 'registration' && (isSeriesTemplate ? seriesTemplateNotice : <EventRegistrationWorkspace eventId={event.id} />)}
          </Tabs.Panel>
        )}
        {event.permissions.edit && (
          <Tabs.Panel id="safety" className="pt-5 outline-none">
            {selectedTab === 'safety' && (isSeriesTemplate ? seriesTemplateNotice : <EventSafetyWorkspace eventId={event.id} />)}
          </Tabs.Panel>
        )}
        {event.permissions.edit && federationVisible && (
          <Tabs.Panel id="federation" className="pt-5 outline-none">
            {selectedTab === 'federation' && <EventFederationStatusPanel eventId={event.id} />}
          </Tabs.Panel>
        )}
        {event.permissions.edit && (
          <Tabs.Panel id="templates" className="pt-5 outline-none">
            {selectedTab === 'templates' && (
              <EventTemplatesWorkspace sourceEventId={event.id} sourceEventTitle={event.title} />
            )}
          </Tabs.Panel>
        )}
        {event.permissions.edit && (
          <Tabs.Panel id="analytics" className="pt-5 outline-none">
            {selectedTab === 'analytics' && <EventAnalyticsPanel eventId={event.id} />}
          </Tabs.Panel>
        )}
        {(event.permissions.manage_finance || event.permissions.reconcile_tickets)
          && event.schedule.start_at && (
            <Tabs.Panel id="tickets" className="pt-5 outline-none">
              {selectedTab === 'tickets' && (isSeriesTemplate ? seriesTemplateNotice : (
                <EventTicketsPanel
                  eventId={event.id}
                  eventStart={event.schedule.start_at}
                  eventTimezone={event.schedule.timezone}
                />
              ))}
            </Tabs.Panel>
          )}
        {event.permissions.check_in && (
          <Tabs.Panel id="check-in" className="pt-5 outline-none">
            {selectedTab === 'check-in' && (isSeriesTemplate ? seriesTemplateNotice : <EventOfflineCheckinWorkspace eventId={event.id} />)}
          </Tabs.Panel>
        )}
        {event.permissions.broadcast && (
          <Tabs.Panel id="communications" className="pt-5 outline-none">
            {selectedTab === 'communications' && (
              <EventCommunicationsWorkspace eventId={event.id} eventTitle={event.title} />
            )}
          </Tabs.Panel>
        )}
        {event.permissions.manage_agenda && (
          <Tabs.Panel id="agenda" className="pt-5 outline-none">
            {selectedTab === 'agenda' && <EventAgendaWorkspace event={event} />}
          </Tabs.Panel>
        )}
        {event.permissions.manage_staff && (
          <Tabs.Panel id="team" className="pt-5 outline-none">
            {selectedTab === 'team' && (
              <EventStaffWorkspace
                eventId={event.id}
                organizerId={event.organizer.id}
                canGrantPrivilegedRoles={event.permissions.transfer_ownership}
                assignments={assignments}
                isLoading={isLoadingStaff}
                error={staffError}
                onRetry={() => void refreshStaff()}
                onChanged={refreshStaff}
              />
            )}
          </Tabs.Panel>
        )}
        {canUseDefinitionBlueprints(event, recurrenceCapabilities, definitionBlueprintsSuppressed)
          && event.series.recurrence?.recurrence_id && (
            <Tabs.Panel id="series-definitions" className="pt-5 outline-none">
              {selectedTab === 'series-definitions' && (
                <EventRecurrenceDefinitionBlueprintManager
                  eventId={event.id}
                  recurrenceId={event.series.recurrence.recurrence_id}
                  allowedSections={recurrenceDefinitionPermissions(event)}
                  onUnavailable={suppressDefinitionBlueprints}
                />
              )}
            </Tabs.Panel>
          )}
      </Tabs>
    </div>
  );
}

function EventManagementOverview({ event }: { event: Event }) {
  const { hasFeature } = useTenant();
  const { t } = useTranslation([
    'events',
    'event_safety',
    'event_federation',
    'event_templates',
    'event_analytics',
    'event_tickets',
    'event_communications',
    'event_registration',
  ]);
  const { tenantPath } = useTenant();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-5 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold text-theme-primary">{t('manage.overview.title')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('manage.overview.description')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-theme-elevated p-4">
              <p className="text-sm text-theme-muted">{t('manage.overview.confirmed')}</p>
              <p className="mt-1 text-2xl font-bold text-theme-primary">{event.metrics.confirmed_count}</p>
            </div>
            <div className="rounded-xl bg-theme-elevated p-4">
              <p className="text-sm text-theme-muted">{t('manage.overview.waitlisted')}</p>
              <p className="mt-1 text-2xl font-bold text-theme-primary">{event.metrics.waitlist_count}</p>
            </div>
            <div className="rounded-xl bg-theme-elevated p-4">
              <p className="text-sm text-theme-muted">{t('manage.overview.lifecycle')}</p>
              <Chip className="mt-2" variant="flat">{t(`manage.lifecycle_states.${event.schedule.state}`)}</Chip>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-theme-primary">{t('manage.overview.operations_title')}</h2>
          <div className="flex flex-col gap-2">
            <Button as={Link} to={tenantPath(`/events/${event.id}`)} variant="outline" className="justify-start">
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t('manage.view_event')}
            </Button>
            {event.permissions.edit && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/edit`)} variant="outline" className="justify-start">
                <Edit className="h-4 w-4" aria-hidden="true" />
                {t('manage.overview.edit_event')}
              </Button>
            )}
            {event.permissions.manage_people && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/people`)} variant="outline" className="justify-start">
                <Users className="h-4 w-4" aria-hidden="true" />
                {t('manage.overview.people')}
              </Button>
            )}
            {event.permissions.manage_registration && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/registration`)} variant="outline" className="justify-start">
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                {t('event_registration:title')}
              </Button>
            )}
            {event.permissions.edit && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/safety`)} variant="outline" className="justify-start">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t('event_safety:manage.overview')}
              </Button>
            )}
            {event.permissions.edit && hasFeature('federation') && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/federation`)} variant="outline" className="justify-start">
                <Network className="h-4 w-4" aria-hidden="true" />
                {t('event_federation:manage.federation.overview')}
              </Button>
            )}
            {event.permissions.edit && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/templates`)} variant="outline" className="justify-start">
                <CopyPlus className="h-4 w-4" aria-hidden="true" />
                {t('event_templates:tab')}
              </Button>
            )}
            {event.permissions.edit && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/analytics`)} variant="outline" className="justify-start">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                {t('event_analytics:analytics.title')}
              </Button>
            )}
            {(event.permissions.manage_finance || event.permissions.reconcile_tickets)
              && event.schedule.start_at && (
                <Button as={Link} to={tenantPath(`/events/${event.id}/manage/tickets`)} variant="outline" className="justify-start">
                  <Ticket className="h-4 w-4" aria-hidden="true" />
                  {t('event_tickets:tickets.title')}
                </Button>
              )}
            {event.permissions.check_in && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/check-in`)} variant="outline" className="justify-start">
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                {t('manage.overview.check_in')}
              </Button>
            )}
            {event.permissions.broadcast && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/communications`)} variant="outline" className="justify-start">
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                {t('event_communications:title')}
              </Button>
            )}
            {event.permissions.manage_agenda && (
              <Button as={Link} to={tenantPath(`/events/${event.id}/manage/agenda`)} variant="outline" className="justify-start">
                <ListTree className="h-4 w-4" aria-hidden="true" />
                {t('manage.overview.agenda')}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="lg:col-span-2">
        <EventLifecycleHistoryPanel eventId={event.id} />
      </div>
    </div>
  );
}

export default EventManagePage;
