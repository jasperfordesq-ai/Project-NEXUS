// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { AdminVolunteerCertificate } from '@/admin/api/types';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    listCertificates: vi.fn(),
    downloadCertificate: vi.fn(),
    revokeCertificate: vi.fn(),
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
function makeCertificate(overrides: Partial<AdminVolunteerCertificate> = {}): AdminVolunteerCertificate {
  return {
    id: 7,
    verification_code: 'ABCD1234EFGH5678',
    total_hours: 24.5,
    date_range: { start: '2026-03-01', end: '2026-06-30' },
    organizations: [{ name: 'Food Bank', hours: 24.5 }],
    generated_at: '2026-07-01T10:00:00Z',
    downloaded_at: null,
    revoked_at: null,
    revoke_reason: null,
    verification_url: 'https://example.test/verify',
    volunteer: { id: 10, name: 'Ada Lovelace', email: 'ada@example.test', avatar_url: null },
    ...overrides,
  };
}

const okList = (items = [makeCertificate()], total = items.length) => ({
  success: true,
  data: { items, total, counts: { active: 5, revoked: 2 } },
});

async function renderPage() {
  const mod = await import('./VolunteerCertificates');
  const Component = mod.default;
  render(<Component />);
}

const lastParams = () => mockAdminVolunteering.listCertificates.mock.calls.slice(-1)[0]?.[0] as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerCertificates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/volunteering/certificates');
    mockAdminVolunteering.listCertificates.mockResolvedValue(okList());
    mockAdminVolunteering.downloadCertificate.mockResolvedValue(new Blob());
    mockAdminVolunteering.revokeCertificate.mockResolvedValue({ success: true, data: { revoked: true } });
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('lists the community certificates with their counts', async () => {
    await renderPage();
    await screen.findByText('Ada Lovelace');

    expect(lastParams()).toEqual({ page: 1, per_page: 20 });
    expect(screen.getByRole('heading', { name: 'Certificates' })).toBeInTheDocument();
    expect(screen.getByText('Verified hours: 24.5')).toBeInTheDocument();
    expect(screen.getByText(/Verification code ABCD1234EFGH5678/)).toBeInTheDocument();
    expect(screen.getByText('Food Bank')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('filters to revoked certificates through the address', async () => {
    await renderPage();
    await screen.findByText('Ada Lovelace');

    const group = screen.getByRole('radiogroup', { name: 'Status' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Revoked' }));

    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'revoked' }));
    expect(window.location.search).toContain('status=revoked');
  });

  it('downloads the printable copy for the admin', async () => {
    await renderPage();
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(mockAdminVolunteering.downloadCertificate).toHaveBeenCalledWith(7, 'ABCD1234EFGH5678');
  });

  it('revokes only once a reason is given, then reloads', async () => {
    await renderPage();
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Revoke certificate' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), '  Hours logged in error  ');
    await userEvent.click(submit);

    await waitFor(() => expect(mockAdminVolunteering.revokeCertificate).toHaveBeenCalledWith(7, 'Hours logged in error'));
    expect(mockToast.success).toHaveBeenCalledWith('Certificate revoked.');
    expect(mockAdminVolunteering.listCertificates).toHaveBeenCalledTimes(2);
  });

  it('shows a revoked certificate as revoked, with its reason, and offers no revoke', async () => {
    mockAdminVolunteering.listCertificates.mockResolvedValue(okList([
      makeCertificate({ revoked_at: '2026-10-07T09:00:00Z', revoke_reason: 'Entered in error' }),
    ]));
    await renderPage();
    await screen.findByText('Ada Lovelace');

    expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0);
    expect(screen.getByText(/Entered in error/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mockAdminVolunteering.listCertificates.mockResolvedValue({ success: false, error: 'boom' });
    await renderPage();

    expect(await screen.findByText('The certificates could not be loaded.')).toBeInTheDocument();
  });
});
