// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DeliverablesList admin module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock factories ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());

const DELIVERABLES = vi.hoisted(() => [
  {
    id: 1,
    title: 'Alpha Release',
    description: 'Ship alpha',
    priority: 'high',
    status: 'in_progress',
    assigned_to: 'Alice',
    due_date: '2026-07-01',
    created_at: '2026-01-01',
  },
  {
    id: 2,
    title: 'Beta Release',
    description: 'Ship beta',
    priority: 'medium',
    status: 'planned',
    assigned_to: '',
    due_date: '',
    created_at: '2026-01-02',
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

// adminDeliverability lives inside adminApi which internally calls api.*
// Mock the whole adminApi module at path level
vi.mock('../../api/adminApi', () => ({
  adminDeliverability: {
    list: vi.fn(),
    delete: vi.fn(),
  },
  adminPages: { list: vi.fn(), delete: vi.fn() },
  adminEnterprise: { getGdprRequests: vi.fn(), updateGdprRequest: vi.fn() },
  adminGamification: { getBadgeConfig: vi.fn(), updateBadgeConfig: vi.fn(), resetBadgeConfig: vi.fn() },
  adminLegalDocs: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Import after mocks are declared
import { DeliverablesList } from './DeliverablesList';
import { adminDeliverability } from '../../api/adminApi';

// ─────────────────────────────────────────────────────────────────────────────

describe('DeliverablesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loading state ─────────────────────────────────────────────────────────

  it('shows a loading spinner while fetching', () => {
    // Never resolves — keeps component in loading state
    vi.mocked(adminDeliverability.list).mockReturnValue(new Promise(() => {}));
    render(<DeliverablesList />);

    const spinners = screen.getAllByRole('status');
    const busySpinner = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busySpinner).toBeInTheDocument();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders deliverable titles after successful load (array response)', async () => {
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta Release')).toBeInTheDocument();
  });

  it('renders deliverables from the paginated shape (rows in data, pagination in meta)', async () => {
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // this paginated endpoint: `data` is the bare row array and pagination lives on
    // the sibling `meta`. An earlier fixture nested the rows inside `data`, a shape
    // the client never produces.
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES, meta: { current_page: 1, per_page: 20, total: 2, total_pages: 1, has_more: false },
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });
  });

  it('shows the "Create Deliverable" button after load', async () => {
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });

    // At least one element with "Create" text should exist (header button)
    const createBtns = screen.getAllByRole('button');
    const hasCreate = createBtns.some((b) => b.textContent?.includes('Create'));
    expect(hasCreate).toBe(true);
  });

  // ── empty state ───────────────────────────────────────────────────────────

  it('shows an empty state when the API returns an empty array', async () => {
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: [],
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      // Spinner gone
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    // EmptyState renders an action button / message — multiple buttons may exist so use getAllByRole
    const createBtns = screen.getAllByRole('button', { name: /create deliverable/i });
    expect(createBtns.length).toBeGreaterThan(0);
  });

  // ── error state ───────────────────────────────────────────────────────────

  it('shows an error alert when the API returns success:false', async () => {
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: false,
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('shows an error alert when the API throws', async () => {
    vi.mocked(adminDeliverability.list).mockRejectedValue(new Error('Network error'));

    render(<DeliverablesList />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  // ── delete action ─────────────────────────────────────────────────────────

  it('opens confirm modal when delete icon is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });

    // Click the first delete button (aria-label pattern from source)
    const deleteButtons = screen.getAllByRole('button', { name: /delete deliverable/i });
    await user.click(deleteButtons[0]);

    // ConfirmModal should appear — it renders a dialog or modal with confirm button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });
  });

  it('calls adminDeliverability.delete and refetches on confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });
    vi.mocked(adminDeliverability.delete).mockResolvedValue({ success: true });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete deliverable/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(adminDeliverability.delete).toHaveBeenCalledWith(DELIVERABLES[0].id);
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows error toast when delete fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });
    vi.mocked(adminDeliverability.delete).mockResolvedValue({ success: false });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete deliverable/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── navigation ────────────────────────────────────────────────────────────

  it('navigates to edit page when edit icon is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminDeliverability.list).mockResolvedValue({
      success: true,
      data: DELIVERABLES,
    });

    render(<DeliverablesList />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Release')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /edit deliverable/i });
    await user.click(editButtons[0]);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining(`/deliverability/edit/${DELIVERABLES[0].id}`),
    );
  });
});
