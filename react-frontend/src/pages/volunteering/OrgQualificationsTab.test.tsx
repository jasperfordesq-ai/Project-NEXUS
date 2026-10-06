// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { api } from '@/lib/api';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Org Owner' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, resolveAvatarUrl: (url: string | null) => url ?? '' };
});

import OrgQualificationsTab, { type OrgQualification } from './OrgQualificationsTab';

const ORG_ID = 42;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeQualification(overrides: Partial<OrgQualification> = {}): OrgQualification {
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

function listResponse(items: OrgQualification[], extra: Partial<{ counts: Record<string, number>; next_cursor: string | null }> = {}) {
  return {
    success: true,
    data: {
      items,
      counts: { expiring: 1, recorded: 2, confirmed: 3, expired: 4, ...(extra.counts ?? {}) },
      next_cursor: extra.next_cursor ?? null,
    },
  };
}

describe('OrgQualificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(listResponse([makeQualification()]));
    vi.mocked(api.post).mockResolvedValue({ success: true, data: makeQualification({ status: 'confirmed' }) });
  });

  it('loads the "needs attention" view by default, scoped to the organisation', async () => {
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    const url = vi.mocked(api.get).mock.calls[0]?.[0] as string;
    expect(url).toContain(`/v2/volunteering/organizations/${ORG_ID}/qualifications?`);
    expect(url).toContain('status=attention');
    expect(url).toContain('per_page=20');

    // Intro, tiles and the type label from the volunteering namespace.
    expect(screen.getByText(/Do not upload or store copies here/)).toBeInTheDocument();
    expect(screen.getByText('Awaiting confirmation', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('First aid')).toBeInTheDocument();
    expect(screen.getByText(/Ref\. FA-123/)).toBeInTheDocument();
    expect(screen.getByText('1 qualification')).toBeInTheDocument();
    // Volunteer name links to the profile.
    expect(screen.getByRole('link', { name: /Alice Brown/ })).toHaveAttribute('href', '/test/profile/10');
  });

  it('sends the chosen filter and the search text to the API', async () => {
    const user = userEvent.setup();
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('radio', { name: 'Expired' }));
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('status=expired'))).toBe(true);
    });

    await user.click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => {
      const last = vi.mocked(api.get).mock.calls.slice(-1)[0]?.[0] as string;
      expect(last).not.toContain('status=');
    });

    await user.type(screen.getByPlaceholderText('Search volunteers'), 'ali');
    await waitFor(() => {
      const last = vi.mocked(api.get).mock.calls.slice(-1)[0]?.[0] as string;
      expect(last).toContain('q=ali');
    });
  });

  it('confirms with the chosen method and the organisation id', async () => {
    const user = userEvent.setup();
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/You are confirming that Alice Brown holds this qualification/)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'I saw the original certificate' })).toBeChecked();

    await user.click(within(dialog).getByRole('radio', { name: 'I checked an online register' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/qualifications/100/confirm', {
        method: 'online_register',
        organization_id: ORG_ID,
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification confirmed.'));
    // The list is reloaded after a confirmation.
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('disables Confirm on an expired record and explains why', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([
      makeQualification({ id: 7, status: 'expired', is_expiring: false, days_until_expiry: -3, expires_at: isoDaysFromNow(-3) }),
    ]));
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText(/Expired/, { selector: 'span' })).toBeInTheDocument();
    // Withdraw is still offered on an expired record.
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  it('never offers Confirm on the caller\'s own record', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([
      makeQualification({ id: 8, user_id: 1, volunteer: { id: 1, name: 'Org Owner', avatar_url: null } }),
    ]));
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Org Owner');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('withdraws with the chosen reason', async () => {
    const user = userEvent.setup();
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'No longer held' }));
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/qualifications/100/withdraw', { reason: 'no_longer_held' });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification withdrawn.'));
  });

  it('shows the confirmation line on a confirmed record', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([
      makeQualification({
        id: 9,
        status: 'confirmed',
        is_expiring: false,
        expires_at: isoDaysFromNow(400),
        confirmed_by: { id: 3, name: 'Bea Coordinator' },
        confirmed_at: '2026-09-01T09:00:00Z',
        confirmation_method: 'issuer_confirmed',
        confirmed_for_organization: { id: ORG_ID, name: 'Community Helpers' },
      }),
    ]));
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');
    expect(screen.getByText(/Confirmed by Bea Coordinator for Community Helpers on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('loads the next page with the cursor', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockResolvedValueOnce(listResponse([makeQualification()], { next_cursor: 'abc' }))
      .mockResolvedValueOnce(listResponse([makeQualification({ id: 101, volunteer: { id: 11, name: 'Bob Green', avatar_url: null } })]));
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    await screen.findByText('Alice Brown');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Bob Green');
    const second = vi.mocked(api.get).mock.calls[1]?.[0] as string;
    expect(second).toContain('cursor=abc');
    expect(screen.getByText('Alice Brown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing needs attention', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([]));
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    expect(await screen.findByText('Nothing needs your attention')).toBeInTheDocument();
  });

  it('shows an error with a retry when the load fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'boom', code: 'SERVER_ERROR' });
    render(<OrgQualificationsTab orgId={ORG_ID} />);
    expect(await screen.findByText('Unable to load qualifications.')).toBeInTheDocument();

    vi.mocked(api.get).mockResolvedValue(listResponse([makeQualification()]));
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await screen.findByText('Alice Brown');
  });
});
