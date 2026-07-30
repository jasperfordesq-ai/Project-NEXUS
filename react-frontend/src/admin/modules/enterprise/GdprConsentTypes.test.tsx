// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock data ────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const { mockGetConsentTypes, mockCreateConsentType, mockUpdateConsentType, mockDeleteConsentType, mockGetConsentTypeUsers, mockExportConsentTypeUsers } = vi.hoisted(() => ({
  mockGetConsentTypes: vi.fn(),
  mockCreateConsentType: vi.fn(),
  mockUpdateConsentType: vi.fn(),
  mockDeleteConsentType: vi.fn(),
  mockGetConsentTypeUsers: vi.fn(),
  mockExportConsentTypeUsers: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
// consent_types is a platform-global catalogue: create/edit/delete are gated on
// requirePlatformSuperAdmin() server-side, and the page mirrors that. Most tests
// here exercise the CRUD, so the default identity is a platform super admin;
// the gating test below overrides it with a plain tenant admin.
const mockAuthUser = vi.hoisted(() => ({
  current: { id: 1, role: 'super_admin', is_super_admin: true } as Record<string, unknown> | null,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({ user: mockAuthUser.current, isAuthenticated: true }),
  })
);

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getConsentTypes: mockGetConsentTypes,
    createConsentType: mockCreateConsentType,
    updateConsentType: mockUpdateConsentType,
    deleteConsentType: mockDeleteConsentType,
    getConsentTypeUsers: mockGetConsentTypeUsers,
    exportConsentTypeUsers: mockExportConsentTypeUsers,
  },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub heavy admin sub-components that render complex data tables
vi.mock('../../components', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  DataTable: ({ data, isLoading, emptyContent }: { data: unknown[]; isLoading?: boolean; emptyContent?: string }) => (
    <div>
      {isLoading && <div role="status" aria-busy="true" />}
      {!isLoading && data.length === 0 && <div>{emptyContent}</div>}
      {(data as Array<{ user_name?: string; user_email?: string }>).map((item, i) => (
        <div key={i}>{item.user_name || item.user_email}</div>
      ))}
    </div>
  ),
  ConfirmModal: ({ isOpen, onConfirm, onClose, title }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string }) => (
    isOpen ? (
      <div role="dialog" aria-label="Dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeConsentType = (overrides = {}) => ({
  id: 1,
  slug: 'marketing',
  name: 'Marketing Consent',
  description: 'Marketing emails consent',
  category: 'marketing',
  is_required: false,
  legal_basis: 'Legitimate interest',
  retention_days: 365,
  display_order: 0,
  is_active: true,
  granted_count: 80,
  denied_count: 20,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GdprConsentTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthUser.current = { id: 1, role: 'super_admin', is_super_admin: true };
    mockGetConsentTypes.mockResolvedValue({ success: true, data: [] });
    mockExportConsentTypeUsers.mockReturnValue('/api/v2/admin/consent-types/marketing/users.csv');
  });

  it('shows loading spinner while fetching', async () => {
    mockGetConsentTypes.mockReturnValue(new Promise(() => {}));
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    const statusEls = screen.getAllByRole('status');
    const busyEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeDefined();
  });

  it('shows empty message when no consent types returned', async () => {
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busy).toBeUndefined();
    });
  });

  it('renders consent type cards when data is returned', async () => {
    mockGetConsentTypes.mockResolvedValue({
      success: true,
      data: [makeConsentType()],
    });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(screen.getByText('Marketing Consent')).toBeInTheDocument();
    });
    expect(screen.getAllByText('marketing').length).toBeGreaterThan(0);
  });

  it('shows error toast when API throws', async () => {
    mockGetConsentTypes.mockRejectedValue(new Error('network error'));
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('opens create modal when "Create Consent Type" button is pressed', async () => {
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busy).toBeUndefined();
    });

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') ||
      b.textContent?.toLowerCase().includes('add')
    );
    expect(createBtn).toBeDefined();
    if (createBtn) fireEvent.click(createBtn);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('shows toast error when form submitted without required fields', async () => {
    const user = userEvent.setup();
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busy).toBeUndefined();
    });

    // Open create modal
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') ||
      b.textContent?.toLowerCase().includes('add')
    );
    if (createBtn) await user.click(createBtn);

    // Submit with empty fields (modal opens, find submit)
    await waitFor(() => document.querySelector('[role="dialog"]'));
    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') &&
      b.closest('[role="dialog"]')
    );
    if (submitBtn) await user.click(submitBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('opens delete confirm modal and calls deleteConsentType on confirm', async () => {
    const user = userEvent.setup();
    mockGetConsentTypes.mockResolvedValue({
      success: true,
      data: [makeConsentType({ id: 5 })],
    });
    mockDeleteConsentType.mockResolvedValue({ success: true });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(screen.getByText('Marketing Consent')).toBeInTheDocument();
    });

    // Click delete icon button (aria-label contains 'delete')
    const deleteBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    expect(deleteBtn).toBeDefined();
    if (deleteBtn) await user.click(deleteBtn);

    // Confirm dialog appears
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    // This page passes confirmLabel={t('enterprise.gdpr_delete')}, so the
    // button reads "Delete", not "Confirm". Locating it by label found nothing,
    // and the old `if (confirmBtn)` guard turned that into a silent no-click.
    await user.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockDeleteConsentType).toHaveBeenCalledWith(5);
    });
  });

  it('shows success toast after successful delete', async () => {
    const user = userEvent.setup();
    mockGetConsentTypes.mockResolvedValue({
      success: true,
      data: [makeConsentType()],
    });
    mockDeleteConsentType.mockResolvedValue({ success: true });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => expect(screen.getByText('Marketing Consent')).toBeInTheDocument());

    const deleteBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    if (deleteBtn) await user.click(deleteBtn);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    await user.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('renders consent rate correctly for a card with 80 granted / 100 total', async () => {
    mockGetConsentTypes.mockResolvedValue({
      success: true,
      data: [makeConsentType({ granted_count: 80, denied_count: 20 })],
    });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(screen.getByText(/80\.0%/)).toBeInTheDocument();
    });
  });

  it('hides catalogue mutation controls from a tenant admin', async () => {
    // consent_types is shared across every community, so the server refuses
    // create/update/delete for anyone below platform super admin. The page must
    // not offer buttons that would 403 — but reading the catalogue is fine.
    mockAuthUser.current = { id: 2, role: 'admin', is_super_admin: false };
    mockGetConsentTypes.mockResolvedValue({
      success: true,
      data: [makeConsentType({ name: 'Marketing Emails' })],
    });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(screen.getByText('Marketing Emails')).toBeInTheDocument();
    });

    const labels = screen.getAllByRole('button').map((b) =>
      `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`.toLowerCase()
    );
    expect(labels.some((l) => l.includes('create'))).toBe(false);
    expect(labels.some((l) => l.includes('edit'))).toBe(false);
    expect(labels.some((l) => l.includes('delete'))).toBe(false);
    // Read-only affordances survive.
    expect(labels.some((l) => l.includes('users'))).toBe(true);
  });

  it('surfaces an error instead of an empty list when the load fails', async () => {
    // The API client resolves rather than throws, so without an explicit
    // res.success check a 500 renders as "no consent types" — which is exactly
    // how the phantom tenant_id filter stayed invisible.
    mockGetConsentTypes.mockResolvedValue({ success: false, error: 'boom' });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls refresh when Refresh button is pressed', async () => {
    const user = userEvent.setup();
    mockGetConsentTypes.mockResolvedValue({ success: true, data: [] });
    const { GdprConsentTypes } = await import('./GdprConsentTypes');
    render(<GdprConsentTypes />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busy).toBeUndefined();
    });

    const refreshBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh')
    );
    expect(refreshBtn).toBeDefined();
    if (refreshBtn) await user.click(refreshBtn);

    await waitFor(() => {
      expect(mockGetConsentTypes).toHaveBeenCalledTimes(2);
    });
  });
});
