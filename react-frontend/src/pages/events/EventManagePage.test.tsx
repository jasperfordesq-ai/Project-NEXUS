// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanonicalEventFixture, renderEventRoute } from '@/test/events-test-harness';
import { EventManagePage } from './EventManagePage';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
/*
  🔴 `hasFeature` and `hasModule` are NOT optional in this mock, even though nothing in
  this file reads them. `Breadcrumbs` — rendered inside this page — began asking the
  tenant context whether each crumb's destination is enabled (5871d270f), and a partial
  mock made `context.hasFeature` undefined. The page then threw during render and all
  16 cases here failed at once, none of them about breadcrumbs.

  Both grant everything: this suite is about event management permissions, which come
  from the event contract, not from tenant gating.
*/
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('./components/EventOfflineCheckinWorkspace', () => ({
  EventOfflineCheckinWorkspace: ({ eventId }: { eventId: number }) => (
    <section>
      <h2>Offline QR check-in</h2>
      <h3>Manual check-in</h3>
      <span>event-{eventId}</span>
    </section>
  ),
}));
vi.mock('./components/EventRegistrationWorkspace', () => ({
  EventRegistrationWorkspace: ({ eventId }: { eventId: number }) => (
    <section aria-label="Registration management workspace">registration-{eventId}</section>
  ),
}));

const manageableEvent = createCanonicalEventFixture({
  permissions: {
    ...createCanonicalEventFixture().permissions,
    edit: true,
    cancel: true,
    manage_people: true,
    check_in: true,
    manage_agenda: true,
    manage_staff: true,
    manage_registration: true,
    manage_finance: true,
    reconcile_tickets: true,
    transfer_ownership: true,
  },
});

function renderManagePage(route = '/test/events/1/manage') {
  return renderEventRoute(<EventManagePage />, {
    route,
    path: '/:tenantSlug/events/:id/manage/:section?',
  });
}

describe('EventManagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: manageableEvent });
      if (url === '/v2/events/1/staff?include_inactive=true') {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url === '/v2/events/1/lifecycle-history?per_page=20') {
        return Promise.resolve({
          success: true,
          data: [],
          meta: { per_page: 20, next_cursor: null, has_more: false },
        });
      }
      if (url === '/v2/events/1/federation-status') {
        return Promise.resolve({
          success: true,
          data: {
            contract_version: 1,
            event_id: 1,
            federation_version: 2,
            visibility: 'listed',
            configured_partners: 0,
            recipient_partners: 0,
            health: 'not_configured',
            counts: { pending: 0, retry: 0, processing: 0, delivered: 0, dead_letter: 0 },
            partners: [],
            generated_at: '2030-01-01T12:00:00Z',
          },
        });
      }
      if (url === '/v2/event-templates?status=active&per_page=20') {
        return Promise.resolve({
          success: true,
          data: [],
          meta: { per_page: 20, next_cursor: null, has_more: false },
        });
      }
      if (url === '/v2/events/1/analytics') {
        const rate = { numerator: 0, denominator: 0, basis_points: null, suppressed: false };
        const deliveries = { pending: 0, delivered: 0, suppressed: 0, failed: 0, dead_lettered: 0 };
        return Promise.resolve({
          success: true,
          data: {
            contract_version: 1,
            event_id: 1,
            event_title: 'Community Garden Day',
            generated_at: '2030-01-01T12:00:00Z',
            privacy_threshold: 5,
            registration: {
              capacity_limit: 20,
              confirmed: 12,
              pending: 0,
              invited: 0,
              declined: 0,
              cancelled: 0,
              remaining: 8,
              completion_transitions: 12,
              cancellation_transitions: 0,
            },
            invitation: { available: true, issued: 0, accepted: 0, revoked: 0, expired: 0, conversion: rate },
            waitlist: {
              current_waiting: 0,
              current_offered: 0,
              joined: 0,
              offered: 0,
              accepted: 0,
              expired: 0,
              cancelled: 0,
              conversion: rate,
            },
            attendance: { checked_in: 0, checked_out: 0, attended: 0, no_show: 0, attendance_rate: rate },
            tickets: {
              available: true,
              redacted: false,
              confirmed_entitlements: 0,
              confirmed_units: 0,
              cancelled_units: 0,
              confirmed_credit_value: '0.00',
            },
            credits: {
              completed_claims: 0,
              completed_amount: '0.00',
              pending_claims: 0,
              failed_claims: 0,
              reversed_claims: 0,
            },
            communications: { ...deliveries, delivery_rate: rate, by_channel: {} },
            optional_funnel: {
              event_views: { value: null, suppressed: true },
              registration_starts: { value: null, suppressed: true },
              start_to_registration_conversion: { ...rate, suppressed: true },
            },
            safeguarding: { available: true, guardian_consents: { value: null, suppressed: true } },
          },
        });
      }
      if (url === '/v2/events/1/tickets') {
        return Promise.resolve({
          success: true,
          data: {
            contract_version: 1,
            event_id: 1,
            currency: 'time_credit',
            payment_gateway: { free_supported: true, time_credit_supported: false, money_supported: false },
            permissions: { manage: true, reconcile: true, allocate_self: false },
            ticket_types: [],
            own_entitlements: [],
          },
        });
      }
      return Promise.resolve({ success: false });
    });
  });

  it('loads the canonical event before staff and exposes only implemented management tabs', async () => {
    const user = userEvent.setup();
    renderManagePage();

    expect(screen.getByRole('status', { name: 'Loading event management workspace...' })).toBeInTheDocument();
    await screen.findByRole('heading', { level: 1, name: 'Community Garden Day' });

    expect(mockApi.get.mock.calls.map(([url]) => url)).toEqual([
      '/v2/events/1',
      '/v2/events/1/staff?include_inactive=true',
      '/v2/events/1/lifecycle-history?per_page=20',
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Registration, invitations and guests' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Templates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Event analytics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /communications/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /finance/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Team' }));
    expect(await screen.findByRole('heading', { name: 'Add a team member' })).toBeInTheDocument();
  });

  it('keeps future setup visible after staff loading fails and is refreshed', async () => {
    const recurringEvent = createCanonicalEventFixture({
      permissions: {
        ...createCanonicalEventFixture().permissions,
        manage_staff: true,
      },
      series: {
        named: null,
        recurrence: {
          parent_event_id: 90,
          root_event_id: 90,
          is_template: false,
          recurrence_id: '20300601T100000Z',
          engine: 'sabre-vobject',
          engine_version: '2',
          frequency: 'weekly',
          interval: 1,
          rrule: 'FREQ=WEEKLY',
          occurrence_count: 2,
          occurrences: [],
        },
      },
    });
    let staffLoads = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: recurringEvent });
      if (url === '/v2/events/recurrence-capabilities') {
        return Promise.resolve({
          success: true,
          data: {
            contract_version: 1,
            engine: 'v2',
            structured_input: true,
            supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
            max_occurrences: 500,
            supported_end_types: ['after_count', 'on_date', 'never'],
            supports_rolling_never: true,
            supports_effective_revisions: true,
            supports_definition_blueprints: true,
            schema_ready: true,
            rollout_state: 'v2_rolling',
          },
        });
      }
      if (url === '/v2/events/1/staff?include_inactive=true') {
        staffLoads += 1;
        return Promise.resolve(staffLoads === 1
          ? { success: false, code: 'TEMPORARY_FAILURE' }
          : { success: true, data: [] });
      }
      return Promise.resolve({ success: false });
    });
    const user = userEvent.setup();

    renderManagePage('/test/events/1/manage/team');

    expect(await screen.findByRole('tab', { name: 'Future setup' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the event team');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(staffLoads).toBe(2));
    expect(screen.getByRole('tab', { name: 'Future setup' })).toBeInTheDocument();
    expect(await screen.findByText('No delegated roles yet')).toBeInTheDocument();
  });

  it.each(['disabled', 'failed'] as const)(
    'fails closed without a dead future-setup tab when capabilities are %s',
    async (mode) => {
      const recurringEvent = createCanonicalEventFixture({
        permissions: { ...createCanonicalEventFixture().permissions, edit: true },
        series: {
          named: null,
          recurrence: {
            parent_event_id: 90,
            root_event_id: 90,
            is_template: false,
            recurrence_id: '20300601T100000Z',
            engine: 'sabre-vobject',
            engine_version: '2',
            frequency: 'weekly',
            interval: 1,
            rrule: 'FREQ=WEEKLY',
            occurrence_count: 2,
            occurrences: [],
          },
        },
      });
      mockApi.get.mockImplementation((url: string) => {
        if (url === '/v2/events/1') return Promise.resolve({ success: true, data: recurringEvent });
        if (url === '/v2/events/recurrence-capabilities') {
          if (mode === 'failed') return Promise.reject(new Error('capability unavailable'));
          return Promise.resolve({
            success: true,
            data: {
              contract_version: 1,
              engine: 'v2',
              structured_input: true,
              supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
              max_occurrences: 500,
              supported_end_types: ['after_count', 'on_date', 'never'],
              supports_rolling_never: true,
              supports_effective_revisions: true,
              supports_definition_blueprints: false,
              schema_ready: true,
              rollout_state: 'v2_rolling',
            },
          });
        }
        return Promise.resolve({ success: false });
      });

      renderManagePage('/test/events/1/manage/overview');

      expect(await screen.findByRole('heading', { level: 1, name: 'Community Garden Day' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Future setup' })).not.toBeInTheDocument();
      expect(screen.queryByText('Unable to load event management')).not.toBeInTheDocument();
    },
  );

  it('keeps management tabs intrinsically sized and reveals the selected tab at 390px', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
    const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame');
    const animationFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    let layoutReady = false;
    const scrollIntoView = vi.fn(function scrollSelectedTab(this: Element) {
      if (!layoutReady) return;
      const tabList = this.closest<HTMLElement>('[role="tablist"]');
      if (tabList) tabList.scrollLeft = 1034;
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const frameId = ++nextFrameId;
        animationFrames.set(frameId, callback);
        return frameId;
      }),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn((frameId: number) => animationFrames.delete(frameId)),
    });

    try {
      let resolveStaff!: (value: { success: boolean; data: never[] }) => void;
      const staffRequest = new Promise<{ success: boolean; data: never[] }>((resolve) => {
        resolveStaff = resolve;
      });
      const mobileEvent = createCanonicalEventFixture({
        permissions: { ...manageableEvent.permissions, broadcast: true },
        series: {
          named: null,
          recurrence: {
            parent_event_id: 1,
            root_event_id: 1,
            is_template: false,
            frequency: 'weekly',
            interval: 1,
            rrule: 'FREQ=WEEKLY',
            recurrence_id: '20300601T100000Z',
            engine: 'sabre-vobject',
            engine_version: '2',
            occurrence_count: 2,
            occurrences: [],
          },
        },
      });
      mockApi.get.mockImplementation((url: string) => {
        if (url === '/v2/events/1') return Promise.resolve({ success: true, data: mobileEvent });
        if (url === '/v2/events/recurrence-capabilities') {
          return Promise.resolve({
            success: true,
            data: {
              contract_version: 1,
              engine: 'v2',
              structured_input: true,
              supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
              max_occurrences: 500,
              supported_end_types: ['after_count', 'on_date', 'never'],
              supports_rolling_never: true,
              supports_effective_revisions: true,
              supports_definition_blueprints: true,
              schema_ready: true,
              rollout_state: 'v2_rolling',
            },
          });
        }
        if (url === '/v2/events/1/staff?include_inactive=true') {
          return staffRequest;
        }
        if (url === '/v2/events/1/broadcasts?page=1&per_page=20') {
          return Promise.resolve({
            success: true,
            data: [],
            meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false },
          });
        }
        return Promise.resolve({ success: false });
      });

      renderManagePage('/test/events/1/manage/communications');

      await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
        '/v2/events/1/staff?include_inactive=true',
        expect.anything(),
      ));
      expect(screen.getByRole('status', { name: 'Loading event management workspace...' }))
        .toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
      await act(async () => {
        resolveStaff({ success: true, data: [] });
      });

      const tabList = await screen.findByRole('tablist');
      const tabs = screen.getAllByRole('tab');
      const selected = screen.getByRole('tab', { name: 'Organizer communications' });
      const listContainer = tabList.closest<HTMLElement>('[data-slot="tabs-list-container"]');

      expect(window.innerWidth).toBe(390);
      expect(listContainer).toHaveClass('w-full', 'min-w-0', 'max-w-full');
      expect(listContainer).not.toHaveClass('overflow-x-auto');
      expect(tabList).toHaveClass(
        'w-full',
        'min-w-0',
        'max-w-full',
        'overflow-x-auto',
        'overscroll-x-contain',
      );
      expect(tabs.length).toBeGreaterThan(8);
      tabs.forEach((tab) => expect(tab).toHaveClass('w-auto', 'flex-none'));
      expect(screen.getByRole('tab', { name: 'Future setup' })).toBeInTheDocument();
      expect(selected).toHaveAttribute('aria-selected', 'true');
      expect(selected).toHaveAttribute('data-management-section', 'communications');

      // React Aria may apply selection state after the management effect. The
      // reveal contract targets the controlled section key, not transient ARIA,
      // and retries after the tablist has acquired its scrollable layout.
      selected.removeAttribute('aria-selected');
      expect(tabList.scrollLeft).toBe(0);
      await act(async () => {
        const callbacks = [...animationFrames.values()];
        animationFrames.clear();
        callbacks.forEach((callback) => callback(performance.now()));
      });
      expect(tabList.scrollLeft).toBe(0);
      layoutReady = true;
      await act(async () => {
        const callbacks = [...animationFrames.values()];
        animationFrames.clear();
        callbacks.forEach((callback) => callback(performance.now()));
      });
      expect(scrollIntoView).toHaveBeenCalledWith({
        inline: 'nearest',
        block: 'nearest',
      });
      expect(tabList.scrollLeft).toBeGreaterThan(0);
    } finally {
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
      else Reflect.deleteProperty(window, 'innerWidth');
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
      if (originalRequestAnimationFrame) {
        Object.defineProperty(window, 'requestAnimationFrame', originalRequestAnimationFrame);
      } else {
        Reflect.deleteProperty(window, 'requestAnimationFrame');
      }
      if (originalCancelAnimationFrame) {
        Object.defineProperty(window, 'cancelAnimationFrame', originalCancelAnimationFrame);
      } else {
        Reflect.deleteProperty(window, 'cancelAnimationFrame');
      }
    }
  });

  it('links the overview only to operations granted by the event contract', async () => {
    renderManagePage();
    await screen.findByRole('heading', { level: 1, name: 'Community Garden Day' });

    expect(screen.getByRole('link', { name: 'Edit event' })).toHaveAttribute('href', '/test/events/1/edit');
    expect(screen.getByRole('link', { name: 'Manage people' })).toHaveAttribute('href', '/test/events/1/manage/people');
    expect(screen.getByRole('link', { name: 'Registration, invitations and guests' })).toHaveAttribute('href', '/test/events/1/manage/registration');
    expect(screen.getByRole('link', { name: 'Open check-in' })).toHaveAttribute('href', '/test/events/1/manage/check-in');
    expect(screen.getByRole('link', { name: 'Manage agenda' })).toHaveAttribute('href', '/test/events/1/manage/agenda');
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/test/events/1/manage/templates');
    expect(screen.getByRole('link', { name: 'Event analytics' })).toHaveAttribute('href', '/test/events/1/manage/analytics');
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/test/events/1/manage/tickets');
  });

  it('deep-links editors to the privacy-safe template library', async () => {
    renderManagePage('/test/events/1/manage/templates');

    const templatesTab = await screen.findByRole('tab', { name: 'Templates' });
    expect(templatesTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Event templates' })).toBeInTheDocument();
    expect(screen.getByText('Templates copy configuration only')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/event-templates?status=active&per_page=20');
  });

  it('deep-links authorized organizers to payload-free federation delivery status', async () => {
    renderManagePage('/test/events/1/manage/federation');

    const federationTab = await screen.findByRole('tab', { name: 'Federation' });
    expect(federationTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Federated event sharing' }))
      .toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(
      '/v2/events/1/federation-status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('deep-links organizers to privacy-safe analytics and finance-authorized ticket operations', async () => {
    const analytics = renderManagePage('/test/events/1/manage/analytics');

    expect(await screen.findByRole('tab', { name: 'Event analytics' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Event analytics' })).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(
      '/v2/events/1/analytics',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    analytics.unmount();
    renderManagePage('/test/events/1/manage/tickets');

    expect(await screen.findByRole('tab', { name: 'Tickets' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByText('No ticket types have been configured for this event.')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith(
      '/v2/events/1/tickets',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('deep-links check-in-only staff without revealing People or Team', async () => {
    const checkInOnlyEvent = createCanonicalEventFixture({
      permissions: {
        ...createCanonicalEventFixture().permissions,
        check_in: true,
      },
    });
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: checkInOnlyEvent });
      if (url.startsWith('/v2/events/1/people?')) {
        return Promise.resolve({
          success: true,
          data: [],
          meta: {
            base_url: 'https://api.example.test',
            current_page: 1,
            per_page: 25,
            total: 0,
            total_pages: 0,
            has_more: false,
            search: null,
            registration_state: null,
            waitlist_state: null,
            attendance_state: null,
            engagement_state: null,
            sort: 'name',
            direction: 'asc',
            metrics: { confirmed: 0, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
            projection: 'attendance',
            sensitive_fields_redacted: true,
            capabilities: {
              view_roster: true,
              view_waitlist: false,
              manage_registration: false,
              manage_attendance: true,
              export_people: false,
              view_history: true,
            },
          },
        });
      }
      return Promise.resolve({ success: false });
    });

    renderManagePage('/test/events/1/manage/check-in');

    const checkInTab = await screen.findByRole('tab', { name: 'Check-in' });
    expect(checkInTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Offline QR check-in' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Manual check-in' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('deep-links delegated registration managers without exposing unrelated organizer controls', async () => {
    const registrationOnlyEvent = createCanonicalEventFixture({
      permissions: {
        ...createCanonicalEventFixture().permissions,
        manage_registration: true,
      },
    });
    mockApi.get.mockImplementation((url: string) => (
      url === '/v2/events/1'
        ? Promise.resolve({ success: true, data: registrationOnlyEvent })
        : Promise.resolve({ success: false })
    ));

    renderManagePage('/test/events/1/manage/registration');

    const registrationTab = await screen.findByRole('tab', {
      name: 'Registration, invitations and guests',
    });
    expect(registrationTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Registration management workspace' }))
      .toHaveTextContent('registration-1');
    expect(screen.queryByRole('tab', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('deep-links delegated broadcasters without exposing unrelated organizer controls', async () => {
    const broadcastOnlyEvent = createCanonicalEventFixture({
      permissions: {
        ...createCanonicalEventFixture().permissions,
        broadcast: true,
      },
    });
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: broadcastOnlyEvent });
      if (url === '/v2/events/1/broadcasts?page=1&per_page=20') {
        return Promise.resolve({
          success: true,
          data: [],
          meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false },
        });
      }
      return Promise.resolve({ success: false });
    });

    renderManagePage('/test/events/1/manage/communications');

    const communicationsTab = await screen.findByRole('tab', { name: 'Organizer communications' });
    expect(communicationsTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Organizer communications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New message' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Event analytics' })).not.toBeInTheDocument();
  });

  it('normalizes legacy tab queries and permission-gates unknown sections', async () => {
    const { router } = renderManagePage('/test/events/1/manage?tab=team');
    expect(await screen.findByRole('heading', { name: 'Add a team member' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true');

    await router.navigate('/test/events/1/manage/not-a-section');
    expect(await screen.findByRole('heading', { name: 'Operational overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('previews the privacy-safe People CSV fields before starting a download', async () => {
    mockApi.download.mockResolvedValue(new Blob(['member_id,member_name']));
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: manageableEvent });
      if (url === '/v2/events/1/staff?include_inactive=true') {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.startsWith('/v2/events/1/people?')) {
        return Promise.resolve({
          success: true,
          data: [],
          meta: {
            base_url: 'https://api.example.test',
            current_page: 1,
            per_page: 25,
            total: 17,
            total_pages: 1,
            has_more: false,
            search: null,
            registration_state: null,
            waitlist_state: null,
            attendance_state: null,
            engagement_state: null,
            sort: 'name',
            direction: 'asc',
            metrics: { confirmed: 12, waitlisted: 2, checked_in: 3, checked_out: 1, no_show: 0, attended: 4 },
            projection: 'full',
            sensitive_fields_redacted: true,
            capabilities: {
              view_roster: true,
              view_waitlist: true,
              manage_registration: true,
              manage_attendance: true,
              export_people: true,
              view_history: true,
            },
          },
        });
      }
      return Promise.resolve({ success: false });
    });
    const user = userEvent.setup();
    renderManagePage('/test/events/1/manage/people');

    const exportButton = await screen.findByRole('button', { name: 'Export CSV' });
    await user.click(exportButton);

    expect(await screen.findByRole('dialog')).toHaveTextContent('Review People CSV export');
    expect(screen.getByText('Registration form answers and custom question responses')).toBeInTheDocument();
    expect(screen.getByText('Incident, safeguarding and case-management records')).toBeInTheDocument();
    expect(screen.getByText('Health, accessibility, accommodation and private support notes')).toBeInTheDocument();
    expect(mockApi.download).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Download privacy-safe CSV' }));
    await waitFor(() => expect(mockApi.download).toHaveBeenCalledTimes(1));
  });

  it('paginates a member audit history instead of silently truncating it', async () => {
    const person = {
      member: { id: 7, display_name: 'Alex Member', avatar_url: null },
      engagement: { state: 'none', consumes_capacity: false },
      registration: {
        id: 21,
        state: 'confirmed',
        version: 1,
        capacity_pool_key: 'event',
        allocation_key: null,
        changed_at: '2030-01-01T09:00:00Z',
        confirmed_at: '2030-01-01T09:00:00Z',
      },
      waitlist: {
        id: null,
        state: null,
        version: null,
        position: null,
        sequence: null,
        offered_at: null,
        offer_expires_at: null,
        accepted_at: null,
      },
      attendance: {
        id: null,
        state: 'not_checked_in',
        version: null,
        changed_at: null,
        checked_in_at: null,
        checked_out_at: null,
      },
      management_actions: {
        approve: false,
        reject: false,
        cancel: true,
        check_in: true,
        check_out: false,
        no_show: true,
        undo_attendance: false,
        idempotency_key_required: true,
      },
      privacy: { sensitive_fields_redacted: true },
    } as const;
    const historyEntry = (entryId: number, version: number, reason: string) => ({
      axis: 'registration' as const,
      entry_id: entryId,
      version,
      sequence: null,
      action: 'confirmed',
      from_state: version === 1 ? null : 'pending',
      to_state: 'confirmed',
      actor: { id: 3, display_name: 'Event Manager' },
      reason,
      created_at: `2030-01-0${version}T10:00:00Z`,
    });

    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/events/1') return Promise.resolve({ success: true, data: manageableEvent });
      if (url === '/v2/events/1/staff?include_inactive=true') {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.startsWith('/v2/events/1/people?')) {
        return Promise.resolve({
          success: true,
          data: [person],
          meta: {
            base_url: 'https://api.example.test',
            current_page: 1,
            per_page: 25,
            total: 1,
            total_pages: 1,
            has_more: false,
            search: null,
            registration_state: null,
            waitlist_state: null,
            attendance_state: null,
            engagement_state: null,
            sort: 'name',
            direction: 'asc',
            metrics: {
              confirmed: 1,
              waitlisted: 0,
              checked_in: 0,
              checked_out: 0,
              no_show: 0,
              attended: 0,
            },
            projection: 'full',
            sensitive_fields_redacted: true,
            capabilities: {
              view_roster: true,
              view_waitlist: true,
              manage_registration: true,
              manage_attendance: true,
              export_people: true,
              view_history: true,
            },
          },
        });
      }
      if (url === '/v2/events/1/people/7/history?page=1&per_page=100') {
        return Promise.resolve({
          success: true,
          data: [historyEntry(31, 1, 'Initial approval')],
          meta: {
            base_url: 'https://api.example.test',
            current_page: 1,
            per_page: 100,
            total: 2,
            total_pages: 2,
            has_more: true,
            projection: 'full',
            sensitive_fields_redacted: true,
          },
        });
      }
      if (url === '/v2/events/1/people/7/history?page=2&per_page=100') {
        return Promise.resolve({
          success: true,
          data: [historyEntry(32, 2, 'On-site correction')],
          meta: {
            base_url: 'https://api.example.test',
            current_page: 2,
            per_page: 100,
            total: 2,
            total_pages: 2,
            has_more: false,
            projection: 'full',
            sensitive_fields_redacted: true,
          },
        });
      }
      return Promise.resolve({ success: false });
    });

    const user = userEvent.setup();
    renderManagePage('/test/events/1/manage/people');

    await screen.findByText('Alex Member');
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('Initial approval')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more (1 remaining)' }));
    expect(await screen.findByText('On-site correction')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
  });

  it('does not request staff and shows an access boundary without implemented server permissions', async () => {
    const inaccessibleEvent = createCanonicalEventFixture();
    mockApi.get.mockResolvedValue({ success: true, data: inaccessibleEvent });
    renderManagePage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Event management is not available');
    expect(mockApi.get).toHaveBeenCalledTimes(1);
    expect(mockApi.get).toHaveBeenCalledWith('/v2/events/1', expect.anything());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('offers a retryable error when the event contract cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false });
    renderManagePage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load event management');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled());
  });
});
