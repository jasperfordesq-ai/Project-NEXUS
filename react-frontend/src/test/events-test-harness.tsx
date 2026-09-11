// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactElement, ReactNode } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import {
  MemoryRouter,
  useNavigate,
  useRoutes,
  type NavigateFunction,
  type RouteObject,
} from 'react-router-dom';
import {
  act,
  render as testingLibraryRender,
  type RenderOptions,
} from '@testing-library/react';
import type { Event } from '@/lib/events-api';

export function createCanonicalEventFixture(overrides: Partial<Event> = {}): Event {
  return {
    contract_version: 2,
    id: 1,
    title: 'Community Garden Day',
    description: 'Join us for a community garden event',
    primary_image: null,
    organizer: {
      id: 5,
      display_name: 'Morgan Organiser',
      avatar_url: null,
      relationship: 'member',
      actions: { view_profile: true, message: false },
    },
    category: { id: 3, name: 'Outdoor', slug: 'outdoor', colour: null },
    location: { label: 'Dublin Park', latitude: 53.3498, longitude: -6.2603, mode: 'in_person' },
    schedule: {
      start_at: '2030-06-01T10:00:00Z',
      end_at: '2030-06-01T14:00:00Z',
      timezone: 'UTC',
      all_day: false,
      state: 'upcoming',
      publication_state: 'published',
      operational_state: 'scheduled',
      lifecycle_version: 1,
      cancellation_reason: null,
    },
    relationship: {
      engagement: { state: 'none', can_change: true },
      registration: {
        state: 'none',
        waitlist_position: null,
        can_register: true,
        can_withdraw: false,
        can_join_waitlist: false,
        can_leave_waitlist: false,
      },
      attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
      capacity: { limit: 50, confirmed: 10, remaining: 40, is_full: false, waitlist_count: 0 },
    },
    online_access: {
      mode: 'in_person',
      reveal_state: 'not_applicable',
      join_url: null,
      video_url: null,
      reveal_at: null,
      expires_at: null,
    },
    series: { named: null, recurrence: null },
    permissions: {
      edit: false,
      cancel: false,
      manage_people: false,
      check_in: false,
      message: false,
      export: false,
      publish: false,
      submit_for_review: false,
      manage_agenda: false,
      manage_staff: false,
      manage_registration: false,
      broadcast: false,
      manage_finance: false,
      reconcile_credits: false,
      reconcile_tickets: false,
      transfer_ownership: false,
    },
    metrics: { confirmed_count: 10, interested_count: 3, waitlist_count: 0 },
    created_at: '2026-01-01T10:00:00Z',
    updated_at: null,
    group: null,
    ...overrides,
  };
}

interface EventRouteRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  path?: string;
  routes?: RouteObject[];
}

function EventTestRoutes({
  routes,
  captureNavigate,
}: {
  routes: RouteObject[];
  captureNavigate: (navigate: NavigateFunction) => void;
}) {
  captureNavigate(useNavigate());
  return useRoutes(routes);
}

/**
 * Render an Events page with a real in-memory router and Helmet provider.
 *
 * Events tests used to combine BrowserRouter with mocked router hooks, which
 * hid route-transition regressions and produced provider-order failures. This
 * harness keeps route params and navigation real while opting into React
 * Router's v7 compatibility flags so strict-console test runs stay quiet.
 */
export function renderEventRoute(
  ui: ReactElement,
  {
    route = '/test/events',
    path = '/:tenantSlug/events',
    routes,
    ...renderOptions
  }: EventRouteRenderOptions = {},
) {
  let navigate: NavigateFunction | undefined;

  const result = testingLibraryRender(
    <HelmetProvider>
      <MemoryRouter
        initialEntries={[route]}

      >
        <EventTestRoutes
          routes={routes ?? [{ path, element: ui }]}
          captureNavigate={(nextNavigate) => { navigate = nextNavigate; }}
        />
      </MemoryRouter>
    </HelmetProvider>,
    renderOptions,
  );

  return {
    ...result,
    router: {
      navigate: async (to: string) => {
        if (!navigate) throw new Error('Events test router is not ready');
        await act(async () => {
          navigate?.(to);
          await Promise.resolve();
        });
      },
    },
  };
}

/** Render an Events component that does not need a router. */
export function renderEventComponent(
  ui: ReactElement,
  renderOptions?: Omit<RenderOptions, 'wrapper'>,
) {
  return testingLibraryRender(
    <HelmetProvider>{ui}</HelmetProvider>,
    renderOptions,
  );
}

/** Lightweight labelled input for page tests that are not testing a calendar. */
export function EventDateOrTimeInputStub({
  label,
  value,
  isInvalid,
  errorMessage,
}: {
  label: ReactNode;
  value?: { toString(): string } | null;
  isInvalid?: boolean;
  errorMessage?: ReactNode;
}) {
  const accessibleLabel = typeof label === 'string' ? label : undefined;

  return (
    <label>
      {label}
      <input
        aria-label={accessibleLabel}
        aria-invalid={isInvalid || undefined}
        value={value?.toString() ?? ''}
        readOnly
      />
      {isInvalid && errorMessage ? <span>{errorMessage}</span> : null}
    </label>
  );
}
