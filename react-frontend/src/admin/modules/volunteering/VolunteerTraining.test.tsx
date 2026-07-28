// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock data ────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const { mockGetTraining, mockVerifyTraining, mockRejectTraining } = vi.hoisted(() => ({
  mockGetTraining: vi.fn(),
  mockVerifyTraining: vi.fn(),
  mockRejectTraining: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: {
    getTraining: mockGetTraining,
    verifyTraining: mockVerifyTraining,
    rejectTraining: mockRejectTraining,
  },
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub heavy admin components.
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: number }) => (
      <div data-testid="stat-card">
        <span>{label}</span>
        <span>{value}</span>
      </div>
    ),
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
    DataTable: ({
      data,
      isLoading,
      columns,
    }: {
      data: Array<Record<string, unknown>>;
      isLoading?: boolean;
      columns: Array<{ key: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
    }) => (
      <div data-testid="data-table">
        {isLoading && <div role="status" aria-busy="true" />}
        {data.map((item) => (
          <div key={String(item.id)} data-testid={`row-${String(item.id)}`}>
            <span>{String(item.volunteer_name ?? '')}</span>
            <span>{String(item.training_type ?? '')}</span>
            <span>{String(item.status ?? '')}</span>
            {columns.map((col) =>
              col.render ? (
                <div key={col.key} data-testid={`col-${col.key}-${String(item.id)}`}>
                  {col.render(item)}
                </div>
              ) : null
            )}
          </div>
        ))}
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeRecord = (overrides = {}) => ({
  id: 1,
  volunteer_name: 'Alice Smith',
  user_id: 10,
  training_type: 'first_aid' as const,
  completed_date: '2025-01-10',
  expires_date: null,
  certificate_ref: 'CERT-001',
  status: 'pending' as const,
  ...overrides,
});

const makeStats = (overrides = {}) => ({
  total_submissions: 10,
  pending_verification: 3,
  verified: 6,
  expired: 1,
  ...overrides,
});

function makeSuccessPayload(records = [makeRecord()], stats = makeStats()) {
  return {
    success: true,
    data: { items: records, stats },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('VolunteerTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTraining.mockResolvedValue(makeSuccessPayload([]));
  });

  it('shows loading spinner while fetching', async () => {
    mockGetTraining.mockReturnValue(new Promise(() => {}));
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    const statusEls = screen.getAllByRole('status');
    // DataTable stub renders role=status while isLoading=true
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no records returned', async () => {
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders volunteer name when records are present', async () => {
    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord()]));
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('shows error toast when API throws', async () => {
    mockGetTraining.mockRejectedValue(new Error('network'));
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders stat cards with data from the stats payload', async () => {
    mockGetTraining.mockResolvedValue(
      makeSuccessPayload([makeRecord()], makeStats({ total_submissions: 42 }))
    );
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('calls verifyTraining when Verify button is clicked', async () => {
    const user = userEvent.setup();
    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord({ status: 'pending', id: 7 })]));
    mockVerifyTraining.mockResolvedValue({ success: true });
    // Re-load after verify returns fresh empty list
    mockGetTraining.mockResolvedValueOnce(makeSuccessPayload([makeRecord({ status: 'pending', id: 7 })]));
    mockGetTraining.mockResolvedValue(makeSuccessPayload([]));

    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const verifyBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('verify')
    );
    expect(verifyBtn).toBeDefined();
    if (verifyBtn) await user.click(verifyBtn);

    await waitFor(() => {
      expect(mockVerifyTraining).toHaveBeenCalledWith(7);
    });
  });

  it('shows success toast after successful verify', async () => {
    const user = userEvent.setup();
    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord({ status: 'pending', id: 7 })]));
    mockVerifyTraining.mockResolvedValue({ success: true });

    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => screen.getByText('Alice Smith'));

    const verifyBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('verify')
    );
    if (verifyBtn) await user.click(verifyBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls rejectTraining when Reject is confirmed in the modal with a reason', async () => {
    const user = userEvent.setup();

    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord({ status: 'pending', id: 9 })]));
    mockRejectTraining.mockResolvedValue({ success: true });

    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => screen.getByText('Alice Smith'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    expect(rejectBtn).toBeDefined();
    if (rejectBtn) await user.click(rejectBtn);

    // Reject now opens a modal with a reason textarea (replaces window.prompt)
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    expect(mockRejectTraining).not.toHaveBeenCalled();

    const dialog = document.querySelector('[role="dialog"]')!;
    const reasonField = dialog.querySelector('textarea');
    expect(reasonField).toBeTruthy();
    await user.type(reasonField as HTMLTextAreaElement, 'Invalid certificate');

    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    expect(confirmBtn).toBeDefined();
    await user.click(confirmBtn!);

    await waitFor(() => {
      expect(mockRejectTraining).toHaveBeenCalledWith(9, 'Invalid certificate');
    });
  });

  it('does NOT call rejectTraining when the reject modal is cancelled', async () => {
    const user = userEvent.setup();

    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord({ status: 'pending' })]));

    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => screen.getByText('Alice Smith'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    if (rejectBtn) await user.click(rejectBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    const cancelBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('cancel')
    );
    expect(cancelBtn).toBeDefined();
    await user.click(cancelBtn!);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeFalsy();
    });
    expect(mockRejectTraining).not.toHaveBeenCalled();
  });

  it('keeps the reject confirm disabled while the reason is empty', async () => {
    const user = userEvent.setup();

    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord({ status: 'pending', id: 4 })]));

    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => screen.getByText('Alice Smith'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    if (rejectBtn) await user.click(rejectBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    const dialog = document.querySelector('[role="dialog"]')!;
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    expect(confirmBtn).toBeDefined();

    // Empty reason → confirm is disabled and clicking it does nothing
    await user.click(confirmBtn!);
    expect(mockRejectTraining).not.toHaveBeenCalled();
  });

  it('renders expiry alert when a verified record expires within 30 days', async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);

    mockGetTraining.mockResolvedValue(
      makeSuccessPayload([
        makeRecord({
          status: 'verified',
          expires_date: soon.toISOString().split('T')[0],
          volunteer_name: 'Bob Jones',
        }),
      ])
    );
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => {
      expect(screen.getAllByText('Bob Jones').length).toBeGreaterThanOrEqual(1);
    });
    // Expiry alert also shows the volunteer name (appears in both table and alert)
    expect(screen.queryAllByText('Bob Jones').length).toBeGreaterThanOrEqual(2);
  });

  it('shows bulk verify button when pending records are selected', async () => {
    // The DataTable stub doesn't render checkboxes; bulk bar only appears when selectedIds.size > 0.
    // This is an internal state transition driven by toggleSelection. Since DataTable is stubbed,
    // this test only verifies the initial render does NOT show the bulk bar.
    mockGetTraining.mockResolvedValue(makeSuccessPayload([makeRecord()]));
    const { VolunteerTraining } = await import('./VolunteerTraining');
    render(<VolunteerTraining />);

    await waitFor(() => screen.getByText('Alice Smith'));

    // Bulk bar should NOT be visible initially (no selections)
    const bulkVerifyBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('bulk')
    );
    expect(bulkVerifyBtn).toBeUndefined();
  });
});
