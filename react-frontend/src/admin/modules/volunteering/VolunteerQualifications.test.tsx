// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import { createUser } from '@/test/factories';
import React from 'react';
import type { AdminVolunteerQualification } from '@/admin/api/types';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    listQualifications: vi.fn(),
    confirmQualification: vi.fn(),
    withdrawQualification: vi.fn(),
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
    useAuth: () => ({
      user: createUser({ id: 1, name: 'Admin User' }),
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
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
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeQualification(overrides: Partial<AdminVolunteerQualification> = {}): AdminVolunteerQualification {
  return {
    id: 100,
    user_id: 10,
    qualification_type: 'first_aid',
    type_label_key: 'qualifications.types.first_aid',
    title: null,
    issuer: 'Red Cross',
    reference_number: 'FA-123',
    obtained_at: '2025-01-10',
    expires_at: isoDaysFromNow(12),
    status: 'recorded',
    is_expiring: true,
    days_until_expiry: 12,
    confirmed_by: null,
    confirmed_at: null,
    confirmation_method: null,
    confirmed_for_organization: null,
    withdrawn_at: null,
    withdrawal_reason: null,
    notes: null,
    created_at: '2025-01-10T10:00:00Z',
    updated_at: '2025-01-10T10:00:00Z',
    volunteer: { id: 10, name: 'Alice Brown', avatar_url: null },
    ...overrides,
  };
}

const okList = (items = [makeQualification()], total = items.length) => ({
  success: true,
  data: {
    items,
    total,
    counts: { expiring: 1, recorded: 2, confirmed: 3, expired: 4 },
  },
});

async function renderPage() {
  const mod = await import('./VolunteerQualifications');
  const Component = mod.default;
  render(<Component />);
}

const lastParams = () => mockAdminVolunteering.listQualifications.mock.calls.slice(-1)[0]?.[0] as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerQualifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/volunteering/qualifications');
    mockAdminVolunteering.listQualifications.mockResolvedValue(okList());
    mockAdminVolunteering.confirmQualification.mockResolvedValue({ success: true, data: makeQualification({ status: 'confirmed' }) });
    mockAdminVolunteering.withdrawQualification.mockResolvedValue({ success: true, data: makeQualification({ status: 'withdrawn' }) });
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('opens on the "needs attention" view and shows the register', async () => {
    await renderPage();
    await screen.findByText('Alice Brown');

    expect(lastParams()).toMatchObject({ status: 'attention', page: 1, per_page: 20 });
    expect(screen.getByRole('heading', { name: 'Qualifications' })).toBeInTheDocument();
    // The type label also appears as an option in the type filter, so target the row heading.
    expect(screen.getByRole('heading', { name: 'First aid' })).toBeInTheDocument();
    expect(screen.getByText(/Ref\. FA-123/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alice Brown/ })).toHaveAttribute('href', '/test/admin/users/10/edit');
    expect(screen.getByText('1 qualifications')).toBeInTheDocument();
  });

  it('reads the filters from the address', async () => {
    window.history.pushState({}, '', '/admin/volunteering/qualifications?status=expired&type=food_hygiene&q=ali&page=2');
    await renderPage();
    await screen.findByText('Alice Brown');
    expect(lastParams()).toMatchObject({ status: 'expired', type: 'food_hygiene', q: 'ali', page: 2 });
    expect(screen.getByRole('radio', { name: 'Expired' })).toBeChecked();
  });

  it('writes a filter change to the address and starts from page 1', async () => {
    window.history.pushState({}, '', '/admin/volunteering/qualifications?page=3');
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('radio', { name: 'Confirmed' }));
    await waitFor(() => expect(window.location.search).toBe('?status=confirmed'));
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'confirmed', page: 1 }));

    // "All" is sent as no status at all.
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(window.location.search).toBe('?status=all'));
    await waitFor(() => expect(lastParams().status).toBeUndefined());
  });

  it('sends the search text after a pause and clears every filter', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Alice Brown');

    await user.type(screen.getByPlaceholderText('Search volunteers'), 'ali');
    await waitFor(() => expect(window.location.search).toBe('?q=ali'));
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'ali' }));

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('confirms with the chosen method and no organisation', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/You are confirming that Alice Brown holds this qualification/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'The issuer confirmed it' }));
    await user.click(within(dialog).getByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockAdminVolunteering.confirmQualification).toHaveBeenCalledWith(100, 'issuer_confirmed');
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification confirmed.'));
    await waitFor(() => expect(mockAdminVolunteering.listQualifications).toHaveBeenCalledTimes(2));
  });

  it('withdraws with the chosen reason', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Entered by mistake' }));
    await user.click(within(dialog).getByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockAdminVolunteering.withdrawQualification).toHaveBeenCalledWith(100, 'entered_in_error');
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification withdrawn.'));
  });

  it('disables Confirm on an expired record and on the caller\'s own record', async () => {
    mockAdminVolunteering.listQualifications.mockResolvedValue(okList([
      makeQualification({ id: 7, status: 'expired', is_expiring: false, days_until_expiry: -2, expires_at: isoDaysFromNow(-2) }),
      makeQualification({ id: 8, user_id: 1, volunteer: { id: 1, name: 'Admin User', avatar_url: null } }),
    ]));
    await renderPage();
    await screen.findByText('Alice Brown');

    const confirmButtons = screen.getAllByRole('button', { name: 'Confirm' });
    expect(confirmButtons).toHaveLength(2);
    confirmButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('shows who a qualification was confirmed for', async () => {
    mockAdminVolunteering.listQualifications.mockResolvedValue(okList([
      makeQualification({
        id: 9,
        status: 'confirmed',
        is_expiring: false,
        expires_at: isoDaysFromNow(400),
        confirmed_by: { id: 3, name: 'Bea Coordinator' },
        confirmed_at: '2026-09-01T09:00:00Z',
        confirmation_method: 'saw_original',
        confirmed_for_organization: { id: 42, name: 'Community Helpers' },
      }),
      makeQualification({
        id: 10,
        status: 'confirmed',
        is_expiring: false,
        expires_at: null,
        confirmed_by: { id: 1, name: 'Admin User' },
        confirmed_at: '2026-09-02T09:00:00Z',
        confirmation_method: 'online_register',
        confirmed_for_organization: null,
      }),
    ]));
    await renderPage();
    await screen.findByText(/Confirmed for: Community Helpers/);
    expect(screen.getByText(/Confirmed for: Community staff/)).toBeInTheDocument();
    expect(screen.getByText('No expiry date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('paginates through the address', async () => {
    mockAdminVolunteering.listQualifications.mockResolvedValue(okList([makeQualification()], 45));
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Alice Brown');

    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^2$|page 2/i }));
    await waitFor(() => expect(window.location.search).toBe('?page=2'));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));
  });

  it('offers to clear the filters when nothing matches', async () => {
    window.history.pushState({}, '', '/admin/volunteering/qualifications?status=withdrawn');
    mockAdminVolunteering.listQualifications.mockResolvedValue(okList([]));
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('No qualifications match');

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('shows an error with a retry when the first load fails', async () => {
    mockAdminVolunteering.listQualifications.mockResolvedValueOnce({ success: false, error: 'boom', code: 'SERVER_ERROR' });
    const user = userEvent.setup();
    await renderPage();
    await screen.findByText('Unable to load qualifications.');

    mockAdminVolunteering.listQualifications.mockResolvedValue(okList());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Alice Brown');
  });
});
