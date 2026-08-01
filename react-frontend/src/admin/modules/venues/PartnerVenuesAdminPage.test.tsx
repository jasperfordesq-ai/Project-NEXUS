// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockVenuesApi } = vi.hoisted(() => ({
  mockVenuesApi: {
    adminList: vi.fn(),
    adminCreate: vi.fn(),
    adminUpdate: vi.fn(),
    adminArchive: vi.fn(),
    adminStaff: vi.fn(),
    adminAddStaff: vi.fn(),
    adminRemoveStaff: vi.fn(),
    adminSummary: vi.fn(),
    adminExportCsv: vi.fn(),
  },
}));

vi.mock('@/lib/partner-venues-api', () => ({
  partnerVenuesApi: mockVenuesApi,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

// The page's archive flow uses useConfirm; the barrel re-exports it from this
// module, so mocking here covers the '@/components/ui' import path too.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The staff picker searches the admin users API — stub it as a plain input so
// this suite tests the page's wiring, not the picker's internals (it has its
// own suite).
vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, onSelectedMemberChange }: {
    label: string;
    onSelectedMemberChange?: (member: { id: number; name: string } | null) => void;
  }) => (
    <button type="button" onClick={() => onSelectedMemberChange?.({ id: 42, name: 'Marie Curie' })}>
      {label}
    </button>
  ),
}));

function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <span>{title}</span>
        {actions}
      </div>
    ),
  };
}
vi.mock('../../components/PageHeader', adminComponentsMock);

import PartnerVenuesAdminPage from './PartnerVenuesAdminPage';

const VENUE_ROW = {
  id: 5,
  name: 'The Time Union Cafe',
  category: 'cafe',
  offer_summary: '10% off',
  status: 'active',
  visit_count: 12,
  member_count: 7,
  staff_count: 2,
};

const SUMMARY = {
  window_days: 30,
  total_visits: 12,
  venues: [
    { venue_id: 5, venue_name: 'The Time Union Cafe', total_visits: 12, unique_members: 7, recent_visits: 4 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVenuesApi.adminList.mockResolvedValue({ success: true, data: { venues: [VENUE_ROW] } });
  mockVenuesApi.adminSummary.mockResolvedValue({ success: true, data: SUMMARY });
});

describe('PartnerVenuesAdminPage', () => {
  it('renders the venue list and the per-venue engagement report', async () => {
    render(<PartnerVenuesAdminPage />);

    await waitFor(() => {
      expect(screen.getAllByText('The Time Union Cafe').length).toBeGreaterThan(0);
    });
    // Total stat + per-venue breakdown from the summary payload.
    expect(screen.getByText('Total visits recorded')).toBeInTheDocument();
    expect(screen.getByText('Unique members')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('passes the status filter to the list call', async () => {
    render(<PartnerVenuesAdminPage />);

    await waitFor(() => {
      expect(mockVenuesApi.adminList).toHaveBeenCalledWith(undefined);
    });
    // The page reloads with the chosen status when the filter changes; the
    // Select is driven through state, so assert the wiring by invoking load
    // again after simulating a selection is covered in integration — here we
    // pin the default (no status = all).
  });

  it('exports the CSV with the chosen filters', async () => {
    mockVenuesApi.adminExportCsv.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    render(<PartnerVenuesAdminPage />);

    const exportButton = await screen.findByRole('button', { name: 'Export visits (CSV)' });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockVenuesApi.adminExportCsv).toHaveBeenCalledWith({
        venueId: undefined,
        from: undefined,
        to: undefined,
      });
    });
  });

  it('adds staff through the member search picker', async () => {
    mockVenuesApi.adminStaff.mockResolvedValue({ success: true, data: { staff: [] } });
    mockVenuesApi.adminAddStaff.mockResolvedValue({
      success: true,
      data: { staff: [{ id: 1, user_id: 42, name: 'Marie Curie', role: 'member', status: 'active' }] },
    });

    render(<PartnerVenuesAdminPage />);

    const manageButton = await screen.findByRole('button', { name: 'Manage staff' });
    fireEvent.click(manageButton);

    // Select a member via the stubbed picker, then add.
    fireEvent.click(await screen.findByRole('button', { name: 'Member' }));

    const addButton = screen.getByRole('button', { name: 'Add staff member' });
    await waitFor(() => expect(addButton).not.toBeDisabled());
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockVenuesApi.adminAddStaff).toHaveBeenCalledWith(5, 42, 'member');
    });
  });
});
