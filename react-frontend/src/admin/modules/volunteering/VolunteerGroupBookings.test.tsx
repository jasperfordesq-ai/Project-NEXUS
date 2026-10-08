// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { AdminVolunteerGroupReservation } from '@/admin/api/types';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    listGroupReservations: vi.fn(),
    cancelGroupReservation: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeBooking(overrides: Partial<AdminVolunteerGroupReservation> = {}): AdminVolunteerGroupReservation {
  return {
    id: 7,
    status: 'active',
    reserved_slots: 3,
    filled_slots: 1,
    notes: 'Bringing our own gloves',
    created_at: '2026-10-01T10:00:00Z',
    shift: { id: 10, start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T12:00:00Z' },
    opportunity: { id: 3, title: 'Beach Litter Pick' },
    organization: { id: 5, name: 'Coastal Care' },
    group: { id: 9, name: 'Sandcastle Crew' },
    leader: { id: 10, name: 'Larry Leader', avatar_url: null },
    members: [{ id: 11, name: 'Mina Member', avatar_url: null }],
    ...overrides,
  };
}

const okList = (items = [makeBooking()], total = items.length) => ({
  success: true,
  data: { items, total, counts: { active: 4, cancelled: 1 } },
});

async function renderPage() {
  const mod = await import('./VolunteerGroupBookings');
  const Component = mod.default;
  render(<Component />);
}

const lastParams = () => mockAdminVolunteering.listGroupReservations.mock.calls.slice(-1)[0]?.[0] as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerGroupBookings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/volunteering/group-bookings');
    mockAdminVolunteering.listGroupReservations.mockResolvedValue(okList());
    mockAdminVolunteering.cancelGroupReservation.mockResolvedValue({ success: true, data: { cancelled: true } });
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('lists the group bookings with shift, group, leader, places and members', async () => {
    await renderPage();
    await screen.findByText('Sandcastle Crew');

    expect(lastParams()).toEqual({ page: 1, per_page: 20 });
    expect(screen.getByRole('heading', { name: 'Group bookings' })).toBeInTheDocument();
    expect(screen.getByText('Larry Leader')).toBeInTheDocument();
    expect(screen.getByText(/Beach Litter Pick/)).toBeInTheDocument();
    expect(screen.getByText(/Coastal Care/)).toBeInTheDocument();
    expect(screen.getByText(/Places: 1 of 3 filled/)).toBeInTheDocument();
    expect(screen.getByText(/Mina Member/)).toBeInTheDocument();
    expect(screen.getByText(/Bringing our own gloves/)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('filters to cancelled bookings through the address', async () => {
    await renderPage();
    await screen.findByText('Sandcastle Crew');

    const group = screen.getByRole('radiogroup', { name: 'Status' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Cancelled' }));

    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'cancelled' }));
    expect(window.location.search).toContain('status=cancelled');
  });

  it('cancels a booking after confirmation, then reloads', async () => {
    await renderPage();
    await screen.findByText('Sandcastle Crew');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/3 places reserved for Sandcastle Crew on Beach Litter Pick/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));

    await waitFor(() => expect(mockAdminVolunteering.cancelGroupReservation).toHaveBeenCalledWith(7));
    expect(mockToast.success).toHaveBeenCalledWith('Group booking cancelled.');
    expect(mockAdminVolunteering.listGroupReservations).toHaveBeenCalledTimes(2);
  });

  it('shows a cancelled booking as cancelled and offers no cancel', async () => {
    mockAdminVolunteering.listGroupReservations.mockResolvedValue(okList([
      makeBooking({ status: 'cancelled', members: [] }),
    ]));
    await renderPage();
    await screen.findByText('Sandcastle Crew');

    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(screen.getByText(/No members named yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mockAdminVolunteering.listGroupReservations.mockResolvedValue({ success: false, error: 'boom' });
    await renderPage();

    expect(await screen.findByText('The group bookings could not be loaded.')).toBeInTheDocument();
  });
});
