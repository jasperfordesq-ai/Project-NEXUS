// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoist mock fns
// ---------------------------------------------------------------------------
const mockGetApiKeys = vi.hoisted(() => vi.fn());
const mockRevokeApiKey = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('../../api/adminApi', () => ({
  adminFederation: {
    getApiKeys: mockGetApiKeys,
    revokeApiKey: mockRevokeApiKey,
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({
      success: mockToastSuccess,
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// PartnerTimebankGuidance renders decorative content — stub it out
vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => null,
}));

import { ApiKeys } from './ApiKeys';

const ACTIVE_KEY = {
  id: 1,
  name: 'Production Key',
  key_prefix: 'pk_live_abc',
  status: 'active',
  scopes: ['read', 'write'],
  last_used_at: '2026-06-01T12:00:00Z',
  expires_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const REVOKED_KEY = {
  id: 2,
  name: 'Old Key',
  key_prefix: 'pk_old_xyz',
  status: 'revoked',
  scopes: ['read'],
  last_used_at: null,
  expires_at: null,
  created_at: '2025-01-01T00:00:00Z',
};

describe('ApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no keys are returned', async () => {
    mockGetApiKeys.mockResolvedValue({ success: true, data: [] });
    render(<ApiKeys />);

    await waitFor(() => {
      // Empty state from EmptyState component
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
    });
    // The "Create API key" action button should appear
    expect(
      screen.getAllByRole('button').some((b) => /create/i.test(b.textContent ?? ''))
    ).toBe(true);
  });

  it('renders data table rows when keys are returned', async () => {
    mockGetApiKeys.mockResolvedValue({ success: true, data: [ACTIVE_KEY, REVOKED_KEY] });
    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument();
    });
    expect(screen.getByText('Old Key')).toBeInTheDocument();
  });

  it('shows Revoke button only for active keys', async () => {
    mockGetApiKeys.mockResolvedValue({ success: true, data: [ACTIVE_KEY, REVOKED_KEY] });
    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument();
    });

    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    // Only one revoke button (for ACTIVE_KEY); REVOKED_KEY renders null
    expect(revokeButtons.length).toBe(1);
  });

  it('opens confirm modal when Revoke button is pressed', async () => {
    const user = userEvent.setup();
    mockGetApiKeys.mockResolvedValue({ success: true, data: [ACTIVE_KEY] });
    render(<ApiKeys />);

    await waitFor(() => expect(screen.getByText('Production Key')).toBeInTheDocument());

    const revokeBtn = screen.getByRole('button', { name: /revoke/i });
    await user.click(revokeBtn);

    // ConfirmModal should open — look for a dialog or the confirmation message
    await waitFor(() => {
      // The modal title from federation.revoke_key_title key
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls revokeApiKey and shows success toast on confirm', async () => {
    const user = userEvent.setup();
    mockGetApiKeys.mockResolvedValue({ success: true, data: [ACTIVE_KEY] });
    mockRevokeApiKey.mockResolvedValue({ success: true });
    render(<ApiKeys />);

    await waitFor(() => expect(screen.getByText('Production Key')).toBeInTheDocument());

    // Click Revoke to open modal
    await user.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Find the confirm button inside the dialog and click it
    const confirmBtn = screen.getAllByRole('button', { name: /revoke/i }).at(-1)!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockRevokeApiKey).toHaveBeenCalledWith(ACTIVE_KEY.id);
      expect(mockToastSuccess).toHaveBeenCalled();
    });
  });

  it('shows error toast when revokeApiKey throws', async () => {
    const user = userEvent.setup();
    mockGetApiKeys.mockResolvedValue({ success: true, data: [ACTIVE_KEY] });
    mockRevokeApiKey.mockRejectedValue(new Error('server error'));
    render(<ApiKeys />);

    await waitFor(() => expect(screen.getByText('Production Key')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    const confirmBtn = screen.getAllByRole('button', { name: /revoke/i }).at(-1)!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it('still renders keys from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/federation/api-keys really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    mockGetApiKeys.mockResolvedValue({
      success: true,
      data: { data: [ACTIVE_KEY] },
    });
    render(<ApiKeys />);

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument();
    });
  });

  it('gracefully handles failed load (shows empty table)', async () => {
    mockGetApiKeys.mockRejectedValue(new Error('network'));
    render(<ApiKeys />);

    await waitFor(() => {
      // Empty state: no table rows
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
    });
  });
});
