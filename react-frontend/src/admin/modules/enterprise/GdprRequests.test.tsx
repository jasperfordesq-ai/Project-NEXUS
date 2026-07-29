// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GdprRequests admin module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock factories ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());

// Dates chosen so SLA chips are deterministic relative to "now" in tests.
// Use a far-future created_at so the chip always shows "days left" (green).
const FUTURE_DATE = vi.hoisted(() => '2099-01-01T00:00:00Z');
const GDPR_REQUESTS = vi.hoisted(() => [
  {
    id: 1,
    user_id: 100,
    user_name: 'Alice Smith',
    type: 'access' as const,
    status: 'pending' as const,
    created_at: FUTURE_DATE,
  },
  {
    id: 2,
    user_id: 101,
    user_name: 'Bob Jones',
    type: 'erasure' as const,
    status: 'processing' as const,
    created_at: FUTURE_DATE,
  },
]);

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    refreshTenant: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getGdprRequests: vi.fn(),
    updateGdprRequest: vi.fn(),
  },
  adminDeliverability: { list: vi.fn(), delete: vi.fn() },
  adminPages: { list: vi.fn(), delete: vi.fn() },
  adminGamification: { getBadgeConfig: vi.fn(), updateBadgeConfig: vi.fn(), resetBadgeConfig: vi.fn() },
  adminLegalDocs: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { GdprRequests } from './GdprRequests';
import { adminEnterprise } from '../../api/adminApi';

// ─────────────────────────────────────────────────────────────────────────────

describe('GdprRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders user names after successful load (array response)', async () => {
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('renders user names from paginated { data, meta } response', async () => {
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: { data: GDPR_REQUESTS, meta: { total: 2 } },
    });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('renders request type values', async () => {
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });

    render(<GdprRequests />);

    // By data attribute, not the cell's text: the label comes from
    // t(`enterprise.gdpr_type_${r.type}`) and no i18n resources load under test.
    await waitFor(() => {
      expect(screen.getAllByTestId('request-type').length).toBeGreaterThan(0);
    });

    const types = screen.getAllByTestId('request-type').map((cell) => cell.getAttribute('data-type'));
    expect(types).toContain('access');
    expect(types).toContain('erasure');
  });

  // ── loading state ─────────────────────────────────────────────────────────
  // Note: GdprRequests passes isLoading to DataTable (not a standalone spinner).
  // The DataTable receives loading prop — component still renders; skeleton/overlay
  // is internal to DataTable. We verify the page header renders while loading.

  it('renders the page header while loading', () => {
    vi.mocked(adminEnterprise.getGdprRequests).mockReturnValue(new Promise(() => {}));
    render(<GdprRequests />);

    // The Refresh button is always rendered regardless of loading state
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  // ── error state ───────────────────────────────────────────────────────────

  it('shows error toast when API throws', async () => {
    vi.mocked(adminEnterprise.getGdprRequests).mockRejectedValue(new Error('Network'));
    render(<GdprRequests />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── status update action (dropdown menu) ──────────────────────────────────

  it('calls updateGdprRequest with "processing" when action pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });
    vi.mocked(adminEnterprise.updateGdprRequest).mockResolvedValue({ success: true });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Open the actions dropdown for the first row
    const actionButtons = screen.getAllByRole('button', { name: /actions/i });
    await user.click(actionButtons[0]);

    // "Mark Processing" item appears in the opened DropdownMenu
    await waitFor(() => {
      expect(screen.getByText(/mark processing/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/mark processing/i));

    await waitFor(() => {
      expect(adminEnterprise.updateGdprRequest).toHaveBeenCalledWith(
        GDPR_REQUESTS[0].id,
        { status: 'processing' },
      );
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls updateGdprRequest with "completed" status', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });
    vi.mocked(adminEnterprise.updateGdprRequest).mockResolvedValue({ success: true });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const actionButtons = screen.getAllByRole('button', { name: /actions/i });
    await user.click(actionButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/mark completed/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/mark completed/i));

    await waitFor(() => {
      expect(adminEnterprise.updateGdprRequest).toHaveBeenCalledWith(
        GDPR_REQUESTS[0].id,
        { status: 'completed' },
      );
    });
  });

  it('shows error toast when status update fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });
    vi.mocked(adminEnterprise.updateGdprRequest).mockResolvedValue({ success: false });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const actionButtons = screen.getAllByRole('button', { name: /actions/i });
    await user.click(actionButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/mark processing/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/mark processing/i));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── navigation ────────────────────────────────────────────────────────────

  it('navigates to GDPR request detail when "View Details" is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const actionButtons = screen.getAllByRole('button', { name: /actions/i });
    await user.click(actionButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/view details/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/view details/i));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining(`/gdpr/requests/${GDPR_REQUESTS[0].id}`),
    );
  });

  it('navigates to create-request page when Create button is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const btns = screen.getAllByRole('button');
    const createBtn = btns.find((b) => b.textContent?.toLowerCase().includes('create'));
    expect(createBtn).toBeTruthy();
    await user.click(createBtn!);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/gdpr/requests/create'),
    );
  });

  // ── refresh button ────────────────────────────────────────────────────────

  it('refetches when the Refresh button is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminEnterprise.getGdprRequests).mockResolvedValue({
      success: true,
      data: GDPR_REQUESTS,
    });

    render(<GdprRequests />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);

    await waitFor(() => {
      // Called once on mount, once on click
      expect(adminEnterprise.getGdprRequests).toHaveBeenCalledTimes(2);
    });
  });
});
