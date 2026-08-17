// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanonicalEventFixture, renderEventRoute } from '@/test/events-test-harness';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockToast, mockLogError, mockAuthUser } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockLogError: vi.fn(),
  // Mutable so a test can flip the server-supplied Event-creation capability.
  mockAuthUser: { current: { id: 1, name: 'Alice' } as { id: number; name: string; can_create_events?: boolean } },
}));

vi.mock('@/lib/api', () => ({ api: mockApi }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (path: string) => `/test${path}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
    useAuth: () => ({
      user: mockAuthUser.current,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: mockLogError }));

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: Array<{ label: string }> }) => (
    <nav aria-label="Breadcrumb">
      {items.map((item) => <span key={item.label}>{item.label}</span>)}
    </nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => (
    <div role="status" aria-label={message} aria-busy="true" />
  ),
}));

vi.mock('@/components/ui/DatePicker', async () => {
  const { parseDate } = await import('@internationalized/date');
  return {
    DatePicker: ({ label, value, onChange, isInvalid, errorMessage }: {
      label: string;
      value?: { toString(): string } | null;
      onChange?: (value: ReturnType<typeof parseDate>) => void;
      isInvalid?: boolean;
      errorMessage?: React.ReactNode;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          aria-invalid={isInvalid || undefined}
          value={value?.toString() ?? ''}
          onChange={(event) => event.target.value && onChange?.(parseDate(event.target.value))}
        />
        {isInvalid && errorMessage ? <span>{errorMessage}</span> : null}
      </label>
    ),
  };
});

vi.mock('@/components/ui/TimeInput', async () => {
  const { parseTime } = await import('@internationalized/date');
  return {
    TimeInput: ({ label, value, onChange, isInvalid, errorMessage }: {
      label: string;
      value?: { toString(): string } | null;
      onChange?: (value: ReturnType<typeof parseTime>) => void;
      isInvalid?: boolean;
      errorMessage?: React.ReactNode;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          aria-invalid={isInvalid || undefined}
          value={value?.toString() ?? ''}
          onChange={(event) => event.target.value && onChange?.(parseTime(event.target.value))}
        />
        {isInvalid && errorMessage ? <span>{errorMessage}</span> : null}
      </label>
    ),
  };
});

vi.mock('@/components/ui/Select', () => ({
  Select: ({ label, 'aria-label': ariaLabel, selectedKeys, onChange, children }: {
    label?: React.ReactNode;
    'aria-label'?: string;
    selectedKeys?: Iterable<string>;
    onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
    children?: React.ReactNode;
  }) => (
    <label>
      {label}
      <select
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        value={Array.from(selectedKeys ?? [])[0] ?? ''}
        onChange={(event) => onChange?.({ target: { value: event.target.value }, currentTarget: { value: event.target.value } })}
      >
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ id, children }: { id?: string; children?: React.ReactNode }) => <option value={id}>{children}</option>,
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

import { CreateEventPage } from './CreateEventPage';

async function renderCreateEventPage() {
  renderEventRoute(<CreateEventPage />, {
    route: '/test/events/create',
    path: '/:tenantSlug/events/create',
  });

  await screen.findByRole('heading', { level: 1, name: 'Create New Event' });
  await waitFor(() => {
    expect(mockApi.get).toHaveBeenCalledWith('/v2/polls?status=all&limit=100');
  });
}

describe('CreateEventPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthUser.current = { id: 1, name: 'Alice' };
    mockApi.get.mockImplementation((endpoint: string) => Promise.resolve({
      success: true,
      data: endpoint === '/v2/events/recurrence-capabilities'
        ? {
            contract_version: 1,
            engine: 'v2',
            structured_input: true,
            supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
            max_occurrences: 366,
            supported_end_types: ['after_count', 'on_date', 'never'],
            supports_rolling_never: true,
            supports_effective_revisions: true,
            supports_definition_blueprints: false,
            schema_ready: true,
            rollout_state: 'v2_rolling',
          }
        : [],
    }));
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  /**
   * A community can restrict Event creation to brokers/admins. The server refuses
   * the POST regardless; this stops the page presenting a long form that cannot
   * be submitted, which is what used to happen.
   */
  it('refuses the create form when the community restricts Event creation', async () => {
    mockAuthUser.current = { id: 1, name: 'Alice', can_create_events: false };
    await renderEventRoute(<CreateEventPage />);

    expect(await screen.findByText(/only staff can create events here/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /title/i })).not.toBeInTheDocument();
  });

  /**
   * 🔴 The restriction is on CREATING. Editing an existing Event is governed by
   * the Event policy (organiser / delegated staff / admin), so an organiser whose
   * community later restricted creation must still be able to edit what they own.
   */
  it('still allows editing an existing Event when creation is restricted', async () => {
    mockAuthUser.current = { id: 1, name: 'Alice', can_create_events: false };
    // A real event payload, so this asserts the edit FORM renders rather than
    // passing vacuously against the "unable to load" screen.
    const existing = createCanonicalEventFixture({ id: 5, title: 'Existing Event' });
    mockApi.get.mockImplementation((endpoint: string) => Promise.resolve(
      endpoint.startsWith('/v2/events/5')
        ? { success: true, data: existing }
        : { success: true, data: [] },
    ));

    await renderEventRoute(<CreateEventPage />, { route: '/test/events/edit/5', path: '/test/events/edit/:id' });

    expect(await screen.findByDisplayValue('Existing Event')).toBeInTheDocument();
    expect(screen.queryByText(/only staff can create events here/i)).not.toBeInTheDocument();
  });

  it('renders the create-event heading', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Create New Event' })).toBeInTheDocument();
  });

  it('renders an accessible title input', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('textbox', { name: 'Event Title' })).toBeInTheDocument();
  });

  it('renders a tenant-aware Cancel link', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/test/events');
  });

  it('renders an accessible description textarea', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
  });

  it('renders an accessible start-date control', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('textbox', { name: 'Start Date' })).toBeInTheDocument();
  });

  it('exposes the canonical timezone and all-day schedule controls', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('textbox', { name: 'Event time zone' })).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const allDay = screen.getByRole('switch', { name: 'All-day event' });
    expect(allDay).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Start Time' })).toBeInTheDocument();

    fireEvent.click(allDay);

    expect(allDay).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Start Time' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Final event day' })).toBeInTheDocument();
  });

  it('renders the max-attendees number input', async () => {
    await renderCreateEventPage();

    expect(screen.getByRole('spinbutton', { name: 'Max Attendees (optional)' })).toBeInTheDocument();
  });

  it('shows concrete validation errors and blocks the mutation for an empty form', async () => {
    await renderCreateEventPage();

    const titleInput = screen.getByRole('textbox', { name: 'Event Title' });
    const form = titleInput.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Description is required')).toBeInTheDocument();
    expect(screen.getByText('Start date is required')).toBeInTheDocument();
    expect(screen.getByText('Start time is required')).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalledWith(
      'Please fix the highlighted fields before saving',
    );
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('submits yearly never-ending recurrence as structured fields only', async () => {
    const eventFixture = await import('../../../../contracts/events/v2/event-detail.json');
    mockApi.post.mockResolvedValue({
      success: true,
      data: { template: eventFixture.default, occurrences_created: 0 },
    });
    await renderCreateEventPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Event Title' }), { target: { value: 'Yearly community assembly' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'A detailed annual gathering for the whole community.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Start Date' }), { target: { value: '2099-05-01' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Start Time' }), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle recurring event' }));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
      '/v2/events/recurrence-capabilities',
      expect.any(Object),
    ));
    expect(mockLogError).not.toHaveBeenCalled();
    await screen.findByRole('option', { name: 'Never (rolling schedule)' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Recurrence frequency' }), { target: { value: 'yearly' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'How the series ends' }), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      '/v2/events/recurring',
      expect.objectContaining({
        recurrence_frequency: 'yearly',
        recurrence_interval: 1,
        recurrence_ends_type: 'never',
      }),
      expect.any(Object),
    ));
    const recurringPayload = mockApi.post.mock.calls.find(([path]) => path === '/v2/events/recurring')?.[1];
    expect(recurringPayload).not.toHaveProperty('recurrence_rule');
    expect(recurringPayload).not.toHaveProperty('recurrence_rrule');
    expect(recurringPayload).not.toHaveProperty('recurrence_days');
  });

  it('renders the legacy runtime maximum in both the input and translated helper copy', async () => {
    mockApi.get.mockImplementation((endpoint: string) => Promise.resolve({
      success: endpoint !== '/v2/events/recurrence-capabilities',
      data: endpoint === '/v2/events/recurrence-capabilities' ? undefined : [],
    }));
    await renderCreateEventPage();

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle recurring event' }));

    expect(screen.getByRole('spinbutton', { name: 'Number of occurrences' })).toHaveAttribute('max', '52');
    expect(screen.getByText('Between 2 and 52 occurrences')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Never (rolling schedule)' })).not.toBeInTheDocument();
  });
});
